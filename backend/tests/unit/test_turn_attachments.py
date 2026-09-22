"""A7 (vòng 22) — tệp đính kèm đi cùng lượt và tới được MÔ HÌNH, không chỉ tới giao diện.

BUG-40 (vòng 21): ảnh đi vào `dataUrl` còn mọi tệp khác chỉ giữ cái TÊN — `ChatInputBar` ghép
chuỗi `[Attached Files: …]` nên trong box không có tệp nào, và mô hình không có đường nào đọc.
Phần A của vòng 22 đổi đường đi: ô soạn tin tải tệp lên box trước (`assign`), rồi gửi `attachments`
kèm lượt. Bài này chốt hợp đồng ở tầng HTTP — đúng những hàng đó vào event `user`, và **đường dẫn
tuyệt đối** phải nằm trong thân gửi mô hình, vì đó mới là thứ `file_read` cần.

Bốn luật của lượt cũng nằm đây, vì chúng là chốt an toàn chứ không phải chi tiết cài đặt:
`path` do client gửi không bao giờ trở thành đường dẫn tuyệt đối; trần ảnh của lượt; và
`invocationId` phải khoá CẢ danh sách tệp (gửi lại cùng id mà khác tệp là hai lượt khác nhau).

Ghi chú về cách đọc: `create_app` đăng ký `on_cleanup` đóng luôn store, nên mọi phép đọc hàng
nhật ký/event nằm TRONG khối `async with TestServer(...)` — đúng khuôn của
`test_turn_partial_budget.py`.
"""
import asyncio
import copy
import json

from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from agentbox.agent_core.attachments import (INLINE_IMAGE_CHARS_TOTAL, MAX_ATTACHMENTS,
                                             MAX_INLINE_MEDIA, attachment_prompt_block,
                                             validate_attachments, validate_inline_images)
from agentbox.agent_core.runtime import HarnessRuntime
from agentbox.api.server import create_app
from agentbox.memory.session_store import SessionStore

HEADERS = {'Host': '127.0.0.1:3102', 'X-BoxFox-Admin': '1'}
PNG = 'data:image/png;base64,' + 'A' * 64
FILES = [{'name': 'báo cáo.md', 'path': '.uploaded_artifacts/7.md', 'sizeBytes': 12288,
          'absolutePath': '/etc/passwd'},
         {'name': 'nhật ký.txt', 'path': '.uploaded_artifacts/8.txt', 'sizeBytes': 40}]
BLOCK_HEADER = '[Tệp đính kèm đã lưu trong box]'


def answer(text='đã nhận tệp'):
    return {'choices': [{'message': {'content': text}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}}


class FixtureModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    async def complete(self, messages, tools, route, max_tokens=4096, on_thought=None, on_content=None):
        self.requests.append({'messages': copy.deepcopy(messages), 'tools': copy.deepcopy(tools),
                              'route': copy.deepcopy(route), 'max_tokens': max_tokens})
        return next(self.responses)


class FixtureExecutor:
    async def execute(self, name, args, sid):
        return {'content': 'observed fixture result'}

    async def cleanup(self, sid):
        return None


async def open_session(server, values=None):
    """Mở phiên qua `POST /api/agent/sessions` như giao diện làm, trả về `(sid, url)`."""
    async with ClientSession(headers=HEADERS) as http:
        async with http.post(str(server.make_url('/api/agent/sessions')),
                             json={'skills': [], **(values or {})}) as resp:
            assert resp.status == 201
            return (await resp.json())['id'], str(server.make_url('/api/agent/sessions'))


async def send_turn(http, url, sid, body):
    async with http.post(f'{url}/{sid}/turns', json=body) as resp:
        return resp.status, await resp.json()


def user_events(store, sid):
    return [event['data'] for event in store.events(sid) if event['type'] == 'user']


def model_text(client, index=0):
    """Phần chữ của thông điệp `user` mà mô hình thật sự nhận ở lượt thứ `index`."""
    message = client.requests[index]['messages'][-1]
    assert message['role'] == 'user'
    content = message['content']
    if isinstance(content, str):
        return content
    return '\n'.join(part['text'] for part in content if part['type'] == 'text')


# --------------------------------------------------------------------------- #
# (a) tệp tới được event `user` VÀ tới được mô hình
# --------------------------------------------------------------------------- #

def test_two_attachments_reach_the_event_and_the_model_context(tmp_path):
    """Hai tệp: event `user` mang hai hàng đã kiểm, và thân gửi mô hình mang hai đường dẫn thật."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer()])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        async with TestServer(create_app(runtime)) as server:
            sid, url = await open_session(server)
            async with ClientSession(headers=HEADERS) as http:
                status, _body = await send_turn(http, url, sid, {'prompt': 'đọc hai tệp này',
                                                                 'attachments': FILES})
                assert status == 202
                await runtime.tasks[sid]

            rows = user_events(store, sid)
            assert len(rows) == 1, 'một lượt = một event `user`'
            assert rows[0]['text'] == 'đọc hai tệp này', 'câu của người dùng không bị ghép tên tệp vào'
            assert [row['path'] for row in rows[0]['attachments']] == ['.uploaded_artifacts/7.md',
                                                                       '.uploaded_artifacts/8.txt']
            assert [row['absolutePath'] for row in rows[0]['attachments']] == [
                '/home/agent/workspace/.uploaded_artifacts/7.md',
                '/home/agent/workspace/.uploaded_artifacts/8.txt'], \
                'đường dẫn tuyệt đối do harness suy ra, KHÔNG lấy `/etc/passwd` từ client'
            assert [row['sizeBytes'] for row in rows[0]['attachments']] == [12288, 40]
            assert [row['kind'] for row in rows[0]['attachments']] == ['file', 'file']

            stored = [message for message in store.get(sid)['messages'] if message['role'] == 'user']
            assert BLOCK_HEADER in stored[0]['content'], 'bản lưu trong phiên cũng mang khối đường dẫn'

        text = model_text(client)
        assert 'đọc hai tệp này' in text
        assert BLOCK_HEADER in text
        assert '- /home/agent/workspace/.uploaded_artifacts/7.md (báo cáo.md, 12 KB)' in text
        assert '- /home/agent/workspace/.uploaded_artifacts/8.txt (nhật ký.txt, 40 B)' in text

    asyncio.run(run())


def test_two_images_and_two_files_share_one_turn(tmp_path):
    """Ảnh và tệp đi chung: event `user` mang cả hai mảng, thân gửi mô hình là danh sách nhiều phần."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer()])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        async with TestServer(create_app(runtime)) as server:
            sid, url = await open_session(server)
            async with ClientSession(headers=HEADERS) as http:
                status, _body = await send_turn(http, url, sid, {'prompt': 'xem ảnh và đọc tệp',
                                                                 'images': [PNG, PNG],
                                                                 'attachments': FILES})
                assert status == 202
                await runtime.tasks[sid]

            row = user_events(store, sid)[0]
            assert row['images'] == [PNG, PNG] and len(row['attachments']) == 2

        content = client.requests[0]['messages'][-1]['content']
        assert isinstance(content, list), 'có ảnh thì thân phải là danh sách nhiều phần'
        assert [part['type'] for part in content] == ['text', 'image_url', 'image_url']
        assert BLOCK_HEADER in content[0]['text']
        assert '- /home/agent/workspace/.uploaded_artifacts/7.md' in content[0]['text']

    asyncio.run(run())


# --------------------------------------------------------------------------- #
# (b) trần ảnh của lượt; (c) đường dẫn của client
# --------------------------------------------------------------------------- #

def test_three_images_are_refused_with_the_turn_limit(tmp_path):
    """Ba ảnh: luật từng ảnh vẫn qua, nhưng trần của LƯỢT từ chối ⇒ 400 và không lượt nào chạy."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer()])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        async with TestServer(create_app(runtime)) as server:
            sid, url = await open_session(server)
            async with ClientSession(headers=HEADERS) as http:
                status, body = await send_turn(http, url, sid, {'prompt': 'ba ảnh',
                                                                'images': [PNG, PNG, PNG]})
            assert status == 400
            assert f'IMAGE_LIMIT: at most {MAX_INLINE_MEDIA} images per turn' in body['error']
            assert client.requests == [] and user_events(store, sid) == []
            assert store.get(sid)['status'] == 'idle', 'lượt bị từ chối không được đụng hàng phiên'

    asyncio.run(run())


def test_a_traversal_path_is_refused_before_the_turn_starts(tmp_path):
    """`path` có `..`: 400 ngay ở cửa, và mô hình không nhận được đường dẫn nào."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer()])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        bad = [{'name': 'passwd', 'path': '../../etc/passwd', 'sizeBytes': 10}]
        async with TestServer(create_app(runtime)) as server:
            sid, url = await open_session(server)
            async with ClientSession(headers=HEADERS) as http:
                status, body = await send_turn(http, url, sid, {'prompt': 'đọc tệp',
                                                                'attachments': bad})
            assert status == 400 and body['error'].startswith('ATTACHMENTS_INVALID')
            assert client.requests == [] and user_events(store, sid) == []

    asyncio.run(run())


def test_the_validator_never_takes_the_absolute_path_from_the_client():
    """Luật thuần: đường dẫn tuyệt đối luôn được suy từ `path`, và tên tệp thiếu thì lấy đuôi path."""

    checked = validate_attachments([{'path': '.uploaded_artifacts/9.pdf', 'sizeBytes': 5,
                                     'absolutePath': '/root/.ssh/id_rsa'}])
    assert checked[0]['absolutePath'] == '/home/agent/workspace/.uploaded_artifacts/9.pdf'
    assert checked[0]['name'] == '9.pdf'
    assert validate_attachments(None) == [] and validate_attachments([]) == []
    assert attachment_prompt_block([]) == ''
    for bad in ('/etc/passwd', '.uploaded_artifacts/../../etc/passwd', '', 'a//b', '\x00'):
        try:
            validate_attachments([{'path': bad, 'sizeBytes': 1}])
        except ValueError as exc:
            assert str(exc).startswith('ATTACHMENTS_INVALID'), bad
        else:  # pragma: no cover - chỉ chạy khi luật bị hạ
            raise AssertionError(f'đường dẫn phải bị từ chối: {bad!r}')
    try:
        validate_attachments([{'path': 'a.md', 'sizeBytes': 1}] * (MAX_ATTACHMENTS + 1))
    except ValueError as exc:
        assert f'at most {MAX_ATTACHMENTS} files per turn' in str(exc)
    else:  # pragma: no cover
        raise AssertionError('trần số tệp phải được áp dụng')


def test_the_total_image_chars_are_capped_even_under_the_count_limit():
    """Hai ảnh vẫn có thể vượt trần ký tự của lượt: trần TỔNG phải chặn trước khi gửi mô hình."""
    half = INLINE_IMAGE_CHARS_TOTAL // 2 + 10
    big = 'data:image/png;base64,' + 'A' * (half - len('data:image/png;base64,'))
    assert len(big) * 2 > INLINE_IMAGE_CHARS_TOTAL and len(big) <= 700_000, \
        'kịch bản phải là hai ảnh hợp lệ vượt trần TỔNG'
    try:
        validate_inline_images([big, big])
    except ValueError as exc:
        assert str(exc).startswith('IMAGE_LIMIT_TOTAL')
    else:  # pragma: no cover
        raise AssertionError('trần tổng ký tự ảnh phải được áp dụng')
    assert validate_inline_images([big, big[:64]]) == [big, big[:64]], \
        'dưới trần tổng thì hai ảnh phải đi qua nguyên vẹn'


# --------------------------------------------------------------------------- #
# (d) `invocationId` khoá cả danh sách tệp
# --------------------------------------------------------------------------- #

def test_the_same_invocation_id_with_other_attachments_conflicts(tmp_path):
    """Gửi lại cùng `invocationId` mà khác tệp là HAI lượt khác nhau — chốt luôn mã lỗi."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer(), answer()])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        async with TestServer(create_app(runtime)) as server:
            sid, url = await open_session(server)
            async with ClientSession(headers=HEADERS) as http:
                first = {'prompt': 'đọc tệp', 'invocationId': 'inv-1', 'attachments': FILES}
                status, _body = await send_turn(http, url, sid, first)
                assert status == 202
                await runtime.tasks[sid]
                same = await send_turn(http, url, sid, first)
                assert same[0] == 202, 'cùng id + cùng tệp = chính lượt cũ, không phải lượt thứ hai'
                other = await send_turn(http, url, sid, {**first, 'attachments': [FILES[0]]})
            assert other[0] == 409 and 'INVOCATION_CONFLICT' in other[1]['error']
            assert len(user_events(store, sid)) == 1, 'lượt bị chặn không để lại event nào'
            assert len(client.requests) == 1, 'lượt bị chặn không gọi mô hình lần nào'

    asyncio.run(run())


def test_the_attachment_block_is_absent_when_the_turn_has_no_files(tmp_path):
    """Lượt không có tệp: thân gửi mô hình là câu cũ, không có khối rỗng nào."""

    async def run():
        store = SessionStore(tmp_path / 'sessions.db')
        client = FixtureModel([answer()])
        runtime = HarnessRuntime(store, FixtureExecutor(), client)
        async with TestServer(create_app(runtime)) as server:
            sid, url = await open_session(server)
            async with ClientSession(headers=HEADERS) as http:
                status, _body = await send_turn(http, url, sid, {'prompt': 'chào'})
                assert status == 202
                await runtime.tasks[sid]

            assert 'attachments' not in user_events(store, sid)[0]
            assert json.dumps(store.get(sid)['messages'], ensure_ascii=False).count(BLOCK_HEADER) == 0

        assert model_text(client) == 'chào', 'không có tệp thì không thêm gì vào câu của người dùng'

    asyncio.run(run())
