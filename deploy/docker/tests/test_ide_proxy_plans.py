"""Kiểm thử HTTP cho endpoint plan của ide-proxy."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOCKER_DIRECTORY))

sys.path.insert(0, str(DOCKER_DIRECTORY))
import plan_files  # noqa: E402  (dùng cho giới hạn MAX_NOTE_SIZE)

SPEC = importlib.util.spec_from_file_location("ide_proxy", DOCKER_DIRECTORY / "ide-proxy.py")
assert SPEC and SPEC.loader
ide_proxy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ide_proxy)


class IdeProxyPlansTest(unittest.TestCase):
    """Xác minh CORS, mã lỗi và payload của API chỉ-đọc."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "v1-demo.md").write_bytes(b"# Demo\n")
        self.previous_root = ide_proxy.PLAN_ROOT
        ide_proxy.PLAN_ROOT = str(self.root)
        self.server = ide_proxy.ThreadingHTTPServer(("127.0.0.1", 0), ide_proxy.ProxyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        ide_proxy.PLAN_ROOT = self.previous_root
        self.temporary_directory.cleanup()

    def request(self, path: str, method: str = "GET", origin: str = "http://localhost:3100"):
        request = urllib.request.Request(
            f"{self.base_url}{path}", method=method, headers={"Origin": origin}
        )
        return urllib.request.urlopen(request)

    def test_lists_and_reads_plan_with_no_store_cors(self) -> None:
        with self.request("/__box/plans") as response:
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:3100")
            self.assertEqual(response.headers.get_content_type(), "application/json")
            self.assertIn('"identity": "demo"', body)

        with self.request("/__box/plans/content?identity=demo&version=1") as response:
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertIn('"markdown": "# Demo\\n"', body)
            self.assertIn('"label": "v1"', body)
            self.assertNotIn(str(self.root), body)

    def test_rejects_invalid_requests_and_foreign_origin(self) -> None:
        for path, method, expected_status in (
            ("/__box/plans?path=/etc/passwd", "GET", 400),
            ("/__box/plans/content?identity=../etc&version=1", "GET", 400),
            ("/__box/plans/content?identity=demo&version=1", "POST", 405),
        ):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request(path, method)
            self.assertEqual(caught.exception.code, expected_status)
            self.assertEqual(caught.exception.headers["Cache-Control"], "no-store")

        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/__box/plans", origin="https://malicious.example")
        self.assertEqual(caught.exception.code, 403)


SECRET_OK = "test-secret-key"
ORIGIN_OK = "http://localhost:3100"


class IdeProxyPlanReviewTest(unittest.TestCase):
    """`POST /__box/plans/review` — route GHI chạy server-to-server nên KHÔNG cần Origin."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "v1-demo.md").write_bytes(b"# Demo\n")
        (self.root / "v1-other.md").write_bytes(b"# Other\n")
        (self.root / "subplans").mkdir()
        (self.root / "subplans" / "v1-login.md").write_bytes(b"# Login\n")
        self.previous_root = ide_proxy.PLAN_ROOT
        self.previous_key = ide_proxy.BOXFOX_API_KEY
        ide_proxy.PLAN_ROOT = str(self.root)
        ide_proxy.BOXFOX_API_KEY = SECRET_OK
        self.server = ide_proxy.ThreadingHTTPServer(("127.0.0.1", 0), ide_proxy.ProxyHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        ide_proxy.PLAN_ROOT = self.previous_root
        ide_proxy.BOXFOX_API_KEY = self.previous_key
        self.temporary_directory.cleanup()

    def request(
        self,
        path: str,
        method: str = "POST",
        payload=None,
        raw: bytes | None = None,
        origin: str | None = None,
        key: str | None = None,
    ) -> tuple[int, dict, str]:
        headers: dict[str, str] = {}
        if origin is not None:
            headers["Origin"] = origin
        if key is not None:
            headers["X-BoxFox-Api-Key"] = key
        data: bytes | None = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif raw is not None:
            data = raw
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, dict(response.headers), response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read().decode("utf-8")

    def plans(self) -> dict:
        status, _headers, body = self.request(
            "/__box/plans", method="GET", origin=ORIGIN_OK
        )
        self.assertEqual(status, 200)
        return json.loads(body)

    def review_of(self, identity: str) -> dict | None:
        for plan in self.plans()["plans"]:
            if plan["identity"] == identity:
                self.assertIn("review", plan)
                return plan["review"]
        raise AssertionError(f"không thấy plan {identity!r} trong manifest")

    def test_review_requires_secret_and_rejects_get(self) -> None:
        payload = {"identity": "demo", "decision": "approved", "note": ""}

        status, _headers, body = self.request("/__box/plans/review", payload=payload)
        self.assertEqual(status, 401)
        self.assertIn("X-BoxFox-Api-Key", body)
        status, _headers, _body = self.request(
            "/__box/plans/review", payload=payload, key="sai-khoa", origin=ORIGIN_OK
        )
        self.assertEqual(status, 401)
        status, _headers, _body = self.request(
            "/__box/plans/review", payload=payload, origin=ORIGIN_OK
        )
        self.assertEqual(status, 401)

        status, _headers, _body = self.request(
            "/__box/plans/review", method="GET", key=SECRET_OK
        )
        self.assertEqual(status, 405)

        self.assertFalse((self.root / ".reviews").exists())

    def test_review_preflight_allows_post_and_api_key_header(self) -> None:
        status, headers, _body = self.request(
            "/__box/plans/review", method="OPTIONS", origin=ORIGIN_OK
        )

        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN_OK)
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertIn("X-BoxFox-Api-Key", headers["Access-Control-Allow-Headers"])

    def test_review_round_trip_without_origin_updates_manifest(self) -> None:
        self.assertIsNone(self.review_of("demo"))  # lần đọc đầu bơm cache manifest

        status, headers, body = self.request(
            "/__box/plans/review",
            payload={"identity": "demo", "decision": "approved", "note": "ổn rồi"},
            key=SECRET_OK,
        )

        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)  # gọi server-to-server
        record = json.loads(body)
        self.assertEqual(set(record), {"identity", "decision", "note", "updatedAt"})
        self.assertEqual(record["identity"], "demo")
        self.assertEqual(record["decision"], "approved")
        self.assertEqual(record["note"], "ổn rồi")
        self.assertIsInstance(record["updatedAt"], float)

        stored = json.loads((self.root / ".reviews" / "demo.json").read_text(encoding="utf-8"))
        self.assertEqual(stored, record)

        self.assertEqual(self.review_of("demo"), record)  # cache manifest đã được làm mới
        self.assertIsNone(self.review_of("other"))

    def test_review_changes_requested_replaces_previous_decision(self) -> None:
        body = {"identity": "demo", "decision": "approved", "note": ""}
        self.assertEqual(self.request("/__box/plans/review", payload=body, key=SECRET_OK)[0], 200)

        body["decision"] = "changes_requested"
        body["note"] = "cần tách nhỏ"
        status, _headers, payload = self.request(
            "/__box/plans/review", payload=body, key=SECRET_OK
        )

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload)["decision"], "changes_requested")
        self.assertEqual(self.review_of("demo")["note"], "cần tách nhỏ")
        self.assertEqual(len(list((self.root / ".reviews").glob("*.json"))), 1)

    def test_nested_identity_review_round_trips_through_nested_directory(self) -> None:
        """Plan trong `slug/`: ghi review → file lồng thật → đọc lại đúng identity TRẦN."""

        status, _headers, body = self.request(
            "/__box/plans/review",
            payload={"identity": "subplans/login", "decision": "approved", "note": "ok"},
            key=SECRET_OK,
        )

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["identity"], "subplans/login")  # không kèm vN-
        self.assertTrue((self.root / ".reviews" / "subplans" / "login.json").is_file())
        self.assertEqual(
            json.loads((self.root / ".reviews" / "subplans" / "login.json").read_text("utf-8"))[
                "identity"
            ],
            "subplans/login",
        )
        self.assertEqual(self.review_of("subplans/login")["decision"], "approved")
        self.assertIsNone(self.review_of("demo"))

        # Đọc nội dung plan lồng nhau vẫn chạy sau khi ghi review.
        status, _headers, content = self.request(
            "/__box/plans/content?identity=subplans/login&version=1",
            method="GET",
            origin=ORIGIN_OK,
        )
        self.assertEqual(status, 200)
        self.assertIn("# Login", content)

        # identity CÓ tiền tố version là giá trị hợp lệ nhưng TRẦN mới là khoá: không
        # được khớp mờ vào plan `subplans/login`.
        status, _headers, _body = self.request(
            "/__box/plans/review",
            payload={"identity": "v1-login", "decision": "changes_requested", "note": ""},
            key=SECRET_OK,
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.review_of("subplans/login")["decision"], "approved")
        self.assertNotIn(
            "v1-login", [plan["identity"] for plan in self.plans()["plans"]]
        )

    def test_review_rejects_bad_identity_decision_and_body(self) -> None:
        for payload in (
            {"identity": "../etc", "decision": "approved"},
            {"identity": "", "decision": "approved"},
            {"identity": "Demo", "decision": "approved"},
            {"identity": "x" * (plan_files.MAX_IDENTITY_LENGTH + 1), "decision": "approved"},
            {"identity": ["demo"], "decision": "approved"},
            {"identity": "demo", "decision": "maybe"},
            {"identity": "demo", "decision": ""},
            {"identity": "demo", "decision": "approved", "note": {"a": 1}},
            {"decision": "approved"},
        ):
            status, _headers, _body = self.request(
                "/__box/plans/review", payload=payload, key=SECRET_OK
            )
            self.assertEqual(status, 400, payload)

        status, _headers, _body = self.request(
            "/__box/plans/review", raw=b"{khong-phai-json", key=SECRET_OK
        )
        self.assertEqual(status, 400)

        status, _headers, _body = self.request(
            "/__box/plans/review",
            payload={"identity": "demo", "decision": "approved", "note": "x" * (plan_files.MAX_NOTE_SIZE + 1)},
            key=SECRET_OK,
        )
        self.assertEqual(status, 413)

        self.assertFalse((self.root / ".reviews").exists())

    def test_reviews_directory_is_never_listed_as_a_plan(self) -> None:
        self.request(
            "/__box/plans/review",
            payload={"identity": "demo", "decision": "approved", "note": ""},
            key=SECRET_OK,
        )

        manifest = self.plans()

        self.assertEqual(sorted(plan["identity"] for plan in manifest["plans"]), ["demo", "other", "subplans/login"])
        self.assertNotIn(".reviews", json.dumps(manifest))


if __name__ == "__main__":
    unittest.main()
