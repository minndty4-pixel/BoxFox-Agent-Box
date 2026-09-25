"""Bảng khai báo hồ sơ việc (vòng 27 · B-3a) — dữ liệu thuần, không luật.

Ba nhóm hồ sơ bằng chứng (`official-document`, `academic`, `market`), chín mẫu con và một
mẫu trung lập `mixed` cho việc nghiên cứu nhiều phương pháp. Mỗi mẫu bằng chứng khai
**trường bắt buộc** với mức `hard` (thiếu ⇒ hồ sơ đỏ) hoặc `soft` (thiếu ⇒ nhắc), **luật chờ**
(`any_of` — nhóm trường chỉ cần một cái), **luật hiệu lực** (`validity`), và **số nguồn độc lập
tối thiểu** cho khẳng định then chốt.

Danh mục TM-1…TM-10 (thị trường) và bốn archetype C1/C2/C2′/C3/C4 nằm ở cuối tệp — máy đọc được,
để cổng chất lượng đối chiếu mà không cần suy luận.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from typing import Any, Mapping, Sequence

# --- Nhóm và nhãn ----------------------------------------------------------

GROUPS: tuple[str, ...] = ('official-document', 'academic', 'market', 'mixed')

GROUP_LABELS: Mapping[str, str] = {
    'official-document': 'văn bản chính thống',
    'academic': 'học thuật & kỹ thuật',
    'market': 'thị trường',
    'mixed': 'nghiên cứu đa phương pháp',
}

KINDS: tuple[str, ...] = ('text', 'enum', 'number', 'date', 'url')


@dataclass(frozen=True)
class Field:
    """Một trường hồ sơ. `required` = `hard` | `soft`; `kind` để máy kiểm dạng giá trị."""

    key: str
    required: str = 'hard'
    kind: str = 'text'
    label: str = ''
    values: tuple[str, ...] = ()

    @property
    def is_hard(self) -> bool:
        return self.required == 'hard'


@dataclass(frozen=True)
class Profile:
    """Một hồ sơ việc: trường bắt buộc + luật riêng của nhóm."""

    key: str
    group: str
    label: str
    fields: tuple[Field, ...] = ()
    any_of: tuple[tuple[str, ...], ...] = ()
    validity: bool = False
    validity_fields: tuple[str, ...] = ()
    min_independent: int = 2
    host_doc: bool = False
    usecases: tuple[str, ...] = ()
    archetype: str = ''
    notes: str = ''

    def field(self, key: str) -> Field | None:
        for item in self.fields:
            if item.key == key:
                return item
        return None

    @property
    def hard_fields(self) -> tuple[Field, ...]:
        return tuple(item for item in self.fields if item.is_hard)

    @property
    def all_keys(self) -> tuple[str, ...]:
        return tuple(item.key for item in self.fields)

    def missing(self, payload: Mapping[str, Any]) -> list[tuple[Field, str]]:
        """Trường thiếu + mức. Nhóm `any_of` được tính là đủ khi có **một** khoá."""
        missing: list[tuple[Field, str]] = []
        payload = payload or {}
        for group_keys in self.any_of:
            if not any(str(payload.get(key, '')).strip() for key in group_keys):
                first = self.field(group_keys[0])
                required = first.required if first else 'hard'
                label = ' hoặc '.join(group_keys)
                missing.append((Field(key=label, required=required, kind='text', label=label), required))
        covered = {key for group_keys in self.any_of for key in group_keys}
        for item in self.fields:
            if item.key in covered:
                continue
            if str(payload.get(item.key, '')).strip():
                continue
            missing.append((item, item.required))
        return missing


# --- Chín mẫu bằng chứng và một mẫu việc hỗn hợp ----------------------------

LAW = Profile(
    key='law',
    group='official-document',
    label='luật',
    fields=(
        Field('docNumber', 'hard', 'text', 'số hiệu văn bản'),
        Field('effectiveDate', 'hard', 'date', 'ngày hiệu lực'),
        Field('validity', 'hard', 'enum', 'còn/hết hiệu lực', values=('in_force', 'expired', 'unknown')),
        Field('issuingBody', 'soft', 'text', 'cơ quan ban hành'),
        Field('appliesTo', 'soft', 'text', 'đối tượng áp dụng'),
    ),
    validity=True,
    validity_fields=('docNumber', 'effectiveDate', 'validity'),
    usecases=('TM-6',),
    archetype='C4',
)

HEALTH = Profile(
    key='health',
    group='official-document',
    label='y tế',
    fields=(
        Field('docNumber', 'hard', 'text', 'số hiệu văn bản'),
        Field('effectiveDate', 'hard', 'date', 'ngày hiệu lực'),
        Field('validity', 'hard', 'enum', 'còn/hết hiệu lực', values=('in_force', 'expired', 'unknown')),
        Field('appliesTo', 'hard', 'text', 'đối tượng áp dụng (tuyến, nhóm bệnh, mức hưởng)'),
        Field('issuingBody', 'soft', 'text', 'cơ quan ban hành'),
    ),
    validity=True,
    validity_fields=('docNumber', 'effectiveDate', 'validity'),
    usecases=('TM-6',),
    archetype='C4',
)

FINANCE = Profile(
    key='finance',
    group='official-document',
    label='tài chính',
    fields=(
        Field('rate', 'hard', 'number', 'mức/thuế/phí'),
        Field('effectiveDate', 'hard', 'date', 'ngày hiệu lực'),
        Field('validity', 'hard', 'enum', 'còn/hết hiệu lực', values=('in_force', 'expired', 'unknown')),
        Field('docNumber', 'soft', 'text', 'số hiệu văn bản'),
        Field('unit', 'soft', 'text', 'đơn vị tính'),
    ),
    validity=True,
    validity_fields=('effectiveDate', 'validity'),
    usecases=('TM-1', 'TM-6'),
    archetype='C4',
)

PAPER = Profile(
    key='paper',
    group='academic',
    label='bài báo khoa học',
    fields=(
        Field('doi', 'hard', 'text', 'DOI'),
        Field('arxivId', 'hard', 'text', 'arXiv id'),
        Field('year', 'hard', 'number', 'năm'),
        Field('venue', 'soft', 'text', 'nơi công bố'),
        Field('authors', 'soft', 'text', 'tác giả'),
        Field('openedFullText', 'hard', 'text', 'đã mở toàn văn (không trích tóm tắt)'),
    ),
    any_of=(('doi', 'arxivId'),),
    usecases=('TM-9',),
    notes='Toàn văn phải mở thật; tóm tắt/tìm kiếm không tính (#6002).',
)

VENDOR_DOC = Profile(
    key='vendor-doc',
    group='academic',
    label='tài liệu hãng',
    fields=(
        Field('product', 'hard', 'text', 'sản phẩm/thành phần'),
        Field('version', 'hard', 'text', 'phiên bản'),
        Field('publishedAt', 'hard', 'date', 'ngày phát hành'),
        Field('accessedAt', 'hard', 'date', 'ngày lấy'),
        Field('url', 'soft', 'url', 'đường dẫn chính chủ'),
    ),
    notes='Tài liệu hãng là tầng 1; bản sao trên blog bên thứ ba là tầng 3.',
)

REPO = Profile(
    key='repo',
    group='academic',
    label='kho mã',
    fields=(
        Field('repo', 'hard', 'text', 'kho mã'),
        Field('commit', 'hard', 'text', 'commit/phiên bản'),
        Field('accessedAt', 'hard', 'date', 'ngày lấy'),
        Field('file', 'soft', 'text', 'tệp/dòng đã đọc'),
    ),
)

PRICE = Profile(
    key='price',
    group='market',
    label='giá',
    fields=(
        Field('price', 'hard', 'number', 'giá'),
        Field('currency', 'hard', 'enum', 'đơn vị tiền', values=('VND', 'USD', 'EUR')),
        Field('capturedAt', 'hard', 'date', 'ngày lấy'),
        Field('region', 'hard', 'text', 'khu vực'),
        Field('package', 'soft', 'text', 'gói/phiên bản'),
        Field('taxIncluded', 'soft', 'enum', 'đã gồm thuế–phí chưa', values=('yes', 'no', 'unknown')),
    ),
    usecases=('TM-1', 'TM-7'),
    archetype='C1',
)

COMPETITOR = Profile(
    key='competitor',
    group='market',
    label='đối thủ',
    fields=(
        Field('name', 'hard', 'text', 'tên'),
        Field('positioning', 'hard', 'text', 'mô hình/định vị'),
        Field('price', 'soft', 'text', 'giá hoặc khoảng giá'),
        Field('channel', 'hard', 'text', 'loại kênh thấy nó'),
    ),
    usecases=('TM-2', 'TM-9'),
    archetype='C1',
    notes='Mỗi đối thủ chính cần ≥ 1 nguồn gốc; ≥ 2 loại kênh; mặc định 5–8; trần 10–15.',
)

USERS = Profile(
    key='users',
    group='market',
    label='người dùng',
    fields=(
        Field('pain', 'hard', 'text', 'nỗi đau diễn giải ngắn'),
        Field('reports', 'hard', 'number', 'số lượt phản ánh khác nhau'),
        Field('platforms', 'hard', 'number', 'số nền tảng'),
        Field('confidence', 'soft', 'enum', 'mức tin cậy', values=('verified', 'signal', 'single')),
        Field('secondKind', 'soft', 'text', 'nguồn thứ hai khác loại'),
    ),
    usecases=('TM-3', 'TM-10'),
    archetype='C2′',
    notes='Một lượt phàn nàn đơn lẻ không phải gap đã kiểm — phải ghi "chỉ 1 lượt".',
)

MIXED = Profile(
    key='mixed',
    group='mixed',
    label='nhiều loại bằng chứng',
    # A v2 job can mix laws, studies, product pages and community reports.
    # Document-specific fields are checked on their own evidence rows, never
    # invented as a single global schema for the entire job.
    fields=(),
    notes='Mẫu trung lập cho việc pha trộn nguồn; không thay thế kiểm tra từng loại bằng chứng.',
)

PROFILES: Mapping[str, Profile] = {
    item.key: item
    for item in (LAW, HEALTH, FINANCE, PAPER, VENDOR_DOC, REPO, PRICE, COMPETITOR, USERS, MIXED)
}

PROFILE_LABELS: Mapping[str, str] = {key: item.label for key, item in PROFILES.items()}


def get(key: str) -> Profile | None:
    return PROFILES.get((key or '').strip().lower())


def by_group(group: str) -> tuple[Profile, ...]:
    group = (group or '').strip().lower()
    return tuple(item for item in PROFILES.values() if item.group == group)


def default_for_group(group: str) -> Profile | None:
    items = by_group(group)
    return items[0] if items else None


def resolve(group_or_key: str) -> Profile | None:
    """Nhận **tên nhóm** hoặc **tên hồ sơ** (một hồ sơ hoặc hồ sơ đầu của nhóm)."""
    value = (group_or_key or '').strip().lower()
    direct = PROFILES.get(value)
    if direct is not None:
        return direct
    return default_for_group(value)


def group_of(key: str) -> str:
    item = PROFILES.get((key or '').strip().lower())
    return item.group if item else ''


def label_of(key: str) -> str:
    """Nhãn người đọc: `văn bản chính thống (y tế)` — dùng ở đầu hồ sơ và báo cáo."""
    item = PROFILES.get((key or '').strip().lower())
    if item is None:
        return ''
    group_label = GROUP_LABELS.get(item.group, item.group)
    return f'{group_label} ({item.label})' if item.label else group_label


def missing_fields(key: str, payload: Mapping[str, Any]) -> list[tuple[str, str]]:
    """`[(nhãn trường, mức)]` cho trường còn thiếu."""
    item = PROFILES.get((key or '').strip().lower())
    if item is None:
        return []
    return [(field.label or field.key, level) for field, level in item.missing(payload)]


def required_keys(key: str) -> tuple[str, ...]:
    item = PROFILES.get((key or '').strip().lower())
    if item is None:
        return ()
    return tuple(field.key for field in item.hard_fields)


# --- Danh mục usecase thị trường (TM-1…TM-10) ------------------------------


@dataclass(frozen=True)
class UseCase:
    key: str
    label: str
    archetype: str
    fields: tuple[str, ...] = ()
    cap: tuple[int, int] | None = None
    note: str = ''


USECASES: Mapping[str, UseCase] = {
    'TM-1': UseCase('TM-1', 'giá & chính sách giá', 'C1', ('price', 'capturedAt', 'region'), (5, 8)),
    # TM-2 là ngoại lệ đã chốt ở kế hoạch vòng 27 §C-10 (#6007): trần đối thủ là **10–15** đơn vị,
    # không phải 5–8. Con số sống ở đây, trên chính usecase — bảng `MARKET_CAPS` chép lại nó ở chỗ
    # khác đã bị xoá vì hai bản ấy lệch nhau và không ai đọc bản thứ hai.
    'TM-2': UseCase('TM-2', 'đối thủ', 'C1', ('name', 'channel'), (10, 15)),
    'TM-3': UseCase('TM-3', 'nỗi đau / gap người dùng', 'C2′', ('pain', 'reports', 'platforms')),
    'TM-4': UseCase('TM-4', 'quy mô & xu hướng', 'C3', ('value', 'unit', 'year', 'publisher')),
    'TM-5': UseCase('TM-5', 'khách hàng mục tiêu', 'C3', ('segment', 'basis')),
    'TM-6': UseCase('TM-6', 'quy định/pháp lý', 'C4', ('docNumber', 'effectiveDate', 'validity')),
    'TM-7': UseCase('TM-7', 'kênh & đối tác', 'C1', ('channel', 'price', 'currency', 'capturedAt'), (3, 5)),
    'TM-8': UseCase('TM-8', 'nhu cầu theo địa bàn', 'C3', ('region', 'indicator', 'year')),
    'TM-9': UseCase('TM-9', 'sản phẩm thay thế & công nghệ mới', 'C3', ('name', 'status', 'year')),
    'TM-10': UseCase('TM-10', 'niềm tin, uy tín & cộng đồng', 'C2', ('claim', 'direction', 'reports')),
}

def usecase(key: str) -> UseCase | None:
    return USECASES.get((key or '').strip().upper())


# --- Bốn archetype (Phần 2 của tài liệu thị trường) ------------------------


@dataclass(frozen=True)
class Archetype:
    key: str
    label: str
    rule: str
    counts: Mapping[str, int] = dc_field(default_factory=dict)


ARCHETYPES: Mapping[str, Archetype] = {
    'C1': Archetype('C1', 'danh mục kín', 'mỗi mục ≥ 1 nguồn gốc; danh sách từ ≥ 2 loại kênh; bão hoà sau 2 vòng',
                    {'channels': 2, 'saturationRounds': 2}),
    'C2': Archetype('C2', 'nỗi đau / niềm tin', 'mỗi mục ≥ 3 lượt độc lập hoặc 1 lượt + 1 nguồn khác loại',
                    {'reports': 3, 'saturationRounds': 2}),
    'C2′': Archetype('C2′', 'nỗi đau / gap đã kiểm',
                     'sàn ≥ 20 lượt / ≥ 10 cùng chủ đề / ≥ 2 nền tảng + 1 nguồn tổng hợp; đích 30–50 / ≥ 15 / ≥ 3 nền tảng',
                     {'rows': 20, 'sameTopic': 10, 'platforms': 2, 'targetRows': 30, 'targetRowsMax': 50,
                      'targetSameTopic': 15, 'targetPlatforms': 3}),
    'C3': Archetype('C3', 'số liệu tổng hợp', 'bản gốc công bố (tổ chức · năm · cỡ mẫu) + nơi thứ hai cùng nói',
                    {'independent': 2}),
    'C4': Archetype('C4', 'văn bản chính thống', 'số hiệu + ngày hiệu lực + dấu còn/hết hiệu lực; một nguồn tầng 1 là đủ',
                    {'independent': 1}),
}


def archetype(key: str) -> Archetype | None:
    return ARCHETYPES.get((key or '').strip().upper())


def describe() -> list[dict[str, Any]]:
    """Khuôn cho `runtime_info` — máy đọc được, không chứa nội dung phiên."""
    return [
        {
            'key': item.key,
            'group': item.group,
            'label': label_of(item.key),
            'required': list(required_keys(item.key)),
            'soft': [field.key for field in item.fields if not field.is_hard],
            'anyOf': [list(keys) for keys in item.any_of],
            'validity': item.validity,
            'minIndependent': item.min_independent,
            'usecases': list(item.usecases),
            'archetype': item.archetype,
        }
        for item in PROFILES.values()
    ]


def summary_for(keys: Sequence[str]) -> str:
    """`y tế + luật` — dòng nhãn cho hồ sơ nhiều hồ sơ con."""
    labels = [PROFILE_LABELS[key] for key in keys if key in PROFILE_LABELS]
    return ' + '.join(labels)
