"""Nhật ký phiên ở nửa harness (`agent_core/session_journal.py`) — việc A4/A5/A7.

Ba điều phải đúng, vì cả ba đều là chỗ đã hỏng thật trên máy chủ nhà:

1. **Lỗi ghi ra file không giết một lượt** — nhưng cũng **không im**: có `notice` với mã nói rõ.
2. **Hàng SQLite là nguồn của khối ký ức**, nên `brief()` vẫn có nội dung kể cả khi tầng file trong
   box hỏng (đúng ca "22 hàng checkpoint không có bản đọc được nào").
3. **Chèn khối ký ức là idempotent** — dựng lại ở đầu mỗi lượt và sau mỗi lần nén không được chồng
   khối lên nhau (system prompt phình ra là ngữ cảnh chết).
"""
import asyncio

from agentbox.agent_core import journal, session_journal
from agentbox.memory.session_store import SessionStore


class _Executor:
    """Executor giả: ghi lại lời gọi, và có thể hỏng theo yêu cầu."""

    def __init__(self, answer=None, boom=None):
        self.calls = []
        self.answer = answer or {'ok': True}
        self.boom = boom

    async def execute(self, name, args, session):
        self.calls.append((name, args, session))
        if self.boom is not None:
            raise self.boom
        return self.answer


def _store(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    sid = store.create({'skills': []})['id']
    return store, sid


def test_a_checkpoint_file_write_is_sent_to_the_box_with_the_numbers(tmp_path):
    store, sid = _store(tmp_path)
    executor = _Executor({'ok': True, 'status': 'recorded', 'checkpointNumber': 3})

    answer = asyncio.run(session_journal.write_checkpoint_file(
        executor, store, sid, [{'role': 'user', 'content': 'trước nén'}],
        numbers={'checkpointNumber': 3, 'rowId': 7}, note='nén lần 3'))

    assert executor.calls[0][0] == 'checkpoint_write'
    assert executor.calls[0][1]['messages'] == [{'role': 'user', 'content': 'trước nén'}]
    assert executor.calls[0][1]['numbers']['rowId'] == 7
    assert answer['checkpointNumber'] == 3


def test_a_failing_box_write_becomes_one_notice_and_never_raises(tmp_path):
    store, sid = _store(tmp_path)
    executor = _Executor(boom=RuntimeError('container tắt'))

    answer = asyncio.run(session_journal.write_checkpoint_file(
        executor, store, sid, [{'role': 'user', 'content': 'x'}]))

    assert answer is None
    notices = [event for event in store.events(sid) if event['type'] == 'notice']
    assert len(notices) == 1
    assert notices[0]['data']['code'] == session_journal.CHECKPOINT_FAILED_CODE
    assert 'container tắt' in notices[0]['data']['message']


def test_a_box_refusal_is_reported_with_its_own_code(tmp_path):
    store, sid = _store(tmp_path)
    executor = _Executor({'ok': False, 'error': 'SESSION_FILES_BAD_ARGS'})

    assert asyncio.run(session_journal.append(executor, store, sid, 'evidence', 'ảnh đã lưu')) is not None
    notices = [event for event in store.events(sid) if event['type'] == 'notice']
    assert notices and notices[0]['data']['code'] == session_journal.JOURNAL_FAILED_CODE


def test_the_journal_row_is_written_even_when_the_file_layer_fails(tmp_path):
    store, sid = _store(tmp_path)
    executor = _Executor(boom=OSError('đĩa đầy'))

    asyncio.run(session_journal.append(executor, store, sid, 'task', 'việc: nén ngữ cảnh',
                                       numbers={'steps': 0}))

    rows = store.journal_tail(sid)
    assert len(rows) == 1 and rows[0]['kind'] == 'task'
    # Mã `T:<sid8>-<n>` cần số `seq` mà SQLite chỉ trả về sau khi chèn, nên nó nằm trong payload
    # của chính hàng vừa tạo — và vẫn phải có, dù tầng file trong box hỏng.
    assert rows[0]['payload']['record']['id'] == f"T:{sid[:8]}-{rows[0]['seq']}"
    assert 'việc: nén ngữ cảnh' in rows[0]['text']


def test_the_brief_is_rebuilt_from_the_rows_and_replaces_itself(tmp_path):
    store, sid = _store(tmp_path)
    executor = _Executor()

    assert session_journal.brief(store, sid) == '', 'lượt đầu chưa có gì để nhớ'

    asyncio.run(session_journal.append(executor, store, sid, 'task', 'việc: nén ngữ cảnh'))
    asyncio.run(session_journal.append(executor, store, sid, 'checkpoint', 'gộp 58 tin nhắn',
                                       numbers={'messageCountBefore': 58, 'messageCountAfter': 8}))
    asyncio.run(session_journal.append(executor, store, sid, 'blocker', 'hết hạn chót ở bước 20',
                                       status='blocked'))
    block = session_journal.brief(store, sid)
    assert block.startswith(journal.JOURNAL_BRIEF_HEADER)
    assert 'việc: nén ngữ cảnh' in block, '`T:` mở việc → nhóm mục tiêu'
    assert 'gộp 58 tin nhắn' in block, '`C:` xếp vào nhóm đã xong'
    assert 'hết hạn chót ở bước 20' in block, '`X:` xếp vào nhóm đang tắc'
    # `F:` (fact) cố ý KHÔNG có nhóm trong khối ký ức — nó để tra cứu, không phải để nhắc lại mỗi
    # lượt; vẫn phải đọc được qua `journal_tail`.
    asyncio.run(session_journal.append(executor, store, sid, 'fact', 'ngưỡng nén 1M nay là 200 000'))
    assert 'ngưỡng nén 1M nay là 200 000' not in session_journal.brief(store, sid)
    assert any('ngưỡng nén' in row['text'] for row in store.journal_tail(sid))

    once = session_journal.inject_brief('ROLE + HƯỚNG DẪN', block)
    twice = session_journal.inject_brief(once, block)
    assert once == twice, 'ghép lại không được chồng khối thứ hai'
    assert once.count(journal.JOURNAL_BRIEF_HEADER) == 1
    assert once.startswith('ROLE + HƯỚNG DẪN')

    assert session_journal.inject_brief(once, '') == 'ROLE + HƯỚNG DẪN', 'không có khối thì bỏ khối cũ'


def test_a_missing_executor_skips_the_file_layer_silently(tmp_path):
    """Harness không sandbox (test, chạy ngoài box): hàng SQLite vẫn có, không notice, không ném."""
    store, sid = _store(tmp_path)
    asyncio.run(session_journal.append(None, store, sid, 'step', 'bước 1 xong', status='done'))
    assert [row['kind'] for row in store.journal_tail(sid)] == ['step']
    assert [event for event in store.events(sid) if event['type'] == 'notice'] == []
