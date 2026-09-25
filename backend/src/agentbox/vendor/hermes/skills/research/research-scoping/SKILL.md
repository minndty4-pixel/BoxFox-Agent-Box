---
name: research-scoping
description: Turn a decision into answerable research questions.
---
# Research Scoping Skill

Frame the choice before opening sources. The output and evidence methods follow the user's decision, including mixed paper, code, product and fieldwork questions.

## When to Use

Use before a consequential research or planning job and again when evidence changes the original framing.

## Prerequisites

Read the user's request, supplied documents and the current `research_status` if the job already exists.

## How to Run

1. Name the decision, audience, scope, geography and time horizon. Record what the user already decided.
2. List hypotheses as possibilities, never as facts. For each, write a question whose answer could change the decision.
3. Give each question `importance` and a concrete `doneWhen`: which evidence, coverage or comparison would be enough.
4. Choose methods by question. A market question about diffusion may need papers and repos; a hospital workflow question may need documents, users and official rules.
5. Estimate `budgetSeconds` from uncertainty and source difficulty. Reserve time for verification, critique and synthesis. Tell the user the estimate and that it can be changed.
6. Call `research_brief` with `goal`, `questions`, `methods`, `output` and budget. Use `research_update` as answers or blockers arrive.

## Quick Reference

Each branch task states question ID, scope, candidate sources, evidence to return, stop condition and time allowance. Split by decision-critical question, not website type.

## Procedure

Ask the user only when two plausible interpretations lead to materially different work. Otherwise state the chosen interpretation and proceed. Mark high-impact unknowns as such. Keep the original question visible if the search discovers a more useful subordinate question.

## Pitfalls

Do not let a fixed profile dictate every source or require one agent per channel. Do not call an entire field “covered” because a few convenient results appeared. Do not promise a perfect answer; use an explicit sufficiency test.

## Verification

Every important question should say what decision it affects, what would count as an answer, and what happens if it remains unknown.
