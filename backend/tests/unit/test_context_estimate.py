"""Ước lượng ngữ cảnh phải đếm **ảnh** theo token ảnh, không theo độ dài base64.

Đo sống 2026-09-20 trên nhiệm vụ CUA nặng 30 bước (phiên `08f2483c`): `estimate_tokens` trả
**1 051 631** token cho một transcript mà router chỉ báo **358 771** token đầu vào cho cùng
request — vì toàn bộ ảnh base64 bị tính như chữ. Hệ quả không chỉ là con số sai: `before` vượt
`context_window - output_reserve` nên khi lượt tóm tắt thất bại (nhà cung cấp trả 429/90 giây),
bộ nén đi vào đúng nhánh duy nhất làm chết cả lượt — `CONTEXT_LIMIT: summary failed`.
"""
import json

from agentbox.agent_core.compression import IMAGE_TOKEN_ALLOWANCE, estimate_tokens


def _capture(payload: int) -> dict:
    return {
        'role': 'tool',
        'tool_call_id': 'call_0',
        'name': 'computer_screen_capture',
        'content': [
            {'type': 'text', 'text': '{"path": "/tmp/shot.png", "width": 1280}'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + 'A' * payload}},
        ],
    }


def test_an_inline_capture_counts_as_image_tokens():
    messages = [{'role': 'user', 'content': 'nhiệm vụ'}, _capture(400_000)]
    raw = (len(json.dumps(messages, ensure_ascii=False).encode('utf-8')) + 2) // 3
    estimated = estimate_tokens(messages)
    assert estimated < raw / 10, (estimated, raw)
    assert estimated <= 4000, 'phần còn lại chỉ là chữ ngắn cộng một khoản ảnh'


def test_the_allowance_is_the_only_thing_that_grows_with_the_capture():
    small = estimate_tokens([_capture(1000)])
    large = estimate_tokens([_capture(400_000)])
    assert abs(large - small) < 100, 'ảnh to hơn không được kéo ước lượng lên'


def test_a_transcript_without_images_keeps_the_old_estimate():
    messages = [
        {'role': 'user', 'content': 'xin chào'},
        {'role': 'assistant', 'content': 'chào bạn', 'thought': 'nghĩ'},
        {'role': 'tool', 'name': 'terminal_exec', 'content': '{"ok": true}'},
    ]
    tools = [{'type': 'function', 'function': {'name': 'terminal_exec'}}]
    raw = (len(json.dumps([messages, tools], ensure_ascii=False).encode('utf-8')) + 2) // 3
    assert estimate_tokens(messages, tools) == raw


def test_the_estimate_stays_a_list_of_the_same_length():
    messages = [_capture(1000), {'role': 'user', 'content': 'tiếp'}]
    assert isinstance(estimate_tokens(messages), int)
    assert IMAGE_TOKEN_ALLOWANCE > 0
