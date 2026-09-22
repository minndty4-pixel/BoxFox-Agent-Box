"""Khối header `boxfox-plan`: cặp regex chuẩn + hàm dựng/đọc phía harness.

Vì sao có file này
------------------
Vòng 20 (§2 của `docs`-plan) chốt: số version và identity của một plan phải sống **trong chính
file plan**, không chỉ trong tên file. Lý do là ca sống: copy/rename một file `.plans/v4-*.md`
ra chỗ khác là mất luôn quan hệ cha–con, mà quan hệ đó mới là thứ giữ bản sửa gắn với bản gốc.

Hợp đồng
--------
Khối là một comment HTML nằm ở đầu file (khi render markdown thì vô hình với người đọc)::

    <!-- boxfox-plan
    Version: v4
    Identity: clinical-patient-record-lookup-research
    Parent: v3
    Slug: research-patient-record-lookup
    -->

`Version`/`Identity`/`Parent` **bắt buộc**; `Slug` chỉ ghi khi model xin một slug khác slug chuẩn
của nhóm. Khối phải đóng trong `HEADER_MAX_LINES` dòng đầu.

* `build_plan_header(version, identity, parent, declared_slug=None) -> str` — harness dựng khối
  trước khi gọi sandbox (`runtime.write_plan`). Sandbox không sửa nội dung, chỉ ghi file đúng tên.
* `parse_plan_header(markdown) -> PlanHeader | None` — **không bao giờ raise**: đầu vào không phải
  chuỗi trả `None`, mọi trường hợp khác trả một `PlanHeader` với `status` ∈ `{'ok','invalid','missing'}`.
  `missing` = không có khối (file cũ: hợp lệ, không phải lỗi); `invalid` = có khối nhưng sai cú pháp
  hoặc thiếu khoá bắt buộc.

`HEADER_PATTERNS` là **bản sao bắt buộc** của `HEADER_PATTERNS` trong `deploy/docker/plan_files.py`
(nguồn chân lý). Hai chuỗi regex phải giống nhau từng ký tự; `backend/tests/unit/test_plan_header.py`
tự nạp file box bằng đường dẫn để so từng khoá, nên hai cây không thể lệch nhau trong im lặng.

Lưu ý: `Identity`/`Slug` ở đây chỉ để số version sống sót khi copy file — **việc nhóm plan vẫn luôn
theo tên file** (đường dẫn là biên an toàn của reader).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ['HEADER_PATTERNS', 'HEADER_MAX_LINES', 'HEADER_KEYS', 'SLUG_PATTERN',
           'IDENTITY_PATTERN', 'PlanHeader', 'build_plan_header', 'parse_plan_header',
           'header_block_lines']

# Bản sao của `deploy/docker/plan_files.py`. `_SLUG`/`_VERSION` giữ y hệt, kể cả độ dài tối đa
# 10 chữ số của version, để một file ghi trên box luôn đọc được ở đây và ngược lại.
_SLUG = r'[a-z0-9]+(?:-[a-z0-9]+)*'
_VERSION = r'[1-9][0-9]{0,9}'
_IDENTITY_RE_GROUP = rf'(?:{_SLUG}/)*{_SLUG}'

# Grammar trần của slug/identity, cho nơi khác trong harness cần validate một tham số tool
# (`plan_registry`): cùng một nguồn với khối header, nên không có bản sao thứ ba.
SLUG_PATTERN = _SLUG
IDENTITY_PATTERN = _IDENTITY_RE_GROUP

_HEADER_OPEN_RE = re.compile(r'^<!--\s*boxfox-plan\s*$')
_HEADER_CLOSE_RE = re.compile(r'^-->\s*$')
_HEADER_VERSION_RE = re.compile(rf'^Version:\s*v({_VERSION})$')
_HEADER_IDENTITY_RE = re.compile(rf'^Identity:\s*({_IDENTITY_RE_GROUP})$')
_HEADER_PARENT_RE = re.compile(rf'^Parent:\s*(?:v({_VERSION})|none)$')
_HEADER_SLUG_RE = re.compile(rf'^Slug:\s*({_SLUG})$')

# Khối phải đóng trong 12 dòng đầu: đủ rộng cho 4 khoá + comment mở/đóng, đủ hẹp để một tài liệu
# không bị coi là "có header" chỉ vì tình cờ nhắc tới nó ở giữa bài.
HEADER_MAX_LINES = 12

# Tên khoá -> chuỗi regex. Test ở `backend/tests/unit/test_plan_header.py` so `HEADER_PATTERNS` của
# file này với dict cùng tên trong `deploy/docker/plan_files.py`.
HEADER_PATTERNS = {
    'open': _HEADER_OPEN_RE.pattern,
    'close': _HEADER_CLOSE_RE.pattern,
    'version': _HEADER_VERSION_RE.pattern,
    'identity': _HEADER_IDENTITY_RE.pattern,
    'parent': _HEADER_PARENT_RE.pattern,
    'slug': _HEADER_SLUG_RE.pattern,
}

# Ba khoá bắt buộc, theo đúng thứ tự harness ghi ra.
HEADER_KEYS = ('Version', 'Identity', 'Parent')


@dataclass(frozen=True)
class PlanHeader:
    """Kết quả đọc khối header. `status`: `ok` | `invalid` | `missing`.

    `body_offset` = chỉ số dòng (0-based) bắt đầu phần thân, tức dòng ngay sau `-->`; các kiểm tra
    "chỉ xét thân" (§5) dùng nó để không tính chính khối header vào nội dung plan.
    """

    version: int | None
    identity: str
    parent: int | None
    declared_slug: str | None
    status: str
    body_offset: int

    @property
    def ok(self) -> bool:
        return self.status == 'ok'

    def to_payload(self) -> dict:
        """Dạng camelCase để nhét vào event/API, khớp tên trường phía box."""
        return {
            'status': self.status,
            'version': self.version,
            'identity': self.identity,
            'parent': self.parent,
            'declaredSlug': self.declared_slug,
            'bodyOffset': self.body_offset,
        }


def header_block_lines(version, identity, parent, declared_slug=None):
    """Các dòng của khối header, chưa ghép. `parent=None` ghi `Parent: none`.

    Tách khỏi `build_plan_header` để `plan_eval` so được khối model tự viết với khối chuẩn mà
    không phải parse lại chuỗi.
    """
    lines = ['<!-- boxfox-plan', f'Version: v{int(version)}', f'Identity: {identity}']
    lines.append('Parent: none' if parent is None else f'Parent: v{int(parent)}')
    if declared_slug:
        lines.append(f'Slug: {declared_slug}')
    lines.append('-->')
    return lines


def build_plan_header(version, identity, parent, declared_slug=None) -> str:
    """Khối header đúng 4–5 dòng, kết thúc bằng newline (ghép thẳng lên đầu markdown).

    Không validate sâu ở đây: người gọi đã chọn version/identity bằng luật của `plan_registry`,
    và một chuỗi sai sẽ bị `parse_plan_header` bắt ở lần đọc kế tiếp. Validate ở đây chỉ khiến
    lỗi hiện ra ở hai chỗ thay vì một.
    """
    return '\n'.join(header_block_lines(version, identity, parent, declared_slug)) + '\n'


def parse_plan_header(markdown):
    """Đọc khối `boxfox-plan` ở đầu `markdown`. Không bao giờ raise.

    Trả `PlanHeader` với `status`:

    * `missing` — không có dòng `<!-- boxfox-plan` nào trong `HEADER_MAX_LINES` dòng đầu (file cũ,
      hợp lệ).
    * `invalid` — có comment mở nhưng: chưa đóng trong `HEADER_MAX_LINES` dòng, thiếu một trong ba
      khoá bắt buộc, khoá lặp, hoặc có dòng lạ không rỗng trong khối.
    * `ok` — đóng đúng hạn và đủ ba khoá bắt buộc (`Slug` tuỳ chọn).

    Khi `invalid`, các trường đọc được vẫn được giữ (best-effort) để thông báo lỗi nói được cái
    gì đã khai; `body_offset` trỏ ngay sau dòng đóng nếu tìm thấy, ngược lại là 0.
    """
    if not isinstance(markdown, str):
        return None
    lines = markdown.splitlines()
    start = None
    for index in range(min(HEADER_MAX_LINES, len(lines))):
        if _HEADER_OPEN_RE.match(lines[index]):
            start = index
            break
    if start is None:
        return PlanHeader(None, '', None, None, 'missing', 0)

    version = None
    identity = ''
    parent = None
    declared_slug = None
    has_parent = False
    seen: set[str] = set()
    closed_at = None
    valid = True

    def field_is_new(name: str) -> bool:
        """Khoá lặp trong cùng một khối = mơ hồ → khối hỏng, không đoán."""
        if name in seen:
            return False
        seen.add(name)
        return True

    # Cố tình viết song song từng dòng với `plan_files.parse_plan_header` (bản box): hai bên phải
    # cho cùng kết quả trên cùng đầu vào, và một test so bảng ca hai chiều để không lệch.
    for index in range(start + 1, min(len(lines), start + HEADER_MAX_LINES + 1)):
        line = lines[index]
        if _HEADER_CLOSE_RE.match(line):
            closed_at = index
            break
        match = _HEADER_VERSION_RE.match(line)
        if match:
            if field_is_new('Version'):
                version = int(match.group(1))
            else:
                valid = False
            continue
        match = _HEADER_IDENTITY_RE.match(line)
        if match:
            if field_is_new('Identity'):
                identity = match.group(1)
            else:
                valid = False
            continue
        match = _HEADER_PARENT_RE.match(line)
        if match:
            if field_is_new('Parent'):
                has_parent = True
                parent = int(match.group(1)) if match.group(1) else None
            else:
                valid = False
            continue
        match = _HEADER_SLUG_RE.match(line)
        if match:
            if field_is_new('Slug'):
                declared_slug = match.group(1)
            else:
                valid = False
            continue
        if line.strip():
            valid = False  # dòng lạ trong khối: không đoán ý
    if closed_at is None:
        valid = False
    if version is None or not identity or not has_parent:
        valid = False

    body_offset = closed_at + 1 if closed_at is not None else start + 1
    return PlanHeader(version, identity, parent, declared_slug,
                      'ok' if valid else 'invalid', body_offset)
