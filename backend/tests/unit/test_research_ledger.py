"""Sổ nguồn — phần LUẬT thuần (`research_ledger.py`, vòng 27 đợt 3–4, A4/B-1/B-2).

Ba câu hỏi ở đây là ba câu hỏi của chủ nhà, không phải của máy: *hai bài này có phải một nguồn
không?* (#5996), *khẳng định then chốt này có nguồn thứ hai thật chưa?* (#5985), *sổ này đã đủ dày
để kết luận chưa?* (#6012). Mỗi luật được ghim bằng một ca đọc được, và các ca "phải bị chặn" đi
kèm ca "phải qua" để một luật quá tay cũng lộ ra.
"""
from __future__ import annotations

from agentbox.agent_core import research_ledger


def long_text(seed: str, times: int = 4) -> str:
    """Đoạn trích dài hơn sàn vân tay (>200 ký tự) — dưới sàn thì luật cùng-bản-tin không chạy."""
    return (seed + ' ') * times


def row(row_id, *, host='a.vn', url=None, tier=2, excerpt='', origin=None, type='normal',
        payload=None, method='web_fetch', claim='quy định chuyển tuyến', source_row_id=None):
    return research_ledger.Row(row_id=row_id, claim=claim, url=url or f'https://{host}/{row_id}',
                               host=host, tier=tier, type=type, excerpt=excerpt, origin=origin,
                               method=method, payload=payload or {}, source_row_id=source_row_id)


def codes(rows, profile=None, verified=None):
    return {issue.code for issue in research_ledger.assess_rows(rows, profile, verified=verified or {})}


def test_a_source_row_keeps_the_verbatim_excerpt_the_tier_and_the_fetch_date():
    item = research_ledger.Row(row_id='r7', claim='mức phí', url='https://moh.gov.vn/a', host='moh.gov.vn',
                               tier=1, excerpt='Nguyên văn đoạn đã đọc.', fetched_at='2026-09-23T10:00:00Z',
                               payload={'priceVnd': 1500_000})
    clone = item.with_payload({'priceVnd': 2000_000})
    assert (clone.row_id, clone.tier, clone.fetched_at) == ('r7', 1, '2026-09-23T10:00:00Z')
    assert clone.payload['priceVnd'] == 2000_000
    assert item.payload['priceVnd'] == 1500_000, 'bản gốc không bị sửa theo'


def test_the_same_story_published_at_two_hosts_counts_once():
    body = long_text('Hồ sơ chuyển tuyến bảo hiểm y tế gồm bốn loại giấy tờ theo quy định mới')
    rows = [row('r1', host='baochinhphu.vn', excerpt=body), row('r2', host='nhandan.vn', excerpt=body)]
    units = research_ledger.origin_units(rows)
    assert len(units) == 1
    assert units[0].reason == 'same-story'
    assert research_ledger.independent_count(rows) == 1


def test_a_declared_origin_lets_two_different_hosts_count_as_two():
    rows = [row('r1', host='dantri.com.vn', excerpt=long_text('bản tin về chuyển tuyến'),
                origin='baochinhphu.vn'),
            row('r2', host='vietnamnet.vn', excerpt=long_text('một chủ đề khác hẳn về giá dịch vụ'),
                origin='moh.gov.vn')]
    assert research_ledger.independent_count(rows) == 2
    same = [row('r1', host='dantri.com.vn', excerpt=long_text('bản tin về chuyển tuyến'),
                origin='baochinhphu.vn'),
            row('r2', host='vietnamnet.vn', excerpt=long_text('bản tin về chuyển tuyến'),
                origin='baochinhphu.vn')]
    assert research_ledger.independent_count(same) == 1, 'khai cùng nguồn gốc ⇒ cùng một nguồn'


def test_a_short_excerpt_does_not_merge_two_hosts():
    body = 'Chuyển tuyến đúng tuyến.'
    rows = [row('r1', host='a.vn', excerpt=body), row('r2', host='b.vn', excerpt=body)]
    assert len(body) < research_ledger.MIN_FINGERPRINT_CHARS
    assert research_ledger.independent_count(rows) == 2


def test_a_reused_excerpt_without_a_declared_origin_is_flagged():
    body = long_text('Cùng một bản tin được hai báo đăng lại nguyên văn')
    rows = [row('r1', host='baochinhphu.vn', excerpt=body), row('r2', host='nhandan.vn', excerpt=body)]
    assert 'research-origin-undeclared' in codes(rows)
    declared = [row('r1', host='baochinhphu.vn', excerpt=body, origin='baochinhphu.vn'),
                row('r2', host='nhandan.vn', excerpt=body, origin='baochinhphu.vn')]
    assert 'research-origin-undeclared' not in codes(declared)


def test_an_excerpt_under_the_floor_is_flagged():
    rows = [row('r1', excerpt='quá ngắn')]
    assert 'research-excerpt-missing' in codes(rows)
    rows = [row('r1', excerpt=long_text('đủ dài để không bị chấm là thiếu đoạn trích nguyên văn'))]
    assert 'research-excerpt-missing' not in codes(rows)


def test_a_primary_source_alone_is_enough_for_a_key_claim():
    """#5985: khẳng định then chốt (có số hiệu văn bản) cần tầng 0–1, hoặc hai nguồn tầng 2–3."""
    body = long_text('Theo Nghị định 75/2023/NĐ-CP, mức hưởng bảo hiểm y tế khi chuyển tuyến')
    primary = [row('r1', host='vanban.chinhphu.vn', tier=1, excerpt=body)]
    assert 'research-claim-single-source' not in codes(primary)
    secondary_pair = [row('r1', host='dantri.com.vn', tier=2, excerpt=body),
                      row('r2', host='vnexpress.net', tier=2,
                          excerpt=long_text('Cùng nội dung về mức hưởng bảo hiểm y tế nhưng diễn đạt khác'),
                          origin='baochinhphu.vn')]
    assert research_ledger.independent_count(secondary_pair) == 2
    assert 'research-claim-single-source' not in codes(secondary_pair)


def test_a_key_claim_backed_by_one_secondary_unit_is_flagged():
    body = long_text('Theo Nghị định 75/2023/NĐ-CP, mức hưởng bảo hiểm y tế khi chuyển tuyến')
    rows = [row('r1', host='dantri.com.vn', tier=2, excerpt=body)]
    issues = {(issue.code, issue.detail) for issue in research_ledger.assess_rows(rows)}
    assert any(code == 'research-claim-single-source' for code, _ in issues)
    assert any('tầng 2' in detail for _, detail in issues)


def test_a_verified_failure_on_a_secondary_source_is_flagged():
    body = long_text('Một khẳng định có mở lại nhưng nội dung đã đổi mất một nửa')
    rows = [row('r1', host='dantri.com.vn', tier=2, excerpt=body)]
    assert 'research-doc-pointer-missing' in codes(rows, verified={'r1': False})
    assert 'research-doc-pointer-missing' not in codes(rows, verified={'r1': True})
    # Nguồn chính thống mở lại hỏng KHÔNG bị chấm: thiếu bản gốc là chuyện của bản chính thống.
    primary = [row('r1', host='vanban.chinhphu.vn', tier=1, excerpt=body)]
    assert 'research-doc-pointer-missing' not in codes(primary, verified={'r1': False})


def test_a_host_document_that_is_not_marked_is_flagged():
    rows = [row('r1', excerpt=long_text('Tài liệu chủ nhà cấp về chi phí'), payload={'hostDoc': True})]
    assert 'research-host-doc-unmarked' in codes(rows)
    marked = [row('r1', excerpt=long_text('Tài liệu chủ nhà cấp về chi phí'), type='host-doc',
                  payload={'hostDoc': True})]
    assert 'research-host-doc-unmarked' not in codes(marked)


def test_the_gap_verdict_stays_a_signal_under_the_floor():
    thin = [row(f'r{i}', host='a.vn', excerpt=long_text('dòng')) for i in range(1, 6)]
    verdict = research_ledger.gap_verdict(thin)
    assert verdict['checked'] is False
    assert verdict['label'] == research_ledger.GAP_SIGNAL_LABEL
    assert verdict['floor']['rows'] == research_ledger.GAP_FLOOR_ROWS
    deep = [row(f'r{i}', host=f'{i}.vn', excerpt=long_text('dòng')) for i in range(1, 25)]
    assert research_ledger.gap_verdict(deep)['checked'] is True


def test_a_confirmation_row_needs_to_point_at_the_row_it_confirms():
    body = long_text('Trang xã hội chính thức của Bộ Y tế đăng thông tin về chuyển tuyến')
    rows = [row('r1', host='facebook.com', tier=1, type='official-social', excerpt=body),
            row('r2', host='moh.gov.vn', tier=1, type='confirm', excerpt=long_text('bản xác nhận khác chữ'),
                source_row_id='r1')]
    assert research_ledger.is_confirmed(rows[0], rows) is True
    # Bản xác nhận không trỏ dòng nào và không trùng vân tay ⇒ dòng kia vẫn "chưa xác nhận".
    lonely = [rows[0], row('r3', host='moh.gov.vn', tier=1, type='confirm',
                           excerpt=long_text('một bản xác nhận không liên quan'))]
    assert research_ledger.is_confirmed(lonely[0], lonely) is False
    assert 'research-social-unconfirmed' in codes(lonely)
    assert 'research-social-unconfirmed' not in codes(rows)
