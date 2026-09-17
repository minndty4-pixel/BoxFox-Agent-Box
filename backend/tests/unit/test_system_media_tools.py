"""Unit tests for System Media Tools (Screen Capture & Recording)."""

import asyncio
from pathlib import Path
import pytest

from agentbox.tools.base import ToolContext
from agentbox.tools.system_media import (
    ComputerScreenCaptureTool,
    ComputerScreenRecordTool,
    _RECORDING_STATE,
)


def test_computer_screen_capture_creates_png(tmp_path: Path):
    """Verify screen capture generates a valid PNG file and dimensions."""
    ctx = ToolContext(workspace_dir=tmp_path)
    tool = ComputerScreenCaptureTool()

    result = asyncio.run(tool.execute({
        "output_path": "desktop_test.png",
        "include_base64": True,
    }, ctx))

    assert not result.is_error, f"Screen capture failed: {result.error}"
    assert "desktop_test.png" in result.content

    # Check physical file
    shot_path = tmp_path / "desktop_test.png"
    assert shot_path.exists()
    assert shot_path.stat().st_size > 0

    # Check metadata
    assert result.metadata is not None
    assert "dimensions" in result.metadata
    assert "base64" in result.metadata
    assert len(result.metadata["base64"]) > 100


def test_computer_screen_capture_sandbox_path_security(tmp_path: Path):
    """Verify screen capture respects workspace boundaries."""
    ctx = ToolContext(workspace_dir=tmp_path)
    tool = ComputerScreenCaptureTool()

    result = asyncio.run(tool.execute({
        "output_path": "../../outside.png",
    }, ctx))

    assert result.is_error
    assert "Path Traversal Denied" in result.error or "Access denied" in result.error


def test_computer_screen_record_lifecycle(tmp_path: Path):
    """Verify screen recording start, status, and stop state machine."""
    ctx = ToolContext(workspace_dir=tmp_path)
    tool = ComputerScreenRecordTool()

    # Reset recording state in case of dirty test state
    _RECORDING_STATE["active"] = False
    _RECORDING_STATE["start_time"] = None
    _RECORDING_STATE["output_file"] = None

    # 1. Initial Status
    status_res = asyncio.run(tool.execute({"action": "status"}, ctx))
    assert not status_res.is_error
    assert status_res.metadata["active"] is False

    # 2. Start Recording
    start_res = asyncio.run(tool.execute({
        "action": "start",
        "output_filename": "screen_test.mp4",
    }, ctx))
    assert not start_res.is_error
    assert start_res.metadata["active"] is True
    assert "screen_test.mp4" in start_res.content

    # 3. Status during active recording
    active_status = asyncio.run(tool.execute({"action": "status"}, ctx))
    assert active_status.metadata["active"] is True
    assert "ACTIVE" in active_status.content

    # 4. Duplicate start prevention
    dup_res = asyncio.run(tool.execute({"action": "start"}, ctx))
    assert "already active" in dup_res.content

    # 5. Stop Recording
    stop_res = asyncio.run(tool.execute({"action": "stop"}, ctx))
    assert not stop_res.is_error
    assert stop_res.metadata["active"] is False
    assert "stopped" in stop_res.content

    # 6. Status after stop
    final_status = asyncio.run(tool.execute({"action": "status"}, ctx))
    assert final_status.metadata["active"] is False
