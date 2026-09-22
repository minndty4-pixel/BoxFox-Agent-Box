"""Thang điểm P1–P8: `agent_core/plan_eval.py` (vòng 20, §5 của plan).

Ba việc chính: (1) tám chiều chấm đúng dải 0–2 với các ranh giới được ghim; (2) cổng cứng chặn
ĐÚNG những chiều mà plan đặt tên, và `P3 = 0` giữ nguyên câu của `plan_quality.py`; (3) hai mốc độ
dài (40 000 cảnh báo / 150 000 từ chối) và `repetition_ratio` — bản sao phải khớp hàm trong
`scripts/eval/rubric.py`, nên test nạp file script bằng đường dẫn để so.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

from agentbox.agent_core import plan_eval, plan_quality
from agentbox.agent_core.plan_eval import (
    HARD_GATES, JUDGE_ENV, JUDGE_PROMPT, PLAN_MAX_CHARS, PLAN_WARN_CHARS, REPETITION_MAX, RUBRIC,
    VERDICT_CONDITIONAL_MIN, VERDICT_PASS_MIN, Evaluation, evaluate_plan, judge_enabled,
    parse_judge_response, raise_if_rejected, repetition_ratio, scope_honesty_level, verdict_for)
from agentbox.agent_core.plan_header import build_plan_header
from agentbox.agent_core.plan_registry import PlanRegistrationError

REPO = Path(__file__).resolve().parents[3]

STEP_SECTION = ('## Thực hiện\n'
                '1. Chạy `.venv/bin/python -m pytest backend/tests -q`; mong đợi 9 passed.\n'
                '2. Gọi `GET /api/agent/health` và xác nhận mã trả về là 200.\n')
VERIFY_SECTION = ('## Nghiệm thu\n'
                  'Chạy `.venv/bin/python -m pytest backend/tests -q`; kỳ vọng 9 passed, '
                  '0 failed.\n')
RISKS_SECTION = ('## Rủi ro\n'
                 '- Giới hạn: chưa kiểm được hành vi khi box mất mạng vì môi trường này không '
                 'mô phỏng được.\n')


def plan_body(*, change_section='', steps=STEP_SECTION, verify=VERIFY_SECTION, risks=RISKS_SECTION,
              title='# Kế hoạch', extra=''):
    return f'{title}\n\n{change_section}{steps}{verify}{risks}{extra}'


def plan_text(*, version=1, identity='workspace-plan', parent=None, header=True, **kwargs):
    body = plan_body(**kwargs)
    if not header:
        return body
    return build_plan_header(version, identity, parent) + body


def evaluate(markdown, **kwargs):
    options = {'identity': 'workspace-plan', 'version': 1, 'state': 'draft', 'matched_by': 'declared'}
    options.update(kwargs)
    return evaluate_plan(markdown, **options)


def long_plan(chars, **kwargs):
    """Plan hợp lệ, phình bằng các dòng KHÁC nhau (để chỉ độ dài bị chấm, không phải trùng lặp).

    Dòng độn cố tình KHÔNG phải mục danh sách: nếu là mục danh sách thì P4 sẽ chấm chúng như bước
    và phép đo độ dài lẫn với phép đo tính thực thi.
    """
    filler = []
    size = len(plan_body(**kwargs)) + 1
    index = 0
    while size < chars:
        line = f'chi tiết {index:07d}: ghi chú riêng cho mục {index:07d}, không lặp lại dòng nào.\n'
        filler.append(line)
        size += len(line)
        index += 1
    return plan_text(extra='\n' + ''.join(filler), **kwargs)[:chars]


class VerdictTest(unittest.TestCase):
    def test_bands_are_pinned_at_13_and_9(self):
        self.assertEqual(VERDICT_PASS_MIN, 13)
        self.assertEqual(VERDICT_CONDITIONAL_MIN, 9)
        self.assertEqual(verdict_for(16), 'pass')
        self.assertEqual(verdict_for(13), 'pass')
        self.assertEqual(verdict_for(12), 'conditional')
        self.assertEqual(verdict_for(9), 'conditional')
        self.assertEqual(verdict_for(8), 'fail')
        self.assertEqual(verdict_for(0), 'fail')


class CleanPlanTest(unittest.TestCase):
    def test_clean_plan_scores_all_eight_dimensions_and_passes(self):
        evaluation = evaluate(plan_text())
        self.assertEqual(sorted(evaluation.levels), sorted(plan_eval.DIMENSIONS))
        self.assertNotIn(0, evaluation.levels.values())
        self.assertEqual(evaluation.total, sum(evaluation.levels.values()))
        self.assertEqual(evaluation.verdict, 'pass')
        self.assertEqual(evaluation.gates_failed, ())
        self.assertTrue(evaluation.hard_gate)
        self.assertIsNone(evaluation.rejected)
        self.assertIsNone(evaluation.message())

    def test_payload_shape_is_the_contract_event(self):
        payload = evaluate(plan_text()).to_payload(written=True)
        for key in ('identity', 'version', 'parentVersion', 'written', 'rubric', 'levels', 'layer',
                    'total', 'maxTotal', 'hardGate', 'gatesFailed', 'verdict', 'rejected',
                    'measures', 'evidence', 'judge', 'evaluatedAt'):
            self.assertIn(key, payload)
        self.assertEqual(payload['rubric'], RUBRIC)
        self.assertEqual(payload['maxTotal'], 16)
        self.assertTrue(payload['evaluatedAt'].endswith('Z'))
        self.assertEqual(sorted(payload['levels']), sorted(plan_eval.DIMENSIONS))
        for key in ('chars', 'repetition', 'steps', 'stepsAnchored', 'externalFacts',
                    'externalFactsSourced', 'noteKeywords', 'noteKeywordsEchoed'):
            self.assertIn(key, payload['measures'])
        self.assertIsNone(payload['judge'])

    def test_a_rejected_plan_still_has_a_truthful_payload(self):
        evaluation = evaluate(plan_text(parent=1, version=2), version=2, parent_version=1)
        self.assertIsNotNone(evaluation.rejected)
        payload = evaluation.to_payload(written=False)
        self.assertFalse(payload['written'])
        self.assertFalse(payload['hardGate'])
        self.assertTrue(payload['gatesFailed'])
        self.assertEqual(payload['verdict'], 'fail')
        self.assertEqual(payload['rejected'], evaluation.rejected)

    def test_junk_input_never_raises(self):
        for value in ('', None, 7, b'# Plan'):
            with self.subTest(value=value):
                evaluation = evaluate_plan(value, identity='x', version=1)
                self.assertIsInstance(evaluation, Evaluation)
                self.assertEqual(len(evaluation.levels), 8)

    def test_note_keywords_are_measured_without_changing_a_level(self):
        clean = evaluate(plan_text())
        note = 'nêu rõ cách kiểm tra FHIR và giới hạn độ dài'
        echoed = evaluate(plan_text(), review_note=note)
        self.assertEqual(echoed.measures['noteKeywords'], len(plan_eval._note_keywords(note)))
        self.assertGreaterEqual(echoed.measures['noteKeywordsEchoed'], 1)
        self.assertLessEqual(echoed.measures['noteKeywordsEchoed'], echoed.measures['noteKeywords'])
        self.assertEqual(echoed.levels, clean.levels)


class DimensionP1Test(unittest.TestCase):
    def test_model_header_matching_what_the_harness_will_write_scores_two(self):
        evaluation = evaluate(plan_text(version=2, parent=1), version=2, parent_version=1)
        self.assertEqual(evaluation.levels['P1'], 2)
        self.assertEqual(evaluation.measures['headerSource'], 'model')

    def test_absent_header_is_synthesized_and_scores_one(self):
        evaluation = evaluate(plan_text(header=False))
        self.assertEqual((evaluation.levels['P1'], evaluation.measures['headerSource']),
                         (1, 'synthesized'))

    def test_mismatched_header_is_rejected_naming_both_sides(self):
        markdown = plan_text(version=3, parent=None)
        evaluation = evaluate(markdown, version=4, parent_version=3)
        self.assertEqual(evaluation.levels['P1'], 0)
        self.assertEqual(evaluation.rejected, 'header-mismatch')
        message = evaluation.message()
        self.assertIn('Version: v3', message)
        self.assertIn('v4', message)

    def test_unparsable_header_is_a_mismatch_not_a_crash(self):
        markdown = '<!-- boxfox-plan\nVersion: v1\n-->\n' + plan_body()
        evaluation = evaluate(markdown)
        self.assertEqual((evaluation.levels['P1'], evaluation.rejected), (0, 'header-mismatch'))

    def test_a_malformed_block_is_named_as_syntax_not_as_a_version_mismatch(self):
        """Đo sống 2026-09-22: khai `Parent: <identity>@v1` (sai cú pháp) mà version KHỚP bị kể
        thành "lệch version", câu ra "khai vVersion: v2" — model sẽ đi sửa đúng thứ không hỏng.
        """
        markdown = ('<!-- boxfox-plan\nVersion: v2\nIdentity: workspace-plan\n'
                    'Parent: workspace-plan@v1\n-->\n') + plan_body()
        evaluation = evaluate(markdown, version=2, parent_version=1)
        message = evaluation.message()
        self.assertEqual((evaluation.levels['P1'], evaluation.rejected), (0, 'header-mismatch'))
        self.assertIn('không đúng cú pháp', message)
        self.assertIn('đọc được: Version: v2, Identity: workspace-plan', message)
        self.assertNotIn('khai vVersion', message, 'câu cũ ghép `v` vào trước cả mệnh đề')
        self.assertIn('harness sẽ ghi v2', message, 'con số harness sẽ ghi vẫn phải có')


class DimensionP2Test(unittest.TestCase):
    def test_revision_must_trace_back_to_the_previous_version(self):
        evaluation = evaluate(plan_text(version=2, parent=1), version=2, parent_version=1)
        self.assertEqual(evaluation.levels['P2'], 0)
        self.assertEqual(evaluation.rejected, 'revision-untraceable')
        self.assertIn('v1', evaluation.message())

    def test_mentioning_the_previous_version_is_level_one(self):
        evaluation = evaluate(plan_text(version=2, parent=1, title='# Kế hoạch v2 (thay v1)'),
                              version=2, parent_version=1)
        self.assertEqual(evaluation.levels['P2'], 1)

    def test_a_change_section_scores_two(self):
        section = '## Thay đổi so với v1\n- thêm mục nghiệm thu và hai bước có lệnh.\n'
        evaluation = evaluate(plan_text(version=2, parent=1, change_section=section),
                              version=2, parent_version=1)
        self.assertEqual(evaluation.levels['P2'], 2)

    def test_the_first_version_has_nothing_to_trace_and_is_never_gated(self):
        evaluation = evaluate(plan_text())
        self.assertEqual(evaluation.levels['P2'], 2)
        self.assertNotIn('P2', evaluation.gates_failed)

    def test_an_approved_group_does_not_gate_the_parent_chain(self):
        evaluation = evaluate(plan_text(version=2, parent=1), version=2, parent_version=1,
                              state='approved')
        self.assertEqual(evaluation.levels['P2'], 0)
        self.assertNotIn('P2', evaluation.gates_failed)
        self.assertNotIn('P2', [evaluation.rejected])


class DimensionP3Test(unittest.TestCase):
    def test_missing_sections_keep_the_unchanged_quality_message(self):
        markdown = plan_text(steps='', verify='', risks='')
        with self.assertRaises(ValueError) as caught:
            plan_quality.check_plan_quality(markdown)
        evaluation = evaluate(markdown)
        self.assertEqual(evaluation.levels['P3'], 0)
        self.assertEqual(evaluation.rejected, 'QUALITY')
        self.assertEqual(evaluation.message(), str(caught.exception))
        self.assertTrue(evaluation.message().startswith('PLAN_QUALITY_REJECTED: '))
        with self.assertRaises(ValueError) as raised:
            raise_if_rejected(evaluation)
        self.assertEqual(str(raised.exception), evaluation.message())

    def test_clean_but_thin_structure_scores_one_and_is_not_a_gate(self):
        evaluation = evaluate(plan_text())
        self.assertEqual(evaluation.levels['P3'], 1)
        self.assertTrue(evaluation.hard_gate)

    def test_thick_sections_score_two(self):
        thick_risks = ('## Rủi ro\n- Giới hạn: chưa kiểm được hành vi khi đĩa đầy vì môi trường '
                       'không mô phỏng được; cách kiểm sau này là chạy `df -h` rồi chạy lại '
                       '`pytest -q`. Không có rủi ro nào khác đã biết.\n')
        thick_verify = ('## Nghiệm thu\nChạy `.venv/bin/python -m pytest backend/tests -q`; kỳ vọng '
                        '9 passed và 0 failed. Sau đó gọi `GET /api/agent/health` và kỳ vọng 200.\n')
        thick_steps = ('## Thực hiện\n1. Chạy `.venv/bin/python -m pytest backend/tests -q`; mong đợi '
                       '9 passed.\n2. Gọi `GET /api/agent/health`; xác nhận 200.\n'
                       '3. Chạy `npx vitest run` trong `frontend`; mong đợi 894 test, 4 lỗi cũ.\n')
        context = ('## Bối cảnh\nMục này chỉ để đủ dài: vòng 20 thêm sổ duyệt và thang điểm, nhưng '
                   'nội dung plan vẫn là văn xuôi của người dùng, và văn xuôi dài thì mục nào cũng '
                   'phải dài theo. Không có dữ kiện bên ngoài nào ở đây, nên mục Nguồn không bắt '
                   'buộc và không được tính vào độ dày. Một bản plan thật thường có bối cảnh, các '
                   'bước, cách nghiệm thu và rủi ro; cả bốn mục đều phải đủ dài thì mới gọi là dày, '
                   'vì mục mỏng nghĩa là người đọc không kiểm được gì. Ngưỡng ở đây là 120 ký tự '
                   'cho mỗi mục bắt buộc đang có, cộng 1 200 ký tự cho cả tài liệu; hai con số đó '
                   'được ghim bằng test này để sau này không ai hạ thấp chúng trong im lặng. Bản '
                   'dày ở đây phải dài hơn 1 200 ký tự, nên mục bối cảnh cũng góp phần vào phép đo '
                   'độ dài chung.\n')
        evaluation = evaluate(plan_text(steps=thick_steps, verify=thick_verify, risks=thick_risks,
                                        extra='\n' + context))
        self.assertEqual(evaluation.measures['chars'] >= 1200, True)
        self.assertEqual(evaluation.levels['P3'], 2)


class DimensionP4Test(unittest.TestCase):
    def test_all_steps_anchored_scores_two(self):
        evaluation = evaluate(plan_text())
        self.assertEqual(evaluation.measures['steps'], 2)
        self.assertEqual(evaluation.levels['P4'], 2)

    def test_half_anchored_scores_one(self):
        steps = ('## Thực hiện\n1. Chạy `pytest -q`; mong đợi 9 passed.\n'
                 '2. Viết tài liệu cho người dùng.\n')
        evaluation = evaluate(plan_text(steps=steps))
        self.assertEqual((evaluation.measures['steps'], evaluation.measures['stepsAnchored']), (2, 1))
        self.assertEqual(evaluation.levels['P4'], 1)
        self.assertTrue(evaluation.hard_gate)

    def test_steps_without_commands_are_a_hard_gate_with_the_ratio(self):
        steps = '## Thực hiện\n1. Viết tài liệu.\n2. Xem lại lần cuối.\n'
        evaluation = evaluate(plan_text(steps=steps))
        self.assertEqual(evaluation.levels['P4'], 0)
        self.assertEqual(evaluation.rejected, 'steps-unanchored')
        self.assertIn('0/2', evaluation.message())

    def test_no_list_items_at_all_is_its_own_code(self):
        evaluation = evaluate('# Kế hoạch\n\n' + '\n\n'.join(
            text for text in (VERIFY_SECTION, RISKS_SECTION)))
        self.assertEqual(evaluation.rejected, 'plan-no-steps')
        self.assertIn('không có bước nào', evaluation.message())


class DimensionP5Test(unittest.TestCase):
    def test_proxy_is_used_when_the_judge_is_off(self):
        evaluation = evaluate(plan_text())
        self.assertEqual(evaluation.layer['P5'], 'oracle')
        self.assertEqual(evaluation.levels['P5'], 2)

    def test_claiming_verification_without_a_command_scores_zero(self):
        claims = ('## Nghiệm thu\nĐã kiểm mọi thứ và mọi thứ đều ổn; đã chạy thử vài lần rồi nên '
                  'không cần kiểm lại nữa.\n')
        steps = ('## Thực hiện\nĐã kiểm rồi nên chỉ cần viết tài liệu cho người dùng đọc lại.\n')
        evaluation = evaluate(plan_text(steps=steps, verify=claims))
        self.assertEqual(evaluation.levels['P5'], 0)
        self.assertNotIn('P5', evaluation.gates_failed, 'P5 không phải cổng cứng')
        self.assertEqual(evaluation.layer['P5'], 'oracle')

    def test_generic_risks_score_one_and_specific_limits_score_two(self):
        generic = '## Rủi ro\n- Có thể có rủi ro khi chạy thật.\n'
        self.assertEqual(evaluate(plan_text(risks=generic)).levels['P5'], 1)
        specific = ('## Rủi ro\n- Không kiểm được ca box mất mạng: chưa có cách mô phỏng trong '
                    'môi trường này.\n')
        self.assertEqual(evaluate(plan_text(risks=specific)).levels['P5'], 2)

    def test_judge_result_switches_the_layer_and_the_level(self):
        evaluation = evaluate(plan_text(), judged={'score': 1.0, 'reason': 'nêu giới hạn cụ thể'})
        self.assertEqual((evaluation.layer['P5'], evaluation.levels['P5']), ('judge', 2))
        self.assertEqual(evaluation.judge, {'score': 1.0, 'reason': 'nêu giới hạn cụ thể'})
        middle = evaluate(plan_text(), judged={'score': 0.5, 'reason': 'chung chung'})
        self.assertEqual(middle.levels['P5'], 1)
        low = evaluate(plan_text(), judged={'score': 0.1, 'reason': 'nói quá'})
        self.assertEqual(low.levels['P5'], 0)
        self.assertNotIn('P5', low.gates_failed)

    def test_scope_level_boundaries(self):
        self.assertEqual([scope_honesty_level(s) for s in (0.0, 0.33, 0.34, 0.66, 0.67, 1.0)],
                         [0, 0, 1, 1, 2, 2])

    def test_judge_contract_is_strict(self):
        self.assertEqual(parse_judge_response('{"scopeHonesty": {"score": 0.4, "reason": "ok"}}'),
                         {'score': 0.4, 'reason': 'ok'})
        self.assertEqual(parse_judge_response('```json\n{"scopeHonesty": {"score": 1, "reason": "x"}}\n```'),
                         {'score': 1.0, 'reason': 'x'})
        bad = ['{"scopeHonesty": {"score": 0.4, "reason": "ok"}, "total": 12}',
               '{"scopeHonesty": {"score": "0.4", "reason": "ok"}}',
               '{"scopeHonesty": {"score": 1.4, "reason": "ok"}}',
               '{"scopeHonesty": {"score": true, "reason": "ok"}}',
               '{"scopeHonesty": {"score": 0.4}}', '{"other": 1}', 'not json', None, 7, []]
        for raw in bad:
            with self.subTest(raw=raw):
                self.assertIsNone(parse_judge_response(raw))
        clipped = parse_judge_response(json.dumps({'scopeHonesty': {'score': 0.4, 'reason': 'x' * 500}}))
        self.assertEqual(len(clipped['reason']), plan_eval.JUDGE_REASON_MAX_CHARS)

    def test_judge_flag_and_prompt(self):
        self.assertTrue(judge_enabled({JUDGE_ENV: '1'}))
        for value in ({}, {JUDGE_ENV: '0'}, {JUDGE_ENV: ''}, {JUDGE_ENV: True}):
            self.assertFalse(judge_enabled(value))
        self.assertIn('scopeHonesty', JUDGE_PROMPT)
        self.assertIn('JSON', JUDGE_PROMPT)


class DimensionP6Test(unittest.TestCase):
    def test_plan_without_external_facts_scores_two(self):
        self.assertEqual(evaluate(plan_text()).levels['P6'], 2)

    def test_unsourced_external_fact_scores_zero_without_gating(self):
        verify = ('## Nghiệm thu\nĐối chiếu với official docs của FHIR rồi mới viết mã; kết quả '
                  'là `pytest -q` xanh.\n')
        sources = '\n## Nguồn\n- Chưa tìm được nguồn cho dữ kiện trên; sẽ bổ sung trước khi làm.\n'
        evaluation = evaluate(plan_text(verify=verify, extra=sources))
        self.assertEqual(evaluation.measures['externalFacts'], 1)
        self.assertEqual(evaluation.measures['externalFactsSourced'], 0)
        self.assertEqual(evaluation.levels['P6'], 0)
        self.assertEqual(evaluation.gates_failed, ())
        self.assertIsNone(evaluation.rejected)

    def test_sourced_external_facts_score_two(self):
        verify = ('## Nghiệm thu\nXem official docs của FHIR tại https://hl7.org/fhir/ rồi chạy '
                  '`pytest -q`; kỳ vọng 9 passed.\n')
        evaluation = evaluate(plan_text(verify=verify))
        self.assertEqual(evaluation.measures['externalFacts'], evaluation.measures['externalFactsSourced'])
        self.assertEqual(evaluation.levels['P6'], 2)

    def test_half_sourced_scores_one(self):
        notes = ('## Ghi chú\n- Dùng RFC 7807 cho phần lỗi trả về; đã hỏi đội backend và họ đồng ý.\n'
                 '\n'
                 '\n'
                 '## Tham chiếu\n- Official docs của FHIR: https://hl7.org/fhir/\n')
        evaluation = evaluate(plan_text(extra='\n' + notes))
        self.assertEqual(evaluation.measures['externalFacts'], 2)
        self.assertEqual(evaluation.measures['externalFactsSourced'], 1)
        self.assertEqual(evaluation.levels['P6'], 1)


class DimensionP7Test(unittest.TestCase):
    def test_warning_band_between_the_two_thresholds(self):
        markdown = long_plan(PLAN_WARN_CHARS + 500)
        evaluation = evaluate(markdown)
        self.assertGreater(evaluation.measures['chars'], PLAN_WARN_CHARS)
        self.assertEqual(evaluation.levels['P7'], 1)
        self.assertTrue(any('PLAN_EVAL_LONG' in warning for warning in evaluation.warnings))
        self.assertIsNone(evaluation.rejected)

    def test_at_the_warn_threshold_still_scores_two(self):
        markdown = long_plan(PLAN_WARN_CHARS - 50)
        evaluation = evaluate(markdown)
        self.assertLessEqual(evaluation.measures['chars'], PLAN_WARN_CHARS)
        self.assertEqual(evaluation.levels['P7'], 2)
        self.assertEqual(evaluation.warnings, ())

    def test_just_over_the_max_is_rejected_with_the_measurement(self):
        markdown = long_plan(PLAN_MAX_CHARS + 10)
        evaluation = evaluate(markdown)
        self.assertEqual(evaluation.levels['P7'], 0)
        self.assertEqual(evaluation.rejected, 'plan-too-long')
        message = evaluation.message()
        self.assertNotIn('\n', message)
        self.assertIn(str(evaluation.measures['chars']), message)
        self.assertIn(str(PLAN_MAX_CHARS), message)
        self.assertIn('tách thành bản tóm tắt + bản chi tiết', message)

    def test_just_under_the_max_is_not_rejected(self):
        markdown = long_plan(PLAN_MAX_CHARS - 10)
        evaluation = evaluate(markdown)
        self.assertLessEqual(evaluation.measures['chars'], PLAN_MAX_CHARS)
        self.assertNotEqual(evaluation.rejected, 'plan-too-long')

    def test_the_live_306_kilobyte_case_is_rejected_by_one_line(self):
        evaluation = evaluate(plan_text(extra='x' * 306_721))
        self.assertEqual(evaluation.rejected, 'plan-too-long')
        self.assertEqual(evaluation.message().count('\n'), 0)

    def test_repetition_is_the_other_half_of_p7(self):
        doubled = plan_text() + plan_body()
        evaluation = evaluate(doubled)
        self.assertGreaterEqual(evaluation.measures['repetition'], REPETITION_MAX)
        self.assertEqual(evaluation.levels['P7'], 0)
        self.assertEqual(evaluation.rejected, 'plan-repetitive')
        self.assertIn('lặp', evaluation.message())

    def test_repetition_ratio_matches_the_script_in_the_repo(self):
        spec = importlib.util.spec_from_file_location('r20_rubric', REPO / 'scripts' / 'eval' / 'rubric.py')
        rubric = importlib.util.module_from_spec(spec)
        sys.modules['r20_rubric'] = rubric
        spec.loader.exec_module(rubric)
        samples = ['', 'ngắn', 'a' * 500, ('câu văn bình thường. ' * 40),
                   ('khối lặp. ' * 30 + 'khối lặp. ' * 30), plan_body()]
        for sample in samples:
            with self.subTest(size=len(sample)):
                self.assertEqual(repetition_ratio(sample), rubric.repetition_ratio(sample))
                self.assertEqual(repetition_ratio(sample, stride=3), rubric.repetition_ratio(sample, stride=3))


class DimensionP8Test(unittest.TestCase):
    def test_declared_identity_scores_two(self):
        self.assertEqual(evaluate(plan_text()).levels['P8'], 2)

    def test_auto_merged_or_forced_new_scores_one(self):
        merged = evaluate(plan_text(), matched_by='similarity')
        self.assertEqual((merged.levels['P8'], merged.rejected), (1, None))
        forced = evaluate(plan_text(), matched_by='none', forced_new=True)
        self.assertEqual((forced.levels['P8'], forced.rejected), (1, None))

    def test_ignoring_a_change_request_or_duplicating_a_version_is_level_zero(self):
        ignored = evaluate(plan_text(), ignored_change_request=True)
        self.assertEqual(ignored.levels['P8'], 0)
        self.assertEqual(ignored.rejected, 'identity-unhygienic')
        duplicate = evaluate(plan_text(), duplicate_version=True)
        self.assertEqual(duplicate.rejected, 'identity-unhygienic')
        self.assertIn('trùng số version', duplicate.message())


class HardGateTest(unittest.TestCase):
    def test_gates_are_exactly_the_five_named_plus_a_conditional_p2(self):
        self.assertEqual(HARD_GATES, ('P1', 'P3', 'P4', 'P7', 'P8'))
        self.assertEqual(plan_eval.CONDITIONAL_HARD_GATES, ('P2',))

    def test_p5_and_p6_are_scored_but_never_gate(self):
        verify = '## Nghiệm thu\nXem official docs của FHIR rồi chạy `pytest -q`; kỳ vọng 9 passed.\n'
        sources = '\n## Nguồn\n- Chưa tìm được nguồn nào cho dữ kiện trên.\n'
        evaluation = evaluate(plan_text(verify=verify, extra=sources,
                                        risks='## Rủi ro\n- Có thể có rủi ro khi chạy thật.\n'))
        self.assertEqual(evaluation.levels['P6'], 0)
        self.assertEqual(evaluation.levels['P5'], 1)
        self.assertEqual(evaluation.gates_failed, ())
        self.assertIsNone(evaluation.rejected)

    def test_rejection_order_follows_p1_to_p8(self):
        markdown = plan_text(version=2, parent=None)
        evaluation = evaluate(markdown, version=2, parent_version=1)
        self.assertEqual(evaluation.rejected_dimension, 'P1')

    def test_raise_if_rejected_is_a_value_error_with_the_eval_prefix(self):
        evaluation = evaluate(plan_text(version=2, parent=1), version=2, parent_version=1)
        with self.assertRaises(PlanRegistrationError) as caught:
            raise_if_rejected(evaluation)
        self.assertTrue(str(caught.exception).startswith('PLAN_EVAL_REJECTED: (revision-untraceable)'))
        raise_if_rejected(evaluate(plan_text()))

    def test_every_eval_code_has_an_actionable_remedy(self):
        for code in ('plan-too-long', 'plan-repetitive', 'plan-no-steps', 'steps-unanchored',
                     'revision-untraceable', 'identity-unhygienic', 'header-mismatch',
                     'identity-ambiguous', 'revision-not-traceable', 'identity-pending-review'):
            with self.subTest(code=code):
                self.assertIn(code, plan_eval.REMEDIES)

    def test_a_rejected_eval_carries_its_own_remedy_not_the_generic_line(self):
        """Lỗi bắt được ở lượt chạy sống 2026-09-21: câu khắc phục riêng bị thay bằng câu chung.

        `PlanRegistrationError` dựng lại câu bằng `REMEDIES` của `plan_registry`, mà bảng đó không
        có các mã của P1–P8, nên model chỉ nhận được "không thoả luật của harness" và phải đoán.
        """
        steps = '## Thực hiện\n1. Viết tài liệu.\n2. Xem lại lần cuối.\n'
        evaluation = evaluate(plan_text(steps=steps))
        with self.assertRaises(PlanRegistrationError) as caught:
            raise_if_rejected(evaluation)
        message = str(caught.exception)
        self.assertIn('chỉ 0/2 bước', message)
        self.assertIn('thêm lệnh/kết quả vào từng bước', message)
        self.assertEqual(caught.exception.message, evaluation.message())
        self.assertNotIn('không thoả luật của harness', message)


if __name__ == '__main__':
    unittest.main()
