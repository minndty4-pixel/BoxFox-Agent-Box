"""T6 + T7 — sinh con KHÔNG chặn, và dọn con khi lượt cha đóng (vòng 22).

Hai việc này phải vào cùng nhau. `wait=false` (T6) cho cha sinh nhiều con rồi mới chờ (L1/L2 chỉ
chạy được nếu lệnh sinh không chặn), nhưng nó mở ra một trạng thái mới: **lượt cha đóng trong khi
con vẫn chạy**. Không có người dọn (T7) thì phiên con sống mồ côi — không ai đọc kết quả, slot
không bao giờ nhả, giao diện vẫn thấy "đang chạy" sau khi câu trả lời cuối đã xong.

Bộ kiểm này khẳng định cả hai mặt: (1) `wait=false` trả `sessionId` ngay và tool result KHÔNG có
`summary`; (2) lượt cha đóng ⇒ mỗi con còn `started` của CHÍNH lượt đó thành `failed` +
`PARENT_TURN_ENDED`, có đúng một event `child` kết thúc, một hàng `X:` trong nhật ký, `runtime.tasks`
không còn sid của con, và trần fan-out về đủ. `wait=true` giữ nguyên hành vi cũ.
"""
import asyncio
import copy
import json

from agentbox.agent_core.limits import FANOUT_GLOBAL_CEILING
from agentbox.agent_core.runtime import HarnessRuntime, TURN_ENDED_REASON
from agentbox.memory.session_store import SessionStore

GOAL_A = 'việc của con A'
GOAL_B = 'việc của con B'


def answer(text='done', calls=None, finish='stop'):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else finish}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


def call(name, args, cid='c1'):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


class FixtureModel:
    """Trả lời theo LÔ: lời gọi nào mang goal của con trong transcript thì lấy từ `child_responses`.

    `wait=false` làm cha và con gọi model **xen kẽ**, nên một hàng đợi chung sẽ gán câu trả lời sai
    chỗ (đúng loại lỗi mà test này phải bắt được). Nhận diện theo nội dung là cách duy nhất ổn
    định: bộ đệm lời gọi của con luôn chứa goal mà cha đã giao.

    Chỉ đọc **tin nhắn người dùng ĐẦU TIÊN**: các lượt gọi sau của cha cũng mang goal trong kết quả
    tool (`delegate_task` trả về goal + prompt), nên soi cả transcript sẽ nhận cha thành con.
    """

    def __init__(self, parent_responses, child_responses=()):
        self.parent_responses = iter(parent_responses)
        self.child_responses = iter(child_responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append(copy.deepcopy((messages, tools, route)))
        first_user = next((str(message.get('content') or '') for message in messages
                           if message.get('role') == 'user'), '')
        if GOAL_A in first_user or GOAL_B in first_user:
            return next(self.child_responses)
        return next(self.parent_responses)


class FixtureExecutor:
    """`slow` là khe để vòng lặp chạy con: cha `await asyncio.sleep` thì task con mới được xếp lịch."""

    def __init__(self, slow=(), seconds=0.1):
        self.slow = set(slow)
        self.seconds = seconds
        self.calls = []

    async def execute(self, name, args, sid, **_identity):
        self.calls.append((sid, name))
        if name in self.slow:
            await asyncio.sleep(self.seconds)
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def build(tmp_path, parent_answers, child_answers=(), slow=(), seconds=0.1, values=None):
    store = SessionStore(tmp_path / 'sessions.db')
    # Câu trả lời của con nhận dạng `str` cho dễ đọc ở chỗ gọi; model thật trả object có `choices`.
    child_answers = [item if isinstance(item, dict) else answer(item) for item in child_answers]
    model = FixtureModel(parent_answers, child_answers)
    runtime = HarnessRuntime(store, FixtureExecutor(slow, seconds), model)
    sid = runtime.create({'skills': [], **(values or {})})['id']
    return store, runtime, model, sid


def child_events(store, sid):
    return [event['data'] for event in store.events(sid) if event['type'] == 'child']


def tool_results(store, sid):
    return [json.loads(message['content']) for message in store.get(sid)['messages']
            if message['role'] == 'tool']


def blockers(store, sid):
    return store.journal_tail(sid, kinds=['blocker'])


def detached_parent_answers():
    """Hai bước sinh con `wait=false`, rồi câu trả lời cuối — không bước nào chờ con."""
    return [answer(calls=[call('delegate_task', {'role': 'review', 'goal': GOAL_A, 'wait': False}, 'c1')]),
            answer(calls=[call('delegate_task', {'role': 'testing', 'goal': GOAL_B, 'wait': False,
                                                 'deliverTo': ['main', 'role:review']}, 'c2')]),
            answer('cha chốt lượt, hai con còn chạy')]


# --------------------------------------------------------------------------- #
# T6 — `wait=false` trả về ngay, không có `summary`, phiên con vẫn tồn tại
# --------------------------------------------------------------------------- #

def test_async_delegation_hai_con_wait_false_tra_ve_ngay(tmp_path):
    store, runtime, _model, sid = build(tmp_path, detached_parent_answers())

    async def run():
        runtime.start(sid, 'giao hai việc rồi tự chốt')
        await runtime.tasks[sid]

    asyncio.run(run())

    started = [event for event in child_events(store, sid) if event['status'] == 'started']
    assert len(started) == 2, 'hai bước sinh con ⇒ hai event mở'
    assert [event['role'] for event in started] == ['review', 'testing']
    assert [event['turn'] for event in started] == [1, 1], 'cả hai con thuộc lượt 1 của cha'
    assert [event['wait'] for event in started] == [False, False]
    assert started[0]['deliverTo'] == [] and started[1]['deliverTo'] == ['main', 'role:review']

    for event in started:
        child = store.get(event['sessionId'])
        assert child is not None and child['parent_id'] == sid, 'phiên con tồn tại và trỏ về cha'
        assert store.child(event['sessionId'])['parent_turn'] == 1

    # Kết quả tool của `delegate_task`: chế độ không chặn KHÔNG được trả `summary` (chưa có gì để trả).
    results = tool_results(store, sid)
    assert [item['status'] for item in results] == ['started', 'started']
    assert [item['sessionId'] for item in results] == [event['sessionId'] for event in started]
    for item in results:
        assert 'summary' not in item, 'chưa có câu trả lời nào để tóm tắt'
        assert item['role'] in ('review', 'testing') and item['turn'] == 1 and item['step'] >= 1
    assert results[1]['deliverTo'] == ['main', 'role:review']
    assert store.get(sid)['status'] == 'completed', 'cha trả lời cuối bình thường'
    store.close()


def test_async_delegation_wait_true_giu_nguyen_hanh_vi_cu(tmp_path):
    """Mặc định không đổi: lệnh sinh chờ con, và cha nhận `summary` ngay trong tool result."""
    store, _runtime, _model, sid = build(tmp_path,
                                         [answer(calls=[call('delegate_task', {'role': 'review',
                                                                               'goal': GOAL_A})]),
                                          answer('cha chốt')],
                                         ['con trả lời xong'])

    async def run():
        runtime = _runtime
        runtime.start(sid, 'giao một việc rồi chờ')
        await runtime.tasks[sid]

    asyncio.run(run())

    events = child_events(store, sid)
    assert [event['status'] for event in events] == ['started', 'completed']
    assert events[0]['wait'] is True, 'không truyền `wait` ⇒ chờ như trước'
    result = tool_results(store, sid)[0]
    assert result['status'] == 'completed' and result['summary'] == 'con trả lời xong'
    assert result['sessionId'] == events[0]['sessionId']
    assert store.child(result['sessionId'])['status'] == 'completed'
    assert blockers(store, sid) == [], 'con xong trong lượt ⇒ không có gì phải dọn'
    store.close()


# --------------------------------------------------------------------------- #
# T7 — lượt cha đóng ⇒ con của lượt đó không sống tiếp
# --------------------------------------------------------------------------- #

def test_reap_children_don_con_mo_coi_khi_luot_cha_dong(tmp_path):
    store, runtime, _model, sid = build(tmp_path, detached_parent_answers())

    async def run():
        runtime.start(sid, 'giao hai việc rồi tự chốt')
        await runtime.tasks[sid]
        return [event['data'] for event in store.events(sid) if event['type'] == 'child']

    events = asyncio.run(run())
    started = [event for event in events if event['status'] == 'started']
    finishes = [event for event in events if event['status'] != 'started']
    child_ids = [event['sessionId'] for event in started]

    assert len(finishes) == 2, 'mỗi con mồ côi đúng MỘT event kết thúc'
    for event in finishes:
        assert event['status'] == 'failed' and event['reason'] == TURN_ENDED_REASON
        assert event['turn'] == 1 and event['reaped'] is True
    assert [event['sessionId'] for event in finishes] == child_ids

    for child_id in child_ids:
        row = store.child(child_id)
        assert row['status'] == 'failed' and row['reason'] == TURN_ENDED_REASON
        assert row['finished'] is not None
        assert child_id not in runtime.tasks, 'không còn task nào sống'
        assert store.get(child_id)['status'] in ('cancelled', 'idle'), 'phiên con không còn ở trạng thái chạy'

    assert store.live_children(sid) == [], 'không còn phiên con sống mồ côi'

    # MỘT hàng nhật ký `X:` cho cả sự việc, và nó đếm đúng số con đã bị dừng.
    rows = blockers(store, sid)
    assert len(rows) == 1, 'một sự việc, một hàng'
    assert TURN_ENDED_REASON in rows[0]['text']
    assert rows[0]['payload']['record']['id'].startswith('X:'), 'hàng nhật ký có mã X:<sid8>-<seq>'
    body = json.dumps(rows[0]['payload'], ensure_ascii=False)
    for child_id in child_ids:
        assert child_id in body, 'payload nói rõ sid nào bị dừng'

    # Trần fan-out phải về đủ: con bị dọn vẫn nhả slot (T5 + T7).
    assert runtime.parent_slots == {}
    assert runtime.global_child_slots._value == FANOUT_GLOBAL_CEILING
    store.close()


def test_con_bi_don_van_ghi_lai_so_buoc_va_token_da_tieu(tmp_path):
    """Con chạy được một bước rồi bị dọn: phần ĐÃ tiêu phải vào sổ con, không được đếm thiếu.

    T13 đo chi phí theo lượt bằng `children_summary` (đọc `steps_used`/`output_tokens` của sổ con),
    nên một con bị `PARENT_TURN_ENDED` mà không ghi lại gì sẽ biến chi phí thật thành số 0 — đúng
    loại sai số mà "đo chi phí theo lượt" không được phép có.
    """
    store, runtime, _model, sid = build(tmp_path, [])
    child = store.create({'skills': []}, role='review', parent_id=sid)['id']
    store.child_start(child, sid, 1, 1, 'review', goal=GOAL_A)
    store.save(child, [], 'running')
    # Bước 1 của con đã xong ⇒ có `turn_end` thật; bước 2 còn đang chạy (task ngủ dài thay cho một
    # lượt thật): dựng thẳng trạng thái đó để ca kiểm không đua với đồng hồ.
    store.emit(child, 'turn_end', {'turn': 1, 'step': 1, 'stepsUsed': 1, 'outputTokens': 7})

    async def run():
        runtime.tasks[child] = asyncio.ensure_future(asyncio.sleep(30))
        return await runtime.reap_children(sid, turn=1)

    reaped = asyncio.run(run())
    assert [event['sessionId'] for event in reaped] == [child]

    finishes = [event for event in child_events(store, sid) if event['status'] != 'started']
    assert len(finishes) == 1
    assert finishes[0]['status'] == 'failed' and finishes[0]['reason'] == TURN_ENDED_REASON

    row = store.child(child)
    assert row['steps_used'] == 1, 'một bước của con đã xong trước khi bị dọn'
    assert row['output_tokens'] == 7, 'token của bước đó nằm trong chính luồng của con'
    assert finishes[0]['stepsUsed'] == 1 and finishes[0]['outputTokens'] == 7

    # Và bộ số theo lượt của CHA cũng thấy phần đó (`finish` lấy đúng từ `children_summary` này —
    # hình dạng của `finish` được kiểm ở `test_peer_cost.py`).
    summary = runtime.store.children_summary(sid)
    assert summary['childSteps'] == 1 and summary['childTokens'] == 7
    assert summary['failed'] == 1 and summary['running'] == 0
    store.close()


def test_reap_children_chi_dung_con_cua_luot_minh(tmp_path):
    store, runtime, _model, sid = build(tmp_path, [answer('không làm gì')])
    child = store.create({'skills': []}, role='review', parent_id=sid)['id']
    store.child_start(child, sid, 1, 1, 'review', goal='việc cũ')

    async def run():
        empty = await runtime.reap_children(sid, turn=2)
        assert empty == [], 'con của lượt 1 không bị lượt 2 giết'
        assert store.child(child)['status'] == 'started'
        reaped = await runtime.reap_children(sid, turn=1)
        assert [event['sessionId'] for event in reaped] == [child]
        assert len(blockers(store, sid)) == 1
        assert await runtime.reap_children(sid, turn=1) == [], 'chạy lại là no-op, không ghim thêm hàng'

    asyncio.run(run())
    assert store.child(child)['reason'] == TURN_ENDED_REASON
    assert len(blockers(store, sid)) == 1
    store.close()


# --------------------------------------------------------------------------- #
# T6 nhánh còn lại — con `wait=false` tự xong trước khi lượt cha đóng
# --------------------------------------------------------------------------- #

def test_con_wait_false_tu_xong_thi_dong_so_dung_mot_lan(tmp_path):
    """Cha còn bận một bước (executor ngủ) ⇒ con kịp xong ⇒ đóng sổ, không bị coi là mồ côi."""
    store, runtime, _model, sid = build(
        tmp_path,
        [answer(calls=[call('delegate_task', {'role': 'review', 'goal': GOAL_A, 'wait': False}, 'c1')]),
         answer(calls=[call('file_read', {'path': 'x'})], finish='tool_calls'),
         answer('cha chốt')],
        ['con trả lời xong'],
        slow=('file_read',), seconds=0.2)

    async def run():
        runtime.start(sid, 'giao việc rồi còn bận một bước')
        await runtime.tasks[sid]

    asyncio.run(run())

    events = child_events(store, sid)
    assert [event['status'] for event in events] == ['started', 'completed'], \
        'con xong trước ⇒ KHÔNG có event dọn nào'
    finished = events[-1]
    assert finished.get('detached') is True and finished.get('reaped') is None
    assert finished['answerChars'] == len('con trả lời xong')
    assert finished['turn'] == 1 and finished['step'] == 1
    assert 'summary' not in finished, 'đường event không mang bản sao câu trả lời'

    row = store.child(finished['sessionId'])
    assert row['status'] == 'completed' and row['reason'] is None
    assert store.live_children(sid) == [] and store.child(finished['sessionId'])['waiting_for'] == []
    assert blockers(store, sid) == [], 'không có con nào bị bỏ rơi ⇒ không có hàng X:'
    assert runtime.parent_slots == {} and runtime.global_child_slots._value == FANOUT_GLOBAL_CEILING
    store.close()


def test_con_wait_false_hong_thi_cha_doc_duoc_ly_do(tmp_path):
    """Con `wait=false` chết vì lỗi của chính nó ⇒ hàng sổ con mang mã lỗi thật, không phải `PARENT_TURN_ENDED`."""
    store, _runtime, _model, sid = build(
        tmp_path,
        [answer(calls=[call('delegate_task', {'role': 'review', 'goal': GOAL_A, 'wait': False}, 'c1')]),
         answer(calls=[call('file_read', {'path': 'x'})], finish='tool_calls'),
         answer('cha chốt')],
        [answer('con gặp lỗi', finish='error')],
        slow=('file_read',), seconds=0.2)

    async def run():
        runtime = _runtime
        runtime.start(sid, 'giao việc cho con hỏng')
        await runtime.tasks[sid]

    asyncio.run(run())

    finished = [event for event in child_events(store, sid) if event['status'] != 'started'][-1]
    assert finished['status'] == 'failed' and finished['reason'] != TURN_ENDED_REASON
    assert finished['is_error'] is True
    assert store.child(finished['sessionId'])['reason'] == finished['reason']
    assert blockers(store, sid) == [], 'con tự chết vì lỗi của nó ⇒ không phải việc của người dọn'
    store.close()

def test_con_tu_xong_cung_cong_token_ca_chuoi_buoc(tmp_path):
    """Con `wait=false` TỰ xong: bộ số đóng sổ là số của cả chuỗi bước, không chỉ bước cuối.

    `close_detached_child` là đường đóng sổ của MỌI con `wait=false` (T6) — đường mà lượt sống
    đi qua. Bước cuối không `outputTokens` (chẩn đoán `partial` hoặc lỗi) làm bản cũ ghi `None`,
    và `childTokens` của lượt cha (T13) đếm thiếu toàn bộ phần con đã tiêu.
    """
    store, runtime, _model, sid = build(tmp_path, [])
    child = store.create({'skills': []}, role='testing', parent_id=sid)['id']
    store.child_start(child, sid, 1, 1, 'testing', goal=GOAL_A)
    store.save(child, [], 'completed')
    store.emit(child, 'turn_end', {'turn': 1, 'step': 1, 'stepsUsed': 1, 'outputTokens': 7})
    store.emit(child, 'turn_end', {'turn': 1, 'step': 2, 'stepsUsed': 2, 'outputTokens': 5})
    store.emit(child, 'turn_end', {'turn': 1, 'step': 3, 'stepsUsed': 3, 'status': 'partial'})

    async def run():
        task = asyncio.ensure_future(asyncio.sleep(0))
        await task
        runtime.close_detached_child(sid, child, 'testing', 1, 1, GOAL_A, task, ())
        return task

    asyncio.run(run())

    row = store.child(child)
    assert row['status'] == 'completed'
    assert row['steps_used'] == 3 and row['output_tokens'] == 12, \
        'ba bước, tổng token 7 + 5; bước chẩn đoán cuối không mang usage'
    finished = [event for event in child_events(store, sid) if event['status'] != 'started'][-1]
    assert finished['status'] == 'completed' and finished.get('detached') is True
    assert finished['stepsUsed'] == 3 and finished['outputTokens'] == 12
    store.close()

