import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock
from agentbox.agent_core.roles import ROLES, allowed_tools
from agentbox.agent_core.runtime import (
    IDENTITY,
    TOOL_USE_ENFORCEMENT_GUIDANCE,
    EXECUTION_DISCIPLINE_GUIDANCE,
    ACT_DONT_ASK_GUIDANCE,
    TASK_COMPLETION_GUIDANCE,
    PARALLEL_TOOL_CALL_GUIDANCE,
    ORCHESTRATOR_SOP_GUIDANCE,
    AntiLoopGuard,
    HarnessRuntime,
)
from agentbox.agent_core.context import ContextManager
from agentbox.tools.base import ToolContext
from pathlib import Path


def test_system_prompt_contains_all_hermes_guidance_blocks():
    """Verify that BoxFox brain integrates all 6 core Hermes cognitive guidance blocks."""
    assert "Tool-Use Enforcement" in IDENTITY
    assert "Execution Discipline & Mandatory Tool Use" in IDENTITY
    assert "Act Don't Ask" in IDENTITY
    assert "Finishing the Job & Grounded Verification" in IDENTITY
    assert "Parallel Tool Calls" in IDENTITY

    # Check that mandatory tool use lists key tools
    assert "terminal_exec" in EXECUTION_DISCIPLINE_GUIDANCE
    assert "file_read" in EXECUTION_DISCIPLINE_GUIDANCE
    assert "codebase_grep" in EXECUTION_DISCIPLINE_GUIDANCE


def test_specialist_roles_deep_prompts():
    """Verify that all 9 specialist subagents have deep, professional SOPs and role boundaries."""
    expected_roles = [
        'explore', 'plan', 'design', 'build', 'debug',
        'review', 'simplify', 'testing', 'research'
    ]
    for role_id in expected_roles:
        assert role_id in ROLES, f"Role {role_id} must be registered in ROLES"
        role = ROLES[role_id]
        instructions = role.instructions

        # Check depth: instructions must be substantial (at least 200 chars)
        assert len(instructions) > 200, f"Role {role_id} instruction too shallow ({len(instructions)} chars)"

        # Check role-specific constraints
        if role_id == 'explore':
            assert "READ-ONLY" in instructions
            assert "codebase_glob" in instructions
        elif role_id == 'plan':
            assert "Milestones" in instructions or "milestone" in instructions
            assert "Acceptance" in instructions
        elif role_id == 'build':
            assert "TODO" in instructions  # Cấm TODO
            assert "Surgical" in instructions or "surgical" in instructions
        elif role_id == 'debug':
            assert "Reproduce" in instructions or "reproduce" in instructions
            assert "Root Cause" in instructions or "root cause" in instructions
        elif role_id == 'review':
            assert "READ-ONLY" in instructions
            assert "[BLOCKER]" in instructions
        elif role_id == 'testing':
            assert "fabricate" in instructions.lower() or "never claim" in instructions.lower()
        elif role_id == 'research':
            assert "Fact vs Inference" in instructions or "fact" in instructions.lower()


def test_orchestrator_sop_guidance_multi_agent():
    """Verify that Orchestrator SOP enforces hierarchical 5-phase delegation."""
    assert "Supreme Orchestrator Brain of BoxFox" in ORCHESTRATOR_SOP_GUIDANCE
    assert "Phase 1 (Explore)" in ORCHESTRATOR_SOP_GUIDANCE
    assert "Phase 2 (Plan & Design)" in ORCHESTRATOR_SOP_GUIDANCE
    assert "Phase 3 (Build)" in ORCHESTRATOR_SOP_GUIDANCE
    assert "Phase 4 (Testing & Quality Assurance)" in ORCHESTRATOR_SOP_GUIDANCE
    assert "Phase 5 (Review & Simplification)" in ORCHESTRATOR_SOP_GUIDANCE
    assert "delegate_task" in ORCHESTRATOR_SOP_GUIDANCE


def test_the_orchestrator_guidance_matches_the_tools_it_really_holds():
    """SOP không được phủ nhận thứ `ORCHESTRATOR_TOOLS` vừa cấp.

    Vòng soát mã đợt 10 bắt được: `roles.py` cấp `web_search`/`web_fetch` cho vai gốc, còn
    SOP vẫn khẳng định "is the ONLY role with browser access, there is NO web-search tool",
    trong khi cùng một request cũng quảng cáo hai công cụ đó. Câu sai làm agent từ chối
    tra cứu rồi đoán. Bài này khoá hai vế lại với nhau.
    """
    from agentbox.agent_core.roles import ORCHESTRATOR_TOOLS
    assert {'web_search', 'web_fetch'} <= ORCHESTRATOR_TOOLS
    assert 'no web-search tool' not in ORCHESTRATOR_SOP_GUIDANCE.lower()
    assert 'web_search' in ORCHESTRATOR_SOP_GUIDANCE and 'web_fetch' in ORCHESTRATOR_SOP_GUIDANCE


def test_anti_loop_guard_repetition_recovery():
    """Verify that AntiLoopGuard flags repetitive errors after 3 consecutive failures."""
    guard = AntiLoopGuard(threshold=3)
    args = {"command": "invalid_command_xyz"}

    assert not guard.check_and_record("terminal_exec", args, is_error=True)
    assert not guard.check_and_record("terminal_exec", args, is_error=True)
    # 3rd identical error triggers loop detection
    assert guard.check_and_record("terminal_exec", args, is_error=True)

    # Different tool or args should reset the threshold
    assert not guard.check_and_record("terminal_exec", {"command": "ls"}, is_error=True)


def test_context_manager_prompt_alignment():
    """Verify that ContextManager produces 3-tier prompt aligned with cognitive guidance."""
    cm = ContextManager()
    tc = ToolContext(workspace_dir=Path("."), session_id="test_session")
    full_prompt = cm.assemble_full_system_prompt(tc)

    assert "Tool-Use Enforcement" in full_prompt
    assert "Execution Discipline" in full_prompt
    assert "ENVIRONMENT & WORKSPACE SNAPSHOT" in full_prompt
    assert "CURRENT SESSION & CAPABILITIES" in full_prompt


def test_runtime_create_session_injects_correct_specialist_prompt():
    """Verify that HarnessRuntime injects Orchestrator SOP for main session and Specialist SOP for subagents."""
    mock_store = MagicMock()
    mock_store.create.return_value = {"id": "sess_orch"}
    mock_store.get.return_value = {"id": "sess_orch", "messages": []}

    mock_executor = MagicMock()
    runtime = HarnessRuntime(store=mock_store, executor=mock_executor)

    # 1. Create Orchestrator Session
    orch_session = runtime.create({"skills": []}, role="orchestrator")
    save_args = mock_store.save.call_args[0]
    saved_messages = save_args[1]
    system_msg = saved_messages[0]["content"]

    assert "ASSIGNED ROLE: ORCHESTRATOR" in system_msg
    assert "Supreme Orchestrator Brain of BoxFox" in system_msg
    assert "Tool-Use Enforcement" in system_msg

    # 2. Create Specialist Child Session (e.g. Build)
    mock_store.create.return_value = {"id": "sess_build"}
    mock_store.get.return_value = {"id": "sess_build", "messages": []}
    runtime.create({"skills": []}, role="build", parent_id="sess_orch")
    save_args = mock_store.save.call_args[0]
    child_system_msg = save_args[1][0]["content"]

    assert "ASSIGNED ROLE: BUILD" in child_system_msg
    assert "Build Specialist in the BoxFox Multi-Agent system" in child_system_msg
    assert "Surgical" in child_system_msg
