"""`search_pipeline` (P0b §5): 10 bước, KHÔNG mạng — mọi chân HTTP đều được thay.

Ca then chốt: bật/tắt qua env, gộp RRF, khử trùng + trần tên miền, BM25, thứ tự nguồn ngày,
`suspended` của engine, và hình dạng đầu ra mà mô hình nhìn thấy (không lộ điểm nội bộ).
"""
from __future__ import annotations

import json

import pytest

from agentbox.agent_core import limits
from agentbox.agent_core import search_pipeline as sp
from agentbox.agent_core.web import WebError


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_DB', str(tmp_path / 'search.sqlite'))
    monkeypatch.delenv('BOXFOX_SEARCH_PIPELINE', raising=False)
    monkeypatch.delenv('BOXFOX_SEARXNG_URL', raising=False)
    monkeypatch.delenv('BOXFOX_WEB_PACK', raising=False)
    sp.reset_store()
    yield
    sp.reset_store()


# ------------------------------------------------------------------ công tắc

def test_pipeline_is_off_by_default(monkeypatch):
    sp.reset_store()
    assert sp.pipeline_enabled() is False
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'ON')
    assert sp.pipeline_enabled() is True
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'maybe')
    assert sp.pipeline_enabled() is False


def test_searxng_url_trims_the_trailing_slash(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARXNG_URL', 'http://127.0.0.1:8888/')
    assert sp.searxng_url() == 'http://127.0.0.1:8888'


# ------------------------------------------------------------------ bước 3 · URL chuẩn

@pytest.mark.parametrize('raw, expected', [
    ('https://www.arXiv.org/abs/1706.03762v7?utm_source=x#frag', 'arxiv:1706.03762'),
    ('https://arxiv.org/pdf/1706.03762', 'arxiv:1706.03762'),
    ('https://doi.org/10.1000/ABC.1', 'doi:10.1000/abc.1'),
    ('https://www.example.com/a/b?utm_campaign=z&fbclid=1&gclid=2', 'https://example.com/a/b'),
    ('HTTPS://Example.COM/Path/', 'https://example.com/Path/'),
])
def test_canonical_url_folds_variants(raw, expected):
    assert sp.canonical_url(raw) == expected


# ------------------------------------------------------------------ bước 1 · lập truy vấn

def test_plan_queries_covers_question_synonyms_and_language():
    variants = sp.plan_queries({'label': 'retrieval augmented generation',
                                'terms': ['RAG', 'retriever']}, {}, wave=1)
    kinds = [variant['variant_kind'] for variant in variants]
    assert kinds[0] == 'keywords'
    assert 'question' in kinds and 'synonym' in kinds and 'language' in kinds
    assert variants[1]['query'] == 'what is retrieval augmented generation'
    # Biến thể `language` trùng văn bản với từ khoá nhưng khác ngôn ngữ ⇒ phải sống sót.
    assert any(variant['variant_kind'] == 'language' and variant['language'] == 'en'
               for variant in variants)
    assert len(variants) <= sp.SEARCH_PIPELINE_VARIANTS_L2


def test_plan_queries_uses_vietnamese_wording_for_vietnamese_labels():
    variants = sp.plan_queries({'label': 'thị trường xe điện', 'terms': []}, {}, wave=1)
    assert any('là gì' in variant['query'] for variant in variants)
    assert any(variant.get('language') == 'vi-VN' for variant in variants)


def test_plan_queries_respects_the_level_three_cap():
    facet = {'label': 'xe điện', 'terms': ['EV', 'pin'], 'kind': 'paper'}
    scope = {'needs_fresh': True, 'site_hints': ['vnexpress.net', 'tuoitre.vn']}
    level3 = sp.plan_queries(facet, {**scope, 'level': 3}, wave=3)
    level2 = sp.plan_queries(facet, scope, wave=2)
    assert len(level3) <= sp.SEARCH_PIPELINE_VARIANTS_L3
    assert len(level2) <= sp.SEARCH_PIPELINE_VARIANTS_L2
    assert len(level3) > len(level2), 'mức 3 phải nở nhiều biến thể hơn mức 2'


def test_plan_queries_dedupes_and_never_returns_blank_queries():
    variants = sp.plan_queries({'label': 'abc', 'terms': ['abc']}, {}, wave=1)
    assert all(variant['query'].strip() for variant in variants)
    keys = {(variant['query'].lower(), variant['language']) for variant in variants}
    assert len(keys) == len(variants), 'biến thể trùng cả văn bản lẫn ngôn ngữ phải bị gộp'


# ------------------------------------------------------------------ bước 4 · RRF

def test_rrf_pushes_urls_seen_by_several_engines_to_the_top():
    legs = [
        {'engine': 'brave', 'variant_kind': 'keywords',
         'results': [{'url': 'https://x.example/p', 'title': 'P'},
                     {'url': 'https://y.example/q', 'title': 'Q'}]},
        {'engine': 'bing', 'variant_kind': 'question',
         'results': [{'url': 'https://x.example/p'}]},
    ]
    rows = sp.rrf_fuse(legs)
    assert rows[0]['url'] == 'https://x.example/p'
    assert set(rows[0]['engines']) == {'brave', 'bing'}
    assert rows[0]['rrf'] > rows[1]['rrf']


def test_rrf_merges_arxiv_and_pdf_links_of_the_same_paper():
    rows = sp.rrf_fuse([
        {'engine': 'a', 'results': [{'url': 'https://arxiv.org/abs/1706.03762'}]},
        {'engine': 'b', 'results': [{'url': 'https://arxiv.org/pdf/1706.03762'}]},
    ])
    assert len(rows) == 1 and rows[0]['canonical'] == 'arxiv:1706.03762'


# ------------------------------------------------------------------ bước 5 · khử trùng + đa dạng

def test_dedupe_merges_near_duplicate_titles_without_losing_the_second_url():
    shared = 'retrieval augmented generation combines a retriever with a generator model'
    rows = sp.dedupe_diversity([
        {'url': 'https://a.example/one', 'title': shared, 'snippet': shared},
        {'url': 'https://b.example/two', 'title': shared, 'snippet': shared},
    ])
    assert len(rows) == 1
    assert rows[0]['alsoFrom'] == ['https://b.example/two']


def test_dedupe_keeps_at_most_two_rows_per_domain():
    rows = sp.dedupe_diversity([
        {'url': f'https://news.example/{index}', 'title': f'tin số {index}', 'snippet': ''}
        for index in range(4)
    ], per_domain=2)
    assert len(rows) == 2
    assert [row['url'] for row in rows] == ['https://news.example/0', 'https://news.example/1']


# ------------------------------------------------------------------ bước 6 · BM25

def test_bm25_normalises_scores_and_rewards_term_overlap():
    rows = [{'url': 'https://a.example/1', 'title': 'retrieval augmented generation',
             'snippet': 'retriever generator'},
            {'url': 'https://b.example/2', 'title': 'nấu ăn', 'snippet': 'món ăn'}]
    sp.bm25_rerank(rows, 'retrieval augmented generation', [])
    assert rows[0]['bm25'] == 1.0
    assert rows[1]['bm25'] == 0.0


def test_final_score_is_the_weighted_sum_by_contract():
    weights = sp.SEARCH_WEIGHTS
    row = {'rrfNorm': 1.0, 'bm25': 1.0, 'llm': 1.0, 'tierScore': 1.0, 'freshScore': 1.0}
    assert sp.final_score(row) == pytest.approx(sum(weights.values()))
    assert sp.final_score({}) == 0.0


# ------------------------------------------------------------------ bước 8 · ngày

def test_resolve_dates_priority_order():
    assert sp.resolve_dates({'url': 'https://e.example/x', 'publishedDate': '2026-05-05'})['dateSource'] \
        == 'provider'
    assert sp.resolve_dates({'url': 'https://e.example/2026/03/09/bai'},
                            {'datePublished': '2026-04-04'}) == {
        'publishedAt': '2026-04-04', 'updatedAt': '', 'dateSource': 'page-meta'}
    assert sp.resolve_dates({'url': 'https://e.example/2026/03/09/bai'})['dateSource'] == 'url'
    assert sp.resolve_dates({'url': 'https://e.example/bai', 'snippet': 'đăng ngày 2025-07-12 lúc 8h'}) \
        ['dateSource'] == 'text'
    assert sp.resolve_dates({'url': 'https://e.example/bai'})['dateSource'] == 'unknown'


# ------------------------------------------------------------------ bước 2 · chân SearXNG

def test_searxng_search_without_a_url_reports_an_error_instead_of_raising():
    result = sp.searxng_search('bất kỳ', engines=['brave'], count=5)
    assert result['error'] and 'BOXFOX_SEARXNG_URL' in result['error']
    assert result['results'] == []


def test_searxng_search_parses_normal_and_unresponsive_engines(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARXNG_URL', 'http://127.0.0.1:8888')
    seen = {}

    def fake_request(url, *, timeout):
        seen['url'] = url
        return 200, json.dumps({
            'results': [{'url': 'https://a.example/1', 'title': 'A', 'content': 'đoạn',
                         'engine': 'brave', 'publishedDate': '2026-01-02'},
                        {'no_url': True}],
            'unresponsive_engines': [['bing', 'timeout'], 'google'],
        })

    monkeypatch.setattr(sp, 'http_request', fake_request)
    result = sp.searxng_search('truy vấn', engines=['brave', 'bing'], count=5)
    assert result['error'] is None
    assert [row['url'] for row in result['results']] == ['https://a.example/1']
    assert result['results'][0]['engine'] == 'brave'
    assert result['results'][0]['publishedDate'] == '2026-01-02'
    assert result['unresponsive'] == ['bing', 'google']
    assert 'q=truy+' in seen['url']
    assert 'engines=brave%2Cbing' in seen['url']


@pytest.mark.parametrize('answer, marker', [
    ((500, 'boom'), 'HTTP 500'),
    ((200, 'not json at all'), 'not JSON'),
])
def test_searxng_search_never_raises_on_bad_answers(monkeypatch, answer, marker):
    monkeypatch.setenv('BOXFOX_SEARXNG_URL', 'http://127.0.0.1:8888')
    monkeypatch.setattr(sp, 'http_request', lambda url, *, timeout: answer)
    result = sp.searxng_search('x', engines=['brave'], count=3)
    assert marker in str(result['error']) and result['results'] == []


def test_searxng_search_never_raises_on_a_transport_failure(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARXNG_URL', 'http://127.0.0.1:8888')

    def boom(url, *, timeout):
        raise sp._LocalRequestError('connection refused')

    monkeypatch.setattr(sp, 'http_request', boom)
    result = sp.searxng_search('x', engines=['brave'], count=3)
    assert 'connection refused' in result['error']


# ------------------------------------------------------------------ bước 7 · sức khoẻ engine

def test_engine_failures_suspend_it_and_remove_it_from_pick_engines():
    for _ in range(limits.SEARCH_ENGINE_FAIL_STREAK):
        sp.record_engine_result('brave', ok=False, empty=False, blocked=True, timeout=False,
                                latency_ms=100)
    assert 'brave' not in sp.pick_engines(4, kind='web')


# ------------------------------------------------------------------ bước 9-10 · chạy ống

def _fake_leg(rows):
    def fake(query, *, engines, count, time_range=None, language='', timeout=None):
        return {'results': rows, 'engines': list(engines), 'unresponsive': [], 'error': None,
                'latencyMs': 12}
    return fake


def test_run_pipeline_shapes_the_payload_and_hides_internal_scores(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'on')
    rows = [{'url': 'https://a.example/rag', 'title': 'RAG', 'snippet': 'retrieval augmented',
             'engine': 'brave', 'publishedDate': '2026-02-02'},
            {'url': 'https://b.example/rag', 'title': 'RAG hai', 'snippet': 'generation',
             'engine': 'bing'}]
    monkeypatch.setattr(sp, 'searxng_search', _fake_leg(rows))
    payload = sp.run_pipeline(['retrieval augmented generation'], source='web', count=5, options={})

    for key in ('query', 'queries', 'source', 'count', 'results', 'perQuery', 'deduped', 'dropped',
                'searchTrace', 'untrusted', 'note', 'cached', 'fetchedAt', 'pagination', 'filters',
                'pipeline'):
        assert key in payload
    assert payload['cached'] is False and payload['pipeline']['pack'] is False
    assert payload['pipeline']['steps']['results'] == len(payload['results']) > 0
    first = payload['results'][0]
    assert set(first) & {'rrf', 'bm25', 'score', 'rrfNorm'} == set(), 'mô hình không được thấy điểm nội bộ'
    assert first['domain'] == 'a.example' and first['provider'] == 'searxng'
    assert first['publishedAt'] == '2026-02-02' and first['dateSource'] == 'provider'
    assert 'brave' in payload['pipeline']['enginesUsed']


def test_run_pipeline_serves_the_second_identical_call_from_the_cache(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'on')
    monkeypatch.setattr(sp, 'searxng_search',
                        _fake_leg([{'url': 'https://a.example/1', 'title': 'A', 'engine': 'brave'}]))
    first = sp.run_pipeline(['q'], source='web', count=5, options={})
    second = sp.run_pipeline(['q'], source='web', count=5, options={})
    assert first['cached'] is False and second['cached'] is True
    assert second['results'] == first['results']


def test_run_pipeline_raises_web_error_when_every_engine_refuses(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'on')
    monkeypatch.setattr(sp, 'searxng_search', _fake_leg([]))
    with pytest.raises(WebError) as caught:
        sp.run_pipeline(['không có gì'], source='web', count=5, options={})
    assert caught.value.code == 'WEB_SEARCH_UNAVAILABLE'


def test_run_pipeline_feeds_the_local_index_in_as_its_own_engine(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'on')
    store = sp._store()
    store.index_upsert('https://cached.example/doc', 'RAG nội bộ', 'retrieval augmented generation')
    monkeypatch.setattr(sp, 'searxng_search', _fake_leg([]))
    payload = sp.run_pipeline(['retrieval augmented generation'], source='web', count=5, options={})
    assert payload['results'][0]['url'] == 'https://cached.example/doc'
    assert 'local-index' in payload['pipeline']['enginesUsed']


def test_run_pipeline_records_search_log_rows(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'on')
    monkeypatch.setattr(sp, 'searxng_search',
                        _fake_leg([{'url': 'https://a.example/1', 'title': 'A', 'engine': 'brave'}]))
    sp.run_pipeline(['q'], source='web', count=5, options={}, session_id='s1', research_id='r1')
    rows = sp._store().search_log(research_id='r1')
    assert rows and any(row['results'] == 1 for row in rows)


def test_run_pipeline_rejects_an_empty_query(monkeypatch):
    monkeypatch.setenv('BOXFOX_SEARCH_PIPELINE', 'on')
    with pytest.raises(WebError):
        sp.run_pipeline([], source='web', count=5, options={})
