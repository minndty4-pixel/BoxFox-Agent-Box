"""A-7 (vòng 27, đợt 2): `web_search` gộp nhiều chân keyless — nhiều truy vấn, khử trùng, cache, thử lại.

Không ca nào gọi mạng: `web.http_request` và `web.GENERAL_PROVIDERS` đều bị thay bằng fixture.
Mọi con số trong tệp là số **đo được** ngày 2026-09-23 (xem `docs/plan/v27/subplans/reading.md` §7):
`site:`/`tbs=qdr:m`/`lang=vi` được Firecrawl nhận, `sources=[…]` và `page=2` trả **400**, cùng một
truy vấn tốn ~0,7 s mỗi lần nên cache TTL 300 s là chỗ chống đốt chân keyless duy nhất.
"""
import json

import pytest

from agentbox.agent_core import web as web_module
from agentbox.agent_core.tool_contracts import SCHEMAS, schemas_for
from agentbox.agent_core.web import WebError, WebTools

PUBLIC_IP = '93.184.216.34'


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    monkeypatch.setattr(web_module.socket, 'getaddrinfo',
                        lambda host, port, **kwargs: [(2, 1, 6, '', (PUBLIC_IP, 0))])


@pytest.fixture
def tools(tmp_path, monkeypatch):
    import agentbox.observability.system_log as system_log_module
    monkeypatch.setattr(system_log_module.system_log, 'directory', tmp_path)
    monkeypatch.setattr(system_log_module.system_log, 'path', tmp_path / 'harness.jsonl')
    return WebTools()


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    """Thử lại không được làm bộ test chậm: ghi lại thời gian chờ thay vì ngủ thật."""
    waits: list[float] = []
    monkeypatch.setattr(web_module.time, 'sleep', lambda seconds: waits.append(seconds))
    return waits


def _row(url: str, title: str = 'Tiêu đề', snippet: str = 'đoạn mô tả') -> dict:
    return {'title': title, 'url': url, 'snippet': snippet, 'provider': 'fake'}


def _chain(monkeypatch, provider):
    monkeypatch.setattr(web_module, 'GENERAL_PROVIDERS', (provider,))


def _errors(tmp_path):
    raw = (tmp_path / 'harness.jsonl').read_text()
    return [json.loads(line) for line in raw.splitlines()]


# ------------------------------------------------------------------ nhiều truy vấn

def test_two_queries_are_merged_and_a_repeated_url_collapses(tools, monkeypatch):
    seen: list[str] = []

    def provider(query, count, options=None):
        seen.append(query)
        if 'thứ hai' in query:
            return [_row('https://example.com/a'), _row('https://example.com/b')]
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'truy vấn đầu', 'queries': ['truy vấn thứ hai']})
    assert seen == ['truy vấn đầu', 'truy vấn thứ hai'], 'các truy vấn chạy tuần tự, đúng thứ tự'
    assert [row['url'] for row in result['results']] == ['https://example.com/a', 'https://example.com/b']
    assert result['count'] == 2 and result['deduped'] == 1
    assert result['perQuery'] == [{'query': 'truy vấn đầu', 'count': 1},
                                 {'query': 'truy vấn thứ hai', 'count': 2}]
    assert result['queries'] == ['truy vấn đầu', 'truy vấn thứ hai']


def test_a_refused_leg_is_named_in_per_query_instead_of_disappearing(tools, monkeypatch):
    """Một chân hỏng mà chân khác còn kết quả thì KHÔNG được im lặng (chân keyless bị giới hạn nhịp)."""

    def provider(query, count, options=None):
        if 'hai' in query:
            raise WebError('WEB_SEARCH_UNAVAILABLE', 'the keyless search provider refused the query (HTTP 429)')
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'một', 'queries': ['hai']})
    assert result['count'] == 1
    assert result['perQuery'][0] == {'query': 'một', 'count': 1}
    assert result['perQuery'][1]['count'] == 0 and 'HTTP 429' in result['perQuery'][1]['error']


def test_a_real_type_error_inside_a_leg_is_named_and_not_probed_away(tools, monkeypatch):
    """Chân ném `TypeError` THẬT ⇒ gọi đúng MỘT lần và tên lỗi nói ra `TypeError`.

    Lớp dò chữ ký cũ (`_call_provider`) đoán "chân này không nhận options" rồi gọi lại hai tham số —
    vừa khiến mỗi chân bị gọi hai lần, vừa giấu lỗi thật sau một phép đoán. Nay mọi chân nhận cùng ba
    tham số (`(query, count, options=None)`), nên lỗi thật đi thẳng ra ngoài.
    """
    calls: list[str] = []

    def broken(query, count, options=None):
        calls.append(query)
        raise TypeError("'NoneType' object is not subscriptable")

    _chain(monkeypatch, broken)
    with pytest.raises(WebError) as caught:
        tools.search({'query': 'một'})
    message = str(caught.value)
    assert calls == ['một'], 'chân hỏng bị gọi đúng MỘT lần, không dò chữ ký'
    assert 'unreadable answer (TypeError)' in message and 'option' not in message.lower()


def test_a_leg_that_raises_still_lets_the_next_leg_answer(tools, monkeypatch):
    """Chân đầu ném lỗi thật thì rơi tiếp: chân sau vẫn có lượt, kết quả không bị mất."""

    def broken(query, count, options=None):
        raise TypeError('chân hỏng')

    def good(query, count, options=None):
        return [_row('https://example.com/ok')]

    monkeypatch.setattr(web_module, 'GENERAL_PROVIDERS', (broken, good))
    result = tools.search({'query': 'một'})
    assert result['count'] == 1 and result['results'][0]['url'] == 'https://example.com/ok'


def test_the_query_list_is_capped_and_de_duplicated(tools, monkeypatch):
    seen: list[str] = []

    def provider(query, count, options=None):
        seen.append(query)
        return [_row(f'https://example.com/{len(seen)}')]

    _chain(monkeypatch, provider)
    tools.search({'query': 'một', 'queries': ['hai', 'ba', 'bốn', 'năm', 'MỘT']})
    assert seen == ['một', 'hai', 'ba'], 'trần 3 truy vấn; truy vấn trùng (không phân biệt hoa thường) bị bỏ'


def test_site_narrows_every_query_without_touching_the_rest(tools, monkeypatch):
    seen: list[str] = []

    def provider(query, count, options=None):
        seen.append(query)
        return [_row('https://chinhphu.vn/a')]

    _chain(monkeypatch, provider)
    tools.search({'query': 'hồ sơ chuyển tuyến', 'site': 'https://www.chinhphu.vn/van-ban'})
    assert seen == ['site:chinhphu.vn hồ sơ chuyển tuyến'], 'site gộp vào truy vấn, bỏ www và đường dẫn'


def test_a_bad_site_or_freshness_is_refused(tools, monkeypatch):
    _chain(monkeypatch, lambda query, count, options=None: [_row('https://example.com/a')])
    for args in ({'query': 'x', 'site': 'không phải tên miền'}, {'query': 'x', 'freshness': 'tuần'}):
        with pytest.raises(WebError) as caught:
            tools.search(args)
        assert caught.value.code == 'WEB_URL_INVALID', args


# ---------------------------------------------------------------------- khử trùng

def test_a_near_duplicate_is_merged_and_keeps_the_second_url_in_also_from(tools, monkeypatch):
    body = ('Thông tư quy định chi tiết về hồ sơ chuyển tuyến bảo hiểm y tế và thủ tục thanh toán '
            'chi phí khám bệnh chữa bệnh theo quy định của pháp luật hiện hành')

    def provider(query, count, options=None):
        return [_row('https://vietnamplus.vn/a', 'Thông tư chuyển tuyến bảo hiểm y tế', body),
                _row('https://baotintuc.vn/bản-sao', 'Thông tư chuyển tuyến bảo hiểm y tế', body)]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'chuyển tuyến'})
    assert result['count'] == 1 and result['deduped'] == 1
    assert result['results'][0]['url'] == 'https://vietnamplus.vn/a', 'giữ bản ĐẦU'
    assert result['results'][0]['alsoFrom'] == ['https://baotintuc.vn/bản-sao']


def test_short_results_with_the_same_title_shape_are_not_merged(tools, monkeypatch):
    """Tiêu đề vài chữ cho Jaccard 1,0 với mọi tiêu đề cùng khuôn ⇒ luật gần trùng phải có ngưỡng từ."""

    def provider(query, count, options=None):
        return [_row(f'https://example.com/{index}', f'Kết quả {index}', 'đoạn mô tả ' + 'x' * 600)
                for index in range(2)]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'x', 'count': 2})
    assert result['count'] == 2 and result['deduped'] == 0


def test_urls_that_only_differ_by_tracking_parameters_are_one_result(tools, monkeypatch):
    def provider(query, count, options=None):
        return [_row('https://example.com/bai?utm_source=fb&fbclid=1'),
                _row('https://www.example.com/bai?utm_source=zalo')]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'x'})
    assert result['count'] == 1 and result['deduped'] == 1


def test_exclude_drops_hosts_and_leaves_the_query_alone(tools, monkeypatch):
    seen: list[str] = []

    def provider(query, count, options=None):
        seen.append(query)
        return [_row('https://youtube.com/watch?v=1'), _row('https://chinhphu.vn/a')]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'hồ sơ chuyển tuyến', 'exclude': ['https://www.youtube.com/@x']})
    assert seen == ['hồ sơ chuyển tuyến'], 'exclude lọc kết quả, không cắt truy vấn'
    assert [row['url'] for row in result['results']] == ['https://chinhphu.vn/a']


def test_exclude_is_not_on_by_default(tools, monkeypatch):
    """#5991: trang mạng xã hội chính thức của cơ quan vẫn dùng được ⇒ không cấm mặc định."""
    _chain(monkeypatch, lambda query, count, options=None: [_row('https://facebook.com/coquan')])
    assert tools.search({'query': 'x'})['count'] == 1


# --------------------------------------------------------------------------- cache

def test_a_second_identical_call_is_served_from_the_cache(tools, monkeypatch):
    calls: list[str] = []

    def provider(query, count, options=None):
        calls.append(query)
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    first = tools.search({'query': 'bệnh án điện tử'})
    second = tools.search({'query': 'bệnh án điện tử'})
    assert calls == ['bệnh án điện tử'], 'lời gọi thứ hai không chạm nhà cung cấp'
    assert first['cached'] is False and second['cached'] is True
    assert second['fetchedAt'] == first['fetchedAt'], 'thời điểm tải là của bản gốc, không phải của lượt đọc cache'
    assert second['results'] == first['results']


def test_a_different_filter_is_a_different_cache_entry(tools, monkeypatch):
    calls: list[str] = []

    def provider(query, count, options=None):
        calls.append(str((options or {}).get('freshness')))
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    tools.search({'query': 'x'})
    tools.search({'query': 'x', 'freshness': 'month'})
    tools.search({'query': 'x'})
    assert calls == ['', 'month'], 'khoá cache gồm bộ lọc đã chuẩn hoá; lượt thứ ba quay lại mục đầu'


def test_the_cache_expires_after_the_ttl(tools, monkeypatch):
    calls: list[int] = []
    clock = {'now': 1000.0}
    monkeypatch.setattr(web_module.time, 'time', lambda: clock['now'])

    def provider(query, count, options=None):
        calls.append(1)
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    tools.search({'query': 'x'})
    clock['now'] += web_module.SEARCH_CACHE_TTL_SECONDS + 1
    tools.search({'query': 'x'})
    assert len(calls) == 2, 'quá TTL thì phải hỏi lại'


def test_a_cached_call_writes_exactly_one_dev_log_line(tools, tmp_path, monkeypatch):
    """Một lời gọi = MỘT dòng `web.search`: nhánh cache từng tự ghi thêm một dòng nữa."""
    import asyncio

    calls: list[int] = []

    def provider(query, count, options=None):
        calls.append(1)
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    asyncio.run(tools.run('web_search', {'query': 'x'}, 'sess-cache'))
    second = asyncio.run(tools.run('web_search', {'query': 'x'}, 'sess-cache'))
    assert second['cached'] is True and len(calls) == 1
    lines = _errors(tmp_path)
    assert [line['event'] for line in lines] == ['web.search', 'web.search']
    assert lines[-1]['data'].get('cached') is True and lines[-1]['sessionId'] == 'sess-cache'


def test_a_wide_search_stays_under_the_runtime_cap_and_reports_dropped_rows(tools, monkeypatch):
    """3 chân × 10 hàng × đoạn trích 400 ký tự phải KHÔNG vượt ngân sách, và phải NÓI RA số hàng bỏ.

    Runtime cắt kết quả công cụ ở 24 000 ký tự (giữ 20 000): payload dài hơn sẽ bị cắt giữa JSON.
    """
    def provider(query, count, options=None):
        return [_row(f'https://example.com/{query}/{index}', title='T' * 400, snippet='S' * 400)
                for index in range(count)]

    _chain(monkeypatch, provider)
    payload = tools.search({'query': 'a', 'queries': ['b', 'c'], 'count': 10})
    assert payload['count'] == len(payload['results']) and payload['dropped'] > 0
    assert len(json.dumps(payload, ensure_ascii=False)) < 24_000
    kept = {row['url'] for row in payload['results']}
    assert kept <= {row['url'] for row in provider('a', 10)} | \
        {row['url'] for row in provider('b', 10)} | {row['url'] for row in provider('c', 10)}
    assert payload['results'][0]['url'].endswith('/a/0'), 'cắt ở ĐUÔI, hàng của chân chính đứng đầu'


def test_a_pair_just_over_the_threshold_merges_and_keeps_the_lost_url(tools, monkeypatch):
    """Biên của luật gần trùng: cặp VỪA qua ngưỡng vẫn gộp, nhưng URL không mất (nằm trong `alsoFrom`)."""
    shared = 'ho so chuyen tuyen bao hiem y te can gi'
    first = _row('https://benhvien-a.vn/bai', title=shared,
                 snippet='cau mo ta chung cua hai trang khac nhau ve thu tuc hanh chinh')
    second = _row('https://benhvien-b.vn/bai', title=shared,
                  snippet='cau mo ta chung cua hai trang khac nhau ve thu tuc hanh chinh dai hon')
    _chain(monkeypatch, lambda query, count, options=None: [first, second])
    payload = tools.search({'query': 'x'})
    assert payload['count'] == 1 and payload['deduped'] == 1
    assert payload['results'][0]['alsoFrom'] == ['https://benhvien-b.vn/bai']


# -------------------------------------------------------------------------- thử lại

def test_a_rate_limited_leg_is_retried_and_the_retry_is_logged(tools, tmp_path, monkeypatch):
    calls: list[int] = []

    def provider(query, count, options=None):
        calls.append(1)
        if len(calls) == 1:
            raise WebError('WEB_SEARCH_UNAVAILABLE', 'the keyless search provider refused the query (HTTP 429)')
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    result = tools.search({'query': 'x'})
    assert result['count'] == 1 and len(calls) == 2
    retries = [line for line in _errors(tmp_path) if line['event'] == 'web.retry']
    assert len(retries) == 1 and retries[0]['code'] == 'WEB_SEARCH_UNAVAILABLE'
    assert retries[0]['data'] == {'attempt': 1}, 'dòng thử lại chỉ mang SỐ ĐẾM, không truy vấn'
    assert 'x' not in (tmp_path / 'harness.jsonl').read_text().split('"queryChars"')[0]


def test_a_client_error_is_not_retried(tools, monkeypatch):
    calls: list[int] = []

    def provider(query, count, options=None):
        calls.append(1)
        raise WebError('WEB_SEARCH_UNAVAILABLE', 'the keyless search provider refused the query (HTTP 400)')

    _chain(monkeypatch, provider)
    with pytest.raises(WebError):
        tools.search({'query': 'x'})
    assert len(calls) == 1, '400 không đáng thử lại'


def test_the_retry_honours_retry_after_up_to_the_cap(tools, no_sleep, monkeypatch):
    calls: list[int] = []

    def provider(query, count, options=None):
        calls.append(1)
        if len(calls) == 1:
            raise WebError('WEB_FETCH_FAILED', 'https://api.example/x answered HTTP 429 (retry-after 2)')
        return [_row('https://example.com/a')]

    _chain(monkeypatch, provider)
    tools.search({'query': 'x'})
    assert no_sleep == [2.0], 'chờ đúng `Retry-After` chứ không theo bước lùi'


def test_every_leg_failing_names_the_missing_keys(tools, monkeypatch):
    for key in ('FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'BOXFOX_BRAVE_API_KEY', 'TAVILY_API_KEY',
                'EXA_API_KEY', 'PARALLEL_API_KEY'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(web_module, 'http_request', lambda url, **kwargs: (_ for _ in ()).throw(
        WebError('WEB_FETCH_FAILED', f'{url} answered HTTP 500: boom')))
    monkeypatch.setattr(web_module, 'GENERAL_PROVIDERS',
                        (web_module._provider_firecrawl, web_module._provider_brave, web_module._provider_tavily))
    with pytest.raises(WebError) as caught:
        tools.search({'query': 'x'})
    message = str(caught.value)
    assert 'BRAVE_API_KEY' in message and 'TAVILY_API_KEY' in message, 'thông điệp phải KỂ TÊN khoá thiếu'
    assert 'EXA_API_KEY' in message


def test_the_extra_legs_are_keyed_and_say_so(tools, monkeypatch):
    for key in ('EXA_API_KEY', 'PARALLEL_API_KEY'):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(WebError) as exa:
        web_module._provider_exa('x', 1)
    with pytest.raises(WebError) as parallel:
        web_module._provider_parallel('x', 1)
    assert 'EXA_API_KEY is not set' in str(exa.value) and 'PARALLEL_API_KEY is not set' in str(parallel.value)


# ---------------------------------------------------------- không phân trang (đo được)

def test_freshness_sets_the_window_and_paging_parameters_are_never_sent(tools, monkeypatch):
    bodies: list[dict] = []

    def fake(url, **kwargs):
        bodies.append(json.loads(kwargs.get('body') or b'{}'))
        return 200, 'application/json', json.dumps({'success': True, 'data': [
            {'url': 'https://example.com/a', 'title': 'A', 'description': 'mô tả'}]}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    tools.search({'query': 'x', 'freshness': 'month', 'lang': 'vi'})
    assert bodies[0]['tbs'] == 'qdr:m'
    assert bodies[0]['lang'] == 'vi'
    assert 'sources' not in bodies[0], 'ĐO ĐƯỢC: `sources=[…]` ⇒ 400'
    assert 'page' not in bodies[0], 'ĐO ĐƯỢC: `page=2` ⇒ 400'
    assert bodies[0]['limit'] == web_module.DEFAULT_RESULTS


def test_the_brave_leg_translates_freshness(tools, monkeypatch):
    seen: list[str] = []

    def fake(url, **kwargs):
        seen.append(url)
        return 200, 'application/json', json.dumps({'web': {'results': [
            {'url': 'https://example.com/b', 'title': 'B', 'description': 'mô tả'}]}}), url

    monkeypatch.setattr(web_module, 'http_request', fake)
    monkeypatch.setenv('BRAVE_API_KEY', 'unit-key')
    monkeypatch.setattr(web_module, 'GENERAL_PROVIDERS', (web_module._provider_brave,))
    tools.search({'query': 'x', 'freshness': 'week'})
    assert 'freshness=pw' in seen[0]


# ------------------------------------------------------------------------ hợp đồng

def test_the_schema_advertises_the_new_arguments_and_keeps_the_contract(tools):
    schema = schemas_for({'web_search'})[0]['function']['parameters']
    assert schema['required'] == ['query'], 'không thêm tham số bắt buộc nào'
    assert {'queries', 'site', 'freshness', 'lang', 'exclude'} <= set(schema['properties'])
    assert schema['properties']['queries']['maxItems'] == web_module.SEARCH_QUERY_MAX - 1
    assert schema['properties']['freshness']['enum'] == ['day', 'week', 'month', 'year']
    assert schema['properties']['source']['enum'] == ['web', 'wikipedia', 'stackoverflow', 'github', 'papers']
    assert len([entry for entry in SCHEMAS if entry['function']['name'] == 'web_search']) == 1


def test_the_search_cache_is_bounded_and_keyed_by_normalised_arguments(tools, monkeypatch):
    calls: list[str] = []

    def provider(query, count, options=None):
        calls.append(query)
        return [_row(f'https://example.com/{len(calls)}')]

    _chain(monkeypatch, provider)
    for index in range(web_module.SEARCH_CACHE_MAX_ENTRIES + 2):
        tools.search({'query': f'x{index}'})
    assert len(tools._search_cache) == web_module.SEARCH_CACHE_MAX_ENTRIES
    assert len(calls) == web_module.SEARCH_CACHE_MAX_ENTRIES + 2, 'mỗi truy vấn mới vẫn phải hỏi nhà cung cấp'
