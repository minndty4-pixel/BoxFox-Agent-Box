#!/usr/bin/env python3
"""Summarize human-reviewed research v2 runs; never invent missing measurements."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

MANIFEST = Path(__file__).parent / 'benchmarks' / 'research-v2.json'


def assess(records: list[dict], manifest: dict, baseline: list[dict] | None = None) -> dict:
    dimensions = manifest['dimensions']
    case_defs = {item['id']: item for item in manifest['cases']}
    expected = {(case_id, repetition) for case_id in case_defs
                for repetition in range(1, manifest['repetitions'] + 1)}
    observed: dict[tuple[str, int], dict] = {}
    for row in records:
        key = (str(row.get('caseId')), row.get('run'))
        if key not in expected or key in observed:
            raise ValueError(f'unknown or repeated run: {key}')
        scores = row.get('scores') or {}
        if any(isinstance(scores.get(axis), bool) or not isinstance(scores.get(axis), int)
               or not 1 <= scores[axis] <= 5 for axis in dimensions):
            raise ValueError(f'invalid five-dimension scores: {key}')
        observed[key] = row
    missing = sorted(expected - set(observed))
    if missing:
        return {'measured': False, 'missingRuns': [list(item) for item in missing],
                'passing': False}
    severe = sum(bool(row.get('severeMisattribution')) for row in records)
    cases = []
    for case_id, definition in case_defs.items():
        runs = [observed[(case_id, repetition)] for repetition in
                range(1, manifest['repetitions'] + 1)]
        medians = {axis: statistics.median(row['scores'][axis] for row in runs)
                   for axis in dimensions}
        passed = (all(score >= manifest['rollout']['minimumMedianPerDimension']
                      for score in medians.values())
                  and not any(row.get('severeMisattribution') for row in runs))
        cases.append({'caseId': case_id, 'kind': definition['kind'],
                      'medians': medians, 'passing': passed})
    baseline_by_case = {item['caseId']: item for item in (baseline or [])}
    baseline_complete = set(case_defs) <= set(baseline_by_case)
    simple = next(item for item in cases if item['kind'] == 'simple')
    baseline_simple = baseline_by_case.get(simple['caseId'])
    simple_regressed = (baseline_simple is not None and
                        any(simple['medians'][axis] < baseline_simple['medians'][axis]
                            for axis in dimensions))
    complex_new = [item for item in cases if item['kind'] == 'complex'
                   and item['caseId'] in baseline_by_case]
    complex_better = sum(sum(item['medians'].values()) >
                         sum(baseline_by_case[item['caseId']]['medians'].values())
                         for item in complex_new)
    improvement_ok = baseline_complete and complex_better > len(complex_new) / 2
    passing = (sum(item['passing'] for item in cases) >=
               manifest['rollout']['minimumCasesPassing'] and
               severe <= manifest['rollout']['maximumSevereMisattributions'] and
               not simple_regressed and improvement_ok)
    return {'measured': True, 'passing': passing,
            'casesPassing': sum(item['passing'] for item in cases),
            'severeMisattributions': severe, 'simpleRegressed': simple_regressed,
            'complexImprovedOverBaseline': complex_better if complex_new else None,
            'baselineCompared': baseline_complete, 'cases': cases}


def _jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()
            if line.strip()]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Assess 12 research scenarios, three runs each.')
    parser.add_argument('--scores', type=Path, required=True,
                        help='JSONL rows with caseId, run, five scores and severeMisattribution')
    parser.add_argument('--baseline', type=Path, help='Baseline case summaries in JSON')
    args = parser.parse_args(argv)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    baseline = json.loads(args.baseline.read_text(encoding='utf-8')) if args.baseline else None
    result = assess(_jsonl(args.scores), manifest, baseline)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['passing'] else 1


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
