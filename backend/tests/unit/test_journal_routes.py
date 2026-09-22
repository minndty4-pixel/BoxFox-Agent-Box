"""A9 — hai route nhật ký + khối `journal` trong payload phiên (gọi route THẬT qua aiohttp).

Ba bề mặt này là thứ UI sau này đọc; đợt này không vẽ gì nên hợp đồng phải được khoá bằng test:
`GET /api/agent/sessions/{sid}/journal` trả `{records, nextSeq, more, degraded}`, con trỏ `after`
chạy đúng, lọc `kind` đúng, `GET /api/agent/journal/tasks` trả task kèm phiên, và payload phiên có
`journal.records` **cộng thêm** (không phá chỗ đọc cũ). Thiếu header admin thì 403 — như mọi route.
"""
from __future__ import annotations

import asyncio
import json

from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core import session_journal
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.api.server import create_app
from agentbox.memory.session_store import SessionStore

HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'ok': True}

    async def cleanup(self, sid):
        return None


def fetch(tmp_path, coro_factory):
    """Chạy một chuỗi request thật trong MỘT phiên aiohttp, trả `(status, payload)` từng cái."""
    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        runtime = HarnessRuntime(store, FixtureExecutor(), None)
        session = runtime.create({'skills': []})
        sid = session['id']
        results = []
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(server.make_url('/')) as client:
                results = await coro_factory(client, store, runtime, sid)
        return results

    return asyncio.run(run())


def test_the_journal_route_pages_records_with_a_cursor(tmp_path):
    async def scenario(client, store, runtime, sid):
        for index in range(5):
            await session_journal.append(runtime.executor, store, sid, 'step',
                                         f'bước {index} xong', status='done')
        first = await (await client.get(f'/api/agent/sessions/{sid}/journal?limit=2',
                                        headers=HEADERS)).json()
        second = await (await client.get(f'/api/agent/sessions/{sid}/journal?limit=2&after='
                                         f"{first['nextSeq']}", headers=HEADERS)).json()
        kinds = await (await client.get(f'/api/agent/sessions/{sid}/journal?kind=checkpoint',
                                       headers=HEADERS)).json()
        return first, second, kinds

    first, second, kinds = fetch(tmp_path, scenario)
    assert [record['text'] for record in first['records']] == ['bước 0 xong', 'bước 1 xong']
    assert first['more'] is True and first['degraded'] is False
    assert first['nextSeq'] == first['records'][-1]['seq'] == 2
    assert [record['text'] for record in second['records']] == ['bước 2 xong', 'bước 3 xong']
    assert second['nextSeq'] == 4, 'con trỏ đi tiếp từ `after`'
    assert kinds['records'] == [], 'lọc `kind` không khớp thì trả rỗng, không trả hết'


def test_a_record_pinned_with_turn_and_step_carries_them_through_the_route(tmp_path):
    """P1.2 — lượt/bước của bản ghi phải đi hết đường: `append` → SQLite → payload route.

    Hàng cũ (ghi trước vòng này) KHÔNG có hai khoá: trả `None`, không được bịa số 0 — người đọc
    phải phân biệt được "không có lượt" với "lượt 0".
    """
    async def scenario(client, store, runtime, sid):
        await session_journal.append(runtime.executor, store, sid, 'evidence',
                                     'lượt ba có bằng chứng', turn=3, step=2, status='info')
        await session_journal.append(runtime.executor, store, sid, 'step',
                                     'bước cũ không có số lượt', status='done')
        payload = await (await client.get(f'/api/agent/sessions/{sid}/journal',
                                          headers=HEADERS)).json()
        return payload['records']

    records = fetch(tmp_path, scenario)
    assert (records[0]['turn'], records[0]['step']) == (3, 2)
    assert records[1]['turn'] is None and records[1]['step'] is None, \
        'hàng không có lượt trả None, không được bịa số 0'


def test_a_failed_file_layer_shows_up_as_degraded(tmp_path):
    async def scenario(client, store, runtime, sid):
        store.emit(sid, 'notice', {'code': 'JOURNAL_DEGRADED', 'message': 'box đóng rồi'})
        return await (await client.get(f'/api/agent/sessions/{sid}/journal', headers=HEADERS)).json()

    payload = fetch(tmp_path, scenario)
    assert payload['degraded'] is True, 'tầng file hỏng phải đọc được từ cờ này'


def test_the_tasks_route_answers_which_session_a_task_belongs_to(tmp_path):
    async def scenario(client, store, runtime, sid):
        item = await session_journal.append(runtime.executor, store, sid, 'task', 'việc: nén 1M',
                                            status='doing')
        await session_journal.append(runtime.executor, store, sid, 'task', 'việc: xong rồi',
                                     status='done')
        tasks = await (await client.get('/api/agent/journal/tasks?status=doing', headers=HEADERS)).json()
        everything = await (await client.get('/api/agent/journal/tasks', headers=HEADERS)).json()
        return item, tasks, everything

    item, tasks, everything = fetch(tmp_path, scenario)
    assert len(tasks['tasks']) == 1, 'lọc theo trạng thái đọc từ BẢN GHI, không phải chuỗi thô'
    task = tasks['tasks'][0]
    assert task['status'] == 'doing' and task['text'] == 'việc: nén 1M'
    assert task['session'].startswith(task['sid8']) and len(task['sid8']) == 8
    assert task['id'].startswith('T:')
    assert [entry['status'] for entry in everything['tasks']] == ['done', 'doing'], 'mới nhất trước'


def test_the_tasks_route_reports_the_refs_and_evidence_it_holds(tmp_path):
    """Bản 0.1 trả `refs`/`evidence` là `null` cho MỌI việc, vì `record_view` không đọc hai trường đó.

    Người đọc route tưởng "việc này không có tham chiếu nào", trong khi sự thật là "route không
    đọc ra". Hai câu đó khác nhau, và đây là chỗ duy nhất nói được câu thứ hai.
    """
    async def scenario(client, store, runtime, sid):
        await session_journal.append(runtime.executor, store, sid, 'task', 'việc: ghim nhật ký',
                                     refs=None, evidence=None)
        await session_journal.append(runtime.executor, store, sid, 'task', 'việc: có tham chiếu',
                                     evidence=[{'type': 'file', 'path': '.session-history',
                                                'note': 'journal.jsonl'}])
        return await (await client.get('/api/agent/journal/tasks', headers=HEADERS)).json()

    payload = fetch(tmp_path, scenario)
    newest, oldest = payload['tasks']
    assert newest['evidence'] == [{'type': 'file', 'path': '.session-history',
                                   'note': 'journal.jsonl'}]
    assert newest['refs'] == []
    assert oldest['refs'] == [] and oldest['evidence'] == [], 'không có thì là danh sách RỖNG'


def test_the_session_payload_gains_a_journal_block_without_losing_anything(tmp_path):
    async def scenario(client, store, runtime, sid):
        await session_journal.append(runtime.executor, store, sid, 'task', 'việc: ghim nhật ký')
        payload = await (await client.get(f'/api/agent/sessions/{sid}', headers=HEADERS)).json()
        return payload

    payload = fetch(tmp_path, scenario)
    assert [record['text'] for record in payload['journal']['records']] == ['việc: ghim nhật ký']
    assert payload['journal']['lastSeq'] == payload['journal']['records'][0]['seq']
    assert payload['journal']['degraded'] is False
    assert 'messages' not in payload, 'transcript vẫn không được gửi kèm'
    assert payload['sessionMetrics']['messageCount'] >= 0, 'khối cũ không bị mất'
    assert payload['events'] == [], 'phiên này chưa có event nào — nhưng khoá `events` vẫn phải có'
    assert isinstance(payload['config'], dict) and payload['id'], 'hàng phiên cũ vẫn nguyên'


def test_both_routes_need_the_admin_header(tmp_path):
    async def scenario(client, store, runtime, sid):
        anonymous = await client.get(f'/api/agent/sessions/{sid}/journal')
        tasks = await client.get('/api/agent/journal/tasks')
        return anonymous.status, tasks.status

    anonymous, tasks = fetch(tmp_path, scenario)
    assert (anonymous, tasks) == (403, 403)


def test_a_bad_query_is_a_400_not_a_500(tmp_path):
    async def scenario(client, store, runtime, sid):
        bad_after = await client.get(f'/api/agent/sessions/{sid}/journal?after=x', headers=HEADERS)
        bad_limit = await client.get('/api/agent/journal/tasks?limit=x', headers=HEADERS)
        return bad_after.status, json.loads(await bad_after.text()), bad_limit.status

    status, payload, limit_status = fetch(tmp_path, scenario)
    assert status == 400 and 'JOURNAL_BAD_QUERY' in payload['error']
    assert limit_status == 400
