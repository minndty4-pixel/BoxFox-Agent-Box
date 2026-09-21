"""Loopback harness API; UI uses the Vite /api/agent proxy."""
import asyncio
import logging
import os
import sys
from pathlib import Path
from aiohttp import web
from ..agent_core.runtime import HarnessRuntime, DecisionError
from ..agent_core.roles import ROLES
from ..memory.session_store import SessionStore
from ..observability.system_log import (DEFAULT_READ_LINES, MAX_READ_LINES, clamp_lines,
                                        redact_entry, system_log)
from ..sandbox.executor import SandboxExecutor


logger = logging.getLogger('boxfox.harness.api')

DEFAULT_HARNESS_PORT = 3102
HARNESS_VERSION = '0.1.0'


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

    async def health(request):
        return web.json_response({'status': 'ok', 'service': 'boxfox-harness', 'version': HARNESS_VERSION})

    async def catalog(request):
        return web.json_response({'roles': [{'id': r.id, 'name': r.name, 'instructions': r.instructions, 'tools': sorted(r.tools)} for r in ROLES.values()], 'skills': runtime.catalog.list(runtime.commands.settings()['enabled'])})

    async def skill_settings(request):
        return web.json_response(runtime.commands.settings() if request.method == 'GET' else runtime.commands.configure(await request.json()))

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
        # The router owns provider metadata (context window, thinking type). Read it once per
        # session so the harness never has to guess the context budget from the model name.
        if value.get('connectionId') and value.get('modelId'):
            metadata = await runtime.client.model_metadata(value.get('connectionId'), value.get('modelId'))
            if metadata:
                value['modelMetadata'] = metadata
                if not value.get('contextWindow') and metadata.get('contextWindow'):
                    value['contextWindow'] = metadata['contextWindow']
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
        return web.json_response({k: v for k, v in value.items() if k != 'messages'} |
                                 {'events': runtime.store.events(sid, int(request.query.get('after', '0')))})

    async def turn(request):
        body = await request.json()
        sid = request.match_info['sid']
        # Check before submitting: `runtime.submit` would raise the same KeyError and the user
        # would get `INTERNAL_ERROR` for what is really a stale session id.
        known_session(sid)
        result = await runtime.submit(sid, body.get('prompt'), body.get('image'), body.get('route'), body.get('invocationId'))
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
        try:
            result = runtime.resolve_decision(request.match_info['sid'], body.get('decisionId'), body.get('choice'), body.get('note'))
        except DecisionError as exc:
            return web.json_response({'error': str(exc)}, status=exc.status)
        return web.json_response(result)

    async def delete_session(request):
        sid = request.match_info['sid']
        if sid in runtime.tasks:
            try:
                await runtime.stop(sid)
            except Exception:
                pass
        runtime.store.delete(sid)
        return web.json_response({'status': 'deleted', 'id': sid})

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
    app.router.add_get('/api/agent/skill-settings', skill_settings)
    app.router.add_put('/api/agent/skill-settings', skill_settings)
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
