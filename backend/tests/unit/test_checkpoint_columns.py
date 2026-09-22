"""Bốn cột số đo của hàng checkpoint (Phần D đợt 20, việc N4).

Đo trên máy chủ nhà 2026-09-21: bảng `checkpoints` có **22 hàng / 17 967 616 B** nhưng cột chỉ là
`id, session_id, messages, reason, created` — không một con số nào. Muốn biết lần nén đó chạy ở cửa
sổ nào, ngưỡng bao nhiêu, phải mò sang `events.payload` (33 hàng `kind='compression'`, mà 8 hàng
trong đó còn không mang số). Hai bài dưới đây khoá lại: (1) ghi số thì đọc lại được số; (2) DB sống
đã có bảng từ trước vẫn được thêm cột, hàng cũ vẫn đọc được, caller cũ không đổi hành vi.
"""
import json
import sqlite3

from agentbox.memory.session_store import SessionStore


def _legacy_db(path):
    """Dựng đúng schema cũ (không có bốn cột số đo) như `sessions.sqlite` trên máy chủ nhà."""
    db = sqlite3.connect(path)
    db.executescript('''
        CREATE TABLE checkpoints (
            id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, messages TEXT NOT NULL,
            reason TEXT NOT NULL, created REAL NOT NULL);
    ''')
    db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_id TEXT, role TEXT NOT NULL,"
               " config TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL"
               " DEFAULT 'idle', updated REAL NOT NULL)")
    db.execute('INSERT INTO sessions(id,role,config,updated) VALUES(?,?,?,?)',
               ('legacy-session', 'orchestrator', '{"skills":[]}', 0.0))
    db.execute('INSERT INTO checkpoints(session_id,messages,reason,created) VALUES(?,?,?,?)',
               ('legacy-session', json.dumps([{'role': 'user', 'content': 'cũ'}]), 'prune', 0.0))
    db.commit()
    db.close()


def test_a_checkpoint_with_numbers_reports_them_back(tmp_path):
    store = SessionStore(tmp_path / 'sessions.sqlite')
    sid = store.create({'skills': []})['id']
    messages = [{'role': 'user', 'content': 'xin chào'}]

    store.checkpoint(sid, messages, 'summary', {
        'before_estimate': 301_151, 'after_estimate': 24_490,
        'context_window': 1_000_000, 'model_id': 'deepseek-v4-flash',
    })
    store.checkpoint(sid, messages, 'manual_compact')

    rows = store.checkpoints(sid)
    assert [row['reason'] for row in rows] == ['summary', 'manual_compact']
    assert rows[0]['before_estimate'] == 301_151
    assert rows[0]['after_estimate'] == 24_490
    assert rows[0]['context_window'] == 1_000_000
    assert rows[0]['model_id'] == 'deepseek-v4-flash'
    assert rows[0]['messages'] == messages, 'bản gốc vẫn đọc được nguyên vẹn'
    assert rows[1]['before_estimate'] is None and rows[1]['model_id'] is None, 'hàng không số vẫn hợp lệ'


def test_the_columns_are_added_to_a_database_that_already_had_the_table(tmp_path):
    """DB sống: bảng đã tồn tại từ trước ⇒ `CREATE TABLE IF NOT EXISTS` không thêm cột, phải `ALTER`."""
    path = tmp_path / 'sessions.sqlite'
    _legacy_db(path)

    store = SessionStore(path)
    columns = {row['name'] for row in store.db.execute('PRAGMA table_info(checkpoints)')}
    assert {'before_estimate', 'after_estimate', 'context_window', 'model_id'} <= columns

    legacy = [row for row in store.checkpoints('legacy-session')]
    assert len(legacy) == 1 and legacy[0]['before_estimate'] is None, 'hàng cũ đọc được, số là NULL'

    sid = store.create({'skills': []})['id']
    store.checkpoint(sid, [{'role': 'user', 'content': 'mới'}], 'summary',
                     {'before_estimate': 10, 'after_estimate': 3})
    row = store.checkpoints(sid)[0]
    assert (row['before_estimate'], row['after_estimate']) == (10, 3)
