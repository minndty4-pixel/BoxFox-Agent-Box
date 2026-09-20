"""Managed Claude Code child executor using the BoxFox container's own credentials.

Router configuration (opt-in)
-----------------------------
`/claude-code` chạy được MÀ KHÔNG cần tài khoản Anthropic nếu harness được khởi
động với cấu hình router BoxFox (xem docs/deploy/README-claude-code.md):

    BOXFOX_ANTHROPIC_BASE_URL             (bắt buộc cùng token)
    BOXFOX_ANTHROPIC_AUTH_TOKEN
    BOXFOX_ANTHROPIC_MODEL                (tuỳ chọn)
    BOXFOX_ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL (tuỳ chọn)

Giá trị đi vào box qua `docker exec -e` — cùng tên, có tiền tố BoxFox, nên biến
ANTHROPIC_* thô không bao giờ nằm trong môi trường của container — và
claude_worker.py đổi tên thành biến CLI đọc + ghi ~/.claude/settings.json.
Không đặt biến nào ⇒ KHÔNG có cờ -e nào, hành vi y như trước.
"""
import asyncio
import json
import os
from pathlib import Path
import uuid

WORKER = Path(__file__).with_name('claude_worker.py').read_text(encoding='utf-8')

# Danh sách ĐÓNG (allow-list): chỉ sáu biến này được phép đi vào box. Hợp đồng
# được ghim ở hai đầu bởi backend/tests/unit/test_claude_executor.py (so với
# claude_worker.CONFIG_ENV) nên thêm biến ở một phía sẽ đỏ test ngay.
CONFIG_ENV = ('BOXFOX_ANTHROPIC_BASE_URL', 'BOXFOX_ANTHROPIC_AUTH_TOKEN', 'BOXFOX_ANTHROPIC_MODEL',
              'BOXFOX_ANTHROPIC_DEFAULT_OPUS_MODEL', 'BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL',
              'BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL')


class ClaudeExecutor:
    def __init__(self, container='agentbox-box', spawn=asyncio.create_subprocess_exec, environment=None):
        self.container, self.spawn = container, spawn
        self.environment = self.config(os.environ if environment is None else environment)

    @staticmethod
    def config(environment):
        """Cặp `NAME=value` cho những biến ĐÃ đặt và KHÁC RỖNG (chưa cấu hình ⇒ rỗng)."""
        return [f'{name}={value}' for name in CONFIG_ENV
                if (value := str(environment.get(name) or '').strip())]

    def command(self):
        flags = [part for pair in self.environment for part in ('-e', pair)]
        return ['docker', 'exec', '-i', *flags, '--user', 'agent', self.container,
                '/opt/pw-driver/bin/python3', '-c', WORKER]

    async def process(self, value):
        proc = await self.spawn(*self.command(), stdin=asyncio.subprocess.PIPE,
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
                        # Câu của nhà cung cấp nằm ở `text` trên đường kết quả (worker chỉ đặt
                        # `message` cho lỗi của chính nó). Đo sống 2026-09-20: lỗi hạn mức chỉ
                        # hiện ra thành "Claude Code task failed", còn lý do thật thì bị bỏ.
                        raise ValueError(event.get('message') or event.get('text')
                                         or 'Claude Code task failed')
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
