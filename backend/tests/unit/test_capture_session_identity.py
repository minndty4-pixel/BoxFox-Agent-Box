"""A3 — ảnh và ghi hình phải mang **định danh phiên** qua dây, không chỉ ở tầng box.

`capture.py` đã biết xếp ảnh vào `captures/<kind>/<sid8>/` từ lâu, và `ide-proxy.py` đã chuyển
tiếp `session` — nhưng harness gọi `/__box/capture` **không kèm** `session`, nên trong thực tế
mọi ảnh mới vẫn rơi vào thư mục phẳng. Đo sống 2026-09-21: `captures/screen` = 375 tệp / 113 MB,
79 tệp `mp4` = 94 505 331 B, và 123 tệp không được payload nào nhắc tới.

Bài này khoá đúng mắt nối còn thiếu: thân yêu cầu của hai route capture/record phải có `session`.
Kiểm ở tầng `SandboxExecutor.request` (chỗ duy nhất biết cả `session` lẫn đường dẫn HTTP) nên
không phụ thuộc box thật.
"""
from __future__ import annotations

import asyncio
import base64
import struct
import zlib

import pytest

from agentbox.agent_core.failures import classify_failure
from agentbox.sandbox import executor as executor_module
from agentbox.sandbox.executor import BoxRequestError, SandboxExecutor, box_error_message

SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
BOX_AMBIGUOUS = 'Nhiều tab khớp target — chọn chính xác hơn'


def _png() -> bytes:
    """Ảnh PNG 2x2 hợp lệ — `computer_screen_capture` từ chối ảnh không đọc được kích thước."""
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00' + b'\x00' * 6 + b'\x00' + b'\x00' * 6))
            + chunk(b'IEND', b''))


class RecordingExecutor(SandboxExecutor):
    """Chặn ở `request` — đúng mặt mà harness gửi ra box; trả về khuôn box thật trả về."""

    def __init__(self):
        super().__init__()
        self.sent = []
        self.recordings_in_box = []

    async def request(self, path, body=None):
        self.sent.append((path, body))
        if path == '/__box/capture':
            return {'path': 'screen/a1b2c3d4/a1b2c3d4_000_screen.png',
                    'data': base64.b64encode(_png()).decode('ascii')}
        if path == '/__box/record/start':
            return {'recordingId': 'rec-1', 'active': True}
        if path == '/__box/record/stop':
            return {'recordingId': (body or {}).get('recordingId'), 'active': False}
        return {}


def test_a_screenshot_carries_the_session_id_so_it_lands_in_the_session_folder():
    executor = RecordingExecutor()
    result = asyncio.run(executor.execute('computer_screen_capture', {}, SID))
    assert executor.sent == [('/__box/capture', {'target': {'kind': 'screen'}, 'output': 'base64',
                                                 'session': SID})]
    assert result['dimensions'] == (2, 2)
    assert result['artifact'] == 'screen/a1b2c3d4/a1b2c3d4_000_screen.png'


def test_recording_carries_the_session_id_too():
    executor = RecordingExecutor()
    asyncio.run(executor.execute('computer_screen_record', {'action': 'start'}, SID))
    asyncio.run(executor.execute('computer_screen_record', {'action': 'stop'}, SID))
    assert executor.sent[0] == ('/__box/record/start', {'target': {'kind': 'screen'}, 'session': SID})
    # Lệnh dừng đã có `recordingId` (định danh bản ghi) — thêm `session` ở đó là vô nghĩa.
    assert executor.sent[1] == ('/__box/record/stop', {'recordingId': 'rec-1'})


def test_a_box_that_ignores_the_session_still_works():
    """Box cũ trả y hệt khuôn cũ: harness không được đổi hình dạng payload khi box bỏ qua `session`."""
    class OldBox(RecordingExecutor):
        async def request(self, path, body=None):
            self.sent.append((path, body))
            if path == '/__box/capture':
                return {'path': 'screen/1700000000000-screen.png',
                        'data': base64.b64encode(_png()).decode('ascii')}
            return {}

    executor = OldBox()
    result = asyncio.run(executor.execute('computer_screen_capture', {}, SID))
    assert result['artifact'] == 'screen/1700000000000-screen.png'
    assert set(result) >= {'content', 'artifact', 'image', 'mime', 'dimensions'}


# ---------------------------------------------------------------------------------------------
# Vòng 23 (P2.2/P2.4/P2.5) — `target` của model đi tới box, lỗi của box đi lên nguyên văn.
# Mọi ca dưới đây kiểm ở tầng `SandboxExecutor` (chỗ duy nhất biết cả `session` lẫn thân HTTP),
# không cần box thật.
# ---------------------------------------------------------------------------------------------
def test_mot_target_tab_di_nguyen_qua_executor_kem_nhan_trong_ten_tep():
    """P2.5(a) — model xin chụp MỘT tab thì đúng target đó ra tới box, kèm nhãn ASCII của `caption`.

    `label` là chữ HARNESS sinh từ `caption` (bỏ dấu, chỉ `[a-z0-9-]`): `capture.py._slug` thay mọi
    ký tự khác bằng `-`, nên gửi nguyên dấu tiếng Việt sẽ ra một tên tệp toàn gạch ngang.
    """
    executor = RecordingExecutor()
    asyncio.run(executor.execute('computer_screen_capture',
                                 {'target': {'kind': 'tab', 'url': '127.0.0.1:5173'},
                                  'caption': 'Kiểm thử RAG'}, SID))
    assert executor.sent == [('/__box/capture', {
        'target': {'kind': 'tab', 'url': '127.0.0.1:5173', 'label': 'kiem-thu-rag'},
        'output': 'base64', 'session': SID})]


def test_mot_target_cua_so_di_nguyen_qua_executor():
    """P2.5(a) — cửa sổ: `windowId`/`pid` của box đi nguyên, khoá box không đọc bị bỏ."""
    executor = RecordingExecutor()
    asyncio.run(executor.execute('computer_screen_capture',
                                 {'target': {'kind': 'window', 'windowId': '0x400003', 'pid': 42,
                                             'selector': '#app', 'zoom': 2}}, SID))
    assert executor.sent[0][1]['target'] == {'kind': 'window', 'windowId': '0x400003', 'pid': 42}


def test_target_rac_quay_ve_screen_nhu_cu():
    """P2.5(b) — kind lạ/`target` sai kiểu ⇒ `screen`: hành vi của chỗ gọi cũ không đổi một byte."""
    executor = RecordingExecutor()
    asyncio.run(executor.execute('computer_screen_capture', {'target': {'kind': 'webcam'}}, SID))
    asyncio.run(executor.execute('computer_screen_capture', {'target': 'tab'}, SID))
    assert [body['target'] for _path, body in executor.sent] == [{'kind': 'screen'}, {'kind': 'screen'}]


def test_payload_tra_ve_mang_target_va_caption():
    """P2.5(c) — mảnh bằng chứng phải biết ảnh chụp CÁI GÌ: `target` (và `caption`) ở lại payload."""
    executor = RecordingExecutor()
    result = asyncio.run(executor.execute('computer_screen_capture',
                                          {'target': {'kind': 'tab', 'url': '127.0.0.1:5173'},
                                           'caption': 'RAG flow'}, SID))
    assert result['target'] == {'kind': 'tab', 'url': '127.0.0.1:5173', 'label': 'rag-flow'}
    assert result['caption'] == 'RAG flow'
    assert set(result) >= {'content', 'artifact', 'image', 'mime', 'dimensions', 'target'}


def test_nhan_khong_lam_doi_ba_khoa_dinh_danh():
    """P2.5(d) — `label` là chữ thêm vào TÊN TỆP: `session`/`step`/`toolCallId` vẫn nguyên chỗ."""
    executor = RecordingExecutor()
    asyncio.run(executor.execute('computer_screen_capture',
                                 {'target': {'kind': 'tab', 'url': 'x'}, 'caption': 'RAG flow'},
                                 SID, turn=3, step=7, tool_call_id='call-9'))
    assert executor.sent == [('/__box/capture', {
        'target': {'kind': 'tab', 'url': 'x', 'label': 'rag-flow'},
        'output': 'base64', 'session': SID, 'step': 7, 'toolCallId': 'call-9'})]


class _StubResponse:
    """Thân lỗi THẬT của box: `deploy/docker/ide-proxy.py` trả `{'error': <câu>}` + mã 4xx/5xx."""

    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError('no json body')
        return self._payload


def _client_with(monkeypatch, response):
    """`SandboxExecutor` với một client HTTP giả trả đúng `response` — không cần box, không cần mạng."""

    class StubClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, method, url, json=None, headers=None):
            return response

    monkeypatch.setattr(executor_module.httpx, 'AsyncClient', StubClient)
    return SandboxExecutor()


def test_loi_cua_box_di_len_nguyen_van(monkeypatch):
    """P2.4 — box trả `ambiguous` (409) ⇒ harness giữ NGUYÊN câu của box, không nuốt thành "không
    chụp được": `raise_for_status()` cũ thay câu đó bằng `Client error '409 Conflict' for url …`,
    và model mất luôn manh mối để chọn lại `tabId`/`windowId`.
    """
    executor = _client_with(monkeypatch, _StubResponse(409, {'error': BOX_AMBIGUOUS}))
    with pytest.raises(BoxRequestError) as caught:
        asyncio.run(executor.execute('computer_screen_capture', {'target': {'kind': 'tab'}}, SID))
    assert str(caught.value) == BOX_AMBIGUOUS
    assert caught.value.status_code == 409
    # Hình dạng mà model đọc: thông điệp của lần gọi hỏng phải CÒN câu của box trong đó.
    _code, message = classify_failure(caught.value)
    assert BOX_AMBIGUOUS in message


def test_than_loi_khong_doc_duoc_thi_cau_mac_dinh_kem_ma():
    """Không đọc được thân JSON ⇒ câu mặc định kèm mã trạng thái, không phải chuỗi rỗng."""
    assert box_error_message(_StubResponse(500, None)) == 'HTTP 500 from the sandbox box'
    assert box_error_message(_StubResponse(409, {'error': '   '})) == 'HTTP 409 from the sandbox box'
    assert box_error_message(_StubResponse(400, {'message': 'bad target'})) == 'bad target'
