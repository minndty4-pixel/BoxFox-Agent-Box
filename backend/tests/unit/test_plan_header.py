"""Khối header `boxfox-plan`: dựng/đọc ở harness + so khớp với bản box.

Mục đích của file test này không chỉ là "hàm chạy đúng": nó là **chốt chống lệch** giữa hai cây.
`deploy/docker/plan_files.py` là nguồn chân lý của regex; `agent_core/plan_header.py` là bản sao
bắt buộc để harness đọc được header trước khi ghi. Hai bên lệch nhau một ký tự là đủ để một file
hợp lệ phía box thành `invalid` phía harness, nên ở đây so **từng khoá regex** và so **hành vi
parse** trên cùng một bảng ca.
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

from agentbox.agent_core import plan_header
from agentbox.agent_core.plan_header import PlanHeader, build_plan_header, parse_plan_header

DOCKER_DIR = Path(__file__).resolve().parents[3] / 'deploy' / 'docker'


def load_box_module():
    """Nạp `deploy/docker/plan_files.py` theo đường dẫn (không phải package).

    Phải đăng ký vào `sys.modules` trước khi `exec_module`: file dùng `dataclass`, và dataclass
    tra ngược `sys.modules[cls.__module__]` để đọc annotation — thiếu bước này sẽ nổ
    `AttributeError: NoneType has no attribute __dict__`.
    """
    name = 'box_plan_files_for_test'
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, DOCKER_DIR / 'plan_files.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def header_block(version=2, identity='pilot', parent=1, slug=None):
    """Khối header gọn để nhét vào markdown trong test."""
    return build_plan_header(version, identity, parent, slug)


class HeaderPatternParityTest(unittest.TestCase):
    """Hai cây phải dùng đúng cùng một bộ regex."""

    def test_regex_patterns_match_box_file_key_by_key(self):
        box = load_box_module()
        self.assertEqual(sorted(box.HEADER_PATTERNS), sorted(plan_header.HEADER_PATTERNS))
        for key in sorted(box.HEADER_PATTERNS):
            self.assertEqual(box.HEADER_PATTERNS[key], plan_header.HEADER_PATTERNS[key],
                             f'regex «{key}» lệch giữa plan_files.py và plan_header.py')

    def test_line_budget_matches_box_file(self):
        self.assertEqual(load_box_module().HEADER_MAX_LINES, plan_header.HEADER_MAX_LINES)

    def test_parse_results_match_box_parser_on_same_cases(self):
        """Bảng ca hai bên phải cho cùng `status`/số/`body_offset` — kể cả ca hỏng."""
        box = load_box_module()
        cases = [
            header_block(4, 'clinical-patient-record-lookup-research', 3, 'research-patient-record-lookup'),
            header_block(1, 'pilot', None),
            header_block(2, 'subplans/login', None),
            '# Plan\n\nkhông có header\n',
            header_block(2, 'pilot', 1) + '# Plan\n',
            '<!-- boxfox-plan\nVersion: v1\n',
            '<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\n',
            header_block(2, 'pilot', 1).replace('\n-->', '\n') + 'x\n-->',
            (header_block(2, 'pilot', 1) + '"<!-- boxfox-plan"\n'),
            'x\n' * 20 + header_block(2, 'pilot', 1),
            '<!-- boxfox-plan\nVersion: 2\nIdentity: pilot\nParent: none\n-->\n',
            '<!-- boxfox-plan\nVersion: v2\nIdentity: Pilot\nParent: none\n-->\n',
            '<!-- boxfox-plan\nVersion: v2\nIdentity: pilot\nParent: v1\nSlug: nope_nope\n-->\n',
            '',
        ]
        for text in cases:
            mine = parse_plan_header(text)
            theirs = box.parse_plan_header(text)
            self.assertIsNotNone(mine)
            self.assertEqual(
                (mine.version, mine.identity, mine.parent, mine.declared_slug, mine.status,
                 mine.body_offset),
                (theirs.version, theirs.identity, theirs.parent, theirs.declared_slug, theirs.status,
                 theirs.body_offset),
                f'lệch kết quả parse cho ca: {text[:60]!r}')

    def test_non_string_input_returns_none_on_both_sides(self):
        box = load_box_module()
        for value in (None, b'# Plan', 3, ['# Plan']):
            self.assertIsNone(parse_plan_header(value))
            self.assertIsNone(box.parse_plan_header(value))


class HeaderBuildTest(unittest.TestCase):
    def test_build_writes_three_required_keys_and_closes(self):
        text = build_plan_header(4, 'clinical-patient-record-lookup-research', 3,
                                 'research-patient-record-lookup')
        self.assertEqual(text.splitlines(), [
            '<!-- boxfox-plan',
            'Version: v4',
            'Identity: clinical-patient-record-lookup-research',
            'Parent: v3',
            'Slug: research-patient-record-lookup',
            '-->',
        ])
        self.assertTrue(text.endswith('\n'))

    def test_build_omits_slug_line_when_no_extra_slug(self):
        text = build_plan_header(1, 'pilot', None)
        self.assertEqual(text.splitlines(), [
            '<!-- boxfox-plan', 'Version: v1', 'Identity: pilot', 'Parent: none', '-->',
        ])

    def test_build_then_parse_round_trips(self):
        for version, identity, parent, slug in (
            (1, 'pilot', None, None),
            (4, 'clinical-patient-record-lookup-research', 3, 'research-patient-record-lookup'),
            (2, 'subplans/login', 1, None),
            (10, 'agent-box-plan', 9, 'agent-box-plan'),
        ):
            markdown = build_plan_header(version, identity, parent, slug) + '# Plan\n\nThân.\n'
            header = parse_plan_header(markdown)
            self.assertEqual(header.status, 'ok')
            self.assertEqual((header.version, header.identity, header.parent), (version, identity, parent))
            self.assertEqual(header.declared_slug, slug)
            self.assertEqual(header.body_offset, 6 if slug else 5)

    def test_build_header_keeps_body_offset_pointing_at_the_body(self):
        markdown = build_plan_header(2, 'pilot', 1) + '# Plan\n'
        header = parse_plan_header(markdown)
        self.assertEqual(markdown.splitlines()[header.body_offset], '# Plan')


class HeaderParseTest(unittest.TestCase):
    def test_well_formed_block_reads_ok_with_all_fields(self):
        markdown = ('<!-- boxfox-plan\nVersion: v4\nIdentity: clinical-patient-record-lookup-research\n'
                    'Parent: v3\nSlug: research-patient-record-lookup\n-->\n# Plan\n')
        header = parse_plan_header(markdown)
        self.assertEqual(header, PlanHeader(4, 'clinical-patient-record-lookup-research', 3,
                                            'research-patient-record-lookup', 'ok', 6))
        self.assertTrue(header.ok)

    def test_parent_none_is_ok_and_means_new_identity(self):
        header = parse_plan_header('<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: none\n-->\n')
        self.assertEqual(header.status, 'ok')
        self.assertIsNone(header.parent)

    def test_missing_header_is_not_an_error(self):
        header = parse_plan_header('# Kế hoạch cũ\n\nKhông có khối header.\n')
        self.assertEqual(header, PlanHeader(None, '', None, None, 'missing', 0))

    def test_block_beyond_line_budget_reads_missing(self):
        markdown = 'x\n' * 20 + build_plan_header(2, 'pilot', 1)
        self.assertEqual(parse_plan_header(markdown).status, 'missing')

    def test_body_offset_of_unclosed_block_points_after_open_line(self):
        header = parse_plan_header('<!-- boxfox-plan\nVersion: v1\n')
        self.assertEqual(header.status, 'invalid')
        self.assertEqual(header.body_offset, 1)

    def test_invalid_cases_are_reported_never_raised(self):
        cases = {
            'chưa đóng trong 12 dòng': ('<!-- boxfox-plan\n' + 'Version: v1\nIdentity: pilot\nParent: none\n'
                                        + 'x\n' * 12),
            'thiếu khoá Slug chỉ có Version': '<!-- boxfox-plan\nVersion: v1\n-->\n',
            'khoá lặp': '<!-- boxfox-plan\nVersion: v1\nVersion: v2\nIdentity: pilot\nParent: none\n-->\n',
            'dòng lạ': '<!-- boxfox-plan\nVersion: v1\nGhi chú: gì đó\nIdentity: pilot\nParent: none\n-->\n',
            'version 04': '<!-- boxfox-plan\nVersion: v04\nIdentity: pilot\nParent: none\n-->\n',
            'identity hoa': '<!-- boxfox-plan\nVersion: v1\nIdentity: Pilot\nParent: none\n-->\n',
            'cha sai định dạng': '<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: v0\n-->\n',
            'slug có gạch dưới': ('<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: none\n'
                                  'Slug: nope_nope\n-->\n'),
        }
        for name, markdown in cases.items():
            with self.subTest(name=name):
                header = parse_plan_header(markdown)
                self.assertIsNotNone(header)
                self.assertEqual(header.status, 'invalid')
                self.assertFalse(header.ok)

    def test_slug_key_is_optional_and_published_only_when_declared(self):
        header = parse_plan_header('<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: none\n-->\n')
        self.assertIsNone(header.declared_slug)
        with_slug = parse_plan_header('<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: none\n'
                                      'Slug: other-name\n-->\n')
        self.assertEqual(with_slug.declared_slug, 'other-name')

    def test_nested_identity_is_accepted(self):
        header = parse_plan_header(build_plan_header(1, 'subplans/header-demo', None) + '# Plan\n')
        self.assertEqual((header.status, header.identity), ('ok', 'subplans/header-demo'))

    def test_payload_is_camel_case_for_events(self):
        header = parse_plan_header(build_plan_header(4, 'pilot', 3, 'other-slug') + '# Plan\n')
        self.assertEqual(header.to_payload(), {
            'status': 'ok', 'version': 4, 'identity': 'pilot', 'parent': 3,
            'declaredSlug': 'other-slug', 'bodyOffset': 6,
        })

    def test_blank_lines_inside_the_block_are_tolerated(self):
        markdown = '<!-- boxfox-plan\nVersion: v2\n\nIdentity: pilot\n\nParent: v1\n\n-->\n# Plan\n'
        header = parse_plan_header(markdown)
        self.assertEqual(header.status, 'ok')
        self.assertEqual(header.body_offset, 8)


if __name__ == '__main__':
    unittest.main()
