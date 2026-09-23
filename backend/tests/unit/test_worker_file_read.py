"""A8 (vòng 22) — `file_read` trong box đọc được tệp NHỊ PHÂN, không làm chết lượt.

Sự việc đo được: một `.png`/`.pdf` người dùng vừa tải lên làm lượt chết `UnicodeDecodeError` —
mô hình không đọc được gì, và cái chết nằm ở tầng thấp nên thông báo không nói được vì sao.

Bài này chạy ĐÚNG cửa vào của worker (`worker.execute('file_read', …)`, thứ được gửi nội tuyến
vào box mỗi lượt) trên một thư mục tạm, nên nó kiểm cả hợp đồng dữ liệu trả về:

- tệp nhị phân ⇒ `encoding: 'base64'` + `bytesRead`/`sizeBytes`/`truncated`;
- tệp văn bản ⇒ **không** có khoá `encoding`, nội dung nguyên như trước;
- `truncated` nói sự thật của phép đọc: đủ byte thì `False`, bị cắt ở 30 000 ký tự thì `True`.
"""
import base64
from pathlib import Path

import agentbox.sandbox.worker as worker

# 1 KiB PNG thật (đuôi nhị phân nằm trong danh sách, nội dung cũng có byte 0x00).
PNG_1KIB = (b'\x89PNG\r\n\x1a\n' + bytes(range(256)) * 4)[:1024]
MARKDOWN = '# Báo cáo\n\nNội dung tiếng Việt có dấu: đã đọc xong.\n'


def _box(tmp_path):
    """Trỏ `ROOT` của worker vào thư mục tạm — máy chủ nhà không có `/home/agent/workspace`."""
    worker.ROOT = Path(tmp_path).resolve()
    return worker.ROOT


def test_a_one_kib_png_is_read_as_base64_without_raising(tmp_path):
    root = _box(tmp_path)
    (root / '.uploaded_artifacts').mkdir(parents=True, exist_ok=True)
    target = root / '.uploaded_artifacts' / '7.png'
    target.write_bytes(PNG_1KIB)

    payload = worker.execute('file_read', {'path': '.uploaded_artifacts/7.png'}, 'session-1')

    assert payload['encoding'] == 'base64', 'mô hình phải biết đây là dữ liệu đã mã hoá'
    assert base64.b64decode(payload['content']) == PNG_1KIB, 'nội dung phải là chính tệp đó'
    assert payload['bytesRead'] == len(PNG_1KIB) and payload['sizeBytes'] == len(PNG_1KIB)
    assert payload['truncated'] is False, 'tệp 1 KiB nằm trọn trong content thì không được nói là thiếu'


def test_a_markdown_file_keeps_the_old_text_contract(tmp_path):
    root = _box(tmp_path)
    (root / 'notes').mkdir(parents=True, exist_ok=True)
    (root / 'notes' / 'báo cáo.md').write_text(MARKDOWN, encoding='utf-8')

    payload = worker.execute('file_read', {'path': 'notes/báo cáo.md'}, 'session-1')

    assert payload['content'] == MARKDOWN, 'nhánh văn bản giữ nguyên hành vi cũ'
    assert 'encoding' not in payload and 'bytesRead' not in payload


def test_a_binary_file_with_a_text_extension_is_still_readable(tmp_path):
    """Ảnh chụp đổi tên thành `.txt`, hoặc tệp nén sai đuôi: dò byte `\\x00` phải bắt được."""

    root = _box(tmp_path)
    (root / 'shard.txt').write_bytes(b'PNG-ish' + b'\x00' * 16 + b'tail')
    payload = worker.execute('file_read', {'path': 'shard.txt'}, 'session-1')
    assert payload['encoding'] == 'base64' and payload['bytesRead'] == 27
    assert base64.b64decode(payload['content']) == b'PNG-ish' + b'\x00' * 16 + b'tail'


def test_a_text_extension_with_broken_utf8_falls_back_instead_of_dying(tmp_path):
    """`latin-1` trong một tệp `.md`: trước đây là `UnicodeDecodeError` giết cả lượt."""

    root = _box(tmp_path)
    raw = 'Báo cáo: '.encode('latin-1') + b'caf\xe9'
    (root / 'legacy.md').write_bytes(raw)
    payload = worker.execute('file_read', {'path': 'legacy.md'}, 'session-1')
    assert payload['encoding'] == 'base64'
    assert base64.b64decode(payload['content']) == raw


def test_a_large_binary_is_cut_at_thirty_thousand_chars_and_says_so(tmp_path):
    root = _box(tmp_path)
    size = 200 * 1024
    (root / 'big.pdf').write_bytes(bytes(range(256)) * (size // 256))
    payload = worker.execute('file_read', {'path': 'big.pdf'}, 'session-1')

    assert len(payload['content']) == worker.BINARY_READ_CHARS == 30_000
    assert payload['truncated'] is True and payload['bytesRead'] == 22_500
    assert payload['sizeBytes'] == size, 'mô hình phải biết tệp thật dài bao nhiêu'


def test_the_path_guard_still_refuses_to_leave_the_workspace(tmp_path):
    """A8 không được nới cổng cũ: `..` vẫn bị từ chối như trước."""

    _box(tmp_path)
    try:
        worker.execute('file_read', {'path': '../etc/passwd'}, 'session-1')
    except ValueError as exc:
        assert 'Path Traversal Denied' in str(exc)
    else:  # pragma: no cover - chỉ chạy khi cổng bị nới
        raise AssertionError('đường dẫn ra ngoài workspace phải bị từ chối')
