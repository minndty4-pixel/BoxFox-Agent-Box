"""Durable session checkpoints/events, adapted from Hermes persistence and OpenCode admission.

Running work is marked interrupted after restart; tool side effects are never replayed.
"""
import json
import sqlite3
import time
import uuid
from pathlib import Path


class SessionStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, parent_id TEXT, role TEXT NOT NULL,
                config TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'idle', updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                kind TEXT NOT NULL, payload TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS checkpoints (
                id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, messages TEXT NOT NULL,
                reason TEXT NOT NULL, created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS event_session ON events(session_id, seq);
        ''')
        self.db.execute("UPDATE sessions SET status='interrupted' WHERE status IN ('running','awaiting_decision')")
        self.db.commit()

    def create(self, config, role='orchestrator', parent_id=None):
        sid = uuid.uuid4().hex
        with self.db:
            self.db.execute('INSERT INTO sessions(id,parent_id,role,config,updated) VALUES(?,?,?,?,?)',
                            (sid, parent_id, role, json.dumps(config), time.time()))
        return self.get(sid)

    def get(self, sid):
        row = self.db.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if row is None:
            raise KeyError('Session not found')
        result = dict(row)
        result['messages'] = json.loads(result['messages'])
        result['config'] = json.loads(result['config'])
        return result

    def save(self, sid, messages, status=None):
        with self.db:
            self.db.execute('UPDATE sessions SET messages=?,status=COALESCE(?,status),updated=? WHERE id=?',
                            (json.dumps(messages, ensure_ascii=False), status, time.time(), sid))

    def update_config(self, sid, config):
        with self.db:
            self.db.execute('UPDATE sessions SET config=?,updated=? WHERE id=?',
                            (json.dumps(config, ensure_ascii=False), time.time(), sid))

    def emit(self, sid, kind, payload):
        with self.db:
            cur = self.db.execute('INSERT INTO events(session_id,kind,payload,created) VALUES(?,?,?,?)',
                                  (sid, kind, json.dumps(payload, ensure_ascii=False), time.time()))
        return cur.lastrowid

    def events(self, sid, after=0):
        self.get(sid)
        return [{'seq': r['seq'], 'type': r['kind'], 'data': json.loads(r['payload']), 'created': r['created']}
                for r in self.db.execute('SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT 500', (sid, after))]

    def list(self, limit=50):
        rows = self.db.execute(
            'SELECT id, role, config, status, updated FROM sessions WHERE parent_id IS NULL ORDER BY updated DESC LIMIT ?',
            (limit,)
        ).fetchall()
        result = []
        for r in rows:
            item = dict(r)
            try:
                item['config'] = json.loads(item['config'])
            except Exception:
                pass
            result.append(item)
        return result

    def checkpoint(self, sid, messages, reason):
        with self.db:
            self.db.execute('INSERT INTO checkpoints(session_id,messages,reason,created) VALUES(?,?,?,?)',
                            (sid, json.dumps(messages, ensure_ascii=False), reason, time.time()))

    def delete(self, sid):
        with self.db:
            child_rows = self.db.execute('SELECT id FROM sessions WHERE parent_id=?', (sid,)).fetchall()
            all_sids = [sid] + [r['id'] for r in child_rows]
            placeholders = ','.join('?' for _ in all_sids)
            self.db.execute(f'DELETE FROM checkpoints WHERE session_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM events WHERE session_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM sessions WHERE id IN ({placeholders})', all_sids)
        return True

    def close(self):
        self.db.close()

