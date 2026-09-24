"""Nhịp báo tiến độ giữa lượt (#5969, vòng 27 đợt 7, C-4).

Chủ nhà không nhìn thấy gì trong một lượt dài là một lỗi trải nghiệm, không phải chuyện thẩm mỹ:
lượt mức 3 chạy tới một giờ. Nhịp mười phút bơm ĐÚNG một câu nhắc vào transcript — không event,
không hàng `D:`, không lượt mới. Ca kiểm dùng đồng hồ giả nên đo được cả ba mặt: mốc đầu tiên, trần
số lần trong lượt, và việc lượt mới tự đặt lại nhịp.
"""
from __future__ import annotations

import asyncio
import time

import pytest

from agentbox.agent_core import limits, research_runtime
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'ok'}

    async def cleanup(self, sid):
        pass


class FixtureModel:
    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        return {'choices': [{'message': {'content': 'ok'}, 'finish_reason': 'stop'}]}


@pytest.fixture()
def harness(tmp_path, monkeypatch):
    monkeypatch.delenv('BOXFOX_RESEARCH_PROGRESS', raising=False)
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    sid = runtime.create({'skills': []})['id']
    yield store, runtime, sid, store.get(sid)
    store.close()


def nudges(store, sid):
    """Các mục `user` trong transcript mang tiền tố nhịp tiến độ."""
    rows = store.get(sid)['messages']
    return [m for m in rows if m.get('role') == 'user'
            and str(m.get('content') or '').startswith(limits.RESEARCH_NUDGE_PREFIX)]


def test_the_first_six_hundred_seconds_pass_without_a_single_nudge(harness, monkeypatch):
    store, runtime, sid, session = harness
    messages = list(session['messages'])
    runtime.active_turn[sid] = 1
    assert runtime.maybe_nudge_progress(sid, messages) is False, 'mốc đầu là mốc ĐẶT nhịp'
    assert runtime.progress_state[sid]['turn'] == 1
    clock = time.time()
    monkeypatch.setattr(time, 'time', lambda: clock + 599)
    assert runtime.maybe_nudge_progress(sid, messages) is False, '599 s chưa tới nhịp'
    assert nudges(store, sid) == []


def test_six_hundred_and_one_seconds_bring_exactly_one_user_line(harness, monkeypatch):
    store, runtime, sid, session = harness
    messages = list(session['messages'])
    runtime.active_turn[sid] = 1
    runtime.maybe_nudge_progress(sid, messages)
    before = len(store.events(sid))
    clock = time.time()
    monkeypatch.setattr(time, 'time', lambda: clock + 601)
    assert runtime.maybe_nudge_progress(sid, messages) is True
    rows = nudges(store, sid)
    assert len(rows) == 1
    assert str(limits.RESEARCH_PROGRESS_NUDGE_SECONDS // 60) in rows[0]['content']
    assert len(store.events(sid)) == before, 'câu nhắc KHÔNG phát event — nó không phải sự kiện phiên'
    assert store.get(sid)['turn_count'] == 0, 'và nó không sinh lượt mới'
    assert store.journal_tail(sid, limit=10, kinds=('decision',)) == [], 'không hàng `D:` nào'


def test_the_nudge_stops_at_the_per_turn_ceiling(harness, monkeypatch):
    store, runtime, sid, session = harness
    messages = list(session['messages'])
    runtime.active_turn[sid] = 1
    runtime.maybe_nudge_progress(sid, messages)
    clock = time.time()
    for _ in range(limits.RESEARCH_PROGRESS_MAX_PER_TURN):
        clock += limits.RESEARCH_PROGRESS_NUDGE_SECONDS + 1
        monkeypatch.setattr(time, 'time', lambda clock=clock: clock)
        assert runtime.maybe_nudge_progress(sid, messages) is True
    assert len(nudges(store, sid)) == limits.RESEARCH_PROGRESS_MAX_PER_TURN
    clock += limits.RESEARCH_PROGRESS_NUDGE_SECONDS * 5
    monkeypatch.setattr(time, 'time', lambda clock=clock: clock)
    assert runtime.maybe_nudge_progress(sid, messages) is False, 'trần mỗi lượt là trần'
    assert len(nudges(store, sid)) == limits.RESEARCH_PROGRESS_MAX_PER_TURN


def test_a_new_turn_resets_the_rhythm(harness, monkeypatch):
    store, runtime, sid, session = harness
    messages = list(session['messages'])
    runtime.active_turn[sid] = 1
    runtime.maybe_nudge_progress(sid, messages)
    clock = time.time() + limits.RESEARCH_PROGRESS_NUDGE_SECONDS + 1
    monkeypatch.setattr(time, 'time', lambda: clock)
    assert runtime.maybe_nudge_progress(sid, messages) is True
    runtime.active_turn[sid] = 2
    assert runtime.maybe_nudge_progress(sid, messages) is False, 'lượt mới đặt lại nhịp (chưa tới mốc)'
    assert runtime.progress_state[sid] == {'turn': 2, 'count': 0,
                                           'due': clock + limits.RESEARCH_PROGRESS_NUDGE_SECONDS}


def test_the_switch_off_silences_the_rhythm(harness, monkeypatch):
    store, runtime, sid, session = harness
    messages = list(session['messages'])
    runtime.active_turn[sid] = 1
    runtime.maybe_nudge_progress(sid, messages)
    monkeypatch.setenv('BOXFOX_RESEARCH_PROGRESS', 'off')
    monkeypatch.setattr(time, 'time', lambda: time.time() + 10 * limits.RESEARCH_PROGRESS_NUDGE_SECONDS)
    assert runtime.maybe_nudge_progress(sid, messages) is False
    assert nudges(store, sid) == []


def test_a_stranger_value_falls_back_and_is_reported_once(harness):
    store, runtime, sid, session = harness
    assert research_runtime.research_progress_mode({'BOXFOX_RESEARCH_PROGRESS': 'thin'}) == ('on', 'thin')
    assert research_runtime.research_progress_mode({'BOXFOX_RESEARCH_PROGRESS': 'off'}) == ('off', None)
    runtime.active_turn[sid] = 1
    research_runtime.nudge_due(runtime, sid)
    research_runtime.nudge_due(runtime, sid)
    codes = [row['data']['code'] for row in store.events(sid) if row['type'] == 'notice']
    assert codes.count('RESEARCH_PROGRESS_MODE_UNKNOWN') <= 1, 'mỗi mã chỉ nói một lần cho mỗi phiên'


def test_the_drain_and_the_nudge_do_not_touch_each_other(harness, monkeypatch):
    """Hai đường bơm khác nhau: chỉ thị là hàng chờ có `steerId`, câu nhắc là mục `user` trần."""
    store, runtime, sid, session = harness
    messages = list(session['messages'])
    runtime.active_turn[sid] = 1
    asyncio.run(research_runtime.queue_owner_steer(runtime, sid, 'chỉ đọc tầng 1'))
    runtime.maybe_nudge_progress(sid, messages)
    clock = time.time() + limits.RESEARCH_PROGRESS_NUDGE_SECONDS + 1
    monkeypatch.setattr(time, 'time', lambda: clock)
    runtime.maybe_nudge_progress(sid, messages)
    assert research_runtime.drain_steers(runtime, sid, messages) == 1
    assert store.pending_steer_count(sid) == 0
    assert len(nudges(store, sid)) == 1, 'một câu nhắc, một chỉ thị — không lẫn nhau'
    steers = [row for row in store.events(sid) if row['type'] == 'user' and row['data'].get('steer')]
    assert len(steers) == 1 and steers[0]['data']['steerId']
