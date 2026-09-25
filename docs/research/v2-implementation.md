# Research v2 implementation status

Research v2 is opt-in for a new `research_brief` carrying `goal`, `questions`, or `methods`. Existing briefs keep the prior workflow. A v2 brief creates a durable `ResearchJob` in SQLite, and the Research tab can inspect questions, evidence, findings, blocked sources, review state, budget, and dependent plans.

## Runtime path

1. Main scopes the decision and questions through `research_brief`; each research child receives a `questionId`.
2. Children search and read sources, including OpenReview submissions and reviews, GitHub repositories, long HTML documents, and PDF page windows. Search responses include `searchTrace`; readers report extraction limits. User supplied workspace text can be checked with `file_read`.
3. `source_add` stores source, passage, claim, and relation separately. `source_verify` checks the original passage; `claim_assess` records a reviewer's assessment of whether it supports the claim.
4. `dossier_write` saves a draft even when the gate finds problems. Evidence and reasoning review bind to the exact dossier version, content hash, and a full read of that version. A writer supplied verdict cannot stand in for a reviewer.
5. `research_update` records question state and findings. The harness resumes active jobs from a checkpoint under the original budget; pause, cancel, and completion stop the scheduler.
6. `write_plan` can link a plan to research versions. A later dossier version marks the dependent plan stale and blocks approval until it is reviewed again.

Research that finds no source can report the gap and save a draft or partial result. It should never create a source row to satisfy branch lineage. A short verbatim passage is acceptable in v2 when that is all the source says.

## Verification status

Mechanism regression tests and the frontend build have passed during this implementation. The 12-case, three-run research quality benchmark in `scripts/eval/benchmarks/research-v2.json` is **unmeasured**. The acceptance aggregator in `scripts/eval/research_v2_acceptance.py` does not run models or judge dossiers; use `v2-evaluation.md` to collect controlled and held-out runs before treating the quality gate as passed.

Current reading limits remain visible in tool results: a PDF page window extracts at most 40 pages and scans without selectable text require an external OCR route. Other search providers do not expose a real pagination cursor. These cases must be reported as incomplete or blocked, not as fully reviewed sources.
