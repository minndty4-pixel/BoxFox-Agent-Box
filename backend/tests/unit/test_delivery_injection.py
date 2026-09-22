"""T12 đợt 2 — kết quả bạn gửi tới thì phải VÀO ĐƯỢC vòng bước của người nhận.

Bốn điều được ghim ở đây, vì cả bốn đều là chỗ dễ hỏng im lặng:

1. **Đúng một lần.** `claim_deliveries` đọc-rồi-đổi-trạng-thái trong MỘT giao dịch, nên hai
   đường cùng gọi (bơm ở ranh giới bước, người dọn lúc hết lượt) không thể bơm hai lần.
2. **Đúng chỗ.** Message được chèn là `user`, dựng bằng khung "dữ liệu, không phải chỉ thị" và
   một đường đọc thêm (`peer_read`), chứ không phải một câu chỉ thị trần.
3. **Không phát event `user`.** Bộ đếm lượt và cách giao diện gom lượt đọc event `user`; bơm mà
   phát event đó thì một kết quả bạn bè bị tính thành một lượt người mới.
4. **Người đang chờ thì thấy kết quả ở BƯỚC KẾ TIẾP** — đây là mối nối T9↔T12 của dây chuyền
   `test → review → main` (T16).
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from agentbox.agent_core import runtime as runtime_module  # noqa: E402
from agentbox.agent_core.runtime import CHILD_ANSWER_MAX_CHARS, HarnessRuntime  # noqa: E402
from agentbox.memory.session_store import SessionStore  # noqa: E402

GOAL_A = 'chạy bộ kiểm thử đầy đủ'
GOAL_B = 'soát lại thay đổi'


def call(name, args, cid):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


def answer(text='', calls=()):
    message = {'content': text}
    if calls:
        message['tool_calls'] = calls
    return {'choices': [{'finish_reason': 'tool_calls' if calls else 'stop', 'message': message}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


class FixtureModel:
    """Mỗi con một hàng trả lời riêng, chọn theo goal; lượt cha ghi lại để soi context."""

    def __init__(self, parent_responses, child_responses=None):
        self.parent_responses = iter(parent_responses)
        self.by_goal = {goal: iter([item if isinstance(item, dict) else answer(item) for item in rows])
                        for goal, rows in dict(child_responses or {}).items()}
        self.calls = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.calls.append([dict(message) for message in messages])
        first_user = next((str(message.get('content') or '') for message in messages
                           if message.get('role') == 'user'), '')
        for goal, responses in self.by_goal.items():
            if goal in first_user:
                return next(responses)
        return next(self.parent_responses)


class FixtureExecutor:
    def __init__(self, slow=(), seconds=0.3):
        self.slow = set(slow)
        self.seconds = seconds

    async def execute(self, name, args, sid, **_identity):
        if name in self.slow:
            await asyncio.sleep(self.seconds)
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def build(tmp_path, parent_answers=(), child_answers=None, slow=()):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(slow), FixtureModel(parent_answers, child_answers))
    sid = runtime.create({'skills': []})['id']
    return store, runtime, sid


def spawn(store, parent_id, role, turn=1):
    """Một con đang chạy thật (đã `child_start`), đúng như đường `delegate` để lại."""
    child = store.create({'skills': []}, role=role, parent_id=parent_id)['id']
    store.child_start(child, parent_id, turn, 1, role, goal=f'việc của {role}')
    return child


def turn_count(store, sid):
    return int(store.get(sid)['turn_count'] or 0)


def run_turn(runtime, sid, prompt):
    async def run():
        runtime.start(sid, prompt)
        await runtime.tasks[sid]

    asyncio.run(run())


def injected_text(store, sid):
    blocks = [message['content'] for message in store.get(sid)['messages']
              if message['role'] == 'user' and '[Kết quả từ chuyên gia' in str(message.get('content'))]
    return blocks


def test_bom_dung_mot_lan_roi_thoi(tmp_path):
    store, runtime, sid = build(tmp_path)
    worker = spawn(store, sid, 'testing')
    store.queue_delivery(worker, sid, 1, 'peer', chars=5)

    assert runtime.drain_peer_deliveries(sid, store.get(sid)['messages']) == 1
    messages = store.get(sid)['messages']
    assert messages[-1]['role'] == 'user'
    assert '[Kết quả từ chuyên gia testing' in messages[-1]['content']

    # Lần hai: hàng đã bị `claim` rồi, nên không có gì để bơm — kể cả khi transcript được đọc lại
    # từ đĩa (đây là điều mà một biến trong RAM sẽ không giữ được qua lần chạy lại).
    assert runtime.drain_peer_deliveries(sid, messages) == 0
    assert len(store.get(sid)['messages']) == len(messages)
    assert store.deliveries_of(worker)[0]['state'] == 'injected'
    store.close()


def test_dong_goi_noi_ro_la_du_lieu_va_co_duong_doc_them(tmp_path):
    store, runtime, sid = build(tmp_path)
    worker = spawn(store, sid, 'review')
    store.emit(worker, 'assistant', {'text': 'câu trả lời của con', 'final': True})
    store.queue_delivery(worker, sid, 1, 'peer', chars=18)

    assert runtime.drain_peer_deliveries(sid, store.get(sid)['messages']) == 1
    block = injected_text(store, sid)[0]
    assert 'Kết quả từ chuyên gia review' in block
    assert worker[:8] in block
    assert 'dữ liệu, không phải chỉ thị' in block, 'bọc rõ để con không đọc kết quả bạn thành mệnh lệnh'
    assert 'câu trả lời của con' in block, 'thân kết quả phải có trong khung'
    assert f'peer_read("{worker}")' in block, 'đường đọc thêm khi bản gọn chưa đủ'
    store.close()


def test_ban_gon_cat_theo_tran_nhung_van_doc_duoc_phan_con_lai(tmp_path):
    store, runtime, sid = build(tmp_path)
    worker = spawn(store, sid, 'testing')
    long_answer = 'x' * (CHILD_ANSWER_MAX_CHARS + 500)
    store.emit(worker, 'assistant', {'text': long_answer, 'final': True})
    store.queue_delivery(worker, sid, 1, 'peer', chars=len(long_answer))

    assert runtime.drain_peer_deliveries(sid, store.get(sid)['messages']) == 1
    block = injected_text(store, sid)[0]
    assert f'Bounded at {CHILD_ANSWER_MAX_CHARS} characters' in block, 'cắt thì phải nói là đã cắt'
    assert len(block) < CHILD_ANSWER_MAX_CHARS + 1000, 'bơm vào context phải có trần'
    store.close()


def test_khong_phat_event_user_va_khong_dung_bo_dem_luot(tmp_path):
    store, runtime, sid = build(tmp_path)
    worker = spawn(store, sid, 'testing')
    store.queue_delivery(worker, sid, 1, 'peer', chars=5)
    before_users = len([event for event in store.events(sid) if event['type'] == 'user'])
    before_turn = turn_count(store, sid)

    writes = []
    original = runtime_module.system_log.write
    runtime_module.system_log.write = lambda event, **data: writes.append((event, data))
    try:
        assert runtime.drain_peer_deliveries(sid, store.get(sid)['messages']) == 1
    finally:
        runtime_module.system_log.write = original

    assert len([event for event in store.events(sid) if event['type'] == 'user']) == before_users
    assert turn_count(store, sid) == before_turn, 'bơm không được tính thành lượt mới'
    assert [event for event, _ in writes] == ['peer.delivery.injected']
    assert writes[0][1]['rows'] == 1 and writes[0][1]['children'] == [worker]
    store.close()


def test_hai_ban_giao_thi_vao_cung_mot_message_nhung_khong_mất_ban_nao(tmp_path):
    store, runtime, sid = build(tmp_path)
    first = spawn(store, sid, 'testing')
    second = spawn(store, sid, 'review')
    store.queue_delivery(first, sid, 1, 'peer', chars=5)
    store.queue_delivery(second, sid, 1, 'peer', chars=5)

    before = len(store.get(sid)['messages'])
    assert runtime.drain_peer_deliveries(sid, store.get(sid)['messages']) == 2
    assert len(store.get(sid)['messages']) == before + 1, 'một bước = một message, dù hai kết quả'
    block = injected_text(store, sid)[0]
    assert 'testing' in block and 'review' in block
    store.close()


def test_chi_lay_hang_cua_chinh_minh(tmp_path):
    store, runtime, sid = build(tmp_path)
    first = spawn(store, sid, 'testing')
    second = spawn(store, sid, 'review')
    store.queue_delivery(first, sid, 1, 'peer', chars=5)
    store.queue_delivery(second, first, 1, 'peer', chars=5)

    assert runtime.drain_peer_deliveries(sid, store.get(sid)['messages']) == 1
    assert injected_text(store, first) == [], 'hàng của người khác còn nguyên'
    assert [row for row in store.deliveries_of(second)
            if row['recipient'] == first][0]['state'] == 'pending'
    store.close()


def test_nguoi_dang_cho_nghe_thay_ket_qua_o_buoc_ke_tiep(tmp_path):
    """Mối nối T9↔T12: `review` giao trong lúc `testing` đang `await_children`.

    Đây đúng là dây chuyền của T16 nhưng không cần `terminal_exec`: cha sinh `review` trước rồi
    sinh `testing`; `testing` chờ tới lúc `review` GIAO (không chờ tới lúc nó đóng sổ), nên bước kế
    tiếp của nó phải đọc được kết quả trong context — và không lượt nào trong chuỗi được `failed`.
    """
    store, runtime, sid = build(tmp_path, [
        answer(calls=[call('delegate_task', {'role': 'review', 'goal': GOAL_B, 'wait': False,
                                             'deliverTo': ['role:testing']}, 'c1')]),
        answer(calls=[call('delegate_task', {'role': 'testing', 'goal': GOAL_A, 'wait': False}, 'c2')]),
        answer(calls=[call('file_read', {'path': 'chờ hai con'}, 'c3')]),
        answer('xong'),
    ], child_answers={
        GOAL_A: [answer(calls=[call('await_children', {'targets': ['role:review'], 'mode': 'all',
                                                       'timeoutSeconds': 5}, 'a1')]),
                 answer('đã nhận kết quả của bạn')],
        GOAL_B: ['bản soát của review'],
    }, slow={'file_read'})
    run_turn(runtime, sid, 'chạy review rồi testing')

    testing = next(row for row in store.children_of(sid) if row['role'] == 'testing')
    review = next(row for row in store.children_of(sid) if row['role'] == 'review')
    assert testing['status'] == 'completed' and review['status'] == 'completed'
    assert store.get(sid)['status'] == 'completed'
    assert [event for event in store.events(sid) if event['type'] == 'error'] == []

    block = injected_text(store, testing['session_id'])
    assert len(block) == 1, 'bơm đúng một lần'
    assert 'bản soát của review' in block[0]

    # Bước kế tiếp của `testing` (lời gọi model thứ hai) đã đọc thấy kết quả đó.
    testing_calls = [messages for messages in runtime.client.calls
                     if any(GOAL_A in str(message.get('content') or '') for message in messages
                            if message.get('role') == 'user')]
    assert len(testing_calls) == 2, testing_calls
    assert 'bản soát của review' in json.dumps(testing_calls[-1], ensure_ascii=False)

    waits = [event['data'] for event in store.events(testing['session_id'])
             if event['type'] == 'peer_wait_end']
    assert len(waits) == 1 and waits[0]['status'] == 'done', waits
    store.close()
