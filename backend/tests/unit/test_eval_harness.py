"""Bộ chạy đánh giá P0a (B3): phân loại hợp lệ, chạy lại, gói nguồn, đo 8.7, chấm mù.

Tất cả **offline**: không mô-đun nào ở đây mở socket. Đường mạng được thay bằng
hàm giả để kiểm đúng logic quanh nó (thứ tự phân loại, số lần chạy lại, `null`
thay cho 0, đầu vào/hình dạng của lời gọi giám khảo).

Bất biến trung tâm: ô **chưa đo** ghi `null`, không bao giờ ghi `0`; và cổng
`guard.py` phải chặn trước mọi lời gọi mạng.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
EVAL_DIR = REPO / 'scripts' / 'eval'
PACKS_DIR = EVAL_DIR / 'packs'
sys.path.insert(0, str(EVAL_DIR))
sys.path.insert(0, str(PACKS_DIR))

import build_pack  # noqa: E402
import grading  # noqa: E402
import guard  # noqa: E402
import judge  # noqa: E402
import net  # noqa: E402
import reference_map  # noqa: E402
import run_eval  # noqa: E402
import runner  # noqa: E402
import search_bench  # noqa: E402


def _open_gate(monkeypatch, budget='5'):
    monkeypatch.setenv(guard.SPEND_ENV, '1')
    monkeypatch.setenv(guard.BUDGET_ENV, budget)


# --------------------------------------------------------------------------- runner
def test_classify_validity_covers_every_branch():
    assert runner.classify_validity({'status': 'completed'}) == runner.QUALITY_VALID
    assert runner.classify_validity({'status': 'failed', 'errorCode': 'UPSTREAM_HTTP_502'}) \
        == runner.INFRA_FAILED
    assert runner.classify_validity({'errorCode': 'DEADLINE_EXCEEDED'}) == runner.INFRA_FAILED
    # Hạn chót do chính agent tiêu hết là lỗi CHẤT LƯỢNG, không phải hạ tầng.
    assert runner.classify_validity({'errorCode': 'DEADLINE_EXCEEDED', 'deadlineSource': 'agent'}) \
        == runner.QUALITY_VALID
    assert runner.classify_validity({'errorCode': 'SEARCH_TOOLING_FAILED'}) == runner.INFRA_FAILED
    assert runner.classify_validity({'harnessBug': True}) == runner.HARNESS_BUG
    # Cổng từ chối / vượt trần của agent vẫn là chất lượng.
    assert runner.classify_validity({'errorCode': 'BUDGET_EXHAUSTED'}) == runner.QUALITY_VALID


def test_infra_failure_rate_and_divergence_flag():
    attempts = [{'validity': runner.INFRA_FAILED}, {'validity': runner.QUALITY_VALID}]
    assert runner.infra_failure_rate(attempts) == 0.5
    assert runner.infra_failure_rate([]) is None
    flagged = runner.flag_rate_divergence({'c1': 0.5, 'c2': 0.2})
    assert flagged['flagged'] is True and flagged['pairs'][0]['delta'] == 0.3
    quiet = runner.flag_rate_divergence({'c1': 0.5, 'c2': 0.45})
    assert quiet['flagged'] is False
    assert runner.flag_rate_divergence({'c1': None, 'c2': 0.9})['flagged'] is False


def test_run_scenario_reruns_infra_then_scores(monkeypatch):
    _open_gate(monkeypatch)
    outcomes = iter([
        {'status': 'failed', 'errorCode': 'UPSTREAM_HTTP_502'},
        {'status': 'failed', 'errorCode': 'UPSTREAM_TIMEOUT'},
        {'status': 'completed', 'metrics': {'steps': 4}},
    ])
    monkeypatch.setattr(runner, 'run_once', lambda *a, **k: next(outcomes))
    result = runner.run_scenario({'id': 'S1'}, {'id': 'c1'}, repeat=0, allow_spend=True,
                                 budget_usd=5, max_reruns=2)
    assert result['validity'] == runner.QUALITY_VALID
    assert result['measured'] is True
    assert result['reruns'] == 2 and len(result['runs']) == 3
    assert result['metrics'] == {'steps': 4}
    assert result['infraErrorCodes'] == {'UPSTREAM_HTTP_502': 1, 'UPSTREAM_TIMEOUT': 1}


def test_run_scenario_writes_null_when_every_attempt_is_infra(monkeypatch):
    _open_gate(monkeypatch)
    monkeypatch.setattr(runner, 'run_once', lambda *a, **k: {'status': 'failed',
                                                             'errorCode': 'UPSTREAM_TIMEOUT'})
    result = runner.run_scenario({'id': 'S1'}, {'id': 'c1'}, repeat=0, allow_spend=True,
                                 budget_usd=5)
    assert result['measured'] is False
    assert result['metrics'] is None  # chưa đo, KHÔNG phải 0
    assert result['infraFailureRate'] == 1.0 and len(result['runs']) == 3


def test_run_scenario_refuses_without_opt_in(monkeypatch):
    monkeypatch.delenv(guard.SPEND_ENV, raising=False)
    monkeypatch.delenv(guard.BUDGET_ENV, raising=False)
    with pytest.raises(runner.SpendRefused):
        runner.run_scenario({'id': 'S1'}, {'id': 'c1'}, repeat=0, allow_spend=False,
                            budget_usd=5)


def test_pack_hash_reports_missing_instead_of_faking(tmp_path):
    assert runner.pack_hash(None)['sha256'] is None
    assert runner.pack_hash(tmp_path / 'nope')['missing']
    (tmp_path / 'a.txt').write_text('x', encoding='utf-8')
    digest = runner.pack_hash(tmp_path)
    assert digest['files'] == 1 and len(digest['sha256']) == 64


# --------------------------------------------------------------------------- reference map
def test_canonical_url_folds_arxiv_doi_and_tracking():
    assert reference_map.canonical_url('https://arxiv.org/abs/1706.03762v5') == 'arxiv:1706.03762'
    assert reference_map.canonical_url('https://arxiv.org/pdf/1706.03762.pdf') == 'arxiv:1706.03762'
    assert reference_map.canonical_url('https://doi.org/10.1000/ABC') == 'doi:10.1000/abc'
    assert reference_map.canonical_url('https://x.test/a?utm_source=n&keep=1#frag') \
        == 'https://x.test/a?keep=1'
    assert reference_map.canonical_url('HTTPS://X.test/A/') == 'https://x.test/a'


def test_weighted_recall_uses_weights_and_reports_missing():
    reference = {'scenarioId': 'S1', 'builtAt': '2026-01-01T00:00:00Z', 'items': [
        {'id': 'm1', 'label': 'Must', 'weight': 'must', 'urls': ['https://a.test/1']},
        {'id': 'n1', 'label': 'Nice', 'weight': 'nice', 'urls': ['https://b.test/2']},
    ]}
    result = reference_map.weighted_recall(reference, ['https://a.test/1/?utm_source=x'])
    assert result['recall'] == 0.75  # 3 / (3 + 1)
    assert result['mustRecall'] == 1.0
    assert result['missing'] == ['n1'] and result['missingMust'] == []


def test_load_map_rejects_a_map_without_dates(tmp_path):
    bad = tmp_path / 'map.json'
    bad.write_text(json.dumps({'scenarioId': 'S1', 'items': []}), encoding='utf-8')
    with pytest.raises(ValueError):
        reference_map.load_map(bad)


# --------------------------------------------------------------------------- grading
def test_blind_labels_and_trace_stripping(tmp_path):
    assert grading.blind_label(1) == 'G-001'
    run = {'report': 'chạy bằng muse-secret-model xong', 'model': 'muse-secret-model',
           'configId': 'c2', 'commit': 'deadbeef'}
    label_dir = grading.build_pack(run, label='G-001', out_dir=tmp_path, reference_map=None)
    report = (label_dir / 'report.md').read_text(encoding='utf-8')
    assert 'muse-secret-model' not in report and '[đã ẩn]' in report
    assert (label_dir / 'rubric.md').exists() and (label_dir / 'reference-map.md').exists()


def test_grading_sheet_round_trip_and_empty_cost_column(tmp_path):
    labels = [{'label': 'G-001', 'scenarioId': 'S1'},
              {'label': 'G-002', 'scenarioId': 'S2'}]
    csv_path = grading.grading_sheet(labels, tmp_path)
    header = csv_path.read_text(encoding='utf-8').splitlines()[0]
    assert 'c1_goal_fit' in header and 'minutes_spent' in header
    rows = grading.read_sheet(csv_path)
    assert set(rows) == {'G-001', 'G-002'}
    assert rows['G-001']['scores']['c10_cost_latency'] is None  # để trống, không ghi 0


def test_spearman_and_within_one():
    assert grading.spearman([(1, 1), (2, 2), (3, 3)]) == 1.0
    assert grading.spearman([(1, 1)]) is None
    assert grading.within_one([(2, 3), (2, 0)]) == 0.5


def test_unblind_reports_agreement_and_unresolved_labels(tmp_path):
    grading.write_blind_key([
        {'label': 'G-001', 'scenarioId': 'S1', 'configId': 'c1',
         'judgeScores': {code: 2 for code in grading.CRITERION_CODES}},
        {'label': 'G-002', 'scenarioId': 'S2', 'configId': 'c2',
         'judgeScores': {code: 1 for code in grading.CRITERION_CODES}},
    ], tmp_path)
    (tmp_path / 'grading-sheet.csv').write_text(
        'label,scenario_id,' + ','.join(grading.CRITERION_CODES) +
        ',evidence_note,flag,minutes_spent\n'
        'G-001,S1,' + ','.join(['2'] * 10) + ',ổn,none,10\n', encoding='utf-8')
    result = grading.unblind(tmp_path)
    assert result['labels'] == 2 and result['graded'] == 1
    assert result['overall']['n'] == 1
    assert [item['graded'] for item in result['resolved']] == [True, False]


def test_select_sample_forces_needs_owner_labels():
    runs = [{'label': f'G-{i:03d}', 'scenarioId': 'S1', 'configId': 'c1'} for i in range(1, 9)]
    runs.append({'label': 'G-100', 'scenarioId': 'S1', 'configId': 'c1', 'needsOwner': True})
    chosen = grading.select_sample(runs, fraction=0.25, seed=0)
    assert 'G-100' in chosen
    assert chosen == grading.select_sample(runs, fraction=0.25, seed=0)


# --------------------------------------------------------------------------- search bench (8.7)
def test_search_queries_file_meets_the_plan_fractions():
    queries = search_bench.load_queries()
    assert len(queries) >= 120
    counts: dict[str, int] = {}
    for item in queries:
        counts[item['facet']] = counts.get(item['facet'], 0) + 1
    assert counts['academic'] == 40 and counts['tech-landscape'] == 30
    assert counts['market'] == 25 and counts['vietnamese'] == 25
    dev = sum(1 for item in queries if item['split'] == 'dev')
    assert 0.35 <= dev / len(queries) <= 0.45
    assert all(item['lang'] in ('en', 'vi') for item in queries)


def test_load_queries_rejects_a_missing_key(tmp_path):
    bad = tmp_path / 'q.jsonl'
    bad.write_text(json.dumps({'id': 'X', 'text': 'x', 'lang': 'en'}) + '\n', encoding='utf-8')
    with pytest.raises(ValueError, match='thiếu khoá'):
        search_bench.load_queries(bad)


def test_ndcg_at_k_is_hand_computable_and_unmeasured_is_none():
    assert search_bench.ndcg_at_k(['a', 'b', 'c'], {'a': 3, 'b': 0, 'c': 1}, 3) == 0.9828
    assert search_bench.ndcg_at_k(['b', 'a'], {'a': 3, 'b': 1}, 2) == 0.7098
    assert search_bench.ndcg_at_k(['a'], {}, 10) is None  # chưa có nhãn ⇒ chưa đo


def test_compute_metrics_reports_null_for_what_it_cannot_measure():
    queries = {'Q1': {'facet': 'academic', 'needsFresh': True}}
    rows = [{'queryId': 'Q1', 'latencyMs': 100, 'results': [{'url': 'https://a.test/1'}]},
            {'queryId': 'Q1', 'latencyMs': 13000, 'error': 'timeout', 'results': []}]
    metrics = search_bench.compute_metrics(rows, queries, {})
    assert metrics['failureRate'] == 0.5
    assert metrics['ndcgAt10'] is None       # thiếu nhãn
    assert metrics['mapRecallTop20'] is None  # thiếu bản đồ
    assert metrics['freshRate'] is None       # thiếu cửa sổ thời gian
    assert metrics['latencyP50Ms'] == 6550.0


def test_parse_relevance_reads_the_first_allowed_digit():
    assert search_bench.parse_relevance('Điểm: 3') == 3
    with pytest.raises(ValueError):
        search_bench.parse_relevance('không có số')


def test_build_pool_dedupes_by_canonical_url():
    raw = [
        {'queryId': 'Q1', 'results': [{'url': 'https://a.test/1?utm_source=x', 'title': 'a'}]},
        {'queryId': 'Q1', 'results': [{'url': 'https://a.test/1/', 'title': 'a again'}]},
    ]
    pool = search_bench.build_pool(raw, {'Q1': {'text': 'q'}})
    assert len(pool) == 1 and pool[0]['label'] == 'P-0001'


def test_run_bench_refuses_without_the_spend_gate(monkeypatch, tmp_path):
    monkeypatch.delenv(guard.SPEND_ENV, raising=False)
    monkeypatch.delenv(guard.BUDGET_ENV, raising=False)
    with pytest.raises(search_bench.SpendRefusedForBench):
        search_bench.run_bench(['pipeline'], split='dev', out_dir=tmp_path)


def test_run_bench_writes_raw_pool_and_metrics(monkeypatch, tmp_path):
    _open_gate(monkeypatch)
    calls: list[tuple[str, str]] = []

    def fake_run_query(query, config):
        calls.append((query['id'], config))
        return {'queryId': query['id'], 'config': config, 'latencyMs': 10,
                'results': [{'url': 'https://a.test/1', 'title': 'A'}], 'error': None}

    monkeypatch.setattr(search_bench, 'run_query', fake_run_query)
    monkeypatch.setattr(search_bench, 'judge_pool', lambda pool, out_dir, runner=None: {
        str(pool[0]['label']): 2})
    dev = [item for item in search_bench.load_queries() if item['split'] == 'dev']
    bench = search_bench.run_bench(['legacy', 'pipeline'], split='dev', out_dir=tmp_path)
    assert len(calls) == 2 * len(dev)  # xen kẽ mọi truy vấn với mọi cấu hình
    assert (tmp_path / 'raw.jsonl').exists() and (tmp_path / 'metrics.json').exists()
    assert (tmp_path / 'manifest.json').exists()
    assert bench['poolPairs'] == len(dev)
    assert 'nDCG@10' in search_bench.report(bench)


# --------------------------------------------------------------------------- source packs (§3)
def _write_pack_inputs(tmp_path: Path) -> Path:
    captured = tmp_path / 'captured'
    captured.mkdir()
    (captured / 'a.html').write_text('<html><body>hello</body></html>', encoding='utf-8')
    (captured / 'b.txt').write_text('plain source', encoding='utf-8')
    manifest = tmp_path / 'sources.json'
    manifest.write_text(json.dumps({'scenarioId': 'S1', 'sources': [
        {'url': 'https://example.org/a', 'title': 'A', 'date': '2025-03-01', 'kind': 'web',
         'accessLevel': 'open', 'file': 'captured/a.html'},
        {'url': 'https://example.org/b', 'title': 'B', 'date': '', 'kind': 'paper',
         'accessLevel': 'abstract', 'file': 'captured/b.txt'}]}), encoding='utf-8')
    return manifest


def test_build_pack_matches_the_frozen_pack_shape(tmp_path):
    manifest = _write_pack_inputs(tmp_path)
    queries = tmp_path / 'queries.jsonl'
    queries.write_text(json.dumps({'query': 'hello', 'results': [
        {'url': 'https://example.org/a', 'rank': 1, 'snippet': 'hi'}]}) + '\n', encoding='utf-8')
    out = tmp_path / 'pack'
    result = build_pack.build_pack(manifest, out, queries_path=queries,
                                   built_at='2026-09-25T00:00:00Z')
    pack = json.loads((out / 'pack.json').read_text(encoding='utf-8'))
    assert pack['scenarioId'] == 'S1' and pack['builtAt'] == '2026-09-25T00:00:00Z'
    for item in pack['sources']:
        assert set(item) == {'url', 'title', 'date', 'kind', 'accessLevel', 'file'}
        assert (out / item['file']).is_file()
    index = [json.loads(line) for line in
             (out / 'search_index.jsonl').read_text(encoding='utf-8').splitlines()]
    assert index[0]['urls'] == [{'url': 'https://example.org/a', 'rank': 1, 'snippet': 'hi'}]
    assert result['indexRows'] == 1
    summary = build_pack.validate_pack(out)
    assert summary['sources'] == 2 and summary['hasIndex'] is True


def test_build_pack_refuses_to_overwrite_without_force(tmp_path):
    manifest = _write_pack_inputs(tmp_path)
    out = tmp_path / 'pack'
    build_pack.build_pack(manifest, out)
    with pytest.raises(ValueError, match='--force'):
        build_pack.build_pack(manifest, out)


def test_build_pack_rejects_a_file_outside_the_manifest_tree(tmp_path):
    manifest = tmp_path / 'sources.json'
    manifest.write_text(json.dumps({'scenarioId': 'S1', 'sources': [
        {'url': 'https://e.test/x', 'title': 'X', 'file': '../../etc/passwd'}]}),
        encoding='utf-8')
    with pytest.raises(ValueError, match='cây con'):
        build_pack.load_source_manifest(manifest)


# --------------------------------------------------------------------------- judge (router call)
def test_judge_request_posts_to_the_router_and_parses_content(monkeypatch):
    _open_gate(monkeypatch)
    monkeypatch.setenv(judge.ROUTER_ENV, 'http://router.test:3101/')
    monkeypatch.setenv(judge.JUDGE_MODEL_ENV, 'judge-model-x')
    captured: dict = {}

    def fake_request(url, *, method='GET', payload=None, headers=None, timeout=120.0):
        captured.update({'url': url, 'method': method, 'payload': payload})
        return {'choices': [{'message': {'content': '{"scores": {}}'}}]}

    monkeypatch.setattr(judge.net, 'request_json', fake_request)
    runner_obj = judge.JudgeRunner()
    assert runner_obj.request('chấm hộ') == '{"scores": {}}'
    assert captured['url'] == 'http://router.test:3101/v1/chat/completions'
    assert captured['method'] == 'POST'
    assert captured['payload']['stream'] is False
    assert captured['payload']['model'] == 'judge-model-x'
    assert captured['payload']['messages'][0]['content'] == 'chấm hộ'


def test_judge_retries_twice_on_5xx_then_succeeds(monkeypatch):
    _open_gate(monkeypatch)
    attempts: list[int] = []

    def flaky(url, *, method='GET', payload=None, headers=None, timeout=120.0):
        attempts.append(1)
        if len(attempts) < 3:
            raise net.HttpStatusError(503, 'busy')
        return {'choices': [{'message': {'content': 'ok'}}]}

    monkeypatch.setattr(judge.net, 'request_json', flaky)
    assert judge.JudgeRunner().request('x') == 'ok'
    assert len(attempts) == 3  # 1 lần + 2 lần thử lại


def test_judge_gives_up_after_two_retries_on_5xx(monkeypatch):
    _open_gate(monkeypatch)

    def always_503(url, *, method='GET', payload=None, headers=None, timeout=120.0):
        raise net.HttpStatusError(503, 'busy')

    monkeypatch.setattr(judge.net, 'request_json', always_503)
    with pytest.raises(net.HttpStatusError):
        judge.JudgeRunner().request('x')


def test_judge_refuses_before_opening_a_socket(monkeypatch):
    monkeypatch.delenv(guard.SPEND_ENV, raising=False)
    monkeypatch.delenv(guard.BUDGET_ENV, raising=False)
    called: list[int] = []
    monkeypatch.setattr(judge.net, 'request_json',
                        lambda *a, **k: called.append(1) or {})
    with pytest.raises(judge.SpendRefused):
        judge.JudgeRunner().request('x')
    assert called == []


# --------------------------------------------------------------------------- run_eval --execute
def test_execute_writes_research_scores_v2_with_null_for_infra(monkeypatch, tmp_path):
    _open_gate(monkeypatch)
    monkeypatch.setenv('BOXFOX_ROUTER_KEY', 'bf_test')
    monkeypatch.setenv('BOXFOX_HARNESS_ADMIN_TOKEN', 'test')
    monkeypatch.setattr(run_eval.runner, 'run_scenario', lambda *a, **k: {
        'scenarioId': 'Q1', 'configId': 'c1', 'repeat': 0,
        'validity': runner.INFRA_FAILED, 'measured': False, 'metrics': None, 'reruns': 2,
        'infraFailureRate': 1.0, 'infraErrorCodes': {'UPSTREAM_TIMEOUT': 3},
        'errorCode': 'UPSTREAM_TIMEOUT', 'artifacts': {}})
    code = run_eval.main(['--execute', '--fixture', 'Q1', '--configs', '1', '--out',
                          str(tmp_path), '--budget-usd', '0.01'])
    assert code == run_eval.EXIT_CONNECTION  # không ô nào hợp lệ
    rows = [json.loads(line) for line in
            (tmp_path / 'scores.jsonl').read_text(encoding='utf-8').splitlines()]
    assert rows[0]['schemaVersion'] == 'research-scores-v2'
    assert rows[0]['metrics'] is None and rows[0]['measured'] is False
    manifest = json.loads((tmp_path / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['scoresSchema'] == 'research-scores-v2'
    assert manifest['infraDivergence']['flagged'] is False


def test_execute_writes_metrics_for_a_quality_valid_cell(monkeypatch, tmp_path):
    _open_gate(monkeypatch)
    monkeypatch.setenv('BOXFOX_ROUTER_KEY', 'bf_test')
    monkeypatch.setenv('BOXFOX_HARNESS_ADMIN_TOKEN', 'test')
    monkeypatch.setattr(run_eval.runner, 'run_scenario', lambda *a, **k: {
        'scenarioId': 'Q1', 'configId': 'c1', 'repeat': 0,
        'validity': runner.QUALITY_VALID, 'measured': True, 'metrics': {'steps': 7},
        'reruns': 0, 'infraFailureRate': 0.0, 'infraErrorCodes': {}, 'errorCode': None,
        'artifacts': {}})
    code = run_eval.main(['--execute', '--fixture', 'Q1', '--configs', '1', '--out',
                          str(tmp_path), '--budget-usd', '0.01'])
    assert code == run_eval.EXIT_OK
    rows = [json.loads(line) for line in
            (tmp_path / 'scores.jsonl').read_text(encoding='utf-8').splitlines()]
    assert rows[0]['metrics'] == {'steps': 7} and rows[0]['validity'] == runner.QUALITY_VALID


def test_dry_run_does_not_reach_the_runner(monkeypatch, capsys):
    def boom(*args, **kwargs):
        raise AssertionError('dry-run không được gọi runner')

    monkeypatch.setattr(run_eval.runner, 'run_scenario', boom)
    assert run_eval.main(['--dry-run', '--fixture', 'Q1']) == run_eval.EXIT_OK
    assert 'DRY RUN' in capsys.readouterr().out
