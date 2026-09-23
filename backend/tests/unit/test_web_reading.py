"""Lớp đọc nguồn (vòng 27 · Phạm vi A, đợt 1): giải nén, kiểm thân bài, thang đọc, tầng PDF.

Không ca nào gọi mạng: `web.http_request` (seam cũ) hoặc `urllib.request.build_opener`
đều được thay bằng fixture, còn `reading.py` là hàm thuần. Mọi con số trong tệp này là
số **đo được** ngày 2026-09-23 (xem `docs/plan/v27/subplans/reading.md` §0 và
`docs/tracking/test-rounds.md`): Nhân Dân 17 421 ký tự rác / junk 0,550, PDF 0,517,
văn xuôi thật 0,0000.
"""
import email.message
import gzip
import zlib

import pytest

from agentbox.agent_core import reading, web as web_module
from agentbox.agent_core.web import WebError, WebTools

PUBLIC_IP = '93.184.216.34'

NHAN_DAN_HTML = ('<html><head><title>Báo Nhân Dân điện tử</title></head><body><h1>Danh mục</h1>'
                 '<p>' + ('Kinh tế · Chính trị · Xã hội · Văn hoá · Thể thao. ' * 30) + '</p></body></html>')
NHAN_DAN_TEXT = 'Danh mục\n\nBáo Nhân Dân điện tử\n\nKinh tế · Chính trị · Xã hội'


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


def _headers(ctype='text/html; charset=utf-8', encoding=None):
    message = email.message.Message()
    message['Content-Type'] = ctype
    if encoding:
        message['Content-Encoding'] = encoding
    return message


class _FakeResponse:
    def __init__(self, body: bytes, *, status=200, ctype='text/html; charset=utf-8',
                 encoding=None, url='https://example.com/a', incomplete=False):
        self.status = status
        self.headers = _headers(ctype, encoding)
        self._body = body
        self._url = url
        self._incomplete = incomplete

    def read(self, size=-1):
        if self._incomplete:
            raise web_module.http.client.IncompleteRead(self._body)
        return self._body

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Opener:
    def __init__(self, handler):
        self._handler = handler

    def open(self, request, timeout=None):
        return self._handler(request.full_url)


def _serve(monkeypatch, handler):
    """Route every request through ``handler(url) -> _FakeResponse`` (no socket is opened)."""
    monkeypatch.setattr(web_module.urllib.request, 'build_opener', lambda *a, **k: _Opener(handler))


# ------------------------------------------------------------------ A-1: gzip / deflate

def test_a_gzip_answer_is_inflated_before_it_reaches_the_model(tools, monkeypatch):
    body = gzip.compress(NHAN_DAN_HTML.encode())
    _serve(monkeypatch, lambda url: _FakeResponse(body, encoding='gzip', url=url))
    payload = tools.fetch({'url': 'https://nhandan.vn/trang-chu'})
    assert payload['contentEncoding'] == 'gzip' and payload['decoded'] is True
    assert payload['quality']['junkRatio'] == 0.0
    assert 'Kinh tế · Chính trị · Xã hội' in payload['text']
    assert payload['textChars'] < 5000, 'thân bài thật nhỏ hơn nhiều so với 17 421 ký tự rác'
    assert payload['quality']['verdict'] == 'ok'


def test_the_same_gzip_bytes_without_the_header_are_still_inflated(monkeypatch):
    body = gzip.compress(NHAN_DAN_HTML.encode())
    text, meta = reading.decode_body(body, _headers())
    assert meta['decoded'] is True and meta['contentEncoding'] == 'gzip'
    assert 'Báo Nhân Dân điện tử' in text


def test_the_junk_the_old_code_returned_is_measurably_not_prose():
    """Số đo cũ: thân bài gzip đọc thẳng ra 17 421 "ký tự" mà 55 % không thể là văn xuôi."""
    junk = gzip.compress(NHAN_DAN_HTML.encode()).decode('utf-8', errors='replace')
    assert reading.junk_ratio(junk) > 0.10
    assert reading.body_check(junk)['verdict'] == 'junk'
    assert reading.junk_ratio(NHAN_DAN_TEXT) == 0.0


def test_a_compressed_bomb_is_bounded(monkeypatch):
    bomb = gzip.compress(b'\x00' * (2 * 1024 * 1024))
    text, meta = reading.decode_body(bomb, _headers(encoding='gzip'), max_inflated_bytes=4096)
    assert meta['decodeTruncated'] is True
    assert len(text) <= 4096


def test_deflate_is_inflated_in_both_encodings():
    raw = NHAN_DAN_HTML.encode()
    zlib_wrapped = zlib.compress(raw)
    raw_deflate = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    bare = raw_deflate.compress(raw) + raw_deflate.flush()
    for body in (zlib_wrapped, bare):
        text, meta = reading.decode_body(body, _headers(encoding='deflate'))
        assert meta['decoded'] is True and 'Báo Nhân Dân' in text


def test_a_brotli_answer_is_an_explicit_error_not_junk():
    with pytest.raises(WebError) as caught:
        reading.decode_body(b'\x21\x0c\x00\x00', _headers(encoding='br'))
    assert 'brotli' in str(caught.value)


def test_the_decode_switch_restores_the_old_behaviour():
    body = gzip.compress(NHAN_DAN_HTML.encode())
    text, meta = reading.decode_body(body, _headers(encoding='gzip'), mode='off')
    assert meta['decoded'] is False
    assert reading.junk_ratio(text) > 0.10, 'tắt giải nén nghĩa là quay lại đúng rác như trước'


def test_a_body_that_stops_early_is_kept_as_partial(tools, monkeypatch):
    partial = NHAN_DAN_HTML.encode() + '<p>cắt giữa đường'.encode()
    _serve(monkeypatch, lambda url: _FakeResponse(partial, incomplete=True, url=url))
    payload = tools.fetch({'url': 'https://vnexpress.net/bai-dai'})
    assert payload['partial'] is True
    assert 'Kinh tế · Chính trị' in payload['text'] and 'cắt giữa đường' in payload['text']


# -------------------------------------------------------- A-2: junk / error / wrong page

def test_junk_ratio_separates_measured_junk_from_measured_prose():
    pdf_bytes = b'%PDF-1.4\n' + bytes(range(256)) * 8
    assert reading.junk_ratio(pdf_bytes.decode('utf-8', errors='replace')) > 0.10
    prose = ('Trang chủ\n\nBảo hiểm y tế chi trả cho người bệnh chuyển tuyến đúng quy định. ' * 10)
    assert reading.junk_ratio(prose) == 0.0
    assert reading.body_check(prose)['verdict'] == 'ok'


def test_an_error_page_is_named_a_thin_page_is_advice_and_a_wrong_page_is_named():
    warning = 'Warning: This page maybe not yet fully loaded'
    thin = reading.body_check(warning, status=200, content_type='text/markdown', reader='r.jina.ai')
    assert thin['verdict'] == 'error-page' and thin['underMinChars'] is True

    short = reading.body_check('Thông báo: hồ sơ đã được tiếp nhận, hẹn trả kết quả sau ba ngày làm việc.')
    assert short['verdict'] == 'thin', 'thân bài ngắn THẬT vẫn được trả về, chỉ kèm lời khuyên'

    page_404 = ('![Image 2: 404 Error](https://vbpl.vn/404.png)\n\nVăn bản không tồn tại\n' + 'x' * 900)
    assert reading.body_check(page_404)['verdict'] == 'error-page'

    home_page = 'Trang chủ\n\n' + ('Danh mục văn bản pháp luật · tra cứu · hướng dẫn. ' * 20)
    home = reading.body_check(home_page, url='https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=1',
                              title='Trang chủ')
    assert home['verdict'] == 'wrong-page', 'ĐO ĐƯỢC: URL văn bản trả về trang chủ 27 378 byte'


def test_a_real_vietnamese_page_is_not_called_junk():
    page = ('Bảo hiểm y tế: hồ sơ chuyển tuyến gồm giấy chuyển tuyến, thẻ bảo hiểm và căn cước. '
            * 20)
    checked = reading.body_check(page, url='https://kcb.vn/tin-tuc/chuyen-tuyen', title='Chuyển tuyến')
    assert checked['verdict'] == 'ok' and checked['junkRatio'] == 0.0


# ------------------------------------------------------------------ A-3: read ladder

def test_the_ladder_decides_from_the_verdict_and_never_from_thin_alone():
    assert reading.ladder_plan(verdict='junk') == {'use_reader': True, 'reason': 'junk'}
    assert reading.ladder_plan(verdict='error-page')['reason'] == 'error-page'
    assert reading.ladder_plan(verdict='wrong-page')['reason'] == 'wrong-page'
    assert reading.ladder_plan(verdict='ok') == {'use_reader': False, 'reason': 'none'}
    assert reading.ladder_plan(verdict='ok', is_pdf=True)['reason'] == 'pdf'
    assert reading.ladder_plan(verdict='ok', status=403)['reason'] == 'http-status'
    assert reading.ladder_plan(verdict='ok', direct_error=True)['reason'] == 'unreachable'
    assert reading.ladder_plan(verdict='ok', mode='off') == {'use_reader': False, 'reason': 'none'}


def test_the_reader_is_tried_for_a_forbidden_page_and_its_answer_has_to_be_better(monkeypatch, tools):
    calls: list[str] = []

    def handler(url: str):
        calls.append(url)
        if url.startswith(web_module.READER_PREFIX):
            return _FakeResponse(('Markdown Content:\nTitle: Luật số 15/2023/QH15\n\n' + 'toàn văn ' * 400).encode(),
                                 ctype='text/markdown', url=url)
        return _FakeResponse(b'', status=403, ctype='text/html', url=url)

    _serve(monkeypatch, handler)
    payload = tools.fetch({'url': 'https://thuvienphapluat.vn/van-ban/luat-15-2023.html'})
    assert payload['reader'] == 'r.jina.ai' and payload['readerReason'] == 'http-status'
    assert payload['readTier'] == 'reader-text'
    assert payload['status'] == 403, 'status của lần gọi TRỰC TIẾP vẫn được báo thật'
    assert 'toàn văn' in payload['text'] and payload['quality']['verdict'] == 'ok'


def test_the_reader_answer_is_dropped_when_it_is_not_better_than_the_direct_body(tools, monkeypatch):
    junk = gzip.compress(NHAN_DAN_HTML.encode()).decode('utf-8', errors='replace')

    def handler(url: str):
        if url.startswith(web_module.READER_PREFIX):
            return _FakeResponse(b'\xff\xfe\x00\x01' * 40, ctype='text/markdown', url=url)
        return _FakeResponse(junk.encode('utf-8', errors='replace'), url=url)

    _serve(monkeypatch, handler)
    payload = tools.fetch({'url': 'https://example.com/nen'})
    assert payload['reader'] is None
    assert payload['readerReason'] == 'junk'
    assert payload['quality']['verdict'] == 'junk', 'không nhận bản đầu đọc rác vào chỗ bản trực tiếp'


def test_the_reader_never_launders_a_blocked_address(tools, monkeypatch):
    monkeypatch.setattr(web_module.socket, 'getaddrinfo',
                        lambda host, port, **kwargs: [(2, 1, 6, '', ('127.0.0.1', 0))])
    with pytest.raises(WebError) as caught:
        tools.fetch({'url': 'http://harness.local:8081/api/agent/sessions'})
    assert caught.value.code == 'WEB_URL_FORBIDDEN', 'đầu đọc không được thành đường vòng qua SSRF'


def test_the_old_thin_page_policy_is_still_reachable_by_switch(tools, monkeypatch):
    """`BOXFOX_WEB_READER=thin` = đúng hành vi commit `2add905` (chỉ khi thân bài < 200 ký tự)."""
    monkeypatch.setenv('BOXFOX_WEB_READER', 'thin')
    seen: list[str] = []

    def handler(url: str):
        seen.append(url)
        if url.startswith(web_module.READER_PREFIX):
            return _FakeResponse(b'Markdown Content:\nban doc du phong ' * 30, ctype='text/markdown', url=url)
        return _FakeResponse(('x' * 900).encode(), url=url)

    _serve(monkeypatch, handler)
    long_body = tools.fetch({'url': 'https://example.com/dai'})
    assert long_body['reader'] is None and long_body['readerReason'] == 'none'
    assert not any(url.startswith(web_module.READER_PREFIX) for url in seen)

    seen.clear()

    def handler2(url: str):
        seen.append(url)
        if url.startswith(web_module.READER_PREFIX):
            return _FakeResponse(('Markdown Content:\nTitle: Bản đầy đủ\n\n' + 'nội dung thật ' * 60).encode(),
                                 ctype='text/markdown', url=url)
        return _FakeResponse('<html><body>ngan</body></html>'.encode(), url=url)

    _serve(monkeypatch, handler2)
    short_body = tools.fetch({'url': 'https://example.com/ngan'})
    assert any(url.startswith(web_module.READER_PREFIX) for url in seen)
    assert short_body['reader'] == 'r.jina.ai', 'thân bài < 200 ký tự vẫn đi qua đầu đọc như trước'


def test_an_unknown_reader_mode_falls_back_to_the_default():
    from agentbox.agent_core import limits
    import os
    os.environ['BOXFOX_WEB_READER'] = 'chặt-vừa-thôi'
    try:
        assert limits.web_reader_mode() == limits.WEB_READER_DEFAULT_MODE
    finally:
        os.environ.pop('BOXFOX_WEB_READER', None)


# ------------------------------------------------------------ A-10: structured tiers

def test_html_tables_are_kept_and_labelled():
    rows = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    markup = '<html><body><p>Bài báo</p>' + rows * 10 + '</body></html>'
    markdown = reading.tables_to_markdown(markup)
    assert markdown.count('bảng trích tự động') == 10, 'ĐO ĐƯỢC: HTML arXiv giữ 10 bảng thật'
    assert '| A | B |' in markdown


def test_a_page_with_tables_keeps_them_in_the_payload(tools, monkeypatch):
    rows = '<table><tr><th>Năm</th><th>Số</th></tr><tr><td>2024</td><td>17</td></tr></table>'
    markup = ('<html><head><title>Niên giám</title></head><body><p>' + 'văn xuôi ' * 200 + '</p>'
              + rows * 3 + '</body></html>')
    _serve(monkeypatch, lambda url: _FakeResponse(markup.encode(), url=url))
    payload = tools.fetch({'url': 'https://example.com/nien-giam'})
    assert payload['tables'] == 3 and payload['readTier'] == 'html'
    assert '**Bảng 3**' in payload['text'] and '| 2024 | 17 |' in payload['text']


def test_jats_full_text_keeps_its_table_wraps():
    jats = ('<article><body><sec><p>' + 'nội dung ' * 60 + '</p>'
            '<table-wrap><label>Table 1</label><caption>Đặc điểm mẫu</caption><table>'
            '<tr><th>Nhóm</th><th>n</th></tr><tr><td>Can thiệp</td><td>54</td></tr></table>'
            '</table-wrap></sec></body></article>')
    markdown = reading.jats_tables_to_markdown(jats)
    assert 'bảng trích tự động' in markdown and 'Đặc điểm mẫu' in markdown and '| Nhóm | n |' in markdown
    assert reading.read_tier(content_type='application/xml', text=jats) == 'jats'


def _tiny_pdf() -> bytes:
    """Một PDF một trang, viết tay: đủ để pdfplumber đọc ra chữ (không cần thư viện ghi PDF)."""
    content = b'BT /F1 12 Tf 72 720 Td (Bang du lieu thuc nghiem) Tj ET'
    objects = [
        b'1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        b'2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        b'3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font '
        b'<< /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
        b'4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
        b'5 0 obj << /Length ' + str(len(content)).encode() + b' >> stream\n' + content + b'\nendstream endobj',
    ]
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for obj in objects:
        offsets.append(len(out))
        out += obj + b'\n'
    xref = len(out)
    out += b'xref\n0 ' + str(len(objects) + 1).encode() + b'\n0000000000 65535 f \n'
    for offset in offsets:
        out += f'{offset:010d} 00000 n \n'.encode()
    out += (b'trailer << /Size ' + str(len(objects) + 1).encode() + b' /Root 1 0 R >>\nstartxref\n'
            + str(xref).encode() + b'\n%%EOF\n')
    return bytes(out)


def test_a_pdf_body_is_rebuilt_on_the_host_and_labelled(tools, monkeypatch):
    pdf = _tiny_pdf()
    _serve(monkeypatch, lambda url: _FakeResponse(pdf, ctype='application/pdf', url=url))
    payload = tools.fetch({'url': 'https://arxiv.org/pdf/1706.03762v7'})
    assert payload['readTier'] == 'pdf-table' and payload['pdfPages'] == 1
    assert payload['reader'] is None, 'PDF dựng được tại chỗ thì không cần đầu đọc chỉ-chữ'
    assert 'Bang du lieu thuc nghiem' in payload['text']


def test_pdf_without_the_library_says_so_instead_of_returning_junk(monkeypatch):
    monkeypatch.setitem(__import__('sys').modules, 'pdfplumber', None)
    markdown, info = reading.pdf_to_markdown(_tiny_pdf())
    assert markdown == '' and 'pdfplumber' in info['reason']


def test_a_body_that_is_not_a_pdf_is_refused_by_the_pdf_tier():
    markdown, info = reading.pdf_to_markdown(b'<html>not a pdf</html>')
    assert markdown == '' and info['reason'] == 'not a PDF body'
