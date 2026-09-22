"""Chỉ dẫn của chủ máy (tab Instructions): MỘT tài liệu + `revision`.

Khuôn theo `skills/commands.py`: bảng một dòng `id=1`, `value` + `revision`. Chỉ dẫn
là văn bản của chủ máy chứ không phải danh sách cờ, nên thứ duy nhất cần chống là
ghi đè từ một bản cũ — `revision` làm đúng việc đó, và lệch thì báo
`REVISION_CONFLICT` (boundary đã map mã này thành 409) chứ không âm thầm ghi.

Chuỗi được lưu **nguyên văn**: Markdown vẫn là Markdown, không chuẩn hoá, không cắt
lúc lưu. Việc cắt theo `limits.INSTRUCTIONS_MAX_CHARS` xảy ra khi ghép system
message (`runtime.py`), nên tài liệu gốc vẫn còn đủ cho người dùng sửa lại.
"""
from ..agent_core.limits import INSTRUCTIONS_MAX_CHARS


class OwnerSettings:
    def __init__(self, store):
        self.store = store
        self._ready = False

    def _table(self):
        """Bảng tạo ở lần dùng đầu tiên, không phải trong `__init__`.

        `create_app` dựng `OwnerSettings` cho MỌI app, kể cả những runtime tối thiểu mà
        test dựng lên chỉ để chạm một route khác (test nhật ký hệ thống) — những store đó
        không có kết nối SQLite. Chạm DB trong `__init__` là biến việc dựng app thành lỗi
        của một bảng chưa ai hỏi tới.
        """
        if not self._ready:
            self.store.db.executescript('''
                CREATE TABLE IF NOT EXISTS owner_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL);
            ''')
            self.store.db.commit()
            self._ready = True
        return self.store.db

    def settings(self):
        """Tài liệu đang lưu: chuỗi rỗng + revision 0 khi chưa ghi lần nào."""
        row = self._table().execute('SELECT value,revision FROM owner_settings WHERE id=1').fetchone()
        return {'instructions': row[0] if row else '', 'revision': row[1] if row else 0}

    def configure(self, value):
        """Ghi khi `revision` còn khớp bản đang lưu, rồi trả tài liệu mới (revision + 1)."""
        current = self.settings()
        if value.get('revision') != current['revision']:
            raise ValueError('REVISION_CONFLICT: reload owner settings')
        instructions = value.get('instructions')
        if not isinstance(instructions, str):
            raise ValueError('INSTRUCTIONS_INVALID: instructions must be a string')
        with self._table() as db:
            db.execute('INSERT OR REPLACE INTO owner_settings VALUES(1,?,?)',
                       (instructions, current['revision'] + 1))
        return self.settings()

    def for_engine(self):
        """Đúng phần engine sẽ đọc — cắt bằng CÙNG hằng số với `runtime.py`."""
        return self.settings()['instructions'][:INSTRUCTIONS_MAX_CHARS]
