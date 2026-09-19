"""Kiểm thử HTTP cho endpoint workspace files của ide-proxy.

Mẫu theo ``test_ide_proxy_plans.py``/``test_ide_proxy_network.py``: spin
``ThreadingHTTPServer`` trên port 0, chèn ``WORKSPACE_ROOT`` tạm, gửi request.
Chứng minh: Origin-gate cho JSON read, secret-gate cho upload/unzip, Range → 206,
405 sai method, 416 Range sai, và không rò đường dẫn tuyệt đối ra response.
"""

from __future__ import annotations

import atexit
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOCKER_DIRECTORY))

# Đặt AGENT_WORKSPACE trước khi import ide_proxy (ide_proxy import workspace_files,
# vốn đọc env lúc import). Thư mục boot chỉ là mặc định an toàn; mỗi test patch riêng.
_BOOT_DIR = tempfile.mkdtemp(prefix="wf-http-boot-")
os.environ["AGENT_WORKSPACE"] = _BOOT_DIR
atexit.register(shutil.rmtree, _BOOT_DIR, ignore_errors=True)

SPEC = importlib.util.spec_from_file_location("ide_proxy", DOCKER_DIRECTORY / "ide-proxy.py")
assert SPEC and SPEC.loader
ide_proxy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ide_proxy)

ORIGIN_OK = "http://localhost:3100"
ORIGIN_BAD = "https://malicious.example"
SECRET_OK = "box-secret-123"


class IdeProxyWorkspaceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        # Seed file biết trước
        (self.root / "hello.txt").write_text("hello world\n", encoding="utf-8")
        (self.root / "media.bin").write_bytes(bytes(range(32)))  # 32 byte
        (self.root / "sub").mkdir()
        (self.root / "sub" / "nested.py").write_text("x = 1\n", encoding="utf-8")
        # Zip để test unzip (chứa out.txt)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("out.txt", "payload")
        (self.root / "pkg.zip").write_bytes(buf.getvalue())

        self._previous_root = ide_proxy.workspace_files.WORKSPACE_ROOT
        ide_proxy.workspace_files.WORKSPACE_ROOT = self.root
        self._previous_key = ide_proxy.BOXFOX_API_KEY
        ide_proxy.BOXFOX_API_KEY = SECRET_OK

        self.server = ide_proxy.ThreadingHTTPServer(("127.0.0.1", 0), ide_proxy.ProxyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        ide_proxy.workspace_files.WORKSPACE_ROOT = self._previous_root
        ide_proxy.BOXFOX_API_KEY = self._previous_key
        self.temporary_directory.cleanup()

    def _request(self, path: str, *, method: str = "GET", headers: dict | None = None,
                 data: bytes | None = None):
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method, headers=headers or {}
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    # --- Origin gate (JSON read) ---
    def test_files_list_requires_origin(self) -> None:
        status, _headers, _body = self._request("/__box/files?path=")
        self.assertEqual(status, 403)

    def test_files_list_foreign_origin_denied(self) -> None:
        status, _h, _b = self._request("/__box/files?path=", headers={"Origin": ORIGIN_BAD})
        self.assertEqual(status, 403)

    def test_files_list_ok_with_origin(self) -> None:
        status, headers, body = self._request(
            "/__box/files?path=", headers={"Origin": ORIGIN_OK}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "application/json")
        payload = json.loads(body.decode("utf-8"))
        names = [entry["name"] for entry in payload["entries"]]
        self.assertIn("hello.txt", names)
        self.assertIn("sub", names)
        self.assertNotIn(".generated_artifacts", names)
        # Không rò đường dẫn tuyệt đối
        self.assertNotIn(str(self.root), body.decode("utf-8"))
        # CORS phản chiếu
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), ORIGIN_OK)

    def test_file_content_ok_and_no_abs_path(self) -> None:
        status, _h, body = self._request(
            "/__box/file/content?path=hello.txt", headers={"Origin": ORIGIN_OK}
        )
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["content"], "hello world\n")
        self.assertFalse(payload["binary"])
        self.assertNotIn(str(self.root), body.decode("utf-8"))

    def test_file_content_missing_returns_404(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/content?path=nope.txt", headers={"Origin": ORIGIN_OK}
        )
        self.assertEqual(status, 404)

    # --- Media subresource: Range → 206 ---
    def test_media_open_ended_range_206(self) -> None:
        status, headers, body = self._request(
            "/__box/file/media?path=media.bin",
            headers={"Origin": ORIGIN_OK, "Range": "bytes=0-"},
        )
        self.assertEqual(status, 206)
        self.assertEqual(headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(headers.get("Content-Range"), "bytes 0-31/32")
        self.assertEqual(headers.get("Content-Length"), "32")
        self.assertEqual(body, bytes(range(32)))
        # subresource phản chiếu CORS khi Origin hợp lệ
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), ORIGIN_OK)

    def test_media_suffix_range_206(self) -> None:
        status, headers, body = self._request(
            "/__box/file/media?path=media.bin",
            headers={"Range": "bytes=-16"},
        )
        self.assertEqual(status, 206)
        self.assertEqual(headers.get("Content-Range"), "bytes 16-31/32")
        self.assertEqual(headers.get("Content-Length"), "16")
        self.assertEqual(body, bytes(range(16, 32)))

    def test_media_no_range_returns_200_full(self) -> None:
        status, headers, body = self._request("/__box/file/media?path=media.bin")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(int(headers.get("Content-Length")), 32)
        self.assertEqual(len(body), 32)

    def test_media_bad_range_returns_416(self) -> None:
        status, headers, _body = self._request(
            "/__box/file/media?path=media.bin",
            headers={"Range": "bytes=100-200"},
        )
        self.assertEqual(status, 416)
        self.assertEqual(headers.get("Content-Range"), "bytes */32")

    def test_download_attachment_header(self) -> None:
        status, headers, body = self._request(
            "/__box/file/download?path=hello.txt", headers={"Origin": ORIGIN_OK}
        )
        self.assertEqual(status, 200)
        self.assertIn('attachment; filename="hello.txt"', headers.get("Content-Disposition", ""))
        self.assertEqual(body, b"hello world\n")

    # --- secret gate (upload/unzip) ---
    def test_upload_without_secret_denied(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/upload?path=&name=u.bin",
            method="POST",
            data=b"x" * 10,
            headers={"Content-Type": "application/octet-stream"},
        )
        self.assertEqual(status, 403)

    def test_upload_wrong_secret_denied(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/upload?path=&name=u.bin",
            method="POST",
            data=b"x" * 10,
            headers={"Content-Type": "application/octet-stream", "X-BoxFox-Api-Key": "wrong"},
        )
        self.assertEqual(status, 403)

    def test_upload_with_secret_writes_file(self) -> None:
        status, _h, body = self._request(
            "/__box/file/upload?path=&name=uploaded.bin",
            method="POST",
            data=b"payload-bytes",
            headers={
                "Content-Type": "application/octet-stream",
                "X-BoxFox-Api-Key": SECRET_OK,
            },
        )
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload, {"path": "uploaded.bin", "sizeBytes": len(b"payload-bytes")})
        path = self.root / "uploaded.bin"
        self.assertTrue(path.exists())
        self.assertEqual(path.read_bytes(), b"payload-bytes")
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)
        if os.geteuid() == 0:
            self.assertEqual(path.stat().st_uid, ide_proxy.workspace_files.AGENT_UID)
            self.assertEqual(path.stat().st_gid, ide_proxy.workspace_files.AGENT_GID)

    def test_upload_origin_alone_not_enough(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/upload?path=&name=u.bin",
            method="POST",
            data=b"x" * 10,
            headers={"Content-Type": "application/octet-stream", "Origin": ORIGIN_OK},
        )
        self.assertEqual(status, 403)

    def test_unzip_without_secret_denied(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/unzip?path=pkg.zip", method="POST"
        )
        self.assertEqual(status, 403)

    def test_unzip_wrong_secret_denied(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/unzip?path=pkg.zip",
            method="POST",
            headers={"X-BoxFox-Api-Key": "wrong"},
        )
        self.assertEqual(status, 403)

    def test_unzip_with_secret_extracts(self) -> None:
        status, _h, body = self._request(
            "/__box/file/unzip?path=pkg.zip",
            method="POST",
            headers={"X-BoxFox-Api-Key": SECRET_OK},
        )
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(payload["extracted"], 1)
        self.assertEqual((self.root / "out.txt").read_text(), "payload")

    # --- zip build ---
    def test_files_zip_returns_zip_bytes(self) -> None:
        status, headers, body = self._request(
            "/__box/files/zip",
            method="POST",
            data=json.dumps({"paths": ["hello.txt"]}).encode("utf-8"),
            headers={"Origin": ORIGIN_OK, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "application/zip")
        self.assertIn('attachment; filename="boxfox-workspace.zip"', headers.get("Content-Disposition", ""))
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            self.assertIn("hello.txt", zf.namelist())
            self.assertEqual(zf.read("hello.txt"), b"hello world\n")

    def test_files_zip_foreign_origin_denied(self) -> None:
        status, _h, _b = self._request(
            "/__box/files/zip",
            method="POST",
            data=json.dumps({"paths": ["hello.txt"]}).encode("utf-8"),
            headers={"Origin": ORIGIN_BAD, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 403)

    # --- method checks ---
    def test_files_list_post_not_allowed(self) -> None:
        status, _h, _b = self._request(
            "/__box/files?path=", method="POST", headers={"Origin": ORIGIN_OK}
        )
        self.assertEqual(status, 405)

    def test_upload_get_not_allowed(self) -> None:
        status, _h, _b = self._request(
            "/__box/file/upload?path=&name=u.bin",
            method="GET",
            headers={"X-BoxFox-Api-Key": SECRET_OK},
        )
        self.assertEqual(status, 405)


class IdeProxyWorkspaceWriteTest(unittest.TestCase):
    """Đợt 3: POST /__box/files/{mkdir,touch,rename,move,delete} qua HTTP thật.

    Cùng idiom với ``IdeProxyWorkspaceTest``: spin ``ThreadingHTTPServer`` trên port 0,
    trỏ ``WORKSPACE_ROOT`` vào thư mục tạm, rồi kiểm cả payload hợp đồng §2 lẫn trạng
    thái thật trên đĩa. Nhóm này bắt buộc header ``X-BoxFox-Api-Key`` → 401 khi thiếu.
    """

    ENDPOINTS = (
        "/__box/files/mkdir",
        "/__box/files/touch",
        "/__box/files/rename",
        "/__box/files/move",
        "/__box/files/delete",
    )

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "src").mkdir()
        (self.root / "src" / "a.md").write_text("# a\n", encoding="utf-8")
        (self.root / "docs").mkdir()
        (self.root / ".plans").mkdir()

        self._previous_root = ide_proxy.workspace_files.WORKSPACE_ROOT
        ide_proxy.workspace_files.WORKSPACE_ROOT = self.root
        self._previous_key = ide_proxy.BOXFOX_API_KEY
        ide_proxy.BOXFOX_API_KEY = SECRET_OK

        self.server = ide_proxy.ThreadingHTTPServer(("127.0.0.1", 0), ide_proxy.ProxyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        ide_proxy.workspace_files.WORKSPACE_ROOT = self._previous_root
        ide_proxy.BOXFOX_API_KEY = self._previous_key
        self.temporary_directory.cleanup()

    def _request(self, path: str, *, method: str = "POST", headers: dict | None = None,
                 data: bytes | None = None):
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method, headers=headers or {}
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def write_call(self, endpoint: str, payload: dict, *, key: str | None = SECRET_OK,
                   method: str = "POST"):
        headers = {"Content-Type": "application/json"}
        if key is not None:
            headers["X-BoxFox-Api-Key"] = key
        return self._request(
            endpoint, method=method, headers=headers,
            data=json.dumps(payload).encode("utf-8"),
        )

    @staticmethod
    def payload_of(body: bytes) -> dict:
        return json.loads(body.decode("utf-8"))

    # --- auth ---
    def test_all_write_endpoints_require_api_key(self) -> None:
        payloads = {
            "/__box/files/mkdir": {"path": "x"},
            "/__box/files/touch": {"path": "x.md"},
            "/__box/files/rename": {"path": "src/a.md", "name": "b.md"},
            "/__box/files/move": {"path": "src/a.md", "destination": "docs"},
            "/__box/files/delete": {"path": "src/a.md"},
        }
        for endpoint, payload in payloads.items():
            with self.subTest(endpoint=endpoint, key="missing"):
                status, _headers, body = self.write_call(endpoint, payload, key=None)
                self.assertEqual(status, 401)
                self.assertEqual(self.payload_of(body)["error"], "Cần X-BoxFox-Api-Key hợp lệ")
            with self.subTest(endpoint=endpoint, key="wrong"):
                status, _headers, _body = self.write_call(endpoint, payload, key="sai-khoa")
                self.assertEqual(status, 401)
            with self.subTest(endpoint=endpoint, origin_only=True):
                status, _headers, _body = self._request(
                    endpoint, headers={"Origin": ORIGIN_OK, "Content-Type": "application/json"},
                    data=json.dumps(payload).encode("utf-8"),
                )
                self.assertEqual(status, 401)
        # không có thao tác nào chạy: file gốc còn nguyên, chưa có thư mục/thùng rác mới
        self.assertTrue((self.root / "src" / "a.md").is_file())
        self.assertFalse((self.root / "x").exists())
        self.assertFalse((self.root / ".trash").exists())

    def test_write_endpoint_get_not_allowed(self) -> None:
        for endpoint in self.ENDPOINTS:
            with self.subTest(endpoint=endpoint):
                status, _h, _b = self._request(
                    endpoint, method="GET", headers={"X-BoxFox-Api-Key": SECRET_OK}
                )
                self.assertEqual(status, 405)

    # --- happy paths (đọc lại từ đĩa thật) ---
    def test_mkdir_creates_directory(self) -> None:
        status, _headers, body = self.write_call("/__box/files/mkdir", {"path": "src/new"})
        self.assertEqual(status, 200)
        self.assertEqual(self.payload_of(body), {"path": "src/new", "type": "directory"})
        self.assertTrue((self.root / "src" / "new").is_dir())
        # 409 khi đã tồn tại, trừ khi exist_ok
        status, _h, _b = self.write_call("/__box/files/mkdir", {"path": "src/new"})
        self.assertEqual(status, 409)
        status, _h, body = self.write_call(
            "/__box/files/mkdir", {"path": "src/new", "exist_ok": True}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.payload_of(body)["type"], "directory")
        status, _h, body = self.write_call(
            "/__box/files/mkdir", {"path": "src/new", "exist_ok": "yes"}
        )
        self.assertEqual(status, 400)
        self.assertIn("exist_ok", self.payload_of(body)["error"])

    def test_touch_creates_file(self) -> None:
        status, _h, body = self.write_call("/__box/files/touch", {"path": "src/new.md"})
        self.assertEqual(status, 200)
        self.assertEqual(
            self.payload_of(body), {"path": "src/new.md", "type": "file", "size": 0}
        )
        self.assertEqual((self.root / "src" / "new.md").read_bytes(), b"")
        status, _h, body = self.write_call(
            "/__box/files/touch", {"path": "docs/note.md", "content": "# hi\n"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.payload_of(body)["size"], len("# hi\n".encode("utf-8")))
        self.assertEqual((self.root / "docs" / "note.md").read_text(encoding="utf-8"), "# hi\n")
        # đích đã tồn tại → 409, nội dung cũ không bị ghi đè
        status, _h, _b = self.write_call(
            "/__box/files/touch", {"path": "docs/note.md", "content": "ghi đè"}
        )
        self.assertEqual(status, 409)
        self.assertEqual((self.root / "docs" / "note.md").read_text(encoding="utf-8"), "# hi\n")

    def test_rename_returns_new_path(self) -> None:
        status, _h, body = self.write_call(
            "/__box/files/rename", {"path": "src/a.md", "name": "b.md"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.payload_of(body), {"path": "src/a.md", "newPath": "src/b.md"})
        self.assertFalse((self.root / "src" / "a.md").exists())
        self.assertEqual((self.root / "src" / "b.md").read_text(encoding="utf-8"), "# a\n")
        # đích đã tồn tại → 409
        status, _h, _b = self.write_call(
            "/__box/files/rename", {"path": "src/b.md", "name": "b.md"}
        )
        self.assertEqual(status, 409)
        # tên sai (có '/', rỗng, '.', '..') → 400
        for bad_name in ("sub/b.md", "", ".", ".."):
            with self.subTest(name=bad_name):
                status, _h, _b = self.write_call(
                    "/__box/files/rename", {"path": "src/b.md", "name": bad_name}
                )
                self.assertEqual(status, 400)
        self.assertTrue((self.root / "src" / "b.md").is_file())

    def test_move_returns_new_path(self) -> None:
        status, _h, body = self.write_call(
            "/__box/files/move", {"path": "src/a.md", "destination": "docs"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.payload_of(body), {"path": "src/a.md", "newPath": "docs/a.md"})
        self.assertFalse((self.root / "src" / "a.md").exists())
        self.assertEqual((self.root / "docs" / "a.md").read_text(encoding="utf-8"), "# a\n")
        # đích đã tồn tại → 409
        (self.root / "src" / "a.md").write_text("x", encoding="utf-8")
        status, _h, _b = self.write_call(
            "/__box/files/move", {"path": "src/a.md", "destination": "docs"}
        )
        self.assertEqual(status, 409)
        self.assertEqual((self.root / "src" / "a.md").read_text(encoding="utf-8"), "x")

    def test_delete_trashes_entry_and_listing_hides_trash(self) -> None:
        status, _h, body = self.write_call("/__box/files/delete", {"path": "src/a.md"})
        self.assertEqual(status, 200)
        payload = self.payload_of(body)
        self.assertEqual(payload["path"], "src/a.md")
        self.assertTrue(payload["trashPath"].startswith(".trash/"))
        self.assertTrue(payload["trashPath"].endswith("-a.md"))
        self.assertFalse((self.root / "src" / "a.md").exists())
        self.assertTrue((self.root / payload["trashPath"]).is_file())
        self.assertEqual((self.root / payload["trashPath"]).read_text(encoding="utf-8"), "# a\n")
        # GET /__box/files ẩn `.trash`
        status, _h, body = self._request("/__box/files?path=", method="GET",
                                        headers={"Origin": ORIGIN_OK})
        self.assertEqual(status, 200)
        names = [entry["name"] for entry in self.payload_of(body)["entries"]]
        self.assertNotIn(".trash", names)
        self.assertIn("src", names)
        # xoá lần hai → 404
        status, _h, _b = self.write_call("/__box/files/delete", {"path": "src/a.md"})
        self.assertEqual(status, 404)

    # --- refusal paths ---
    def test_write_endpoints_reject_path_escape(self) -> None:
        cases = (
            ("/__box/files/mkdir", {"path": "../escaped"}),
            ("/__box/files/mkdir", {"path": "/etc/escaped"}),
            ("/__box/files/touch", {"path": "../escaped.md"}),
            ("/__box/files/rename", {"path": "../escaped.md", "name": "x.md"}),
            ("/__box/files/move", {"path": "../escaped.md", "destination": "docs"}),
            ("/__box/files/move", {"path": "src/a.md", "destination": "../escaped"}),
            ("/__box/files/delete", {"path": "../escaped.md"}),
            ("/__box/files/delete", {"path": "/etc/passwd"}),
        )
        for endpoint, payload in cases:
            with self.subTest(endpoint=endpoint, payload=payload):
                status, _h, body = self.write_call(endpoint, payload)
                self.assertEqual(status, 400)
                self.assertIn("error", self.payload_of(body))
        self.assertFalse((self.root.parent / "escaped").exists())
        self.assertFalse((self.root.parent / "escaped.md").exists())
        self.assertTrue((self.root / "src" / "a.md").is_file())

    def test_delete_refuses_protected_paths(self) -> None:
        (self.root / ".plans" / "v1-pilot.md").write_text("# plan\n", encoding="utf-8")
        for protected in ("", ".plans", ".trash", ".generated_artifacts"):
            with self.subTest(path=protected):
                status, _h, _b = self.write_call("/__box/files/delete", {"path": protected})
                self.assertEqual(status, 409)
        self.assertTrue((self.root / ".plans" / "v1-pilot.md").is_file())
        self.assertFalse((self.root / ".trash").exists())

    def test_write_endpoints_reject_malformed_body(self) -> None:
        # thiếu 'path' → 400 chứ không phải 500
        status, _h, _b = self.write_call("/__box/files/mkdir", {})
        self.assertEqual(status, 400)
        status, _h, _b = self._request(
            "/__box/files/touch",
            headers={"X-BoxFox-Api-Key": SECRET_OK, "Content-Type": "application/json"},
            data=b"{not json",
        )
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
