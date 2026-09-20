"""Đường CUA nặng chết vì thân request vượt trần 1 MiB của router.

Đo sống 2026-09-20 (vòng kiểm chứng độc lập đợt 10, ca T21): một nhiệm vụ nặng mà mô hình
tự chọn chụp màn hình giữa các bước làm thân request phình lên 1 107 315 ký tự, trong đó
**1 018 908 ký tự là ảnh base64** (mỗi ảnh 77-104 KB), và mọi lượt gọi sau đó chết với
`UPSTREAM_HTTP_413: Request is too large.` — router cắt thân ở 1 MiB
(`router/src/server.mjs`), còn `ContextCompressor` chỉ đếm token nên không bao giờ thấy.

Cách sửa: giữ ảnh của các lần chụp MỚI NHẤT trong thân request, các ảnh cũ rút về phần chữ
đi kèm (đường dẫn tệp vẫn nằm trong đó). Bản lưu trong store — và do đó giao diện chat —
không bị đụng tới.

Vòng kiểm chứng thứ hai đo lại sau bản sửa đó: thân request còn **1 017 382 B, vẫn quá trần
17 382 B**, vì phần lớn nhất còn lại là chữ ký suy luận bị ghi **hai lần**
(`thought_signature` + `thoughtSignature`, tổng 761 888 B) — không đường nào cắt nó. Nên có
thêm `dedupe_thought_signatures()`: thân request chỉ mang một cách viết, bản lưu giữ nguyên.
"""
import copy
import json

from agentbox.agent_core import runtime as runtime_module
from agentbox.agent_core.runtime import (MAX_INLINE_MEDIA_BYTES, ROUTER_BODY_BUDGET,
                                         bound_inline_media, dedupe_thought_signatures,
                                         request_body_bytes, shrink_request_to_budget)


def _capture(index: int, payload: int) -> dict:
    """Một thông điệp `tool` đúng hình dạng `runtime` dựng cho `computer_screen_capture`."""
    return {
        'role': 'tool',
        'tool_call_id': f'call_{index}',
        'name': 'computer_screen_capture',
        'content': [
            {'type': 'text', 'text': json.dumps({'path': f'/tmp/shot_{index}.png', 'width': 1280})},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + ('A' * payload)}},
        ],
    }


def test_messages_without_media_are_returned_untouched():
    messages = [{'role': 'user', 'content': 'xin chào'}, {'role': 'tool', 'content': '{"ok": true}'}]
    returned, dropped = bound_inline_media(messages)
    assert dropped == 0 and returned is messages


def test_only_the_newest_captures_stay_inline():
    messages = [_capture(index, 200) for index in range(5)]
    bounded, dropped = bound_inline_media(messages)
    assert dropped == 3
    inline = [m for m in bounded if isinstance(m['content'], list)]
    assert [m['tool_call_id'] for m in inline] == ['call_3', 'call_4']
    older = [m for m in bounded if isinstance(m['content'], str)]
    assert [m['tool_call_id'] for m in older] == ['call_0', 'call_1', 'call_2']
    assert '/tmp/shot_1.png' in older[1]['content'], 'đường dẫn tệp phải ở lại trong phần chữ'
    assert 'left out of this request' in older[1]['content']
    assert 'base64' not in older[1]['content']


def test_the_stored_transcript_keeps_every_image():
    """Bản lưu phải nguyên vẹn: giao diện chat đọc chính danh sách đó."""
    messages = [_capture(index, 200) for index in range(5)]
    before = copy.deepcopy(messages)
    bound_inline_media(messages)
    assert messages == before, 'danh sách gốc không được sửa'


def test_the_bytes_budget_wins_over_the_count_budget():
    """Hai ảnh 300 KB vượt 512 KB, nên chỉ ảnh mới nhất được giữ."""
    messages = [_capture(index, 300 * 1024) for index in range(3)]
    bounded, dropped = bound_inline_media(messages)
    assert dropped == 2
    assert [m['tool_call_id'] for m in bounded if isinstance(m['content'], list)] == ['call_2']


def test_a_long_mission_stays_under_the_router_cap():
    """Ca thật của T21: 12 ảnh 90 KB — thân request phải nhỏ hơn 1 MiB."""
    messages = [_capture(index, 90 * 1024) for index in range(12)]
    before = len(json.dumps(messages, ensure_ascii=False).encode('utf-8'))
    bounded, dropped = bound_inline_media(messages)
    after = len(json.dumps(bounded, ensure_ascii=False).encode('utf-8'))
    assert before > 1048576, 'kịch bản phải tái hiện được thân request quá trần'
    assert after < 1048576 and dropped == 10


def test_the_bound_is_applied_on_the_way_to_the_router():
    """`RouterClient.complete` là nơi duy nhất dựng thân request, nên chốt chặn nằm ở đó."""
    source = (runtime_module.__file__)
    with open(source, encoding='utf-8') as handle:
        text = handle.read()
    assert 'messages, dropped = bound_inline_media(messages)' in text
    assert text.index('bound_inline_media(messages)') < text.index("json={**route, 'messages': messages")
    assert 'model.media_pruned' in text


# --------------------------------------------------- chữ ký suy luận bị ghi hai lần

def _assistant_with_signature(index: int, size: int) -> dict:
    """Thông điệp `assistant` mang chữ ký suy luận — cả hai cách viết, như `runtime` lưu."""
    signature = 'S' * size
    return {
        'role': 'assistant',
        'content': None,
        'tool_calls': [{
            'id': f'call_{index}',
            'type': 'function',
            'function': {'name': 'computer_screen_capture', 'arguments': '{"x": 10}'},
            'thought_signature': signature,
            'thoughtSignature': signature,
        }],
    }


def test_a_thought_signature_is_sent_once():
    messages = [_assistant_with_signature(0, 4096)]
    deduped, saved = dedupe_thought_signatures(messages)
    assert saved == 4096
    call = deduped[0]['tool_calls'][0]
    assert 'thoughtSignature' not in call and call['thought_signature'] == 'S' * 4096
    assert messages[0]['tool_calls'][0]['thoughtSignature'] == 'S' * 4096, 'bản lưu không đổi'


def test_messages_without_signatures_are_returned_untouched():
    messages = [{'role': 'user', 'content': 'xin chào'}, _capture(0, 10)]
    returned, saved = dedupe_thought_signatures(messages)
    assert saved == 0 and returned is messages


def test_a_long_mission_body_fits_after_both_passes():
    """Ca của vòng kiểm chứng: ảnh base64 + chữ ký ghi hai lần làm thân vượt trần 1 MiB."""
    messages = []
    for index in range(6):
        messages.append(_assistant_with_signature(index, 120 * 1024))
        messages.append(_capture(index, 90 * 1024))
    before = len(json.dumps(messages, ensure_ascii=False).encode('utf-8'))
    bounded, dropped = bound_inline_media(messages)
    bounded, saved = dedupe_thought_signatures(bounded)
    after = len(json.dumps(bounded, ensure_ascii=False).encode('utf-8'))
    assert before > 1048576 and after < 1048576, (before, after)
    assert dropped == 4 and saved == 6 * 120 * 1024


# --------------------------------------------------- trần BYTE cuối cùng của thân request

def test_a_body_under_the_budget_is_returned_untouched():
    messages = [{'role': 'user', 'content': 'xin chào'}, {'role': 'assistant', 'content': 'chào bạn'}]
    returned, freed = shrink_request_to_budget(messages)
    assert freed == 0 and returned is messages


def test_the_byte_budget_trims_the_oldest_text_first():
    """Trần token không bắt được trần byte: model 1M token vẫn vượt 1 MiB thân request.

    Đo trên phiên thật của vòng kiểm chứng: `assistant` văn bản dài 416 891 B là phần lớn nhất
    còn lại sau khi đã bó ảnh và bỏ chữ ký trùng — không lượt nén nào chạm tới vì ngưỡng là token.
    """
    messages = [
        {'role': 'user', 'content': 'nhiệm vụ'},
        {'role': 'assistant', 'content': 'A' * 600_000},
        {'role': 'tool', 'name': 'terminal_exec', 'content': 'B' * 400_000},
        {'role': 'assistant', 'content': 'C' * 200_000},
        {'role': 'user', 'content': 'tiếp tục'},
        {'role': 'assistant', 'content': 'mới nhất, không được đụng'},
    ]
    assert request_body_bytes(messages) > ROUTER_BODY_BUDGET
    trimmed, freed = shrink_request_to_budget(messages)
    assert freed > 0 and request_body_bytes(trimmed) <= ROUTER_BODY_BUDGET
    assert trimmed[1]['content'].startswith('A' * 1000) and 'trimmed so the request body fits' in trimmed[1]['content']
    assert trimmed[5]['content'] == 'mới nhất, không được đụng', 'bước mới nhất phải nguyên vẹn'
    assert messages[1]['content'] == 'A' * 600_000, 'bản lưu không được sửa'


def test_a_huge_single_old_message_still_leaves_a_hard_failure_to_the_caller():
    """Không cắt được gì (mọi thứ đều là bước hiện tại) thì trả nguyên trạng, không nuốt lỗi."""
    messages = [{'role': 'user', 'content': 'x' * (2 * 1024 * 1024)}]
    returned, freed = shrink_request_to_budget(messages)
    assert freed == 0 and request_body_bytes(returned) > ROUTER_BODY_BUDGET
