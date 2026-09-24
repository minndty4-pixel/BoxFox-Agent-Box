"""Ba nhóm hồ sơ việc (`research_profiles.py`, vòng 27 đợt 4, B-3a/B-3b).

Hồ sơ là bảng khai: mỗi nhóm việc có đúng những trường mà một người đọc khó tính sẽ hỏi (số hiệu
và ngày hiệu lực cho văn bản; DOI + đã mở toàn văn cho bài báo; giá + đơn vị tiền + ngày lấy cho
một mức giá; phiên bản + ngày phát hành cho tài liệu hãng). Trường `hard` thiếu ⇒ cổng chất lượng
chặn; trường `soft` thiếu ⇒ chỉ được nhắc. Ca kiểm ghim ba nhóm ấy, cộng ba luật khó: hồ sơ nhận
TÊN NHÓM, `validity` chỉ bật cho nhóm văn bản — nơi "còn hiệu lực" mới có nghĩa, và trường mềm
không bao giờ được tính là chặn.
"""
from __future__ import annotations

from agentbox.agent_core import research_profiles as rp


def hard_keys(key: str) -> set[str]:
    """Trường CỨNG của hồ sơ — thứ duy nhất được quyền chặn một hồ sơ."""
    return {field.key for field in rp.get(key).hard_fields}


def rows(key: str, payload: dict) -> dict[str, str]:
    """`{khoá trường: mức}` cho mọi trường còn thiếu — cả cứng lẫn mềm."""
    return {field.key: level for field, level in rp.get(key).missing(payload)}


def missing_hard(key: str, payload: dict) -> set[str]:
    return {k for k, level in rows(key, payload).items() if level == 'hard'}


def test_every_profile_names_a_group_and_its_hard_fields():
    assert set(rp.GROUPS) == {'official-document', 'academic', 'market'}
    assert len(rp.PROFILES) == 9
    for key, profile in rp.PROFILES.items():
        assert profile.group in rp.GROUPS, key
        assert profile.label and profile.label.strip(), key
        assert profile.hard_fields, f'{key} phải có ít nhất một trường bắt buộc'
        for field in profile.fields:
            assert field.required in ('hard', 'soft'), (key, field.key)
            assert field.label, (key, field.key)
            assert field.kind in rp.KINDS, (key, field.key)
    assert rp.label_of('health') == 'văn bản chính thống (y tế)'


def test_the_law_profile_demands_number_effective_date_and_validity():
    assert {'docNumber', 'effectiveDate', 'validity'} <= hard_keys('law')
    assert {'docNumber', 'effectiveDate', 'validity'} <= missing_hard('law', {})
    filled = {'docNumber': '75/2023/NĐ-CP', 'effectiveDate': '2023-12-01', 'validity': 'in_force'}
    assert missing_hard('law', filled) == set(), 'đủ ba trường cứng ⇒ không còn trường cứng nào'
    assert set(rows('law', filled).values()) == {'soft'}, 'hai trường mềm còn thiếu chỉ để nhắc'
    # Nhãn người đọc đi kèm trường thiếu, và mức đi kèm nhãn ấy.
    labels = dict(rp.missing_fields('law', {}))
    assert labels['số hiệu văn bản'] == 'hard'
    # Nhóm văn bản giữ `validity` (còn/hết hiệu lực); bài báo khoa học thì không.
    assert rp.get('law').validity is True
    assert rp.get('paper').validity is False


def test_the_paper_profile_does_not_demand_a_validity_word_but_demands_the_full_text():
    assert 'openedFullText' in missing_hard('paper', {'year': '2024'})
    assert 'validity' not in rows('paper', {'year': '2024'})
    # DOI **hoặc** arXiv id là điều kiện hoặc: có một trong hai thì nhóm ấy không bị chấm thiếu.
    assert missing_hard('paper', {'doi': '10.7717/peerj.4375', 'year': '2024',
                                  'openedFullText': 'yes'}) == set()
    assert missing_hard('paper', {'arxivId': '2401.00001', 'year': '2024',
                                  'openedFullText': 'yes'}) == set()
    assert missing_hard('paper', {'year': '2024', 'openedFullText': 'yes'}) == {'doi hoặc arxivId'}
    assert missing_hard('paper', {}) == {'doi hoặc arxivId', 'year', 'openedFullText'}


def test_the_price_profile_demands_currency_capture_date_and_region():
    assert {'currency', 'capturedAt', 'region'} <= missing_hard('price', {'price': '1.500.000'})
    assert 'price' not in missing_hard('price', {'price': '1.500.000'})
    full = {'price': '1500000', 'currency': 'VND', 'capturedAt': '2026-09-01', 'region': 'Hà Nội'}
    assert missing_hard('price', full) == set(), 'hai trường mềm không bao giờ chặn'
    assert set(rows('price', full)) == {'package', 'taxIncluded'}, 'chúng vẫn được nhắc'


def test_a_group_name_resolves_to_its_first_profile():
    assert rp.resolve('official-document') is rp.get('law')
    assert rp.resolve('academic') is rp.get('paper')
    assert rp.resolve('market') is rp.get('price')
    assert rp.resolve('price') is rp.get('price')
    assert rp.resolve('không-có-hồ-sơ-này') is None
    assert rp.default_for_group('market') is rp.get('price')
    assert rp.group_of('paper') == 'academic'
    assert rp.group_of('không-có') == '', 'hồ sơ lạ không được gán bừa vào một nhóm'


def test_every_profile_says_which_usecases_and_archetype_it_serves():
    for key, profile in rp.PROFILES.items():
        for usecase in profile.usecases:
            assert rp.usecase(usecase) is not None, (key, usecase)
        if profile.archetype:
            assert rp.archetype(profile.archetype) is not None, (key, profile.archetype)
    described = rp.describe()
    assert {item['key'] for item in described} == set(rp.PROFILES)
    assert rp.summary_for(['law', 'price']) == 'luật + giá'


def test_a_soft_field_alone_never_blocks_and_hard_keys_are_listed_once():
    soft = rp.missing_fields('repo', {'repo': 'minndty3-design/BoxFox-Agent-Box',
                                      'commit': 'a959c51', 'accessedAt': '2026-09-24'})
    assert soft == [('tệp/dòng đã đọc', 'soft')], 'chỉ trường mềm thiếu, và không được chặn'
    assert missing_hard('repo', {'repo': 'x', 'commit': 'y', 'accessedAt': 'z'}) == set()
    assert 'file' not in rp.required_keys('repo')
    assert rp.required_keys('repo') == ('repo', 'commit', 'accessedAt')
    # Hồ sơ không tồn tại ⇒ không ném, trả danh sách rỗng.
    assert rp.missing_fields('không-có', {}) == []
    assert rp.required_keys('không-có') == ()
    assert rp.required_keys('LAW') == rp.required_keys('law'), 'đọc không phân biệt hoa thường'
