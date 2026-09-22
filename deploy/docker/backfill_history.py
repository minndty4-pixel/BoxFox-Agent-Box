#!/usr/bin/env python3
"""Nạp lịch sử cũ vào thư mục phiên (A9) — **mặc định chỉ đọc, in bản dry-run**.

Ba thứ đang có trên máy chủ nhà (đo 2026-09-21) mà đường mới không tự thấy:

| Dữ liệu | Số đo | Việc ở đây |
|---|---|---|
| Hàng `checkpoints` | **22 hàng / 12 phiên / 17 967 616 B** | Ghi cặp `.session-history/<sid8>/checkpoints/ck-<sid8>-NNN.{json,md}` + ghim một bản ghi `C:` |
| `tool_end` có `artifact` | 375 ảnh/ghi hình phẳng, 113 MB | **Gán về phiên** và đếm file không gán được — không bịa phiên cho file lạ |
| Event `plan_written` | 10 hàng | Ghim `P:<identity>@v<n>` (không sửa tệp `.plans/` nào) |

Luật của tệp này:

1. **Mặc định dry-run.** Mọi thao tác ghi đều phải qua `--apply`, và bản dry-run in ra đúng số việc
   sẽ làm. Chủ nhà đọc bản dry-run trước khi cho ghi (kế hoạch đợt 20, bảng di trú dữ liệu).
2. **Idempotent.** Số hiệu checkpoint cấp theo thứ tự hàng trong SQLite (`id`), **không** cấp lại theo
   lượt chạy; file nào đã có thì **bỏ qua**, nên chạy `--apply` hai lần không đẻ ra bản trùng.
3. **Không bịa.** File không gán được về phiên nào thì chỉ đếm và liệt kê, không gán bừa.

Lệnh:

    python3 backfill_history.py --db ~/BoxFox/harness/sessions.sqlite          # dry-run
    python3 backfill_history.py --db ... --apply --stage                        # ghi thật (staged vào box)

`--stage` chép `session_files.py` + `session_ops.py` vào `/usr/local/bin` trong container **trước**
khi gọi (đường dây worker cũng cần hai tệp đó), rồi so `md5sum` sau khi chép — bài học đợt 19.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
STAGE_DIR = "/usr/local/bin"
STAGED_FILES = ("session_files.py", "session_ops.py")
BOX_PYTHON = "/opt/pw-driver/bin/python3"
DEFAULT_CONTAINER = "agentbox-box"
DEFAULT_ROOT = "/home/agent/workspace/.session-history"
DEFAULT_CAPTURES = "/home/agent/workspace/.generated_artifacts/captures"


def _sid8(session_id: str) -> str:
    """Tám ký tự đầu của id phiên — khớp `session_files.sid8_of` (một quy luật, hai nơi đọc)."""
    clean = "".join(ch for ch in str(session_id or "") if ch.isalnum())
    return clean[:8].lower()


def read_rows(db_path: Path) -> dict:
    """Đọc DB của harness ở chế độ **chỉ đọc** (`mode=ro`) — không được ghi vào máy chủ nhà."""
    uri = f"file:{Path(db_path).as_posix()}?mode=ro"
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    try:
        checkpoints = [dict(row) for row in db.execute(
            'SELECT id, session_id, reason, created FROM checkpoints ORDER BY session_id, id')]
        artifacts = [dict(row) for row in db.execute(
            "SELECT seq, session_id, payload FROM events "
            "WHERE kind IN ('tool_end','tool_start') AND payload LIKE '%artifact%' ORDER BY seq")]
        plans = [dict(row) for row in db.execute(
            "SELECT seq, session_id, payload FROM events WHERE kind='plan_written' ORDER BY seq")]
        sessions = {row['id']: row['status'] for row in db.execute('SELECT id, status FROM sessions')}
    finally:
        db.close()
    return {'checkpoints': checkpoints, 'artifacts': artifacts, 'plans': plans, 'sessions': sessions}


def _artifact_of(payload: dict) -> str:
    """Đường dẫn artefact trong một payload — đo trên máy chủ nhà 2026-09-21: `tool_end` để nó ở
    `result.artifact` (`computer_screen_capture`), còn vài hàng cũ để ở `data.artifact`."""
    for candidate in (payload.get('artifact'), (payload.get('result') or {}).get('artifact'),
                      (payload.get('data') or {}).get('artifact')):
        if candidate:
            return str(candidate)
    return ''


def attribution(rows: dict) -> dict:
    """Mỗi artefact phẳng thuộc phiên nào — và **bao nhiêu file không gán được**.

    Đường cũ ghi ảnh vào thư mục phẳng, nên quan hệ duy nhất còn lại là payload của `tool_start`/
    `tool_end` trỏ vào đường dẫn. File nào không xuất hiện trong bất kỳ payload nào thì thuộc nhóm
    `unattached` và bản báo cáo nói thẳng con số — không gán bừa cho phiên "gần nhất".
    """
    by_session: dict[str, list[str]] = {}
    known: set[str] = set()
    for row in rows['artifacts']:
        try:
            payload = json.loads(row['payload'])
        except (TypeError, ValueError):
            continue
        path = _artifact_of(payload) if isinstance(payload, dict) else ''
        if not path:
            continue
        known.add(path)
        by_session.setdefault(row['session_id'], []).append(path)
    return {'bySession': {sid: sorted(set(paths)) for sid, paths in by_session.items()},
            'knownPaths': sorted(known), 'sessionsWithArtifacts': len(by_session)}


def unattached(captures_root: str, known: set, container: str = DEFAULT_CONTAINER) -> dict:
    """File trong thư mục ảnh/ghi hình mà **không** payload nào nhắc tới.

    Đếm được thì trả `{'files': N, 'bytes': M, 'readable': True}`; không đọc được box (container
    chưa chạy, quyền) thì trả `readable: False` — bản báo cáo nói "không đọc được", không nói "0".
    """
    if not captures_root:
        return {'readable': False, 'files': None, 'bytes': None}
    proc = subprocess.run(
        ['docker', 'exec', container, 'bash', '-lc',
         f'cd {captures_root} 2>/dev/null && find . -type f -printf "%s %p\\n" || true'],
        capture_output=True, text=True)
    if proc.returncode:
        return {'readable': False, 'files': None, 'bytes': None}
    files = total = 0
    for line in proc.stdout.splitlines():
        size, _, path = line.strip().partition(' ')
        full = f'{captures_root}/{path[2:]}' if path.startswith('./') else f'{captures_root}/{path}'
        if full in known:
            continue
        files += 1
        try:
            total += int(size)
        except ValueError:
            pass
    return {'readable': True, 'files': files, 'bytes': total}


def plan(rows: dict, existing: set[str] = None) -> dict:
    """Danh sách việc sẽ làm — thuần, không chạm đĩa, không chạm box.

    `existing` là tập đường dẫn **tương đối** (so với gốc `.session-history`) đã có trong box;
    file nào đã có thì việc đó `skip=True` (idempotent, xem luật 2 ở docstring module).
    """
    existing = set(existing or ())
    numbers: dict[str, int] = {}
    checkpoint_actions, skipped = [], 0
    for row in rows['checkpoints']:
        sid8 = _sid8(row['session_id'])
        numbers[sid8] = numbers.get(sid8, 0) + 1
        number = numbers[sid8]
        rel = f"{sid8}/checkpoints/ck-{sid8}-{number:03d}.json"
        present = rel in existing
        skipped += 1 if present else 0
        checkpoint_actions.append({
            'op': 'checkpoint_write', 'skip': present, 'session': row['session_id'],
            'number': number, 'relPath': rel, 'checkpointRowId': row['id'], 'reason': row['reason'],
        })
    pins = []
    seen_pins = set()
    for row in rows['plans']:
        try:
            payload = json.loads(row['payload'])
        except (TypeError, ValueError):
            continue
        identity, version = payload.get('identity'), payload.get('version')
        if not identity or not version:
            continue
        key = (row['session_id'], str(identity), int(version))
        if key in seen_pins:
            continue
        seen_pins.add(key)
        pins.append({'op': 'journal_append', 'skip': False, 'session': row['session_id'],
                     'kind': 'plan', 'plan': {'identity': str(identity), 'version': int(version)},
                     'text': str(payload.get('slug') or identity)})
    return {'checkpoints': checkpoint_actions, 'pins': pins,
            'counts': {'checkpointRows': len(checkpoint_actions), 'checkpointSkipped': skipped,
                       'sessions': len(numbers), 'planPins': len(pins)}}


def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def stage(container: str = DEFAULT_CONTAINER, source_dir: Path = _HERE) -> dict:
    """Chép hai mô-đun vào container và **so md5sum** — chép xong mà khác bản repo là lỗi im lặng."""
    result = {}
    for name in STAGED_FILES:
        local = Path(source_dir) / name
        if not local.is_file():
            raise FileNotFoundError(f'thiếu {local}')
        subprocess.run(['docker', 'cp', str(local), f'{container}:{STAGE_DIR}/{name}'], check=True)
        remote = subprocess.run(['docker', 'exec', container, 'md5sum', f'{STAGE_DIR}/{name}'],
                                check=True, capture_output=True, text=True).stdout.split()[0]
        local_md5 = _md5(local)
        result[name] = {'local': local_md5, 'container': remote, 'match': local_md5 == remote}
        if local_md5 != remote:
            raise RuntimeError(f'{name}: md5 trong container khác bản repo — dừng trước khi ghi lịch sử')
    return result


def box_runner(container: str = DEFAULT_CONTAINER, root: str = DEFAULT_ROOT):
    """Gọi op qua CLI đã staged trong box: stdin JSON `{'name','args','session'}` — cùng khuôn worker."""
    def run(name: str, args: dict) -> dict:
        proc = subprocess.run(
            ['docker', 'exec', '-i', '--user', 'agent', '--workdir', root, container,
             BOX_PYTHON, f'{STAGE_DIR}/session_ops.py', name],
            input=json.dumps({'name': name, 'args': args}, ensure_ascii=False),
            capture_output=True, text=True)
        if proc.returncode:
            return {'ok': False, 'error': (proc.stderr or '').strip()[:400]}
        try:
            return json.loads(proc.stdout)
        except ValueError:
            return {'ok': False, 'error': 'box trả về dữ liệu không phải JSON'}
    return run


def fetch_existing(root: str, container: str = DEFAULT_CONTAINER) -> set[str]:
    """Các đường dẫn đã có trong `.session-history` (tương đối), để bản kế hoạch biết mà bỏ qua."""
    proc = subprocess.run(
        ['docker', 'exec', container, 'bash', '-lc',
         f'cd {root} 2>/dev/null && find . -type f | sed "s#^./##" || true'],
        capture_output=True, text=True)
    return {line.strip() for line in proc.stdout.splitlines() if line.strip()}


def report(rows: dict, plan_result: dict, artifacts: dict, lost: dict = None) -> str:
    counts = plan_result['counts']
    lines = [
        '# Bản dry-run nạp lịch sử cũ (A9)',
        '',
        f"- Hàng checkpoint: **{counts['checkpointRows']}** trên **{counts['sessions']}** phiên; "
        f"đã có file trong box: **{counts['checkpointSkipped']}**",
        f"- Ghim `P:`: **{counts['planPins']}** (từ event `plan_written`)",
        f"- Artefact gán được về phiên: **{sum(len(v) for v in artifacts['bySession'].values())}** "
        f"đường dẫn khác nhau trên **{artifacts['sessionsWithArtifacts']}** phiên",
        f"- Đường dẫn artefact thấy trong `events`: **{len(artifacts['knownPaths'])}**",
    ]
    lost = lost or {'readable': False}
    if lost.get('readable'):
        lines.append(f"- File trong thư mục captures **không** payload nào nhắc tới: "
                     f"**{lost['files']}** ({lost['bytes']} B) — giữ nguyên tại chỗ, chỉ đếm")
    else:
        lines.append('- File trong thư mục captures: **không đọc được** (container chưa chạy?) — '
                     'không đoán số')
    return '\n'.join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Nạp lịch sử cũ vào thư mục phiên (mặc định dry-run).')
    parser.add_argument('--db', default=str(Path.home() / 'BoxFox/harness/sessions.sqlite'))
    parser.add_argument('--root', default=DEFAULT_ROOT, help='gốc .session-history trong box')
    parser.add_argument('--container', default=DEFAULT_CONTAINER)
    parser.add_argument('--apply', action='store_true', help='ghi thật (mặc định: chỉ đọc)')
    parser.add_argument('--stage', action='store_true', help='chép mô-đun vào container rồi so md5sum')
    parser.add_argument('--json', action='store_true', help='in kết quả dạng JSON')
    parser.add_argument('--captures', default=DEFAULT_CAPTURES,
                        help='gốc ảnh/ghi hình cũ trong box (để đếm file không gán được về phiên nào)')
    parser.add_argument('--limit', type=int, default=0, help='giới hạn số hàng checkpoint mỗi lượt (0 = hết)')
    args = parser.parse_args(argv)

    rows = read_rows(Path(args.db))
    artifacts = attribution(rows)
    try:
        existing = fetch_existing(args.root, args.container)
    except (OSError, subprocess.SubprocessError):
        existing = set()
    plan_result = plan(rows, existing)
    if args.limit:
        plan_result['checkpoints'] = plan_result['checkpoints'][:args.limit]

    try:
        lost = unattached(args.captures, set(artifacts['knownPaths']), args.container)
    except (OSError, subprocess.SubprocessError):
        lost = {'readable': False, 'files': None, 'bytes': None}
    print(json.dumps({'plan': plan_result['counts'], 'artifacts': {
        'sessions': artifacts['sessionsWithArtifacts'], 'paths': len(artifacts['knownPaths'])},
        'unattached': lost}, ensure_ascii=False) if args.json
        else report(rows, plan_result, artifacts, lost))

    if not args.apply:
        return 0
    if args.stage:
        stage(args.container)
    run = box_runner(args.container, args.root)
    written = skipped = failed = 0
    for action in plan_result['checkpoints']:
        if action['skip']:
            skipped += 1
            continue
        messages = _messages_for(args.db, action['checkpointRowId'])
        if messages is None:
            failed += 1
            continue
        answer = run('checkpoint_write', {
            'session': action['session'], 'messages': messages,
            'numbers': {'checkpointNumber': action['number'], 'rowId': action['checkpointRowId']},
            'note': f"nạp lại từ hàng checkpoints #{action['checkpointRowId']} ({action['reason']})",
            'journalRecord': {'kind': 'checkpoint', 'text': f'gộp {len(messages)} tin nhắn',
                              'status': action['reason']},
        })
        written += 1 if answer.get('ok') else 0
        failed += 0 if answer.get('ok') else 1
    for pin in plan_result['pins']:
        run('journal_append', {'session': pin['session'], 'kind': pin['kind'],
                               'plan': pin['plan'], 'text': pin['text']})
    print(f'Đã ghi: {written} · bỏ qua (đã có): {skipped} · lỗi: {failed}')
    return 0 if failed == 0 else 1


def _messages_for(db_path, row_id):
    """Đọc `messages` của đúng một hàng — tách riêng vì hàng lớn nhất là 3 170 519 B."""
    uri = f'file:{Path(db_path).as_posix()}?mode=ro'
    db = sqlite3.connect(uri, uri=True)
    try:
        row = db.execute('SELECT messages FROM checkpoints WHERE id=?', (row_id,)).fetchone()
    finally:
        db.close()
    if row is None:
        return None
    try:
        loaded = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    return loaded if isinstance(loaded, list) else None


if __name__ == '__main__':
    sys.exit(main())
