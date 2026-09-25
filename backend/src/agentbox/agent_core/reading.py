"""Body-quality rules and the fallback read ladder, host side, no network.

Split out of :mod:`agentbox.agent_core.web` so the rules can be unit-tested
without a socket and so the source-ledger work (Phạm vi B) has **one** shared
definition of "this body is real". Numbers below were measured on 2026-09-23
(see ``docs/plan/v27/subplans/reading.md`` and ``docs/tracking/test-rounds.md``):

* gzip bodies arrive as binary junk: 17 421 / 46 692 / 37 798 "characters" with
  ``junkRatio`` 0.550 / 0.517, against 0.0000 for real prose;
* ``moh.gov.vn`` answers the reader with 165–259 bytes
  ("Warning: This page maybe not yet fully loaded");
* ``vbpl.vn`` answers 200 with a 404 image page, and 27 378 bytes of
  "Trang chủ" for a document URL.

Five read tiers, best first (chốt #6010/#6011):

1. ``html``  — the publisher's own HTML; tables survive (measured: arXiv HTML kept 10 tables)
2. ``jats``  — full-text XML/JATS; tables survive (measured: Europe PMC kept 6 tables)
3. ``pdf-table`` — host-side PDF with ``pdfplumber``; tables rebuilt, labelled "bảng trích tự động"
4. ``reader-text`` — ``r.jina.ai`` text only; tables are **lost** (measured: 0 rows with ``|``)
5. ``page-image`` — page images + image reading; last resort, not built in this batch

The same module owns the **read store** (``ReadStore``, A-4): the full body of a page that was
fetched once, kept in process memory so a long document can be read in slices by ``read_source``
without a second network call (measured: 113 936 characters for the Python 3.13 whatsnew page,
of which one call can carry 20 000 at most).
"""

import io
import re
import urllib.parse
import uuid
import unicodedata
import zlib
from collections import OrderedDict
from html.parser import HTMLParser

from .limits import READ_STORE_ENTRY_MAX_CHARS, READ_STORE_MAX_CHARS, READ_STORE_MAX_ENTRIES

# --------------------------------------------------------------------- constants

JUNK_CATEGORIES = {'Cf', 'Cs', 'Co', 'Cn'}   # Cc is judged separately so \t \n \r survive
JUNK_RATIO_MAX = 0.10                        # measured: junk 0.52–0.55 · real prose 0.0000
BODY_MIN_CHARS = 500                         # measured: smallest fake body is 403 chars (vbpl.vn 404)
# CẢNH BÁO (đo được 2026-09-23): phép so dấu hiệu chạy trên bản ĐÃ BỎ DẤU (`_plain`), nên mục nào
# còn dấu trong bảng này là chuỗi chết trừ khi có mặt chữ không dấu đi kèm. `'văn bản không tồn tại'`
# và `'đang tải dữ liệu'` từng KHÔNG BAO GIỜ khớp: một trang `vbpl.vn` 404 (ảnh + "Văn bản không
# tồn tại") vẫn được chấm `ok`. Nay mỗi mục có cả hai cách viết.
ERROR_MARKERS = (
    '404 error',
    'văn bản không tồn tại',
    'van ban khong ton tai',
    'warning: this page maybe not yet fully loaded',
    'cached snapshot',
    'just a moment',
    'attention required',
    # ĐO ĐƯỢC 2026-09-23: thuvienphapluat.vn trả 403 cho client thường, và `r.jina.ai`
    # (không khoá) nhận đúng trang chặn bot 281 ký tự "Performing security verification".
    # Không có dấu hiệu này thì 281 ký tự đó ra `thin` — vẫn là một dạng thành công giả.
    'performing security verification',
    'đang tải dữ liệu',
    'dang tai du lieu',
    'enable javascript',
    'please wait while we load',
    'meta http-equiv="refresh"',
    'window.location.replace',
)
GENERIC_TITLES = ('trang chủ', 'home', 'homepage', 'trang chu', 'page not found', 'not found',
                  'đang tải', 'dang tai', 'just a moment', 'access denied', 'forbidden', 'error')

TABLE_LABEL = 'bảng trích tự động'
TABLE_LABEL_NOTE = ('bảng trích tự động — dòng tiêu đề nhiều tầng có thể lệch; '
                    'khẳng định dựa vào bảng phải ghi rõ nguồn bảng')
READ_TIERS = ('html', 'jats', 'pdf-table', 'reader-text', 'page-image')
VERDICTS = ('ok', 'thin', 'junk', 'error-page', 'wrong-page', 'empty')
LADDER_REASONS = ('none', 'thin', 'junk', 'error-page', 'wrong-page', 'pdf', 'http-status', 'unreachable')
_TIER_RANK = {'ok': 3, 'thin': 2, 'wrong-page': 1, 'error-page': 1, 'junk': 0, 'empty': 0}

_SLUG_EXTENSIONS = ('.html', '.htm', '.aspx', '.asp', '.php', '.jsp', '.json', '.xml', '.rss',
                    '.atom', '.pdf', '.md', '.txt', '.cgi')
_TOKEN_SPLIT = re.compile(r'[^0-9a-z]+')
_HTML_TAG = re.compile(r'(?s)<[^>]+>')
_JATS_TABLE = re.compile(r'(?s)<table-wrap\b.*?</table-wrap>')


def _plain(value: str) -> str:
    """Lowercase, diacritics removed (NFD + drop marks, plus đ/Đ which NFD keeps)."""
    text = unicodedata.normalize('NFD', str(value or ''))
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    return text.replace('đ', 'd').replace('Đ', 'D').lower()


def _tokens(value: str, *, min_len: int = 1) -> list[str]:
    return [tok for tok in _TOKEN_SPLIT.split(_plain(value)) if len(tok) >= min_len]


# `wrong_page` so trên `_plain(heading)`, nên bản bỏ dấu này mới là bảng thật dùng để so: mỗi mục
# còn dấu trong `GENERIC_TITLES` (`'trang chủ'`, `'đang tải'`) là chuỗi chết nếu so thẳng.
_GENERIC_TITLES_PLAIN = tuple(dict.fromkeys(_plain(item) for item in GENERIC_TITLES))


# ------------------------------------------------------------------- junk / title

def junk_ratio(text: str, sample: int = 1000) -> float:
    """Share of characters that cannot be prose, in the first ``sample`` characters.

    Counts U+FFFD, control characters other than ``\\t \\n \\r``, and the
    Cf/Cs/Co/Cn categories. Measured: compressed junk 0.550 · PDF bytes 0.517 ·
    Vietnamese prose 0.0000 (so the 0.10 line has a very wide margin).
    """
    head = str(text or '')[:max(1, int(sample))]
    if not head:
        return 0.0
    bad = 0
    for ch in head:
        if ch == '\ufffd':
            bad += 1
            continue
        category = unicodedata.category(ch)
        if category == 'Cc' and ch not in '\t\n\r':
            bad += 1
        elif category in JUNK_CATEGORIES:
            bad += 1
    return bad / len(head)


def reader_title(text: str) -> str:
    """Title line of a reader answer (``Title: …``), empty when the text has none."""
    for line in str(text or '').splitlines()[:6]:
        if line.startswith('Title:'):
            return line.split(':', 1)[1].strip()[:200]
    return ''


def _slug_tokens(url: str) -> list[str]:
    """Token chữ của slug cuối ĐƯỜNG DẪN (>=3 ký tự, bỏ đuôi tệp) — dùng chung cho hai phép kiểm.

    ĐO ĐƯỢC 2026-09-23: phép cắt chuỗi cũ lấy cả tên miền khi đường dẫn chỉ là `/`, nên
    `https://vanban.chinhphu.vn/` sinh token `['vanban', 'chinhphu']` rồi so với tiêu đề
    "Hệ thống văn bản" ⇒ **mọi** trang của host đó bị gọi là `wrong-page` (một báo sai, không
    phải một phép kiểm). Nay chỉ lấy phần `path` của URL.
    """
    path = urllib.parse.urlsplit(str(url or '')).path or ''
    path = path.split('?', 1)[0].split('#', 1)[0].rstrip('/')
    if not path:
        return []
    # ĐO ĐƯỢC 2026-09-23: slug tiếng Việt bị percent-encode (`%E1%BA%BFt`) mà không giải mã thì
    # token sinh ra là rác (`['chuy','83n','tuy','bfn','b4ng','ngh']`) và trang THẬT bị gọi là
    # `wrong-page` — báo sai trên chính nhóm URL luật/hành chính là nguồn chính của sản phẩm.
    slug = urllib.parse.unquote(path.rsplit('/', 1)[-1]).lower()
    for extension in _SLUG_EXTENSIONS:
        if slug.endswith(extension):
            slug = slug[: -len(extension)]
            break
    return [tok for tok in _tokens(slug, min_len=3) if any(ch.isalpha() for ch in tok)]


def _first_heading(text: str) -> str:
    """Dòng tiêu đề đầu của một bản đọc: `Title: …` của đầu đọc, hoặc `# …`/`## …` markdown."""
    title = reader_title(text)
    if title:
        return title
    for line in str(text or '').splitlines()[:40]:
        stripped = line.strip()
        if stripped.startswith('#') and len(stripped) > 2:
            return stripped.lstrip('# ').strip()[:200]
    return ''


def slug_clue(text: str, *, url: str = '') -> bool:
    """True khi TIÊU ĐỀ của bản đọc chia sẻ token với slug URL — cửa hậu của `wrong_page`.

    ĐO ĐƯỢC (2026-09-23): `r.jina.ai` trả đúng *site chrome* cho `vbpq-toanvan.aspx?ItemID=1`
    ("Tùy chọn · Chính sách bảo mật · …", 26 522 ký tự) và không có dòng `Title:` nào, nên
    `wrong_page()` không bắt được — bản đọc ấy sẽ "rửa" một trang SAI thành `ok`.

    Phép kiểm chỉ nhìn **tiêu đề**, không nhìn cả thân bài: thân bài của chrome có chứa chuỗi
    URL `…/vbpq-toanvan.aspx?ItemID=1` trong liên kết, nên nếu quét cả thân bài thì cửa hậu
    không chặn được gì (đã đo: lần chạy đầu cho `slug_clue=True` với đúng trang chrome ấy).
    """
    tokens = _slug_tokens(url)
    if not tokens:
        return False
    heading = _first_heading(text)
    if not heading:
        return False
    heading_tokens = [tok for tok in _tokens(_plain(heading), min_len=3) if any(ch.isalpha() for ch in tok)]
    return bool(set(tokens) & set(heading_tokens))


def wrong_page(text: str, *, url: str = '', title: str = '') -> bool:
    """True when the title shares no clue with the URL slug — "Trang chủ" for a document URL.

    Deliberately conservative: it needs a title, at least two alphabetic slug
    tokens (≥3 characters, file extensions dropped) and at least one alphabetic
    title token. A generic title ("Trang chủ", "Home", …) is enough on its own.
    """
    heading = (title or reader_title(text)).strip()
    if not heading or len(heading) > 200:
        return False
    plain_heading = _plain(heading).strip(' -–—:|')
    if plain_heading in _GENERIC_TITLES_PLAIN or any(
            plain_heading.startswith(g + ' ') or plain_heading.startswith(g + ' -')
            for g in _GENERIC_TITLES_PLAIN):
        return True
    slug_tokens = _slug_tokens(url)
    if len(slug_tokens) < 2:
        return False
    title_tokens = [tok for tok in _tokens(heading, min_len=3) if any(ch.isalpha() for ch in tok)]
    if not title_tokens:
        return False
    return not set(slug_tokens) & set(title_tokens)


def body_check(text: str, *, url: str = '', status: int | None = None,
               content_type: str = '', reader: str | None = None,
               title: str = '') -> dict:
    """Judge a fetched body and say *why* it cannot be trusted.

    ``verdict`` values (frozen after đợt 1 — Phạm vi B maps them):
    ``ok`` · ``thin`` (short, still returned) · ``junk`` · ``error-page`` ·
    ``wrong-page`` · ``empty``. Only ``ok`` means "treat this as the real page";
    ``thin`` is advice, the other three are refusals.
    """
    body = str(text or '')
    stripped = body.strip()
    ratio = junk_ratio(body)
    low = _plain(stripped[:4000])
    # So trên bản bỏ dấu ⇒ cũng phải BỎ DẤU chính dấu hiệu, nếu không mục còn dấu là chuỗi chết.
    marker = next((mark for mark in ERROR_MARKERS if _plain(mark) in low), '')
    result = {
        'verdict': 'ok',
        'reason': '',
        'junkRatio': round(ratio, 4),
        'textChars': len(stripped),
        'underMinChars': len(stripped) < BODY_MIN_CHARS,
        'reader': reader or '',
        'contentType': content_type or '',
        'status': status,
    }
    if not stripped:
        result.update(verdict='empty', reason='the body is empty')
        return result
    if ratio > JUNK_RATIO_MAX:
        result.update(verdict='junk',
                      reason=f'{ratio:.1%} of the first characters cannot be prose (compressed or binary body)')
        return result
    if marker:
        result.update(verdict='error-page', reason=f'the body carries an error/marker page ("{marker}")')
        return result
    if wrong_page(body, url=url, title=title):
        result.update(verdict='wrong-page',
                      reason='the page title does not match the address (a home or error page answered)')
        return result
    if len(stripped) < BODY_MIN_CHARS:
        result.update(verdict='thin',
                      reason=f'only {len(stripped)} characters — read it, but look for a second source')
        return result
    return result


# ------------------------------------------------------------------------ decode

def _fail(code: str, message: str, log_message: str):
    from .web import WebError  # lazy import: web imports this module, so a cycle must not form
    raise WebError(code, message, log_message)


def decode_body(raw: bytes, headers, *, charset: str = 'utf-8', mode: str = 'on',
                max_inflated_bytes: int = 16 * 1024 * 1024) -> tuple[str, dict]:
    """Inflate ``Content-Encoding`` before anything reads the bytes as text.

    ``gzip`` is recognised from the header **or** the ``\\x1f\\x8b`` magic (servers
    send gzip without saying so — measured on nhandan.vn). ``br`` is an explicit
    error instead of a wall of junk: the standard library cannot decode it.
    """
    meta = {'contentEncoding': 'identity', 'decoded': False, 'decodeTruncated': False}
    encoding = ''
    try:
        encoding = str(headers.get('Content-Encoding') or '').strip().lower()
    except AttributeError:  # a plain dict without .get on the header object
        encoding = ''
    if mode == 'off':
        # Công tắc lùi chỉ tắt việc GIẢI NÉN, không được phép nói sai host đã gửi gì: đo được
        # 2026-09-23 là `nhandan.vn` trả `Content-Encoding: gzip` kể cả khi bị xin `identity`,
        # nên báo `identity` ở đây là payload nói dối người đọc (mà còn hỏi gzip qua
        # `Accept-Encoding` ở `http_request_meta`). Vẫn giữ `decoded: False` — đúng sự thật.
        if 'gzip' in encoding or raw[:2] == b'\x1f\x8b':
            meta.update(contentEncoding='gzip')
        elif encoding and encoding not in ('identity', 'none'):
            meta.update(contentEncoding=encoding)
        return raw.decode(charset, errors='replace'), meta
    gzip_like = 'gzip' in encoding or raw[:2] == b'\x1f\x8b'
    if gzip_like:
        try:
            obj = zlib.decompressobj(16 + zlib.MAX_WBITS)
            inflated = obj.decompress(raw, max_inflated_bytes)
        except zlib.error as exc:
            _fail('WEB_FETCH_FAILED', f'the body says it is gzip but cannot be inflated ({exc})',
                  'the gzip body could not be inflated')
        meta.update(contentEncoding='gzip', decoded=True,
                    decodeTruncated=bool(obj.unconsumed_tail))
        return inflated.decode(charset, errors='replace'), meta
    if 'deflate' in encoding:
        for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
            try:
                inflated = zlib.decompressobj(wbits).decompress(raw, max_inflated_bytes)
                meta.update(contentEncoding='deflate', decoded=True)
                return inflated.decode(charset, errors='replace'), meta
            except zlib.error:
                continue
        _fail('WEB_FETCH_FAILED', 'the body says it is deflate but cannot be inflated',
              'the deflate body could not be inflated')
    if 'br' in encoding:
        _fail('WEB_FETCH_FAILED',
              'the host answered with brotli compression this reader cannot decode',
              'the host answered with br')
    if encoding and encoding not in ('identity', 'none'):
        meta.update(contentEncoding=encoding)
    return raw.decode(charset, errors='replace'), meta


# ------------------------------------------------------------------------ ladder

def ladder_plan(*, status: int | None = None, content_type: str = '', verdict: str = 'ok',
                direct_error: bool = False, is_pdf: bool = False, text_chars: int | None = None,
                mode: str = 'auto', pdf_rebuilt: bool = False) -> dict:
    """Decide whether the third-party reader gets a turn, and name the reason.

    ``mode='thin'`` reproduces exactly the behaviour of commit ``2add905`` (only
    bodies shorter than 200 characters went to the reader) — the regression
    switch. ``mode='off'`` never calls the reader.

    ``is_pdf`` means "a PDF whose on-host rebuild (tier 3) produced nothing usable":
    tier 3 sits **before** the text-only reader (tier 4), so a PDF that ``pdfplumber``
    already turned into text + tables is never sent out — that call would cost an
    external hop and could replace labelled tables with table-less text.
    """
    if mode == 'off':
        return {'use_reader': False, 'reason': 'none'}
    if mode == 'thin':
        # `2add905` ném lỗi TRƯỚC khi đầu đọc có cơ hội (đo được 2026-09-23: thuvienphapluat.vn
        # 403 ⇒ `WEB_FETCH_FAILED`, đầu đọc không được gọi). Không giữ đường đó thì công tắc hồi
        # quy vẫn thêm một lời gọi ra ngoài mà bản cũ không có — tức không còn là bản cũ.
        if direct_error:
            return {'use_reader': False, 'reason': 'none'}
        use_reader = text_chars is not None and text_chars < 200
        return {'use_reader': use_reader, 'reason': 'thin' if use_reader else 'none'}
    if pdf_rebuilt:
        # Tầng 3 đã trả về một bản đọc dùng được (chữ + bảng có nhãn): tầng 4 đứng SAU, nên ở đây
        # không có gì để cứu — và một lời gọi đầu đọc có thể thay bảng bằng bản chữ không bảng.
        return {'use_reader': False, 'reason': 'none'}
    if is_pdf:
        return {'use_reader': True, 'reason': 'pdf'}
    if direct_error:
        return {'use_reader': True, 'reason': 'unreachable'}
    if status is not None and not (200 <= int(status) < 300):
        return {'use_reader': True, 'reason': 'http-status'}
    if verdict in ('junk', 'error-page', 'wrong-page'):
        return {'use_reader': True, 'reason': verdict}
    if verdict in ('thin', 'empty'):
        return {'use_reader': True, 'reason': 'thin'}
    return {'use_reader': False, 'reason': 'none'}


def is_better_grade(new_verdict: str, old_verdict: str) -> bool:
    """Keep a reader answer only when its ``body_check`` grade beats the direct body."""
    return _TIER_RANK.get(new_verdict, 0) > _TIER_RANK.get(old_verdict, 0)


# ------------------------------------------------------------- structured tiers

class _TableReader(HTMLParser):
    """Pull ``<table>`` blocks out of HTML as markdown rows (tier 1 keeps tables)."""

    _CELL = {'td', 'th'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._depth = 0
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ('script', 'style'):
            self._skip += 1
            return
        if tag == 'table':
            self._depth += 1
            if self._depth == 1 and self._table is None:
                self._table = []
        elif tag == 'tr' and self._table is not None and self._depth == 1:
            self._row = []
        elif tag in self._CELL and self._row is not None and self._depth == 1:
            self._cell = []
        elif tag == 'br' and self._cell is not None:
            self._cell.append(' ')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ('script', 'style'):
            self._skip = max(0, self._skip - 1)
            return
        if tag in self._CELL and self._cell is not None and self._row is not None:
            self._row.append(' '.join(''.join(self._cell).split()))
            self._cell = None
        elif tag == 'tr' and self._row is not None and self._table is not None:
            if any(cell for cell in self._row):
                self._table.append(self._row)
            self._row = None
        elif tag == 'table':
            self._depth = max(0, self._depth - 1)
            if self._depth == 0 and self._table is not None:
                if self._table:
                    self.tables.append(self._table)
                self._table = None

    def handle_data(self, data):
        if self._skip or self._cell is None:
            return
        self._cell.append(data)


def _rows_to_markdown(rows: list[list[str]]) -> str:
    if not rows:
        return ''
    width = max(len(row) for row in rows)
    lines = []
    for index, row in enumerate(rows):
        cells = [(cell or '').replace('|', '\\|') for cell in row] + [''] * (width - len(row))
        lines.append('| ' + ' | '.join(cells) + ' |')
        if index == 0:
            lines.append('|' + '---|' * width)
    return '\n'.join(lines)


def tables_to_markdown(markup: str, *, max_tables: int = 12) -> str:
    """Markdown of every ``<table>`` in an HTML body, labelled as machine-extracted."""
    if not markup or '<table' not in markup.lower():
        return ''
    parser = _TableReader()
    try:
        parser.feed(markup)
    except Exception:  # a broken page must not lose the rest of the read
        return ''
    blocks = []
    for index, rows in enumerate(parser.tables[:max_tables], start=1):
        table = _rows_to_markdown(rows)
        if table:
            blocks.append(f'**Bảng {index}** ({TABLE_LABEL})\n\n{table}')
    return '\n\n'.join(blocks)


def jats_tables_to_markdown(xml: str, *, max_tables: int = 12) -> str:
    """Markdown of ``<table-wrap>`` blocks in a JATS full-text answer (tier 2)."""
    if not xml or '<table-wrap' not in xml.lower():
        return ''
    blocks = []
    for index, chunk in enumerate(_JATS_TABLE.findall(xml)[:max_tables], start=1):
        label = ''
        caption = ''
        label_match = re.search(r'(?s)<label>(.*?)</label>', chunk)
        caption_match = re.search(r'(?s)<caption>(.*?)</caption>', chunk)
        if label_match:
            label = _HTML_TAG.sub(' ', label_match.group(1)).strip()
        if caption_match:
            caption = _HTML_TAG.sub(' ', caption_match.group(1)).strip()
        parser = _TableReader()
        try:
            parser.feed(chunk)
        except Exception:
            continue
        if not parser.tables:
            continue
        head = ' · '.join(part for part in (label, caption) if part)
        table = _rows_to_markdown(parser.tables[0])
        blocks.append(f'**Bảng {index}** ({TABLE_LABEL})' + (f' — {head}' if head else '') + f'\n\n{table}')
    return '\n\n'.join(blocks)


def read_tier(*, content_type: str = '', reader: str | None = None, pdf: bool = False,
              text: str = '') -> str:
    """Name of the tier this body came from — the ledger stores this per source."""
    ctype = str(content_type or '').lower()
    if pdf:
        return 'pdf-table'
    if reader:
        return 'reader-text'
    if '<table-wrap' in str(text or '').lower() or 'jats' in ctype:
        return 'jats'
    return 'html'


def pdf_to_markdown(data: bytes, *, max_pages: int = 40, max_tables: int = 24,
                    max_chars: int = 200000, start_page: int = 1) -> tuple[str, dict]:
    """Rebuild a PDF as markdown text + markdown tables with pdfplumber (tier 3).

    Returns ``('', info)`` when pdfplumber is missing or the bytes are not a PDF;
    the caller then falls through to the reader tier.
    """
    info = {'pages': 0, 'tables': 0, 'tier': 'pdf-table', 'engine': 'pdfplumber',
            'startPage': start_page, 'pagesRead': 0}
    if start_page < 1 or max_pages < 1:
        info['reason'] = 'start_page and max_pages must be positive'
        return '', info
    if not data[:5].startswith(b'%PDF-'):
        info['reason'] = 'not a PDF body'
        return '', info
    try:
        import pdfplumber  # type: ignore[import-not-found]  # optional host dependency
    except Exception:
        info['reason'] = 'pdfplumber is not installed'
        return '', info
    parts: list[str] = []
    table_count = 0
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            info['pages'] = len(pdf.pages)
            first = start_page - 1
            if first >= len(pdf.pages):
                info['reason'] = 'requested page is beyond the end of the PDF'
                return '', info
            stop = min(first + max_pages, len(pdf.pages))
            info['pagesRead'] = stop - first
            if stop < len(pdf.pages):
                info['truncatedPages'] = len(pdf.pages) - stop
                info['nextPage'] = stop + 1
            for number in range(first, stop):
                page = pdf.pages[number]
                page_number = number + 1
                text = (page.extract_text() or '').strip()
                if text:
                    parts.append(f'## Trang {page_number}\n\n{text}')
                if table_count < max_tables:
                    for rows in (page.extract_tables() or []):
                        cleaned = [[(cell or '').replace('\n', ' ').strip() for cell in row] for row in rows]
                        table = _rows_to_markdown(cleaned)
                        if not table:
                            continue
                        table_count += 1
                        parts.append(f'**Bảng {table_count}** ({TABLE_LABEL_NOTE})\n\n{table}')
    except Exception as exc:  # a broken PDF must not kill the read
        info['reason'] = f'{exc.__class__.__name__} while reading the PDF'
        if not parts:
            return '', info
    info['tables'] = table_count
    body = '\n\n'.join(parts)
    if len(body) > max_chars:
        body = body[:max_chars]
        info['truncated'] = True
    if not body and info['pages']:
        info['scanLikely'] = True
        info['reason'] = 'no selectable text; scanned PDF may need OCR'
    return body, info

# ------------------------------------------------------------------ read store (A-4)
#
# ĐO ĐƯỢC 2026-09-23: `docs.python.org/3/whatsnew/3.13.html` dựng được 113 936 ký tự nhưng
# một lời gọi chỉ mang về 20 000 (trần ngữ cảnh), và 8 000 đầu là râu ria điều hướng. Đầu đọc
# `r.jina.ai` trả CẢ tài liệu trong một lời gọi (`x-start` không cắt) ⇒ nút thắt nằm phía ta.
# Bộ đệm này giữ bản đầy đủ trong bộ nhớ tiến trình; WebTools có thể ghim bản sao
# theo phiên nghiên cứu vào SQLite để `read_source` đọc tiếp sau khi khởi động lại.

def fold_text(value: str) -> str:
    """Bỏ dấu + hạ chữ cho phép so khớp #5966, **giữ nguyên độ dài** để offset còn dùng được."""
    out = []
    for ch in value:
        low = ch.lower().replace('đ', 'd')
        if len(low) != 1:           # vài ký tự lạ đổi độ dài khi hạ chữ: giữ nguyên bản gốc
            low = ch
        out.append(unicodedata.normalize('NFD', low)[0])
    return ''.join(out)


def find_terms(text: str, terms, *, limit: int = 4) -> list[dict]:
    """Vị trí của từng từ khoá tìm được; `offset` tính trên `text` GỐC, không phải bản bỏ dấu."""
    folded = fold_text(text)
    hits: list[dict] = []
    for term in list(terms or [])[:limit]:
        needle = fold_text(str(term).strip())
        if not needle:
            continue
        at = folded.find(needle)
        if at < 0:
            continue
        hits.append({'term': str(term).strip(), 'offset': at})
    hits.sort(key=lambda item: item['offset'])
    return hits[:limit]


_TRACKING_KEYS = ('fbclid', 'gclid')


def normalize_url(url: str) -> str:
    """Khoá bộ đệm: bỏ fragment + tham số theo dõi, GIỮ truy vấn (nhiều trang chỉ khác `?ItemID=`)."""
    parts = urllib.parse.urlsplit(str(url or '').strip())
    kept = [(key, value) for key, value in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith('utm_') and key.lower() not in _TRACKING_KEYS]
    netloc = parts.netloc.lower()
    if netloc.startswith('www.'):
        netloc = netloc[4:]
    return urllib.parse.urlunsplit((parts.scheme.lower(), netloc, parts.path,
                                    urllib.parse.urlencode(kept), ''))


class ReadStore:
    """Bản đầy đủ của những trang đã tải, trong bộ nhớ tiến trình, LRU theo lần chạm.

    Trần (`limits.py`): ``READ_STORE_MAX_ENTRIES`` bản · ``READ_STORE_ENTRY_MAX_CHARS`` ký tự một
    bản · ``READ_STORE_MAX_CHARS`` tổng. Runtime có thể lưu một bản sao bền vững theo phiên việc.
    """

    def __init__(self, *, max_entries: int = READ_STORE_MAX_ENTRIES,
                 entry_max_chars: int = READ_STORE_ENTRY_MAX_CHARS,
                 max_chars: int = READ_STORE_MAX_CHARS):
        self.max_entries = max(1, int(max_entries))
        self.entry_max_chars = max(1, int(entry_max_chars))
        self.max_chars = max(1, int(max_chars))
        self._entries: OrderedDict = OrderedDict()
        self._by_url: dict = {}
        self._seq = 0
        self.total_chars = 0

    # ------------------------------------------------------------------ write
    def put(self, *, url: str, final: str, text: str, **fields) -> dict:
        """Lưu một bản đọc (đã cắt theo trần MỘT bản) và trả về bản ghi kèm `ref`."""
        stored = str(text or '')[: self.entry_max_chars]
        key = normalize_url(final or url)
        old = self._by_url.get(key)
        if old is not None:
            self._drop(old)
        self._seq += 1
        # A reference must remain unique after a harness restart because durable
        # research snapshots can outlive this in-memory cache.
        ref = 'r-' + uuid.uuid4().hex
        entry = {'ref': ref, 'url': url, 'finalUrl': final, 'text': stored,
                 'storedChars': len(stored)}
        entry.update(fields)
        self._entries[ref] = entry
        self._by_url[key] = ref
        self.total_chars += len(stored)
        self._evict()
        return entry

    def _drop(self, ref: str) -> None:
        entry = self._entries.pop(ref, None)
        if entry is None:
            return
        self.total_chars -= len(entry.get('text') or '')
        key = normalize_url(entry.get('finalUrl') or entry.get('url') or '')
        if self._by_url.get(key) == ref:
            self._by_url.pop(key, None)

    def _evict(self) -> None:
        while self._entries and (len(self._entries) > self.max_entries
                                 or self.total_chars > self.max_chars):
            oldest = next(iter(self._entries))
            self._drop(oldest)

    # ------------------------------------------------------------------- read
    def get(self, ref: str) -> dict | None:
        """Bản ghi theo `ref`, có chạm LRU."""
        entry = self._entries.get(str(ref or '').strip())
        if entry is None:
            return None
        self._entries.move_to_end(entry['ref'])
        return entry

    def by_url(self, url: str) -> dict | None:
        """Bản ghi gần nhất của một URL (đã chuẩn hoá), có chạm LRU."""
        ref = self._by_url.get(normalize_url(url))
        return self.get(ref) if ref else None

    def __len__(self) -> int:
        return len(self._entries)
