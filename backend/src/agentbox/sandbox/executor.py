"""Host adapter for the existing BoxFox container and capture control plane."""
import asyncio
import base64
import json
from pathlib import Path
import httpx
from ..observability.system_log import system_log
from ..vendor.hermes.computer_backend import image_dimensions_from_bytes

WORKER = Path(__file__).with_name('worker.py').read_text(encoding='utf-8')


class SandboxExecutor:
    def __init__(self, container='agentbox-box', api_url='http://127.0.0.1:8081', api_key='boxfox-local-dev-token'):
        self.container = container
        self.api_url = api_url
        self.api_key = api_key
        self.recordings = {}
        # Physical desktop shared by sessions: media/input/browser serialize per action.
        self.visual_lock = asyncio.Lock()

    async def request(self, path, body=None):
        async with httpx.AsyncClient(timeout=40, trust_env=False) as client:
            response = await client.request('POST' if body is not None else 'GET', self.api_url + path,
                json=body, headers={'X-BoxFox-Api-Key': self.api_key})
            response.raise_for_status()
            return response.json()

    async def execute(self, name, args, session):
        if name in {'computer_screen_capture', 'computer_screen_record', 'computer_use', 'browser_use', 'inspect_element'}:
            async with self.visual_lock:
                result = await self._execute(name, args, session)
        else:
            result = await self._execute(name, args, session)
        self._log_desktop_note(name, result, session)
        return result

    def _log_desktop_note(self, name, result, session):
        """Ghi lại việc màn hình bị kéo nhỏ (F6) vào nhật ký hệ thống cho DEV.

        F6 xảy ra ÂM THẦM: client RFB kéo framebuffer nhỏ đi là toạ độ CUA trỏ sai mà
        không lỗi nào nổi lên. Dòng log này là bằng chứng duy nhất khi truy lỗi về sau.
        """
        if not isinstance(result, dict):
            return
        note = result.get('desktopRestored') or result.get('desktopWarning')
        if not isinstance(note, dict):
            return
        restored = 'to' in note
        system_log.write(
            'box.desktop_restored' if restored else 'box.desktop_warning',
            level='info' if restored else 'warn',
            code='DESKTOP_RESTORED' if restored else 'DESKTOP_TOO_SMALL',
            message=(f"the sandbox desktop was {note.get('from')} and is back at {note.get('to')}"
                     if restored else
                     f"the sandbox desktop is smaller than configured ({note.get('from')}): {note.get('warning')}"),
            session_id=session,
            tool=name,
            **note,
        )

    async def _execute(self, name, args, session):
        if name == 'inspect_element':
            return await self.request('/__box/inspect-element', {'x': int(args['x']), 'y': int(args['y'])})
        if name == 'computer_screen_capture':
            data = await self.request('/__box/capture', {'target': {'kind': 'screen'}, 'output': 'base64'})
            raw = base64.b64decode(data.get('data', ''))
            dimensions = image_dimensions_from_bytes(raw)
            if not dimensions:
                raise ValueError('Sandbox returned no valid screenshot')
            payload = {'content': f'Sandbox screenshot {dimensions[0]}x{dimensions[1]}', 'artifact': data.get('path'),
                       'image': data['data'], 'mime': 'image/png', 'dimensions': dimensions}
            # F6: chuyển tiếp ghi chú kích thước desktop để `execute()` ghi vào nhật ký DEV.
            for key in ('desktopRestored', 'desktopWarning'):
                if key in data:
                    payload[key] = data[key]
            return payload
        if name == 'computer_screen_record':
            action = args['action']
            rid = self.recordings.get(session)
            if action == 'status':
                state = await self.request('/__box/record/status')
                return {'active': any(r.get('recordingId') == rid for r in state.get('active', [])), 'recordingId': rid}
            if action == 'start':
                if rid:
                    raise ValueError('Recording already owned by this session; stop first')
                data = await self.request('/__box/record/start', {'target': {'kind': 'screen'}})
                self.recordings[session] = data['recordingId']
                return data
            if action == 'stop':
                if not rid:
                    raise ValueError('No recording owned by this session')
                data = await self.request('/__box/record/stop', {'recordingId': rid})
                self.recordings.pop(session, None)
                return data
            raise ValueError('Unknown recording action')
        # Worker executes inside Docker; no interpolation of model text into the host shell.
        proc = await asyncio.create_subprocess_exec('docker', 'exec', '-i', '--user', 'agent',
            '--workdir', '/home/agent/workspace', self.container, '/opt/pw-driver/bin/python3', '-c', WORKER,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(json.dumps({'name': name, 'args': args, 'session': session}).encode()), timeout=140)
        except BaseException:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            if name == 'terminal_exec':
                await self._execute('__cancel', {}, session)
            raise
        if proc.returncode:
            raise RuntimeError('Sandbox unavailable: ' + err.decode(errors='replace')[:500])
        return json.loads(out)

    async def cleanup(self, session):
        if session in self.recordings:
            try:
                await self.execute('computer_screen_record', {'action': 'stop'}, session)
            except Exception:
                # Keep ownership for an explicit later stop; never report a saved artifact.
                return False
        return True
