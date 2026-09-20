"""F3/F4 (đợt 7): computer_use key/type phải báo thất bại thật.

`xdotool key NotARealKey` in 'No such key name ... Ignoring it.' và thoát 0, nên
tool từng trả 'Input delivered' cho một phím không tồn tại. `xdotool` cũng nhận
lệnh khi không có cửa sổ nào được focus, rồi gõ vào hư không.
"""
import subprocess

import pytest

from agentbox.sandbox import worker


class FakeRun:
    def __init__(self, *, focused_ok=True, key_warning=False):
        self.calls = []
        self.focused_ok = focused_ok
        self.key_warning = key_warning

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        if argv[:2] == ['xdotool', 'getactivewindow']:
            return subprocess.CompletedProcess(argv, 0 if self.focused_ok else 1, b'12345', b'')
        if argv[:2] == ['xdotool', 'key'] and self.key_warning:
            return subprocess.CompletedProcess(
                argv, 0, b"No such key name 'NotARealKey'.  Ignoring it.\n", b'')
        return subprocess.CompletedProcess(argv, 0, b'', b'')


@pytest.fixture(autouse=True)
def _no_system_log(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))


def test_bad_key_name_is_not_reported_as_delivered(monkeypatch):
    fake = FakeRun(key_warning=True)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    with pytest.raises(ValueError) as err:
        worker.execute('computer_use', {'action': 'key', 'key': 'NotARealKey'}, 'sess-f3')
    message = str(err.value)
    assert 'Unsupported key name' in message
    assert 'NotARealKey' in message


def test_key_without_focused_window_is_refused(monkeypatch):
    fake = FakeRun(focused_ok=False)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    with pytest.raises(ValueError) as err:
        worker.execute('computer_use', {'action': 'key', 'key': 'Return'}, 'sess-f4')
    assert 'No focused window' in str(err.value)


def test_valid_key_still_reports_delivery(monkeypatch):
    fake = FakeRun()
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    result = worker.execute('computer_use', {'action': 'key', 'key': 'Return'}, 'sess-ok')
    assert 'Input delivered' in result['content']
    assert any(call[:2] == ['xdotool', 'key'] for call in fake.calls)


def test_click_does_not_require_focus(monkeypatch):
    fake = FakeRun(focused_ok=False)
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    result = worker.execute('computer_use', {'action': 'click', 'x': 5, 'y': 7}, 'sess-click')
    assert 'Input delivered' in result['content']
    assert not any(call[:2] == ['xdotool', 'getactivewindow'] for call in fake.calls)
