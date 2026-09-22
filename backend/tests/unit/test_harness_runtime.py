import asyncio
import copy
import hashlib
import json
from pathlib import Path
import pytest
from agentbox.agent_core import evidence_gate
from agentbox.agent_core.runtime import HarnessRuntime, RouterClient
from agentbox.agent_core.roles import ROLES, allowed_tools
from agentbox.agent_core.compression import ContextCompressor
from agentbox.agent_core.tool_contracts import schemas_for
from agentbox.memory.session_store import SessionStore
from agentbox.skills.catalog import SkillCatalog
from agentbox.api.server import create_app


def answer(text='done', calls=None, finish='stop'):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else finish}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


def call(name, args, cid='c1'):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


class FixtureModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append(copy.deepcopy((messages, tools, route)))
        return next(self.responses)


class FixtureExecutor:
    def __init__(self):
        self.calls = []
        self.cleaned = []

    async def execute(self, name, args, sid):
        self.calls.append((name, args, sid))
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        self.cleaned.append(sid)


def test_first_turn_ensures_the_session_dir_once(tmp_path):
    """A1: op `session_ensure` chạy ở LƯỢT ĐẦU (thư mục phiên sinh ở lần ghi đầu tiên) và đúng một
    lần cho mỗi phiên — lượt sau không trả thêm một `docker exec` không cần thiết.
    """
    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        executor = FixtureExecutor()
        client = FixtureModel([answer('xong'), answer('xong lần hai')])
        runtime = HarnessRuntime(store, executor, client)
        s = runtime.create({'skills': []}, role='plan')
        await runtime.start(s['id'], 'Lượt một')
        ensures = [args for name, args, _ in executor.calls if name == 'session_ensure']
        assert len(ensures) == 1, 'lượt đầu phải gọi op tạo thư mục phiên'
        assert ensures[0] == {'session': s['id'], 'role': 'plan', 'parent': None, 'goal': None}, \
            'session.json phải nói được sid8 nào là phiên nào (và vai gì)'
        await runtime.start(s['id'], 'Lượt hai')
        assert [name for name, _, _ in executor.calls].count('session_ensure') == 1, \
            'cùng một phiên: một lần ensure cho cả tiến trình'
        store.close()
    asyncio.run(run())


def test_multiturn_restart_and_isolation(tmp_path):
    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer('alpha'), answer('beta')])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        s = runtime.create({'skills': []})
        await runtime.start(s['id'], 'Remember cedar 481')
        original_prompt = store.get(s['id'])['messages'][0]
        await runtime.start(s['id'], 'What did I say?')
        assert client.requests[1][0][0] == original_prompt
        assert 'cedar 481' in json.dumps(client.requests[1][0])
        other = runtime.create({'skills': []})
        assert 'cedar 481' not in json.dumps(other['messages'])
        before = store.get(s['id'])['messages']
        store.close()
        restored = SessionStore(tmp_path / 'sessions.db')
        assert restored.get(s['id'])['messages'] == before
        assert restored.events(s['id'])
        restored.close()
    asyncio.run(run())


@pytest.mark.parametrize('role', list(ROLES))
def test_each_specialist_policy_and_lineage(tmp_path, role):
    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer(calls=[call('delegate_task', {'role': role, 'goal': 'Inspect your scope'})]), answer('child evidence'), answer('parent final')])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        s = runtime.create({'skills': []})
        await runtime.start(s['id'], 'Delegate to ' + role)
        event = next(e for e in store.events(s['id']) if e['type'] == 'child')
        child = store.get(event['data']['sessionId'])
        assert child['parent_id'] == s['id'] and child['role'] == role
        assert child['status'] == 'completed'
        assert set(child['config']['tools']) <= set(s['config']['tools'])
        assert 'delegate_task' not in child['config']['tools']
        assert ROLES[role].instructions in child['messages'][0]['content']
        assert any(m['role'] == 'tool' and 'child evidence' in m['content'] for m in store.get(s['id'])['messages'])
        store.close()
    asyncio.run(run())


def test_denied_tool_and_malformed_args_never_execute(tmp_path):
    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        invalid = call('file_read', {})
        invalid['function']['arguments'] = '{invalid'
        client = FixtureModel([answer(calls=[call('file_write', {'path': 'x', 'content': 'bad'}), invalid]), answer()])
        executor = FixtureExecutor()
        runtime = HarnessRuntime(store, executor, client)
        s = runtime.create({'skills': []}, role='review')
        await runtime.start(s['id'], 'Inspect')
        # `session_ensure` (A1) là op hạ tầng được phép chạm executor ở đây: nó dọn thư mục phiên lúc
        # bắt đầu lượt, không phải một công cụ. Cổng bằng chứng (P3.2, vòng 22) cũng vậy: nó tự chạy
        # MỘT phép dò `find` rồi ghi kết quả dò vào thư mục bằng chứng — việc của harness, không phải
        # công cụ của model. Nhận diện hai lời gọi đó bằng **dấu vết của chính chúng** (lệnh `find`
        # cố định, thư mục bằng chứng), KHÔNG bằng tên op: lọc theo tên thì chính cú `file_write` mà
        # model gọi trong lượt này cũng lọt qua phép kiểm.
        def infra_only(name, args):
            if name == 'session_ensure':
                return True
            if name == 'terminal_exec':
                return str(args.get('command') or '').startswith('cd /home/agent/workspace && find .')
            return str(args.get('path') or '').startswith(evidence_gate.EVIDENCE_ROOT_REL)

        assert [name for name, args, _ in executor.calls if not infra_only(name, args)] == []
        results = [m for m in store.get(s['id'])['messages'] if m['role'] == 'tool']
        assert all('error' in m['content'] for m in results)
        store.close()
    asyncio.run(run())


def test_disabled_child_and_budget(tmp_path):
    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel([answer(calls=[call('delegate_task', {'role': 'research', 'goal': 'x'})])]))
        s = runtime.create({'skills': [], 'subagents': [], 'maxSteps': 1})
        await runtime.start(s['id'], 'Try disabled child')
        assert store.get(s['id'])['status'] == 'failed'
        assert 'disabled' in store.get(s['id'])['messages'][-1]['content']
        # B2 (vòng 22): mã `MAX_STEPS` chung chung tách thành `STEP_BUDGET_EXHAUSTED`.
        assert 'STEP_BUDGET_EXHAUSTED' in store.events(s['id'])[-1]['data']['message']
        store.close()
    asyncio.run(run())


def test_stop_busy_and_resume_no_replayed_tool(tmp_path):
    async def run():
        entered = asyncio.Event()
        class Waiting(FixtureExecutor):
            async def execute(self, name, args, sid):
                # A1: `session_ensure` chạy ở đầu lượt và phải trả NGAY — nếu nó cũng treo thì lượt
                # không bao giờ tới được công cụ đang chờ, và phép kiểm này không còn nói về ca
                # "công cụ đang chạy thì bị stop".
                if name == 'session_ensure':
                    return {'ok': True, 'session': sid}
                entered.set()
                await asyncio.Event().wait()
        executor = Waiting()
        store = SessionStore(tmp_path / 'sessions.db')
        model = FixtureModel([answer(calls=[call('terminal_exec', {'command': 'sleep 100'})]), answer('resumed')])
        runtime = HarnessRuntime(store, executor, model)
        s = runtime.create({'skills': []})
        runtime.start(s['id'], 'start')
        await asyncio.wait_for(entered.wait(), 3)
        with pytest.raises(ValueError, match='SESSION_BUSY'):
            runtime.start(s['id'], 'duplicate')
        await runtime.stop(s['id'])
        assert store.get(s['id'])['status'] == 'cancelled'
        assert s['id'] in executor.cleaned
        await runtime.start(s['id'], 'resume by inspection only')
        assert 'Interrupted before result' in str(model.requests[-1][0])
        assert store.get(s['id'])['status'] == 'completed'
        store.close()
    asyncio.run(run())


def test_compaction_keeps_pairs_goal_and_prefix():
    async def run():
        messages = [{'role': 'system', 'content': 'stable'}]
        for i in range(6):
            messages.extend([{'role': 'user', 'content': f'goal-{i}'},
                {'role': 'assistant', 'content': '', 'tool_calls': [call('file_read', {'path': 'x'}, str(i))]},
                {'role': 'tool', 'tool_call_id': str(i), 'name': 'file_read', 'content': 'x' * 2200},
                {'role': 'assistant', 'content': 'result ' + 'y' * 1200}])
        messages.append({'role': 'user', 'content': 'LATEST GOAL'})
        original = copy.deepcopy(messages)
        async def summary(history, max_tokens=None):
            return answer('Goal: previous work. Evidence: six tool results. Outstanding: latest task.')
        result, event = await ContextCompressor(7000).compact(messages, [], summary)
        assert event['kind'] == 'summary'
        assert result[0] == messages[0] and result[-1] == messages[-1]
        assert messages == original
        call_ids = {c['id'] for m in result for c in m.get('tool_calls', [])}
        assert call_ids == {m['tool_call_id'] for m in result if m['role'] == 'tool'}
        async def bad_summary(history):
            return answer('partial', finish='length')
        with pytest.raises(ValueError, match='original transcript preserved'):
            await ContextCompressor(7000).compact(messages, [], bad_summary)
        assert messages == original
    asyncio.run(run())


def test_skills_are_full_upstream_and_path_safe():
    catalog = SkillCatalog()
    assert len(catalog.items) == 208
    for sid, item in catalog.items.items():
        read = catalog.read(sid)
        assert hashlib.sha256(read['content'].encode()).hexdigest() == item['sha256']
    with pytest.raises(ValueError):
        catalog.read('systematic-debugging', '../../LICENSE')
    assert len(catalog.read('systematic-debugging')['content']) > 1000


def test_http_router_auth_and_agent_session_api(tmp_path):
    from aiohttp import web, ClientSession
    from aiohttp.test_utils import TestServer
    async def run():
        received = []
        async def upstream(request):
            assert request.headers['x-boxfox-admin'] == '1'
            payload = await request.json()
            received.append(payload)
            return web.json_response(answer('HTTP evidence'))
        router = web.Application()
        router.router.add_post('/api/router/chat', upstream)
        async with TestServer(router) as router_server:
            store = SessionStore(tmp_path / 'sessions.db')
            runtime = HarnessRuntime(store, FixtureExecutor(), RouterClient(str(router_server.make_url('')).rstrip('/')))
            async with TestServer(create_app(runtime)) as server:
                async with ClientSession(headers={'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}) as client:
                    url = str(server.make_url('/api/agent'))
                    async with client.get(url + '/catalog') as resp:
                        assert len((await resp.json())['roles']) == 9
                    async with client.post(url + '/sessions', json={'skills': []}) as resp:
                        assert resp.status == 201
                        sid = (await resp.json())['id']
                    async with client.post(url + '/sessions/' + sid + '/turns', json={'prompt': 'hello'}) as resp:
                        assert resp.status == 202
                    await runtime.tasks[sid]
                    async with client.get(url + '/sessions/' + sid) as resp:
                        assert (await resp.json())['status'] == 'completed'
                    async with client.get(url + '/catalog', headers={'Origin': 'https://evil.example'}) as resp:
                        assert resp.status == 403
                    assert received[0]['messages'][-1]['content'] == 'hello'
    asyncio.run(run())
