"""Giàn probe tầng HARNESS cho vòng khoá (vòng 29 đợt 4, mục 3.3 của plan).

Vòng khoá sống **trong router** (`router/**`, ghim bằng bộ `node --test` của chính nó). Tầng này
ghim điều mà harness phải chịu được, và nó chạy hoàn toàn trong tiến trình — một `aiohttp`
`TestServer` đóng vai router, không mở socket ra Internet, không gọi nhà cung cấp nào:

* **Xoay khoá xảy ra ở TRONG router ⇒ harness không phải biết.** Router giả thử ba khoá cho CHÍNH
  một request (hai lần 429 rồi một lần 200) và trả về một kênh SSE bình thường; harness thấy **một**
  lời gọi HTTP, một câu trả lời, không thử lại, không mang thông tin khoá nào ra ngoài.
* **Hết sạch khoá ⇒ MỘT lỗi tạm thời, không treo.** Router giả trả 429 cho mọi lần thử; harness thấy
  `Router HTTP 429` với mã `RATE_LIMIT`, `failures.retry_advice` xếp nó vào loại thử lại được có
  chặn (`rate-limit`, có `Retry-After`, trần số lần), và lời gọi trả về ngay chứ không quay vòng.

Điều giàn này **KHÔNG** chứng minh — đừng nói quá: nhà cung cấp thật có cắt lượt ở phút 8,5–14 như
đo được không; một lượt mức 2 có kịp đóng hồ sơ trên khoá thật không; hạn mức theo phiên của
provider miễn phí có luật gì. Ba câu đó chỉ lượt sống trả lời (`docs/handoff/research-verification.md`).
"""
from __future__ import annotations

import asyncio
import json
import time

import pytest

from agentbox.agent_core.failures import classify_failure, retry_advice
from agentbox.agent_core.runtime import RouterClient

#: Nhãn khoá, KHÔNG phải giá trị khoá: probe chỉ nói "khoá thứ mấy", không bao giờ có bí mật nào.
KEY_LABELS = ('key 1', 'key 2', 'key 3')


def sse(frames):
    """Kênh SSE như router thật trả: các `data:` JSON rồi `data: [DONE]`."""
    body = ''.join(f'data: {json.dumps(frame)}\n\n' for frame in frames)
    return body + 'data: [DONE]\n\n'


def text_frame(text, *, chunk_id='resp_keyring', finish=None):
    return {'id': chunk_id, 'choices': [{'index': 0, 'delta': {'content': text},
                                         'finish_reason': finish}]}


def test_a_rotation_inside_the_router_is_invisible_to_the_harness():
    """Ba khoá trong MỘT connection: router tự xoay, harness chỉ thấy 200 — không phải sửa gì.

    Đây là lý do vòng khoá đổi đúng chỗ: khi harness ghim `connectionId`, router chỉ dựng một đích
    (`router/src/engine.mjs`), nên "một connection = một khoá = một phát" là đường chết của vòng 27.
    """
    from aiohttp import web
    from aiohttp.test_utils import TestServer

    async def run():
        seen = []
        ring_log = []
        #: Vòng khoá giả của MỘT connection: khoá 1 và 2 bị hạn mức, khoá 3 trả lời.
        ring_outcomes = ((KEY_LABELS[0], 429), (KEY_LABELS[1], 429), (KEY_LABELS[2], 200))

        async def upstream(request):
            body = await request.json()
            seen.append(body)
            # Router giả xoay khoá Ở TRONG, trong cùng MỘT request HTTP. Hai lần 429 ấy không bao
            # giờ tới harness — đó chính là điều phép kiểm này ghim.
            for label, status in ring_outcomes:
                ring_log.append((label, status))
            return web.Response(body=sse([text_frame('Hồ sơ mở bằng khoá thứ ba.'), text_frame('', finish='stop')]),
                                content_type='text/event-stream')

        router = web.Application()
        router.router.add_post('/api/router/chat', upstream)
        async with TestServer(router) as router_server:
            client = RouterClient(str(router_server.make_url('')).rstrip('/'))
            route = {'connectionId': 'f8a5f4e8-0986-45f9-bf5b-555e8b96a95c', 'modelId': 'muse-spark-1.3-contributor-free'}
            answer = await client.complete([{'role': 'user', 'content': 'mở hồ sơ mức 2'}], [], route)

        assert answer['choices'][0]['message']['content'] == 'Hồ sơ mở bằng khoá thứ ba.'
        assert answer['choices'][0]['finish_reason'] == 'stop'
        assert ring_log == list(ring_outcomes), 'router giả phải THỬ cả ba khoá cho một request'
        assert len(seen) == 1, 'xoay khoá ở trong router ⇒ harness chỉ gọi HTTP MỘT lần, không thử lại'
        assert seen[0]['connectionId'] == route['connectionId'], 'route ghim connection đi nguyên vẹn'
        assert seen[0]['stream'] is True
        assert not [name for name in seen[0] if 'key' in name.lower()], \
            'request của harness không được mang thông tin khoá ra ngoài router'

    asyncio.run(run())


def test_a_ring_that_is_429_all_the_way_is_one_bounded_temporary_failure():
    """Hết sạch khoá ⇒ harness thấy lỗi TẠM THỜI (không phải lỗi hình dạng), và không treo.

    Lượt chết ở đây là kết cục đúng của "hết hạn mức cả vòng khoá": một mã đọc được
    (`UPSTREAM_HTTP_429`), một câu khuyên thử lại CÓ CHẶN (`failures.retry_advice`), không quay vòng
    vô hạn và không tự xoay khoá ở tầng harness.
    """
    from aiohttp import web
    from aiohttp.test_utils import TestServer

    async def run():
        calls = []

        async def upstream(request):
            await request.json()
            calls.append(1)
            return web.json_response({'error': {'message': 'every key in the ring is rate limited',
                                                'code': 'RATE_LIMIT', 'retryable': True,
                                                'retryAfterMs': 1500}}, status=429)

        router = web.Application()
        router.router.add_post('/api/router/chat', upstream)
        async with TestServer(router) as router_server:
            client = RouterClient(str(router_server.make_url('')).rstrip('/'))
            started = time.monotonic()
            with pytest.raises(RuntimeError) as caught:
                await client.complete([{'role': 'user', 'content': 'mở hồ sơ mức 2'}], [],
                                      {'connectionId': 'f8a5f4e8-0986-45f9-bf5b-555e8b96a95c'})
            elapsed = time.monotonic() - started

        refusal = caught.value
        assert refusal.router_status == 429
        assert refusal.router_code == 'RATE_LIMIT'
        assert elapsed < 10, f'lời gọi phải trả về ngay, không treo (mất {elapsed:.2f}s)'
        assert len(calls) == 1, 'một lời gọi HTTP, một phán quyết — tầng harness không tự xoay khoá'
        code, _message = classify_failure(refusal)
        assert code == 'UPSTREAM_HTTP_429', code
        advice = retry_advice(refusal, attempt=0, remaining_seconds=600)
        assert advice is not None and advice['reason'] == 'rate-limit'
        assert 2.0 <= advice['delay'] <= 30.0, f"trần chờ của loại rate-limit là [2, 30]s: {advice['delay']}"
        assert retry_advice(refusal, attempt=0, remaining_seconds=3.0) is None, \
            'không đủ cửa sổ thử lại (MIN_RETRY_WINDOW_SECONDS) ⇒ báo, đừng ngủ vào hạn chót'
        assert retry_advice(refusal, attempt=3, remaining_seconds=600) is None, \
            'hết số lần thử ⇒ dừng, không quay vòng vô hạn'

    asyncio.run(run())
