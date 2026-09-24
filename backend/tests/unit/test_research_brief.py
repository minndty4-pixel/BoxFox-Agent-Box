"""`research_brief` — chốt mức, hồ sơ, phòng hồ sơ cho MỘT việc (vòng 27 đợt 5, C-1/C-6).

Mức là thứ chủ nhà phải biết trước khi tiền và thời gian được tiêu: mức 1 một nhánh ngắn, mức 2 một
sóng, mức 3 ba sóng + phản biện + trần lượt một giờ. Ca kiểm ghim sáu luật của đợt này: giá trị lạ
thì kẹp và NÓI RA; trần lượt chỉ được ngắn hơn; nâng mức trong cùng lượt bị từ chối; chỉ main gọi
được; brief nằm trong `config` và để lại ĐÚNG MỘT hàng `D:`; và `next` nói được hạn mức cho nhánh.
"""
from __future__ import annotations

import asyncio

import pytest

from agentbox.agent_core import limits, research_quality, research_runtime
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.memory.session_store import SessionStore


class FixtureExecutor:
    def __init__(self):
        self.calls = []

    async def execute(self, name, args, sid):
        self.calls.append((name, args, sid))
        return {'content': 'ok'}

    async def cleanup(self, sid):
        pass


class FixtureModel:
    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        return {'choices': [{'message': {'content': 'ok'}, 'finish_reason': 'stop'}]}


@pytest.fixture()
def harness(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureModel())
    sid = runtime.create({'skills': []})['id']
    yield store, runtime, sid, store.get(sid)
    store.close()


def brief(runtime, session, **overrides):
    args = {'tier': 2, 'jobProfile': 'health', 'question': 'Mức hưởng chuyển tuyến 2026?',
            'rationale': 'cần dẫn nguồn văn bản, nhiều khía cạnh'}
    args.update(overrides)
    return asyncio.run(runtime.dispatch(session, 'research_brief', args))


def notices(store, sid):
    return [row['data'] for row in store.events(sid) if row['type'] == 'notice']


def test_a_wrong_tier_is_clamped_to_two_and_the_notice_says_so(harness):
    store, runtime, sid, session = harness
    answer = brief(runtime, session, tier='mức ba')
    assert answer['tier'] == limits.RESEARCH_TIER_DEFAULT
    codes = [item['code'] for item in notices(store, sid)]
    assert limits.RESEARCH_TIER_DEFAULTED_CODE in codes
    assert limits.RESEARCH_TIER_DEFAULTED_CODE in answer['notices']


def test_a_ceiling_longer_than_the_tier_allows_is_clamped(harness):
    store, runtime, sid, session = harness
    answer = brief(runtime, session, ceilingSeconds=99999)
    assert answer['turnSeconds'] == limits.RESEARCH_TIER_TURN_SECONDS[2]
    assert limits.RESEARCH_CEILING_CLAMPED_CODE in answer['notices']
    assert research_runtime.research_config(store.get(sid))['ceilingSeconds'] == answer['turnSeconds']


def test_level_three_brings_the_critique_wave_and_the_hard_ceiling(harness):
    store, runtime, sid, session = harness
    answer = brief(runtime, session, tier=3, jobProfile='price', ceilingSeconds=3600)
    assert answer['critique'] is True
    assert answer['branchCeiling'] == limits.RESEARCH_TIER_BRANCHES[3] == 15
    assert (answer['waves'], answer['waveSize']) == (3, 5)
    assert answer['hardCeilingSeconds'] == limits.RESEARCH_TIER_HARD_CEILING_SECONDS[3]
    assert answer['softCeilingSeconds'] == 3600
    assert 'research-review' in answer['next'], 'mức 3 phải nói ai phản biện'


def test_raising_the_level_in_one_turn_is_refused_and_the_old_brief_stays(harness):
    store, runtime, sid, session = harness
    brief(runtime, session, tier=1, jobProfile='law', question='Số hiệu nghị định mới nhất là gì?')
    with pytest.raises(ValueError, match=limits.RESEARCH_BRIEF_RAISE_REFUSED_CODE):
        brief(runtime, session, tier=3, researchId=None)
    assert research_runtime.research_config(store.get(sid))['tier'] == 1
    lowered = brief(runtime, session, tier=1, researchId=None)
    assert lowered['updated'] is True
    assert limits.RESEARCH_BRIEF_UPDATED_CODE in lowered['notices']


def test_a_child_may_not_choose_the_level(harness):
    store, runtime, sid, session = harness
    child = runtime.create({'skills': []}, parent_id=sid, role='research')
    with pytest.raises(PermissionError):
        brief(runtime, store.get(child['id']), tier=3)
    with pytest.raises(ValueError, match='RESEARCH_BRIEF_INVALID'):
        brief(runtime, session, question='   ')
    with pytest.raises(ValueError, match='RESEARCH_BRIEF_INVALID'):
        brief(runtime, session, rationale='')


def test_the_brief_is_stored_and_leaves_exactly_one_decision_row(harness):
    store, runtime, sid, session = harness
    asked = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    brief(runtime, session, tier=2, branches=asked)
    stored = research_runtime.research_config(store.get(sid))
    assert stored['researchId'] == 'muc-huong-chuyen-tuyen-2026'
    assert stored['branches'] == ['a', 'b', 'c', 'd', 'e'], 'cắt theo trần nhánh của mức'
    assert stored['dossierDir'].startswith('.research/muc-huong-chuyen-tuyen-2026-')
    rows = store.journal_tail(sid, kinds=('decision',))
    assert len(rows) == 1
    record = rows[0]['payload']['record']
    assert record['data']['kind'] == 'research-brief'
    assert record['data']['tier'] == 2 and record['data']['researchId'] == stored['researchId']
    assert 'mức 2' in rows[0]['text']
    repeat = brief(runtime, session, tier=2, branches=asked)
    assert repeat['updated'] is False and len(store.journal_tail(sid, kinds=('decision',))) == 1, \
        'gọi lại y hệt không ghim thêm hàng D:'
    narrowed = brief(runtime, session, tier=2, branches=['a'])
    assert narrowed['updated'] is True
    assert len(store.journal_tail(sid, kinds=('decision',))) == 2, 'brief ĐỔI thì có hàng D: mới'


class FakeBudget:
    def __init__(self, when):
        self._when = when
        self.rescheduled = []

    def when(self):
        return self._when

    def reschedule(self, when):
        self.rescheduled.append(when)
        self._when = when


def test_a_long_tier_three_turn_extends_the_budget_once(harness):
    store, runtime, sid, session = harness
    from agentbox.agent_core.runtime import DEADLINE_DEFAULT_SECONDS

    assert runtime.current_turn_seconds(sid) == DEADLINE_DEFAULT_SECONDS
    budget = FakeBudget(1000.0)
    runtime.run_budget[sid] = budget
    runtime.turn_started_at[sid] = 900.0
    answer = brief(runtime, session, tier=3, jobProfile='paper', question='Bài báo X nói gì về Y?',
                   ceilingSeconds=3600)
    assert answer['extendedTurn'] is True
    assert runtime.research_extensions[sid] == 1
    codes = [item['code'] for item in notices(store, sid)]
    assert limits.TURN_EXTENDED_CODE in codes
    second = brief(runtime, session, tier=3, ceilingSeconds=3600)
    assert second['extendedTurn'] is False, 'trần lượt chỉ được nới MỘT lần'


# --- #6025: ý kiến chủ nhà đi vào brief, và điều đó ràng buộc pha phản biện ----------------


def test_owner_views_are_kept_in_the_brief_and_announced_once(harness):
    store, runtime, sid, session = harness
    answer = brief(runtime, session, ownerViews=['phí chuyển tuyến sẽ tăng trong 2026',
                                                'bảo hiểm không chi trả cho tuyến huyện'])
    assert answer['ownerViews'] == ['phí chuyển tuyến sẽ tăng trong 2026',
                                    'bảo hiểm không chi trả cho tuyến huyện']
    assert research_runtime.research_config(store.get(sid))['ownerViews'] == answer['ownerViews']
    codes = [item['code'] for item in notices(store, sid)]
    assert limits.RESEARCH_OWNER_VIEWS_CODE in codes
    message = next(item['message'] for item in notices(store, sid)
                   if item['code'] == limits.RESEARCH_OWNER_VIEWS_CODE)
    for label, _english in research_quality.OWNER_VIEW_LABELS:
        assert label in message, 'câu nhắc phải nêu đủ ba nhãn'
    assert 'ba nhãn' in answer['next'], 'hợp đồng ba nhãn phải đi cùng lời gợi ý hành động'


def test_a_single_string_is_one_opinion_not_an_error(harness):
    store, runtime, sid, session = harness
    answer = brief(runtime, session, ownerViews='chỉ một ý kiến')
    assert answer['ownerViews'] == ['chỉ một ý kiến']


def test_owner_views_are_deduped_capped_and_absent_by_default(harness):
    store, runtime, sid, session = harness
    many = ['ý kiến ' + str(index) for index in range(limits.RESEARCH_OWNER_VIEWS_MAX + 5)]
    answer = brief(runtime, session, ownerViews=many + ['ý kiến 0', '  '])
    assert answer['ownerViews'] == many[:limits.RESEARCH_OWNER_VIEWS_MAX]
    assert limits.RESEARCH_OWNER_VIEWS_CODE in answer['notices'], 'còn ý kiến thì còn nhắc' 
    # Brief KHÔNG có ý kiến chủ nhà: không notice, không ràng buộc nào thêm.
    fresh = runtime.create({'skills': []})
    other = brief(runtime, store.get(fresh['id']))
    assert other['ownerViews'] == []
    assert limits.RESEARCH_OWNER_VIEWS_CODE not in other['notices']


def test_the_same_owner_views_twice_do_not_append_a_second_decision_row(harness):
    store, runtime, sid, session = harness
    views = ['giá sẽ giảm trong quý bốn']
    brief(runtime, session, ownerViews=views)
    rows = [row for row in store.journal_tail(sid, limit=50) if row['kind'] == 'decision']
    brief(runtime, session, ownerViews=views)
    again = [row for row in store.journal_tail(sid, limit=50) if row['kind'] == 'decision']
    assert len(again) == len(rows) == 1, 'gọi lại y hệt không ghim thêm hàng `D:`'
