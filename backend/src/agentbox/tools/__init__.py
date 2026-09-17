"""BoxFox Agent Box Tools Package.

Exports all tools and pre-registers them into the default registry.
"""

from __future__ import annotations

from .base import BaseTool, RiskTier, SmartTruncator, ToolContext, ToolResult
from .code_intelligence import (
    AstGrepSearchTool,
    LspDefinitionsTool,
    LspDiagnosticsTool,
    LspReferencesTool,
    RepoMapGenerateTool,
)
from .file_ops import (
    CodebaseGlobTool,
    CodebaseGrepTool,
    FileApplyPatchTool,
    FileEditBlockTool,
    FileReadTool,
    FileWriteTool,
)
from .registry import ToolRegistry, default_registry
from .terminal_ops import (
    ExecuteCodeTool,
    ProcessManageTool,
    ProcessSendInputTool,
    TerminalExecTool,
    TerminalOutputTruncateTool,
    TerminalSpawnBackgroundTool,
)

# Register Core 17 Tools into default_registry
ALL_CORE_TOOLS = [
    # Filesystem & Code Editing (6 tools)
    FileReadTool(),
    FileWriteTool(),
    FileEditBlockTool(),
    FileApplyPatchTool(),
    CodebaseGrepTool(),
    CodebaseGlobTool(),
    # Code Intelligence & AST LSP (5 tools)
    LspDiagnosticsTool(),
    LspDefinitionsTool(),
    LspReferencesTool(),
    AstGrepSearchTool(),
    RepoMapGenerateTool(),
    # Terminal & Ephemeral Execution (6 tools)
    TerminalExecTool(),
    TerminalSpawnBackgroundTool(),
    ProcessManageTool(),
    ProcessSendInputTool(),
    TerminalOutputTruncateTool(),
    ExecuteCodeTool(),
]

for tool_instance in ALL_CORE_TOOLS:
    default_registry.register(tool_instance)

__all__ = [
    "BaseTool",
    "RiskTier",
    "ToolResult",
    "ToolContext",
    "SmartTruncator",
    "ToolRegistry",
    "default_registry",
    # Filesystem & Code Editing
    "FileReadTool",
    "FileWriteTool",
    "FileEditBlockTool",
    "FileApplyPatchTool",
    "CodebaseGrepTool",
    "CodebaseGlobTool",
    # Code Intelligence & LSP
    "LspDiagnosticsTool",
    "LspDefinitionsTool",
    "LspReferencesTool",
    "AstGrepSearchTool",
    "RepoMapGenerateTool",
    # Terminal & Execution
    "TerminalExecTool",
    "TerminalSpawnBackgroundTool",
    "ProcessManageTool",
    "ProcessSendInputTool",
    "TerminalOutputTruncateTool",
    "ExecuteCodeTool",
]
