---
name: research-search
description: Search multiple channels and record coverage gaps.
---
# Research Search Skill

Search for evidence that could change a decision. Keep a trace that another reader can repeat or challenge.

## When to Use

Use for every question requiring external evidence or a claim about absence, novelty or competition.

## Prerequisites

Know the question, date range, geography and source channels. Use the public `web_search`, `web_fetch`, `read_source` and `paper_citations` tools within your assigned budget.

## How to Run

1. Start with broad concepts, synonyms and adjacent terms; then narrow by venue, date, institution or technique.
2. Run a deliberate contrary search: failures, negative reviews, alternatives, retractions, changed rules and products already shipping.
3. Use channels suited to the claim: proceedings and OpenReview for scholarly status, official documentation and versioned repos for code, authorities for current rules, and public community pages for signals from practice.
4. Open the original result. Follow citations, implementation links and references when a source is decision-critical.
5. Record the query, channel, filters, date, useful results, exclusions and reasons. `web_search.searchTrace` identifies each returned candidate as retained, duplicate, excluded by host or removed by the response size limit; keep `omittedCandidates` visible when the trace itself is cut. A zero-result search is a result, not proof of absence.
6. If a page is blocked, report URL, attempts, readable portion and affected question. Continue other branches and send the blocker to main.

## Quick Reference

`web_search(source="openreview")` supports a returned `pagination.nextCursor`; other sources report pagination unsupported. Do not invent a cursor. Use site filters only where the tool supports them.

## Procedure

For paper claims, distinguish submission, accepted paper, workshop, review, rebuttal and decision. For market claims, distinguish launch announcement, deployment, usage and measured outcome. For community posts, preserve author and repost chain; many copies of one post remain one origin.

## Pitfalls

Do not stop after a search snippet. Do not infer comprehensiveness from a provider's first page. Do not promote a verified badge, star count or posting frequency into truth of the underlying claim.

## Verification

The search trace should expose what was attempted, where coverage ended, and at least one path by which the main agent could challenge the preliminary conclusion.
