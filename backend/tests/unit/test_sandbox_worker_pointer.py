"""F8 (đợt 9): bấm chuột lần thứ hai vào cùng toạ độ không được treo 15 giây.

`xdotool mousemove --sync` chỉ trả về khi con trỏ ĐỔI vị trí; khi con trỏ đã ở đúng
toạ độ đích, nó chờ hết thời gian chờ của `xdotool` (đo trong box: 15.16 s), mà lệnh
của `worker.py` bị cắt ở `timeout=15` — nên lần bấm thứ hai vào cùng một chỗ báo lỗi
"timed out after 15 seconds". Đợt 7 ghi nhận đúng triệu chứng đó: lượt CUA nặng đốt
20/20 bước rồi kết thúc `MAX_STEPS`.

Cách sửa: di chuyển không `--sync`, rồi tự chờ bằng `xdotool getmouselocation`.
Các ca dưới đây khoá lại: không còn `--sync`, vị trí được kiểm tra, và vòng chờ có trần.
"""
import subprocess

import pytest

from agentbox.sandbox import worker

CURRENT_OK = b"Screen 0: minimum 32 x 32, current 1280 x 800, maximum 32768 x 32768\n"


class FakeRun:
    """Đứng thay `subprocess.run`: trả vị trí con trỏ theo kịch bản đã định."""

    def __init__(self, *, location_responses=('X=640\nY=300\n', ), current=CURRENT_OK):
        self.calls = []
        self.location_responses = list(location_responses)
        self.current = current
        self.probes = 0

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        if argv[:2] == ['xrandr', '--current']:
            return subprocess.CompletedProcess(argv, 0, self.current, b'')
        if argv[:2] == ['xdotool', 'getmouselocation']:
            index = min(self.probes, len(self.location_responses) - 1)
            self.probes += 1
            return subprocess.CompletedProcess(argv, 0, self.location_responses[index], b'')
        return subprocess.CompletedProcess(argv, 0, b'', b'')

    def moves(self):
        return [call for call in self.calls if call[:2] == ['xdotool', 'mousemove']]


@pytest.fixture(autouse=True)
def _branch(tmp_path, monkeypatch):
    """Đứng thay `time.sleep` để không ca nào thật sự phải chờ."""
    monkeypatch.setenv('BOXFOX_SYSTEM_LOG_DIR', str(tmp_path))
    monkeypatch.setattr(worker.time, 'sleep', lambda _seconds: None)


def test_click_never_uses_the_sync_flag(monkeypatch):
    """`--sync` là thứ treo khi con trỏ đã ở đích — không lệnh nào được mang nó nữa."""
    fake = FakeRun(location_responses=('X=640\nY=300\n', ))
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    worker.execute('computer_use', {'action': 'click', 'x': 640, 'y': 300}, 'sess-f8')
    assert fake.moves() == [['xdotool', 'mousemove', '640', '300']]
    assert all('--sync' not in call for call in fake.calls), 'không còn --sync trong bất kỳ lệnh nào'


def test_every_pointer_action_moves_first(monkeypatch):
    for action, click_args in (('click', ['click', '1']),
                               ('double_click', ['click', '--repeat', '2', '--delay', '100', '1']),
                               ('right_click', ['click', '3']),
                               ('middle_click', ['click', '2'])):
        fake = FakeRun()
        monkeypatch.setattr(worker.subprocess, 'run', fake)
        worker.execute('computer_use', {'action': action, 'x': 10, 'y': 20}, 'sess-f8')
        assert fake.moves() == [['xdotool', 'mousemove', '10', '20']], action
        assert ['xdotool', *click_args] in fake.calls, action


def test_the_pointer_that_is_already_there_is_confirmed_at_once(monkeypatch):
    """Con trỏ đã ở đích: một lần thăm dò là đủ, không lặp 15 giây như bản cũ."""
    fake = FakeRun(location_responses=('X=640\nY=300\n', 'X=640\nY=300\n', 'X=640\nY=300\n'))
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    worker.execute('computer_use', {'action': 'click', 'x': 640, 'y': 300}, 'sess-f8')
    assert fake.probes == 1


def test_a_missed_pointer_is_retried_a_bounded_number_of_times(monkeypatch):
    """Nếu vị trí không bao giờ khớp, vòng chờ phải dừng lại — không treo, không nuốt lỗi."""
    fake = FakeRun(location_responses=('X=0\nY=0\n', ))
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    result = worker.execute('computer_use', {'action': 'click', 'x': 640, 'y': 300}, 'sess-f8')
    assert fake.probes == 20, 'trần thăm dò là hằng số trong worker'
    assert ['xdotool', 'click', '1'] in fake.calls, 'bấm vẫn được gửi sau vòng chờ'
    assert 'Input delivered' in result['content']


def test_a_prefix_of_the_real_coordinates_does_not_count_as_arrival(monkeypatch):
    """`X=64` không được khớp với dòng `X=640` — so chuỗi con thì lần thăm dò đầu đạt nhầm.

    Vòng soát mã đợt 10: bản cũ dùng `f'X={x}' in out`, nên đích (64, 3) gặp con trỏ thật
    ở (640, 300) là "tới nơi" ngay, và cú bấm rơi vào chỗ khác mà không ai biết.
    """
    fake = FakeRun(location_responses=('X=640\nY=300\n', 'X=640\nY=300\n', 'X=64\nY=3\n'))
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    worker.execute('computer_use', {'action': 'click', 'x': 64, 'y': 3}, 'sess-f8')
    assert fake.probes == 3, 'phải chờ tới khi dòng X/Y khớp đúng, không khớp tiền tố'


def test_keyboard_actions_do_not_move_the_pointer(monkeypatch):
    fake = FakeRun()
    monkeypatch.setattr(worker.subprocess, 'run', fake)
    worker.execute('computer_use', {'action': 'key', 'key': 'Return'}, 'sess-f8')
    worker.execute('computer_use', {'action': 'type', 'text': 'xin chao'}, 'sess-f8')
    assert [call for call in fake.calls if call[:2] == ['xdotool', 'mousemove']] == []
