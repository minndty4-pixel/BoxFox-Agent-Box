"""Loopback harness API; UI uses the Vite /api/agent proxy."""
import asyncio
import os
from pathlib import Path
from aiohttp import web
from ..agent_core.runtime import HarnessRuntime
from ..agent_core.roles import ROLES
from ..memory.session_store import SessionStore
from ..sandbox.executor import SandboxExecutor


def create_app(runtime):
    @web.middleware
    async def boundary(request, handler):
        if request.host not in {'127.0.0.1:3102', 'localhost:3102', '127.0.0.1:3100', 'localhost:3100'}:
            return web.json_response({'error': 'Host not allowed'}, status=403)
        if request.path != '/api/agent/health':
            if request.headers.get('X-BoxFox-Admin') != '1' or request.headers.get('Origin', 'http://localhost:3100') not in {'http://localhost:3100', 'http://127.0.0.1:3100'}:
                return web.json_response({'error': 'Local administration required'}, status=403)
        try:
            return await handler(request)
        except KeyError:
            return web.json_response({'error': 'Not found'}, status=404)
        except (ValueError, TypeError) as exc:
            return web.json_response({'error': str(exc)}, status=409 if 'SESSION_BUSY' in str(exc) else 400)

    app = web.Application(middlewares=[boundary], client_max_size=1048576)

    async def health(request):
        return web.json_response({'status': 'ok', 'service': 'boxfox-harness', 'version': '0.1.0'})

    async def catalog(request):
        return web.json_response({'roles': [{'id': r.id, 'name': r.name, 'instructions': r.instructions, 'tools': sorted(r.tools)} for r in ROLES.values()], 'skills': runtime.catalog.list()})

    async def skill(request):
        return web.json_response(runtime.catalog.read(request.match_info['skill']))

    async def create(request):
        value = await request.json()
        if not isinstance(value, dict):
            raise ValueError('JSON object required')
        return web.json_response(runtime.create(value), status=201)

    async def list_sessions(request):
        limit = min(100, max(1, int(request.query.get('limit', '50'))))
        return web.json_response({'sessions': runtime.store.list(limit)})

    async def session(request):
        sid = request.match_info['sid']
        value = runtime.store.get(sid)
        # Do not resend large multimodal transcripts on every polling request.
        return web.json_response({k: v for k, v in value.items() if k != 'messages'} |
                                 {'events': runtime.store.events(sid, int(request.query.get('after', '0')))})

    async def turn(request):
        body = await request.json()
        runtime.start(request.match_info['sid'], body.get('prompt'), body.get('image'))
        return web.json_response({'status': 'running'}, status=202)

    async def stop(request):
        await runtime.stop(request.match_info['sid'])
        return web.json_response({'status': runtime.store.get(request.match_info['sid'])['status']})

    async def delete_session(request):
        sid = request.match_info['sid']
        if sid in runtime.tasks:
            try:
                await runtime.stop(sid)
            except Exception:
                pass
        runtime.store.delete(sid)
        return web.json_response({'status': 'deleted', 'id': sid})

    async def close(app):
        for sid in list(runtime.tasks):
            await runtime.stop(sid)
        runtime.store.close()

    app.router.add_get('/api/agent/health', health)
    app.router.add_get('/api/agent/catalog', catalog)
    app.router.add_get('/api/agent/skills/{skill}', skill)
    app.router.add_get('/api/agent/sessions', list_sessions)
    app.router.add_post('/api/agent/sessions', create)
    app.router.add_get('/api/agent/sessions/{sid}', session)
    app.router.add_delete('/api/agent/sessions/{sid}', delete_session)
    app.router.add_post('/api/agent/sessions/{sid}/turns', turn)
    app.router.add_post('/api/agent/sessions/{sid}/stop', stop)
    app.on_cleanup.append(close)
    return app



def main():
    data = Path(os.environ.get('BOXFOX_AGENT_DATA_DIR', str(Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'BoxFox/harness')))
    runtime = HarnessRuntime(SessionStore(data / 'sessions.sqlite'), SandboxExecutor(
        api_key=os.environ.get('BOXFOX_API_KEY', 'boxfox-local-dev-token')))
    web.run_app(create_app(runtime), host='127.0.0.1', port=3102, print=None)


if __name__ == '__main__':
    main()
