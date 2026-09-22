"""P1.4 (đợt 23) — bằng chứng TẠI GỐC: mỗi lần ghi tệp để lại một mảnh kiểm chứng được.

Sự việc đo được (vòng 21): `file_write` trả đúng một câu `'Written <rel>'`, `file_edit_block` trả
`'Updated <rel>'` — không diff, không hash, không số dòng, nên cổng bằng chứng ở câu trả lời cuối
không có gì để trích: muốn biết một lượt có thật sự đổi tệp hay không thì phải đi tìm ở nơi khác.

Chỗ rẻ nhất và thật nhất để sinh bằng chứng là CHÍNH công cụ đã sửa tệp. `worker.py` được harness
gửi nội tuyến vào box ở mỗi lần gọi, nên bài này chạy ĐÚNG cửa vào của worker
(`worker.execute`) trên một thư mục tạm — máy chủ nhà không có `/home/agent/workspace` — và khoá:

- `file_write` tạo tệp mới ⇒ `sha256Before` là `None`, `added` = số dòng vừa thêm;
- `file_edit_block` sửa tệp ⇒ hai hash khác nhau, diff đúng dấu `+`/`-`, và tệp bằng chứng có thật;
- tệp cũ quá 256 KiB ⇒ **không** diff, `numbers.diffSkipped = 'too_large'`;
- diff dài ⇒ cắt còn 8 000 ký tự kèm `numbers.diffTruncated`;
- không có `sid` ⇒ `artifact` là `None` (lượt gọi ngoài phiên không đổ rác vào workspace);
- mặt harness: payload gửi worker và hai route capture/ghi hình mang `turn`/`step`/`toolCallId` do
  harness đặt, không lấy từ `args` của model.
"""
import asyncio
import base64
import hashlib
import json
import re
from pathlib import Path

import pytest

from agentbox.sandbox import executor as executor_module
from agentbox.sandbox import worker
from agentbox.sandbox.executor import SandboxExecutor

SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
EVIDENCE_DIR = '.generated_artifacts/captures/evidence/a1b2c3d4'


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


@pytest.fixture
def box(tmp_path, monkeypatch):
    """Trỏ `ROOT` của worker vào thư mục tạm (cùng cách bài `test_worker_file_read.py` làm)."""
    root = Path(tmp_path).resolve()
    monkeypatch.setattr(worker, 'ROOT', root)
    return root


def test_a_new_file_reports_no_before_hash_and_its_added_line_count(box):
    """(a) Tệp mới: không có gì để so nên `sha256Before` là `None`, `added` là số dòng đã ghi."""
    payload = worker.execute('file_write', {'path': 'src/app.py', 'content': 'a\nb\nc\n'}, SID, step=2)

    assert payload['content'] == 'Written src/app.py', 'khoá cũ `content` phải giữ nguyên'
    numbers = payload['numbers']
    assert numbers['sha256Before'] is None, 'tệp chưa tồn tại thì không được bịa một hash cũ'
    assert numbers['sha256After'] == digest('a\nb\nc\n')
    assert numbers['added'] == 3 and numbers['removed'] == 0
    assert numbers['lines'] == 3 and numbers['bytes'] == 6
    assert numbers['session'] == SID and numbers['step'] == 2 and numbers['tool'] == 'file_write'
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', numbers['at']), 'mốc thời gian ISO-8601 UTC'
    assert 'path' not in numbers, '`path` ở lại trong tệp bằng chứng, không đi vào kết quả tool'
    assert payload['diff'].startswith('--- a/src/app.py\n+++ b/src/app.py\n')
    assert box.joinpath('src/app.py').read_text(encoding='utf-8') == 'a\nb\nc\n'


def test_an_edit_reports_both_hashes_and_a_readable_diff(box):
    """(b) Sửa tệp: hai hash khác nhau, diff đúng dấu, tệp bằng chứng có thật và chứa hash mới."""
    before = 'def add(a, b):\n    return a - b\n'
    box.joinpath('calc.py').write_text(before, encoding='utf-8')

    payload = worker.execute('file_edit_block', {'path': 'calc.py', 'old_text': '    return a - b',
                                                 'new_text': '    return a + b'}, SID, step=3)

    numbers = payload['numbers']
    assert payload['content'] == 'Updated calc.py'
    assert numbers['sha256Before'] == digest(before)
    assert numbers['sha256After'] == digest('def add(a, b):\n    return a + b\n')
    assert numbers['sha256Before'] != numbers['sha256After']
    assert numbers['added'] == 1 and numbers['removed'] == 1 and numbers['lines'] == 2
    diff_lines = payload['diff'].splitlines()
    assert '-    return a - b' in diff_lines and '+    return a + b' in diff_lines
    assert diff_lines[0] == '--- a/calc.py' and diff_lines[1] == '+++ b/calc.py'

    artifact = box / payload['artifact']
    assert payload['artifact'].startswith(EVIDENCE_DIR + '/') and artifact.is_file()
    document = artifact.read_text(encoding='utf-8')
    assert payload['diff'] in document, 'tệp bằng chứng phải chở chính diff đã trả về'
    for line in ('path: calc.py', 'sha256Before: ' + numbers['sha256Before'],
                 'sha256After: ' + numbers['sha256After'], 'added: 1', 'removed: 1',
                 'lines: 2', 'session: ' + SID, 'step: 3', 'tool: file_edit_block'):
        assert line in document.splitlines(), line


def test_an_oversized_old_file_is_hashed_but_never_diffed(box):
    """(c) Trần an toàn 256 KiB: hashes và số dòng vẫn có, `diff` rỗng, lý do là `too_large`."""
    before = 'x' * (300 * 1024) + '\n'
    box.joinpath('big.txt').write_text(before, encoding='utf-8')

    payload = worker.execute('file_write', {'path': 'big.txt', 'content': 'nhỏ thôi\n'}, SID, step=4)

    assert payload['diff'] == '', 'không diff một tệp quá trần'
    assert payload['numbers']['diffSkipped'] == 'too_large'
    assert payload['numbers']['sha256Before'] == digest(before), 'hash nội dung cũ vẫn phải thật'
    assert payload['numbers']['lines'] == 1 and payload['numbers']['bytes'] == len('nhỏ thôi\n'.encode('utf-8'))
    assert payload['artifact'].endswith('.txt'), 'không có diff thì mảnh bằng chứng là tệp txt'


def test_a_long_diff_is_cut_at_the_limit_and_flagged(box):
    """(d) Diff dài: cắt còn 8 000 ký tự và nói thật là đã cắt, số dòng đếm trên diff ĐẦY ĐỦ."""
    box.joinpath('long.txt').write_text(''.join(f'cũ {index}\n' for index in range(1200)), encoding='utf-8')

    payload = worker.execute('file_write', {'path': 'long.txt',
                                            'content': ''.join(f'mới {index}\n' for index in range(1200))},
                             SID, step=5)

    assert len(payload['diff']) == 8000, 'diff trả về bị cắt đúng ở trần'
    assert payload['numbers']['diffTruncated'] is True
    assert payload['numbers']['added'] == 1200 and payload['numbers']['removed'] == 1200


def test_a_call_without_a_session_returns_the_numbers_but_writes_no_evidence_file(box):
    """(e) Không có `sid`: vẫn trả `diff`/`numbers`, nhưng không đổ rác vào workspace."""
    payload = worker.execute('file_write', {'path': 'note.md', 'content': 'một dòng\n'}, '')

    assert payload['artifact'] is None
    assert payload['numbers']['sha256Before'] is None and payload['numbers']['sha256After'] == digest('một dòng\n')
    assert payload['diff'].startswith('--- a/note.md\n+++ b/note.md\n')
    assert not box.joinpath('.generated_artifacts').exists()


def test_the_evidence_file_name_follows_the_box3_shape(box):
    """Khuôn BOX-3 `captures/evidence/<sid8>/<sid8>_<step>_<slug>.<ext>`; bước không gửi ⇒ token `000`."""
    payload = worker.execute('file_write', {'path': 'docs/Báo cáo v2.md', 'content': 'x\n'}, SID)

    assert payload['numbers']['step'] == 0
    assert payload['artifact'] == f'{EVIDENCE_DIR}/a1b2c3d4_000_b-o-c-o-v2.md.diff', 'slug chỉ [a-z0-9._-]'
    assert box.joinpath(payload['artifact']).is_file()

    dotfile = worker.execute('file_write', {'path': '.env', 'content': 'A=1\n'}, SID, step=1)
    assert dotfile['artifact'] == f'{EVIDENCE_DIR}/a1b2c3d4_001_env.diff', 'bỏ dấu chấm đầu để tệp không bị ẩn'


def test_overwriting_a_binary_file_still_works_and_invents_no_diff(box):
    """Tệp cũ không phải văn bản: ghi được như trước, chỉ không bịa ra một diff vô nghĩa."""
    box.joinpath('shot.png').write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(range(256)))

    payload = worker.execute('file_write', {'path': 'shot.png', 'content': 'giờ là văn bản\n'}, SID, step=6)

    assert payload['numbers']['diffSkipped'] == 'binary' and payload['diff'] == ''
    assert payload['numbers']['sha256Before'] is not None
    assert payload['artifact'].endswith('.txt')
    assert box.joinpath('shot.png').read_text(encoding='utf-8') == 'giờ là văn bản\n'


class _FakeProcess:
    """Tiến trình `docker exec` giả: giữ stdin để bài kiểm đọc lại payload harness gửi."""

    returncode = 0

    def __init__(self):
        self.stdin = b''

    async def communicate(self, data):
        self.stdin = data
        return json.dumps({'content': 'Written whatever'}).encode(), b''

    def kill(self):
        raise AssertionError('không được kill tiến trình giả')

    async def wait(self):
        raise AssertionError('không được chờ tiến trình giả')


def _fake_docker(monkeypatch):
    """Chặn `docker exec` và trả về tiến trình giả để đọc payload gửi cho worker."""
    proc = _FakeProcess()

    async def fake_exec(*argv, **kwargs):
        return proc

    monkeypatch.setattr(executor_module.asyncio, 'create_subprocess_exec', fake_exec)
    return proc


def test_the_worker_payload_carries_the_identity_the_harness_set(monkeypatch):
    """Mặt harness: `turn`/`step`/`toolCallId` do harness đặt và phải tới worker nguyên vẹn."""
    proc = _fake_docker(monkeypatch)

    asyncio.run(SandboxExecutor().execute('file_write', {'path': 'a.txt', 'content': 'x'}, SID,
                                          turn=3, step=2, tool_call_id='call-1'))

    request = json.loads(proc.stdin.decode())
    assert request == {'name': 'file_write', 'args': {'path': 'a.txt', 'content': 'x'}, 'session': SID,
                       'turn': 3, 'step': 2, 'toolCallId': 'call-1'}, \
        'args của model không được trộn định danh của lượt'


def test_an_old_call_site_still_sends_the_three_keys_as_null(monkeypatch):
    """Chỗ gọi cũ (không truyền gì) vẫn dùng được: ba khoá có mặt với giá trị `None`."""
    proc = _fake_docker(monkeypatch)

    asyncio.run(SandboxExecutor().execute('file_read', {'path': 'a.txt'}, SID))

    request = json.loads(proc.stdin.decode())
    assert request['turn'] is None and request['step'] is None and request['toolCallId'] is None


def test_the_capture_and_record_bodies_carry_the_step_and_the_call_id(monkeypatch):
    """Hai route này đã đọc `step`/`toolCallId` từ lâu nhưng harness chưa từng gửi
    (`deploy/docker/ide-proxy.py:284`), nên ảnh chụp không mang số bước."""
    sent = []

    class Recording(SandboxExecutor):
        async def request(self, path, body=None):
            sent.append((path, body))
            if path == '/__box/capture':
                return {'path': 'screen/a1b2c3d4/a1b2c3d4_002_screen.png', 'data': base64.b64encode(b'png').decode()}
            return {'recordingId': 'rec-1'}

    monkeypatch.setattr(executor_module, 'image_dimensions_from_bytes', lambda raw: (2, 2))
    executor = Recording()
    asyncio.run(executor.execute('computer_screen_capture', {}, SID, turn=3, step=2, tool_call_id='call-7'))
    asyncio.run(executor.execute('computer_screen_record', {'action': 'start'}, SID, turn=3, step=2,
                                 tool_call_id='call-7'))

    assert sent == [('/__box/capture', {'target': {'kind': 'screen'}, 'output': 'base64', 'session': SID,
                                        'step': 2, 'toolCallId': 'call-7'}),
                    ('/__box/record/start', {'target': {'kind': 'screen'}, 'session': SID, 'step': 2,
                                             'toolCallId': 'call-7'})]
