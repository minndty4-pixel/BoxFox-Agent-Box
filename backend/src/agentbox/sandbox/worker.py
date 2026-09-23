"""Executed ONLY inside the configured Docker sandbox as unprivileged agent.

The host sends this module through docker exec; no host workspace/tool fallback.
"""
import base64
import difflib
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path('/home/agent/workspace').resolve()

# F6 (đợt 8): Xvnc chạy `-AcceptSetDesktopSize` nên client RFB kéo được framebuffer nhỏ
# đi (tester từng thấy 286x311) — toạ độ bấm sau đó trỏ sai mà không ai báo. Giữ auto-fit
# nhưng chặn SÀN: trước thao tác theo toạ độ, nếu màn hình nhỏ hơn cỡ cấu hình thì đặt lại.
SCREEN_ENV = 'BOX_SCREEN'
DEFAULT_SCREEN = (1280, 800)
VNC_OUTPUT = 'VNC-0'
DISPLAY_ENV = {**os.environ, 'DISPLAY': ':99'}


def desktop_target():
    """Cỡ màn hình cấu hình (`BOX_SCREEN` = `WxH` hoặc `WxHxD`), mặc định 1280x800."""
    match = re.match(r'^(\d{3,5})x(\d{3,5})', (os.environ.get(SCREEN_ENV) or '').strip())
    if not match:
        return DEFAULT_SCREEN
    return int(match.group(1)), int(match.group(2))


def screen_size():
    """(rộng, cao) thật của framebuffer, hoặc None khi không đọc được."""
    try:
        proc = subprocess.run(['xrandr', '--current'], env=DISPLAY_ENV, capture_output=True, timeout=10)
    except (subprocess.SubprocessError, OSError):
        return None
    if proc.returncode:
        return None
    match = re.search(r'current (\d+) x (\d+)', proc.stdout.decode(errors='replace'))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def ensure_desktop_size():
    """Đặt lại framebuffer nếu nó bị kéo nhỏ hơn cỡ cấu hình.

    Trả `{'from': 'WxH', 'to': 'WxH'}` khi có đặt lại, `{'from': ..., 'warning': ...}`
    khi đặt lại thất bại (không ném lỗi — ảnh chụp vẫn là ảnh thật), `None` khi không cần.
    """
    current = screen_size()
    if not current:
        return None
    target = desktop_target()
    if current[0] >= target[0] and current[1] >= target[1]:
        return None
    mode = '%dx%d' % target
    try:
        proc = subprocess.run(['xrandr', '--output', VNC_OUTPUT, '--mode', mode], env=DISPLAY_ENV,
                              capture_output=True, timeout=10)
    except (subprocess.SubprocessError, OSError) as exc:
        return {'from': '%dx%d' % current, 'warning': 'xrandr failed: %s' % exc}
    if proc.returncode:
        detail = (proc.stderr or proc.stdout).decode(errors='replace').strip()[:200]
        return {'from': '%dx%d' % current, 'warning': 'xrandr exit %d: %s' % (proc.returncode, detail)}
    return {'from': '%dx%d' % current, 'to': mode}

# Plan filename rules, identical to deploy/docker/plan_files.py:18-22 (the reader that enforces them).
PLAN_FILENAME = re.compile(r'^v([1-9][0-9]{0,9})-([a-z0-9]+(-[a-z0-9]+)*)\.md$')
PLAN_SLUG = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
PLAN_ROOM = '.plans'
PLAN_MAX_BYTES = 1048576


def path(value):
    resolved = (ROOT / value).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError('Path Traversal Denied: outside sandbox workspace')
    return resolved


# A8 (đợt 22): `file_read` từng gọi thẳng `read_text` nên một tệp nhị phân người dùng vừa tải
# lên (`.png`, `.pdf`) làm lượt chết `UnicodeDecodeError` — mô hình không đọc được gì và người
# dùng không biết vì sao. Đuôi dưới đây là danh sách nhị phân, cộng phép dò byte `\x00` trong
# 8 KiB đầu (bắt cả tệp không có đuôi quen thuộc).
BINARY_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.pdf',
                     '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.docx', '.xlsx', '.pptx',
                     '.whl', '.so', '.bin', '.exe', '.dll', '.mp4', '.mov', '.avi', '.mp3', '.wav',
                     '.woff', '.woff2', '.ttf', '.otf', '.sqlite', '.db')
BINARY_SNIFF_BYTES = 8192
BINARY_READ_CHARS = 30000


def read_file_payload(target):
    """Nội dung một tệp cho `file_read`: văn bản như cũ, nhị phân thì base64 (A8).

    Tệp nhị phân trả `encoding: 'base64'` để mô hình biết nó đang cầm một mẩu đã mã hoá chứ
    không phải văn bản, kèm `bytesRead`/`sizeBytes` để nó tự đối chiếu còn thiếu bao nhiêu.
    `truncated` nói SỰ THẬT của phép đọc (đủ hay thiếu byte), không phải "đây là tệp nhị phân":
    một tệp 1 KiB nằm trọn trong `content` mà bị gắn `truncated: True` sẽ khiến mô hình kết luận
    sai là nó chưa thấy hết tệp.

    Nhánh văn bản giữ nguyên hành vi cũ (30 000 ký tự đầu); chỉ thêm một đường lui: tệp có đuôi
    văn bản nhưng không giải mã được UTF-8 (ảnh chụp lưu sai tên, tệp nén đổi đuôi) đi tiếp
    bằng đường base64 thay vì làm lượt chết `UnicodeDecodeError`.
    """
    binary = target.suffix.lower() in BINARY_EXTENSIONS
    if not binary:
        with open(target, 'rb') as handle:
            binary = b'\x00' in handle.read(BINARY_SNIFF_BYTES)
    if not binary:
        try:
            return {'content': target.read_text(encoding='utf-8')[:BINARY_READ_CHARS]}
        except UnicodeDecodeError:
            # Tệp đuôi chữ nhưng không giải mã được UTF-8 (ảnh lưu sai tên, tệp nén đổi đuôi): rơi
            # xuống đường base64 ngay dưới đây thay vì làm lượt chết `UnicodeDecodeError`.
            pass
    # 30 000 ký tự base64 ≈ 22 500 byte thật; đọc đúng ngần ấy rồi mã hoá.
    size = target.stat().st_size
    with open(target, 'rb') as handle:
        raw = handle.read(BINARY_READ_CHARS * 3 // 4)
    return {'content': base64.b64encode(raw).decode('ascii')[:BINARY_READ_CHARS],
            'encoding': 'base64', 'truncated': len(raw) < size, 'bytesRead': len(raw),
            'sizeBytes': size}


def process_marker(session):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', session):
        raise ValueError('Invalid session identifier')
    return Path('/tmp/boxfox-exec-' + session + '.json')


def shell(command, timeout=30, session='default'):
    proc = subprocess.Popen(['bash', '-lc', command], cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, start_new_session=True)
    marker = process_marker(session)
    marker.write_text(json.dumps({'pid': proc.pid, 'start': Path(f'/proc/{proc.pid}/stat').read_text().split()[21]}))
    try:
        output, _ = proc.communicate(timeout=min(120, max(1, timeout)))
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        raise ValueError('Command timed out; process group stopped')
    finally:
        marker.unlink(missing_ok=True)
    output = output.decode('utf-8', errors='replace')
    artifact = None
    if len(output) > 20000:
        file = path('.generated_artifacts/tools/' + uuid.uuid4().hex + '.txt')
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(output, encoding='utf-8')
        artifact = str(file.relative_to(ROOT))
    return {'content': output[:15000] + ('\n[truncated; see artifact]' if artifact else ''),
            'exit_code': proc.returncode, 'is_error': proc.returncode != 0, 'artifact': artifact}


def _pointer_move(x: int, y: int) -> None:
    """Đưa con trỏ tới (x, y) rồi CHỜ nó tới nơi — không dùng `mousemove --sync`.

    F8 (đợt 9): `xdotool mousemove --sync` treo đúng 15 giây khi con trỏ ĐÃ ở toạ độ
    đích (đo trong box: 15.16 s và 15.15 s, trong khi điểm mới mất 0.0 s), mà lệnh bị
    cắt ở `timeout=15` nên lần bấm thứ hai vào cùng một chỗ báo lỗi hết giờ. Đó chính
    là thứ làm lượt CUA nặng đốt 20/20 bước ở đợt 7. Ở đây di chuyển trước, rồi tự
    kiểm tra vị trí bằng `getmouselocation` — vẫn đảm bảo bấm đúng chỗ, không treo.
    """
    subprocess.run(['xdotool', 'mousemove', str(x), str(y)], env={**os.environ, 'DISPLAY': ':99'},
                   capture_output=True, timeout=10)
    for _ in range(20):
        probe = subprocess.run(['xdotool', 'getmouselocation', '--shell'],
                               env={**os.environ, 'DISPLAY': ':99'}, capture_output=True, timeout=10)
        out = probe.stdout.decode(errors='replace') if isinstance(probe.stdout, bytes) else str(probe.stdout or '')
        # So khớp theo DÒNG `X=<số>`; tìm chuỗi con thì `X=64` khớp luôn `X=640` và lần
        # kiểm tra đầu tiên sẽ đạt nhầm (vòng soát mã đợt 10 bắt được ở dòng này).
        seen = {}
        for line in out.splitlines():
            key, _, value = line.partition('=')
            if key in {'X', 'Y'}:
                seen[key] = value.strip()
        if seen.get('X') == str(x) and seen.get('Y') == str(y):
            return
        time.sleep(0.05)


def _pointer_click(args, *click_args) -> list:
    """Lệnh bấm chuột tại (x, y): di chuyển (không `--sync`) rồi bấm."""
    _pointer_move(int(args['x']), int(args['y']))
    return ['xdotool', 'click', *click_args]


def browser(args, session):
    from playwright.sync_api import sync_playwright
    action = args.get('action', 'snapshot')
    try:
        with socket.create_connection(('127.0.0.1', 9222), timeout=1):
            pass
    except OSError:
        if action != 'navigate':
            raise ValueError('Sandbox browser is not running; navigate first')
        subprocess.Popen(['box-chromium', 'about:blank'], env={**os.environ, 'DISPLAY': ':99'},
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(40):
            try:
                with socket.create_connection(('127.0.0.1', 9222), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise ValueError('Sandbox Chromium failed to start CDP')
    with sync_playwright() as pw:
        client = pw.chromium.connect_over_cdp('http://127.0.0.1:9222', timeout=15000)
        context = client.contexts[0]
        marker = 'boxfox-harness-' + session
        page = next((p for p in context.pages if p.evaluate('window.name') == marker), None)
        if page is None:
            if action != 'navigate':
                raise ValueError('No browser page for this session. Navigate first.')
            page = context.new_page()
            page.evaluate('(v) => window.name = v', marker)
        page.set_default_timeout(10000)
        if action == 'navigate':
            url = args['url']
            if not url.startswith(('http://', 'https://')):
                raise ValueError('Only http/https browser URLs are allowed')
            page.goto(url, wait_until='domcontentloaded', timeout=25000)
            page.evaluate('(v) => window.name = v', marker)
        elif action in {'click', 'fill'}:
            ref = args.get('ref', '')
            if not re.fullmatch(r'[a-f0-9]{8}-\d+', ref):
                raise ValueError('Use a ref from the latest snapshot')
            locator = page.locator('[data-boxfox-ref="' + ref + '"]')
            if locator.count() != 1:
                raise ValueError('Stale browser ref; take a new snapshot')
            if action == 'click':
                locator.click()
            else:
                locator.fill(args.get('text', ''))
        elif action == 'key':
            page.keyboard.press(args['key'])
        elif action == 'screenshot':
            output = path('.generated_artifacts/browser/' + uuid.uuid4().hex + '.png')
            output.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output))
            return {'content': 'Browser screenshot captured', 'artifact': str(output.relative_to(ROOT)),
                    'image': base64.b64encode(output.read_bytes()).decode(), 'mime': 'image/png'}
        elif action != 'snapshot':
            raise ValueError('Unknown browser action')
        nonce = uuid.uuid4().hex[:8]
        elements = page.locator('a,button,input,textarea,select,[role="button"]').evaluate_all('''(nodes, nonce) => nodes.slice(0,100).map((e,i) => {
            const ref = nonce + '-' + i; e.setAttribute('data-boxfox-ref',ref);
            return {ref,tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,180)};
        })''', nonce)
        return {'url': page.url, 'title': page.title(), 'content': page.locator('body').inner_text()[:12000], 'elements': elements}


# P1.4 (đợt 23) — BẰNG CHỨNG TẠI GỐC: mỗi lần ghi tệp để lại một mảnh kiểm chứng được, sinh
# ngay tại chỗ ghi (diff + sha256 trước/sau + số dòng) chứ không suy lại từ sau. Chỗ rẻ nhất và
# thật nhất để sinh bằng chứng là CHÍNH công cụ đã sửa tệp — worker được harness gửi nội tuyến vào
# box ở mỗi lần gọi, nên sửa ở đây không cần dựng lại image. Mảnh bằng chứng nằm trong gốc captures
# nên `retention()` của box quét và dọn nó như mọi ảnh chụp khác.
EVIDENCE_ROOT = '.generated_artifacts/captures/evidence'
# Trần an toàn: tệp cũ dài hơn mức này thì KHÔNG diff — diff một tệp lớn vừa tốn RAM trong box vừa
# làm ngữ cảnh của model phình ra mà không ai đọc. Nội dung cũ vẫn được hash nên mảnh còn giá trị.
EVIDENCE_MAX_BYTES = 256 * 1024
# Trần `diff` trả về harness: bằng chứng phải ĐỌC ĐƯỢC, không phải để chở cả tệp.
EVIDENCE_DIFF_MAX_CHARS = 8000
EVIDENCE_SLUG_MAX_CHARS = 60
# Khuôn BOX-3 (`deploy/docker/capture.py:180`) giữ chữ thường và chỉ bốn nhóm ký tự này.
EVIDENCE_SLUG_CHARS = re.compile(r'[^a-z0-9._-]')


def sha256_of(raw):
    """sha256 hex của một khối byte — cùng đơn vị với `sha256sum` trong box."""
    return hashlib.sha256(raw).hexdigest()


def file_digest(target):
    """sha256 của tệp trên đĩa đọc theo khối: tệp lớn không bị nạp hết vào RAM."""
    digest = hashlib.sha256()
    with open(target, 'rb') as handle:
        for chunk in iter(lambda: handle.read(65536), b''):
            digest.update(chunk)
    return digest.hexdigest()


def before_write(target):
    """Trạng thái CŨ của tệp ngay trước khi ghi: `(sha256, nội dung văn bản, lý do bỏ diff)`.

    `(None, None, None)` = tệp chưa tồn tại; mảnh bằng chứng nói thật `sha256Before: None`.
    Tệp quá trần ⇒ `(sha256, None, 'too_large')`. Tệp không giải mã được UTF-8 (ảnh, tệp nén)
    ⇒ `(sha256, None, 'binary')`: vẫn nói thật là tệp ĐÃ có và nội dung cũ hash ra sao, nhưng
    không bịa một diff từ dữ liệu không phải văn bản — và không bao giờ làm hỏng việc ghi.
    """
    if not target.is_file():
        return None, None, None
    if target.stat().st_size > EVIDENCE_MAX_BYTES:
        return file_digest(target), None, 'too_large'
    raw = target.read_bytes()
    try:
        return sha256_of(raw), raw.decode('utf-8'), None
    except UnicodeDecodeError:
        return sha256_of(raw), None, 'binary'


def step_number(value):
    """Số bước harness gửi kèm payload; không gửi (hoặc gửi giá trị lạ) thì `0`."""
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def evidence_step(value):
    """Bước thành token ba chữ số (`002`) — cùng khuôn `_step_token` của ảnh chụp trong box."""
    return f'{step_number(value):03d}'


def evidence_slug(target):
    """Tên tệp thành `slug` của khuôn BOX-3: chỉ `[a-z0-9._-]`, tối đa 60 ký tự.

    Bỏ dấu `.`/`-` ở ĐẦU: `<slug>` đứng ngay sau `_`, để nguyên dấu chấm thì tệp bằng chứng
    của một tệp ẩn (`.env`) cũng thành tệp ẩn — người mở thư mục bằng `ls` sẽ không thấy nó.
    """
    slug = EVIDENCE_SLUG_CHARS.sub('-', target.name.lower())[:EVIDENCE_SLUG_MAX_CHARS].lstrip('.-')
    return slug or 'file'


def session_key(session):
    """`<sid8>` = 8 ký tự đầu của session id; `''` khi không có định danh để đặt tên tệp."""
    return re.sub(r'[^0-9a-z]', '', str(session or '').strip().lower())[:8]


def evidence_entry(target, content, before, capture):
    """Mảnh bằng chứng của MỘT lần ghi: `(payload, diff)`.

    `payload` là khối `key: value` ghi vào tệp bằng chứng — thứ tự khoá là thứ tự ĐỌC: đường dẫn,
    hai hash, số dòng thêm/bớt, số dòng và số byte SAU khi ghi, rồi định danh lượt. `diff` rỗng
    khi không có gì để so (tệp cũ bằng tệp mới, hoặc `before_write` đã nói lý do bỏ diff).
    """
    relative = target.relative_to(ROOT).as_posix()
    sha_before, text_before, skipped = before
    encoded = content.encode('utf-8')
    payload = {
        'path': relative,
        'sha256Before': sha_before,
        'sha256After': sha256_of(encoded),
        'added': 0,
        'removed': 0,
        'lines': len(content.splitlines()),
        'bytes': len(encoded),
        'session': str(capture.get('session') or ''),
        'step': step_number(capture.get('step')),
        'tool': str(capture.get('tool') or ''),
        'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    diff = ''
    if skipped is not None:
        payload['diffSkipped'] = skipped
    else:
        old_lines = [] if text_before is None else text_before.splitlines()
        lines = list(difflib.unified_diff(old_lines, content.splitlines(), fromfile='a/' + relative,
                                          tofile='b/' + relative, lineterm=''))
        # Bỏ ĐÚNG hai dòng đầu `---`/`+++` khi đếm: một dòng nội dung cũng có thể bắt đầu bằng
        # `+`/`-` (`+++x` là một dòng THÊM), nên lọc theo tiền tố sẽ đếm sai.
        body = lines[2:] if len(lines) >= 2 and lines[0].startswith('---') and lines[1].startswith('+++') else lines
        payload['added'] = sum(1 for line in body if line.startswith('+'))
        payload['removed'] = sum(1 for line in body if line.startswith('-'))
        diff = '\n'.join(lines)
    if len(diff) > EVIDENCE_DIFF_MAX_CHARS:
        diff = diff[:EVIDENCE_DIFF_MAX_CHARS]
        payload['diffTruncated'] = True
    return payload, diff


def evidence_document(payload, diff):
    """Nội dung tệp bằng chứng: diff (nếu có) rồi tới khối `key: value` của lần ghi đó."""
    block = '\n'.join(f'{key}: {value}' for key, value in payload.items())
    return (diff + '\n\n' + block + '\n') if diff else (block + '\n')


def write_evidence(target, payload, diff, capture):
    """Ghi tệp bằng chứng theo khuôn BOX-3 và trả đường dẫn TƯƠNG ĐỐI của nó.

    `.generated_artifacts/captures/evidence/<sid8>/<sid8>_<step>_<slug>.<ext>`, `<ext>` là `diff`
    khi có diff, ngược lại `txt`. Không có `session` ⇒ trả `None`: lượt gọi ngoài phiên vẫn nhận
    `diff`/`numbers` nhưng KHÔNG được đổ rác vào workspace (P1.4 mục 5). Tệp đã tồn tại thì thêm
    hậu tố đếm — bằng chứng cũ đã phát tán trong event stream nên không bao giờ bị ghi đè.
    """
    sid8 = session_key(capture.get('session'))
    if not sid8:
        return None
    directory = path(EVIDENCE_ROOT + '/' + sid8)
    directory.mkdir(parents=True, exist_ok=True)
    extension = 'diff' if diff else 'txt'
    stem = f'{sid8}_{evidence_step(capture.get("step"))}_{evidence_slug(target)}'
    candidate = directory / f'{stem}.{extension}'
    index = 2
    while candidate.exists() and index < 1000:
        candidate = directory / f'{stem}-{index}.{extension}'
        index += 1
    if candidate.exists():
        candidate = directory / f'{stem}-{time.time_ns()}.{extension}'
    candidate.write_text(evidence_document(payload, diff), encoding='utf-8')
    return candidate.relative_to(ROOT).as_posix()


def write_text(target, content, exclusive=False, capture=None):
    """Ghi tệp; khi chỗ gọi yêu cầu thì dựng LUÔN mảnh bằng chứng của lần ghi đó (P1.4).

    Đọc nội dung CŨ trước khi ghi (không đoán lại sau khi tệp đã đổi), rồi tính `sha256` trước/
    sau, `difflib.unified_diff` (nhãn `a/<rel>` → `b/<rel>`) và số dòng. Trả `(target, evidence)`:
    `evidence` là `None` khi không ai yêu cầu, ngược lại là khối `{'diff', 'numbers', 'artifact'}`
    mà op ghi trả thẳng cho harness.

    `capture` do `execute()` dựng từ payload của HARNESS (`session`/`step`/`tool`) — không bao giờ
    lấy từ `args` của model, vì `args` là văn của model.
    """
    before = before_write(target) if capture is not None else None
    target.parent.mkdir(parents=True, exist_ok=True)
    if exclusive:
        with open(target, 'x', encoding='utf-8') as handle:
            handle.write(content)
    else:
        target.write_text(content, encoding='utf-8')
    if capture is None:
        return target, None
    payload, diff = evidence_entry(target, content, before, capture)
    return target, {'diff': diff, 'artifact': write_evidence(target, payload, diff, capture),
                    'numbers': {key: value for key, value in payload.items() if key != 'path'}}


def plan_directory(args):
    """Thư mục nhóm bên trong `.plans` (`''` = gốc) — mỗi đoạn phải đúng quy tắc slug.

    Harness chọn thư mục (nó sở hữu identity `dir/slug`), sandbox chỉ ghi đúng chỗ.
    """
    value = args.get('directory')
    if value in (None, ''):
        return ''
    if not isinstance(value, str):
        raise ValueError('PLAN_SLUG_INVALID: directory must be a string of slug segments, e.g. designs')
    segments = value.strip().strip('/').split('/')
    if not all(PLAN_SLUG.fullmatch(segment) for segment in segments):
        raise ValueError('PLAN_SLUG_INVALID: directory must be lowercase words separated by single dashes, e.g. designs')
    return '/'.join(segments)


def plan_version(value):
    """Số phiên bản do harness quyết; `None` nghĩa là "harness không đọc được chỉ mục"."""
    if value is None or value == '':
        return None
    if isinstance(value, bool):
        raise ValueError('PLAN_INVALID: version must be a positive integer decided by the harness, e.g. 3')
    if not re.fullmatch(r'[1-9][0-9]{0,9}', str(value).strip()):
        raise ValueError('PLAN_INVALID: version must be a positive integer decided by the harness, e.g. 3')
    return int(str(value).strip())


def write_plan(args):
    """Write .plans[/dir]/vN-slug.md.

    `version` (tuỳ chọn) là số harness đã quyết từ chỉ mục `GET /__box/plans/index`:
    file đã tồn tại → từ chối bằng `PLAN_VERSION_TAKEN` (KHÔNG tự tăng số — tự tăng là
    mầm của lỗi "v5 rồi v6 cho hai chủ đề mới" ở vòng 20). Không truyền `version`
    (harness không đọc được chỉ mục) thì giữ nguyên hành vi cũ: lấy số trống kế tiếp.
    """
    slug = str(args.get('slug') or '').strip()
    if not PLAN_SLUG.fullmatch(slug):
        raise ValueError('Plan slug must be lowercase words separated by single dashes (e.g. workspace-plan)')
    content = args.get('markdown')
    if not isinstance(content, str) or not content.strip():
        raise ValueError('Plan markdown must not be empty')
    size = len(content.encode('utf-8'))
    if size > PLAN_MAX_BYTES:
        raise ValueError('Plan exceeds the 1 MiB plan-file limit')
    directory = plan_directory(args)
    room = path(PLAN_ROOM + '/' + directory if directory else PLAN_ROOM)
    room.mkdir(parents=True, exist_ok=True)
    if not room.is_dir():
        raise ValueError(PLAN_ROOM + ' is not a directory')
    # Chỉ đếm file CÙNG slug trong CÙNG thư mục: số version là của nhóm, không của cả `.plans`.
    used = {int(match.group(1)) for match in (PLAN_FILENAME.fullmatch(item.name) for item in room.iterdir())
            if match and match.group(2) == slug and (room / match.group(0)).is_file()}
    version = plan_version(args.get('version'))
    if version is None:
        version = max(used or {0}) + 1
    elif version in used:
        raise ValueError('PLAN_VERSION_TAKEN: v%d-%s.md already exists; the harness must pick the next version'
                         % (version, slug))
    target = room / f'v{version}-{slug}.md'
    try:
        write_text(target, content, exclusive=True)
    except FileExistsError:
        # Đua ghi hiếm gặp: harness đọc lại chỉ mục rồi thử lần hai (PLAN_WRITE_CONFLICT nếu vẫn kẹt).
        raise ValueError('PLAN_VERSION_TAKEN: v%d-%s.md already exists; the harness must pick the next version'
                         % (version, slug))
    relative = target.relative_to(ROOT).as_posix()
    # KHÔNG trả `identity` ở đây: hợp đồng §1 cấm dạng kèm tiền tố `vN-` (identity là
    # khoá mà `GET /__box/plans` dùng để nhóm, tức slug trần / `dir/slug`). Bên gọi
    # tự suy ra từ `relativePath` đã được xác nhận.
    return {'content': 'Written ' + relative, 'version': version,
            'slug': slug, 'relativePath': relative, 'title': str(args.get('title') or '')[:120],
            'bytes': size}


try:  # pragma: no cover - đường dẫn chỉ tồn tại khi worker chạy TRONG box
    sys.path.insert(0, '/usr/local/bin')
    import session_ops as _session_ops
except ImportError:  # box chưa re-stage hai tệp nhật ký: xem `SESSION_OPS_UNAVAILABLE` bên dưới
    _session_ops = None

SESSION_OP_NAMES = ('session_ensure', 'journal_append', 'checkpoint_write', 'captures_prune',
                    'uploads_prune')
# Gán mặc định TRƯỚC nhánh có điều kiện: `importlib.reload` chạy lại thân mô-đun trong chính
# namespace cũ, nên một biến chỉ được gán trong nhánh `if` sẽ giữ giá trị cũ khi nhánh đó không chạy.
SESSION_OPS = ()

if _session_ops is not None:
    SESSION_OPS = tuple(_session_ops.OPS)


def execute(name, args, session, turn=None, step=None, tool_call_id=None):
    """Cửa vào DUY NHẤT của worker: một op, một payload JSON vào, một kết quả JSON ra.

    `turn`/`step`/`tool_call_id` do **harness** đặt trong payload (P1.4) — KHÔNG bao giờ
    lấy từ `args` của model. `step` đi vào mảnh bằng chứng của op ghi tệp (số bước trong
    `numbers` và trong tên tệp); `turn`/`tool_call_id` đi cùng payload để worker và hai
    route capture/ghi hình dùng chung một hợp đồng định danh (`deploy/docker/ide-proxy.py`).
    """
    capture = {'session': session, 'step': step, 'tool': name}
    if name == '__skill_readiness':
        package = Path(args['basePath']).resolve()
        base = Path('/opt/boxfox-skills').resolve()
        if not package.is_relative_to(base):
            raise ValueError('Invalid skill package')
        requirements = args.get('requirements', {})
        def names(items):
            return [v if isinstance(v, str) else v.get('name', '') for v in items if isinstance(v, (str, dict)) and not (isinstance(v, dict) and v.get('optional'))]
        commands = names(requirements.get('commands', []))
        environment = names(requirements.get('environment', []))
        files = names(requirements.get('files', []))
        missing = {'commands': [n for n in commands if not shutil.which(n)],
                   'environment': [n for n in environment if not os.environ.get(n)],
                   'files': [n for n in files if not Path(os.path.expandvars(n)).expanduser().is_file()]}
        supported = not args.get('platforms') or 'linux' in args['platforms']
        return {'status': 'ready' if package.is_dir() and supported and not any(missing.values()) else 'setup_required',
                'packageMounted': package.is_dir(), 'platformSupported': supported, 'missing': missing}
    if name == '__cancel':
        marker = process_marker(session)
        if marker.exists():
            entry = json.loads(marker.read_text())
            stat = Path('/proc/' + str(entry['pid']) + '/stat')
            if stat.exists() and stat.read_text().split()[21] == entry['start']:
                os.killpg(entry['pid'], signal.SIGKILL)
            marker.unlink(missing_ok=True)
        return {'content': 'Session subprocess cleanup complete'}
    if name == 'file_read':
        return read_file_payload(path(args['path']))
    if name == 'file_write':
        target = path(args['path'])
        target, evidence = write_text(target, args['content'], capture=capture)
        return {'content': 'Written ' + target.relative_to(ROOT).as_posix(), **evidence}
    if name == 'write_plan':
        return write_plan(args)
    if name == 'file_edit_block':
        target = path(args['path'])
        content = target.read_text(encoding='utf-8')
        if not args['old_text'] or content.count(args['old_text']) != 1:
            raise ValueError('old_text must match exactly once; read file first')
        target, evidence = write_text(target, content.replace(args['old_text'], args['new_text'], 1),
                                      capture=capture)
        return {'content': 'Updated ' + target.relative_to(ROOT).as_posix(), **evidence}
    if name == 'codebase_glob':
        pattern = args.get('pattern', '**/*')
        path(pattern)
        found = []
        for item in ROOT.glob(pattern):
            if item.is_file() and item.resolve().is_relative_to(ROOT):
                found.append(item.relative_to(ROOT).as_posix())
            if len(found) >= 500:
                break
        return {'content': '\n'.join(found)}
    if name == 'codebase_grep':
        needle = args['query']
        results = []
        for item in path(args.get('path', '.')).rglob('*'):
            if not item.is_file() or not item.resolve().is_relative_to(ROOT) or item.stat().st_size > 1000000:
                continue
            try:
                for n, line in enumerate(item.read_text(encoding='utf-8').splitlines(), 1):
                    if needle in line:
                        results.append(f'{item.relative_to(ROOT)}:{n}:{line[:300]}')
                    if len(results) >= 100:
                        return {'content': '\n'.join(results)}
            except (UnicodeError, PermissionError):
                continue
        return {'content': '\n'.join(results)}
    if name == 'terminal_exec':
        return shell(args['command'], args.get('timeout', 30), session)
    if name == 'browser_use':
        return browser(args, session)
    if name == 'computer_use':
        action = args['action']
        commands = {
            'click': lambda: _pointer_click(args, '1'),
            'double_click': lambda: _pointer_click(args, '--repeat', '2', '--delay', '100', '1'),
            'right_click': lambda: _pointer_click(args, '3'),
            'middle_click': lambda: _pointer_click(args, '2'),
            'type': lambda: ['xdotool', 'type', '--clearmodifiers', '--', args['text']],
            'key': lambda: ['xdotool', 'key', '--clearmodifiers', args['key']],
            'scroll': lambda: ['xdotool', 'click', '--repeat', str(min(20, max(1, int(args.get('steps', 3))))), '5' if args.get('direction') == 'down' else '4'],
        }
        if action not in commands:
            raise ValueError('Unknown computer action')
        # F6: các thao tác theo toạ độ phải chạy trên framebuffer đúng cỡ cấu hình.
        desktop_note = ensure_desktop_size() if action != 'type' and action != 'key' else None
        # F4 (đợt 7): bàn phím chỉ tới cửa sổ ĐANG được focus. Không có cửa sổ nào thì
        # `xdotool` vẫn thoát 0, nên phải nói rõ là chưa gửi được thay vì báo đã gửi.
        if action in {'type', 'key'}:
            focused = subprocess.run(['xdotool', 'getactivewindow'], env={**os.environ, 'DISPLAY': ':99'},
                                     capture_output=True, timeout=15)
            if focused.returncode:
                raise ValueError('No focused window: click the target window first, then send keys.')
        proc = subprocess.run(commands[action](), env={**os.environ, 'DISPLAY': ':99'}, capture_output=True, timeout=15)
        if proc.returncode:
            raise ValueError(proc.stderr.decode(errors='replace'))
        # F3 (đợt 7): `xdotool key NotARealKey` in 'No such key name ... Ignoring it.' ra
        # stdout rồi thoát 0. Coi cảnh báo đó là thất bại, kèm tên phím sai.
        noisy = (proc.stdout + proc.stderr).decode(errors='replace')
        if 'No such key name' in noisy or 'Ignoring it' in noisy:
            raise ValueError('Unsupported key name: ' + str(args.get('key', '')) + '. Use an X keysym such as Return, Tab, ctrl+c.')
        payload = {'content': 'Input delivered; capture the screen to verify the effect.'}
        if desktop_note:
            payload['desktopRestored' if 'to' in desktop_note else 'desktopWarning'] = desktop_note
        return payload
    if name in SESSION_OP_NAMES:
        # A1 — bốn op phiên/nhật ký (`session_ensure`, `journal_append`, `checkpoint_write`,
        # `captures_prune`) do `session_ops.py` trong box phục vụ. Tệp đó phải được staged vào
        # `/usr/local/bin` (cùng chỗ `capture.py`); chưa staged thì op trả một lỗi **có mã** để
        # chỗ gọi hạ xuống `notice` — nhật ký không ghi được không bao giờ được giết một lượt.
        if _session_ops is None:
            return {'is_error': True,
                    'error': 'SESSION_OPS_UNAVAILABLE: session_files.py/session_ops.py chưa được '
                             'staged vào /usr/local/bin trong box (xem deploy/docker/backfill_history.py --stage)'}
        answer = _session_ops.run_op(name, args)
        if isinstance(answer, dict) and answer.get('ok') is False and 'is_error' not in answer:
            # `run_op` không bao giờ ném (thiết kế của nó) — nhưng worker phải trả về đúng khuôn
            # lỗi mà `execute()` của harness đã hiểu, nếu không lỗi ghi nhật ký sẽ thành công.
            return {'is_error': True, 'error': f"{answer.get('code') or 'SESSION_FILES_ERROR'}: "
                                               f"{answer.get('error') or 'op nhật ký hỏng'}"}
        return answer
    raise ValueError('Unsupported sandbox tool: ' + name)


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(execute(request['name'], request['args'], request['session'],
                                 turn=request.get('turn'), step=request.get('step'),
                                 tool_call_id=request.get('toolCallId')), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'is_error': True, 'error': str(exc)}))
