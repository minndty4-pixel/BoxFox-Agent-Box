"""Developer system log: append-only JSONL, written OUTSIDE the box.

The file lives in ``~/BoxFox/logs`` on the HOST (default), next to the harness
database and the router state. The sandbox container only mounts the workspace
directory, so the agent inside the box cannot read, write or discover this log:
it is a developer tool, not agent context.

Shape of one line (JSON object, one per line):

    {
      "ts": "2026-09-20T04:05:06.123Z",
      "level": "info" | "warn" | "error",
      "source": "harness" | "router" | "box",
      "event": "turn.start" | "turn.end" | "tool.end" | "failure" | ...,
      "sessionId": "…",          # when the entry belongs to one session
      "turnId": 12,              # optional counter inside the session
      "code": "UPSTREAM_UNREACHABLE",   # machine token when the entry is a failure
      "message": "…",            # human, one line
      "durationMs": 1523,
      "data": { … }              # small, already-redacted extras
    }

Rules kept deliberately simple so the log can never break a turn:

* writing is best-effort — any error is swallowed;
* entries are capped in size (``MAX_ENTRY_CHARS``) so a giant payload cannot
  fill the disk;
* rotation keeps ``ROTATE_BACKUPS`` files of at most ``MAX_BYTES`` each.

Read it with ``scripts/system-log.py``: ``tail``, ``follow``, ``errors``,
``summary``, ``sessions``.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

__all__ = ['SystemLog', 'system_log', 'LOG_DIR_ENV', 'DEFAULT_LOG_DIR']

LOG_DIR_ENV = 'BOXFOX_SYSTEM_LOG_DIR'
DEFAULT_LOG_DIR = Path.home() / 'BoxFox' / 'logs'
MAX_BYTES = 8 * 1024 * 1024
ROTATE_BACKUPS = 4
MAX_ENTRY_CHARS = 4000

# Values that must never reach the log even by accident.
_REDACT_KEYS = {'apikey', 'api_key', 'authorization', 'password', 'secret', 'token', 'x-boxfox-api-key'}


def _now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()) + f'.{int(time.time() * 1000) % 1000:03d}Z'


def _redact(value, depth: int = 0):
    """Drop secrets and keep the entry small."""
    if depth > 3:
        return '…'
    if isinstance(value, dict):
        out = {}
        for key, item in list(value.items())[:40]:
            if str(key).lower() in _REDACT_KEYS:
                out[key] = '[redacted]'
            else:
                out[key] = _redact(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [_redact(item, depth + 1) for item in list(value)[:40]]
    if isinstance(value, str):
        return value if len(value) <= 400 else value[:400] + '…'
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:400]


class SystemLog:
    """Append-only JSONL writer. Safe to share between threads."""

    def __init__(self, directory: str | Path | None = None, source: str = 'harness',
                 filename: str = 'harness.jsonl', enabled: bool = True):
        self.source = source
        self.enabled = enabled
        self.directory = Path(directory or os.environ.get(LOG_DIR_ENV) or DEFAULT_LOG_DIR)
        self.path = self.directory / filename
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ write
    def write(self, event: str, *, level: str = 'info', message: str | None = None,
              code: str | None = None, session_id: str | None = None, turn_id: int | None = None,
              duration_ms: float | None = None, **data) -> None:
        if not self.enabled:
            return
        if duration_ms is None:
            # Callers may use the camelCase name of the JSON field.
            duration_ms = data.pop('durationMs', None)
        entry = {
            'ts': _now_iso(),
            'level': level,
            'source': self.source,
            'event': event,
        }
        if session_id:
            entry['sessionId'] = session_id
        if turn_id is not None:
            entry['turnId'] = turn_id
        if code:
            entry['code'] = code
        if message:
            entry['message'] = message[:1000]
        if duration_ms is not None:
            entry['durationMs'] = round(float(duration_ms), 1)
        if data:
            entry['data'] = _redact(data)
        try:
            line = json.dumps(entry, ensure_ascii=False, default=str)
        except Exception:
            line = json.dumps({'ts': entry['ts'], 'level': level, 'source': self.source, 'event': event})
        if len(line) > MAX_ENTRY_CHARS:
            line = line[:MAX_ENTRY_CHARS - 20] + '…[truncated]"}'
        try:
            with self._lock:
                self.directory.mkdir(parents=True, exist_ok=True)
                if self.path.exists() and self.path.stat().st_size >= MAX_BYTES:
                    self._rotate()
                with self.path.open('a', encoding='utf-8') as handle:
                    handle.write(line + '\n')
        except Exception:
            # The system log must never be able to fail a turn.
            pass

    def error(self, event: str, exc: BaseException | None = None, *, message: str | None = None,
              code: str | None = None, **data) -> None:
        self.write(event, level='error', message=message, code=code, **data)

    # ----------------------------------------------------------------- rotate
    def _rotate(self) -> None:
        for index in range(ROTATE_BACKUPS - 1, 0, -1):
            older = self.path.with_suffix(self.path.suffix + f'.{index}')
            newer = self.path.with_suffix(self.path.suffix + f'.{index - 1}')
            if newer.exists():
                older.unlink(missing_ok=True)
                newer.rename(older)
        self.path.rename(self.path.with_suffix(self.path.suffix + '.0'))

    def tail(self, lines: int = 100) -> list[dict]:
        """Newest `lines` entries, for the CLI and tests."""
        try:
            with self.path.open('r', encoding='utf-8') as handle:
                raw = handle.readlines()[-lines:]
        except FileNotFoundError:
            return []
        out = []
        for line in raw:
            try:
                out.append(json.loads(line))
            except Exception:
                continue
        return out


# One shared instance for the harness process; tests build their own with a tmp dir.
system_log = SystemLog()
