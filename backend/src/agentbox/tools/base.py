"""Base Framework for BoxFox Agent Box Tools.

Provides the foundational classes for tool definition, execution results,
context isolation, and smart output truncation.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


class RiskTier(str, Enum):
    """Risk tier classification for BoxFox tools, used by L4 Security Gateway."""
    READ_ONLY = "read_only"             # An toàn: Đọc file, grep, status, outline
    WORKSPACE_WRITE = "workspace_write" # Trung bình: Ghi/sửa file trong workspace
    SYSTEM_EXEC = "system_exec"         # Cao: Chạy lệnh shell, mở cổng port
    DANGEROUS = "dangerous"             # Rất cao: Xóa file, cấu hình mạng, hạ snapshot


@dataclass
class ToolResult:
    """Result returned by a BoxFox tool execution."""
    content: str
    error: Optional[str] = None
    is_error: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)
    truncated: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "content": self.content,
            "error": self.error,
            "is_error": self.is_error,
            "metadata": self.metadata,
            "truncated": self.truncated,
        }

    def to_llm_output(self) -> str:
        """Format the output string destined for LLM context."""
        if self.is_error:
            err_msg = self.error or "Unknown error"
            return f"Error: {err_msg}\nDetails:\n{self.content}" if self.content else f"Error: {err_msg}"
        return self.content


@dataclass
class ToolContext:
    """Execution context provided to a tool."""
    workspace_dir: Path
    session_id: str = "default_session"
    task_epoch: int = 1
    lease_id: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    container_id: Optional[str] = None

    def resolve_path(self, relative_or_absolute: str) -> Path:
        """Resolve a path safely within the workspace to prevent Path Traversal."""
        clean_path = relative_or_absolute.strip().strip("'\"")
        p = Path(clean_path)
        if p.is_absolute():
            resolved = p.resolve()
        else:
            resolved = (self.workspace_dir / p).resolve()

        # Path Traversal Guard: Resolved path must reside within workspace_dir
        ws_resolved = self.workspace_dir.resolve()
        try:
            resolved.relative_to(ws_resolved)
        except ValueError:
            raise PermissionError(
                f"Path Traversal Denied: '{relative_or_absolute}' resolves outside workspace '{ws_resolved}'"
            )
        return resolved


class SmartTruncator:
    """Truncates large outputs while preserving the head and tail (error stack traces)."""

    DEFAULT_MAX_LINES = 150
    DEFAULT_MAX_CHARS = 30_000

    @classmethod
    def truncate(
        cls,
        text: str,
        max_lines: int = DEFAULT_MAX_LINES,
        max_chars: int = DEFAULT_MAX_CHARS,
    ) -> tuple[str, bool]:
        """Truncate text if it exceeds limits. Returns (truncated_text, was_truncated)."""
        if not text:
            return "", False

        lines = text.splitlines(keepends=True)
        total_lines = len(lines)
        total_chars = len(text)

        if total_lines <= max_lines and total_chars <= max_chars:
            return text, False

        # Head and tail line allocation (60% head, 40% tail)
        head_lines_count = int(max_lines * 0.6)
        tail_lines_count = max_lines - head_lines_count

        head = "".join(lines[:head_lines_count])
        tail = "".join(lines[-tail_lines_count:]) if tail_lines_count > 0 else ""

        dropped_lines = total_lines - (head_lines_count + tail_lines_count)
        marker = (
            f"\n... [Smart Truncate: {dropped_lines} lines ({total_chars - len(head) - len(tail)} chars) omitted] ...\n"
        )

        truncated_text = head + marker + tail
        if len(truncated_text) > max_chars:
            # Further truncate characters if lines were unusually wide
            head_chars = int(max_chars * 0.6)
            tail_chars = max_chars - head_chars
            truncated_text = (
                text[:head_chars]
                + f"\n... [Truncated {total_chars - max_chars} characters] ...\n"
                + text[-tail_chars:]
            )

        return truncated_text, True


class BaseTool(ABC):
    """Abstract Base Class for all BoxFox Agent Tools."""

    name: str
    description: str
    risk_tier: RiskTier = RiskTier.READ_ONLY
    parameters: Dict[str, Any]

    def __init__(self) -> None:
        if not hasattr(self, "name") or not self.name:
            raise ValueError(f"Tool {self.__class__.__name__} must define a unique 'name'.")
        if not hasattr(self, "description") or not self.description:
            raise ValueError(f"Tool {self.name} must define a 'description'.")
        if not hasattr(self, "parameters"):
            self.parameters = {
                "type": "object",
                "properties": {},
                "required": [],
            }

    @abstractmethod
    async def execute(self, params: Dict[str, Any], context: ToolContext) -> ToolResult:
        """Execute the tool with given parameters and context."""
        pass

    def to_schema(self) -> Dict[str, Any]:
        """Convert to OpenAI / Anthropic standard function call schema."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def validate_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Basic validation for required parameters."""
        required = self.parameters.get("required", [])
        missing = [param for param in required if param not in params]
        if missing:
            raise ValueError(f"Tool '{self.name}' missing required parameters: {', '.join(missing)}")
        return params
