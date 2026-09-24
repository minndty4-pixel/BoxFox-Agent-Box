"""Khối header của hồ sơ (`research_header.py`, vòng 27 đợt 4).

Header là thứ biến một tệp markdown thành hồ sơ MÁY đọc được: version, mã việc, hồ sơ, mức, đã
phản biện chưa, cổng có sạch không, bao nhiêu dòng sổ. Ca kiểm ghim ba trạng thái (`ok` / `missing`
/ `invalid`) — chủ nhà mở tệp viết tay thì phải ra `missing`, không phải một lỗi.
"""
from __future__ import annotations

from agentbox.agent_core import research_header as rh


def test_the_header_block_carries_all_seven_keys_in_order():
    block = rh.header_block_lines(2, 'ho-so-chuyen-tuyen', 'health', 2, 'none', 'clear', 12)
    assert block[0] == '<!-- boxfox-research'
    assert block[-1] == '-->'
    assert [line.split(':')[0] for line in block[1:-1]] == list(rh.HEADER_KEYS)
    assert len(block) <= rh.HEADER_MAX_LINES
    assert rh.build_research_header(1, 'x', 'law', 1).endswith('\n')


def test_a_built_header_parses_back_to_the_same_values():
    header = rh.build_research_header(3, 'gia-dich-vu-2026', 'price', 3, 'ok', 'warn', 41)
    parsed = rh.parse_research_header(header + '\n# Câu hỏi\nnội dung\n')
    assert parsed.status == 'ok' and parsed.ok
    assert (parsed.version, parsed.research_id, parsed.profile) == (3, 'gia-dich-vu-2026', 'price')
    assert (parsed.level, parsed.critique, parsed.gate, parsed.rows) == (3, 'ok', 'warn', 41)
    payload = parsed.to_payload()
    assert payload['researchId'] == 'gia-dich-vu-2026' and payload['bodyOffset'] == 9


def test_a_hand_written_file_reports_missing_not_an_error():
    parsed = rh.parse_research_header('# Hồ sơ tự viết\nkhông có header\n')
    assert parsed.status == 'missing'
    assert parsed.ok is False
    assert parsed.body_offset == 0
    # Ô đầu vào lạ không bao giờ làm ném.
    assert rh.parse_research_header(None) is None
    assert rh.parse_research_header(12345) is None


def test_a_broken_header_is_invalid_and_never_raises():
    broken = '\n'.join(['<!-- boxfox-research', 'Version: v1', 'ResearchId: abc', 'Level: 9', '-->'])
    parsed = rh.parse_research_header(broken)
    assert parsed.status == 'invalid'
    assert parsed.research_id == 'abc', 'đọc được gì thì vẫn giữ để thông báo nói đúng'
    unclosed = '\n'.join(['<!-- boxfox-research', 'Version: v1'] + ['# x'] * 20)
    assert rh.parse_research_header(unclosed).status == 'invalid'
    duplicate = rh.build_research_header(1, 'a-b', 'law', 1).replace('Rows: 0', 'Rows: 0\nRows: 3')
    assert rh.parse_research_header(duplicate).status == 'invalid'


def test_a_header_far_below_the_top_is_not_found():
    padded = '\n' * (rh.HEADER_MAX_LINES + 2) + rh.build_research_header(1, 'a-b', 'law', 1)
    assert rh.parse_research_header(padded).status == 'missing'
