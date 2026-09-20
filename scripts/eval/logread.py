"""Read the DEV system log (`~/BoxFox/logs/harness.jsonl`) as plain JSONL.

The writer is `agentbox.observability.system_log` (backend) and
`router/src/system-log.mjs`; the format is documented in
`docs/plan/dev-system-log-plan.md` §2.1. This reader parses the file directly
instead of importing the harness package for two reasons:

* the eval scripts must run from a clean checkout with no third-party import
  and no `agentbox` on `sys.path` (tests feed them synthetic files);
* rotation keeps a finished run as `<name>.previous.jsonl` (the writer's graceful
  shutdown path) plus `*.jsonl.0` … `.3` size backups, and a window can start
  before the last rotation, so reading the file bytes ourselves is the honest
  thing to do. A reader that only opened `harness.jsonl` would report "no data"
  right after every restart — which is exactly the mistake this module exists to
  avoid.

It touches nothing but the filesystem: no socket, no urllib, no subprocess.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

LOG_DIR_ENV = 'BOXFOX_SYSTEM_LOG_DIR'   # same override the writer honours
LOG_NAME = 'harness.jsonl'
PREVIOUS_SUFFIX = '.previous'           # `harness.previous.jsonl`, see system_log.rotate_on_shutdown
ROTATION_BACKUPS = 4                    # `harness.jsonl.0` … `.3`

# What a caller must be told when there is nothing to measure.
STATE_OK = 'ok'
STATE_MISSING = 'missing'
STATE_EMPTY = 'empty'


def default_log_dir() -> Path:
    override = os.environ.get(LOG_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / 'BoxFox' / 'logs'


def default_log_path(name: str = LOG_NAME) -> Path:
    return default_log_dir() / name


def previous_path(path: str | Path) -> Path:
    """`harness.jsonl` → `harness.previous.jsonl` (the last finished run)."""
    path = Path(path)
    return path.with_name(f'{path.stem}{PREVIOUS_SUFFIX}{path.suffix}')


def log_family(path: str | Path, *, rotated: bool = False) -> list[Path]:
    """Every file belonging to one log name, as a window may span several.

    The previous run is always included: after a restart the active file holds
    only the last few lines, and an index computed on those alone would say "no
    data" about a run that is in fact sitting in `harness.previous.jsonl`.
    `rotated=True` also reaches into the `.0` … `.3` size backups. The caller
    sorts by `ts` afterwards, so the order here is only "oldest-ish first".
    """
    path = Path(path)
    family = [previous_path(path)]
    if rotated:
        family.extend(Path(f'{path}.{index}') for index in reversed(range(ROTATION_BACKUPS)))
    family.append(path)
    return family


def parse_lines(lines, *, keep_bad: bool = False) -> tuple[list[dict], int]:
    """Parse JSONL text into (entries, bad_line_count)."""
    entries: list[dict] = []
    bad = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            bad += 1
            continue
        if isinstance(entry, dict):
            entries.append(entry)
        else:
            bad += 1
    return entries, bad


def read_file(path: str | Path) -> tuple[list[dict], str, int]:
    """Return (entries, state, bad_lines) for one log file."""
    path = Path(path)
    if not path.exists():
        return [], STATE_MISSING, 0
    try:
        text = path.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return [], STATE_MISSING, 0
    entries, bad = parse_lines(text.splitlines())
    if not entries:
        return [], STATE_EMPTY, bad
    return entries, STATE_OK, bad


def read_window(path: str | Path, *, limit: int | None = None, rotated: bool = False) -> dict:
    """Read a window of the log, oldest first, with an explicit data state.

    The window always includes the previous run (`harness.previous.jsonl`);
    `rotated=True` also reads `*.jsonl.0` … `.3`, so a window may reach back past
    a size rotation. `limit` keeps the LAST `limit` entries of the merged file
    set (the newest lines, which is what an analysis window wants). Identical
    lines found in two files are counted once: a rotation that copies instead of
    renaming must not double-count. `files` names every file that existed and was
    read, so a report can say where its numbers came from.
    """
    path = Path(path)
    entries: list[dict] = []
    bad = 0
    states: list[str] = []
    read_files: list[str] = []
    seen: set[str] = set()
    duplicates = 0
    for candidate in log_family(path, rotated=rotated):
        chunk, state, chunk_bad = read_file(candidate)
        if candidate.exists():
            states.append(state)
            read_files.append(str(candidate))
        bad += chunk_bad
        for entry in chunk:
            key = json.dumps(entry, sort_keys=True, ensure_ascii=False)
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            entries.append(entry)
    if not entries:
        state = STATE_MISSING if all(item == STATE_MISSING for item in states) else STATE_EMPTY
        return {'path': str(path), 'state': state, 'entries': [], 'badLines': bad,
                'files': read_files, 'duplicates': duplicates}
    entries.sort(key=lambda item: str(item.get('ts', '')))
    if limit is not None and limit > 0:
        entries = entries[-limit:]
    return {'path': str(path), 'state': STATE_OK, 'entries': entries, 'badLines': bad,
            'files': read_files, 'duplicates': duplicates}


def session_ids(entries) -> list[str]:
    seen: list[str] = []
    for entry in entries:
        sid = entry.get('sessionId')
        if sid and sid not in seen:
            seen.append(sid)
    return seen


def event_counts(entries) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in entries:
        key = str(entry.get('event', ''))
        counts[key] = counts.get(key, 0) + 1
    return counts
