"""Read the developer system log (`~/BoxFox/logs/harness.jsonl`).

The log lives on the HOST, outside the sandbox, so the agent inside the box can
never read it. This CLI is the developer's entry point.

Usage:
    python scripts/system-log.py tail [--lines 50] [--level error] [--session <sid>] [--file harness|router]
    python scripts/system-log.py follow [--file harness]
    python scripts/system-log.py errors [--lines 20] [--since-minutes 60]
    python scripts/system-log.py summary [--since-minutes 1440]
    python scripts/system-log.py sessions [--lines 200]
    python scripts/system-log.py reset [--file harness|router|all]
    python scripts/system-log.py prune [--days 7] [--max-mib 200] [--dry-run]

Exit code is 0 on success and 2 when the requested log file does not exist yet.

`reset` is the manual twin of what the writers do on a graceful shutdown
(`SystemLog.rotate_on_shutdown()` in `backend/src/agentbox/observability/system_log.py`):
the active file becomes `<name>.previous.jsonl`, replacing the older previous file, so
exactly one finished run is kept and the next run starts empty. `prune` is the retention
policy of plan §4 item 2: it never touches the active file, only the rotation backups
(`*.jsonl.0`…`.3`) and previous-run files older than `--days`, and it also enforces the
`--max-mib` ceiling oldest-first.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

# Same override the writers honour, so a verification instance can be read back.
LOG_DIR = Path(os.environ.get('BOXFOX_SYSTEM_LOG_DIR') or (Path.home() / 'BoxFox' / 'logs'))

PREVIOUS_SUFFIX = '.previous'
DEFAULT_RETENTION_DAYS = 7
DEFAULT_MAX_MIB = 200


def _files(which: str) -> list[Path]:
    if which == 'all':
        # `*.jsonl` also matches `<name>.previous.jsonl` — a finished run a dev may still
        # want to read. Each line carries `runId`, so the runs stay tellable apart.
        return sorted(LOG_DIR.glob('*.jsonl'))
    return [LOG_DIR / f'{which}.jsonl']


def _previous_path(path: Path) -> Path:
    return path.with_name(f'{path.stem}{PREVIOUS_SUFFIX}{path.suffix}')


def _recyclable_files(which: str) -> list[Path]:
    """Rotation backups + previous-run files. The ACTIVE file is never in this list."""
    found: set[Path] = set()
    for path in _files(which):
        found.update(path.parent.glob(f'{path.name}.*'))
        previous = _previous_path(path)
        if previous.exists():
            found.add(previous)
    return sorted(found)


def read(which: str, lines: int, level: str | None, session: str | None) -> list[dict]:
    entries: list[dict] = []
    paths = [path for path in _files(which) if path.exists()]
    for path in paths:
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore').splitlines()
        except OSError:
            continue
        for line in raw[-max(lines * 4, lines):]:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if level and entry.get('level') != level:
                continue
            if session and not str(entry.get('sessionId', '')).startswith(session):
                continue
            entries.append(entry)
    entries.sort(key=lambda item: item.get('ts', ''))
    return entries[-lines:]


def _format(entry: dict) -> str:
    stamp = str(entry.get('ts', ''))[11:23]
    level = str(entry.get('level', 'info')).upper()[:5].ljust(5)
    event = str(entry.get('event', '')).ljust(16)
    session = str(entry.get('sessionId') or '')[:8].ljust(8)
    extra = ' '.join(
        f'{key}={entry[key]}' for key in ('code', 'errorCode', 'tool', 'status', 'durationMs', 'steps') if entry.get(key) is not None
    )
    message = str(entry.get('message') or '')
    return f'{stamp} {level} {event} {session} {extra} {message}'.rstrip()


def _minutes_ago(minutes: float) -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() - minutes * 60))


def reset(which: str) -> int:
    """Owner's rule ("log only while running, reset on shutdown"), applied by hand.

    Same rename as `SystemLog.rotate_on_shutdown()`: active file → `<name>.previous.jsonl`,
    replacing the older previous file. Nothing is deleted, so a manual reset can never
    lose the run that just ended. A file that IS already a previous run (`*.previous.jsonl`)
    is skipped: renaming it would keep two previous generations and dilute the promise that
    exactly one previous file exists.
    """
    for path in _files(which):
        if PREVIOUS_SUFFIX in path.stem:
            continue
        if not path.exists():
            print(f'{path.name}: no active log file', file=sys.stderr)
            continue
        target = _previous_path(path)
        try:
            target.unlink(missing_ok=True)
            path.replace(target)
        except OSError as error:
            print(f'{path.name}: {error}', file=sys.stderr)
            continue
        print(f'{path.name} -> {target.name}')
    return 0


def prune(which: str, days: float, max_mib: float, dry_run: bool = False) -> int:
    """Retention policy of plan §4 item 2. The active file is never touched."""
    try:
        sized = [(path, path.stat()) for path in _recyclable_files(which)]
    except OSError as error:
        print(f'cannot read {LOG_DIR}: {error}', file=sys.stderr)
        return 2

    cutoff = time.time() - days * 86400 if days else None
    doomed = {path for path, stat in sized if cutoff is not None and stat.st_mtime < cutoff}
    kept = [(path, stat) for path, stat in sized if path not in doomed]
    if max_mib:
        # Oldest first, and only the recyclable files: the active log always survives.
        budget = max_mib * 1024 * 1024
        total = sum(stat.st_size for _, stat in kept)
        for path, stat in sorted(kept, key=lambda item: item[1].st_mtime):
            if total <= budget:
                break
            doomed.add(path)
            total -= stat.st_size

    freed = sum(stat.st_size for path, stat in sized if path in doomed)
    for path in sorted(doomed):
        if not dry_run:
            try:
                path.unlink()
            except OSError as error:
                print(f'{path.name}: {error}', file=sys.stderr)
        print(f'{"would remove" if dry_run else "removed"} {path.name}')
    remaining = sum(stat.st_size for path, stat in sized if path not in doomed)
    print(f'{"would keep" if dry_run else "kept"} {len(sized) - len(doomed)} file(s), '
          f'{remaining / 1024 / 1024:.2f} MiB; freed {freed / 1024 / 1024:.2f} MiB '
          f'(policy: {days:g} days / {max_mib:g} MiB)')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Read the BoxFox developer system log.')
    parser.add_argument('command', choices=['tail', 'follow', 'errors', 'summary', 'sessions', 'reset', 'prune'])
    parser.add_argument('--lines', type=int, default=50)
    parser.add_argument('--level', choices=['info', 'warn', 'error'])
    parser.add_argument('--session')
    parser.add_argument('--file', default='harness', choices=['harness', 'router', 'box', 'all'])
    parser.add_argument('--since-minutes', type=float, default=0)
    parser.add_argument('--days', type=float, default=DEFAULT_RETENTION_DAYS,
                        help='prune: keep backups/previous runs newer than this many days (0 = no age policy)')
    parser.add_argument('--max-mib', type=float, default=DEFAULT_MAX_MIB,
                        help='prune: ceiling for the recyclable files, oldest removed first (0 = no size cap)')
    parser.add_argument('--dry-run', action='store_true', help='prune: report without deleting')
    args = parser.parse_args(argv)

    # `reset`/`prune` are about files that may not exist yet, so they run BEFORE the
    # "no log file yet" check below (exit 2 stays the answer for the read commands).
    if args.command == 'reset':
        return reset(args.file)
    if args.command == 'prune':
        return prune(args.file, args.days, args.max_mib, args.dry_run)

    if not any(path.exists() for path in _files(args.file)):
        print(f'No log file yet at {LOG_DIR}/ (expected {{harness,router,box}}.jsonl)', file=sys.stderr)
        return 2

    if args.command == 'follow':
        path = _files(args.file)[0]
        with path.open('r', encoding='utf-8', errors='ignore') as handle:
            handle.seek(0, 2)
            while True:
                line = handle.readline()
                if not line:
                    time.sleep(0.4)
                    continue
                try:
                    print(_format(json.loads(line)), flush=True)
                except ValueError:
                    continue

    if args.command == 'summary':
        entries = read(args.file, 10 ** 6, None, None)
        if args.since_minutes:
            cutoff = _minutes_ago(args.since_minutes)
            entries = [entry for entry in entries if entry.get('ts', '') >= cutoff]
        codes: Counter = Counter(
            entry.get('code')
            or entry.get('errorCode')
            # `turn.tool`/`model` writers put the classified code inside `data`.
            or (entry.get('data') or {}).get('errorCode')
            or 'UNCLASSIFIED'
            for entry in entries
            if entry.get('level') == 'error'
        )
        events: Counter = Counter(entry.get('event') for entry in entries)
        durations: dict[str, list[float]] = defaultdict(list)
        for entry in entries:
            if entry.get('durationMs') is not None and entry.get('event'):
                durations[entry['event']].append(float(entry['durationMs']))
        print(f'entries={len(entries)}  window={"all" if not args.since_minutes else f"{args.since_minutes:g}m"}')
        print('events: ' + ', '.join(f'{name} x{count}' for name, count in events.most_common(12)))
        if codes:
            print('failure codes: ' + ', '.join(f'{code} x{count}' for code, count in codes.most_common(12)))
        for name, values in sorted(durations.items()):
            values.sort()
            middle = values[len(values) // 2]
            print(f'  {name}: n={len(values)} p50={middle:.0f}ms max={values[-1]:.0f}ms')
        return 0

    if args.command == 'sessions':
        entries = read(args.file, args.lines, None, None)
        seen: dict[str, dict] = {}
        for entry in entries:
            sid = entry.get('sessionId')
            if not sid:
                continue
            record = seen.setdefault(sid, {'events': 0, 'errors': 0, 'model': None, 'start': entry.get('ts'), 'end': entry.get('ts')})
            record['events'] += 1
            record['end'] = entry.get('ts')
            if entry.get('level') == 'error':
                record['errors'] += 1
                record.setdefault('firstCode', entry.get('code') or entry.get('errorCode'))
            record['model'] = entry.get('model') or record['model']
        for sid, record in sorted(seen.items(), key=lambda item: item[1]['end'], reverse=True)[:30]:
            line = f'{sid[:8]}  events={record["events"]:4d}  errors={record["errors"]}  model={record["model"] or "-"}'
            if record.get('firstCode'):
                line += f'  first={record["firstCode"]}'
            print(line)
        return 0

    level = 'error' if args.command == 'errors' else args.level
    entries = read(args.file, args.lines, level, args.session)
    for entry in entries:
        print(_format(entry))
    if not entries:
        print('(no entries matched)', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
