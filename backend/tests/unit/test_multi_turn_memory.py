"""Unit test for Multi-Turn Agent Conversation Memory (3 consecutive turns).

Verifies:
- Turn 1: User shares contextual facts (project name, tech stack).
- Turn 2: User asks a question relying solely on memory from Turn 1; Agent recalls correctly.
- Turn 3: User commands a tool action based on the accumulated memory; Agent executes file_write with the stored facts.
"""

import asyncio
import json
from pathlib import Path
import pytest

from agentbox.agent_core.engine import BoxFoxAgent, AgentRunResult
from agentbox.memory.simple_memory import SimpleSessionMemory
from agentbox.tools.base import ToolContext
from agentbox.tools.registry import default_registry


def test_agent_multi_turn_memory_accumulation_3_turns(tmp_path: Path):
    """Verify stateful session memory across 3 full conversation turns."""
    ctx = ToolContext(workspace_dir=tmp_path)
    memory = SimpleSessionMemory(is_stateless=False)
    agent = BoxFoxAgent(registry=default_registry, max_iterations=5)

    # ── Turn 1: Introduce Context ──────────────────────────────────────────
    turn1_prompt = "Hello! My project is called 'BoxFox Agent Box' and our backend is built in Python."
    
    def mock_llm_turn1(messages, tools):
        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Nice to meet you! I have noted that your project is 'BoxFox Agent Box' with a Python backend.",
                }
            }]
        }

    res1: AgentRunResult = asyncio.run(agent.run(
        user_goal=turn1_prompt,
        context=ctx,
        memory=memory,
        mock_llm_responder=mock_llm_turn1,
    ))

    assert res1.is_success
    assert "BoxFox Agent Box" in res1.final_answer

    # ── Turn 2: Memory Retrieval (No Repetition) ───────────────────────────
    turn2_prompt = "What is the name of my project, and what language is our backend in?"

    def mock_llm_turn2(messages, tools):
        # Inspect incoming message history to prove Turn 1 context was delivered!
        msg_contents = [str(m.get("content", "")) for m in messages]
        has_turn1_context = any("BoxFox Agent Box" in c for c in msg_contents)
        assert has_turn1_context, "Turn 2 LLM did NOT receive Turn 1 history in memory!"

        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Your project is 'BoxFox Agent Box' and your backend is built using Python.",
                }
            }]
        }

    res2: AgentRunResult = asyncio.run(agent.run(
        user_goal=turn2_prompt,
        context=ctx,
        memory=memory,
        mock_llm_responder=mock_llm_turn2,
    ))

    assert res2.is_success
    assert "BoxFox Agent Box" in res2.final_answer
    assert "Python" in res2.final_answer

    # ── Turn 3: Memory-Grounded Tool Action ────────────────────────────────
    turn3_prompt = "Please create 'project_info.txt' recording the project name and backend language."

    turn3_step = 0

    def mock_llm_turn3(messages, tools):
        nonlocal turn3_step
        turn3_step += 1

        if turn3_step == 1:
            # Step 1: LLM generates file_write tool call using facts remembered from Turn 1
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "I am saving your project details to 'project_info.txt'.",
                        "tool_calls": [{
                            "id": "call_write_info",
                            "type": "function",
                            "function": {
                                "name": "file_write",
                                "arguments": json.dumps({
                                    "path": "project_info.txt",
                                    "content": "Project: BoxFox Agent Box\nBackend: Python\nStatus: Verified\n",
                                    "overwrite": True,
                                }),
                            },
                        }],
                    }
                }]
            }
        else:
            # Step 2: Final response confirming execution
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "I have created 'project_info.txt' with your project information.",
                    }
                }]
            }

    res3: AgentRunResult = asyncio.run(agent.run(
        user_goal=turn3_prompt,
        context=ctx,
        memory=memory,
        mock_llm_responder=mock_llm_turn3,
    ))

    assert res3.is_success
    assert res3.total_tools_called() == 1

    # Verify physical file generated in workspace from remembered facts!
    info_file = tmp_path / "project_info.txt"
    assert info_file.exists()
    content = info_file.read_text(encoding="utf-8")
    assert "BoxFox Agent Box" in content
    assert "Backend: Python" in content
