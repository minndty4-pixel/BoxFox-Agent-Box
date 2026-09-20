"""Hermes-Inspired 3-Tier Context Manager & Prompt Builder for BoxFox Agent Box.

Assembles the system prompt across three distinct caching tiers:
- Tier 1 (Stable): Identity, core operating guidance, safety rules (never changes).
- Tier 2 (Context): Workspace snapshot, environment capabilities, sandbox boundaries.
- Tier 3 (Volatile): Active task objective, available tools summary, memory rules.
"""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..tools.base import ToolContext
from ..tools.registry import ToolRegistry, default_registry

STABLE_IDENTITY_PROMPT = """You are BoxFox Agent, an elite autonomous multi-agent software engineering and computer-use system.
You operate inside a secure, dedicated Docker sandbox governed by Information Flow Control (IFC) labels and capability leases.
You embody ruthless technical precision: match the depth of your reply to the weight of the ask. Plain claims over adjectives; no filler, no sycophancy.

CORE OPERATIONAL PRINCIPLES:

# Tool-Use Enforcement
You MUST use your available tools or delegate to specialist subagents to make tangible progress — NEVER simply describe what you would do or promise future actions without executing them now.
Every response should either (a) contain tool calls or delegation calls that advance the task, or (b) deliver the final verified outcome to the user.

# Execution Discipline & Appropriate Tool Selection
- Conversational greetings, conceptual explanations (e.g. what is recursion), and simple mental math (e.g. 1 + 1) MUST be answered directly and concisely WITHOUT invoking tools.
- NEVER guess or hallucinate environment or codebase facts — invoke tools when tangible investigation or execution is required:
  - Complex computations, hashes, benchmarks -> terminal_exec or execute_code
  - System state: OS, memory, processes, ports, git status/diffs -> terminal_exec
  - File contents, line counts, directory trees -> file_read, codebase_grep, codebase_glob
  - Code definitions, diagnostics, syntax trees -> LSP & AST tools
  - System GUI & Browser interaction -> computer_use, browser_use
  - External facts, docs, versions, the current state of the world -> web_search, web_fetch (host-side; the sandbox itself has no Internet)
Always verify return codes. Never assume an operation succeeded without inspecting its output.

# Act Don't Ask
When a request has an obvious default interpretation or can be resolved by exploring the workspace/sandbox, act immediately using tools instead of asking the user for clarification. Only ask when genuine ambiguity prevents choosing an action.

# Finishing the Job & Grounded Verification
The deliverable for any engineering task is a working, tested artifact backed by real tool output — not an unexecuted plan or code stub with '// TODO'.
Keep working until code is actually written, real tests are executed, and output confirms correctness.
NEVER substitute fabricated test results or made-up output for missing tool executions. Report blockers honestly.

# Parallel Tool Calls
When you need several independent pieces of information (e.g. reading multiple files, searching multiple patterns), issue them together in a single assistant turn. Batching independent calls saves conversation context and reduces round trips.
"""

CODING_STANDARDS_BRIEF = """CODING STANDARDS & MULTI-AGENT PROTOCOL:
- Maintain syntax integrity. Match the existing indentation (tabs vs spaces) and naming conventions of the repository.
- Do not introduce placeholder comments like "// TODO: implement this". Produce complete, working code.
- Always check return codes of terminal commands. If a command fails, diagnose the error before retrying.
- For complex tasks, respect the 5-phase specialist workflow: Explore -> Plan & Design -> Build -> Testing & QA -> Review.
"""


@dataclass
class AgentContextState:
    """Holds the 3-tier context components for a session."""
    workspace_dir: Path
    task_goal: str = ""
    active_epoch: int = 1
    session_id: str = "default"
    custom_system_message: Optional[str] = None
    env_vars: Dict[str, str] = field(default_factory=dict)
    network_enabled: bool = True
    active_skills: List[str] = field(default_factory=list)


class ContextManager:
    """Builds and maintains the 3-tier prompt for BoxFox Agent."""

    def __init__(
        self,
        registry: ToolRegistry = default_registry,
        state: Optional[AgentContextState] = None,
    ) -> None:
        self.registry = registry
        self.state = state or AgentContextState(workspace_dir=Path("."))

    def update_task_goal(self, goal: str) -> None:
        """Update the active task goal in volatile state."""
        self.state.task_goal = goal

    def build_stable_tier(self) -> str:
        """Tier 1: Stable identity and immutable core guidance (optimal for LLM prompt caching)."""
        return f"{STABLE_IDENTITY_PROMPT}\n{CODING_STANDARDS_BRIEF}".strip()

    def build_environment_tier(self, tool_context: ToolContext) -> str:
        """Tier 2: Environment capabilities, workspace snapshot, and sandbox boundaries."""
        os_info = f"{platform.system()} {platform.release()} ({platform.machine()})"
        ws_path = str(tool_context.workspace_dir.resolve())
        net_mode = "ONLINE (External Egress Allowed)" if self.state.network_enabled else "AIR-GAPPED (No Internet)"

        # Inspect quick top-level files
        try:
            top_files = [
                f.name for f in tool_context.workspace_dir.iterdir()
                if not f.name.startswith(".") and f.name not in ["node_modules", "__pycache__", "venv"]
            ][:15]
            files_preview = ", ".join(top_files) if top_files else "(empty workspace)"
        except Exception:
            files_preview = "(workspace scan unavailable)"

        return (
            f"=== ENVIRONMENT & WORKSPACE SNAPSHOT ===\n"
            f"Operating System: {os_info}\n"
            f"Workspace Directory: {ws_path}\n"
            f"Network Mode: {net_mode}\n"
            f"Current Workspace Files: {files_preview}\n"
            f"Session ID: {tool_context.session_id} | Epoch: {tool_context.task_epoch}\n"
        )

    def build_volatile_tier(self) -> str:
        """Tier 3: Active goal, tools inventory, and dynamic guidance."""
        tool_names = self.registry.list_names()
        tools_summary = ", ".join(tool_names) if tool_names else "none"

        goal_line = f"Active Goal: {self.state.task_goal}\n" if self.state.task_goal else ""
        custom_line = f"User Instructions: {self.state.custom_system_message}\n" if self.state.custom_system_message else ""

        skills_block = ""
        if self.state.active_skills:
            from ..skills.registry import skills_registry
            rendered = skills_registry.render_skills_prompt(self.state.active_skills)
            if rendered:
                skills_block = f"\nACTIVE SKILLS:\n{rendered}\n"

        return (
            f"=== CURRENT SESSION & CAPABILITIES ===\n"
            f"{goal_line}"
            f"{custom_line}"
            f"Available Tool Suite ({len(tool_names)} registered): {tools_summary}\n"
            f"{skills_block}"
        )

    def assemble_full_system_prompt(self, tool_context: ToolContext) -> str:
        """Join the 3 tiers with double newlines, matching Hermes prompt-caching layout."""
        tier1 = self.build_stable_tier()
        tier2 = self.build_environment_tier(tool_context)
        tier3 = self.build_volatile_tier()
        return f"{tier1}\n\n{tier2}\n\n{tier3}"
