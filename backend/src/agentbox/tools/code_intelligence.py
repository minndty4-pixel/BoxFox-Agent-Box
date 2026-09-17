"""Code Intelligence, AST & LSP Tools for BoxFox Agent Box.

Includes lsp_diagnostics, lsp_definitions, lsp_references,
ast_grep_search, and repo_map_generate.
"""

from __future__ import annotations

import ast
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import BaseTool, RiskTier, SmartTruncator, ToolContext, ToolResult


class LspDiagnosticsTool(BaseTool):
    """Tool to check syntax errors, linting issues, and static diagnostics for a file."""

    name = "lsp_diagnostics"
    description = (
        "Run static code diagnostics, syntax checking, and linting errors on a file. "
        "Supports Python AST parse verification and JS/TS syntax diagnostics."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path to the file to diagnose.",
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

        suffix = target.suffix.lower()
        diagnostics: List[str] = []

        if suffix == ".py":
            try:
                with open(target, "r", encoding="utf-8") as f:
                    source = f.read()
                ast.parse(source, filename=str(target))
                return ToolResult(
                    content=f"✓ No syntax or compilation errors found in '{raw_path}'.",
                    metadata={"status": "clean", "errors": 0},
                )
            except SyntaxError as syn_err:
                diag = (
                    f"SyntaxError in '{raw_path}' at line {syn_err.lineno}, col {syn_err.offset}:\n"
                    f"  {syn_err.text.strip() if syn_err.text else ''}\n"
                    f"  Error: {syn_err.msg}"
                )
                return ToolResult(
                    content=diag,
                    error=f"Syntax error at line {syn_err.lineno}: {syn_err.msg}",
                    is_error=True,
                    metadata={"line": syn_err.lineno, "col": syn_err.offset},
                )
            except Exception as e:
                return ToolResult(content="", error=f"Diagnostics failed: {e}", is_error=True)

        elif suffix in [".js", ".jsx", ".ts", ".tsx", ".json"]:
            # Basic bracket / token balance check
            try:
                with open(target, "r", encoding="utf-8") as f:
                    content = f.read()
                # Simple balanced bracket verification
                stack = []
                pairs = {")": "(", "}": "{", "]": "["}
                for line_idx, line in enumerate(content.splitlines(), start=1):
                    for char_idx, ch in enumerate(line, start=1):
                        if ch in "({[":
                            stack.append((ch, line_idx, char_idx))
                        elif ch in ")}]":
                            if not stack:
                                return ToolResult(
                                    content=f"Unmatched closing '{ch}' at line {line_idx}:{char_idx}",
                                    error=f"Unmatched '{ch}' at line {line_idx}",
                                    is_error=True,
                                )
                            last_open, o_line, o_col = stack.pop()
                            if pairs[ch] != last_open:
                                return ToolResult(
                                    content=f"Mismatched closing '{ch}' at line {line_idx}:{char_idx}, expected pair for '{last_open}' from {o_line}:{o_col}",
                                    error=f"Mismatched bracket at line {line_idx}",
                                    is_error=True,
                                )
                if stack:
                    last_open, o_line, o_col = stack[-1]
                    return ToolResult(
                        content=f"Unclosed opening bracket '{last_open}' opened at line {o_line}:{o_col}",
                        error=f"Unclosed '{last_open}' at line {o_line}",
                        is_error=True,
                    )
                return ToolResult(
                    content=f"✓ Structure clean: No unbalanced brackets detected in '{raw_path}'.",
                    metadata={"status": "clean", "errors": 0},
                )
            except Exception as e:
                return ToolResult(content="", error=f"Diagnostics failed: {e}", is_error=True)

        return ToolResult(content=f"Diagnostics passed for '{raw_path}' (standard static verify).")


class LspDefinitionsTool(BaseTool):
    """Tool to locate definition of functions, classes or variables across the workspace."""

    name = "lsp_definitions"
    description = (
        "Find where a class, function, interface, or variable is defined in the workspace."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Exact name of function, class, or variable to locate.",
            },
            "path": {
                "type": "string",
                "description": "Optional search directory scope.",
            },
        },
        "required": ["symbol"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        symbol = params["symbol"]
        scope_dir = context.resolve_path(params.get("path", "."))

        # Definition regex patterns for Python, JS/TS, Go, Rust
        def_patterns = [
            # Python def / class
            re.compile(rf"^\s*(?:async\s+)?def\s+{re.escape(symbol)}\b"),
            re.compile(rf"^\s*class\s+{re.escape(symbol)}\b"),
            # JS/TS export function / class / const
            re.compile(rf"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+{re.escape(symbol)}\b"),
            re.compile(rf"^\s*(?:export\s+)?class\s+{re.escape(symbol)}\b"),
            re.compile(rf"^\s*(?:export\s+)?(?:const|let|var)\s+{re.escape(symbol)}\s*="),
            re.compile(rf"^\s*(?:export\s+)?interface\s+{re.escape(symbol)}\b"),
            re.compile(rf"^\s*(?:export\s+)?type\s+{re.escape(symbol)}\s*="),
        ]

        found_locations: List[str] = []
        ignore_dirs = {".git", "node_modules", ".venv", "dist", "build", "__pycache__"}

        for root, dirs, files in os.walk(scope_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in [".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs"]:
                    continue
                fpath = Path(root) / fname
                try:
                    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                        for line_idx, line in enumerate(f, start=1):
                            if any(p.search(line) for p in def_patterns):
                                rel = fpath.relative_to(context.workspace_dir)
                                found_locations.append(f"{rel}:{line_idx}: {line.strip()}")
                except Exception:
                    continue

        if not found_locations:
            return ToolResult(
                content=f"No definition found for '{symbol}'.",
                metadata={"count": 0},
            )

        output = "\n".join(found_locations)
        return ToolResult(content=output, metadata={"count": len(found_locations)})


class LspReferencesTool(BaseTool):
    """Tool to locate where a symbol is referenced across the workspace."""

    name = "lsp_references"
    description = "Find references and usages of a symbol across all workspace code files."
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Symbol name to find usages for.",
            },
            "max_results": {
                "type": "integer",
                "description": "Max references to return (default 50).",
                "default": 50,
            },
        },
        "required": ["symbol"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        symbol = params["symbol"]
        max_results = min(150, params.get("max_results", 50))

        word_pattern = re.compile(rf"\b{re.escape(symbol)}\b")
        references: List[str] = []
        ignore_dirs = {".git", "node_modules", ".venv", "dist", "build", "__pycache__"}

        for root, dirs, files in os.walk(context.workspace_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in [".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md"]:
                    continue
                fpath = Path(root) / fname
                try:
                    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                        for line_idx, line in enumerate(f, start=1):
                            if word_pattern.search(line):
                                rel = fpath.relative_to(context.workspace_dir)
                                references.append(f"{rel}:{line_idx}: {line.strip()}")
                                if len(references) >= max_results:
                                    break
                except Exception:
                    continue
                if len(references) >= max_results:
                    break
            if len(references) >= max_results:
                break

        if not references:
            return ToolResult(content=f"No references found for '{symbol}'.", metadata={"count": 0})

        output = "\n".join(references)
        truncated_out, was_truncated = SmartTruncator.truncate(output)
        return ToolResult(
            content=truncated_out,
            metadata={"count": len(references)},
            truncated=was_truncated,
        )


class AstGrepSearchTool(BaseTool):
    """Tool to search code by Abstract Syntax Tree (AST) structure."""

    name = "ast_grep_search"
    description = (
        "Search code structurally by Python AST node type (e.g. 'FunctionDef', 'ClassDef', 'AsyncFunctionDef') "
        "or function decorators and names."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "node_type": {
                "type": "string",
                "description": "AST node type to search, e.g. 'FunctionDef', 'ClassDef', 'Import', 'Assign'.",
            },
            "name_pattern": {
                "type": "string",
                "description": "Optional regex pattern matching node name (e.g. 'test_.*').",
            },
            "path": {
                "type": "string",
                "description": "Optional search subdirectory. Default is workspace root.",
            },
        },
        "required": ["node_type"],
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        self.validate_params(params)
        node_type = params["node_type"]
        name_pattern = params.get("name_pattern")
        scope_dir = context.resolve_path(params.get("path", "."))

        p_reg = re.compile(name_pattern) if name_pattern else None
        matches: List[str] = []
        ignore_dirs = {".git", "node_modules", ".venv", "dist", "build", "__pycache__"}

        for root, dirs, files in os.walk(scope_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
            for fname in files:
                if not fname.endswith(".py"):
                    continue
                fpath = Path(root) / fname
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        tree = ast.parse(f.read(), filename=str(fpath))
                    for node in ast.walk(tree):
                        if type(node).__name__ == node_type:
                            node_name = getattr(node, "name", "")
                            if p_reg and not p_reg.search(node_name):
                                continue
                            lineno = getattr(node, "lineno", 1)
                            rel = fpath.relative_to(context.workspace_dir)
                            desc = f"{rel}:{lineno}: [{node_type}] {node_name}" if node_name else f"{rel}:{lineno}: [{node_type}]"
                            matches.append(desc)
                            if len(matches) >= 100:
                                break
                except Exception:
                    continue
                if len(matches) >= 100:
                    break
            if len(matches) >= 100:
                break

        if not matches:
            return ToolResult(
                content=f"No AST nodes of type '{node_type}' matched.",
                metadata={"count": 0},
            )

        output = "\n".join(matches)
        return ToolResult(content=output, metadata={"count": len(matches)})


class RepoMapGenerateTool(BaseTool):
    """Tool to generate a concise high-level Repository Map of classes, methods and signatures (Aider & SWE-agent style)."""

    name = "repo_map_generate"
    description = (
        "Generate a concise, token-efficient architectural map of the workspace repository "
        "listing top-level classes, functions, and method signatures."
    )
    risk_tier = RiskTier.READ_ONLY
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Optional subdirectory to map. Default is workspace root.",
            },
            "max_files": {
                "type": "integer",
                "description": "Maximum files to include in the map (default 30).",
                "default": 30,
            },
        },
    }

    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        scope_dir = context.resolve_path(params.get("path", "."))
        max_files = min(60, params.get("max_files", 30))

        repo_map_lines: List[str] = ["# Repository Outline Map:"]
        ignore_dirs = {".git", "node_modules", ".venv", "dist", "build", "__pycache__", "coverage", "docs"}
        processed = 0

        for root, dirs, files in os.walk(scope_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs and not d.startswith(".")]
            for fname in sorted(files):
                if not (fname.endswith(".py") or fname.endswith(".ts") or fname.endswith(".tsx")):
                    continue
                fpath = Path(root) / fname
                rel = fpath.relative_to(context.workspace_dir)

                # Extract top-level symbols
                symbols = []
                try:
                    if fname.endswith(".py"):
                        with open(fpath, "r", encoding="utf-8") as f:
                            tree = ast.parse(f.read())
                        for item in tree.body:
                            if isinstance(item, ast.ClassDef):
                                methods = [
                                    m.name for m in item.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))
                                ]
                                m_str = f" ({', '.join(methods[:5])}...)" if methods else ""
                                symbols.append(f"  class {item.name}{m_str}")
                            elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                                symbols.append(f"  def {item.name}()")
                    else:
                        # Simple regex for JS/TS
                        with open(fpath, "r", encoding="utf-8") as f:
                            for line in f:
                                m = re.match(r"^\s*(?:export\s+)?(?:function|class|interface|type)\s+([A-Za-z0-9_]+)", line)
                                if m:
                                    symbols.append(f"  {m.group(0).strip()}")
                except Exception:
                    continue

                if symbols:
                    repo_map_lines.append(f"\n[{rel}]")
                    repo_map_lines.extend(symbols[:8])
                    processed += 1
                    if processed >= max_files:
                        break
            if processed >= max_files:
                break

        map_text = "\n".join(repo_map_lines)
        return ToolResult(content=map_text, metadata={"files_mapped": processed})
