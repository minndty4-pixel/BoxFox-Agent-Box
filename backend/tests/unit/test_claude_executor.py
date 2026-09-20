"""CLI protocol simulator; no network, credentials or Docker mutations."""
import asyncio
import json
import re
from pathlib import Path
import pytest
from agentbox.sandbox import claude_executor
from agentbox.sandbox.claude_executor import ClaudeExecutor, CONFIG_ENV as EXECUTOR_ENV

ROUTER = {
    'BOXFOX_ANTHROPIC_BASE_URL': 'http://172.18.0.1:3101',
    'BOXFOX_ANTHROPIC_AUTH_TOKEN': 'bf_token_value',
    'BOXFOX_ANTHROPIC_MODEL': 'connection-id/gemini-3.6-flash-high',
    'BOXFOX_ANTHROPIC_DEFAULT_OPUS_MODEL': 'connection-id/gemini-3.8-flash-high',
    'BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL': 'connection-id/gemini-3.6-flash-high',
    'BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL': 'connection-id/gemini-3.6-flash-high',
}


class Input:
    def __init__(self): self.value = b''
    def write(self, data): self.value += data
    async def drain(self): pass
    def close(self): pass


class Process:
    def __init__(self, content=b'', code=0, hang=False, split=0):
        self.stdin, self.stdout = Input(), asyncio.StreamReader()
        self.returncode = None if hang else code
        self.code, self.killed, self.content = code, False, content
        if split:
            for i in range(0, len(content), split): self.stdout.feed_data(content[i:i+split])
        else: self.stdout.feed_data(content)
        if not hang: self.stdout.feed_eof()
    async def communicate(self): return self.content, b''
    async def wait(self):
        self.returncode = self.code
        return self.code
    def kill(self): self.killed = True; self.returncode = -9


def stream(*events):
    return b''.join((json.dumps(e, ensure_ascii=False) + '\n').encode() for e in events)


READY = {'type': 'readiness', 'data': {'status': 'ready', 'version': 'fixture-cli'}}
RESULT = {'type': 'result', 'text': 'Đã sửa lỗi ✓', 'is_error': False}


@pytest.mark.parametrize('split', [0, 1, 2, 7, 19])
def test_json_lines_unicode_and_argv_isolation(split):
    async def run():
        processes, calls, events = [], [], []
        async def spawn(*args, **kwargs):
            calls.append(args)
            p = Process(stream(READY, {'type': 'text', 'text': 'working'}, RESULT) if not processes else b'', split=split)
            processes.append(p); return p
        executor = ClaudeExecutor('isolated-test-box', spawn, {})
        prompt = '$(touch injected); "quoted"\nこんにちは'
        assert await executor.run('abc', prompt, 'build', 'skill body', events.append) == RESULT['text']
        assert json.loads(processes[0].stdin.value)['prompt'] == prompt
        assert all(prompt not in argument for argument in calls[0])
        assert json.loads(processes[1].stdin.value)['action'] == 'cancel'
        assert [e['type'] for e in events] == ['readiness', 'text', 'result']
    asyncio.run(run())


@pytest.mark.parametrize('event', [
    {'type': 'readiness', 'data': {'status': 'setup_required', 'reason': 'missing binary'}},
    {'type': 'readiness', 'data': {'status': 'setup_required', 'reason': 'missing auth'}},
    {'type': 'readiness', 'data': {'status': 'setup_required', 'reason': 'missing mount'}},
    {'type': 'readiness', 'data': {'status': 'setup_required', 'reason': 'unsupported version'}},
    {'type': 'error', 'message': 'readonly isolation unavailable'},
    {'type': 'error', 'message': 'CLI authentication expired'},
    {'type': 'result', 'text': 'error', 'is_error': True},
    {'type': 'result', 'text': '', 'is_error': False},
    {'type': 'result', 'text': None, 'is_error': False},
    {'type': 'text', 'text': 'partial only'},
])
def test_cli_failure_cannot_be_reported_as_success(event):
    async def run():
        processes = []
        async def spawn(*args, **kwargs):
            p = Process(stream(event) if not processes else b''); processes.append(p); return p
        with pytest.raises(ValueError):
            await ClaudeExecutor(spawn=spawn, environment={}).run('abc', 'task', 'build', '', lambda e: None)
        assert len(processes) == 2
        assert json.loads(processes[1].stdin.value)['session'] == 'abc'
    asyncio.run(run())


@pytest.mark.parametrize('action', ['timeout', 'cancel'])
def test_stop_reaches_container_process_group(action):
    async def run():
        processes = []
        async def spawn(*args, **kwargs):
            p = Process(hang=not processes); processes.append(p); return p
        executor = ClaudeExecutor(spawn=spawn, environment={})
        task = asyncio.create_task(executor.run('owned-child', 'task', 'build', '', lambda e: None, deadline=.02 if action == 'timeout' else 10))
        await asyncio.sleep(.01)
        if action == 'cancel': task.cancel()
        with pytest.raises(TimeoutError if action == 'timeout' else asyncio.CancelledError): await task
        assert json.loads(processes[1].stdin.value) == {'action': 'cancel', 'session': 'owned-child'}
        assert processes[0].killed
    asyncio.run(run())


@pytest.mark.parametrize('payload', [b'', b'{bad json}\n', stream(RESULT)])
def test_probe_never_infers_ready_without_evidence(payload):
    async def run():
        async def spawn(*args, **kwargs): return Process(payload)
        try:
            result = await ClaudeExecutor(spawn=spawn, environment={}).probe()
            assert result['status'] == 'setup_required'
        except ValueError:
            assert payload == b'{bad json}\n'
    asyncio.run(run())


def test_router_config_becomes_docker_exec_env_flags():
    """Cấu hình router đi vào box bằng `docker exec -e`, không bằng tham số CLI."""
    async def run():
        processes, calls = [], []
        async def spawn(*args, **kwargs):
            calls.append(args)
            p = Process(stream(READY, RESULT)); processes.append(p); return p
        executor = ClaudeExecutor('isolated-test-box', spawn, ROUTER)
        assert await executor.run('abc', 'task', 'build', '', lambda e: None) == RESULT['text']
        argv = list(calls[0])
        flags = [(argv[i + 1]) for i, part in enumerate(argv) if part == '-e']
        assert flags == [f'{name}={value}' for name, value in ROUTER.items()]
        # Thứ tự cờ vẫn đúng: docker exec -i -e … --user agent <box> python3 -c <worker>
        assert argv[:2] == ['docker', 'exec'] and '-i' in argv[:4]
        assert argv[argv.index('--user') + 1] == 'agent' and argv[argv.index('--user') + 2] == 'isolated-test-box'
        # Token chỉ có trong argv của `docker exec`, KHÔNG nằm trong payload stdin.
        assert ROUTER['BOXFOX_ANTHROPIC_AUTH_TOKEN'] not in processes[0].stdin.value.decode()
        assert json.loads(processes[0].stdin.value)['action'] == 'run'
    asyncio.run(run())


def test_no_configuration_passes_no_environment_at_all():
    """Chưa cấu hình ⇒ hành vi y như trước: không một cờ -e nào."""
    async def run():
        calls = []
        async def spawn(*args, **kwargs):
            calls.append(args); return Process(stream(READY, RESULT))
        await ClaudeExecutor('box', spawn, {}).probe()
        assert '-e' not in calls[0]
        # Biến rỗng/toàn khoảng trắng không được coi là cấu hình.
        await ClaudeExecutor('box', spawn, {name: '  ' for name in ROUTER}).probe()
        assert '-e' not in calls[1]
        # Biến ngoài allow-list KHÔNG bao giờ đi vào box, kể cả khi trùng tiền tố.
        await ClaudeExecutor('box', spawn, {'BOXFOX_ANTHROPIC_EXTRA': 'x', 'ANTHROPIC_API_KEY': 'sk-live'}).probe()
        assert '-e' not in calls[2]
    asyncio.run(run())


def test_partial_router_configuration_passes_only_what_is_set():
    async def run():
        calls = []
        async def spawn(*args, **kwargs):
            calls.append(args); return Process(b'')
        await ClaudeExecutor('box', spawn, {'BOXFOX_ANTHROPIC_AUTH_TOKEN': 'bf_1', 'BOXFOX_ANTHROPIC_MODEL': ''}).probe()
        argv = list(calls[0])
        assert [argv[i + 1] for i, part in enumerate(argv) if part == '-e'] == ['BOXFOX_ANTHROPIC_AUTH_TOKEN=bf_1']
    asyncio.run(run())


def test_executor_and_worker_agree_on_the_environment_contract():
    """Hai đầu của hợp đồng (host truyền / box đọc) phải là CÙNG một danh sách."""
    worker = Path(claude_executor.__file__).with_name('claude_worker.py')
    block = worker.read_text(encoding='utf-8').split('CONFIG_ENV = {', 1)[1].split('}', 1)[0]
    names = set(re.findall(r"'(BOXFOX_[A-Z_]+)':", block))
    assert names == set(EXECUTOR_ENV), 'claude_worker.CONFIG_ENV và ClaudeExecutor.CONFIG_ENV đã lệch nhau'
    assert len(EXECUTOR_ENV) == len(set(EXECUTOR_ENV))



def test_the_provider_reason_survives_an_error_result():
    """Lỗi hạn mức của nhà cung cấp nằm ở `text` của kết quả — phải giữ lại, không nuốt.

    Đo sống 2026-09-20: lượt `/claude-code` thật trả `{"type": "result", "is_error": true,
    "text": "API Error: Request rejected (429) …"}`, nhưng người dùng chỉ thấy
    "Claude Code task failed" vì executor đọc mỗi khoá `message`.
    """
    event = {'type': 'result', 'is_error': True,
             'text': 'API Error: Request rejected (429) · The provider confirmed that a quota or rate limit was reached.'}

    async def run():
        async def spawn(*args, **kwargs):
            return Process(stream(event))
        with pytest.raises(ValueError) as caught:
            await ClaudeExecutor(spawn=spawn, environment={}).run('abc', 'task', 'build', '', lambda e: None)
        message = str(caught.value)
        assert '429' in message and 'rate limit' in message
    asyncio.run(run())
