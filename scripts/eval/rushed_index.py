"""The "rushed index" (§3 of the quality plan) computed from the DEV system log.

Every signal is derived from `~/BoxFox/logs/harness.jsonl` (and the router log
where a signal names upstream), never from the agent's own self-praise. Three
honesty rules apply, and they are enforced by the code rather than promised:

1. a signal with no evidence in the log reports ``not_measured`` with the reason
   — it never becomes a 0 that looks like a clean run;
2. a missing or empty log reports ``no_data`` and an index of ``None``;
3. signals the plan defines over text we are not allowed to log are marked
   ``not_measured`` on purpose, because the system log deliberately never stores
   message or file content (dev-system-log-plan §4.5). S5 is still one of them.
   S4 stopped being one in round 22: the evidence gate now writes
   ``data.evidenceVerdict`` / ``data.evidenceMissing`` on ``turn.end``, so the
   signal reads a number the runtime computed instead of prose, and it reports
   ``not_measured`` only while the log has no such key yet.

Where the log cannot express the plan's exact rule, the signal says ``proxy``
and names what is missing (tool arguments, for instance, are not logged).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import logread  # noqa: E402  (sibling module, flat layout on purpose)

# Tool names come from backend/src/agentbox/agent_core/tool_contracts.py.
#
# P5.1 (đợt 3 vòng 22): danh sách gõ tay ở đây từng là bản sao của
# `evidence_gate.WRITE_TOOLS`, và hai bản sao thì sớm muộn lệch nhau. Từ nay lấy từ nguồn duy nhất
# (`agentbox` nằm trong `backend/src`, vừa được thêm vào `sys.path` ở trên). Đường dự phòng chỉ để
# script còn chạy khi bị chép ra ngoài repo — nó KHÔNG phải nguồn thứ hai để bổ sung tay.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend' / 'src'))
try:
    from agentbox.agent_core.evidence_gate import PLAN_TOOLS as _GATE_PLAN_TOOLS
    from agentbox.agent_core.evidence_gate import WRITE_TOOLS as _GATE_WRITE_TOOLS
except Exception:  # pragma: no cover - bản sao rời, không có mã nguồn backend cạnh nó
    _GATE_WRITE_TOOLS, _GATE_PLAN_TOOLS = ('file_write', 'file_edit_block'), ('write_plan',)
# S3 của kế hoạch §3 tính MỌI lần ghi, kể cả `write_plan`; còn cổng bằng chứng cố ý không tính plan
# viết (plan có cổng riêng, xem `evidence_gate`), nên hai danh sách được GHÉP ở đây thay vì chép
# tay lại danh sách thứ ba.
WRITE_TOOLS = tuple(_GATE_WRITE_TOOLS) + tuple(_GATE_PLAN_TOOLS)
VERIFY_TOOLS = ('file_read', 'codebase_grep', 'codebase_glob', 'terminal_exec', 'browser_use',
                'inspect_element', 'computer_screen_capture')
UPSTREAM_PREFIXES = ('UPSTREAM_',)

# §3 weights. The plan fixes the SEVERITY WORDS of each row ("lỗi", "lỗi nặng",
# "cảnh báo", "theo dõi xu hướng") but not a number, so the mapping below is this
# script's convention and must be agreed with the owner before it is quoted.
WEIGHTS = {'severe': 3.0, 'error': 2.0, 'warning': 1.0, 'trend': 0.0}

SHORT_TEXT_CHARS = 200     # S2 threshold, §3
BUDGET_WARN_RATIO = 0.8    # S8 threshold, §3
LOOP_THRESHOLD = 3         # S6, same threshold as AntiLoopGuard
UNVERIFIED_SHARE = 0.2     # S4, "cảnh báo khi > 20%"

UNMEASURED_LOG_TEXT = ('nhật ký hệ thống cố ý không ghi nội dung tin nhắn/tệp '
                       '(dev-system-log-plan §4.5)')
MISSING_FIELD_NOTE = ('nhật ký chưa có trường chứa dấu hiệu này; đây là việc thêm 1 khoá vào '
                      '`turn.end`/`tool.end`, không phải việc đo lại')
# Mã lý do của S4 khi cửa sổ log chưa có khoá nào của cổng bằng chứng (log trước vòng 22). Đặt thành
# hằng số để người đọc bảng grep được đúng một chuỗi, thay vì đọc câu chữ mỗi lần một khác.
S4_NO_GATE_KEYS = 'not-evidence-gate-keys'


def pair_turns(entries) -> list[dict]:
    """Ghép `turn.start` với `turn.end`/`turn.failed` theo phiên, theo thứ tự."""
    turns: list[dict] = []
    history: dict[str, list[dict]] = {}
    for entry in entries:
        event = entry.get('event')
        sid = entry.get('sessionId')
        if event == 'turn.start':
            turn = {'sessionId': sid, 'start': entry, 'end': None, 'tools': []}
            turns.append(turn)
            history.setdefault(sid, []).append(turn)
        elif event in ('turn.end', 'turn.failed'):
            target = None
            for turn in reversed(history.get(sid) or []):
                if turn['end'] is None:
                    target = turn
                    break
            if target is None:
                target = {'sessionId': sid, 'start': None, 'end': None, 'tools': []}
                turns.append(target)
                history.setdefault(sid, []).append(target)
            target['end'] = entry
        elif event == 'tool.end':
            for turn in reversed(history.get(sid) or []):
                turn['tools'].append(entry)
                break
    return turns


def turn_label(turn: dict) -> str:
    sid = str(turn.get('sessionId') or '?')[:8]
    stamp = str((turn.get('end') or turn.get('start') or {}).get('ts', ''))[:19]
    return f'{sid}@{stamp}'


def _data(entry: dict) -> dict:
    data = entry.get('data')
    return data if isinstance(data, dict) else {}


def _tool_name(entry: dict) -> str:
    return str(_data(entry).get('tool') or entry.get('tool') or '')


def _flagged(turn: dict) -> dict:
    return {'turn': turn_label(turn), 'event': (turn.get('end') or {}).get('event')}


def signal_status(value, flagged, *, measurable: str, why: str = '') -> str:
    if measurable == 'not_measured':
        return 'not_measured'
    if measurable == 'proxy':
        return 'measured_proxy'
    return 'measured'


def _result(code: str, name: str, *, status: str, value, unit: str, severity: str,
            threshold: str, flagged: list, note: str, method: str) -> dict:
    return {
        'code': code,
        'name': name,
        'status': status,
        'value': value,
        'unit': unit,
        'severity': severity,
        'weight': WEIGHTS[severity],
        'threshold': threshold,
        'flagged': flagged,
        'count': len(flagged),
        'note': note,
        'method': method,
    }


# --------------------------------------------------------------------------- S1
def s1_repeated_text(entries, turns) -> dict:
    hits = []
    for entry in entries:
        data = _data(entry)
        marker = data.get('repeatedSuffix') or data.get('duplicateSuffix') or data.get('repeated')
        blob = f"{entry.get('code','')} {entry.get('message','')} {data.get('errorCode','')}"
        if marker or 'REPEATED_SUFFIX' in blob or 'TEXT_REPEAT' in blob:
            hits.append({'entry': str(entry.get('ts', ''))[:19],
                         'session': str(entry.get('sessionId') or '')[:8],
                         'event': entry.get('event')})
    if not hits:
        return _result('S1', 'Lặp văn bản', status='not_measured', value=None, unit='event',
                       severity='error', threshold='> 0 là lỗi',
                       flagged=[],
                       note='không có dòng nào mang dấu hiệu lặp; ' + MISSING_FIELD_NOTE,
                       method='plan')
    return _result('S1', 'Lặp văn bản', status='measured', value=len(hits), unit='event',
                   severity='error', threshold='> 0 là lỗi', flagged=hits,
                   note='đếm dòng có dấu hiệu đuôi lặp lại tiền tố đã phát', method='plan')


# --------------------------------------------------------------------------- S2
def s2_short_answer(entries, turns) -> dict:
    flagged = []
    for turn in turns:
        end = turn.get('end') or {}
        if end.get('event') != 'turn.end':
            continue
        data = _data(end)
        if data.get('status') != 'completed':
            continue
        steps = int(data.get('steps') or 0)
        chars = data.get('textChars')
        if steps >= 1 and isinstance(chars, int) and chars < SHORT_TEXT_CHARS:
            flagged.append({**_flagged(turn), 'textChars': chars, 'steps': steps})
    return _result('S2', 'Trả lời rỗng/ngắn bất thường', status='measured', value=len(flagged),
                   unit='turn', severity='warning',
                   threshold=f'textChars < {SHORT_TEXT_CHARS} sau khi đã dùng công cụ',
                   flagged=flagged, note='chỉ tính lượt đã chạy ≥ 1 bước rồi mới kết thúc',
                   method='plan')


# --------------------------------------------------------------------------- S3
def s3_no_verification(entries, turns) -> dict:
    flagged = []
    for turn in turns:
        names = [_tool_name(entry) for entry in turn['tools']]
        writes = [index for index, name in enumerate(names) if name in WRITE_TOOLS]
        if not writes:
            continue
        last_write = writes[-1]
        if not any(name in VERIFY_TOOLS for name in names[last_write + 1:]):
            flagged.append({**_flagged(turn), 'tools': names})
    return _result('S3', 'Không có kiểm chứng', status='measured_proxy', value=len(flagged),
                   unit='turn', severity='warning',
                   threshold='có ghi (file_write/file_edit_block/write_plan) mà sau lần ghi cuối '
                             'không có lệnh đọc/kiểm nào',
                   flagged=flagged,
                   note='nhật ký chỉ có tên tool, không có tham số, nên "lệnh kiểm tra" là proxy theo '
                        'danh sách tool đọc/kiểm; không phân biệt được lệnh kiểm thật hay chỉ đọc lại',
                   method='proxy')


# --------------------------------------------------------------------------- S4
def s4_unsupported_claims(entries, turns) -> dict:
    """S4 — đọc số của cổng bằng chứng trên `turn.end` (P5.1, đợt 3 vòng 22).

    Trước vòng 22 tín hiệu này chỉ đo được bằng cách đọc câu chữ trong câu trả lời, mà nhật ký hệ
    thống cố ý không ghi nội dung (§4.5) ⇒ nó nằm mãi ở `not_measured`. Từ vòng 22, mỗi `turn.end`
    mang `data.evidenceVerdict`/`data.evidenceMissing` do cổng tính lúc chạy, nên S4 đọc thẳng con
    số đó. Luật trung thực #1 vẫn nguyên: lượt không có khoá ⇒ KHÔNG tính là 0, mà không vào mẫu;
    cả cửa sổ log không có khoá nào ⇒ vẫn `not_measured` kèm lý do cũ.
    """
    flagged = []
    measured = 0
    for turn in turns:
        end = turn.get('end') or {}
        if end.get('event') != 'turn.end':
            continue
        data = _data(end)
        missing = data.get('evidenceMissing')
        verdict = data.get('evidenceVerdict')
        if not isinstance(missing, int) or isinstance(missing, bool) or not verdict:
            continue
        measured += 1
        if missing > 0:
            flagged.append({**_flagged(turn), 'verdict': verdict, 'missing': missing})
    if not measured:
        return _result('S4', 'Khẳng định không có bằng chứng', status='not_measured', value=None,
                       unit='share', severity='warning',
                       threshold=f'cảnh báo khi > {int(UNVERIFIED_SHARE * 100)}%',
                       flagged=[],
                       note=(S4_NO_GATE_KEYS + ' — log chưa có số của cổng bằng chứng (`turn.end` '
                             'thiếu `data.evidenceMissing`); đường cũ là phải đọc câu chữ trong '
                             'câu trả lời: ' + UNMEASURED_LOG_TEXT),
                       method='plan')
    share = round(len(flagged) / measured, 4)
    return _result('S4', 'Khẳng định không có bằng chứng', status='measured', value=share,
                   unit='share', severity='warning',
                   threshold=f'cảnh báo khi > {int(UNVERIFIED_SHARE * 100)}%',
                   flagged=flagged,
                   note=(f'{measured} lượt đã đo (cửa sổ log có {len(turns)} lượt), '
                         f'{len(flagged)} lượt bị gắn cờ; ngưỡng nâng mặc định lên `enforce`: '
                         f'≥ 20 PHIÊN có số (cột `sessions` của báo cáo) VÀ tỉ lệ báo động sai '
                         f'< 10 % — D-8, kế hoạch đợt 3 §6'),
                   method='plan')


# --------------------------------------------------------------------------- S5
def s5_invented_paths(entries, turns) -> dict:
    return _result('S5', 'Bịa đường dẫn', status='not_measured', value=None, unit='path',
                   severity='error', threshold='> 0 là lỗi', flagged=[],
                   note=('cần đối chiếu đường dẫn trong đầu ra với danh sách thật của workspace; '
                         'việc này làm được ở lớp 1 lúc chạy (đọc /__box/files), không làm được chỉ '
                         'từ nhật ký: ' + UNMEASURED_LOG_TEXT),
                   method='plan')


# --------------------------------------------------------------------------- S6
def s6_tool_loop(entries, turns) -> dict:
    flagged = []
    for turn in turns:
        run_name, run_len = None, 0
        for entry in turn['tools']:
            data = _data(entry)
            name = _tool_name(entry)
            is_error = bool(data.get('isError'))
            if name == run_name and is_error:
                run_len += 1
            else:
                run_name, run_len = (name, 1) if is_error else (None, 0)
            if run_len == LOOP_THRESHOLD:
                flagged.append({**_flagged(turn), 'tool': name, 'repeats': run_len})
                break
    return _result('S6', 'Vòng lặp công cụ', status='measured_proxy', value=len(flagged),
                   unit='turn', severity='warning',
                   threshold=f'≥ {LOOP_THRESHOLD} lần cùng tên tool, cùng lỗi (AntiLoopGuard ngưỡng '
                             f'{LOOP_THRESHOLD})',
                   flagged=flagged,
                   note='nhật ký không ghi tham số tool nên không so được "cùng tham số"; proxy theo '
                        'tên tool + isError',
                   method='proxy')


# --------------------------------------------------------------------------- S7
def s7_swallowed_errors(entries, turns) -> dict:
    flagged = []
    for turn in turns:
        end = turn.get('end') or {}
        if end.get('event') != 'turn.end' or _data(end).get('status') != 'completed':
            continue
        failed_tools = [entry for entry in turn['tools'] if _data(entry).get('isError')]
        if failed_tools and int(_data(end).get('textChars') or 0) >= SHORT_TEXT_CHARS:
            flagged.append({**_flagged(turn),
                            'failedTools': [_tool_name(entry) for entry in failed_tools],
                            'textChars': _data(end).get('textChars')})
    return _result('S7', 'Lỗi công cụ bị nuốt', status='measured_proxy', value=len(flagged),
                   unit='turn', severity='severe',
                   threshold='lượt kết thúc completed, có tool.end isError, và vẫn trả lời dài',
                   flagged=flagged,
                   note='luật gốc là "cuối lượt vẫn nói thành công", muốn chắc phải đọc câu trả lời; '
                        'proxy ở đây là lượt completed + có lỗi tool + trả lời ≥ '
                        f'{SHORT_TEXT_CHARS} ký tự',
                   method='proxy')


# --------------------------------------------------------------------------- S8
def s8_budget(entries, turns) -> dict:
    flagged = []
    for turn in turns:
        start, end = turn.get('start'), turn.get('end')
        if not start or not end:
            continue
        start_data = _data(start)
        end_data = _data(end)
        max_steps = start_data.get('maxSteps')
        deadline = start_data.get('deadlineSeconds')
        # B9 (vòng 22): `turn_end` giờ mang thẳng ba số của lượt — `stepsUsed`, `toolsRun`,
        # `deadlineUsedMs` — nên không phải suy ra từ thời lượng. Bản ghi của lượt cũ chỉ có
        # `steps`/`durationMs`, nên hai khoá đó ở lại làm đường lùi (hồi tương thích).
        steps = end_data.get('stepsUsed')
        if not isinstance(steps, int):
            steps = end_data.get('steps')
        duration = end_data.get('deadlineUsedMs')
        if not isinstance(duration, (int, float)):
            duration = end.get('durationMs')
        tools_run = end_data.get('toolsRun')
        if not isinstance(tools_run, int):
            tools_run = len(turn['tools'])
        ratios = {}
        if isinstance(max_steps, int) and max_steps > 0 and isinstance(steps, int):
            ratios['steps'] = steps / max_steps
        if isinstance(deadline, (int, float)) and deadline > 0 and isinstance(duration, (int, float)):
            ratios['time'] = (duration / 1000) / deadline
        if ratios and max(ratios.values()) > BUDGET_WARN_RATIO:
            flagged.append({**_flagged(turn), 'toolsRun': tools_run,
                            'ratios': {key: round(value, 3) for key, value in ratios.items()}})
    return _result('S8', 'Ngân sách', status='measured', value=len(flagged), unit='turn',
                   severity='warning', threshold=f'> {int(BUDGET_WARN_RATIO * 100)}% trần bước/thời gian',
                   flagged=flagged, note='đọc thẳng stepsUsed/deadlineUsedMs/toolsRun của lượt; '
                                        'lượt cũ (chưa có khoá) mới suy từ steps/durationMs',
                   method='plan')


# --------------------------------------------------------------------------- S9
def s9_upstream(entries, turns) -> dict:
    flagged = []
    for entry in entries[::-1]:
        data = _data(entry)
        code = str(entry.get('code') or data.get('errorCode') or '')
        event = str(entry.get('event', ''))
        if code.startswith(UPSTREAM_PREFIXES) or code == 'DEADLINE' or event == 'UPSTREAM_RETRY' \
                or event in ('model.error', 'chat.failed', 'chat.aborted'):
            flagged.append({'entry': str(entry.get('ts', ''))[:19],
                            'session': str(entry.get('sessionId') or '')[:8],
                            'event': event, 'code': code or None})
    return _result('S9', 'Retry/upstream', status='measured', value=len(flagged), unit='entry',
                   severity='trend', threshold='theo dõi xu hướng', flagged=flagged,
                   note='đếm model.error, chat.failed/aborted, mã UPSTREAM_*/DEADLINE; theo kế hoạch '
                        'đây là tín hiệu xu hướng nên không vào tử số của chỉ số',
                   method='plan')


# --------------------------------------------------------------------------- S10
def s10_plan_quality(entries, turns) -> dict:
    flagged = []
    pattern = re.compile(r'\(([a-z][a-z-]+)\)')
    for entry in entries:
        data = _data(entry)
        blob = f"{entry.get('message','')} {data.get('errorCode','')} {data.get('detail','')}"
        if 'PLAN_QUALITY_REJECTED' not in blob:
            continue
        missing = sorted(set(pattern.findall(str(entry.get('message') or ''))))
        flagged.append({'entry': str(entry.get('ts', ''))[:19],
                        'session': str(entry.get('sessionId') or '')[:8],
                        'event': entry.get('event'), 'missing': missing})
    return _result('S10', 'Plan thiếu mục', status='measured', value=len(flagged), unit='entry',
                   severity='trend', threshold='theo dõi xu hướng', flagged=flagged,
                   note='đếm PLAN_QUALITY_REJECTED và các mục bị thiếu đọc từ chính thông điệp; xu hướng '
                        'nên không vào tử số của chỉ số',
                   method='plan')


# Every signal takes (entries, turns) so the dispatcher stays boring.
SIGNAL_FUNCTIONS = (
    s1_repeated_text,
    s2_short_answer,
    s3_no_verification,
    s4_unsupported_claims,
    s5_invented_paths,
    s6_tool_loop,
    s7_swallowed_errors,
    s8_budget,
    s9_upstream,
    s10_plan_quality,
)


def compute(entries) -> dict:
    """Per-signal breakdown + the 0-1 index. `index` is None when there is no data."""
    entries = list(entries)
    turns = pair_turns(entries)
    signals = [function(entries, turns) for function in SIGNAL_FUNCTIONS]
    evaluated_turns = sum(1 for turn in turns if turn.get('start'))
    weighted = sum(signal['weight'] * signal['count'] for signal in signals
                   if signal['status'] in ('measured', 'measured_proxy'))
    measured_any = any(signal['status'] in ('measured', 'measured_proxy') for signal in signals)
    if not entries:
        index, status = None, 'no_data'
    elif not measured_any or evaluated_turns == 0:
        index, status = None, 'no_data'
    else:
        index = round(min(1.0, weighted / evaluated_turns), 4)
        status = 'ok'
    return {
        'index': index,
        'rawIndex': round(weighted / evaluated_turns, 4) if evaluated_turns else None,
        'status': status,
        'weightedFlags': weighted,
        'evaluatedTurns': evaluated_turns,
        'sessions': len(logread.session_ids(entries)),
        'entries': len(entries),
        'signals': signals,
        'weights': WEIGHTS,
        'unmeasured': [signal['code'] for signal in signals if signal['status'] == 'not_measured'],
        'flaggedTurns': sorted({item['turn'] for signal in signals for item in signal['flagged']
                                if 'turn' in item}),
    }


def summarize_log(entries, *, path: str, state: str, files=None, duplicates: int = 0) -> dict:
    return {
        'path': path,
        'state': state,
        'files': list(files or []),
        'duplicates': duplicates,
        'events': logread.event_counts(entries),
    }


def render(report: dict, log: dict) -> str:
    """Bảng tiếng Việt cho người đọc, kèm chỗ ghi 'chưa đo'."""
    lines: list[str] = []
    lines.append('Chỉ số vội (§3 kế hoạch chất lượng) — chỉ đọc nhật ký hệ thống DEV')
    lines.append(f"Nhật ký: {log['path']}")
    if log['state'] == logread.STATE_MISSING:
        lines.append('Trạng thái log: CHƯA CÓ TỆP (no data) — chưa chạy harness lần nào, '
                     'hoặc sai BOXFOX_SYSTEM_LOG_DIR.')
    elif log['state'] == logread.STATE_EMPTY:
        lines.append('Trạng thái log: TỆP RỖNG (no data) — không có dòng nào để đo.')
    else:
        lines.append(f"Trạng thái log: {log['state']} ({report['entries']} dòng, "
                     f"{report['sessions']} phiên)")
        if log.get('files'):
            lines.append('Tệp đã đọc (cửa sổ gồm cả lần chạy trước): '
                         + ', '.join(Path(name).name for name in log['files']))
        if log.get('duplicates'):
            lines.append(f"Bỏ qua {log['duplicates']} dòng trùng giữa các tệp "
                         f"(không đếm hai lần).")
    lines.append('')
    if report['status'] == 'no_data':
        lines.append('Kết luận: NO DATA — không đủ dữ liệu để ra chỉ số. Không suy đoán.')
    else:
        lines.append(f"Chỉ số vội: {report['index']} (0-1, đã chặn trần 1.0) "
                     f"| thô {report['rawIndex']} = {report['weightedFlags']} điểm có trọng số / "
                     f"{report['evaluatedTurns']} lượt đánh giá được")
    lines.append('')
    lines.append('| Tín hiệu | Trạng thái | Số bị gắn cờ | Mức | Ngưỡng |')
    lines.append('|---|---|---|---|---|')
    labels = {'measured': 'đo được', 'measured_proxy': 'đo được (proxy)',
              'not_measured': 'CHƯA ĐO ĐƯỢC'}
    for signal in report['signals']:
        lines.append(f"| {signal['code']} — {signal['name']} | {labels[signal['status']]} | "
                     f"{signal['count'] if signal['status'] != 'not_measured' else '—'} | "
                     f"{signal['severity']} (w={signal['weight']}) | {signal['threshold']} |")
    lines.append('')
    for signal in report['signals']:
        if signal['status'] == 'not_measured':
            lines.append(f"{signal['code']}: chưa đo được — {signal['note']}")
        elif signal['status'] == 'measured_proxy':
            lines.append(f"{signal['code']}: {signal['note']}")
    if report['flaggedTurns']:
        lines.append('')
        lines.append('Lượt bị gắn cờ (mở lại đúng chỗ): ' + ', '.join(report['flaggedTurns']))
    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Tính chỉ số vội (§3) từ nhật ký hệ thống DEV. Không gọi model, không ra mạng.')
    parser.add_argument('--log', default=None, help='đường dẫn harness.jsonl (mặc định ~/BoxFox/logs)')
    parser.add_argument('--limit', type=int, default=20000, help='số dòng cuối cùng đưa vào phân tích')
    parser.add_argument('--rotated', action='store_true',
                        help='đọc thêm các bản xoay vòng theo kích thước .0-.3 (mặc định đã đọc cả '
                             'harness.previous.jsonl của lần chạy trước)')
    parser.add_argument('--json', action='store_true', help='in JSON thay vì bảng')
    args = parser.parse_args(argv)

    path = Path(args.log) if args.log else logread.default_log_path()
    window = logread.read_window(path, limit=args.limit, rotated=args.rotated)
    report = compute(window['entries'])
    log = summarize_log(window['entries'], path=window['path'], state=window['state'],
                        files=window.get('files'), duplicates=window.get('duplicates', 0))
    if args.json:
        print(json.dumps({'report': report, 'log': log}, ensure_ascii=False, indent=2))
    else:
        print(render(report, log))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
