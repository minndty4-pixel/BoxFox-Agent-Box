"""Executed inside Docker via stdin, never imported on the host.

No shell interpolation. Child process-group ownership is per invocation.
"""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys


def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def probe():
    binary = shutil.which('claude')
    result = {'executor': 'claude-code', 'status': 'setup_required', 'binary': bool(binary),
              'authenticated': False, 'version': None, 'readOnlyIsolation': bool(shutil.which('bwrap')),
              'skillMount': Path('/opt/boxfox-skills').is_dir()}
    if not binary:
        result['reason'] = 'Install Claude Code inside the sandbox, then sign in there.'
        return result
    try:
        version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=10)
        result['version'] = version.stdout.strip()[:150]
        auth = subprocess.run([binary, 'auth', 'status'], capture_output=True, text=True, timeout=15)
        state = json.loads(auth.stdout or '{}')
        result['authenticated'] = auth.returncode == 0 and state.get('loggedIn') is True
        help_result = subprocess.run([binary, '--help'], capture_output=True, text=True, timeout=10)
        result['structuredOutput'] = all(flag in help_result.stdout for flag in ('--output-format', '--allowedTools', '--tools', '--strict-mcp-config', '--setting-sources', '--settings'))
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
    proc = subprocess.Popen(argv, cwd='/home/agent/workspace', stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding='utf-8', start_new_session=True)
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
        send({'type': 'error', 'message': str(error)[:500]})
        sys.exit(1)
