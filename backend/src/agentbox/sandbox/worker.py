"""Executed ONLY inside the configured Docker sandbox as unprivileged agent.

The host sends this module through docker exec; no host workspace/tool fallback.
"""
import base64
import glob
import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path('/home/agent/workspace').resolve()

# Plan filename rules, identical to deploy/docker/plan_files.py:18-22 (the reader that enforces them).
PLAN_FILENAME = re.compile(r'^v([1-9][0-9]{0,9})-([a-z0-9]+(-[a-z0-9]+)*)\.md$')
PLAN_SLUG = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
PLAN_ROOM = '.plans'
PLAN_MAX_BYTES = 1048576


def path(value):
    resolved = (ROOT / value).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError('Path Traversal Denied: outside sandbox workspace')
    return resolved


def process_marker(session):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', session):
        raise ValueError('Invalid session identifier')
    return Path('/tmp/boxfox-exec-' + session + '.json')


def shell(command, timeout=30, session='default'):
    proc = subprocess.Popen(['bash', '-lc', command], cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, start_new_session=True)
    marker = process_marker(session)
    marker.write_text(json.dumps({'pid': proc.pid, 'start': Path(f'/proc/{proc.pid}/stat').read_text().split()[21]}))
    try:
        output, _ = proc.communicate(timeout=min(120, max(1, timeout)))
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        raise ValueError('Command timed out; process group stopped')
    finally:
        marker.unlink(missing_ok=True)
    output = output.decode('utf-8', errors='replace')
    artifact = None
    if len(output) > 20000:
        file = path('.generated_artifacts/tools/' + uuid.uuid4().hex + '.txt')
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(output, encoding='utf-8')
        artifact = str(file.relative_to(ROOT))
    return {'content': output[:15000] + ('\n[truncated; see artifact]' if artifact else ''),
            'exit_code': proc.returncode, 'is_error': proc.returncode != 0, 'artifact': artifact}


def browser(args, session):
    from playwright.sync_api import sync_playwright
    action = args.get('action', 'snapshot')
    try:
        with socket.create_connection(('127.0.0.1', 9222), timeout=1):
            pass
    except OSError:
        if action != 'navigate':
            raise ValueError('Sandbox browser is not running; navigate first')
        subprocess.Popen(['box-chromium', 'about:blank'], env={**os.environ, 'DISPLAY': ':99'},
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(40):
            try:
                with socket.create_connection(('127.0.0.1', 9222), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise ValueError('Sandbox Chromium failed to start CDP')
    with sync_playwright() as pw:
        client = pw.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=15000)
        context = client.contexts[0]
        marker = 'boxfox-harness-' + session
        page = next((p for p in context.pages if p.evaluate('window.name') == marker), None)
        if page is None:
            if action != 'navigate':
                raise ValueError('No browser page for this session. Navigate first.')
            page = context.new_page()
            page.evaluate('(v) => window.name = v', marker)
        page.set_default_timeout(10000)
        if action == 'navigate':
            url = args['url']
            if not url.startswith(('http://', 'https://')):
                raise ValueError('Only http/https browser URLs are allowed')
            page.goto(url, wait_until='domcontentloaded', timeout=25000)
            page.evaluate('(v) => window.name = v', marker)
        elif action in {'click', 'fill'}:
            ref = args.get('ref', '')
            if not re.fullmatch(r'[a-f0-9]{8}-\d+', ref):
                raise ValueError('Use a ref from the latest snapshot')
            locator = page.locator('[data-boxfox-ref="' + ref + '"]')
            if locator.count() != 1:
                raise ValueError('Stale browser ref; take a new snapshot')
            if action == 'click':
                locator.click()
            else:
                locator.fill(args.get('text', ''))
        elif action == 'key':
            page.keyboard.press(args['key'])
        elif action == 'screenshot':
            output = path('.generated_artifacts/browser/' + uuid.uuid4().hex + '.png')
            output.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output))
            return {'content': 'Browser screenshot captured', 'artifact': str(output.relative_to(ROOT)),
                    'image': base64.b64encode(output.read_bytes()).decode(), 'mime': 'image/png'}
        elif action != 'snapshot':
            raise ValueError('Unknown browser action')
        nonce = uuid.uuid4().hex[:8]
        elements = page.locator('a,button,input,textarea,select,[role="button"]').evaluate_all('''(nodes, nonce) => nodes.slice(0,100).map((e,i) => {
            const ref = nonce + '-' + i; e.setAttribute('data-boxfox-ref',ref);
            return {ref,tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,180)};
        })''', nonce)
        return {'url': page.url, 'title': page.title(), 'content': page.locator('body').inner_text()[:12000], 'elements': elements}


def write_text(target, content, exclusive=False):
    target.parent.mkdir(parents=True, exist_ok=True)
    if exclusive:
        with open(target, 'x', encoding='utf-8') as handle:
            handle.write(content)
    else:
        target.write_text(content, encoding='utf-8')
    return target


def write_plan(args):
    """Write .plans/vN-slug.md at the next free version. Never overwrites an existing version."""
    slug = str(args.get('slug') or '').strip()
    if not PLAN_SLUG.fullmatch(slug):
        raise ValueError('Plan slug must be lowercase words separated by single dashes (e.g. workspace-plan)')
    content = args.get('markdown')
    if not isinstance(content, str) or not content.strip():
        raise ValueError('Plan markdown must not be empty')
    size = len(content.encode('utf-8'))
    if size > PLAN_MAX_BYTES:
        raise ValueError('Plan exceeds the 1 MiB plan-file limit')
    directory = path(PLAN_ROOM)
    directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        raise ValueError(PLAN_ROOM + ' is not a directory')
    used = {int(match.group(1)) for match in (PLAN_FILENAME.fullmatch(item.name) for item in directory.iterdir())
            if match and (directory / match.group(0)).is_file()}
    version = max(used or {0}) + 1
    while True:
        target = directory / f'v{version}-{slug}.md'
        if target.exists():
            version += 1
            continue
        try:
            write_text(target, content, exclusive=True)
            break
        except FileExistsError:
            version += 1
    relative = target.relative_to(ROOT).as_posix()
    # KHÔNG trả `identity` ở đây: hợp đồng §1 cấm dạng kèm tiền tố `vN-` (identity là
    # khoá mà `GET /__box/plans` dùng để nhóm, tức slug trần / `dir/slug`). Bên gọi
    # tự suy ra từ `relativePath` đã được xác nhận.
    return {'content': 'Written ' + relative, 'version': version,
            'slug': slug, 'relativePath': relative, 'title': str(args.get('title') or '')[:120],
            'bytes': size}


def execute(name, args, session):
    if name == '__skill_readiness':
        package = Path(args['basePath']).resolve()
        base = Path('/opt/boxfox-skills').resolve()
        if not package.is_relative_to(base):
            raise ValueError('Invalid skill package')
        requirements = args.get('requirements', {})
        def names(items):
            return [v if isinstance(v, str) else v.get('name', '') for v in items if isinstance(v, (str, dict)) and not (isinstance(v, dict) and v.get('optional'))]
        commands = names(requirements.get('commands', []))
        environment = names(requirements.get('environment', []))
        files = names(requirements.get('files', []))
        missing = {'commands': [n for n in commands if not shutil.which(n)],
                   'environment': [n for n in environment if not os.environ.get(n)],
                   'files': [n for n in files if not Path(os.path.expandvars(n)).expanduser().is_file()]}
        supported = not args.get('platforms') or 'linux' in args['platforms']
        return {'status': 'ready' if package.is_dir() and supported and not any(missing.values()) else 'setup_required',
                'packageMounted': package.is_dir(), 'platformSupported': supported, 'missing': missing}
    if name == '__cancel':
        marker = process_marker(session)
        if marker.exists():
            entry = json.loads(marker.read_text())
            stat = Path('/proc/' + str(entry['pid']) + '/stat')
            if stat.exists() and stat.read_text().split()[21] == entry['start']:
                os.killpg(entry['pid'], signal.SIGKILL)
            marker.unlink(missing_ok=True)
        return {'content': 'Session subprocess cleanup complete'}
    if name == 'file_read':
        return {'content': path(args['path']).read_text(encoding='utf-8')[:30000]}
    if name == 'file_write':
        target = path(args['path'])
        write_text(target, args['content'])
        return {'content': 'Written ' + str(target.relative_to(ROOT))}
    if name == 'write_plan':
        return write_plan(args)
    if name == 'file_edit_block':
        target = path(args['path'])
        content = target.read_text(encoding='utf-8')
        if not args['old_text'] or content.count(args['old_text']) != 1:
            raise ValueError('old_text must match exactly once; read file first')
        target.write_text(content.replace(args['old_text'], args['new_text'], 1), encoding='utf-8')
        return {'content': 'Updated ' + str(target.relative_to(ROOT))}
    if name == 'codebase_glob':
        pattern = args.get('pattern', '**/*')
        path(pattern)
        found = []
        for item in ROOT.glob(pattern):
            if item.is_file() and item.resolve().is_relative_to(ROOT):
                found.append(item.relative_to(ROOT).as_posix())
            if len(found) >= 500:
                break
        return {'content': '\n'.join(found)}
    if name == 'codebase_grep':
        needle = args['query']
        results = []
        for item in path(args.get('path', '.')).rglob('*'):
            if not item.is_file() or not item.resolve().is_relative_to(ROOT) or item.stat().st_size > 1000000:
                continue
            try:
                for n, line in enumerate(item.read_text(encoding='utf-8').splitlines(), 1):
                    if needle in line:
                        results.append(f'{item.relative_to(ROOT)}:{n}:{line[:300]}')
                    if len(results) >= 100:
                        return {'content': '\n'.join(results)}
            except (UnicodeError, PermissionError):
                continue
        return {'content': '\n'.join(results)}
    if name == 'terminal_exec':
        return shell(args['command'], args.get('timeout', 30), session)
    if name == 'browser_use':
        return browser(args, session)
    if name == 'computer_use':
        action = args['action']
        commands = {
            'click': lambda: ['xdotool', 'mousemove', '--sync', str(int(args['x'])), str(int(args['y'])), 'click', '1'],
            'double_click': lambda: ['xdotool', 'mousemove', '--sync', str(int(args['x'])), str(int(args['y'])), 'click', '--repeat', '2', '--delay', '100', '1'],
            'right_click': lambda: ['xdotool', 'mousemove', '--sync', str(int(args['x'])), str(int(args['y'])), 'click', '3'],
            'middle_click': lambda: ['xdotool', 'mousemove', '--sync', str(int(args['x'])), str(int(args['y'])), 'click', '2'],
            'type': lambda: ['xdotool', 'type', '--clearmodifiers', '--', args['text']],
            'key': lambda: ['xdotool', 'key', '--clearmodifiers', args['key']],
            'scroll': lambda: ['xdotool', 'click', '--repeat', str(min(20, max(1, int(args.get('steps', 3))))), '5' if args.get('direction') == 'down' else '4'],
        }
        if action not in commands:
            raise ValueError('Unknown computer action')
        # F4 (đợt 7): bàn phím chỉ tới cửa sổ ĐANG được focus. Không có cửa sổ nào thì
        # `xdotool` vẫn thoát 0, nên phải nói rõ là chưa gửi được thay vì báo đã gửi.
        if action in {'type', 'key'}:
            focused = subprocess.run(['xdotool', 'getactivewindow'], env={**os.environ, 'DISPLAY': ':99'},
                                     capture_output=True, timeout=15)
            if focused.returncode:
                raise ValueError('No focused window: click the target window first, then send keys.')
        proc = subprocess.run(commands[action](), env={**os.environ, 'DISPLAY': ':99'}, capture_output=True, timeout=15)
        if proc.returncode:
            raise ValueError(proc.stderr.decode(errors='replace'))
        # F3 (đợt 7): `xdotool key NotARealKey` in 'No such key name ... Ignoring it.' ra
        # stdout rồi thoát 0. Coi cảnh báo đó là thất bại, kèm tên phím sai.
        noisy = (proc.stdout + proc.stderr).decode(errors='replace')
        if 'No such key name' in noisy or 'Ignoring it' in noisy:
            raise ValueError('Unsupported key name: ' + str(args.get('key', '')) + '. Use an X keysym such as Return, Tab, ctrl+c.')
        return {'content': 'Input delivered; capture the screen to verify the effect.'}
    raise ValueError('Unsupported sandbox tool: ' + name)


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(execute(request['name'], request['args'], request['session']), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'is_error': True, 'error': str(exc)}))
