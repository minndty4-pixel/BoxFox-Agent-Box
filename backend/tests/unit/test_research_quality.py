"""Cổng chất lượng research — tầng hồ sơ (`research_quality.assess`, vòng 27 đợt 4/6, B-3b/C-2).

Cổng này giữ điều kiện của chủ nhà: *hồ sơ chỉ được ghi khi có nguồn mở thật, đoạn trích nguyên văn,
dấu vết về con làm việc, và mục Phản biện ở mức 3* (#5989, #5996, #6012). Ba tính chất phải giữ,
mỗi tính chất ghim bằng một ca đọc được:

* **không bao giờ ném** — hỏi cổng bằng một hồ sơ rỗng vẫn trả về một kết luận;
* **`enforce` từ chối, `warn` kể lỗi rồi đi tiếp, `off` không kiểm** — ba mức, ba kết cục;
* **một lỗi kể một lần** — trường đã có luật theo dòng (số hiệu/ngày hiệu lực/dấu hiệu lực) không
  bị kể lại lần hai ở luật trường hồ sơ.

Các ca "phải bị từ chối" luôn đi kèm ca "phải qua" để một luật quá tay cũng lộ ra.
"""
from __future__ import annotations

import pytest

from agentbox.agent_core import research_ledger, research_quality, research_profiles
from agentbox.agent_core.reading import normalize_url
from agentbox.agent_core.limits import RESEARCH_GATE_ENV

REMEDY_CODES = set(research_quality.RESEARCH_CODES)


def long_text(seed: str, times: int = 6) -> str:
    """Đoạn trích dài hơn sàn vân tay (>200 ký tự) — dưới sàn thì luật cùng-bản-tin không chạy."""
    return (seed + ' ') * times


def row(row_id, *, host='moh.gov.vn', url=None, tier=1, excerpt='', origin=None, type='normal',
        payload=None, method='web_fetch', claim='quy định chuyển tuyến', child_id=None):
    return research_ledger.Row(row_id=row_id, claim=claim, url=url or f'https://{host}/{row_id}',
                               host=host, tier=tier, type=type, excerpt=excerpt, origin=origin,
                               method=method, payload=payload or {}, child_id=child_id)


def law_payload():
    return {'docNumber': '15/2026/TT-BYT', 'effectiveDate': '2026-07-01', 'validity': 'in_force'}


def clean_rows():
    """Hai dòng sổ cho hồ sơ luật: hai host, khai đủ ba trường cứng, đoạn trích khác nhau."""
    return [
        row('r1', host='moh.gov.vn', tier=1, excerpt=long_text('Theo Thông tư, hồ sơ chuyển tuyến gồm bốn loại giấy tờ'),
            payload=law_payload()),
        row('r2', host='baochinhphu.vn', tier=2,
            excerpt=long_text('Bộ Y tế cho biết thẻ bảo hiểm và giấy chuyển tuyến là hai giấy tờ bắt buộc'),
            payload=law_payload()),
    ]


def good_markdown(*, level=2):
    """Hồ sơ đủ hình dạng cho mức đã chọn, chỉ trỏ tới hai dòng sổ của `clean_rows()`."""
    sections = ['# Hồ sơ chuyển tuyến bảo hiểm y tế', '', '## Câu hỏi', 'Cần những giấy tờ nào?', '',
                '## Phát hiện', 'Bốn loại giấy tờ [r1] [r2].', '', '## Nguồn',
                '- [r1] https://moh.gov.vn/r1 (tầng 1)',
                '- [r2] https://baochinhphu.vn/r2 (tầng 2)', '',
                '## Mâu thuẫn còn lại', 'Không có.', '', '## Việc chưa làm', 'Không.']
    if int(level) >= 3:
        sections += ['', '## Phản biện', 'Người phản biện đã soi bốn điểm và chấp nhận.']
    return '\n'.join(sections)


def codes(verdict):
    return [issue['code'] for issue in verdict.missing]


def details(verdict, code):
    return [issue['detail'] for issue in verdict.missing if issue['code'] == code]


def assess(**kwargs):
    kwargs.setdefault('level', 2)
    kwargs.setdefault('markdown', good_markdown(level=kwargs['level']))
    kwargs.setdefault('rows', clean_rows())
    kwargs.setdefault('profile', research_profiles.get('law'))
    return research_quality.assess(**kwargs)


# --- Không bao giờ ném, và ba mức công tắc ---------------------------------


def test_the_gate_never_raises_and_a_missing_env_reads_the_default(monkeypatch):
    monkeypatch.delenv(RESEARCH_GATE_ENV, raising=False)
    verdict = assess(markdown='', rows=[])
    assert isinstance(verdict, research_quality.Verdict)
    assert verdict.mode == research_quality.gate_mode()[0]
    assert verdict.ok is False, 'hồ sơ rỗng thì không thể qua'
    assert all(issue['remedy'] for issue in verdict.missing), 'mỗi lỗi phải kèm câu khắc phục'
    assert {issue['code'] for issue in verdict.missing} <= REMEDY_CODES


def test_an_unknown_value_falls_back_to_enforce_and_the_raw_value_is_kept(monkeypatch):
    monkeypatch.setenv(RESEARCH_GATE_ENV, 'chặt-vừa-thôi')
    mode, raw = research_quality.gate_mode()
    assert (mode, raw) == ('enforce', 'chặt-vừa-thôi')
    assert mode == 'enforce' == research_quality.RESEARCH_GATE_MODES[0]
    assert assess(mode=None).mode == 'enforce'


@pytest.mark.parametrize('value', research_quality.RESEARCH_GATE_MODES)
def test_a_valid_value_is_not_reported_as_unknown(monkeypatch, value):
    """Giá trị HỢP LỆ ⇒ phần tử thứ hai là `None`; bản trước trả lại chính giá trị ấy nên đường
    `dossier_write` phát notice `RESEARCH_GATE_MODE_UNKNOWN` mỗi lần ghi, kể cả khi mức áp đúng."""
    assert research_quality.gate_mode({RESEARCH_GATE_ENV: value}) == (value, None)
    assert research_quality.gate_mode({RESEARCH_GATE_ENV: '  ' + value.upper() + ' '}) == (value, None)
    assert research_quality.gate_mode({}) == (research_quality.RESEARCH_GATE_DEFAULT_MODE, None)


def test_off_never_inspects_anything(monkeypatch):
    monkeypatch.setenv(RESEARCH_GATE_ENV, 'off')
    verdict = assess(level=3, markdown='', rows=[])
    assert verdict.ok is True and verdict.issues == [] and verdict.mode == 'off'


def test_warn_keeps_the_same_issues_but_does_not_own_the_refusal(monkeypatch):
    monkeypatch.setenv(RESEARCH_GATE_ENV, 'warn')
    verdict = assess(markdown='', rows=[])
    assert verdict.mode == 'warn'
    assert verdict.ok is False, 'cùng luật, cùng lỗi — chỉ khác kết cục ở tầng gọi'
    assert codes(verdict), 'warn phải kể được lỗi để notice có nội dung'


# --- Hình dạng hồ sơ theo mức ---------------------------------------------


def test_a_dossier_missing_a_required_section_says_which_section():
    verdict = assess(rows=clean_rows(), markdown='# Hồ sơ\n\n## Tóm tắt\nNgắn.\n')
    missing = details(verdict, 'research-shape-missing')
    assert 'mục Câu hỏi' in missing
    assert set(missing) <= set(research_quality.SECTION_LABELS.values())


def test_level_three_demands_the_critique_section_and_level_two_does_not():
    assert not details(assess(level=2), 'research-shape-missing')
    assert 'mục Phản biện' in details(assess(level=3, markdown=good_markdown(level=2)),
                                     'research-shape-missing')


def test_a_pinned_row_the_ledger_does_not_have_is_a_broken_pointer():
    markdown = good_markdown(level=1).replace('## Nguồn', 'Xem lại [r12] để đối chiếu.\n\n## Nguồn')
    verdict = assess(level=1, markdown=markdown, rows=clean_rows()[:1])
    assert any('r12' in detail for detail in details(verdict, 'research-sources-unproven'))


# --- Nguồn đã mở thật -----------------------------------------------------


def test_a_dossier_citing_a_url_outside_the_ledger_is_refused():
    markdown = good_markdown(level=2) + '\nTheo https://vnexpress.net/bai-la thì phí tăng.\n'
    verdict = assess(markdown=markdown, mode='enforce')
    assert any('vnexpress.net' in detail for detail in details(verdict, 'research-sources-unproven'))


def test_a_dossier_claiming_external_facts_with_an_empty_ledger_is_refused():
    verdict = assess(rows=[])
    assert 'research-sources-missing' in codes(verdict)


def test_the_same_dossier_with_the_rows_behind_it_is_accepted():
    verdict = assess()
    assert verdict.ok is True, verdict.missing
    assert verdict.counts['rows'] == 2 and verdict.counts['hosts'] == 2
    assert verdict.label == research_profiles.label_of('law')


# --- Dấu vết về con làm việc ----------------------------------------------


def test_a_planned_child_that_left_no_row_is_lineage_missing():
    verdict = assess(child_ids=['child-a', 'child-b'])
    reported = details(verdict, 'research-lineage-missing')
    assert reported == ['child-a', 'child-b']


def test_a_child_that_left_a_row_is_not_reported_missing():
    rows = clean_rows()
    rows[0] = row('r1', host='moh.gov.vn', tier=1,
                  excerpt=long_text('Theo Thông tư, hồ sơ chuyển tuyến gồm bốn loại giấy tờ'),
                  payload=law_payload(), child_id='child-a')
    verdict = assess(rows=rows, child_ids=['child-a'])
    assert 'research-lineage-missing' not in codes(verdict)
    assert verdict.counts['children'] == 1 and verdict.counts['plannedChildren'] == 1


# --- Phản biện ở mức 3 ----------------------------------------------------


def test_enforce_refuses_a_level_three_dossier_that_has_no_critique():
    markdown = good_markdown(level=3).replace('\n## Phản biện', '\n## Ghi chú thừa')
    verdict = assess(level=3, markdown=markdown, critique_ok=False, mode='enforce')
    assert 'research-critique-missing' in codes(verdict)


def test_warn_writes_the_level_three_dossier_but_the_section_is_still_missing():
    markdown = good_markdown(level=3).replace('\n## Phản biện', '\n## Ghi chú thừa')
    verdict = assess(level=3, markdown=markdown, critique_ok=False, mode='warn')
    assert 'research-critique-missing' not in codes(verdict), 'warn không kể lỗi riêng của enforce'
    assert 'research-shape-missing' in codes(verdict), 'mục Phản biện thiếu vẫn là lỗi hình dạng'


def test_no_critique_is_asked_for_at_level_two():
    verdict = assess(level=2, critique_ok=False, mode='enforce')
    assert 'research-critique-missing' not in codes(verdict)
    assert verdict.ok is True


# --- Một lỗi kể một lần ---------------------------------------------------


def test_one_missing_hard_field_is_reported_once_with_its_label():
    rows = [row('r1', host='moh.gov.vn', tier=1, excerpt=long_text('Theo Thông tư'),
                payload=law_payload())]
    verdict = assess(level=1, profile=research_profiles.get('health'),
                     markdown=good_markdown(level=1).replace('https://baochinhphu.vn/r2 (tầng 2)\n', ''),
                     rows=rows)
    fields = details(verdict, 'research-profile-field-missing')
    assert fields == ['đối tượng áp dụng (tuyến, nhóm bệnh, mức hưởng)'], fields


def test_the_field_covered_by_a_row_rule_is_not_reported_twice():
    rows = [row('r1', host='moh.gov.vn', tier=1, excerpt=long_text('Theo Thông tư'), payload={})]
    verdict = assess(level=1, profile=research_profiles.get('health'),
                     markdown=good_markdown(level=1).replace('https://baochinhphu.vn/r2 (tầng 2)\n', ''),
                     rows=rows)
    assert 'research-validity-missing' in codes(verdict), 'luật theo dòng là chỗ kể lỗi này'
    assert details(verdict, 'research-profile-field-missing') == \
        ['đối tượng áp dụng (tuyến, nhóm bệnh, mức hưởng)'], 'ba trường kia đã có luật riêng'


def test_the_owner_view_labels_match_the_review_contract():
    assert tuple(label for label, _english in research_quality.OWNER_VIEW_LABELS) == \
        ('ủng hộ', 'phản bác', 'chưa chắc')
    assert 'research-owner-views-missing' in REMEDY_CODES


@pytest.mark.parametrize('level', [1, 2, 3])
def test_every_level_names_its_own_required_sections(level):
    labels = research_quality.missing_sections('# x\n', level)
    assert labels and all(label.startswith('mục ') for label in labels)
    assert len(labels) == len(set(labels))
    assert labels == list(research_quality.SECTION_LABELS[key] for key, _ in
                          research_quality.DOSSIER_SECTIONS[level])


# --- #6025: mục soi ý kiến chủ nhà đủ ba nhãn, mỗi nhãn kèm nguồn ------------------------


def test_the_three_label_section_is_demanded_only_when_the_brief_carried_owner_views():
    plain = assess()
    assert 'research-owner-views-missing' not in codes(plain), 'không có ý kiến chủ nhà thì không đòi mục này'
    with_views = assess(owner_views=['phí sẽ tăng trong 2026'])
    assert 'research-owner-views-missing' in codes(with_views)


def test_a_missing_label_is_named_and_a_label_without_a_source_is_named_too():
    review = ('### Soi ý kiến chủ nhà\n- ủng hộ: phí tăng theo thông tư mới [r1]\n'
              '- phản bác: chưa thấy dữ liệu nào\n')
    verdict = assess(owner_views=['phí sẽ tăng trong 2026'], review=review, mode='enforce')
    reported = details(verdict, 'research-owner-views-missing')
    assert 'thiếu nhãn: chưa chắc' in reported, reported
    assert any(item.startswith('nhãn chưa kèm nguồn: ') for item in reported), \
        'nhãn `phản bác` trống nguồn phải bị kể'


def test_the_three_labelled_lines_each_with_a_source_pass_the_rule():
    review = ('### Soi ý kiến chủ nhà\n- ủng hộ: theo [r1]\n- phản bác: xem https://baochinhphu.vn/b\n'
              '- chưa chắc: chưa mở được bản gốc [r2]\n')
    verdict = assess(owner_views=['phí sẽ tăng trong 2026'], review=review, mode='enforce')
    assert 'research-owner-views-missing' not in codes(verdict)


def test_the_rule_reads_the_dossier_when_no_review_file_text_was_given():
    dossier = good_markdown(level=2) + ('\n## Soi ý kiến chủ nhà\n- ủng hộ: [r1]\n- phản bác: '
                                         'https://baochinhphu.vn/b\n- chưa chắc: [r2]\n')
    verdict = assess(markdown=dossier, owner_views=['phí sẽ tăng'], mode='enforce')
    assert 'research-owner-views-missing' not in codes(verdict)


@pytest.mark.parametrize('tail', ['.', ',', ';', ':', '!', '?', '*', '**', ').', '`'])
def test_a_url_with_trailing_punctuation_is_still_the_ledger_row(tail):
    """Dấu câu đuôi URL không được biến một nguồn CÓ trong sổ thành "nguồn chưa chứng minh".

    Bản trước: `_URL_RE` nuốt luôn dấu `.` `,` `;` `:` `*` `!` ở đuôi, mà `normalize_url` không cắt,
    nên hồ sơ viết "… theo https://moh.gov.vn/r1." bị cổng `enforce` TỪ CHỐI với cách sửa không thể
    thi hành ("nguồn chưa chứng minh: https://moh.gov.vn/r1.") — trong khi dòng sổ đúng là nguồn ấy.
    """
    markdown = good_markdown(level=2) + f'\nTheo https://moh.gov.vn/r1{tail} thì phí tăng.\n'
    verdict = assess(markdown=markdown, rows=clean_rows())
    assert 'research-sources-unproven' not in codes(verdict)


def test_a_url_outside_the_ledger_still_says_so_with_punctuation():
    markdown = good_markdown(level=2) + '\nTheo https://vnexpress.net/bai-la, thì phí tăng.\n'
    verdict = assess(markdown=markdown, rows=clean_rows())
    assert 'https://vnexpress.net/bai-la' in details(verdict, 'research-sources-unproven')


def test_the_two_faces_of_the_ledger_compare_urls_the_same_way():
    """`urls_in` (hồ sơ) và phần chú thích nhánh con dùng CHUNG một phép cắt dấu câu."""
    assert research_quality.clean_url('https://moh.gov.vn/r1.') == research_quality.clean_url('https://moh.gov.vn/r1')
    assert research_quality.clean_url('https://moh.gov.vn/r1**') == 'https://moh.gov.vn/r1'
    # Không phá URL thật có sẵn dấu trong đường dẫn hay truy vấn: dấu câu CHỈ bị cắt ở ĐUÔI.
    assert research_quality.clean_url('https://a.vn/x?q=1,2') == normalize_url('https://a.vn/x?q=1,2')
    assert research_quality.clean_url('https://a.vn/x/') == normalize_url('https://a.vn/x/')
    assert research_quality.clean_url('https://a.vn/x/') != normalize_url('https://a.vn/x')
    notes = research_quality.annotate_child_answer('Kết luận theo https://moh.gov.vn/r1.', rows=clean_rows()[:1],
                                                   child_id='c1')
    assert 'research-sources-unproven' not in notes['issues']
