"""BoxFox v0 harness: adapted Hermes loop/delegation with durable OpenCode-style sessions.

Original licenses and exact/adapted module provenance: ../vendor/manifest.json.
"""
import asyncio
import copy
import json
from pathlib import Path
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


def resolve_context_window(model_str='', requested=None):
    if requested is not None:
        try:
            val = int(requested)
            if val > 0:
                return min(2000000, max(4096, val))
        except (ValueError, TypeError):
            pass
    m = str(model_str or '').lower()
    if 'gemini' in m:
        return 1000000
    if 'claude' in m:
        return 200000
    if 'deepseek' in m or 'qwen' in m:
        return 64000
    return 128000


class HarnessRuntime(RuntimeCommands):
    def __init__(self, store, executor, client=None, catalog=None):
        self.store, self.executor = store, executor
        self.client = client or RouterClient()
        self.catalog = catalog or SkillCatalog()
        self.commands = CommandRegistry(store, self.catalog)
        self.skill_loader = SkillLoader(self.catalog, store.emit)
        self.active_messages = {}
        self.tasks = {}
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
            route = {k: values[k] for k in ('connectionId', 'modelId', 'aliasId') if isinstance(values.get(k), str)}
            if values.get('model') and values['model'] not in {'default', 'inherit'}:
                route = route_for(values['model'])

        model_id_str = values.get('model') or values.get('modelId') or (route.get('modelId') if isinstance(route, dict) else '')
        context_window = resolve_context_window(model_id_str, values.get('contextWindow'))

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
        if session['status'] == 'running':
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
        children = self.store.db.execute('SELECT id FROM sessions WHERE parent_id=? AND status=?', (sid, 'running')).fetchall()
        for child in children:
            await self.stop(child['id'])
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
            async with asyncio.timeout(config['deadlineSeconds']):
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
                            result = await self.dispatch(session, name, args)
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
            self.active_messages.pop(sid, None)
            await self.executor.cleanup(sid)

    async def dispatch(self, session, name, args):
        sid, config = session['id'], session['config']
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
        if name in {'file_write', 'file_edit_block', 'terminal_exec'}:
            async with self.writer_lock:
                return await self.executor.execute(name, args, sid)
        return await self.executor.execute(name, args, sid)

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
