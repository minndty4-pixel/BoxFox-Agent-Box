"""CLI protocol simulator; no network, credentials or Docker mutations."""
import asyncio
import json
import pytest
from agentbox.sandbox.claude_executor import ClaudeExecutor


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
        executor = ClaudeExecutor('isolated-test-box', spawn)
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
            await ClaudeExecutor(spawn=spawn).run('abc', 'task', 'build', '', lambda e: None)
        assert len(processes) == 2
        assert json.loads(processes[1].stdin.value)['session'] == 'abc'
    asyncio.run(run())


@pytest.mark.parametrize('action', ['timeout', 'cancel'])
def test_stop_reaches_container_process_group(action):
    async def run():
        processes = []
        async def spawn(*args, **kwargs):
            p = Process(hang=not processes); processes.append(p); return p
        executor = ClaudeExecutor(spawn=spawn)
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
            result = await ClaudeExecutor(spawn=spawn).probe()
            assert result['status'] == 'setup_required'
        except ValueError:
            assert payload == b'{bad json}\n'
    asyncio.run(run())
