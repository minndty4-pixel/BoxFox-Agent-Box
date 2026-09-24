"""Thang nguồn bốn tầng (`source_tiers.py`, vòng 27 đợt 3, B-2): phân loại + bảng phủ.

Bốn tầng là lời hứa với chủ nhà: một khẳng định then chốt cần nguồn `is_primary` (tầng 0–1), còn
báo chí chính thống chỉ là tầng 2. Ca kiểm ở đây ghim ĐÚNG bốn nhóm host đó, cộng hai luật khó:
tài liệu chủ nhà cấp (`method='workspace'` ⇒ tầng 0) và bảng phủ từ `BOXFOX_SOURCE_TIERS`
(JSON inline hoặc đường dẫn tệp) — bảng hỏng thì **không** được ném, chỉ mất phần phủ.
"""
from __future__ import annotations

import json

from agentbox.agent_core import source_tiers


def classify(url, **kwargs):
    return source_tiers.classify(url, **kwargs)


def test_a_government_portal_host_lands_in_tier_one():
    for url in ('https://vanban.chinhphu.vn/?pageid=27160&docid=123456',
                'https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=1',
                'https://moh.gov.vn/tin-lien-quan/-/asset_publisher/x/content/id/1',
                'https://soyte.angiang.gov.vn/tin-tuc/1'):
        tier = classify(url)
        assert tier.tier == 1, url
        assert tier.is_primary is True
        assert tier.reason in source_tiers.REASONS


def test_a_state_press_agency_host_lands_in_tier_two():
    tier = classify('https://nhandan.vn/gia-vang-hom-nay-post123.html')
    assert tier.tier == 2
    assert tier.is_primary is False
    assert tier.host == 'nhandan.vn'
    assert tier.type_label == source_tiers.TYPE_LABELS['normal']


def test_an_anonymous_aggregator_host_lands_in_tier_four():
    tier = classify('https://www.facebook.com/groups/123/posts/456')
    assert tier.tier == 4
    assert tier.is_primary is False
    assert tier.reason == 'host-in-table'
    assert classify('https://x.com/someone/status/1').tier == 4
    assert classify('https://medium.com/@someone/story').tier == 4


def test_an_unknown_host_lands_in_tier_three():
    tier = classify('https://example.com/bai-viet')
    assert tier.tier == 3
    assert tier.reason == 'default-unknown'
    assert tier.label == source_tiers.TIER_LABELS[3]


def test_a_declared_official_social_page_is_tier_one_and_needs_a_second_source():
    tier = classify('https://www.facebook.com/bo.yte/posts/789', type='official-social')
    assert (tier.tier, tier.type) == (1, 'official-social')
    # Một trang xã hội chính thức KHÔNG tự nó là bản gốc: câu trả lời vẫn phải có nguồn thứ hai.
    assert tier.is_primary is True
    # Bảng sẵn có cũng nhận ra trang ấy (host + tiền tố đường dẫn) — không cần khai lại `type`.
    listed = classify('https://www.facebook.com/bo.yte/posts/789')
    assert (listed.tier, listed.type) == (1, 'official-social')
    # Nhưng một trang xã hội KHÔNG nằm trong bảng thì vẫn là tầng 4.
    assert classify('https://www.facebook.com/someone/posts/789').tier == 4


def test_a_document_the_owner_supplied_is_tier_zero():
    tier = classify('file:///workspace/ke-hoach.pdf', method='workspace')
    assert (tier.tier, tier.type) == (0, 'host-doc')
    assert tier.reason == 'owner-supplied'
    assert tier.is_primary is True
    assert classify('https://example.com/owner.pdf', type='host-doc').tier == 0


def test_a_host_with_subdomain_documents_lands_in_tier_one():
    tier = classify('https://docs.python.org/3/whatsnew/3.13.html')
    assert tier.tier == 1
    assert classify('https://developers.google.com/sheets/api').tier == 1
    assert classify('https://myproject.readthedocs.io/en/latest/').tier == 1


def test_an_override_table_can_move_a_host_to_another_tier():
    override = source_tiers.parse_overrides(json.dumps({'tiers': {'1': ['example.com']}}))
    assert override.error is None
    assert override.overrides[1] == ('example.com',)
    tier = classify('https://example.com/bai-viet', overrides=override.overrides)
    assert (tier.tier, tier.reason) == (1, 'env-override')


def test_a_broken_override_table_never_raises_and_keeps_the_old_tiers():
    for raw in ('{not json', json.dumps(['a']), json.dumps({'tiers': {'9': ['a.com']}}),
                json.dumps({'tiers': {'1': 'a.com'}}), json.dumps({'officialSocial': 'a'})):
        broken = source_tiers.parse_overrides(raw)
        assert broken.error, raw
        assert broken.overrides == {}
        assert classify('https://nhandan.vn/x', overrides=broken.overrides).tier == 2
    assert source_tiers.parse_overrides(None).overrides == {}


def test_the_override_file_and_the_inline_json_are_read_the_same_way(tmp_path):
    path = tmp_path / 'tiers.json'
    path.write_text(json.dumps({'tiers': {'4': ['nhandan.vn']}, 'officialSocial': ['facebook.com/abc']}),
                    encoding='utf-8')
    from_file = source_tiers.load_from_env({source_tiers.SOURCE_TIERS_ENV: str(path)})
    assert from_file.error is None
    assert from_file.source == 'file'
    assert classify('https://nhandan.vn/x', overrides=from_file.overrides).tier == 4
    social = classify('https://facebook.com/abc/posts/1', official_social=from_file.official_social)
    assert (social.tier, social.type) == (1, 'official-social')


def test_classify_never_raises_on_junk_input():
    for url in (None, '', '   ', 'không-phải-url', 'http://', '://x'):
        tier = classify(url)
        assert isinstance(tier.tier, int)
        assert tier.tier in source_tiers.TIERS
