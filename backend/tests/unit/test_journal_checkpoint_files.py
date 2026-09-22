"""Cặp file trước nén + dòng `C:` — lớp mỏng hay bị bỏ sót nhất của workstream A.

Vì sao có tệp này: bản 0.1 của đường này **sống** trên giấy nhưng **chết** trên máy thật. Nó gửi
`journalRecord` không có chữ, nên op trong box từ chối bản ghi (`JOURNAL_DEGRADED`) — mà lỗi đó
xoá luôn kết quả của cả op, nên harness tưởng không có file nào, ghim `CHECKPOINT_FILE_FAILED` sai,
hạ bản ghi xuống `degraded` sai, và `journal.degraded` thành `true` vĩnh viễn cho mọi phiên đã nén.
Hai bộ kiểm cũ đều không bắt được vì mọi fixture đều truyền `text` sẵn.

Bốn điều tệp này khoá lại:

1. Bản ghi gửi xuống box **luôn có chữ** (không có chữ thì không có dòng nào để đọc lại).
2. Dòng `C:` chỉ có **một** bản cho mỗi lần nén (op trong box ghi dòng, harness ghi hàng SQLite) và
   hai bề mặt dùng **cùng một mã** — không sinh hai mã cho một sự việc.
3. Hàng SQLite của lần nén **trỏ vào đúng cặp file** và mang đủ bốn số của N4, trên **đường tự động**
   (đường `/compact` đã có số từ trước).
4. Khi chỉ một phần việc hỏng, thông báo gọi tên đúng phần đó — không hạ cả bản ghi xuống hỏng.
"""
import asyncio
import json

from agentbox.agent_core import session_journal
from agentbox.agent_core.compression import ContextCompressor, estimate_tokens
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


def _reply(text='final', calls=None):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


class _Model:
    def __init__(self, answers):
        self.answers = iter(answers)

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        return next(self.answers)


def _call(index, pad):
    args = {'command': f'echo {index}' + 'c' * pad}
    return {'id': f'call_{index}', 'type': 'function',
            'function': {'name': 'terminal_exec', 'arguments': json.dumps(args)}}


def _fat_history(rows=6, chars=30_000):
    """Kết quả công cụ rất to, ba lượt cuối nhẹ: phần DUY NHẤT tỉa được là thứ vượt ngưỡng."""
    messages = [{'role': 'system', 'content': 'stable'}, {'role': 'user', 'content': 'goal'}]
    for index in range(rows):
        messages.append({'role': 'assistant', 'content': None, 'tool_calls': [_call(index, 200)]})
        messages.append({'role': 'tool', 'tool_call_id': f'call_{index}', 'name': 'terminal_exec',
                         'content': f'[{index}] ' + 'x' * chars})
    for index in range(rows, rows + 3):
        messages.append({'role': 'assistant', 'content': None, 'tool_calls': [_call(index, 20)]})
        messages.append({'role': 'tool', 'tool_call_id': f'call_{index}', 'name': 'terminal_exec',
                         'content': f'[{index}] small'})
    return messages


class BoxExecutor:
    """Executor giả đúng hình dạng op trong box trả về (`session_files.checkpoint_write`).

    `journal_ok=False` mô phỏng ca thật đã xảy ra: cặp file ghi xong, dòng nhật ký bị từ chối;
    `files='degraded'` mô phỏng transcript vượt trần 8 MiB (chỉ có bản `.md`); `boom` mô phỏng op
    chết hẳn.
    """

    def __init__(self, journal_ok=True, files='recorded', boom=False):
        self.calls = []
        self.journal_ok = journal_ok
        self.files = files
        self.boom = boom

    async def execute(self, name, args, sid):
        self.calls.append((name, args))
        if name == 'checkpoint_write':
            if self.boom:
                raise OSError('đĩa đầy')
            short = sid[:8]
            base = f'.session-history/{short}/checkpoints/ck-{short}-001'
            answer = {'ok': True, 'status': self.files, 'checkpointNumber': 1,
                      'messageCount': len(args.get('messages') or []),
                      'messagesBytes': 4096, 'relPath': f'{base}.json',
                      'mdRelPath': f'{base}.md'}
            if self.files == 'degraded':
                answer.update({'relPath': f'{base}.md', 'file': None,
                               'note': 'transcript 9 000 000 B vượt trần 8 388 608 B'})
            if self.journal_ok:
                answer['journal'] = {'ok': True, 'id': f'C:{short}-1', 'relPath': base + '.json'}
            else:
                answer['journal'] = {'ok': False, 'code': 'JOURNAL_DEGRADED',
                                     'error': 'bản ghi nhật ký phải có chữ'}
            return answer
        return {'ok': True}

    async def cleanup(self, sid):
        return None

    def op_names(self):
        return [name for name, _ in self.calls]


def _run(tmp_path, executor, *, window=40_000, command=None):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, executor, _Model([_reply('Goal: older turns.')]))
    session = runtime.create({'skills': [], 'contextWindow': window,
                              'modelId': 'deepseek-v4-flash', 'connectionId': 'c1'})
    seeded = _fat_history()
    assert estimate_tokens(seeded) > ContextCompressor(window).threshold, 'bài này cần transcript quá ngưỡng'
    store.save(session['id'], seeded)

    async def go():
        if command:
            result = await runtime.submit(session['id'], command)
            await runtime.tasks[session['id']]
            return result
        return await runtime.start(session['id'], 'latest')

    asyncio.run(go())
    return store, session, seeded


def _checkpoint_rows(store, sid):
    return [row for row in store.journal_tail(sid, limit=50) if row['kind'] == 'checkpoint']


def _notices(store, sid):
    return [event['data'] for event in store.events(sid) if event['type'] == 'notice']


def test_the_box_gets_a_journal_record_with_words_in_it(tmp_path):
    """Bản 0.1 gửi `{'kind': 'checkpoint'}` trần: box từ chối, và cả op mất kết quả."""
    store, sid = SessionStore(tmp_path / 'x.db'), None
    sid = store.create({'skills': []})['id']
    executor = BoxExecutor()

    asyncio.run(session_journal.write_checkpoint_file(
        executor, store, sid, [{'role': 'user', 'content': 'trước nén'}],
        numbers={'messageCountBefore': 58, 'messageCountAfter': 8}, note='nén theo prune'))

    record = executor.calls[0][1]['journalRecord']
    assert record['kind'] == 'checkpoint'
    assert record['text'].strip(), 'bản ghi không có chữ thì box không có dòng nào để ghi'
    assert '58' in record['text'] and '8' in record['text'], 'chữ phải nói con số của chính lần nén đó'
    store.close()


def test_an_automatic_compaction_leaves_one_c_row_that_points_at_the_files(tmp_path):
    executor = BoxExecutor()
    store, session, seeded = _run(tmp_path, executor)
    sid = session['id']

    rows = _checkpoint_rows(store, sid)
    assert len(rows) == 1, 'một lần nén = một dòng `C:`, không phải hai'
    record = rows[0]['payload']['record']
    short = sid[:8]
    assert record['id'] == f'C:{short}-1', 'mã do box mint, dùng chung cho cả hai bề mặt'
    assert record['status'] == 'recorded'
    assert record['data']['relPath'].endswith('.json') and record['data']['mdRelPath'].endswith('.md'), \
        'đọc `journal.jsonl` phải biết mở đúng file nào, chứ không đoán theo thứ tự tới'
    saved = store.checkpoints(sid)[-1]['messages']
    assert record['numbers']['messageCountBefore'] == len(saved) == len(seeded) + 1, \
        'số tin nhắn ở bản ghi phải là của CHÍNH transcript đã lưu (lượt mới thêm một message)'
    assert record['numbers']['afterEstimate'] < record['numbers']['beforeEstimate'], \
        'lượt tỉa này gỡ chữ trong kết quả công cụ, không bỏ message — số phải nói đúng như vậy'
    assert record['numbers']['contextWindow'] == 40_000

    # Không có op `journal_append` thứ hai cho cùng lần nén: nếu có, mỗi lần nén sinh hai dòng `C:`
    # với hai mã khác nhau.
    assert executor.op_names().count('journal_append') == 0

    assert _notices(store, sid) == [], 'đường sống không được sinh một `notice` nào'

    store_row = store.checkpoints(sid)[-1]
    assert store_row['reason'] == 'prune'
    assert store_row['before_estimate'] and store_row['after_estimate']
    assert store_row['context_window'] == 40_000
    assert store_row['model_id'] == 'deepseek-v4-flash', \
        'N4: hàng checkpoint của đường TỰ ĐỘNG cũng phải tự nói nó đo bằng gì'
    store.close()


def test_the_manual_compact_leaves_the_same_pair_and_row(tmp_path):
    executor = BoxExecutor()
    store, session, _ = _run(tmp_path, executor, command='/compact')
    sid = session['id']

    rows = _checkpoint_rows(store, sid)
    assert len(rows) == 1, '`/compact` là đường dễ bị hỏi "đã nén gì" nhất — phải có bản đọc được'
    assert rows[0]['payload']['record']['data']['relPath'].endswith('.json')
    assert store.checkpoints(sid)[-1]['reason'] == 'manual_compact'
    assert _notices(store, sid) == []
    store.close()


def test_a_missing_journal_line_does_not_hide_the_checkpoint_files(tmp_path):
    """Ca thật của bản 0.1: file có, dòng nhật ký không, thông báo lại nói ngược lại."""
    executor = BoxExecutor(journal_ok=False)
    store, session, _ = _run(tmp_path, executor)
    sid = session['id']

    notices = _notices(store, sid)
    assert [notice['code'] for notice in notices] == [session_journal.JOURNAL_FAILED_CODE], notices
    assert 'bản ghi nhật ký phải có chữ' in notices[0]['message']

    row = _checkpoint_rows(store, sid)[0]
    assert row['payload']['record']['status'] == 'recorded', \
        'cặp file đã ghi xong thì bản ghi không được tự nhận là hỏng'
    assert row['payload']['record']['data']['relPath'].endswith('.json')
    store.close()


def test_a_transcript_over_the_file_ceiling_says_which_part_is_missing(tmp_path):
    executor = BoxExecutor(files='degraded')
    store, session, _ = _run(tmp_path, executor)
    sid = session['id']

    row = _checkpoint_rows(store, sid)[0]['payload']['record']
    assert row['status'] == 'degraded'
    assert '8 388 608' in row['text'], 'lý do thật do box nói, không phải câu đoán sẵn'
    assert 'prune' in row['text'] or 'nén' in row['text']
    store.close()


def test_a_dead_box_op_is_not_described_as_a_size_problem(tmp_path):
    executor = BoxExecutor(boom=True)
    store, session, _ = _run(tmp_path, executor)
    sid = session['id']

    notices = _notices(store, sid)
    assert [notice['code'] for notice in notices] == [session_journal.CHECKPOINT_FAILED_CODE]
    row = _checkpoint_rows(store, sid)[0]['payload']['record']
    assert row['status'] == 'degraded'
    assert 'không ghi được bản đọc được trong box' in row['text']
    assert '8 MiB' not in row['text'], 'không được đoán lý do khi op chết vì việc khác'
    store.close()
