"""Hai route plan của harness: `POST /api/agent/plans/review` + `GET /api/agent/plans/status`.

Đây là hợp đồng §4.1/§4.2 của plan vòng 20 nhìn từ phía giao diện, nên test gọi **route thật**
qua aiohttp (đúng thứ tab Plan gọi, không tham số nào), và kiểm ba ca mà plan đặt tên:

* một cú bấm của người dùng **vẫn** được ghi khi box đang tắt (`forwarded: false` + nhật ký
  `plan_review_forward_failed`) — quyết định không được biến mất vì hạ tầng;
* `reviewStale` bật khi số đo trên box đổi sau lúc duyệt, và bản duyệt đó không còn là đồng ý;
* duyệt `v1` không bao giờ làm `v2` thành `approved`.
"""
from __future__ import annotations

import asyncio
import json

from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core import plan_registry
from agentbox.api import server as api_server
from agentbox.api.server import create_app
from agentbox.memory.session_store import SessionStore
from agentbox.observability.system_log import SystemLog, read_entries

HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}
REVIEW_ROUTE = '/api/agent/plans/review'
STATUS_ROUTE = '/api/agent/plans/status'
IDENTITY = 'clinical-patient-record-lookup-research'


def plan_payload(*, versions=((3, 4650, '2026-09-20T13:50:00Z'),), identity=IDENTITY, slug=None):
    directory, tail = plan_registry.split_identity(identity)
    return {
        'plans': [{
            'identity': identity, 'relativeDirectory': directory, 'slug': slug or tail,
            'versions': [{'version': version, 'label': f'v{version}',
                          'relativePath': f'.plans/v{version}-{tail}.md', 'sizeBytes': size,
                          'modifiedAt': modified, 'status': 'draft', 'headerStatus': 'ok',
                          'headerVersion': version, 'headerIdentity': identity,
                          'declaredParent': None, 'declaredSlug': None}
                         for version, size, modified in versions],
        }],
        'ignoredCount': 0, 'warnings': [],
    }


class BoxExecutor:
    """Sandbox giả: `request()` là chỉ mục + đường chuyển tiếp duyệt, `execute()` không dùng."""

    def __init__(self, payload=None, index_error=None, forward_error=None):
        self.payload = payload
        self.index_error = index_error
        self.forward_error = forward_error
        self.requests = []

    async def request(self, path, body=None):
        self.requests.append((path, body))
        if path == plan_registry.INDEX_PATH:
            if self.index_error is not None:
                raise self.index_error
            return self.payload
        if self.forward_error is not None:
            raise self.forward_error
        return {'identity': (body or {}).get('identity'), 'decision': (body or {}).get('decision')}

    async def execute(self, name, args, sid):
        return {'content': 'not used by these routes'}

    async def cleanup(self, sid):
        return None


class QuietRouter:
    async def model_metadata_map(self):
        return {}


def make_runtime(tmp_path, executor):
    store = SessionStore(tmp_path / 'sessions.db')
    from agentbox.agent_core.runtime import HarnessRuntime
    return store, HarnessRuntime(store, executor, QuietRouter())


def call(tmp_path, executor, method, path, body=None, monkeypatch=None, log=None):
    """Một request thật qua aiohttp; trả `(status, payload)` và store để kiểm hậu quả."""
    async def run():
        store, runtime = make_runtime(tmp_path, executor)
        if monkeypatch is not None and log is not None:
            monkeypatch.setattr(api_server, 'system_log', log)
            monkeypatch.setattr(plan_registry, 'system_log', log)
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(server.make_url('/')) as client:
                kwargs = {'json': body} if body is not None else {}
                async with client.request(method, path, headers=HEADERS, **kwargs) as response:
                    text = await response.text()
                    try:
                        payload = json.loads(text)
                    except ValueError:
                        payload = text
                    status = response.status
            # Đọc sổ duyệt TRƯỚC khi máy chủ đóng: `create_app` đóng store trong cleanup.
            rows = store.plan_reviews_for(IDENTITY)
        return status, payload, rows

    return asyncio.run(run())


def test_review_is_written_to_the_ledger_and_forwarded_to_the_box(tmp_path):
    executor = BoxExecutor(payload=plan_payload())
    status, payload, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE,
                                 {'identity': IDENTITY, 'version': 3,
                                  'decision': 'changes_requested', 'note': 'nêu rõ mục 3'})
    assert status == 200
    assert payload['forwarded'] is True
    assert payload['decision'] == 'changes_requested'
    assert [row['decision'] for row in rows] == ['changes_requested']
    assert rows[0]['source'] == 'plan-tab'
    assert rows[0]['note'] == 'nêu rõ mục 3'
    assert [path for path, _ in executor.requests] == [plan_registry.INDEX_PATH, '/__box/plans/review']
    forwarded = executor.requests[1][1]
    assert forwarded == {'identity': IDENTITY, 'version': 3, 'decision': 'changes_requested',
                         'note': 'nêu rõ mục 3'}


def test_review_stamps_the_box_measurement_so_staleness_can_be_detected(tmp_path):
    executor = BoxExecutor(payload=plan_payload(versions=((3, 4650, '2026-09-20T13:50:00Z'),)))
    _, _, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE,
                      {'identity': IDENTITY, 'version': 3, 'decision': 'approved'})
    assert rows[0]['content_size'] == 4650
    assert rows[0]['content_modified_at'] == '2026-09-20T13:50:00Z'


def test_a_decision_survives_a_dead_box(tmp_path, monkeypatch):
    """Box tắt: quyết định vẫn vào sổ, `forwarded: false`, và nhật ký nói đúng mã lỗi."""
    log = SystemLog(directory=tmp_path, source='harness', filename='harness.jsonl')
    executor = BoxExecutor(payload=plan_payload(), forward_error=RuntimeError('box down'))
    status, payload, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE,
                                 {'identity': IDENTITY, 'version': 3, 'decision': 'approved'},
                                 monkeypatch=monkeypatch, log=log)
    assert status == 200 and payload['forwarded'] is False
    assert [row['decision'] for row in rows] == ['approved']
    # `create_app` gọi `rotate_on_shutdown()` khi máy chủ đóng, nên dòng vừa ghi nằm ở tệp
    # "previous" — đọc cả hai để test không phụ thuộc thứ tự tắt.
    entries = log.read() or read_entries([log.previous_path()])
    assert [entry['code'] for entry in entries if entry.get('code')] == ['PLAN_REVIEW_FORWARD_FAILED']


def test_a_dead_index_still_records_the_decision(tmp_path):
    executor = BoxExecutor(index_error=RuntimeError('box down'), forward_error=RuntimeError('box down'))
    status, payload, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE,
                                 {'identity': IDENTITY, 'version': 3, 'decision': 'approved'})
    assert status == 200 and payload['forwarded'] is False
    assert len(rows) == 1
    assert rows[0]['content_size'] is None, 'không đo được thì để trống, không bịa số đo'


def test_review_validation(tmp_path):
    executor = BoxExecutor(payload=plan_payload())
    cases = [
        ({'version': 3, 'decision': 'approved'}, 'PLAN_IDENTITY_INVALID'),
        ({'identity': 'Login Page', 'version': 3, 'decision': 'approved'}, 'PLAN_IDENTITY_INVALID'),
        ({'identity': IDENTITY, 'version': 0, 'decision': 'approved'}, 'PLAN_REVIEW_INVALID'),
        ({'identity': IDENTITY, 'version': '3', 'decision': 'approved'}, 'PLAN_REVIEW_INVALID'),
        ({'identity': IDENTITY, 'version': 3, 'decision': 'maybe'}, 'PLAN_REVIEW_INVALID'),
        ({'identity': IDENTITY, 'version': 3, 'decision': 'approved', 'note': 7}, 'PLAN_REVIEW_INVALID'),
    ]
    for body, code in cases:
        status, payload, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE, body)
        assert status == 400, body
        assert payload['code'] == code, body
        assert rows == [], body
    assert executor.requests == [], 'yêu cầu sai không được chạm tới box'


def test_status_of_an_identity_absent_from_the_index_is_none(tmp_path):
    executor = BoxExecutor(payload=plan_payload(identity='other-topic'))
    status, payload, _ = call(tmp_path, executor, 'GET',
                              f'{STATUS_ROUTE}?identity={IDENTITY}')
    assert status == 200
    assert payload['state'] == 'none'
    assert payload['stateVersion'] is None
    assert payload['review'] is None and payload['evaluation'] is None


def test_status_needs_a_valid_identity(tmp_path):
    executor = BoxExecutor(payload=plan_payload())
    for query in ('', '?identity=', '?identity=Login%20Page'):
        status, payload, _ = call(tmp_path, executor, 'GET', STATUS_ROUTE + query)
        assert status == 400, query
        assert payload['code'] == 'PLAN_IDENTITY_INVALID'
    status, payload, _ = call(tmp_path, executor, 'GET', f'{STATUS_ROUTE}?identity={IDENTITY}&version=abc')
    assert status == 400 and payload['code'] == 'PLAN_STATUS_INVALID'


def test_status_reads_the_newest_version_and_reports_stale_approvals(tmp_path):
    executor = BoxExecutor(payload=plan_payload(versions=((3, 4650, '2026-09-20T13:50:00Z'),
                                                          (4, 4514, '2026-09-20T13:56:00Z'))))
    _, _, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE,
                      {'identity': IDENTITY, 'version': 4, 'decision': 'approved'})
    assert rows[0]['version'] == 4
    status, payload, _ = call(tmp_path, executor, 'GET', f'{STATUS_ROUTE}?identity={IDENTITY}')
    assert status == 200
    assert (payload['state'], payload['stateVersion']) == ('approved', 4)
    assert payload['reviewStale'] is False
    assert payload['indexAvailable'] is True
    # Box báo file đã đổi sau lúc duyệt: bản duyệt đó đã cũ, không còn là đồng ý.
    moved = BoxExecutor(payload=plan_payload(versions=((3, 4650, '2026-09-20T13:50:00Z'),
                                                       (4, 4600, '2026-09-20T14:02:00Z'))))
    _, payload, _ = call(tmp_path, moved, 'GET', f'{STATUS_ROUTE}?identity={IDENTITY}')
    assert payload['reviewStale'] is True


def test_approving_v1_does_not_approve_v2(tmp_path):
    executor = BoxExecutor(payload=plan_payload(versions=((1, 100, '2026-09-20T13:00:00Z'),
                                                          (2, 200, '2026-09-20T13:10:00Z'))))
    _, _, rows = call(tmp_path, executor, 'POST', REVIEW_ROUTE,
                      {'identity': IDENTITY, 'version': 1, 'decision': 'approved'})
    assert rows[0]['version'] == 1
    _, payload, _ = call(tmp_path, executor, 'GET', f'{STATUS_ROUTE}?identity={IDENTITY}')
    assert (payload['state'], payload['stateVersion']) == ('draft', 2)
    _, older, _ = call(tmp_path, executor, 'GET', f'{STATUS_ROUTE}?identity={IDENTITY}&version=1')
    assert (older['state'], older['stateVersion']) == ('approved', 1)


def test_status_reports_submitted_only_while_the_approval_is_live(tmp_path):
    executor = BoxExecutor(payload=plan_payload(versions=((3, 4650, '2026-09-20T13:50:00Z'),)))
    from agentbox.agent_core.runtime import HarnessRuntime
    store = SessionStore(tmp_path / 'sessions.db')
    runtime = HarnessRuntime(store, executor, QuietRouter())
    runtime.pending['abc'] = {'kind': 'approval', 'resolved': False, 'planIdentity': IDENTITY,
                              'planVersion': 3}

    async def run():
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(server.make_url('/')) as client:
                async with client.get(f'{STATUS_ROUTE}?identity={IDENTITY}', headers=HEADERS) as response:
                    live = await response.json()
                runtime.pending['abc']['resolved'] = True
                async with client.get(f'{STATUS_ROUTE}?identity={IDENTITY}', headers=HEADERS) as response:
                    settled = await response.json()
        return live, settled

    live, settled = asyncio.run(run())
    assert live['state'] == 'submitted'
    assert settled['state'] == 'draft'


def test_status_degrades_honestly_when_the_index_is_unreadable(tmp_path):
    executor = BoxExecutor(index_error=RuntimeError('box down'))
    status, payload, _ = call(tmp_path, executor, 'GET', f'{STATUS_ROUTE}?identity={IDENTITY}')
    assert status == 200
    assert payload['state'] == 'unknown'
    assert payload['indexAvailable'] is False


def test_status_returns_the_stored_evaluation_when_one_exists(tmp_path):
    executor = BoxExecutor(payload=plan_payload(versions=((3, 4650, '2026-09-20T13:50:00Z'),)))
    store, runtime = make_runtime(tmp_path, executor)
    store.record_plan_evaluation(IDENTITY, 3, {'total': 14, 'levels': {'P1': 2}}, 14, 'pass')

    async def run():
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(server.make_url('/')) as client:
                async with client.get(f'{STATUS_ROUTE}?identity={IDENTITY}', headers=HEADERS) as response:
                    return await response.json()

    payload = asyncio.run(run())
    assert payload['evaluation']['total'] == 14
    assert payload['evaluation']['verdict'] == 'pass'
    assert payload['evaluation']['payload']['levels'] == {'P1': 2}
    store.close()
