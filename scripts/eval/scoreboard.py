"""Write `docs/tracking/eval-<benchmark>.md` from a raw results directory.

Benchmark plan §6 makes three demands of a scoreboard, and all three are code
here, not promises:

* "có manifest cho mỗi lượt chạy" — the table is rendered from `manifest.json`;
* "bảng điểm tính lại được từ dữ liệu thô" — every number is computed from
  `scores.jsonl` / `cases.jsonl`, and `--verify` re-renders and compares byte for
  byte, so drift is detectable in CI;
* "báo cáo ghi rõ lượt chạy hỏng, ca bị bỏ, và mọi thứ chưa xác minh" — the
  document has a "chưa đo" list built from the data, and infrastructure failures
  are listed in their own section (§6: they must not enter the quality score).

The document carries no render timestamp on purpose: a scoreboard that changes
when nothing was measured is not recomputable.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rubric  # noqa: E402

SCORES_FILE = 'scores.jsonl'
CASES_FILE = 'cases.jsonl'
MANIFEST_FILE = 'manifest.json'

CHUA_DO = 'chưa đo'


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def read_results(results_dir: str | Path) -> dict:
    """Everything the writer needs, read from disk only."""
    results_dir = Path(results_dir)
    manifest_path = results_dir / MANIFEST_FILE
    return {
        'dir': str(results_dir),
        'manifest': json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest_path.exists() else {},
        'rows': read_jsonl(results_dir / SCORES_FILE),
        'cases': read_jsonl(results_dir / CASES_FILE),
    }


def scored_rows(rows: list[dict]) -> list[dict]:
    """Turn raw score rows into rubric rows; refuse rows that are not scored."""
    out = []
    for row in rows:
        scores = row.get('scores')
        if not isinstance(scores, dict):
            raise ValueError(f"dòng thiếu 'scores': {row.get('id')}")
        evaluated = rubric.evaluate(scores, outcome=str(row.get('outcome') or 'quality'))
        evaluated['label'] = row.get('label') or row.get('id') or CHUA_DO
        evaluated['cost'] = row.get('cost') or {}
        out.append(evaluated)
    return out


def agreement_pairs(rows: list[dict]) -> list[dict]:
    pairs = []
    for row in rows:
        judge = row.get('judge') or {}
        if isinstance(judge.get('first'), dict) and isinstance(judge.get('second'), dict):
            pairs.append({'first': judge['first'], 'second': judge['second']})
    return pairs


def _value(value, suffix: str = '') -> str:
    if value is None:
        return CHUA_DO
    return f'{value}{suffix}'


def manifest_table(manifest: dict) -> list[str]:
    """The pin table from benchmark plan §4.1, verbatim keys, honest gaps."""
    pins = manifest.get('pins') or {}
    repo = pins.get('repo') or {}
    image = pins.get('image') or {}
    prompts = pins.get('prompts') or {}
    judge = prompts.get('judge') or {}
    tool_schema = pins.get('toolSchema') or {}
    lines = ['| Hạng mục phải ghim | Giá trị |', '|---|---|']
    lines.append(f"| Benchmark + phiên bản | {(manifest.get('benchmark') or {}).get('name', CHUA_DO)} "
                 f"{(manifest.get('benchmark') or {}).get('version', '')} |")
    lines.append(f"| Commit BoxFox | {_value(repo.get('commit'))} "
                 f"({'cây làm việc BẨN: ' + str(repo.get('dirtyFileCount')) + ' tệp chưa commit' if repo.get('dirty') else 'cây sạch'}) |")
    image_ref = image.get('ref') or ('không có ảnh nào được ghi vào manifest' if not image.get('digest')
                                     else CHUA_DO)
    lines.append(f"| Ảnh container (digest) | {_value(image.get('digest'))} ({image_ref}) |")
    lines.append(f"| Provider / model | {_value(pins.get('provider'))} / {_value(pins.get('model'))} |")
    lines.append(f"| Prompt giám khảo | {_value(judge.get('version'))} "
                 f"sha256 {str(judge.get('sha256'))[:12] if judge.get('sha256') else CHUA_DO} |")
    roles = prompts.get('agentRoles') or {}
    lines.append(f"| Prompt agent (roles.py) | sha256 "
                 f"{str(roles.get('sha256'))[:12] if roles.get('sha256') else CHUA_DO} |")
    lines.append(f"| Schema công cụ | {tool_schema.get('path', CHUA_DO)} sha256 "
                 f"{str(tool_schema.get('sha256'))[:12] if tool_schema.get('sha256') else CHUA_DO} |")
    lines.append(f"| Seed / temperature | {_value(pins.get('seed'))} / {_value(pins.get('temperature'))} |")
    lines.append(f"| Trần bước / hạn | {_value(pins.get('maxSteps'))} bước / "
                 f"{_value(pins.get('deadlineSeconds'), ' s')} |")
    lines.append(f"| Điều kiện mạng | {_value(pins.get('network'))} |")
    lines.append(f"| Trạng thái firewall | {_value(pins.get('firewall'))} |")
    runtime = pins.get('runtime') or {}
    lines.append(f"| Python / hệ | {_value(runtime.get('python'))} / {_value(runtime.get('system'))} |")
    return lines


def cost_table(manifest: dict) -> list[str]:
    cost = manifest.get('cost') or {}
    lines = ['| Chi phí thật (§4.4) | Giá trị |', '|---|---|']
    lines.append(f"| Token vào | {_value(cost.get('tokensIn'))} |")
    lines.append(f"| Token ra | {_value(cost.get('tokensOut'))} |")
    lines.append(f"| Thời gian tường | {_value(cost.get('wallTimeMs'), ' ms')} |")
    lines.append(f"| Số bước | {_value(cost.get('steps'))} |")
    lines.append(f"| Số lần retry | {_value(cost.get('retries'))} |")
    lines.append(f"| Nguồn | {cost.get('source', CHUA_DO)} |")
    return lines


def metrics_section(rows: list[dict], pairs: list[dict]) -> list[str]:
    summary = rubric.summarize(rows, pairs)
    lines = ['## Chỉ số (§6)', '']
    rate = summary['passRate']
    lines.append('| Chỉ số | Giá trị |')
    lines.append('|---|---|')
    lines.append(f"| Pass rate (điều kiện cứng + tổng ≥ 9) | "
                 f"{rate['passed']}/{rate['total']}"
                 + (f" = {rate['rate']}" if rate['rate'] is not None else f" ({CHUA_DO})") + ' |')
    lines.append(f"| Điểm trung bình toàn bài (0-16) | {_value(summary['averageTotal'])}"
                 + (f" ± {summary['totalStdev']}" if summary['totalStdev'] is not None else '') + ' |')
    lines.append(f"| Kiểm chứng (C3 ≥ 1) | {_value(summary['verificationRate'])} |")
    agree = summary['judgeAgreement']
    lines.append(f"| Đồng thuận giám khảo (lệch ≤ {rubric.JUDGE_AGREEMENT_TOLERANCE} điểm) | "
                 f"{agree['agree']}/{agree['total']}"
                 + (f" = {agree['rate']}" if agree['rate'] is not None else f" ({CHUA_DO})") + ' |')
    lines.append(f"| Ca hỏng vì hạ tầng (ghi riêng, không vào điểm chất lượng) | "
                 f"{len(summary['infrastructureRows'])} |")
    lines.append('')
    lines.append('| Chiều | Trung bình | Độ lệch | n |')
    lines.append('|---|---|---|---|')
    for code in rubric.DIMENSION_CODES:
        item = summary['dimensions'][code]
        lines.append(f"| {code} — {rubric.DIMENSION_BY_CODE[code]['name']} | {_value(item['mean'])} | "
                     f"{_value(item['stdev'])} | {item['n']} |")
    if agree['needsThirdPass']:
        lines.append('')
        lines.append(f"Ca cần chấm lần ba (lệch > {rubric.JUDGE_AGREEMENT_TOLERANCE} điểm): "
                     + ', '.join(str(index) for index in agree['needsThirdPass']))
    return lines


def cases_section(cases: list[dict]) -> list[str]:
    lines = ['## Ca chạy được (benchmark hồi quy)', '']
    lines.append('| Ca | Lệnh / nguồn | Kết quả | Thời gian | Ghi chú |')
    lines.append('|---|---|---|---|---|')
    for case in cases:
        status = case.get('status', CHUA_DO)
        counts = []
        for key, label in (('passed', 'pass'), ('failed', 'fail'), ('skipped', 'skip'), ('errors', 'error')):
            if case.get(key) is not None:
                counts.append(f"{case[key]} {label}")
        result = f"{status}" + (f" ({', '.join(counts)})" if counts else '')
        lines.append(f"| {case.get('id', CHUA_DO)} | {case.get('command', CHUA_DO)} | {result} | "
                     f"{_value(case.get('durationMs'), ' ms')} | {case.get('note', '')} |")
    return lines


def failures_section(rows: list[dict], cases: list[dict]) -> list[str]:
    lines = ['## Ca hỏng và lý do hỏng (§6)', '']
    broken = [case for case in cases if case.get('status') not in ('pass', 'ok')]
    failed_rows = [row for row in rows if not row['infrastructure'] and not row['pass']]
    if not broken and not failed_rows:
        lines.append('Không có ca hỏng nào trong dữ liệu thô.')
        return lines
    lines.append('| Ca | Loại hỏng | Lý do |')
    lines.append('|---|---|---|')
    for case in broken:
        lines.append(f"| {case.get('id')} | hồi quy | {case.get('note') or case.get('status')} |")
    for row in failed_rows:
        reasons = []
        if not row['hardGate']:
            reasons.append('điều kiện cứng: C2/C7 = 0')
        if row['total'] < rubric.PASS_MIN_TOTAL:
            reasons.append(f"tổng {row['total']} < {rubric.PASS_MIN_TOTAL}")
        lines.append(f"| {row.get('label', CHUA_DO)} | chất lượng | {'; '.join(reasons)} |")
    return lines


def infrastructure_section(rows: list[dict]) -> list[str]:
    infra = [row for row in rows if row['infrastructure']]
    lines = ['## Lượt hỏng vì hạ tầng (KHÔNG tính vào điểm chất lượng, §6)', '']
    if not infra:
        lines.append('Không có lượt nào bị ghi là hỏng hạ tầng trong dữ liệu thô.')
        return lines
    lines.append('| Ca | Loại | Điểm thô (chỉ để tra cứu) |')
    lines.append('|---|---|---|')
    for row in infra:
        lines.append(f"| {row.get('label', CHUA_DO)} | {row['outcome']} | {row['total']} |")
    return lines


def unverified_section(manifest: dict, rows: list[dict], cases: list[dict]) -> list[str]:
    lines = ['## Chưa xác minh', '']
    items: list[str] = []
    for name in manifest.get('missingPins') or []:
        items.append(f'- Manifest thiếu trường: `{name}`')
    for key, cost in (('tokensIn', 'token vào'), ('tokensOut', 'token ra'), ('wallTimeMs', 'thời gian tường'),
                      ('steps', 'số bước')):
        if (manifest.get('cost') or {}).get(key) is None:
            items.append(f'- Chi phí thật chưa đo: {cost}')
    if not rows:
        items.append('- Không có dòng điểm nào: bảng chất lượng chưa có số')
    if not cases:
        items.append('- Không có dòng ca hồi quy nào')
    if not items:
        items.append('- Không còn trường nào bỏ trống trong dữ liệu thô (kiểm bằng mắt vẫn cần)')
    return lines + items


def build_document(results: dict, *, benchmark: str) -> str:
    manifest = results.get('manifest') or {}
    rows = scored_rows(results.get('rows') or [])
    cases = results.get('cases') or []
    name = benchmark or (manifest.get('benchmark') or {}).get('name') or 'chua-dat-ten'
    lines = [f'# Bảng điểm eval — {name}', '']
    lines.append(f"> Sinh bằng `python scripts/eval/scoreboard.py --results {results['dir']}`.")
    lines.append('> Tính lại được từ dữ liệu thô trong thư mục đó: chạy `--verify` để so từng ký tự.')
    lines.append('> Mọi số liệu chưa đo ghi `chưa đo`; không suy đoán (kế hoạch chất lượng §9.4).')
    lines.append('')
    lines.append('## Manifest của lượt chạy')
    lines.append('')
    lines.extend(manifest_table(manifest))
    lines.append('')
    lines.extend(cost_table(manifest))
    lines.append('')
    if rows:
        lines.extend(metrics_section(rows, agreement_pairs(results.get('rows') or [])))
        lines.append('')
    else:
        lines.append('## Chỉ số (§6)')
        lines.append('')
        lines.append(f'CHƯA ĐO: chưa có dòng điểm nào trong `{SCORES_FILE}`.')
        lines.append('')
    if cases:
        lines.extend(cases_section(cases))
        lines.append('')
    lines.extend(failures_section(rows, cases))
    lines.append('')
    lines.extend(infrastructure_section(rows))
    lines.append('')
    lines.extend(unverified_section(manifest, rows, cases))
    lines.append('')
    return '\n'.join(lines)


def write_scoreboard(path: str | Path, text: str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Sinh bảng điểm docs/tracking/eval-<benchmark>.md từ thư mục kết quả thô.')
    parser.add_argument('--results', required=True, help='thư mục kết quả thô (manifest.json + *.jsonl)')
    parser.add_argument('--out', default=None, help='tệp .md cần ghi (mặc định: in ra stdout)')
    parser.add_argument('--benchmark', default=None, help='tên benchmark (mặc định: lấy từ manifest)')
    parser.add_argument('--verify', action='store_true',
                        help='so lại với --out: khác một ký tự là thoát mã 1')
    args = parser.parse_args(argv)

    results = read_results(args.results)
    text = build_document(results, benchmark=args.benchmark)

    if args.verify:
        if not args.out:
            print('--verify cần --out để biết so với tệp nào', file=sys.stderr)
            return 2
        current = Path(args.out).read_text(encoding='utf-8') if Path(args.out).exists() else ''
        if current == text:
            print(f'khớp: {args.out} tính lại được từ {args.results}')
            return 0
        print(f'LỆCH: {args.out} không khớp dữ liệu thô trong {args.results}', file=sys.stderr)
        print(f'  trên đĩa {len(current)} ký tự, tính lại {len(text)} ký tự', file=sys.stderr)
        return 1
    if args.out:
        write_scoreboard(args.out, text)
        print(f'đã ghi {args.out} ({len(text)} ký tự) từ {args.results}')
    else:
        print(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
