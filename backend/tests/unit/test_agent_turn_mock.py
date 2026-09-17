"""Unit tests for Agent Turn Executor (Deterministic Mock LLM - No external network needed)."""

import asyncio
import json
from pathlib import Path
import pytest

from agentbox.agent_core.agent_loop import AgentTurnExecutor
from agentbox.memory.simple_memory import SimpleSessionMemory
from agentbox.tools.base import ToolContext
from agentbox.tools.registry import default_registry


def test_agent_turn_direct_response_no_tools(tmp_path: Path):
    """Test 1-turn conversation where LLM responds directly without tool calls."""
    ctx = ToolContext(workspace_dir=tmp_path)
    executor = AgentTurnExecutor(registry=default_registry)

    def mock_llm(messages, tools):
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "Hello! I am ready to help you with your code.",
                    }
                }
            ]
        }

    turn_res = asyncio.run(executor.run_turn(
        user_prompt="Hi there!",
        context=ctx,
        mock_llm_responder=mock_llm,
    ))

    assert not turn_res.is_error
    assert "ready to help you" in turn_res.final_response
    assert len(turn_res.tool_calls_executed) == 0


def test_agent_turn_with_file_write_tool_execution(tmp_path: Path):
    """Test 1-turn loop where LLM generates tool_call -> Tool executes in workspace -> Final response."""
    ctx = ToolContext(workspace_dir=tmp_path)
    executor = AgentTurnExecutor(registry=default_registry)

    pass_counter = 0

    def mock_llm(messages, tools):
        nonlocal pass_counter
        pass_counter += 1

        if pass_counter == 1:
            # First pass: LLM decides to call file_write
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_write_123",
                                    "type": "function",
                                    "function": {
                                        "name": "file_write",
                                        "arguments": json.dumps({
                                            "path": "hello.py",
                                            "content": "print('Created by BoxFox Agent!')\n",
                                            "overwrite": True,
                                        }),
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        else:
            # Second pass: LLM receives tool result and provides final confirmation
            tool_msg = next((m for m in messages if m.get("role") == "tool"), None)
            assert tool_msg is not None
            assert "Successfully wrote" in tool_msg.get("content", "")

            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "I have created 'hello.py' with the requested code.",
                        }
                    }
                ]
            }

    memory = SimpleSessionMemory(is_stateless=True)
    turn_res = asyncio.run(executor.run_turn(
        user_prompt="Please create hello.py file",
        context=ctx,
        memory=memory,
        mock_llm_responder=mock_llm,
    ))

    assert not turn_res.is_error
    assert "I have created 'hello.py'" in turn_res.final_response
    assert len(turn_res.tool_calls_executed) == 1
    assert turn_res.tool_calls_executed[0]["function"]["name"] == "file_write"

    # Verify that the file was physically created in the test workspace!
    target_file = tmp_path / "hello.py"
    assert target_file.exists()
    assert "Created by BoxFox Agent!" in target_file.read_text(encoding="utf-8")


def test_agent_turn_stateless_vs_stateful_memory():
    """Verify stateless (1-turn) clears old turns while stateful keeps history."""
    stateless_mem = SimpleSessionMemory(is_stateless=True)
    stateless_mem.add_message("system", content="System Prompt")
    stateless_mem.add_message("user", content="Turn 1")
    stateless_mem.add_message("assistant", content="Answer 1")
    stateless_mem.add_message("user", content="Turn 2")
    stateless_mem.add_message("assistant", content="Answer 2")

    # In stateless mode, only the system and most recent turn are retained for context
    stateless_msgs = stateless_mem.get_messages()
    assert len(stateless_msgs) <= 4

    stateful_mem = SimpleSessionMemory(is_stateless=False)
    stateful_mem.add_message("system", content="System Prompt")
    stateful_mem.add_message("user", content="Turn 1")
    stateful_mem.add_message("assistant", content="Answer 1")
    stateful_mem.add_message("user", content="Turn 2")
    stateful_mem.add_message("assistant", content="Answer 2")

    stateful_msgs = stateful_mem.get_messages()
    assert len(stateful_msgs) == 5
