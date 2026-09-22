"""N3 — sàn cửa sổ ngữ cảnh và ngưỡng nén đi kèm (đợt 20).

Vì sao có bài này: hai dòng `nemotron-*-free` của OpenCode không công bố cửa sổ
(router trả `null`), nên mọi lượt chạy trên chúng rơi về sàn của harness — và sàn cũ
128 000 khiến `compact()` gộp ở **86 732** token trong khi chính router đọc được
1 000 000 cho hai bản `:free` cùng model trên OpenRouter. Sàn mới **256 000** đổi
ngưỡng thành 176 332 (vẫn bị `COMPRESSION_MAX_TOKENS` = 200 000 chặn trên); khi
router khai được cửa sổ (bảng tên), ngưỡng là 200 000.

Bài này đo CẢ BA tầng: số của sàn, nhãn nguồn (`fallback`, không giả `documented`),
và ngưỡng nén thật mà `compression.ContextCompressor` tính ra từ cửa sổ đó.
"""
from __future__ import annotations

from agentbox.agent_core.compression import ContextCompressor
from agentbox.agent_core.limits import COMPRESSION_MAX_TOKENS
from agentbox.agent_core.runtime import FALLBACK_CONTEXT_WINDOW, resolve_context_window


def test_the_fallback_floor_is_256000_and_keeps_its_label():
    """Sàn là con số CÓ NHÃN: không có nguồn nào trả lời thì vẫn phải nói `fallback`."""
    assert FALLBACK_CONTEXT_WINDOW == 256_000
    assert resolve_context_window('nemotron-3-ultra-free', None, None) == (256_000, 'fallback')
    assert resolve_context_window('nemotron-3.5-lightning-free', None, {'contextWindow': None}) == (
        256_000, 'fallback')


def test_a_declared_window_still_wins_over_the_floor_and_keeps_its_label():
    """Bảng tên của router khai 1 000 000 → nguồn là `documented`, không phải `fallback`."""
    assert resolve_context_window('nemotron-3-ultra-free', None, {
        'contextWindow': 1_000_000, 'contextWindowSource': 'documented'}) == (1_000_000, 'documented')


def test_the_compaction_threshold_moves_with_the_floor_but_never_past_the_cap():
    """Ngưỡng nén theo cửa sổ: sàn cũ 86 732 → sàn mới 176 332 → cửa sổ 1M chặn ở 200 000."""
    floor = ContextCompressor(context_window=FALLBACK_CONTEXT_WINDOW).threshold
    assert floor == 176_332, 'ngưỡng của sàn mới (256 000 − 4 096) × 0,7'
    old_floor = ContextCompressor(context_window=128_000).threshold
    assert old_floor == 86_732, 'ngưỡng cũ, giữ làm mốc so sánh'
    assert floor > old_floor

    declared = ContextCompressor(context_window=1_000_000).threshold
    assert declared == COMPRESSION_MAX_TOKENS == 200_000, 'cửa sổ lớn gộp ở trần 200 000'
    assert declared < 1_000_000 - 4_096, 'và trần này vẫn thấp hơn hẳn cửa sổ khai'


def test_the_byte_ceiling_still_cannot_raise_the_threshold():
    """Trần byte 301 200 không bao giờ NÂNG ngưỡng lên — chỉ có thể hạ."""
    for window in (8_192, 32_768, 128_000, 256_000, 1_000_000):
        threshold = ContextCompressor(context_window=window).threshold
        assert threshold <= min(COMPRESSION_MAX_TOKENS, 301_200)
        assert threshold <= window - 1
