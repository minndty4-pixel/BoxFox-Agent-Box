"""Khối header của hồ sơ research (vòng 27 đợt 4) — khuôn `plan_header`, không bao giờ ném.

Mọi tệp hồ sơ trong `.research/<slug>/` mở đầu bằng khối comment máy đọc được:

    <!-- boxfox-research
    Version: v1
    ResearchId: health-insurance-admission
    Profile: health
    Level: 2
    Critique: none
    Gate: clear
    Rows: 12
    -->

Vì sao là comment HTML chứ không front matter YAML: chủ nhà mở tệp trong trình duyệt workspace, và
comment HTML không hiện ra trong bản đọc — cùng lựa chọn đã dùng cho `.plans/` (ADR-0003).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

HEADER_MAX_LINES = 14

_OPEN_RE = re.compile(r'^\s*<!--\s*boxfox-research\s*$', re.IGNORECASE)
_CLOSE_RE = re.compile(r'^\s*-->\s*$')
_VERSION_RE = re.compile(r'^Version:\s*v(\d{1,10})\s*$')
_RESEARCH_ID_RE = re.compile(r'^ResearchId:\s*([a-z0-9][a-z0-9-]{0,60})\s*$')
_PROFILE_RE = re.compile(r'^Profile:\s*([a-z0-9-]{1,40})\s*$')
_LEVEL_RE = re.compile(r'^Level:\s*([1-3])\s*$')
_CRITIQUE_RE = re.compile(r'^Critique:\s*(none|ok|revise)\s*$', re.IGNORECASE)
_GATE_RE = re.compile(r'^Gate:\s*(clear|warn|unbacked)\s*$', re.IGNORECASE)
_ROWS_RE = re.compile(r'^Rows:\s*(\d{1,6})\s*$')

#: Bảy khoá, theo đúng thứ tự harness ghi ra (hợp đồng `/var/tmp/v27/iface.md` §4).
HEADER_KEYS = ('Version', 'ResearchId', 'Profile', 'Level', 'Critique', 'Gate', 'Rows')
CRITIQUE_VALUES = ('none', 'ok', 'revise')
GATE_VALUES = ('clear', 'warn', 'unbacked')


@dataclass(frozen=True)
class ResearchHeader:
    """Kết quả đọc khối header. `status`: `ok` | `invalid` | `missing`."""

    version: int | None
    research_id: str
    profile: str
    level: int | None
    critique: str
    gate: str
    rows: int | None
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
            'researchId': self.research_id,
            'profile': self.profile,
            'level': self.level,
            'critique': self.critique,
            'gate': self.gate,
            'rows': self.rows,
            'bodyOffset': self.body_offset,
        }


def header_block_lines(version, research_id, profile, level, critique='none', gate='clear', rows=0):
    """Các dòng của khối header, chưa ghép — tách để test so khối chuẩn mà không phải parse lại."""
    return [
        '<!-- boxfox-research',
        f'Version: v{int(version)}',
        f'ResearchId: {research_id}',
        f'Profile: {profile}',
        f'Level: {int(level)}',
        f'Critique: {critique}',
        f'Gate: {gate}',
        f'Rows: {int(rows)}',
        '-->',
    ]


def build_research_header(version, research_id, profile, level, critique='none', gate='clear', rows=0) -> str:
    """Khối header kết thúc bằng newline (ghép thẳng lên đầu markdown)."""
    return '\n'.join(header_block_lines(version, research_id, profile, level, critique, gate, rows)) + '\n'


def parse_research_header(markdown):
    """Đọc khối `boxfox-research` ở đầu `markdown`. Không bao giờ raise; `None` chỉ khi đầu vào lạ.

    * `missing` — không có dòng mở trong `HEADER_MAX_LINES` dòng đầu (tệp do người viết tay).
    * `invalid` — có comment mở nhưng chưa đóng đúng hạn, thiếu khoá bắt buộc, khoá lặp, hoặc dòng lạ.
    * `ok` — đóng đúng hạn và đủ bảy khoá, giá trị hợp lệ.

    Khi `invalid`, các trường đọc được vẫn giữ (best-effort) để thông báo nói được cái gì đã khai.
    """
    if not isinstance(markdown, str):
        return None
    lines = markdown.splitlines()
    start = None
    for index in range(min(HEADER_MAX_LINES, len(lines))):
        if _OPEN_RE.match(lines[index]):
            start = index
            break
    if start is None:
        return ResearchHeader(None, '', '', None, 'none', 'clear', None, 'missing', 0)

    version: int | None = None
    research_id = ''
    profile = ''
    level: int | None = None
    critique = 'none'
    gate = 'clear'
    rows: int | None = None
    seen: set[str] = set()
    closed_at = None
    valid = True

    def fresh(name: str) -> bool:
        if name in seen:
            return False
        seen.add(name)
        return True

    for index in range(start + 1, min(len(lines), start + HEADER_MAX_LINES + 1)):
        line = lines[index]
        if _CLOSE_RE.match(line):
            closed_at = index
            break
        match = _VERSION_RE.match(line)
        if match:
            if fresh('Version'):
                version = int(match.group(1))
            else:
                valid = False
            continue
        match = _RESEARCH_ID_RE.match(line)
        if match:
            if fresh('ResearchId'):
                research_id = match.group(1)
            else:
                valid = False
            continue
        match = _PROFILE_RE.match(line)
        if match:
            if fresh('Profile'):
                profile = match.group(1)
            else:
                valid = False
            continue
        match = _LEVEL_RE.match(line)
        if match:
            if fresh('Level'):
                level = int(match.group(1))
            else:
                valid = False
            continue
        match = _CRITIQUE_RE.match(line)
        if match:
            if fresh('Critique'):
                critique = match.group(1).lower()
            else:
                valid = False
            continue
        match = _GATE_RE.match(line)
        if match:
            if fresh('Gate'):
                gate = match.group(1).lower()
            else:
                valid = False
            continue
        match = _ROWS_RE.match(line)
        if match:
            if fresh('Rows'):
                rows = int(match.group(1))
            else:
                valid = False
            continue
        if line.strip():
            valid = False

    if closed_at is None:
        valid = False
    if len(seen) < len(HEADER_KEYS):
        valid = False
    body_offset = (closed_at + 1) if closed_at is not None else 0
    return ResearchHeader(version, research_id, profile, level, critique, gate, rows,
                          'ok' if valid else 'invalid', body_offset)
