# Research v2 evaluation

The 12 scenario definitions live in `scripts/eval/benchmarks/research-v2.json`. They define the failure mode each scenario must expose. The suite is **unmeasured** until 36 real runs, three per scenario, have been reviewed.

For a controlled comparison, run the old and new workflow with the same model, total time budget, instructions and fixed source pack. Keep a second source pack held out from development. Then run one bounded live-web pass to measure blocked pages and freshness. Do not convert a mock or an offline unit test into a research quality score.

Each run receives five integer scores from 1 to 5: fit to the user's decision, evidence quality, coverage, reasoning and usefulness of the recommendation or plan. Score 4 only when the result is good enough to make the stated decision with limitations visible. Record `severeMisattribution: true` if a decisive claim is assigned to a source that does not support it, or a reviewer verdict belongs to another document version. A score is a reviewer judgment and must cite the observed run, source pack, dossier and event log.

Write one JSONL row per run with `caseId`, `run` (1–3), `scores` containing `goalFit`, `evidence`, `coverage`, `reasoning`, `decisionUsefulness`, and `severeMisattribution`. Use `python scripts/eval/research_v2_acceptance.py --scores <path>` to aggregate medians. A missing run reports `measured: false`; the command cannot declare rollout ready. When comparing to baseline, pass `--baseline` with the old workflow's case summaries.

The aggregator checks 10 of 12 passing cases, median at least 4 in every dimension, no severe misattribution, no simple-fact regression and improvement over the baseline on a majority of comparable complex cases. Mechanism regression tests must also pass before rollout. The benchmark script intentionally does not call a model or web provider; the live run evidence and human review still need to be collected.
