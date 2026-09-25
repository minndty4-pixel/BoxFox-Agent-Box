---
name: research-evidence
description: Test whether a passage actually supports a claim.
---
# Research Evidence Skill

Keep three questions separate: did we open the source, is the passage there, and does it justify the claim?

## When to Use

Use for every claim that could alter the recommendation or plan.

## Prerequisites

Read the relevant source with context. Get row, passage and claim IDs from `source_list`.

## How to Run

1. Use `source_verify` to reopen the URL and check provenance and passage. `matched` only says that text was found.
2. Compare the claim and passage for population, object, date, version, denominator, unit, condition and strength of language.
3. Label the relationship as support, contradiction, context, insufficient or inaccessible. A reviewer can record this with `claim_assess` against the bound dossier.
4. Trace common origin across reposts, authors, organizations, studies and datasets. Different hosts may repeat one source; one platform can hold independent studies.
5. Recheck current official material at decision time. For owner documents, separate provenance from truth. For vendor materials, separate claimed features from independent effectiveness.

## Quick Reference

The normalized evidence graph allows one passage to relate to many claims. A matched excerpt that contradicts the claim remains a contradiction.

## Procedure

When a relationship is insufficient, name exactly which additional comparison, document or context would settle it. Preserve contrary evidence and unresolved disagreement.

## Pitfalls

Do not count social verification badges, repeated posting or star counts as truth. Do not label a result “verified” when only the quotation was found.

## Verification

For every decisive claim, a reader can identify its passage IDs, relation assessment, source origin and remaining limitation.
