"""`GET /api/agent/runtime-info` (số thật cho giao diện) và luật chỉ-được-thu-hẹp.

Hai việc nằm chung một tệp vì chúng trả lời cùng một câu hỏi: giao diện được phép
hứa gì. Tám nhóm công cụ ở đây phải hợp đúng bằng bộ của orchestrator, mỗi vai trò
đúng bằng `roles.ROLES[...]`, các con số retry/trần đúng bằng hằng trong `failures.py`
và `limits.py` — và một harness gửi lên bộ công cụ chỉ có thể THU HẸP bộ của vai trò.
Không đường nào nới ra: nếu nới được thì khối "Tool access" trên giao diện sẽ hứa
điều engine từ chối bằng `Tool not permitted for this role`.
"""
import asyncio
import inspect

from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core import failures, limits
from agentbox.agent_core import runtime as runtime_module
from agentbox.agent_core import tool_groups as tool_groups_module
from agentbox.agent_core.roles import ORCHESTRATOR_TOOLS, ROLES
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.api.server import create_app
from agentbox.memory.session_store import SessionStore

# Host phải nằm trong allow-list của harness (TestServer mở cổng ngẫu nhiên), đúng khuôn
# test_context_window_heal; không gửi Origin thì boundary dùng mặc định http://localhost:3100.
HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


class FixtureRouterClient:
    """Router im lặng: lượt sửa cửa sổ ngữ cảnh lúc khởi động không gọi mạng."""

    async def model_metadata_map(self):
        return {}


class RecordingModel:
    """Ghi lại đúng danh sách công cụ mà engine đưa cho model ở mỗi lượt."""

    def __init__(self):
        self.offered = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.offered.append([schema['function']['name'] for schema in tools])
        return {'choices': [{'message': {'content': 'ok'}, 'finish_reason': 'stop'}],
                'usage': None, 'boxfox': None}


def make_runtime(tmp_path, name='sessions.db'):
    store = SessionStore(tmp_path / name)
    return store, HarnessRuntime(store, FixtureExecutor(), FixtureRouterClient())


def runtime_info(tmp_path, name='runtime-info.db'):
    """Route thật qua aiohttp — đúng thứ giao diện gọi, không tham số nào."""

    async def run():
        store, runtime = make_runtime(tmp_path, name)
        async with TestServer(create_app(runtime)) as server:
            async with ClientSession(headers=HEADERS) as http:
                async with http.get(str(server.make_url('/api/agent/runtime-info'))) as resp:
                    assert resp.status == 200
                    payload = await resp.json()
        store.close()
        return payload

    return asyncio.run(run())


def test_a_requested_subset_is_kept_exactly(tmp_path):
    store, runtime = make_runtime(tmp_path)
    subset = ['file_read', 'codebase_grep', 'terminal_exec']
    session = runtime.create({'skills': [], 'tools': subset})
    assert session['config']['tools'] == sorted(subset)
    store.close()


def test_names_outside_the_role_set_are_dropped(tmp_path):
    store, runtime = make_runtime(tmp_path)
    session = runtime.create({'skills': [], 'tools': ['file_read', 'sudo_rm_rf', 'ask_user']})
    assert session['config']['tools'] == ['ask_user', 'file_read'], 'tên lạ bị bỏ, tên hợp lệ giữ nguyên'

    # Vai trò hẹp hơn orchestrator: Explore không có `web_search` hay `terminal_exec`.
    child = runtime.create({'skills': [], 'tools': ['file_read', 'web_search', 'terminal_exec']},
                           role='explore')
    assert child['config']['tools'] == ['file_read']
    store.close()


def test_a_child_role_stays_inside_its_parent_set(tmp_path):
    store, runtime = make_runtime(tmp_path)
    parent = runtime.create({'skills': [], 'tools': ['file_read']})
    # Con xin nguyên bộ của vai trò Plan (có `write_plan`), nhưng cha đã thu hẹp còn một
    # công cụ ⇒ con chỉ nhận phần giao với cha. Đây cũng là cách `delegate()` gọi `create`.
    child = runtime.create({'skills': [], 'tools': sorted(ROLES['plan'].tools)},
                           parent_id=parent['id'], role='plan', parent_tools=parent['config']['tools'])
    assert child['config']['tools'] == ['file_read'], 'con không được vượt cha'
    assert 'write_plan' not in child['config']['tools']
    store.close()


def test_a_missing_or_non_list_field_keeps_the_role_default(tmp_path):
    store, runtime = make_runtime(tmp_path)
    default = sorted(ORCHESTRATOR_TOOLS)
    for values in ({}, {'tools': 'file_read'}, {'tools': {'file_read': True}}, {'tools': None}, {'tools': 7}):
        session = runtime.create({'skills': [], **values})
        assert session['config']['tools'] == default, f'{values!r} phải giữ nguyên hành vi hôm nay'
    child = runtime.create({'skills': []}, role='explore')
    assert child['config']['tools'] == sorted(ROLES['explore'].tools)
    store.close()


def test_the_turn_offers_the_model_exactly_the_narrowed_set(tmp_path):
    """Đường thật của một lượt: bộ đã thu hẹp là bộ được gửi cho model.

    Config đúng mà lượt vẫn gửi bộ đầy đủ thì luật thu hẹp chỉ là hình thức — đây là
    chỗ chứng minh `schemas_for(config['tools'])` thấy đúng bộ đã cắt.
    """

    async def run(name, values):
        client = RecordingModel()
        store, runtime = make_runtime(tmp_path, name)
        runtime.client = client
        session = runtime.create({'skills': [], 'connectionId': 'c1', 'modelId': 'm1',
                                  'timeoutSeconds': 30, **values})
        await runtime.submit(session['id'], 'đọc file')
        await runtime.tasks[session['id']]
        store.close()
        return client.offered[-1]

    narrowed = asyncio.run(run('narrow.db', {'tools': ['file_read', 'sudo_rm_rf']}))
    assert narrowed == ['file_read']
    full = asyncio.run(run('full.db', {}))
    assert sorted(full) == sorted(ORCHESTRATOR_TOOLS), 'thiếu trường thì lượt vẫn thấy đủ 24 công cụ'


def test_the_eight_groups_cover_the_orchestrator_exactly():
    groups = tool_groups_module.TOOL_GROUPS
    assert [g['key'] for g in groups] == ['repositoryReading', 'skills', 'filesTerminal',
                                          'screenBrowser', 'webResearch', 'delegationPlans',
                                          'peerMesh', 'questionsApprovals'], \
        'đúng thứ tự bảng Nút vặn của runtime (T8 thêm nhóm thứ tám: mesh agent con)'
    assert all(set(g) == {'key', 'tools', 'alwaysOn'} for g in groups)
    assert all(g['tools'] for g in groups)
    union = [tool for g in groups for tool in g['tools']]
    assert len(union) == len(set(union)) == 24, 'tám nhóm không chồng nhau, tổng 24 công cụ'
    assert set(union) == set(ORCHESTRATOR_TOOLS)

    assert [g['key'] for g in groups if g['alwaysOn']] == ['questionsApprovals']
    questions = next(g for g in groups if g['key'] == 'questionsApprovals')
    assert set(questions['tools']) == {'ask_user', 'request_approval'}


def test_the_route_answers_the_same_eight_groups(tmp_path):
    info = runtime_info(tmp_path)
    assert info['toolGroups'] == tool_groups_module.tool_groups()
    assert info['tools'] == sorted(ORCHESTRATOR_TOOLS)
    assert len(info['tools']) == 24


def test_every_role_row_equals_the_roles_definition(tmp_path):
    info = runtime_info(tmp_path)
    assert {row['id'] for row in info['roles']} == set(ROLES)
    for row in info['roles']:
        role = ROLES[row['id']]
        assert row['name'] == role.name
        assert row['tools'] == sorted(role.tools), f'bộ công cụ của {row["id"]} phải là của roles.py'
        assert row['skills'] == list(role.skills)


def test_the_retry_numbers_are_the_constants_of_the_policy(tmp_path):
    info = runtime_info(tmp_path)
    assert info['retry'] == {
        'maxRetries': failures.DEFAULT_MAX_RETRIES,
        'backoffSeconds': list(failures.BACKOFF_SECONDS),
        'rateLimitMaxSeconds': failures.RATE_LIMIT_MAX_SECONDS,
        'budgetSeconds': failures.RETRY_BUDGET_SECONDS,
        'jitter': failures.BACKOFF_JITTER,
    }
    assert info['retry']['backoffSeconds'] == [1.0, 4.0, 12.0]
    assert info['retry']['maxRetries'] == 3


def test_the_limits_are_the_numbers_the_runtime_applies(tmp_path):
    info = runtime_info(tmp_path)
    assert info['limits'] == {
        'instructionsChars': limits.INSTRUCTIONS_MAX_CHARS,
        'maxStepsDefault': limits.MAX_STEPS_DEFAULT,
        'maxStepsMax': limits.MAX_STEPS_MAX,
        'deadlineDefaultSeconds': limits.DEADLINE_DEFAULT_SECONDS,
        'deadlineMaxSeconds': limits.DEADLINE_MAX_SECONDS,
        'childMaxSteps': limits.CHILD_MAX_STEPS,
        'childDeadlineSeconds': limits.CHILD_DEADLINE_SECONDS,
        # T13 — khối peer: cùng luật "số báo cho giao diện là số engine đang áp", đọc từ `limits`
        # và từ chính runtime (hai giá trị `*Now` đọc env ở thời điểm gọi).
        'peer': {
            'enabled': limits.peer_mesh_enabled(),
            'fanoutPerParentDefault': limits.FANOUT_PER_PARENT_DEFAULT,
            'fanoutPerParentMax': limits.FANOUT_PER_PARENT_MAX,
            'fanoutPerParentNow': HarnessRuntime.fanout_limit({}),
            'fanoutGlobalCeiling': limits.FANOUT_GLOBAL_CEILING,
            'deliverMax': limits.PEER_DELIVER_MAX,
            'waitSafetySeconds': limits.PEER_WAIT_SAFETY_SECONDS,
            'waitMaxSeconds': limits.PEER_WAIT_MAX_SECONDS,
            'waitMaxNow': limits.peer_wait_max(),
            'parallelReadTools': limits.parallel_read_tools_enabled(),
            'watchdogTickSeconds': limits.WATCHDOG_TICK_SECONDS,
            'childWallMaxSeconds': limits.CHILD_WALL_MAX_SECONDS,
        },
    }
    assert info['limits']['instructionsChars'] == limits.INSTRUCTIONS_MAX_CHARS

    # Số báo cho giao diện phải là số engine thật sự kẹp — không phải một bảng chép tay.
    store, runtime = make_runtime(tmp_path, 'limits-check.db')
    plain = runtime.create({'skills': []})['config']
    assert (plain['maxSteps'], plain['deadlineSeconds']) == \
        (info['limits']['maxStepsDefault'], info['limits']['deadlineDefaultSeconds'])
    clamped = runtime.create({'skills': [], 'maxSteps': 9999, 'deadlineSeconds': 99999})['config']
    assert (clamped['maxSteps'], clamped['deadlineSeconds']) == \
        (info['limits']['maxStepsMax'], info['limits']['deadlineMaxSeconds'])
    # Vai trò con bị chặn chặt hơn ở `delegate()`; hai hằng đó là thứ hàm đó dùng.
    source = inspect.getsource(runtime_module.HarnessRuntime.delegate)
    assert 'min(CHILD_MAX_STEPS' in source and 'min(CHILD_DEADLINE_SECONDS' in source
    store.close()
