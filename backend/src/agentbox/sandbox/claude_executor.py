"""Managed Claude Code child executor using the BoxFox container's own credentials."""
import asyncio
import json
from pathlib import Path
import uuid

WORKER = Path(__file__).with_name('claude_worker.py').read_text(encoding='utf-8')


class ClaudeExecutor:
    def __init__(self, container='agentbox-box', spawn=asyncio.create_subprocess_exec):
        self.container, self.spawn = container, spawn

    async def process(self, value):
        proc = await self.spawn('docker', 'exec', '-i', '--user', 'agent', self.container,
            '/opt/pw-driver/bin/python3', '-c', WORKER, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=1048576)
        proc.stdin.write((json.dumps(value) + '\n').encode())
        await proc.stdin.drain()
        proc.stdin.close()
        return proc

    async def probe(self):
        proc = await self.process({'action': 'probe', 'session': uuid.uuid4().hex})
        try:
            async with asyncio.timeout(45):
                out, _ = await proc.communicate()
                rows = [json.loads(line) for line in out.splitlines() if line.strip()]
                return next((r['data'] for r in rows if r.get('type') == 'readiness'),
                            {'status': 'setup_required', 'reason': 'Sandbox unavailable'})
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    async def cancel(self, sid):
        proc = await self.process({'action': 'cancel', 'session': sid})
        try:
            await asyncio.wait_for(proc.communicate(), 10)
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    async def run(self, sid, prompt, role, instructions, emit, deadline=180):
        proc = await self.process(dict(action='run', session=sid, prompt=prompt, role=role, instructions=instructions))
        final = None
        try:
            async with asyncio.timeout(deadline):
                while line := await proc.stdout.readline():
                    event = json.loads(line)
                    emit(event)
                    if event['type'] == 'readiness' and event['data']['status'] != 'ready':
                        raise ValueError('setup_required: ' + event['data'].get('reason', 'Claude Code unavailable'))
                    if event['type'] == 'error' or event.get('is_error'):
                        raise ValueError(event.get('message', 'Claude Code task failed'))
                    if event['type'] == 'result':
                        final = event.get('text')
                code = await proc.wait()
                if code or not isinstance(final, str) or not final.strip():
                    raise ValueError('Claude Code did not return a successful non-empty result')
                return final
        finally:
            # Always stop the owned container process group, including timeout/disconnect.
            await asyncio.shield(self.cancel(sid))
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
