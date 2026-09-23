"""Năm op phiên/nhật ký đi qua ĐÚNG cửa vào của worker (`worker.execute`) — việc A1, A7.

Vì sao phải kiểm ở đây chứ không chỉ ở `session_ops`: harness **gửi nội tuyến** `worker.py` qua
`docker exec`, nên `worker.py` mới là mặt mà lượt thật gọi. Bài này chạy trên máy chủ nhà (không cần
container) bằng cách trỏ `session_files` vào một thư mục tạm, và khoá lại hai điều:

1. Có `session_ops` trên đường dẫn ⇒ op chạy được qua `worker.execute` (đúng chuỗi mà lượt thật đi).
2. **Không** có `session_ops` (box chưa re-stage) ⇒ lỗi có mã `SESSION_OPS_UNAVAILABLE`, **không**
   ném ra ngoài — vì lỗi ghi nhật ký không được giết một lượt.
"""
import importlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEPLOY = REPO / 'deploy' / 'docker'


def _worker(tmp_root, *, with_session_ops: bool):
    """Nạp lại `worker.py` trong điều kiện có/không có `session_ops` trên `sys.path`.

    Phải xoá `session_ops`/`session_files` khỏi `sys.modules`: `importlib.reload` chạy lại thân
    mô-đun nhưng vẫn thấy mô-đun đã nạp trong bộ đệm, nên nếu không xoá thì bài "box chưa staged"
    lại thấy đủ bốn op — đúng cái bẫy làm bài kiểm thành vô nghĩa.
    """
    sys.path[:] = [entry for entry in sys.path if entry not in (str(DEPLOY), '/usr/local/bin')]
    for name in ('session_ops', 'session_files'):
        sys.modules.pop(name, None)
    if with_session_ops:
        sys.path.insert(0, str(DEPLOY))
    module = importlib.import_module('agentbox.sandbox.worker')
    importlib.reload(module)
    return module


def test_the_five_ops_are_reachable_through_the_worker_entry_point(tmp_path):
    worker = _worker(tmp_path, with_session_ops=True)
    # A7 (vòng 22) thêm `uploads_prune` vào `SESSION_OP_NAMES`: op dọn `.uploaded_artifacts`
    # phải đi qua đúng cửa vào mà lượt thật dùng, không chỉ đứng trong `session_ops`.SIGS.
    assert set(worker.SESSION_OPS) == {'session_ensure', 'journal_append', 'checkpoint_write',
                                       'captures_prune', 'uploads_prune'}
    sid = 'a1b2c3d4' * 4

    created = worker.execute('session_ensure', {'session': sid, 'root': str(tmp_path)}, sid)
    assert created['ok'] is True
    assert (tmp_path / 'a1b2c3d4' / 'session.json').is_file()

    record = {'kind': 'task', 'text': 'việc: đo ngưỡng nén', 'sid': sid, 'sid8': 'a1b2c3d4'}
    appended = worker.execute('journal_append', {'session': sid, 'record': record, 'root': str(tmp_path)}, sid)
    assert appended['ok'] is True
    lines = (tmp_path / 'a1b2c3d4' / 'journal.jsonl').read_text(encoding='utf-8').strip().splitlines()
    assert json.loads(lines[0])['text'] == 'việc: đo ngưỡng nén'

    written = worker.execute('checkpoint_write',
                             {'session': sid, 'root': str(tmp_path),
                              'messages': [{'role': 'user', 'content': 'trước nén'}]}, sid)
    assert written['ok'] is True and written['checkpointNumber'] == 1
    assert (tmp_path / 'a1b2c3d4' / 'checkpoints' / 'ck-a1b2c3d4-001.json').is_file()


def test_a_box_without_the_journal_modules_answers_with_a_code_and_never_raises(tmp_path):
    worker = _worker(tmp_path, with_session_ops=False)
    assert worker.SESSION_OPS == ()
    answer = worker.execute('session_ensure', {'session': 'a1b2c3d4' * 4}, 'a1b2c3d4' * 4)
    assert answer['is_error'] is True
    assert answer['error'].startswith('SESSION_OPS_UNAVAILABLE')

    # Và một công cụ cũ vẫn trả đúng lỗi cũ của nó — `execute` ném, khối `__main__` bắt rồi in JSON
    # `{'is_error': True, ...}` (xem cuối `worker.py`), nên bài này bắt đúng cách đó.
    try:
        worker.execute('khong_co_cong_cu_nay', {}, 'a1b2c3d4' * 4)
    except ValueError as exc:
        assert str(exc) == 'Unsupported sandbox tool: khong_co_cong_cu_nay'
    else:  # pragma: no cover - chỉ chạy khi nhánh mới của op phiên nuốt tên công cụ lạ
        raise AssertionError('tên công cụ lạ phải đi tới lỗi cũ')
