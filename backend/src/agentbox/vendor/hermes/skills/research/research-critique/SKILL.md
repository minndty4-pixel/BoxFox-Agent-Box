---
name: research-critique
description: Challenge evidence, inference and missing options.
---
# Research Critique Skill

Challenge a saved dossier independently. Point to the conclusion affected by each flaw and the work needed to resolve it.

## When to Use

Use before publishing a consequential recommendation or a plan derived from research.

## Prerequisites

Receive the exact `reviewTarget` with research ID, version, path, content hash and mode. Read the saved dossier in full with `file_read`.

## How to Run

1. In `evidence` mode, inspect the decisive rows from `source_list`, reopen sources with `source_verify`, and test claim relations with `claim_assess`.
2. In `critique` mode, search independently for counterexamples, omitted alternatives, criteria changed mid-comparison, and conclusions broader than the evidence.
3. Check whether missing or blocked sources could reverse the recommendation. A lack of counterevidence is not evidence of support.
4. Give each finding severity, exact affected claim or section, impact on the choice, and a concrete closing condition.
5. Return `VERDICT: revise` when an unresolved high-impact flaw remains; otherwise return `VERDICT: ok` with residual uncertainty still visible.

## Quick Reference

Two separate `research-review` tasks cover evidence and inference. The verdict belongs to the exact document hash; a revised dossier needs a fresh review.

## Procedure

Do not rewrite the author's conclusion or add a source row to the dossier under review. Record reviewer assessments separately. In the main agent's next pass, convert only actionable findings into bounded follow-up questions.

## Pitfalls

Do not demand invented contrary sources or force equal numbers of positive and negative findings. Do not use a reviewer of another dossier or version.

## Verification

Each finding should be reproducible from a cited row, passage, URL or section; the final line must be exactly `VERDICT: ok` or `VERDICT: revise`.
