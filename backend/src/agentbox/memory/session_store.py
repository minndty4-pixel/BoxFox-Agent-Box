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
            CREATE TABLE IF NOT EXISTS journal (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                kind TEXT NOT NULL, text TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '{}', created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS event_session ON events(session_id, seq);
            CREATE INDEX IF NOT EXISTS journal_session ON journal(session_id, seq);
        ''')
        # N4 — bốn cột số đo cho hàng checkpoint. Đo trên máy chủ nhà 2026-09-21: 22 hàng
        # `checkpoints` (17 967 616 B) **không có một con số nào** — cột chỉ có
        # `id, session_id, messages, reason, created`, nên muốn biết lần nén đó chạy ở cửa sổ nào,
        # ngưỡng bao nhiêu, phải mò sang `events.payload` (33 hàng `kind='compression'`, mà 8 hàng
        # trong đó không mang số). Thêm cột là **thuần cộng thêm**: hàng cũ `NULL` vẫn đọc được, và
        # `ALTER TABLE` chỉ chạy khi cột còn thiếu (DB sống đã có bảng từ trước).
        self._add_missing_columns('checkpoints', {
            'before_estimate': 'INTEGER', 'after_estimate': 'INTEGER',
            'context_window': 'INTEGER', 'model_id': 'TEXT',
        })
        # Sổ duyệt plan + điểm đánh giá plan (vòng 20, §4.1/§5 của plan). Bảng ở đây là
        # NGUỒN CHÂN LÝ: `.reviews/<identity>.json` trong workspace chỉ là bản hiển thị, và
        # không bao giờ là căn cứ để cho phép hay từ chối một lần ghi plan (file nằm trong
        # tầm tay của agent). Khoá chính `(identity, version)` nên quyết định mới cùng bản
        # ghi đè quyết định cũ của ĐÚNG bản đó — duyệt v1 không bao giờ chạm tới v2.
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS plan_reviews (
                identity TEXT NOT NULL, version INTEGER NOT NULL,
                decision TEXT NOT NULL CHECK(decision IN ('approved','changes_requested')),
                note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'plan-tab',
                session_id TEXT, decided_at REAL NOT NULL,
                content_size INTEGER, content_modified_at TEXT,
                PRIMARY KEY (identity, version));
            CREATE TABLE IF NOT EXISTS plan_evaluations (
                identity TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
                total INTEGER NOT NULL, verdict TEXT NOT NULL, evaluated_at REAL NOT NULL,
                PRIMARY KEY (identity, version));
        ''')
        self.db.execute("UPDATE sessions SET status='interrupted' WHERE status IN ('running','awaiting_decision')")
        self.db.commit()

    def _add_missing_columns(self, table, columns):
        """Thêm cột còn thiếu, không bao giờ làm sập khởi động.

        Một lượt sửa lỗi hỏng (file DB khoá, đĩa đầy) không được biến cả harness thành không khởi
        động được: hàm này ghi lại việc bỏ qua và để `checkpoint()` tự chọn câu INSERT khớp với
        cột thật đang có.
        """
        try:
            have = {row['name'] for row in self.db.execute(f'PRAGMA table_info({table})')}
        except sqlite3.DatabaseError:
            self._missing_columns = set(columns)
            return
        for name, kind in columns.items():
            if name in have:
                continue
            try:
                self.db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
            except sqlite3.DatabaseError:
                continue
        return None

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

    def all_configs(self):
        """`{session id: config}` của mọi phiên đã lưu, kể cả phiên con.

        Dùng cho lượt sửa lúc khởi động (cửa sổ ngữ cảnh của các phiên cũ): một
        phiên giữ nguyên con số harness ghi lúc nó được tạo, còn router có thể đã
        biết con số đúng hơn. Một dòng config hỏng bị bỏ qua chứ không làm sập cả
        lượt đọc — hàng đợi sửa lỗi không được phép biến một dòng cũ thành lỗi khởi động.
        """
        result = {}
        for row in self.db.execute('SELECT id, config FROM sessions'):
            try:
                result[row['id']] = json.loads(row['config'])
            except (TypeError, ValueError):
                continue
        return result

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

    def checkpoint(self, sid, messages, reason, numbers=None):
        """Ghi một hàng checkpoint, kèm số đo khi có (N4).

        `numbers` là `{'before_estimate', 'after_estimate', 'context_window', 'model_id'}` — thiếu
        khoá nào thì cột đó `NULL`. Không có `numbers` thì câu INSERT y hệt bản cũ, nên mọi caller
        cũ và mọi test cũ giữ nguyên hành vi.
        """
        with self.db:
            if numbers:
                columns = [name for name in ('before_estimate', 'after_estimate', 'context_window', 'model_id')
                           if name in self._checkpoint_columns()]
                self.db.execute(
                    f'INSERT INTO checkpoints(session_id,messages,reason,created,{",".join(columns)}) '
                    f'VALUES(?,?,?,?,{",".join("?" for _ in columns)})',
                    (sid, json.dumps(messages, ensure_ascii=False), reason, time.time(),
                     *[numbers.get(name) for name in columns]))
                return
            self.db.execute('INSERT INTO checkpoints(session_id,messages,reason,created) VALUES(?,?,?,?)',
                            (sid, json.dumps(messages, ensure_ascii=False), reason, time.time()))

    def _checkpoint_columns(self):
        """Tên cột thật của bảng `checkpoints` (cache một lần cho mỗi kết nối)."""
        cached = getattr(self, '_checkpoint_column_cache', None)
        if cached is None:
            try:
                cached = {row['name'] for row in self.db.execute('PRAGMA table_info(checkpoints)')}
            except sqlite3.DatabaseError:
                cached = {'session_id', 'messages', 'reason', 'created'}
            self._checkpoint_column_cache = cached
        return cached

    def checkpoints(self, sid, limit=200):
        """Các hàng checkpoint của một phiên, cũ nhất trước — có kèm số đo nếu hàng đó có."""
        self.get(sid)
        rows = self.db.execute('SELECT * FROM checkpoints WHERE session_id=? ORDER BY id LIMIT ?',
                               (sid, limit)).fetchall()
        return [{**dict(row), 'messages': json.loads(row['messages'])} for row in rows]

    def journal_add(self, sid, kind, text, payload=None):
        """Một bản ghi nhật ký (A2). Chỉ ghi thêm: không sửa, không xoá, không đánh số lại."""
        with self.db:
            cur = self.db.execute(
                'INSERT INTO journal(session_id,kind,text,payload,created) VALUES(?,?,?,?,?)',
                (sid, kind, text, json.dumps(payload or {}, ensure_ascii=False), time.time()))
        return cur.lastrowid

    def journal_patch(self, sid, seq, payload):
        """Gán mã đã mint cho một hàng vừa tạo trong **cùng một lượt ghi** (`journal_add` → đây).

        Nhật ký là bản chỉ-ghi-thêm, nên hàm này cố ý chỉ sửa được `payload` (nơi giữ mã) và chỉ
        dành cho hàng vừa tạo: mã `T:<sid8>-<n>` cần số `seq` mà SQLite chỉ trả về *sau* khi chèn.
        """
        with self.db:
            self.db.execute('UPDATE journal SET payload=? WHERE session_id=? AND seq=?',
                            (json.dumps(payload or {}, ensure_ascii=False), sid, seq))

    def journal_tail(self, sid, limit=50, kinds=None):
        """`limit` bản ghi mới nhất của một phiên, đọc theo thứ tự cũ → mới."""
        self.get(sid)
        sql = 'SELECT * FROM journal WHERE session_id=?'
        args = [sid]
        if kinds:
            sql += f' AND kind IN ({",".join("?" for _ in kinds)})'
            args += list(kinds)
        sql += ' ORDER BY seq DESC LIMIT ?'
        args.append(limit)
        rows = self.db.execute(sql, args).fetchall()
        result = []
        for row in reversed(rows):
            item = dict(row)
            try:
                item['payload'] = json.loads(item['payload'])
            except (TypeError, ValueError):
                item['payload'] = {}
            result.append(item)
        return result

    # ------------------------------------------------------------------
    # Sổ duyệt plan (vòng 20 §4.1) + điểm đánh giá P1–P8 (§5)
    #
    # Hai đường ghi vào `plan_reviews`, đúng hai đường của plan:
    #   * UI: route `POST /api/agent/plans/review` (api/server.py) gọi `record_plan_review(..., source='plan-tab')`;
    #   * runtime: `settle()` gọi một lần khi quyết định mang `planIdentity`/`planVersion`:
    #         self.store.record_plan_review(identity, version,
    #             decision='approved' if status == 'approved' else 'changes_requested',
    #             note=(note or ''), source='approval', session_id=record['sessionId'])
    #     (chỉ khi record có đủ hai khoá — một `request_approval` cũ không mang chúng thì không ghi).
    # `plan_evaluations` do harness ghi sau mỗi lần chấm P1–P8, kể cả lần bị từ chối
    # (`written: false`) — đó là bằng chứng vì sao không có file nào xuất hiện.
    # ------------------------------------------------------------------
    PLAN_REVIEW_DECISIONS = ('approved', 'changes_requested')
    PLAN_REVIEW_SOURCES = ('plan-tab', 'approval')

    def record_plan_review(self, identity, version, decision, note='', source='plan-tab',
                           session_id=None, content_size=None, content_modified_at=None):
        """Ghi quyết định duyệt cho ĐÚNG một bản `(identity, version)`; trả hàng đã lưu.

        `content_size`/`content_modified_at` là số đo lúc duyệt: sau này chỉ mục của box
        báo số khác thì bản duyệt đó đã cũ (`reviewStale`) và KHÔNG còn được coi là đồng ý.
        """
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError('plan review needs a non-empty identity')
        version = int(version)
        if version < 1:
            raise ValueError('plan review needs a positive version')
        if decision not in self.PLAN_REVIEW_DECISIONS:
            raise ValueError("decision must be one of: " + ', '.join(self.PLAN_REVIEW_DECISIONS))
        if source not in self.PLAN_REVIEW_SOURCES:
            raise ValueError("source must be one of: " + ', '.join(self.PLAN_REVIEW_SOURCES))
        with self.db:
            self.db.execute(
                'INSERT OR REPLACE INTO plan_reviews'
                '(identity,version,decision,note,source,session_id,decided_at,content_size,content_modified_at)'
                ' VALUES(?,?,?,?,?,?,?,?,?)',
                (identity, version, decision, str(note or ''), source, session_id, time.time(),
                 None if content_size is None else int(content_size), content_modified_at))
        return self.plan_review(identity, version)

    def plan_review(self, identity, version):
        """Hàng sổ duyệt của một bản, hoặc `None` khi chưa ai quyết."""
        row = self.db.execute('SELECT * FROM plan_reviews WHERE identity=? AND version=?',
                              (identity, int(version))).fetchone()
        return dict(row) if row is not None else None

    def plan_reviews_for(self, identity):
        """Mọi quyết định của một identity, xếp theo version tăng dần (máy trạng thái đọc)."""
        rows = self.db.execute('SELECT * FROM plan_reviews WHERE identity=? ORDER BY version',
                               (identity,)).fetchall()
        return [dict(row) for row in rows]

    def record_plan_evaluation(self, identity, version, payload, total, verdict):
        """Ghi kết quả chấm P1-P8 của một bản; `payload` là JSON đã dựng ở harness."""
        with self.db:
            self.db.execute(
                'INSERT OR REPLACE INTO plan_evaluations(identity,version,payload,total,verdict,evaluated_at)'
                ' VALUES(?,?,?,?,?,?)',
                (identity, int(version), json.dumps(payload, ensure_ascii=False), int(total),
                 str(verdict), time.time()))
        return self.plan_evaluation(identity, version)

    def plan_evaluation(self, identity, version):
        """Kết quả chấm của một bản (payload đã giải JSON), hoặc `None` khi chưa chấm."""
        row = self.db.execute('SELECT * FROM plan_evaluations WHERE identity=? AND version=?',
                              (identity, int(version))).fetchone()
        if row is None:
            return None
        item = dict(row)
        try:
            item['payload'] = json.loads(item['payload'])
        except (TypeError, ValueError):
            item['payload'] = {}
        return item

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

