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

from agentbox.sandbox.executor import SandboxExecutor

SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'


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
