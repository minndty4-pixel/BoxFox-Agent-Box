"""Read the developer system log (`~/BoxFox/logs/harness.jsonl`).

The log lives on the HOST, outside the sandbox, so the agent inside the box can
never read it. This CLI is the developer's entry point.

Usage:
    python scripts/system-log.py tail [--lines 50] [--level error] [--session <sid>] [--file harness|router]
    python scripts/system-log.py follow [--file harness]
    python scripts/system-log.py errors [--lines 20] [--since-minutes 60]
    python scripts/system-log.py summary [--since-minutes 1440]
    python scripts/system-log.py sessions [--lines 200]

Exit code is 0 on success and 2 when the requested log file does not exist yet.
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


def _files(which: str) -> list[Path]:
    if which == 'all':
        return sorted(LOG_DIR.glob('*.jsonl'))
    return [LOG_DIR / f'{which}.jsonl']


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Read the BoxFox developer system log.')
    parser.add_argument('command', choices=['tail', 'follow', 'errors', 'summary', 'sessions'])
    parser.add_argument('--lines', type=int, default=50)
    parser.add_argument('--level', choices=['info', 'warn', 'error'])
    parser.add_argument('--session')
    parser.add_argument('--file', default='harness', choices=['harness', 'router', 'box', 'all'])
    parser.add_argument('--since-minutes', type=float, default=0)
    args = parser.parse_args(argv)

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
