"""Thang nguồn 4 tầng + tầng 0 "tài liệu chủ nhà" (vòng 27 · #5962, #5983, #5991, #5997).

Bảng tầng nằm **trong mã** và đổi được bằng biến môi trường `BOXFOX_SOURCE_TIERS` (#5975).
Module này **thuần**: không I/O, không đọc mạng, không bao giờ ném vì dữ liệu vào xấu —
`classify()` luôn trả về một tầng (mặc định tầng 3 cho host lạ).

Tầng:
    0  tài liệu do chủ nhà cung cấp  — đứng **trên** tầng 1 (#5962)
    1  nguồn chính chủ / chính thống (cổng nhà nước, văn bản gốc, tạp chí, kho mã, tài liệu hãng)
    2  báo chí chính thống
    3  nguồn thứ cấp (mặc định cho host không biết)
    4  nguồn không kiểm chứng được (mạng xã hội đại chúng, blog ẩn danh, diễn đàn mở)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

# --- Bảng cứng -------------------------------------------------------------

TIERS: dict[int, str] = {
    0: 'owner-supplied',
    1: 'primary-official',
    2: 'state-press',
    3: 'secondary',
    4: 'unverified',
}

TIER_LABELS: dict[int, str] = {
    0: 'tài liệu chủ nhà cung cấp',
    1: 'nguồn chính chủ / chính thống',
    2: 'báo chí chính thống',
    3: 'nguồn thứ cấp',
    4: 'nguồn không kiểm chứng được',
}

TYPE_LABELS: dict[str, str] = {
    'normal': 'nguồn thường',
    'host-doc': 'tài liệu chủ nhà cung cấp',
    'official-social': 'trang chính thức của cơ quan trên mạng xã hội',
    'confirm': 'bản xác nhận',
}

#: Tầng 1 — chính chủ / chính thống. Host khớp **chính xác** hoặc khớp hậu tố `.host`.
TIER1_HOSTS: tuple[str, ...] = (
    'vanban.chinhphu.vn',
    'vbpl.vn',
    'chinhphu.vn',
    'xaydungchinhsach.chinhphu.vn',
    'moh.gov.vn',
    'who.int',
    'doi.org',
    'arxiv.org',
    'openalex.org',
    'europepmc.org',
    'ncbi.nlm.nih.gov',
    'pubmed.ncbi.nlm.nih.gov',
    'github.com',
)

#: Hậu tố nhận **cả** host con (`.gov.vn` phủ `moh.gov.vn`, `kcb.vn` không thuộc).
GOV_SUFFIXES: tuple[str, ...] = ('.gov.vn', '.gov', '.edu.vn', '.europa.eu', '.ac.uk')

#: Tầng 1 theo HAI cách khớp: hậu tố host (`readthedocs.io`, `docs.python.org`) và NHÃN ĐẦU
#: của host (`docs.`, `developer.` — kho mã chính chủ, tài liệu hãng).
TIER1_SUFFIXES: tuple[str, ...] = ('docs.', 'developer.', 'developers.', 'readthedocs.io',
                                   'docs.python.org')

#: Tầng 2 — báo chí chính thống.
TIER2_HOSTS: tuple[str, ...] = (
    'nhandan.vn',
    'baochinhphu.vn',
    'vietnamplus.vn',
    'vov.vn',
    'vtv.vn',
    'vnexpress.net',
    'tuoitre.vn',
    'thanhnien.vn',
    'laodong.vn',
    'sggp.org.vn',
    'qdnd.vn',
)

#: Tầng 4 — không kiểm chứng được.
TIER4_HOSTS: tuple[str, ...] = (
    'facebook.com',
    'm.facebook.com',
    'x.com',
    'twitter.com',
    'tiktok.com',
    'youtube.com',
    'reddit.com',
    'medium.com',
    'blogspot.com',
    'wordpress.com',
    'quora.com',
    'pinterest.com',
)

#: Trang chính thức của cơ quan/toà soạn trên mạng xã hội (host + tiền tố đường dẫn).
#: #5991/#5997: dùng được, tính **ngang** chính thống, nhưng cần bản xác nhận thứ hai.
OFFICIAL_SOCIAL: tuple[str, ...] = (
    'facebook.com/soyte',
    'facebook.com/bo.yte',
    'facebook.com/chinhphu',
    'facebook.com/thongtinchinhphu',
    'facebook.com/baonhandan',
    'facebook.com/baochinhphu',
    'facebook.com/vietnamplus',
    'facebook.com/vov',
    'facebook.com/vtv',
    'youtube.com/@chinhphu',
    'youtube.com/@baochinhphu',
    'youtube.com/@vov',
    'youtube.com/@vtv',
)

REASONS: tuple[str, ...] = (
    'host-in-table',
    'gov-vn-suffix',
    'default-unknown',
    'owner-supplied',
    'official-social',
    'env-override',
)

SOURCE_TIERS_ENV = 'BOXFOX_SOURCE_TIERS'

#: Kiểu bản đã đọc — trường bắt buộc của sổ nguồn (#6009/#6010).
READ_KINDS: tuple[str, ...] = ('html', 'jats', 'pdf-table', 'reader-text', 'page-image')


@dataclass(frozen=True)
class Tier:
    """Kết quả xếp tầng. `reason` là chuỗi máy đọc được (xem `REASONS`)."""

    tier: int
    type: str
    host: str
    reason: str

    @property
    def label(self) -> str:
        return TIER_LABELS.get(self.tier, TIER_LABELS[3])

    @property
    def type_label(self) -> str:
        return TYPE_LABELS.get(self.type, TYPE_LABELS['normal'])

    @property
    def is_primary(self) -> bool:
        """Tầng 0–1: một nguồn là đủ cho khẳng định then chốt (#5985)."""
        return self.tier <= 1


def host_of(url: str) -> str:
    """Host đã chuẩn hoá: bỏ `www.`, bỏ cổng, viết thường. Chuỗi rỗng ⇒ chuỗi rỗng."""
    if not isinstance(url, str) or not url.strip():
        return ''
    raw = url.strip()
    if '://' not in raw:
        raw = 'https://' + raw
    try:
        host = (urlparse(raw).hostname or '').strip().lower()
    except ValueError:
        return ''
    if host.startswith('www.'):
        host = host[4:]
    return host


def path_of(url: str) -> str:
    if not isinstance(url, str) or not url.strip():
        return ''
    raw = url.strip()
    if '://' not in raw:
        raw = 'https://' + raw
    try:
        return (urlparse(raw).path or '').strip()
    except ValueError:
        return ''


def _host_in(host: str, table: tuple[str, ...]) -> bool:
    for entry in table:
        if host == entry or host.endswith('.' + entry):
            return True
    return False


def _suffix_in(host: str, suffixes: tuple[str, ...]) -> bool:
    return any(host.endswith(suffix) for suffix in suffixes)


def _prefix_in(host: str, prefixes: tuple[str, ...]) -> bool:
    """Khớp theo NHÃN ĐẦU của host: `docs.` phủ `docs.python.org`, **không** phủ `notdocs.org`.

    `TIER1_SUFFIXES` giữ hai kiểu mục vì cả hai đều là "host con của chính chủ"; nếu chỉ so hậu tố
    thì `docs.`/`developer.` không bao giờ khớp, và bốn mục ấy thành trang trí.
    """
    return any(host.startswith(prefix) and len(host) > len(prefix)
               for prefix in prefixes if prefix.endswith('.'))


def _social_match(host: str, path: str, table: tuple[str, ...]) -> bool:
    full = f'{host}{path}'.rstrip('/').lower()
    for entry in table:
        needle = entry.rstrip('/').lower()
        if host != needle.split('/')[0]:
            continue
        if full == needle or full.startswith(needle):
            return True
    return False


def classify(
    url: str,
    *,
    type: str | None = None,
    method: str | None = None,
    overrides: dict[int, tuple[str, ...]] | None = None,
    official_social: tuple[str, ...] | None = None,
) -> Tier:
    """Xếp một URL vào thang nguồn. **Không bao giờ ném**, luôn trả một `Tier`.

    `type` do người gọi khai (`host-doc`, `official-social`, `confirm`); `method` là cách lấy
    (`workspace` ⇒ tài liệu chủ nhà). `overrides` là bảng phủ từ biến môi trường.
    """
    host = host_of(url)
    path = path_of(url)
    declared = (type or '').strip() or None
    social_table = official_social if official_social is not None else OFFICIAL_SOCIAL

    if declared == 'host-doc' or (method or '').strip() == 'workspace':
        return Tier(0, 'host-doc', host, 'owner-supplied')

    if declared == 'official-social' or _social_match(host, path, social_table):
        if host:
            return Tier(1, 'official-social', host, 'official-social')

    kind = declared if declared == 'confirm' else 'normal'

    if overrides:
        for tier_number in (1, 2, 3, 4):
            table = overrides.get(tier_number) or ()
            if table and _host_in(host, tuple(table)):
                return Tier(tier_number, kind, host, 'env-override')

    if _host_in(host, TIER1_HOSTS) or _suffix_in(host, TIER1_SUFFIXES) \
            or _prefix_in(host, TIER1_SUFFIXES):
        return Tier(1, kind, host, 'host-in-table')

    if _host_in(host, TIER2_HOSTS):
        return Tier(2, kind, host, 'host-in-table')

    if _host_in(host, TIER4_HOSTS):
        return Tier(4, kind, host, 'host-in-table')

    if host and _suffix_in(host, GOV_SUFFIXES):
        return Tier(1, kind, host, 'gov-vn-suffix')

    return Tier(3, kind, host, 'default-unknown')


# --- Bảng phủ từ biến môi trường (#5975) ----------------------------------


@dataclass(frozen=True)
class OverrideResult:
    """Kết quả nạp bảng phủ. `error` khác None ⇒ người gọi **phải** ghi log + notice."""

    overrides: dict[int, tuple[str, ...]]
    official_social: tuple[str, ...]
    error: str | None
    source: str


def parse_overrides(raw: str | None) -> OverrideResult:
    """Đọc JSON inline **hoặc** đường dẫn tệp JSON. Hỏng ⇒ trả bảng rỗng + lý do."""
    empty = OverrideResult({}, (), None, 'none')
    if not raw or not raw.strip():
        return empty
    text = raw.strip()
    source = 'inline'
    candidate = Path(text)
    try:
        if not text.startswith('{') and candidate.is_file():
            text = candidate.read_text(encoding='utf-8')
            source = 'file'
    except OSError as exc:  # pragma: no cover - đường lỗi hiếm, ca test dùng chuỗi
        return OverrideResult({}, (), f'không đọc được tệp ({exc.__class__.__name__})', source)
    try:
        data = json.loads(text)
    except (ValueError, TypeError) as exc:
        return OverrideResult({}, (), f'JSON hỏng ({exc.__class__.__name__})', source)
    if not isinstance(data, dict):
        return OverrideResult({}, (), 'JSON phải là một object', source)

    tiers: dict[int, tuple[str, ...]] = {}
    raw_tiers = data.get('tiers')
    if isinstance(raw_tiers, dict):
        for key, value in raw_tiers.items():
            try:
                number = int(str(key))
            except (TypeError, ValueError):
                return OverrideResult({}, (), f'khoá tầng không phải số: {key!r}', source)
            if number not in (1, 2, 3, 4):
                return OverrideResult({}, (), f'tầng ngoài 1..4: {number}', source)
            if not isinstance(value, (list, tuple)) or any(not isinstance(item, str) for item in value):
                return OverrideResult({}, (), f'danh sách host của tầng {number} không hợp lệ', source)
            cleaned = tuple(item.strip().lower() for item in value if item.strip())
            if cleaned:
                tiers[number] = cleaned
    elif raw_tiers is not None:
        return OverrideResult({}, (), 'khoá "tiers" phải là một object', source)

    social_raw = data.get('officialSocial')
    social: tuple[str, ...] = ()
    if isinstance(social_raw, (list, tuple)):
        if any(not isinstance(item, str) for item in social_raw):
            return OverrideResult({}, (), 'danh sách officialSocial không hợp lệ', source)
        social = tuple(item.strip().lower() for item in social_raw if item.strip())
    elif social_raw is not None:
        return OverrideResult({}, (), 'khoá "officialSocial" phải là danh sách', source)

    if not tiers and not social:
        return OverrideResult({}, (), 'bảng phủ rỗng', source)
    return OverrideResult(tiers, social, None, source)


def load_from_env(env: dict[str, str] | None = None) -> OverrideResult:
    """Nạp bảng phủ từ `BOXFOX_SOURCE_TIERS` (biến môi trường hoặc dict truyền vào)."""
    source = env if env is not None else os.environ
    return parse_overrides(source.get(SOURCE_TIERS_ENV))


def overrides_summary() -> dict[str, object]:
    """Tóm tắt cho `runtime_info`: số host phủ được + lý do hỏng (nếu có)."""
    result = load_from_env()
    return {
        'source': result.source,
        'hosts': sum(len(value) for value in result.overrides.values()),
        'officialSocial': len(result.official_social),
        'unknown': result.error,
    }
