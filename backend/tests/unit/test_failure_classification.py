"""Lỗi phải luôn có mã máy đọc được và câu giải thích không rỗng.

Trước bản sửa, `error` event mang `str(exc)`. Vài lớp lỗi có `str()` RỖNG
(`aiohttp.ServerDisconnectedError`, `ConnectionResetError`, `Exception()`), nên
chat rơi vào câu mặc định vô nghĩa `Agent run failed` và không thể tra cứu.
"""
import asyncio
import builtins

from agentbox.agent_core.failures import classify_failure, describe_failure, failure_detail, is_transient


class ServerDisconnectedError(Exception):
    """Tên lớp giống aiohttp; `str()` rỗng khi không truyền thông điệp."""


class ConnectError(Exception):
    pass


def test_empty_exception_still_produces_a_readable_message():
    code, message = classify_failure(ServerDisconnectedError())
    assert code == 'UPSTREAM_UNREACHABLE'
    assert message.strip() and 'Agent run failed' not in message
    assert 'ServerDisconnectedError' in message, 'phải nêu tên lớp lỗi để tra log'


def test_connection_reset_is_unreachable():
    code, _ = classify_failure(ConnectionResetError())
    assert code == 'UPSTREAM_UNREACHABLE'


def test_timeout_maps_to_deadline():
    assert classify_failure(TimeoutError())[0] == 'DEADLINE'
    assert classify_failure(asyncio.TimeoutError())[0] == 'DEADLINE'


def test_permission_error_maps_to_tool_not_permitted():
    code, message = classify_failure(PermissionError('Tool not permitted for this role: terminal_exec'))
    assert code == 'TOOL_NOT_PERMITTED'
    assert 'terminal_exec' in message


def test_runtime_error_with_http_status_keeps_the_status():
    code, message = classify_failure(RuntimeError('Router HTTP 502: upstream provider failed'))
    assert code == 'UPSTREAM_HTTP_502'
    assert '502' in message and 'upstream provider failed' in message


def test_known_value_error_prefixes_are_preserved():
    for prefix in ('CONTEXT_LIMIT', 'THINKING_LEVEL_UNSUPPORTED', 'SETUP_REQUIRED', 'MAX_STEPS'):
        code, message = classify_failure(ValueError(f'{prefix}: chi tiết'))
        assert code == prefix
        assert message.startswith(prefix + ':')


def test_empty_stream_and_empty_response_get_their_own_codes():
    assert classify_failure(ValueError('Upstream did not return any SSE completion content'))[0] == 'TURN_EMPTY_STREAM'
    assert classify_failure(ValueError('Model did not produce a complete non-empty final response'))[0] == 'TURN_EMPTY_RESPONSE'


def test_unknown_failure_keeps_the_class_name():
    class WeirdFailure(Exception):
        pass

    code, message = classify_failure(WeirdFailure())
    assert code == 'TURN_FAILED_WEIRDFAILURE'
    assert message.strip()


def test_describe_failure_is_never_empty():
    for exc in (ServerDisconnectedError(), WeirdFailure := builtins.Exception()):
        text = describe_failure(exc)
        assert text.strip()
        assert text.split(':', 1)[0].isupper()


def test_failure_detail_contains_the_traceback():
    try:
        raise ServerDisconnectedError()
    except ServerDisconnectedError as exc:
        detail = failure_detail(exc)
    assert 'ServerDisconnectedError' in detail
    assert 'Traceback' in detail


def test_transient_classification():
    assert is_transient(ServerDisconnectedError()) is True
    assert is_transient(ConnectionResetError()) is True
    assert is_transient(RuntimeError('Router HTTP 503: down')) is True
    assert is_transient(RuntimeError('Router HTTP 400: bad request')) is False
    assert is_transient(ValueError('Upstream did not return any SSE completion content')) is True
    assert is_transient(TimeoutError()) is False
    assert is_transient(PermissionError('nope')) is False
