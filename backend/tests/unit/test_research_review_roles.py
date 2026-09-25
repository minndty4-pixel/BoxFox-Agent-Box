"""P3 (§5.9/§5.11): chế độ soát, mẫu trích xuất, danh mục phát hiện và phân xử mâu thuẫn.

Một nguồn sự thật cho "có phải phản biện không": `research_review.review_modes`. Bài kiểm ghim
đúng ba điều dễ lệch nhất:

* phản biện mặc định từ mức 2 khi công tắc bật, và khi công tắc `off` thì quay lại ĐÚNG
  `limits.RESEARCH_TIER_CRITIQUE` (chỉ mức 3) — không có đường thứ hai;
* `missing-direction` mức cao chưa xử lý ⇒ nhãn `limits.RESEARCH_COVERAGE_LABEL`;
* hai bên soát ĐỘC LẬP mâu thuẫn ⇒ nhận định bị tranh chấp, trần lấy mức THẤP NHẤT và hồ sơ phải
  nói ra — không lấy theo đa số.
"""
import pytest

from agentbox.agent_core import limits, research_review, roles

OFF = {limits.RESEARCH_CRITIQUE_TIER2_ENV: 'off'}


# --- chế độ soát -------------------------------------------------------------

def test_critique_is_default_from_tier_two_while_the_switch_is_on():
    assert research_review.review_modes(2, {}) == ['critique']
    assert research_review.review_modes(1, {}) == []
    assert 'critique' in research_review.review_modes(3, {})


def test_with_the_switch_off_the_old_tier_table_is_the_only_path():
    assert research_review.review_modes(1, {}, env=OFF) == []
    assert research_review.review_modes(2, {}, env=OFF) == []
    assert 'critique' in research_review.review_modes(3, {}, env=OFF)
    # Mức 3 vẫn có phản biện: bảng cũ là nguồn, không phải một bản sao khác.
    assert limits.RESEARCH_TIER_CRITIQUE[3] is True


def test_evidence_follows_the_existing_question_rule_and_coverage_follows_the_job_kind():
    many = {'questions': [{'importance': 'high'}, {'importance': 'high'}, {'importance': 'low'}]}
    assert research_review.review_modes(2, many, env=OFF) == ['evidence']
    assert research_review.review_modes(2, {'questions': [{'importance': 'low'}]},
                                        env=OFF) == []
    landscape = {'scope': {'jobKinds': ['landscape']}}
    assert research_review.review_modes(1, landscape, env=OFF) == ['coverage']
    assert research_review.review_modes(2, {'scope': {'jobKinds': ['gap']}}) \
        == ['critique', 'coverage']
    # Mức 3 LUÔN có bằng chứng (luật hiện có của `_choose_review_modes`) + phản biện + bao phủ.
    assert research_review.review_modes(3, {}, env=OFF) == ['evidence', 'critique', 'coverage']


def test_the_mode_list_keeps_the_public_order_and_never_repeats():
    state = {'questions': [{'importance': 'high'}, {'importance': 'high'}, {'importance': 'high'}],
             'scope': {'jobKinds': ['landscape']}}
    modes = research_review.review_modes(3, state)
    assert modes == ['evidence', 'critique', 'coverage']
    assert modes == [mode for mode in research_review.REVIEW_MODES if mode in modes]
    payload = research_review.review_modes_payload(2, {})
    assert payload['modes'] == ['critique'] and payload['critiqueRule'] == 'tier>=2'


# --- mẫu trích xuất ----------------------------------------------------------

def test_every_pillar_source_kind_has_an_extraction_template_within_the_cap():
    assert set(research_review.EXTRACTION_FIELDS) == {
        'paper', 'blog', 'docs', 'repo', 'legal', 'dataset', 'news', 'vendor', 'forum', 'other'}
    for kind in research_review.EXTRACTION_FIELDS:
        fields = research_review.extraction_fields(kind)
        assert fields and len(fields) <= limits.RESEARCH_EXTRACTION_MAX_FIELDS, kind
        assert all(set(field) >= {'key', 'label', 'required', 'where'} for field in fields), kind
        assert all(field['where'] in ('head', 'body', 'link') for field in fields), kind


def test_an_unknown_source_kind_falls_back_and_an_alias_maps_to_its_real_template():
    unknown = research_review.extraction_fields('telegram-channel')
    assert unknown == research_review.extraction_fields('other')
    assert [field['key'] for field in research_review.extraction_fields('preprint')] \
        == [field['key'] for field in research_review.extraction_fields('paper')]
    assert 'docNumber' in [field['key'] for field in research_review.extraction_fields('standard')]


# --- danh mục phát hiện ------------------------------------------------------

def test_issue_kinds_are_normalised_and_unknown_ones_are_dropped_not_broken():
    issues = research_review.normalize_issues([
        {'severity': 'HIGH', 'text': 'thiếu hướng X', 'fix': 'thêm X', 'kind': 'missing_direction'},
        {'severity': 'weird', 'text': 'chuyện khác', 'kind': 'not-a-kind'},
        'not a dict',
    ])
    assert issues[0] == {'severity': 'high', 'text': 'thiếu hướng X', 'fix': 'thêm X',
                         'kind': 'missing-direction'}
    assert 'kind' not in issues[1] and issues[1]['severity'] == 'medium'
    assert len(issues) == 2
    assert research_review.normalize_issues([], max_items=0) == []


def test_the_cap_and_the_text_limit_of_the_old_clamp_still_hold():
    long_text = 'x' * (limits.RESEARCH_VERIFY_ISSUE_CHARS + 50)
    rows = research_review.normalize_issues(
        [{'severity': 'low', 'text': long_text} for _ in range(limits.RESEARCH_VERIFY_MAX_ISSUES + 5)])
    assert len(rows) == limits.RESEARCH_VERIFY_MAX_ISSUES
    assert len(rows[0]['text']) == limits.RESEARCH_VERIFY_ISSUE_CHARS


def test_an_unhandled_high_missing_direction_puts_the_coverage_label_on_the_dossier():
    open_finding = [{'severity': 'high', 'kind': 'missing-direction', 'text': 'thiếu hướng X'}]
    assert research_review.has_unhandled_missing_direction(open_finding) is True
    assert research_review.coverage_label(open_finding) == limits.RESEARCH_COVERAGE_LABEL
    handled = [dict(open_finding[0], handled=True)]
    assert research_review.has_unhandled_missing_direction(handled) is False
    assert research_review.coverage_label(handled) == ''
    low = [{'severity': 'low', 'kind': 'missing-direction', 'text': 'x'}]
    assert research_review.coverage_label(low) == '', 'chỉ mức CAO mới gắn nhãn'
    assert research_review.coverage_label(verdict='revise') == limits.RESEARCH_COVERAGE_LABEL


# --- phân xử mâu thuẫn -------------------------------------------------------

def test_two_independent_reviewers_in_disagreement_make_the_claim_contested_at_the_lowest_cap():
    resolved = research_review.resolve_disagreement(
        [{'reviewer': 'a', 'verdict': 'ok', 'cap': 'high', 'mode': 'evidence'},
         {'reviewer': 'b', 'verdict': 'revise', 'cap': 'low', 'mode': 'critique'}],
        claim_id='c1')
    assert resolved['contested'] is True and resolved['mustReport'] is True
    assert resolved['cap'] == 'low', 'trần là mức THẤP NHẤT, không lấy theo đa số'
    assert resolved['verdict'] == 'revise'
    assert 'c1' in resolved['reportLine']
    assert resolved['distinctReviewers'] == ['a', 'b']
    assert resolved['note']


def test_agreement_and_a_single_reviewer_are_not_a_disagreement():
    agree = research_review.resolve_disagreement(
        [{'reviewer': 'a', 'verdict': 'ok', 'cap': 'high'},
         {'reviewer': 'b', 'verdict': 'ok', 'cap': 'high'}])
    assert agree['contested'] is False and agree['reportLine'] == ''
    assert agree['verdict'] == 'ok' and agree['cap'] == 'high'
    alone = research_review.resolve_disagreement([{'reviewer': 'a', 'verdict': 'revise'}])
    assert alone['contested'] is False
    # Hai phán quyết trái nhau nhưng CÙNG một người soát là không đủ: phải có hai bên độc lập.
    same = research_review.resolve_disagreement(
        [{'reviewer': 'a', 'verdict': 'ok'}, {'reviewer': 'a', 'verdict': 'revise'}])
    assert same['contested'] is False


def test_a_relation_level_conflict_is_enough_and_the_given_caps_win():
    resolved = research_review.resolve_disagreement(
        [{'reviewer': 'src-1', 'relation': 'supports'}, {'reviewer': 'src-2', 'relation': 'contradicts'}],
        caps=['high', 'medium'])
    assert resolved['contested'] is True and resolved['cap'] == 'medium'
    assert resolved['claimId'] == ''
    assert research_review.contested_claims([resolved, {'claimId': 'c9', 'contested': False}]) == [], \
        'nhận định tranh chấp không có mã thì không bịa ra một mã'
    named = research_review.resolve_disagreement(
        [{'reviewer': 'a', 'verdict': 'ok'}, {'reviewer': 'b', 'verdict': 'revise'}], claim_id='c7')
    assert research_review.contested_claims([named]) == ['c7']


# --- quyền công cụ -----------------------------------------------------------

def test_the_branch_report_tool_belongs_to_the_research_branch_only():
    assert 'research_branch_report' in roles.ROLES['research'].tools
    assert 'research_branch_report' not in roles.ROLES['research-review'].tools
    assert 'research_branch_report' not in roles.ORCHESTRATOR_TOOLS
    for role in ('explore', 'build', 'review', 'plan-review'):
        assert 'research_branch_report' not in roles.allowed_tools(role), role
    # Orchestrator không giữ nó, nên `allowed_tools` phải tự thêm lại cho nhánh — cùng khuôn
    # với `claim_assess` của vai phản biện.
    assert 'research_branch_report' in roles.allowed_tools('research',
                                                           parent=roles.ORCHESTRATOR_TOOLS)
    assert 'claim_assess' in roles.allowed_tools('research-review',
                                                 parent=roles.ORCHESTRATOR_TOOLS)
