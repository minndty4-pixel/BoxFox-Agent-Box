"""Unit tests for Hermes-Inspired Autonomous Multi-Step Agent Engine in BoxFox."""

import asyncio
import json
from pathlib import Path
import pytest

from agentbox.agent_core.context import ContextManager, AgentContextState
from agentbox.agent_core.engine import BoxFoxAgent, AgentHooks, AgentRunResult
from agentbox.memory.simple_memory import SimpleSessionMemory
from agentbox.tools.base import ToolContext
from agentbox.tools.registry import default_registry


def test_context_manager_3_tier_assembly(tmp_path: Path):
    """Verify 3-Tier Context correctly merges Identity, Environment, and Task Goals."""
    ctx = ToolContext(workspace_dir=tmp_path)
    cm = ContextManager(registry=default_registry)

    # Set up some state
    cm.update_task_goal("Refactor auth system to use JWT tokens.")

    prompt = cm.assemble_full_system_prompt(ctx)

    # Check Tier 1
    assert "You are BoxFox Agent" in prompt
    assert "CORE OPERATIONAL PRINCIPLES" in prompt

    # Check Tier 2
    assert str(tmp_path) in prompt
    assert "WORKSPACE SNAPSHOT" in prompt

    # Check Tier 3
    assert "Refactor auth system to use JWT tokens." in prompt
    assert "CURRENT SESSION & CAPABILITIES" in prompt
    assert "Available Tool Suite" in prompt
    assert "file_read" in prompt
    assert "file_write" in prompt


def test_agent_autonomous_multistep_problem_solving(tmp_path: Path):
    """Verify autonomous multi-step reasoning: file_read -> file_write -> execute_code -> finish."""
    # Prepare an initial buggy file in workspace
    buggy_file = tmp_path / "math_helper.py"
    buggy_file.write_text("def add(a, b):\n    return a - b  # BUG!\n", encoding="utf-8")

    ctx = ToolContext(workspace_dir=tmp_path)
    agent = BoxFoxAgent(registry=default_registry, max_iterations=5)

    step_counter = 0
    hook_events = []

    hooks = AgentHooks(
        on_step_start=lambda step: hook_events.append(f"step_{step}"),
        on_tool_start=lambda name, args: hook_events.append(f"tool_start_{name}"),
        on_tool_end=lambda name, res: hook_events.append(f"tool_end_{name}"),
        on_finish=lambda ans: hook_events.append(f"finish_{len(ans) > 0}"),
    )

    def mock_llm(messages, tool_schemas):
        nonlocal step_counter
        step_counter += 1

        if step_counter == 1:
            # Step 1: Agent inspects math_helper.py
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "Let me first inspect the implementation of math_helper.py.",
                        "tool_calls": [{
                            "id": "call_read_1",
                            "type": "function",
                            "function": {
                                "name": "file_read",
                                "arguments": json.dumps({"path": "math_helper.py"}),
                            },
                        }],
                    }
                }]
            }
        elif step_counter == 2:
            # Step 2: Agent fixes the bug
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "I see the subtraction bug. I will rewrite the function to return a + b.",
                        "tool_calls": [{
                            "id": "call_write_1",
                            "type": "function",
                            "function": {
                                "name": "file_write",
                                "arguments": json.dumps({
                                    "path": "math_helper.py",
                                    "content": "def add(a, b):\n    return a + b\n",
                                    "overwrite": True,
                                }),
                            },
                        }],
                    }
                }]
            }
        elif step_counter == 3:
            # Step 3: Agent verifies the fix with python execution
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "Now executing verification code to verify add(2, 3) == 5.",
                        "tool_calls": [{
                            "id": "call_exec_1",
                            "type": "function",
                            "function": {
                                "name": "execute_code",
                                "arguments": json.dumps({
                                    "language": "python",
                                    "code": "from math_helper import add\nassert add(2, 3) == 5\nprint('VERIFIED_OK')",
                                }),
                            },
                        }],
                    }
                }]
            }
        else:
            # Step 4: Verification passed, agent finishes
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "The bug in math_helper.py has been resolved and verified. add(a, b) now returns a + b.",
                        "tool_calls": None,
                    }
                }]
            }

    run_res: AgentRunResult = asyncio.run(agent.run(
        user_goal="Fix the bug in math_helper.py and verify it.",
        context=ctx,
        hooks=hooks,
        mock_llm_responder=mock_llm,
    ))

    # Assertions on Agent Execution
    assert run_res.is_success is True
    assert run_res.iterations == 4
    assert run_res.total_tools_called() == 3
    assert "resolved and verified" in run_res.final_answer

    # Assert workspace file state was updated
    updated_code = buggy_file.read_text(encoding="utf-8")
    assert "return a + b" in updated_code

    # Assert hook events
    assert "step_1" in hook_events
    assert "tool_start_file_read" in hook_events
    assert "tool_end_file_read" in hook_events
    assert "tool_start_file_write" in hook_events
    assert "tool_end_file_write" in hook_events
    assert "tool_start_execute_code" in hook_events
    assert "tool_end_execute_code" in hook_events
    assert "finish_True" in hook_events


def test_agent_iteration_limit_budget(tmp_path: Path):
    """Verify agent safely halts when max_iterations is exceeded."""
    ctx = ToolContext(workspace_dir=tmp_path)
    agent = BoxFoxAgent(registry=default_registry, max_iterations=2)

    def infinite_loop_llm(messages, tool_schemas):
        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Still looping...",
                    "tool_calls": [{
                        "id": "loop_call",
                        "type": "function",
                        "function": {
                            "name": "file_read",
                            "arguments": json.dumps({"path": "nonexistent.txt"}),
                        },
                    }],
                }
            }]
        }

    run_res = asyncio.run(agent.run(
        user_goal="Never ending loop",
        context=ctx,
        mock_llm_responder=infinite_loop_llm,
    ))

    assert run_res.is_success is False
    assert run_res.error == "MAX_ITERATIONS_REACHED"
    assert run_res.iterations == 2
