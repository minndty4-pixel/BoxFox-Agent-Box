"""BoxFox v0 harness: adapted Hermes loop/delegation with durable OpenCode-style sessions.

Original licenses and exact/adapted module provenance: ../vendor/manifest.json.
"""
import asyncio
import copy
import json
from pathlib import Path
import re
import time
import uuid
import httpx
from .compression import ContextCompressor, estimate_tokens
from .roles import ROLES, allowed_tools
from .tool_contracts import schemas_for
from ..skills.catalog import SkillCatalog, DEFAULT_SKILLS
from ..skills.commands import CommandRegistry, ROLE_SKILLS, EXTERNAL
from ..skills.lifecycle import SkillLoader
from ..skills.runtime_commands import RuntimeCommands
from ..vendor.hermes.tool_arguments import _parse_tool_arguments

TOOL_USE_ENFORCEMENT_GUIDANCE = """# Tool-Use Enforcement
You MUST use your available tools or delegate to specialist subagents to make tangible progress — NEVER simply describe what you would do or promise future actions without executing them now.
Every response should either (a) contain tool calls or delegation calls that advance the task, or (b) deliver the final verified outcome to the user.
Responses that only state intentions without action are strictly prohibited."""

EXECUTION_DISCIPLINE_GUIDANCE = """# Execution Discipline & Mandatory Tool Use
NEVER answer these from memory, mental computation, or hallucination — ALWAYS use a tool:
- Arithmetic, math, calculations -> terminal_exec (e.g. python -c "...")
- Hashes, checksums, encodings -> terminal_exec (e.g. sha256sum, base64)
- Current time, date, environment variables -> terminal_exec
- System state: OS, memory, processes, ports -> terminal_exec
- File contents, line counts, directory trees -> file_read, codebase_grep, codebase_glob
- Git status, commits, diffs -> terminal_exec (e.g. git status, git diff)
Always verify return codes. Never assume an operation succeeded without inspecting its output."""

ACT_DONT_ASK_GUIDANCE = """# Act Don't Ask
When a request has an obvious default interpretation or can be resolved by exploring the workspace/sandbox, act immediately using tools instead of asking the user for clarification. Only ask when genuine ambiguity prevents choosing an action."""

TASK_COMPLETION_GUIDANCE = """# Finishing the Job & Grounded Verification
The deliverable for any engineering task is a working, tested artifact backed by real tool output — not an unexecuted plan or code stub with '// TODO'.
Keep working until code is actually written, real tests are executed, and output confirms correctness.
NEVER substitute fabricated test results or made-up output for missing tool executions. Report blockers honestly."""

PARALLEL_TOOL_CALL_GUIDANCE = """# Parallel Tool Calls
When you need several independent pieces of information (e.g. reading multiple files, searching multiple patterns), issue them together in a single assistant turn. Batching independent calls saves conversation context and reduces round trips."""

ORCHESTRATOR_SOP_GUIDANCE = """You are the Supreme Orchestrator Brain of BoxFox.
Your primary responsibility is to analyze user requests, break down complex engineering objectives, and coordinate your 9 specialist subagents to achieve verified, production-grade results.

CORE MULTI-AGENT DELEGATION PROTOCOL:
1. Triage & Scope Assessment:
   - For trivial 1-step queries (e.g. running a quick command, viewing a single file), you may execute directly using your available tools.
   - For any non-trivial development, bugfix, refactoring, or feature request: NEVER attempt to do everything in a single turn. You MUST invoke your specialists via `delegate_task`.
2. Hierarchical 5-Phase Execution Workflow:
   - Phase 1 (Explore): Delegate to role='explore' to survey files, symbols, dependency trees, and existing architecture.
   - Phase 2 (Plan & Design):
     * Delegate to role='plan' to construct ordered milestones, risks, and acceptance criteria.
     * For user-facing or architectural changes, delegate to role='design' to specify API/UI contracts before coding.
   - Phase 3 (Build): Delegate implementation slices to role='build'. Enforce surgical edits and zero placeholder stubs.
   - Phase 4 (Testing & Quality Assurance):
     * Delegate to role='testing' to run real automated tests (pytest, npm test) and visual UI checks.
     * If tests fail or bugs emerge, delegate to role='debug' to isolate root cause and apply minimal fixes.
   - Phase 5 (Review & Simplification):
     * Delegate to role='review' to audit diffs for security, regressions, and quality.
     * Delegate to role='simplify' if code cleanup is needed.
3. Subagent Context & Handoff Management:
   - When calling `delegate_task(role=..., goal=..., context=...)`, provide concise, highly relevant context from earlier phases.
   - Do NOT assume a child agent succeeded merely because it finished. Inspect its summary, executed tools, and error status. If a child agent fails, diagnose why and assign a targeted corrective task.
4. Final Synthesis & Delivery:
   - Deliver a clear, professional summary to the user highlighting: (1) what changed, (2) verified test outputs, and (3) any operational notes. No filler, no sycophancy."""

IDENTITY = f'''You are BoxFox, an elite autonomous multi-agent software engineering system operating in a dedicated Docker sandbox.
You embody ruthless technical precision: match the depth of your reply to the weight of the ask. Plain claims over adjectives; no filler, no sycophancy.

{TOOL_USE_ENFORCEMENT_GUIDANCE}

{EXECUTION_DISCIPLINE_GUIDANCE}

{ACT_DONT_ASK_GUIDANCE}

{TASK_COMPLETION_GUIDANCE}

{PARALLEL_TOOL_CALL_GUIDANCE}'''


def get_agent_identity() -> str:
    root_paths = [
        Path.cwd() / 'AGENT.md',
        Path(__file__).resolve().parents[4] / 'AGENT.md',
    ]
    for p in root_paths:
        if p.is_file():
            try:
                return p.read_text(encoding='utf-8').strip()
            except Exception:
                pass
    return IDENTITY


class AntiLoopGuard:
    """Detects repeated failing tool calls to prevent runaway hallucination loops."""
    def __init__(self, threshold=3):
        self.history = []
        self.threshold = threshold

    def check_and_record(self, name: str, args: dict, is_error: bool) -> bool:
        signature = (name, json.dumps(args, sort_keys=True, default=str), is_error)
        self.history.append(signature)
        if len(self.history) >= self.threshold:
            recent = self.history[-self.threshold:]
            if all(item == signature for item in recent) and is_error:
                return True
        return False


class RouterClient:
    def __init__(self, url='http://127.0.0.1:3101'):
        self.url = url.rstrip('/')

    async def model_metadata(self, connection_id, model_id):
        """Read one model record from the router snapshot.

        The router is the only component that talks to provider APIs, so it owns the
        real context window and thinking metadata. Returns None when unavailable.
        """
        if not connection_id or not model_id:
            return None
        try:
            async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
                response = await client.get(self.url + '/api/router/state', headers={'x-boxfox-admin': '1'})
                if response.is_error:
                    return None
                snapshot = response.json()
        except Exception:
            return None
        for connection in snapshot.get('connections', []) or []:
            if connection.get('id') != connection_id:
                continue
            for model in connection.get('models', []) or []:
                if model.get('id') == model_id:
                    return model
        return None

    async def complete(self, messages, tools, route, on_thought=None, on_content=None, max_tokens=4096):
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            try:
                async with client.stream(
                    'POST',
                    self.url + '/api/router/chat',
                    headers={'x-boxfox-admin': '1'},
                    json={**route, 'messages': messages, 'tools': tools, 'stream': True, 'max_tokens': max_tokens}
                ) as response:
                    if response.is_error:
                        content = await response.aread()
                        try:
                            message = json.loads(content).get('error', {}).get('message', 'Router request failed')
                        except Exception:
                            message = content.decode('utf-8', errors='ignore') or 'Router request failed'
                        raise RuntimeError(f'Router HTTP {response.status_code}: {message}')

                    content = ''
                    reasoning_content = ''
                    tool_calls = {}
                    finish_reason = 'stop'
                    req_id = 'resp_' + uuid.uuid4().hex[:12]
                    usage = None
                    boxfox_meta = None

                    async for line in response.aiter_lines():
                        if not line or not line.startswith('data:'):
                            continue
                        data_str = line[5:].strip()
                        if data_str == '[DONE]':
                            break
                        try:
                            chunk = json.loads(data_str)
                        except Exception:
                            continue
                        if chunk.get('id'):
                            req_id = chunk['id']
                        if chunk.get('boxfox'):
                            boxfox_meta = chunk['boxfox']
                        if chunk.get('usage'):
                            usage = chunk['usage']
                        choices = chunk.get('choices') or []
                        if not choices:
                            continue
                        choice = choices[0]
                        if choice.get('finish_reason'):
                            finish_reason = choice['finish_reason']
                        delta = choice.get('delta') or {}
                        if delta.get('content'):
                            content += delta['content']
                            if on_content and callable(on_content):
                                try:
                                    res = on_content(content)
                                    if asyncio.iscoroutine(res):
                                        await res
                                except Exception:
                                    pass
                        if delta.get('reasoning_content'):
                            reasoning_content += delta['reasoning_content']
                            if on_thought and callable(on_thought):
                                try:
                                    res = on_thought(reasoning_content)
                                    if asyncio.iscoroutine(res):
                                        await res
                                except Exception:
                                    pass
                        for tc in delta.get('tool_calls') or []:
                            idx = tc.get('index', 0)
                            old = tool_calls.setdefault(idx, {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                            if tc.get('id'):
                                old['id'] = tc['id']
                            if tc.get('function', {}).get('name'):
                                old['function']['name'] += tc['function']['name']
                            if tc.get('function', {}).get('arguments'):
                                old['function']['arguments'] += tc['function']['arguments']
                            sig = tc.get('thought_signature') or tc.get('thoughtSignature')
                            if sig:
                                old['thought_signature'] = sig
                                old['thoughtSignature'] = sig

                    if not content and not tool_calls:
                        raise ValueError('Upstream did not return any SSE completion content')
                    return {
                        'id': req_id,
                        'choices': [{
                            'index': 0,
                            'message': {
                                'role': 'assistant',
                                'content': content or None,
                                'reasoning_content': reasoning_content or None,
                                'tool_calls': list(tool_calls.values()) if tool_calls else []
                            },
                            'finish_reason': finish_reason
                        }],
                        'usage': usage,
                        'boxfox': boxfox_meta
                    }
            except Exception:
                res = await client.post(self.url + '/api/router/chat',
                    headers={'x-boxfox-admin': '1'}, json={**route, 'messages': messages,
                        'tools': tools, 'stream': False, 'max_tokens': max_tokens})
                if res.is_error:
                    try:
                        message = res.json().get('error', {}).get('message', 'Router request failed')
                    except ValueError:
                        message = 'Router request failed'
                    raise RuntimeError(f'Router HTTP {res.status_code}: {message}')
                return res.json()


def route_for(value):
    if not value or value in {'default', 'inherit'}:
        return {}
    if value.startswith('model:'):
        _, connection, model = value.split(':', 2)
        return {'connectionId': connection, 'modelId': model}
    if value.startswith('alias:'):
        return {'aliasId': value[6:]}
    return {'model': value}


def resolve_context_window(model_str='', requested=None, metadata=None):
    """Resolve the context window. Priority: explicit request → router model metadata → name table.

    The name table is a last resort only: the router reads the true value from the
    provider API (provider `/models`), so prefer that over guessing from the model name.
    """
    if requested is not None:
        try:
            val = int(requested)
            if val > 0:
                return min(2000000, max(4096, val))
        except (ValueError, TypeError):
            pass
    if metadata:
        try:
            value = int((metadata or {}).get('contextWindow'))
            if value > 0:
                return min(2000000, max(4096, value))
        except (ValueError, TypeError, AttributeError):
            pass
    m = str(model_str or '').lower()
    if 'gemini' in m:
        return 1000000
    if 'claude' in m:
        return 200000
    if 'deepseek' in m or 'qwen' in m:
        return 64000
    return 128000


DECISION_TOOLS = frozenset({'ask_user', 'request_approval'})
DECISION_DEFAULT_SECONDS = {'ask_user': 300.0, 'request_approval': 600.0}
DECISION_MAX_SECONDS = 3600.0
DECISION_OPTION_KINDS = frozenset({'approve', 'reject', 'alternative'})
# The contract's default pair (docs/plan/next-batch-contract.md §1). Ids are fixed so the route
# validation, defaultChoice and the UI can rely on them; only the labels are model-supplied.
DEFAULT_APPROVE_OPTION = {'id': 'approve', 'label': 'Duyệt', 'kind': 'approve'}
DEFAULT_REJECT_OPTION = {'id': 'reject', 'label': 'Từ chối', 'kind': 'reject'}

DECISION_OUTCOME_MESSAGES = {
    'approved': 'User approved this request; continue with exactly the approved action.',
    'rejected': 'User rejected this request. Do not perform it; explain plainly and choose another approach.',
    'expired': 'Nobody answered before the deadline, so the request expired and counts as rejected. Do not perform this action and say so plainly.',
    'cancelled': 'The session was stopped before an answer arrived; the request counts as rejected.',
}

# Filename rules are enforced by deploy/docker/plan_files.py:18-22; keep this identical.
PLAN_VERSION = r'[1-9][0-9]{0,9}'
PLAN_SLUG = r'[a-z0-9]+(-[a-z0-9]+)*'
# `.plans/[<dir>/]v<version>-<slug>.md`; nested directories are legal (plan_files.py:250-330) and
# each directory segment must itself match the slug rule, exactly like the reader enforces.
PLAN_PATH_RE = re.compile(rf'^\.plans/(?P<directory>(?:{PLAN_SLUG}/)*)v(?P<version>{PLAN_VERSION})-(?P<slug>{PLAN_SLUG})\.md$')
PLAN_SLUG_RE = re.compile(rf'^{PLAN_SLUG}$')
PLAN_MAX_SLUG = 60
PLAN_MAX_BYTES = 1048576


class DecisionError(Exception):
    """Route-level decision failure carrying the exact contract status and error-code prefix."""

    def __init__(self, code, message, status):
        super().__init__(code + ': ' + message)
        self.code, self.status = code, status


def plan_slug(value):
    """Normalize a plan slug to the filename rule enforced by plan_files.py, or refuse it."""
    text = re.sub(r'[^a-z0-9]+', '-', str(value or '').strip().lower()).strip('-')[:PLAN_MAX_SLUG].rstrip('-')
    if not text or not PLAN_SLUG_RE.fullmatch(text):
        raise ValueError('PLAN_SLUG_INVALID: slug must be lowercase words separated by single dashes, e.g. workspace-plan')
    return text


def plan_title(value, markdown, slug):
    """Real title for the plan_written event: explicit title, else the first H1, else the slug."""
    title = ' '.join(str(value or '').split())
    if not title:
        title = next((line[2:].strip() for line in str(markdown).splitlines() if line.startswith('# ')), '')
    return (title or slug.replace('-', ' ').capitalize())[:120]


def plan_identity(relative_path):
    """The value `GET /__box/plans` groups a plan by (plan_files.py:315-321): bare slug, else `dir/slug`.

    NEVER version-qualified — the version is a separate field — because the Plan tab selects a plan by
    the `(identity, version)` pair the reader returns. Returns '' for a path the reader would reject.
    """
    match = PLAN_PATH_RE.fullmatch(str(relative_path or ''))
    if not match:
        return ''
    directory = match.group('directory').rstrip('/')
    return (directory + '/' if directory else '') + match.group('slug')


def normalize_decision_options(raw, kind):
    """Normalize 2-5 options to the contract shape {id, label, kind} and guarantee the pair.

    A 'question' needs options; an 'approval' falls back to the default approve/reject pair.
    """
    items = list(raw) if isinstance(raw, (list, tuple)) else []
    options = []
    for item in items:
        if isinstance(item, str):
            label, oid, option_kind = item.strip(), '', 'alternative'
        elif isinstance(item, dict):
            label = str(item.get('label') or item.get('id') or '').strip()
            oid = str(item.get('id') or '')
            option_kind = item.get('kind') if item.get('kind') in DECISION_OPTION_KINDS else 'alternative'
        else:
            raise ValueError('DECISION_INVALID: each option must be a text label or an object with a label')
        if not label:
            raise ValueError('DECISION_INVALID: every option needs a label')
        if option_kind in {'approve', 'reject'}:
            options.append({'id': option_kind, 'label': label, 'kind': option_kind})
        else:
            oid = re.sub(r'[^a-z0-9]+', '-', (oid or label).strip().lower()).strip('-')[:40]
            if not oid:
                raise ValueError('DECISION_INVALID: an option needs a label or id with letters or digits')
            options.append({'id': oid, 'label': label, 'kind': 'alternative'})
    if not options:
        if kind != 'approval':
            raise ValueError('DECISION_INVALID: ask_user requires 2-5 options')
        options = [dict(DEFAULT_APPROVE_OPTION), dict(DEFAULT_REJECT_OPTION)]
    if len(options) < 2:
        raise ValueError('DECISION_INVALID: at least 2 options are required')
    if len(options) > 5:
        raise ValueError('DECISION_INVALID: at most 5 options are supported')
    # The contract guarantees one approve and one reject in every request.
    if not any(o['kind'] == 'approve' for o in options):
        options[0] = {**options[0], 'id': 'approve', 'kind': 'approve'}
    if not any(o['kind'] == 'reject' for o in options):
        options[-1] = {**options[-1], 'id': 'reject', 'kind': 'reject'}
    unique, seen = [], set()
    for option in options:
        oid, suffix = option['id'], 1
        while oid in seen:
            suffix += 1
            oid = f"{option['id']}-{suffix}"
        seen.add(oid)
        unique.append({**option, 'id': oid})
    return unique


def decision_deadline(args, kind, now=None):
    """Epoch-seconds deadline for a decision: model request clamped to the contract ceiling."""
    now = time.time() if now is None else now
    requested = args.get('deadlineSeconds')
    if requested is None:
        requested = args.get('deadline')
    seconds = DECISION_DEFAULT_SECONDS[kind]
    try:
        value = float(requested)
        seconds = value - now if value > 1e9 else value
    except (TypeError, ValueError):
        pass
    return round(now + min(DECISION_MAX_SECONDS, max(1.0, seconds)), 3)


class HarnessRuntime(RuntimeCommands):
    def __init__(self, store, executor, client=None, catalog=None):

        self.store, self.executor = store, executor
        self.client = client or RouterClient()
        self.catalog = catalog or SkillCatalog()
        self.commands = CommandRegistry(store, self.catalog)
        self.skill_loader = SkillLoader(self.catalog, store.emit)
        self.active_messages = {}
        self.tasks = {}
        # decisionId -> pending record; settled records are kept so a second answer is a real 409.
        self.pending = {}
        # sessionId -> the asyncio.timeout budget of the live turn (paused while a decision blocks).
        self.run_budget = {}
        self.child_slots = asyncio.Semaphore(3)
        self.writer_lock = asyncio.Lock()

    def create(self, values, parent_id=None, role='orchestrator', parent_tools=None):
        skills = values.get('skills', sorted(DEFAULT_SKILLS))
        if not isinstance(skills, list) or any(s not in self.catalog.items for s in skills):
            raise ValueError('Unknown skills selection')
        subagents = values.get('subagents', [{'id': r, 'enabled': True, 'model': 'inherit'} for r in ROLES])
        if not isinstance(subagents, list) or any(not isinstance(s, dict) or s.get('id') not in ROLES for s in subagents):
            raise ValueError('Unknown subagent role')
        
        # Unified Single Model: If singleModel is set, all subagents inherit or run on that single model
        single_model = values.get('singleModel') or (values.get('model') if values.get('isSingleModel') else None)
        if single_model and single_model not in {'default', 'inherit'}:
            for s in subagents:
                s['model'] = single_model
            route = route_for(single_model)
        else:
            route = {k: values[k] for k in ('connectionId', 'modelId', 'aliasId', 'thinkingLevel') if isinstance(values.get(k), str)}
            if values.get('model') and values['model'] not in {'default', 'inherit'}:
                route = route_for(values['model'])

        model_id_str = values.get('model') or values.get('modelId') or (route.get('modelId') if isinstance(route, dict) else '')
        model_metadata = values.get('modelMetadata') if isinstance(values.get('modelMetadata'), dict) else None
        context_window = resolve_context_window(model_id_str, values.get('contextWindow'), model_metadata)

        config = {'skills': list(dict.fromkeys(skills)), 'subagents': subagents, 'route': route,
                  'maxSteps': min(60, max(1, int(values.get('maxSteps', 16)))),
                  'deadlineSeconds': min(600, max(5, int(values.get('deadlineSeconds', 180)))),
                  'contextWindow': context_window,
                  'tools': sorted(allowed_tools(role, parent_tools)),
                  'instructions': str(values.get('instructions', ''))[:12000]}
        session = self.store.create(config, role, parent_id)
        role_instructions = ROLES[role].instructions if role in ROLES else ORCHESTRATOR_SOP_GUIDANCE
        prompt = (
            f"{get_agent_identity()}\n\n"
            f"=== ASSIGNED ROLE: {role.upper()} ===\n"
            f"{role_instructions}\n\n"
            f"=== ENABLED SKILLS (Load full content via skill_view before executing complex workflows) ===\n"
            f"{self.catalog.prompt(skills)}"
        )
        if config['instructions']:
            prompt += f"\n\n=== OWNER-CONFIGURED DIRECTIVES ===\n{config['instructions']}"
        self.store.save(session['id'], [{'role': 'system', 'content': prompt}])
        return self.store.get(session['id'])


    def start(self, sid, prompt, image=None, route=None):
        session = self.store.get(sid)
        if session['status'] in {'running', 'awaiting_decision'}:
            raise ValueError('SESSION_BUSY: Turn in progress')
        if route and isinstance(route, dict) and any(route.values()):
            session['config']['route'] = route
            self.store.update_config(sid, session['config'])
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError('Prompt is required')
        if image and (not isinstance(image, str) or not image.startswith(('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')) or len(image) > 700000):
            raise ValueError('Unsupported or oversized image')
        # Reconcile interrupted tool groups without replaying side effects.
        messages = session['messages']
        pending = {}
        for m in messages:
            if m['role'] == 'assistant':
                pending.update({c['id']: c['function']['name'] for c in m.get('tool_calls', [])})
            if m['role'] == 'tool':
                pending.pop(m.get('tool_call_id'), None)
        for cid, name in pending.items():
            messages.append({'role': 'tool', 'tool_call_id': cid, 'name': name,
                             'content': 'Interrupted before result was committed. Inspect current state; do not assume success or replay blindly.'})
        content = [{'type': 'text', 'text': prompt}, {'type': 'image_url', 'image_url': {'url': image}}] if image else prompt
        messages.append({'role': 'user', 'content': content})
        self.store.save(sid, messages, 'running')
        self.store.emit(sid, 'user', {'text': prompt})
        task = asyncio.create_task(self._run(sid))
        self.tasks[sid] = task
        return task

    async def stop(self, sid):
        children = self.store.db.execute("SELECT id FROM sessions WHERE parent_id=? AND status IN ('running','awaiting_decision')", (sid,)).fetchall()
        for child in children:
            await self.stop(child['id'])
        # A stopped session must never leave a decision hanging: exactly one cancelled resolution.
        for record in self.pending_for(sid):
            self.settle(record, record['defaultChoice'], 'cancelled', 'session_cancelled', None)
        task = self.tasks.get(sid)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _run(self, sid):
        session = self.store.get(sid)
        config, messages = session['config'], session['messages']
        self.active_messages[sid] = messages
        tools = schemas_for(config['tools'])
        compressor = ContextCompressor(config['contextWindow'])
        loop_guard = AntiLoopGuard(threshold=3)
        try:
            async with asyncio.timeout(config['deadlineSeconds']) as budget:
                self.run_budget[sid] = budget
                for step in range(config['maxSteps']):
                    async def summarize(history):
                        return await self.client.complete(history, [], config['route'], max_tokens=2048)
                    compacted, event = await compressor.compact(messages, tools, summarize)
                    if event:
                        if compacted is not messages:
                            self.store.checkpoint(sid, messages, event['kind'])
                            messages = compacted
                            self.active_messages[sid] = messages
                            self.skill_loader.reset(sid)
                            self.store.save(sid, messages)
                        self.store.emit(sid, 'compression', event)
                    self.store.emit(sid, 'step', {'iteration': step + 1, 'contextEstimate': estimate_tokens(messages, tools)})
                    def handle_thought(thought_text):
                        self.store.emit(sid, 'thought', {'text': thought_text})
                    def handle_content(content_text):
                        self.store.emit(sid, 'assistant_delta', {'text': content_text})
                    response = await self.client.complete(messages, tools, config['route'], on_thought=handle_thought, on_content=handle_content)
                    choice = response['choices'][0]
                    message = choice['message']
                    text, calls = message.get('content') or '', message.get('tool_calls') or []
                    thought = message.get('reasoning_content') or message.get('thought') or choice.get('reasoning_content') or ''
                    if not calls and (choice.get('finish_reason') not in {'stop', 'end_turn'} or not text.strip()):
                        raise ValueError('Model did not produce a complete non-empty final response')
                    # Ensure the same canonical IDs in assistant row and tool results.
                    calls = copy.deepcopy(calls)
                    for call in calls:
                        call['id'] = call.get('id') or 'call_' + uuid.uuid4().hex
                    row = {'role': 'assistant', 'content': text}
                    if thought:
                        row['thought'] = thought
                    if calls:
                        row['tool_calls'] = calls
                    messages.append(row)
                    self.store.save(sid, messages)
                    if thought:
                        self.store.emit(sid, 'thought', {'text': thought})
                    self.store.emit(sid, 'usage', {'usage': response.get('usage'), 'target': response.get('boxfox'), 'requestId': response.get('id')})
                    if text:
                        self.store.emit(sid, 'assistant', {'text': text, 'thought': thought, 'final': not calls})
                    if not calls:
                        self.store.save(sid, messages, 'completed')
                        self.store.emit(sid, 'finish', {'status': 'completed'})
                        return text
                    if len(calls) > 16:
                        raise ValueError('Tool-call batch exceeds limit')
                    for call in calls:
                        fn = call['function']
                        args, error = _parse_tool_arguments(fn.get('arguments'))
                        name = fn.get('name', '')
                        self.store.emit(sid, 'tool_start', {'id': call['id'], 'name': name, 'args': args})
                        try:
                            if error:
                                raise ValueError(error)
                            if name not in config['tools']:
                                raise PermissionError('Tool not permitted for this role: ' + name)
                            result = await self.dispatch(session, name, args, call['id'])
                        except Exception as exc:
                            result = {'is_error': True, 'error': str(exc)}
                        safe = {k: v for k, v in result.items() if k not in {'image', 'base64'}}
                        if safe.get('is_error'):
                            safe['reflection_hint'] = 'AUTONOMOUS_DIAGNOSIS: The previous action returned an error. Inspect the message, avoid repeating identical inputs, and pivot strategy or invoke debug specialist if necessary.'
                        if loop_guard.check_and_record(name, args if isinstance(args, dict) else {}, bool(safe.get('is_error'))):
                            safe['warning'] = 'CRITICAL_LOOP_GUARD: This exact tool call has repeatedly failed 3 times. You MUST halt this approach immediately, analyze why it is failing, change parameters, or delegate to a specialist.'
                        text_result = json.dumps(safe, ensure_ascii=False)
                        # Full skill instruction must never be silently truncated.
                        if name != 'skill_view' and len(text_result) > 24000:
                            text_result = text_result[:20000] + '\n[Output bounded; original result retained in event log.]'
                        tool_content = text_result
                        if result.get('image'):
                            tool_content = [{'type': 'text', 'text': text_result}, {'type': 'image_url', 'image_url': {'url': 'data:' + result.get('mime', 'image/png') + ';base64,' + result['image']}}]
                        messages.append({'role': 'tool', 'tool_call_id': call['id'], 'name': name, 'content': tool_content})
                        self.store.save(sid, messages)
                        self.store.emit(sid, 'tool_end', {'id': call['id'], 'name': name, 'args': args, 'result': safe})
                raise ValueError('MAX_STEPS: iteration budget reached; work may be incomplete')
        except asyncio.CancelledError:
            self.store.save(sid, messages, 'cancelled')
            self.store.emit(sid, 'finish', {'status': 'cancelled'})
            raise
        except Exception as exc:
            error = 'DEADLINE: run timed out' if isinstance(exc, TimeoutError) else str(exc)
            self.store.save(sid, messages, 'failed')
            self.store.emit(sid, 'error', {'message': error})
            return None
        finally:
            self.run_budget.pop(sid, None)
            # The turn ended (completed, failed or cancelled) while a decision was still open.
            for record in self.pending_for(sid):
                self.settle(record, record['defaultChoice'], 'cancelled', 'session_cancelled', None)
            self.active_messages.pop(sid, None)
            await self.executor.cleanup(sid)

    async def dispatch(self, session, name, args, call_id=None):
        sid, config = session['id'], session['config']
        if name in DECISION_TOOLS:
            return await self.decision(session, name, args, call_id)
        if name == 'skills_list':
            return {'skills': [s for s in self.catalog.list(config['skills']) if s['enabled']]}
        if name == 'skill_view':
            if args.get('id') not in config['skills']:
                raise PermissionError('Skill is not enabled for this session')
            if args['id'] in EXTERNAL:
                raise PermissionError('Use an explicit CLI command; executor skills cannot run through native terminal tools')
            return self.skill_loader.read(session, args['id'], args.get('file_path', 'SKILL.md'), self.active_messages.get(sid))
        if name == 'session_search':
            rows = self.store.db.execute('SELECT messages FROM checkpoints WHERE session_id=? ORDER BY id DESC LIMIT 20', (sid,))
            hits = [m for r in rows for m in json.loads(r[0]) if args['query'].casefold() in str(m.get('content', '')).casefold()]
            return {'messages': hits[-10:]}
        if name == 'delegate_task':
            return await self.delegate(session, args)
        if name == 'browser_use' and session['role'] == 'research' and args.get('action') not in {'navigate', 'snapshot', 'screenshot'}:
            raise PermissionError('Research browser access is read-only navigation/snapshot')
        if name == 'write_plan':
            return await self.write_plan(session, args)
        if name in {'file_write', 'file_edit_block', 'terminal_exec'}:
            async with self.writer_lock:
                return await self.executor.execute(name, args, sid)
        return await self.executor.execute(name, args, sid)

    def pending_for(self, sid):
        """Unresolved decisions of one session, in request order."""
        return [record for record in self.pending.values() if record['sessionId'] == sid and not record['resolved']]

    async def decision(self, session, name, args, call_id=None):
        """ask_user / request_approval: emit decision_requested, block, return the honest outcome."""
        sid = session['id']
        kind = 'question' if name == 'ask_user' else 'approval'
        if kind == 'question':
            question = str(args.get('question') or '').strip()
            if not question:
                raise ValueError('DECISION_INVALID: ask_user requires a question')
            action = reason = None
        else:
            action = str(args.get('action') or '').strip()
            reason = str(args.get('reason') or '').strip()
            if not action:
                raise ValueError('DECISION_INVALID: request_approval requires the concrete action')
            if not reason:
                raise ValueError('DECISION_INVALID: request_approval requires a reason')
            question = None
        options = normalize_decision_options(args.get('options'), kind)
        decision_id = uuid.uuid4().hex[:16]
        record = {'decisionId': decision_id, 'sessionId': sid, 'kind': kind, 'options': options,
                  'deadline': decision_deadline(args, name), 'defaultChoice': 'reject',
                  'toolCallId': call_id, 'resolved': False, 'outcome': None,
                  'future': asyncio.get_running_loop().create_future()}
        self.pending[decision_id] = record
        self.prune_pending()
        self.store.save(sid, self.active_messages.get(sid, session['messages']), 'awaiting_decision')
        self.store.emit(sid, 'decision_requested', {
            'decisionId': decision_id, 'kind': kind, 'question': question, 'action': action, 'reason': reason,
            'options': options, 'deadline': record['deadline'], 'defaultChoice': record['defaultChoice'],
            'toolCallId': call_id})
        self.store.emit(sid, 'ui_intent', {'tab': 'decisions', 'target': {'requestId': decision_id},
                                          'reason': 'decision_requested'})
        return await self.wait_for_decision(sid, record)

    async def wait_for_decision(self, sid, record):
        """Await one answer, expanding the turn budget so the user gets the contract deadline."""
        budget = self.run_budget.get(sid)
        paused = budget.when() if budget is not None else None
        paused_at = time.monotonic()
        if paused is not None:
            try:
                budget.reschedule(None)
            except RuntimeError:
                paused = None
        try:
            await asyncio.wait_for(asyncio.shield(record['future']), timeout=max(0.0, record['deadline'] - time.time()))
        except asyncio.TimeoutError:
            self.settle(record, record['defaultChoice'], 'expired', 'timeout', None)
        finally:
            if paused is not None:
                try:
                    budget.reschedule(paused + (time.monotonic() - paused_at))
                except RuntimeError:
                    pass
        return record['outcome']

    def settle(self, record, choice, status, reason, note):
        """Resolve a decision exactly once: event first, then the blocked turn continues."""
        if record['resolved']:
            return False
        record['resolved'] = True
        record['outcome'] = {'decision': 'approved' if status == 'approved' else 'rejected',
                             'choice': choice, 'status': status, 'reason': reason, 'note': note,
                             'decisionId': record['decisionId'], 'message': DECISION_OUTCOME_MESSAGES[status]}
        self.store.emit(record['sessionId'], 'decision_resolved', {
            'decisionId': record['decisionId'], 'choice': choice, 'status': status, 'note': note,
            'reason': reason, 'resolvedAt': round(time.time(), 3)})
        if not record['future'].done():
            record['future'].set_result(record['outcome'])
        if reason != 'session_cancelled':
            self.resume(record['sessionId'])
        return True

    def resume(self, sid):
        """A blocked turn goes back to running as soon as an answer (or the timeout) lands."""
        try:
            session = self.store.get(sid)
        except KeyError:
            return
        if session['status'] == 'awaiting_decision':
            self.store.save(sid, self.active_messages.get(sid, session['messages']), 'running')

    def prune_pending(self, keep=100):
        """Bounded memory: drop the oldest settled decisions, never a live one."""
        settled = [key for key, record in self.pending.items() if record['resolved']]
        for key in settled[:-keep]:
            self.pending.pop(key, None)

    def resolve_decision(self, sid, decision_id, choice, note=None):
        """Answer a pending decision; raises DecisionError with the contract's status codes."""
        if not isinstance(decision_id, str) or not decision_id:
            raise DecisionError('DECISION_INVALID', 'decisionId is required', 400)
        if not isinstance(choice, str) or not choice:
            raise DecisionError('DECISION_INVALID', 'choice is required', 400)
        if note is not None and not isinstance(note, str):
            raise DecisionError('DECISION_INVALID', 'note must be a string', 400)
        record = self.pending.get(decision_id)
        if record is None or record['sessionId'] != sid:
            raise DecisionError('DECISION_NOT_FOUND', 'no decision ' + decision_id + ' in this session', 404)
        if record['resolved']:
            raise DecisionError('DECISION_ALREADY_RESOLVED', 'decision ' + decision_id + ' was already answered', 409)
        option = next((item for item in record['options'] if item['id'] == choice), None)
        if option is None:
            raise DecisionError('DECISION_INVALID', 'choice ' + choice + ' is not one of this decision options', 400)
        status = 'approved' if option['kind'] in {'approve', 'alternative'} else 'rejected'
        self.settle(record, choice, status, 'user', (note or '').strip() or None)
        return {'status': 'resolved', 'decisionId': decision_id, 'choice': choice, 'outcome': status}

    async def write_plan(self, session, args):
        """write_plan: the sandbox picks the next free version and writes it; the host only reports it."""
        sid = session['id']
        slug = plan_slug(args.get('slug'))
        markdown = args.get('markdown')
        if not isinstance(markdown, str) or not markdown.strip():
            raise ValueError('PLAN_INVALID: markdown must be a non-empty string')
        if len(markdown.encode('utf-8')) > PLAN_MAX_BYTES:
            raise ValueError('PLAN_INVALID: the plan exceeds the 1 MiB plan-file limit')
        title = plan_title(args.get('title'), markdown, slug)
        async with self.writer_lock:
            written = await self.executor.execute('write_plan', {'slug': slug, 'markdown': markdown, 'title': title}, sid)
        confirmed = PLAN_PATH_RE.fullmatch(str(written.get('relativePath') or ''))
        version = written.get('version')
        if not confirmed or isinstance(version, bool) or not isinstance(version, int) \
                or int(confirmed.group('version')) != version:
            raise ValueError('PLAN_WRITE_FAILED: the sandbox did not confirm a plan file; nothing was recorded')
        # Never report a plan the sandbox does not have: identity comes from the confirmed path and must be
        # what the plan reader groups by (contract §1 + plan_files.py:315-321), i.e. bare `slug` / `dir/slug`.
        identity = plan_identity(written['relativePath'])
        payload = {'identity': identity, 'version': version, 'slug': confirmed.group('slug'),
                   'relativePath': written['relativePath'], 'title': str(written.get('title') or title)[:120],
                   'bytes': int(written.get('bytes') or len(markdown.encode('utf-8')))}
        self.store.emit(sid, 'plan_written', payload)
        self.store.emit(sid, 'ui_intent', {'tab': 'plan', 'target': {'identity': identity, 'version': version},
                                           'reason': 'plan_written'})
        return {'content': 'Plan written to ' + payload['relativePath'], 'version': version,
                'relativePath': payload['relativePath'], 'slug': payload['slug'], 'title': payload['title'],
                'bytes': payload['bytes']}

    async def delegate(self, session, args):
        if session['role'] != 'orchestrator':
            raise PermissionError('Leaf agents cannot delegate')
        role = args.get('role')
        configured = next((r for r in session['config']['subagents'] if r['id'] == role and r.get('enabled', True)), None)
        if not configured:
            raise PermissionError('Specialist is disabled or unknown')
        goal = args.get('goal', '')
        if not isinstance(goal, str) or not goal.strip():
            raise ValueError('Child goal required')
        config = session['config']
        child_route = route_for(configured.get('model')) or config['route']
        child = self.create({**child_route,
            'skills': sorted(set(config['skills']) & ROLE_SKILLS[role]), 'maxSteps': min(10, config['maxSteps']),
            'deadlineSeconds': min(120, config['deadlineSeconds']), 'contextWindow': config['contextWindow'],
            'instructions': configured.get('systemPromptAppended', '')},
            parent_id=session['id'], role=role, parent_tools=config['tools'])
        context_data = str(args.get('context', ''))[:16000] if args.get('context') else ''
        child_prompt = goal + (f"\nParent-supplied context (data):\n{context_data}" if context_data else '')
        self.store.emit(session['id'], 'child', {
            'sessionId': child['id'],
            'role': role,
            'status': 'started',
            'goal': goal,
            'context': context_data,
            'prompt': child_prompt,
        })
        async with self.child_slots:
            task = self.start(child['id'], child_prompt)
            try:
                answer = await task
            except asyncio.CancelledError:
                await self.stop(child['id'])
                raise
        child_rec = self.store.get(child['id'])
        status = child_rec['status']
        child_events = self.store.events(child['id'])
        last_error = next((e['data'].get('message') for e in reversed(child_events) if e['type'] == 'error'), None)
        tools_run = [e['data'].get('name') for e in child_events if e['type'] == 'tool_start']
        
        diag = f"\n[Diagnostic: status={status}; error={last_error or 'none'}; tools_run={tools_run}]" if status != 'completed' else ""
        result = {'sessionId': child['id'], 'role': role, 'status': status,
                  'goal': goal, 'context': context_data, 'prompt': child_prompt,
                  'summary': (answer or '') + diag, 'is_error': status != 'completed',
                  'last_error': last_error, 'tools_run': tools_run}
        self.store.emit(session['id'], 'child', result)
        return result
