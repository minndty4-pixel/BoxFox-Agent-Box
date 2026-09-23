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
      "turnId": 12,              # optional STEP counter inside the session (turns of the
                                 # agent loop; kept as-is so older log lines still read)
      "turn": 3,                 # optional TURN number of the session (one user turn may
                                 # contain many turnId steps -- the two never mean the same
                                 # thing, see `session_store.begin_turn`)
      "code": "UPSTREAM_UNREACHABLE",   # machine token when the entry is a failure
      "message": "…",            # human, one line
      "durationMs": 1523,
      "data": { … }              # small, already-redacted extras
    }

Rules kept deliberately simple so the log can never break a turn:

* writing is best-effort — any error is swallowed;
* entries are capped in size (``MAX_ENTRY_CHARS``) so a giant payload cannot
  fill the disk;
* rotation keeps ``ROTATE_BACKUPS`` files of at most ``MAX_BYTES`` each;
* every line carries the ``runId`` of the process that wrote it, so lines from
  different runs can be told apart after a restart.

Lifecycle (the owner's rule: *log only while running, reset on shutdown*):

* ``harness.start`` names the run (``runId`` + ``pid``) and the run writes into
  the active file until the process stops;
* the GRACEFUL shutdown path calls ``rotate_on_shutdown()``, which renames the
  active file to ``harness.previous.jsonl`` (overwriting the older previous file,
  so exactly one previous file is kept — bounded disk) and leaves the next run to
  start with a fresh, empty active file;
* a hard kill never reaches that code, so nothing is deleted — the active file
  just stays where it is and the next run appends to it.

The read path is the second half of bản v2: ``read_entries()`` (plus
``SystemLog.read()``) serves the read-only API ``GET /api/agent/system-log`` and
applies a SECOND redaction pass, so a hand-edited file or a line written by an
older build cannot leak a secret through the API. Read it by hand with
``scripts/system-log.py``: ``tail``, ``follow``, ``errors``, ``summary``,
``sessions``, ``prune``, ``reset``.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

__all__ = ['SystemLog', 'system_log', 'read_entries', 'redact_entry', 'since_cutoff',
           'clamp_lines', 'new_run_id', 'LOG_DIR_ENV', 'DEFAULT_LOG_DIR',
           'MAX_READ_LINES', 'DEFAULT_READ_LINES']

LOG_DIR_ENV = 'BOXFOX_SYSTEM_LOG_DIR'
DEFAULT_LOG_DIR = Path.home() / 'BoxFox' / 'logs'
MAX_BYTES = 8 * 1024 * 1024
ROTATE_BACKUPS = 4
MAX_ENTRY_CHARS = 4000

# Read path limits. The cap is a hard one: the API must not be able to hand a
# caller the whole 8 MiB file (plan §3.1).
DEFAULT_READ_LINES = 100
MAX_READ_LINES = 500
READ_CHUNK_BYTES = 2 * 1024 * 1024
LEVELS = ('info', 'warn', 'error')
PREVIOUS_SUFFIX = '.previous'

# Values that must never reach the log even by accident. Shared by the writer and
# by the reader's second pass — one list, so the two cannot drift apart.
_REDACT_KEYS = {'apikey', 'api_key', 'authorization', 'password', 'secret', 'token', 'x-boxfox-api-key'}

# `since` accepts an ISO timestamp; minutes are the other accepted form.
_ISO_PREFIX = re.compile(r'^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?')


def _now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()) + f'.{int(time.time() * 1000) % 1000:03d}Z'


def new_run_id() -> str:
    """Sortable id for one process run: ``20260920T040506-12345-a1b2``.

    The pid is part of it so two runs started in the same second are still
    distinguishable, and the suffix keeps it unique when they share a pid too.
    """
    return f'{time.strftime("%Y%m%dT%H%M%S", time.gmtime())}-{os.getpid()}-{os.urandom(2).hex()}'


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


def redact_entry(entry: dict) -> dict:
    """Second pass over a WHOLE line, applied on the read path (the API layer).

    The writer already redacts, but the file is a file: it can be edited by hand, or
    written by an older build. Wiping the value of any ``_REDACT_KEYS`` key at any depth
    on the way out makes the API independent of what the writer did — and the key list is
    shared with the writer, so the two passes can never drift apart. Nothing else is
    touched (no truncation, no reordering) so the JSON the panel shows is what is on disk.
    """
    if isinstance(entry, dict):
        return {key: '[redacted]' if str(key).lower() in _REDACT_KEYS else _wipe_secrets(item)
                for key, item in entry.items()}
    return entry


def _wipe_secrets(value):
    if isinstance(value, dict):
        return {key: '[redacted]' if str(key).lower() in _REDACT_KEYS else _wipe_secrets(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [_wipe_secrets(item) for item in value]
    return value


def clamp_lines(value) -> int:
    """``lines`` from a query string: default 100, hard cap 500 (plan §3.1)."""
    if value is None or str(value).strip() == '':
        return DEFAULT_READ_LINES
    try:
        number = int(str(value).strip())
    except ValueError:
        raise ValueError(f'lines must be a whole number, got {value!r}') from None
    return max(1, min(number, MAX_READ_LINES))


def since_cutoff(value) -> str | None:
    """Normalise the ``since`` filter: a number of minutes, or an ISO timestamp.

    Returns the timestamp string to compare against the ``ts`` of a line (same shape, so
    the comparison is a plain string compare), or ``None`` when nothing was asked for.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        minutes = float(text)
    except ValueError:
        match = _ISO_PREFIX.match(text)
        if match is None:
            raise ValueError(f'since must be an ISO timestamp or a number of minutes, got {text!r}') from None
        return match.group(0).replace(' ', 'T')
    if minutes < 0:
        raise ValueError('since must not be negative')
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - minutes * 60))


def _tail_lines(path: Path, max_bytes: int = READ_CHUNK_BYTES) -> list[str]:
    """Last chunk of the file as text lines, bounded so a huge log cannot be slurped."""
    try:
        with path.open('rb') as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            if size > max_bytes:
                handle.seek(size - max_bytes)
                handle.readline()  # drop the partial first line
            else:
                handle.seek(0)
            return handle.read().decode('utf-8', 'replace').splitlines()
    except OSError:
        return []


def read_entries(paths, *, level=None, source=None, session_id=None, event=None,
                 lines=DEFAULT_READ_LINES, since=None, redact: bool = True) -> list[dict]:
    """Filtered, newest-last view of one or more log files.

    ``lines`` is clamped to ``MAX_READ_LINES``; ``session_id`` matches on prefix (the panel
    and the CLI both show the first 8 characters). Unparseable lines are skipped, never
    fatal: a half-written last line must not break the reader. Bad filter values raise
    ``ValueError`` so the HTTP layer can answer 400 instead of guessing.
    """
    wanted_level = str(level).strip() if level else ''
    if wanted_level and wanted_level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}, got {wanted_level!r}")
    wanted_source = str(source).strip() if source else ''
    wanted_event = str(event).strip() if event else ''
    wanted_session = str(session_id).strip() if session_id else ''
    limit = clamp_lines(lines)
    cutoff = since_cutoff(since)

    entries: list[dict] = []
    for path in paths:
        for line in _tail_lines(Path(path)):
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            if wanted_level and entry.get('level') != wanted_level:
                continue
            if wanted_source and entry.get('source') != wanted_source:
                continue
            if wanted_event and entry.get('event') != wanted_event:
                continue
            if wanted_session and not str(entry.get('sessionId') or '').startswith(wanted_session):
                continue
            if cutoff and str(entry.get('ts') or '') < cutoff:
                continue
            entries.append(redact_entry(entry) if redact else entry)
    entries.sort(key=lambda item: str(item.get('ts') or ''))
    return entries[-limit:]


class SystemLog:
    """Append-only JSONL writer. Safe to share between threads."""

    def __init__(self, directory: str | Path | None = None, source: str = 'harness',
                 filename: str = 'harness.jsonl', enabled: bool = True,
                 run_id: str | None = None):
        self.source = source
        self.enabled = enabled
        self.directory = Path(directory or os.environ.get(LOG_DIR_ENV) or DEFAULT_LOG_DIR)
        self.path = self.directory / filename
        self.run_id = run_id or new_run_id()
        self._lock = threading.Lock()

    # ------------------------------------------------------------- paths of a run
    def previous_path(self) -> Path:
        """Where ``reset()`` puts the finished run: ``harness.previous.jsonl``.

        Deliberately NOT one of the ``.0``…``.3`` size-rotation backups: those are the
        within-run history, this one is the previous run.
        """
        return self.path.with_name(f'{self.path.stem}{PREVIOUS_SUFFIX}{self.path.suffix}')

    def read(self, *, level=None, source=None, session_id=None, event=None,
             lines=DEFAULT_READ_LINES, since=None) -> list[dict]:
        """Filtered view of the ACTIVE file, for the read-only API and for tests."""
        return read_entries([self.path], level=level, source=source, session_id=session_id,
                            event=event, lines=lines, since=since)

    # ---------------------------------------------------------------- lifecycle
    def rotate_on_shutdown(self) -> Path | None:
        """Reset the active file on a GRACEFUL shutdown (the owner's rule).

        Renames ``harness.jsonl`` to ``harness.previous.jsonl``, replacing any older
        previous file (exactly one kept, so the disk stays bounded), and leaves the next
        run to open a fresh, empty active file. A hard kill never reaches this code: the
        active file simply stays on disk with everything in it.
        """
        try:
            with self._lock:
                if not self.path.exists():
                    return None
                previous = self.previous_path()
                # `replace` (not `rename`) so an existing previous file is overwritten on
                # every platform instead of raising.
                self.path.replace(previous)
                return previous
        except OSError:
            # Like every other write path here: the log must never break shutdown.
            return None

    # The name the plan §3 item 3 uses for the same operation.
    reset = rotate_on_shutdown

    # ------------------------------------------------------------------ write
    def write(self, event: str, *, level: str = 'info', message: str | None = None,
              code: str | None = None, session_id: str | None = None, turn_id: int | None = None,
              turn: int | None = None, duration_ms: float | None = None, **data) -> None:
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
            # Cheap (a short constant string, ~30 bytes) and it is what makes lines from
            # two runs tellable apart after a restart/reset.
            'runId': self.run_id,
        }
        if session_id:
            entry['sessionId'] = session_id
        if turn_id is not None:
            entry['turnId'] = turn_id
        # T2 — số LƯỢT của phiên, KHÁC `turnId` (số bước trong lượt). Hai trường cùng có mặt
        # vì bản ghi cũ không được đổi nghĩa: chỉ thêm.
        if turn is not None:
            entry['turn'] = turn
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
