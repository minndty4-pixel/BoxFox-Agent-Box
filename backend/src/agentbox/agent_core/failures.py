"""Classify a turn/command failure into a stable code plus a readable message.

Why this module exists
----------------------
Every failure path used to emit ``str(exc)``. Several exceptions that reach the
harness stringify to an EMPTY message (``aiohttp.ServerDisconnectedError``,
``ConnectionResetError``, a bare ``Exception()``, a cancelled socket read).
The chat UI then falls back to the literal ``Agent run failed``
(``frontend/src/store/harnessChatStore.ts:277-283``), which tells the user
nothing and cannot be searched in support chats.

Contract
--------
``classify_failure(exc)`` returns ``(code, message)``:

* ``code`` is an uppercase machine token (``DEADLINE``, ``UPSTREAM_UNREACHABLE``,
  ``UPSTREAM_HTTP_502``, ``TOOL_NOT_PERMITTED``, or ``TURN_FAILED_<EXCNAME>``).
  Tokens already carried by a ``ValueError`` prefix (``CONTEXT_LIMIT: …``) are
  preserved, so existing tests and the UI keep their contract.
* ``message`` is never empty and always contains the original reason, so a
  developer reading the chat or the system log sees what actually broke.
"""

from __future__ import annotations

import asyncio
import traceback

__all__ = ['classify_failure', 'describe_failure', 'failure_detail']

# Codes already produced as a ``ValueError('CODE: text')`` prefix by the runtime,
# the command layer or the sandbox. Matched by prefix so the original wording
# survives untouched.
KNOWN_PREFIXES = (
    'CONTEXT_LIMIT',
    'THINKING_LEVEL_UNSUPPORTED',
    'SETUP_REQUIRED',
    'CHILD_FAILED',
    'PLAN_QUALITY_REJECTED',
    'PLAN_INVALID',
    'PLAN_SLUG_INVALID',
    'PLAN_WRITE_FAILED',
    'DECISION_UNAVAILABLE',
    'DECISION_INVALID',
    'DECISION_NOT_FOUND',
    'DECISION_ALREADY_RESOLVED',
    'MAX_STEPS',
    'SKILL_TASK_REQUIRED',
    'MISSING_TASK',
    'SESSION_BUSY',
    'OUTPUT_LIMIT',
    'ROUTER_',
    'WORKSPACE_',
    'CLI_',
)

# Exceptions that mean "the upstream endpoint is gone"; their ``str()`` is often
# empty, which is exactly the case this module exists for.
_UNREACHABLE_NAMES = {
    'ServerDisconnectedError',
    'ClientConnectionError',
    'ClientConnectorError',
    'ClientOSError',
    'ClientPayloadError',
    'ClientResponseError',
    'ConnectError',
    'ConnectTimeout',
    'ConnectionResetError',
    'ConnectionAbortedError',
    'ConnectionRefusedError',
    'ReadTimeout',
    'ReadError',
    'RemoteProtocolError',
    'TransportError',
    'TimeoutException',
    'IncompleteReadError',
    'ServerTimeoutError',
}


def _reason(exc: BaseException) -> str:
    """Text of the exception that is never empty."""
    text = str(exc).strip()
    return text or repr(exc)


def classify_failure(exc: BaseException) -> tuple[str, str]:
    """Return ``(code, message)`` for a failure that ended a turn or a command."""
    reason = _reason(exc)
    name = type(exc).__name__

    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return 'DEADLINE', 'DEADLINE: the turn ran out of time before an answer was produced'

    if isinstance(exc, PermissionError):
        return 'TOOL_NOT_PERMITTED', 'TOOL_NOT_PERMITTED: ' + reason

    if name in _UNREACHABLE_NAMES or isinstance(exc, (ConnectionError,)):
        return 'UPSTREAM_UNREACHABLE', (
            f'UPSTREAM_UNREACHABLE: the model router or provider closed the connection ({name}: {reason})'
        )

    # ``Router HTTP 502: …`` from RouterClient/complete()
    if isinstance(exc, RuntimeError) and reason.startswith('Router HTTP '):
        head, _, tail = reason.partition(':')
        status = head.split()[-1].strip()
        code = 'UPSTREAM_HTTP_' + (status if status.isdigit() else 'ERROR')
        return code, f'{code}: the model router answered {head} ({tail.strip() or "no detail"})'

    for prefix in KNOWN_PREFIXES:
        if reason.startswith(prefix):
            code = reason.split(':', 1)[0].strip() or prefix
            return code, reason

    if isinstance(exc, ValueError) and reason.startswith('Upstream did not return any SSE completion content'):
        return 'TURN_EMPTY_STREAM', 'TURN_EMPTY_STREAM: the provider stream ended without any content or tool call'

    if isinstance(exc, ValueError) and reason.startswith('Model did not produce a complete non-empty final response'):
        return 'TURN_EMPTY_RESPONSE', (
            'TURN_EMPTY_RESPONSE: the model finished without a usable answer (no text, no tool call)'
        )

    if isinstance(exc, ValueError) and reason.startswith('Tool-call batch exceeds limit'):
        return 'TURN_TOOL_BATCH', 'TURN_TOOL_BATCH: the model requested more tool calls in one step than allowed'

    code = 'TURN_FAILED_' + ''.join(ch for ch in name.upper() if ch.isalnum())[:32]
    return code, f'{code}: {name}: {reason}'


def describe_failure(exc: BaseException) -> str:
    """``'CODE: message'`` — the string a caller can emit or log directly."""
    code, message = classify_failure(exc)
    return message if message.startswith(code) else f'{code}: {message}'


def failure_detail(exc: BaseException, limit: int = 12) -> str:
    """Traceback tail for the developer system log (never sent to the model)."""
    frames = traceback.format_exception(type(exc), exc, exc.__traceback__)
    return ''.join(frames)[-4000:] if frames else repr(exc)


def is_transient(exc: BaseException) -> bool:
    """True when a single retry can plausibly succeed (routers restart, sockets drop)."""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return False
    name = type(exc).__name__
    if name in _UNREACHABLE_NAMES or isinstance(exc, ConnectionError):
        return True
    # httpx raises its own names; kept separate from aiohttp to avoid importing it here.
    if name in {'ReadError', 'WriteError', 'PoolTimeout', 'NetworkError', 'HTTPError'}:
        return True
    reason = _reason(exc)
    if isinstance(exc, RuntimeError) and reason.startswith('Router HTTP '):
        status = reason.split()[2].rstrip(':') if len(reason.split()) > 2 else ''
        return status.isdigit() and int(status) >= 500
    if isinstance(exc, ValueError) and reason.startswith('Upstream did not return any SSE completion content'):
        return True
    return False
