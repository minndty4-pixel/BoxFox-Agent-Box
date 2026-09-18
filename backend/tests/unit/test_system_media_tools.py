"""Media compatibility tools must call sandbox adapters, never fake success."""
import asyncio
from agentbox.tools.base import ToolContext
from agentbox.tools.system_media import ComputerScreenCaptureTool, ComputerScreenRecordTool


class UnavailableSandbox:
    async def execute(self, *args):
        raise ConnectionError('Sandbox offline')


def test_capture_offline_does_not_capture_host(tmp_path):
    result = asyncio.run(ComputerScreenCaptureTool(UnavailableSandbox()).execute({}, ToolContext(tmp_path)))
    assert result.is_error and 'Sandbox offline' in result.error
    assert not list(tmp_path.iterdir())


def test_capture_rejects_traversal(tmp_path):
    result = asyncio.run(ComputerScreenCaptureTool(UnavailableSandbox()).execute({'output_path': '../../outside.png'}, ToolContext(tmp_path)))
    assert result.is_error and 'Path Traversal Denied' in result.error


def test_record_offline_never_reports_recording_started(tmp_path):
    tool = ComputerScreenRecordTool(UnavailableSandbox())
    for action in ['start', 'status', 'stop']:
        result = asyncio.run(tool.execute({'action': action}, ToolContext(tmp_path)))
        assert result.is_error
        assert not result.metadata.get('active')
