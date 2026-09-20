"""B13 — `thinkingLevel` của một LƯỢT đổi model vẫn phải được đối chiếu.

`POST /turns {"route": {...}}` thay trọn `config['route']` của phiên. Bản trước bỏ
qua kiểm tra khi `route.modelId` khác model đã lưu (`metadata = None`), nên một mức
sai (ví dụ `"ultrapower"`) được lưu nguyên văn và lượt chết ở provider.

Bản sửa: `submit()` (async) tra metadata của CHÍNH model mà route trỏ tới — cùng
nguồn `/api/router/state` như lúc tạo phiên — rồi truyền vào `start()`. Không tra
được thì giữ hành vi cũ (không có cơ sở để phán).
"""
import asyncio
import copy

import pytest

from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


class StubModel:
    """Router client giả: trả lời chat + tra được metadata model khi được hỏi."""

    def __init__(self, responses=(), records=None, with_lookup=True):
        self.responses = iter(responses)
        self.records = records or {}
        self.lookups = []
        if with_lookup:
            self.model_metadata = self._model_metadata

    async def _model_metadata(self, connection_id, model_id):
        self.lookups.append((connection_id, model_id))
        return self.records.get(model_id)

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        return next(self.responses)


class StubExecutor:
    def __init__(self):
        self.container = None

    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def _record(model_id, thinking_type='effort', levels=('low', 'medium', 'high'), default='high'):
    return {'id': model_id, 'contextWindow': 1_000_000, 'thinkingType': thinking_type,
            'thinkingLevels': list(levels), 'defaultThinking': default}


def _turn_response():
    return {'choices': [{'message': {'content': 'done'}, 'finish_reason': 'stop'}]}


MODEL_A = 'gemini-3.6-flash'
MODEL_B = 'claude-sonnet-4-6'


def _runtime(tmp_path, session_values, responses):
    store = SessionStore(tmp_path / 'sessions.db')
    client = StubModel(responses, {MODEL_A: _record(MODEL_A), MODEL_B: _record(MODEL_B, levels=('minimal', 'standard'), default='standard')})
    runtime = HarnessRuntime(store, StubExecutor(), client)
    session = runtime.create(session_values)
    return store, client, runtime, session


def test_turn_route_switch_rejects_level_the_new_model_does_not_publish(tmp_path):
    """Đổi model ở lượt: mức mà model MỚI không công bố phải bị từ chối."""

    async def run():
        store, client, runtime, session = _runtime(
            tmp_path,
            {'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A, 'modelMetadata': _record(MODEL_A)},
            [_turn_response()],
        )
        with pytest.raises(ValueError, match='THINKING_LEVEL_UNSUPPORTED'):
            await runtime.submit(session['id'], 'hello', None,
                                 {'connectionId': 'c1', 'modelId': MODEL_B, 'thinkingLevel': 'ultrapower'})
        assert client.lookups == [('c1', MODEL_B)], 'phải tra metadata của model mà route trỏ tới'
        stored = store.get(session['id'])
        assert stored['config']['route']['modelId'] == MODEL_A, 'route của lượt bị từ chối không được ghi'
        assert 'thinkingLevel' not in stored['config']['route']
        assert stored['status'] != 'running', 'lượt bị từ chối không được chạy'
        store.close()

    asyncio.run(run())


def test_turn_route_switch_normalizes_a_published_level_of_the_new_model(tmp_path):
    """Mức nằm trong danh sách của model MỚI được chuẩn hoá hoa/thường và lưu."""

    async def run():
        store, client, runtime, session = _runtime(
            tmp_path,
            {'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A, 'modelMetadata': _record(MODEL_A)},
            [_turn_response()],
        )
        await runtime.submit(session['id'], 'hello', None,
                             {'connectionId': 'c1', 'modelId': MODEL_B, 'thinkingLevel': 'STANDARD'})
        await runtime.tasks[session['id']]
        route = store.get(session['id'])['config']['route']
        assert route['modelId'] == MODEL_B
        assert route['thinkingLevel'] == 'standard', 'lưu đúng cách viết provider công bố'
        assert client.lookups == [('c1', MODEL_B)]
        store.close()

    asyncio.run(run())


def test_turn_route_switch_drops_level_when_new_model_publishes_none(tmp_path):
    """Model mới không có điều khiển thinking (`fixed`, danh sách rỗng) → DROP, không lỗi."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = StubModel([_turn_response()], {MODEL_A: _record(MODEL_A), MODEL_B: _record(MODEL_B, thinking_type='fixed', levels=())})
        runtime = HarnessRuntime(store, StubExecutor(), client)
        session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A, 'modelMetadata': _record(MODEL_A)})
        await runtime.submit(session['id'], 'hello', None,
                             {'connectionId': 'c1', 'modelId': MODEL_B, 'thinkingLevel': 'high'})
        await runtime.tasks[session['id']]
        route = store.get(session['id'])['config']['route']
        assert route['modelId'] == MODEL_B
        assert 'thinkingLevel' not in route, 'giá trị provider bỏ qua không được lưu'
        store.close()

    asyncio.run(run())


def test_turn_route_switch_validates_even_when_session_has_no_metadata(tmp_path):
    """Phiên tạo không kèm metadata (model lạ lúc tạo): lượt đổi model vẫn đối chiếu."""

    async def run():
        store, client, runtime, session = _runtime(
            tmp_path,
            {'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A},
            [_turn_response()],
        )
        assert 'modelMetadata' not in session['config']
        with pytest.raises(ValueError, match='THINKING_LEVEL_UNSUPPORTED'):
            await runtime.submit(session['id'], 'hello', None,
                                 {'connectionId': 'c1', 'modelId': MODEL_B, 'thinkingLevel': 'ultrapower'})
        store.close()

    asyncio.run(run())


def test_turn_route_keeps_level_verbatim_when_the_router_cannot_be_asked(tmp_path):
    """Không tra được metadata (client không có `model_metadata`): giữ hành vi cũ."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        runtime = HarnessRuntime(store, StubExecutor(), StubModel([_turn_response()], with_lookup=False))
        session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A})
        await runtime.submit(session['id'], 'hello', None,
                             {'connectionId': 'c1', 'modelId': MODEL_B, 'thinkingLevel': 'ultrapower'})
        await runtime.tasks[session['id']]
        route = store.get(session['id'])['config']['route']
        assert route['modelId'] == MODEL_B
        assert route['thinkingLevel'] == 'ultrapower', 'không có cơ sở để phán thì giữ nguyên'
        store.close()

    asyncio.run(run())


def test_turn_route_keeps_the_stored_model_metadata_path_when_model_is_unchanged(tmp_path):
    """Route giữ nguyên model của phiên: dùng metadata đã lưu, KHÔNG gọi router lại."""

    async def run():
        store, client, runtime, session = _runtime(
            tmp_path,
            {'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A, 'modelMetadata': _record(MODEL_A, levels=('low', 'high'))},
            [_turn_response()],
        )
        await runtime.submit(session['id'], 'hello', None,
                             {'connectionId': 'c1', 'modelId': MODEL_A, 'thinkingLevel': 'HIGH'})
        await runtime.tasks[session['id']]
        assert store.get(session['id'])['config']['route']['thinkingLevel'] == 'high'
        assert client.lookups == [], 'cùng model thì metadata đã lưu là đủ'
        store.close()

    asyncio.run(run())


def test_route_metadata_lookup_is_skipped_without_a_thinking_level(tmp_path):
    """Lượt không gửi `thinkingLevel` thì không có gì phải đối chiếu → không tra."""

    async def run():
        store, client, runtime, session = _runtime(
            tmp_path,
            {'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A, 'modelMetadata': _record(MODEL_A)},
            [_turn_response()],
        )
        await runtime.submit(session['id'], 'hello', None, {'connectionId': 'c1', 'modelId': MODEL_B})
        await runtime.tasks[session['id']]
        assert client.lookups == []
        assert store.get(session['id'])['config']['route']['modelId'] == MODEL_B
        store.close()

    asyncio.run(run())


def test_turn_route_copy_is_not_mutated(tmp_path):
    """Route của người gọi không bị sửa tại chỗ (hợp đồng giữ nguyên tham số)."""

    async def run():
        store, client, runtime, session = _runtime(
            tmp_path,
            {'skills': [], 'connectionId': 'c1', 'modelId': MODEL_A, 'modelMetadata': _record(MODEL_A)},
            [_turn_response()],
        )
        route = {'connectionId': 'c1', 'modelId': MODEL_B, 'thinkingLevel': 'STANDARD'}
        before = copy.deepcopy(route)
        await runtime.submit(session['id'], 'hello', None, route)
        await runtime.tasks[session['id']]
        assert route == before
        store.close()

    asyncio.run(run())
