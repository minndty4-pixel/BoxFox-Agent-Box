"""Integration test for CUA Element Selection, double_click, and screen recording."""
import asyncio
import json
import uuid
import pytest
from agentbox.sandbox.executor import SandboxExecutor
from agentbox.agent_core.tool_contracts import schemas_for
from agentbox.agent_core.roles import allowed_tools


def test_cua_inspect_element_and_double_click():
    async def run():
        executor = SandboxExecutor()
        sid = uuid.uuid4().hex

        # 1. Verify inspect_element tool is registered in tool contracts
        tools = allowed_tools('orchestrator')
        assert 'inspect_element' in tools
        schemas = schemas_for(['inspect_element', 'computer_use', 'browser_use', 'computer_screen_record'])
        names = [s['function']['name'] for s in schemas]
        assert 'inspect_element' in names
        assert 'computer_use' in names

        # Check computer_use actions schema includes double_click and right_click
        comp_use = next(s for s in schemas if s['function']['name'] == 'computer_use')
        actions = comp_use['function']['parameters']['properties']['action']['enum']
        assert 'double_click' in actions
        assert 'right_click' in actions

        # 2. Test inspect_element via executor on X11 desktop (80, 520)
        inspect_res = await executor.execute('inspect_element', {'x': 80, 'y': 520}, sid)
        assert not inspect_res.get('is_error')
        assert inspect_res.get('type') in {'desktop', 'dom'}
        print("\n[TEST] inspect_element result:", inspect_res.get('type'), inspect_res.get('appName'), inspect_res.get('windowTitle'))

        # 3. Test computer_use double_click
        double_click_res = await executor.execute('computer_use', {'action': 'double_click', 'x': 80, 'y': 520}, sid)
        assert not double_click_res.get('is_error')
        assert 'Input delivered' in double_click_res.get('content', '')
        print("[TEST] double_click delivered successfully")

        # 4. Test computer_screen_record start -> sleep -> stop produces valid non-zero mp4
        start_rec = await executor.execute('computer_screen_record', {'action': 'start'}, sid)
        assert start_rec.get('ok') is True
        assert start_rec.get('recordingId')

        await asyncio.sleep(2)

        stop_rec = await executor.execute('computer_screen_record', {'action': 'stop'}, sid)
        assert stop_rec.get('ok') is True
        assert stop_rec.get('sizeBytes', 0) > 0
        assert stop_rec.get('durationSec', 0) > 0
        print(f"[TEST] Screen record verified: size={stop_rec.get('sizeBytes')}B duration={stop_rec.get('durationSec')}s path={stop_rec.get('path')}")

        # 5. Verify video with ffprobe
        video_path = stop_rec['path']
        probe = await executor.execute('terminal_exec', {'command': f'ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of json {video_path}'}, sid)
        assert not probe.get('is_error')
        probe_data = json.loads(probe['content'])
        assert len(probe_data['streams']) > 0
        assert probe_data['streams'][0]['width'] > 0
        print(f"[TEST] ffprobe verified: {probe_data['streams'][0]['width']}x{probe_data['streams'][0]['height']}")

    asyncio.run(run())


def test_browser_use_navigation_and_dom_inspection():
    async def run():
        executor = SandboxExecutor()
        sid = uuid.uuid4().hex

        # Navigate to a real page (Wikipedia)
        nav = await executor.execute('browser_use', {'action': 'navigate', 'url': 'https://vi.wikipedia.org'}, sid)
        assert not nav.get('is_error')
        assert 'Wikipedia' in nav.get('title', '')
        print("\n[TEST] Navigated successfully to Wikipedia:", nav.get('title'))

        # Take snapshot
        snap = await executor.execute('browser_use', {'action': 'snapshot'}, sid)
        assert not snap.get('is_error')
        assert len(snap.get('elements', [])) > 0
        print(f"[TEST] Snapshot returned {len(snap['elements'])} elements")

        # Take browser screenshot
        ss = await executor.execute('browser_use', {'action': 'screenshot'}, sid)
        assert not ss.get('is_error')
        assert ss.get('image')
        print("[TEST] Browser screenshot taken:", ss.get('artifact'))

    asyncio.run(run())
