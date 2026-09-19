"""Opt-in REAL Docker tools + deterministic model loop (not a live LLM claim)."""
import asyncio
import json
import os
import subprocess
import uuid
import pytest
from agentbox.sandbox.executor import SandboxExecutor
from agentbox.memory.session_store import SessionStore
from agentbox.agent_core.runtime import HarnessRuntime

pytestmark = pytest.mark.skipif(os.environ.get('BOXFOX_LIVE_SANDBOX') != '1', reason='Set BOXFOX_LIVE_SANDBOX=1 to exercise real Docker sandbox')


def test_real_files_browser_computer_capture_video_and_agent(tmp_path):
    async def run():
        executor = SandboxExecutor()
        sid = uuid.uuid4().hex
        prefix = '.generated_artifacts/harness-test-' + sid
        result = await executor.execute('file_write', {'path': prefix + '/fixture.html', 'content': '<title>BoxFox Harness Test</title><input aria-label="Name"><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Apply</button><output></output>'}, sid)
        assert not result.get('is_error')
        # One temporary HTTP process serves only this test directory within the container.
        server = subprocess.Popen(['docker', 'exec', '--user', 'agent', '--workdir', '/home/agent/workspace/' + prefix,
                                   'agentbox-box', 'python3', '-m', 'http.server', '8877', '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for attempt in range(20):
                response = await executor.execute('terminal_exec', {'command': 'curl -fsS http://127.0.0.1:8877/fixture.html'}, sid)
                if not response.get('is_error'):
                    break
                await asyncio.sleep(0.25)
            assert '<title>' in response['content']
            browser = await executor.execute('browser_use', {'action': 'navigate', 'url': 'http://127.0.0.1:8877/fixture.html'}, sid)
            assert browser.get('title') == 'BoxFox Harness Test', browser
            field = next(e['ref'] for e in browser['elements'] if e['tag'] == 'INPUT')
            filled = await executor.execute('browser_use', {'action': 'fill', 'ref': field, 'text': 'Verified browser input'}, sid)
            button = next(e['ref'] for e in filled['elements'] if e['tag'] == 'BUTTON')
            clicked = await executor.execute('browser_use', {'action': 'click', 'ref': button}, sid)
            assert 'Verified browser input' in clicked['content']
            screen = await executor.execute('computer_screen_capture', {}, sid)
            assert screen['dimensions'][0] > 0 and screen['image']
            assert not (await executor.execute('computer_use', {'action': 'key', 'key': 'ctrl+l'}, sid)).get('is_error')
            after = await executor.execute('computer_screen_capture', {}, sid)
            assert after['image']
            record = await executor.execute('computer_screen_record', {'action': 'start'}, sid)
            await asyncio.sleep(1.5)
            stopped = await executor.execute('computer_screen_record', {'action': 'stop'}, sid)
            print('SANDBOX_ARTIFACTS', json.dumps({'before': screen['artifact'], 'after': after['artifact'], 'record': record, 'stopped': stopped}))
            video_path = stopped.get('path') or record.get('path')
            assert video_path, stopped
            probe = await executor.execute('terminal_exec', {'command': 'ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json ' + video_path}, sid)
            assert not probe.get('is_error'), probe
            assert json.loads(probe['content'])['streams'][0]['width'] > 0
            class ToolModel:
                async def complete(self, messages, tools, route, max_tokens=4096, **kwargs):
                    if messages[-1]['role'] == 'tool':
                        assert 'fixture.html' in messages[-1]['content']
                        return {'choices': [{'message': {'content': 'Verified sandbox file through agent tools.'}, 'finish_reason': 'stop'}]}
                    return {'choices': [{'message': {'tool_calls': [{'id': 'read', 'type': 'function', 'function': {'name': 'codebase_glob', 'arguments': json.dumps({'pattern': prefix + '/*'})}}]}, 'finish_reason': 'tool_calls'}]}
            store = SessionStore(tmp_path / 'live.db')
            runtime = HarnessRuntime(store, executor, ToolModel())
            session = runtime.create({'skills': []})
            await runtime.start(session['id'], 'Inspect test file')
            assert store.get(session['id'])['status'] == 'completed'
            store.close()
        finally:
            await executor.cleanup(sid)
            # Stop only this fixture HTTP listener (matches exact test directory in command cwd via port owner).
            subprocess.run(['docker', 'exec', '--user', 'agent', 'agentbox-box', 'pkill', '-f', '^python3 -m http.server 8877 --bind 127.0.0.1$'], capture_output=True)
            if server.poll() is None:
                server.terminate()
    asyncio.run(run())
