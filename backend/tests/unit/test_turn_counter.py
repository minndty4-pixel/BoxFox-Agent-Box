"""Bộ đếm LƯỢT một chiều và `turn` trên mọi event của lượt (vòng 22, T2 — BUG-43/D-9).

Trước việc này, dòng event không nói được một bản ghi thuộc lượt nào: phải suy từ event `user`
gần nhất đứng trước, nên bảng Sub-agents trộn con của lượt trước vào lượt sau (BUG-43). Ba ca
dưới đây khoá ba tính chất:

- số lượt là một chiều và đi theo `user`/`turn_start`/`turn_end`/`finish` của đúng lượt đó;
- `turn_end` đóng ở cuối MỖI bước nên nó phải mang cả `turn` (lượt) lẫn `step` (bước trong lượt);
- dòng `turn.end` trong system log giữ `turnId` cũ (số bước) và có thêm `turn` (số lượt) — hai
  trường khác nhau trên cùng một dòng, bản ghi cũ không đổi nghĩa.
"""
import asyncio
import copy
import json

from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


def answer(text='done', calls=None, finish='stop'):
    return {'choices': [{'message': {'content': text, **({'tool_calls': calls} if calls else {})},
                         'finish_reason': 'tool_calls' if calls else finish}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


def call(name, args, cid='c1'):
    return {'id': cid, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


class FixtureModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append({'messages': copy.deepcopy(messages), 'tools': copy.deepcopy(tools)})
        return next(self.responses)


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


def events_of(store, sid, kind):
    return [e['data'] for e in store.events(sid) if e['type'] == kind]


def run_turns(tmp_path, client, prompts):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), client)
    session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'deepseek-v4-flash'})
    sid = session['id']

    async def run():
        for prompt in prompts:
            await runtime.submit(sid, prompt)
            await runtime.tasks[sid]

    asyncio.run(run())
    return store, runtime, session


def test_ba_luot_lien_tiep_mang_turn_1_2_3(tmp_path):
    client = FixtureModel([answer('một'), answer('hai'), answer('ba')])
    store, _runtime, session = run_turns(tmp_path, client, ('lượt một', 'lượt hai', 'lượt ba'))
    sid = session['id']

    assert store.get(sid)['turn_count'] == 3, 'bộ đếm nằm trong hàng phiên, đọc được ngoài lượt'
    assert [e['turn'] for e in events_of(store, sid, 'user')] == [1, 2, 3]
    assert [e['turn'] for e in events_of(store, sid, 'turn_start')] == [1, 2, 3]
    assert [e['turn'] for e in events_of(store, sid, 'turn_end')] == [1, 2, 3]
    assert [e['turn'] for e in events_of(store, sid, 'finish')] == [1, 2, 3]
    # Bước cũng mang lượt: giao diện gom mọi thứ của một lượt mà không phải suy từ event `user`.
    assert [e['turn'] for e in events_of(store, sid, 'step')] == [1, 2, 3]
    assert [e['text'] for e in events_of(store, sid, 'user')] == ['lượt một', 'lượt hai', 'lượt ba']
    store.close()


def test_turn_end_cua_buoc_hai_trong_luot_hai_mang_turn_2_step_2(tmp_path):
    client = FixtureModel([answer('một'),
                           answer('', calls=[call('file_read', {'path': 'a'})]),
                           answer('hai')])
    store, _runtime, session = run_turns(tmp_path, client, ('lượt một', 'lượt hai'))
    sid = session['id']

    ends = events_of(store, sid, 'turn_end')
    assert [(e['turn'], e['step'], e['status']) for e in ends] == [
        (1, 1, 'completed'), (2, 1, 'tool_calls'), (2, 2, 'completed')], \
        '`turn` là lượt, `step` là bước trong lượt: hai con số KHÁC nhau trên cùng một dòng'
    assert ends[-1]['stepsUsed'] == 2, 'số luỹ kế của lượt vẫn như cũ (B9)'
    store.close()


def test_dong_turn_end_trong_system_log_co_ca_turn_lan_turnid(tmp_path, monkeypatch):
    import agentbox.observability.system_log as system_log_module
    log = system_log_module.system_log
    monkeypatch.setattr(log, 'directory', tmp_path)
    monkeypatch.setattr(log, 'path', tmp_path / 'harness.jsonl')
    monkeypatch.setattr(log, 'enabled', True)

    client = FixtureModel([answer('một'),
                           answer('', calls=[call('file_read', {'path': 'a'})]),
                           answer('', calls=[call('file_read', {'path': 'b'}, 'c2')]),
                           answer('hai')])
    store, _runtime, session = run_turns(tmp_path, client, ('lượt một', 'lượt hai'))
    sid = session['id']

    lines = [json.loads(line) for line in (tmp_path / 'harness.jsonl').read_text(
        encoding='utf-8').splitlines() if line.strip()]
    starts = [line for line in lines if line['event'] == 'turn.start' and line.get('sessionId') == sid]
    ends = [line for line in lines if line['event'] == 'turn.end' and line.get('sessionId') == sid]
    assert [line['turn'] for line in starts] == [1, 2], 'mở lượt cũng biết mình là lượt nào'
    assert [(line['turn'], line['turnId']) for line in ends] == [(1, 1), (2, 3)], \
        '`turn` là số lượt (1 rồi 2), `turnId` là số BƯỚC của lượt đó (1 rồi 3)'
    assert [line['turnId'] for line in ends] != [line['turn'] for line in ends], \
        'hai trường khác nhau: đọc lẫn là hiểu sai lượt'
    store.close()


def test_so_luot_lay_tu_bang_events_khi_bo_dem_cua_phien_lech(tmp_path, monkeypatch):
    """P1.1 — bộ đếm của phiên và transcript lệch nhau thì BẢNG thắng, và chuyện lệch được ghi lại.

    Phiên sinh ra TRƯỚC T2 nhận cột `turn_count` với mặc định 0: bộ đếm đọc–tăng–ghi sẽ trả số 1
    cho lượt kế tiếp của một phiên đã có N lượt trong transcript. Ca này dựng lại đúng ca đó và
    khoá hai tính chất: lượt đi tiếp theo số ĐẾM ĐƯỢC, và dòng `turn.index_drift` có mặt để lần
    sau không ai phải đoán vì sao số nhảy.
    """
    import agentbox.observability.system_log as system_log_module
    log = system_log_module.system_log
    monkeypatch.setattr(log, 'directory', tmp_path)
    monkeypatch.setattr(log, 'path', tmp_path / 'harness.jsonl')
    monkeypatch.setattr(log, 'enabled', True)

    client = FixtureModel([answer('một'), answer('hai')])
    store, runtime, session = run_turns(tmp_path, client, ('lượt một',))
    sid = session['id']
    assert runtime._turn_index(sid) == 1, 'chỉ số đếm thẳng từ bảng `events`'

    store.db.execute('UPDATE sessions SET turn_count=0 WHERE id=?', (sid,))
    store.db.commit()
    assert store.get(sid)['turn_count'] == 0, 'bộ đếm của phiên đã lệch khỏi transcript'

    async def second_turn():
        await runtime.submit(sid, 'lượt hai')
        await runtime.tasks[sid]

    asyncio.run(second_turn())
    assert [e['turn'] for e in events_of(store, sid, 'user')] == [1, 2], \
        'lượt kế tiếp đi theo số đếm được, không quay về 1'
    assert [e['turn'] for e in events_of(store, sid, 'turn_start')] == [1, 2]
    lines = [json.loads(line) for line in (tmp_path / 'harness.jsonl').read_text(
        encoding='utf-8').splitlines() if line.strip()]
    drift = [line for line in lines if line['event'] == 'turn.index_drift']
    assert len(drift) == 1, 'lệch số phải nói ra, không sửa im lặng'
    # Số dư nằm trong khối `data` (kỷ luật của system log: trường lạ đi vào `data`).
    assert (drift[0]['turn'], drift[0]['data']['index'], drift[0]['code']) == (1, 2, 'TURN_INDEX_DRIFT')
    store.close()
