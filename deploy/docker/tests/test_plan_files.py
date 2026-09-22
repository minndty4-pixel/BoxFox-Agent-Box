"""Kiểm thử scanner và đọc file kế hoạch an toàn."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import plan_files
from plan_files import (
    InvalidPlanEncoding,
    InvalidPlanRequest,
    PlanNotFound,
    PlanTooLarge,
    read_plan,
    read_reviews,
    scan_plans,
    validate_identity,
    validate_version,
    write_review,
)


class PlanFilesTest(unittest.TestCase):
    """Kiểm thử hợp đồng quét và bảo vệ đọc file."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write(self, relative_path: str, content: bytes | str = "# Plan\n") -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())
        return path

    def test_groups_root_and_nested_identity_with_numeric_sort(self) -> None:
        self.write("v1-login.md")
        self.write("designs/v1-login.md")
        self.write("subplans/v1-login.md")
        self.write("subplans/v2-login.md")
        self.write("subplans/v10-login.md")

        manifest = scan_plans(self.root)

        self.assertEqual(
            [group.identity for group in manifest.plans],
            ["designs/login", "login", "subplans/login"],
        )
        nested = manifest.plans[2]
        self.assertEqual([item.version for item in nested.versions], [10, 2, 1])
        self.assertEqual([item.status for item in nested.versions], ["draft", "approved", "approved"])
        self.assertEqual(manifest.plans[1].versions[0].status, "approved")

    def test_ignores_summary_malformed_hidden_temporary_and_symlinks(self) -> None:
        self.write("v1-good.md")
        for name in (
            "v2-good-summary.md",
            "v01-good.md",
            "v1-Good.md",
            "v1-good.md.tmp",
            ".hidden/v1-hidden.md",
            "subplans/.v2-good.md",
            "notes.txt",
        ):
            self.write(name)
        outside = self.write("outside.md")
        os.symlink(outside, self.root / "v2-link.md")
        os.symlink(self.root / "subplans", self.root / "linked-directory")

        manifest = scan_plans(self.root)

        self.assertEqual([group.identity for group in manifest.plans], ["good"])
        self.assertGreaterEqual(manifest.ignored_count, 7)
        self.assertFalse(any("tóm tắt" in warning for warning in manifest.warnings))
        self.assertTrue(any("liên kết tượng trưng" in warning for warning in manifest.warnings))

    def test_rejects_invalid_identity_and_version(self) -> None:
        for identity in ("", "/login", "../login", "designs//login", "Login", "a_b"):
            with self.assertRaises(InvalidPlanRequest):
                validate_identity(identity)
        for version in (0, "01", "0", "-1", "abc", "12345678901", True):
            with self.assertRaises(InvalidPlanRequest):
                validate_version(version)

    def test_read_returns_metadata_and_rejects_traversal(self) -> None:
        self.write("subplans/v2-login.md", "# Đăng nhập\n")

        document = read_plan(self.root, "subplans/login", "2")

        self.assertEqual(document.relative_path, "subplans/v2-login.md")
        self.assertEqual(document.markdown, "# Đăng nhập\n")
        self.assertEqual(document.to_payload()["label"], "v2")
        with self.assertRaises(InvalidPlanRequest):
            read_plan(self.root, "../etc/passwd", 1)
        with self.assertRaises(PlanNotFound):
            read_plan(self.root, "subplans/login", 3)

    def test_does_not_list_or_read_version_with_more_than_ten_digits(self) -> None:
        self.write("v1234567890-limit.md")
        self.write("v12345678901-too-large.md")

        manifest = scan_plans(self.root)

        self.assertEqual([group.identity for group in manifest.plans], ["limit"])
        self.assertTrue(any("too-large" in warning for warning in manifest.warnings))
        with self.assertRaises(InvalidPlanRequest):
            read_plan(self.root, "too-large", "12345678901")

    def test_rejects_large_and_invalid_utf8_content(self) -> None:
        self.write("v1-large.md", b"x" * (plan_files.MAX_FILE_SIZE + 1))
        self.write("v1-invalid.md", b"\xff")

        with self.assertRaises(PlanTooLarge):
            read_plan(self.root, "large", 1)
        with self.assertRaises(InvalidPlanEncoding):
            read_plan(self.root, "invalid", 1)

    @unittest.skipIf(os.name == "nt", "Symlink tests require POSIX environment")
    def test_does_not_follow_file_or_directory_symlink_during_read(self) -> None:
        self.write("v1-safe.md")
        outside = self.write("outside.md", "bí mật")
        os.symlink(outside, self.root / "v1-escaped.md")
        os.symlink(self.root, self.root / "loop")

        with self.assertRaises(PlanNotFound):
            read_plan(self.root, "escaped", 1)
        self.assertEqual(read_plan(self.root, "safe", 1).markdown, "# Plan\n")

    @unittest.skipIf(os.name == "nt", "Symlink tests require POSIX environment")
    def test_symlink_swap_after_scan_cannot_be_read(self) -> None:
        target = self.write("v1-safe.md", "# An toàn\n")
        original_scan = plan_files.scan_plans

        def swap_then_scan(root: str | Path):
            manifest = original_scan(root)
            target.unlink()
            os.symlink("/etc/passwd", target)
            return manifest

        with patch.object(plan_files, "scan_plans", side_effect=swap_then_scan):
            with self.assertRaises(PlanNotFound):
                read_plan(self.root, "safe", 1)

    @unittest.skipIf(os.name == "nt", "Symlink tests require POSIX environment")
    def test_directory_symlink_swap_does_not_disclose_outside_metadata(self) -> None:
        self.write("plans/v1-safe.md")
        outside_tmp = tempfile.TemporaryDirectory()
        try:
            outside_directory = Path(outside_tmp.name) / "outside"
            outside_directory.mkdir()
            (outside_directory / "v1-secret.md").write_text("# Bí mật\n", encoding="utf-8")
            original_open = plan_files.os.open
            swapped = False

            def swap_before_open(name, flags, *args, **kwargs):
                nonlocal swapped
                if name == "plans" and kwargs.get("dir_fd") is not None and not swapped:
                    swapped = True
                    (self.root / "plans").rename(self.root / "plans-cu")
                    os.symlink(outside_directory, self.root / "plans")
                return original_open(name, flags, *args, **kwargs)

            with patch.object(plan_files.os, "open", side_effect=swap_before_open):
                manifest = scan_plans(self.root)

            self.assertEqual(manifest.plans, ())
            self.assertTrue(any("không thể mở thư mục an toàn" in warning for warning in manifest.warnings))
            self.assertNotIn("secret", " ".join(manifest.warnings))
        finally:
            outside_tmp.cleanup()

    def test_depth_and_entry_limits_return_warnings_without_hanging(self) -> None:
        deep = "/".join(["aaa"] * (plan_files.MAX_DEPTH + 1))
        self.write(f"{deep}/v1-too-deep.md")
        for index in range(plan_files.MAX_ENTRIES + 1):
            self.write(f"many/v1-item-{index}.md")

        manifest = scan_plans(self.root)

        self.assertTrue(any("độ sâu" in warning for warning in manifest.warnings))
        self.assertTrue(any("2000" in warning for warning in manifest.warnings))

    def test_new_plan_inside_nested_directory_is_visible_on_second_scan(self) -> None:
        """Regression: cache cũ khoá theo mtime THƯ MỤC GỐC nên bỏ sót file trong `slug/`.

        Thêm file vào thư mục con chỉ đổi mtime của chính thư mục con — test này khẳng
        định điều đó (mtime gốc không đổi) rồi đòi lần quét thứ hai phải thấy version mới.
        """

        self.write("subplans/v1-login.md")
        first = scan_plans(self.root)
        self.assertEqual([group.identity for group in first.plans], ["subplans/login"])
        self.assertEqual([item.version for item in first.plans[0].versions], [1])

        root_mtime_before = os.stat(self.root).st_mtime_ns
        self.write("subplans/v2-login.md")
        self.assertEqual(os.stat(self.root).st_mtime_ns, root_mtime_before)  # bug cũ nằm ở đây

        second = scan_plans(self.root)
        self.assertEqual([group.identity for group in second.plans], ["subplans/login"])
        self.assertEqual([item.version for item in second.plans[0].versions], [2, 1])
        self.assertEqual(second.plans[0].versions[0].status, "draft")

        (self.root / "subplans" / "v2-login.md").unlink()
        third = scan_plans(self.root)
        self.assertEqual([item.version for item in third.plans[0].versions], [1])

    def test_editing_plan_content_refreshes_cached_metadata(self) -> None:
        """Sửa nội dung tại chỗ chỉ đổi mtime của FILE — manifest phải thấy size mới."""

        path = self.write("v1-login.md", "# một\n")
        self.assertEqual(
            scan_plans(self.root).plans[0].versions[0].size_bytes,
            len("# một\n".encode("utf-8")),
        )

        path.write_text("# nội dung dài hơn hẳn\n", encoding="utf-8")

        refreshed = scan_plans(self.root)
        self.assertEqual(refreshed.plans[0].versions[0].size_bytes, os.stat(path).st_size)
        self.assertEqual(refreshed.plans[0].versions[0].size_bytes, len("# nội dung dài hơn hẳn\n".encode()))

    def test_collision_is_fail_closed(self) -> None:
        first = plan_files._Candidate(
            "login", "", "login", 1, "v1-login.md", 1, "2026-01-01T00:00:00Z"
        )
        second = plan_files._Candidate(
            "login", "", "login", 1, "other/v1-login.md", 1, "2026-01-01T00:00:00Z"
        )
        with patch.object(plan_files, "_walk_plan_entries", return_value=([first, second], 0, [])):
            manifest = scan_plans(self.root)

        self.assertEqual(manifest.plans, ())
        self.assertIn(("login", 1), manifest.collisions)
        self.assertEqual(manifest.ignored_count, 2)


class PlanReviewsTest(unittest.TestCase):
    """Trạng thái duyệt plan trong `.reviews/<identity>.json` (hợp đồng §2)."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write(self, relative_path: str, content: bytes | str = "# Plan\n") -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())
        return path

    def review_path(self, identity: str) -> Path:
        return self.root / ".reviews" / f"{identity}.json"

    def test_write_review_returns_contract_payload_and_writes_file(self) -> None:
        record = write_review(self.root, "v1-pilot", "approved", "ok")

        self.assertEqual(
            set(record), {"identity", "decision", "note", "updatedAt", "version", "reviewLegacy"}
        )
        self.assertEqual(record["identity"], "v1-pilot")
        self.assertEqual(record["decision"], "approved")
        self.assertEqual(record["note"], "ok")
        self.assertIsInstance(record["updatedAt"], float)
        self.assertIsNone(record["version"], "không truyền version → lưu null, không đoán số")
        self.assertTrue(record["reviewLegacy"], "bản ghi không gắn version nào phải tự khai")
        stored = json.loads(self.review_path("v1-pilot").read_text(encoding="utf-8"))
        self.assertEqual(stored, record)
        self.assertEqual(self.review_path("v1-pilot").stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.root.joinpath(".reviews").stat().st_mode & 0o777, 0o750)
        if os.geteuid() == 0:
            self.assertEqual(self.review_path("v1-pilot").stat().st_uid, plan_files.AGENT_UID)

    def test_write_review_overwrites_previous_decision(self) -> None:
        first = write_review(self.root, "v1-pilot", "changes_requested", "sửa phần 2")
        second = write_review(self.root, "v1-pilot", "approved", "")

        self.assertEqual(read_reviews(self.root)["v1-pilot"]["decision"], "approved")
        self.assertEqual(read_reviews(self.root)["v1-pilot"]["note"], "")
        self.assertGreaterEqual(second["updatedAt"], first["updatedAt"])
        self.assertEqual(len(list((self.root / ".reviews").glob("*.json"))), 1)
        self.assertEqual(list((self.root / ".reviews").glob("*.tmp")), [])

    def test_write_review_rejects_bad_identity_and_decision(self) -> None:
        for identity in ("", "/login", "../login", "designs//login", "Login", "a_b", None, 5):
            with self.assertRaises(InvalidPlanRequest):
                write_review(self.root, identity, "approved", "")
        for decision in ("approved!", "ok", "", None, 5, True):
            with self.assertRaises(InvalidPlanRequest):
                write_review(self.root, "v1-pilot", decision, "")
        with self.assertRaises(InvalidPlanRequest):
            write_review(self.root, "v1-pilot", "approved", {"khong": "phai chuoi"})
        with self.assertRaises(PlanTooLarge):
            write_review(self.root, "v1-pilot", "approved", "x" * (plan_files.MAX_NOTE_SIZE + 1))
        self.assertFalse((self.root / ".reviews").exists())

    def test_nested_identity_uses_identity_relative_path(self) -> None:
        write_review(self.root, "designs/login", "approved", "")

        self.assertTrue(self.review_path("designs/login").is_file())
        self.assertEqual(
            read_reviews(self.root)["designs/login"]["decision"], "approved"
        )
        self.assertTrue(read_reviews(self.root)["designs/login"]["identity"] == "designs/login")

    def test_read_reviews_ignores_junk_and_takes_identity_from_path(self) -> None:
        write_review(self.root, "v1-pilot", "approved", "ok")
        self.write(".reviews/notes.txt", "không phải json")
        self.write(".reviews/bad.json", json.dumps({"decision": "maybe"}))
        self.write(".reviews/.hidden.json", json.dumps({"decision": "approved"}))
        self.write(".reviews/broken.json", "{not json")
        # identity trong NỘI DUNG bị bỏ qua — lấy theo đường dẫn
        self.write(
            ".reviews/other.json",
            json.dumps({"identity": "v1-pilot", "decision": "changes_requested", "note": ""}),
        )
        if os.name != "nt":
            outside = self.write("outside.json", json.dumps({"decision": "approved"}))
            os.symlink(outside, self.root / ".reviews" / "linked.json")

        reviews = read_reviews(self.root)

        self.assertEqual(sorted(reviews), ["other", "v1-pilot"])
        self.assertEqual(reviews["other"]["identity"], "other")
        self.assertEqual(reviews["other"]["decision"], "changes_requested")
        self.assertEqual(reviews["v1-pilot"]["note"], "ok")

    @unittest.skipIf(os.name == "nt", "Symlink tests require POSIX environment")
    def test_write_review_refuses_symlinked_reviews_directory(self) -> None:
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        os.symlink(outside.name, self.root / ".reviews")

        with self.assertRaises(InvalidPlanRequest):
            write_review(self.root, "v1-pilot", "approved", "")
        self.assertEqual(list(os.scandir(outside.name)), [])

    def test_review_identity_mapping_is_reversible_and_collision_free(self) -> None:
        """`/` thành thư mục con thật: ánh xạ song ánh, đảo ngược được, không đụng `__`."""

        for identity in ("pilot", "v2-x", "designs/login", "a/b/c/d"):
            relative = plan_files.identity_to_review_relative_path(identity)
            self.assertEqual(relative, f"{identity}.json")
            self.assertEqual(
                plan_files.identity_from_review_relative_path(relative), identity
            )

        # `designs-login` là identity HỢP LỆ khác (slug dùng dấu gạch): nếu thay "/"
        # bằng "-"/"__" thì hai plan này sẽ ghi đè nhau — đường dẫn thật thì không.
        self.assertNotEqual(
            plan_files.identity_to_review_relative_path("designs/login"),
            plan_files.identity_to_review_relative_path("designs-login"),
        )
        write_review(self.root, "designs/login", "approved", "")
        write_review(self.root, "designs-login", "changes_requested", "")
        reviews = read_reviews(self.root)
        self.assertEqual(sorted(reviews), ["designs-login", "designs/login"])
        self.assertEqual(reviews["designs/login"]["decision"], "approved")
        self.assertEqual(reviews["designs-login"]["decision"], "changes_requested")

        for broken in ("", "login.txt", "/login.json", "login.json/"):
            with self.assertRaises(ValueError):
                plan_files.identity_from_review_relative_path(broken)

    def test_nested_plan_review_round_trip_through_manifest(self) -> None:
        """Plan trong thư mục con: ghi review rồi ĐỌC LẠI qua manifest phải khớp."""

        self.write("designs/v1-login.md")
        self.write("designs/v2-login.md")
        self.write("v1-pilot.md")

        write_review(self.root, "designs/login", "changes_requested", "tách nhỏ")

        self.assertTrue((self.root / ".reviews" / "designs" / "login.json").is_file())
        by_identity = {
            plan["identity"]: plan for plan in scan_plans(self.root).to_payload()["plans"]
        }
        self.assertEqual(sorted(by_identity), ["designs/login", "pilot"])
        self.assertEqual(
            by_identity["designs/login"]["review"]["decision"], "changes_requested"
        )
        self.assertEqual(by_identity["designs/login"]["review"]["note"], "tách nhỏ")
        self.assertEqual(
            by_identity["designs/login"]["review"]["identity"], "designs/login"
        )
        # review gắn theo identity nên vẫn còn khi có bản mới hơn
        self.assertEqual(
            [version["version"] for version in by_identity["designs/login"]["versions"]],
            [2, 1],
        )
        self.assertIsNone(by_identity["pilot"]["review"])
        self.assertNotIn(".reviews", json.dumps(scan_plans(self.root).to_payload()))

    def test_version_qualified_identity_never_matches_a_plan(self) -> None:
        """identity là giá trị TRẦN: `v1-pilot` không được khớp mờ vào plan `pilot`."""

        self.write("v1-pilot.md")
        write_review(self.root, "v1-pilot", "approved", "nhầm tiền tố")

        by_identity = {
            plan["identity"]: plan for plan in scan_plans(self.root).to_payload()["plans"]
        }
        self.assertEqual(sorted(by_identity), ["pilot"])
        self.assertIsNone(by_identity["pilot"]["review"])
        self.assertEqual(read_reviews(self.root)["v1-pilot"]["note"], "nhầm tiền tố")

    def test_identity_longer_than_filename_limit_is_rejected(self) -> None:
        with self.assertRaises(InvalidPlanRequest):
            write_review(self.root, "x" * (plan_files.MAX_IDENTITY_LENGTH + 1), "approved", "")
        self.assertFalse((self.root / ".reviews").exists())

        longest = "y" * plan_files.MAX_IDENTITY_LENGTH
        write_review(self.root, longest, "approved", "")
        self.assertEqual(read_reviews(self.root)[longest]["decision"], "approved")

    def test_manifest_payload_carries_review_for_every_plan(self) -> None:
        self.write("v1-pilot.md")
        self.write("subplans/v1-login.md")
        write_review(self.root, "pilot", "approved", "ok")

        payload = scan_plans(self.root).to_payload()

        by_identity = {plan["identity"]: plan for plan in payload["plans"]}
        self.assertEqual(sorted(by_identity), ["pilot", "subplans/login"])
        self.assertEqual(
            by_identity["pilot"]["review"],
            {"identity": "pilot", "decision": "approved", "note": "ok",
             "updatedAt": read_reviews(self.root)["pilot"]["updatedAt"],
             "version": None, "reviewLegacy": True},
        )
        self.assertIn("review", by_identity["subplans/login"])
        self.assertIsNone(by_identity["subplans/login"]["review"])

    def test_reviews_directory_is_never_listed_as_a_plan(self) -> None:
        self.write("v1-pilot.md")
        write_review(self.root, "v1-pilot", "approved", "")

        manifest = scan_plans(self.root)

        self.assertEqual([group.identity for group in manifest.plans], ["pilot"])
        # thư mục của chính box không bị tính là mục lạ
        self.assertFalse(any(".reviews" in warning for warning in manifest.warnings))
        self.assertEqual(manifest.ignored_count, 0)

    def test_new_review_invalidates_manifest_cache(self) -> None:
        self.write("v1-pilot.md")
        self.assertIsNone(scan_plans(self.root).to_payload()["plans"][0]["review"])

        write_review(self.root, "pilot", "changes_requested", "cần sửa")

        self.assertEqual(
            scan_plans(self.root).to_payload()["plans"][0]["review"]["decision"],
            "changes_requested",
        )


def header_block(version: int | str = 2, identity: str = "pilot", parent: int | str | None = 1,
                 slug: str | None = None) -> str:
    """Sinh khối `boxfox-plan` đúng hợp đồng để test không phải viết tay từng dòng."""

    lines = [
        "<!-- boxfox-plan",
        f"Version: v{version}",
        f"Identity: {identity}",
        f"Parent: {'none' if parent is None else f'v{parent}'}",
    ]
    if slug is not None:
        lines.append(f"Slug: {slug}")
    lines.append("-->")
    return "\n".join(lines) + "\n"


class PlanHeaderParseTest(unittest.TestCase):
    """`parse_plan_header` — hàm thuần, không bao giờ ném, không bao giờ đoán bừa."""

    def test_reads_a_well_formed_block(self) -> None:
        header = plan_files.parse_plan_header(header_block(4, "clinical-patient-record-lookup-research", 3,
                                                            slug="research-patient-record-lookup") + "\n# Plan\n")
        self.assertIsNotNone(header)
        assert header is not None
        self.assertEqual(
            (header.status, header.version, header.identity, header.parent, header.declared_slug),
            ("ok", 4, "clinical-patient-record-lookup-research", 3, "research-patient-record-lookup"),
        )
        # `body_offset` = chỉ số dòng sau `-->` để bên gọi biết phần thân bắt đầu ở đâu
        self.assertEqual(header.body_offset, 6)

    def test_parent_none_and_nested_identity_are_valid(self) -> None:
        header = plan_files.parse_plan_header(header_block(1, "subplans/login", None))
        assert header is not None
        self.assertEqual((header.status, header.parent, header.identity), ("ok", None, "subplans/login"))

    def test_missing_header_is_not_an_error(self) -> None:
        for markdown in ("# Plan\nthân bài\n", "", "\n\n\n"):
            header = plan_files.parse_plan_header(markdown)
            assert header is not None
            self.assertEqual(
                (header.status, header.version, header.identity, header.parent, header.declared_slug, header.body_offset),
                ("missing", None, "", None, None, 0),
            )

    def test_header_beyond_the_line_budget_reads_as_missing(self) -> None:
        markdown = "x\n" * 13 + header_block(1, "pilot", None)
        header = plan_files.parse_plan_header(markdown)
        assert header is not None
        self.assertEqual(header.status, "missing", "13 dòng trước khối là quá xa: chỉ đọc 12 dòng đầu")

    def test_invalid_blocks_never_raise(self) -> None:
        # (markdown, version đọc được, identity đọc được): khoá thiếu/sai thì phần
        # tương ứng phải là None/"" — không được đoán bừa từ tên file.
        cases = {
            "chưa đóng": ("<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: none\n# Plan\n", 1, "pilot"),
            "thiếu khoá": ("<!-- boxfox-plan\nVersion: v1\n-->\n", 1, ""),
            "khoá lặp": ("<!-- boxfox-plan\nVersion: v1\nVersion: v2\nIdentity: pilot\nParent: none\n-->\n", 1, "pilot"),
            "dòng lạ": ("<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nParent: none\nGhi chú\n-->\n", 1, "pilot"),
            "version sai định dạng": ("<!-- boxfox-plan\nVersion: 04\nIdentity: pilot\nParent: none\n-->\n", None, "pilot"),
            "identity hoa": ("<!-- boxfox-plan\nVersion: v1\nIdentity: Pilot\nParent: none\n-->\n", 1, ""),
            "khoá parent sai tên": ("<!-- boxfox-plan\nVersion: v1\nIdentity: pilot\nCha: v1\n-->\n", 1, "pilot"),
        }
        for label, (markdown, version, identity) in cases.items():
            header = plan_files.parse_plan_header(markdown)
            assert header is not None
            self.assertEqual(header.status, "invalid", label)
            self.assertEqual((header.version, header.identity), (version, identity), label)

    def test_non_string_input_returns_none(self) -> None:
        self.assertIsNone(plan_files.parse_plan_header(None))
        self.assertIsNone(plan_files.parse_plan_header(b"<!-- boxfox-plan\n"))


class PlanHeaderScanTest(unittest.TestCase):
    """Quét thư mục: header chỉ để HIỂN THỊ — nhóm plan luôn theo TÊN FILE."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write(self, relative_path: str, content: str = "# Plan\n") -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def versions(self, identity: str):
        manifest = scan_plans(self.root)
        return next(group for group in manifest.plans if group.identity == identity).versions

    def test_matching_header_reads_ok_without_warning(self) -> None:
        self.write("v1-pilot.md", header_block(1, "pilot", None) + "# Kế hoạch\n")

        manifest = scan_plans(self.root)
        version = manifest.plans[0].versions[0]
        self.assertEqual(version.header_status, "ok")
        self.assertEqual(version.header_version, 1)
        self.assertEqual(version.header_identity, "pilot")
        self.assertIsNone(version.declared_parent)
        self.assertIsNone(version.declared_slug)
        self.assertEqual(list(manifest.warnings), [])
        # `status` (trạng thái duyệt) KHÔNG bị header thay thế
        self.assertEqual(version.status, "approved")

    def test_legacy_file_without_header_is_silent(self) -> None:
        self.write("v1-pilot.md", "# Kế hoạch cũ\n")

        manifest = scan_plans(self.root)
        version = manifest.plans[0].versions[0]
        self.assertEqual(version.header_status, "legacy")
        self.assertIsNone(version.header_version)
        self.assertIsNone(version.header_identity)
        self.assertIsNone(version.declared_parent)
        self.assertIsNone(version.declared_slug)
        self.assertEqual(list(manifest.warnings), [], "file cũ không được kèm cảnh báo")

    def test_invalid_header_is_reported_but_file_stays_in_its_group(self) -> None:
        self.write("v2-pilot.md", header_block(1, "pilot", 1).replace("Parent: v1", "Cha: v1"))

        manifest = scan_plans(self.root)
        version = manifest.plans[0].versions[0]
        self.assertEqual(version.header_status, "invalid")
        self.assertEqual(manifest.plans[0].identity, "pilot")
        self.assertEqual(version.version, 2)
        self.assertEqual(len(manifest.warnings), 1)
        self.assertIn("v2-pilot.md", manifest.warnings[0])
        self.assertIn("không dùng được", manifest.warnings[0])

    def test_mismatched_header_is_reported_and_never_moves_the_group(self) -> None:
        # Khối khai v3/nhóm khác nhưng tên file là v4-research-patient-record-lookup.md
        self.write("v4-research-patient-record-lookup.md", header_block(3, "clinical-patient-record-lookup-research", 3) + "# Kế hoạch\n")
        self.write("v3-clinical-patient-record-lookup-research.md", header_block(3, "clinical-patient-record-lookup-research", None) + "# Kế hoạch\n")

        manifest = scan_plans(self.root)
        self.assertEqual([group.identity for group in manifest.plans],
                         ["clinical-patient-record-lookup-research", "research-patient-record-lookup"])
        drifted = next(group for group in manifest.plans if group.identity == "research-patient-record-lookup")
        self.assertEqual([item.version for item in drifted.versions], [4])
        self.assertEqual(drifted.versions[0].header_status, "mismatch")
        # công bố đúng những gì file khai để giao diện nói thật
        self.assertEqual(drifted.versions[0].header_version, 3)
        self.assertEqual(drifted.versions[0].header_identity, "clinical-patient-record-lookup-research")
        self.assertEqual(len(manifest.warnings), 1)
        self.assertIn("nhóm vẫn theo tên file", manifest.warnings[0])

    def test_declared_slug_is_published_only_when_the_header_carries_it(self) -> None:
        self.write("v4-clinical-patient-record-lookup-research.md",
                   header_block(4, "clinical-patient-record-lookup-research", 3,
                                slug="research-patient-record-lookup") + "# Kế hoạch\n")

        version = self.versions("clinical-patient-record-lookup-research")[0]
        self.assertEqual(version.header_status, "ok")
        self.assertEqual(version.declared_parent, 3)
        self.assertEqual(version.declared_slug, "research-patient-record-lookup")

    def test_read_plan_publishes_header_fields_too(self) -> None:
        self.write("v1-pilot.md", header_block(1, "pilot", None) + "# Kế hoạch\n")

        document = read_plan(self.root, "pilot", 1)
        self.assertEqual(document.header_status, "ok")
        self.assertEqual(document.header_version, 1)
        self.assertEqual(document.header_identity, "pilot")
        payload = document.to_payload()
        self.assertEqual(payload["headerStatus"], "ok")
        self.assertIn("markdown", payload)

    def test_payload_shape_keeps_status_and_adds_header_fields(self) -> None:
        self.write("v1-pilot.md", header_block(1, "pilot", None) + "# Kế hoạch\n")
        self.write("v2-pilot.md", "# Cũ\n")

        payload = scan_plans(self.root).to_payload()
        newest, oldest = payload["plans"][0]["versions"]
        # bản mới nhất của nhóm đọc là `draft` (chờ duyệt), bản cũ đã duyệt — như hôm nay
        self.assertEqual(newest["status"], "draft")
        self.assertEqual(newest["headerStatus"], "legacy")
        self.assertEqual(oldest["status"], "approved")
        self.assertEqual(oldest["headerStatus"], "ok")


class PlanReviewVersionTest(unittest.TestCase):
    """Sổ duyệt trong workspace ghi kèm `version` — không đoán số khi thiếu."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        (self.root / "v1-pilot.md").write_text("# Kế hoạch\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_version_is_stored_and_read_back(self) -> None:
        record = write_review(self.root, "pilot", "approved", "ổn", 3)
        self.assertEqual(record["version"], 3)
        self.assertFalse(record["reviewLegacy"])
        self.assertEqual(read_reviews(self.root)["pilot"]["version"], 3)
        self.assertFalse(read_reviews(self.root)["pilot"]["reviewLegacy"])

    def test_junk_versions_are_rejected_and_numeric_strings_are_coerced(self) -> None:
        for bad in (0, -1, True, "0", "-1", "3.5", "v3", "abc", 10**10):
            with self.assertRaises(InvalidPlanRequest, msg=repr(bad)):
                write_review(self.root, "pilot", "approved", "", bad)

        # chuỗi số vẫn nhận (query/JSON của app có thể gửi chuỗi), nhưng phải là số dương
        self.assertEqual(write_review(self.root, "pilot", "approved", "", "3")["version"], 3)

    def test_old_record_without_version_reads_as_null(self) -> None:
        reviews_directory = self.root / ".reviews"
        reviews_directory.mkdir()
        (reviews_directory / "pilot.json").write_text(
            json.dumps({"identity": "pilot", "decision": "approved", "note": "cũ", "updatedAt": 1.0}),
            encoding="utf-8",
        )

        review = read_reviews(self.root)["pilot"]
        self.assertIsNone(review["version"])
        self.assertTrue(review["reviewLegacy"])
        self.assertEqual(scan_plans(self.root).to_payload()["plans"][0]["review"]["version"], None)


if __name__ == "__main__":
    unittest.main()
