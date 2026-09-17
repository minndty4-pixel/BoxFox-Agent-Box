"""Hermes-Inspired Autonomous Multi-Step Agent Engine for BoxFox Agent Box.

Builds a pure, vanilla Python asynchronous agent loop (without heavyweight frameworks)
supporting multi-step tool reasoning, event callbacks, 3-tier prompt assembly,
and iterative problem solving.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .context import ContextManager
from ..memory.simple_memory import SimpleSessionMemory
from ..tools.base import ToolContext, ToolResult
from ..tools.registry import ToolRegistry, default_registry

logger = logging.getLogger(__name__)


@dataclass
class AgentStepLog:
    """Detailed log of a single agent reasoning turn / step."""
    iteration: int
    thought: Optional[str] = None
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    tool_results: List[ToolResult] = field(default_factory=list)


@dataclass
class AgentRunResult:
    """Outcome of an entire autonomous agent run."""
    final_answer: str
    is_success: bool
    iterations: int
    steps: List[AgentStepLog] = field(default_factory=list)
    error: Optional[str] = None

    def total_tools_called(self) -> int:
        return sum(len(s.tool_calls) for s in self.steps)


class AgentHooks:
    """Event hooks for observing agent execution in real-time (useful for UI and tests)."""

    def __init__(
        self,
        on_step_start: Optional[Callable[[int], None]] = None,
        on_thought: Optional[Callable[[str], None]] = None,
        on_tool_start: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        on_tool_end: Optional[Callable[[str, ToolResult], None]] = None,
        on_finish: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.on_step_start = on_step_start
        self.on_thought = on_thought
        self.on_tool_start = on_tool_start
        self.on_tool_end = on_tool_end
        self.on_finish = on_finish


class BoxFoxAgent:
    """Autonomous Software Engineering Agent running a pure Python async conversation loop."""

    def __init__(
        self,
        registry: ToolRegistry = default_registry,
        router_url: str = "http://localhost:3101",
        default_model: str = "openrouter/free",
        max_iterations: int = 10,
        context_manager: Optional[ContextManager] = None,
    ) -> None:
        self.registry = registry
        self.router_url = router_url.rstrip("/")
        self.default_model = default_model
        self.max_iterations = max_iterations
        self.context_manager = context_manager or ContextManager(registry=self.registry)

    async def run(
        self,
        user_goal: str,
        context: ToolContext,
        memory: Optional[SimpleSessionMemory] = None,
        model: Optional[str] = None,
        hooks: Optional[AgentHooks] = None,
        mock_llm_responder: Optional[Callable[[List[Dict[str, Any]], List[Dict[str, Any]]], Dict[str, Any]]] = None,
    ) -> AgentRunResult:
        """Run the autonomous multi-step reasoning loop until goal completion or budget exhaustion."""
        target_model = model or self.default_model
        active_memory = memory or SimpleSessionMemory(is_stateless=False)
        hooks = hooks or AgentHooks()

        # Update context state with user goal
        self.context_manager.state.task_goal = user_goal
        self.context_manager.state.workspace_dir = context.workspace_dir

        # Assemble 3-tier system prompt
        system_prompt = self.context_manager.assemble_full_system_prompt(context)
        if not any(m.role == "system" for m in active_memory.messages):
            active_memory.add_message("system", content=system_prompt)

        active_memory.add_message("user", content=user_goal)

        steps: List[AgentStepLog] = []
        iteration = 0
        final_text = ""

        # Hermes Core Loop: Iterate while model generates tool calls
        while iteration < self.max_iterations:
            iteration += 1
            if hooks.on_step_start:
                hooks.on_step_start(iteration)

            step_log = AgentStepLog(iteration=iteration)
            tool_schemas = self.registry.get_schemas()

            # 1. Call LLM
            try:
                llm_response = await self._call_llm_api(
                    messages=active_memory.get_messages(),
                    tool_schemas=tool_schemas,
                    model=target_model,
                    mock_responder=mock_llm_responder,
                )
            except Exception as exc:
                return AgentRunResult(
                    final_answer="",
                    is_success=False,
                    iterations=iteration,
                    steps=steps,
                    error=f"LLM API Error at iteration {iteration}: {exc}",
                )

            message = llm_response.get("choices", [{}])[0].get("message", {})
            content = message.get("content") or ""
            tool_calls = message.get("tool_calls") or []

            step_log.thought = content
            if content and hooks.on_thought:
                hooks.on_thought(content)

            active_memory.add_message(
                role="assistant",
                content=content if content else None,
                tool_calls=tool_calls if tool_calls else None,
            )

            # If no tool calls, the model has reached its final conclusion
            if not tool_calls:
                final_text = content
                steps.append(step_log)
                if hooks.on_finish:
                    hooks.on_finish(final_text)
                return AgentRunResult(
                    final_answer=final_text,
                    is_success=True,
                    iterations=iteration,
                    steps=steps,
                )

            # 2. Dispatch and execute requested tool calls
            for call in tool_calls:
                call_id = call.get("id", f"call_{iteration}_{len(step_log.tool_calls)}")
                fn = call.get("function", {})
                tool_name = fn.get("name", "unknown")
                raw_args = fn.get("arguments", "{}")

                try:
                    params = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    params = {}

                step_log.tool_calls.append(call)
                if hooks.on_tool_start:
                    hooks.on_tool_start(tool_name, params)

                # Locate tool in registry
                tool_inst = self.registry.get(tool_name)
                if not tool_inst:
                    result = ToolResult(
                        content="",
                        error=f"Tool '{tool_name}' is not registered in BoxFox tool suite.",
                        is_error=True,
                    )
                else:
                    try:
                        result = await tool_inst.execute(params, context)
                    except Exception as e:
                        result = ToolResult(content="", error=f"Tool execution exception: {e}", is_error=True)

                step_log.tool_results.append(result)
                if hooks.on_tool_end:
                    hooks.on_tool_end(tool_name, result)

                # Append tool output to active memory
                active_memory.add_message(
                    role="tool",
                    content=result.to_llm_output(),
                    tool_call_id=call_id,
                    name=tool_name,
                )

            steps.append(step_log)

        # Reached iteration limit
        return AgentRunResult(
            final_answer="Iteration budget reached before task was marked complete.",
            is_success=False,
            iterations=iteration,
            steps=steps,
            error="MAX_ITERATIONS_REACHED",
        )

    async def _call_llm_api(
        self,
        messages: List[Dict[str, Any]],
        tool_schemas: List[Dict[str, Any]],
        model: str,
        mock_responder: Optional[Callable[[List[Dict[str, Any]], List[Dict[str, Any]]], Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Dispatch LLM request to mock responder or BoxFox Router."""
        if mock_responder:
            return mock_responder(messages, tool_schemas)

        payload = {
            "model": model,
            "messages": messages,
            "tools": tool_schemas,
            "stream": False,
        }
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.router_url}/v1/chat/completions",
            data=data_bytes,
            headers={
                "Content-Type": "application/json",
                "x-boxfox-admin": "1",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            resp_data = resp.read()
            return json.loads(resp_data.decode("utf-8"))
