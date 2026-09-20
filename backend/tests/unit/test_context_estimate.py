"""Ước lượng ngữ cảnh phải đếm **ảnh** theo token ảnh, không theo độ dài base64.

Đo sống 2026-09-20 trên nhiệm vụ CUA nặng 30 bước (phiên `08f2483c`): `estimate_tokens` trả
**1 051 631** token cho một transcript mà router chỉ báo **358 771** token đầu vào cho cùng
request — vì toàn bộ ảnh base64 bị tính như chữ. Hệ quả không chỉ là con số sai: `before` vượt
`context_window - output_reserve` nên khi lượt tóm tắt thất bại (nhà cung cấp trả 429/90 giây),
bộ nén đi vào đúng nhánh duy nhất làm chết cả lượt — `CONTEXT_LIMIT: summary failed`.
"""
import asyncio
import json

from agentbox.agent_core.compression import (IMAGE_TOKEN_ALLOWANCE, ContextCompressor, estimate_tokens,
                                               summarizer_material)


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


# ------------------------------------------- nén một nhiệm vụ chỉ có MỘT lời nhắc

def _mission(steps: int, payload: int = 40 * 1024) -> list:
    messages = [{'role': 'system', 'content': 'vai gốc'}, {'role': 'user', 'content': 'nhiệm vụ CUA'}]
    for step in range(steps):
        messages.append({'role': 'assistant', 'content': None, 'thought': 'T' * 2000, 'tool_calls': [
            {'id': f'call_{step}', 'type': 'function',
             'function': {'name': 'computer_screen_capture', 'arguments': '{"x": 1}'},
             'thought_signature': 'S' * payload, 'thoughtSignature': 'S' * payload}]})
        messages.append(_capture(payload))
    return messages


def test_a_one_prompt_mission_is_summarized_instead_of_failing():
    """Ca `08f2483c`/`9ec9bf1d`: một lời nhắc, lịch sử vượt cửa sổ, không có lượt cũ nào để nén."""
    messages = _mission(20, payload=4096)
    seen = {}

    async def summary(history):
        seen['history'] = history
        return {'choices': [{'message': {'content': 'Goal: CUA. Evidence: many captures.'}, 'finish_reason': 'stop'}]}

    async def run():
        return await ContextCompressor(40_000, output_reserve=4096).compact(messages, [], summary)

    result, event = asyncio.run(run())
    assert event and event['kind'] == 'summary', event
    assert result[0] == messages[0], 'tiền tố hệ thống giữ nguyên'
    assert result[1]['content'].startswith('[Context compaction'), 'lịch sử giữa nhiệm vụ được gộp'
    assert result[-1] == messages[-1], 'đuôi đang chạy giữ nguyên'
    assert 'computer_screen_capture' in json.dumps(result[-4:]), 'các bước mới nhất còn nguyên'


def test_the_summary_input_is_thin_and_bounded():
    """Đầu vào cho lượt tóm tắt không được mang ảnh base64 hay chữ ký: nhà cung cấp đã trả 90 giây."""
    material = summarizer_material(_mission(30))
    blob = json.dumps(material, ensure_ascii=False)
    assert len(blob) <= 120_000, len(blob)
    assert 'base64' not in blob and 'thought_signature' not in blob
    assert '[inline capture left out of the summary input]' in blob, 'vẫn nói rõ có ảnh ở đó'
    assert 'call_29' in blob, 'bước mới nhất vẫn nằm trong mẫu'


def test_a_short_history_reaches_the_summarizer_intact():
    messages = [{'role': 'user', 'content': 'a'}, {'role': 'assistant', 'content': 'b'},
                {'role': 'user', 'content': 'c'}]
    material = summarizer_material(messages)
    assert [m['content'] for m in material] == ['a', 'b', 'c']


def test_pruning_an_old_capture_keeps_its_text_and_drops_the_image():
    """Bản cũ của phép tỉa coi `str(content)` của ảnh là "kết quả công cụ dài" và cắt nát chính
    ảnh mới nhất — thứ mô hình đang nhìn."""
    messages = _mission(20, payload=4096)
    messages[-1]['content'][0]['text'] = '{"path": "/tmp/last.png", "width": 1280}'

    async def summary(history):
        return {'choices': [{'message': {'content': 'Goal: CUA. Evidence: captures.'}, 'finish_reason': 'stop'}]}

    async def run():
        return await ContextCompressor(40_000, output_reserve=4096).compact(messages, [], summary)

    result, event = asyncio.run(run())
    assert event and event['kind'] == 'summary'
    assert result[-1] == messages[-1], 'bước đang chạy không bị đụng'
    assert '/tmp/last.png' in json.dumps(result[-1])
    assert 'base64' in json.dumps(result[-1]), 'ảnh mới nhất vẫn còn nguyên'


def test_a_duplicated_reasoning_signature_is_counted_once():
    """Bản lưu giữ cùng một chữ ký dưới hai tên; router chỉ nhận một bản, nên ước lượng cũng vậy."""
    messages = _mission(6, payload=20_000)
    doubled = estimate_tokens(messages)
    single = [{**m, 'tool_calls': [{k: v for k, v in call.items() if k != 'thoughtSignature'}
                                  for call in m['tool_calls']]} if m.get('tool_calls') else m
              for m in messages]
    assert doubled == estimate_tokens(single), 'hai tên cho một giá trị không được đếm hai lần'


def test_a_transcript_without_signatures_is_counted_as_before():
    messages = [{'role': 'user', 'content': 'x' * 300}, {'role': 'assistant', 'content': 'y' * 300}]
    expected = (len(json.dumps([messages, []], ensure_ascii=False).encode('utf-8')) + 2) // 3
    assert estimate_tokens(messages) == expected
