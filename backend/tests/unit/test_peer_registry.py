"""Sổ con, biên nhận giao hàng và bộ đếm lượt (vòng 22, T1).

Bộ kiểm này cố ý mở **DB theo schema CŨ** (đúng ba bảng của bản trước) để chứng minh di trú chỉ
ghi thêm: hàng cũ đọc được, bảng mới có mặt, và mở lần thứ hai không đổi gì.
"""
import sqlite3
import time

import pytest

from agentbox.memory.session_store import SessionStore


def old_database(path):
    """DB y hệt bản trước T1: chỉ `sessions`/`events`/`checkpoints`, cộng một hàng phiên cũ."""
    db = sqlite3.connect(path)
    db.executescript('''
        CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_id TEXT, role TEXT NOT NULL,
            config TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'idle', updated REAL NOT NULL);
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
            kind TEXT NOT NULL, payload TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE checkpoints (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
            messages TEXT NOT NULL, reason TEXT NOT NULL, created REAL NOT NULL);
    ''')
    db.execute("INSERT INTO sessions(id,role,config,status,updated) VALUES('old-1','orchestrator','{}','idle',1.0)")
    db.commit()
    db.close()
    return path


def test_schema_cu_mo_bang_ma_moi_khong_mat_gi(tmp_path):
    path = old_database(tmp_path / 'sessions.db')
    store = SessionStore(path)
    tables = {row['name'] for row in store.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {'children', 'child_deliveries'} <= tables
    columns = {row['name'] for row in store.db.execute('PRAGMA table_info(sessions)')}
    assert 'turn_count' in columns
    assert store.get('old-1')['role'] == 'orchestrator', 'hàng cũ vẫn đọc được'
    assert store.get('old-1')['turn_count'] == 0, 'phiên cũ chưa có lượt nào'
    store.close()

    again = SessionStore(path)
    assert again.get('old-1')['turn_count'] == 0
    again.close()


def test_begin_turn_dem_mot_chieu(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    sid = store.create({'skills': []})['id']
    assert [store.begin_turn(sid) for _ in range(3)] == [1, 2, 3]
    assert store.get(sid)['turn_count'] == 3
    with pytest.raises(KeyError):
        store.begin_turn('khong-co-phien-nay')
    store.close()


def test_hang_so_con_di_tron_vong_doi(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    parent = store.create({'skills': []})['id']
    child = store.create({'skills': []}, role='testing', parent_id=parent)['id']

    store.child_start(child, parent, 2, 5, 'testing', goal='kiểm phần upload')
    row = store.child(child)
    assert (row['parent_id'], row['parent_turn'], row['spawn_step']) == (parent, 2, 5)
    assert row['role'] == 'testing' and row['status'] == 'started' and row['goal'] == 'kiểm phần upload'
    assert [r['session_id'] for r in store.children_of(parent)] == [child]
    assert [r['session_id'] for r in store.children_of(parent, turn=2)] == [child]
    assert store.children_of(parent, turn=3) == []
    assert [r['session_id'] for r in store.live_children(parent)] == [child]

    store.child_wait(child, ['role:review'], time.time())
    assert store.child(child)['waiting_for'] == ['role:review']

    store.child_finish(child, 'partial', reason='STEP_BUDGET_EXHAUSTED', steps_used=40,
                       output_tokens=1234, answer_chars=465)
    row = store.child(child)
    assert (row['status'], row['reason'], row['steps_used'], row['output_tokens']) == \
        ('partial', 'STEP_BUDGET_EXHAUSTED', 40, 1234)
    assert row['answer_chars'] == 465 and row['finished'] is not None
    assert row['waiting_for'] == [] and row['waiting_since'] is None, 'chờ xong thì ghi lại là hết chờ'
    assert store.live_children(parent) == []

    store.child_finish(child, 'failed', reason='WATCHDOG_TIMEOUT')
    row = store.child(child)
    assert (row['status'], row['reason']) == ('partial', 'STEP_BUDGET_EXHAUSTED'), \
        'lần gọi thứ hai không ghi đè hàng đã đóng'
    store.close()


def test_bien_nhan_giao_hang_khong_the_giao_hai_lan(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    parent = store.create({'skills': []})['id']
    child = store.create({'skills': []}, role='review', parent_id=parent)['id']
    store.child_start(child, parent, 1, 3, 'review', goal='soát')

    first = store.queue_delivery(child, 'peer-sid-2', 1, 'peer', chars=120, truncated=False)
    again = store.queue_delivery(child, 'peer-sid-2', 1, 'peer', chars=120, truncated=False)
    assert first['id'] == again['id'], 'cùng (con, người nhận, lượt) ⇒ đúng một hàng'
    assert store.deliveries_of(child) == [first] or len(store.deliveries_of(child)) == 1

    other_turn = store.queue_delivery(child, 'peer-sid-2', 2, 'peer', chars=90, truncated=True)
    assert other_turn['id'] != first['id']

    assert [r['id'] for r in store.pending_deliveries('peer-sid-2')] == [first['id'], other_turn['id']]
    assert store.pending_deliveries('peer-sid-2', limit=1)[0]['id'] == first['id']

    done = store.mark_delivered(first['id'])
    assert done['state'] == 'injected' and done['injected'] is not None
    assert store.mark_delivered(first['id'])['state'] == 'injected', 'gọi lại không đổi gì thêm'
    assert [r['id'] for r in store.pending_deliveries('peer-sid-2')] == [other_turn['id']]

    skipped = store.mark_delivered(other_turn['id'], state='skipped', skip_reason='recipient_not_running')
    assert skipped['skip_reason'] == 'recipient_not_running'
    with pytest.raises(ValueError):
        store.mark_delivered(other_turn['id'], state='bịa')

    receipts = store.child_delivery_receipts(child)
    assert receipts == [
        {'recipient': 'peer-sid-2', 'state': 'injected', 'chars': 120, 'truncated': False},
        {'recipient': 'peer-sid-2', 'state': 'skipped', 'chars': 90, 'truncated': True},
    ]
    assert store.child_set_deliveries(child, receipts)['deliveries'] == receipts
    store.close()


def test_xoa_phien_thi_so_con_di_theo(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    parent = store.create({'skills': []})['id']
    child = store.create({'skills': []}, role='review', parent_id=parent)['id']
    store.child_start(child, parent, 1, 1, 'review', goal='soát')
    store.queue_delivery(child, 'peer-x', 1, 'peer', chars=10)

    assert store.delete(parent) is True
    assert store.child(child) is None
    assert store.deliveries_of(child) == []
    assert store.db.execute('SELECT COUNT(*) AS n FROM child_deliveries').fetchone()['n'] == 0
    store.close()
