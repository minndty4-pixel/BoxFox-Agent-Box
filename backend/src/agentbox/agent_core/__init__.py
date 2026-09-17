"""Agent Core Package for BoxFox Agent Box.

Exports Autonomous Agent Engine, Context Manager, and Turn Executors.
"""

from __future__ import annotations

from .agent_loop import AgentTurnExecutor, TurnResult
from .context import AgentContextState, ContextManager
from .engine import AgentHooks, AgentRunResult, AgentStepLog, BoxFoxAgent

__all__ = [
    "BoxFoxAgent",
    "AgentRunResult",
    "AgentStepLog",
    "AgentHooks",
    "ContextManager",
    "AgentContextState",
    "AgentTurnExecutor",
    "TurnResult",
]
