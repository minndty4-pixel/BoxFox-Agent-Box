"""Readiness + cấu hình router của claude_worker — CLI GIẢ, HOME tạm, không Docker.

Worker thật chạy trong box, nhưng toàn bộ logic cấu hình/readiness ở đây là hàm
thuần + subprocess tới một CLI giả nằm trong tmp_path, nên test chạy được trên
host: không `docker exec`, không mạng thật (chỉ một socket TCP loopback), không
chạm /home/agent.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import sys

import pytest

from agentbox.sandbox import claude_worker

pytestmark = pytest.mark.skipif(
    sys.platform == 'win32',
    reason='claude_worker is a Linux container daemon relying on /proc and POSIX permissions',
)

TOKEN = 'bf_test_token_do_not_leak'
STRUCTURED_FLAGS = ('--output-format', '--allowedTools', '--tools', '--strict-mcp-config',
                    '--setting-sources', '--settings')
CONFIG_KEYS = tuple(claude_worker.CONFIG_ENV)

FAKE_CLI = """#!__PYTHON__
import json, os, sys
args = sys.argv[1:]
if '--version' in args:
    print('9.9.9 (Claude Code)')
elif '--help' in args:
    print(' '.join(__FLAGS__))
elif args[:2] == ['auth', 'status']:
    print(json.dumps({'loggedIn': __LOGGED_IN__}))
elif '-p' in args:
    dump = os.environ.get('BOXFOX_TEST_DUMP')
    if dump:
        with open(dump, 'w', encoding='utf-8') as handle:
            json.dump({'env': dict(os.environ), 'stdin': sys.stdin.read(), 'argv': args}, handle)
    print(json.dumps({'type': 'result', 'result': 'DONE', 'is_error': False}))
"""


@contextlib.contextmanager
def listening_router():
    """'Router' chỉ cần NGHE được TCP: connect() thành công là đủ cho reachability."""
    server = socket.socket()
    server.bind(('127.0.0.1', 0))
    server.listen(1)
    try:
        yield f'http://127.0.0.1:{server.getsockname()[1]}'
    finally:
        server.close()


@contextlib.contextmanager
def closed_router():
    """Cổng đã đóng chắc chắn: bind rồi đóng ngay để lấy số cổng."""
    probe = socket.socket()
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
    probe.close()
    yield f'http://127.0.0.1:{port}'


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """HOME tạm + CLI giả + skill mount tạm; xoá sạch biến router của máy test."""
    home = tmp_path / 'home'
    binary = tmp_path / 'bin'
    skills = tmp_path / 'skills'
    for path in (home, binary, skills):
        path.mkdir()
    cli = binary / 'claude'
    cli.write_text(FAKE_CLI.replace('__PYTHON__', sys.executable)
                           .replace('__FLAGS__', repr(STRUCTURED_FLAGS))
                           .replace('__LOGGED_IN__', 'True'), encoding='utf-8')
    cli.chmod(0o755)
    monkeypatch.setenv('HOME', str(home))
    monkeypatch.setenv('PATH', f'{binary}:{os.environ["PATH"]}')
    monkeypatch.setattr(claude_worker, 'SKILL_MOUNT', skills)
    monkeypatch.setattr(claude_worker, 'WORKSPACE', tmp_path)
    for key in CONFIG_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv('BOXFOX_TEST_DUMP', raising=False)
    return {'home': home, 'binary': binary, 'skills': skills, 'settings': home / '.claude' / 'settings.json'}


def read_settings(sandbox):
    return json.loads(sandbox['settings'].read_text(encoding='utf-8'))


def test_probe_keeps_the_account_path_when_no_router_is_configured(sandbox):
    result = claude_worker.probe()
    assert result['status'] == 'ready' and result['auth'] == 'account'
    assert result['authenticated'] is True and result['settingsFile'] is False
    assert result['skillMount'] is True and result['structuredOutput'] is True
    assert result['readOnlyIsolation'] is False  # bwrap không có trên host test
    assert not sandbox['settings'].exists(), 'chưa cấu hình router thì KHÔNG được ghi settings'


def test_probe_without_binary_keeps_the_original_reason(sandbox, monkeypatch):
    monkeypatch.setenv('PATH', str(sandbox['skills']))
    result = claude_worker.probe()
    assert result['status'] == 'setup_required' and result['binary'] is False
    assert result['reason'] == 'Install Claude Code inside the sandbox, then sign in there.'


def test_probe_reports_setup_required_when_the_account_is_not_logged_in(sandbox, monkeypatch):
    cli = sandbox['binary'] / 'claude'
    cli.write_text(cli.read_text(encoding='utf-8').replace("'loggedIn': True", "'loggedIn': False"), encoding='utf-8')
    result = claude_worker.probe()
    assert result['status'] == 'setup_required' and result['auth'] is None
    assert result['reason'] == 'Check sandbox login, CLI version and read-only skill mount.'


def test_probe_accepts_a_router_backed_setup_without_any_account(sandbox, monkeypatch):
    with listening_router() as base:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', base)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_DEFAULT_OPUS_MODEL', 'conn/gemini-3.8-flash-high')
        result = claude_worker.probe()
        assert result['status'] == 'ready' and result['auth'] == 'router' and result['reason'] == ''
        assert result['baseUrl'] == base and result['settingsFile'] is True
        assert result['authenticated'] is False, 'đường router không có trạng thái `claude auth status`'
    document = read_settings(sandbox)
    assert document['hasCompletedOnboarding'] is True
    assert document['env'] == {'ANTHROPIC_BASE_URL': base, 'ANTHROPIC_AUTH_TOKEN': TOKEN,
                               'ANTHROPIC_DEFAULT_OPUS_MODEL': 'conn/gemini-3.8-flash-high'}
    assert oct(sandbox['settings'].stat().st_mode & 0o777) == oct(0o600)


def test_probe_is_idempotent_and_keeps_foreign_settings_keys(sandbox, monkeypatch):
    sandbox['settings'].parent.mkdir(parents=True)
    sandbox['settings'].write_text(json.dumps({'permissions': {'allow': ['Bash(ls:*)']}, 'env': {'MY_FLAG': '1'}}),
                                   encoding='utf-8')
    with listening_router() as base:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', base)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        assert claude_worker.probe()['status'] == 'ready'
        first = sandbox['settings'].read_text(encoding='utf-8')
        assert claude_worker.probe()['status'] == 'ready'
        assert sandbox['settings'].read_text(encoding='utf-8') == first, 'lần probe thứ hai phải là no-op'
    document = json.loads(first)
    assert document['permissions'] == {'allow': ['Bash(ls:*)']}
    assert document['env']['MY_FLAG'] == '1' and document['env']['ANTHROPIC_AUTH_TOKEN'] == TOKEN


def test_probe_names_the_bridge_when_the_router_is_unreachable(sandbox, monkeypatch):
    with closed_router() as base:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', base)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        result = claude_worker.probe()
    assert result['status'] == 'setup_required' and result['auth'] == 'router'
    assert 'BOX_LLM_BRIDGE' in result['reason'] and 'BOXFOX_ROUTER_BRIDGE_HOST' in result['reason']
    assert TOKEN not in json.dumps(result)


def test_partial_configuration_does_not_count_as_configured(sandbox, monkeypatch):
    monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', 'http://127.0.0.1:9')
    result = claude_worker.probe()
    assert result['auth'] == 'account', 'thiếu token ⇒ quay về đường tài khoản, y như trước'
    assert result['status'] == 'ready' and not sandbox['settings'].exists()
    config = claude_worker.router_config()
    assert config['configured'] is False and config['missing'] == ['BOXFOX_ANTHROPIC_AUTH_TOKEN']
    assert claude_worker.cli_environment(config) == {}


@pytest.mark.parametrize('given,expected', [
    ('http://172.18.0.1:3101/', 'http://172.18.0.1:3101'),
    ('http://172.18.0.1:3101/v1', 'http://172.18.0.1:3101'),
    ('http://172.18.0.1:3101/v1/', 'http://172.18.0.1:3101'),
    ('https://router.example/prefix', 'https://router.example/prefix'),
    ('', ''),
])
def test_base_url_normalization(given, expected):
    """CLI tự ghép '/v1/messages' ⇒ '/v1' ở cuối base URL phải bị bỏ."""
    assert claude_worker.normalize_base_url(given) == expected


def test_mask_hides_the_token(sandbox, monkeypatch):
    monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
    assert TOKEN not in claude_worker.mask(f'request failed for header {TOKEN}')
    assert claude_worker.mask('no secret here') == 'no secret here'


def test_run_path_hands_the_router_configuration_to_the_cli(sandbox, monkeypatch, capsys):
    """Đường chạy thật (main) phải đặt ANTHROPIC_* vào MÔI TRƯỜNG của tiến trình CLI."""
    dump = sandbox['home'] / 'dump.json'
    with listening_router() as base:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', base)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL', 'conn/gemini-3.6-flash-high')
        monkeypatch.setenv('BOXFOX_TEST_DUMP', str(dump))
        monkeypatch.setattr('sys.stdin', io.StringIO(json.dumps(
            {'action': 'run', 'session': 'unit-test-child', 'prompt': 'việc cần làm', 'role': 'build', 'instructions': 'skill'})))
        claude_worker.main()
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [event['type'] for event in events] == ['readiness', 'result']
    assert events[0]['data']['status'] == 'ready' and events[0]['data']['auth'] == 'router'
    assert events[-1]['text'] == 'DONE'
    recorded = json.loads(dump.read_text(encoding='utf-8'))
    assert recorded['env']['ANTHROPIC_BASE_URL'] == base
    assert recorded['env']['ANTHROPIC_AUTH_TOKEN'] == TOKEN
    assert recorded['env']['ANTHROPIC_DEFAULT_SONNET_MODEL'] == 'conn/gemini-3.6-flash-high'
    assert recorded['env']['HOME'] == str(sandbox['home'])
    # Prompt đi qua stdin, không qua argv; không có bwrap cho role ghi.
    assert 'việc cần làm' in recorded['stdin'] and 'skill' in recorded['stdin']
    assert 'bwrap' not in recorded['argv'] and '--setting-sources' in recorded['argv']
    assert not Path('/tmp/boxfox-claude-unit-test-child.json').exists(), 'marker phải được dọn'


def test_run_path_stops_before_the_cli_when_readiness_is_not_ready(sandbox, monkeypatch, capsys):
    with closed_router() as base:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', base)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        monkeypatch.setattr('sys.stdin', io.StringIO(json.dumps(
            {'action': 'run', 'session': 'unit-test-blocked', 'prompt': 'never', 'role': 'build', 'instructions': ''})))
        claude_worker.main()
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [event['type'] for event in events] == ['readiness']
    assert events[0]['data']['status'] == 'setup_required'


def test_readonly_roles_still_require_bubblewrap(sandbox, monkeypatch, capsys):
    """Role chỉ đọc không có bwrap ⇒ từ chối chạy, đúng như trước."""
    with listening_router() as base:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', base)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        monkeypatch.setattr('sys.stdin', io.StringIO(json.dumps(
            {'action': 'run', 'session': 'unit-test-ro', 'prompt': 'x', 'role': 'explore', 'instructions': ''})))
        claude_worker.main()
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [event['type'] for event in events] == ['readiness', 'error']
    assert events[1]['message'].startswith('setup_required: read-only roles require working bubblewrap isolation')


def test_the_cli_never_falls_back_to_its_own_default_model(sandbox, monkeypatch):
    """CLI mặc định gọi `claude-opus-5[1m]` — router BoxFox không có model đó.

    Đo sống 2026-09-20: harness chỉ đặt `BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL`, CLI chọn
    model mặc định của nó và lượt `/claude-code` chết với "There's an issue with the
    selected model (claude-opus-5[1m])". Nay `ANTHROPIC_MODEL` lấy model sonnet đã cấu hình.
    """
    with listening_router() as url:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', url)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL', 'conn-1/gemini-3.6-flash-high')
        monkeypatch.delenv('BOXFOX_ANTHROPIC_MODEL', raising=False)
        values = claude_worker.router_config()['values']
        assert values['ANTHROPIC_MODEL'] == 'conn-1/gemini-3.6-flash-high'

        monkeypatch.setenv('BOXFOX_ANTHROPIC_MODEL', 'conn-1/gemini-3.8-flash-high')
        assert claude_worker.router_config()['values']['ANTHROPIC_MODEL'] == 'conn-1/gemini-3.8-flash-high'

        monkeypatch.delenv('BOXFOX_ANTHROPIC_MODEL', raising=False)
        monkeypatch.delenv('BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL', raising=False)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL', 'conn-1/gemini-3.6-flash-high')
        assert claude_worker.router_config()['values']['ANTHROPIC_MODEL'] == 'conn-1/gemini-3.6-flash-high'

        monkeypatch.delenv('BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL', raising=False)
        assert claude_worker.router_config()['values']['ANTHROPIC_MODEL'] == ''


def test_cli_environment_carries_the_resolved_model(sandbox, monkeypatch):
    with listening_router() as url:
        monkeypatch.setenv('BOXFOX_ANTHROPIC_BASE_URL', url)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_AUTH_TOKEN', TOKEN)
        monkeypatch.setenv('BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL', 'conn-1/gemini-3.6-flash-high')
        monkeypatch.delenv('BOXFOX_ANTHROPIC_MODEL', raising=False)
        env = claude_worker.cli_environment(claude_worker.router_config())
    assert env['ANTHROPIC_MODEL'] == 'conn-1/gemini-3.6-flash-high'
    assert env['ANTHROPIC_BASE_URL'] == url
