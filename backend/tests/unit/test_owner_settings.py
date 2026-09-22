"""Chỉ dẫn của chủ máy (tab Instructions): một tài liệu + `revision`, một mốc ký tự.

Trước đợt 18 chỉ dẫn chỉ là một trường của config phiên: không có chỗ lưu (mở phiên
mới là mất), không có đường cho giao diện đọc lại, và trần 12 000 ký tự nằm dưới
dạng literal trong `runtime.py` nên phía giao diện muốn hiện bộ đếm phải chép tay
con số lần thứ hai. Tệp này khoá bốn điều:

* chuỗi được lưu **nguyên văn** (Markdown vẫn là Markdown, không chuẩn hoá);
* ghi lệch `revision` là lỗi thật `REVISION_CONFLICT`, không âm thầm ghi đè;
* chuỗi rỗng là trạng thái hợp lệ — và khi đó system message **không** ghép khối
  `OWNER-CONFIGURED DIRECTIVES` nào;
* trần ký tự chỉ có MỘT con số, dùng chung cho route và runtime.
"""
import asyncio
import inspect

import pytest
from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core import limits
from agentbox.agent_core import runtime as runtime_module
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.api import owner_settings as owner_settings_module
from agentbox.api.owner_settings import OwnerSettings
from agentbox.api.server import create_app
from agentbox.memory.session_store import SessionStore

# Host phải nằm trong allow-list của harness (TestServer mở cổng ngẫu nhiên), đúng khuôn
# test_context_window_heal; không gửi Origin thì boundary dùng mặc định http://localhost:3100.
HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}

MARKDOWN = '# Directives\n\n- Prove it before you claim it\n- Keep vendor trees read-only\n'


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


class FixtureRouterClient:
    """Router im lặng: lượt sửa cửa sổ ngữ cảnh lúc khởi động không gọi mạng."""

    async def model_metadata_map(self):
        return {}


def make_runtime(tmp_path, name='sessions.db'):
    store = SessionStore(tmp_path / name)
    return store, HarnessRuntime(store, FixtureExecutor(), FixtureRouterClient())


def document(tmp_path, name='sessions.db'):
    """Cặp `(store, tài liệu)` — người gọi đóng store, đúng khuôn các test khác."""
    store = SessionStore(tmp_path / name)
    return store, OwnerSettings(store)


def test_constructing_owner_settings_does_not_touch_the_database():
    """`create_app` dựng nó cho mọi app — kể cả runtime tối thiểu mà test khác dựng lên.

    Test nhật ký hệ thống dựng app bằng một store không có kết nối SQLite; chạm DB trong
    `__init__` là biến việc dựng app thành lỗi của một bảng chưa ai hỏi tới. Bảng chỉ được
    tạo khi có người thật sự hỏi tới tài liệu.
    """
    settings = OwnerSettings(object())   # store không có `.db`
    with pytest.raises(AttributeError):
        settings.settings()


def test_write_then_read_back_the_exact_string(tmp_path):
    store, settings = document(tmp_path)
    assert settings.settings() == {'instructions': '', 'revision': 0}, 'chưa ghi gì thì rỗng, revision 0'

    assert settings.configure({'instructions': MARKDOWN, 'revision': 0}) == {'instructions': MARKDOWN, 'revision': 1}
    assert settings.settings() == {'instructions': MARKDOWN, 'revision': 1}
    # Nguyên văn xuống tận cột trong SQLite: không cắt khoảng trắng, không đổi dấu xuống dòng.
    stored = store.db.execute('SELECT value FROM owner_settings WHERE id=1').fetchone()[0]
    assert stored == MARKDOWN
    store.close()


def test_a_stale_revision_names_the_conflict_and_keeps_the_stored_document(tmp_path):
    store, settings = document(tmp_path)
    first = settings.configure({'instructions': 'rule A', 'revision': 0})

    with pytest.raises(ValueError) as raised:
        settings.configure({'instructions': 'rule B', 'revision': 0})
    assert str(raised.value) == 'REVISION_CONFLICT: reload owner settings'
    assert settings.settings()['instructions'] == 'rule A', 'lệch revision thì không được ghi gì'

    assert settings.configure({'instructions': 'rule B', 'revision': first['revision']}) == \
        {'instructions': 'rule B', 'revision': 2}
    store.close()


def test_the_empty_string_is_a_valid_state_and_adds_no_directive_block(tmp_path):
    store, runtime = make_runtime(tmp_path)
    empty = runtime.create({'skills': [], 'instructions': ''})
    system = store.get(empty['id'])['messages'][0]
    assert system['role'] == 'system'
    assert empty['config']['instructions'] == ''
    assert 'OWNER-CONFIGURED DIRECTIVES' not in system['content'], \
        'chuỗi rỗng thì system message không được mang khối chỉ dẫn nào'

    # Đối chứng: có chỉ dẫn thì khối được ghép — nên khẳng định trên không phải rỗng nghĩa.
    typed = runtime.create({'skills': [], 'instructions': 'Be brief.'})
    assert store.get(typed['id'])['messages'][0]['content'].endswith(
        '=== OWNER-CONFIGURED DIRECTIVES ===\nBe brief.')
    store.close()


def test_a_long_document_reaches_the_system_message_cut_at_the_single_cap(tmp_path):
    store, runtime = make_runtime(tmp_path)
    text = 'A' * 12000 + 'B' * 3000
    assert len(text) == 15000

    session = runtime.create({'skills': [], 'instructions': text})
    assert session['config']['instructions'] == 'A' * limits.INSTRUCTIONS_MAX_CHARS
    content = store.get(session['id'])['messages'][0]['content']
    tail = content.split('=== OWNER-CONFIGURED DIRECTIVES ===\n', 1)[1]
    assert tail == 'A' * limits.INSTRUCTIONS_MAX_CHARS, 'chỉ 12 000 ký tự ĐẦU vào system message'
    assert 'B' not in tail, 'phần vượt trần bị bỏ hẳn, không lấy đoạn cuối'
    store.close()


def test_the_route_and_the_runtime_cut_by_the_same_number(tmp_path):
    assert owner_settings_module.INSTRUCTIONS_MAX_CHARS == limits.INSTRUCTIONS_MAX_CHARS
    assert runtime_module.INSTRUCTIONS_MAX_CHARS == limits.INSTRUCTIONS_MAX_CHARS
    source = inspect.getsource(runtime_module)
    assert '[:INSTRUCTIONS_MAX_CHARS]' in source, 'runtime phải cắt bằng hằng số dùng chung'
    assert '[:12000]' not in source, 'literal cũ phải biến mất, nếu không sẽ có hai nguồn'

    # Cùng con số đó cũng là câu trả lời của phía route cho "engine sẽ giữ gì".
    store, settings = document(tmp_path)
    settings.configure({'instructions': 'A' * 12000 + 'B' * 3000, 'revision': 0})
    assert settings.for_engine() == 'A' * owner_settings_module.INSTRUCTIONS_MAX_CHARS
    store.close()


def test_both_routes_speak_the_same_document_and_return_the_new_revision(tmp_path):
    async def run():
        store, runtime = make_runtime(tmp_path)
        async with TestServer(create_app(runtime)) as server:
            url = str(server.make_url('/api/agent/owner-settings'))
            async with ClientSession(headers=HEADERS) as http:
                async with http.get(url) as resp:
                    assert resp.status == 200
                    assert await resp.json() == {'instructions': '', 'revision': 0}
                body = {'instructions': MARKDOWN, 'revision': 0}
                async with http.put(url, json=body) as resp:
                    assert resp.status == 200
                    assert await resp.json() == {'instructions': MARKDOWN, 'revision': 1}
                async with http.get(url) as resp:
                    assert await resp.json() == {'instructions': MARKDOWN, 'revision': 1}
                # Ghi lại bằng revision cũ: 409 REVISION_CONFLICT (boundary đã map sẵn mã này)
                # và bản đang lưu không đổi.
                async with http.put(url, json={'instructions': 'other', 'revision': 0}) as resp:
                    assert resp.status == 409
                    assert 'REVISION_CONFLICT' in (await resp.json())['error']
                async with http.get(url) as resp:
                    assert await resp.json() == {'instructions': MARKDOWN, 'revision': 1}
        store.close()

    asyncio.run(run())


def test_a_session_created_without_instructions_reads_the_stored_document(tmp_path):
    """Lỗi b18-review #6: `for_engine()` không có người gọi ở production.

    Tab Instructions hứa tài liệu áp cho phiên MỚI. Đường giao diện gửi chỉ dẫn kèm yêu
    cầu nên điều đó đúng — nhưng một phiên tạo không qua giao diện (script, lịch chạy)
    thì trước đây không nhận được gì. Route tạo phiên đọc tài liệu đang lưu khi yêu cầu
    không mang chỉ dẫn; chỉ dẫn client gửi kèm vẫn thắng.
    """

    async def run():
        store, runtime = make_runtime(tmp_path)
        async with TestServer(create_app(runtime)) as server:
            settings_url = str(server.make_url('/api/agent/owner-settings'))
            create_url = str(server.make_url('/api/agent/sessions'))
            async with ClientSession(headers=HEADERS) as http:
                async with http.put(settings_url, json={'instructions': MARKDOWN, 'revision': 0}) as resp:
                    assert resp.status == 200

                # Không gửi `instructions`: phiên nhận tài liệu đang lưu, và system message
                # của nó mang đúng khối chỉ dẫn.
                async with http.post(create_url, json={'skills': []}) as resp:
                    assert resp.status == 201
                    inherited = await resp.json()
                assert inherited['config']['instructions'] == MARKDOWN
                system = store.get(inherited['id'])['messages'][0]['content']
                assert system.endswith(f'=== OWNER-CONFIGURED DIRECTIVES ===\n{MARKDOWN}')

                # Chỉ dẫn client gửi kèm thắng tài liệu đang lưu (đường giao diện).
                async with http.post(create_url, json={'skills': [], 'instructions': 'Be brief.'}) as resp:
                    assert resp.status == 201
                    typed = await resp.json()
                assert typed['config']['instructions'] == 'Be brief.'

                # Tài liệu rỗng: không có gì để thừa hưởng, hành vi cũ giữ nguyên.
                async with http.put(settings_url, json={'instructions': '', 'revision': 1}) as resp:
                    assert resp.status == 200
                async with http.post(create_url, json={'skills': []}) as resp:
                    assert resp.status == 201
                    empty = await resp.json()
                assert empty['config']['instructions'] == ''
                assert 'OWNER-CONFIGURED DIRECTIVES' not in store.get(empty['id'])['messages'][0]['content']
        store.close()

    asyncio.run(run())
