"""Quyền của chủ nhà trên một run: sửa thẻ phạm vi (`scope`) và xin đào sâu (`deepen`) — §5.12.

Hai đường được kiểm ở ĐÚNG chỗ chúng gặp nhau: hàm runtime (`scope_update`, `deepen`) và tuyến HTTP
`PATCH /api/agent/research/jobs/{id}` dựng qua `create_app` với một runtime tối thiểu — chính là
tuyến mà giao diện P4 gọi.
"""
from __future__ import annotations

import asyncio
import types

import pytest
from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core import research_runtime
from agentbox.api.server import create_app
from agentbox.memory.session_store import SessionStore

HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}


class FakeRuntime:
    """Runtime đủ dùng cho hai tuyến: `store` thật + vòng đời của ứng dụng aiohttp."""

    def __init__(self, store):
        self.store = store
        self.tasks: dict = {}
        self.search_db_path = None

    async def heal_context_windows(self):
        return None


def a_session(store):
    """Một phiên làm chủ; mọi run trong cùng bài dùng CHUNG phiên (một job không đổi chủ được)."""
    return store.create({'skills': []})['id']


def scope_job(store, sid=None, *, research_id='RS1', revision=1, status='researching',
              velocity='fast'):
    sid = sid or a_session(store)
    scope = {'revision': revision, 'goal': {'text': 'mục tiêu', 'status': 'confirmed'},
             'timePolicy': {'velocity': velocity, 'status': 'confirmed'},
             'questions': [], 'exclude': [], 'openQuestions': [],
             'budget': {'proposedSeconds': 1800, 'hardCeilingSeconds': 7200}}
    return store.research_job_save(research_id, sid,
                                   {'goal': 'mục tiêu', 'phase': 'planning', 'scope': scope},
                                   status=status)


# --- hàm runtime ------------------------------------------------------------

def test_scope_update_merges_the_patch_and_bumps_the_revision(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store)
    answer = research_runtime.scope_update(object_with_store(store), job['session_id'], job,
                                          {'revision': 1, 'scope': {'goal': {'text': 'mục tiêu mới',
                                                                            'status': 'confirmed'},
                                                                    'questions': ['câu 1', 'câu 2'],
                                                                    'depth': 'deep',
                                                                    'budget': {'proposedSeconds': 900}}})
    assert answer['revision'] == 2
    scope = answer['scope']
    assert scope['goal']['text'] == 'mục tiêu mới'
    assert scope['depth'] == 'deep'
    assert len(scope['questions']) == 2
    assert scope['budget']['proposedSeconds'] == 900
    assert scope['budget']['hardCeilingSeconds'] == 7200  # ghép, không ghi đè cả cục
    assert scope['surveyDate'] and scope['window']['days'] > 0
    saved = store.research_job('RS1')
    assert saved['state']['scope']['revision'] == 2
    assert saved['state']['phaseHistory'][-1]['reason'] == 'scope-edited'


def test_scope_update_refuses_a_stale_revision_and_a_cancelled_run(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store, revision=3)
    with pytest.raises(ValueError) as error:
        research_runtime.scope_update(object_with_store(store), job['session_id'], job,
                                      {'revision': 1, 'scope': {'depth': 'deep'}})
    assert str(error.value).startswith('RESEARCH_SCOPE_REVISION_STALE')
    cancelled = scope_job(store, job['session_id'], research_id='RS2', status='cancelled')
    with pytest.raises(ValueError) as error:
        research_runtime.scope_update(object_with_store(store), cancelled['session_id'], cancelled,
                                      {'scope': {'depth': 'deep'}})
    assert 'RESEARCH_SCOPE_JOB_CANCELLED' in str(error.value)


def test_scope_update_rejects_an_empty_patch_and_a_job_without_a_scope(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store)
    with pytest.raises(ValueError) as error:
        research_runtime.scope_update(object_with_store(store), job['session_id'], job,
                                      {'revision': 1, 'scope': {}})
    assert 'RESEARCH_SCOPE_PATCH_REQUIRED' in str(error.value)
    bare = store.research_job_save('RS3', job['session_id'], {'goal': 'không có thẻ'},
                                   status='researching')
    with pytest.raises(ValueError) as error:
        research_runtime.scope_update(object_with_store(store), job['session_id'], bare, {'scope': {'depth': 'x'}})
    assert 'RESEARCH_SCOPE_MISSING' in str(error.value)


def test_a_wrong_velocity_keeps_the_old_window_and_only_leaves_a_note(tmp_path):
    """§7.3: người dùng gõ bừa `velocity` thì KHÔNG mất cửa sổ cũ, và không có lỗi nào ném ra."""
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store, velocity='fast')
    answer = research_runtime.scope_update(object_with_store(store), job['session_id'], job,
                                          {'revision': 1, 'scope': {'timePolicy': {'velocity': 'nhanh-lam'}}})
    policy = answer['scope']['timePolicy']
    assert policy['velocity'] == 'fast'          # giữ nguyên giá trị cũ
    assert 'không thuộc' in policy['note']       # và NÓI vì sao cửa sổ không đổi
    from agentbox.agent_core import research_evidence
    expected = research_evidence.window_bounds('fast', as_of=answer['surveyDate'])
    assert answer['window'] == expected and expected['days'] > 0


def test_deepen_queues_a_request_and_raises_the_facet(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store)
    key = store.facet_save('RS1', {'label': 'Hướng A', 'priority': 'low', 'status': 'searched'})['facetId']
    answer = research_runtime.deepen(object_with_store(store), job['session_id'], job,
                                    {'facetId': key, 'note': 'đọc kỹ hơn phần số liệu'})
    assert answer['facetId'] == key and answer['requests'] == 1
    assert answer['facet']['priority'] == 'high'
    assert 'đọc kỹ hơn phần số liệu' in answer['facet']['note']
    again = research_runtime.deepen(object_with_store(store), job['session_id'],
                                   store.research_job('RS1'), {'facetId': key, 'note': 'thêm'})
    assert again['requests'] == 2
    assert again['facet']['note'].endswith('thêm')
    saved = store.research_job('RS1')
    assert len(saved['state']['deepenRequests']) == 2


def test_deepen_needs_a_target_and_an_existing_facet(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store)
    with pytest.raises(ValueError) as error:
        research_runtime.deepen(object_with_store(store), job['session_id'], job, {'note': 'x'})
    assert 'RESEARCH_DEEPEN_TARGET_REQUIRED' in str(error.value)
    with pytest.raises(ValueError) as error:
        research_runtime.deepen(object_with_store(store), job['session_id'], job, {'facetId': 'f-không-có'})
    assert 'RESEARCH_FACET_UNKNOWN' in str(error.value)


# --- tuyến HTTP mà giao diện gọi -------------------------------------------

def test_the_job_endpoints_accept_scope_and_deepen_and_return_coverage(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store)
    store.facet_save('RS1', {'label': 'Hướng A', 'status': 'searched'})
    runtime = FakeRuntime(store)

    async def flow():
        app = create_app(runtime)
        server = TestServer(app)
        await server.start_server()
        try:
            async with ClientSession() as http:
                base = server.make_url(f'/api/agent/research/jobs/{job["research_id"]}')
                listed = await http.get(server.make_url(
                    f'/api/agent/research/jobs?sessionId={job["session_id"]}'), headers=HEADERS)
                assert listed.status == 200
                payload = await listed.json()
                assert payload['jobs'][0]['coverage']['counts']['total'] == 1
                assert [item['label'] for item in payload['jobs'][0]['facets']] == ['Hướng A']

                detail = await (await http.get(base, headers=HEADERS)).json()
                assert detail['job']['coverage']['counts']['total'] == 1
                assert detail['job']['facets'][0]['status'] == 'searched'

                stale = await http.patch(base, headers=HEADERS,
                                         json={'action': 'scope', 'revision': 99,
                                               'scope': {'depth': 'deep'}})
                assert stale.status == 409
                assert (await stale.json())['code'] == 'RESEARCH_SCOPE_REVISION_STALE'

                edited = await http.patch(base, headers=HEADERS,
                                          json={'action': 'scope', 'revision': 1,
                                                'scope': {'depth': 'deep'}})
                assert edited.status == 200
                body = await edited.json()
                assert body['revision'] == 2 and body['scope']['depth'] == 'deep'

                unknown = await http.patch(base, headers=HEADERS,
                                           json={'action': 'deepen', 'facetId': 'f-không-có'})
                assert unknown.status == 404
                assert (await unknown.json())['code'] == 'RESEARCH_FACET_UNKNOWN'

                deeper = await http.patch(base, headers=HEADERS,
                                          json={'action': 'deepen',
                                                'facetId': detail['job']['facets'][0]['facetId'],
                                                'note': 'sâu hơn'})
                assert deeper.status == 200
                assert (await deeper.json())['facet']['priority'] == 'high'

                invalid = await http.patch(base, headers=HEADERS, json={'action': 'nhảy múa'})
                assert invalid.status == 400
                assert (await invalid.json())['code'] == 'RESEARCH_ACTION_INVALID'
        finally:
            await server.close()

    asyncio.run(flow())


def test_the_scope_event_reaches_the_session_stream(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    job = scope_job(store)
    research_runtime.scope_update(object_with_store(store), job['session_id'], job,
                                  {'revision': 1, 'scope': {'depth': 'deep'}})
    events = [row for row in store.events(job['session_id']) if row.get('type') == 'research_scope']
    assert events and events[-1]['data']['revision'] == 2
    assert events[-1]['data']['researchId'] == 'RS1'


def object_with_store(store):
    """Runtime tối thiểu cho hàm runtime: chỉ `store` là được đọc."""
    return types.SimpleNamespace(store=store, search_db_path=None)
