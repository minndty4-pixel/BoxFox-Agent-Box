---
name: planning
description: "The plan loop: research, write, independent critique, recorded verdict, then approval — without a critique you cannot request approval."
version: 1.0.0
author: BoxFox Agent (vòng 25, D-33)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [planning, review, verification, approval, evidence]
    related_skills: [codebase-inspection, requesting-code-review]
---

# Planning — write a plan, then let somebody else attack it

## Overview

A plan is a claim about work that has not happened yet. Written by the same mind that will execute
it, it is self-reported evidence, and self-reported evidence is the weakest kind. The loop below is
mandatory, and its second half is the half that is usually missing.

**The invariant, in full: without a critique you cannot request approval.**

## The loop

1. **Ground it** — `delegate_task role='explore'` for the code and `role='research'` for anything
   outside the workspace. A plan that cites external facts needs a Sources section with real,
   reachable addresses.
2. **Write it** — one writer only: you. `write_plan` stores `vN-slug.md` and scores P1–P8; a plan
   without an exact acceptance command, without risks, or without sources when it relies on external
   facts is refused before it is stored.
3. **Critique it** — `delegate_task role='plan-review'` on the **file that was just written**. State
   the exact path, demand a report with severities and `path:line`, and demand its answer end with
   `VERDICT: ok` or `VERDICT: revise`. The critic is read-only and never rewrites your plan.
4. **Record the verdict** — `plan_verify(identity, version, verdict, issues, summary)`. The harness
   accepts the verdict only when that `plan-review` child of this session really ran after the write,
   completed, produced enough text, and its own `VERDICT:` line matches what you record.
5. **Repair or approve** — `verdict='revise'` means fix the findings and write the **next** version,
   then critique that one; two revise rounds per turn is the cap. `verdict='ok'` means you may ask
   the owner to approve that exact version.

## What the harness enforces (not advice — gates)

| Gate | Code | Meaning |
|---|---|---|
| Independent critique | `PLAN_APPROVAL_UNVERIFIED` | Approval (chat `request_approval` or the Plan tab) of a version with no recorded passing critique is refused. |
| Critique provenance | `PLAN_VERIFY_NO_CRITIC` | No completed `plan-review` child ran after this version was written. |
| Verdict line | `PLAN_VERIFY_VERDICT_MISSING` | The critique's answer has no final `VERDICT:` line. |
| Verdict mismatch | `PLAN_VERIFY_VERDICT_MISMATCH` | You recorded a different verdict than the critique gave. |
| Sources | `PLAN_QUALITY_REJECTED` / sources findings | A plan leaning on outside facts must name where each fact came from. |

Two switches exist for the owner, not for you: `BOXFOX_PLAN_VERIFY` and
`BOXFOX_PLAN_SOURCES_GATE` (`enforce` / `warn` / `off`). Never argue for lowering them to get a plan
through; report the finding instead.

## Anti-patterns (measured, not guessed)

- **Stopping after `write_plan`.** A written plan is not a finished job; the turn ends at an approval
  request that carries a passing verdict, or at an honest report of the open findings.
- **Critiquing your own plan.** You wrote it, so you will defend it. Delegate the critique.
- **Critiquing the previous version.** The verdict is bound to `(identity, version)`: after a
  revision the critique and the verdict are needed again for the new version.
- **Inventing a verdict.** Recording `ok` when the critique said `revise` fails the mismatch gate and
  is visible in the Plan tab.
- **Asking for approval when the owner said "already old".** Approval resumes the turn for the
  version that was clicked and says so; do not silently execute a newer draft.

## Time

A planning turn can run long. The default turn budget is 600 s and one event-driven extension of
420 s applies after a plan is written, so do not rush the critique to save time — but do not spend
the budget on retries of the same failing call either.
