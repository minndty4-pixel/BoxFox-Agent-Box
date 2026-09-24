#!/usr/bin/env python3
"""Ghi NĂM SỐ của một ca research R1–R12 vào sổ điểm thô — offline, không gọi mạng.

Đây là phần "ghi số" của tầng R (`docs/plan/v27/subplans/flow.md` §7.3):

* đọc **phòng hồ sơ** `.research/` của một lượt (thư mục con `<việc>/v<N>-<việc>.md` +
  `sources.jsonl`/`sources.md` + `tables/*.md` + `review.md`, do op `dossier_write` ghi ra);
* đọc **nhật ký event** của lượt (tuỳ chọn) để chấm phần "đã đọc thật" của oracle;
* chạy `research_checks.quality_numbers` lấy năm số của §7.3, và — khi có `--checks` — chạy
  đúng những oracle máy mà ca đó cần (`rubric.RESEARCH_CASE_CHECKS`);
* ghi **một dòng JSON** vào sổ điểm thô, kèm ngày đo, đúng lệnh đã chạy, nhãn nguồn và số tệp
  trong phòng — để người đọc sau dựng lại được dòng điểm thay vì phải tin.

Số nào chưa đo được thì `value` là `null` kèm `basis` nói vì sao (không ghi 0 thay cho "chưa
biết"). Sổ điểm là **sổ chỉ ghi thêm**: ghi đè một tệp đã có phải xin `--append` hoặc chọn
`--out` khác.

Cách chạy::

    python3 scripts/eval/research_scores.py --help
    python3 scripts/eval/research_scores.py \\
        --workspace <thư mục có .research/> --log <events.jsonl> --case R1 --checks --append

Mã thoát: ``0`` xong, ``1`` có `--checks` và một oracle trượt, ``2`` sai cách dùng (thiếu
`--workspace`/`--case`, không thấy phòng hồ sơ, `--out` đã tồn tại mà không `--append`…).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import research_checks  # noqa: E402
import rubric  # noqa: E402

RESEARCH_CASES: tuple = tuple(rubric.RESEARCH_CASE_CHECKS)
DEFAULT_OUT = (pathlib.Path(__file__).resolve().parent / 'results' / 'tier-r1-research'
               / 'scores.jsonl')
#: Nhãn mặc định nói thẳng dòng điểm này KHÔNG phải một lượt chạy thật.
DEFAULT_SOURCE = 'CHƯA-CHẠY-LƯỢT-THẬT'
SCHEMA_VERSION = 'research-scores-v1'

EXIT_OK, EXIT_FAILED, EXIT_USAGE = 0, 1, 2


def unwrap_event(item: dict) -> dict:
    """Một hàng event -> hình dạng oracle đọc được; hàng đã đúng hình dạng thì giữ nguyên.

    `session_store.events()` trả `{'seq', 'type', 'data', 'created'}` còn `research_checks`
    đọc `{'kind': …, 'payload': …}` (bảng event của harness) — thiếu phép bóc này thì
    `tool_calls()` bỏ qua sạch nhật ký thật và mọi oracle theo nhật ký sẽ trượt oan.
    """
    if 'kind' in item or 'name' in item:
        return item
    kind = item.get('type')
    if not kind:
        return item
    payload = item.get('data')
    return {'kind': str(kind), 'payload': payload if isinstance(payload, dict) else {}}


def load_events(path) -> list:
    """Đọc JSONL nhật ký của lượt; dòng hỏng ⇒ `ValueError` kèm số dòng (không đoán hộ)."""
    rows: list = []
    text = pathlib.Path(path).read_text(encoding='utf-8', errors='replace')
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except ValueError as exc:
            raise ValueError(f'{path}:{number}: dòng không phải JSON ({exc})') from exc
        if not isinstance(item, dict):
            raise ValueError(f'{path}:{number}: mỗi dòng nhật ký phải là một đối tượng JSON')
        rows.append(unwrap_event(item))
    return rows


def number_text(entry: dict) -> str:
    """Một số của §7.3 thành chữ một dòng: giá trị (hoặc `chưa đo`) + `basis` + chi tiết."""
    value = entry.get('value')
    shown = 'chưa đo' if value is None else str(value)
    return f'{shown:>8}  {entry.get("basis", "")} — {entry.get("detail", "")}'


def render_report(case: str, level: int, level_source: str, source: str, numbers: dict,
                  checks, out: pathlib.Path, appended: bool) -> str:
    """Bản người đọc của dòng điểm vừa ghi — cùng dữ liệu, khác hình dạng."""
    lines = [f'Ca {case} · mức {level} ({level_source}) · nhãn nguồn: {source}']
    for name in research_checks.FIVE_NUMBERS:
        lines.append(f'  {name:18s} {number_text(numbers[name])}')
    if checks is None:
        lines.append('  oracle: không chạy (thiếu --checks)')
    else:
        failed = [item for item in checks if not item['ok']]
        lines.append(f'  oracle: {len(checks) - len(failed)}/{len(checks)} đạt')
        for item in checks:
            mark = 'đạt' if item['ok'] else 'TRƯỢT'
            lines.append(f'    - {item["name"]}: {mark} — {item["detail"]}')
    lines.append(f'  đã {"ghi nối" if appended else "ghi"} 1 dòng vào {out}')
    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Ghi năm số của một ca research R1–R12 (offline, không gọi model, không mạng).')
    parser.add_argument('--workspace', required=True,
                        help='thư mục workspace của lượt: chỗ chứa `.research/` của hồ sơ')
    parser.add_argument('--log', default=None,
                        help='JSONL event của lượt (như session_store.events() trả về) — tuỳ chọn')
    parser.add_argument('--case', required=True,
                        help=f'ca research, ví dụ R1; đang có: {", ".join(RESEARCH_CASES)}')
    parser.add_argument('--level', type=int, default=None, choices=(1, 2, 3),
                        help='mức 1/2/3 của việc; bỏ trống thì đọc `Level:` trong header hồ sơ')
    parser.add_argument('--checks', action='store_true',
                        help='chạy thêm oracle máy của ca này và ghi kết quả vào dòng điểm')
    parser.add_argument('--out', default=str(DEFAULT_OUT),
                        help='đường dẫn sổ điểm (mặc định '
                             'scripts/eval/results/tier-r1-research/scores.jsonl)')
    parser.add_argument('--append', action='store_true',
                        help='ghi nối một dòng vào sổ điểm đã có (tạo thư mục nếu cần)')
    parser.add_argument('--source', default=DEFAULT_SOURCE,
                        help='nhãn nguồn của dòng điểm; lượt thật thì ghi tên phiên/lượt')
    args = parser.parse_args(argv)

    case = str(args.case).strip().upper()
    if case not in RESEARCH_CASES:
        print(f'không có ca {args.case!r}; bộ ca hiện có: {", ".join(RESEARCH_CASES)}',
              file=sys.stderr)
        return EXIT_USAGE

    workspace = pathlib.Path(args.workspace).expanduser()
    if not workspace.is_dir():
        print(f'--workspace không phải thư mục: {workspace}', file=sys.stderr)
        return EXIT_USAGE
    room = research_checks.room_root(workspace)
    if not room.is_dir():
        print(f'không thấy phòng hồ sơ `{research_checks.ROOM_DIR}/` trong {workspace} — '
              '--workspace phải là thư mục chứa nó', file=sys.stderr)
        return EXIT_USAGE

    records: list = []
    log_path = None
    if args.log:
        log_path = pathlib.Path(args.log).expanduser()
        if not log_path.is_file():
            print(f'--log không phải tệp: {log_path}', file=sys.stderr)
            return EXIT_USAGE
        try:
            records = load_events(log_path)
        except ValueError as exc:
            print(f'nhật ký không đọc được: {exc}', file=sys.stderr)
            return EXIT_USAGE

    out = pathlib.Path(args.out).expanduser()
    if out.exists() and not args.append:
        print(f'{out} đã có — sổ điểm là sổ chỉ ghi thêm: thêm --append hoặc chọn --out khác',
              file=sys.stderr)
        return EXIT_USAGE

    if args.level is not None:
        level, level_source = int(args.level), 'cờ --level'
    else:
        level = research_checks.room_level(workspace)
        has_header_level = any(header['level'] for _, header in research_checks.headers_of(workspace))
        level_source = 'header hồ sơ' if has_header_level else \
            f'mức mặc định {research_checks.LEVEL_DEFAULT} (hồ sơ không ghi `Level:`)'

    numbers = research_checks.quality_numbers(room=workspace, records=records, level=level)
    checks = None
    if args.checks:
        checks = research_checks.run_checks(rubric.RESEARCH_CASE_CHECKS[case], room=workspace,
                                            records=records)

    line = {
        'schemaVersion': SCHEMA_VERSION,
        'case': case,
        'level': level,
        'levelSource': level_source,
        'measuredAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'command': ' '.join([sys.executable, *sys.argv]),
        'source': args.source,
        'workspace': str(workspace),
        'log': str(log_path) if log_path else None,
        'workspaceFiles': len(research_checks.room_files(workspace)),
        'checks': checks,
        'numbers': {name: numbers[name] for name in research_checks.FIVE_NUMBERS},
    }

    print(render_report(case, level, level_source, args.source, numbers, checks, out, args.append))
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.append:
        with out.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(line, ensure_ascii=False) + '\n')
    else:
        out.write_text(json.dumps(line, ensure_ascii=False) + '\n', encoding='utf-8')

    if checks is not None and any(not item['ok'] for item in checks):
        print('một oracle đã trượt — dòng điểm vẫn được ghi, nhưng lượt này chưa đạt ca',
              file=sys.stderr)
        return EXIT_FAILED
    return EXIT_OK


if __name__ == '__main__':
    raise SystemExit(main())
