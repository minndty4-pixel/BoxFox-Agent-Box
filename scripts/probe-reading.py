#!/usr/bin/env python3
"""Thước đo tay cho lớp đọc nguồn (vòng 27 · Phạm vi A) — KHÔNG vào CI, chỉ chạy khi có mạng.

In một bảng `nhãn · status · textChars · junkRatio · reader · verdict · giây` rồi thoát khác 0 khi
một ngưỡng ĐÃ CHỐT bị phá. Đây là công cụ để chủ nhà tự đo lại khi nghi ngờ, và để sinh số cho
`docs/tracking/test-rounds.md`. Không cần harness, không cần box: gọi thẳng `WebTools` của host.

    ./.venv/bin/python scripts/probe-reading.py                 # chạy hết
    ./.venv/bin/python scripts/probe-reading.py --only gzip
    ./.venv/bin/python scripts/probe-reading.py --only gzip reader --json /var/tmp/reading.json

Nhóm `store` (bộ đệm đọc + `read_source`) có từ đợt 2 (A-4): nó tải một trang DÀI rồi ghép các mẩu
lại, phải bằng đúng số ký tự đã lưu. Chạy trên cây chưa có A-4 thì nhóm này báo "chưa có" chứ không
giả vờ đã đo.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend/src'))

from agentbox.agent_core.reading import normalize_url  # noqa: E402
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
        {'label': 'web_search (firecrawl)', 'source': 'web', 'query': 'bảo hiểm y tế chuyển tuyến',
         'minResults': 1},
        {'label': 'web_search (wikipedia)', 'source': 'wikipedia', 'query': 'bảo hiểm y tế',
         'minResults': 1},
        # A-7: hai truy vấn keyless gộp lại, khử trùng theo URL chuẩn hoá, và lời gọi LẶP phải ăn cache.
        # Ngưỡng 6 kết quả là ngưỡng nghiệm thu đã chốt trong plan (§7).
        # Ngưỡng CỨNG ở đây là hình dạng của mã (2 truy vấn chạy, 0 URL trùng, lời gọi lặp ăn cache),
        # còn con số "≥ 6 kết quả" của plan đã đo được lúc 23:15 UTC ngày 2026-09-23 (10 kết quả).
        # Chân keyless bị GIỚI HẠN NHỊP (đo lại lúc 23:19: hai lượt bị từ chối 429) nên lấy 6 làm
        # ngưỡng cứng sẽ biến một thay đổi của dịch vụ bên ngoài thành "hồng quy" của mã.
        {'label': 'web_search gộp 2 truy vấn', 'source': 'web', 'count': 5, 'minResults': 3,
         'noDuplicateUrls': True, 'expectCache': True,
         'query': 'hồ sơ chuyển tuyến bảo hiểm y tế',
         'queries': ['site:chinhphu.vn hồ sơ chuyển tuyến']},
    ],
}

# Nhóm `store` (A-4): chỉ có nghĩa khi `read_source` đã ở trong cây.
STORE_TARGETS: list[dict] = [
    # Trang DÀI thật: `docs.python.org/3/whatsnew/3.13.html` = 113 936 ký tự văn bản (đo 2026-09-23),
    # mà đợt 1 chỉ đưa 8 000 ký tự (7 %) vào ngữ cảnh. Ngưỡng của A-4: ghép các mẩu phải ĐỦ bài.
    {'label': 'docs.python.org 3.13 (mẩu 8 000)', 'url': 'https://docs.python.org/3/whatsnew/3.13.html',
     'slice': 8000, 'find': 'asyncio', 'minStored': 100000},
]
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


def measure_store(tools: WebTools, target: dict) -> dict:
    """Đo bộ đệm đọc: tải một lần, ghép các mẩu, rồi `find` một từ khoá.

    Ngưỡng là **bằng đúng** `storedChars`: ghép thiếu một mẩu nghĩa là `read_source` mất chữ — đúng
    thứ mà A-4 sinh ra để chữa (trước đợt 1-2: trang extract 113 936 ký tự, model chỉ thấy 8 000).
    """
    started = time.time()
    row = {'label': target['label'], 'url': target['url'], 'group': 'store'}
    try:
        first = tools.fetch({'url': target['url'], 'maxChars': target['slice']})
    except WebError as exc:
        row |= {'seconds': round(time.time() - started, 2), 'error': str(exc)[:300],
                'problems': ['lỗi — không đo được']}
        return row
    ref = first.get('ref')
    pieces = [first.get('text') or '']
    offset = first.get('nextOffset')
    calls = 1
    while ref and offset and calls < 40:
        piece = tools.read_source({'ref': ref, 'offset': offset, 'maxChars': target['slice']})
        calls += 1
        pieces.append(piece.get('text') or '')
        offset = piece.get('nextOffset')
        if not piece.get('more'):
            break
    joined = ''.join(pieces)
    stored = first.get('storedChars') or 0
    hit = tools.read_source({'ref': ref, 'find': [target['find']]}) if ref else {}
    row |= {'seconds': round(time.time() - started, 2), 'storedChars': stored, 'joinedChars': len(joined),
            'calls': calls, 'findMatches': len(hit.get('matches') or []), 'ref': ref}
    problems = []
    if stored < target.get('minStored', 0):
        problems.append(f"storedChars {stored} < {target['minStored']}")
    if len(joined) != stored:
        problems.append(f"ghép {len(joined)} != storedChars {stored}")
    if not (hit.get('matches') or []):
        problems.append(f"`find` {target['find']!r} không khớp")
    row['problems'] = problems
    return row


def measure_search(tools: WebTools, target: dict) -> dict:
    started = time.time()
    row = {'label': target['label'], 'group': 'search'}
    args = {'query': target['query'], 'source': target['source']}
    if target.get('queries'):
        args['queries'] = list(target['queries'])
    if target.get('count'):
        args['count'] = target['count']
    try:
        payload = tools.search(args)
    except WebError as exc:
        row |= {'seconds': round(time.time() - started, 2), 'error': str(exc)[:300], 'problems': ['lỗi']}
        return row
    results = payload.get('results') or []
    urls = [item.get('url') or '' for item in results]
    duplicates = len(urls) - len({normalize_url(url) for url in urls})
    failed = [entry['query'] for entry in (payload.get('perQuery') or []) if entry.get('error')]
    row |= {'seconds': round(time.time() - started, 2), 'results': len(results),
            'source': payload.get('source') or target['source'],
            'queries': len(payload.get('queries') or []), 'deduped': payload.get('deduped', 0),
            'duplicateUrls': duplicates, 'failedQueries': failed}
    if target.get('expectCache'):
        started_cache = time.time()
        again = tools.search(dict(args))
        row |= {'cachedSeconds': round(time.time() - started_cache, 4), 'cached': bool(again.get('cached'))}
    problems = ([] if len(results) >= target.get('minResults', 1)
                else [f"results {len(results)} < {target['minResults']}"])
    if target.get('noDuplicateUrls') and duplicates:
        problems.append(f'{duplicates} URL trùng sau khử trùng')
    if target.get('expectCache') and not row.get('cached'):
        problems.append('lời gọi lặp KHÔNG ăn cache')
    row['problems'] = problems
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', nargs='*', choices=[*GROUPS, 'store'],
                        help='chỉ chạy nhóm này (mặc định: hết)')
    parser.add_argument('--json', help='ghi số đo ra tệp JSON')
    args = parser.parse_args()
    # Chạy hết nghĩa là hết CẢ nhóm `store` (A-4): trước lượt đo 8, nhóm này không bao giờ nằm trong
    # lượt chạy đầy đủ nên "12/12 đạt ngưỡng" vẫn thiếu một nhóm.
    wanted = args.only or [*GROUPS, 'store']

    tools = WebTools()
    rows: list[dict] = []
    queue: list[tuple[str, dict]] = []
    if 'store' in wanted:
        wanted = [name for name in wanted if name != 'store']
        if not STORE_READY:
            print('store: bộ đệm đọc + `read_source` chưa có trong cây này (A-4, đợt 2)')
        else:
            queue.extend(('store', target) for target in STORE_TARGETS)
    for name in wanted:
        queue.extend((name, target) for target in GROUPS[name])

    for name, target in queue:
        if name == 'store':
            row = measure_store(tools, target)
        else:
            row = measure_search(tools, target) if name == 'search' else measure_fetch(tools, target)
        rows.append(row)
        if name == 'store':
            line = (f"{row['label']:34s} stored={str(row.get('storedChars')):>7s} "
                    f"ghép={str(row.get('joinedChars')):>7s} mẩu={str(row.get('calls')):>3s} "
                    f"find={str(row.get('findMatches')):>2s} {row['seconds']}s")
        elif row.get('failedQueries'):
            line = (f"{row['label']:34s} results={str(row.get('results')):>3s} "
                    f"queries={str(row.get('queries')):>2s} trùng={str(row.get('duplicateUrls')):>2s} "
                    f"chân hỏng={len(row['failedQueries'])} {row['seconds']}s")
        else:
            line = (f"{row['label']:34s} status={str(row.get('status')):>5s} "
                    f"chars={str(row.get('textChars') or row.get('results')):>7s} "
                    f"junk={str(row.get('junkRatio')):>6s} reader={str(row.get('reader')):>12s} "
                    f"verdict={str(row.get('verdict')):>11s} {row['seconds']}s")
        print(line + (f"  ⚠ {'; '.join(row['problems'])}" if row.get('problems') else ''))

    partial = [row for row in rows if row.get('failedQueries')]
    if partial:
        print(f"\n{len(partial)} dòng có chân bị từ chối (kết quả một phần): "
              + ', '.join(row['label'] for row in partial))
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
