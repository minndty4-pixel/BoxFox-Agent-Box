"""Unit tests for Terminal & Ephemeral Execution Tools."""

import asyncio
from pathlib import Path
import pytest

from agentbox.tools.base import ToolContext
from agentbox.tools.terminal_ops import (
    ExecuteCodeTool,
    ProcessManageTool,
    TerminalExecTool,
    TerminalOutputTruncateTool,
)


def test_terminal_exec_echo(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    exec_tool = TerminalExecTool()

    res = asyncio.run(exec_tool.execute({"command": "Write-Output 'BOXFOX_TERMINAL_OK'"}, ctx))
    assert not res.is_error
    assert "BOXFOX_TERMINAL_OK" in res.content


def test_execute_code_python(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    code_tool = ExecuteCodeTool()

    snippet = "import math\nprint(f'SQRT:{math.isqrt(144)}')"
    res = asyncio.run(code_tool.execute({"language": "python", "code": snippet}, ctx))
    assert not res.is_error
    assert "SQRT:12" in res.content


def test_terminal_output_truncate():
    ctx = ToolContext(workspace_dir=Path("."))
    trunc_tool = TerminalOutputTruncateTool()

    raw_text = "\n".join([f"line_{i}" for i in range(100)])
    res = asyncio.run(trunc_tool.execute({"text": raw_text, "max_lines": 20}, ctx))
    assert not res.is_error
    assert "Smart Truncate" in res.content
    assert res.metadata.get("truncated") is True
