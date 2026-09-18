"""Unit tests for Hermes & Claude Code Skills Registry and Context Integration."""

from pathlib import Path
import pytest

from agentbox.agent_core.context import ContextManager, AgentContextState
from agentbox.skills.registry import skills_registry, CORE_HERMES_SKILLS
from agentbox.tools.base import ToolContext


def test_skills_registry_core_definitions():
    """Verify all ported Hermes & Claude Code skills are available."""
    all_skills = skills_registry.list_all()
    assert len(all_skills) >= 8

    skill_ids = [s.id for s in all_skills]
    assert "systematic-debugging" in skill_ids
    assert "test-driven-development" in skill_ids
    assert "simplify-code" in skill_ids
    assert "codebase-inspection" in skill_ids
    assert "requesting-code-review" in skill_ids
    assert "subagent-driven-development" in skill_ids
    assert "ast-grep" in skill_ids
    assert "grill-me" in skill_ids


def test_skills_prompt_rendering():
    """Verify rendering skills prompt formats markdown instructions cleanly."""
    rendered = skills_registry.render_skills_prompt(["systematic-debugging", "simplify-code"])
    assert "Systematic Debugging" in rendered
    assert "Simplify Code" in rendered
    assert "SYSTEMATIC DEBUGGING DISCIPLINE" in rendered


def test_context_manager_incorporates_active_skills(tmp_path: Path):
    """Verify ContextManager includes active skills in Tier 3 prompt."""
    ctx = ToolContext(workspace_dir=tmp_path)
    state = AgentContextState(
        workspace_dir=tmp_path,
        active_skills=["test-driven-development", "requesting-code-review"],
    )
    cm = ContextManager(state=state)

    full_prompt = cm.assemble_full_system_prompt(ctx)
    assert "ACTIVE SKILLS:" in full_prompt
    assert "Test-Driven Development (TDD)" in full_prompt
    assert "Self-Critique & Code Review" in full_prompt
