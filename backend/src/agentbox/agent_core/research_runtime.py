"""Công cụ research của vòng 27 (đợt 3–8) — sổ nguồn, hồ sơ, ba mức, phản biện, can thiệp giữa lượt.

Tách khỏi `runtime.py` để phần luật nằm một chỗ đọc được, còn `runtime.py` chỉ giữ đường nối:
mỗi hàm ở đây nhận `rt` (phiên bản `HarnessRuntime`) làm tham số đầu, đúng khuôn để `runtime.py`
gọi một dòng. Không hàm nào tự ghi đĩa hay tự mở mạng: việc đó đi qua `rt.executor`/`rt.web` như
mọi công cụ khác, và mọi cổng (`research_quality`) chạy TRƯỚC khi ghi.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from typing import Any

from . import journal, research_header, research_ledger, research_profiles, research_quality
from . import session_journal, source_tiers
from .limits import (
    CHILD_DEADLINE_SECONDS, CHILD_MAX_STEPS, DOSSIER_MAX_BYTES, DOSSIER_ROOM,
    FANOUT_PER_PARENT_MAX, OWNER_STEER_PREFIX, RESEARCH_BRIEF_DEFAULT_MODE, RESEARCH_BRIEF_ENV,
    RESEARCH_BRIEF_MISSING_CODE, RESEARCH_BRIEF_MODES, RESEARCH_BRIEF_MODE_UNKNOWN_CODE,
    RESEARCH_BRIEF_TAKEN_CODE, RESEARCH_CRITIQUE_LABEL, RESEARCH_CRITIQUE_MISSING_CODE,
    RESEARCH_GATE_NOTE_CODE, RESEARCH_LEVEL_INVALID_CODE, RESEARCH_MAX_ROWS_PER_DOSSIER,
    RESEARCH_NUDGE_PREFIX, RESEARCH_PROFILE_INVALID_CODE, RESEARCH_PROGRESS_DEFAULT_MODE,
    RESEARCH_PROGRESS_ENV, RESEARCH_PROGRESS_MAX_PER_TURN, RESEARCH_PROGRESS_MODES,
    RESEARCH_PROGRESS_NUDGE_SECONDS, RESEARCH_REVIEW_MIN_ANSWER_CHARS, RESEARCH_SLUG_RE,
    RESEARCH_TIER_BRANCHES, RESEARCH_TIER_CHILD_SECONDS, RESEARCH_TIER_CHILD_STEPS,
    RESEARCH_TIER_CRITIQUE, RESEARCH_TIER_DEFAULT, RESEARCH_TIER_HARD_CEILING_SECONDS,
    RESEARCH_TIER_INVALID_CODE, RESEARCH_TIER_TURN_SECONDS, RESEARCH_TIER_WAVES,
    RESEARCH_TIER_WAVE_SIZE, RESEARCH_TIERS, RESEARCH_TURN_EXTENSION_SECONDS_TIER3,
    RESEARCH_BRIEF_RAISE_REFUSED_CODE, RESEARCH_BRIEF_UPDATED_CODE, RESEARCH_CEILING_CLAMPED_CODE,
    RESEARCH_GATE_ENV, RESEARCH_GATE_DEFAULT_MODE, RESEARCH_GATE_MODES, RESEARCH_GATE_MODE_UNKNOWN_CODE,
    RESEARCH_TIER_DEFAULTED_CODE, RESEARCH_BRANCH_LIMIT_CODE,
    RESEARCH_OWNER_VIEWS_CODE, RESEARCH_OWNER_VIEWS_MAX, RESEARCH_OWNER_VIEW_CHARS,
    RESEARCH_VERIFY_ISSUE_CHARS, RESEARCH_VERIFY_MAX_ISSUES, RESEARCH_VERIFY_NO_CRITIC_CODE,
    RESEARCH_VERIFY_REVISE_MAX, RESEARCH_VERIFY_SUMMARY_CHARS, RESEARCH_VERIFY_UNKNOWN_CODE,
    RESEARCH_VERIFY_VERDICT_MISMATCH_CODE, RESEARCH_VERIFY_VERDICT_MISSING_CODE,
    RESEARCH_VERIFY_VERSION_MISSING_CODE, SOURCE_CLAIM_MAX_CHARS, SOURCE_EXCERPT_MAX_CHARS,
    SOURCE_FAKE_SUCCESS_MIN_CHARS, SOURCE_FAKE_SUCCESS_TITLE_MARKERS, SOURCE_ORIGIN_MAX_CHARS,
    SOURCE_ROW_LIMIT_DEFAULT, SOURCE_ROW_LIMIT_MAX, STEER_DEFAULT_MODE, STEER_DRAIN_MAX,
    STEER_ENV, STEER_MAX_PENDING, STEER_MODES, STEER_MODE_UNKNOWN_CODE, STEER_TEXT_MAX_CHARS,
)
from .reading import normalize_url
from ..observability.system_log import system_log

#: Câu nhắc tiến độ (#5969) — một câu, có số phút, nói rõ "báo xong thì đi tiếp".
_NUDGE_BODY = ('{elapsed} phút đã trôi trong lượt research này. Báo tiến độ NGẮN cho chủ nhà: '
               'đã mở được bao nhiêu nguồn (số dòng sổ), đang ở nhánh nào, còn nghi ngờ gì nhất. '
               'Báo xong thì đi tiếp, không cần dừng việc.')


# --------------------------------------------------------------------------- cấu hình


def research_config(session) -> dict:
    """Brief của phiên (`session['config']['research']`), hoặc `{}`."""
    value = (session.get('config') or {}).get('research')
    return dict(value) if isinstance(value, dict) else {}


def has_research_brief(session) -> bool:
    """Lượt này đã mở một việc research bằng `research_brief` chưa."""
    return bool(research_config(session).get('researchId'))


def research_tier_limits(tier) -> dict:
    """Trần theo mức, ĐÃ KẸP theo trần chung — số ở đây là số sẽ áp, không phải số trong bảng.

    `branchCeiling` là trần của **cả lượt** (mức 3 = 15 nhánh qua ba sóng), nên nó KHÔNG bị kẹp theo
    `FANOUT_PER_PARENT_MAX` — trần ấy là trần **chạy cùng lúc**, và một sóng chỉ mở `waveSize` nhánh.
    Kẹp nhầm chỗ này biến "ba sóng × năm nhánh" của mức 3 thành sáu nhánh rồi khoá cứng.
    """
    try:
        value = int(tier)
    except (TypeError, ValueError):
        value = 0
    tier = value if value in RESEARCH_TIERS else RESEARCH_TIER_DEFAULT
    return {
        'tier': tier,
        'branchCeiling': int(RESEARCH_TIER_BRANCHES[tier]),
        'branchCeilingPerWave': min(RESEARCH_TIER_WAVE_SIZE[tier], FANOUT_PER_PARENT_MAX),
        'waves': RESEARCH_TIER_WAVES[tier],
        'waveSize': min(RESEARCH_TIER_WAVE_SIZE[tier], FANOUT_PER_PARENT_MAX),
        'childSteps': min(RESEARCH_TIER_CHILD_STEPS[tier], CHILD_MAX_STEPS),
        'childSeconds': min(RESEARCH_TIER_CHILD_SECONDS[tier], CHILD_DEADLINE_SECONDS),
        'turnSeconds': RESEARCH_TIER_TURN_SECONDS[tier],
        'softCeilingSeconds': RESEARCH_TIER_TURN_SECONDS[tier],
        'hardCeilingSeconds': RESEARCH_TIER_HARD_CEILING_SECONDS[tier],
        'extensionSeconds': (RESEARCH_TURN_EXTENSION_SECONDS_TIER3 if tier >= 3 else 0),
        'critique': bool(RESEARCH_TIER_CRITIQUE[tier]),
    }


def _mode(env_name, modes, default, env=None):
    """Đọc một công tắc `off|warn|enforce|on` — trả `(mode, giá_trị_lạ)`."""
    source = os.environ if env is None else env
    raw = str(source.get(env_name, '') or '').strip().lower()
    if not raw:
        return default, None
    if raw in modes:
        return raw, None
    return default, raw


def research_progress_mode(env=None) -> tuple[str, str | None]:
    """`(mode, unknown)` của nhịp báo tiến độ."""
    return _mode(RESEARCH_PROGRESS_ENV, RESEARCH_PROGRESS_MODES, RESEARCH_PROGRESS_DEFAULT_MODE, env)


def steer_mode(env=None) -> tuple[str, str | None]:
    """`(mode, unknown)` của công tắc can thiệp giữa lượt."""
    return _mode(STEER_ENV, STEER_MODES, STEER_DEFAULT_MODE, env)


def mode_notice(rt, sid, code, env_name, value, default):
    """Notice + log cho một công tắc đọc ra giá trị lạ — mỗi mã chỉ nói MỘT lần cho mỗi phiên."""
    if value is None or rt._notice_seen(sid, code):
        return False
    rt.store.emit(sid, 'notice', {
        'code': code, 'value': value, 'partial': False,
        'message': f'{code}: {env_name}={value!r} là giá trị lạ — dùng {default!r} cho lượt này'})
    system_log.write('research.mode_unknown', level='warn', session_id=sid, code=code, value=value)
    return True


def _fold(value: Any) -> str:
    return research_ledger.fold_text(value)


def _owner_views(raw):
    """Chuẩn hoá `ownerViews` của brief: danh sách chuỗi, bỏ rỗng, bỏ trùng, cắt trần.

    Nhận cả một chuỗi đơn (model hay gửi `ownerViews: "…"`) — một ý kiến vẫn là một ý kiến, không
    phải lỗi tham số.
    """
    if raw is None:
        return []
    items = [raw] if isinstance(raw, str) else list(raw)
    out: list[str] = []
    for item in items:
        text = str(item or '').strip()[:RESEARCH_OWNER_VIEW_CHARS]
        if text and text not in out:
            out.append(text)
    return out[:RESEARCH_OWNER_VIEWS_MAX]


def slug_from_question(question: str, research_id: str | None = None) -> str:
    """Slug phòng hồ sơ: `researchId` nếu hợp lệ, ngược lại sinh từ câu hỏi (đọc được, tất định)."""
    candidate = str(research_id or '').strip().lower()
    if candidate and re.fullmatch(RESEARCH_SLUG_RE, candidate):
        return candidate
    words = [word for word in re.findall(r'[a-z0-9]+', _fold(question)) if len(word) > 1][:5]
    slug = '-'.join(words)[:40].strip('-')
    if slug and re.fullmatch(RESEARCH_SLUG_RE, slug):
        return slug
    return f'research-{str(int(time.time()))[-4:]}'


def dossier_dir_for(slug: str) -> str:
    """`.research/<slug>-<yyyymmdd-hhmm>` — một phòng cho mỗi việc, đường dẫn chủ nhà mở được."""
    stamp = time.strftime('%Y%m%d-%H%M', time.gmtime())
    return f'{DOSSIER_ROOM}/{slug}-{stamp}'


# --------------------------------------------------------------------------- sổ nguồn


def _excerpt_key(text: str) -> str:
    """Chìa tự nhiên cho một đoạn trích: vân tay khi đủ dài, ngược lại băm ngắn (đoạn trích ngắn vẫn
    phải idempotent — model gọi lại cùng một dòng thì không được sinh dòng thứ hai)."""
    body = str(text or '')
    if len(body) >= research_ledger.MIN_FINGERPRINT_CHARS:
        return research_ledger.fingerprint(body)
    return 'sha1:' + hashlib.sha1(body.encode('utf-8')).hexdigest()[:16]


def _ledger_owner(rt, session, sid):
    """`(owner, child_id)` — sổ nguồn sống ở phiên GIỮ BRIEF, không ở nhánh con.

    Nhánh con ghi vào sổ của việc (kèm mã nhánh) để (a) cổng chất lượng đọc được cả sổ ở một chỗ,
    (b) luật "mỗi nhánh con phải để lại một dòng" đếm được, (c) hồ sơ ghi ở phiên việc thấy hết nguồn.
    Không tìm được phiên giữ brief thì đi lên tận gốc — dòng sổ vẫn nằm một chỗ, không rơi.
    """
    owner = str(sid)
    if research_config(session).get('researchId'):
        return owner, None
    current = session
    for _ in range(8):
        parent = str(current.get('parent_id') or '')
        if not parent:
            break
        owner = parent
        current = rt.store.get(parent) or {}
        if research_config(current).get('researchId'):
            break
    return owner, (None if owner == str(sid) else str(sid))


def _rows_of(rt, sid) -> list:
    """Sổ nguồn của phiên dưới dạng `research_ledger.Row` (thuần, cho mọi luật)."""
    return [_row_of(item) for item in rt.store.source_rows(sid)]


def _row_of(item) -> Any:
    return research_ledger.Row(
        row_id=item['rowId'], claim=item.get('claim') or '', url=item.get('url') or '',
        host=item.get('host') or '', tier=int(item.get('tier') or 4), type=item.get('type') or 'normal',
        excerpt=item.get('excerpt') or '', fetched_at=item.get('fetchedAt') or '',
        origin=item.get('origin'), method=item.get('method'), source_row_id=item.get('sourceRowId'),
        status=item.get('status') or 'unverified', fingerprint=item.get('fingerprint') or '',
        payload=item.get('payload') or {}, child_id=item.get('childId'),
        turn=int(item.get('turn') or 0), step=item.get('step'), created=str(item.get('created') or ''))


def _count_by(items, key):
    counts: dict[str, int] = {}
    for item in items:
        label = str(key(item))
        counts[label] = counts.get(label, 0) + 1
    return counts


def _ledger_counts(rt, owner) -> dict:
    """Số liệu sổ của MỘT việc: số dòng, số nguồn độc lập, theo tầng, theo nhánh con."""
    items = _rows_of(rt, owner)
    return {'rows': len(items), 'independent': research_ledger.independent_count(items),
            'byChild': rt.store.source_counts_by_child(owner),
            'byTier': _count_by(items, lambda item: str(item.tier))}


def source_add(rt, session, args):
    """`source_add`: ghim một dòng sổ. Ghi lặp CÙNG (url, đoạn trích) là idempotent — một khẳng định,
    một dòng, kể cả khi model gọi lại sau một lỗi mạng hay một lượt lặp."""
    sid = session['id']
    owner, child_id = _ledger_owner(rt, session, sid)
    claim = str(args.get('claim') or '').strip()
    url = str(args.get('url') or '').strip()
    excerpt = str(args.get('excerpt') or '').strip()
    if not claim:
        raise ValueError('SOURCE_INVALID: claim must not be empty — say which assertion this row backs')
    if not url:
        raise ValueError('SOURCE_INVALID: url must not be empty — the row must point at what you opened')
    if not excerpt:
        raise ValueError('SOURCE_INVALID: excerpt must not be empty — record what you actually read, verbatim')
    tier_info = source_tiers.classify(url, type=args.get('type'), method=args.get('method'),
                                      overrides=source_tiers.load_from_env().overrides)
    excerpt_text = excerpt[:SOURCE_EXCERPT_MAX_CHARS]
    key = _excerpt_key(excerpt_text)
    normalized = normalize_url(url)
    for item in _rows_of(rt, owner):
        if normalize_url(item.url) != normalized:
            continue
        if _excerpt_key(item.excerpt) != key:
            continue
        return {'rowId': item.row_id, 'tier': item.tier, 'type': item.type, 'host': item.host,
                'fetchedAt': item.fetched_at, 'reused': True,
                'counts': _ledger_counts(rt, owner), 'label': source_tiers.TIER_LABELS.get(item.tier, ''),
                'reason': 'đã có dòng sổ cho đúng URL và đúng đoạn trích này'}
    row = {
        'claim': claim[:SOURCE_CLAIM_MAX_CHARS],
        'url': url,
        'host': tier_info.host or source_tiers.host_of(url),
        'tier': tier_info.tier,
        'type': tier_info.type,
        'excerpt': excerpt_text,
        'fetched_at': str(args.get('fetchedAt') or journal.utc_now_iso()),
        'origin': (str(args.get('origin') or '').strip()[:SOURCE_ORIGIN_MAX_CHARS] or None),
        'method': str(args.get('method') or 'web_fetch'),
        'source_row_id': (str(args.get('sourceRowId') or '').strip() or None),
        'status': 'unverified',
        'fingerprint': (key if not key.startswith('sha1:') else ''),
        'payload': args.get('payload') if isinstance(args.get('payload'), dict) else {},
        'child_id': child_id,
        'job': research_config(session).get('researchId'),
        'turn': int(rt.active_turn.get(sid) or 0),
        'step': rt.active_step.get(sid),
    }
    stored = rt.store.source_add(owner, row)
    counts = _ledger_counts(rt, owner)
    system_log.write('research.source.added', session_id=sid, code='SOURCE_ADDED',
                     row=stored['rowId'], host=stored['host'], tier=stored['tier'],
                     rows=counts['rows'], chars=len(excerpt_text))
    answer = {'rowId': stored['rowId'], 'tier': stored['tier'], 'type': stored['type'],
              'host': stored['host'], 'fetchedAt': stored['fetchedAt'], 'counts': counts,
              'label': tier_info.label, 'reason': tier_info.reason, 'reused': False}
    if not tier_info.is_primary:
        answer['note'] = (f'{stored["host"]} xếp tầng {stored["tier"]} ({tier_info.label}); một khẳng '
                          f'định then chốt cần nguồn thứ hai KHÁC nguồn tin gốc.')
    if len(excerpt_text) < research_ledger.MIN_EXCERPT_CHARS:
        answer['warning'] = (f'đoạn trích {len(excerpt_text)} ký tự, dưới sàn '
                             f'{research_ledger.MIN_EXCERPT_CHARS} — hồ sơ sẽ bị cổng chất lượng từ chối: '
                             f'lưu đoạn NGUYÊN VĂN đã đọc, không phải tóm tắt.')
    return answer


def source_list(rt, session, args):
    """`source_list`: đọc lại sổ — thứ main phải xem TRƯỚC khi viết hồ sơ."""
    sid = session['id']
    owner, _child = _ledger_owner(rt, session, sid)
    try:
        limit = int(args.get('limit')) if args.get('limit') is not None else SOURCE_ROW_LIMIT_DEFAULT
    except (TypeError, ValueError):
        limit = SOURCE_ROW_LIMIT_DEFAULT
    limit = max(1, min(limit, SOURCE_ROW_LIMIT_MAX))
    try:
        tier = int(args.get('tier')) if args.get('tier') is not None else None
    except (TypeError, ValueError):
        tier = None
    turn = None
    if args.get('turn') is not None:
        try:
            turn = int(args.get('turn'))
        except (TypeError, ValueError):
            turn = None
    rows = rt.store.source_rows(owner, child_id=args.get('childId') or None, turn=turn, tier=tier,
                                limit=limit, newest_first=True)
    counts = _ledger_counts(rt, owner)
    return {'rows': rows, 'counts': {'total': counts['rows'], 'byTier': counts['byTier'],
                                     'byChild': counts['byChild'], 'independent': counts['independent']},
            'window': {'limit': limit, 'returned': len(rows), 'newestFirst': True}}


async def source_verify(rt, session, args):
    """`source_verify`: mở LẠI một URL và so với đoạn trích đã ghim (chống "thành công giả")."""
    sid = session['id']
    owner, _child = _ledger_owner(rt, session, sid)
    row_id = str(args.get('rowId') or '').strip()
    if not row_id:
        raise ValueError('SOURCE_VERIFY_INVALID: rowId is required (r1, r2, … from source_add)')
    stored = rt.store.source_row(owner, row_id)
    if stored is None:
        raise ValueError(f'SOURCE_VERIFY_UNKNOWN: no ledger row {row_id!r} in this session — '
                         f'call source_list to see the row ids you have')
    url = stored['url']
    try:
        payload = await asyncio.to_thread(rt.web.fetch, {'url': url, 'maxChars': 6000})
    except Exception as exc:  # lỗi mở lại ⇒ KHÔNG BAO GIỜ `ok` (A-6, "thành công giả")
        rt.store.source_status_set(owner, row_id, 'unverified', matched=False)
        code = getattr(exc, 'code', exc.__class__.__name__)
        system_log.write('research.source.verify', level='warn', session_id=sid,
                         code='SOURCE_VERIFY_UNREACHABLE', row=row_id, host=stored['host'], remote=code)
        return {'rowId': row_id, 'status': 'unverified', 'matched': False, 'unreachable': True,
                'fakeSuccess': False, 'viaReader': False, 'host': stored['host'],
                'message': f'không mở lại được {stored["host"]} ({code}) — ghi "chưa mở được bản gốc" '
                           f'vào hồ sơ thay vì coi dòng này là đã kiểm'}
    served = dict(payload or {})
    text = str(served.get('text') or '')
    title = str(served.get('title') or '').strip()
    body = text.strip()
    fake = (title in SOURCE_FAKE_SUCCESS_TITLE_MARKERS) or (len(body) < SOURCE_FAKE_SUCCESS_MIN_CHARS)
    ratio = research_ledger.jaccard(research_ledger.shingles(stored.get('excerpt') or ''),
                                    research_ledger.shingles(text))
    matched = (not fake) and ratio >= research_ledger.JACCARD_MERGE
    status = 'ok' if matched else ('stale' if not fake else 'unverified')
    rt.store.source_status_set(owner, row_id, status, matched=matched)
    system_log.write('research.source.verify', level='info', session_id=sid,
                     code='SOURCE_VERIFY_OK' if matched else 'SOURCE_VERIFY_MISMATCH', row=row_id,
                     host=stored['host'], status=status, overlap=round(ratio, 3), chars=len(body),
                     fakeSuccess=fake)
    answer = {'rowId': row_id, 'status': status, 'matched': matched, 'unreachable': False,
              'fakeSuccess': bool(fake), 'viaReader': bool(served.get('reader')),
              'host': stored['host'], 'httpStatus': served.get('status'),
              'overlap': round(ratio, 3), 'chars': len(body), 'fetchedAt': served.get('fetchedAt')}
    if fake:
        answer['message'] = (f'{stored["host"]} trả HTTP {served.get("status")} nhưng thân bài chỉ '
                             f'{len(body)} ký tự (dưới sàn {SOURCE_FAKE_SUCCESS_MIN_CHARS})'
                             f'{f", tiêu đề {title!r}" if title else ""} — "thành công giả": dòng này '
                             f'KHÔNG được coi là đã kiểm; tìm bản gốc khác, hoặc ghi "chưa mở được bản gốc".')
    elif not matched:
        answer['message'] = (f'nội dung đã đổi (trùng {round(ratio, 3)} < {research_ledger.JACCARD_MERGE}); '
                             f'cập nhật đoạn trích bằng `source_add` rồi mới viết hồ sơ.')
    return answer


def pin_source_ledger(rt, sid, payload):
    """Ghim hàng `E:` cho một hồ sơ vừa ghi — con trỏ kiểm chứng, không phải bản sao nội dung."""
    research_id, version = payload.get('researchId'), payload.get('version')
    if not research_id or not isinstance(version, int) or isinstance(version, bool):
        return None
    try:
        return session_journal.insert_row(
            rt.store, sid, 'evidence',
            f"hồ sơ {research_id} v{version} đã ghi ({payload.get('rows')} dòng sổ)",
            evidence=[{'type': 'file', 'path': payload.get('relativePath'),
                       'note': f"hồ sơ nghiên cứu {research_id} v{version}"}],
            data={'research': {'researchId': research_id, 'version': version,
                               'profile': payload.get('profile'), 'level': payload.get('level'),
                               'gate': payload.get('gate'), 'rows': payload.get('rows')}},
            turn=rt.active_turn.get(sid))
    except Exception:  # pragma: no cover - ghi sổ hỏng chỉ log + đi tiếp (bất biến §5.5)
        system_log.write('research.pin.failed', level='warn', session_id=sid,
                         code='JOURNAL_FAILED', research_id=str(research_id))
        return None


# --------------------------------------------------------------------------- brief (ba mức)


async def research_brief(rt, session, args):
    """`research_brief`: chốt mức + hồ sơ + phòng hồ sơ cho MỘT việc research (chỉ main được gọi).

    Bốn luật ở đây là bốn cách giữ "một mức cho cả việc" (#5961):
    `tier` lạ ⇒ kẹp về mức mặc định + notice; `jobProfile` lạ ⇒ kẹp về nhóm thị trường + notice;
    `ceilingSeconds` chỉ được NGẮN hơn trần của mức; và trong cùng một lượt chỉ được **hạ** mức —
    nâng mức phải xin chủ nhà ở lượt sau (D-24/D-40).
    """
    sid = session['id']
    if session.get('role') != 'orchestrator' or session.get('parent_id'):
        raise PermissionError('research_brief is orchestrator-only (#5961): a child must not choose the '
                              'level — ask the main turn to record it, or note it in your answer')
    question = str(args.get('question') or '').strip()
    if not question:
        raise ValueError('RESEARCH_BRIEF_INVALID: question must not be empty — record the research question verbatim')
    rationale = str(args.get('rationale') or '').strip()
    if not rationale:
        raise ValueError('RESEARCH_BRIEF_INVALID: rationale must not be empty — say why this level is the right one')
    raw_tier = args.get('tier')
    try:
        tier = int(raw_tier)
    except (TypeError, ValueError):
        tier = 0
    defaulted = None
    if tier not in RESEARCH_TIERS:
        defaulted, tier = str(raw_tier), RESEARCH_TIER_DEFAULT
    raw_profile = str(args.get('jobProfile') or '').strip()
    profile = research_profiles.resolve(raw_profile)
    bad_profile = None
    if profile is None:
        bad_profile = raw_profile or '(empty)'
        profile = research_profiles.resolve('market')
    limits = research_tier_limits(tier)
    branch_ceiling = limits['branchCeiling']
    owner_views = _owner_views(args.get('ownerViews'))
    branches = [str(item).strip() for item in (args.get('branches') or []) if str(item).strip()]
    dropped_branches = max(0, len(branches) - branch_ceiling)
    branches = branches[:branch_ceiling]
    ceiling, clamped = limits['turnSeconds'], None
    if args.get('ceilingSeconds') is not None:
        try:
            wanted = int(args.get('ceilingSeconds'))
        except (TypeError, ValueError):
            wanted = ceiling
        ceiling = max(60, min(wanted, limits['turnSeconds']))
        if ceiling != wanted:
            clamped = wanted
    existing = research_config(session)
    if existing:
        if args.get('researchId') is not None:
            asked = slug_from_question(question, str(args.get('researchId')))
            if asked != existing.get('researchId'):
                raise ValueError(f'{RESEARCH_BRIEF_TAKEN_CODE}: việc research '
                                 f'{existing.get("researchId")!r} đang mở cho lượt này; một lượt chỉ mở '
                                 f'MỘT việc — gộp câu hỏi mới vào việc đang mở, hoặc để lượt sau')
        if int(existing.get('tier') or 0) < tier:
            raise ValueError(f'{RESEARCH_BRIEF_RAISE_REFUSED_CODE}: mức {existing.get("tier")} đã chốt cho '
                             f'việc {existing.get("researchId")!r}; nâng lên mức {tier} phải xin chủ nhà ở '
                             f'lượt sau — tiếp tục trong mức {existing.get("tier")} và gộp bớt nhánh')
        if float(existing.get('ceilingSeconds') or 0) > ceiling:
            raise ValueError(f'{RESEARCH_BRIEF_RAISE_REFUSED_CODE}: trần lượt đã chốt '
                             f'{existing.get("ceilingSeconds")}s; cần dài hơn thì xin chủ nhà ở lượt sau')
    slug = slug_from_question(question, args.get('researchId'))
    dossier_dir = str(existing.get('dossierDir') or '').strip() or dossier_dir_for(slug)
    config = {'researchId': slug, 'tier': tier, 'jobProfile': profile.key, 'profileGroup': profile.group,
              'question': question, 'branches': branches, 'ceilingSeconds': ceiling,
              'ownerViews': owner_views,
              'dossierDir': dossier_dir, 'startedAt': journal.utc_now_iso(), 'rationale': rationale,
              'waves': limits['waves'], 'waveSize': limits['waveSize'],
              'hardCeilingSeconds': limits['hardCeilingSeconds'], 'mode': 'brief'}
    session.setdefault('config', {})['research'] = config
    # `save` chỉ ghi MESSAGES, nên brief nằm trong `config` phải đi qua `update_config`: không có
    # dòng này thì mức/hồ sơ/phòng hồ sơ biến mất ở lượt sau (harness đọc lại phiên từ store).
    rt.store.update_config(sid, session['config'])
    notices = []
    if defaulted is not None:
        notices.append((RESEARCH_TIER_DEFAULTED_CODE,
                        f'mức {defaulted!r} không thuộc {{1,2,3}} — dùng mức {tier} (mặc định)'))
        system_log.write('research.brief.tier_defaulted', level='warn', session_id=sid,
                         code=RESEARCH_TIER_DEFAULTED_CODE, value=defaulted, tier=tier)
    if bad_profile is not None:
        notices.append((RESEARCH_PROFILE_INVALID_CODE,
                        f'hồ sơ {bad_profile!r} không có trong danh mục — dùng {profile.key!r}'))
        system_log.write('research.brief.profile_defaulted', level='warn', session_id=sid,
                         code=RESEARCH_PROFILE_INVALID_CODE, value=bad_profile, profile=profile.key)
    if clamped is not None:
        notices.append((RESEARCH_CEILING_CLAMPED_CODE,
                        f'ceilingSeconds {clamped} vượt trần của mức {tier} ({limits["turnSeconds"]}s) — '
                        f'dùng {ceiling}s'))
    if dropped_branches:
        notices.append(('RESEARCH_BRANCHES_CLAMPED',
                        f'{dropped_branches} nhánh vượt trần mức {tier} ({branch_ceiling}) đã bị bỏ khỏi brief'))
    if owner_views:
        # #6025 — tự động, không hỏi lại: brief có ý kiến/giả định ⇒ pha phản biện PHẢI có mục riêng
        # ba nhãn, mỗi nhãn kèm nguồn. Câu này nói cho main biết hợp đồng ấy ngay lúc chốt brief.
        notices.append((RESEARCH_OWNER_VIEWS_CODE,
                        f'{len(owner_views)} ý kiến chủ nhà đã ghi — hồ sơ phải có mục soi ý kiến đủ ba '
                        f'nhãn {", ".join(label for label, _ in research_quality.OWNER_VIEW_LABELS)}, '
                        f'mỗi nhãn kèm nguồn'))
    # "Cập nhật" chỉ có nghĩa khi brief ĐỔI: gọi lại y hệt (model lặp một lời gọi) không được ghim
    # thêm hàng `D:` — hàng `D:` để lại dấu vết của một QUYẾT ĐỊNH, không phải của một lời gọi.
    changed = (not existing) or any(existing.get(key) != config.get(key) for key in
                                    ('tier', 'jobProfile', 'question', 'branches', 'ceilingSeconds',
                                     'researchId', 'ownerViews'))
    updated = bool(existing) and changed
    if updated:
        notices.append((RESEARCH_BRIEF_UPDATED_CODE, f'brief của {slug} đã được cập nhật (mức {tier})'))
    elif existing:
        notices.append((RESEARCH_BRIEF_UPDATED_CODE, f'brief của {slug} giữ nguyên (mức {tier})'))
    for code, message in notices:
        rt.store.emit(sid, 'notice', {'code': code, 'tier': tier, 'partial': False,
                                      'message': f'{code}: {message}'})
    rt.store.emit(sid, 'notice', {'code': 'RESEARCH_BRIEF', 'tier': tier, 'jobProfile': profile.key,
                                  'profileLabel': research_profiles.label_of(profile.key),
                                  'dossierDir': dossier_dir, 'branches': branches,
                                  'ceilingSeconds': ceiling, 'partial': False,
                                  'message': (f'RESEARCH_BRIEF: mức {tier} · {research_profiles.label_of(profile.key)} '
                                              f'· phòng {dossier_dir} · trần {ceiling}s'
                                              f'{" · có phản biện độc lập" if limits["critique"] else ""}')})
    system_log.write('research.brief', level='info', session_id=sid, code='RESEARCH_BRIEF', tier=tier,
                     profile=profile.key, dossierDir=dossier_dir, branches=len(branches),
                     ceilingSeconds=ceiling, updated=updated)
    if changed:
        try:
            await session_journal.append(
                rt.executor, rt.store, sid, 'decision',
                f'mức {tier} · hồ sơ {profile.key} · {len(branches)} nhánh · trần {ceiling}s',
                data={'kind': 'research-brief', 'researchId': slug, 'tier': tier,
                      'jobProfile': profile.key, 'dossierDir': dossier_dir, 'branches': branches,
                      'ceilingSeconds': ceiling, 'rationale': rationale, 'updated': updated},
                turn=rt.active_turn.get(sid))
        except Exception:  # pragma: no cover - ghi sổ hỏng ⇒ log + đi tiếp (bất biến §5.5)
            system_log.write('research.brief.journal_failed', level='warn', session_id=sid,
                             code='JOURNAL_FAILED', researchId=slug)
    extended = None
    if int(ceiling) > int(rt.current_turn_seconds(sid)):
        extended = await rt.extend_research_budget(sid, tier=tier, ceiling=ceiling)
    answer = {'researchId': slug, 'tier': tier, 'jobProfile': profile.key,
              'profileLabel': research_profiles.label_of(profile.key), 'dossierDir': dossier_dir,
              'branchCeiling': branch_ceiling, 'waves': limits['waves'], 'waveSize': limits['waveSize'],
              'childSteps': limits['childSteps'], 'childSeconds': limits['childSeconds'],
              'turnSeconds': limits['turnSeconds'], 'softCeilingSeconds': limits['softCeilingSeconds'],
              'hardCeilingSeconds': limits['hardCeilingSeconds'], 'critique': limits['critique'],
              'ownerViews': owner_views, 'updated': updated, 'extendedTurn': bool(extended),
              'next': f'delegate_task(role="research", …) mở đầu context bằng '
                      f'"Mức: {tier} · hồ sơ: {profile.key} · phòng hồ sơ: {dossier_dir}"'}
    if limits['waves'] > 1:
        answer['next'] += (f' — tối đa {limits["waves"]} sóng × {limits["waveSize"]} nhánh; hết sóng thì gộp '
                           f'báo cáo, đừng mở nhánh mới')
    if limits['critique']:
        answer['next'] += (' — mức 3: nhánh viết hồ sơ báo LÊN main; main giao '
                           'delegate_task(role="research-review") đọc hồ sơ rồi main gọi research_verify '
                           'trước khi báo chủ nhà')
    if owner_views:
        answer['next'] += (f' — brief có {len(owner_views)} ý kiến chủ nhà: hồ sơ phải có mục soi ý kiến '
                           f'đủ ba nhãn {", ".join(label for label, _ in research_quality.OWNER_VIEW_LABELS)}, '
                           f'mỗi nhãn kèm nguồn')
    answer['notices'] = [code for code, _ in notices]
    return answer


def brief_mode(env=None) -> tuple[str, str | None]:
    """`(mode, unknown)` của cổng mềm thiếu brief."""
    return _mode(RESEARCH_BRIEF_ENV, RESEARCH_BRIEF_MODES, RESEARCH_BRIEF_DEFAULT_MODE, env)


def branch_limit_check(rt, session, role):
    """Cổng đếm nhánh theo mức (#5982): chỉ áp khi lượt này ĐÃ có brief, và chỉ với `role='research'`."""
    if role != 'research':
        return None
    cfg = research_config(session)
    tier = int(cfg.get('tier') or 0)
    if not tier:
        return None
    sid = session['id']
    ceiling = research_tier_limits(tier)['branchCeiling']
    opened = 0
    for row in rt.store.children_of(sid, turn=rt.active_turn.get(sid)):
        if row.get('role') == 'research':
            opened += 1
    if opened >= ceiling:
        raise ValueError(f'{RESEARCH_BRANCH_LIMIT_CODE}: mức {tier} cho tối đa {ceiling} nhánh research '
                         f'trong lượt này (đã mở {opened}); gộp nhánh lại — việc liên quan phải nằm trong '
                         f'MỘT con — hoặc xin chủ nhà nâng mức ở lượt sau')
    return opened


def missing_brief_gate(rt, session, role):
    """Cổng MỀM `RESEARCH_BRIEF_MISSING`: delegate research mà chưa brief ⇒ notice + log, KHÔNG chặn."""
    mode, unknown = brief_mode()
    sid = session['id']
    if unknown is not None:
        mode_notice(rt, sid, RESEARCH_BRIEF_MODE_UNKNOWN_CODE, RESEARCH_BRIEF_ENV, unknown,
                    RESEARCH_BRIEF_DEFAULT_MODE)
    if mode == 'off' or role != 'research' or has_research_brief(session):
        return False
    if rt._notice_seen(sid, RESEARCH_BRIEF_MISSING_CODE):
        return False
    system_log.write('research.brief.missing', level='warn', session_id=sid,
                     code=RESEARCH_BRIEF_MISSING_CODE, mode=mode)
    rt.store.emit(sid, 'notice', {
        'code': RESEARCH_BRIEF_MISSING_CODE, 'mode': mode, 'partial': False,
        'message': (f'{RESEARCH_BRIEF_MISSING_CODE}: lượt này giao việc research mà chưa gọi '
                    f'`research_brief` — mức/hồ sơ/phòng hồ sơ chưa được chốt, nên trần theo mức và '
                    f'cổng chất lượng hồ sơ không áp. Gọi `research_brief` rồi giao lại.')})
    if mode == 'enforce':
        raise ValueError(f'{RESEARCH_BRIEF_MISSING_CODE}: gọi `research_brief` trước khi '
                         f'delegate_task(role="research")')
    return True


# --------------------------------------------------------------------------- hồ sơ (C-2)


def _dossier_rows(rt, sid, row_ids=None) -> list:
    items = _rows_of(rt, sid)
    if row_ids:
        wanted = {str(item) for item in row_ids}
        items = [item for item in items if item.row_id in wanted]
    return items


def _verified_map(rows) -> dict:
    """`{rowId: matched}` đọc từ `payload.verify` — cái đã đi qua `source_verify`."""
    out = {}
    for row in rows:
        verify = (row.payload or {}).get('verify')
        if isinstance(verify, dict):
            out[row.row_id] = bool(verify.get('matched'))
        elif row.status in ('ok', 'stale'):
            out[row.row_id] = row.status == 'ok'
    return out


def _planned_children(rt, sid) -> list:
    """Mã các phiên con `research` của lượt này — luật `research-lineage-missing` đọc theo đây."""
    turn = rt.active_turn.get(sid)
    return [str(row['session_id']) for row in rt.store.children_of(sid, turn=turn)
            if row.get('role') == 'research']


def _dossier_tables(raw) -> list:
    """Bảng kèm hồ sơ, chuẩn hoá về `[{'name','markdown'}]` — dạng box ghi thành `tables/<tên>.md`.

    Lược đồ công bố của `dossier_write.tables` là LIST; đo được bản cũ chỉ nhận `dict`, nên model gửi
    đúng lược đồ thì bảng **mất âm thầm**, còn `{}` thì bị biến thành `[{}]` và box giết cả lần ghi.
    Không có bảng ⇒ `[]` (box không dựng thư mục `tables/`).
    """
    out = []
    if isinstance(raw, dict):
        pairs = raw.items()
    elif isinstance(raw, list):
        pairs = [(item.get('name'), item.get('markdown')) for item in raw if isinstance(item, dict)]
    else:
        return []
    for name, body in pairs:
        name, body = str(name or '').strip(), str(body or '')
        if name and body.strip():
            out.append({'name': name, 'markdown': body})
    return out


def _dossier_op_args(path, markdown, rows, args, tables, review, title):
    """Tham số cho op `dossier_write` của box — một chỗ, để hợp đồng với worker đọc được một lần."""
    return {
        'path': path,
        'markdown': markdown,
        'title': title,
        'rows': [{'rowId': row.row_id, 'claim': row.claim, 'url': row.url, 'host': row.host,
                  'tier': row.tier, 'type': row.type, 'excerpt': row.excerpt,
                  'fetchedAt': row.fetched_at, 'origin': row.origin, 'method': row.method,
                  'status': row.status} for row in rows],
        'tables': tables,
        'review': review,
        'overwrite': bool(args.get('overwrite')),
    }


async def dossier_write(rt, session, args):
    """`dossier_write`: cổng chất lượng chạy TRƯỚC, rồi mới ghi hồ sơ vào `.research/`.

    Thứ tự ba bước là phần cốt lõi: (1) đọc sổ + hồ sơ + lượt con để máy chấm; (2) `enforce` ⇒ ném
    `RESEARCH_QUALITY_REJECTED` kèm từng dòng thiếu và cách sửa, **không** chạm đĩa; (3) chỉ khi qua
    (hoặc `warn`) mới gọi op của box, rồi ghim hàng `E:` trỏ vào tệp vừa ghi.
    """
    sid = session['id']
    # Hồ sơ do MAIN ghi (ledger subplan §A3.5): nhánh con `research` chỉ để lại dòng sổ + bản tóm tắt,
    # nên cổng vai ở đây là orchestrator. Một nhánh gọi thẳng cũng bị từ chối, không chỉ thiếu tên
    # công cụ trong `config['tools']`.
    if session.get('role') != 'orchestrator':
        raise PermissionError('dossier_write is for the orchestrator — a research branch reports its '
                              'ledger rows up and main writes the dossier')
    cfg = research_config(session)
    research_id = str(args.get('researchId') or cfg.get('researchId') or '').strip().lower()
    if not research_id or not re.fullmatch(RESEARCH_SLUG_RE, research_id):
        raise ValueError(f'RESEARCH_ID_INVALID: researchId {research_id!r} is not a slug — use the id '
                         f'`research_brief` returned, format {RESEARCH_SLUG_RE}')
    try:
        level = int(args.get('level'))
    except (TypeError, ValueError):
        level = 0
    if level not in (1, 2, 3):
        raise ValueError(f'{RESEARCH_LEVEL_INVALID_CODE}: level must be 1, 2 or 3 (got '
                         f'{args.get("level")!r}) — mức quyết định khuôn hồ sơ và cổng chất lượng')
    profile_key = str(args.get('profile') or cfg.get('jobProfile') or '').strip().lower()
    profile = research_profiles.get(profile_key) or research_profiles.resolve(profile_key)
    if profile is None:
        raise ValueError(f'{RESEARCH_PROFILE_INVALID_CODE}: unknown profile {profile_key!r} — one of '
                         f'{", ".join(sorted(research_profiles.PROFILE_LABELS))}')
    markdown = str(args.get('markdown') or '')
    if not markdown.strip():
        raise ValueError('DOSSIER_INVALID: markdown must be a non-empty string')
    tier_limits = research_tier_limits(level)
    critique_arg = str(args.get('critique') or 'none').strip().lower()
    if critique_arg not in research_header.CRITIQUE_VALUES:
        critique_arg = 'none'
    rows = _dossier_rows(rt, sid, args.get('rows'))
    if len(rows) > RESEARCH_MAX_ROWS_PER_DOSSIER:
        rows = rows[:RESEARCH_MAX_ROWS_PER_DOSSIER]
    children = _planned_children(rt, sid)
    mode, raw_mode = research_quality.gate_mode()
    if raw_mode:
        mode_notice(rt, sid, RESEARCH_GATE_MODE_UNKNOWN_CODE, RESEARCH_GATE_ENV, raw_mode,
                    RESEARCH_GATE_DEFAULT_MODE)
    latest_verdict = rt.store.research_verification_latest(research_id)
    critique_ok = True
    if tier_limits['critique']:
        # Bản ĐẦU của mức 3 ghi được (chưa ai phản biện thì không có gì để kèm); từ bản thứ hai, sau
        # khi đã có phán quyết, hồ sơ phải mang phản biện ĐẠT — nếu không thì đây là bản viết lại
        # lờ phản biện, và cổng chặn (D-40, #6024).
        critique_ok = (critique_arg == 'ok') or latest_verdict is None
        if critique_arg == 'none' and latest_verdict is None:
            rt.store.emit(sid, 'notice', {
                'code': RESEARCH_CRITIQUE_MISSING_CODE, 'partial': False,
                'message': (f'{RESEARCH_CRITIQUE_MISSING_CODE}: mức {level} cần phản biện độc lập — sau '
                            f'bản này hãy delegate_task(role="research-review") rồi `research_verify`')})
    verdict = research_quality.assess(session, profile=profile, level=level, markdown=markdown,
                                      rows=rows, child_ids=children, mode=mode,
                                      critique_ok=critique_ok, verified=_verified_map(rows),
                                      owner_views=(cfg.get('ownerViews') if cfg else []),
                                      review=str(args.get('review') or ''))
    if not verdict.ok and verdict.mode == 'enforce':
        system_log.write('research.gate.rejected', level='warn', session_id=sid,
                         code=research_quality.RESEARCH_QUALITY_PREFIX, mode=verdict.mode,
                         issues=[item['code'] for item in verdict.missing], rows=len(rows))
        raise ValueError(research_quality.rejection_message(verdict))
    versions = rt.store.dossier_versions(research_id)
    version = (int(versions[-1] or 0) if versions else 0) + 1
    dossier_dir = str(cfg.get('dossierDir') or '').strip() or f'{DOSSIER_ROOM}/{research_id}'
    path = f'{dossier_dir}/v{version}-{research_id}.md'
    if not path.startswith(f'{DOSSIER_ROOM}/{research_id}') and not path.startswith(dossier_dir):
        raise ValueError(f'{DOSSIER_DIR_MISMATCH_CODE}: hồ sơ phải nằm trong phòng {dossier_dir!r} '
                         f'(đường dẫn nhận được: {path!r})')
    gate_label = _gate_label(verdict, level, critique_arg)
    header = research_header.build_research_header(
        version, research_id, profile.key, level, critique=critique_arg, gate=gate_label,
        rows=len(rows))
    full = header + markdown
    tables = _dossier_tables(args.get('tables'))
    review = str(args.get('review') or '')
    title = str(args.get('title') or '').strip() or research_id.replace('-', ' ')
    write_args = _dossier_op_args(path, full, rows, args, tables, review, title)
    async with rt.writer_lock:
        written = await rt.executor.execute('dossier_write', write_args, sid)
    written = dict(written or {})
    returned = str(written.get('relativePath') or '')
    if not returned.endswith(f'v{version}-{research_id}.md'):
        raise ValueError(f'DOSSIER_WRITE_CONFLICT: box báo đường dẫn {returned!r} trong khi lượt này ghi '
                         f'{path!r}; không có gì được đăng ký')
    rt.store.record_dossier(sid, research_id, version, returned, profile=profile.key, level=level,
                            critique=critique_arg, gate=gate_label, rows=len(rows),
                            bytes=int(written.get('bytes') or len(full.encode('utf-8'))))
    payload = {'researchId': research_id, 'version': version, 'profile': profile.key, 'level': level,
               'rows': len(rows), 'relativePath': returned, 'gate': verdict.mode,
               'bytes': int(written.get('bytes') or len(full.encode('utf-8')))}
    if verdict.issues:
        rt.store.emit(sid, 'notice', {
            'code': RESEARCH_GATE_NOTE_CODE, 'mode': verdict.mode, 'partial': False,
            'issues': [item['code'] for item in verdict.missing], 'soft': verdict.soft,
            'message': research_quality.notice_for(verdict.issues, len(rows))})
        system_log.write('research.gate.unbacked', level='warn', session_id=sid,
                         code=RESEARCH_GATE_NOTE_CODE, mode=verdict.mode, researchId=research_id,
                         version=version, issues=[item['code'] for item in verdict.missing])
    if verdict.soft:
        rt.store.emit(sid, 'notice', {
            'code': 'RESEARCH_GATE_SOFT', 'partial': False, 'fields': verdict.soft,
            'message': f'RESEARCH_GATE_SOFT: trường mềm còn thiếu — {", ".join(verdict.soft)}'})
    pin = pin_source_ledger(rt, sid, payload)
    system_log.write('research.dossier.written', level='info', session_id=sid,
                     code='DOSSIER_WRITTEN', researchId=research_id, version=version, rows=len(rows),
                     bytes=payload['bytes'], gateMode=verdict.mode, tierLevel=level)
    answer = {'researchId': research_id, 'version': version, 'profile': profile.key,
              'level': level, 'relativePath': returned, 'files': written.get('files') or [returned],
              'header': {'version': version, 'researchId': research_id, 'profile': profile.key,
                         'level': level, 'critique': critique_arg, 'rows': len(rows)},
              'gate': {'mode': verdict.mode, 'ok': verdict.ok,
                       'issues': [item['code'] for item in verdict.missing], 'soft': verdict.soft,
                       'counts': verdict.counts},
              'journal': bool(pin and pin[1]),
              'bytes': payload['bytes'], 'sha1': written.get('sha1')}
    if not verdict.ok and verdict.mode == 'warn':
        answer['warning'] = research_quality.notice_for(verdict.issues, len(rows))
    critique_step = (' — mức 3 cần phản biện độc lập: **báo main** kèm đường dẫn hồ sơ để main giao '
                     'delegate_task(role="research-review") rồi main gọi `research_verify` cho bản này '
                     '(chỉ main ghi được phán quyết)')
    answer['next'] = ('báo cáo chủ nhà bằng đường dẫn hồ sơ, không dán lại toàn văn'
                      + (critique_step if tier_limits['critique'] else ''))
    return answer


def _gate_label(verdict, level, critique_arg) -> str:
    """`Gate:` của header + cột `gate` của chỉ mục: `clear` sạch, `warn` có mục chỉ nhắc, `unbacked` cổng tắt.

    Ba nhãn này là hợp đồng với FE (`research_header.GATE_VALUES`), nên `off` **không** được ghi thành
    `clear`: một hồ sơ không ai chấm thì không phải một hồ sơ sạch.
    """
    mode = str(getattr(verdict, 'mode', '') or '')
    if mode == 'off':
        return 'unbacked'
    if getattr(verdict, 'issues', None):
        return 'warn'
    if research_tier_limits(level)['critique'] and critique_arg == 'none':
        return 'warn'
    return 'clear'


def annotate_branch_answer(rt, session, child_id, answer, calls=()):
    """Chú thích tất định cho câu trả lời của MỘT nhánh research (đợt 4, A5) — chỉ đọc.

    Sổ nguồn sống ở phiên GIỮ BRIEF, dòng của nhánh mang `childId` của chính nó (A3.5), nên đọc
    theo nhánh phải hỏi chủ sổ. Hàm này **không** viết lại câu trả lời (I2/D-18) và **không** đổi
    `status` (I3): kết quả chỉ là một chú thích cho chủ nhà và cho người gọi.
    """
    # Chủ sổ tìm từ PHIÊN CON: khi cha chưa giữ brief, `_ledger_owner` đi ngược LÊN từ chính con —
    # hỏi từ phiên cha thì nó dừng ngay ở cha và đọc nhầm sổ rỗng của con (BUG-108).
    child_session = rt.store.get(str(child_id)) or session
    owner, _child = _ledger_owner(rt, child_session, str(child_id))
    rows = [_row_of(item) for item in rt.store.source_rows_for(owner, [str(child_id)])]
    profile = None
    try:
        profile = research_profiles.get(research_config(rt.store.get(owner) or {}).get('jobProfile') or '')
    except Exception:  # pragma: no cover - chú thích không bao giờ được chặn đường đóng lượt con
        profile = None
    return research_quality.annotate_child_answer(answer, rows=rows, calls=calls,
                                                 child_id=str(child_id), profile=profile)


# --------------------------------------------------------------------------- phản biện (đợt 6)


def research_critique(rt, sid, research_id, version):
    """Cổng provenance của phản biện hồ sơ — khuôn `plan_critique`, đọc verdict ở DÒNG CUỐI.

    Bốn điều kiện: có bản hồ sơ thật cho `(research_id, version)`; phiên con mang vai
    `research-review`; nó chạy SAU lần ghi đó; câu trả lời đủ dài để có nội dung đọc được.
    """
    row = rt.store.dossier(research_id, version)
    if row is None:
        raise ValueError(f'{RESEARCH_VERIFY_UNKNOWN_CODE}: no dossier write is recorded for '
                         f'{research_id}@v{version} — write it first with dossier_write')
    written_at = float(row.get('created') or 0)
    usable = []
    for child in rt.store.children_of(sid):
        if child.get('role') != 'research-review' or child.get('status') != 'completed':
            continue
        if float(child.get('started') or 0) < written_at:
            continue
        if int(child.get('answer_chars') or 0) < RESEARCH_REVIEW_MIN_ANSWER_CHARS:
            continue
        usable.append(child)
    if not usable:
        raise ValueError(f'{RESEARCH_VERIFY_NO_CRITIC_CODE}: {research_id}@v{version} chưa có phản biện '
                         f'dùng được — delegate_task(role="research-review") SAU khi bản này được ghi và '
                         f'để nó kết thúc với câu trả lời ít nhất {RESEARCH_REVIEW_MIN_ANSWER_CHARS} ký tự')
    critic = max(usable, key=lambda item: (float(item.get('started') or 0), str(item.get('session_id'))))
    text = ''
    for event in rt.store.events(critic['session_id']):
        if event['type'] != 'assistant':
            continue
        candidate = event['data'].get('text') if isinstance(event['data'], dict) else None
        if isinstance(candidate, str) and candidate.strip():
            text = candidate
    lines = [line.strip() for line in str(text or '').splitlines() if line.strip()]
    found = re.match(r'(?i)^VERDICT:\s*(ok|revise)$', lines[-1] if lines else '')
    if found is None:
        raise ValueError(f'{RESEARCH_VERIFY_VERDICT_MISSING_CODE}: câu trả lời phản biện phải KẾT THÚC bằng '
                         f'đúng một dòng "VERDICT: ok" hoặc "VERDICT: revise" (con '
                         f'{str(critic["session_id"])[:8]}, {len(lines)} dòng) — hỏi nó dòng verdict rồi '
                         f'gọi `research_verify` lại')
    return critic, found.group(1).lower(), int(critic.get('answer_chars') or 0)


def _clamp_issues(issues) -> list:
    out = []
    for item in issues or []:
        text = str(item).strip()
        if text:
            out.append(text[:RESEARCH_VERIFY_ISSUE_CHARS])
    return out[:RESEARCH_VERIFY_MAX_ISSUES]


async def research_verify(rt, session, args):
    """`research_verify`: ghi phán quyết phản biện — CHỈ khi có phê bình độc lập thật.

    Vai: **orchestrator** (iface.md §1). Người phản biện không tự ghi phán quyết của chính mình —
    luật đó là chỗ biến "phản biện độc lập" từ lời nói thành chuyện máy kiểm được (D-40).
    """
    if session.get('role') != 'orchestrator':
        raise PermissionError('research_verify is for the orchestrator role — a research branch that '
                              'got a critique reports the verdict up to the orchestrator, which records '
                              'it (the critic is the orchestrator\'s own child)')
    sid = session['id']
    research_id = str(args.get('researchId') or '').strip().lower()
    if not research_id:
        raise ValueError(f'{RESEARCH_VERIFY_UNKNOWN_CODE}: researchId is required — the id '
                         f'`research_brief` returned')
    version = args.get('version')
    if isinstance(version, bool) or not isinstance(version, int):
        raise ValueError(f'{RESEARCH_VERIFY_VERSION_MISSING_CODE}: version must be an integer (which '
                         f'dossier version the critique read)')
    verdict = str(args.get('verdict') or '').strip().lower()
    if verdict not in ('ok', 'revise'):
        raise ValueError('RESEARCH_VERIFY_INVALID: verdict must be "ok" or "revise"')
    issues = _clamp_issues(args.get('issues'))
    summary = str(args.get('summary') or '')[:RESEARCH_VERIFY_SUMMARY_CHARS]
    critic, critic_verdict, answer_chars = research_critique(rt, sid, research_id, version)
    if critic_verdict != verdict:
        raise ValueError(f'{RESEARCH_VERIFY_VERDICT_MISMATCH_CODE}: phản biện nói {critic_verdict!r} mà bạn '
                         f'ghi {verdict!r} — ghi đúng điều nó nói, hoặc hỏi nó phản biện lại nếu nó sai')
    rt.store.record_research_verification(research_id, version, sid, verdict, issues=issues,
                                          summary=summary, critic_session_id=critic['session_id'],
                                          critic_answer_chars=answer_chars, critic_verdict=critic_verdict)
    rt.store.dossier_critique_set(research_id, version, verdict)
    rt.store.emit(sid, 'research_verified', {
        'researchId': research_id, 'version': version, 'verdict': verdict, 'issues': issues,
        'summary': summary, 'criticSessionId': critic['session_id'], 'criticAnswerChars': answer_chars,
        'at': journal.utc_now_iso()})
    rounds = rt.store.research_verification_count(research_id, verdict='revise')
    capped = rounds > RESEARCH_VERIFY_REVISE_MAX
    label = RESEARCH_CRITIQUE_LABEL if verdict == 'revise' else ''
    try:
        await session_journal.append(
            rt.executor, rt.store, sid, 'fact',
            f'phản biện độc lập hồ sơ {research_id}@v{version}: {verdict} — {len(issues)} vấn đề',
            data={'researchVerification': {'researchId': research_id, 'version': version,
                                           'verdict': verdict, 'issueCount': len(issues),
                                           'criticSessionId': critic['session_id']}},
            turn=rt.active_turn.get(sid))
    except Exception:  # pragma: no cover - ghi sổ hỏng ⇒ log + đi tiếp
        system_log.write('research.verify.journal_failed', level='warn', session_id=sid,
                         code='JOURNAL_FAILED', researchId=research_id)
    system_log.write('research.verified', level='info', session_id=sid, code='RESEARCH_VERIFIED',
                     researchId=research_id, version=version, verdict=verdict, issues=len(issues),
                     reviseRounds=rounds)
    answer = {'researchId': research_id, 'version': version, 'verdict': verdict, 'capped': capped,
              'label': label, 'issues': issues, 'criticSessionId': critic['session_id'],
              'criticAnswerChars': answer_chars, 'reviseRounds': rounds}
    if verdict == 'revise':
        answer['next'] = ('sửa đúng các điểm đã nêu rồi ghi bản mới bằng `dossier_write` (kèm '
                          f'critique="ok" khi đã xử lý) — còn tối đa {RESEARCH_VERIFY_REVISE_MAX} vòng sửa')
    if capped:
        answer['message'] = (f'{RESEARCH_CRITIQUE_LABEL}: đã quá trần {RESEARCH_VERIFY_REVISE_MAX} vòng '
                             f'`revise` cho việc này — dừng viết lại và báo chủ nhà trung thực, kèm bản '
                             f'còn phải sửa')
    return answer


def research_status(rt, session, args):
    """`research_status`: đọc lại một việc — có mấy bản, bản nào, ai phản biện, bằng gì.

    Vai được đọc: orchestrator, phiên research của việc, và người phản biện (`research-review`) —
    đúng hợp đồng `/var/tmp/v27/iface.md` §1. Vai khác gọi vào là lỗi quyền, không phải lỗi dữ liệu.
    """
    if session.get('role') not in {'orchestrator', 'research', 'research-review'}:
        raise PermissionError('research_status is for the orchestrator, the research session and the reviewer')
    research_id = str(args.get('researchId') or research_config(session).get('researchId') or '').strip().lower()
    if not research_id:
        raise ValueError(f'{RESEARCH_VERIFY_UNKNOWN_CODE}: researchId is required (or call `research_brief` '
                         f'first so the turn knows which job you mean)')
    # Người gọi thường là một phiên CON (nhánh research, người phản biện) ⇒ số liệu sổ nguồn phải đọc
    # ở phiên giữ brief, không phải sổ rỗng của chính nó.
    owner, _child = _ledger_owner(rt, session, session['id'])
    versions = [int(item) for item in rt.store.dossier_versions(research_id)]
    latest = rt.store.dossier_latest(research_id)
    verifications = rt.store.research_verifications(research_id)
    cfg = research_config(session)
    answer = {'researchId': research_id, 'versions': versions,
              'latest': ({'version': int(latest['version']), 'path': latest['relative_path'],
                          'profile': latest['profile'], 'level': int(latest['level']),
                          'critique': latest['critique'], 'gate': latest['gate'],
                          'rows': int(latest['rows']), 'bytes': int(latest['bytes']),
                          'sessionId': latest['session_id']} if latest else None),
              'verifications': [{'version': int(item['version']), 'verdict': item['verdict'],
                                 'issues': len(item['issues']), 'summary': item['summary'],
                                 'criticSessionId': item['criticSessionId']} for item in verifications],
              'config': ({'tier': cfg.get('tier'), 'jobProfile': cfg.get('jobProfile'),
                          'dossierDir': cfg.get('dossierDir'), 'branches': cfg.get('branches'),
                          'ceilingSeconds': cfg.get('ceilingSeconds'), 'question': cfg.get('question')}
                         if cfg else None),
              'counts': {'versions': len(versions), 'verifications': len(verifications),
                         'revise': rt.store.research_verification_count(research_id, verdict='revise'),
                         'ledgerRows': rt.store.source_count(owner),
                         'independent': research_ledger.independent_count(_rows_of(rt, owner))}}
    return answer


async def cancel_child(rt, session, args):
    """`cancel_child`: chủ nhà dừng MỘT nhánh — chỉ nhánh của chính phiên này, và chỉ một lần."""
    sid = session['id']
    target = str(args.get('sessionId') or '').strip()
    reason = str(args.get('reason') or '').strip()
    if not target:
        raise ValueError('CANCEL_CHILD_INVALID: sessionId is required (the child to stop)')
    row = rt.store.child(target)
    if row is None or str(row.get('parent_id') or '') != sid:
        raise PermissionError('CANCEL_CHILD_NOT_MINE: that session is not a child of this turn — only the '
                              'parent can cancel a branch')
    if str(row.get('status') or '') in {'completed', 'failed', 'cancelled', 'interrupted', 'not_found'}:
        return {'sessionId': target, 'status': 'already_closed', 'childStatus': row.get('status'),
                'reason': row.get('reason')}
    await rt.stop(target)
    closed = rt.store.child_close_once(target, 'cancelled', reason='OWNER_CANCELLED')
    for steer in rt.store.claim_steers(target, limit=STEER_MAX_PENDING):
        rt.store.mark_steer(steer['id'], 'dropped')
    rt.store.emit(sid, 'child', {'sessionId': target, 'status': 'cancelled', 'cancelledBy': 'owner',
                                 'reason': reason or None, 'role': row.get('role'),
                                 'at': journal.utc_now_iso()})
    try:
        await session_journal.append(
            rt.executor, rt.store, sid, 'fact',
            f'chủ nhà dừng nhánh {row.get("role") or "con"} {target[:8]}',
            data={'childCancel': {'sessionId': target, 'reason': reason or None,
                                  'cancelledBy': 'owner'}}, turn=rt.active_turn.get(sid))
    except Exception:  # pragma: no cover - ghi sổ hỏng ⇒ log + đi tiếp
        system_log.write('research.cancel.journal_failed', level='warn', session_id=sid,
                         code='JOURNAL_FAILED', child=target)
    system_log.write('child.cancelled_by_owner', level='info', session_id=sid, code='OWNER_CANCELLED',
                     child=target, role=row.get('role'), closed=bool(closed))
    return {'sessionId': target, 'status': 'cancelled', 'childStatus': 'cancelled',
            'role': row.get('role'), 'reason': reason or None}


# --------------------------------------------------------------- chỉ thị giữa lượt (đợt 7)


async def queue_owner_steer(rt, sid, text, turn=None):
    """Xếp một chỉ thị giữa lượt — trả `(answer, notice)` cho route, hoặc `None` khi công tắc tắt."""
    mode, unknown = steer_mode()
    if unknown is not None:
        mode_notice(rt, sid, STEER_MODE_UNKNOWN_CODE, STEER_ENV, unknown, STEER_DEFAULT_MODE)
    if mode != 'on':
        return None
    body = str(text or '').strip()
    if not body:
        raise ValueError('STEER_EMPTY: chỉ thị trống — gõ nội dung cần nhắn cho lượt đang chạy')
    if len(body) > STEER_TEXT_MAX_CHARS:
        body = body[:STEER_TEXT_MAX_CHARS]
    if rt.store.pending_steer_count(sid) >= STEER_MAX_PENDING:
        raise ValueError(f'STEER_QUEUE_FULL: đã có {STEER_MAX_PENDING} chỉ thị đang chờ bơm vào lượt này — '
                         f'chờ lượt bơm bớt rồi gửi tiếp')
    turn_no = int(turn if turn is not None else (rt.active_turn.get(sid) or 0))
    record = rt.store.queue_steer(sid, body, turn_no)
    rt.store.emit(sid, 'user', {'text': f'{OWNER_STEER_PREFIX} {body}', 'control': True,
                                'steer': True, 'steerId': record['id'], 'turn': turn_no})
    try:
        await session_journal.append(
            rt.executor, rt.store, sid, 'decision', f'chỉ thị giữa lượt: {body[:120]}',
            data={'kind': 'owner-steer', 'steerId': record['id'], 'chars': len(body)},
            turn=turn_no)
    except Exception:  # pragma: no cover - ghi sổ hỏng ⇒ log + đi tiếp
        system_log.write('steer.journal_failed', level='warn', session_id=sid, code='JOURNAL_FAILED')
    system_log.write('steer.queued', level='info', session_id=sid, code='OWNER_STEER',
                     steerId=record['id'], chars=len(body), pending=rt.store.pending_steer_count(sid))
    return {'status': 'steered', 'steerId': record['id'], 'turn': turn_no,
            'pending': rt.store.pending_steer_count(sid)}


def steer_block(records) -> str:
    """Khối văn bản bơm vào transcript: mỗi chỉ thị một mục, giữ nguyên văn của chủ nhà."""
    lines = []
    for record in records:
        lines.append(f'{OWNER_STEER_PREFIX} {str(record.get("text") or "").strip()}')
    return '\n\n'.join(lines)


def drain_steers(rt, sid, messages) -> int:
    """Bơm các chỉ thị đang chờ vào transcript ở ranh giới bước — **một** lần cho mỗi chỉ thị."""
    claimed = rt.store.claim_steers(sid, limit=STEER_DRAIN_MAX)
    if not claimed:
        return 0
    messages.append({'role': 'user', 'content': steer_block(claimed)})
    rt.store.save(sid, messages)
    system_log.write('steer.injected', level='info', session_id=sid, code='OWNER_STEER',
                     count=len(claimed), steerIds=[record['id'] for record in claimed])
    return len(claimed)


def nudge_due(rt, sid) -> int | None:
    """Số phút nếu tới nhịp báo tiến độ (#5969) và còn quota trong lượt này, ngược lại `None`."""
    mode, unknown = research_progress_mode()
    if unknown is not None:
        mode_notice(rt, sid, 'RESEARCH_PROGRESS_MODE_UNKNOWN', RESEARCH_PROGRESS_ENV, unknown,
                    RESEARCH_PROGRESS_DEFAULT_MODE)
    if mode != 'on':
        return None
    state = rt.progress_state.get(sid)
    if not isinstance(state, dict):
        return None
    if state.get('turn') != (rt.active_turn.get(sid) or 0):
        return None
    if int(state.get('count') or 0) >= RESEARCH_PROGRESS_MAX_PER_TURN:
        return None
    if float(state.get('due') or 0) > time.time():
        return None
    return int(RESEARCH_PROGRESS_NUDGE_SECONDS // 60)


def inject_progress_nudge(rt, sid, messages, minutes) -> bool:
    """Bơm câu nhắc tiến độ: **không** event, **không** hàng `D:` — chỉ một mục `user` trong transcript."""
    state = rt.progress_state.get(sid)
    if not isinstance(state, dict):
        return False
    messages.append({'role': 'user', 'content': RESEARCH_NUDGE_PREFIX + ' ' + _NUDGE_BODY.format(elapsed=minutes)})
    rt.store.save(sid, messages)
    state['count'] = int(state.get('count') or 0) + 1
    state['due'] = time.time() + RESEARCH_PROGRESS_NUDGE_SECONDS
    system_log.write('research.progress.nudged', level='info', session_id=sid,
                     code='RESEARCH_PROGRESS_NUDGE', count=state['count'], minutes=minutes)
    return True
