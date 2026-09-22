"""Dải mục tiêu của ngưỡng nén (Phần D đợt 20): không nén quá sớm, cũng không để phiên dài vô hạn.

Bối cảnh đo được 2026-09-21: máy Vorflux gộp mỗi lần 65–185k token, còn box có phiên khai tay
32 768 nén ở 20 070 token ("cụt ngủn") và cửa sổ 1M chỉ bị trần byte 301 200 chặn. Ba hằng số mới
nằm ở `agent_core/limits.py`; bài ở đây ghim đúng bảng trong kế hoạch, gồm cả các hành vi KHÔNG đổi.
"""
import json

from agentbox.agent_core.compression import ContextCompressor
from agentbox.agent_core.limits import (COMPRESSION_MAX_TOKENS, COMPRESSION_MIN_ROOM,
                                        COMPRESSION_MIN_TOKENS, ROUTER_BODY_BUDGET,
                                        ROUTER_BODY_OVERHEAD_TOKENS)

BODY_CEILING_TOKENS = ROUTER_BODY_BUDGET // 3 - ROUTER_BODY_OVERHEAD_TOKENS


def _ratio_threshold(window, percent=0.7):
    reserve = min(4096, window // 4)
    return int((window - reserve) * percent)


def test_the_band_keeps_every_window_up_to_128k_exactly_as_before():
    """Không đổi hành vi cho mọi cửa sổ đang dùng: 8 192 / 16 384 / 32 768 / 128 000.

    Sàn chỉ áp khi `budget >= COMPRESSION_MIN_ROOM`, nên bốn cửa sổ này giữ nguyên con số 70 % —
    đây là điều kiện để việc sửa ngưỡng không kéo theo một đợt kiểm thử lại toàn bộ.
    """
    assert COMPRESSION_MIN_ROOM > 32_768 - 4096, 'cửa sổ 32k phải nằm dưới ngưỡng áp sàn'
    for window in (8_192, 16_384, 32_768, 128_000):
        assert ContextCompressor(window).threshold == _ratio_threshold(window), window


def test_the_cap_shortens_a_million_token_window():
    """Cửa sổ 1M: trần dải mục tiêu thay trần byte — 301 200 → 200 000 (gộp sớm hơn 1,5 lần)."""
    compressor = ContextCompressor(1_000_000)
    assert compressor.threshold == COMPRESSION_MAX_TOKENS == 200_000
    assert compressor.threshold < BODY_CEILING_TOKENS < compressor.percent_threshold
    assert COMPRESSION_MAX_TOKENS < BODY_CEILING_TOKENS, 'trần dải phải chặt hơn trần byte'


def test_the_floor_lifts_a_window_that_would_fold_too_early(monkeypatch):
    """Khi cửa sổ đủ chỗ, sàn 32 000 giữ ngưỡng khỏi rơi xuống dưới mức đó.

    Ca này cần một cửa sổ mà tỉ lệ 70 % cho ra số nhỏ hơn sàn nhưng `budget` vẫn ≥ `MIN_ROOM`:
    cửa sổ 64 000 → 0,7 × (64 000 − 4 096) = 41 932 (trên sàn, không đổi) — nên phải hạ tỉ lệ để
    thấy sàn làm việc, đúng cách một người chạy phiên đặt `threshold_percent` thấp.
    """
    window = 64_000
    assert ContextCompressor(window, threshold_percent=0.2).threshold == COMPRESSION_MIN_TOKENS
    # Và sàn không bao giờ vượt quá chỗ thật của một lượt.
    assert ContextCompressor(window, threshold_percent=0.2).threshold < window - 4096
    # Cửa sổ nhỏ hơn MIN_ROOM thì sàn không áp, kể cả khi tỉ lệ bị hạ.
    assert ContextCompressor(32_768, threshold_percent=0.2).threshold == int((32_768 - 4096) * 0.2)


def test_the_threshold_never_exceeds_the_room_a_turn_has():
    """Ngưỡng phải luôn nằm dưới `budget`, nếu không thì không bao giờ nén và phiên chết ở trần."""
    for window in (8_192, 32_768, 64_000, 128_000, 1_000_000):
        compressor = ContextCompressor(window)
        assert 0 < compressor.threshold < compressor.budget, window
        assert compressor.threshold * 3 <= ROUTER_BODY_BUDGET, window


def test_a_model_threshold_still_wins_inside_the_band():
    """Ngưỡng tuyệt đối của model vẫn là thứ được ưu tiên, miễn là nằm trong dải."""
    assert ContextCompressor(1_000_000, threshold_tokens=150_000).threshold == 150_000
    # Sàn chỉ áp cho ngưỡng suy ra từ tỉ lệ: số tuyệt đối của model là số của người chạy phiên,
    # kể cả khi nó thấp hơn sàn (ví dụ để thử bộ nén trên cửa sổ lớn).
    assert ContextCompressor(1_000_000, threshold_tokens=10_000).threshold == 10_000
    assert ContextCompressor(128_000, threshold_tokens=10_000).threshold == 10_000
    assert ContextCompressor(1_000_000, threshold_tokens=900_000).threshold == COMPRESSION_MAX_TOKENS, \
        'trần dải vẫn áp cho cả số của model'


def test_the_band_numbers_are_the_ones_the_plan_promised():
    """Ba hằng số là dữ liệu công khai của đợt này — đổi chúng là đổi hợp đồng với chủ dự án."""
    assert (COMPRESSION_MIN_TOKENS, COMPRESSION_MAX_TOKENS, COMPRESSION_MIN_ROOM) == (32_000, 200_000, 40_000)
