"""Hermes and Claude Code Skills Registry for BoxFox Agent Box.

Ported from research_code/hermes-agent-main/skills with focus on autonomous software engineering:
- systematic-debugging
- test-driven-development
- simplify-code
- codebase-inspection
- requesting-code-review
- subagent-driven-development
- ast-grep
- grill-me
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class AgentSkill:
    """Represents a specialized engineering skill ported from Hermes / Claude Code."""
    id: str
    name: str
    category: str
    description: str
    instructions: str
    enabled_by_default: bool = True
    tags: List[str] = field(default_factory=list)


CORE_HERMES_SKILLS: List[AgentSkill] = [
    AgentSkill(
        id="systematic-debugging",
        name="Systematic Debugging",
        category="software-development",
        description="Scientific 5-step root cause analysis: Reproduce -> Isolate -> Hypothesize -> Fix surgically -> Regression check.",
        instructions=(
            "SYSTEMATIC DEBUGGING DISCIPLINE:\n"
            "1. Reproduce with Minimal Case: Write a minimal reproduction test or script before changing code.\n"
            "2. Isolate Component: Use logging, tracebacks or `terminal_exec` to locate exact failure point.\n"
            "3. Formulate Hypothesis: State clearly WHY the bug is happening before modifying any line.\n"
            "4. Surgical Fix: Change only what is broken. Do not refactor unrelated areas while fixing a bug.\n"
            "5. Verify Regression: Run the entire test suite to ensure the fix does not break other modules."
        ),
        enabled_by_default=True,
        tags=["debugging", "claude-code", "quality"],
    ),
    AgentSkill(
        id="test-driven-development",
        name="Test-Driven Development (TDD)",
        category="software-development",
        description="Strict Red-Green-Refactor development cycle ensuring robust test coverage.",
        instructions=(
            "TDD METHODOLOGY:\n"
            "1. Red: Write an automated test covering expected behavior and observe it fail first.\n"
            "2. Green: Implement the minimal code necessary to make the test pass cleanly.\n"
            "3. Refactor: Clean up design, remove duplication, and verify test suite remains green."
        ),
        enabled_by_default=True,
        tags=["testing", "tdd", "claude-code"],
    ),
    AgentSkill(
        id="simplify-code",
        name="Simplify Code",
        category="software-development",
        description="Aggressively simplify architecture, eliminate dead abstractions and unnecessary wrappers.",
        instructions=(
            "CODE SIMPLIFICATION MANDATE:\n"
            "- Favor explicit, flat code over deep inheritance trees and unnecessary helper indirection.\n"
            "- Remove unused variables, redundant parameters, and dead imports.\n"
            "- Keep functions focused on a single responsibility with self-documenting naming."
        ),
        enabled_by_default=True,
        tags=["refactoring", "clarity", "hermes"],
    ),
    AgentSkill(
        id="codebase-inspection",
        name="Codebase Inspection",
        category="software-development",
        description="Pre-execution reconnaissance: inspect project layout, config files, and coding conventions before making changes.",
        instructions=(
            "CODEBASE INSPECTION PRINCIPLE:\n"
            "- Never guess file paths, class names, or import styles.\n"
            "- Always run `codebase_grep` or `codebase_glob` to discover existing patterns.\n"
            "- Match project formatting style (tabs vs spaces, docstring conventions, typing)."
        ),
        enabled_by_default=True,
        tags=["reconnaissance", "grounding", "claude-code"],
    ),
    AgentSkill(
        id="requesting-code-review",
        name="Self-Critique & Code Review",
        category="software-development",
        description="Automated pre-completion review checking security boundaries, edge cases, and injection risks.",
        instructions=(
            "PRE-COMPLETION REVIEW CHECKLIST:\n"
            "- Have all modified files been verified by linters or tests?\n"
            "- Are there any path traversal, injection, or resource leak risks?\n"
            "- Did you remove all debug print statements and temporary artifacts?"
        ),
        enabled_by_default=True,
        tags=["review", "security", "claude-code"],
    ),
    AgentSkill(
        id="subagent-driven-development",
        name="Subagent-Driven Development",
        category="software-development",
        description="Deconstruct complex goals into discrete phases for specialized subagents (Explore, Build, Review, Test).",
        instructions=(
            "SUBAGENT ORCHESTRATION:\n"
            "- For large refactors, delegate exploration to an Explore subagent to map invariants.\n"
            "- Use Code & Build for surgical edits and Review & Verify for validation gates.\n"
            "- Synthesize results into a cohesive, verified pull request or patch."
        ),
        enabled_by_default=False,
        tags=["subagents", "multi-agent", "hermes"],
    ),
    AgentSkill(
        id="ast-grep",
        name="AST-Grep Structural Search",
        category="code-intelligence",
        description="Search code patterns based on syntax tree AST rather than fragile regex string matching.",
        instructions=(
            "AST PATTERN MATCHING:\n"
            "- Use AST search when looking for function definitions, class declarations, or decorator usages.\n"
            "- Preserves structure across formatting differences and multiline signatures."
        ),
        enabled_by_default=False,
        tags=["ast", "search", "code-intel"],
    ),
    AgentSkill(
        id="grill-me",
        name="Requirements Interview (Grill-Me)",
        category="productivity",
        description="Proactively ask clarifying questions when requirements are underspecified or architectural tradeoffs exist.",
        instructions=(
            "REQUIREMENTS CLARIFICATION:\n"
            "- When faced with high-impact ambiguity, state the tradeoff options clearly.\n"
            "- Recommend the optimal default choice while soliciting user confirmation."
        ),
        enabled_by_default=False,
        tags=["interview", "clarification", "hermes"],
    ),
]


class SkillsRegistry:
    """Registry maintaining active and available agent skills."""

    def __init__(self) -> None:
        self._skills: Dict[str, AgentSkill] = {s.id: s for s in CORE_HERMES_SKILLS}
        self._enabled_ids: set[str] = {s.id for s in CORE_HERMES_SKILLS if s.enabled_by_default}

    def list_all(self) -> List[AgentSkill]:
        return list(self._skills.values())

    def get(self, skill_id: str) -> Optional[AgentSkill]:
        return self._skills.get(skill_id)

    def is_enabled(self, skill_id: str) -> bool:
        return skill_id in self._enabled_ids

    def enable(self, skill_id: str) -> None:
        if skill_id in self._skills:
            self._enabled_ids.add(skill_id)

    def disable(self, skill_id: str) -> None:
        self._enabled_ids.discard(skill_id)

    def get_enabled_skills(self) -> List[AgentSkill]:
        return [self._skills[sid] for sid in self._enabled_ids if sid in self._skills]

    def render_skills_prompt(self, skill_ids: Optional[List[str]] = None) -> str:
        """Render markdown guidelines for active skills to inject into system prompt."""
        target_ids = set(skill_ids) if skill_ids is not None else self._enabled_ids
        active = [self._skills[sid] for sid in target_ids if sid in self._skills]
        if not active:
            return ""

        sections = []
        for skill in active:
            sections.append(f"### Skill: {skill.name} (`{skill.id}`)\n{skill.instructions}")
        return "\n\n".join(sections)


skills_registry = SkillsRegistry()
