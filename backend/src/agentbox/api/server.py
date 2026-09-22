"""Loopback harness API; UI uses the Vite /api/agent proxy."""
import asyncio
import logging
import os
import re
import sys
from pathlib import Path
from aiohttp import web
from ..agent_core import plan_registry
from ..agent_core.plan_header import IDENTITY_PATTERN
from ..agent_core.runtime import HarnessRuntime, DecisionError
from ..agent_core.failures import (BACKOFF_JITTER, BACKOFF_SECONDS, DEFAULT_MAX_RETRIES,
                                   RATE_LIMIT_MAX_SECONDS, RETRY_BUDGET_SECONDS)
from ..agent_core.limits import (CHILD_DEADLINE_SECONDS, CHILD_MAX_STEPS, DEADLINE_DEFAULT_SECONDS,
                                 DEADLINE_MAX_SECONDS, INSTRUCTIONS_MAX_CHARS, MAX_STEPS_DEFAULT,
                                 MAX_STEPS_MAX)
from ..agent_core.roles import ORCHESTRATOR_TOOLS, ROLES
from ..agent_core.tool_groups import tool_groups
from ..memory.session_store import SessionStore
from ..observability.system_log import (DEFAULT_READ_LINES, MAX_READ_LINES, clamp_lines,
                                        redact_entry, system_log)
from ..sandbox.executor import SandboxExecutor
from .owner_settings import OwnerSettings


logger = logging.getLogger('boxfox.harness.api')

DEFAULT_HARNESS_PORT = 3102
HARNESS_VERSION = '0.1.0'

# Grammar của identity plan, neo vào cùng hằng số với khối header/`plan_registry` nên không có bản
# sao thứ ba của `_SLUG`. Ghi chú người dùng khi duyệt plan bị cắt ở đây: sổ duyệt là chỗ ghi lại
# lý do, không phải chỗ dán cả một tài liệu.
_PLAN_IDENTITY_RE = re.compile(rf'^{IDENTITY_PATTERN}$')
_PLAN_NOTE_MAX_CHARS = 4096


class ApiError(Exception):
    """HTTP failure the client can act on: a stable code plus a readable message.

    The middleware used to turn any ``KeyError`` into ``{'error': 'Not found'}``. A missing
    session is exactly that shape, so the chat showed the word "Not found" for a stale id —
    with no code, no id and nothing for support to search. Codes here are the contract the UI
    reads (``SESSION_NOT_FOUND`` lets it start a fresh session instead of failing forever).
    """

    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def missing_session(sid):
    """404 for an id this harness does not know (deleted, or a store from another run)."""
    return ApiError('SESSION_NOT_FOUND',
                    f'session {sid} is not known to this harness; it was deleted or the harness '
                    'started with an empty store', 404)


def _plan_review_json(row):
    """Một hàng `plan_reviews` → camelCase cho UI; `None` khi chưa có quyết định nào."""
    if not row:
        return {'review': None}
    return {'review': {
        'identity': row.get('identity'), 'version': row.get('version'),
        'decision': row.get('decision'), 'note': row.get('note') or '',
        'source': row.get('source') or 'plan-tab', 'sessionId': row.get('session_id'),
        'decidedAt': row.get('decided_at'), 'contentSize': row.get('content_size'),
        'contentModifiedAt': row.get('content_modified_at'),
    }}


def repo_commit() -> str | None:
    """Commit of this checkout, read from `.git` directly (no subprocess), or None.

    The diagnostics line a dev copies out of the system-log panel has to name the build
    it came from; when there is no `.git` (a packaged run) the answer is honestly `None`
    and the panel prints `unknown` instead of inventing a hash.
    """
    git = Path(__file__).resolve().parents[4] / '.git'
    try:
        head = git / 'HEAD'
        text = head.read_text(encoding='utf-8').strip()
        if text.startswith('ref:'):
            ref = text[4:].strip()
            return (git / ref).read_text(encoding='utf-8').strip()[:40] or None
        return text[:40] or None
    except OSError:
        return None


def harness_port() -> int:
    """Port the harness binds. Read per call, not at import: a wrapper or a test that sets
    `BOXFOX_HARNESS_PORT` after this module is imported must still get a matching allow-list,
    and a non-numeric value must not kill the process with a bare `ValueError`."""
    raw = (os.environ.get('BOXFOX_HARNESS_PORT') or '').strip()
    if not raw:
        return DEFAULT_HARNESS_PORT
    try:
        port = int(raw)
    except ValueError:
        raise ValueError(f'BOXFOX_HARNESS_PORT must be a number, got {raw!r}') from None
    if not 1 <= port <= 65535:
        raise ValueError(f'BOXFOX_HARNESS_PORT must be 1-65535, got {port}')
    return port


def allowed_hosts() -> set[str]:
    """The UI and the Vite proxy use 3100/3102; the override adds an isolated instance's
    own port without dropping the defaults."""
    port = harness_port()
    return {
        '127.0.0.1:3102', 'localhost:3102', '127.0.0.1:3100', 'localhost:3100',
        f'127.0.0.1:{port}', f'localhost:{port}',
    }


def create_app(runtime):
    @web.middleware
    async def boundary(request, handler):
        if request.host not in allowed_hosts():
            return web.json_response({'error': 'Host not allowed'}, status=403)
        if request.path != '/api/agent/health':
            if request.headers.get('X-BoxFox-Admin') != '1' or request.headers.get('Origin', 'http://localhost:3100') not in {'http://localhost:3100', 'http://127.0.0.1:3100'}:
                return web.json_response({'error': 'Local administration required'}, status=403)
        try:
            return await handler(request)
        except ApiError as exc:
            return web.json_response({'error': f'{exc.code}: {exc.message}', 'code': exc.code}, status=exc.status)
        except KeyError as exc:
            # A KeyError inside a handler is an internal defect (a missing key in a payload or a
            # record) — never "the route does not exist". Reporting it as a bare `Not found` cost
            # a whole support round: the user sees one opaque word and nothing gets logged.
            logger.exception('internal error: missing key %r while handling %s %s',
                             exc.args[0] if exc.args else exc, request.method, request.path)
            return web.json_response({
                'error': f'INTERNAL_ERROR: the harness hit a missing key {exc} while handling '
                         f'{request.method} {request.path}', 'code': 'INTERNAL_ERROR'}, status=500)
        except PermissionError as exc:
            return web.json_response({'error': str(exc)}, status=403)
        except (ValueError, TypeError) as exc:
            return web.json_response({'error': str(exc)}, status=409 if any(c in str(exc) for c in ('SESSION_BUSY', 'REVISION_CONFLICT', 'INVOCATION_CONFLICT')) else 400)

    app = web.Application(middlewares=[boundary], client_max_size=1048576)

    async def heal_stored_context_windows(_app):
        """Lượt sửa một lần lúc khởi động: phiên cũ còn giữ cửa sổ ngữ cảnh đoán theo tên.

        Không được phép làm sập khởi động: router chưa lên cũng chỉ là 0 phiên được
        sửa (`heal_context_windows` trả 0 và không ghi gì).
        """
        try:
            healed = await runtime.heal_context_windows()
        except Exception:
            logger.exception('context-window heal skipped')
            return
        if healed:
            logger.info('context window healed for %s stored sessions', healed)

    app.on_startup.append(heal_stored_context_windows)

    async def health(request):
        return web.json_response({'status': 'ok', 'service': 'boxfox-harness', 'version': HARNESS_VERSION})

    async def catalog(request):
        return web.json_response({'roles': [{'id': r.id, 'name': r.name, 'instructions': r.instructions, 'tools': sorted(r.tools)} for r in ROLES.values()], 'skills': runtime.catalog.list(runtime.commands.settings()['enabled'])})

    async def runtime_info(request):
        """Nút vặn của runtime, chỉ đọc và không tham số — cho tab Harness của Settings.

        Bảng này là nguồn duy nhất cho mọi con số giao diện hiển thị (tám nhóm công cụ,
        bộ của từng vai trò, chính sách retry, trần bước/thời gian/ký tự): không chỗ nào
        ở phía UI được chép tay lại một con số, nếu không hai bên sẽ lệch nhau và khối
        "Tool access" sẽ hứa điều engine từ chối.
        """
        return web.json_response({
            'toolGroups': tool_groups(),
            'tools': sorted(ORCHESTRATOR_TOOLS),
            'roles': [{'id': r.id, 'name': r.name, 'tools': sorted(r.tools), 'skills': list(r.skills)}
                      for r in ROLES.values()],
            'retry': {'maxRetries': DEFAULT_MAX_RETRIES,
                      'backoffSeconds': list(BACKOFF_SECONDS),
                      'rateLimitMaxSeconds': RATE_LIMIT_MAX_SECONDS,
                      'budgetSeconds': RETRY_BUDGET_SECONDS,
                      'jitter': BACKOFF_JITTER},
            'limits': {'instructionsChars': INSTRUCTIONS_MAX_CHARS,
                       'maxStepsDefault': MAX_STEPS_DEFAULT,
                       'maxStepsMax': MAX_STEPS_MAX,
                       'deadlineDefaultSeconds': DEADLINE_DEFAULT_SECONDS,
                       'deadlineMaxSeconds': DEADLINE_MAX_SECONDS,
                       'childMaxSteps': CHILD_MAX_STEPS,
                       'childDeadlineSeconds': CHILD_DEADLINE_SECONDS},
        })

    async def skill_settings(request):
        return web.json_response(runtime.commands.settings() if request.method == 'GET' else runtime.commands.configure(await request.json()))

    # Chỉ dẫn của chủ máy: một tài liệu + `revision` (bảng riêng, xem owner_settings.py).
    # Cùng khuôn với skill-settings: GET đọc, PUT ghi kèm `revision` và trả bản mới.
    owner_directives = OwnerSettings(runtime.store)

    async def owner_settings(request):
        return web.json_response(owner_directives.settings() if request.method == 'GET'
                                 else owner_directives.configure(await request.json()))

    async def commands(request):
        if request.method == 'GET':
            return web.json_response({'commands': runtime.commands.list(), 'custom': runtime.commands.custom()})
        return web.json_response(runtime.commands.save(await request.json()), status=201)

    async def command(request):
        value = await request.json()
        if request.method == 'DELETE':
            runtime.commands.delete(request.match_info['slug'], value.get('revision'))
            return web.json_response({'status': 'deleted'})
        return web.json_response(runtime.commands.save(value, request.match_info['slug']))

    async def resolve(request):
        return web.json_response(runtime.commands.preview((await request.json()).get('prompt')))

    async def executor_status(request):
        from ..sandbox.claude_executor import ClaudeExecutor
        return web.json_response(await ClaudeExecutor(runtime.executor.container).probe())

    async def skill(request):
        return web.json_response(runtime.catalog.read(request.match_info['skill']))

    async def readiness(request):
        sid = request.match_info['skill']
        # `catalog.items[sid]` raises KeyError for an unknown skill; the middleware now reports
        # that as a 500, which is the right answer for a bug and the wrong one for a typo in a
        # URL. Validate here so an unknown skill is the 404 the client can act on.
        if sid not in runtime.catalog.items:
            raise ApiError('SKILL_NOT_FOUND', f'skill {sid} is not in this harness catalog', 404)
        item = runtime.catalog.items[sid]
        if sid == 'claude-code':
            return await executor_status(request)
        if sid in {'codex', 'opencode'}:
            return web.json_response({'status': 'adapter_unavailable'})
        payload = runtime.catalog.read(sid)
        result = await runtime.executor.execute('__skill_readiness', {'basePath': payload['basePath'],
            'requirements': item['requirements'], 'platforms': item['platforms']}, 'skill-readiness')
        return web.json_response(result)

    async def create(request):
        value = await request.json()
        if not isinstance(value, dict):
            raise ValueError('JSON object required')
        # The router owns provider metadata (context window AND its source label). Read it once per
        # session and hand the whole record to the harness: `runtime.resolve_context_window` reads the
        # number and the label together, so nothing here may overwrite the request's own value — a copy
        # guarded by a falsy check used to drop an explicit 0 or an inherited number silently.
        if value.get('connectionId') and value.get('modelId'):
            metadata = await runtime.client.model_metadata(value.get('connectionId'), value.get('modelId'))
            if metadata:
                value['modelMetadata'] = metadata
        # Tab Instructions nói tài liệu áp cho phiên MỚI, nhưng chỉ đường giao diện gửi
        # chỉ dẫn kèm yêu cầu; một phiên tạo không qua giao diện (script, lịch chạy) trước
        # đây không nhận được gì dù tài liệu đã lưu. Thiếu hẳn `instructions` trong yêu cầu
        # thì đọc tài liệu đang lưu, cắt bằng cùng trần với runtime. Engine không đổi luật:
        # nó vẫn chỉ đọc `values['instructions']`, và chỉ dẫn client gửi kèm luôn thắng.
        if not str(value.get('instructions') or '').strip():
            value['instructions'] = owner_directives.for_engine()
        return web.json_response(runtime.create(value), status=201)

    async def list_sessions(request):
        limit = min(100, max(1, int(request.query.get('limit', '50'))))
        return web.json_response({'sessions': runtime.store.list(limit)})

    def known_session(sid):
        """The session record, or an explicit 404 the UI can act on."""
        try:
            return runtime.store.get(sid)
        except KeyError:
            raise missing_session(sid) from None

    async def session(request):
        sid = request.match_info['sid']
        value = known_session(sid)
        # Do not resend large multimodal transcripts on every polling request.
        # N10 (đợt 20): kèm `sessionMetrics` — trước đây không có cách nào biết một phiên đã dài
        # bao nhiêu, đã nén mấy lần, hay `deadlineSeconds` đã bị hạ trần lúc tạo, mà không tải cả
        # transcript. Bốn khoá này đọc từ chính hàng đã lưu nên rẻ.
        journal_tail = runtime.journal_records(sid, limit=50)
        return web.json_response({k: v for k, v in value.items() if k != 'messages'} |
                                 {'events': runtime.store.events(sid, int(request.query.get('after', '0'))),
                                  'sessionMetrics': runtime.session_metrics(sid),
                                  # A9 (đợt 20): khối `journal` cộng thêm — chỗ đọc cũ không phải biết
                                  # tới nó, còn UI sau này có sẵn `records`/`lastSeq`/`degraded`.
                                  'journal': {'records': journal_tail['records'],
                                              'lastSeq': journal_tail['nextSeq'],
                                              'degraded': journal_tail['degraded']}})

    async def turn(request):
        body = await request.json()
        sid = request.match_info['sid']
        # Check before submitting: `runtime.submit` would raise the same KeyError and the user
        # would get `INTERNAL_ERROR` for what is really a stale session id.
        known_session(sid)
        result = await runtime.submit(sid, body.get('prompt'), body.get('image'), body.get('route'),
                                      body.get('invocationId'), images=body.get('images'),
                                      attachments=body.get('attachments'))
        return web.json_response(result, status=202 if result['status'] == 'running' else 200)

    async def stop(request):
        sid = request.match_info['sid']
        known_session(sid)
        await runtime.stop(sid)
        return web.json_response({'status': known_session(sid)['status']})

    async def decision(request):
        """Answer a pending ask_user / request_approval (contract §2: 200/400/404/409)."""
        try:
            body = await request.json()
        except Exception:
            body = None
        if not isinstance(body, dict):
            return web.json_response({'error': 'DECISION_INVALID: a JSON body with decisionId and choice is required'}, status=400)
        sid = request.match_info['sid']
        try:
            result = runtime.resolve_decision(sid, body.get('decisionId'), body.get('choice'), body.get('note'))
        except DecisionError as exc:
            return web.json_response({'error': str(exc)}, status=exc.status)
        # A7 (đợt 20): quyết định của người dùng được ghim vào nhật ký phiên — bản ghi `D:` giữ cả
        # `choice`, nên đọc lại biết đã chốt phương án nào (phát hiện đợt 4: `alternative` từng bị
        # ghi thành `approved` trơ). Ghi nhật ký hỏng không bao giờ làm hỏng câu trả lời cho UI.
        await runtime.pin_decision(sid, result)
        return web.json_response(result)

    async def session_journal(request):
        """`GET /api/agent/sessions/{sid}/journal?after=&kind=&limit=` — nhật ký bền của một phiên."""
        sid = request.match_info['sid']
        known_session(sid)
        try:
            after = int(request.query['after']) if 'after' in request.query else None
            limit = int(request.query.get('limit', '50'))
        except ValueError:
            return web.json_response({'error': 'JOURNAL_BAD_QUERY: after/limit phải là số'}, status=400)
        kind = request.query.get('kind') or None
        return web.json_response(runtime.journal_records(sid, after=after, kind=kind, limit=limit))

    async def journal_tasks(request):
        """`GET /api/agent/journal/tasks?status=&limit=` — task qua mọi phiên, đọc từ bảng nhật ký."""
        try:
            limit = int(request.query.get('limit', '50'))
        except ValueError:
            return web.json_response({'error': 'JOURNAL_BAD_QUERY: limit phải là số'}, status=400)
        return web.json_response(runtime.journal_tasks(status=request.query.get('status') or None, limit=limit))

    async def delete_session(request):
        sid = request.match_info['sid']
        if sid in runtime.tasks:
            try:
                await runtime.stop(sid)
            except Exception:
                pass
        runtime.store.delete(sid)
        return web.json_response({'status': 'deleted', 'id': sid})

    # ------------------------------------------------------------------ plan duyệt (vòng 20)
    #
    # Hai route này là ĐƯỜNG DUY NHẤT để tab Plan ghi/đọc trạng thái duyệt. Nguồn chân lý là bảng
    # SQLite của harness (`plan_reviews`, `plan_evaluations`), KHÔNG phải `.reviews/<identity>.json`
    # trong workspace: file đó agent ghi được nên nó chỉ là bản hiển thị, và không bao giờ là căn cứ
    # để cho hay không cho ghi một plan mới (§4.1 của plan vòng 20).
    #
    # Nối từ phía runtime (workstream A/C), giữ đúng chữ ký này:
    #
    #   * `request_approval` mang thêm hai tham số tuỳ chọn `planIdentity` (string) và `planVersion`
    #     (int ≥ 1) trong `args`; `runtime.decision()` chép chúng vào `record` đang chờ
    #     (`self.pending[decision_id]`) với **đúng hai tên khoá** `planIdentity`/`planVersion` —
    #     `plan_registry.pending_submissions()` đọc chính hai khoá đó để trả trạng thái `submitted`.
    #   * `settle()` gọi một lần, ngay trước khi phát `decision_resolved`:
    #         self.store.record_plan_review(identity=record.get('planIdentity'),
    #                                       version=record.get('planVersion'),
    #                                       decision='approved' if status == 'approved' else 'changes_requested',
    #                                       note=(note or ''), source='approval',
    #                                       session_id=record['sessionId'])
    #     Chỉ gọi khi cả hai khoá đều có (một `request_approval` cũ không mang chúng thì không ghi gì).
    #     "Chưa đồng ý" ở đây chính là điều kiện của luật v2 (R1) nên `rejected`/`expired`/`cancelled`
    #     đều thành `changes_requested`.

    def plan_identity_arg(value):
        """Identity hợp lệ (cùng grammar với khối header) hoặc `ApiError` 400."""
        text = str(value or '').strip().strip('/')
        if not text or not _PLAN_IDENTITY_RE.match(text):
            raise ApiError('PLAN_IDENTITY_INVALID',
                           'identity phải là chữ thường, các từ cách nhau một dấu gạch, có thể kèm '
                           'thư mục (ví dụ "clinical-patient-record-lookup-research")', 400)
        return text

    async def plan_index_or_none():
        """Chỉ mục box, hoặc `None` khi không đọc được (đã ghi nhật ký `PLAN_INDEX_UNAVAILABLE`).

        Không bao giờ raise: mất chỉ mục chỉ làm mất phần *số đo* (nhóm nào có những bản nào), còn
        quyết định của người dùng vẫn phải ghi được.
        """
        try:
            return await plan_registry.read_plan_index(runtime.executor)
        except Exception:
            return None

    async def plan_review(request):
        """`POST /api/agent/plans/review` — người dùng duyệt/yêu cầu sửa một bản plan (§4.1).

        Ghi vào sổ duyệt TRƯỚC, rồi mới chuyển tiếp sang box để badge của tab Plan chạy như cũ.
        Chuyển tiếp hỏng thì quyết định **vẫn** đã được ghi (`forwarded: false` + nhật ký
        `plan_review_forward_failed`): một cú bấm của người dùng không được biến mất vì box đang tắt.
        """
        try:
            body = await request.json()
        except Exception:
            body = None
        if not isinstance(body, dict):
            raise ApiError('PLAN_REVIEW_INVALID', 'a JSON body with identity, version, decision is required', 400)
        identity = plan_identity_arg(body.get('identity'))
        version = body.get('version')
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ApiError('PLAN_REVIEW_INVALID', 'version phải là số nguyên dương (bản plan bị duyệt)', 400)
        decision = str(body.get('decision') or '')
        if decision not in SessionStore.PLAN_REVIEW_DECISIONS:
            raise ApiError('PLAN_REVIEW_INVALID',
                           'decision phải là "approved" hoặc "changes_requested"', 400)
        note = body.get('note')
        if note is not None and not isinstance(note, str):
            raise ApiError('PLAN_REVIEW_INVALID', 'note phải là chuỗi', 400)
        note = (note or '').strip()
        if len(note) > _PLAN_NOTE_MAX_CHARS:
            raise ApiError('PLAN_REVIEW_INVALID',
                           f'note dài quá {_PLAN_NOTE_MAX_CHARS} ký tự', 400)

        # Chốt số đo tại thời điểm duyệt, nếu đọc được: về sau box báo số khác thì bản duyệt này
        # đã cũ và không còn tính là "đã đồng ý" (§4.2). Không đọc được thì để `None` — thà không
        # có số đo còn hơn bịa một con số để rồi lặng lẽ coi là còn hiệu lực.
        index = await plan_index_or_none()
        entry = None
        if index is not None:
            group = index.group(identity)
            if group is not None:
                entry = next((item for item in group.versions if item.version == version), None)
        try:
            row = runtime.store.record_plan_review(
                identity, version, decision, note=note, source='plan-tab',
                content_size=None if entry is None else entry.size_bytes,
                content_modified_at=None if entry is None else entry.modified_at)
        except ValueError as exc:
            raise ApiError('PLAN_REVIEW_INVALID', str(exc), 400) from None

        forwarded = True
        try:
            await runtime.executor.request('/__box/plans/review',
                                           {'identity': identity, 'version': version,
                                            'decision': decision, 'note': note})
        except Exception as exc:
            forwarded = False
            system_log.write('plan.review.forward_failed', level='warn', code='PLAN_REVIEW_FORWARD_FAILED',
                             message='Đã ghi quyết định duyệt vào sổ của harness nhưng chưa chuyển được '
                                     'sang box; badge trong .reviews sẽ cập nhật ở lần duyệt sau.',
                             reason=f'{type(exc).__name__}: {exc}')
        return web.json_response({'identity': identity, 'version': version, 'decision': decision,
                                  'note': note, 'forwarded': forwarded,
                                  'review': _plan_review_json(row)['review']})

    async def plan_status(request):
        """`GET /api/agent/plans/status?identity=&version=` — trạng thái duyệt cho tab Plan (§4.2).

        Không có `version` → trả trạng thái của bản **mới nhất** trong nhóm. Có `version` → trả đúng
        bản đó (duyệt một bản cũ ghi vào sổ đúng bản cũ và không áp cho bản mới hơn).
        Identity không có trong chỉ mục → 200 với `{state: "none"}`. Chỉ mục không đọc được →
        `{state: "unknown", indexAvailable: false}`: đó là sự thật, không phải một lần đoán.
        """
        identity = plan_identity_arg(request.query.get('identity'))
        wanted = request.query.get('version')
        version = None
        if wanted not in (None, ''):
            if not str(wanted).isdigit() or int(wanted) < 1:
                raise ApiError('PLAN_STATUS_INVALID', 'version phải là số nguyên dương', 400)
            version = int(wanted)

        index = await plan_index_or_none()
        group = index.group(identity) if index is not None else None
        reviews = runtime.store.plan_reviews_for(identity)
        submitted = plan_registry.pending_submissions(getattr(runtime, 'pending', {}).values(), identity)
        if group is not None and version is None:
            state = plan_registry.group_state(group.versions, reviews=reviews, submitted=submitted)
        else:
            entries = () if group is None else tuple(item for item in group.versions
                                                     if version is None or item.version == version)
            state = plan_registry.group_state(entries, reviews=reviews, submitted=submitted,
                                             index_available=index is not None)
        payload = state.to_payload() | {'identity': identity}
        evaluation = runtime.store.plan_evaluation(identity, state.state_version or 0)
        if state.state_version is None and version is not None:
            # Bản được hỏi không có trên box (đã bị xoá, hoặc gõ sai số): không nhóm nào để đo, nên
            # `stateVersion` phải nói đúng bản đang được hỏi thay vì im lặng trả `null` bên cạnh
            # hàng sổ duyệt của chính bản đó.
            payload['stateVersion'] = version
            evaluation = runtime.store.plan_evaluation(identity, version)
        payload['version'] = version if version is not None else state.state_version
        payload['evaluation'] = None if evaluation is None else {
            'identity': evaluation.get('identity'), 'version': evaluation.get('version'),
            'total': evaluation.get('total'), 'verdict': evaluation.get('verdict'),
            'evaluatedAt': evaluation.get('evaluated_at'), 'payload': evaluation.get('payload'),
        }
        return web.json_response(payload)


    async def system_log_view(request):
        """Read-only view of the developer system log (plan §3.1).

        The log lives in `~/BoxFox/logs` on the HOST, so this route is the only way the
        UI can see it; nothing inside the box reaches it and no box route proxies it
        (plan §3.2 — proven by `deploy/docker/tests/test_ide_proxy_system_log.py`).
        A missing file is not an error: it only means the harness has not run yet, and
        the answer is an explicit empty list. Bad filter values raise ValueError, which
        the boundary middleware turns into a 400.
        """
        query = request.query
        limit = clamp_lines(query.get('lines'))
        entries = system_log.read(level=query.get('level'), source=query.get('source'),
                                  session_id=query.get('sessionId'), event=query.get('event'),
                                  lines=limit, since=query.get('since'))
        return web.json_response({
            # Second pass at the API layer: the writer redacts, but the file is a file,
            # so a secret value never leaves the harness through this route either.
            'entries': [redact_entry(entry) for entry in entries],
            'count': len(entries),
            'exists': system_log.path.exists(),
            'file': system_log.path.name,
            'lines': limit,
            'cap': MAX_READ_LINES,
            'runId': system_log.run_id,
            'version': HARNESS_VERSION,
            'commit': repo_commit(),
        })

    async def close(app):
        for sid in list(runtime.tasks):
            await runtime.stop(sid)
        runtime.store.close()
        # Graceful shutdown is the owner's "reset on shutdown": mark the end of the run
        # in the file it happened in, then reset it to `harness.previous.jsonl` so the
        # next run opens a fresh, empty active file (plan §3.3). A hard kill never gets
        # here, so an abrupt death loses nothing — the file simply stays.
        try:
            port = harness_port()
        except ValueError:
            port = None
        system_log.write('harness.stop', port=port, pid=os.getpid())
        system_log.rotate_on_shutdown()

    app.router.add_get('/api/agent/health', health)
    app.router.add_get('/api/agent/catalog', catalog)
    app.router.add_get('/api/agent/runtime-info', runtime_info)
    app.router.add_get('/api/agent/skill-settings', skill_settings)
    app.router.add_put('/api/agent/skill-settings', skill_settings)
    app.router.add_get('/api/agent/owner-settings', owner_settings)
    app.router.add_put('/api/agent/owner-settings', owner_settings)
    app.router.add_get('/api/agent/commands', commands)
    app.router.add_post('/api/agent/commands', commands)
    app.router.add_post('/api/agent/commands/resolve', resolve)
    app.router.add_put('/api/agent/commands/{slug}', command)
    app.router.add_delete('/api/agent/commands/{slug}', command)
    app.router.add_get('/api/agent/executors/claude-code', executor_status)
    app.router.add_get('/api/agent/skills/{skill}', skill)
    app.router.add_get('/api/agent/skills/{skill}/readiness', readiness)
    app.router.add_get('/api/agent/sessions', list_sessions)
    app.router.add_post('/api/agent/sessions', create)
    app.router.add_get('/api/agent/sessions/{sid}', session)
    app.router.add_delete('/api/agent/sessions/{sid}', delete_session)
    app.router.add_post('/api/agent/sessions/{sid}/turns', turn)
    app.router.add_post('/api/agent/sessions/{sid}/stop', stop)
    app.router.add_post('/api/agent/sessions/{sid}/decisions', decision)
    app.router.add_get('/api/agent/sessions/{sid}/journal', session_journal)
    app.router.add_get('/api/agent/journal/tasks', journal_tasks)
    app.router.add_post('/api/agent/plans/review', plan_review)
    app.router.add_get('/api/agent/plans/status', plan_status)
    # DEV-only surface: the system log is host-only and read-only. There is deliberately
    # no write route and no route of the box that reaches it (plan §3.1 + §3.2).
    app.router.add_get('/api/agent/system-log', system_log_view)
    app.on_cleanup.append(close)
    return app



def main():
    data = Path(os.environ.get('BOXFOX_AGENT_DATA_DIR', str(Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'BoxFox/harness')))
    port = harness_port()
    runtime = HarnessRuntime(SessionStore(data / 'sessions.sqlite'), SandboxExecutor(
        api_key=os.environ.get('BOXFOX_API_KEY', 'boxfox-local-dev-token')))
    system_log.write('harness.start', dataDir=str(data), port=port, pid=os.getpid(),
                     python=sys.version.split()[0])
    try:
        web.run_app(create_app(runtime), host='127.0.0.1', port=port, print=None)
    finally:
        # `close()` is the normal path (`harness.stop` + reset). This call covers a
        # startup that died before the aiohttp cleanup ran; it is a no-op when the file
        # was already reset, because then there is no active file left to rename.
        system_log.rotate_on_shutdown()


if __name__ == '__main__':
    main()
