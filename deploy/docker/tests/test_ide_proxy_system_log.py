"""Không có đường nào từ box tới API nhật ký hệ thống (plan §3.2).

Nhật ký hệ thống nằm trên HOST (`~/BoxFox/logs`), harness phục vụ nó ở
`GET /api/agent/system-log`. Agent trong box **không được** đọc nhật ký của chính nó —
đó là khác biệt cốt lõi so với bảng Terminal.

Theo đúng idiom của `test_ide_proxy_workspace.py` (spin `ThreadingHTTPServer` trên
port 0, chèn `WORKSPACE_ROOT` tạm), bốn điều được chứng minh:

1. mọi đường dẫn hình dạng nhật ký trong `/__box/*` trả 404 — router của box chỉ có
   một danh sách route hữu hạn và không route nào chở nội dung log;
2. đường dẫn KHÔNG thuộc `/__box/` chỉ được forward tới upstream trong box
   (code-server), nên `/api/agent/system-log` gửi từ trong box tới đúng upstream của
   box, không tới harness;
3. API file của box từ chối đường dẫn tuyệt đối và `..`, nên không trỏ được vào
   `~/BoxFox/logs` của host;
4. cấu hình đóng phần còn lại: compose không publish cổng harness, harness chỉ bind
   `127.0.0.1`, và mã nguồn box không hề nhắc tới tệp/thư mục log hay cổng harness.
"""

from __future__ import annotations

import atexit
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]
REPO_ROOT = DOCKER_DIRECTORY.parents[1]
sys.path.insert(0, str(DOCKER_DIRECTORY))

# Đặt AGENT_WORKSPACE trước khi import ide_proxy (ide_proxy import workspace_files,
# vốn đọc env lúc import).
_BOOT_DIR = tempfile.mkdtemp(prefix="system-log-boot-")
os.environ["AGENT_WORKSPACE"] = _BOOT_DIR
atexit.register(shutil.rmtree, _BOOT_DIR, ignore_errors=True)

SPEC = importlib.util.spec_from_file_location("ide_proxy", DOCKER_DIRECTORY / "ide-proxy.py")
assert SPEC and SPEC.loader
ide_proxy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ide_proxy)

ORIGIN_OK = "http://localhost:3100"
SECRET_OK = "box-secret-123"
HARNESS_ROUTE = "/api/agent/system-log"

# Đường dẫn mà một process trong box có thể thử để với tới nhật ký.
LOG_SHAPED_PATHS = (
    "/__box/system-log",
    "/__box/system-log?lines=10&level=error",
    "/__box/system-log/raw",
    "/__box/logs",
    "/__box/log",
    "/__box/harness.jsonl",
    "/__box/BoxFox/logs/harness.jsonl",
    HARNESS_ROUTE,
    f"{HARNESS_ROUTE}?lines=10",
)

# Dấu vết nội dung nhật ký: thấy bất kỳ cái nào trong response nghĩa là có đường rò.
LOG_MARKERS = ("system-log", "harness.jsonl", "router.jsonl", "runId", "turn.failed", "BoxFox/logs")

UPSTREAM_SEEN: list[str] = []


class _StubUpstream(http.server.BaseHTTPRequestHandler):
    """Upstream giả của box (thay code-server) — ghi lại đường dẫn nó nhận được."""

    def do_GET(self) -> None:
        UPSTREAM_SEEN.append(self.path)
        payload = json.dumps({"stub": "box-upstream", "path": self.path}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args) -> None:
        pass


class IdeProxySystemLogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "hello.txt").write_text("hello world\n", encoding="utf-8")
        # Tệp "nhật ký" giả nằm NGOÀI workspace, đúng như trên host.
        self.host_logs = Path(self.temporary_directory.name) / "host-logs"
        self.host_logs.mkdir()
        (self.host_logs / "harness.jsonl").write_text('{"event": "turn.failed"}\n', encoding="utf-8")

        self._previous_root = ide_proxy.workspace_files.WORKSPACE_ROOT
        ide_proxy.workspace_files.WORKSPACE_ROOT = self.root
        self._previous_key = ide_proxy.BOXFOX_API_KEY
        ide_proxy.BOXFOX_API_KEY = SECRET_OK

        # Upstream của box = một server giả trong tiến trình test này.
        UPSTREAM_SEEN.clear()
        self.upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _StubUpstream)
        self.upstream_thread = threading.Thread(target=self.upstream.serve_forever, daemon=True)
        self.upstream_thread.start()
        self._previous_upstream = (ide_proxy.UPSTREAM_HOST, ide_proxy.UPSTREAM_PORT)
        ide_proxy.UPSTREAM_HOST, ide_proxy.UPSTREAM_PORT = "127.0.0.1", self.upstream.server_port

        self.server = ide_proxy.ThreadingHTTPServer(("127.0.0.1", 0), ide_proxy.ProxyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.upstream_thread.join()
        ide_proxy.UPSTREAM_HOST, ide_proxy.UPSTREAM_PORT = self._previous_upstream
        ide_proxy.workspace_files.WORKSPACE_ROOT = self._previous_root
        ide_proxy.BOXFOX_API_KEY = self._previous_key
        self.temporary_directory.cleanup()

    def _request(self, path: str, *, headers: dict | None = None):
        request = urllib.request.Request(f"{self.base_url}{path}", headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    # --- 1. Router của box không có route nào chở nội dung log ---
    def test_log_shaped_box_paths_are_not_routed(self) -> None:
        for path in LOG_SHAPED_PATHS:
            with self.subTest(path=path):
                for headers in ({"Origin": ORIGIN_OK},
                                {"Origin": ORIGIN_OK, "X-BoxFox-Api-Key": SECRET_OK},
                                {"X-BoxFox-Api-Key": SECRET_OK}):
                    status, body = self._request(path, headers=headers)
                    text = body.decode("utf-8", "replace")
                    # Không bao giờ có nội dung nhật ký, ở bất kỳ biến thể header nào.
                    self.assertNotIn("turn.failed", text)
                    self.assertNotIn("runId", text)
                    self.assertNotIn("harness.jsonl", text)
                    if path.startswith("/__box/"):
                        # 404 (không có route) hoặc 403 (thiếu Origin hợp lệ) — không hơn.
                        self.assertIn(status, (403, 404), f"{path} → {status} với {headers}")
                    else:
                        # Ngoài `/__box/`: chỉ forward tới upstream của box (stub), 200.
                        self.assertEqual(status, 200, f"{path} → {status}")
                        self.assertEqual(json.loads(text)["stub"], "box-upstream")

    def test_a_log_shaped_box_path_is_404_with_a_valid_origin(self) -> None:
        """Có Origin hợp lệ — tức đã qua cổng — vẫn không có route: 404."""
        for path in ("/__box/system-log", "/__box/system-log?lines=10", "/__box/logs", "/__box/log"):
            with self.subTest(path=path):
                status, body = self._request(path, headers={"Origin": ORIGIN_OK})
                self.assertEqual(status, 404)
                self.assertEqual(body, b"", "404 phải rỗng, không kèm dữ liệu log")

    def test_the_box_router_has_no_system_log_branch(self) -> None:
        """Bảng route của box là hữu hạn: không nhánh nào nhắc tới nhật ký."""
        source = (DOCKER_DIRECTORY / "ide-proxy.py").read_text(encoding="utf-8")
        for marker in ("system-log", "system_log", "harness.jsonl", "BoxFox/logs", "3102"):
            self.assertNotIn(marker, source, f"ide-proxy.py không được nhắc tới {marker!r}")

    # --- 2. Đường ra duy nhất của box là upstream trong box ---
    def test_a_harness_route_from_inside_the_box_hits_the_box_upstream(self) -> None:
        status, body = self._request(HARNESS_ROUTE + "?lines=10")
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["stub"], "box-upstream")
        self.assertEqual(UPSTREAM_SEEN, [HARNESS_ROUTE + "?lines=10"])
        self.assertNotIn("entries", payload, "không được trả nội dung nhật ký")

    # --- 3. API file không trỏ được ra ngoài workspace ---
    def test_workspace_api_refuses_paths_outside_the_workspace(self) -> None:
        outside = str(self.host_logs / "harness.jsonl")
        for path in (outside, "../../BoxFox/logs/harness.jsonl", "/etc/passwd"):
            with self.subTest(path=path):
                status, body = self._request(
                    "/__box/file/content?path=" + urllib.parse.quote(path),
                    headers={"Origin": ORIGIN_OK},
                )
                self.assertEqual(status, 400, f"{path} trả {status}")
                self.assertNotIn("turn.failed", body.decode("utf-8", "replace"))

    # --- 4. Cấu hình đóng nốt phần còn lại ---
    def test_the_harness_is_unreachable_from_the_box(self) -> None:
        compose = (DOCKER_DIRECTORY / "docker-compose.yml").read_text(encoding="utf-8")
        published = [line.strip() for line in compose.splitlines() if "127.0.0.1:" in line]
        self.assertTrue(published, "phải tìm thấy danh sách cổng publish")
        for line in published:
            self.assertNotIn("3102", line, "cổng harness không được publish vào box")

        server_source = (REPO_ROOT / "backend" / "src" / "agentbox" / "api" / "server.py").read_text(encoding="utf-8")
        self.assertIn("host='127.0.0.1'", server_source, "harness chỉ được bind loopback của host")


if __name__ == "__main__":
    unittest.main()
