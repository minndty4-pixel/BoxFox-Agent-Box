"""The new research benchmark must not pass on absent or misattributed runs."""
import importlib.util
import json
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'eval' / 'research_v2_acceptance.py'
MANIFEST = json.loads((SCRIPT.parent / 'benchmarks' / 'research-v2.json').read_text(encoding='utf-8'))
SPEC = importlib.util.spec_from_file_location('research_v2_acceptance', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _runs():
    return [{'caseId': case['id'], 'run': run,
             'scores': {axis: 4 for axis in MANIFEST['dimensions']},
             'severeMisattribution': False}
            for case in MANIFEST['cases'] for run in range(1, 4)]


def test_acceptance_requires_every_run_and_rejects_a_severe_source_error():
    runs = _runs()
    baseline = [{'caseId': case['id'], 'medians': {
        axis: (4 if case['kind'] == 'simple' else 3) for axis in MANIFEST['dimensions']}}
        for case in MANIFEST['cases']]
    assert MODULE.assess(runs[:-1], MANIFEST)['measured'] is False
    assert MODULE.assess(runs, MANIFEST)['passing'] is False
    assert MODULE.assess(runs, MANIFEST, baseline)['passing'] is True
    runs[0]['severeMisattribution'] = True
    assert MODULE.assess(runs, MANIFEST, baseline)['passing'] is False
