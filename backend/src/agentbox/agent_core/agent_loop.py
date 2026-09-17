"""Agent Turn Loop for BoxFox Agent Box.

Handles 1-turn reasoning loops, tool dispatching, execution in sandbox/workspace,
and formatting results for the Model Router.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import urllib.request
import urllib.error

from ..memory.simple_memory import SimpleSessionMemory
from ..tools.base import ToolContext, ToolResult
from ..tools.registry import ToolRegistry, default_registry


@dataclass
class TurnResult:
    """Outcome of an agent interaction turn."""
    final_response: str
    tool_calls_executed: List[Dict[str, Any]] = field(default_factory=list)
    tool_results: List[ToolResult] = field(default_factory=list)
    is_error: bool = False
    error: Optional[str] = None


class AgentTurnExecutor:
    """Executes a 1-turn or multi-turn agent interaction loop."""

    def __init__(
        self,
        registry: ToolRegistry = default_registry,
        router_url: str = "http://localhost:3101",
        system_prompt: str = (
            "You are BoxFox Agent, an expert autonomous software engineer. "
            "You have access to tools to read/write files, execute commands, and inspect code. "
            "Always inspect files before modifying them, and explain what you did concisely."
        ),
    ) -> None:
        self.registry = registry
        self.router_url = router_url.rstrip("/")
        self.system_prompt = system_prompt

    async def run_turn(
        self,
        user_prompt: str,
        context: ToolContext,
        memory: Optional[SimpleSessionMemory] = None,
        model: str = "openrouter/free",
        mock_llm_responder: Optional[Callable[[List[Dict[str, Any]], List[Dict[str, Any]]], Dict[str, Any]]] = None,
    ) -> TurnResult:
        """Run an interaction turn: User prompt -> LLM -> Tool Execution -> Final Response."""
        if memory is None:
            # Default to 1-turn stateless (no memory)
            memory = SimpleSessionMemory(is_stateless=True)

        if not any(m.role == "system" for m in memory.messages):
            memory.add_message("system", content=self.system_prompt)

        memory.add_message("user", content=user_prompt)

        # 1. Fetch available tool schemas
        tool_schemas = self.registry.get_schemas()

        # 2. Call LLM (First pass)
        try:
            llm_response = await self._call_llm(
                messages=memory.get_messages(),
                tool_schemas=tool_schemas,
                model=model,
                mock_responder=mock_llm_responder,
            )
        except Exception as e:
            return TurnResult(
                final_response="",
                is_error=True,
                error=f"LLM call failed: {e}",
            )

        message = llm_response.get("choices", [{}])[0].get("message", {})
        content = message.get("content") or ""
        tool_calls = message.get("tool_calls") or []

        memory.add_message(
            role="assistant",
            content=content if content else None,
            tool_calls=tool_calls if tool_calls else None,
        )

        executed_calls: List[Dict[str, Any]] = []
        executed_results: List[ToolResult] = []

        # 3. If LLM requested tool execution
        if tool_calls:
            for call in tool_calls:
                call_id = call.get("id", "call_default")
                fn = call.get("function", {})
                tool_name = fn.get("name")
                raw_args = fn.get("arguments", "{}")

                try:
                    params = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    params = {}

                tool_inst = self.registry.get(tool_name)
                if not tool_inst:
                    t_res = ToolResult(
                        content="",
                        error=f"Tool '{tool_name}' not found in registry.",
                        is_error=True,
                    )
                else:
                    try:
                        t_res = await tool_inst.execute(params, context)
                    except Exception as exc:
                        t_res = ToolResult(content="", error=f"Tool crashed: {exc}", is_error=True)

                executed_calls.append(call)
                executed_results.append(t_res)

                # Add tool result to conversation history
                memory.add_message(
                    role="tool",
                    content=t_res.to_llm_output(),
                    tool_call_id=call_id,
                    name=tool_name,
                )

            # 4. Call LLM (Second pass: generate final answer incorporating tool results)
            try:
                final_llm_response = await self._call_llm(
                    messages=memory.get_messages(),
                    tool_schemas=tool_schemas,
                    model=model,
                    mock_responder=mock_llm_responder,
                )
                final_msg = final_llm_response.get("choices", [{}])[0].get("message", {})
                final_text = final_msg.get("content") or ""
                memory.add_message("assistant", content=final_text)
            except Exception as e:
                final_text = f"Tools executed successfully, but final summary generation failed: {e}"

            return TurnResult(
                final_response=final_text,
                tool_calls_executed=executed_calls,
                tool_results=executed_results,
            )

        # No tool calls needed; return direct response
        return TurnResult(
            final_response=content,
            tool_calls_executed=[],
            tool_results=[],
        )

    async def _call_llm(
        self,
        messages: List[Dict[str, Any]],
        tool_schemas: List[Dict[str, Any]],
        model: str,
        mock_responder: Optional[Callable[[List[Dict[str, Any]], List[Dict[str, Any]]], Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Dispatch LLM request to mock responder or BoxFox Router."""
        if mock_responder:
            return mock_responder(messages, tool_schemas)

        # Call BoxFox Router via HTTP POST
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

        with urllib.request.urlopen(req, timeout=45) as resp:
            resp_data = resp.read()
            return json.loads(resp_data.decode("utf-8"))
