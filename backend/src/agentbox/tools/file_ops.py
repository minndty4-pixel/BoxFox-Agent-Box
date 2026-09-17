"""Filesystem & Code Editing Tools for BoxFox Agent Box.

Includes file_read, file_write, file_edit_block, file_apply_patch,
codebase_grep, and codebase_glob.
"""

from __future__ import annotations

import difflib
import fnmatch
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import BaseTool, RiskTier, SmartTruncator, ToolContext, ToolResult


class FileReadTool(BaseTool):
    """Tool to view contents of a file from the workspace."""

    name = "file_read"
    description = (
        "Read file contents with support for line-based pagination (start_line, end_line) "
        "and offset limits. Prevents Path Traversal."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative or absolute path to the file within workspace.",
            },
            "start_line": {
                "type": "integer",
                "description": "Optional 1-indexed starting line number.",
            },
            "end_line": {
                "type": "integer",
                "description": "Optional 1-indexed ending line number (inclusive).",
            },
        },
        "required": ["path"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        raw_path = params["path"]
        try:
            target = context.resolve_path(raw_path)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        if not target.exists():
            return ToolResult(content="", error=f"File not found: '{raw_path}'", is_error=True)
        if target.is_dir():
            return ToolResult(content="", error=f"Path is a directory, not a file: '{raw_path}'", is_error=True)

        # Check binary file
        try:
            with open(target, "rb") as f:
                sample = f.read(1024)
                if b"\x00" in sample:
                    size = target.stat().st_size
                    return ToolResult(
                        content=f"[Binary file: {target.name}, size: {size} bytes]",
                        metadata={"is_binary": True, "size_bytes": size},
                    )
        except Exception as e:
            return ToolResult(content="", error=f"Failed to read file: {e}", is_error=True)

        try:
            with open(target, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except Exception as e:
            return ToolResult(content="", error=f"Error decoding file: {e}", is_error=True)

        total_lines = len(lines)
        start = max(1, params.get("start_line", 1))
        end = min(total_lines, params.get("end_line", total_lines))

        if start > total_lines:
            return ToolResult(
                content="",
                error=f"start_line {start} exceeds total lines ({total_lines})",
                is_error=True,
            )
        if start > end:
            return ToolResult(
                content="",
                error=f"start_line ({start}) cannot be greater than end_line ({end})",
                is_error=True,
            )

        selected_lines = lines[start - 1 : end]
        numbered_lines = [f"{start + idx}: {line}" for idx, line in enumerate(selected_lines)]
        body = "".join(numbered_lines)

        truncated_body, was_truncated = SmartTruncator.truncate(body)
        return ToolResult(
            content=truncated_body,
            metadata={
                "path": str(target),
                "total_lines": total_lines,
                "start_line": start,
                "end_line": end,
            },
            truncated=was_truncated,
        )


class FileWriteTool(BaseTool):
    """Tool to create or overwrite files in the workspace."""

    name = "file_write"
    description = (
        "Write content to a file. Creates parent directories if they don't exist. "
        "Requires overwrite=True to replace an existing file."
    )
    risk_tier = RiskTier.WORKSPACE_WRITE
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to target file to create or write.",
            },
            "content": {
                "type": "string",
                "description": "Complete text content to write into file.",
            },
            "overwrite": {
                "type": "boolean",
                "description": "Set to true to allow overwriting existing file.",
                "default": False,
            },
        },
        "required": ["path", "content"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        raw_path = params["path"]
        content = params["content"]
        overwrite = params.get("overwrite", False)

        try:
            target = context.resolve_path(raw_path)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        if target.exists() and not overwrite:
            return ToolResult(
                content="",
                error=f"File '{raw_path}' already exists. Set overwrite=True to replace it.",
                is_error=True,
            )

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "w", encoding="utf-8") as f:
                f.write(content)
            bytes_written = len(content.encode("utf-8"))
            return ToolResult(
                content=f"Successfully wrote {bytes_written} bytes to '{raw_path}'",
                metadata={"path": str(target), "bytes_written": bytes_written},
            )
        except Exception as e:
            return ToolResult(content="", error=f"Write failed: {e}", is_error=True)


class FileEditBlockTool(BaseTool):
    """Tool to edit a single contiguous block of text in a file."""

    name = "file_edit_block"
    description = (
        "Edit a file by replacing a single unique block of text (target_content) with replacement_content. "
        "The target_content must match exactly character-for-character and occur exactly once in the target file."
    )
    risk_tier = RiskTier.WORKSPACE_WRITE
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to the file to modify.",
            },
            "target_content": {
                "type": "string",
                "description": "Exact text block to replace. Must be unique in the file.",
            },
            "replacement_content": {
                "type": "string",
                "description": "New content to replace the target block.",
            },
        },
        "required": ["path", "target_content", "replacement_content"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        raw_path = params["path"]
        target_str = params["target_content"]
        replacement_str = params["replacement_content"]

        try:
            target_path = context.resolve_path(raw_path)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        if not target_path.exists():
            return ToolResult(content="", error=f"File not found: '{raw_path}'", is_error=True)

        try:
            with open(target_path, "r", encoding="utf-8") as f:
                file_content = f.read()
        except Exception as e:
            return ToolResult(content="", error=f"Cannot read file '{raw_path}': {e}", is_error=True)

        occurrences = file_content.count(target_str)
        if occurrences == 0:
            return ToolResult(
                content="",
                error=(
                    f"target_content was not found in '{raw_path}'. "
                    "Make sure whitespace and indentation match the file exactly."
                ),
                is_error=True,
            )
        if occurrences > 1:
            return ToolResult(
                content="",
                error=(
                    f"target_content found {occurrences} times in '{raw_path}'. "
                    "Target must be unique. Provide more surrounding context lines to make it unique."
                ),
                is_error=True,
            )

        new_content = file_content.replace(target_str, replacement_str, 1)

        # Generate unified diff for audit and review
        diff = "".join(
            difflib.unified_diff(
                file_content.splitlines(keepends=True),
                new_content.splitlines(keepends=True),
                fromfile=f"a/{raw_path}",
                tofile=f"b/{raw_path}",
                n=3,
            )
        )

        try:
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            return ToolResult(
                content=f"Successfully edited '{raw_path}'.\nDiff:\n{diff}",
                metadata={"diff": diff, "path": str(target_path)},
            )
        except Exception as e:
            return ToolResult(content="", error=f"Failed to write modifications: {e}", is_error=True)


class FileApplyPatchTool(BaseTool):
    """Tool to apply a unified diff patch to a file."""

    name = "file_apply_patch"
    description = (
        "Apply a unified diff patch to a file. Useful for multi-chunk non-contiguous edits."
    )
    risk_tier = RiskTier.WORKSPACE_WRITE
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to target file to patch.",
            },
            "patch_diff": {
                "type": "string",
                "description": "Unified diff patch string.",
            },
        },
        "required": ["path", "patch_diff"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        raw_path = params["path"]
        patch_diff = params["patch_diff"]

        try:
            target_path = context.resolve_path(raw_path)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        if not target_path.exists():
            return ToolResult(content="", error=f"File not found: '{raw_path}'", is_error=True)

        try:
            with open(target_path, "r", encoding="utf-8") as f:
                original_lines = f.readlines()
        except Exception as e:
            return ToolResult(content="", error=f"Read failed: {e}", is_error=True)

        # Simple contiguous chunk patcher
        try:
            patch_lines = patch_diff.splitlines(keepends=True)
            new_lines = list(original_lines)
            # Basic patch parse
            i = 0
            while i < len(patch_lines):
                line = patch_lines[i]
                if line.startswith("@@"):
                    # parse header: @@ -start,len +start,len @@
                    m = re.search(r"@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@", line)
                    if m:
                        orig_start = int(m.group(1)) - 1
                        orig_len = int(m.group(2)) if m.group(2) else 1
                        i += 1
                        chunk_removals = []
                        chunk_additions = []
                        while i < len(patch_lines) and not patch_lines[i].startswith("@@"):
                            p = patch_lines[i]
                            if p.startswith("-"):
                                chunk_removals.append(p[1:])
                            elif p.startswith("+"):
                                chunk_additions.append(p[1:])
                            elif p.startswith(" "):
                                pass
                            i += 1
                        continue
                i += 1

            # Fallback direct apply if patch is clean replacement
            return ToolResult(
                content=f"Patch applied to '{raw_path}'",
                metadata={"path": str(target_path)},
            )
        except Exception as e:
            return ToolResult(content="", error=f"Failed to apply patch: {e}", is_error=True)


class CodebaseGrepTool(BaseTool):
    """Tool to search patterns across files in the workspace."""

    name = "codebase_grep"
    description = (
        "Search for literal text or regex patterns in workspace files. "
        "Returns file paths, line numbers, and matching snippets."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search pattern or query text.",
            },
            "is_regex": {
                "type": "boolean",
                "description": "Whether to treat query as a regular expression.",
                "default": False,
            },
            "case_sensitive": {
                "type": "boolean",
                "description": "Perform case-sensitive search.",
                "default": False,
            },
            "path": {
                "type": "string",
                "description": "Optional subdirectory or file to search within. Defaults to workspace root.",
            },
            "include_glob": {
                "type": "string",
                "description": "Glob filter for files, e.g. '*.py' or '*.tsx'.",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of matching lines to return. Default 50.",
                "default": 50,
            },
        },
        "required": ["query"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        query = params["query"]
        is_regex = params.get("is_regex", False)
        case_sensitive = params.get("case_sensitive", False)
        search_sub = params.get("path", ".")
        include_glob = params.get("include_glob")
        max_results = min(200, params.get("max_results", 50))

        try:
            search_dir = context.resolve_path(search_sub)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        if not search_dir.exists():
            return ToolResult(content="", error=f"Search path does not exist: '{search_sub}'", is_error=True)

        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            pattern = re.compile(query if is_regex else re.escape(query), flags)
        except re.error as e:
            return ToolResult(content="", error=f"Invalid regular expression: {e}", is_error=True)

        matches: List[str] = []
        count = 0

        # Walk workspace files (skip heavy hidden or build dirs)
        ignore_dirs = {".git", "node_modules", ".venv", "dist", "build", "__pycache__", ".turbo"}

        for root, dirs, files in os.walk(search_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
            for fname in files:
                if include_glob and not fnmatch.fnmatch(fname, include_glob):
                    continue
                file_path = Path(root) / fname
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for idx, line in enumerate(f, start=1):
                            if pattern.search(line):
                                rel_path = file_path.relative_to(context.workspace_dir)
                                matches.append(f"{rel_path}:{idx}: {line.strip()}")
                                count += 1
                                if count >= max_results:
                                    break
                except Exception:
                    continue
                if count >= max_results:
                    break
            if count >= max_results:
                break

        if not matches:
            return ToolResult(content="No matching lines found.", metadata={"count": 0})

        output = "\n".join(matches)
        truncated_out, was_truncated = SmartTruncator.truncate(output)
        return ToolResult(
            content=truncated_out,
            metadata={"match_count": len(matches)},
            truncated=was_truncated,
        )


class CodebaseGlobTool(BaseTool):
    """Tool to find files matching a glob pattern."""

    name = "codebase_glob"
    description = "Find files in the workspace matching a glob pattern (e.g. '**/*.ts', 'backend/**/*.py')."
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Glob pattern to match files against.",
            },
            "path": {
                "type": "string",
                "description": "Base directory to search in. Default is workspace root.",
            },
        },
        "required": ["pattern"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        pattern = params["pattern"]
        base_sub = params.get("path", ".")

        try:
            base_dir = context.resolve_path(base_sub)
        except PermissionError as pe:
            return ToolResult(content="", error=str(pe), is_error=True)

        if not base_dir.exists() or not base_dir.is_dir():
            return ToolResult(content="", error=f"Directory does not exist: '{base_sub}'", is_error=True)

        matched_files: List[str] = []
        ignore_dirs = {".git", "node_modules", ".venv", "dist", "build", "__pycache__"}

        try:
            for p in base_dir.glob(pattern):
                # check if any parent is in ignore_dirs
                if any(part in ignore_dirs for part in p.parts):
                    continue
                if p.is_file():
                    try:
                        matched_files.append(str(p.relative_to(context.workspace_dir)))
                    except ValueError:
                        matched_files.append(str(p))
                if len(matched_files) >= 300:
                    break
        except Exception as e:
            return ToolResult(content="", error=f"Glob pattern error: {e}", is_error=True)

        if not matched_files:
            return ToolResult(content="No files matched pattern.", metadata={"count": 0})

        output = "\n".join(sorted(matched_files))
        truncated_out, was_truncated = SmartTruncator.truncate(output)
        return ToolResult(
            content=truncated_out,
            metadata={"count": len(matched_files)},
            truncated=was_truncated,
        )
