"""F6 (đợt 8): framebuffer bị client RFB kéo nhỏ phải được đặt lại trước thao tác toạ độ.

`Xvnc -AcceptSetDesktopSize` là tính năng cố ý (auto-fit cho noVNC), nhưng nó cũng cho
bất kỳ trình xem nào kéo màn hình xuống 286x311. Khi đó `computer_use click` vẫn "thành
công" mà bấm vào sai chỗ. Bản sửa chặn SÀN kích thước thay vì bỏ auto-fit.
"""
import subprocess

import pytest

from agentbox.sandbox import worker

CURRENT_SMALL = b"Screen 0: minimum 32 x 32, current 286 x 311, maximum 32768 x 32768\nVNC-0 connected 286x311+0+0 0mm x 0mm\n"
CURRENT_OK = b"Screen 0: minimum 32 x 32, current 1280 x 800, maximum 32768 x 32768\n"
CURRENT_WIDE = b"Screen 0: minimum 32 x 32, current 1920 x 1080, maximum 32768 x 32768\n"


class FakeRun:
    def __init__(self, *, current=CURRENT_OK, restore_ok=True, focused_ok=True):
        self.calls = []
        self.current = current
        self.restore_ok = restore_ok
        self.focused_ok = focused_ok

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        if argv[:2] == ['xrandr', '--current']:
            return subprocess.CompletedProcess(argv, 0, self.current, b'')
        if argv[:3] == ['xrandr', '--output', 'VNC-0']:
            if self.restore_ok:
                return subprocess.CompletedProcess(argv, 0, b'', b'')
            return subprocess.CompletedProcess(argv, 1, b'', b'xrandr: cannot find mode\n')
        if argv[:2] == ['xdotool', 'getactivewindow']:
            return subprocess.CompletedProcess(argv, 0 if self.focused_ok else 1, b'12345', b'')
        return subprocess.CompletedProcess(argv, 0, b'', b'')

    def restores(self):
        return [call for call in self.calls if call[:3] == ['xrandr', '--output', 'VNC-0']]


@pytest.fixture(autouse=True)
def _no_system_log(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))


def test_click_restores_a_shrunk_desktop_and_says_so(monkeypatch):
    fake = FakeRun(current=CURRENT_SMALL)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    result = worker.execute('computer_use', {'action': 'click', 'x': 100, 'y': 200}, 'sess-f6')
    assert fake.restores() == [['xrandr', '--output', 'VNC-0', '--mode', '1280x800']]
    assert result['desktopRestored'] == {'from': '286x311', 'to': '1280x800'}
    assert 'Input delivered' in result['content']


def test_normal_size_is_left_alone(monkeypatch):
    fake = FakeRun(current=CURRENT_OK)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    result = worker.execute('computer_use', {'action': 'click', 'x': 1, 'y': 1}, 'sess-f6')
    assert fake.restores() == [], 'không được đụng vào màn hình đang đúng cỡ'
    assert 'desktopRestored' not in result and 'desktopWarning' not in result


def test_wider_than_configured_is_left_alone(monkeypatch):
    fake = FakeRun(current=CURRENT_WIDE)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    worker.execute('computer_use', {'action': 'scroll', 'direction': 'down'}, 'sess-f6')
    assert fake.restores() == []


def test_failed_restore_warns_but_still_sends_the_input(monkeypatch):
    fake = FakeRun(current=CURRENT_SMALL, restore_ok=False)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    result = worker.execute('computer_use', {'action': 'click', 'x': 5, 'y': 5}, 'sess-f6')
    assert 'desktopWarning' in result
    assert result['desktopWarning']['from'] == '286x311'
    assert 'cannot find mode' in result['desktopWarning']['warning']
    assert any(call[0] == 'xdotool' and 'mousemove' in call for call in fake.calls), 'lệnh bấm vẫn phải chạy'


def test_keyboard_actions_do_not_touch_the_desktop(monkeypatch):
    fake = FakeRun(current=CURRENT_SMALL)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    worker.execute('computer_use', {'action': 'key', 'key': 'Return'}, 'sess-f6')
    assert fake.restores() == []
    assert not any(call[:2] == ['xrandr', '--current'] for call in fake.calls)


def test_target_follows_the_box_screen_env(monkeypatch):
    monkeypatch.delenv('BOX_SCREEN', raising=False)
    assert worker.desktop_target() == (1280, 800)
    monkeypatch.setenv('BOX_SCREEN', '1920x1080')
    assert worker.desktop_target() == (1920, 1080)
    monkeypatch.setenv('BOX_SCREEN', '1024x768x24')
    assert worker.desktop_target() == (1024, 768)
    monkeypatch.setenv('BOX_SCREEN', 'khong-phai-so')
    assert worker.desktop_target() == (1280, 800)


def test_screen_size_is_none_when_xrandr_is_unreadable(monkeypatch):
    fake = FakeRun()
    monkeypatch.setattr(worker.subprocess, 'run',
                        lambda argv, **kwargs: subprocess.CompletedProcess(argv, 1, b'', b'loi'))
    assert worker.screen_size() is None
    assert worker.ensure_desktop_size() is None
