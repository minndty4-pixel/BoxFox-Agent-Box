"""Unit tests for Filesystem & Code Editing Tools."""

import asyncio
from pathlib import Path
import pytest

from agentbox.tools.base import ToolContext
from agentbox.tools.file_ops import (
    CodebaseGlobTool,
    CodebaseGrepTool,
    FileEditBlockTool,
    FileReadTool,
    FileWriteTool,
)


def test_file_write_and_read(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    writer = FileWriteTool()
    reader = FileReadTool()

    # Write file
    w_res = asyncio.run(writer.execute(
        {"path": "src/app.py", "content": "print('hello world')\n", "overwrite": False},
        ctx,
    ))
    assert not w_res.is_error
    assert (tmp_path / "src" / "app.py").exists()

    # Overwrite protection check
    w_dup = asyncio.run(writer.execute(
        {"path": "src/app.py", "content": "print('override')", "overwrite": False},
        ctx,
    ))
    assert w_dup.is_error
    assert "already exists" in w_dup.error

    # Read file
    r_res = asyncio.run(reader.execute({"path": "src/app.py"}, ctx))
    assert not r_res.is_error
    assert "1: print('hello world')" in r_res.content


def test_file_read_reports_a_binary_file_instead_of_decoding_it(tmp_path: Path):
    """A8: công cụ đọc của HARNESS cũng phải nói thật về tệp nhị phân, không ném.

    `worker.py::file_read` (trong box) là mặt của lượt thật; đây là mặt còn lại — công cụ
    `FileReadTool` mà harness dùng khi tự đọc tệp. Hai mặt phải cùng một hợp đồng: nhị phân thì
    trả mô tả ngắn kèm cờ, không trả về một nửa chuỗi đã giải mã sai.
    """
    ctx = ToolContext(workspace_dir=tmp_path)
    payload = b'\x89PNG\r\n\x1a\n' + bytes(range(256))
    (tmp_path / 'shot.png').write_bytes(payload)

    result = asyncio.run(FileReadTool().execute({'path': 'shot.png'}, ctx))

    assert not result.is_error
    assert result.content.startswith('[Binary file: shot.png')
    assert result.metadata.get('is_binary') is True
    assert result.metadata.get('size_bytes') == len(payload)


def test_file_edit_block_success(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    fpath = tmp_path / "calc.py"
    fpath.write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")

    editor = FileEditBlockTool()
    res = asyncio.run(editor.execute(
        {
            "path": "calc.py",
            "target_content": "    return a - b",
            "replacement_content": "    return a + b",
        },
        ctx,
    ))
    assert not res.is_error
    assert "Diff:" in res.content
    assert fpath.read_text(encoding="utf-8") == "def add(a, b):\n    return a + b\n"


def test_file_edit_block_errors(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    fpath = tmp_path / "multi.py"
    fpath.write_text("x = 1\nx = 1\n", encoding="utf-8")

    editor = FileEditBlockTool()

    # Target not found
    not_found = asyncio.run(editor.execute(
        {"path": "multi.py", "target_content": "z = 9", "replacement_content": "z = 10"},
        ctx,
    ))
    assert not_found.is_error
    assert "target_content was not found" in not_found.error

    # Target not unique
    not_unique = asyncio.run(editor.execute(
        {"path": "multi.py", "target_content": "x = 1", "replacement_content": "x = 2"},
        ctx,
    ))
    assert not_unique.is_error
    assert "found 2 times" in not_unique.error


def test_codebase_grep_and_glob(tmp_path: Path):
    ctx = ToolContext(workspace_dir=tmp_path)
    (tmp_path / "module_a.py").write_text("class AlphaProcessor:\n    pass\n", encoding="utf-8")
    (tmp_path / "module_b.py").write_text("class BetaProcessor:\n    pass\n", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("alpha notes\n", encoding="utf-8")

    grep_tool = CodebaseGrepTool()
    glob_tool = CodebaseGlobTool()

    # Grep test
    grep_res = asyncio.run(grep_tool.execute({"query": "AlphaProcessor"}, ctx))
    assert not grep_res.is_error
    assert "module_a.py:1: class AlphaProcessor:" in grep_res.content

    # Glob test
    glob_res = asyncio.run(glob_tool.execute({"pattern": "*.py"}, ctx))
    assert not glob_res.is_error
    assert "module_a.py" in glob_res.content
    assert "module_b.py" in glob_res.content
    assert "notes.txt" not in glob_res.content
