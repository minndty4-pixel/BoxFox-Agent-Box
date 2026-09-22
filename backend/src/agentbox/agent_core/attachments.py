"""A7 (vòng 22) — tệp đính kèm của một lượt: kiểm vào, và khối mô tả gửi cho model.

Hai việc, một chỗ:

1. **Kiểm vào** (`validate_attachments`, `validate_inline_images`): giao diện gửi lên đường
   dẫn tương đối của tệp đã nằm THẬT trên đĩa box (A5/A6), kèm mảng ảnh inline. Harness
   không tin dữ liệu của client: `path` phải là đường dẫn tương đối an toàn, và đường dẫn
   tuyệt đối để mô hình `file_read` do **chỗ này** suy ra — client gửi gì cũng không đẩy
   được mô hình ra ngoài workspace.
2. **Khối mô tả** (`attachment_prompt_block`): mô hình chỉ đọc được tệp nếu biết đường dẫn
   thật, nên harness dựng MỘT khối cho cả đường lượt thường (`HarnessRuntime.start`) và
   đường command/skill (`RuntimeCommands.submit`).

Vì sao là mô-đun riêng: `agent_core/runtime.py` nhập `skills/runtime_commands.py`, nên hai
mô-đun đó không nhập được lẫn nhau; hàm thuần nằm đây thì cả hai dùng chung một nguồn.
"""

WORKSPACE_ROOT = '/home/agent/workspace'
MAX_ATTACHMENTS = 25
MAX_ATTACHMENT_NAME = 200
# Trần ảnh của một lượt: khớp `MAX_TURN_IMAGES`/`MAX_TURN_IMAGE_CHARS` ở ô soạn tin
# (`frontend/src/components/panels/ChatInputBar.tsx`) và thân request 1 MiB của harness.
MAX_INLINE_MEDIA = 2
MAX_INLINE_IMAGE_CHARS = 700_000
INLINE_IMAGE_CHARS_TOTAL = 800_000
IMAGE_PREFIXES = ('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')


def absolute_workspace_path(path: str) -> str:
    """Đường dẫn tuyệt đối trong box của một đường dẫn tương đối đã qua kiểm."""
    return f'{WORKSPACE_ROOT}/{str(path).lstrip("/")}'


def format_size(size_bytes) -> str:
    """Kích thước người đọc được: `23 B`, `12 KB`, `1.5 MB`."""
    try:
        value = int(size_bytes)
    except (TypeError, ValueError):
        return '?'
    if value < 1024:
        return f'{value} B'
    if value < 1024 * 1024:
        return f'{round(value / 1024)} KB'
    return f'{value / (1024 * 1024):.1f} MB'


def validate_inline_images(images):
    """Chuẩn hoá và kiểm mảng ảnh của MỘT lượt; sai ⇒ `ValueError` ⇒ HTTP 400.

    Luật từng ảnh y như luật cũ (chỉ nhận `data:image/png|jpeg|webp;base64,`, ≤ 700 000
    ký tự); thêm hai trần của lượt: số ảnh (`MAX_INLINE_MEDIA`) và tổng ký tự
    (`INLINE_IMAGE_CHARS_TOTAL`) — vì thân request bị chặn ở 1 MiB.
    """
    rows = [row for row in (images or []) if row]
    for row in rows:
        if (not isinstance(row, str) or not row.startswith(IMAGE_PREFIXES)
                or len(row) > MAX_INLINE_IMAGE_CHARS):
            raise ValueError('Unsupported or oversized image')
    if len(rows) > MAX_INLINE_MEDIA:
        raise ValueError(f'IMAGE_LIMIT: at most {MAX_INLINE_MEDIA} images per turn')
    total = sum(len(row) for row in rows)
    if total > INLINE_IMAGE_CHARS_TOTAL:
        raise ValueError(f'IMAGE_LIMIT_TOTAL: the turn carries {total} image chars, over the '
                         f'{INLINE_IMAGE_CHARS_TOTAL}-char limit')
    return rows


def validate_attachments(rows):
    """Chuẩn hoá danh sách tệp đính kèm; sai ⇒ `ValueError('ATTACHMENTS_INVALID: …')` ⇒ 400.

    Trả về danh sách đã kiểm, mỗi mục chỉ còn `name`/`path`/`absolutePath`/`sizeBytes`/`kind`
    — dạng mà event `user` và khối mô tả cùng đọc.
    """
    if rows is None:
        return []
    if not isinstance(rows, (list, tuple)):
        raise ValueError('ATTACHMENTS_INVALID: attachments must be a list')
    if len(rows) > MAX_ATTACHMENTS:
        raise ValueError(f'ATTACHMENTS_INVALID: at most {MAX_ATTACHMENTS} files per turn')
    checked = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('ATTACHMENTS_INVALID: each attachment needs path, name and sizeBytes')
        path = str(row.get('path') or '').strip().replace('\\', '/')
        if (not path or path.startswith('/') or '\x00' in path
                or any(part in {'', '..'} for part in path.split('/'))):
            raise ValueError(f'ATTACHMENTS_INVALID: unsafe attachment path {path!r}')
        size = row.get('sizeBytes', 0)
        if isinstance(size, bool) or not isinstance(size, (int, float)) or size < 0:
            raise ValueError('ATTACHMENTS_INVALID: sizeBytes must be a number >= 0')
        name = str(row.get('name') or path.rsplit('/', 1)[-1])[:MAX_ATTACHMENT_NAME]
        checked.append({
            'name': name,
            'path': path,
            # Đường dẫn tuyệt đối do HARNESS suy từ `path` đã kiểm (không lấy từ client).
            'absolutePath': absolute_workspace_path(path),
            'sizeBytes': int(size),
            'kind': 'folder-item' if row.get('kind') == 'folder-item' else 'file',
        })
    return checked


def attachment_prompt_block(attachments) -> str:
    """Khối văn bản nói cho mô hình biết tệp đã nằm ở đâu trong box (không có tệp ⇒ `''`)."""
    if not attachments:
        return ''
    lines = ['[Tệp đính kèm đã lưu trong box]']
    for row in attachments:
        path = str(row.get('path') or '')
        absolute = str(row.get('absolutePath') or '').strip() or absolute_workspace_path(path)
        label = str(row.get('name') or '').strip() or path.rsplit('/', 1)[-1] or '?'
        lines.append(f'- {absolute} ({label}, {format_size(row.get("sizeBytes"))})')
    return '\n'.join(lines)
