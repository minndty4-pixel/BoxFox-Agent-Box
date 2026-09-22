"""Nhật ký hệ thống cho DEV: JSONL, nằm trên host, ngoài tầm nhìn của box.

Kiểm tra: ghi được entry, che bí mật, xoay vòng khi quá dung lượng, không bao
giờ ném lỗi làm chết lượt chạy, và CLI đọc lại được (tail/summary/errors).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from agentbox.observability.system_log import SystemLog

REPO = Path(__file__).resolve().parents[3]


def _log(tmp_path, **kwargs):
    return SystemLog(directory=tmp_path, source='harness', filename='harness.jsonl', **kwargs)


def test_writes_jsonl_lines_with_the_expected_shape(tmp_path):
    log = _log(tmp_path)
    log.write('turn.start', session_id='abc12345', model='gemini-3.6-flash', maxSteps=12)
    log.write('turn.end', session_id='abc12345', status='completed', durationMs=1234.56)
    lines = (tmp_path / 'harness.jsonl').read_text().strip().split('\n')
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first['event'] == 'turn.start'
    assert first['source'] == 'harness'
    assert first['level'] == 'info'
    assert first['sessionId'] == 'abc12345'
    assert first['data'] == {'model': 'gemini-3.6-flash', 'maxSteps': 12}
    assert first['ts'].endswith('Z')
    second = json.loads(lines[1])
    assert second['durationMs'] == 1234.6


def test_secrets_are_redacted(tmp_path):
    log = _log(tmp_path)
    log.write('chat.call', apiKey='sk-live-123', headers={'authorization': 'Bearer abc', 'token': 't'},
              safe='giữ lại')
    entry = json.loads((tmp_path / 'harness.jsonl').read_text(encoding='utf-8').strip())
    assert entry['data']['apiKey'] == '[redacted]'
    assert entry['data']['headers']['authorization'] == '[redacted]'
    assert entry['data']['headers']['token'] == '[redacted]'
    assert entry['data']['safe'] == 'giữ lại'


def test_error_entries_carry_code_and_message(tmp_path):
    log = _log(tmp_path)
    log.error('turn.failed', message='UPSTREAM_UNREACHABLE: mất kết nối', code='UPSTREAM_UNREACHABLE', session_id='s1')
    entry = json.loads((tmp_path / 'harness.jsonl').read_text(encoding='utf-8').strip())
    assert entry['level'] == 'error'
    assert entry['code'] == 'UPSTREAM_UNREACHABLE'
    assert 'mất kết nối' in entry['message']


def test_a_broken_directory_never_raises(tmp_path):
    blocked = tmp_path / 'file-not-dir'
    blocked.write_text('x')
    log = SystemLog(directory=blocked / 'logs')
    log.write('turn.start', session_id='s1')  # phải im lặng, không ném lỗi


def test_rotation_keeps_backups(tmp_path, monkeypatch):
    import importlib

    module = importlib.import_module('agentbox.observability.system_log')
    monkeypatch.setattr(module, 'MAX_BYTES', 400)
    log = _log(tmp_path)
    for index in range(6):
        log.write('turn.end', session_id='s1', status='completed', note='x' * 120, index=index)
    assert (tmp_path / 'harness.jsonl').exists()
    assert (tmp_path / 'harness.jsonl.0').exists(), 'phải xoay vòng khi vượt ngưỡng'


def test_tail_reads_back_entries(tmp_path):
    log = _log(tmp_path)
    for index in range(5):
        log.write('turn.end', index=index)
    entries = log.tail(3)
    assert [entry['data']['index'] for entry in entries] == [2, 3, 4]


def test_cli_reads_the_log_it_is_pointed_at(tmp_path):
    log = _log(tmp_path)
    log.write('turn.start', session_id='deadbeef', model='gemini-3.6-flash')
    log.error('turn.failed', session_id='deadbeef', code='UPSTREAM_UNREACHABLE', message='mất kết nối')
    # `conftest.py` đặt BOXFOX_SYSTEM_LOG_DIR cho cả phiên test; ở đây muốn kiểm
    # nhánh mặc định `~/BoxFox/logs` nên phải bỏ biến đó khỏi môi trường con.
    fake_home = str(tmp_path.parent / 'fake-home')
    env = {**os.environ, 'HOME': fake_home, 'USERPROFILE': fake_home}
    env.pop('BOXFOX_SYSTEM_LOG_DIR', None)
    # CLI đọc `~/BoxFox/logs`; trỏ HOME vào một cây tạm rồi đặt log đúng chỗ.
    target = Path(fake_home) / 'BoxFox' / 'logs'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'harness.jsonl').write_text((tmp_path / 'harness.jsonl').read_text(encoding='utf-8'), encoding='utf-8')

    summary = subprocess.run([sys.executable, str(REPO / 'scripts' / 'system-log.py'), 'summary'],
                             capture_output=True, text=True, env=env, cwd=REPO)
    assert summary.returncode == 0, summary.stderr
    assert 'UPSTREAM_UNREACHABLE' in summary.stdout
    assert 'entries=2' in summary.stdout

    errors = subprocess.run([sys.executable, str(REPO / 'scripts' / 'system-log.py'), 'errors'],
                            capture_output=True, text=True, env=env, cwd=REPO)
    assert errors.returncode == 0
    assert 'turn.failed' in errors.stdout
    assert 'turn.start' not in errors.stdout


def test_cli_env_var_overrides_the_home_default(tmp_path):
    """Biến `BOXFOX_SYSTEM_LOG_DIR` thắng mặc định `~/BoxFox/logs` — nhờ đó bản
    kiểm chứng chạy tách được log, không ghi vào thư mục log của người vận hành."""
    log = _log(tmp_path)
    log.error('turn.failed', session_id='cafebabe', code='DEADLINE', message='hết hạn')
    fake_home = str(tmp_path / 'empty-home')
    env = {**os.environ, 'HOME': fake_home, 'USERPROFILE': fake_home, 'BOXFOX_SYSTEM_LOG_DIR': str(tmp_path)}

    summary = subprocess.run([sys.executable, str(REPO / 'scripts' / 'system-log.py'), 'summary'],
                             capture_output=True, text=True, env=env, cwd=REPO)
    assert summary.returncode == 0, summary.stderr
    assert 'DEADLINE' in summary.stdout


def test_cli_reset_all_leaves_exactly_one_previous_file(tmp_path):
    """`reset --file all` không được đổi tên chính tệp *previous*.

    Vòng soát mã đợt 10: bản cũ chạy qua mọi `*.jsonl`, kể cả `harness.previous.jsonl`, nên
    sinh ra `harness.previous.previous.jsonl` — trái lời hứa "đúng một tệp previous" ở cả
    docstring lẫn phần trợ giúp của CLI.
    """
    log = _log(tmp_path)
    log.write('turn.start', session_id='cafebabe')
    (tmp_path / 'harness.previous.jsonl').write_text('{"event": "lan-chay-truoc"}\n')
    (tmp_path / 'router.jsonl').write_text('{"event": "router.start"}\n')
    env = {**os.environ, 'BOXFOX_SYSTEM_LOG_DIR': str(tmp_path)}

    result = subprocess.run([sys.executable, str(REPO / 'scripts' / 'system-log.py'),
                             'reset', '--file', 'all'],
                            capture_output=True, text=True, env=env, cwd=REPO)
    assert result.returncode == 0, result.stderr
    assert not list(tmp_path.glob('*.previous.previous.jsonl')), 'không sinh thế hệ previous thứ hai'
    previous = (tmp_path / 'harness.previous.jsonl').read_text()
    assert 'lan-chay-truoc' not in previous, \
        'bản previous cũ phải bị THAY bằng lần chạy vừa kết thúc, không bị đổi tên đi'
    assert 'turn.start' in previous, 'lần chạy vừa kết thúc nằm ở tệp previous'
    assert (tmp_path / 'harness.jsonl').exists() is False, 'tệp đang ghi phải được xoay đi'
    assert (tmp_path / 'router.previous.jsonl').exists()
    assert (tmp_path / 'router.jsonl').exists() is False


def test_cli_reports_a_missing_log(tmp_path):
    # Cùng lý do: bỏ biến của conftest để CLI đi theo nhánh mặc định `~/BoxFox/logs`.
    fake_home = str(tmp_path / 'empty-home')
    env = {**os.environ, 'HOME': fake_home, 'USERPROFILE': fake_home}
    env.pop('BOXFOX_SYSTEM_LOG_DIR', None)
    result = subprocess.run([sys.executable, str(REPO / 'scripts' / 'system-log.py'), 'tail'],
                            capture_output=True, text=True, env=env, cwd=REPO)
    assert result.returncode == 2
    assert 'No log file yet' in result.stderr
