"""Kiểm thử HTTP cho endpoint capture/record của ide-proxy.

Đối tượng kiểm: quyền (Origin + shared-secret), mã lỗi, method, JSON body và ánh
xạ CaptureError → HTTP status. Các hàm capture thực (gosu/wmctrl/CDP) được mock.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOCKER_DIRECTORY))

SPEC = importlib.util.spec_from_file_location("ide_proxy", DOCKER_DIRECTORY / "ide-proxy.py")
assert SPEC and SPEC.loader
ide_proxy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ide_proxy)

ORIGIN_OK = "http://localhost:3100"
SESSION_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
ORIGIN_BAD = "https://malicious.example"


class IdeProxyCaptureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ide_proxy.ThreadingHTTPServer(("127.0.0.1", 0), ide_proxy.ProxyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self._original_key = ide_proxy.BOXFOX_API_KEY

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        ide_proxy.BOXFOX_API_KEY = self._original_key

    def _request(self, path, method="GET", body=None, headers=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method, headers=headers or {}
        )
        return urllib.request.urlopen(request)

    def _status(self, path, method="GET", body=None, headers=None):
        try:
            with self._request(path, method, body, headers) as response:
                return response.status, response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8")

    def test_windows_allowed_via_origin(self) -> None:
        with patch.object(ide_proxy.capture, "dispatch_list_windows", return_value={"windows": []}):
            status, body = self._status("/__box/windows", headers={"Origin": ORIGIN_OK})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"windows": []})

    def test_foreign_origin_denied(self) -> None:
        status, _ = self._status("/__box/windows", headers={"Origin": ORIGIN_BAD})
        self.assertEqual(status, 403)

    def test_no_origin_no_secret_denied(self) -> None:
        ide_proxy.BOXFOX_API_KEY = ""
        status, _ = self._status("/__box/windows", headers={})
        self.assertEqual(status, 403)

    def test_shared_secret_allows_and_mismatch_denies(self) -> None:
        ide_proxy.BOXFOX_API_KEY = "box-secret-123"
        with patch.object(ide_proxy.capture, "dispatch_list_windows", return_value={"windows": []}):
            status, _ = self._status(
                "/__box/windows", headers={"X-BoxFox-Api-Key": "box-secret-123"}
            )
        self.assertEqual(status, 200)

        status, _ = self._status("/__box/windows", headers={"X-BoxFox-Api-Key": "wrong-key"})
        self.assertEqual(status, 403)
        status, _ = self._status("/__box/windows", headers={})
        self.assertEqual(status, 403)

    def test_method_not_allowed(self) -> None:
        status, _ = self._status("/__box/windows", method="POST", body={}, headers={"Origin": ORIGIN_OK})
        self.assertEqual(status, 405)

    def test_options_preflight_returns_204(self) -> None:
        status, _ = self._status("/__box/capture", method="OPTIONS", headers={"Origin": ORIGIN_OK})
        self.assertEqual(status, 204)

    def test_options_preflight_foreign_origin_still_204(self) -> None:
        # Preflight không cần auth; không cấp Access-Control-Allow-Origin cho origin lạ
        # nhưng vẫn trả 204 để trình duyệt tự chặn phía client.
        status, _ = self._status("/__box/capture", method="OPTIONS", headers={"Origin": ORIGIN_BAD})
        self.assertEqual(status, 204)

    def test_capture_bad_json_returns_400(self) -> None:
        request = urllib.request.Request(
            f"{self.base_url}/__box/capture",
            data=b"{not-json",
            method="POST",
            headers={"Origin": ORIGIN_OK},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request)
        self.assertEqual(caught.exception.code, 400)

    def test_capture_result_passthrough(self) -> None:
        result = {"ok": True, "path": "/tmp/x.png", "width": 800, "height": 600}
        with patch.object(ide_proxy.capture, "dispatch_capture", return_value=result) as capture_call:
            status, body = self._status(
                "/__box/capture", method="POST",
                body={"target": {"kind": "screen"}}, headers={"Origin": ORIGIN_OK},
            )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), result)
        # A3 (đợt 20): định danh phiên/bước/công cụ phải đi QUA proxy — thiếu mắt nối này thì
        # ảnh mới vẫn rơi vào thư mục phẳng dù `capture.py` đã biết xếp theo phiên.
        self.assertEqual(capture_call.call_args.kwargs,
                         {"session": None, "step": None, "tool_call_id": None})

    def test_capture_forwards_the_session_step_and_tool_call(self) -> None:
        with patch.object(ide_proxy.capture, "dispatch_capture",
                          return_value={"ok": True, "path": "/x.png"}) as capture_call:
            status, _ = self._status(
                "/__box/capture", method="POST",
                body={"target": {"kind": "screen"}, "session": SESSION_ID, "step": 3,
                      "toolCallId": "call-1"}, headers={"Origin": ORIGIN_OK},
            )
        self.assertEqual(status, 200)
        self.assertEqual(capture_call.call_args.args[0], {"kind": "screen"})
        self.assertEqual(capture_call.call_args.kwargs,
                         {"session": SESSION_ID, "step": 3, "tool_call_id": "call-1"})

    def test_record_start_forwards_the_session_too(self) -> None:
        with patch.object(ide_proxy.capture, "dispatch_record_start",
                          return_value={"recordingId": "r1"}) as started:
            status, _ = self._status(
                "/__box/record/start", method="POST",
                body={"target": {"kind": "screen"}, "session": SESSION_ID}, headers={"Origin": ORIGIN_OK},
            )
        self.assertEqual(status, 200)
        self.assertEqual(started.call_args.kwargs,
                         {"session": SESSION_ID, "step": None, "tool_call_id": None})

    def test_capture_error_maps_to_status(self) -> None:
        def raise_not_found(_target, _output="file", **_rest):
            raise ide_proxy.capture.CaptureError("Không tìm thấy", status_code=404)
        with patch.object(ide_proxy.capture, "dispatch_capture", side_effect=raise_not_found):
            status, body = self._status(
                "/__box/capture", method="POST",
                body={"target": {"kind": "tab", "url": "x"}}, headers={"Origin": ORIGIN_OK},
            )
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body), {"error": "Không tìm thấy"})

    def test_prune_route_passes_the_session_and_dry_run(self) -> None:
        """A8: dọn ảnh theo trần F2 — route cho người vận hành, mặc định chỉ xem trước."""
        with patch.object(ide_proxy.capture, "dispatch_captures_prune",
                          return_value={"ok": True, "removedFiles": 0}) as prune:
            status, body = self._status(
                "/__box/captures/prune", method="POST", body={}, headers={"Origin": ORIGIN_OK},
            )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "removedFiles": 0})
        self.assertEqual(prune.call_args.kwargs, {"session": None, "dry_run": False})

        with patch.object(ide_proxy.capture, "dispatch_captures_prune",
                          return_value={"ok": True}) as prune:
            self._status("/__box/captures/prune", method="POST",
                         body={"session": SESSION_ID, "dryRun": True}, headers={"Origin": ORIGIN_OK})
        self.assertEqual(prune.call_args.kwargs, {"session": SESSION_ID, "dry_run": True})

    def test_prune_route_rejects_get(self) -> None:
        status, _ = self._status("/__box/captures/prune", headers={"Origin": ORIGIN_OK})
        self.assertEqual(status, 405)

    def test_record_stop_requires_id(self) -> None:
        status, _ = self._status(
            "/__box/record/stop", method="POST", body={}, headers={"Origin": ORIGIN_OK}
        )
        self.assertEqual(status, 400)

    def test_record_status_shape(self) -> None:
        with patch.object(ide_proxy.capture, "dispatch_record_status", return_value={"active": []}):
            status, body = self._status("/__box/record/status", headers={"Origin": ORIGIN_OK})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"active": []})


if __name__ == "__main__":
    unittest.main()
