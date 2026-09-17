"""Unit tests for Code Intelligence, AST & LSP Tools."""

import asyncio
from pathlib import Path
import pytest

from agentbox.tools.base import ToolContext
from agentbox.tools.code_intelligence import (
    AstGrepSearchTool,
    LspDefinitionsTool,
    LspDiagnosticsTool,
    LspReferencesTool,
    RepoMapGenerateTool,
)


def test_lsp_diagnostics_python(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    diag_tool = LspDiagnosticsTool()

    # Valid python file
    valid_file = tmp_path / "valid.py"
    valid_file.write_text("def greet():\n    return 'hello'\n", encoding="utf-8")
    clean_res = asyncio.run(diag_tool.execute({"path": "valid.py"}, ctx))
    assert not clean_res.is_error
    assert "No syntax or compilation errors" in clean_res.content

    # Broken python file
    broken_file = tmp_path / "broken.py"
    broken_file.write_text("def greet(\n    return 'missing close paren'\n", encoding="utf-8")
    broken_res = asyncio.run(diag_tool.execute({"path": "broken.py"}, ctx))
    assert broken_res.is_error
    assert "SyntaxError" in broken_res.content


def test_lsp_definitions_and_references(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    service_file = tmp_path / "service.py"
    service_file.write_text(
        "class OrderService:\n"
        "    def process_order(self):\n"
        "        pass\n\n"
        "svc = OrderService()\n"
        "svc.process_order()\n",
        encoding="utf-8",
    )

    def_tool = LspDefinitionsTool()
    ref_tool = LspReferencesTool()

    # Find definition
    d_res = asyncio.run(def_tool.execute({"symbol": "OrderService"}, ctx))
    assert not d_res.is_error
    assert "service.py:1: class OrderService:" in d_res.content

    # Find references
    r_res = asyncio.run(ref_tool.execute({"symbol": "process_order"}, ctx))
    assert not r_res.is_error
    assert "service.py:2" in r_res.content
    assert "service.py:6" in r_res.content


def test_ast_grep_and_repo_map(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    models_file = tmp_path / "models.py"
    models_file.write_text(
        "class UserModel:\n"
        "    def save(self):\n"
        "        pass\n"
        "    def delete(self):\n"
        "        pass\n\n"
        "def helper_func():\n"
        "    return 42\n",
        encoding="utf-8",
    )

    ast_tool = AstGrepSearchTool()
    map_tool = RepoMapGenerateTool()

    # AST grep search for ClassDef
    ast_res = asyncio.run(ast_tool.execute({"node_type": "ClassDef"}, ctx))
    assert not ast_res.is_error
    assert "[ClassDef] UserModel" in ast_res.content

    # Generate repository map
    map_res = asyncio.run(map_tool.execute({}, ctx))
    assert not map_res.is_error
    assert "class UserModel" in map_res.content
    assert "def helper_func()" in map_res.content
