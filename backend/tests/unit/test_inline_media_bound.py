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
from agentbox.agent_core.roles import ORCHESTRATOR_TOOLS
from agentbox.agent_core.tool_contracts import schemas_for
from agentbox.agent_core.runtime import (MAX_INLINE_MEDIA_BYTES, ROUTER_BODY_BUDGET, TRIMMED_ARGUMENTS,
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
    body = {'modelId': 'x', 'tools': [], 'max_tokens': 4096}
    messages = [{'role': 'user', 'content': 'xin chào'}, {'role': 'assistant', 'content': 'chào bạn'}]
    returned, freed, phase = shrink_request_to_budget(body, messages)
    assert freed == 0 and phase == '' and returned is messages


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
    body = {'modelId': 'x', 'tools': [], 'max_tokens': 4096}
    assert request_body_bytes({**body, 'messages': messages}) > ROUTER_BODY_BUDGET
    trimmed, freed, phase = shrink_request_to_budget(body, messages)
    assert phase == 'text' and freed > 0
    assert request_body_bytes({**body, 'messages': trimmed}) <= ROUTER_BODY_BUDGET
    assert trimmed[1]['content'].startswith('A' * 1000) and 'trimmed so the request body fits' in trimmed[1]['content']
    assert trimmed[5]['content'] == 'mới nhất, không được đụng', 'bước mới nhất phải nguyên vẹn'
    assert messages[1]['content'] == 'A' * 600_000, 'bản lưu không được sửa'


def test_a_huge_single_old_message_still_leaves_a_hard_failure_to_the_caller():
    """Không cắt được gì (mọi thứ đều là bước hiện tại) thì trả nguyên trạng, không nuốt lỗi."""
    messages = [{'role': 'user', 'content': 'x' * (2 * 1024 * 1024)}]
    returned, freed, phase = shrink_request_to_budget({'tools': []}, messages)
    assert freed == 0 and phase == '' and returned is messages


def test_the_budget_counts_the_prompt_and_the_tool_schemas():
    """Trần của router đếm **cả** thân request, không chỉ `messages`.

    Đo trên phiên thật `584d61c8` (25 bước, chết ở bước 25): thân đầy đủ 1 060 902 B trong khi
    danh sách `messages` chỉ 1 043 364 B — bản sửa đầu tiên chỉ đo `messages` nên không thấy
    12 326 B vượt trần và lượt gọi vẫn chết với `UPSTREAM_HTTP_413`.
    """
    messages = [
        {'role': 'user', 'content': 'nhiệm vụ'},
        {'role': 'assistant', 'content': 'A' * (ROUTER_BODY_BUDGET - 20_000)},
        {'role': 'user', 'content': 'tiếp tục'},
        {'role': 'assistant', 'content': 'mới nhất'},
    ]
    body = {'system': 'S' * 40_000, 'tools': [{'type': 'function'}] * 200, 'max_tokens': 4096}
    assert request_body_bytes(messages) <= ROUTER_BODY_BUDGET, 'chỉ riêng messages thì vừa'
    assert request_body_bytes({**body, 'messages': messages}) > ROUTER_BODY_BUDGET
    trimmed, freed, phase = shrink_request_to_budget(body, messages)
    assert freed > 0 and phase == 'text'
    assert request_body_bytes({**body, 'messages': trimmed}) <= ROUTER_BODY_BUDGET
    assert trimmed[3]['content'] == 'mới nhất', 'bước sống không bị đụng'


def test_history_is_reduced_least_destructively_first():
    """Chữ ký và `thought` của bước cũ là thứ rẻ nhất để bỏ, trước khi cắt chữ."""
    messages = [
        {'role': 'user', 'content': 'nhiệm vụ'},
        {'role': 'assistant', 'content': 'ngắn', 'thought': 'T' * (ROUTER_BODY_BUDGET + 10_000)},
        {'role': 'user', 'content': 'tiếp tục'},
        {'role': 'assistant', 'content': 'mới nhất'},
    ]
    body = {'tools': [], 'max_tokens': 4096}
    trimmed, freed, phase = shrink_request_to_budget(body, messages)
    assert phase == 'thought' and freed > ROUTER_BODY_BUDGET
    assert trimmed[1]['thought'] == '' and trimmed[1]['content'] == 'ngắn', 'chữ không bị cắt'
    assert messages[1]['thought'].startswith('T' * 100), 'bản lưu không được sửa'


def test_old_tool_arguments_shrink_without_breaking_the_call_pairing():
    messages = [
        {'role': 'user', 'content': 'nhiệm vụ'},
        {'role': 'assistant', 'content': None, 'tool_calls': [
            {'id': 'call_7', 'type': 'function',
             'function': {'name': 'computer_use',
                          'arguments': '{"script": "' + 'x' * (ROUTER_BODY_BUDGET + 10_000) + '"}'},
             'thought_signature': 'S' * 20},
        ]},
        {'role': 'tool', 'tool_call_id': 'call_7', 'name': 'computer_use', 'content': '{"ok": true}'},
        {'role': 'user', 'content': 'tiếp tục'},
        {'role': 'assistant', 'content': 'mới nhất'},
    ]
    body = {'tools': [], 'max_tokens': 4096}
    trimmed, freed, phase = shrink_request_to_budget(body, messages)
    assert phase == 'arguments' and freed > 0
    call = trimmed[1]['tool_calls'][0]
    assert call['id'] == 'call_7' and call['function']['name'] == 'computer_use'
    assert call['function']['arguments'] == TRIMMED_ARGUMENTS
    assert call['thought_signature'] == 'S' * 20, 'chữ ký vẫn phải đi cùng lượt gọi'
    assert trimmed[2]['tool_call_id'] == 'call_7', 'cặp gọi/kết quả vẫn khớp id'
    assert messages[1]['tool_calls'][0]['function']['arguments'].endswith('"}'), 'bản lưu không đổi'


def test_the_newest_capture_is_the_last_thing_dropped():
    """Ảnh là thứ đắt nhất về mặt thông tin, nên chỉ bị bỏ khi mọi cách khác đã hết."""
    messages = [
        {'role': 'user', 'content': 'nhiệm vụ'},
        {'role': 'assistant', 'content': None, 'tool_calls': [
            {'id': 'c0', 'type': 'function', 'function': {'name': 'computer_screen_capture', 'arguments': '{}'}}]},
        _capture(0, 300 * 1024),
        {'role': 'user', 'content': 'tiếp tục'},
        {'role': 'assistant', 'content': None, 'tool_calls': [
            {'id': 'c1', 'type': 'function', 'function': {'name': 'computer_screen_capture', 'arguments': '{}'}}]},
        _capture(1, 300 * 1024),
    ]
    body = {'tools': [], 'max_tokens': 4096}
    # Hai ảnh 300 KB vừa ngân sách ảnh (512 KB) nhưng vượt ngân sách thân request thấp.
    bounded, _ = bound_inline_media(messages)
    assert sum(1 for m in bounded if isinstance(m['content'], list)) == 1, 'ngân sách ảnh giữ 1 ảnh'
    trimmed, freed, phase = shrink_request_to_budget(body, messages, budget=250 * 1024)
    assert phase == 'media-0' and freed > 0
    assert all(isinstance(m['content'], str) for m in trimmed if m.get('role') == 'tool')
    assert messages[5]['content'][1]['type'] == 'image_url', 'bản lưu vẫn còn ảnh'


def test_the_measured_cua_body_now_fits_under_the_router_cap():
    """Hình dạng thật của ca chết vì 413: chữ ký ghi hai lần + ảnh + văn bản trợ lý dài."""
    messages = [{'role': 'user', 'content': 'nhiệm vụ CUA nặng'}]
    for index in range(8):
        messages.append(_assistant_with_signature(index, 60 * 1024))
        messages.append(_capture(index, 70 * 1024))
        messages.append({'role': 'assistant', 'content': 'ghi chú ' + 'N' * 30_000})
    messages.append({'role': 'user', 'content': 'bước sống'})
    messages.append({'role': 'assistant', 'content': 'kết quả mới nhất'})
    body = {'system': 'S' * 30_000, 'tools': [{'type': 'function'}] * 100, 'max_tokens': 4096}
    before = request_body_bytes({**body, 'messages': messages})
    bounded, _ = bound_inline_media(messages)
    deduped, _ = dedupe_thought_signatures(bounded)
    trimmed, freed, phase = shrink_request_to_budget(body, deduped)
    after = request_body_bytes({**body, 'messages': trimmed})
    assert before > 1048576, 'kịch bản phải tái hiện được thân quá trần'
    assert after < 1048576 and after <= ROUTER_BODY_BUDGET, (phase, freed, after)
    assert trimmed[-1]['content'] == 'kết quả mới nhất', 'bước sống không bị đụng'


def test_a_mission_that_keeps_capturing_never_crosses_the_router_cap():
    """Đúng thứ đã hỏng: vòng lặp tiếp tục chụp thì thân phải ở lại dưới trần, mãi mãi.

    Mỗi bước thêm một cặp `assistant` (chữ ký ghi hai lần) + `tool` mang ảnh 80 KB, đúng như
    vòng lặp thật; sau mỗi bước chạy ba lượt và khẳng định thân request gửi đi vẫn dưới 1 MiB.
    """
    tools = schemas_for(list(ORCHESTRATOR_TOOLS))
    route = {'connectionId': 'c' * 36, 'modelId': 'gemini-3.8-flash-medium'}
    messages = [{'role': 'system', 'content': 'vai gốc'}, {'role': 'user', 'content': 'nhiệm vụ'}]
    sizes = []
    for step in range(30):
        messages.append(_assistant_with_signature(step, 40 * 1024))
        messages.append(_capture(step, 80 * 1024))
        messages.append({'role': 'assistant', 'content': 'ghi chú ' + 'N' * 20_000})
        body = {**route, 'messages': messages, 'tools': tools, 'stream': True, 'max_tokens': 4096}
        bounded, _ = bound_inline_media(messages)
        deduped, _ = dedupe_thought_signatures(bounded)
        trimmed, _, _ = shrink_request_to_budget({**body, 'messages': deduped}, deduped)
        sent = request_body_bytes({**body, 'messages': trimmed})
        sizes.append(sent)
        assert sent < 1048576, (step, sent)
    assert sizes[0] < sizes[-1] < 1048576, 'thân vẫn tăng nhưng luôn dưới trần'


def test_the_trim_measures_the_body_the_client_really_sends():
    """`RouterClient.complete` phải đưa **cả thân request** vào phép đo, không chỉ `messages`."""
    source = runtime_module.__file__
    with open(source, encoding='utf-8') as handle:
        text = handle.read()
    assert "shrink_request_to_budget(\n            {**route, 'messages': messages" in text
    assert "'model.request_trimmed'" in text

