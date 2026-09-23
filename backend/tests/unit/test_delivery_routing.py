"""T11 — giao kết quả của con tới **nhiều** người nhận đúng địa chỉ, có biên nhận, không giao hai lần.

Đây là trái tim của L1/L2: `main` sinh `testing` và `review` trong cùng một lượt, `review` giao kết quả
cho `main` **và** cho `testing` (người đang cần nó để chạy tiếp). Ba luật của bộ kiểm này:

1. Địa chỉ phân giải theo phạm vi bạn của CHA — `main`, `peer:<sid>`, `role:<vai>`, tên vai.
2. Địa chỉ không tồn tại **không** làm hỏng lượt: nó thành một biên nhận `skipped` có lý do.
3. Giao lại cùng một kết quả không sinh hàng thứ hai (`UNIQUE(child_id, recipient, recipient_turn)`)
   và **không** hồi sinh một phiên đã kết thúc.
"""
import asyncio
import json

import pytest

from agentbox.agent_core.limits import PEER_DELIVER_MAX
from agentbox.agent_core.runtime import HarnessRuntime
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
    """Mỗi con có hàng trả lời RIÊNG, chọn theo goal — hai con chạy xen kẽ nên hàng chung sẽ gán sai."""

    def __init__(self, parent_responses, child_responses=()):
        self.parent_responses = iter(parent_responses)
        self.by_goal = {}
        for goal, responses in dict(child_responses or {}).items():
            self.by_goal[goal] = iter([item if isinstance(item, dict) else answer(item) for item in responses])

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        first_user = next((str(message.get('content') or '') for message in messages
                           if message.get('role') == 'user'), '')
        for goal, responses in self.by_goal.items():
            if goal in first_user:
                return next(responses)
        return next(self.parent_responses)


class FixtureExecutor:
    """`slow` là khe để vòng lặp chạy con: cha `await asyncio.sleep` thì task con mới được xếp lịch."""

    def __init__(self, slow=(), seconds=0.3):
        self.slow = set(slow)
        self.seconds = seconds

    async def execute(self, name, args, sid, **_identity):
        if name in self.slow:
            await asyncio.sleep(self.seconds)
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def build(tmp_path, parent_answers=(), child_answers=None):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel(parent_answers, child_answers or {}))
    sid = runtime.create({'skills': []})['id']
    return store, runtime, sid


def spawn(store, parent_id, role, turn=1):
    child = store.create({'skills': []}, role=role, parent_id=parent_id)['id']
    store.child_start(child, parent_id, turn, 1, role, goal=f'việc của {role}')
    return child


def run_turn(runtime, sid, prompt):
    async def run():
        runtime.start(sid, prompt)
        await runtime.tasks[sid]

    asyncio.run(run())


def child_events(store, sid):
    return [event['data'] for event in store.events(sid) if event['type'] == 'child']


def receipts(store, child_id):
    return store.child_delivery_receipts(child_id)


# --------------------------------------------------------------------------- #
# Địa chỉ: main, peer:<sid>, role:<vai>, tên vai
# --------------------------------------------------------------------------- #

def test_giao_hang_cho_vai_anh_em_ghi_mot_bien_nhan_va_mot_event(tmp_path):
    store, runtime, sid = build(tmp_path)
    review = spawn(store, sid, 'review')
    testing = spawn(store, sid, 'testing')

    runtime.deliver_child_result(review, sid, 'review', 1, 2, ['main', 'role:testing'], chars=180)

    rows = store.deliveries_of(review)
    assert [(row['recipient'], row['state'], row['kind']) for row in rows] == [
        (sid, 'injected', 'main'), (testing, 'pending', 'peer')]
    assert rows[1]['chars'] == 180
    assert store.child(review)['deliveries'] == [
        {'recipient': sid, 'state': 'injected', 'chars': 180, 'truncated': False},
        {'recipient': testing, 'state': 'pending', 'chars': 180, 'truncated': False}]
    events = store.events(testing)
    assert [event['type'] for event in events] == ['peer_delivery']
    assert events[0]['data']['from'] == review and events[0]['data']['role'] == 'review'
    assert events[0]['data']['deliveryId'] == rows[1]['id'] and events[0]['data']['state'] == 'pending'
    assert [event['type'] for event in store.events(sid)] == [], 'main không nhận thêm event nào'
    store.close()


def test_giao_hang_dung_peer_id_va_ten_vai_tran(tmp_path):
    store, runtime, sid = build(tmp_path)
    review = spawn(store, sid, 'review')
    testing = spawn(store, sid, 'testing')

    runtime.deliver_child_result(review, sid, 'review', 1, 2, [f'peer:{testing}'], chars=10)
    assert [row['recipient'] for row in store.deliveries_of(review)] == [testing]

    other = spawn(store, sid, 'explore')
    runtime.deliver_child_result(other, sid, 'explore', 1, 2, ['testing', 'role:testing'], chars=10)
    rows = store.deliveries_of(other)
    assert [row['recipient'] for row in rows] == [testing], 'trùng địa chỉ chỉ ghi MỘT hàng'
    store.close()


def test_giao_hang_khong_hoi_sinh_phien_da_ket_thuc(tmp_path):
    store, runtime, sid = build(tmp_path)
    review = spawn(store, sid, 'review')
    dead = spawn(store, sid, 'testing')
    store.child_finish(dead, 'completed')
    store.save(dead, [{'role': 'user', 'content': 'x'}], 'completed')

    runtime.deliver_child_result(review, sid, 'review', 1, 2, ['role:testing'], chars=10)
    row = store.deliveries_of(review)[0]
    assert (row['recipient'], row['state'], row['skip_reason']) == (dead, 'skipped', 'recipient_not_running')
    assert store.child_delivery_receipts(review) == [
        {'recipient': dead, 'state': 'skipped', 'chars': 0, 'truncated': False,
         'reason': 'recipient_not_running'}]
    assert [event for event in store.events(dead) if event['type'] == 'peer_delivery'] == [], \
        'không giao cho phiên đã chết, cũng không đánh thức nó'
    store.close()


def test_dia_chi_khong_ton_tai_thanh_bien_nhan_skipped_chu_khong_lam_hong_luot(tmp_path):
    store, runtime, sid = build(tmp_path)
    review = spawn(store, sid, 'review')

    runtime.deliver_child_result(review, sid, 'review', 1, 2,
                                 ['role:khong-co-that', 'peer:khong-co-that'], chars=10)
    receipts = store.child_delivery_receipts(review)
    # Hai cách viết của CÙNG một địa chỉ chết ⇒ một biên nhận (chống trùng theo người nhận), và
    # lượt không hề hấn gì: không ném, không có biên nhận `pending` nào để ai đó chờ vô vọng.
    assert [(item['recipient'], item['state'], item['reason']) for item in receipts] == [
        ('khong-co-that', 'skipped', 'no_such_peer')]
    store.close()


def test_giao_hang_khong_gui_hai_lan_cung_mot_ket_qua(tmp_path):
    store, runtime, sid = build(tmp_path)
    review = spawn(store, sid, 'review')
    testing = spawn(store, sid, 'testing')

    runtime.deliver_child_result(review, sid, 'review', 1, 2, ['role:testing'], chars=42)
    runtime.deliver_child_result(review, sid, 'review', 1, 2, ['role:testing'], chars=42)
    assert len(store.deliveries_of(review)) == 1, 'cùng (con, người nhận, lượt) ⇒ đúng một hàng'
    assert len([event for event in store.events(testing) if event['type'] == 'peer_delivery']) == 1
    store.close()


def test_khong_khai_nhan_thi_chi_cha_doc_duoc(tmp_path):
    store, runtime, sid = build(tmp_path)
    review = spawn(store, sid, 'review')
    spawn(store, sid, 'testing')

    assert runtime.deliver_child_result(review, sid, 'review', 1, 2, []) == []
    assert store.deliveries_of(review) == []
    store.close()


# --------------------------------------------------------------------------- #
# Trần địa chỉ: lỗi rõ ràng, không cắt im lặng
# --------------------------------------------------------------------------- #

def test_qua_tran_nguoi_nhan_thi_loi_tool_ro_rang(tmp_path):
    store, runtime, sid = build(tmp_path, [
        answer(calls=[call('delegate_task', {'role': 'review', 'goal': GOAL_A, 'wait': False,
                                             'deliverTo': [f'role:r{index}' for index in range(PEER_DELIVER_MAX + 1)]})]),
        answer('bỏ qua'),
    ], child_answers={GOAL_A: ['con xong'], GOAL_B: ['con xong']})
    run_turn(runtime, sid, 'giao cho quá nhiều người')

    assert store.get(sid)['status'] == 'completed', 'lỗi tool không làm hỏng lượt'
    results = [json.loads(message['content']) for message in store.get(sid)['messages']
               if message['role'] == 'tool']
    assert any('PEER_DELIVER_MAX' in str(item.get('error') or '') for item in results), results
    assert store.children_of(sid) == [], 'từ chối TRƯỚC khi sinh con — không có phiên mồ côi'
    store.close()
    store.close()


# --------------------------------------------------------------------------- #
# Đi qua `delegate` thật: biên nhận nằm trong event kết thúc
# --------------------------------------------------------------------------- #

def test_luot_that_giao_ket_qua_cho_anh_em_va_main(tmp_path):
    store, runtime, sid = build(tmp_path, [
        answer(calls=[call('delegate_task', {'role': 'testing', 'goal': GOAL_A, 'wait': False},
                          'c1')]),
        answer(calls=[call('delegate_task', {'role': 'review', 'goal': GOAL_B, 'wait': False,
                                             'deliverTo': ['main', 'role:testing']}, 'c2')]),
        answer(calls=[call('file_read', {'path': 'chờ hai con xong'}, 'c3')]),
        answer('xong cả hai'),
    ], child_answers={GOAL_A: [answer(calls=[call('terminal_exec', {'command': 'ls'}, 'c1')]),
                               'kết quả của testing'],
                      GOAL_B: ['kết quả của review']})
    runtime.executor.slow = {'file_read', 'terminal_exec'}   # khe để hai con chạy trong lượt cha
    run_turn(runtime, sid, 'chạy hai chuyên gia song song')

    events = child_events(store, sid)
    finishes = [event for event in events if event['status'] != 'started']
    assert len(finishes) == 2
    review_row = next(row for row in store.children_of(sid) if row['role'] == 'review')
    testing_row = next(row for row in store.children_of(sid) if row['role'] == 'testing')
    review_event = next(event for event in finishes if event['sessionId'] == review_row['session_id'])
    assert review_event['deliveries'] == [
        {'recipient': sid, 'state': 'injected', 'chars': len('kết quả của review'), 'truncated': False},
        # `testing` còn sống (đang trong bước `terminal_exec`) nên biên nhận của nó là `pending`:
        # T12 sẽ bơm kết quả vào transcript của nó ở bước kế tiếp.
        {'recipient': testing_row['session_id'], 'state': 'pending', 'chars': len('kết quả của review'),
         'truncated': False}]
    assert review_row['deliveries'] == review_event['deliveries'], 'sổ con và event nói cùng một chuyện'
    assert [event['data'] for event in store.events(testing_row['session_id'])
            if event['type'] == 'peer_delivery'][0]['role'] == 'review'
    assert testing_row['deliveries'] == [], 'testing không giao cho ai'
    store.close()
