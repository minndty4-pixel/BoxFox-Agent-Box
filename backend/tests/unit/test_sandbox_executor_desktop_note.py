"""F6 (đợt 8): ghi chú kích thước desktop phải đi tới nhật ký hệ thống của DEV.

Việc client kéo nhỏ framebuffer là ÂM THẦM: không lỗi nào nổi lên, chỉ toạ độ CUA trỏ
sai. Vì vậy đường duy nhất để hậu kiểm là một dòng log — và dòng đó chỉ có nếu host
chuyển tiếp ghi chú từ box lên `execute()`.
"""
import asyncio
import json

import pytest

import agentbox.sandbox.executor as executor_module
from agentbox.sandbox.executor import SandboxExecutor


@pytest.fixture(autouse=True)
def _log_in_tmp(tmp_path, monkeypatch):
    """`system_log` là instance dùng chung, đọc thư mục lúc khởi tạo — trỏ nó vào tmp."""
    monkeypatch.setattr(executor_module.system_log, 'directory', tmp_path)
    monkeypatch.setattr(executor_module.system_log, 'path', tmp_path / 'harness.jsonl')
    return tmp_path


def _lines(tmp_path):
    path = tmp_path / 'harness.jsonl'
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_restore_note_is_forwarded_and_logged(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))
    executor = SandboxExecutor()

    async def fake_execute(name, args, session):
        return {'content': 'Sandbox screenshot', 'desktopRestored': {'from': '286x311', 'to': '1280x800'}}

    monkeypatch.setattr(executor, '_execute', fake_execute)
    result = asyncio.run(executor.execute('computer_screen_capture', {}, 'sess-f6'))
    assert result['desktopRestored'] == {'from': '286x311', 'to': '1280x800'}

    lines = _lines(tmp_path)
    assert lines and lines[-1]['event'] == 'box.desktop_restored'
    assert lines[-1]['code'] == 'DESKTOP_RESTORED'
    assert lines[-1]['sessionId'] == 'sess-f6'
    assert lines[-1]['data'] == {'tool': 'computer_screen_capture', 'from': '286x311', 'to': '1280x800'}
    assert '286x311' in lines[-1]['message']


def test_warning_note_is_logged_as_a_warning(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))
    executor = SandboxExecutor()

    async def fake_execute(name, args, session):
        return {'content': 'Input delivered', 'desktopWarning': {'from': '286x311', 'warning': 'xrandr exit 1'}}

    monkeypatch.setattr(executor, '_execute', fake_execute)
    asyncio.run(executor.execute('computer_use', {'action': 'click'}, 'sess-f6b'))

    lines = _lines(tmp_path)
    assert lines[-1]['event'] == 'box.desktop_warning'
    assert lines[-1]['code'] == 'DESKTOP_TOO_SMALL'
    assert lines[-1]['level'] == 'warn'


def test_no_note_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))
    executor = SandboxExecutor()

    async def fake_execute(name, args, session):
        return {'content': 'ok'}

    monkeypatch.setattr(executor, '_execute', fake_execute)
    asyncio.run(executor.execute('computer_screen_capture', {}, 'sess-f6c'))
    assert _lines(tmp_path) == []


def test_non_dict_result_is_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))
    executor = SandboxExecutor()

    async def fake_execute(name, args, session):
        return ['khong-phai-dict']

    monkeypatch.setattr(executor, '_execute', fake_execute)
    asyncio.run(executor.execute('computer_screen_capture', {}, 'sess-f6d'))
    assert _lines(tmp_path) == []


def _png(width=2, height=3):
    """PNG tối thiểu hợp lệ để `image_dimensions_from_bytes` đọc được chiều."""
    import struct
    import zlib

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    raw = b'\x00' + b'\x00' * (width * 3)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def test_capture_execute_forwards_the_note_from_the_box(tmp_path, monkeypatch):
    """Nhánh thật của `_execute`: payload ảnh được DỰNG LẠI, nên ghi chú phải được
    chuyển tiếp tường minh — nếu không, `execute()` không bao giờ thấy nó."""
    import base64

    executor = SandboxExecutor()

    async def fake_request(path, body=None):
        return {'path': '/home/agent/x.png', 'data': base64.b64encode(_png()).decode('ascii'),
                'desktopRestored': {'from': '286x311', 'to': '1280x800'}}

    monkeypatch.setattr(executor, 'request', fake_request)
    result = asyncio.run(executor.execute('computer_screen_capture', {}, 'sess-f6e'))
    assert result['dimensions'] == (2, 3)
    assert result['desktopRestored'] == {'from': '286x311', 'to': '1280x800'}
    assert _lines(tmp_path)[-1]['event'] == 'box.desktop_restored'
