"""Lượt sửa cửa sổ ngữ cảnh của các phiên ĐÃ LƯU, chạy một lần lúc khởi động.

Trước đợt 18 harness tự đoán cửa sổ theo tên model, nên phiên DeepSeek/Qwen nằm
trong `sessions.db` với 64 000 trong khi model thật có 1M. Lượt sửa đọc snapshot
router một lần, tính lại đúng cặp `(số, nguồn)`, và không được đụng vào con số
người dùng tự khai.

N2 (đợt 20) — ngoại lệ của luật "không đụng số người dùng khai": một cửa sổ
`manual` NHỎ HƠN con số router công bố cho đúng model đó thì bị sửa, và mỗi lần
sửa phát một event `context_window_healed`. Đo sống 2026-09-21: 12 phiên còn kẹt
ở 32 768 ×9, 16 384 ×1, 8 192 ×2 — ngưỡng nén tương ứng 20 070 / 8 602 / 2 867
token, tức phiên bị gộp ở ~2 % cửa sổ thật, còn phiên `43a92d61` đã có request
thật 29 908 token = 1,49× ngưỡng của chính nó. Số LỚN HƠN người dùng khai vẫn
được giữ nguyên: hạ nó là cắt mất ngữ cảnh người dùng cố ý mở rộng.
"""
import asyncio
import copy
import json

from aiohttp.test_utils import TestServer
from aiohttp import ClientSession

from agentbox.agent_core.runtime import CONTEXT_WINDOW_LOCK_ENV, HarnessRuntime
from agentbox.memory.session_store import SessionStore
from agentbox.api.server import create_app

# Host phải nằm trong allow-list của harness (TestServer mở cổng ngẫu nhiên), đúng khuôn
# test_decision_flow; không gửi Origin thì boundary dùng mặc định http://localhost:3100.
HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}


class FixtureModel:
    def __init__(self, responses=()):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append(copy.deepcopy((messages, tools, route)))
        return next(self.responses)


class FixtureExecutor:
    def __init__(self):
        self.calls = []

    async def execute(self, name, args, sid):
        self.calls.append((name, args, sid))
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


class FixtureRouterClient:
    """Router giả: đếm số lần đọc snapshot để chứng minh lượt sửa chỉ đọc MỘT lần."""

    def __init__(self, records=None, answer=True):
        self.records = records or {}
        self.answer = answer
        self.calls = 0

    async def model_metadata_map(self):
        self.calls += 1
        return dict(self.records) if self.answer else {}


def records(*pairs):
    """Bản đồ record giống `/api/router/state`: khoá là (connectionId, modelId)."""
    return {(connection, model): {'id': model, 'contextWindow': window, 'contextWindowSource': source}
            for connection, model, window, source in pairs}


def stale_session(runtime, connection='c1', model='deepseek-v4-flash', window=64000):
    """Một phiên đúng như bản cũ để lại: số cũ, không có nhãn nguồn."""
    session = runtime.create({'skills': [], 'connectionId': connection, 'modelId': model})
    config = session['config']
    config['contextWindow'] = window
    config.pop('contextWindowSource', None)
    runtime.store.update_config(session['id'], config)
    return session


def test_heal_rewrites_stale_sessions_from_the_router_table(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    client = FixtureRouterClient(records(('c1', 'deepseek-v4-flash', 1048576, 'documented')))
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    first = stale_session(runtime)
    second = stale_session(runtime)
    # Model mà router không còn liệt kê: con số cũ (64 000 do bảng đoán theo tên) rơi về
    # SÀN có nhãn — đúng bằng thứ một phiên mới cùng model sẽ nhận hôm nay.
    unknown_to_router = stale_session(runtime, model='deepseek-r1', window=64000)

    healed = asyncio.run(runtime.heal_context_windows())
    assert healed == 3, 'hai phiên V4 lấy số bảng, phiên còn lại rơi về sàn có nhãn'
    assert store.get(first['id'])['config']['contextWindow'] == 1048576
    assert store.get(first['id'])['config']['contextWindowSource'] == 'documented'
    assert store.get(second['id'])['config']['contextWindow'] == 1048576
    assert store.get(unknown_to_router['id'])['config']['contextWindow'] == 256000
    assert store.get(unknown_to_router['id'])['config']['contextWindowSource'] == 'fallback'
    assert client.calls == 1, 'một snapshot cho mọi phiên, không phải N lời gọi'

    assert asyncio.run(runtime.heal_context_windows()) == 0, 'lượt sửa lần hai không đổi gì'
    store.close()


def test_heal_raises_a_manual_window_that_is_smaller_than_the_router_knows(tmp_path):
    """N2: số người dùng khai NHỎ hơn thật thì bị sửa, và mỗi lần sửa có một event."""
    store = SessionStore(tmp_path / 'sessions.db')
    client = FixtureRouterClient(records(('c1', 'deepseek-flash', 1000000, 'documented')))
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    typed = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-flash',
                            'contextWindow': 32768, 'contextWindowSource': 'manual'})
    assert typed['config']['contextWindow'] == 32768

    assert asyncio.run(runtime.heal_context_windows()) == 1
    healed = store.get(typed['id'])['config']
    assert healed['contextWindow'] == 1000000
    assert healed['contextWindowSource'] == 'documented'
    events = [e for e in store.events(typed['id']) if e['type'] == 'context_window_healed']
    assert len(events) == 1, 'một lần sửa, một event — không phát lại mỗi lần khởi động'
    assert events[0]['data'] == {'from': 32768, 'to': 1000000, 'modelId': 'deepseek-flash',
                                 'source': 'router'}
    assert asyncio.run(runtime.heal_context_windows()) == 0, 'lần hai không còn gì để sửa'
    assert len([e for e in store.events(typed['id']) if e['type'] == 'context_window_healed']) == 1
    store.close()


def test_heal_never_touches_a_window_the_user_declared_larger(tmp_path):
    """Số LỚN HƠN router là lựa chọn của người dùng: sửa nó là cắt mất ngữ cảnh họ mở rộng."""
    store = SessionStore(tmp_path / 'sessions.db')
    client = FixtureRouterClient(records(('c1', 'deepseek-v4-flash', 1048576, 'documented')))
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    typed = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-v4-flash',
                            'contextWindow': 32768, 'contextWindowSource': 'manual'})
    assert typed['config']['contextWindowSource'] == 'manual'
    # Cùng model đó, nhưng người dùng khai một cửa sổ rộng hơn cả bảng của router (trần khai
    # tay của `resolve_context_window` là 2 000 000, nên 1 500 000 là con số hợp lệ và lớn hơn).
    generous = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-v4-flash',
                               'contextWindow': 1500000, 'contextWindowSource': 'manual'})

    assert asyncio.run(runtime.heal_context_windows()) == 1, 'chỉ phiên 32 768 bị sửa'
    assert store.get(typed['id'])['config']['contextWindow'] == 1048576
    assert store.get(generous['id'])['config']['contextWindow'] == 1500000
    assert store.get(generous['id'])['config']['contextWindowSource'] == 'manual'
    assert not [e for e in store.events(generous['id']) if e['type'] == 'context_window_healed']
    store.close()


def test_heal_can_be_locked_off_entirely(tmp_path, monkeypatch):
    """`BOXFOX_CONTEXT_WINDOW_LOCK=1`: không sửa hàng nào, không phát event nào."""
    monkeypatch.setenv(CONTEXT_WINDOW_LOCK_ENV, '1')
    store = SessionStore(tmp_path / 'sessions.db')
    client = FixtureRouterClient(records(('c1', 'deepseek-v4-flash', 1048576, 'documented')))
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    stale = stale_session(runtime)
    typed = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-v4-flash',
                            'contextWindow': 32768, 'contextWindowSource': 'manual'})

    assert asyncio.run(runtime.heal_context_windows()) == 0
    assert client.calls == 0, 'khoá rồi thì không cần đọc cả snapshot của router'
    assert store.get(stale['id'])['config']['contextWindow'] == 64000
    assert store.get(typed['id'])['config']['contextWindow'] == 32768
    store.close()


def test_heal_labels_an_event_from_the_fallback_floor(tmp_path):
    """Model router không liệt kê: con số mới là SÀN, và event phải nói đúng như vậy."""
    store = SessionStore(tmp_path / 'sessions.db')
    client = FixtureRouterClient(records(('c1', 'deepseek-v4-flash', 1048576, 'documented')))
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    typed = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'still-unknown-model',
                            'contextWindow': 8192, 'contextWindowSource': 'manual'})

    assert asyncio.run(runtime.heal_context_windows()) == 1
    config = store.get(typed['id'])['config']
    assert (config['contextWindow'], config['contextWindowSource']) == (256000, 'fallback')
    event = next(e for e in store.events(typed['id']) if e['type'] == 'context_window_healed')
    assert event['data']['source'] == 'fallback'
    assert event['data']['from'] == 8192 and event['data']['to'] == 256000
    store.close()


def test_heal_leaves_sessions_without_a_route_or_without_a_router_alone(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureRouterClient(records(), answer=False))
    orphan = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-v4-flash'})
    config = orphan['config']
    config['contextWindow'] = 64000
    config.pop('contextWindowSource', None)
    runtime.store.update_config(orphan['id'], config)
    no_route = runtime.create({'skills': []})
    assert 'connectionId' not in no_route['config']['route']

    assert asyncio.run(runtime.heal_context_windows()) == 0, 'router im lặng thì không sửa gì'
    assert store.get(orphan['id'])['config']['contextWindow'] == 64000
    assert 'contextWindowSource' not in store.get(orphan['id'])['config']
    assert store.get(no_route['id'])['config']['contextWindow'] == 256000
    store.close()


def test_app_startup_runs_the_heal_once(tmp_path):
    """Đường nối thật: `create_app` gắn lượt sửa vào on_startup của aiohttp."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureRouterClient(records(('c1', 'deepseek-v4-flash', 1048576, 'documented')))
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        session = stale_session(runtime)
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(headers=HEADERS) as http:
                async with http.get(str(server.make_url('/api/agent/sessions')) + '/' + session['id']) as resp:
                    assert resp.status == 200
                    payload = await resp.json()
        assert payload['config']['contextWindow'] == 1048576, 'phiên cũ đã được sửa ngay lúc khởi động'
        assert payload['config']['contextWindowSource'] == 'documented'
        assert client.calls == 1
        store.close()

    asyncio.run(run())
