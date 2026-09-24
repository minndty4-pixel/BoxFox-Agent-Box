"""Vòng 29, phát hiện (c): câu lỗi tham số công cụ dài hơn, có độ dài và vị trí.

Bốn ca dưới đây khẳng định đúng bốn thứ mà lượt research thật thứ tư không có:
độ dài thô, vị trí lỗi JSON, dấu hiệu bị cắt, và kiểu dữ liệu nhận được khi chuỗi
là JSON hợp lệ nhưng không phải object. Đồng thời ghim rằng cây vendor không đổi.
"""
import json

from agentbox.agent_core.tool_arg_errors import describe_tool_arguments, parse_tool_arguments
from agentbox.vendor.hermes.tool_arguments import _parse_tool_arguments


def _message(error: str) -> str:
    payload = json.loads(error)
    assert payload['error'] == 'Invalid tool arguments'
    return payload['message']


def test_object_passes_through_untouched():
    arguments, error = parse_tool_arguments('{"query": "moh.gov.vn"}')
    assert arguments == {'query': 'moh.gov.vn'}
    assert error is None


def test_non_object_json_passes_through_untouched():
    arguments, error = parse_tool_arguments('[1, 2]')
    assert arguments == {}
    assert error is not None
    assert 'list' in _message(error)


def test_truncated_json_reports_length_and_position():
    raw = '{"query": "moh.gov.vn", "deep": {"limit": 5'
    _, error = parse_tool_arguments(raw)
    assert error is not None
    message = _message(error)
    assert str(len(raw)) + ' characters' in message
    assert 'JSON error' in message
    assert 'line 1 column ' in message
    assert 'cut off before the closing brace' in message


def test_long_text_does_not_end_with_a_brace():
    raw = '{"query": "moh.gov.vn"} trailing junk'
    _, error = parse_tool_arguments(raw)
    assert error is not None
    message = _message(error)
    assert 'does not end with a closing brace' in message


def test_missing_and_wrong_type_arguments_are_named():
    assert 'No arguments were sent' in _message(parse_tool_arguments(None)[1])
    assert 'dict' in _message(parse_tool_arguments({'query': 'x'})[1])


def test_vendor_helper_stays_short():
    """Cây vendor giữ nguyên: lời gọi thẳng vendor vẫn trả câu ngắn cũ."""
    _, error = _parse_tool_arguments('{')
    assert error is not None
    assert 'characters' not in error
    assert json.loads(error)['error'] == 'Invalid tool arguments'


def test_describe_never_raises_on_odd_input():
    for value in (None, 0, 3.5, b'{}', '', '{', 'null', 'true'):
        assert isinstance(describe_tool_arguments(value), str)
