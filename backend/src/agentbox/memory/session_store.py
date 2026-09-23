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
        # Vòng 25 (D-33) — hai sổ của VÒNG LẶP KẾ HOẠCH. `plan_verifications` là phán quyết của
        # người phản biện độc lập cho ĐÚNG một bản ghi: không có hàng ở đây thì cổng duyệt
        # (`PLAN_APPROVAL_UNVERIFIED`) từ chối lời xin duyệt của bản đó. `plan_owners` giữ đường
        # từ nhóm kế hoạch về phiên đã ghi nó — thứ mà tab Plan cần để mở một lượt thật thay vì
        # chỉ ghi sổ rồi im lặng (BUG-2 đo được: `plan_reviews.session_id` toàn `NULL`).
        # `resumed` là cột cộng thêm của hàng duyệt: nó nói lượt đã được mở lại thật hay chưa.
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS plan_verifications (
                identity TEXT NOT NULL, version INTEGER NOT NULL,
                verdict TEXT NOT NULL CHECK(verdict IN ('ok','revise')),
                issues TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '',
                critic_session_id TEXT, critic_answer_chars INTEGER, critic_verdict TEXT,
                created REAL NOT NULL,
                PRIMARY KEY (identity, version));
            CREATE TABLE IF NOT EXISTS plan_owners (
                identity TEXT PRIMARY KEY, session_id TEXT NOT NULL, first_session_id TEXT NOT NULL,
                slug TEXT NOT NULL DEFAULT '', relative_path TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL, updated REAL NOT NULL);
        ''')
        self._add_missing_columns('plan_reviews', {'resumed': 'INTEGER NOT NULL DEFAULT 0'})
        # Vòng 22 (peer mesh) T1 — sổ con + bảng giao hàng. Hai bảng này là NGUỒN CHÂN LÝ cho
        # "phiên này sinh con nào, ở lượt nào, đã giao kết quả cho ai": `runtime.delegate` ghi,
        # `peer_read`/`await_children` đọc, watchdog quét. Khoá `UNIQUE(child_id, recipient,
        # recipient_turn)` biến "không giao hai lần" thành chuyện KHÔNG-THỂ, không phải một lời hứa.
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS children (
                session_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL,
                parent_turn INTEGER NOT NULL DEFAULT 0, spawn_step INTEGER NOT NULL DEFAULT 0,
                role TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'started',
                reason TEXT,
                deliveries TEXT NOT NULL DEFAULT '[]',
                waiting_for TEXT NOT NULL DEFAULT '[]',
                waiting_since REAL, started REAL NOT NULL, finished REAL,
                steps_used INTEGER, output_tokens INTEGER, answer_chars INTEGER);
            CREATE INDEX IF NOT EXISTS children_parent ON children(parent_id, parent_turn);
            CREATE TABLE IF NOT EXISTS child_deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                child_id TEXT NOT NULL, recipient TEXT NOT NULL, recipient_turn INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending',
                chars INTEGER NOT NULL DEFAULT 0, truncated INTEGER NOT NULL DEFAULT 0,
                created REAL NOT NULL, injected REAL, skip_reason TEXT,
                UNIQUE(child_id, recipient, recipient_turn));
        ''')
        # Bộ đếm lượt của phiên (T2 đọc nó để mọi event mang `turn`). Cột thêm kiểu cộng thêm:
        # phiên cũ đọc ra `0` rồi lượt kế tiếp bắt đầu từ 1.
        self._add_missing_columns('sessions', {'turn_count': 'INTEGER NOT NULL DEFAULT 0'})
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
    # Vòng 22 (peer mesh) T1 — sổ con, biên nhận giao hàng, bộ đếm lượt
    #
    # Ba thứ này đi cùng nhau vì cùng trả lời một câu: "phiên này đã sinh con nào, ở lượt nào, và
    # kết quả của con đã tới tay ai". Hàng `sessions` vẫn là nguồn chân lý cho phiên; hai bảng
    # dưới đây chỉ THÊM, không thay thế hàng nào.
    # ------------------------------------------------------------------
    def begin_turn(self, sid):
        """Số lượt kế tiếp của phiên (một chiều, không bao giờ lùi).

        Đọc–tăng–ghi trong **một** transaction, nên hai lượt không thể nhận cùng một số.
        """
        with self.db:
            row = self.db.execute('SELECT turn_count FROM sessions WHERE id=?', (sid,)).fetchone()
            if row is None:
                raise KeyError('Session not found')
            turn = int(row['turn_count'] or 0) + 1
            self.db.execute('UPDATE sessions SET turn_count=? WHERE id=?', (turn, sid))
        return turn

    def child_start(self, child_id, parent_id, turn, step, role, goal=''):
        """Ghi hàng sổ con lúc con được sinh; gọi lại thì cập nhật chỗ sinh chứ không nhân hàng."""
        with self.db:
            self.db.execute(
                'INSERT INTO children(session_id,parent_id,parent_turn,spawn_step,role,goal,status,started)'
                ' VALUES(?,?,?,?,?,?,?,?)'
                ' ON CONFLICT(session_id) DO UPDATE SET parent_id=excluded.parent_id,'
                ' parent_turn=excluded.parent_turn, spawn_step=excluded.spawn_step,'
                ' role=excluded.role, goal=excluded.goal, started=excluded.started',
                (child_id, parent_id, int(turn or 0), int(step or 0), role, str(goal or ''),
                 'started', time.time()))
        return self.child(child_id)

    def child_finish(self, child_id, status, reason=None, steps_used=None, output_tokens=None,
                     answer_chars=None):
        """Đóng hàng sổ con. Chỉ hàng còn `started` mới đổi được ⇒ lần gọi thứ hai không đổi gì."""
        with self.db:
            self.db.execute(
                "UPDATE children SET status=?, reason=?, finished=?, steps_used=?, output_tokens=?,"
                " answer_chars=?, waiting_for='[]', waiting_since=NULL"
                " WHERE session_id=? AND status='started'",
                (status, reason, time.time(), steps_used, output_tokens, answer_chars, child_id))
        return self.child(child_id)

    def child_usage_from_events(self, child_id):
        """Số bước/token một phiên con ĐÃ tiêu, đọc từ chính luồng của nó: `(steps, tokens)`.

        Đường đóng sổ bình thường (`finish` của con) tự mang bộ số này; hai đường còn lại — T7 dọn
        con khi lượt cha đóng và T10 watchdog cắt con quá hạn — đóng một phiên con **đang chạy**,
        nên không có `finish` nào để đọc. Bỏ qua chúng thì `childSteps`/`childTokens` của lượt cha
        (T13) đếm thiếu đúng phần con đã tiêu trước khi bị cắt: đo được thì phải ghi được.
        `stepsUsed` trong `turn_end` là số luỹ kế của lượt ⇒ lấy `max`; `outputTokens` là của từng
        bước ⇒ cộng.
        """
        steps = tokens = 0
        for row in self.db.execute("SELECT payload FROM events WHERE session_id=? AND kind='turn_end'",
                                   (child_id,)):
            try:
                data = json.loads(row['payload'])
            except ValueError:
                continue
            steps = max(steps, int(data.get('stepsUsed') or 0))
            tokens += int(data.get('outputTokens') or 0)
        return steps, tokens

    def child_close_once(self, child_id, status, reason=None, steps_used=None, output_tokens=None):
        """Đóng hàng sổ con và CHỈ trả hàng khi chính NGƯỜI GỌI NÀY vừa đóng nó.

        `child_finish` nói kết quả cuối cùng; hàm này nói AI đã đóng. Hai đường cùng đóng một hàng
        (callback của `delegate_task` với watchdog T10, hoặc hai watchdog) thì đúng một bên nhận
        `rowcount == 1`, nên đúng một event `child` được phát và người đọc không thấy hai lý do
        khác nhau cho cùng một cái chết.
        """
        with self.db:
            cursor = self.db.execute(
                "UPDATE children SET status=?, reason=?, finished=?, waiting_for='[]', waiting_since=NULL,"
                " steps_used=COALESCE(?, steps_used), output_tokens=COALESCE(?, output_tokens)"
                " WHERE session_id=? AND status='started'",
                (status, reason, time.time(), steps_used, output_tokens, child_id))
            if cursor.rowcount != 1:
                return None
        return self.child(child_id)

    def child(self, child_id):
        """Một hàng sổ con (đã giải JSON), hoặc `None` khi chưa có hàng nào."""
        row = self.db.execute('SELECT * FROM children WHERE session_id=?', (child_id,)).fetchone()
        return self._child_view(row) if row is not None else None

    @staticmethod
    def _child_view(row):
        item = dict(row)
        for key in ('deliveries', 'waiting_for'):
            try:
                item[key] = json.loads(item[key] or '[]')
            except (TypeError, ValueError):
                item[key] = []
        return item

    def children_of(self, parent_id, turn=None):
        """Con của một cha (lọc theo `parent_turn` khi có), cũ → mới."""
        sql = 'SELECT * FROM children WHERE parent_id=?'
        args = [parent_id]
        if turn is not None:
            sql += ' AND parent_turn=?'
            args.append(int(turn))
        sql += ' ORDER BY started, session_id'
        return [self._child_view(r) for r in self.db.execute(sql, args).fetchall()]

    def live_children(self, parent_id=None):
        """Hàng sổ con còn `started` — mọi cha khi `parent_id=None` (watchdog quét đường này)."""
        if parent_id is None:
            rows = self.db.execute("SELECT * FROM children WHERE status='started' ORDER BY started").fetchall()
        else:
            rows = self.db.execute("SELECT * FROM children WHERE parent_id=? AND status='started'"
                                   ' ORDER BY started', (parent_id,)).fetchall()
        return [self._child_view(r) for r in rows]

    def children_summary(self, parent_id, turn=None):
        """Số con của một cha trong MỘT truy vấn (T13) — `turn` để đo theo LƯỢT, `None` là cả phiên.

        Hai người đọc, hai câu hỏi: `session_metrics` hỏi "phiên này đã sinh bao nhiêu con" (cả
        phiên), còn `peer_turn_cost` hỏi "LƯỢT này tốn bao nhiêu" và phải lọc `parent_turn` —
        không lọc thì payload `finish` của lượt thứ ba báo số luỹ kế (BUG-56).

        Vì sao một truy vấn chứ không phải đếm bằng vòng lặp: `session_metrics` được gọi ở mỗi lần
        mở một phiên, còn một vòng lặp là một truy vấn cho mỗi con. `failed` gom mọi trạng thái cuối
        KHÔNG phải `completed`/`partial` — kể cả `cancelled`/`interrupted`/`not_found` — vì câu hỏi
        của người đọc là "bao nhiêu con không trả được kết quả", còn chi tiết nằm ở cột `reason`.
        """
        where, args = 'parent_id=?', [parent_id]
        if turn is not None:
            where += ' AND parent_turn=?'
            args.append(int(turn))
        row = self.db.execute(
            'SELECT COUNT(*) AS spawned,'
            " SUM(CASE WHEN status='started' THEN 1 ELSE 0 END) AS running,"
            " SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,"
            " SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,"
            " SUM(CASE WHEN status NOT IN ('started','completed','partial') THEN 1 ELSE 0 END) AS failed,"
            ' SUM(COALESCE(steps_used,0)) AS steps, SUM(COALESCE(output_tokens,0)) AS tokens,'
            ' SUM(COALESCE(answer_chars,0)) AS answerChars,'
            ' (SELECT COUNT(*) FROM child_deliveries WHERE child_id IN'
            f'  (SELECT session_id FROM children WHERE {where})) AS deliveries'
            f' FROM children WHERE {where}', tuple(args + args)).fetchone()
        numbers = {key: int(row[key] or 0) for key in
                   ('spawned', 'running', 'completed', 'partial', 'failed', 'steps', 'tokens',
                    'answerChars', 'deliveries')}
        return {'spawned': numbers['spawned'], 'running': numbers['running'],
                'completed': numbers['completed'], 'partial': numbers['partial'],
                'failed': numbers['failed'], 'childSteps': numbers['steps'],
                'childTokens': numbers['tokens'], 'childAnswerChars': numbers['answerChars'],
                'deliveries': numbers['deliveries']}

    def child_wait(self, child_id, targets=None, since=None):
        """Ghi/bỏ trạng thái "đang chờ" của một con.

        `waiting_for` là bản ghi trong DB (giao diện KHÔNG đọc: nó vẽ theo event `peer_wait` của
        luồng đang mở), `waiting_since` là mốc thời gian watchdog luật 3 đọc để đánh thức cưỡng bức.
        """
        with self.db:
            self.db.execute('UPDATE children SET waiting_for=?, waiting_since=? WHERE session_id=?',
                            (json.dumps(list(targets or []), ensure_ascii=False), since, child_id))
        return self.child(child_id)

    def child_set_deliveries(self, child_id, receipts):
        """Ghim danh sách biên nhận (`[{recipient,state,chars,truncated}]`) vào hàng sổ con."""
        with self.db:
            self.db.execute('UPDATE children SET deliveries=? WHERE session_id=?',
                            (json.dumps(list(receipts or []), ensure_ascii=False), child_id))
        return self.child(child_id)

    def queue_delivery(self, child_id, recipient, recipient_turn, kind, chars=0, truncated=False):
        """Ghi một biên nhận `pending`; giao lặp trả **hàng cũ** thay vì ghi thêm.

        `IntegrityError` ở đây là chuyện bình thường (đường kết thúc bình thường và watchdog cùng
        gọi), không phải lỗi — nên bắt rồi trả hàng đã có.
        """
        turn = int(recipient_turn or 0)
        try:
            with self.db:
                cur = self.db.execute(
                    'INSERT INTO child_deliveries(child_id,recipient,recipient_turn,kind,state,chars,'
                    ' truncated,created) VALUES(?,?,?,?,?,?,?,?)',
                    (child_id, recipient, turn, kind, 'pending', int(chars or 0),
                     1 if truncated else 0, time.time()))
            return self.delivery(cur.lastrowid)
        except sqlite3.IntegrityError:
            row = self.db.execute('SELECT * FROM child_deliveries WHERE child_id=? AND recipient=?'
                                  ' AND recipient_turn=?', (child_id, recipient, turn)).fetchone()
            return dict(row) if row is not None else None

    def delivery(self, delivery_id):
        """Một hàng biên nhận, hoặc `None`."""
        row = self.db.execute('SELECT * FROM child_deliveries WHERE id=?', (delivery_id,)).fetchone()
        return dict(row) if row is not None else None

    def pending_deliveries(self, sid, limit=4):
        """Biên nhận đang chờ bơm vào transcript của `sid` (cũ → mới, có trần)."""
        rows = self.db.execute("SELECT * FROM child_deliveries WHERE recipient=? AND state='pending'"
                               ' ORDER BY id LIMIT ?', (sid, int(limit))).fetchall()
        return [dict(r) for r in rows]

    def claim_deliveries(self, recipient, limit=4):
        """Giành các biên nhận `pending` của một phiên để bơm vào transcript — **một lần**.

        `UPDATE … WHERE state='pending'` là chỗ chốt chống bơm hai lần: hàng nào đã bị
        người khác giành thì `rowcount == 0` và không nằm trong kết quả. Đọc và đổi nằm
        trong **một** transaction, nên không có cửa sổ nào để hai nhịp cùng thấy một hàng.
        """
        claimed = []
        with self.db:
            rows = self.db.execute(
                "SELECT * FROM child_deliveries WHERE recipient=? AND state='pending'"
                ' ORDER BY id LIMIT ?', (recipient, int(limit))).fetchall()
            for row in rows:
                cursor = self.db.execute("UPDATE child_deliveries SET state='injected', injected=?"
                                         " WHERE id=? AND state='pending'", (time.time(), row['id']))
                if cursor.rowcount == 1:
                    claimed.append(dict(row))
        return claimed

    def mark_delivered(self, delivery_id, state='injected', skip_reason=None):
        """Chuyển `pending` → `injected`/`skipped` trong một transaction; trả hàng sau khi đổi."""
        if state not in ('injected', 'skipped'):
            raise ValueError("state must be 'injected' or 'skipped'")
        with self.db:
            self.db.execute("UPDATE child_deliveries SET state=?, injected=?, skip_reason=?"
                            " WHERE id=? AND state='pending'",
                            (state, time.time(), skip_reason, int(delivery_id)))
        return self.delivery(delivery_id)

    def deliveries_of(self, child_id):
        """Mọi biên nhận của một con, cũ → mới (đường đọc cho event và cho sổ con)."""
        rows = self.db.execute('SELECT * FROM child_deliveries WHERE child_id=? ORDER BY id',
                               (child_id,)).fetchall()
        return [dict(r) for r in rows]

    def child_delivery_receipts(self, child_id):
        """Biên nhận gọn để nhét vào dict kết quả/event: `{recipient,state,chars,truncated}`."""
        receipts = []
        for row in self.deliveries_of(child_id):
            receipt = {'recipient': row['recipient'], 'state': row['state'],
                       'chars': row['chars'], 'truncated': bool(row['truncated'])}
            if row['state'] == 'skipped' and row['skip_reason']:
                # Lý do bỏ qua phải tới được người đọc: "không giao" mà im lặng thì không
                # phân biệt được với "giao rồi".
                receipt['reason'] = row['skip_reason']
            receipts.append(receipt)
        return receipts

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

    # ------------------------------------------------------------------
    # Vòng 25 (D-33) — sổ PHẢN BIỆN kế hoạch + sổ SỞ HỮU kế hoạch
    #
    # `plan_verifications` là phán quyết của người phản biện độc lập cho ĐÚNG một bản ghi.
    # Cổng duyệt (`PLAN_APPROVAL_UNVERIFIED`, runtime) đọc nó; giao diện đọc nó qua
    # `plan_verification_view`. Khoá `(identity, version)` nên phán quyết của bản mới KHÔNG
    # bao giờ ghi đè bản cũ — cùng luật với `plan_reviews`.
    # `plan_owners` giữ đường từ nhóm kế hoạch về PHIÊN GỐC đã ghi nó: đó là thứ tab Plan cần
    # để mở một lượt thật (`plan_reviews.session_id` đo được toàn `NULL` ở vòng 25).
    # ------------------------------------------------------------------

    def record_plan_verification(self, identity, version, verdict, issues=(), summary='',
                                 critic_session_id=None, critic_answer_chars=None, critic_verdict=None):
        """Ghi phán quyết phản biện cho một bản; trả hàng đã lưu.

        `critic_*` là DẤU VẾT: phiên phản biện nào, câu trả lời dài bao nhiêu, và verdict đọc
        được từ văn bản của chính nó. Cổng provenance đã kiểm trước khi gọi hàm này, nhưng hàng
        sổ vẫn phải giữ được bằng chứng — người đọc sau không chạy lại được lần đo đó.
        """
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError('plan verification needs a non-empty identity')
        version = int(version)
        if version < 1:
            raise ValueError('plan verification needs a positive version')
        if verdict not in ('ok', 'revise'):
            raise ValueError("verdict must be 'ok' or 'revise'")
        rows = []
        for item in (issues or ()):
            if not isinstance(item, dict):
                continue
            rows.append({'severity': str(item.get('severity') or 'medium')[:16],
                         'text': str(item.get('text') or ''),
                         'fix': str(item.get('fix') or '')})
        with self.db:
            self.db.execute(
                'INSERT OR REPLACE INTO plan_verifications'
                '(identity,version,verdict,issues,summary,critic_session_id,critic_answer_chars,'
                ' critic_verdict,created) VALUES(?,?,?,?,?,?,?,?,?)',
                (identity, version, verdict, json.dumps(rows, ensure_ascii=False), str(summary or '')[:2000],
                 critic_session_id, None if critic_answer_chars is None else int(critic_answer_chars),
                 None if critic_verdict is None else str(critic_verdict), time.time()))
        return self.plan_verification(identity, version)

    def plan_verification(self, identity, version):
        """Hàng phán quyết của một bản (đã giải `issues`), hoặc `None` khi chưa ai phản biện."""
        row = self.db.execute('SELECT * FROM plan_verifications WHERE identity=? AND version=?',
                              (identity, int(version))).fetchone()
        if row is None:
            return None
        item = dict(row)
        try:
            item['issues'] = json.loads(item['issues'])
        except (TypeError, ValueError):
            item['issues'] = []
        return item

    def record_plan_owner(self, identity, session_id, slug='', relative_path='', version=1):
        """Ghi phiên GỐC sở hữu một nhóm kế hoạch; gọi lại thì cập nhật, không nhân hàng.

        `first_session_id` và `created` là dấu vết của lần ghi ĐẦU TIÊN và không bao giờ bị ghi
        đè: một kế hoạch được sửa từ phiên con vẫn phải mở lại được ở phiên gốc.
        """
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError('plan owner needs a non-empty identity')
        if not isinstance(session_id, str) or not session_id:
            raise ValueError('plan owner needs a session id')
        now = time.time()
        with self.db:
            self.db.execute(
                'INSERT INTO plan_owners(identity,session_id,first_session_id,slug,relative_path,'
                'version,created,updated) VALUES(?,?,?,?,?,?,?,?)'
                ' ON CONFLICT(identity) DO UPDATE SET session_id=excluded.session_id,'
                ' slug=excluded.slug, relative_path=excluded.relative_path,'
                ' version=excluded.version, updated=excluded.updated',
                (identity, session_id, session_id, str(slug or ''), str(relative_path or ''),
                 int(version), now, now))
        return self.plan_owner(identity)

    def plan_owner(self, identity):
        """Hàng sở hữu của một nhóm kế hoạch, hoặc `None` khi harness chưa biết."""
        row = self.db.execute('SELECT * FROM plan_owners WHERE identity=?', (identity,)).fetchone()
        return dict(row) if row is not None else None

    def plan_written_at(self, session_ids, identity, version):
        """Epoch của hàng `plan_written` MỚI NHẤT khớp `(identity, version)` trong tập phiên.

        Đây là mốc thời gian của cổng provenance (M3): một phê bình chỉ có giá trị nếu phiên
        phản biện chạy SAU khi chính bản đó được ghi. Trả `None` khi không có hàng nào — và
        `None` làm cổng từ chối, không phải làm nó bỏ qua.
        """
        ids = [sid for sid in (session_ids or ()) if isinstance(sid, str) and sid]
        if not ids:
            return None
        marks = ','.join('?' * len(ids))
        rows = self.db.execute(
            f"SELECT payload, created FROM events WHERE kind='plan_written' "
            f"AND session_id IN ({marks}) ORDER BY seq", tuple(ids)).fetchall()
        found = None
        for row in rows:
            try:
                payload = json.loads(row['payload'])
            except (TypeError, ValueError):
                continue  # hàng hỏng bị BỎ QUA, không làm hỏng cả phép tìm
            if not isinstance(payload, dict):
                continue
            if payload.get('identity') != identity:
                continue
            try:
                row_version = int(payload.get('version'))
            except (TypeError, ValueError):
                continue
            if row_version == int(version):
                found = float(row['created'])
        return found

    def last_turn_status(self, sid):
        """Bộ số của hàng `turn_end` MỚI NHẤT: `{'turn','status','partial','code','at'}`.

        `sessions.status` là trạng thái của PHIÊN (một lượt dở vẫn để phiên `completed` — bất
        biến #1). Muốn nói được "lượt này dở" thì phải đọc chính hàng `turn_end`, và mã lý do
        nằm ở hàng `notice` bền (`partial: true`) mà `finish_partial` phát sau đó.
        """
        row = self.db.execute(
            "SELECT payload, created FROM events WHERE session_id=? AND kind='turn_end' "
            "ORDER BY seq DESC LIMIT 1", (sid,)).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row['payload'])
        except (TypeError, ValueError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        status = str(payload.get('status') or '')
        partial = status == 'partial' or bool(payload.get('partial'))
        code = None
        if partial:
            notices = self.db.execute(
                "SELECT payload FROM events WHERE session_id=? AND kind='notice' ORDER BY seq DESC LIMIT 20",
                (sid,)).fetchall()
            for notice_row in notices:
                try:
                    notice = json.loads(notice_row['payload'])
                except (TypeError, ValueError):
                    continue
                if isinstance(notice, dict) and notice.get('partial'):
                    code = notice.get('code')
                    break
        return {'turn': payload.get('turn'), 'status': status, 'partial': partial, 'code': code,
                'at': float(row['created'])}

    def turn_boundary_epoch(self, sid):
        """Epoch bắt đầu LƯỢT đang chạy: hàng `events` `kind='user'` mới nhất.

        `start()` phát hàng `user` trước khi chạy lượt, nên đây là ranh giới lượt mà không cần
        thêm trạng thái trong bộ nhớ và không cần đồng hồ thứ hai (M3 đếm vòng `revise` từ đây).
        """
        row = self.db.execute(
            "SELECT created FROM events WHERE session_id=? AND kind='user' ORDER BY seq DESC LIMIT 1",
            (sid,)).fetchone()
        return None if row is None else float(row['created'])

    def set_plan_review_resumed(self, identity, version, resumed=True):
        """Đánh dấu hàng duyệt đã mở được lượt thật (`resumed`) — giao diện đọc để nói sự thật."""
        with self.db:
            self.db.execute('UPDATE plan_reviews SET resumed=? WHERE identity=? AND version=?',
                            (1 if resumed else 0, identity, int(version)))
        return self.plan_review(identity, version)

    def delete(self, sid):
        with self.db:
            child_rows = self.db.execute('SELECT id FROM sessions WHERE parent_id=?', (sid,)).fetchall()
            all_sids = [sid] + [r['id'] for r in child_rows]
            placeholders = ','.join('?' for _ in all_sids)
            self.db.execute(f'DELETE FROM checkpoints WHERE session_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM events WHERE session_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM sessions WHERE id IN ({placeholders})', all_sids)
            # Vòng 22 (T1): sổ con và biên nhận đi theo phiên — xoá phiên mà để lại hàng sổ con
            # thì watchdog sẽ đi tìm một phiên không còn tồn tại (và bắn event vào luồng đã xoá).
            self.db.execute(f'DELETE FROM children WHERE session_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM children WHERE parent_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM child_deliveries WHERE child_id IN ({placeholders})', all_sids)
            self.db.execute(f'DELETE FROM child_deliveries WHERE recipient IN ({placeholders})', all_sids)
            # Vòng 25 (D-33): HAI SỔ CỦA VÒNG LẶP KẾ HOẠCH **CỐ Ý** không nằm trong cascade này.
            # `plan_verifications`/`plan_owners` nói về một NHÓM KẾ HOẠCH, không về một phiên: cùng
            # một kế hoạch có thể được sửa ở phiên khác, và xoá phiên cũ mà làm biến mất phán quyết
            # phản biện của bản đang nằm trên đĩa thì cổng duyệt sẽ từ chối một bản đã được phản
            # biện thật. Xoá hàng `.plans/` mới là cách kết thúc vòng đời của một kế hoạch.
        return True

    def close(self):
        self.db.close()

