"""A6 — `session_search` v2: tra **cả** lịch sử bền, không chỉ 20 checkpoint mới nhất.

Bản cũ: `SELECT messages FROM checkpoints ... ORDER BY id DESC LIMIT 20`, nên một từ chỉ có trong
lần nén thứ 25 là không tìm thấy — mà checkpoint chính là chỗ duy nhất còn giữ transcript trước nén
(đo sống 2026-09-21: 22 hàng / 17 967 616 B trên 12 phiên). Ba nguồn gộp lại: checkpoint (không
`LIMIT 20`), nhật ký, `events` — mỗi nguồn mang mã bản ghi của nó, và khi phải cắt thì nói thẳng.
"""
from __future__ import annotations

import asyncio
import json

from agentbox.agent_core import session_journal
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore

SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'ok': True, 'in': name}

    async def cleanup(self, sid):
        return None


def build(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), None)
    return store, runtime


def test_a_term_from_an_old_checkpoint_beyond_the_twenty_newest_is_still_found(tmp_path):
    store, runtime = build(tmp_path)
    sid = SID
    store.create({'skills': []}, None) if False else None
    # Hàng phiên: dùng chính store để tạo rồi ghi 25 checkpoint, từ mới nhất về cũ nhất.
    session = store.create({'skills': []})
    sid = session['id']
    store.db.execute("INSERT INTO sessions(id, config, messages, status, created, updated, role, parent_id) "
                     "VALUES(?,?,?,?,?,?,?,?)", (sid, '{}', '[]', 'idle', 0, 0, 'orchestrator', None)) \
        if False else None
    for index in range(25):
        text = 'kho lạnh ' + str(index) if index == 0 else f'bước {index}'
        store.checkpoint(sid, [{'role': 'user', 'content': text}], 'prune')

    result = runtime.session_search(sid, {'query': 'kho lạnh'})
    assert [hit['text'] for hit in result['hits']] == ['kho lạnh 0'], \
        'checkpoint cũ nhất (ngoài 20 hàng mới nhất) vẫn phải tìm thấy'
    # Kết quả từ bảng `checkpoints` KHÔNG mang mã `C:`: cột `id` của bảng đó là bộ đếm khác với số
    # file `ck-<sid8>-NNN`, nên một mã `C:<sid8>-<n>` ở đây là mã trỏ vào hư không. Nguồn được nói
    # bằng `source` + `checkpointId`; mã bản ghi chỉ có ở kết quả từ nhật ký.
    assert result['hits'][0]['id'] is None and result['hits'][0]['checkpointId'] == 1
    assert result['hits'][0]['source'] == 'checkpoint'
    store.close()


def test_a_journal_hit_carries_its_record_id(tmp_path):
    async def run():
        store, runtime = build(tmp_path)
        sid = store.create({'skills': []})['id']
        await session_journal.append(runtime.executor, store, sid, 'decision',
                                     'chốt: dùng kho lạnh cho bản ghi cũ', status='approved')
        result = runtime.session_search(sid, {'query': 'kho lạnh'})
        assert len(result['hits']) == 1
        hit = result['hits'][0]
        assert hit['kind'] == 'journal:decision'
        assert hit['id'].startswith('D:') and hit['id'].endswith('-1')
        store.close()

    asyncio.run(run())


def test_a_source_read_to_its_cap_is_reported_as_capped(tmp_path):
    """Đọc tới trần 500 hàng nhật ký mà không nói ra thì "500 bản ghi đầu" bị đọc thành "cả nhật ký"."""
    store, runtime = build(tmp_path)
    sid = store.create({'skills': []})['id']
    for index in range(505):
        store.journal_add(sid, 'step', f'kho lạnh bước {index}', {'record': {'id': f'S:{sid[:8]}-{index}'}})

    result = runtime.session_search(sid, {'query': 'kho lạnh'})

    assert result['capped'] == ['journal'], result
    assert result['truncated'] is True, 'nguồn bị cắt cũng là cắt — không được trả `truncated: false`'
    assert len(result['hits']) == 10, 'vẫn là trần `limit` của lượt tra'
    store.close()


def test_events_are_searched_too(tmp_path):
    store, runtime = build(tmp_path)
    sid = store.create({'skills': []})['id']
    store.emit(sid, 'notice', {'code': 'CHECKPOINT_FILE_FAILED', 'message': 'kho lạnh hỏng'})
    result = runtime.session_search(sid, {'query': 'kho lạnh'})
    assert [hit['kind'] for hit in result['hits']] == ['event']
    assert 'CHECKPOINT_FILE_FAILED' in result['hits'][0]['text']
    store.close()


def test_messages_keep_the_old_shape_and_the_limit_is_capped(tmp_path):
    store, runtime = build(tmp_path)
    sid = store.create({'skills': []})['id']
    for index in range(3):
        store.checkpoint(sid, [{'role': 'assistant', 'content': f'kho lạnh lần {index}'}], 'prune')
    result = runtime.session_search(sid, {'query': 'kho lạnh', 'limit': 2})
    assert [hit['text'] for hit in result['hits']] == ['kho lạnh lần 1', 'kho lạnh lần 2'], \
        'hai kết quả MỚI NHẤT khi limit=2 (sắp theo thời gian tăng dần)'
    assert result['truncated'] is True and result['dropped'] == 1
    assert result['messages'] == [{'role': 'assistant', 'content': 'kho lạnh lần 1'},
                                 {'role': 'assistant', 'content': 'kho lạnh lần 2'}], \
        'khuôn `messages` cũ (role + content) vẫn đọc được'
    # Trần 50: xin 1000 cũng chỉ trả 50.
    for index in range(60):
        store.checkpoint(sid, [{'role': 'user', 'content': f'kho lạnh thêm {index}'}], 'prune')
    capped = runtime.session_search(sid, {'query': 'kho lạnh', 'limit': 1000})
    assert len(capped['hits']) == 50
    store.close()


def test_an_empty_query_is_refused_loudly(tmp_path):
    store, runtime = build(tmp_path)
    sid = store.create({'skills': []})['id']
    try:
        runtime.session_search(sid, {'query': '  '})
    except ValueError as exc:
        assert 'SESSION_SEARCH_EMPTY' in str(exc)
    else:  # pragma: no cover
        raise AssertionError('truy vấn rỗng phải bị từ chối')
    store.close()


def test_the_transcript_is_searched_through_the_tool_entry_point(tmp_path):
    """Đường thật: `dispatch` gọi `session_search` — không chỉ hàm phụ trợ."""
    async def run():
        store, runtime = build(tmp_path)
        session = runtime.create({'skills': [], 'tools': ['session_search'],
                                  'contextWindow': 32768})
        store.checkpoint(session['id'], [{'role': 'user', 'content': 'kho lạnh trong lượt cũ'}], 'prune')
        result = await runtime.dispatch(session, 'session_search', {'query': 'kho lạnh'})
        assert [hit['text'] for hit in result['hits']] == ['kho lạnh trong lượt cũ']
        store.close()

    asyncio.run(run())
