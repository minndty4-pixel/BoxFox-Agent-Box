#!/usr/bin/env python3
"""Thước đo tay cho lớp đọc nguồn (vòng 27 · Phạm vi A) — KHÔNG vào CI, chỉ chạy khi có mạng.

In một bảng `nhãn · status · textChars · junkRatio · reader · verdict · giây` rồi thoát khác 0 khi
một ngưỡng ĐÃ CHỐT bị phá. Đây là công cụ để chủ nhà tự đo lại khi nghi ngờ, và để sinh số cho
`docs/tracking/test-rounds.md`. Không cần harness, không cần box: gọi thẳng `WebTools` của host.

    ./.venv/bin/python scripts/probe-reading.py                 # chạy hết
    ./.venv/bin/python scripts/probe-reading.py --only gzip
    ./.venv/bin/python scripts/probe-reading.py --only gzip reader --json /var/tmp/reading.json

Nhóm `store` (bộ đệm đọc + `read_source`) chỉ có nghĩa sau đợt 2; chạy `--only store` trước lúc đó
sẽ báo "chưa có" chứ không giả vờ đã đo.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend/src'))

from agentbox.agent_core.web import WebError, WebTools  # noqa: E402

# Ngưỡng ĐÃ CHỐT — số ở đây là số đo ngày 2026-09-23 (xem docs/tracking/test-rounds.md §vòng 27).
# Đổi ngưỡng thì phải sửa cả tài liệu, vì đó là một quyết định chứ không phải một chi tiết mã.
GROUPS: dict[str, list[dict]] = {
    'gzip': [
        {'label': 'nhandan.vn', 'url': 'https://nhandan.vn/',
         'minChars': 2000, 'maxJunk': 0.05, 'expectVerdict': ('ok', 'thin'), 'minTables': 0},
        {'label': 'vanban.chinhphu.vn', 'url': 'https://vanban.chinhphu.vn/',
         'minChars': 2000, 'maxJunk': 0.05, 'expectVerdict': ('ok', 'thin'), 'minTables': 0},
        {'label': 'vietnamplus.vn', 'url': 'https://www.vietnamplus.vn/',
         'minChars': 2000, 'maxJunk': 0.05, 'expectVerdict': ('ok', 'thin'), 'minTables': 0},
    ],
    'reader': [
        # 403 ở bản trực tiếp. Plan A-3 từng kỳ vọng đầu đọc cứu được ≥ 20 000 ký tự (đo 91 032
        # byte ngày 2026-09-23). ĐO LẠI cùng ngày, muộn hơn: `r.jina.ai` KHÔNG khoá nhận đúng
        # trang chặn bot 281 ký tự ("Performing security verification") ⇒ ngưỡng 20 000 không
        # còn đứng được, và đó là thay đổi của dịch vụ bên ngoài, không phải của mã.
        # Bất biến giữ được và phải đo: chủ nhà 403 KHÔNG BAO GIỜ ra `ok`.
        {'label': 'thuvienphapluat.vn (403)', 'url': 'https://thuvienphapluat.vn/van-ban/Doanh-nghiep/Luat-Doanh-nghiep-2020-472429.aspx',
         'forbidVerdict': ('ok', 'junk'), 'expectVerdict': ('error-page', 'thin'), 'maxJunk': 0.05},
        # Trang trả về "Trang chủ" cho một URL văn bản: KHÔNG được coi là đọc thành công.
        {'label': 'vbpl.vn (trang chủ)', 'url': 'https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=1',
         'forbidVerdict': ('ok',), 'maxJunk': 0.05},
        # Đầu đọc trả "Warning: … not yet fully loaded": phải ra `error-page`, không ra `ok`.
        {'label': 'moh.gov.vn (đang tải)', 'url': 'https://moh.gov.vn/',
         'forbidVerdict': ('ok',), 'maxJunk': 0.05},
    ],
    'papers': [
        # PDF arXiv: trước đợt 1 chỉ ra chuỗi `%PDF-1.4…`; nay phải dựng lại được chữ + bảng.
        {'label': 'arxiv PDF 1706.03762v7', 'url': 'https://arxiv.org/pdf/1706.03762v7',
         'minChars': 30000, 'maxJunk': 0.05, 'minTables': 5, 'expectTier': 'pdf-table',
         'expectReader': None},
        # HTML arXiv (bản toàn văn): bảng nằm trong thân bài ⇒ phải giữ được. Trang tóm tắt
        # `/abs/…` chỉ có 1 bảng (đo 2026-09-23) nên KHÔNG dùng nó làm ngưỡng.
        {'label': 'arxiv HTML 1706.03762v7', 'url': 'https://arxiv.org/html/1706.03762v7',
         'minChars': 20000, 'maxJunk': 0.05, 'minTables': 5},
        # Europe PMC fullTextXML (JATS). Phải chọn bài CÓ bảng: PMC3258128 không có `<table-wrap>` nào
        # (đo 2026-09-23) nên nhánh JATS không chạy và tầng ra `html` — lỗi ở mẫu đo, không ở mã.
        # PMC7090843 có 10 `<table-wrap>` lồng nhau (5 khối mức ngoài; đo 2026-09-23).
        {'label': 'Europe PMC JATS', 'url': 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7090843/fullTextXML',
         'minChars': 5000, 'maxJunk': 0.05, 'minTables': 5, 'expectTier': 'jats'},
    ],
    'search': [
        # Nền tìm kiếm không khoá: đo số kết quả, không đo chất lượng (đợt 2 mới gộp nhiều chân).
        {'label': 'web_search (firecrawl)', 'source': 'web', 'query': 'bảo hiểm y tế chuyển tuyến',
         'minResults': 1},
        {'label': 'web_search (wikipedia)', 'source': 'wikipedia', 'query': 'bảo hiểm y tế',
         'minResults': 1},
    ],
}
# Nguồn mặc định cho nhóm `store`: chỉ có sau A-4 (đợt 2).
STORE_READY = hasattr(WebTools, 'read_source')


def measure_fetch(tools: WebTools, target: dict) -> dict:
    started = time.time()
    row = {'label': target['label'], 'url': target['url'], 'group': 'fetch'}
    try:
        payload = tools.fetch({'url': target['url'], 'maxChars': 20000})
    except WebError as exc:
        # Đích không trả lời KHÔNG phải là "đạt ngưỡng": không có số đo thì không có gì để so.
        row |= {'seconds': round(time.time() - started, 2), 'error': str(exc)[:300],
                'problems': ['lỗi — không đo được']}
        return row
    quality = payload.get('quality') or {}
    row |= {
        'seconds': round(time.time() - started, 2),
        'status': payload.get('status'),
        'textChars': payload.get('textChars'),
        'junkRatio': quality.get('junkRatio'),
        'verdict': quality.get('verdict'),
        'reader': payload.get('reader'),
        'readerReason': payload.get('readerReason'),
        'readTier': payload.get('readTier'),
        'tables': payload.get('tables'),
        'contentEncoding': payload.get('contentEncoding'),
        'decoded': payload.get('decoded'),
        'partial': payload.get('partial'),
    }
    problems = []
    if target.get('minChars') is not None and (row['textChars'] or 0) < target['minChars']:
        problems.append(f"textChars {row['textChars']} < {target['minChars']}")
    if target.get('maxJunk') is not None and (row['junkRatio'] or 0) > target['maxJunk']:
        problems.append(f"junkRatio {row['junkRatio']} > {target['maxJunk']}")
    if target.get('minTables') is not None and (row['tables'] or 0) < target['minTables']:
        problems.append(f"tables {row['tables']} < {target['minTables']}")
    if target.get('expectVerdict') and row['verdict'] not in target['expectVerdict']:
        problems.append(f"verdict {row['verdict']} không thuộc {target['expectVerdict']}")
    if target.get('forbidVerdict') and row['verdict'] in target['forbidVerdict']:
        problems.append(f"verdict {row['verdict']} bị cấm (đây là 'thành công giả' đã đo được)")
    if 'expectReader' in target and row['reader'] != target['expectReader']:
        problems.append(f"reader {row['reader']!r} != {target['expectReader']!r}")
    if target.get('expectTier') and row['readTier'] != target['expectTier']:
        problems.append(f"readTier {row['readTier']!r} != {target['expectTier']!r}")
    row['problems'] = problems
    return row


def measure_search(tools: WebTools, target: dict) -> dict:
    started = time.time()
    row = {'label': target['label'], 'group': 'search'}
    try:
        payload = tools.search({'query': target['query'], 'source': target['source']})
    except WebError as exc:
        row |= {'seconds': round(time.time() - started, 2), 'error': str(exc)[:300], 'problems': ['lỗi']}
        return row
    results = payload.get('results') or []
    row |= {'seconds': round(time.time() - started, 2), 'results': len(results),
            'source': payload.get('source') or target['source']}
    row['problems'] = ([] if len(results) >= target.get('minResults', 1)
                       else [f"results {len(results)} < {target['minResults']}"])
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', nargs='*', choices=[*GROUPS, 'store'],
                        help='chỉ chạy nhóm này (mặc định: hết)')
    parser.add_argument('--json', help='ghi số đo ra tệp JSON')
    args = parser.parse_args()
    wanted = args.only or list(GROUPS)

    tools = WebTools()
    rows: list[dict] = []
    if 'store' in wanted:
        print('store: bộ đệm đọc + `read_source` là việc của đợt 2 (A-4)' if not STORE_READY
              else 'store: đã có `read_source`')
        wanted = [name for name in wanted if name != 'store']

    for name in wanted:
        for target in GROUPS[name]:
            row = measure_search(tools, target) if name == 'search' else measure_fetch(tools, target)
            rows.append(row)
            print(f"{row['label']:34s} status={str(row.get('status')):>5s} "
                  f"chars={str(row.get('textChars') or row.get('results')):>7s} "
                  f"junk={str(row.get('junkRatio')):>6s} reader={str(row.get('reader')):>12s} "
                  f"verdict={str(row.get('verdict')):>11s} {row['seconds']}s"
                  + (f"  ⚠ {'; '.join(row['problems'])}" if row.get('problems') else ''))

    broken = [row for row in rows if row.get('problems')]
    failed = [row for row in rows if row.get('error')]
    print(f"\n{len(rows) - len(broken)}/{len(rows)} đạt ngưỡng"
          f" — đo được {len(rows) - len(failed)}/{len(rows)} dòng, "
          f"{len(failed)} dòng lỗi tính là hỏng")
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(rows, ensure_ascii=False, indent=1))
        print(f'ghi {args.json}')
    return 1 if broken else 0


if __name__ == '__main__':
    raise SystemExit(main())
