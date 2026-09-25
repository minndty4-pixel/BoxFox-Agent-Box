"""A-4 — bộ đệm đọc (`ReadStore`) + `read_source`: đọc tài liệu dài theo mảnh.

ĐO ĐƯỢC 2026-09-23: `docs.python.org/3/whatsnew/3.13.html` dựng được **113 936** ký tự, nhưng một
lời gọi chỉ mang về trần 20 000 ký tự (trần ngữ cảnh) và 8 000 đầu là râu ria điều hướng ⇒ model
thấy 7 % tài liệu. Không ca nào dưới đây gọi mạng thật: `web.http_request` bị thay bằng fixture có
đếm số lời gọi, vì điều đáng ghim là **số lần chạm mạng**, không phải nội dung trang.
"""
import pytest

from agentbox.agent_core import reading as reading_module
from agentbox.agent_core import tool_groups as tool_groups_module
from agentbox.agent_core import web as web_module
from agentbox.agent_core.roles import ORCHESTRATOR_TOOLS, allowed_tools
from agentbox.agent_core.tool_contracts import SCHEMAS, schemas_for
from agentbox.agent_core.web import WebError, WebTools

DOC_SIZE = 60_000
DOC_LINE = 'Đoạn văn thật của tài liệu dài, có dấu tiếng Việt và con số 2026. '
DOC = (DOC_LINE * (DOC_SIZE // len(DOC_LINE) + 1))[:DOC_SIZE]
HIT = 'Chuyển tuyến bảo hiểm y tế cần hồ sơ gì'
DOC_WITH_HIT = DOC[:20_000] + HIT + DOC[20_000:]
URL = 'https://example.com/tai-lieu-dai'


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
def served(monkeypatch):
    """Trang dài trả lời qua `http_request` giả; trả về danh sách URL đã bị gọi."""
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
        return 200, 'text/plain', DOC_WITH_HIT, url

    monkeypatch.setattr(web_module, 'http_request', fake)
    return calls


# ------------------------------------------------------------- đường đọc theo mảnh

def test_a_truncated_fetch_hands_out_a_reference_and_a_next_offset(tools, served):
    first = tools.fetch({'url': URL})
    assert first['textChars'] == len(DOC_WITH_HIT)
    assert len(first['text']) == web_module.MAX_TEXT_DEFAULT      # 8 000 mặc định
    assert first['truncated'] is True and first['more'] is True
    assert first['offset'] == 0 and first['nextOffset'] == len(first['text'])
    assert first['ref'] and first['storedChars'] == len(DOC_WITH_HIT)
    assert first['fromStore'] is False
    assert served == [URL]


def test_every_slice_joins_back_into_the_original_document_with_one_network_call(tools, served):
    first = tools.fetch({'url': URL})
    pieces = [first['text']]
    offset, ref = first['nextOffset'], first['ref']
    while offset is not None:
        piece = tools.read_source({'ref': ref, 'offset': offset})
        assert piece['fromStore'] is True
        pieces.append(piece['text'])
        offset = piece['nextOffset']
    assert ''.join(pieces) == DOC_WITH_HIT, 'các mảnh phải nối lại ĐÚNG bản gốc'
    assert served == [URL], 'đọc tiếp không được chạm mạng lần thứ hai'


def test_reading_again_on_the_same_url_is_served_from_the_store(tools, served):
    tools.fetch({'url': URL})
    again = tools.fetch({'url': URL, 'offset': web_module.MAX_TEXT_DEFAULT})
    assert again['fromStore'] is True and served == [URL]
    assert again['text'] == DOC_WITH_HIT[web_module.MAX_TEXT_DEFAULT:
                                        web_module.MAX_TEXT_DEFAULT * 2]


def test_offset_zero_still_fetches_the_page_again(tools, served):
    """Hợp đồng cũ giữ nguyên: `web_fetch` không `offset` (hoặc `offset=0`) LUÔN tải mới."""
    tools.fetch({'url': URL})
    fresh = tools.fetch({'url': URL, 'offset': 0})
    assert fresh['fromStore'] is False and served == [URL, URL]


def test_reading_past_the_end_says_done_not_missing(tools, served):
    first = tools.fetch({'url': URL})
    end = tools.read_source({'ref': first['ref'], 'offset': len(DOC_WITH_HIT) + 5_000})
    assert end['text'] == '' and end['more'] is False and end['nextOffset'] is None
    assert end['storedChars'] == len(DOC_WITH_HIT)


def test_a_silly_offset_is_clamped_like_file_read(tools, served):
    tools.fetch({'url': URL})
    clamped = tools.fetch({'url': URL, 'offset': 'không-phải-số'})
    assert clamped['offset'] == 0 and clamped['fromStore'] is False
    assert served == [URL, URL]


def test_a_url_that_was_never_fetched_is_read_once_and_then_served(tools, served):
    first = tools.read_source({'url': URL})
    assert len(first['text']) == web_module.MAX_TEXT_DEFAULT and served == [URL]
    second = tools.read_source({'url': URL, 'offset': web_module.MAX_TEXT_DEFAULT})
    assert served == [URL], 'lời gọi thứ hai trên cùng URL phải phục vụ từ bộ đệm'
    assert second['fromStore'] is True


# ------------------------------------------------------------------- tìm đoạn liên quan

def test_find_folds_the_diacritics_and_starts_at_the_hit(tools, served):
    first = tools.fetch({'url': URL})
    found = tools.read_source({'ref': first['ref'], 'find': ['chuyen tuyen']})
    assert found['matches'] == [{'term': 'chuyen tuyen', 'offset': DOC_WITH_HIT.index(HIT)}]
    assert found['text'].startswith(HIT), 'mảnh trả về phải bắt đầu NGAY TẠI đoạn liên quan'
    assert found['offset'] == DOC_WITH_HIT.index(HIT)
    assert served == [URL]


def test_find_without_a_hit_says_how_long_the_document_is(tools, served):
    first = tools.fetch({'url': URL})
    found = tools.read_source({'ref': first['ref'], 'find': ['khong-co-tu-nay']})
    assert found['matches'] == []
    assert str(len(DOC_WITH_HIT)) in found['hint']


def test_find_accepts_extra_terms_but_keeps_four(tools, served):
    first = tools.fetch({'url': URL})
    found = tools.read_source({'ref': first['ref'],
                               'find': ['mot', 'hai', 'ba', 'bon', 'nam', 'sau']})
    assert len(found['matches']) <= 4


# ------------------------------------------------------------------------- lỗi

def test_read_source_without_a_reference_or_a_url_is_refused(tools):
    with pytest.raises(WebError) as caught:
        tools.read_source({'offset': 5})
    assert caught.value.code == 'WEB_READ_REF_MISSING'


def test_an_unknown_reference_is_refused_with_a_reason(tools, served):
    with pytest.raises(WebError) as caught:
        tools.read_source({'ref': 'r99'})
    assert caught.value.code == 'WEB_READ_REF_UNKNOWN'
    assert 'web_fetch' in str(caught.value)


def test_the_read_store_switch_off_stores_nothing_and_kills_references(tools, served, monkeypatch):
    monkeypatch.setenv('BOXFOX_WEB_READ_STORE', 'off')
    first = tools.fetch({'url': URL})
    assert first['ref'] is None and first['storedChars'] == 0
    assert first['fromStore'] is False
    again = tools.fetch({'url': URL, 'offset': 20_000})
    assert again['fromStore'] is False and served == [URL, URL]
    with pytest.raises(WebError) as caught:
        tools.read_source({'ref': 'r1'})
    assert caught.value.code == 'WEB_READ_REF_UNKNOWN'


# --------------------------------------------------------------- bộ đệm (đơn vị)

def test_the_store_drops_the_oldest_entry_when_it_is_full():
    store = reading_module.ReadStore(max_entries=2)
    first = store.put(url='https://a.example/1', final='https://a.example/1', text='một')
    second = store.put(url='https://a.example/2', final='https://a.example/2', text='hai')
    third = store.put(url='https://a.example/3', final='https://a.example/3', text='ba')
    assert len(store) == 2 and store.get(first['ref']) is None
    assert store.get(second['ref'])['text'] == 'hai' and store.get(third['ref'])['text'] == 'ba'


def test_a_touched_entry_survives_the_next_eviction():
    store = reading_module.ReadStore(max_entries=2)
    first = store.put(url='https://a.example/1', final='https://a.example/1', text='một')
    second = store.put(url='https://a.example/2', final='https://a.example/2', text='hai')
    store.get(first['ref'])                                     # chạm vào bản cũ nhất
    store.put(url='https://a.example/3', final='https://a.example/3', text='ba')
    assert store.get(first['ref']) is not None and store.get(second['ref']) is None


def test_the_store_respects_the_total_budget():
    store = reading_module.ReadStore(max_entries=10, entry_max_chars=100, max_chars=250)
    first = store.put(url='https://a.example/1', final='https://a.example/1', text='x' * 100)
    store.put(url='https://a.example/2', final='https://a.example/2', text='y' * 100)
    store.put(url='https://a.example/3', final='https://a.example/3', text='z' * 100)
    assert store.total_chars == 200 and store.get(first['ref']) is None


def test_one_entry_is_capped_and_says_how_much_was_kept():
    store = reading_module.ReadStore(entry_max_chars=1_000)
    entry = store.put(url='https://a.example/dai', final='https://a.example/dai', text='x' * 5_000)
    assert entry['storedChars'] == 1_000 and len(entry['text']) == 1_000


def test_the_cache_key_ignores_tracking_but_keeps_the_query():
    assert reading_module.normalize_url(
        'https://WWW.Example.com/van-ban/x.aspx?ItemID=1&utm_source=fb&fbclid=z#frag'
    ) == 'https://example.com/van-ban/x.aspx?ItemID=1'
    assert reading_module.normalize_url('https://example.com/a') != \
        reading_module.normalize_url('https://example.com/b')


def test_a_fetch_without_a_stored_copy_keeps_the_old_payload_keys(tools, monkeypatch):
    """F23: `source_verify` (Phạm vi B) gọi `fetch(args)` cũ — khoá cũ phải còn đủ."""
    monkeypatch.setattr(web_module, 'http_request',
                        lambda url, **kwargs: (200, 'text/html',
                                               '<html><head><title>X</title></head><body>'
                                               '<p>' + 'nội dung thật ' * 60 + '</p></body></html>', url))
    result = tools.fetch({'url': 'https://example.com/doc'})
    for key in ('url', 'finalUrl', 'host', 'status', 'contentType', 'title', 'text', 'textChars',
                'truncated', 'links', 'reader', 'untrusted', 'note', 'fetchedAt'):
        assert key in result, key
    assert {key for key in result if key in ('ref', 'offset', 'nextOffset', 'more', 'storedChars',
                                             'fromStore')} == {'ref', 'offset', 'nextOffset', 'more',
                                                               'storedChars', 'fromStore'}


# ------------------------------------------------------------------- khai báo công cụ

def test_the_read_tool_is_advertised_and_held_where_it_must_be():
    names = {entry['function']['name'] for entry in SCHEMAS}
    assert 'read_source' in names
    schema = schemas_for({'read_source'})[0]['function']['parameters']
    assert schema['required'] == [], 'một trong hai (`ref`, `url`) là đủ nên không tham số nào bắt buộc'
    assert set(schema['properties']) == {'ref', 'url', 'offset', 'maxChars', 'find'}
    assert schema['properties']['find']['type'] == 'array'
    assert 'read_source' in allowed_tools('research') and 'read_source' in ORCHESTRATOR_TOOLS
    for role in ('explore', 'plan', 'plan-review', 'build', 'debug', 'review', 'simplify', 'testing'):
        assert 'read_source' not in allowed_tools(role), role
    group = next(item for item in tool_groups_module.TOOL_GROUPS if item['key'] == 'webResearch')
    assert group['tools'] == ['web_search', 'web_fetch', 'read_source', 'paper_citations']
