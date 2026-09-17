"""Unit tests for BoxFox Base Tool Framework, Registry, and Path Traversal Security."""

from pathlib import Path
import pytest

from agentbox.tools.base import (
    BaseTool,
    RiskTier,
    SmartTruncator,
    ToolContext,
    ToolResult,
)
from agentbox.tools.registry import ToolRegistry, default_registry


def test_tool_result_to_dict():
    res = ToolResult(content="test output", error=None, is_error=False, metadata={"code": 200})
    d = res.to_dict()
    assert d["content"] == "test output"
    assert d["is_error"] is False
    assert d["metadata"]["code"] == 200


def test_tool_result_error_formatting():
    res = ToolResult(content="traceback details", error="Compilation failed", is_error=True)
    out = res.to_llm_output()
    assert "Error: Compilation failed" in out
    assert "traceback details" in out


def test_smart_truncator_short_text():
    short = "Hello World\nLine 2"
    res, truncated = SmartTruncator.truncate(short, max_lines=10, max_chars=100)
    assert res == short
    assert truncated is False


def test_smart_truncator_long_text():
    lines = [f"Log line {i}\n" for i in range(200)]
    long_text = "".join(lines)
    res, truncated = SmartTruncator.truncate(long_text, max_lines=30, max_chars=1000)
    assert truncated is True
    assert "Smart Truncate" in res
    assert "Log line 0" in res  # Head preserved
    assert "Log line 199" in res  # Tail preserved


def test_tool_context_path_traversal_guard(tmp_path: Path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    ctx = ToolContext(workspace_dir=ws)

    # Valid relative path inside workspace
    valid = ctx.resolve_path("sub/file.txt")
    assert valid == (ws / "sub" / "file.txt").resolve()

    # Path traversal attack attempting to escape workspace
    with pytest.raises(PermissionError) as exc_info:
        ctx.resolve_path("../../etc/passwd")
    assert "Path Traversal Denied" in str(exc_info.value)


def test_tool_registry_registration():
    reg = ToolRegistry()

    class DummyTool(BaseTool):
        name = "dummy_tool"
        description = "A test dummy tool"
        risk_tier = RiskTier.READ_ONLY
        parameters = {
            "type": "object",
            "properties": {"arg": {"type": "string"}},
            "required": ["arg"],
        }

        async def execute(self, params, context):
            return ToolResult(content=params["arg"])

    dummy = DummyTool()
    reg.register(dummy)

    assert reg.has("dummy_tool")
    assert reg.get("dummy_tool") is dummy
    assert reg.get_risk_tier("dummy_tool") == RiskTier.READ_ONLY

    schemas = reg.get_schemas()
    assert len(schemas) == 1
    assert schemas[0]["function"]["name"] == "dummy_tool"


def test_default_registry_contains_core_tools():
    names = default_registry.list_names()
    assert "file_read" in names
    assert "file_write" in names
    assert "file_edit_block" in names
    assert "codebase_grep" in names
    assert "terminal_exec" in names
    assert "lsp_diagnostics" in names
    assert "execute_code" in names
    assert len(names) >= 17
