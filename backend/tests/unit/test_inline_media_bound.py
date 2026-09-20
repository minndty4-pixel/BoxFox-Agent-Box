"""Đường CUA nặng chết vì thân request vượt trần 1 MiB của router.

Đo sống 2026-09-20 (vòng kiểm chứng độc lập đợt 10, ca T21): một nhiệm vụ nặng mà mô hình
tự chọn chụp màn hình giữa các bước làm thân request phình lên 1 107 315 ký tự, trong đó
**1 018 908 ký tự là ảnh base64** (mỗi ảnh 77-104 KB), và mọi lượt gọi sau đó chết với
`UPSTREAM_HTTP_413: Request is too large.` — router cắt thân ở 1 MiB
(`router/src/server.mjs`), còn `ContextCompressor` chỉ đếm token nên không bao giờ thấy.

Cách sửa: giữ ảnh của các lần chụp MỚI NHẤT trong thân request, các ảnh cũ rút về phần chữ
đi kèm (đường dẫn tệp vẫn nằm trong đó). Bản lưu trong store — và do đó giao diện chat —
không bị đụng tới.
"""
import copy
import json

from agentbox.agent_core import runtime as runtime_module
from agentbox.agent_core.runtime import MAX_INLINE_MEDIA_BYTES, bound_inline_media


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
