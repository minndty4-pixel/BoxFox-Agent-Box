"""Vòng 29, phát hiện (c): câu lỗi tham số công cụ phải đủ dài để model tự sửa.

Cây vendor `backend/src/agentbox/vendor/hermes/tool_arguments.py` giữ nguyên: nó vẫn
trả về đúng một câu ngắn. Hai chỗ gọi trong `runtime.py` dùng hàm bọc ở đây thay vì
gọi thẳng vendor, để câu lỗi gửi cho model có thêm **độ dài thô** và **vị trí lỗi
JSON** (hoặc kiểu dữ liệu nhận được khi chuỗi là JSON hợp lệ nhưng không phải object).

Phép đo: lượt research thật thứ tư gửi tham số hỏng bị thay bằng `{}` và model chỉ
nhận được một câu `Invalid tool arguments` — không độ dài, không vị trí, không dấu
hiệu bị cắt, nên model không có gì để sửa và lặp lại y hệt ở bước sau.

Giữ nguyên phong bì JSON cũ (`{"error": ..., "message": ...}`) để mọi giao diện đọc
kết quả công cụ không phải đổi.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from ..vendor.hermes.tool_arguments import _parse_tool_arguments

ERROR_LABEL = 'Invalid tool arguments'
BASE_MESSAGE = 'Tool arguments must be a valid JSON object; tool was not executed.'


def _envelope(detail: str) -> str:
    """Same JSON envelope as the vendor helper, with one extra sentence of detail."""
    return json.dumps(
        {'error': ERROR_LABEL, 'message': BASE_MESSAGE + (' ' + detail if detail else '')},
        ensure_ascii=False,
    )


def describe_tool_arguments(raw_arguments: Any) -> str:
    """One actionable error string: what was wrong, how long the text was, and where it broke."""
    if raw_arguments is None:
        return _envelope('No arguments were sent at all.')
    if not isinstance(raw_arguments, str):
        return _envelope(
            'Arguments arrived as ' + type(raw_arguments).__name__ + ', not a JSON string.'
        )

    length = len(raw_arguments)
    try:
        parsed = json.loads(raw_arguments)
    except json.JSONDecodeError as exc:
        location = 'line ' + str(exc.lineno) + ' column ' + str(exc.colno) + ' (character ' + str(exc.pos) + ')'
        hint = ''
        if raw_arguments.count('{') > raw_arguments.count('}'):
            hint = ' The text looks cut off before the closing brace.'
        elif raw_arguments.strip() and not raw_arguments.rstrip().endswith('}'):
            hint = ' The text does not end with a closing brace.'
        return _envelope(
            'Received ' + str(length) + ' characters; JSON error "' + exc.msg + '" at '
            + location + '.' + hint + ' Resend the whole call with one complete JSON object.'
        )

    if isinstance(parsed, dict):
        # Not reachable through parse_tool_arguments (a dict never fails there), but the
        # helper stays honest when a caller asks about a valid object on its own.
        return _envelope('')

    return _envelope(
        'Received ' + str(length) + ' characters that parse as JSON '
        + type(parsed).__name__ + ', not an object. Resend the call with one JSON object.'
    )


def parse_tool_arguments(raw_arguments: Any) -> tuple[dict, Optional[str]]:
    """Drop-in replacement for the vendor helper: same contract, richer failure text."""
    arguments, error = _parse_tool_arguments(raw_arguments)
    if error is None:
        return arguments, None
    return arguments, describe_tool_arguments(raw_arguments)
