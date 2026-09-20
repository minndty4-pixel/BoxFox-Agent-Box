r"""Executed inside Docker via stdin, never imported on the host.

No shell interpolation. Child process-group ownership is per invocation.

Cấu hình router (harness → box)
-------------------------------
CLI không cần tài khoản Anthropic nếu nó được trỏ về router BoxFox: chỉ cần
`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (+ các *_MODEL), đúng cách 9router
làm. Harness truyền cấu hình vào box qua `docker exec -e` dưới tên CÓ TIỀN TỐ
BOXFOX_ANTHROPIC_* (xem CONFIG_ENV); worker đổi tên thành biến CLI hiểu, ghi
`~/.claude/settings.json` (idempotent) và đặt luôn vào môi trường tiến trình CLI.
CHƯA cấu hình ⇒ không ghi file nào, readiness đi theo đường `claude auth status`
y như trước — không có hành vi nào đổi khi người dùng không đặt biến.

Giá trị token KHÔNG bao giờ được gửi ra harness: mọi thông báo lỗi đi qua mask().

Hai sự thật về CLI 2.1.278 đã kiểm bằng chính binary (đừng "sửa" lại cho khớp
trực giác):
  1. CLI TỰ ghép '/v1/messages' vào ANTHROPIC_BASE_URL (chuỗi trong binary:
     `${d.baseUrl.replace(/\/$/,"")}/v1/messages`) ⇒ base URL không được có '/v1'.
  2. argv của worker có `--setting-sources ''` (nguồn userSettings bị tắt) nên
     `~/.claude/settings.json` KHÔNG được CLI đọc khi chạy qua /claude-code —
     vì vậy biến ANTHROPIC_* phải được đặt thẳng vào môi trường tiến trình CLI,
     còn settings.json là để người dùng/agent tự chạy `claude` trong box.
"""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
from urllib.parse import urlsplit

# Tên biến harness đặt (ngoài box) → tên biến CLI đọc (trong box). Hợp đồng này
# được ghim bởi backend/tests/unit/test_claude_executor.py (cùng danh sách với
# claude_executor.CONFIG_ENV) nên hai đầu không thể lệch nhau.
CONFIG_ENV = {
    'BOXFOX_ANTHROPIC_BASE_URL': 'ANTHROPIC_BASE_URL',
    'BOXFOX_ANTHROPIC_AUTH_TOKEN': 'ANTHROPIC_AUTH_TOKEN',
    'BOXFOX_ANTHROPIC_MODEL': 'ANTHROPIC_MODEL',
    'BOXFOX_ANTHROPIC_DEFAULT_OPUS_MODEL': 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'BOXFOX_ANTHROPIC_DEFAULT_SONNET_MODEL': 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'BOXFOX_ANTHROPIC_DEFAULT_HAIKU_MODEL': 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
}
SETTINGS_RELATIVE = '.claude/settings.json'
# Thư mục làm việc của CLI trong box (agent uid 1000 sở hữu; xem Dockerfile lớp 5).
WORKSPACE = Path('/home/agent/workspace')
SKILL_MOUNT = Path('/opt/boxfox-skills')
STRUCTURED_FLAGS = ('--output-format', '--allowedTools', '--tools', '--strict-mcp-config',
                    '--setting-sources', '--settings')
CONNECT_TIMEOUT = 2.0


def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def mask(text):
    """Xoá mọi giá trị bí mật khỏi văn bản trước khi gửi ra harness."""
    masked = str(text)
    for key in ('BOXFOX_ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN'):
        value = str(os.environ.get(key) or '')
        if value:
            masked = masked.replace(value, '***')
    return masked


def home_dir():
    """Thư mục HOME đúng: `docker exec --user agent` đặt HOME=/home/agent.

    HOME tuyệt đối được ưu tiên (và là thứ test nào cũng thay được), nhưng nếu ai
    đó chạy worker với HOME sai/thiếu thì lấy theo passwd để settings.json rơi
    đúng chỗ CLI đọc.
    """
    value = os.environ.get('HOME')
    if value and os.path.isabs(value):
        return Path(value)
    try:
        import pwd
        return Path(pwd.getpwuid(os.getuid()).pw_dir)
    except Exception:
        return Path.home()


def settings_path():
    return home_dir() / SETTINGS_RELATIVE


def normalize_base_url(value):
    """URL gốc của API Messages: bỏ '/' cuối và bỏ '/v1' dư thừa ở cuối path.

    Bằng chứng từ chính binary `claude` 2.1.278:
        `${d.baseUrl.replace(/\\/$/,"")}/v1/messages`
    tức CLI TỰ ghép '/v1/messages'. Nên một base URL đã kết thúc bằng '/v1' (đúng
    quy ước mà 9router ghi vào settings.json) sẽ thành '/v1/v1/messages' và 404.
    Ta bỏ '/v1' dư thừa để cả hai quy ước đều chạy, và URL HIỆU LỰC luôn được báo
    lại trong readiness (`baseUrl`) nên không có chuyện sửa âm thầm.
    """
    trimmed = str(value or '').strip().rstrip('/')
    return trimmed[:-3].rstrip('/') if trimmed.endswith('/v1') else trimmed


def router_config(env=None):
    """Cấu hình router của harness. `configured` chỉ đúng khi có ĐỦ base URL + token."""
    env = os.environ if env is None else env
    values = {cli: str(env.get(box) or '').strip() for box, cli in CONFIG_ENV.items()}
    values['ANTHROPIC_BASE_URL'] = normalize_base_url(values['ANTHROPIC_BASE_URL'])
    missing = [box for box, cli in CONFIG_ENV.items()
               if cli in {'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'} and not values[cli]]
    return {'configured': not missing, 'values': values, 'missing': missing,
            'models': {cli: value for cli, value in values.items() if cli.endswith('_MODEL') and value}}


def cli_environment(config):
    """Biến `ANTHROPIC_*` đặt vào môi trường tiến trình CLI (không có base URL ⇒ rỗng)."""
    if not config['configured']:
        return {}
    return {cli: value for cli, value in config['values'].items() if value}


def write_settings(config, target=None):
    """Ghi/cập nhật `~/.claude/settings.json`, trả (đường dẫn, đã đổi hay chưa).

    Idempotent: nội dung giống hệt thì không chạm vào file (probe gọi hàm này mỗi
    lần readiness được hỏi). Khoá lạ của người dùng trong file được giữ nguyên —
    ta chỉ đặt `hasCompletedOnboarding` và từng khoá trong `env`.
    """
    destination = Path(target) if target else settings_path()
    document = {}
    if destination.exists():
        try:
            loaded = json.loads(destination.read_text(encoding='utf-8') or '{}')
        except (OSError, ValueError):
            loaded = {}
        if isinstance(loaded, dict):
            document = loaded
    document['hasCompletedOnboarding'] = True
    block = document.get('env')
    if not isinstance(block, dict):
        block = {}
    block.update(cli_environment(config))
    document['env'] = block
    text = json.dumps(document, ensure_ascii=False, indent=2) + '\n'
    if destination.exists() and destination.read_text(encoding='utf-8') == text:
        return destination, False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.tmp')
    temporary.write_text(text, encoding='utf-8')
    os.chmod(temporary, 0o600)
    os.replace(temporary, destination)
    return destination, True


def router_reachable(config, timeout=CONNECT_TIMEOUT):
    """Router có trả lời TCP từ TRONG box không (bằng chứng cho readiness)."""
    parts = urlsplit(config['values']['ANTHROPIC_BASE_URL'])
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == 'https' else 80)
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def probe(env=None):
    env = os.environ if env is None else env
    config = router_config(env)
    binary = shutil.which('claude')
    result = {'executor': 'claude-code', 'status': 'setup_required', 'binary': bool(binary),
              'authenticated': False, 'version': None, 'readOnlyIsolation': bool(shutil.which('bwrap')),
              'skillMount': SKILL_MOUNT.is_dir(), 'auth': None, 'settingsFile': False}
    if not binary:
        result['reason'] = 'Install Claude Code inside the sandbox, then sign in there.'
        return result
    try:
        version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=10)
        result['version'] = version.stdout.strip()[:150]
        help_result = subprocess.run([binary, '--help'], capture_output=True, text=True, timeout=10)
        result['structuredOutput'] = all(flag in help_result.stdout for flag in STRUCTURED_FLAGS)
        if config['configured']:
            # Đường router: không cần `claude auth status`, nhưng token phải dùng
            # được NGAY từ trong box — nếu cầu nối chưa mở thì nói thẳng ra.
            result['auth'] = 'router'
            result['baseUrl'] = config['values']['ANTHROPIC_BASE_URL']
            # Ghi settings NGAY tại đây (idempotent): readiness nghĩa là "CLI đã có
            # cấu hình để chạy", kể cả khi người dùng mở shell trong box sau đó.
            write_settings(config)
            result['settingsFile'] = settings_path().exists()
            if not (result['structuredOutput'] and result['skillMount']):
                result['reason'] = 'Check sandbox login, CLI version and read-only skill mount.'
            elif not router_reachable(config):
                result['reason'] = ('BoxFox router is not reachable from inside the sandbox: open the LLM bridge '
                                    '(BOX_LLM_BRIDGE=on + BOX_LLM_BRIDGE_HOST=<docker gateway>) and bind the router '
                                    'on that address (BOXFOX_ROUTER_BRIDGE_HOST).')
            else:
                result['status'] = 'ready'
                result['reason'] = ''
        else:
            auth = subprocess.run([binary, 'auth', 'status'], capture_output=True, text=True, timeout=15)
            state = json.loads(auth.stdout or '{}')
            result['authenticated'] = auth.returncode == 0 and state.get('loggedIn') is True
            result['auth'] = 'account' if result['authenticated'] else None
            result['status'] = 'ready' if result['authenticated'] and result['structuredOutput'] and result['skillMount'] else 'setup_required'
            result['reason'] = '' if result['status'] == 'ready' else 'Check sandbox login, CLI version and read-only skill mount.'
    except Exception as exc:
        result['reason'] = type(exc).__name__ + ': CLI readiness check failed'
    return result


def main():
    value = json.loads(sys.stdin.readline())
    sid = value.get('session', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', sid):
        raise ValueError('Invalid child session')
    marker = Path('/tmp/boxfox-claude-' + sid + '.json')
    if value['action'] == 'cancel':
        if marker.exists():
            pgid = json.loads(marker.read_text())['pgid']
            try:
                stat = Path(f'/proc/{pgid}/stat')
                if stat.exists() and stat.read_text().split()[21] == json.loads(marker.read_text()).get('start'):
                    os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        return
    ready = probe()
    send({'type': 'readiness', 'data': ready})
    if value['action'] == 'probe' or ready['status'] != 'ready':
        return
    readonly = value['role'] in {'explore', 'plan', 'design', 'review', 'research'}
    if readonly and not ready['readOnlyIsolation']:
        send({'type': 'error', 'message': 'setup_required: read-only roles require working bubblewrap isolation'})
        return
    binary = shutil.which('claude')
    toolset = 'Read,Glob,Grep' if readonly else 'Read,Glob,Grep,Edit,Write,Bash'
    argv = [binary, '-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '10',
            '--tools', toolset, '--allowedTools', toolset, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--setting-sources', '', '--settings', '{"disableAllHooks":true}']
    if readonly:
        argv = ['bwrap', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
                '--tmpfs', '/tmp', '--', *argv]
    # Môi trường CLI = môi trường worker + biến ANTHROPIC_* đã đặt tên lại. Nhờ
    # vậy đường router chạy được kể cả khi HOME/settings.json bị lệch.
    environment = {**os.environ, **cli_environment(router_config())}
    proc = subprocess.Popen(argv, cwd=str(WORKSPACE), env=environment, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                            start_new_session=True)
    marker.write_text(json.dumps({'pgid': proc.pid, 'start': Path(f'/proc/{proc.pid}/stat').read_text().split()[21]}))
    try:
        proc.stdin.write(value['prompt'] + '\n\nTask skill guidance; obey assigned role and tool restrictions:\n' + value.get('instructions', ''))
        proc.stdin.close()
        for line in proc.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            # Do not forward system env/auth details, raw tool inputs, or provider secrets.
            if event.get('type') == 'assistant':
                content = event.get('message', {}).get('content', [])
                text = ''.join(c.get('text', '') for c in content if c.get('type') == 'text')
                if text:
                    send({'type': 'text', 'text': text})
            elif event.get('type') == 'result':
                send({'type': 'result', 'text': event.get('result', ''), 'is_error': event.get('is_error', False),
                      'usage': event.get('usage'), 'sessionId': event.get('session_id')})
        code = proc.wait()
        if code:
            send({'type': 'error', 'message': f'Claude Code exited with status {code}; check sandbox CLI setup'})
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        marker.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        send({'type': 'error', 'message': mask(str(error))[:500]})
        sys.exit(1)
