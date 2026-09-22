"""Bài kiểm cho bản nạp lịch sử cũ (A9) — `deploy/docker/backfill_history.py`.

Ba thứ phải đúng, vì cả ba đều là chỗ dễ làm hỏng dữ liệu thật:

1. **Dry-run không ghi gì** — chạy không `--apply` thì không có lệnh `docker` nào được gọi.
2. **Idempotent** — file đã có trong box thì việc đó bị `skip`, nên `--apply` hai lần không đẻ bản trùng.
3. **Không bịa phiên cho file lạ** — `attribution` chỉ gán theo `tool_end.payload.artifact` và đếm
   riêng nhóm không thấy trong `events`.
"""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backfill_history as backfill  # noqa: E402


def _db(rows):
    """DB tạm đúng ba bảng mà bản nạp cần: `checkpoints`, `events`, `sessions`."""
    path = Path(tempfile.mkdtemp()) / 'sessions.sqlite'
    db = sqlite3.connect(path)
    db.executescript('''
        CREATE TABLE checkpoints (id INTEGER PRIMARY KEY, session_id TEXT, messages TEXT,
                                  reason TEXT, created REAL);
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, kind TEXT,
                             payload TEXT, created REAL);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, status TEXT);
    ''')
    for row in rows.get('checkpoints', []):
        db.execute('INSERT INTO checkpoints(id,session_id,messages,reason,created) VALUES(?,?,?,?,?)',
                   (row['id'], row['session_id'], json.dumps(row['messages']), row['reason'], 0.0))
    for row in rows.get('events', []):
        db.execute('INSERT INTO events(session_id,kind,payload,created) VALUES(?,?,?,?)',
                   (row['session_id'], row['kind'], json.dumps(row['payload'], ensure_ascii=False), 0.0))
    for sid in rows.get('sessions', []):
        db.execute('INSERT INTO sessions(id,status) VALUES(?,?)', (sid, 'completed'))
    db.commit()
    db.close()
    return path


class BackfillTest(unittest.TestCase):
    def test_numbers_are_per_session_and_in_row_order(self) -> None:
        rows = backfill.read_rows(_db({'checkpoints': [
            {'id': 1, 'session_id': 'aaaa1111' + '0' * 24, 'messages': [{'role': 'user'}], 'reason': 'prune'},
            {'id': 2, 'session_id': 'aaaa1111' + '0' * 24, 'messages': [{'role': 'user'}], 'reason': 'summary'},
            {'id': 3, 'session_id': 'bbbb2222' + '0' * 24, 'messages': [{'role': 'user'}], 'reason': 'manual_compact'},
        ]}))
        result = backfill.plan(rows)
        self.assertEqual([item['number'] for item in result['checkpoints']], [1, 2, 1])
        self.assertEqual([item['relPath'] for item in result['checkpoints']],
                         ['aaaa1111/checkpoints/ck-aaaa1111-001.json',
                          'aaaa1111/checkpoints/ck-aaaa1111-002.json',
                          'bbbb2222/checkpoints/ck-bbbb2222-001.json'])
        self.assertEqual(result['counts'], {'checkpointRows': 3, 'checkpointSkipped': 0,
                                            'sessions': 2, 'planPins': 0})

    def test_existing_files_are_skipped_not_rewritten(self) -> None:
        rows = backfill.read_rows(_db({'checkpoints': [
            {'id': 1, 'session_id': 'aaaa1111' + '0' * 24, 'messages': [], 'reason': 'prune'},
            {'id': 2, 'session_id': 'aaaa1111' + '0' * 24, 'messages': [], 'reason': 'prune'},
        ]}))
        existing = {'aaaa1111/checkpoints/ck-aaaa1111-001.json'}
        result = backfill.plan(rows, existing)
        self.assertEqual([item['skip'] for item in result['checkpoints']], [True, False])
        self.assertEqual(result['counts']['checkpointSkipped'], 1)

    def test_dry_run_never_shells_out(self) -> None:
        path = _db({'checkpoints': [{'id': 1, 'session_id': 'aaaa1111' + '0' * 24,
                                     'messages': [{'role': 'user', 'content': 'x'}], 'reason': 'prune'}]})
        calls = []
        original = backfill.subprocess.run
        original_fetch = backfill.fetch_existing
        original_lost = backfill.unattached

        def fake_run(*args, **kwargs):
            calls.append(args)
            raise AssertionError('dry-run không được gọi lệnh ngoài')

        # `fetch_existing` (đọc danh sách file đã có) và `unattached` (đếm file lạ) là hai phép
        # ĐỌC; ở đây chặn cả hai để khẳng định bản dry-run không chạy lệnh ghi nào — không phải để
        # khẳng định nó không đọc gì.
        backfill.subprocess.run = fake_run
        backfill.fetch_existing = lambda root, container: set()
        backfill.unattached = lambda captures, known, container: {'readable': False, 'files': None,
                                                                 'bytes': None}
        try:
            code = backfill.main(['--db', str(path), '--root', '/tmp/khong-co'])
        finally:
            backfill.subprocess.run = original
            backfill.fetch_existing = original_fetch
            backfill.unattached = original_lost
        self.assertEqual(code, 0)
        self.assertEqual(calls, [])

    def test_artifacts_are_attributed_by_tool_end_and_unknown_paths_are_counted(self) -> None:
        rows = backfill.read_rows(_db({'events': [
            {'session_id': 's1', 'kind': 'tool_end',
             'payload': {'artifact': '/home/agent/workspace/.generated_artifacts/captures/screen/1.png'}},
            {'session_id': 's1', 'kind': 'tool_end',
             'payload': {'artifact': '/home/agent/workspace/.generated_artifacts/captures/screen/2.png'}},
            {'session_id': 's2', 'kind': 'tool_end', 'payload': {'content': 'không có artefact'}},
            {'session_id': 's2', 'kind': 'plan_written',
             'payload': {'identity': 'clinical-patient-record-lookup', 'version': 5, 'slug': 'clinical'}},
        ]}))
        result = backfill.attribution(rows)
        self.assertEqual(result['sessionsWithArtifacts'], 1)
        self.assertEqual(len(result['knownPaths']), 2)
        self.assertEqual(result['bySession']['s1'], sorted(result['knownPaths']))
        plan_result = backfill.plan(rows)
        self.assertEqual(plan_result['counts']['planPins'], 1)
        self.assertEqual(plan_result['pins'][0]['plan'], {'identity': 'clinical-patient-record-lookup', 'version': 5})

    def test_apply_writes_each_row_once_and_is_idempotent(self) -> None:
        path = _db({'checkpoints': [
            {'id': 1, 'session_id': 'aaaa1111' + '0' * 24,
             'messages': [{'role': 'user', 'content': 'trước nén'}], 'reason': 'summary'},
        ]})
        written = []

        def runner(name, args):
            written.append((name, args))
            return {'ok': True, 'status': 'recorded', 'checkpointNumber': args['numbers']['checkpointNumber']}

        original_runner, original_fetch = backfill.box_runner, backfill.fetch_existing
        backfill.box_runner = lambda container, root: runner
        try:
            backfill.fetch_existing = lambda root, container: set()
            self.assertEqual(backfill.main(['--db', str(path), '--apply']), 0)
            self.assertEqual([name for name, _ in written], ['checkpoint_write'])
            self.assertEqual(written[0][1]['messages'], [{'role': 'user', 'content': 'trước nén'}])
            self.assertEqual(written[0][1]['numbers']['checkpointNumber'], 1)

            # Lần hai: file đã có trong box ⇒ không ghi lại.
            written.clear()
            backfill.fetch_existing = lambda root, container: {'aaaa1111/checkpoints/ck-aaaa1111-001.json'}
            self.assertEqual(backfill.main(['--db', str(path), '--apply']), 0)
            self.assertEqual(written, [])
        finally:
            backfill.box_runner, backfill.fetch_existing = original_runner, original_fetch

    def test_a_missing_row_is_reported_not_guessed(self) -> None:
        path = _db({'checkpoints': []})
        self.assertIsNone(backfill._messages_for(path, 99))


if __name__ == '__main__':
    unittest.main()
