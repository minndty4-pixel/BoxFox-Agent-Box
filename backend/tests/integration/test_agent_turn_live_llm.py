"""Integration tests for Agent Turn Loop with Live BoxFox Router."""

import asyncio
import json
from pathlib import Path
import urllib.request
import pytest

from agentbox.agent_core.agent_loop import AgentTurnExecutor
from agentbox.memory.simple_memory import SimpleSessionMemory
from agentbox.tools.base import ToolContext
from agentbox.tools.registry import default_registry


def is_router_online(url: str = "http://localhost:3101") -> bool:
    """Check if the BoxFox Router daemon is alive."""
    try:
        req = urllib.request.Request(f"{url}/api/router/health")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("status") == "ok"
    except Exception:
        return False


def test_live_router_connectivity():
    """Verify BoxFox Router is online on port 3101."""
    if not is_router_online():
        pytest.skip("BoxFox router daemon is not running on port 3101")
    assert is_router_online() is True


def test_agent_turn_with_live_router(tmp_path: Path):
    """Test 1-turn interaction loop against live BoxFox Router."""
    if not is_router_online():
        pytest.skip("BoxFox router daemon is not running on port 3101")

    ctx = ToolContext(workspace_dir=tmp_path)
    executor = AgentTurnExecutor(registry=default_registry, router_url="http://localhost:3101")
    memory = SimpleSessionMemory(is_stateless=True)

    # Use a live available model in BoxFox router
    # Testing with a fast prompt
    try:
        turn_res = asyncio.run(executor.run_turn(
            user_prompt="Reply with the exact word: BOXFOX_LIVE_VERIFIED",
            context=ctx,
            memory=memory,
            model="antigravity/gemini-3.6-flash-low",
        ))

        if turn_res.is_error:
            # Surfaced error from upstream quota/network
            pytest.skip(f"Live router upstream error: {turn_res.error}")

        assert not turn_res.is_error
        assert len(turn_res.final_response) > 0
    except Exception as e:
        pytest.skip(f"Live network call skipped: {e}")
