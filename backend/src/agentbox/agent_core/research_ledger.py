"""Sổ nguồn — luật thuần, máy kiểm được (vòng 27 · A1 + A4).

Module **thuần**: không I/O, không đọc mạng, không bao giờ ném. Mọi hàm ở đây chạy trên
danh sách `Row` (một dòng sổ) và trả về kết luận máy đọc được.

Luật số nguồn (#5985, #5996) nằm ở `origin_units()` / `independent_count()`:

    1. Mỗi dòng (trừ dòng `type='confirm'`) là một *nơi đăng*.
    2. Cùng `origin` đã khai ⇒ **một** nguồn, dù khác host (bản tin của một hãng được đăng lại).
    3. Hai dòng khác host mà **trùng bản tin** (Jaccard shingle ≥ 0.85, cả hai đoạn trích ≥ 200
       ký tự) ⇒ **một** nguồn.
    4. Hai nơi viết độc lập ⇒ hai nguồn.

Khẳng định then chốt (#5985) cần **≥ 2** nguồn độc lập, **trừ** khi mọi nguồn là tầng 0–1
(tài liệu chủ nhà hoặc nguồn chính chủ) — lúc đó **một** nguồn là đủ.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

# --- Hằng số ---------------------------------------------------------------

SCHEMA_VERSION = 1
MIN_EXCERPT_CHARS = 80
MIN_FINGERPRINT_CHARS = 200
SHINGLE_SIZE = 5
JACCARD_MERGE = 0.85
MAX_LEDGER_ROWS = 400

ROW_TYPES: tuple[str, ...] = ('normal', 'host-doc', 'official-social', 'confirm')
ROW_STATUSES: tuple[str, ...] = ('unverified', 'ok', 'stale')
ROW_METHODS: tuple[str, ...] = ('web_search', 'web_fetch', 'reader', 'workspace', 'terminal')

#: Sàn và đích của luật gap hai tầng số (#6012, #6013, #6016).
GAP_FLOOR_ROWS = 20
GAP_FLOOR_SAME_TOPIC = 10
GAP_FLOOR_PLATFORMS = 2
GAP_TARGET_ROWS = 30
GAP_TARGET_ROWS_MAX = 50
GAP_TARGET_SAME_TOPIC = 15
GAP_TARGET_PLATFORMS = 3
GAP_SIGNAL_LABEL = 'tín hiệu, chưa kiểm'


@dataclass
class Row:
    """Một dòng sổ nguồn. Trường khớp cột bảng `source_ledger` trong `session_store`."""

    row_id: str
    claim: str
    url: str
    host: str
    tier: int
    type: str = 'normal'
    excerpt: str = ''
    fetched_at: str = ''
    origin: str | None = None
    method: str | None = None
    source_row_id: str | None = None
    status: str = 'unverified'
    fingerprint: str = ''
    payload: Mapping[str, Any] = field(default_factory=dict)
    child_id: str | None = None
    #: Các nhánh con KHÁC cũng dùng dòng này làm bằng chứng (luật idempotent giữ một dòng cho một
    #: (URL, đoạn trích), nên một dòng phải nhớ đủ mọi nhánh đã mở nguồn ấy).
    branches: tuple[str, ...] = ()
    turn: int = 0
    step: int | None = None
    created: str = ''

    def with_payload(self, payload: Mapping[str, Any] | None) -> 'Row':
        clone = Row(**{**self.__dict__})
        clone.payload = dict(payload or {})
        return clone


@dataclass(frozen=True)
class Issue:
    """Một phát hiện của máy. `detail` nói chỗ nào; `remedy` do `research_quality` gắn."""

    code: str
    detail: str = ''


@dataclass(frozen=True)
class Unit:
    """Một *nguồn độc lập*: tập các dòng mà máy coi là cùng một nguồn tin."""

    unit_id: str
    hosts: tuple[str, ...]
    row_ids: tuple[str, ...]
    reason: str
    tier: int

    @property
    def is_primary(self) -> bool:
        return self.tier <= 1


# --- Hàm thuần dùng chung --------------------------------------------------


def fold_text(value: Any) -> str:
    """Bỏ dấu để so khớp: hạ chữ, `đ` → `d`, rồi gộp dấu NFD.

    KHÔNG giữ độ dài và KHÔNG phải `reading.fold_text`: `reading.fold_text` giữ nguyên chuỗi NFD (nên
    `'a\u0301b'` ở lại 3 ký tự), còn hàm này gộp dấu thật (`'a\u0301b'` → `'ab'`, 2 ký tự). Hai hàm
    phục vụ hai việc khác nhau (so khớp tiêu đề/khẳng định ở đây; chuẩn hoá văn bản đọc được ở kia),
    nên **đừng** trỏ cái này về cái kia.
    """
    text_value = '' if value is None else str(value)
    lowered = text_value.lower().replace('đ', 'd')
    return ''.join(ch for ch in unicodedata.normalize('NFD', lowered) if not unicodedata.combining(ch))


def shingles(excerpt: str, size: int = SHINGLE_SIZE) -> frozenset[str]:
    """Tập shingle `size` từ của đoạn trích (đã bỏ dấu + gộp khoảng trắng)."""
    words = re.findall(r'\w+', fold_text(excerpt))
    if len(words) < size:
        return frozenset(words)
    return frozenset(' '.join(words[i:i + size]) for i in range(len(words) - size + 1))


def fingerprint(excerpt: str) -> str:
    """`sha256[:16]` của tập shingle — dấu vân tay bản tin, không chứa nội dung."""
    joined = '|'.join(sorted(shingles(excerpt)))
    return hashlib.sha256(joined.encode('utf-8')).hexdigest()[:16]


def jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    a, b = set(left), set(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def origin_unit(row: Row) -> str:
    """Nhãn "nguồn tin gốc" của một dòng: lời khai của con, hoặc host."""
    declared = (row.origin or '').strip().lower()
    return declared or (row.host or '').strip().lower()


def tier_of(rows: Sequence[Row]) -> int:
    return min((row.tier for row in rows), default=3)


# --- Luật số nguồn ---------------------------------------------------------


def _places(rows: Sequence[Row]) -> list[Row]:
    return [row for row in rows if (row.type or 'normal') != 'confirm']


def origin_units(rows: Sequence[Row]) -> list[Unit]:
    """Gom các dòng thành *nguồn độc lập* — bốn bước của A4(b)."""
    places = _places(rows)
    if not places:
        return []

    parent = list(range(len(places)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[max(root_left, root_right)] = min(root_left, root_right)

    # Bước 2 — cùng "nguồn tin gốc" đã khai ⇒ một nguồn.
    by_origin: dict[str, int] = {}
    for index, row in enumerate(places):
        label = origin_unit(row)
        if label in by_origin:
            union(by_origin[label], index)
        else:
            by_origin[label] = index

    # Bước 3 — cùng bản tin ⇒ một nguồn.
    prints: list[frozenset[str] | None] = []
    for row in places:
        excerpt = row.excerpt or ''
        prints.append(shingles(excerpt) if len(excerpt) >= MIN_FINGERPRINT_CHARS else None)
    for left in range(len(places)):
        if prints[left] is None:
            continue
        for right in range(left + 1, len(places)):
            if prints[right] is None:
                continue
            if (places[left].host or '') == (places[right].host or ''):
                continue
            if jaccard(prints[left] or (), prints[right] or ()) >= JACCARD_MERGE:
                union(left, right)

    groups: dict[int, list[Row]] = {}
    for index, row in enumerate(places):
        groups.setdefault(find(index), []).append(row)

    units: list[Unit] = []
    for position, members in enumerate(sorted(groups.values(), key=lambda items: items[0].row_id)):
        hosts = tuple(dict.fromkeys(row.host for row in members))
        reasons = []
        if len(hosts) > 1:
            reasons.append('same-story')
        if len({origin_unit(row) for row in members}) == 1:
            reasons.append('same-origin')
        reasons.append('place')
        units.append(
            Unit(
                unit_id=f'u{position + 1}',
                hosts=hosts,
                row_ids=tuple(row.row_id for row in members),
                # `reasons` luôn kết thúc bằng `'place'`; nhãn là lý do ĐẦU TIÊN tìm được, còn
                # `'place'` chỉ là nhãn nền khi không có lý do nào khác.
                reason=reasons[0],
                tier=tier_of(members),
            )
        )
    return units


def independent_count(rows: Sequence[Row]) -> int:
    """Số **nguồn độc lập** — đếm theo nguồn tin gốc, không đếm theo URL (#5996)."""
    return len(origin_units(rows))


def units_for_rows(rows: Sequence[Row], wanted: Sequence[str]) -> list[Unit]:
    """Các unit có chứa ít nhất một dòng trong `wanted`."""
    wanted_ids = set(wanted)
    return [unit for unit in origin_units(rows) if wanted_ids & set(unit.row_ids)]


def confirm_rows(rows: Sequence[Row]) -> list[Row]:
    return [row for row in rows if (row.type or 'normal') == 'confirm']


def is_confirmed(row: Row, rows: Sequence[Row]) -> bool:
    """Dòng `normal` đã có bản xác nhận (`type='confirm'` cùng nội dung) hay chưa."""
    print_self = fingerprint(row.excerpt or '')
    for other in confirm_rows(rows):
        if other.source_row_id == row.row_id:
            return True
        if other.fingerprint and print_self and other.fingerprint == print_self:
            return True
    return False


# --- Khẳng định then chốt --------------------------------------------------

_NUMBER_RE = re.compile(r'\d')
_LAW_RE = re.compile(
    r'(?i)\b(điều|khoản|nghị định|thông tư|luật|quyết định|nghị quyết)\s+\d+'
    r'|\b\d+/\d{4}/[A-Za-zĐđ\-]+'
)
_PRICE_RE = re.compile(r'(?i)(\bgiá\b|\bvnd\b|\busd\b|\bđồng\b|\bvnđ\b)')
_DATE_RE = re.compile(r'\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b')
_PROPER_RE = re.compile(r'\b[A-ZĐ][\wÀ-ỹ]+(?:\s+[A-ZĐ][\wÀ-ỹ]+)+')


def key_claim(row: Row, profile: Any | None = None) -> bool:
    """Dòng này có phải **khẳng định then chốt** không (#5985)."""
    text = f'{row.claim or ""} {row.excerpt or ""}'
    fields: Sequence[Any] = ()
    if profile is not None:
        fields = getattr(profile, 'fields', ()) or ()
        for item in fields:
            key = getattr(item, 'key', None) or (item.get('key') if isinstance(item, Mapping) else None)
            if key and str(row.payload.get(key, '')).strip():
                return True
        names = row.payload.get('names') if isinstance(row.payload, Mapping) else None
        if names:
            return True
    if _LAW_RE.search(text) or _PRICE_RE.search(text) or _DATE_RE.search(text):
        return True
    if _NUMBER_RE.search(row.claim or ''):
        return True
    if _PROPER_RE.search(row.claim or ''):
        return True
    return False


def claims_index(rows: Sequence[Row], profile: Any | None = None) -> list[tuple[str, list[Row], bool]]:
    """Gom dòng theo **câu khẳng định**: trả `(claim_key, rows, là_khẳng_định_then_chốt)`."""
    groups: dict[str, list[Row]] = {}
    for row in rows:
        label = fold_text(row.claim or '')[:80].strip() or row.row_id
        groups.setdefault(label, []).append(row)
    result: list[tuple[str, list[Row], bool]] = []
    for label, members in groups.items():
        result.append((members[0].row_id, members, any(key_claim(row, profile) for row in members)))
    return result


# --- Kiểm dòng sổ ----------------------------------------------------------


def assess_rows(
    rows: Sequence[Row],
    profile: Any | None = None,
    *,
    verified: Mapping[str, bool] | None = None,
) -> list[Issue]:
    """Kiểm cấp DÒNG SỔ (A5). `verified` là bản đồ `rowId -> mở lại được nguyên văn`."""
    issues: list[Issue] = []
    verified = verified or {}

    for row in rows:
        excerpt = (row.excerpt or '').strip()
        if len(excerpt) < MIN_EXCERPT_CHARS:
            issues.append(Issue('research-excerpt-missing', f'{row.row_id}: {len(excerpt)} ký tự'))
        if row.tier is None or int(row.tier) < 0:
            issues.append(Issue('research-tier-unknown', row.row_id))
        if (row.type or 'normal') == 'normal' and not (row.host or '').strip():
            issues.append(Issue('research-tier-unknown', row.row_id))

    for row_id, matched in (verified or {}).items():
        if matched:
            continue
        row = next((item for item in rows if item.row_id == row_id), None)
        if row is None or (row.method or '') == 'workspace':
            continue
        if (row.tier or 0) <= 1:
            continue
        issues.append(Issue('research-doc-pointer-missing', f'{row_id}: {row.host} chưa mở lại được'))

    for row in rows:
        if (row.type or 'normal') == 'official-social' and not is_confirmed(row, rows):
            issues.append(Issue('research-social-unconfirmed', f'{row.row_id}: {row.host}'))

    for anchor, members, is_key in claims_index(rows, profile):
        if not is_key:
            continue
        units = units_for_rows(rows, [row.row_id for row in members])
        if len(units) >= 2:
            continue
        if units and all(unit.is_primary for unit in units):
            continue
        issues.append(
            Issue('research-claim-single-source', f'{anchor}: {origin_unit(members[0])} (tầng {tier_of(members)})')
        )

    # Khẳng định về NỘI DUNG VĂN BẢN mà chỉ có báo chí chống lưng ⇒ phải trỏ bản gốc (#5985).
    for anchor, members, is_key in claims_index(rows, profile):
        if not is_key or any(row.tier <= 1 for row in members):
            continue
        if not any(_LAW_RE.search(f'{row.claim or ""} {row.excerpt or ""}') for row in members):
            continue
        hosts = ', '.join(sorted({row.host for row in members}))
        issues.append(Issue('research-doc-pointer-missing', f'{anchor}: tầng {tier_of(members)} ({hosts})'))

    # Trùng bản tin mà không khai "nguồn tin gốc" (#5996): một unit gộp NHIỀU host nghĩa là cùng
    # một bản tin được đăng lại, nên phải có ít nhất một dòng nói bản nào là gốc — không thì người
    # đọc không biết chuyện gì tới từ đâu, và luật "hai nguồn độc lập" bị đếm sai chỗ.
    places = _places(rows)
    for unit in origin_units(rows):
        if len(unit.hosts) < 2:
            continue
        members = [row for row in places if row.row_id in set(unit.row_ids)]
        if any((row.origin or '').strip() for row in members):
            continue
        issues.append(Issue('research-origin-undeclared', f'{unit.row_ids[0]}: {", ".join(unit.hosts)}'))

    for row in rows:
        if (row.payload or {}).get('hostDoc') and (row.type or 'normal') != 'host-doc':
            issues.append(Issue('research-host-doc-unmarked', row.row_id))

    if profile is not None and getattr(profile, 'validity', False):
        needs_validity = [(row, getattr(profile, 'validity_fields', ()) or ()) for row in rows]
        for row, field_keys in needs_validity:
            if (row.type or 'normal') == 'confirm':
                continue
            payload = row.payload or {}
            missing = [key for key in field_keys if not str(payload.get(key, '')).strip()]
            if missing:
                issues.append(Issue('research-validity-missing', f'{row.row_id}: {", ".join(missing)}'))

    return issues


def gap_verdict(rows: Sequence[Row]) -> dict[str, Any]:
    """Luật gap hai tầng số (#6012, #6013, #6016) — thuần, không đòi thêm dữ liệu.

    Trả `{'checked': bool, 'rows': n, 'platforms': n, 'label': str|None, 'ceiling': ...}`.
    Chưa đủ **sàn** ⇒ `label = GAP_SIGNAL_LABEL` (hồ sơ phải ghi rõ + lý do, **không** treo lượt).
    """
    places = _places(rows)
    rows_count = len(places)
    platforms = len({row.host for row in places})
    rows_floor = GAP_FLOOR_ROWS
    platforms_floor = GAP_FLOOR_PLATFORMS
    checked = rows_count >= rows_floor and platforms >= platforms_floor
    # Trần của luật gap là `GAP_TARGET_ROWS_MAX` (50): bản trước còn một tham số `target` chết —
    # `(target or True)` luôn đúng, nên nhánh `GAP_TARGET_ROWS` (30) không bao giờ chạy.
    ceiling = GAP_TARGET_ROWS_MAX
    return {
        'checked': checked,
        'rows': rows_count,
        'platforms': platforms,
        'floor': {'rows': rows_floor, 'sameTopic': GAP_FLOOR_SAME_TOPIC, 'platforms': platforms_floor},
        'target': {
            'rows': GAP_TARGET_ROWS,
            'rowsMax': GAP_TARGET_ROWS_MAX,
            'sameTopic': GAP_TARGET_SAME_TOPIC,
            'platforms': GAP_TARGET_PLATFORMS,
        },
        'ceiling': ceiling,
        'label': None if checked else GAP_SIGNAL_LABEL,
    }
