"""A-6 — `paper_citations` hai chiều trên đồ thị trích dẫn + thử lại của các chân học thuật.

ĐO ĐƯỢC 2026-09-23 (keyless, `mailto` của dự án): `W2741809807` có 54 tham chiếu sống qua `select`,
và `filter=cites:W2741809807&per-page=2` trả `count=1255`. Crossref 429 rồi 200 cùng phiên; Europe
PMC 200 rồi 503; arXiv 406 cho `all:referral` mà 200 cho `all:electron`. Không ca nào dưới đây gọi
mạng thật: `web.http_request` bị thay bằng fixture đếm số lời gọi, vì điều đáng ghim là **số lần
chạm mạng và tham số của URL**, không phải nội dung trả về của nhà cung cấp.
"""
import json
import urllib.parse

import pytest

from agentbox.agent_core import limits as limits_module
from agentbox.agent_core import tool_contracts as contracts_module
from agentbox.agent_core import web as web_module
from agentbox.agent_core.web import WebError, WebTools

WORK = 'W2741809807'


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    """Mọi tên phân giải ra một địa chỉ công cộng (không ca nào ở đây chạm SSRF)."""
    monkeypatch.setattr(web_module.socket, 'getaddrinfo',
                        lambda host, port, **kwargs: [(2, 1, 6, '', ('93.184.216.34', 0))])


@pytest.fixture
def tools(tmp_path, monkeypatch):
    import agentbox.observability.system_log as system_log_module
    monkeypatch.setattr(system_log_module.system_log, 'directory', tmp_path)
    monkeypatch.setattr(system_log_module.system_log, 'path', tmp_path / 'harness.jsonl')
    return WebTools()


@pytest.fixture
def no_sleep(monkeypatch):
    """Ghim đồng hồ: chờ bao lâu là con số của luật, không phải của máy."""
    seen = []
    monkeypatch.setattr(web_module.time, 'sleep', lambda seconds: seen.append(seconds))
    return seen


def _work(item_id, title, year=2020, cited=0, doi=None):
    return {'id': f'https://openalex.org/{item_id}', 'doi': doi, 'display_name': title,
            'publication_year': year, 'cited_by_count': cited,
            'primary_location': {'source': {'display_name': 'Tạp chí Y học'}}}


@pytest.fixture
def openalex(monkeypatch):
    """OpenAlex giả: trả lời theo `filter` của URL, và ghi lại mọi URL đã bị gọi."""
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if 'works/' in url:
            body = {'id': f'https://openalex.org/{WORK}', 'title': 'Bài gốc',
                    'referenced_works': [f'https://openalex.org/W{i}' for i in (1, 2, 3)]}
        elif query.get('filter', [''])[0].startswith('cites:'):
            body = {'meta': {'count': 1255},
                    'results': [_work('W11', 'Bài trích dẫn A', 2024, 7, 'https://doi.org/10.1/a'),
                                _work('W12', 'Bài trích dẫn B', 2023, 2, 'https://doi.org/10.1/b')]}
        elif query.get('filter', [''])[0].startswith('openalex_id:'):
            body = {'results': [_work('W1', 'Nền tảng A', 1999, 900, 'https://doi.org/10.1/n-a'),
                                _work('W2', 'Nền tảng B', 2001, 100)]}
        else:
            body = {'meta': {'count': 2}, 'results': [_work('W21', 'Tìm được', 2022, 3)]}
        return 200, 'application/json', json.dumps(body), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    return calls


# --------------------------------------------------------------- chiều xuôi

def test_forward_asks_who_cites_the_work_and_reports_the_full_count(tools, openalex):
    result = tools.paper_citations({'workId': WORK})
    assert result['direction'] == 'forward' and result['work'] == WORK
    assert result['total'] == 1255                     # `meta.count`, không phải số dòng trả về
    assert result['count'] == 2 and result['source'] == 'openalex'
    assert result['untrusted'] is True and result['note']
    assert result['fetchedAt'].endswith('Z')
    first = openalex[0]
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(first).query)
    assert query['filter'] == [f'cites:{WORK}']
    assert query['per-page'] == ['10'] and query['mailto'] == [limits_module.OPENALEX_MAILTO_DEFAULT]
    assert query['select'][0].startswith('id,doi,display_name')      # `select` là đòn bẩy thật


def test_the_limit_is_capped_by_the_constant_instead_of_the_argument(tools, openalex):
    tools.paper_citations({'workId': WORK, 'limit': 999})   # trần là hằng số, không phải lời gọi
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(openalex[0]).query)
    assert query['per-page'] == [str(limits_module.PAPER_CITATIONS_LIMIT_MAX)]


def test_a_doi_alone_is_enough_and_travels_inside_the_openalex_path(tools, openalex):
    tools.paper_citations({'doi': '10.1000/xyz', 'direction': 'forward'})
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(openalex[0]).query)
    # Không có `W…` thì OpenAlex nhận thẳng `doi:…` làm mã trong `filter` (đo được 2026-09-23).
    assert query['filter'] == ['cites:doi:10.1000/xyz']
    assert 'works/' not in urllib.parse.urlsplit(openalex[0]).path.replace('/works', '')


def test_a_full_openalex_url_is_accepted_where_an_id_is_expected(tools, openalex):
    result = tools.paper_citations({'workId': f'https://openalex.org/{WORK}/'})
    assert result['work'] == WORK


# --------------------------------------------------------------- chiều lùi

def test_backward_reads_the_reference_list_then_resolves_it_in_one_call(tools, openalex):
    result = tools.paper_citations({'workId': WORK, 'direction': 'backward', 'limit': 5})
    assert result['direction'] == 'backward' and result['total'] == 3
    assert result['count'] == 2 and result['title'] == 'Bài gốc'
    first = urllib.parse.parse_qs(urllib.parse.urlsplit(openalex[0]).query)
    second = urllib.parse.parse_qs(urllib.parse.urlsplit(openalex[1]).query)
    assert 'referenced_works' in first['select'][0]     # SỐNG qua `select`, đo được 2026-09-23
    assert 'filter' not in first
    assert second['filter'] == ['openalex_id:W1|W2|W3']  # MỘT lời gọi giải cả danh sách
    assert len(openalex) == 2


def test_a_long_reference_list_is_cut_at_the_resolve_constant(tools, monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        if 'works/' in url:
            return 200, 'application/json', json.dumps({'referenced_works': [
                f'https://openalex.org/W{i}' for i in range(1, 200)]}), url
        return 200, 'application/json', json.dumps({'results': []}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    result = tools.paper_citations({'workId': WORK, 'direction': 'backward', 'limit': 3})
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(calls[1]).query)
    ids = query['filter'][0].split(':', 1)[1].split('|')
    assert len(ids) == limits_module.PAPER_CITATIONS_RESOLVE_MAX
    assert result['total'] == 199 and result['count'] == 0   # trần là số ĐO ĐƯỢC, không im lặng


def test_a_work_without_references_does_not_spend_a_second_call(tools, monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        return 200, 'application/json', json.dumps({'referenced_works': []}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    result = tools.paper_citations({'workId': WORK, 'direction': 'backward'})
    assert result['total'] == 0 and result['count'] == 0 and len(calls) == 1


# --------------------------------------------------------------- hình dạng sai

@pytest.mark.parametrize('args, message', [
    ({}, 'workId'),
    ({'workId': WORK, 'direction': 'sideways'}, 'forward'),
    ({'workId': WORK, 'limit': 'nhiều'}, 'limit'),
])
def test_bad_arguments_say_what_is_missing(tools, args, message):
    with pytest.raises(WebError) as caught:
        tools.paper_citations(args)
    assert caught.value.code == 'WEB_URL_INVALID' and message in str(caught.value)


# --------------------------------------------------------------- thử lại

def test_a_rate_limited_provider_is_retried_once_and_the_retry_is_announced(monkeypatch, no_sleep):
    attempts = []
    seen = []

    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise WebError('WEB_SEARCH_UNAVAILABLE', 'crossref said HTTP 429')
        return 200, 'application/json', '{}', 'https://api.crossref.org/works'

    result = web_module._retry(flaky, on_retry=lambda attempt, exc: seen.append((attempt, exc.code)))
    assert result[0] == 200 and len(attempts) == 2
    assert seen == [(1, 'WEB_SEARCH_UNAVAILABLE')]
    assert no_sleep == [0.6]


def test_a_client_error_is_not_retried(monkeypatch, no_sleep):
    attempts = []

    def refused():
        attempts.append(1)
        raise WebError('WEB_SEARCH_UNAVAILABLE', 'the provider said HTTP 400')

    with pytest.raises(WebError):
        web_module._retry(refused)
    assert len(attempts) == 1 and no_sleep == []


def test_the_retry_honours_retry_after_up_to_the_cap(monkeypatch, no_sleep):
    attempts = []

    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise WebError('WEB_SEARCH_UNAVAILABLE', 'the provider said HTTP 429 (retry-after 2)')
        return 200, 'application/json', '{}', 'https://api.crossref.org/works'

    web_module._retry(flaky)
    assert no_sleep == [2.0]

    def slow():
        attempts.append(1)
        raise WebError('WEB_SEARCH_UNAVAILABLE', 'the provider said HTTP 429 (retry-after 900)')

    with pytest.raises(WebError):
        web_module._retry(slow, cap=5.0)
    assert no_sleep[-1] == 5.0


# --------------------------------------------------------------- chuỗi chân học thuật

def test_the_paper_chain_falls_through_to_crossref_and_names_the_provider(tools, no_sleep, monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        if 'openalex' in url:
            raise WebError('WEB_SEARCH_UNAVAILABLE', 'openalex said HTTP 503')
        body = {'message': {'items': [{'DOI': '10.1000/abc', 'title': ['Bài Crossref'],
                                       'issued': {'date-parts': [[2019]]},
                                       'container-title': ['Tạp chí'], 'is-referenced-by-count': 4}]}}
        return 200, 'application/json', json.dumps(body), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    result = tools.search({'query': 'hồ sơ chuyển tuyến', 'source': 'papers'})
    assert result['source'] == 'papers' and result['count'] == 1
    row = result['results'][0]
    assert row['provider'] == 'crossref' and row['doi'] == '10.1000/abc'
    assert row['url'] == 'https://doi.org/10.1000/abc' and row['year'] == 2019
    assert 'Tạp chí' in row['snippet'] and 'cited by 4' in row['snippet']
    # OpenAlex 503 → thử lại MỘT lần (đúng luật của `_retry`) → rồi mới rơi sang Crossref.
    assert len(calls) == 3 and no_sleep == [0.6]


def test_an_empty_openalex_answer_moves_the_chain_on_instead_of_stopping(monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        if 'openalex' in url:
            return 200, 'application/json', json.dumps({'meta': {'count': 0}, 'results': []}), url
        return 200, 'application/json', json.dumps({'resultList': {'result': [
            {'title': 'Bài Europe PMC', 'doi': '10.2/x', 'pubYear': '2021',
             'journalTitle': 'Lancet', 'citedByCount': 9}]}}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    with pytest.raises(WebError) as caught:
        web_module._provider_papers('y học', 3)
    assert 'openalex found nothing' in str(caught.value)
    rows = web_module._provider_europepmc('y học', 3)
    assert rows[0]['provider'] == 'europepmc' and rows[0]['url'] == 'https://doi.org/10.2/x'
    assert 'Lancet' in rows[0]['snippet'] and '9 citations' in rows[0]['snippet']
    assert len(calls) == 2                       # một lời gọi rỗng của OpenAlex, một của Europe PMC


def test_europe_pmc_falls_back_to_the_pmid_link_when_there_is_no_doi(monkeypatch):
    def fake(url, **kwargs):
        return 200, 'application/json', json.dumps({'resultList': {'result': [
            {'title': 'Không DOI', 'pmid': '12345', 'pubYear': '2018'}]}}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    rows = web_module._provider_europepmc('y học', 3)
    assert rows[0]['url'] == 'https://europepmc.org/article/MED/12345'


def test_a_provider_that_flaps_is_retried_inside_the_provider(monkeypatch, no_sleep):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            raise WebError('WEB_SEARCH_UNAVAILABLE', 'europepmc said HTTP 503')
        return 200, 'application/json', json.dumps({'resultList': {'result': [
            {'title': 'Bài thứ hai lần', 'pmid': '999', 'pubYear': '2022'}]}}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    rows = web_module._provider_europepmc('y học', 3)
    assert len(calls) == 2 and rows[0]['title'] == 'Bài thứ hai lần' and no_sleep == [0.6]


def test_arxiv_entries_are_parsed_from_the_atom_feed(monkeypatch):
    feed = ('<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/1706.03762v7</id>'
            '<title>Attention Is All You Need</title><published>2017-06-12T00:00:00Z</published>'
            '</entry><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Bài hai</title>'
            '<published>2024-01-01T00:00:00Z</published></entry></feed>')

    def fake(url, **kwargs):
        return 200, 'application/atom+xml', feed, url

    monkeypatch.setattr(web_module, 'http_request', fake)
    rows = web_module._provider_arxiv('electron', 2)
    assert [row['url'] for row in rows] == ['http://arxiv.org/abs/1706.03762v7',
                                            'http://arxiv.org/abs/2401.00001v1']
    assert rows[0]['year'] == 2017 and rows[0]['provider'] == 'arxiv'


def test_an_arxiv_refusal_names_the_quirk_instead_of_looking_empty(monkeypatch):
    def fake(url, **kwargs):
        return 200, 'application/atom+xml', '<feed></feed>', url

    monkeypatch.setattr(web_module, 'http_request', fake)
    with pytest.raises(WebError) as caught:
        web_module._provider_arxiv('referral', 3)
    assert '406' in str(caught.value)


# --------------------------------------------------------------- khai báo công cụ

def test_paper_citations_is_declared_with_both_directions_and_is_never_required():
    schema = next(item['function'] for item in contracts_module.SCHEMAS
                  if item['function']['name'] == 'paper_citations')
    assert schema['parameters']['required'] == []
    properties = schema['parameters']['properties']
    assert set(properties) == {'workId', 'doi', 'direction', 'limit'}
    assert properties['direction']['enum'] == ['backward', 'forward']
    assert '25' in properties['limit']['description']       # trần nằm trong mô tả model đọc
    assert 'openalex' in schema['description'].lower()
