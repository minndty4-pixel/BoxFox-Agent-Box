"""`assistant_delta`/`thought` events must carry the NEW part of the answer only.

Bản cũ phát văn bản TÍCH LUỸ: mỗi `assistant_delta` mang toàn bộ câu trả lời tính
đến lúc đó. Một consumer chỉ biết cộng chuỗi (SubagentInspectorPanel) vì thế in
lại toàn bộ câu trả lời một lần cho mỗi token — đúng hiện tượng người dùng thấy
trong file .md do sub-agent trả về, và mỗi event còn lưu lại toàn bộ văn bản vào
database.

Bản sửa: `_run` cắt phần mới (`_suffix`) trước khi emit. Router vẫn gọi callback
với văn bản tích luỹ, nên mọi adapter giữ nguyên hành vi.
"""
import asyncio

import pytest

from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


class StreamingModel:
    """Giả lập router: gọi `on_content`/`on_thought` với văn bản TÍCH LUỸ."""

    def __init__(self, content_sequence=(), thought_sequence=(), fail_first=False):
        self.content_sequence = list(content_sequence)
        self.thought_sequence = list(thought_sequence)
        self.fail_first = fail_first
        self.calls = 0

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.calls += 1
        if self.fail_first and self.calls == 1:
            raise ServerDisconnectedError()
        accumulated = ''
        for piece in self.content_sequence:
            accumulated += piece
            if on_content:
                result = on_content(accumulated)
                if asyncio.iscoroutine(result):
                    await result
        reasoning = ''
        for piece in self.thought_sequence:
            reasoning += piece
            if on_thought:
                result = on_thought(reasoning)
                if asyncio.iscoroutine(result):
                    await result
        text = accumulated or 'done'
        return {'choices': [{'message': {'content': text, 'reasoning_content': reasoning or None},
                             'finish_reason': 'stop'}], 'usage': None, 'boxfox': None}


class ServerDisconnectedError(Exception):
    """Tên lớp giống aiohttp: `str()` rỗng — nguồn gốc của 'Agent run failed'."""


class StubExecutor:
    def __init__(self):
        self.container = None

    async def execute(self, name, args, sid):
        return {'content': 'fixture'}

    async def cleanup(self, sid):
        return None


def _runtime(tmp_path, client):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, StubExecutor(), client)
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm1', 'timeoutSeconds': 30})
    return store, runtime, session


def test_assistant_delta_events_carry_only_the_new_part(tmp_path):
    async def run():
        client = StreamingModel(content_sequence=['Kế hoạch chi', ' tiết cho', ' agent'])
        store, runtime, session = _runtime(tmp_path, client)
        await runtime.submit(session['id'], 'viết kế hoạch')
        await runtime.tasks[session['id']]
        deltas = [event['data']['text'] for event in store.events(session['id']) if event['type'] == 'assistant_delta']
        assert deltas == ['Kế hoạch chi', ' tiết cho', ' agent'], deltas
        assert ''.join(deltas) == 'Kế hoạch chi tiết cho agent'
        # Không event nào được phép lặp lại phần đã phát.
        seen = ''
        for piece in deltas:
            assert piece not in seen or piece == '', 'phần mới không được trùng văn bản đã phát'
            seen += piece
        store.close()

    asyncio.run(run())


def test_thought_events_carry_only_the_new_part(tmp_path):
    async def run():
        client = StreamingModel(content_sequence=['xong'], thought_sequence=['Cần đọc', ' file', ' trước'])
        store, runtime, session = _runtime(tmp_path, client)
        await runtime.submit(session['id'], 'hỏi')
        await runtime.tasks[session['id']]
        thoughts = [event['data']['text'] for event in store.events(session['id']) if event['type'] == 'thought']
        # Ba event đầu là phần MỚI; event cuối là bản ghi chuẩn của cả lượt
        # (consumer ghép theo tiền tố nên bản ghi chuẩn không nhân đôi văn bản).
        assert thoughts[:3] == ['Cần đọc', ' file', ' trước'], thoughts
        assert thoughts[-1] == 'Cần đọc file trước', thoughts
        store.close()

    asyncio.run(run())


def test_transient_upstream_failure_is_retried_once(tmp_path, monkeypatch):
    async def run():
        async def fast_sleep(_seconds):
            return None

        monkeypatch.setattr(asyncio, 'sleep', fast_sleep)
        client = StreamingModel(content_sequence=['đã trả lời'], fail_first=True)
        store, runtime, session = _runtime(tmp_path, client)
        await runtime.submit(session['id'], 'hỏi lại')
        await runtime.tasks[session['id']]
        events = store.events(session['id'])
        assert client.calls == 2, 'lỗi tạm thời phải được thử lại đúng một lần'
        assert store.get(session['id'])['status'] == 'completed'
        notice = [event for event in events if event['type'] == 'notice']
        assert notice and notice[0]['data']['code'] == 'UPSTREAM_RETRY'
        assert [event for event in events if event['type'] == 'finish']
        store.close()

    asyncio.run(run())


def test_failure_message_is_never_empty_and_carries_a_code(tmp_path):
    """Lỗi với `str(exc)` rỗng vẫn phải cho người dùng một câu đọc được."""

    async def run():
        class AlwaysBroken(StreamingModel):
            async def complete(self, *args, **kwargs):
                raise ServerDisconnectedError()

        store, runtime, session = _runtime(tmp_path, AlwaysBroken())
        await runtime.submit(session['id'], 'hỏi')
        await runtime.tasks[session['id']]
        errors = [event for event in store.events(session['id']) if event['type'] == 'error']
        assert errors, 'phải có event error'
        payload = errors[-1]['data']
        assert payload['message'].strip() != '', 'thông báo lỗi không được rỗng'
        assert 'Agent run failed' not in payload['message']
        assert payload['code'] == 'UPSTREAM_UNREACHABLE'
        assert store.get(session['id'])['status'] == 'failed'
        store.close()

    asyncio.run(run())
