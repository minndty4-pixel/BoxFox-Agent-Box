"""Vỏ mode `/research` + ranh giới main↔research của P1 (plan v2 §5.2, §5.3, §5.10, §5.12).

Nhóm M của plan (§8.2) chạy tất định trong CI: không mạng, không gọi mô hình thật. Mọi hành vi mới
của P1 nằm sau công tắc `BOXFOX_RESEARCH_MODE` — tệp này bật công tắc bằng `monkeypatch`, và bài
cuối cùng chứng minh công tắc TẮT thì hành vi quay về đúng f17d54b.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core import limits, research_runtime
from agentbox.agent_core import runtime as runtime_module
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.api.server import create_app, research_job_pumpable
from agentbox.memory.session_store import SessionStore
from agentbox.skills.commands import CommandRegistry
from agentbox.skills.catalog import SkillCatalog

HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'ok'}

    async def cleanup(self, sid):
        return None


class FixtureRouterClient:
    async def model_metadata_map(self):
        return {}


class RecordingModel:
    """Ghi lại danh sách công cụ mỗi lượt và ĐẾM số lần được gọi (M-16: không gọi mô hình)."""

    def __init__(self, answer='ok'):
        self.offered = []
        self.calls = 0
        self.answer = answer

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.calls += 1
        self.offered.append([schema['function']['name'] for schema in tools])
        return {'choices': [{'message': {'content': self.answer}, 'finish_reason': 'stop'}],
                'usage': None, 'boxfox': None}


@pytest.fixture()
def harness(tmp_path, monkeypatch):
    monkeypatch.setenv(limits.RESEARCH_MODE_ENV, 'on')
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureRouterClient())
    sid = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm1',
                          'timeoutSeconds': 30, 'deadlineSeconds': 60})['id']
    yield store, runtime, sid
    store.close()


def session_of(store, sid):
    return store.get(sid)


def events(store, sid, kind=None):
    return [row['data'] for row in store.events(sid) if kind is None or row['type'] == kind]


def run_turn(runtime, sid, prompt, invocation_id=None):
    """Nộp một lượt và chờ xong — dùng ở đây để đo bộ công cụ/hồ sơ lượt thật."""

    async def main():
        await runtime.submit(sid, prompt, invocation_id=invocation_id)
        task = runtime.tasks.get(sid)
        if task is not None:
            await task

    asyncio.run(main())


# ------------------------------------------------------------------ M-01 / M-02 / M-03 / M-04 / M-16


def test_m01_turning_mode_on_from_the_toggle_changes_the_config_and_sends_no_turn(harness):
    store, runtime, sid = harness
    result = research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True, 'by': 'toggle'})
    assert result['on'] is True and result['prompt'] is None
    config = session_of(store, sid)['config']
    assert config['researchMode']['on'] is True
    assert config['researchMode']['enteredBy'] == 'toggle'
    assert [item for item in events(store, sid, limits.RESEARCH_MODE_EVENT_CODE)] == [
        {'on': True, 'by': 'toggle', 'activeRunId': None, 'revision': 1}]
    assert sid not in runtime.tasks, 'bật mode không gửi lượt nào'


def test_m02_slash_research_with_text_is_a_mode_command_that_opens_a_turn(harness):
    store, runtime, sid = harness
    model = RecordingModel()
    runtime.client = model
    registry = CommandRegistry(store, SkillCatalog())
    resolved = registry.resolve('/research tìm tài liệu chính thức', subagents=[])
    assert resolved.kind == 'mode' and resolved.command == 'research'
    assert resolved.prompt == 'tìm tài liệu chính thức'
    run_turn(runtime, sid, '/research tìm tài liệu chính thức')
    assert session_of(store, sid)['config']['researchMode']['on'] is True
    assert model.calls == 1, 'lệnh có nội dung vẫn mở đúng một lượt'
    assert limits.RESEARCH_MODE_BLOCK_MARKER in session_of(store, sid)['messages'][0]['content']


def test_m03_bare_slash_research_turns_the_mode_on_without_a_turn(harness):
    store, runtime, sid = harness
    model = RecordingModel()
    runtime.client = model
    result = asyncio.run(runtime.submit(sid, '/research'))
    assert result['status'] == 'idle'
    assert session_of(store, sid)['config']['researchMode']['on'] is True
    assert model.calls == 0
    assert sid not in runtime.tasks, 'M-03: `/research` rỗng KHÔNG tạo lượt'


def test_m04_slash_research_off_without_a_run_turns_the_mode_off(harness):
    store, runtime, sid = harness
    asyncio.run(runtime.submit(sid, '/research'))
    model = RecordingModel()
    runtime.client = model
    result = asyncio.run(runtime.submit(sid, '/research off'))
    assert session_of(store, sid)['config']['researchMode']['on'] is False
    assert result['status'] == 'idle'
    assert model.calls == 0
    event = events(store, sid, limits.RESEARCH_MODE_EVENT_CODE)[-1]
    assert event['on'] is False and event['by'] == 'command'


def test_m16_slash_research_status_replays_the_card_without_a_turn_or_a_model_call(harness):
    store, runtime, sid = harness
    model = RecordingModel()
    runtime.client = model
    asyncio.run(runtime.submit(sid, '/research'))
    store.research_job_save('run-a', sid, {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600,
                                          'questions': [], 'scope': {'revision': 2}}, status='researching')
    before = model.calls
    result = asyncio.run(runtime.submit(sid, '/research status'))
    assert 'run-a' in result['output'] and 'searching' in result['output']
    assert model.calls == before, 'M-16: `/research status` không gọi mô hình'
    assert sid not in runtime.tasks or runtime.tasks[sid].done()


# ------------------------------------------------------------------ M-05 (mức 3 chỉ trong mode)


def test_m05_tier_three_outside_mode_is_refused_with_research_mode_required(harness):
    store, runtime, sid = harness
    session = session_of(store, sid)
    before = json.dumps(session['config'], sort_keys=True)
    with pytest.raises(ValueError, match=limits.RESEARCH_MODE_REQUIRED_CODE):
        asyncio.run(runtime.dispatch(session, 'research_brief', {
            'tier': 3, 'question': 'Toàn cảnh thị trường?', 'rationale': 'việc lớn'}))
    assert json.dumps(session_of(store, sid)['config'], sort_keys=True) == before, \
        'từ chối chứ KHÔNG hạ mức im lặng (và không ghi brief)'


def test_m05_tier_three_is_allowed_once_the_mode_is_on(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    answer = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_brief', {
        'tier': 3, 'question': 'Toàn cảnh thị trường?', 'rationale': 'việc lớn'}))
    assert answer['tier'] == 3


# ------------------------------------------------------------------ M-06 (research_suggest không đổi config)


def test_m06_research_suggest_only_emits_and_never_changes_the_config(harness):
    store, runtime, sid = harness
    before = json.dumps(session_of(store, sid)['config'], sort_keys=True)
    answer = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_suggest',
                                          {'reason': 'cần bản đồ tài liệu', 'draftGoal': 'Toàn cảnh X'}))
    assert answer['suggested'] is True and answer['changedConfig'] is False
    assert json.dumps(session_of(store, sid)['config'], sort_keys=True) == before
    [suggestion] = events(store, sid, 'research_suggested')
    assert suggestion['draftGoal'] == 'Toàn cảnh X'
    assert session_of(store, sid)['config'].get('researchMode', {}).get('on', False) is False


# ------------------------------------------------------------------ M-07 (cửa 2: brief bắt buộc)


def test_m07_outside_mode_the_second_unbriefed_branch_is_refused(harness):
    store, runtime, sid = harness
    runtime.active_turn[sid] = 1
    assert research_runtime.missing_brief_gate(runtime, session_of(store, sid), 'research') is True
    store.child_start('child-1', sid, 1, 1, 'research')
    with pytest.raises(ValueError, match=limits.RESEARCH_BRIEF_MISSING_CODE):
        research_runtime.missing_brief_gate(runtime, session_of(store, sid), 'research')


def test_m07_the_first_unbriefed_branch_is_clamped_to_tier_one(harness):
    store, runtime, sid = harness
    runtime.active_turn[sid] = 1
    clamp = research_runtime.quick_lookup_clamp(runtime, session_of(store, sid), 'research')
    assert clamp == {'tier': 1, 'childSteps': 20, 'childSeconds': 180}


# ------------------------------------------------------------------ M-08 (bơm)


def test_m08_the_pump_skips_main_jobs_mode_off_jobs_and_needs_user(harness):
    store, runtime, sid = harness
    session = session_of(store, sid)
    main_job = {'research_id': 'main-job', 'session_id': sid, 'revision': 1, 'status': 'researching',
                'state': {'origin': 'main', 'phase': 'searching', 'budgetSeconds': 600}}
    mode_job = {'research_id': 'mode-job', 'session_id': sid, 'revision': 1, 'status': 'researching',
                'state': {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600}}
    assert research_job_pumpable(runtime, main_job, session) is False, 'origin=main không bao giờ bơm'
    assert research_job_pumpable(runtime, mode_job, session) is False, 'mode tắt và không chạy nền'
    research_runtime.apply_research_mode(runtime, session, {'on': True})
    session = session_of(store, sid)
    assert research_job_pumpable(runtime, mode_job, session) is False, 'activeRunId chưa trỏ vào job này'
    store.research_job_save('mode-job', sid, mode_job['state'], status='researching')
    config = session['config']
    config['researchMode']['activeRunId'] = 'mode-job'
    store.update_config(sid, config)
    assert research_job_pumpable(runtime, mode_job, session_of(store, sid)) is True
    background = {'research_id': 'bg', 'session_id': sid, 'revision': 1, 'status': 'researching',
                  'state': {'origin': 'mode', 'phase': 'searching', 'background': True, 'budgetSeconds': 600}}
    assert research_job_pumpable(runtime, background, session_of(store, sid)) is True
    clarifying = {'research_id': 'cl', 'session_id': sid, 'revision': 1, 'status': 'scoping',
                  'state': {'origin': 'mode', 'phase': 'clarifying', 'background': True, 'budgetSeconds': 600}}
    assert research_job_pumpable(runtime, clarifying, session_of(store, sid)) is False


# ------------------------------------------------------------------ M-09 / M-10a / M-10b / M-15


def test_m09_pause_by_job_never_stops_the_whole_session(harness, monkeypatch):
    store, runtime, sid = harness
    store.research_job_save('run-halt', sid, {'origin': 'mode', 'phase': 'searching',
                                             'budgetSeconds': 600, 'questions': []}, status='researching')

    async def forbidden(_sid):
        raise AssertionError('research_halt must never stop the whole session')

    monkeypatch.setattr(runtime, 'stop', forbidden)
    job = store.research_job('run-halt')
    updated = asyncio.run(runtime.research_halt(job, 'pause'))
    assert updated['status'] == 'paused'
    assert events(store, sid, 'research_run')[-1]['status'] == 'paused'


def test_m10a_exit_choice_pause_keeps_active_run_id_and_the_pump_stays_away(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    store.research_job_save('run-p', sid, {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600,
                                          'questions': []}, status='researching')
    config = session_of(store, sid)['config']
    config['researchMode']['activeRunId'] = 'run-p'
    store.update_config(sid, config)
    result = research_runtime.apply_research_mode(runtime, session_of(store, sid),
                                                 {'on': False, 'exitChoice': 'pause'})
    assert result['on'] is False and result['activeRunId'] == 'run-p'
    assert session_of(store, sid)['config']['researchMode']['activeRunId'] == 'run-p'
    assert store.research_job('run-p')['status'] == 'paused'
    assert research_job_pumpable(runtime, store.research_job('run-p'), session_of(store, sid)) is False


def test_m10b_exit_choice_background_keeps_the_run_and_the_pump_keeps_going(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    store.research_job_save('run-bg', sid, {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600,
                                           'questions': []}, status='researching')
    config = session_of(store, sid)['config']
    config['researchMode']['activeRunId'] = 'run-bg'
    store.update_config(sid, config)
    research_runtime.apply_research_mode(runtime, session_of(store, sid),
                                        {'on': False, 'exitChoice': 'background'})
    job = store.research_job('run-bg')
    assert job['state']['background'] is True and job['status'] == 'researching'
    assert session_of(store, sid)['config']['researchMode']['on'] is False
    assert research_job_pumpable(runtime, job, session_of(store, sid)) is True
    # Lượt bơm dùng hồ sơ research kể cả khi mode đã tắt.
    profile = runtime.turn_profile(session_of(store, sid), 'research-resume-run-bg-1')
    assert profile['mode'] == 'research'
    assert not (set(profile['tools']) & set(limits.RESEARCH_MODE_EXCLUDED_TOOLS))
    main_profile = runtime.turn_profile(session_of(store, sid), None)
    assert main_profile['mode'] == 'main'


def test_m10b_background_finish_emits_the_report_and_the_notice_and_the_handoff_once(harness):
    store, runtime, sid = harness
    store.research_job_save('run-done', sid, {'origin': 'mode', 'phase': 'done', 'background': True,
                                             'budgetSeconds': 600, 'tier': 2,
                                             'reviewModes': ['critique'],
                                             'questions': [{'id': 'q1', 'importance': 'high',
                                                            'status': 'answered'}],
                                             'scope': {'revision': 1, 'goal': {'text': 'X', 'status': 'confirmed'}}},
                            status='researching')
    store.record_dossier(sid, 'run-done', 1, '.research/run-done/v1-done.md', quality_ok=True)
    store.dossier_critique_set('run-done', 1, 'ok')
    answer = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_update',
                                          {'researchId': 'run-done', 'status': 'completed'}))
    assert answer['status'] == 'completed'
    kinds = [row['type'] for row in store.events(sid)]
    assert 'research_report' in kinds and 'research_notice' in kinds
    assert store.research_job('run-done')['state']['background'] is False
    handoff = runtime.research_handoff(session_of(store, sid))
    assert handoff is not None and handoff['researchId'] == 'run-done'
    runtime.mark_handoff_delivered(session_of(store, sid), handoff['researchId'], handoff['version'])
    assert runtime.research_handoff(session_of(store, sid)) is None, 'bàn giao MỘT lần cho mỗi bản hồ sơ'


def test_m10c_turning_mode_off_without_a_choice_is_409_and_keeps_the_mode_on(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    store.research_job_save('run-x', sid, {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600,
                                          'questions': []}, status='researching')
    config = session_of(store, sid)['config']
    config['researchMode']['activeRunId'] = 'run-x'
    store.update_config(sid, config)
    with pytest.raises(ValueError, match=limits.RESEARCH_MODE_EXIT_CHOICE_REQUIRED_CODE) as caught:
        research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': False})
    assert caught.value.payload['code'] == limits.RESEARCH_MODE_EXIT_CHOICE_REQUIRED_CODE
    assert caught.value.payload['prompt']['kind'] == 'exit-choice'
    assert session_of(store, sid)['config']['researchMode']['on'] is True, 'M-10c: mode KHÔNG đổi'
    assert store.research_job('run-x')['status'] == 'researching'


def test_the_put_route_answers_409_with_the_exit_choice_prompt(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    store.research_job_save('run-http', sid, {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600,
                                             'questions': []}, status='researching')
    config = session_of(store, sid)['config']
    config['researchMode']['activeRunId'] = 'run-http'
    store.update_config(sid, config)

    async def run():
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(headers=HEADERS) as http:
                async with http.put(str(server.make_url(f'/api/agent/sessions/{sid}/research-mode')),
                                    json={'on': False}) as resp:
                    assert resp.status == 409
                    body = await resp.json()
                async with http.put(str(server.make_url(f'/api/agent/sessions/{sid}/research-mode')),
                                    json={'on': True}) as ok:
                    assert ok.status == 200
                    enabled = await ok.json()
        return body, enabled

    body, enabled = asyncio.run(run())
    assert body['code'] == limits.RESEARCH_MODE_EXIT_CHOICE_REQUIRED_CODE
    assert body['prompt']['kind'] == 'exit-choice'
    assert len(body['prompt']['questions'][0]['options']) == 2
    assert enabled['on'] is True


def test_m15_dismissing_the_exit_prompt_changes_nothing(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    store.research_job_save('run-d', sid, {'origin': 'mode', 'phase': 'searching', 'budgetSeconds': 600,
                                          'questions': []}, status='researching')
    config = session_of(store, sid)['config']
    config['researchMode']['activeRunId'] = 'run-d'
    store.update_config(sid, config)
    with pytest.raises(ValueError):
        research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': False})
    [prompt] = store.research_job('run-d')['state']['prompts']
    research_runtime.dismiss_prompt(runtime, sid, store.research_job('run-d'), prompt['promptId'])
    assert session_of(store, sid)['config']['researchMode']['on'] is True
    assert store.research_job('run-d')['status'] == 'researching'


# ------------------------------------------------------------------ M-11 / M-17 (thẻ phạm vi + lời hỏi)


def scope_job(store, sid, research_id='run-scope'):
    store.research_job_save(research_id, sid, {
        'origin': 'mode', 'phase': 'clarifying', 'budgetSeconds': 1800, 'tier': 2,
        'goal': 'Toàn cảnh X', 'questions': [{'id': 'q1', 'importance': 'high', 'status': 'unexplored'}],
        'scope': {'revision': 0}}, status='scoping')
    return store.research_job(research_id)


def test_m11_scope_edits_bump_the_revision_and_a_stale_revision_is_refused(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    scope_job(store, sid)
    first = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_scope',
                                         {'action': 'propose', 'researchId': 'run-scope',
                                          'patch': {'purpose': 'chọn phương án dùng ngay'}}))
    assert first['revision'] == 1
    second = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_scope',
                                          {'action': 'update', 'researchId': 'run-scope',
                                           'patch': {'depth': 'deep'}}))
    assert second['revision'] == 2
    scope = store.research_job('run-scope')['state']['scope']
    assert scope['purpose']['status'] == 'assumed', 'agent đề xuất ⇒ giả định, không phải xác nhận'
    assert scope['purpose']['source']['kind'] == 'agent'
    assert [item['revision'] for item in events(store, sid, 'research_scope')] == [1, 2]


def test_m17_answers_land_in_one_call_and_clear_needs_user(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    scope_job(store, sid)
    asked = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_scope',
                                         {'action': 'ask', 'researchId': 'run-scope', 'questions': [
                                             {'id': 'iq1', 'text': 'Dùng để làm gì?', 'blocking': True,
                                              'options': [{'id': 'o1', 'label': 'Dùng ngay'},
                                                          {'id': 'o2', 'label': 'Bản đồ nghiên cứu'}]},
                                             {'id': 'iq2', 'text': 'Cửa sổ thời gian?', 'blocking': True,
                                              'options': [{'id': 'o1', 'label': '12 tháng'},
                                                          {'id': 'o2', 'label': 'Mọi lúc'}]}]}))
    assert asked['needsUser'] is True
    assert store.research_job('run-scope')['status'] == 'needs_user'
    job = store.research_job('run-scope')
    prompt = job['state']['prompts'][0]
    with pytest.raises(ValueError, match=limits.RESEARCH_SCOPE_REVISION_STALE_CODE):
        research_runtime.answer_prompt(runtime, sid, job, {'promptId': prompt['promptId'], 'revision': 99,
                                                          'answers': []})
    with pytest.raises(ValueError, match='RESEARCH_PROMPT_UNANSWERED'):
        research_runtime.answer_prompt(runtime, sid, job, {
            'promptId': prompt['promptId'], 'revision': prompt['revision'], 'start': True,
            'answers': [{'questionId': 'iq1', 'optionId': 'o1'}]})
    done = research_runtime.answer_prompt(runtime, sid, job, {
        'promptId': prompt['promptId'], 'revision': prompt['revision'], 'start': True,
        'answers': [{'questionId': 'iq1', 'optionId': 'o1'}, {'questionId': 'iq2', 'text': '24 tháng'}]})
    assert done['resume'] is True and done['unanswered'] == []
    saved = store.research_job('run-scope')
    assert saved['status'] == 'researching' and saved['state']['scope']['openQuestions'][0]['answer']['status'] == 'confirmed'


def test_m12_the_scope_card_splits_what_the_user_confirmed_from_what_the_agent_assumed(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    scope_job(store, sid)
    asyncio.run(runtime.dispatch(session_of(store, sid), 'research_scope',
                                 {'action': 'propose', 'researchId': 'run-scope',
                                  'patch': {'purpose': 'chọn phương án dùng ngay', 'depth': 'deep'}}))
    asyncio.run(runtime.dispatch(session_of(store, sid), 'research_scope',
                                 {'action': 'ask', 'researchId': 'run-scope', 'questions': [
                                     {'id': 'iq1', 'text': 'Cửa sổ thời gian?', 'blocking': True,
                                      'options': [{'id': 'o1', 'label': '12 tháng'}]}]}))
    job = store.research_job('run-scope')
    prompt = job['state']['prompts'][0]
    research_runtime.answer_prompt(runtime, sid, job, {
        'promptId': prompt['promptId'], 'revision': prompt['revision'],
        'answers': [{'questionId': 'iq1', 'optionId': 'o1'}]})
    scope = store.research_job('run-scope')['state']['scope']
    assert scope['purpose']['status'] == 'assumed' and scope['purpose']['source']['kind'] == 'agent'
    [answered] = scope['openQuestions']
    assert answered['answer']['status'] == 'confirmed' and answered['answer']['text'] == '12 tháng'
    assert answered['blocking'] is False, 'trả lời xong thì câu chặn thành đã trả lời'


# ------------------------------------------------------------------ M-12 / M-13 / M-14


def test_m12_m13_the_handoff_separates_confirmed_from_assumed_and_carries_the_labels(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    store.research_job_save('run-h', sid, {
        'origin': 'mode', 'phase': 'done', 'budgetSeconds': 900, 'tier': 2, 'reviewModes': ['critique'],
        'questions': [], 'goal': 'X',
        'scope': {'revision': 3,
                  'goal': {'text': 'Mức hưởng 2026', 'status': 'confirmed',
                           'source': {'kind': 'user', 'seq': 12}},
                  'purpose': {'text': 'chọn phương án dùng ngay', 'status': 'assumed',
                              'source': {'kind': 'agent'}},
                  'openQuestions': [{'id': 'iq1', 'text': 'Cửa sổ thời gian?', 'blocking': False}]}},
        status='partial')
    store.record_dossier(sid, 'run-h', 1, '.research/run-h/v1-h.md', quality_ok=True)
    store.dossier_critique_set('run-h', 1, 'revise')
    # Khối bàn giao chỉ dựng khi mode TẮT (§5.10); chọn "chạy nền" để run giữ nguyên nhãn `partial`.
    config = session_of(store, sid)['config']
    config['researchMode']['activeRunId'] = 'run-h'
    store.update_config(sid, config)
    research_runtime.apply_research_mode(runtime, session_of(store, sid),
                                        {'on': False, 'exitChoice': 'background'})
    block = runtime.research_handoff(session_of(store, sid))['block']
    assert 'Bạn đã xác nhận: goal: Mức hưởng 2026' in block
    assert 'Giả định của agent: purpose: chọn phương án dùng ngay' in block
    assert 'partial' in block and limits.RESEARCH_CRITIQUE_LABEL in block
    assert 'open questions: Cửa sổ thời gian?' in block
    assert 'do NOT raise the confidence' in block


def test_a_research_turn_is_capped_at_the_short_turn_target(harness, monkeypatch):
    """§5.5 — lượt research nhắm ≤ `RESEARCH_TURN_TARGET_SECONDS`; lượt main giữ trần của phiên."""
    store, runtime, sid = harness
    session = session_of(store, sid)
    session['config']['deadlineSeconds'] = 3600
    store.update_config(sid, session['config'])
    session = session_of(store, sid)
    assert runtime.turn_budget_seconds(session) == 3600, 'mode tắt ⇒ không chia lượt ngắn'
    research_runtime.apply_research_mode(runtime, session, {'on': True})
    session = session_of(store, sid)
    assert runtime.turn_budget_seconds(session) == limits.RESEARCH_TURN_TARGET_SECONDS
    assert runtime.turn_budget_seconds(session, 'research-resume-run-1') == limits.RESEARCH_TURN_TARGET_SECONDS
    monkeypatch.setenv(limits.RESEARCH_TURN_TARGET_SECONDS_ENV, '0')
    assert runtime.turn_budget_seconds(session) == 3600, '0 ⇒ tắt chia lượt ngắn'
    monkeypatch.setenv(limits.RESEARCH_TURN_TARGET_SECONDS_ENV, '600')
    session['config']['deadlineSeconds'] = 240
    store.update_config(sid, session['config'])
    assert runtime.turn_budget_seconds(session_of(store, sid)) == 240, 'trần phiên vẫn là trần trên'


def test_m14_the_mode_tool_set_drops_every_write_tool(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    profile = runtime.turn_profile(session_of(store, sid))
    assert profile['mode'] == 'research'
    assert not (set(profile['tools']) & set(limits.RESEARCH_MODE_EXCLUDED_TOOLS))
    assert 'ask_user' in profile['tools'] and 'delegate_task' in profile['tools']
    assert limits.RESEARCH_MODE_BLOCK_MARKER in profile['promptBlock']


def test_the_sop_naming_the_block_does_not_make_the_block_stripper_eat_the_prompt(harness):
    """Câu nhắc TÊN khối mode (không khép bằng end marker) không được làm luật gỡ nuốt phần đuôi."""
    store, runtime, sid = harness
    session = session_of(store, sid)
    mention = f'=== ASSIGNED ROLE ===\nA block named "{limits.RESEARCH_MODE_BLOCK_MARKER}" wins.\n\n'
    session['messages'][0]['content'] = mention + (session['messages'][0]['content'] or '')
    store.save(sid, session['messages'])
    runtime._sync_mode_block(session)
    after = session_of(store, sid)['messages'][0]['content']
    assert '=== ANSWER LENGTH ===' in after and '=== ENABLED SKILLS' in after, \
        'mode tắt và không có gì để bàn giao ⇒ prompt không đổi'
    assert after == store.get(sid)['messages'][0]['content']


def test_the_mode_block_is_inserted_and_removed_per_turn(harness):
    store, runtime, sid = harness
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': True})
    session = session_of(store, sid)
    runtime._sync_mode_block(session)
    assert limits.RESEARCH_MODE_BLOCK_MARKER in session['messages'][0]['content']
    research_runtime.apply_research_mode(runtime, session_of(store, sid), {'on': False})
    session = session_of(store, sid)
    runtime._sync_mode_block(session)
    assert limits.RESEARCH_MODE_BLOCK_MARKER not in session['messages'][0]['content']


# ------------------------------------------------------------------ M-18 (research_update theo job)


def test_m18_outside_mode_main_may_only_pause_a_background_run(harness):
    store, runtime, sid = harness
    store.research_job_save('foreground', sid, {'origin': 'main', 'phase': 'searching',
                                                'budgetSeconds': 600, 'questions': []},
                            status='researching')
    with pytest.raises(PermissionError, match='RESEARCH_UPDATE_BACKGROUND_ONLY'):
        asyncio.run(runtime.dispatch(session_of(store, sid), 'research_update',
                                     {'researchId': 'foreground', 'action': 'pause'}))
    store.research_job_save('background', sid, {'origin': 'mode', 'phase': 'searching', 'background': True,
                                                'budgetSeconds': 600, 'questions': []},
                            status='researching')
    answer = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_update',
                                          {'researchId': 'background', 'action': 'cancel'}))
    assert answer['status'] == 'cancelled'
    assert store.research_job('background')['status'] == 'cancelled'


def test_m18_pausing_a_background_run_keeps_the_session_alive(harness, monkeypatch):
    store, runtime, sid = harness
    store.research_job_save('bg2', sid, {'origin': 'mode', 'phase': 'searching', 'background': True,
                                         'budgetSeconds': 600, 'questions': []}, status='researching')

    async def forbidden(_sid):
        raise AssertionError('job control must never stop the session')

    monkeypatch.setattr(runtime, 'stop', forbidden)
    answer = asyncio.run(runtime.dispatch(session_of(store, sid), 'research_update',
                                          {'researchId': 'bg2', 'action': 'pause'}))
    assert answer['status'] == 'paused'


# ------------------------------------------------------------------ công tắc giết


def test_with_the_mode_switch_off_everything_behaves_like_before(monkeypatch, tmp_path):
    monkeypatch.setenv(limits.RESEARCH_MODE_ENV, 'off')
    assert runtime_module.research_mode_available() is False
    store = SessionStore(tmp_path / 'legacy.db')
    runtime = HarnessRuntime(store, FixtureExecutor(), FixtureRouterClient())
    sid = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm1', 'timeoutSeconds': 30})['id']
    registry = CommandRegistry(store, SkillCatalog())
    resolved = registry.resolve('/research tìm tài liệu chính thức',
                                subagents=[{'id': 'research', 'enabled': True}])
    assert resolved.kind == 'task' and resolved.role == 'research', 'công tắc tắt ⇒ lệnh vai cũ'
    session = store.get(sid)
    assert runtime.turn_profile(session)['mode'] == 'main'
    assert runtime.turn_profile(session)['promptBlock'] == ''
    runtime.active_turn[sid] = 1
    store.child_start('legacy-1', sid, 1, 1, 'research')
    # Cổng cửa 2 không chạy khi công tắc tắt: cổng MỀM warn của f17d54b giữ nguyên — notice, không chặn.
    assert research_runtime.missing_brief_gate(runtime, session, 'research') is True
    assert limits.RESEARCH_BRIEF_MISSING_CODE in [item['code'] for item in events(store, sid, 'notice')]
    assert research_job_pumpable(runtime, {'research_id': 'j', 'session_id': sid, 'revision': 1,
                                          'status': 'researching',
                                          'state': {'phase': 'searching'}}, session) is True, \
        'job cũ không có origin ⇒ đường bơm cũ giữ nguyên'
    store.research_job_save('needs', sid, {'origin': 'mode', 'phase': 'clarifying', 'budgetSeconds': 600},
                            status='needs_user')
    assert 'needs' not in {job['research_id'] for job in store.research_jobs_active()}
    store.close()
