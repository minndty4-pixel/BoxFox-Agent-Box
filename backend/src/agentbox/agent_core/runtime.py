"""BoxFox v0 harness: adapted Hermes loop/delegation with durable OpenCode-style sessions.

Original licenses and exact/adapted module provenance: ../vendor/manifest.json.
"""
import asyncio
import copy
import json
import os
from pathlib import Path
import re
import time
import uuid
import httpx
from .attachments import (MAX_INLINE_MEDIA, attachment_prompt_block, validate_attachments,
                        validate_inline_images)
from .compression import ContextCompressor, estimate_tokens, usage_reading
from .failures import (RETRY_BUDGET_SECONDS, classify_failure, failure_detail, level_refusal,
                       log_safe_failure, retry_advice, stop_reason)
from .limits import (ANSWER_LENGTH_HINT, ANSWER_LENGTH_WARN_CODE, ANSWER_MAX_CHARS, ANSWER_TOO_LONG_CODE,
                     ANSWER_WARN_CHARS, CHILD_DEADLINE_SECONDS, CHILD_MAX_STEPS, DEADLINE_CLAMP_NOTICE_CODE,
                     DEADLINE_DEFAULT_SECONDS, DEADLINE_MAX_SECONDS, DEADLINE_MIN_SECONDS, DEADLINE_NOTICE_CODE,
                     DIAGNOSIS_MIN_CHARS, INSTRUCTIONS_MAX_CHARS, MAX_STEPS_DEFAULT, MAX_STEPS_MAX,
                     ROUTER_BODY_BUDGET, STEP_BUDGET_NOTICE_CODE, STEPS_CLAMP_NOTICE_CODE,
                     TRUNCATED_OUTPUT_MAX_TOKENS, TRUNCATED_OUTPUT_NOTICE_CODE, WRAP_UP_MAX_TOKENS,
                     WRAP_UP_READ_TOOL_CALLS, WRAP_UP_STEPS_RESERVED, WRAP_UP_TIMEOUT_SECONDS)
from .plan_quality import check_plan_quality
from .roles import ROLES, allowed_tools
from . import journal, plan_eval, plan_header, plan_registry, session_journal
from .tool_contracts import schemas_for
from .tool_groups import TOOL_GROUPS
from .web import WebTools
from ..skills.catalog import SkillCatalog, DEFAULT_SKILLS
from ..skills.commands import CommandRegistry, ROLE_SKILLS, EXTERNAL
from ..skills.lifecycle import SkillLoader
from ..skills.runtime_commands import RuntimeCommands
from ..observability.system_log import system_log
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
     * Hand every external-knowledge question (a library's real API, a standard, a version, a web page) to role='research'. It reaches the browser AND the host-side `web_search`/`web_fetch` tools; you hold those two tools as well, so answer a quick fact yourself and delegate the deep survey. The sandbox network can be OFF — the host tools are not affected — so a research answer may still honestly say "could not verify". Accept that over a guessed source.
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
   - State the required RESULT SHAPE in `expect` for EVERY delegation: the exact deliverable plus the evidence you need back (which files with line numbers, which commands and what their output must show, which sources). A child that is not told what to return will return prose.
   - When calling `delegate_task(role=..., goal=..., context=..., expect=...)`, provide concise, highly relevant context from earlier phases.
   - Do NOT assume a child agent succeeded merely because it finished. Inspect its summary, the `truncated` flag, executed tools, and error status. Require evidence (file path + line, command + observed output, citation) for every claim; if a child returns none, re-delegate with `expect` naming the missing evidence or verify it yourself. If a child agent fails, diagnose why and assign a targeted corrective task.
   - A plan you accept must contain a Verification / Acceptance criteria section with an exact command or check and its expected result, and a Risks / Limitations section; `write_plan` refuses anything less.
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


# The router refuses a request body over 1 MiB (`router/src/server.mjs`). Every capture is
# inlined as base64, and a CUA mission takes one per step, so a long turn grows past that cap
# and every later model call dies with `UPSTREAM_HTTP_413: Request is too large.` — measured
# 2026-09-20: of a 1 107 315-char body, 1 018 908 chars were base64 images. The newest
# captures stay inline; an older one shrinks to the text it came with, and the file stays on
# disk exactly as the transcript shows it.
# `MAX_INLINE_MEDIA` sống ở `agent_core/attachments.py` (cùng chỗ với trần tổng ký tự của
# một lượt, A7) — ở đây chỉ còn trần BYTE của ngữ cảnh gửi đi mỗi bước.
MAX_INLINE_MEDIA_BYTES = 512 * 1024


def _media_payload_size(message) -> int:
    """Base64 payload carried by one message, 0 when it carries no image."""
    content = message.get('content')
    if not isinstance(content, list):
        return 0
    size = 0
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get('type') == 'image_url':
            size += len(str((part.get('image_url') or {}).get('url') or ''))
        elif part.get('type') == 'image':
            size += len(str((part.get('source') or {}).get('data') or ''))
    return size


def _text_only(content) -> str:
    text = '\n'.join(str(part.get('text') or '') for part in content
                      if isinstance(part, dict) and part.get('type') == 'text')
    note = ('[Older screenshot left out of this request so the body stays under the router cap; '
            'the file is unchanged on disk at the path named above.]')
    return f'{text.strip()}\n{note}'.strip()


def bound_inline_media(messages, keep: int = MAX_INLINE_MEDIA,
                       max_bytes: int = MAX_INLINE_MEDIA_BYTES) -> tuple[list, int]:
    """A request-ready copy of ``messages`` that carries only the newest captures inline.

    Returns ``(messages_for_the_request, dropped)``. The input list is never mutated, so the
    stored transcript — and therefore the chat UI — keeps every image.
    """
    indexes = [index for index, message in enumerate(messages) if _media_payload_size(message)]
    if not indexes:
        return messages, 0
    kept, total, dropped = set(), 0, 0
    for index in reversed(indexes):  # newest first
        size = _media_payload_size(messages[index])
        if len(kept) < keep and total + size <= max_bytes:
            kept.add(index)
            total += size
        else:
            dropped += 1
    if not dropped:
        return messages, 0
    out = list(messages)
    for index in indexes:
        if index not in kept:
            out[index] = {**messages[index], 'content': _text_only(messages[index]['content'])}
    return out, dropped


TRIMMED_TEXT_NOTE = ('\n[Older step trimmed so the request body fits the router; the full entry '
                     'stays in the transcript.]')
TRIMMED_ARGUMENTS = '{"note": "[older tool arguments trimmed to fit the router body cap]"}'


def request_body_bytes(payload) -> int:
    """Bytes the router will receive — it counts the serialized body, not tokens.

    The same call `httpx` makes for a `json=` body, so this number is the router's own
    `Content-Length` (it refuses anything over 1 MiB).
    """
    blob = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    return len(blob.encode('utf-8'))


# Messages the model still needs verbatim: the step it is in, plus the rounds that produced it.
LIVE_TAIL = 8


def _reducible(messages) -> list:
    """Indexes the model can lose detail on: not a user instruction, not the newest step.

    A heavy CUA mission is one user prompt followed by dozens of assistant/tool rounds, so
    "everything before the last user message" is the whole mission — that is why the first
    byte-budget pass freed 7 841 B of a 1 060 902 B body and the call still died with 413.
    """
    stop = max(0, len(messages) - LIVE_TAIL)
    if not stop:  # a short session still has history worth trimming — keep only the last two
        stop = max(0, len(messages) - 2)
    return [index for index in range(0, stop) if messages[index].get('role') != 'user']


def _shrink_old_text(messages, indexes):
    out = list(messages)
    for index in indexes:
        text = out[index].get('content')
        if isinstance(text, str) and len(text) > 2000:
            out[index] = {**out[index], 'content': text[:1000] + TRIMMED_TEXT_NOTE}
    return out


def _drop_old_thoughts(messages, indexes):
    """Reasoning traces are not part of any provider protocol — only the signature is."""
    out = list(messages)
    for index in indexes:
        if out[index].get('thought'):
            out[index] = {**out[index], 'thought': ''}
    return out


def _shrink_old_tool_arguments(messages, indexes):
    """Keep the call id and the tool name — the pairing every provider validates — drop the blob."""
    out = list(messages)
    for index in indexes:
        calls = out[index].get('tool_calls')
        if not isinstance(calls, list) or not calls:
            continue
        replaced = False
        rewritten = []
        for call in calls:
            function = call.get('function') if isinstance(call, dict) else None
            arguments = function.get('arguments') if isinstance(function, dict) else None
            if isinstance(arguments, str) and len(arguments) > 400:
                function = {**function, 'arguments': TRIMMED_ARGUMENTS}
                call = {**call, 'function': function}
                replaced = True
            rewritten.append(call)
        if replaced:
            out[index] = {**out[index], 'tool_calls': rewritten}
    return out


def _drop_oldest_round(messages):
    """Drop the oldest complete tool round: the assistant call and the results it produced.

    The last resort, and the only way to bound a mission whose **signatures** alone outgrow the
    cap: a Gemini provider refuses a replayed function call that lost its signature, so an old
    call cannot be kept without one — but a call that is not in the request at all needs no
    signature. The oldest round goes first, its parts always leave together (so no `tool` message
    is left orphaned), and user instructions and the live tail are never touched.
    """
    out = list(messages)
    tail = max(0, len(out) - LIVE_TAIL)
    fallback = None
    for index in range(0, tail):
        message = out[index]
        if message.get('role') != 'assistant' or not isinstance(message.get('tool_calls'), list):
            continue
        ids = {call.get('id') for call in message['tool_calls'] if isinstance(call, dict)}
        dropping = {index}
        cursor = index + 1
        while cursor < len(out) and out[cursor].get('role') == 'tool' \
                and out[cursor].get('tool_call_id') in ids:
            dropping.add(cursor)
            cursor += 1
        if len(dropping) > 1:
            if cursor <= tail:
                return [item for position, item in enumerate(out) if position not in dropping]
            # A round that runs into the tail can only leave together with the results it produced,
            # so it is a last resort: the newest observations are worth more than the oldest round.
            if fallback is None:
                fallback = dropping
    if fallback is not None:
        return [item for position, item in enumerate(out) if position not in fallback]
    return out


def shrink_request_to_budget(body, messages, budget: int = ROUTER_BODY_BUDGET) -> tuple[list, int, str]:
    """Last-resort byte budget for the **whole** request, least destructive reduction first.

    `ContextCompressor` works in tokens while the router caps the body in bytes, so on a model
    with a large context window (1M) a long mission grows past 1 MiB without ever crossing the
    token threshold and every later call is refused (`UPSTREAM_HTTP_413`).

    `body` is the request as it would be sent: the cap counts the role prompt and the tool
    schemas too, and measuring `messages` alone underestimates it by their size (measured
    2026-09-20: a body 1 060 902 B large whose `messages` list was 1 043 364 B — 12 326 B over
    the cap, and the earlier messages-only check never saw it).

    The reductions run over the history before the live tail only, each one whole-list at a time,
    in order of what costs the model least: old text, old reasoning traces, old tool arguments,
    the older inline captures down to one and then to none, and finally — the only reduction that
    is not bounded by what a single round holds — dropping the oldest tool rounds outright. The
    moment the body fits it stops. Returns `(messages, freed_bytes, phase)`; `freed_bytes` is 0
    (and the input list comes back) when nothing helped, so a request that cannot be reduced still
    fails honestly. The stored transcript is never mutated — the chat UI keeps every byte.
    """
    def size(candidate):
        return request_body_bytes({**body, 'messages': candidate})

    original = size(messages)
    if original <= budget:
        return messages, 0, ''
    out = list(messages)
    freed, phase, current = 0, '', original
    steps = [
        ('text', lambda history: _shrink_old_text(history, _reducible(history))),
        ('thought', lambda history: _drop_old_thoughts(history, _reducible(history))),
        ('arguments', lambda history: _shrink_old_tool_arguments(history, _reducible(history))),
        ('media-1', lambda history: bound_inline_media(history, keep=1)[0]),
        ('media-0', lambda history: bound_inline_media(history, keep=0)[0]),
    ]
    # Dropping rounds is the only reduction that is not bounded by what one round holds, so it
    # repeats — the oldest first, and only for as long as the body is still over the budget.
    steps += [('round', _drop_oldest_round)] * len(messages)
    for name, reduce in steps:
        before = current
        out = reduce(out)
        current = size(out)
        if current < before:
            freed += before - current
            phase = name
        if current <= budget:
            break
    if not freed:
        return messages, 0, ''
    return out, freed, phase


def dedupe_thought_signatures(messages) -> tuple[list, int]:
    """One spelling per thought signature in the request body.

    Every signature is stored under both names — the router normalises either one, and so does
    this client — which is fine on disk but doubles a large opaque blob on every later request.
    Measured on a heavy CUA mission (2026-09-20): 761 888 B of a 1.7 MiB body were the two
    copies of the same signatures, which is what kept the body over the router's 1 MiB cap even
    after the inline images were bounded. The request keeps `thought_signature`; the stored
    transcript is left alone.
    """
    out, saved = [], 0
    for message in messages:
        calls = message.get('tool_calls') if isinstance(message, dict) else None
        if not isinstance(calls, list) or not calls:
            out.append(message)
            continue
        trimmed, local = [], 0
        for call in calls:
            if (isinstance(call, dict) and call.get('thought_signature') and call.get('thoughtSignature')):
                local += len(str(call['thoughtSignature']))
                call = {key: value for key, value in call.items() if key != 'thoughtSignature'}
            trimmed.append(call)
        if local:
            saved += local
            out.append({**message, 'tool_calls': trimmed})
        else:
            out.append(message)
    if not saved:
        return messages, 0
    return out, saved


def router_refusal(status, content):
    """``RuntimeError`` for a router error envelope, carrying the machine metadata.

    The message keeps the ``Router HTTP <status>: <message>`` shape the classifier and the
    UI already read. The attributes carry what a formatted string cannot: the router's code,
    whether the router itself called the failure retryable, and the provider's ``Retry-After``
    (``retryAfterMs``). The retry policy needs all three — without them a 429 looked like a
    plain 4xx and never got another attempt.
    """
    try:
        payload = json.loads(content)
    except Exception:
        payload = {}
    error = (payload or {}).get('error') if isinstance(payload, dict) else None
    error = error if isinstance(error, dict) else {}
    if not error.get('message'):
        text = content.decode('utf-8', errors='ignore') if isinstance(content, (bytes, bytearray)) else str(content or '')
        error = {**error, 'message': text.strip() or 'Router request failed'}
    refusal = RuntimeError(f'Router HTTP {status}: {error["message"]}')
    refusal.router_status = status
    if error.get('code'):
        refusal.router_code = str(error['code'])
    if isinstance(error.get('retryable'), bool):
        refusal.retryable = error['retryable']
    after = error.get('retryAfterMs')
    if isinstance(after, (int, float)) and after > 0:
        refusal.retry_after_ms = float(after)
    return refusal


class RouterClient:
    def __init__(self, url='http://127.0.0.1:3101'):
        self.url = url.rstrip('/')

    async def snapshot(self):
        """Router state in one read, or None when the router does not answer.

        `trust_env=False` is deliberate: a proxy in the environment must not decide
        whether the local router is reachable.
        """
        try:
            async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
                response = await client.get(self.url + '/api/router/state', headers={'x-boxfox-admin': '1'})
                if response.is_error:
                    return None
                return response.json()
        except Exception:
            return None

    async def model_metadata_map(self):
        """`{(connectionId, modelId): model record}` từ MỘT lần đọc snapshot.

        Lượt sửa lúc khởi động cần record của mọi phiên đã lưu; đọc snapshot một
        lần là khác biệt giữa một lời gọi router và N lời gọi.
        """
        snapshot = await self.snapshot()
        if not snapshot:
            return {}
        result = {}
        for connection in snapshot.get('connections', []) or []:
            for model in connection.get('models', []) or []:
                if connection.get('id') and model.get('id'):
                    result[(connection.get('id'), model.get('id'))] = model
        return result

    async def model_metadata(self, connection_id, model_id):
        """Read one model record from the router snapshot.

        The router is the only component that talks to provider APIs, so it owns the
        real context window and thinking metadata. Returns None when unavailable.
        """
        if not connection_id or not model_id:
            return None
        snapshot = await self.snapshot()
        if not snapshot:
            return None
        for connection in snapshot.get('connections', []) or []:
            if connection.get('id') != connection_id:
                continue
            for model in connection.get('models', []) or []:
                if model.get('id') == model_id:
                    return model
        return None

    async def complete(self, messages, tools, route, on_thought=None, on_content=None, max_tokens=4096):
        messages, dropped = bound_inline_media(messages)
        if dropped:
            system_log.write('model.media_pruned', session_id=route.get('sessionId'), dropped=dropped,
                             kept=MAX_INLINE_MEDIA)
        messages, signature_chars = dedupe_thought_signatures(messages)
        if signature_chars:
            system_log.write('model.signature_deduped', session_id=route.get('sessionId'),
                             chars=signature_chars)
        messages, freed, phase = shrink_request_to_budget(
            {**route, 'messages': messages, 'tools': tools, 'stream': True, 'max_tokens': max_tokens},
            messages)
        if freed:
            system_log.write('model.request_trimmed', level='warn', session_id=route.get('sessionId'),
                             chars=freed, phase=phase, budgetBytes=ROUTER_BODY_BUDGET)
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
            try:
                async with client.stream(
                    'POST',
                    self.url + '/api/router/chat',
                    headers={'x-boxfox-admin': '1'},
                    json={**route, 'messages': messages, 'tools': tools, 'stream': True, 'max_tokens': max_tokens}
                ) as response:
                    if response.is_error:
                        raise router_refusal(response.status_code, await response.aread())

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
            except Exception as exc:
                # The router already gave a verdict (a rate limit, an auth failure, an unknown
                # model, an unreachable provider): repeating the same call without the stream
                # only doubles the load on an endpoint that just told us why it refused, and
                # turns one refusal into two provider calls — which a 429 on a metered key can
                # bill or block. The non-streaming path stays for a failure the router never
                # judged, i.e. a broken SSE channel or a dropped socket mid-stream.
                verdict = getattr(exc, 'router_status', None)
                if verdict is not None:
                    raise
                res = await client.post(self.url + '/api/router/chat',
                    headers={'x-boxfox-admin': '1'}, json={**route, 'messages': messages,
                        'tools': tools, 'stream': False, 'max_tokens': max_tokens})
                if res.is_error:
                    raise router_refusal(res.status_code, await res.read())
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


# Sàn an toàn của harness khi không nguồn nào trả lời. Router trả lời được cho mọi
# model có trên máy (số nhà cung cấp công bố, hoặc bảng tên của chính router), nên
# con số này chỉ dành cho tên mà cả hai đều không biết — và nó luôn mang nhãn
# `'fallback'`, để giao diện nói đúng "sàn an toàn" thay vì "chưa rõ".
#
# 128 000 → 256 000 (đợt 20, đo sống 2026-09-21): hai dòng `nemotron-*-free` của
# OpenCode không công bố cửa sổ (router trả `null`), nên sàn cũ 128 000 khiến
# `compact()` gộp ở 86 732 token — trong khi chính router đọc được 1 000 000 cho
# hai bản `:free` cùng model trên OpenRouter. Sàn mới 256 000 vẫn là con số CÓ NHÃN
# `'fallback'` (không giả `documented`), và ngưỡng nén vẫn bị `COMPRESSION_MAX_TOKENS`
# = 200 000 chặn trên, nên đổi sàn không làm cửa sổ lớn gộp muộn hơn 200 000 token.
# Vẫn quy được về tay chủ nhà khi cần: khai cửa sổ theo phiên, hoặc
# `BOXFOX_CONTEXT_WINDOW_LOCK=1` để không cho harness sửa lại cửa sổ đã khai.
# A3 — hai tập `kind` của nhật ký: thứ agent tự viết, và thứ harness ghim. `plan` cần kết quả
# `write_plan`, `checkpoint` là dấu vết của một lần nén; để model tự viết hai loại đó là mời nó
# tạo mã giả (`P:`/`C:` trùng với bản do harness ghim).
AGENT_JOURNAL_KINDS = ('task', 'step', 'decision', 'evidence', 'fact', 'blocker')
HARNESS_ONLY_JOURNAL_KINDS = ('plan', 'checkpoint')

FALLBACK_CONTEXT_WINDOW = 256000
# Nhãn nguồn gốc của một cửa sổ ngữ cảnh (song song với bảng giá của router, và
# đúng từ vựng `contextWindowSource` mà router công bố trên mỗi dòng model).
CONTEXT_WINDOW_SOURCES = ('manual', 'documented', 'reported')
# Nhãn mà NGƯỜI GỌI được phép khai khi đưa sẵn một con số: người dùng gõ tay
# (`manual`), nhãn của router mà phiên con thừa hưởng, và sàn (`fallback`) —
# phiên con của một phiên đang ở sàn phải giữ nguyên nhãn sàn đó.
DECLARED_CONTEXT_WINDOW_SOURCES = CONTEXT_WINDOW_SOURCES + ('fallback',)


# Biến môi trường khoá lượt sửa cửa sổ (N2). Người dùng đã tự khai cửa sổ cho mọi phiên
# thì không muốn harness sửa lại lúc khởi động: `BOXFOX_CONTEXT_WINDOW_LOCK=1` tắt hẳn
# `heal_context_windows` (trả 0, không ghi hàng nào, không phát event nào).
CONTEXT_WINDOW_LOCK_ENV = 'BOXFOX_CONTEXT_WINDOW_LOCK'


def context_window_locked(environ=None):
    """`BOXFOX_CONTEXT_WINDOW_LOCK=1` → giữ nguyên mọi cửa sổ người dùng đã khai.

    Đọc Ở THỜI ĐIỂM GỌI chứ không phải lúc import: cùng một tiến trình phải tôn trọng biến
    của lần khởi động hiện tại, và test phải đặt được biến mà không import lại mô-đun.
    Nhận `1` (đúng như tài liệu) cùng các cách viết thường gặp của cùng ý đó.
    """
    raw = (environ if environ is not None else os.environ).get(CONTEXT_WINDOW_LOCK_ENV)
    return str(raw or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _journal_row(store, session_id, text, numbers):
    """Ghim MỘT hàng nhật ký kiểu `X:` (trần bước, câu trả lời bị cắt) — trả số thứ tự, hoặc `None`.

    Đi qua `session_journal.insert_row` chứ không gọi thẳng `store.journal_add`: bản ghi phải có mã
    `X:<sid8>-<seq>` như mọi bản ghi khác (bản 0.1 ghi thẳng nên hàng không có mã, và khối ký ức in
    ra `X:?`). Ghi nhật ký là việc PHỤ: kho lưu trữ không có API này, hoặc ghi hỏng vì bất cứ lý do
    gì, đều trả `None` — chỗ gọi không được coi im lặng là thành công. Số `None` bị bỏ khỏi payload.
    """
    if store is None or not callable(getattr(store, 'journal_add', None)):
        return None
    try:
        item, stored = session_journal.insert_row(
            store, session_id, 'blocker', text,
            numbers={key: value for key, value in numbers.items() if value is not None})
        return stored if stored else None
    except Exception:
        return None


def _journal_blocker(store, session_id, record, step=None):
    """Ghim bản ghi `blocker` của trần bước vào NHẬT KÝ phiên — đúng một hàng (C1).

    Lượt chạm trần bước để lại hai bề mặt của CÙNG một sự việc: hàng `events` kind `blocker`
    (do `_run` phát, là bản bền cho UI) và hàng `journal` (`store.journal_add`, là bản cho
    `journal_tail`/khối ký ức của làn A). Kế hoạch viết "đúng một hàng `blocker` trong nhật ký
    phiên"; chữ ở `text` để người đọc, mọi con số nằm ở `payload` để máy lọc (`planPath`,
    `diffPath`, `maxSteps`, `step`).

    Ghi nhật ký là việc PHỤ: kho lưu trữ không có API này, hoặc ghi hỏng vì bất cứ lý do gì,
    đều trả `None` — lượt đã hết ngân sách bước và người dùng vẫn phải thấy lý do thật
    (`MAX_STEPS`), không phải một lỗi ghi nhật ký.
    """
    numbers = {'step': step, 'maxSteps': record.get('maxSteps'),
               'planPath': record.get('planPath'), 'diffPath': record.get('diffPath')}
    return _journal_row(store, session_id,
                        f'{STEP_BUDGET_NOTICE_CODE}: the iteration budget cut this turn short — the work '
                        'on disk may already be done; see planPath/diffPath in this record',
                        numbers)


# --- Vòng 22: chẩn đoán chỗ tắc, MỘT nguồn cho mọi đường (B3, B4, B10) --------------------
# Chủ nhà chốt (D-15): chạm trần bước hay hạn chót thì lượt phải tự đọc lại trạng thái, sửa
# một lần nếu đường cũ sai, rồi trả `partial` kèm bốn phần. Câu dưới đây là câu chỉ dẫn duy
# nhất — vòng lặp bước, đường hạn chót và phiên con đều dùng lại, không có bản sao thứ hai.
# Nhóm công cụ đọc lấy từ `tool_groups.TOOL_GROUPS` (không chép tay danh sách công cụ).
READ_TOOL_NAMES = frozenset(
    next(group['tools'] for group in TOOL_GROUPS if group['key'] == 'repositoryReading'))
DIAGNOSIS_PARTS = 'what is done / where you are stuck / what is left / what to try next'
# Ba việc của một lượt chốt, câu chữ cố định — chỗ kiểm (test) và chỗ dùng (prompt) đọc CÙNG
# một hằng số, nên không có bản sao nào lệch nhau.
DIAGNOSIS_PROMPT = ('(1) Re-read the state you touched: the files you changed, the last command output '
                    'you got, what is still undone. (2) If the path you took was wrong, do the single '
                    'correct action now. (3) Then answer in plain text with four short parts: '
                    f'{DIAGNOSIS_PARTS}.')


def diagnosis_prompt(reason, steps_left=None, out_of_time=False):
    """Câu chỉ dẫn chẩn đoán của một lượt sắp hết ngân sách.

    `steps_left` là số bước còn lại khi câu này đi kèm một bước của vòng lặp; `out_of_time`
    đổi cách nói đầu câu (hạn chót không đếm được bằng bước); `reason` là MÃ sẽ nằm trong
    notice bền, nên lý do trong prompt và lý do trong transcript không bao giờ lệch.
    """
    if out_of_time:
        head = 'You are out of time for this turn. Do NOT start new work.'
    elif steps_left is None:
        head = 'You are almost out of budget for this turn. Do NOT start new work.'
    else:
        head = f'You are almost out of steps ({max(0, int(steps_left))} left). Do NOT start new work.'
    return f'{head} {DIAGNOSIS_PROMPT} This turn is stopping because: {reason}.'


EMPTY_ANSWER_INSTRUCTION = ('You produced no answer and no tool call. Answer in plain text now, '
                           'briefly, using what you already know — do not start new work.')


def answer_truncation_tail():
    """Dòng cuối của câu trả lời bị cắt ở trần (D2) — nói luôn cách lấy phần còn lại."""
    return (f'\n[Answer truncated at {ANSWER_MAX_CHARS} chars — the full content must be written to a '
            'file in the workspace]')


def _journal_answer_truncated(store, session_id, chars, kept):
    """Một hàng `X:` cho câu trả lời bị cắt ở trần (D2) — cùng đường với `_journal_blocker`.

    Hàng `events` kind `notice` là bản cho giao diện; hàng này ghim cùng sự việc vào nhật ký
    phiên (`X:<sid8>-<seq>`) để khối ký ức đọc được nó. Trả `None` khi không ghi được — chỗ
    gọi không được coi im lặng là thành công.
    """
    return _journal_row(store, session_id,
                        f'{ANSWER_TOO_LONG_CODE}: the final answer was {chars} chars and was cut at '
                        f'{kept} — the full content must be written to a file in the workspace',
                        {'chars': chars, 'keptChars': kept})


def resolve_context_window(model_str='', requested=None, metadata=None, declared_source=None):
    """Cửa sổ ngữ cảnh của phiên: trả về MỘT CẶP `(số token, nguồn gốc)`.

    Thứ tự, một chiều và không nhập nhằng:

    - `requested` (số do người gọi đưa vào — người dùng gửi, hoặc phiên con thừa
      hưởng số của phiên cha): `(số đã kẹp, declared_source hoặc 'manual')`.
    - metadata của router (`modelMetadata`): router đã áp thứ tự của nó rồi (người
      dùng khai → bảng tên của router → số nhà cung cấp), nên harness đọc **số và
      nhãn** của router, không đoán lại từ tên model; router cũ không có nhãn thì
      đọc là `'reported'`.
    - không có gì: sàn có nhãn (`FALLBACK_CONTEXT_WINDOW`, `'fallback'`).

    Bảng đoán theo tên từng nằm ở đây (`gemini`→1M, `deepseek`→64000, …) đã bị xoá
    có chủ đích: hai bảng cùng sống một lúc chính là cách harness, router và giao
    diện nói ba số khác nhau về cùng một model.
    """
    if requested is not None:
        try:
            value = int(requested)
        except (ValueError, TypeError):
            value = None
        if value is not None and value > 0:
            source = declared_source if declared_source in DECLARED_CONTEXT_WINDOW_SOURCES else 'manual'
            return min(2000000, max(4096, value)), source
    if metadata:
        try:
            value = int((metadata or {}).get('contextWindow'))
        except (ValueError, TypeError, AttributeError):
            value = None
        if value is not None and value > 0:
            source = (metadata or {}).get('contextWindowSource')
            return min(2000000, max(4096, value)), (source if source in CONTEXT_WINDOW_SOURCES else 'reported')
    return FALLBACK_CONTEXT_WINDOW, 'fallback'


def resolve_thinking_level(requested, metadata=None):
    """Mức thinking ĐƯỢC LƯU cho phiên: chỉ mức mà model đã định tuyến thật sự công bố.

    Metadata router (`modelMetadata` / `/api/router/state`) mang `thinkingLevels`,
    `thinkingType` và `defaultThinking` đọc thẳng từ provider. Trước đây `create()`
    nhận bất kỳ chuỗi `thinkingLevel` nào và lưu nguyên văn, nên một mức sai (provider
    bỏ qua) vẫn nằm trong config như thể đã được áp.

    - Model CÔNG BỐ danh sách mức: mức yêu cầu được chuẩn hoá hoa/thường rồi phải
      khớp một mức trong danh sách (lưu đúng cách viết của provider); mức lạ →
      `THINKING_LEVEL_UNSUPPORTED` để người dùng biết ngay thay vì lưu im lặng.
    - Model KHÔNG công bố mức nào (`thinkingType` 'none'/'fixed' hoặc
      `thinkingLevels` rỗng, ví dụ các id antigravity `…-low/-medium/-high` đã mang
      sẵn mức trong tên): giá trị bị DROP (trả `None`) chứ không báo lỗi — provider
      không có điều khiển thinking để áp, và chặn tạo phiên ở đây là sai.
    - Không có metadata để đối chiếu (router không trả record, model lạ): giữ
      nguyên giá trị yêu cầu như hành vi cũ, vì không có cơ sở nào để phán.
    """
    if not isinstance(requested, str) or not requested.strip():
        return None
    level = requested.strip()
    if not isinstance(metadata, dict):
        return level
    published = metadata.get('thinkingLevels')
    levels = [str(item).strip().lower() for item in published if str(item).strip()] if isinstance(published, list) else []
    if not levels:
        return None
    for candidate in levels:
        if candidate == level.lower():
            return candidate
    raise ValueError(f'THINKING_LEVEL_UNSUPPORTED: model publishes {"/".join(levels)}; requested {level}')


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

# C1 — tệp diff: bản này KHÔNG có nhánh nào sinh ra nó (đo 2026-09-21: tab Diff của
# PlanPanel luôn rỗng), nên đường dẫn chỉ được coi là có thật khi chính phiên đã chạm một
# tệp `.diff`/`.patch` trong `tool_end`. Quét có trần để bản ghi `blocker` không bao giờ
# biến lượt hết ngân sách bước thành một truy vấn không đáy.
DIFF_ARTIFACT_RE = re.compile(r'/?[A-Za-z0-9_.-]*(?:/[A-Za-z0-9_.-]+)*\.(?:diff|patch)\b')
DIFF_ARTIFACT_EVENT_LIMIT = 40


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


# Cùng nguồn grammar với khối header và `plan_registry` — không có bản sao thứ ba của luật slug.
PLAN_IDENTITY_TEXT_RE = re.compile(rf'^{plan_header.IDENTITY_PATTERN}$')


def plan_approval_target(args, tool='request_approval'):
    """`(identity, version)` của lượt xin duyệt kế hoạch, hoặc `(None, None)` khi không khai kế hoạch.

    Hai tham số đi **cặp**: khai một nửa là lỗi tham số, không phải một lượt xin duyệt mơ hồ — ghi
    một hàng duyệt cho một bản không có thật còn tệ hơn không ghi gì. Đây là đường nối giữa
    `request_approval` và sổ duyệt `plan_reviews` (§4.1): người dùng duyệt trong chat và duyệt ở tab
    Plan phải cho ra cùng một hàng, khác nhau đúng ở cột `source`.
    """
    args = args or {}
    identity = str(args.get('planIdentity') or '').strip().strip('/')
    version = args.get('planVersion')
    if isinstance(version, str) and version.strip().isdigit():
        version = int(version.strip())  # model hay gửi số dạng chuỗi; "2" là 2, "hai" thì không
    if not identity and version is None:
        return None, None
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError(f'DECISION_INVALID: {tool} needs planIdentity and planVersion (int >= 1) together')
    if not identity:
        raise ValueError(f'DECISION_INVALID: {tool} needs planIdentity and planVersion (int >= 1) together')
    if not PLAN_IDENTITY_TEXT_RE.match(identity):
        raise ValueError('DECISION_INVALID: planIdentity must be lowercase dash-separated, optionally '
                         'nested (for example "billing-plan" or "subplans/api"); it is the plan group '
                         'the version belongs to, not the file name')
    return identity, version


# The child of `delegate_task` is a real session whose answer lands in the durable event stream AND in the
# parent's tool result, so every child string is bounded: a runaway child must not balloon either one.
# 8000 chars of answer is ~2000 tokens — enough for real findings, small enough to stay in the parent prompt.
CHILD_ANSWER_MAX_CHARS = 8000
# Echoes of the parent's own goal/context/prompt are already in the parent's `tool_start` event verbatim.
CHILD_ECHO_MAX_CHARS = 3000
CHILD_EXPECT_MAX_CHARS = 2000
# Appended to every child prompt (<= 1200 chars, asserted by tests). Free-form prose from a child is what
# made the first round of plans unusable: no evidence, no verification, no honest limits.
CHILD_RESULT_CONTRACT = f"""

Result contract (the parent needs exactly this back). Your own budget is at most {CHILD_MAX_STEPS} steps and {CHILD_DEADLINE_SECONDS} s, clamped by the parent; plan for it.
## Findings — what you established, most important first.
## Evidence — file paths with line numbers, exact commands, and the real observed output quoted.
## Verification performed — each check you actually ran and its result. Never claim success without evidence; if you could not run a check, say so.
## Limitations & open questions — what you could not verify, your assumptions, and what the parent must decide.
Keep it compact and drop nothing that proves a claim. An unevidenced claim is a failure, not an answer.
If you run out of steps or time, stop starting work and answer with the four-part diagnosis instead: {DIAGNOSIS_PARTS} — a `partial` answer with that diagnosis is worth far more to the parent than an empty failure."""


def bound_child_text(text, limit):
    """(bounded, truncated) — one child string must never grow the event stream without limit."""
    raw = str(text or '')
    if len(raw) <= limit:
        return raw, False
    return raw[:limit] + f'\n[Bounded at {limit} characters; the full text stays in the child transcript.]', True


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
        # sessionId -> đã gọi op `session_ensure` trong box (A1). Thư mục phiên sinh ở LẦN GHI đầu
        # tiên của phiên, nhưng một tiến trình harness chỉ trả MỘT `docker exec` cho việc đó; lượt
        # sau đọc lại set này. Không nhớ khi box chưa trả lời — hỏng thì lượt kế thử lại.
        self.ensured_sessions = set()
        # sessionId -> ContextCompressor. Sống cùng phiên (không bị bỏ ở `finally` của lượt) vì khoá
        # chống-thrash là trạng thái của PHIÊN: một lượt tóm tắt hỏng ở lượt trước vẫn còn giá trị
        # ngăn lượt sau đốt tiếp một lượt tóm tắt nữa. Bị thay khi cửa sổ ngữ cảnh đổi (config khác
        # thì ngưỡng khác).
        self.compressors = {}
        # sessionId -> (số token, số message) mà router ĐÃ báo cho request gần nhất. Bộ nén neo vào
        # con số thật này rồi chỉ ước lượng phần gửi sau nó (P3). Sống qua các lượt vì transcript
        # chỉ dài thêm — chỉ bị bỏ khi một lần nén thay chính danh sách đó.
        self.last_usage = {}
        self.tasks = {}
        # decisionId -> pending record; settled records are kept so a second answer is a real 409.
        self.pending = {}
        # sessionId -> the asyncio.timeout budget of the live turn (paused while a decision blocks).
        self.run_budget = {}
        self.child_slots = asyncio.Semaphore(3)
        self.writer_lock = asyncio.Lock()
        # web_search / web_fetch run on the HOST: the box has no Internet (only loopback).
        self.web = WebTools()

    async def heal_context_windows(self):
        """Sửa cửa sổ ngữ cảnh của các phiên ĐÃ LƯU, trả về số phiên đã sửa.

        Trước đợt 18 harness tự đoán cửa sổ theo tên model, nên mọi phiên DeepSeek/Qwen
        đã lưu mang 64 000 trong khi model thật có 1M — con số sai vẫn nằm trong config
        và `ContextCompressor` vẫn cắt transcript theo nó. Hàm này chạy một lần lúc khởi
        động:

        - đọc snapshot router MỘT lần (`model_metadata_map`), rồi tính lại đúng cặp
          `(số, nguồn)` bằng chính `resolve_context_window` — không có quy tắc thứ hai;
        - bỏ qua phiên không có `route.connectionId`/`route.modelId` (không có gì để đối chiếu);
        - cửa sổ người dùng TỰ KHAI (`manual`) chỉ bị sửa khi nó NHỎ HƠN con số router công
          bố cho đúng model đó, và mỗi lần sửa phát một event `context_window_healed`
          `{from, to, modelId, source}`. Lý do, đo sống 2026-09-21: 12 phiên còn kẹt ở
          32 768 ×9, 16 384 ×1, 8 192 ×2 — ngưỡng nén tương ứng 20 070 / 8 602 / 2 867
          token, tức phiên bị gộp ở ~2 % cửa sổ thật (router ghi 1 000 000 cho
          `deepseek-flash`), trong khi phiên `43a92d61` đã có request thật 29 908 token =
          1,49× ngưỡng của chính nó. Con số LỚN HƠN người dùng khai thì giữ nguyên: hạ nó
          xuống là cắt mất ngữ cảnh mà người dùng đã cố ý mở rộng;
        - `BOXFOX_CONTEXT_WINDOW_LOCK=1` tắt hẳn lượt sửa này (người dùng muốn giữ nguyên
          mọi con số đã khai);
        - router không trả lời thì không sửa gì (lượt sửa lỗi không được đoán bừa);
        - chỉ ghi khi cặp giá trị đổi, nên gọi lần hai trả 0 và không tạo write vô ích.
        """
        if context_window_locked():
            return 0
        configurations = self.store.all_configs()
        if not configurations:
            return 0
        metadata_map = await self.client.model_metadata_map()
        if not metadata_map:
            return 0
        healed = 0
        for sid, config in configurations.items():
            if not isinstance(config, dict):
                continue
            route = config.get('route') if isinstance(config.get('route'), dict) else {}
            connection_id, model_id = route.get('connectionId'), route.get('modelId')
            if not connection_id or not model_id:
                continue
            metadata = metadata_map.get((connection_id, model_id))
            number, source = resolve_context_window(model_id, None, metadata)
            current, declared = config.get('contextWindow'), config.get('contextWindowSource')
            if current == number and declared == source:
                continue
            if declared == 'manual' and isinstance(current, (int, float)) and number <= current:
                # Người dùng khai một cửa sổ LỚN HƠN con số router: đó là lựa chọn của họ.
                continue
            config['contextWindow'] = number
            config['contextWindowSource'] = source
            self.store.update_config(sid, config)
            self.store.emit(sid, 'context_window_healed', {
                'from': current,
                'to': number,
                'modelId': model_id,
                # `source` của event chỉ nói con số mới đến từ đâu: bảng của router, hay sàn
                # an toàn của harness khi router không có dòng nào cho model này.
                'source': 'fallback' if source == 'fallback' else 'router',
            })
            healed += 1
        return healed

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
        context_window, context_window_source = resolve_context_window(
            model_id_str, values.get('contextWindow'), model_metadata, values.get('contextWindowSource'))

        # thinkingLevel: chỉ lưu mức mà model đã định tuyến công bố (THINKING_LEVEL_UNSUPPORTED
        # khi model có danh sách mức mà mức yêu cầu không nằm trong đó; drop khi model không
        # công bố mức nào — xem `resolve_thinking_level`).
        if 'thinkingLevel' in route:
            thinking_level = resolve_thinking_level(route['thinkingLevel'], model_metadata)
            if thinking_level is None:
                route.pop('thinkingLevel')
            else:
                route['thinkingLevel'] = thinking_level

        # `tools` từ harness chỉ được THU HẸP bộ của vai trò: tên ngoài bộ bị bỏ, và vai trò
        # con vẫn bị giao với bộ của cha (`parent_tools`) nên không đường nào nới ra. Không
        # có luật này thì khối "Tool access" trên giao diện sẽ hứa điều engine từ chối bằng
        # `Tool not permitted for this role`. Thiếu trường, hoặc không phải danh sách, thì
        # giữ nguyên hành vi cũ — bộ đầy đủ của vai trò.
        requested = values.get('tools')
        allowed = allowed_tools(role, parent_tools)
        # C1 — hạn chót: `deadlineSeconds` bị kẹp vào [5, 600] từ trước tới nay mà KHÔNG nói
        # gì (đo sống 2026-09-21: người dùng đặt 900, engine chạy 600, không event/không log).
        # Giữ nguyên luật kẹp, nhưng ghi lại sự thật: `deadlineClamped` vào config (để payload
        # phiên trả được cờ này) và một notice `DEADLINE_CLAMPED` ngay sau khi phiên có id.
        requested_deadline = int(values.get('deadlineSeconds', DEADLINE_DEFAULT_SECONDS))
        deadline = min(DEADLINE_MAX_SECONDS, max(DEADLINE_MIN_SECONDS, requested_deadline))
        # B7 — cùng luật với hạn chót, cho `maxSteps`: kẹp vẫn giữ, nhưng phải NÓI RA. Giao diện
        # gửi 999 bước thì engine chạy 60 mà trước đợt này không hàng nào nói vậy (cùng lớp lỗi
        # với `DEADLINE_CLAMPED` của C1).
        requested_steps = max(1, int(values.get('maxSteps', MAX_STEPS_DEFAULT)))
        max_steps = min(MAX_STEPS_MAX, requested_steps)
        config = {'skills': list(dict.fromkeys(skills)), 'subagents': subagents, 'route': route,
                  'maxSteps': max_steps,
                  'deadlineSeconds': deadline,
                  'contextWindow': context_window,
                  'contextWindowSource': context_window_source,
                  'tools': sorted(set(requested) & set(allowed)) if isinstance(requested, list)
                           else sorted(allowed),
                  # Cắt bằng hằng số dùng chung: phía giao diện đọc đúng con số này từ
                  # `limits.py` (qua `runtime-info`), không chép tay lại lần thứ hai.
                  'instructions': str(values.get('instructions', ''))[:INSTRUCTIONS_MAX_CHARS]}
        if deadline != requested_deadline:
            config['deadlineClamped'] = True
        if max_steps != requested_steps:
            config['stepsClamped'] = True
        # Giữ metadata của model đã định tuyến: các lượt sau gửi route kèm
        # `thinkingLevel` (UI gửi ở mỗi lượt) và `start()` cần nó để đối chiếu.
        if model_metadata:
            config['modelMetadata'] = model_metadata
        session = self.store.create(config, role, parent_id)
        if config.get('deadlineClamped'):
            self.store.emit(session['id'], 'notice', {
                'code': DEADLINE_CLAMP_NOTICE_CODE,
                'requested': requested_deadline,
                'applied': deadline,
                'message': (f'{DEADLINE_CLAMP_NOTICE_CODE}: deadlineSeconds {requested_deadline} is outside '
                            f'the engine range {DEADLINE_MIN_SECONDS}-{DEADLINE_MAX_SECONDS} s — this session '
                            f'runs with {deadline} s'),
            })
        if config.get('stepsClamped'):
            self.store.emit(session['id'], 'notice', {
                'code': STEPS_CLAMP_NOTICE_CODE,
                'requested': requested_steps,
                'applied': max_steps,
                'message': (f'{STEPS_CLAMP_NOTICE_CODE}: maxSteps {requested_steps} is outside the engine '
                            f'range 1-{MAX_STEPS_MAX} — this session runs with {max_steps} steps'),
            })
        role_instructions = ROLES[role].instructions if role in ROLES else ORCHESTRATOR_SOP_GUIDANCE
        prompt = (
            f"{get_agent_identity()}\n\n"
            f"=== ASSIGNED ROLE: {role.upper()} ===\n"
            f"{role_instructions}\n\n"
            f"=== ENABLED SKILLS (Load full content via skill_view before executing complex workflows) ===\n"
            f"{self.catalog.prompt(skills)}"
            f'\n\n=== ANSWER LENGTH ===\n{ANSWER_LENGTH_HINT}'
        )
        if config['instructions']:
            prompt += f"\n\n=== OWNER-CONFIGURED DIRECTIVES ===\n{config['instructions']}"
        self.store.save(session['id'], [{'role': 'system', 'content': prompt}])
        return self.store.get(session['id'])


    async def route_metadata(self, session, route):
        """Router record của model mà route của LƯỢT trỏ tới, khi nó khác model của phiên.

        `start()` là hàm đồng bộ nên người gọi async (`submit`) tra trước rồi truyền
        vào. Trả `None` khi model không đổi (metadata đã lưu của phiên là đúng), khi
        lượt không gửi `thinkingLevel` (không có gì phải đối chiếu), hoặc khi không
        tra được (router tắt / client giả trong test) — lúc đó `start()` giữ nguyên
        hành vi cũ thay vì đoán.
        """
        if not isinstance(route, dict) or 'thinkingLevel' not in route:
            return None
        model_id = route.get('modelId')
        stored = session['config'].get('modelMetadata')
        if isinstance(stored, dict) and stored.get('id') == model_id:
            return None
        lookup = getattr(self.client, 'model_metadata', None)
        if not callable(lookup):
            return None
        try:
            record = await lookup(route.get('connectionId'), model_id)
        except Exception:
            return None
        return record if isinstance(record, dict) else None

    def start(self, sid, prompt, image=None, route=None, route_metadata=None, images=None,
              attachments=None):
        """Mở lượt mới. `images` là mảng ảnh inline của lượt (A7), `attachments` là tệp đã
        nằm thật trên đĩa box; cả hai đi qua `agent_core/attachments.py` để kiểm.
        """
        session = self.store.get(sid)
        if session['status'] in {'running', 'awaiting_decision'}:
            raise ValueError('SESSION_BUSY: Turn in progress')
        if route and isinstance(route, dict) and any(route.values()):
            # Route của lượt cũng mang `thinkingLevel` (UI gửi ở mỗi lượt) và thay
            # trọn `config['route']`, nên phải đối chiếu y như lúc tạo phiên — nếu
            # không, một mức sai lại được lưu nguyên văn và provider bỏ qua im lặng.
            updated = dict(route)
            metadata = session['config'].get('modelMetadata')
            metadata = metadata if isinstance(metadata, dict) else None
            # Metadata chỉ dùng được khi nó mô tả ĐÚNG model của route này. Route
            # đổi model ở lượt thì KHÔNG bỏ qua kiểm tra: người gọi đã tra sẵn
            # metadata của chính model mà route trỏ tới (`route_metadata`, cùng
            # nguồn `/api/router/state` như lúc tạo phiên) và truyền vào đây, nên
            # mức thinking vẫn được đối chiếu với danh sách provider công bố cho
            # model MỚI (B13: trước đây `metadata = None` khiến mức sai được lưu
            # nguyên văn và lượt chết ở provider). Không tra được (router tắt,
            # model lạ) thì giữ hành vi cũ: `resolve_thinking_level` không có cơ
            # sở để phán nên trả nguyên giá trị.
            if metadata is None or updated.get('modelId') != metadata.get('id'):
                metadata = route_metadata if isinstance(route_metadata, dict) else None
            if 'thinkingLevel' in updated:
                thinking_level = resolve_thinking_level(updated['thinkingLevel'], metadata)
                if thinking_level is None:
                    updated.pop('thinkingLevel')
                else:
                    updated['thinkingLevel'] = thinking_level
            session['config']['route'] = updated
            self.store.update_config(sid, session['config'])
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError('Prompt is required')
        # Một `image` đơn (đường cũ) gộp vào mảng `images`; luật từng ảnh và hai trần của
        # lượt nằm ở `validate_inline_images` (một nguồn, xem `agent_core/attachments.py`).
        checked_images = validate_inline_images([image, *(images or [])])
        checked_attachments = validate_attachments(attachments)
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
        # Khối tệp đính kèm do HARNESS dựng (`attachment_prompt_block`) — nguồn duy nhất cho
        # cả đường lượt thường lẫn đường command/skill; client không tự nhồi đường dẫn.
        block = attachment_prompt_block(checked_attachments)
        text = f'{prompt}\n\n{block}' if block else prompt
        if checked_images:
            content = [{'type': 'text', 'text': text}] + [{'type': 'image_url', 'image_url': {'url': row}}
                                                         for row in checked_images]
        else:
            content = text
        messages.append({'role': 'user', 'content': content})
        self.store.save(sid, messages, 'running')
        event = {'text': prompt}
        if checked_attachments:
            event['attachments'] = checked_attachments
        if checked_images:
            event['images'] = checked_images
        self.store.emit(sid, 'user', event)
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

    @staticmethod
    def seconds_left(budget):
        """Seconds left in this turn's deadline, or ``None`` when it cannot be read.

        The retry policy refuses a wait it cannot afford: sleeping past the deadline turns a
        recoverable provider limit into a `DEADLINE` failure with no answer at all.
        """
        try:
            return max(0.0, budget.when() - asyncio.get_running_loop().time())
        except Exception:
            return None

    @staticmethod
    def retry_noun(count):
        """`retry` / `retries` — the message is read by people, not parsed."""
        return 'retry' if count == 1 else 'retries'

    def artifact_paths(self, sid):
        """`(planPath, diffPath)` của một phiên — chỉ khi có BẰNG CHỨNG thật, không đoán.

        Harness chạy trên HOST còn tệp nằm trong box (`/home/agent/workspace`, một volume
        Docker), nên không có đường `Path.exists()` nào ở đây. Bằng chứng harness thật sự
        có là chính event của phiên:

        - `plan_written` chỉ được phát SAU khi sandbox xác nhận đường dẫn plan (xem
          `write_plan` và `test_write_plan.py` — "never emitted unless the sandbox confirms
          a real plan path"), nên `relativePath` của hàng MỚI NHẤT là một tệp có thật;
        - tệp diff: không nhánh nào trong bản này sinh tệp diff (đo 2026-09-21: tab Diff
          của PlanPanel luôn rỗng, `plan_files.py`/`worker.py` không có op diff), nên đường
          dẫn chỉ được lấy khi chính phiên đã chạm một tệp `.diff`/`.patch` qua `tool_end`.
          Không có bằng chứng thì trả `None` — bản ghi `blocker` bỏ hẳn khoá đó thay vì
          bịa một đường dẫn trông hợp lý.
        """
        plan_path = None
        row = self.store.db.execute(
            "SELECT payload FROM events WHERE session_id=? AND kind='plan_written' ORDER BY seq DESC LIMIT 1",
            (sid,)).fetchone()
        if row is not None:
            try:
                candidate = json.loads(row['payload']).get('relativePath')
            except (TypeError, ValueError):
                candidate = None
            if isinstance(candidate, str) and PLAN_PATH_RE.fullmatch(candidate):
                plan_path = candidate
        diff_path = None
        rows = self.store.db.execute(
            "SELECT payload FROM events WHERE session_id=? AND kind='tool_end' ORDER BY seq DESC LIMIT ?",
            (sid, DIFF_ARTIFACT_EVENT_LIMIT))
        for candidate_row in rows:
            match = DIFF_ARTIFACT_RE.search(str(candidate_row['payload']))
            if match:
                diff_path = match.group(0)
                break
        return plan_path, diff_path

    def blocker_record(self, sid, config=None):
        """Bản ghi `blocker` (duy nhất) của một lượt chạm trần bước — C1.

        Lượt chạy sống 2026-09-21 đã xong việc trên đĩa (plan `v5-…` 9 155 B, 4 tệp sửa,
        `300 passed`) mà phiên vẫn `failed`, và không hàng nào nói "việc đã xong, chỉ có
        lượt là chưa đóng". Bản ghi này là câu đó: `status: blocked`, `note: max-steps`,
        kèm đường dẫn plan/diff khi có bằng chứng (xem `artifact_paths`).
        """
        record = {'kind': 'blocker', 'status': 'blocked', 'note': 'max-steps'}
        if isinstance(config, dict) and isinstance(config.get('maxSteps'), int):
            record['maxSteps'] = config['maxSteps']
        plan_path, diff_path = self.artifact_paths(sid)
        if plan_path:
            record['planPath'] = plan_path
        if diff_path:
            record['diffPath'] = diff_path
        return record

    def session_metrics(self, sid):
        """Ba số đo độ dài của một phiên + cờ kẹp hạn chót (N10 + C1).

        Payload `GET /api/agent/sessions/{sid}` trả nguyên hàng `sessions` (trừ `messages`),
        nên trước đợt này không có cách nào biết một phiên dài bao nhiêu mà không tải cả
        transcript: đo sống 2026-09-21 — 150 phiên, trung vị 7 message / 17 942 B, nhưng
        phiên lớn nhất 6 424 279 B (10 phiên > 921 600 B, cả 10 đều `failed`). Bốn khoá dưới
        đây đọc từ chính hàng đã lưu:

        - `messageCount` — độ dài mảng `messages` đã lưu;
        - `contextEstimate` — ước lượng token của đúng transcript đó, cùng hàm `estimate_tokens`
          mà event `turn_start` dùng nên hai con số khớp nhau;
        - `compressionCount` — số hàng `events` kind `compression`, tức số lần bộ nén đã thay
          transcript (phải đếm từ `events`: đo sống chỉ có 22 hàng `checkpoints` trên 12 phiên,
          và không phải mọi lần nén đều để lại checkpoint);
        - `deadlineClamped` — phiên này có bị kẹp `deadlineSeconds` lúc tạo không (C1);
        - `stepsClamped` — phiên này có bị kẹp `maxSteps` lúc tạo không (B7, đối xứng với C1).
        """
        session = self.store.get(sid)
        config = session.get('config') if isinstance(session.get('config'), dict) else {}
        messages = session.get('messages') if isinstance(session.get('messages'), list) else []
        tools = schemas_for(config.get('tools') or [])
        row = self.store.db.execute(
            "SELECT COUNT(*) AS total FROM events WHERE session_id=? AND kind='compression'",
            (sid,)).fetchone()
        return {'messageCount': len(messages),
                'contextEstimate': estimate_tokens(messages, tools),
                'compressionCount': int(row['total']) if row is not None else 0,
                'deadlineClamped': bool(config.get('deadlineClamped')),
                'stepsClamped': bool(config.get('stepsClamped'))}

    async def write_journal_checkpoint(self, sid, saved, compacted, event, config):
        """A4 — bản đọc được của transcript trước nén ra `.session-history/<sid8>/`.

        Bảng `checkpoints` giữ bản đầy đủ (SQLite); tầng file giữ bản người đọc được. Ba tính chất
        của hàm này là cố ý, vì đo sống 2026-09-21 cho thấy chúng đã thiếu: (1) **không bao giờ** ném
        — mọi lỗi thành một `notice` với mã `CHECKPOINT_FILE_FAILED`, lượt vẫn đi tiếp; (2) số đo đi
        **cùng** bản ghi (số tin nhắn trước/sau, ước lượng token, cửa sổ, model) — 22 hàng checkpoint
        cũ không có một con số nào nên phải mò sang `events.payload`; (3) trạng thái bản ghi nói thật
        `degraded` khi vượt trần 8 MiB và file `.json` không được ghi.
        """
        numbers = {'messageCountBefore': len(saved) if isinstance(saved, list) else None,
                   'messageCountAfter': len(compacted) if isinstance(compacted, list) else None,
                   'beforeEstimate': event.get('beforeEstimate'),
                   'afterEstimate': event.get('afterEstimate'),
                   'contextWindow': config.get('contextWindow'),
                   'modelId': (config.get('route') or {}).get('modelId'),
                   'reason': event.get('kind'),
                   'ineffective': event.get('ineffective')}
        numbers = {key: value for key, value in numbers.items() if value is not None}
        answer = await session_journal.write_checkpoint_file(
            self.executor, self.store, sid, saved, numbers=numbers,
            note=f"nén theo {event.get('kind')}")
        before, after = numbers.get('messageCountBefore'), numbers.get('messageCountAfter')
        text = (f"nén {before} → {after} tin nhắn" if isinstance(after, int)
                else f"nén còn {after} tin nhắn")
        status = 'recorded'
        if answer is None:
            # Cả op hỏng: `_safe` đã ghim `CHECKPOINT_FILE_FAILED`. Bản ghi phải nói ĐÚNG là
            # không có bản đọc được — không đoán lý do (bản 0.1 luôn gán "chỉ có bản .md", câu
            # đó chỉ đúng ở một ca: transcript vượt trần 8 MiB).
            status = 'degraded'
            text += ' (không ghi được bản đọc được trong box)'
        elif answer.get('status') == 'degraded':
            status = 'degraded'
            text += f" ({answer.get('note') or 'chỉ có bản .md'})"
        journal_part = answer.get('journal') if isinstance(answer, dict) else None
        if isinstance(journal_part, dict) and journal_part.get('ok') is False:
            # Cặp file đã ghi mà dòng `journal.jsonl` không: nói ra phần còn thiếu, và **không**
            # hạ trạng thái của bản ghi xuống degraded (hàng SQLite vẫn vào, file vẫn có).
            session_journal.note_gap(
                self.store, sid, session_journal.JOURNAL_FAILED_CODE,
                f"{session_journal.JOURNAL_FAILED_CODE}: dòng nhật ký trong box không ghi được "
                f"({journal_part.get('error') or journal_part.get('code')}) — hàng SQLite và cặp "
                "file checkpoint thì đã có", op='checkpoint_write')
        # Dòng `journal.jsonl` của lần nén do CHÍNH op trong box ghi (cùng lượt với cặp file), nên
        # ở đây chỉ còn hàng SQLite — dùng đúng mã box mint để hai bề mặt đọc ra một mã.
        box_id = journal_part.get('id') if isinstance(journal_part, dict) else None
        data = {}
        for key in ('checkpointNumber', 'relPath', 'mdRelPath', 'messagesBytes', 'messageCount'):
            value = (answer or {}).get(key)
            if value is not None:
                data[key] = value
        session_journal.insert_row(self.store, sid, 'checkpoint', text, numbers=numbers,
                                   status=status, record_id=box_id if isinstance(box_id, str) else None,
                                   data=data or None)

    def refresh_journal_brief(self, sid, messages):
        """A5 — ghép khối ký ức vào system message (đầu mỗi lượt và ngay sau mỗi lần nén).

        Vì sao vào **system message**: khối này là chỉ dẫn, không phải một lượt hội thoại — để nó
        trôi vào lịch sử thì chính bộ nén sẽ cắt mất (đợt 19 đo được 86 % transcript bị gộp ở ca
        `920946a7`). Hàm trả `True` khi có thay đổi thật, và `inject_brief` thay khối cũ nên gọi
        nhiều lần không chồng khối.
        """
        if not isinstance(messages, list) or not messages:
            return False
        first = messages[0]
        if not isinstance(first, dict) or first.get('role') != 'system':
            return False
        original = first.get('content') or ''
        refreshed = session_journal.inject_brief(original, session_journal.brief(self.store, sid))
        if refreshed == original:
            return False
        first['content'] = refreshed
        self.store.save(sid, messages)
        return True

    def _notice_seen(self, sid, *codes):
        """True khi phiên này đã có notice BỀN khớp MỘT trong các mã (`payload LIKE %<code>%`).

        Một chỗ cho ba câu hỏi cùng dạng: `partial_turn` (mã lý do của lượt dở) và `diagnosed_turn`
        (mã lý do cộng dấu `"diagnosis": true`) — SQL không chép lại ba lần.
        """
        if not codes:
            return False
        where = ' OR '.join('payload LIKE ?' for _ in codes)
        row = self.store.db.execute(
            f"SELECT COUNT(*) AS total FROM events WHERE session_id=? AND kind='notice' AND ({where})",
            (sid, *(f'%{code}%' for code in codes))).fetchone()
        return bool(row is not None and row['total'])

    def partial_turn(self, sid):
        """Mã lý do khi lượt gần nhất của phiên này trả về câu trả lời DỞ, ngược lại `None`.

        Vòng 22 (B5): ba notice BỀN nói cùng một sự thật — lượt bị nhà cung cấp cắt ở trần
        output (`PROVIDER_OUTPUT_TRUNCATED`, C2), hết trần bước (`STEP_BUDGET_EXHAUSTED`, B3),
        hoặc hết hạn chót (`DEADLINE_EXCEEDED`, B4). Hàng `sessions` vẫn `completed` (bất biến
        #1: không thêm từ vựng trạng thái), nên `delegate` phải đọc notice để trả `partial` cho
        cha kèm ĐÚNG mã lý do — cha cần phân biệt "con bị nhà cung cấp cắt" với "con hết
        ngân sách" vì hai ca cần hai cách xử lý khác nhau.
        """
        for code in (TRUNCATED_OUTPUT_NOTICE_CODE, STEP_BUDGET_NOTICE_CODE, DEADLINE_NOTICE_CODE):
            if self._notice_seen(sid, code):
                return code
        return None

    def enforce_answer_length(self, sid, text):
        """D2 — cổng đo độ dài câu trả lời cuối (D-4). Trả `(text, partial)`.

        Ba mức, và mức nào cũng NÓI RA (im lặng là thứ đã làm vòng 21 tốn thời gian):

        - `<= ANSWER_WARN_CHARS`: không gì cả — không nhiễu.
        - trong khoảng cảnh báo: một notice bền + một dòng log, câu trả lời **nguyên vẹn**.
        - `> ANSWER_MAX_CHARS`: cắt còn `ANSWER_MAX_CHARS` ký tự + dòng nói chỗ lấy phần còn
          lại, một notice bền kèm số gốc, và **một** hàng `X:`; lượt thành `partial`. Bản đã
          cắt vào transcript (ngữ cảnh gửi đi không được phình theo bản gốc) — người dùng đã
          thấy phần dài hơn qua `stream`, đó là chấp nhận có ghi trong docs.
        """
        chars = len(text or '')
        if chars <= ANSWER_WARN_CHARS:
            return text, False
        if chars <= ANSWER_MAX_CHARS:
            self.store.emit(sid, 'notice', {
                'code': ANSWER_LENGTH_WARN_CODE, 'chars': chars, 'limit': ANSWER_WARN_CHARS,
                'message': (f'{ANSWER_LENGTH_WARN_CODE}: the answer is {chars} chars — over the '
                            f'{ANSWER_WARN_CHARS}-char guidance; long content belongs in a file in '
                            'the workspace, not in the answer')})
            system_log.write('answer.length', level='warn', session_id=sid, status='warn',
                             chars=chars, limit=ANSWER_WARN_CHARS)
            return text, False
        kept = text[:ANSWER_MAX_CHARS] + answer_truncation_tail()
        journal_seq = _journal_answer_truncated(self.store, sid, chars, ANSWER_MAX_CHARS)
        notice = {'code': ANSWER_TOO_LONG_CODE, 'partial': True, 'chars': chars,
                  'keptChars': ANSWER_MAX_CHARS, 'limit': ANSWER_MAX_CHARS,
                  'message': (f'{ANSWER_TOO_LONG_CODE}: the answer was {chars} chars and was cut at '
                              f'{ANSWER_MAX_CHARS} — write the full content to a file in the workspace '
                              'and quote the path')}
        if journal_seq is not None:
            notice['journalSeq'] = journal_seq
        self.store.emit(sid, 'notice', notice)
        system_log.write('answer.length', level='warn', session_id=sid, status='truncated',
                         chars=chars, kept=ANSWER_MAX_CHARS)
        return kept, True

    async def wrap_up_diagnosis(self, sid, messages, config, budget, reason, *, out_of_time=False):
        """Lượt chốt CÓ TRẦN cho một lượt sắp hết ngân sách. Trả `(text, read_tool_calls)`.

        Ba tính chất, và cả ba đều là điều kiện sống còn của đường này:

        - **Có trần.** `WRAP_UP_TIMEOUT_SECONDS` (và không hơn phần thời gian còn lại của lượt
          khi `budget` còn sống), `WRAP_UP_MAX_TOKENS` token, `WRAP_UP_READ_TOOL_CALLS` lời gọi
          công cụ đọc. Đường hạn chót truyền `budget=None` vì hạn chót của lượt đã tiêu hết —
          cửa sổ chốt này là thứ duy nhất còn lại, và nó vẫn bị chặn ở 30 s.
        - **Không công cụ ghi.** Chỉ nhóm `repositoryReading` (`file_read`/`codebase_glob`/
          `codebase_grep`) chạy được, và chỉ trong pha đọc; câu trả lời cuối gọi với `tools=[]`
          nên model buộc phải trả lời bằng chữ.
        - **Không làm hỏng lượt.** Mọi lỗi (mạng, timeout, tool hỏng) trả `''` để chỗ gọi đi
          tiếp đường cũ của nó (notice `error` + `failed`) — chẩn đoán là phần THÊM, không phải
          điều kiện để lượt được đóng.
        """
        limit = WRAP_UP_TIMEOUT_SECONDS
        if budget is not None:
            seconds = self.seconds_left(budget)
            if seconds is not None:
                limit = min(WRAP_UP_TIMEOUT_SECONDS, max(0.0, seconds))
        if limit <= 1.0:
            return '', 0
        read_calls = 0
        prompt = diagnosis_prompt(reason, out_of_time=out_of_time)
        try:
            async with asyncio.timeout(limit):
                if out_of_time:
                    read_schemas = schemas_for(READ_TOOL_NAMES & set(config['tools']))
                    if read_schemas:
                        request = list(messages) + [{'role': 'user', 'content': prompt}]
                        # Đúng HAI lời gọi có tool đọc (mỗi lời tối đa `WRAP_UP_READ_TOOL_CALLS`
                        # lời gọi được thực thi), rồi tới nhịp chẩn đoán — trần cứng ba lời gọi
                        # provider cho cả đường hạn chót.
                        for _ in range(WRAP_UP_READ_TOOL_CALLS):
                            response = await self.client.complete(request, read_schemas, config['route'],
                                                                  max_tokens=WRAP_UP_MAX_TOKENS)
                            message = (response.get('choices') or [{}])[0].get('message') or {}
                            text = (message.get('content') or '').strip()
                            calls = list(message.get('tool_calls') or [])
                            if text and not calls:
                                return text, read_calls
                            if not calls or read_calls >= WRAP_UP_READ_TOOL_CALLS:
                                break
                            request.append({'role': 'assistant', 'content': message.get('content') or '',
                                            'tool_calls': calls})
                            for call in calls:
                                if read_calls >= WRAP_UP_READ_TOOL_CALLS:
                                    break
                                name = (call.get('function') or {}).get('name') or ''
                                args, parse_error = _parse_tool_arguments((call.get('function') or {}).get('arguments'))
                                read_ok = False
                                if parse_error or name not in READ_TOOL_NAMES:
                                    result = {'is_error': True, 'error': parse_error or 'not a read tool'}
                                else:
                                    read_calls += 1
                                    read_ok = True
                                    # Lượt đọc lại này cũng là việc THẬT trên máy người dùng, nên
                                    # nó phải hiện trong dòng event như mọi lời gọi khác — nếu
                                    # không, giao diện đọc một câu chẩn đoán mà không thấy gốc.
                                    self.store.emit(sid, 'tool_start', {'id': call.get('id'), 'name': name,
                                                                        'args': args})
                                    read_started = time.time()
                                    try:
                                        result = await self.dispatch(self.store.get(sid), name, args, call.get('id'))
                                    except Exception as exc:
                                        result = {'is_error': True, 'error': str(exc)}
                                    system_log.write('tool.end', session_id=sid, tool=name, wrapUp=True,
                                                     isError=bool(result.get('is_error')) if isinstance(result, dict) else False,
                                                     durationMs=(time.time() - read_started) * 1000)
                                safe = {key: value for key, value in result.items()
                                        if key not in {'image', 'base64'}} if isinstance(result, dict) else result
                                if read_ok and isinstance(safe, dict):
                                    self.store.emit(sid, 'tool_end', {'id': call.get('id'), 'name': name,
                                                                     'args': args, 'result': safe})
                                request.append({'role': 'tool', 'tool_call_id': call.get('id') or '',
                                                'name': name,
                                                'content': json.dumps(safe, ensure_ascii=False)[:8000]})
                # Câu trả lời cuối: KHÔNG tool. Model phải nói ra bốn phần chẩn đoán bằng chữ.
                response = await self.client.complete(list(messages) + [{'role': 'user', 'content': prompt}],
                                                      [], config['route'], max_tokens=WRAP_UP_MAX_TOKENS)
                message = (response.get('choices') or [{}])[0].get('message') or {}
                return (message.get('content') or '').strip(), read_calls
        except Exception as exc:
            system_log.write('turn.wrapup_failed', level='warn', session_id=sid, reason=reason,
                             errorCode=classify_failure(exc)[0])
            return '', read_calls

    def diagnosed_turn(self, sid, reason_code):
        """True khi lượt gần nhất của phiên này trả về **chẩn đoán** cho mã lý do `reason_code`.

        B10: notice BỀN mà `finish_partial` phát ra mang `code` và `diagnosis: true` — đọc chính
        nó thì cha biết câu trả lời dở kia có bốn phần chẩn đoán, chứ không phải một câu cụt.
        """
        if not self._notice_seen(sid, reason_code):
            return False
        return self._notice_seen(sid, '"diagnosis": true')

    @staticmethod
    def diagnosis_ok(text):
        """True khi lượt chốt THẬT SỰ trả về chẩn đoán, không phải một chữ "ok" cho có."""
        return bool(text and len(text.strip()) >= DIAGNOSIS_MIN_CHARS)

    async def ensure_session_dir(self, session):
        """A1 — gọi op `session_ensure` đúng **một lần** cho mỗi phiên trong vòng đời tiến trình.

        Thư mục phiên sinh ở lần ghi đầu tiên (không lúc tạo phiên), và lượt đầu là lần ghi đầu
        tiên — nhưng gọi op này ở *mỗi* lượt là trả thêm một `docker exec` vô ích. Vì vậy nhớ theo
        `sid` trong `self.ensured_sessions`; **chỉ** nhớ khi box đã trả lời (executor hỏng/op lỗi thì
        `ensure_session` trả `None` kèm notice `JOURNAL_DEGRADED`, và lượt sau thử lại).

        `role`/`parent` lấy từ chính hàng phiên: `session.json` là bản đọc được ngoài DB, nên nó
        phải nói được phiên này là phiên gốc hay phiên con của ai.
        """
        sid = session.get('id')
        if not sid or sid in self.ensured_sessions:
            return None
        answer = await session_journal.ensure_session(self.executor, self.store, sid,
                                                      role=session.get('role'),
                                                      parent=session.get('parent_id'))
        if answer is not None:
            self.ensured_sessions.add(sid)
        return answer

    async def _run(self, sid):
        session = self.store.get(sid)
        config, messages = session['config'], session['messages']
        self.active_messages[sid] = messages
        tools = schemas_for(config['tools'])
        loop_guard = AntiLoopGuard(threshold=3)
        started = time.time()
        steps_used = 0
        # B9 — số công cụ đã chạy trong CẢ lượt (không phải của riêng bước). Cùng `steps_used`
        # và `deadlineUsedMs`, nó nằm trong payload `turn_end` để giao diện và `rushed_index`
        # đọc được "lượt này đã tiêu bao nhiêu" mà không phải đếm lại 74 994 hàng `events`.
        tools_run = 0
        # N6 — ranh giới LƯỢT trong dòng event. Đo sống 2026-09-21: `turn_start`/`turn_end`
        # = 0 trên 74 994 hàng `events`, nên muốn đếm số lượt phải suy từ `user`/`finish` và
        # không ai biết một bước dài bao nhiêu, ngưỡng nén lúc đó là bao nhiêu. Cặp event
        # dưới đây đóng đúng MỘT lần cho mỗi bước, trên mọi đường ra (xong, hỏng, bị dừng).
        turn = {'step': None}

        def close_turn(status, finish_reason=None, tool_calls=0, usage=None, extra=None):
            """Đóng cặp `turn_start`/`turn_end` của bước đang mở, nếu có.

            `contextEstimate` đọc tại đây (sau khi hàng assistant của bước đã vào transcript)
            nên nó là ngữ cảnh mà bước KẾ TIẾP sẽ nhìn thấy — cùng phép đo với event `step`.

            B9: payload mang thêm ba số **luỹ kế của cả lượt** — `stepsUsed`, `toolsRun`,
            `deadlineUsedMs`. `turn_end` được phát ở cuối MỖI bước, nên ba khoá này chỉ có
            nghĩa ở lần đóng CUỐI của lượt; đó là lần mà giao diện đọc ("Worked for 180s"
            trước đây là con số duy nhất, và nó nói `deadlineSeconds` chứ không nói đã dùng bao
            nhiêu). `extra` cho đường `partial` gắn thêm `diagnosis`/`stuckReason`.
            """
            step_open = turn['step']
            if step_open is None:
                return
            turn['step'] = None
            payload = {'step': step_open, 'status': status,
                       'finishReason': finish_reason, 'toolCalls': tool_calls,
                       'contextEstimate': estimate_tokens(messages, tools),
                       'stepsUsed': steps_used, 'toolsRun': tools_run,
                       'deadlineUsedMs': round((time.time() - started) * 1000)}
            if extra:
                payload.update(extra)
            output_tokens = (usage or {}).get('completion_tokens') if isinstance(usage, dict) else None
            if not isinstance(output_tokens, int) or isinstance(output_tokens, bool):
                output_tokens = (usage or {}).get('output_tokens') if isinstance(usage, dict) else None
            if isinstance(output_tokens, int) and not isinstance(output_tokens, bool):
                payload['outputTokens'] = output_tokens
            self.store.emit(sid, 'turn_end', payload)

        def finish_partial(text, reason_code, *, read_tool_calls=0):
            """Đóng lượt bằng câu trả lời DỞ nhưng CÓ THẬT (B3/B4): hàng assistant, `partial`, notice.

            Thứ tự bốn việc là hợp đồng: transcript trước (lượt sau đọc được nó), rồi `turn_end`
            với `status='partial'`, rồi `finish`, rồi notice BỀN mang mã lý do — notice là bản
            duy nhất sống qua `store.save`, và `partial_turn`/`delegate` đọc chính nó để biết
            lượt này không trọn vẹn. Hàng `sessions` vẫn `completed` (bất biến #1: không thêm từ
            vựng trạng thái). Trả `text` để chỗ gọi `return` thẳng.
            """
            messages.append({'role': 'assistant', 'content': text})
            self.store.save(sid, messages, 'completed')
            self.store.emit(sid, 'assistant', {'text': text, 'thought': '', 'final': True})
            close_turn('partial', 'stop', 0, None, extra={'partial': True, 'diagnosis': True})
            self.store.emit(sid, 'finish', {'status': 'completed'})
            elapsed_ms = round((time.time() - started) * 1000)
            notice = {'code': reason_code, 'partial': True, 'diagnosis': True,
                      'diagnosisChars': len(text), 'stepsUsed': steps_used, 'toolsRun': tools_run,
                      'maxSteps': config.get('maxSteps'), 'reservedSteps': WRAP_UP_STEPS_RESERVED,
                      'deadlineSeconds': config.get('deadlineSeconds'), 'deadlineUsedMs': elapsed_ms,
                      'message': (f'{reason_code}: the turn ran out of budget — closing with a '
                                  'four-part diagnosis instead of losing the work')}
            if read_tool_calls:
                notice['readToolCalls'] = read_tool_calls
            self.store.emit(sid, 'notice', notice)
            system_log.write('turn.end', level='warn', session_id=sid, status='completed',
                             partial=True, diagnosis=True, reason=reason_code, steps=steps_used,
                             toolsRun=tools_run, textChars=len(text), deadlineUsedMs=elapsed_ms)
            return text
        # B3 — cửa sổ giữ chỗ: ba bước cuối của trần bước là của việc CHẨN ĐOÁN, không phải
        # của việc mới. Đo sống vòng 21: lượt chạm trần bước (phiên `ea948649…`) chạy đủ 10/10
        # bước rồi trả "iteration budget reached" trong khi mọi việc trên đĩa đã xong.
        wrap_up_at = max(0, config['maxSteps'] - WRAP_UP_STEPS_RESERVED)
        system_log.write('turn.start', session_id=sid, role=session.get('role'),
                         model=(config.get('route') or {}).get('modelId'),
                         connectionId=(config.get('route') or {}).get('connectionId'),
                         contextWindow=config.get('contextWindow'), maxSteps=config.get('maxSteps'),
                         deadlineSeconds=config.get('deadlineSeconds'),
                         contextEstimate=estimate_tokens(messages, tools),
                         messages=len(messages))
        self.refresh_journal_brief(sid, messages)
        try:
            # A1 — thư mục phiên (`<sid8>/session.json` + `checkpoints/`) sinh ở **lần ghi đầu tiên**,
            # không lúc tạo phiên: một lỗi đĩa không được làm chết `POST /api/agent/sessions`. Lượt
            # đầu của mỗi phiên chính là lần ghi đầu tiên, nên đây là chỗ gọi op `session_ensure` —
            # trước mọi bản ghi nhật ký/checkpoint, để `session.json` nói được sid8 này là phiên nào
            # ngay cả khi lượt đó chưa kịp ghi gì khác. Hỏng thì `session_journal` ghim notice và lượt
            # đi tiếp. Đặt TRONG `try` này để một cú `stop()` rơi đúng vào lúc chờ box vẫn là
            # `cancelled` (không để phiên mắc ở `running`); chỉ trả một `docker exec` cho mỗi phiên.
            await self.ensure_session_dir(session)
            async with asyncio.timeout(config['deadlineSeconds']) as budget:
                self.run_budget[sid] = budget
                for step in range(config['maxSteps']):
                    async def summarize(history, max_tokens=None):
                        return await self.client.complete(history, [], config['route'], max_tokens=max_tokens or 2048)
                    compressor = self.compressors.get(sid)
                    if compressor is None or compressor.context_window != config['contextWindow']:
                        compressor = self.compressors[sid] = ContextCompressor(config['contextWindow'])
                    compacted, event = await compressor.compact(messages, tools, summarize,
                                                                usage=self.last_usage.get(sid))
                    if event:
                        if compacted is not messages:
                            saved = messages
                            # N4 — hàng checkpoint tự nói nó đo bằng gì (cửa sổ, ngưỡng, ước
                            # lượng). Đường `/compact` đã ghi bốn số này từ đầu; đường tự động thì
                            # chưa, nên 22 hàng sống chỉ có `id, session_id, messages, reason,
                            # created` và muốn biết lần nén đó đo bằng gì phải mò sang `events`.
                            self.store.checkpoint(sid, messages, event['kind'], {
                                'before_estimate': event.get('beforeEstimate'),
                                'after_estimate': event.get('afterEstimate'),
                                'context_window': config.get('contextWindow'),
                                'model_id': (config.get('route') or {}).get('modelId'),
                            })
                            messages = compacted
                            self.active_messages[sid] = messages
                            self.skill_loader.reset(sid)
                            self.store.save(sid, messages)
                            # Con số usage của request cũ mô tả danh sách CŨ: giữ lại thì lần đo sau
                            # lấy một hóa đơn thật của một transcript khác (PI bỏ usage cũ sau mỗi
                            # lần nén, compaction.ts:2393-2405).
                            self.last_usage.pop(sid, None)
                            # A4/A5 — bản đọc được của transcript trước nén ra file trong box, rồi
                            # dựng lại khối ký ức: sau một lần nén, chính khối đó là thứ giữ lại
                            # "phiên này đang ở đâu" mà không cần đọc lại bảng `checkpoints`.
                            await self.write_journal_checkpoint(sid, saved, compacted, event, config)
                            self.refresh_journal_brief(sid, messages)
                        self.store.emit(sid, 'compression', event)
                    self.store.emit(sid, 'step', {'iteration': step + 1, 'contextEstimate': estimate_tokens(messages, tools)})
                    # The router callback hands over the text accumulated so far (that is the shape
                    # every provider adapter can satisfy). Events must carry only the NEW part:
                    # a consumer that appends `assistant_delta.text` would otherwise reprint the
                    # whole answer once per token, and every event would store the full text again.
                    streamed = {'content': '', 'thought': ''}

                    def _suffix(previous, current):
                        # `current` is the text accumulated by the provider so far. While it grows by
                        # appending, only the new tail is emitted. `current` that does NOT start with
                        # `previous` means the provider restarted its accumulation (a fresh attempt,
                        # or a rewritten answer): the whole `current` is then new, and the consumer
                        # must drop what it already showed for this step — hence the reset below and
                        # the `UPSTREAM_RETRY` notice consumers treat as a reset.
                        return current[len(previous):] if current.startswith(previous) else current

                    def _reset_stream():
                        streamed['content'] = ''
                        streamed['thought'] = ''

                    def handle_thought(thought_text):
                        new_text = _suffix(streamed['thought'], thought_text)
                        streamed['thought'] = thought_text
                        if new_text:
                            self.store.emit(sid, 'thought', {'text': new_text})

                    def handle_content(content_text):
                        new_text = _suffix(streamed['content'], content_text)
                        streamed['content'] = content_text
                        if new_text:
                            self.store.emit(sid, 'assistant_delta', {'text': new_text})
                    steps_used = step + 1
                    # N6: mở lượt NÀY. `threshold` hỏi CHÍNH bộ nén đang chạy (cùng lớp
                    # `ContextCompressor` đã cắt transcript) — ngưỡng chỉ có một định nghĩa,
                    # không chép lại công thức ở đây. Lưới an toàn: bộ nén được dựng ngay đầu
                    # mỗi bước nên nhánh dưới gần như không chạy.
                    compressor = self.compressors.get(sid) or ContextCompressor(
                        config.get('contextWindow') or FALLBACK_CONTEXT_WINDOW)
                    turn_payload = {'step': steps_used,
                                    'modelId': (config.get('route') or {}).get('modelId'),
                                    'contextWindow': config.get('contextWindow'),
                                    'threshold': compressor.threshold,
                                    'contextEstimate': estimate_tokens(messages, tools)}
                    self.store.emit(sid, 'turn_start', turn_payload)
                    turn['step'] = steps_used
                    # Retry policy (failures.retry_advice owns the rules): a dropped socket, a
                    # restarted router, an empty stream OR a provider asking us to slow down
                    # (429 / ``Retry-After``) gets another attempt inside this turn's budget.
                    # A deadline already spent, or a request the provider rejected, fails at once
                    # — a second identical call cannot help. Waiting is bounded per attempt and
                    # per turn, so a retry never eats the deadline it is trying to save.
                    attempts = 0
                    retry_waited = 0.0
                    degraded = False
                    while True:
                        step_started = time.time()
                        # A retry restarts the answer: without this, the abandoned partial text of
                        # the previous attempt stays on screen and the new answer is glued to it.
                        if attempts or degraded:
                            _reset_stream()
                        try:
                            # B3 — bước trong cửa sổ giữ chỗ: câu chẩn đoán đi kèm YÊU CẦU nhưng
                            # KHÔNG vào transcript (nó là chỉ dẫn của lượt này, không phải dữ
                            # liệu của phiên; nhét vào `messages` là phình ngữ cảnh của mọi bước
                            # sau). Bộ tool vẫn còn, nên model đọc lại được tệp nó vừa sửa.
                            request_messages = messages
                            if step >= wrap_up_at:
                                request_messages = messages + [{'role': 'user', 'content': diagnosis_prompt(
                                    STEP_BUDGET_NOTICE_CODE, config['maxSteps'] - step)}]
                            response = await self.client.complete(request_messages, tools, config['route'], on_thought=handle_thought, on_content=handle_content)
                            break
                        except Exception as exc:
                            code, message = classify_failure(exc)
                            system_log.write('model.error', level='warn', session_id=sid, turn_id=steps_used,
                                             step=step + 1, attempt=attempts + 1, errorCode=code, message=message,
                                             durationMs=(time.time() - step_started) * 1000, retries=attempts,
                                             retryWaitedMs=round(retry_waited * 1000),
                                             retryBudgetSeconds=RETRY_BUDGET_SECONDS,
                                             detail=failure_detail(exc))
                            # Danh mục của router có thể quảng cáo một mức thinking mà API của
                            # provider không nhận (Google đánh dấu `thinking: true` cho cả họ
                            # Gemini 2.5, nhưng các model đó trả `400 Thinking level is not
                            # supported`). Đây là lỗi của YÊU CẦU, không phải của nhà cung cấp:
                            # bỏ mức rồi gọi lại, để lượt vẫn có câu trả lời thay vì dựng banner
                            # đỏ. Không tính vào số lần thử lại (không chờ provider), và chỉ chạy
                            # một lần vì mức đã bị bỏ khỏi route.
                            if config['route'].get('thinkingLevel') and level_refusal(exc):
                                dropped = config['route'].pop('thinkingLevel')
                                degraded = True
                                self.store.emit(sid, 'notice', {
                                    'code': 'THINKING_LEVEL_REFUSED',
                                    'reset': True,
                                    'level': dropped,
                                    'model': config['route'].get('modelId'),
                                    'message': (f'{code}: the provider does not accept the thinking level '
                                                f'"{dropped}" for this model — retrying without it '
                                                f'({message})'),
                                })
                                continue
                            advice = retry_advice(exc, attempts, remaining_seconds=self.seconds_left(budget),
                                                  spent_seconds=retry_waited)
                            if advice is None:
                                if attempts:
                                    # The chat banner prints the LAST error, which on its own reads
                                    # like "failed with no retry". The attempt count rides along, and
                                    # the notice keeps the give-up visible in the transcript. The
                                    # reason it stopped is named too: "gave up after 3 retries" is
                                    # wrong when the real cause was the per-turn wait budget or the
                                    # turn's remaining window.
                                    exc.retry_attempts = attempts
                                    exc.retry_waited_seconds = round(retry_waited, 3)
                                    stop = stop_reason(exc, attempts, remaining_seconds=self.seconds_left(budget),
                                                       spent_seconds=retry_waited)
                                    gave_up = {
                                        'budget': (f'gave up after {attempts} {self.retry_noun(attempts)} in '
                                                   f'{retry_waited:.1f}s — the per-turn retry budget of '
                                                   f'{RETRY_BUDGET_SECONDS:.0f}s is spent'),
                                        'window': (f'gave up after {attempts} {self.retry_noun(attempts)} in '
                                                   f'{retry_waited:.1f}s — too little turn time left for '
                                                   f'another attempt'),
                                    }.get(stop, f'gave up after {attempts} {self.retry_noun(attempts)} in {retry_waited:.1f}s')
                                    self.store.emit(sid, 'notice', {
                                        'code': 'UPSTREAM_RETRY_EXHAUSTED',
                                        'reset': True,
                                        'attempts': attempts,
                                        'waitMs': round(retry_waited * 1000),
                                        'stopReason': stop,
                                        'message': f'{code}: {gave_up} ({message})',
                                    })
                                raise
                            attempts += 1
                            retry_waited += advice['delay']
                            self.store.emit(sid, 'notice', {
                                'code': 'UPSTREAM_RETRY',
                                # Consumers use this notice to drop the live text of the attempt
                                # that just died; the text after it is a complete answer again.
                                'reset': True,
                                'attempt': advice['attempt'],
                                'maxRetries': advice['maxRetries'],
                                'waitMs': round(advice['delay'] * 1000),
                                'reason': advice['reason'],
                                'message': (f'{code}: {advice["reason"]} — retrying {advice["attempt"]}/'
                                            f'{advice["maxRetries"]} in {advice["delay"]:.1f}s ({message})'),
                            })
                            await asyncio.sleep(advice['delay'])
                    # P3 — usage của router là con số THẬT của đúng request vừa gửi, nên nó mô tả
                    # `messages[:len(messages)]` tại đây (hàng assistant của câu trả lời này chưa
                    # được thêm vào). Đo bằng ước lượng 3 byte/token lệch hẳn trên transcript nhiều
                    # ảnh và nhiều chữ ký suy luận: đo sống 2026-09-20 (phiên `08f2483c`) ước lượng
                    # 1 051 631 token cho một request router báo 358 771 token đầu vào.
                    reading = usage_reading(response.get('usage'), len(messages))
                    if reading:
                        self.last_usage[sid] = reading
                    choice = response['choices'][0]
                    # C2 — nhà cung cấp cắt ở trần output: `finishReason: length`, 0 tool call.
                    # Đo sống 2026-09-21: phiên con `6bd868ad…` trả `outputTokens: 4096`,
                    # `toolCalls: 0` → `TURN_EMPTY_RESPONSE`, KHÔNG thử lại lần nào, và phiên
                    # cha đọc kết quả đó thành con `failed` — trong khi đây là lỗi TẠM THỜI của
                    # nhà cung cấp: cùng câu hỏi, xin ít token hơn, là có câu trả lời. Thử lại
                    # ĐÚNG MỘT lần với `TRUNCATED_OUTPUT_MAX_TOKENS` và KHÔNG gửi tool schema
                    # (chính bộ tool là thứ vừa ngốn hết trần). Đây không phải lượt thử lại của
                    # `retry_advice` (bộ đó lo lỗi mạng/429), nên không đụng vào nó.
                    truncated_retry = False
                    truncated_partial = False
                    if not (choice['message'].get('tool_calls') or []) and choice.get('finish_reason') == 'length':
                        _reset_stream()
                        response = await self.client.complete(request_messages, [], config['route'],
                                                              on_thought=handle_thought,
                                                              on_content=handle_content,
                                                              max_tokens=TRUNCATED_OUTPUT_MAX_TOKENS)
                        reading = usage_reading(response.get('usage'), len(messages))
                        if reading:
                            self.last_usage[sid] = reading
                        choice = response['choices'][0]
                        truncated_retry = True
                    message = choice['message']
                    text, calls = message.get('content') or '', message.get('tool_calls') or []
                    thought = message.get('reasoning_content') or message.get('thought') or choice.get('reasoning_content') or ''
                    if truncated_retry and not calls and (choice.get('finish_reason') == 'length' or not text.strip()):
                        # Vẫn bị cắt sau khi đã xin ít token hơn: đây là SỰ THẬT của lượt này,
                        # không phải lỗi hạ tầng. Nói ra bằng một notice BỀN — đó là bản ghi duy
                        # nhất sống sót qua `store.save`, nên `delegate` đọc nó (xem
                        # `truncated_turn`) để không báo với cha rằng con đã xong. Cờ
                        # `truncated_partial` chỉ đổi ĐÚNG hai chỗ ở dưới: bỏ qua phép kiểm
                        # "câu trả lời phải trọn vẹn" và ghi ranh giới lượt là `partial`. Hàng
                        # `sessions` vẫn `completed` (giữ nguyên từ vựng trạng thái cũ); không
                        # đường nào ở đây ghi `completed` cho một câu trả lời trọn vẹn.
                        self.store.emit(sid, 'notice', {
                            'code': TRUNCATED_OUTPUT_NOTICE_CODE,
                            'partial': True,
                            'outputTokens': (response.get('usage') or {}).get('completion_tokens'),
                            'message': (f'{TRUNCATED_OUTPUT_NOTICE_CODE}: the provider stopped at the output '
                                        f'cap twice — this turn only produced a partial answer'),
                        })
                        truncated_partial = True
                    if not calls and not truncated_partial and (choice.get('finish_reason') not in {'stop', 'end_turn'} or not text.strip()):
                        # B8 — `TURN_EMPTY_RESPONSE`: model đã suy nghĩ (thought delta đã phát)
                        # nhưng không trả chữ nào và không gọi công cụ. Đo sống vòng 21 (BUG-41):
                        # lượt như vậy đóng thẳng bằng lỗi, KHÔNG thử lại lần nào, dù cùng câu
                        # hỏi hỏi lại là có câu trả lời. Thử ĐÚNG MỘT lần, hai cách khác nhau:
                        #   - route KHÔNG có `thinkingLevel` ⇒ `tool_choice: 'required'` trong
                        #     bản SAO của route (một request, không lưu vào config) — model buộc
                        #     phải hành động;
                        #   - route CÓ `thinkingLevel` ⇒ bỏ tool và xin câu trả lời bằng chữ, vì
                        #     nhà cung cấp từ chối `required` khi bật thinking (400).
                        empty_retry = {'reset': True}
                        if (config['route'] or {}).get('thinkingLevel'):
                            empty_how = 'plain-text'
                            retry_messages = request_messages + [{'role': 'user', 'content': EMPTY_ANSWER_INSTRUCTION}]
                            retry_tools, retry_route = [], config['route']
                        else:
                            empty_how = 'tool-choice-required'
                            retry_messages, retry_tools = request_messages, tools
                            retry_route = {**config['route'], 'tool_choice': 'required'}
                        _reset_stream()
                        response = await self.client.complete(retry_messages, retry_tools, retry_route,
                                                              on_thought=handle_thought,
                                                              on_content=handle_content,
                                                              max_tokens=config.get('maxTokens') or 4096)
                        reading = usage_reading(response.get('usage'), len(messages))
                        if reading:
                            self.last_usage[sid] = reading
                        choice = response['choices'][0]
                        message = choice['message']
                        text, calls = message.get('content') or '', message.get('tool_calls') or []
                        thought = message.get('reasoning_content') or message.get('thought') or choice.get('reasoning_content') or ''
                        empty_retry.update({'attempt': 1, 'how': empty_how,
                                            'code': 'TURN_EMPTY_RESPONSE_RETRY',
                                            'message': (f'TURN_EMPTY_RESPONSE_RETRY: the model returned '
                                                        f'nothing twice; retried once with {empty_how}')})
                        self.store.emit(sid, 'notice', empty_retry)
                        system_log.write('turn.retry', level='warn', session_id=sid, turn_id=steps_used,
                                         reason='empty_response', how=empty_how)
                        if not calls and (choice.get('finish_reason') not in {'stop', 'end_turn'} or not text.strip()):
                            raise ValueError('Model did not produce a complete non-empty final response')
                    # B3 chặng 1 — text trả về NGAY TRONG cửa sổ giữ chỗ là câu chốt bốn phần:
                    # model đã được yêu cầu chẩn đoán và đã trả lời, nên lượt đóng là `partial`
                    # kèm notice, y như chặng 2. Ngắn hơn `DIAGNOSIS_MIN_CHARS` thì không tính là
                    # chẩn đoán — đó chỉ là một câu trả lời bình thường.
                    if not calls and not truncated_partial and step >= wrap_up_at and self.diagnosis_ok(text):
                        return finish_partial(text, STEP_BUDGET_NOTICE_CODE)
                    # D2 — cổng đo độ dài của câu trả lời CUỐI (chỉ khi lượt này đã có câu trả lời).
                    answer_partial = False
                    if not calls and not truncated_partial:
                        text, answer_partial = self.enforce_answer_length(sid, text)
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
                        # C2: `truncated_partial` chỉ bật khi lần thử lại thứ hai vẫn bị nhà cung
                        # cấp cắt ở trần output. Hàng `sessions` vẫn `completed` (giữ nguyên từ
                        # vựng trạng thái cũ), nhưng ranh giới lượt nói thẳng là `partial` và
                        # `delegate` đọc notice bền của phiên con để trả `partial` cho cha.
                        partial = truncated_partial or answer_partial
                        close_turn('partial' if partial else 'completed', choice.get('finish_reason'), 0,
                                   response.get('usage'), extra={'partial': True} if partial else None)
                        self.store.save(sid, messages, 'completed')
                        self.store.emit(sid, 'finish', {'status': 'completed'})
                        elapsed_ms = (time.time() - started) * 1000
                        system_log.write('turn.end', session_id=sid, status='completed', steps=steps_used,
                                         textChars=len(text or ''), partial=partial,
                                         stepsUsed=steps_used, toolsRun=tools_run,
                                         deadlineUsedMs=elapsed_ms,
                                         durationMs=elapsed_ms)
                        return text
                    if len(calls) > 16:
                        raise ValueError('Tool-call batch exceeds limit')
                    for call in calls:
                        fn = call['function']
                        args, error = _parse_tool_arguments(fn.get('arguments'))
                        name = fn.get('name', '')
                        self.store.emit(sid, 'tool_start', {'id': call['id'], 'name': name, 'args': args})
                        tools_run += 1
                        tool_started = time.time()
                        try:
                            if error:
                                raise ValueError(error)
                            if name not in config['tools']:
                                raise PermissionError('Tool not permitted for this role: ' + name)
                            result = await self.dispatch(session, name, args, call['id'])
                        except Exception as exc:
                            code, message = classify_failure(exc)
                            # The model gets `message` (it may name the query or the URL); the DEV
                            # log gets the log-safe variant, so "Copy diagnostics" cannot carry a
                            # user query or a fetched URL off the machine.
                            _, log_message, log_detail = log_safe_failure(exc)
                            system_log.write('tool.error', level='error', session_id=sid, turn_id=steps_used,
                                             step=step + 1, tool=name, errorCode=code, message=log_message,
                                             durationMs=(time.time() - tool_started) * 1000, detail=log_detail)
                            result = {'is_error': True, 'error': message, 'errorCode': code}
                        system_log.write('tool.end', session_id=sid, turn_id=steps_used, step=step + 1, tool=name,
                                         isError=bool(result.get('is_error')),
                                         durationMs=(time.time() - tool_started) * 1000)
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
                    # N6 — đóng bước SAU khi mọi kết quả tool đã vào transcript, nên
                    # `contextEstimate` của `turn_end` là ngữ cảnh mà bước kế tiếp thật sự gửi đi.
                    # B3 — ở bước CUỐI của trần bước, cặp `turn_start`/`turn_end` được để MỞ: đường
                    # chốt sau vòng lặp sẽ đóng nó bằng `status='partial'` sau khi chẩn đoán xong
                    # (không có chẩn đoán thì nhánh `error` đóng). Đóng ở đây là nói sai ranh giới
                    # của lượt — đúng thứ giao diện đọc.
                    if step + 1 < config['maxSteps']:
                        close_turn('tool_calls', choice.get('finish_reason'), len(calls), response.get('usage'))
                # C1 — hết ngân sách bước. Ghi ĐÚNG MỘT bản ghi bền nói rằng việc có thể đã xong
                # trên đĩa còn lượt thì bị trần bước cắt (lượt chạy sống 2026-09-21: plan 9 155 B,
                # 4 tệp sửa, `300 passed`, lượt vẫn `failed` mà không hàng nào nói vì sao). Hàng
                # `events` kind `blocker` là bản bền cho UI; `_journal_blocker` ghim cùng sự việc
                # vào bảng `journal` (nhật ký phiên) và trả về số thứ tự của hàng đó để event nối
                # được sang nhật ký. Trạng thái phiên KHÔNG đổi vì việc này — vẫn `failed`.
                blocker = self.blocker_record(sid, config)
                journal_seq = _journal_blocker(self.store, sid, blocker, step=steps_used)
                if journal_seq is not None:
                    blocker['journalSeq'] = journal_seq
                self.store.emit(sid, 'blocker', blocker)
                # B3 — trước khi tuyên bố thất bại, xin MỘT lượt chốt có trần: đọc lại trạng thái,
                # sửa một lần nếu đường cũ sai, rồi trả bốn phần chẩn đoán. Đo sống vòng 21: lượt
                # chạm trần bước đã xong việc trên đĩa (plan 9 155 B, 4 tệp sửa, `300 passed`) mà
                # vẫn kết thúc `failed` trắng. Chỉ khi lượt chốt KHÔNG trả được gì mới rơi về lỗi.
                diagnosis, _ = await self.wrap_up_diagnosis(sid, messages, config, budget,
                                                            STEP_BUDGET_NOTICE_CODE)
                if self.diagnosis_ok(diagnosis):
                    return finish_partial(diagnosis, STEP_BUDGET_NOTICE_CODE)
                raise ValueError(f'{STEP_BUDGET_NOTICE_CODE}: iteration budget reached; work may be incomplete')
        except asyncio.CancelledError:
            close_turn('cancelled')
            self.store.save(sid, messages, 'cancelled')
            self.store.emit(sid, 'finish', {'status': 'cancelled'})
            elapsed_ms = (time.time() - started) * 1000
            system_log.write('turn.end', session_id=sid, status='cancelled', steps=steps_used,
                             stepsUsed=steps_used, toolsRun=tools_run, deadlineUsedMs=elapsed_ms,
                             durationMs=elapsed_ms)
            raise
        except Exception as exc:
            code, error = classify_failure(exc)
            if code == DEADLINE_NOTICE_CODE and not self.partial_turn(sid):
                # B4 — hết hạn chót cũng đi ĐÚNG đường chẩn đoán của B3, chỉ khác cửa sổ: hạn chót
                # của lượt đã tiêu hết nên `budget=None` (cửa sổ chốt vẫn bị chặn ở 30 s), và pha
                # đọc cho phép `WRAP_UP_READ_TOOL_CALLS` lời gọi công cụ ĐỌC để model thấy lại
                # đúng trạng thái trước khi nói. Chẩn đoán chạy TRƯỚC `close_turn` để cặp
                # `turn_start`/`turn_end` đóng đúng một lần với `status='partial'`.
                diagnosis, read_calls = await self.wrap_up_diagnosis(sid, messages, config, None,
                                                                     DEADLINE_NOTICE_CODE,
                                                                     out_of_time=True)
                if self.diagnosis_ok(diagnosis):
                    return finish_partial(diagnosis, DEADLINE_NOTICE_CODE, read_tool_calls=read_calls)
            close_turn('error')
            retries = getattr(exc, 'retry_attempts', 0)
            if retries:
                error = (f'{error} [after {retries} {self.retry_noun(retries)} in '
                         f'{getattr(exc, "retry_waited_seconds", 0.0):.1f}s]')
            self.store.save(sid, messages, 'failed')
            self.store.emit(sid, 'error', {'message': error, 'code': code})
            elapsed_ms = (time.time() - started) * 1000
            system_log.write('turn.failed', level='error', session_id=sid, turn_id=steps_used, status='failed',
                             errorCode=code, message=error, steps=steps_used,
                             stepsUsed=steps_used, toolsRun=tools_run, deadlineUsedMs=elapsed_ms,
                             durationMs=elapsed_ms, detail=failure_detail(exc))
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
            return self.session_search(sid, args)
        if name == 'delegate_task':
            return await self.delegate(session, args)
        if name in {'web_search', 'web_fetch'}:
            return await self.web.run(name, args, sid)
        if name == 'browser_use' and session['role'] == 'research' and args.get('action') not in {'navigate', 'snapshot', 'screenshot'}:
            raise PermissionError('Research browser access is read-only navigation/snapshot')
        if name == 'write_plan':
            return await self.write_plan(session, args)
        if name == 'journal_write':
            return await self.journal_write(sid, args)
        if name == 'journal_brief':
            return self.journal_brief(sid, args)
        if name in {'file_write', 'file_edit_block', 'terminal_exec'}:
            async with self.writer_lock:
                return await self.executor.execute(name, args, sid)
        return await self.executor.execute(name, args, sid)

    JOURNAL_ROUTE_LIMIT = 200

    def journal_degraded(self, sid):
        """True khi tầng file của nhật ký đã hỏng ít nhất một lần trong phiên này.

        Sự thật bền duy nhất là `events` (một `notice` với mã `JOURNAL_DEGRADED` /
        `CHECKPOINT_FILE_FAILED`), vì tầng file chính là chỗ có thể im lặng hỏng. Route đọc cờ này
        thay vì suy đoán từ sự tồn tại của file — "có file" không có nghĩa là mọi lần ghi đều đã tới.
        """
        row = self.store.db.execute(
            "SELECT COUNT(*) AS total FROM events WHERE session_id=? AND kind='notice' "
            "AND (payload LIKE ? OR payload LIKE ?)",
            (sid, f'%{session_journal.JOURNAL_FAILED_CODE}%', f'%{session_journal.CHECKPOINT_FAILED_CODE}%')
        ).fetchone()
        return bool(row is not None and row['total'])

    def journal_records(self, sid, after=None, kind=None, limit=50):
        """A9 — lô bản ghi nhật ký cho `GET /api/agent/sessions/{sid}/journal`.

        `nextSeq` là con trỏ cho lần hỏi tiếp (`after=`), `more` nói còn bản ghi nữa; hàng SQLite là
        nguồn, tầng file trong box chỉ là bản người đọc được (đợt này không vẽ gì ở UI).
        """
        self.store.get(sid)
        size = max(1, min(self.JOURNAL_ROUTE_LIMIT, int(limit or 50)))
        sql = 'SELECT * FROM journal WHERE session_id=?'
        parameters = [sid]
        if after is not None:
            sql += ' AND seq>?'
            parameters.append(int(after))
        if kind:
            sql += ' AND kind=?'
            parameters.append(str(kind))
        sql += ' ORDER BY seq LIMIT ?'
        parameters.append(size + 1)  # +1 để biết còn bản ghi nữa mà không đếm thêm một lượt
        rows = self.store.db.execute(sql, parameters).fetchall()
        records = [dict(session_journal.record_view(dict(row)), seq=row['seq'],
                        created=row['created'], kind=row['kind']) for row in rows[:size]]
        return {'records': records,
                'nextSeq': records[-1]['seq'] if records else int(after or 0),
                'more': len(rows) > size,
                'degraded': self.journal_degraded(sid)}

    def journal_tasks(self, status=None, limit=50):
        """A9 — `GET /api/agent/journal/tasks`: task nào thuộc phiên nào, trạng thái gì.

        Đây là bản chiếu qua MỌI phiên của bảng `journal` (không phải `INDEX.json`): đường route
        không phụ thuộc box đang chạy, nên vẫn trả lời được khi box tắt.
        """
        size = max(1, min(self.JOURNAL_ROUTE_LIMIT, int(limit or 50)))
        # Lọc trạng thái ở Python, không bằng `payload LIKE`: payload là JSON do `json.dumps` sinh
        # (có/không có dấu cách tuỳ chỗ ghi), nên một mẫu chuỗi sẽ lọc trượt trong im lặng. Đọc dư
        # rồi cắt — trần đọc là 200 hàng, đủ cho màn hình tổng hợp.
        tasks = []
        for row in self.store.db.execute(
                "SELECT * FROM journal WHERE kind='task' ORDER BY seq DESC LIMIT ?",
                (self.JOURNAL_ROUTE_LIMIT,)):
            item = dict(row)
            record = session_journal.record_view(item)
            if status and record['status'] != status:
                continue
            tasks.append({'id': record['id'], 'session': item['session_id'], 'sid8': str(item['session_id'])[:8],
                          'kind': 'task', 'status': record['status'], 'text': record['text'],
                          'created': item['created'], 'ts': record['ts'], 'refs': record.get('refs'),
                          'evidence': record.get('evidence')})
            if len(tasks) >= size:
                break
        return {'tasks': tasks}

    def session_search(self, sid, args):
        """A6 — tra lịch sử bền của phiên: **mọi** checkpoint + nhật ký + `events`, không chỉ 20 hàng mới.

        Bản cũ chỉ đọc `LIMIT 20` checkpoint mới nhất, nên một từ chỉ có trong lần nén thứ 25 là
        **không tìm thấy** — trong khi đó lại đúng là chỗ duy nhất còn giữ transcript trước nén
        (đo sống 2026-09-21: 22 hàng `checkpoints` / 17 967 616 B trên 12 phiên, lớn nhất 3,1 MB).
        Ba nguồn gộp lại, sắp theo thời gian, và nói thẳng khi phải cắt bớt:
        `truncated` = có kết quả bị bỏ; `messages` giữ nguyên hình dạng cũ nên chỗ đọc cũ không đổi.
        """
        query = str((args or {}).get('query') or '').strip().casefold()
        if not query:
            raise ValueError('SESSION_SEARCH_EMPTY: query is required')
        limit = int((args or {}).get('limit') or 10)
        limit = max(1, min(50, limit))  # trần 50: kết quả tra là bản trích, không phải transcript
        ceiling = max(limit * 10, 200)  # gom rộng rồi mới cắt — cắt lúc đang gom là cắt SAI đầu
        hits, matched = [], 0

        def add(ts, kind, text, ident=None, role=None, rank=0, order=0, **extra):
            nonlocal matched
            if query in str(text or '').casefold():
                matched += 1
                if len(hits) < ceiling:
                    hits.append({'ts': ts, 'kind': kind, 'id': ident, 'role': role,
                                 'text': str(text or '')[:2000], **extra,
                                 # Khoá sắp xếp đầy đủ: ba nguồn được đọc theo ba khối, mà ba lần nén
                                 # trong cùng một mili-giây là chuyện thường — chỉ so `ts` thì thứ tự
                                 # "mới nhất" thành ra tuỳ thứ tự đọc. `rank` xếp khối, `order` xếp
                                 # trong khối (số hàng tăng dần, độc lập nhau nên không so ngang).
                                 '_key': (float(ts or 0), rank, order)})

        for row in self.store.db.execute(
                'SELECT id, created, messages, reason FROM checkpoints WHERE session_id=? ORDER BY id', (sid,)):
            try:
                stored = json.loads(row['messages'])
            except (TypeError, ValueError):
                continue
            # KHÔNG bịa mã bản ghi cho kết quả từ bảng `checkpoints`: cột `id` của bảng này là một
            # bộ đếm khác với số file `ck-<sid8>-NNN` (và khác cả hàng `journal`) — một mã
            # `C:<sid8>-<n>` ở đây trỏ vào **không** bản ghi nào. Thay bằng hai trường nói đúng
            # nguồn: `checkpointId` (hàng SQLite) và `source`.
            for message in stored:
                if message.get('role') == 'system':
                    continue  # system message là chỉ dẫn, không phải lịch sử người dùng
                add(row['created'], f"checkpoint:{row['reason']}", message.get('content'), None,
                    message.get('role'), rank=0, order=row['id'],
                    checkpointId=row['id'], source='checkpoint')
        journal_cap = 500
        journal_rows = self.store.journal_tail(sid, limit=journal_cap)
        capped = ['journal'] if len(journal_rows) >= journal_cap else []
        for row in journal_rows:
            record = (row.get('payload') or {}).get('record') or {}
            add(row.get('created'), 'journal:' + str(row.get('kind')),
                record.get('text') or row.get('text'), record.get('id'), record.get('actor'),
                rank=1, order=row.get('seq') or 0, source='journal')
        for row in self.store.db.execute(
                "SELECT seq, created, payload FROM events WHERE session_id=? ORDER BY seq", (sid,)):
            add(row['created'], 'event', row['payload'], rank=2, order=row['seq'])

        hits.sort(key=lambda item: item['_key'])
        newest = hits[-limit:]
        for item in newest:
            item.pop('_key', None)
        dropped = matched - len(newest)
        return {'hits': newest,
                # Nguồn bị đọc tới trần (`capped`) cũng là một dạng cắt bớt: nói ra cùng chỗ với
                # `dropped`, nếu không thì "chỉ có 500 bản ghi đầu" bị đọc thành "chỉ có 500 bản ghi".
                'capped': capped,
                # Hình dạng cũ của `messages` (danh sách tin nhắn) vẫn đọc được: chỗ đọc cũ chỉ lấy
                # `content`, nên giữ nguyên nó thay vì đổi sang khuôn `hit` mới.
                'messages': [{'role': item['role'], 'content': item['text']} for item in newest],
                'truncated': bool(dropped) or bool(capped), 'dropped': dropped}

    def pending_for(self, sid):
        """Unresolved decisions of one session, in request order."""
        return [record for record in self.pending.values() if record['sessionId'] == sid and not record['resolved']]

    async def decision(self, session, name, args, call_id=None):
        """ask_user / request_approval: emit decision_requested, block, return the honest outcome."""
        sid = session['id']
        # A delegated child runs inside the parent's turn and has no chat of its own (only root
        # sessions are listed), so a question asked there could never be shown or answered.
        if session.get('parent_id'):
            raise ValueError('DECISION_UNAVAILABLE: a delegated session cannot ask the user; '
                             'decide from your own evidence')
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
        # §4.1: một lượt xin duyệt kế hoạch mang theo `planIdentity`/`planVersion` thì quyết định của
        # người dùng vào thẳng sổ duyệt — cùng hai khoá mà `plan_registry.pending_submissions` đọc.
        plan_id, plan_version = (None, None)
        if kind == 'approval':
            plan_id, plan_version = plan_approval_target(args, name)
        options = normalize_decision_options(args.get('options'), kind)
        decision_id = uuid.uuid4().hex[:16]
        record = {'decisionId': decision_id, 'sessionId': sid, 'kind': kind, 'options': options,
                  'deadline': decision_deadline(args, name), 'defaultChoice': 'reject',
                  'toolCallId': call_id, 'resolved': False, 'outcome': None,
                  'future': asyncio.get_running_loop().create_future()}
        if plan_id:
            record['planIdentity'] = plan_id
            record['planVersion'] = plan_version
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
            if self.settle(record, record['defaultChoice'], 'expired', 'timeout', None):
                # A7: hết hạn là một cách chốt — nhật ký phải ghi cùng một khuôn như người bấm.
                await self.pin_decision(record['sessionId'], record['outcome'])
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
        # §4.1: quyết định về một kế hoạch vào sổ duyệt TRƯỚC `decision_resolved`, để ai đọc sổ ngay
        # sau sự kiện đó cũng thấy đúng trạng thái. Ghi hỏng không được làm hỏng lượt trả lời.
        self.record_plan_decision(record, status, note)
        self.store.emit(record['sessionId'], 'decision_resolved', {
            'decisionId': record['decisionId'], 'choice': choice, 'status': status, 'note': note,
            'reason': reason, 'resolvedAt': round(time.time(), 3)})
        if not record['future'].done():
            record['future'].set_result(record['outcome'])
        if reason != 'session_cancelled':
            self.resume(record['sessionId'])
        return True

    def record_plan_decision(self, record, status, note):
        """Duyệt kế hoạch trong chat vào sổ thật (§4.1): `request_approval` khai `planIdentity`/`planVersion`.

        Chỉ ghi khi record mang **đủ** hai khoá — một lượt xin phép cũ (không nói tới kế hoạch nào)
        không được sinh một hàng duyệt giả. `approved` chỉ khi người dùng thật sự đồng ý; mọi kết cục
        khác (từ chối, hết hạn, huỷ phiên) đều là "chưa đồng ý", tức `changes_requested` của luật R1 —
        và đó cũng là điều kiện để bản sửa bắt buộc phải khai cha.

        Cột `source` là `'approval'` để phân biệt với `'plan-tab'`: hai đường vào cùng một sổ, không
        đường nào ghi đè đường kia một cách âm thầm.
        """
        identity = str(record.get('planIdentity') or '').strip().strip('/')
        version = record.get('planVersion')
        if not identity or isinstance(version, bool) or not isinstance(version, int) or version < 1:
            return None
        decision = 'approved' if status == 'approved' else 'changes_requested'
        try:
            return self.store.record_plan_review(identity, version, decision, note=(note or ''),
                                                 source='approval', session_id=record['sessionId'])
        except Exception as exc:  # pragma: no cover - sổ duyệt không bao giờ được giết một quyết định
            system_log.write('plan.review.store_failed', level='warn', code='PLAN_REVIEW_STORE_FAILED',
                             message=f'không ghi được sổ duyệt cho {identity} v{version}: {exc}',
                             session_id=record['sessionId'], identity=identity, version=version,
                             decision=decision)
            return None

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

    async def plan_registration_for(self, session, slug, args, declared):
        """B2 — chọn identity/version/parent từ chỉ mục box TRƯỚC khi ghi (§3.2–§3.4 + R1/R3).

        Sổ duyệt và các lượt xin duyệt đang treo được nạp sẵn cho **mọi** identity trong chỉ mục:
        `group_state` cần chúng để biết nhóm đang `changes_requested` (R3) hay đã `approved` (R2),
        còn tra theo từng identity ngay lúc đó thì không được (hàm thuần, một lượt, không I/O).

        `RegistrationPlan.degraded` = không đọc được chỉ mục box. Chỗ gọi quay về hành vi cũ
        (sandbox tự chọn số, không header) và `read_plan_index` đã ghi `PLAN_INDEX_UNAVAILABLE`
        vào nhật ký hệ thống: thà mất tính năng còn hơn bịa số version.
        """
        index = await plan_registry.read_plan_index(self.executor)
        reviews, submitted = {}, {}
        if index is not None:
            pending = list(getattr(self, 'pending', {}).values())
            for group in index.groups:
                reviews[group.identity] = self.store.plan_reviews_for(group.identity)
                submitted[group.identity] = plan_registry.pending_submissions(pending, group.identity)
        # Chỉ khối header đọc ra `ok` mới được coi là lời khai: một khối sai cú pháp không phải
        # một con số để so, và P1 của bản chấm sẽ nói đúng điều đó thay vì đoán ý model.
        ok_header = declared is not None and getattr(declared, 'status', '') == 'ok'
        # D-3: vé mơ hồ của CHÍNH phiên này cho ĐÚNG slug đề nghị. Chỉ đọc `kind='fact'`: một hàng
        # `P:` là kế hoạch đã có thật, còn vé thì cố ý không mang `relativePath`. Vé chỉ sống trong
        # phiên bị từ chối — phiên mới thì luật cũ áp dụng, không có gì để đọc.
        ticket = plan_registry.ticket_from_rows(
            self.store.journal_tail(session['id'], kinds=['fact']),
            slug=slug, directory=str(args.get('directory') or ''))
        return plan_registry.plan_registration(
            slug, index=index, reviews_by_identity=reviews, submitted_by_identity=submitted,
            declared_identity=args.get('identity'), relates_to=args.get('relatesTo'),
            declared_version=declared.version if ok_header else plan_registry.UNSET,
            declared_parent=declared.parent if ok_header else plan_registry.UNSET,
            ambiguity_ticket=ticket)

    async def write_plan(self, session, args):
        """write_plan: harness chọn identity/version/parent, chấm P1–P8, rồi mới ghi (đợt 20 §3–§5).

        Bốn bước, theo đúng thứ tự — mỗi bước có đường lui riêng:

        1. `check_plan_quality` (P3) chạy trước tiên, nguyên luật và nguyên câu của bản cũ.
        2. `plan_registry.plan_registration` chọn identity/version/parent. Chỉ mục box chết →
           nhánh suy giảm: sandbox tự chọn số, không header, không chấm điểm (bản chấm cần số của
           nhóm, mà số đó vừa không biết được — điền số sau khi ghi là bịa).
        3. `plan_eval` chấm 8 chiều, lưu `plan_evaluations` **kể cả** bản bị từ chối
           (`written: false` — bằng chứng vì sao không có file nào xuất hiện), phát `plan_evaluated`
           đúng **một** lần cho mỗi bản. Cổng cứng trượt ⇒ dừng ở đây, sandbox không chạm đĩa.
        4. Ghi qua sandbox với `version`/`directory` tường minh: box không tự tăng số nữa, nên
           tên file trùng (`PLAN_VERSION_TAKEN`) được thử lại **một** lần với chỉ mục vừa đọc lại.
        """
        sid = session['id']
        slug = plan_slug(args.get('slug'))
        markdown = args.get('markdown')
        if not isinstance(markdown, str) or not markdown.strip():
            raise ValueError('PLAN_INVALID: markdown must be a non-empty string')
        if len(markdown.encode('utf-8')) > PLAN_MAX_BYTES:
            raise ValueError('PLAN_INVALID: the plan exceeds the 1 MiB plan-file limit')
        # Structural gate BEFORE the sandbox writer runs: a rejected plan leaves no file behind and the model
        # gets one actionable line naming what is missing (plan_quality.py owns the rules).
        # Cổng P3 của thang P1–P8 **cố ý** đứng sau cổng này (cùng luật, cùng câu, mã cũ
        # `PLAN_QUALITY_REJECTED`), nên một kế hoạch hỏng cấu trúc không sinh `plan_evaluated` và không có
        # hàng `plan_evaluations`: chặn trước khi tốn một lượt ghi đĩa là hành vi mong muốn. Vì vậy nhánh
        # P3-0 trong `plan_eval` là lưới an toàn cho `write_plan` gọi từ nơi khác, không phải đường sống.
        check_plan_quality(markdown)
        title = plan_title(args.get('title'), markdown, slug)
        declared = plan_header.parse_plan_header(markdown)
        try:
            registration = await self.plan_registration_for(session, slug, args, declared)
        except plan_registry.PlanRegistrationError as exc:
            # "Log nhật ký hệ thống cho mọi lần từ chối" (§B4): một dòng cho mỗi lần luật §3.2–§4.3
            # chặn, kèm mã máy đọc được — câu trả cho model là một dòng, nhưng DEV cần con số.
            system_log.write('plan.registration.rejected', level='warn', code=exc.code,
                             message=exc.message, session_id=sid, slug=slug,
                             identity=exc.fields.get('identity'), fields=exc.fields)
            ticket = exc.fields.get('ambiguity_ticket')
            if isinstance(ticket, dict):
                # D-3: lời từ chối để lại một VÉ trên hàng dữ kiện (`F:`) — cố ý KHÔNG phải `P:`:
                # bản bị từ chối không có tệp nào để giữ, nên vé không được lọt vào cổng xoá `P:`
                # của `migrate_plans.py --delete-orphan`. Câu dưới là đường duy nhất nói cho model
                # biết nó được gửi lại nguyên văn (khối ký ức `brief()` chỉ có sáu nhóm, không có
                # nhóm `fact` — xem bàn giao C4).
                await session_journal.append(
                    self.executor, self.store, sid, 'fact',
                    f"PLAN_IDENTITY_AMBIGUOUS: slug «{slug}» giống "
                    f"{float(ticket.get('score') or 0):.0%} nhóm «{ticket.get('matchedIdentity') or ''}» "
                    'nên harness không tự đoán; gửi lại NGUYÊN VĂN để nhận là kế hoạch mới '
                    '(vé dùng được đúng một lần).',
                    data={plan_registry.AMBIGUITY_TICKET_KEY: ticket}, status='info')
            raise
        for note in registration.notes:
            # `PLAN_IDENTITY_FORCED_NEW`: model khai `relatesTo: "none"` ở dải j ≥ 0.75 nên harness
            # vẫn ghi thành identity mới — chủ dự án thấy việc này trong nhật ký hệ thống.
            system_log.write('plan.identity.forced_new', level='warn',
                             code=plan_registry.IDENTITY_FORCED_NEW_CODE, message=note,
                             session_id=sid, identity=registration.identity, slug=slug)
        write_args, evaluation = self.plan_write_args(markdown, slug, title, registration)
        if evaluation is not None and evaluation.rejected is not None:
            self.emit_plan_rejection(sid, registration, evaluation)
        async with self.writer_lock:
            written = await self.executor.execute('write_plan', write_args, sid)
            if self.version_taken(written) and not registration.degraded:
                # Đua ghi hiếm gặp: chỉ mục vừa cũ đi giữa hai bước. Đọc lại đúng MỘT lần rồi ghi lại;
                # vẫn kẹt thì thôi — `PLAN_WRITE_CONFLICT` để lần ghi sau tự chọn lại số.
                registration = await self.plan_registration_for(session, slug, args, declared)
                if registration.degraded:
                    raise ValueError('PLAN_WRITE_CONFLICT: the box index became unreadable and the '
                                     'version is already taken; nothing was recorded')
                write_args, evaluation = self.plan_write_args(markdown, slug, title, registration)
                if evaluation is not None and evaluation.rejected is not None:
                    self.emit_plan_rejection(sid, registration, evaluation)
                written = await self.executor.execute('write_plan', write_args, sid)
                if self.version_taken(written):
                    raise ValueError('PLAN_WRITE_CONFLICT: two writers picked the same version; '
                                     'nothing was recorded')
        confirmed = PLAN_PATH_RE.fullmatch(str(written.get('relativePath') or ''))
        version = written.get('version')
        if not confirmed or isinstance(version, bool) or not isinstance(version, int) \
                or int(confirmed.group('version')) != version:
            # Lỗi của box nói rõ chuyện gì đã xảy ra (`is_error` + `error`); nuốt nó vào câu
            # "không xác nhận được tệp" sẽ giấu mất nguyên nhân thật.
            if isinstance(written, dict) and written.get('is_error'):
                raise ValueError('PLAN_WRITE_FAILED: the sandbox refused the write: '
                                 + str(written.get('error') or '')[:300])
            raise ValueError('PLAN_WRITE_FAILED: the sandbox did not confirm a plan file; nothing was recorded')
        # Never report a plan the sandbox does not have: identity comes from the confirmed path and must be
        # what the plan reader groups by (contract §1 + plan_files.py:315-321), i.e. bare `slug` / `dir/slug`.
        identity = plan_identity(written['relativePath'])
        payload = {'identity': identity, 'version': version, 'slug': confirmed.group('slug'),
                   'relativePath': written['relativePath'], 'title': str(written.get('title') or title)[:120],
                   'bytes': int(written.get('bytes') or len(markdown.encode('utf-8')))}
        if not registration.degraded:
            # Hai trường hợp đồng bằng: ở nhánh suy giảm không có bản chấm, nên `parentVersion` và
            # `headerSource` KHÔNG được bịa — chỉ ghi khi harness thật sự đã quyết hai giá trị đó.
            payload['parentVersion'] = registration.parent
            payload['headerSource'] = 'model' if (evaluation is not None
                                                 and evaluation.measures.get('headerSource') == 'model') \
                else 'synthesized'
            payload['identityMatchedBy'] = registration.matched_by
            payload['identityForcedNew'] = bool(registration.forced_new)
            payload['state'] = registration.state
            if registration.ambiguity:
                # D-3: bản này ra đời từ dải mơ hồ (đi qua vé) — hàng `P:` phải nói được điều đó.
                payload['identityAmbiguity'] = registration.ambiguity
        self.store.emit(sid, 'plan_written', payload)
        if evaluation is not None:
            self.record_plan_evaluation(registration, evaluation.to_payload(written=True))
            self.store.emit(sid, 'plan_evaluated', evaluation.to_payload(written=True))
        self.store.emit(sid, 'ui_intent', {'tab': 'plan', 'target': {'identity': identity, 'version': version},
                                           'reason': 'plan_written'})
        await self.pin_plan(sid, payload)
        answer = {'content': 'Plan written to ' + payload['relativePath'], 'version': version,
                  'relativePath': payload['relativePath'], 'slug': payload['slug'], 'title': payload['title'],
                  'bytes': payload['bytes']}
        if evaluation is not None:
            # Một dòng cho model biết điểm, để nó tự sửa ở lần ghi sau thay vì đoán vì sao bị từ chối.
            answer['rubric'] = evaluation.to_payload(written=True)
        return answer

    def plan_write_args(self, markdown, slug, title, registration):
        """Dựng tham số cho op `write_plan` của box + bản chấm P1–P8 tương ứng (hoặc `None`).

        Nhánh suy giảm (không đọc được chỉ mục) giữ **nguyên** markdown và để box tự chọn số: đó
        đúng là hành vi trước vòng 20, và cũng là lý do không có bản chấm ở nhánh này — hợp đồng
        `plan_evaluations` buộc mỗi hàng phải có `version` của nhóm, mà số đó lúc này chưa biết.

        Nhánh thường ghép khối header do **harness** viết lên đầu markdown (`plan_header`), rồi
        gửi `directory` + `version` tường minh: box không tự tăng số nữa.
        """
        args = {'slug': registration.slug or slug, 'title': title}
        if registration.degraded:
            args['markdown'] = markdown
            return args, None
        args.update({'directory': registration.directory, 'version': registration.version,
                     'markdown': plan_header.build_plan_header(
                         registration.version, registration.identity, registration.parent,
                         registration.declared_slug) + markdown})
        return args, self.evaluate_plan(markdown, registration)

    @staticmethod
    def version_taken(answer):
        """Box báo tên file đã tồn tại? Worker không ném lỗi — nó trả `{'is_error': True, 'error': …}`."""
        if not isinstance(answer, dict):
            return False
        return 'PLAN_VERSION_TAKEN' in str(answer.get('error') or '') or \
            'PLAN_VERSION_TAKEN' in str(answer.get('code') or '')

    def emit_plan_rejection(self, sid, registration, evaluation):
        """Lưu + phát bản chấm của một lần ghi **bị cổng cứng chặn**, rồi mới raise câu từ chối.

        Hai việc này đi cùng nhau và luôn theo thứ tự này: hàng `plan_evaluations` với
        `written: false` là bằng chứng vì sao `.plans/` không có file nào mới, còn `plan_evaluated`
        là thứ tab Plan đọc để hiện lý do. Raise sau cùng để sandbox không chạm đĩa.
        """
        payload = evaluation.to_payload(written=False)
        self.record_plan_evaluation(registration, payload)
        self.store.emit(sid, 'plan_evaluated', payload)
        plan_eval.raise_if_rejected(evaluation)

    def evaluate_plan(self, markdown, registration):
        """B3/B4 — chấm P1–P8 cho một lần ghi, theo đúng thứ tự con trỏ của §5.

        `markdown` là **bản model viết** (chưa ghép header của harness): P1 phải nhìn thấy khối
        header mà model tự khai, còn P2 cần ghi chú mới nhất của người dùng khi nhóm đang chờ sửa.
        """
        return plan_eval.evaluate_plan(
            markdown, identity=registration.identity, version=registration.version,
            parent_version=registration.parent, state=registration.state,
            matched_by=registration.matched_by, forced_new=registration.forced_new,
            review_note=self.latest_review_note(registration.identity))

    def latest_review_note(self, identity):
        """Ghi chú mới nhất của lần "yêu cầu sửa" gần đây nhất cho `identity`, hoặc `''`.

        Chỉ để đo `noteKeywords`/`noteKeywordsEchoed` (P5/P8 đọc chúng như số đo, không đổi mức):
        điều kiện từ chối của R3 nằm ở `plan_registry`, không ở đây.
        """
        try:
            rows = self.store.plan_reviews_for(identity)
        except Exception:  # pragma: no cover - DB cũ chưa có bảng plan_reviews
            return ''
        for row in reversed(list(rows or ())):
            if row.get('decision') == 'changes_requested' and (row.get('note') or '').strip():
                return str(row['note']).strip()[:plan_registry.MAX_NOTE_CHARS]
        return ''

    def record_plan_evaluation(self, registration, payload):
        """Lưu kết quả chấm vào `plan_evaluations` — `written: true|false` là một phần của bản ghi.

        Bản ghi là **bản chấm mới nhất theo từng `(identity, version)`** (upsert, xem
        `SessionStore.record_plan_evaluation`): một lượt bị từ chối rồi viết lại cùng version sẽ để lại
        đúng một hàng, mang kết quả của lượt gần nhất. Đó là chủ ý — tab Plan hỏi "bản này đang thế nào",
        không hỏi lịch sử chấm; muốn lịch sử thì `events kind='plan_evaluated'` giữ đủ mọi lượt.
        """
        try:
            self.store.record_plan_evaluation(registration.identity, registration.version, payload,
                                              payload.get('total') or 0, payload.get('verdict') or 'fail')
        except Exception as exc:  # pragma: no cover - bảng điểm không bao giờ được làm hỏng lượt ghi
            system_log.write('plan.eval.store_failed', level='warn', code='PLAN_EVAL_STORE_FAILED',
                             message=f'{type(exc).__name__}: {exc}', identity=registration.identity,
                             version=registration.version)

    def open_task_refs(self, sid, limit=1):
        """Mã của (các) bản ghi `T:` còn mở của phiên — để một bản kế hoạch trỏ về việc nó phục vụ.

        Trả `[]` khi phiên chưa có bản ghi `task` nào (đường thường gặp trước khi agent gọi
        `journal_write`): `refs` là **tham chiếu**, không phải chỗ bịa mã, nên không có thì để trống.
        """
        try:
            rows = self.store.journal_tail(sid, limit=50, kinds=['task'])
        except Exception:  # pragma: no cover - DB cũ chưa có bảng journal
            return []
        open_rows = [row for row in rows if (row.get('payload') or {}).get('record', {}).get('status')
                     in {'open', 'doing'}]
        return [row['payload']['record']['id'] for row in open_rows[-limit:]
                if (row.get('payload') or {}).get('record', {}).get('id')]

    async def journal_write(self, sid, args):
        """A3 — công cụ `journal_write`: agent TỰ ghi một dòng ký ức, có kiểm tra trước khi ghi.

        Ba chốt, theo đúng kế hoạch Phần A:

        1. `journal.record` chạy TRƯỚC mọi thứ (kind hợp lệ, `text` ≤ 1000 ký tự, `refs`/`evidence`
           đúng khuôn) — nên một lời gọi sai bị từ chối bằng một dòng chỉ đúng chỗ sai, và không để
           lại hàng rác nào.
        2. Hàng SQLite là bản mà `brief()` đọc, nên nó được ghi **trước**; tầng file trong box chỉ là
           bản đọc thêm. Tầng file hỏng ⇒ vẫn có hàng, kèm `notice` `JOURNAL_DEGRADED` (do
           `session_journal.append` ghim) và `recorded: false` trong câu trả lời — không bao giờ nói
           "đã ghi ra file" khi chưa ghi.
        3. `docs/naming.md` ghim trật tự mã: `P:`/`D:` do harness tự ghim, còn `T:`/`S:`/`E:`/`F:`/`X:`
           là thứ agent tự viết. Phiên con không có công cụ này (cha ghi hộ bằng `X:` kèm refs).
        """
        kind = args.get('kind')
        text = args.get('text')
        if not isinstance(text, str) or not text.strip():
            raise ValueError('JOURNAL_INVALID: text must be a non-empty string')
        if kind in HARNESS_ONLY_JOURNAL_KINDS:
            # `plan` cần kết quả `write_plan` (`P:<identity>@v<n>`) và `checkpoint` là dấu vết của
            # một lần nén — cả hai do harness ghim. Để model tự viết thì nhật ký có mã giả, và
            # `kind='plan'` còn luôn hỏng vì thiếu tham số `plan` (schema cũ vẫn mời gọi nó).
            raise ValueError(f"JOURNAL_INVALID: kind={kind!r} is recorded by the harness, not by this "
                             f"tool; use one of {list(AGENT_JOURNAL_KINDS)}")
        if not isinstance(kind, str) or kind not in AGENT_JOURNAL_KINDS:
            raise ValueError(f"JOURNAL_INVALID: kind must be one of {list(AGENT_JOURNAL_KINDS)}")
        # `status`, `refs`, `evidence` đi THẲNG vào bộ kiểm của `journal.record` — một giá trị sai
        # kiểu bị từ chối ở đó, chứ ở đây không được phép lặng lẽ bỏ qua (đã suýt bỏ qua `refs` kiểu
        # chuỗi, tức là một lời gọi sai vẫn ghi được hàng).
        # `status` và `evidence` là trường CỦA BẢN GHI (không phải `data`): chúng vào thẳng
        # khuôn của `journal.record` để bộ kiểm ở đó từ chối giá trị lạ, và để `brief()` xếp
        # nhóm theo `status` đúng như thiết kế.
        written = await session_journal.append(
            self.executor, self.store, sid, kind, text.strip(),
            status=args.get('status'), evidence=args.get('evidence'), refs=args.get('refs'))
        # Mã lấy từ chính câu trả lời của `append` (`recordId`), KHÔNG mò lại hàng cuối: khi chèn
        # hỏng, hàng cuối là bản ghi của lượt trước — trả mã đó ra là nhận vơ một bản ghi khác.
        record_id = written.get('recordId') if isinstance(written, dict) else None
        recorded = bool(written and written.get('ok') is not False)
        if isinstance(written, dict) and written.get('rowMissing'):
            # Dòng đã vào file trong box, hàng SQLite thì không: khối ký ức (`brief`) không thấy
            # bản ghi này, nên `recorded` phải là false — và **không** trả mã nào, vì mã duy nhất
            # đang có trên đời là của bản ghi khác.
            return {'content': 'The box journal file kept this line, but the session journal row '
                               'could not be written, so journal_brief will not show it. Nothing '
                               'was lost from the turn; the line is in '
                               '.session-history/<sid8>/journal.jsonl.',
                    'id': None, 'kind': kind, 'recorded': False}
        if written is None:
            return {'content': f'Not recorded: the session journal row could not be written '
                               f'(see the JOURNAL_DEGRADED notice). Nothing was lost from the '
                               f'turn; try again later.',
                    'id': None, 'kind': kind, 'recorded': False}
        if not recorded and record_id:
            # Hàng đã có, chỉ tầng file thiếu: nói đúng phần thiếu thay vì trả lỗi trơ.
            return {'content': f'Recorded {record_id} in the session journal (the box file layer did not '
                               f'answer; see the JOURNAL_DEGRADED notice).',
                    'id': record_id, 'kind': kind, 'recorded': False}
        return {'content': f'Recorded {record_id or kind} in the session journal.',
                'id': record_id, 'kind': kind, 'recorded': recorded,
                'brief': session_journal.brief(self.store, sid)}

    def journal_brief(self, sid, args):
        """A3 — công cụ `journal_brief`: khối ký ức của phiên, rỗng khi chưa có gì để nhớ."""
        limit = args.get('limit')
        try:
            limit = max(1, min(200, int(limit))) if limit is not None else 60
        except (TypeError, ValueError):
            limit = 60
        block = session_journal.brief(self.store, sid, limit=limit)
        return {'content': block or 'The session journal is empty — nothing recorded yet.',
                'empty': not block}

    async def pin_plan(self, sid, payload):
        """A7 — ghim bản ghi `P:<identity>@v<version>` sau khi sandbox đã xác nhận đường dẫn.

        Vì sao mã của kế hoạch **không** theo phiên: cùng một slug ở hai phiên vẫn là cùng một bản
        kế hoạch, `@v<n>` mới phân biệt hai bản. Nhờ vậy hỏi "kế hoạch này ra đời ở phiên nào, đã
        duyệt chưa" trả lời được bằng cách tra nhật ký thay vì quét `.plans/` rồi đoán theo thời gian.
        """
        identity, version = payload.get('identity'), payload.get('version')
        if not identity or not isinstance(version, int) or isinstance(version, bool):
            return None  # không có gì để ghim: chỗ gọi đã kiểm đường dẫn, đây là chốt thứ hai
        pinned_data = {'identity': identity, 'version': version, 'slug': payload.get('slug'),
                       'relativePath': payload.get('relativePath'), 'title': payload.get('title')}
        if payload.get('identityAmbiguity'):
            # D-3: giữ dấu dải mơ hồ trên chính hàng `P:` — đọc lại biết bản này ra đời thế nào.
            pinned_data['identityAmbiguity'] = payload['identityAmbiguity']
        return await session_journal.append(
            self.executor, self.store, sid, 'plan',
            f"kế hoạch {identity} v{version} đã ghi ({payload.get('bytes')} B)",
            plan={'identity': identity, 'version': version}, refs=self.open_task_refs(sid),
            data=pinned_data, status='draft')

    async def pin_decision(self, sid, outcome):
        """A7 — ghim bản ghi `D:` cho một quyết định đã chốt, kèm **lựa chọn** chứ không chỉ kết quả.

        Phát hiện đợt 4: một lựa chọn `alternative` bị ghi thành `approved` trơ, nên đọc lại nhật ký
        không biết người dùng đã chọn phương án nào. Bản ghi ở đây giữ `choice` + nhãn của phương án
        đã chọn, và `alternatives` là các phương án còn lại — "chốt gì" trả lời được mà không mở UI.
        """
        if not isinstance(outcome, dict):
            return None
        record = self.pending.get(outcome.get('decisionId')) or {}
        # Hai đường gọi khác nhau: route đưa kết quả của `resolve_decision` (`{status: 'resolved',
        # choice, outcome}`), còn đường hết hạn đưa `record['outcome']` đã settle. Bản đã settle là
        # bản đầy đủ nhất (có `note`, `reason`, `status`), nên nó thắng khi có.
        outcome = {**(record.get('outcome') or {}), **outcome} if record.get('outcome') else outcome
        options = record.get('options') or []
        chosen = next((item for item in options if item.get('id') == outcome.get('choice')), None)
        expired = outcome.get('status') == 'expired'
        approved = outcome.get('decision') == 'approved'
        status = 'approved' if approved else ('info' if expired else 'rejected')
        label = (chosen or {}).get('label') or outcome.get('choice') or '?'
        prefix = 'hết hạn, lấy mặc định' if expired else ('chốt' if approved else 'từ chối')
        return await session_journal.append(
            self.executor, self.store, sid, 'decision', f"{prefix}: {label}",
            data={'decisionId': outcome.get('decisionId'), 'choice': outcome.get('choice'),
                  'choiceLabel': (chosen or {}).get('label'), 'choiceKind': (chosen or {}).get('kind'),
                  'status': outcome.get('status'), 'note': outcome.get('note'),
                  'alternatives': [item.get('id') for item in options if item.get('id') != outcome.get('choice')]},
            status=status)

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
            'skills': sorted(set(config['skills']) & ROLE_SKILLS[role]),
            'maxSteps': min(CHILD_MAX_STEPS, config['maxSteps']),
            'deadlineSeconds': min(CHILD_DEADLINE_SECONDS, config['deadlineSeconds']),
            'contextWindow': config['contextWindow'],
            'contextWindowSource': config.get('contextWindowSource'),
            'instructions': configured.get('systemPromptAppended', '')},
            parent_id=session['id'], role=role, parent_tools=config['tools'])
        context_data = str(args.get('context', ''))[:16000] if args.get('context') else ''
        expectation = str(args.get('expect', ''))[:CHILD_EXPECT_MAX_CHARS] if args.get('expect') else ''
        prompt_parts = [goal]
        if context_data:
            prompt_parts.append(f'Parent-supplied context (data):\n{context_data}')
        if expectation:
            prompt_parts.append(f'Parent-required deliverable and evidence (result shape):\n{expectation}')
        child_prompt = '\n'.join(prompt_parts) + CHILD_RESULT_CONTRACT
        echo_goal, echo_context, echo_prompt = (bound_child_text(goal, CHILD_ECHO_MAX_CHARS)[0],
                                                bound_child_text(context_data, CHILD_ECHO_MAX_CHARS)[0],
                                                bound_child_text(child_prompt, CHILD_ECHO_MAX_CHARS)[0])
        self.store.emit(session['id'], 'child', {
            'sessionId': child['id'],
            'role': role,
            'status': 'started',
            'goal': echo_goal,
            'context': echo_context,
            'prompt': echo_prompt,
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
        # C2 — con bị nhà cung cấp cắt ở trần output: `_run` đã thử lại một lần rồi trả câu trả lời
        # dở, và hàng `sessions` của con vẫn `completed` (giữ nguyên từ vựng trạng thái). Nên sự
        # thật phải đọc từ notice BỀN của chính con, không đọc từ status — nếu không, cha sẽ nhận
        # một "thành công" trong khi câu trả lời mới có một nửa.
        # C2 + B5 — con trả về câu trả lời DỞ vì một trong ba trần (output của nhà cung cấp, ngân
        # sách bước, hạn chót). `_run` của con đã phát notice BỀN mang ĐÚNG mã lý do, và hàng
        # `sessions` của con vẫn `completed` (giữ nguyên từ vựng trạng thái), nên sự thật phải
        # đọc từ notice — nếu không, cha nhận một "thành công" trong khi câu trả lời mới có một
        # phần. `reason` là mã của chính con, không phải một mã chung cho mọi ca.
        partial_reason = self.partial_turn(child['id']) if status == 'completed' else None
        if partial_reason:
            status = 'partial'
            last_error = last_error or partial_reason
        last_error = bound_child_text(last_error, CHILD_ECHO_MAX_CHARS)[0] if last_error else None
        tools_run = [e['data'].get('name') for e in child_events if e['type'] == 'tool_start']
        # The child's answer is the only unbounded string a delegated run produces. Bound it in the payload
        # itself (events and the parent's tool result share this dict) and report the truth about it.
        answer_text = answer or ''
        summary, truncated = bound_child_text(answer_text, CHILD_ANSWER_MAX_CHARS)
        diag = f"\n[Diagnostic: status={status}; error={last_error or 'none'}; tools_run={tools_run}]" if status != 'completed' else ""
        result = {'sessionId': child['id'], 'role': role, 'status': status,
                  'goal': echo_goal, 'context': echo_context, 'prompt': echo_prompt,
                  'summary': summary + diag, 'answerChars': len(answer_text), 'truncated': truncated,
                  'is_error': status != 'completed', 'last_error': last_error, 'tools_run': tools_run}
        if status == 'partial':
            # Lý do ĐÚNG MÃ cho cha: cắt ở trần output của nhà cung cấp, hết trần bước, hay hết
            # hạn chót là ba ca khác nhau — cha cần biết ca nào để xử lý.
            result['reason'] = partial_reason or TRUNCATED_OUTPUT_NOTICE_CODE
            if partial_reason and self.diagnosed_turn(child['id'], partial_reason):
                # B10 — con chạm trần đã trả BỐN PHẦN chẩn đoán (đã làm / tắc ở đâu / còn lại /
                # thử gì tiếp) và câu trả lời dở đó CHÍNH LÀ nội dung dùng được. Nói thẳng ra
                # để cha biết đường đi tiếp, thay vì coi con là `failed` trắng như BUG-42.
                result['diagnosis'] = True
                result['stuckReason'] = partial_reason
                result['is_error'] = False
        self.store.emit(session['id'], 'child', result)
        return result
