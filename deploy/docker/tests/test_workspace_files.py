"""Kiểm thử module ``workspace_files`` (mặt box) trên thư mục tạm.

Đặt ``AGENT_WORKSPACE`` TRƯỚC khi import để module đọc đúng root; mỗi test lại
dùng một thư mục tạm riêng và patch ``WORKSPACE_ROOT`` để cô lập.
"""

from __future__ import annotations

import atexit
import io
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOCKER_DIRECTORY))

# Đặt env TRƯỚC import — workspace_files đọc AGENT_WORKSPACE lúc import. Mọi test
# đều patch WORKSPACE_ROOT cho thư mục tạm riêng, nên thư mục boot này chỉ là giá
# trị mặc định an toàn (dọn qua atexit, tránh ResourceWarning của TemporaryDirectory).
_BOOT_DIR = tempfile.mkdtemp(prefix="wf-boot-")
os.environ["AGENT_WORKSPACE"] = _BOOT_DIR
atexit.register(shutil.rmtree, _BOOT_DIR, ignore_errors=True)

import workspace_files  # noqa: E402
from workspace_files import (  # noqa: E402
    InvalidWorkspacePath,
    WorkspaceConflict,
    WorkspaceEncoding,
    WorkspaceFileError,
    WorkspaceNotFound,
    WorkspaceRangeNotSatisfiable,
    WorkspaceTooLarge,
    build_zip,
    confidentiality_for,
    delete_entry,
    extract_zip,
    integrity_for,
    list_directory,
    make_directory,
    move_entry,
    parse_range,
    read_content,
    rename_entry,
    touch_file,
    validate_rel_path,
    write_as_agent,
    write_upload,
)


class WorkspaceFilesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self._previous_root = workspace_files.WORKSPACE_ROOT
        workspace_files.WORKSPACE_ROOT = self.root

    def tearDown(self) -> None:
        workspace_files.WORKSPACE_ROOT = self._previous_root
        self.temporary_directory.cleanup()

    def write(self, relative_path: str, content: bytes | str = b"data") -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
        return path

    # --- validate_rel_path ---
    def test_validate_rel_path_rejects_unsafe(self) -> None:
        for bad in ("/etc/passwd", "../secret", "a/../b", "a/../../b", "C:\\x", "a\x00b"):
            with self.assertRaises(InvalidWorkspacePath):
                validate_rel_path(bad)

    def test_validate_rel_path_accepts_root_and_normalizes(self) -> None:
        self.assertEqual(validate_rel_path(""), "")
        self.assertEqual(validate_rel_path("a/./b/"), "a/b")
        self.assertEqual(validate_rel_path("src/parser.py"), "src/parser.py")

    def test_validate_rel_path_rejects_too_deep(self) -> None:
        deep = "/".join(["d"] * (workspace_files.MAX_DEPTH + 1))
        with self.assertRaises(InvalidWorkspacePath):
            validate_rel_path(deep)

    # --- list_directory ---
    def test_list_directory_sort_and_skip_symlink_and_generated(self) -> None:
        self.write("zfile.txt", "z")
        self.write("afile.py", "a")
        (self.root / "zdir").mkdir()
        (self.root / "adir").mkdir()
        (self.root / ".generated_artifacts").mkdir()  # phải bị ẩn
        (self.root / ".generated_artifacts" / "thumbnails").mkdir()
        os.symlink(self.write("real.txt", "real"), self.root / "link.txt")
        self.write(".env", "secret")  # file dot thật phải hiện

        listing = list_directory("")
        names = [entry["name"] for entry in listing["entries"]]
        kinds = [entry["kind"] for entry in listing["entries"]]
        # dir trước file, rồi theo tên (so sánh chuỗi: '.env' < 'afile.py' < 'real.txt' < 'zfile.txt')
        self.assertEqual(names, ["adir", "zdir", ".env", "afile.py", "real.txt", "zfile.txt"])
        self.assertEqual(kinds[:2], ["dir", "dir"])
        self.assertNotIn(".generated_artifacts", names)
        self.assertNotIn("link.txt", names)  # symlink bị bỏ

    def test_list_directory_breadcrumb_and_dir_labels(self) -> None:
        (self.root / "frontend" / "src").mkdir(parents=True)
        self.write("frontend/src/App.tsx", "x")
        listing = list_directory("frontend/src")
        self.assertEqual(
            [crumb["path"] for crumb in listing["breadcrumb"]],
            ["", "frontend", "frontend/src"],
        )
        file_entry = next(e for e in listing["entries"] if e["name"] == "App.tsx")
        self.assertEqual(file_entry["kind"], "file")
        self.assertEqual(file_entry["language"], "typescript")
        self.assertEqual(file_entry["ext"], "tsx")
        self.assertEqual(file_entry["integrity"], "duoc_nguoi_dung_cho_phep")
        self.assertEqual(file_entry["confidentiality"], "cong_khai")

    def test_list_directory_truncates_at_max_entries(self) -> None:
        for index in range(workspace_files.MAX_ENTRIES + 5):
            self.write(f"f{index:04d}.txt", b"x")
        listing = list_directory("")
        self.assertTrue(listing.get("truncated"))
        self.assertEqual(len(listing["entries"]), workspace_files.MAX_ENTRIES)

    # --- read_content ---
    def test_read_content_too_large_raises_413(self) -> None:
        self.write("big.txt", b"x" * (workspace_files.MAX_FILE_SIZE + 1))
        with self.assertRaises(WorkspaceTooLarge) as caught:
            read_content("big.txt")
        self.assertEqual(caught.exception.status_code, 413)

    def test_read_content_non_utf8_raises_422(self) -> None:
        self.write("bin.dat", b"\xff\xfe\x00bad")
        with self.assertRaises(WorkspaceEncoding) as caught:
            read_content("bin.dat")
        self.assertEqual(caught.exception.status_code, 422)

    def test_read_content_returns_text(self) -> None:
        self.write("a.py", "print('hi')\n")
        payload = read_content("a.py")
        self.assertEqual(payload["content"], "print('hi')\n")
        self.assertEqual(payload["language"], "python")
        self.assertFalse(payload["binary"])
        self.assertEqual(payload["sizeBytes"], len("print('hi')\n"))

    def test_read_content_not_a_regular_file_raises_404(self) -> None:
        (self.root / "sub").mkdir()
        with self.assertRaises(WorkspaceNotFound):
            read_content("sub")

    # --- provenance heuristic ---
    def test_integrity_for_vendor_and_plan(self) -> None:
        self.assertEqual(integrity_for("vendor/lib/README.md"), "khong_tin_duoc")
        self.assertEqual(integrity_for("node_modules/x/index.js"), "khong_tin_duoc")
        self.assertEqual(integrity_for("dist/main.js"), "khong_tin_duoc")
        self.assertEqual(integrity_for("plan.md"), "khong_tin_duoc")
        # basename == plan.md ở bất kỳ thư mục nào cũng không tin (theo heuristic)
        self.assertEqual(integrity_for("docs/plan.md"), "khong_tin_duoc")
        self.assertEqual(integrity_for("src/parser.py"), "duoc_nguoi_dung_cho_phep")

    def test_confidentiality_for_secret_basenames(self) -> None:
        self.assertEqual(confidentiality_for(".env"), "bi_mat")
        self.assertEqual(confidentiality_for(".env.local"), "bi_mat")
        self.assertEqual(confidentiality_for("server.key"), "bi_mat")
        self.assertEqual(confidentiality_for("cert.pem"), "bi_mat")
        self.assertEqual(confidentiality_for("id_rsa"), "bi_mat")
        self.assertEqual(confidentiality_for("id_ed25519"), "bi_mat")
        self.assertEqual(confidentiality_for("README.md"), "cong_khai")
        # .env giữ integrity tin cậy nhưng confidentiality bí mật (khớp mock)
        self.assertEqual(integrity_for(".env"), "duoc_nguoi_dung_cho_phep")
        self.assertEqual(confidentiality_for(".env"), "bi_mat")

    # --- zip roundtrip + zip-slip ---
    def test_build_zip_and_extract_zip_roundtrip(self) -> None:
        self.write("a.txt", "hello")
        (self.root / "zips").mkdir()
        (self.root / "sub").mkdir()
        self.write("sub/b.txt", "world")
        data = build_zip(["a.txt", "sub"])
        # zip phải là archive hợp lệ và chứa đúng arcname tương đối
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            self.assertIn("a.txt", zf.namelist())
            self.assertIn("sub/b.txt", zf.namelist())

        (self.root / "zips" / "round.zip").write_bytes(data)
        result = extract_zip("zips/round.zip")  # giải nén vào "zips"
        self.assertEqual(result["extracted"], 2)
        self.assertEqual((self.root / "zips" / "a.txt").read_text(), "hello")
        self.assertEqual((self.root / "zips" / "sub" / "b.txt").read_text(), "world")

    def test_extract_zip_skips_existing_files(self) -> None:
        (self.root / "zips").mkdir()
        # File đích đã tồn tại sẵn → extract phải SKIP, không ghi đè.
        (self.root / "zips" / "note.txt").write_text("PREEXISTING")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("note.txt", "NEW")
        (self.root / "zips" / "dup.zip").write_bytes(buf.getvalue())
        result = extract_zip("zips/dup.zip")
        self.assertEqual(result["extracted"], 0)
        self.assertEqual(result["skipped"], 1)
        # Nội dung cũ được giữ nguyên (không bị ghi đè)
        self.assertEqual((self.root / "zips" / "note.txt").read_text(), "PREEXISTING")

    def test_extract_zip_rejects_zip_slip(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../evil.txt", "pwned")
        (self.root / "zips").mkdir()
        (self.root / "zips" / "evil.zip").write_bytes(buf.getvalue())
        with self.assertRaises(WorkspaceConflict) as caught:
            extract_zip("zips/evil.zip")
        self.assertEqual(caught.exception.status_code, 409)
        # fileescape không thoát ra ngoài
        self.assertFalse((self.root / "evil.txt").exists())

    def test_extract_zip_rejects_absolute_member(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("/etc/evil.txt", "pwned")
        (self.root / "zips").mkdir()
        (self.root / "zips" / "abs.zip").write_bytes(buf.getvalue())
        with self.assertRaises(WorkspaceConflict):
            extract_zip("zips/abs.zip")

    def test_build_zip_rejects_bad_path(self) -> None:
        with self.assertRaises(InvalidWorkspacePath):
            build_zip(["../etc/passwd"])
        with self.assertRaises(InvalidWorkspacePath):
            build_zip(["/etc/passwd"])
        with self.assertRaises(WorkspaceNotFound):
            build_zip(["missing.txt"])

    # --- parse_range ---
    def test_parse_range_valid_forms(self) -> None:
        size = 1000
        self.assertEqual(parse_range("bytes=0-99", size), (0, 99))
        self.assertEqual(parse_range("bytes=0-", size), (0, 999))
        self.assertEqual(parse_range("bytes=-16", size), (984, 999))
        self.assertEqual(parse_range("bytes=500-2000", size), (500, 999))  # end kẹp về size-1
        self.assertIsNone(parse_range(None, size))
        self.assertIsNone(parse_range("", size))

    def test_parse_range_invalid_raises_416(self) -> None:
        size = 32
        with self.assertRaises(WorkspaceRangeNotSatisfiable):
            parse_range("bytes=100-200", size)  # start >= size
        with self.assertRaises(WorkspaceRangeNotSatisfiable):
            parse_range("bytes=abc", size)
        with self.assertRaises(WorkspaceRangeNotSatisfiable):
            parse_range("bytes=-0", size)
        with self.assertRaises(WorkspaceRangeNotSatisfiable):
            parse_range("bytes=10-5", size)  # end < start

    # --- write_upload / write_as_agent ---
    def test_write_upload_creates_file_with_mode_and_returns_path(self) -> None:
        result = write_upload("", "uploaded.txt", [b"hello world"], 11)
        self.assertEqual(result, {"path": "uploaded.txt", "sizeBytes": 11})
        path = self.root / "uploaded.txt"
        self.assertTrue(path.exists())
        self.assertEqual(path.read_text(), "hello world")
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)
        if os.geteuid() == 0:
            self.assertEqual(path.stat().st_uid, workspace_files.AGENT_UID)
            self.assertEqual(path.stat().st_gid, workspace_files.AGENT_GID)

    def test_write_upload_into_subdir(self) -> None:
        (self.root / "sub").mkdir()
        result = write_upload("sub", "x.bin", [b"\x00\x01"], 2)
        self.assertEqual(result["path"], "sub/x.bin")
        self.assertEqual((self.root / "sub" / "x.bin").read_bytes(), b"\x00\x01")

    def test_write_upload_rejects_bad_filename(self) -> None:
        for bad in ("", ".", "..", "a/b", "a\\b", "a\x00b", "./x"):
            with self.assertRaises(InvalidWorkspacePath):
                write_upload("", bad, [b"x"], 1)

    def test_write_upload_missing_target_dir_raises_404(self) -> None:
        with self.assertRaises(WorkspaceNotFound):
            write_upload("nope", "x.txt", [b"x"], 1)

    def test_write_as_agent_refuses_symlink_target(self) -> None:
        os.symlink(self.write("real.txt", "r"), self.root / "link.txt")
        with self.assertRaises(WorkspaceConflict):
            write_as_agent("", "link.txt", [b"pwned"])

    def test_write_upload_enforces_size_hint(self) -> None:
        with self.assertRaises(WorkspaceTooLarge):
            write_upload("", "big.txt", [b"x"], workspace_files.MAX_UPLOAD_SIZE + 1)


class WorkspaceWriteApiTest(unittest.TestCase):
    """Đợt 3: mkdir/touch/rename/move/delete trên thư mục tạm thật.

    Hợp đồng: docs/plan/next-batch-contract.md §2 (bảng route container). Mỗi hàm
    được kiểm bằng trạng thái thật trên đĩa (không mock), kèm các đường từ chối:
    thoát khỏi WORKSPACE_ROOT, đích đã tồn tại (409), tên rename sai (400), mục bảo
    vệ (`.plans`/`.trash`/`.generated_artifacts`/thư mục gốc).
    """

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self._previous_root = workspace_files.WORKSPACE_ROOT
        workspace_files.WORKSPACE_ROOT = self.root

    def tearDown(self) -> None:
        workspace_files.WORKSPACE_ROOT = self._previous_root
        self.temporary_directory.cleanup()

    def write(self, relative_path: str, content: bytes | str = b"data") -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
        return path

    def trash_names(self) -> list[str]:
        return sorted(path.name for path in (self.root / ".trash").iterdir())

    # --- mkdir ---
    def test_make_directory_creates_parents_and_returns_contract_shape(self) -> None:
        self.assertEqual(make_directory("src/new"), {"path": "src/new", "type": "directory"})
        created = self.root / "src" / "new"
        self.assertTrue(created.is_dir())
        self.assertEqual(created.stat().st_mode & 0o777, 0o750)
        if os.geteuid() == 0:
            self.assertEqual(created.stat().st_uid, workspace_files.AGENT_UID)
            self.assertEqual(created.stat().st_gid, workspace_files.AGENT_GID)

    def test_make_directory_conflicts_and_exist_ok(self) -> None:
        make_directory("a")
        with self.assertRaises(WorkspaceConflict) as caught:
            make_directory("a")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(
            make_directory("a", exist_ok=True), {"path": "a", "type": "directory"}
        )
        # exist_ok không được biến file thường thành thư mục
        self.write("plain.txt")
        with self.assertRaises(WorkspaceConflict) as caught:
            make_directory("plain.txt", exist_ok=True)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertTrue((self.root / "plain.txt").is_file())

    def test_make_directory_rejects_escape_depth_and_root(self) -> None:
        deep = "/".join(["d"] * (workspace_files.MAX_DEPTH + 1))
        for bad in ("/abs", "../out", "a/../../out", "C:\\out", "a\x00b", deep):
            with self.assertRaises(InvalidWorkspacePath):
                make_directory(bad)
        with self.assertRaises(InvalidWorkspacePath):
            make_directory("")
        # không có gì được tạo ra ngoài (hay ngay trong) workspace
        self.assertEqual([path.name for path in self.root.iterdir()], [])

    # --- touch ---
    def test_touch_creates_empty_and_content_files(self) -> None:
        self.assertEqual(
            touch_file("src/new.md"), {"path": "src/new.md", "type": "file", "size": 0}
        )
        empty = self.root / "src" / "new.md"
        self.assertEqual(empty.read_bytes(), b"")
        self.assertEqual(empty.stat().st_mode & 0o777, 0o640)
        if os.geteuid() == 0:
            self.assertEqual(empty.stat().st_uid, workspace_files.AGENT_UID)
            self.assertEqual(empty.stat().st_gid, workspace_files.AGENT_GID)
        payload = "# ghi chú\n"
        self.assertEqual(
            touch_file("notes.md", payload),
            {"path": "notes.md", "type": "file", "size": len(payload.encode("utf-8"))},
        )
        self.assertEqual((self.root / "notes.md").read_text(encoding="utf-8"), payload)
        # file do touch tạo ra luôn đọc được (không vượt MAX_FILE_SIZE của read_content)
        self.assertEqual(read_content("notes.md")["content"], payload)

    def test_touch_conflicts_and_guards(self) -> None:
        touch_file("a.md")
        with self.assertRaises(WorkspaceConflict) as caught:
            touch_file("a.md", "ghi đè")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual((self.root / "a.md").read_bytes(), b"")  # nội dung cũ giữ nguyên
        with self.assertRaises(WorkspaceTooLarge) as caught:
            touch_file("big.md", "x" * (workspace_files.MAX_TOUCH_CONTENT_BYTES + 1))
        self.assertEqual(caught.exception.status_code, 413)
        self.assertFalse((self.root / "big.md").exists())
        for bad_content in ({"khong": "phai chuoi"}, 5):
            with self.assertRaises(InvalidWorkspacePath):
                touch_file("z.md", bad_content)
        for bad_path in ("../out.md", "/tmp/out.md", ""):
            with self.assertRaises(InvalidWorkspacePath):
                touch_file(bad_path)
        self.assertFalse((self.root.parent / "out.md").exists())

    # --- rename ---
    def test_rename_stays_inside_its_directory(self) -> None:
        self.write("src/a.md", "nội dung")
        self.assertEqual(
            rename_entry("src/a.md", "b.md"), {"path": "src/a.md", "newPath": "src/b.md"}
        )
        self.assertFalse((self.root / "src" / "a.md").exists())
        self.assertEqual((self.root / "src" / "b.md").read_text(encoding="utf-8"), "nội dung")

    def test_rename_conflicts_and_invalid_names(self) -> None:
        self.write("a.md")
        self.write("b.md", "đích")
        with self.assertRaises(WorkspaceConflict) as caught:
            rename_entry("a.md", "b.md")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual((self.root / "b.md").read_text(encoding="utf-8"), "đích")
        # đổi tên thành chính nó cũng là "đích đã tồn tại" theo hợp đồng
        with self.assertRaises(WorkspaceConflict):
            rename_entry("a.md", "a.md")
        for bad_name in ("", ".", "..", "sub/b.md", "/abs.md", "a\x00b", 5, None):
            with self.assertRaises(InvalidWorkspacePath):
                rename_entry("a.md", bad_name)
        with self.assertRaises(WorkspaceNotFound) as caught:
            rename_entry("missing.md", "x.md")
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(InvalidWorkspacePath):
            rename_entry("", "x.md")
        with self.assertRaises(InvalidWorkspacePath):
            rename_entry("../outside.md", "x.md")

    # --- move ---
    def test_move_into_existing_directory(self) -> None:
        self.write("src/a.md", "payload")
        make_directory("docs")
        self.assertEqual(
            move_entry("src/a.md", "docs"), {"path": "src/a.md", "newPath": "docs/a.md"}
        )
        self.assertFalse((self.root / "src" / "a.md").exists())
        self.assertEqual((self.root / "docs" / "a.md").read_text(encoding="utf-8"), "payload")

    def test_move_to_root_and_nested_destination(self) -> None:
        self.write("src/a.md")
        self.assertEqual(move_entry("src/a.md", ""), {"path": "src/a.md", "newPath": "a.md"})
        make_directory("tree/child")
        self.write("tree/child/x.txt", "x")
        self.assertEqual(
            move_entry("tree/child/x.txt", "tree"),
            {"path": "tree/child/x.txt", "newPath": "tree/x.txt"},
        )
        self.assertTrue((self.root / "tree" / "x.txt").is_file())

    def test_move_conflicts_missing_destination_and_escape(self) -> None:
        self.write("a.md")
        self.write("docs/a.md", "đích")
        with self.assertRaises(WorkspaceConflict) as caught:
            move_entry("a.md", "docs")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual((self.root / "docs" / "a.md").read_text(encoding="utf-8"), "đích")
        with self.assertRaises(WorkspaceNotFound) as caught:
            move_entry("a.md", "missing-dir")
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(InvalidWorkspacePath):
            move_entry("a.md", "../outside")
        with self.assertRaises(InvalidWorkspacePath):
            move_entry("", "docs")
        with self.assertRaises(WorkspaceNotFound):
            move_entry("missing.md", "docs")

    def test_move_directory_into_itself_is_conflict(self) -> None:
        make_directory("tree/child")
        with self.assertRaises(WorkspaceConflict):
            move_entry("tree", "tree")
        with self.assertRaises(WorkspaceConflict):
            move_entry("tree", "tree/child")
        self.assertTrue((self.root / "tree" / "child").is_dir())

    # --- delete ---
    def test_rename_and_move_refuse_protected_entries(self) -> None:
        """Cùng luật bảo vệ như `delete`, ở cả nguồn lẫn thư mục đích."""

        for name in (".plans", ".trash", ".generated_artifacts"):
            (self.root / name).mkdir()
        self.write(".plans/v1-pilot.md", "# plan\n")

        for protected in (".plans", ".trash", ".generated_artifacts"):
            with self.assertRaises(WorkspaceConflict) as caught:
                rename_entry(protected, "moved-away")
            self.assertEqual(caught.exception.status_code, 409)
            with self.assertRaises(WorkspaceConflict) as caught:
                move_entry(protected, "src")
            self.assertEqual(caught.exception.status_code, 409)
        # đích cấp 1 bảo vệ cũng bị chặn (không dựng được `.trash` sau lưng delete)
        for destination in (".plans", ".trash", ".generated_artifacts"):
            with self.assertRaises(WorkspaceConflict) as caught:
                move_entry("a.md", destination)
            self.assertEqual(caught.exception.status_code, 409)
        # không thao tác nào chạm đĩa
        for name in (".plans", ".trash", ".generated_artifacts"):
            self.assertTrue((self.root / name).is_dir())
        self.assertTrue((self.root / ".plans" / "v1-pilot.md").is_file())
        self.assertFalse((self.root / "moved-away").exists())
        self.assertEqual(self.trash_names(), [])

        # mục con của mục bảo vệ vẫn đổi tên/di chuyển bình thường
        make_directory("docs")
        self.assertEqual(
            rename_entry(".plans/v1-pilot.md", "v2-pilot.md"),
            {"path": ".plans/v1-pilot.md", "newPath": ".plans/v2-pilot.md"},
        )
        self.assertEqual(
            move_entry(".plans/v2-pilot.md", "docs"),
            {"path": ".plans/v2-pilot.md", "newPath": "docs/v2-pilot.md"},
        )

    def test_delete_moves_to_trash_and_hides_trash_from_listing(self) -> None:
        self.write("docs/a.md", "bye")
        result = delete_entry("docs/a.md")
        self.assertEqual(result["path"], "docs/a.md")
        trash_path = result["trashPath"]
        self.assertTrue(trash_path.startswith(".trash/"))
        # tên trong thùng rác đúng dạng `<epoch>-<tên gốc>`
        epoch, separator, original = trash_path[len(".trash/"):].partition("-")
        self.assertEqual(separator, "-")
        self.assertEqual(original, "a.md")
        self.assertTrue(epoch.isdigit())
        self.assertFalse((self.root / "docs" / "a.md").exists())
        trashed = self.root / ".trash" / f"{epoch}-{original}"
        self.assertEqual(trashed.read_text(encoding="utf-8"), "bye")
        # `.trash` bị loại khỏi listing của GET /__box/files
        names = [entry["name"] for entry in list_directory("")["entries"]]
        self.assertNotIn(".trash", names)
        self.assertIn("docs", names)
        # `.trash` cũng không lọt vào zip workspace
        self.assertEqual([name for name, _ in workspace_files._iter_regular_files("")], [])

    def test_delete_directory_and_missing_entry(self) -> None:
        make_directory("tree/child")
        self.write("tree/child/x.txt", "x")
        result = delete_entry("tree")
        self.assertEqual(result["path"], "tree")
        self.assertEqual(result["trashPath"].split("/", 1)[0], ".trash")
        self.assertFalse((self.root / "tree").exists())
        trashed = self.root / result["trashPath"]
        self.assertTrue(trashed.is_dir())
        self.assertEqual((trashed / "child" / "x.txt").read_text(encoding="utf-8"), "x")
        with self.assertRaises(WorkspaceNotFound) as caught:
            delete_entry("tree")
        self.assertEqual(caught.exception.status_code, 404)

    def test_delete_trash_names_stay_unique_within_one_second(self) -> None:
        self.write("a.md")
        first = delete_entry("a.md")
        self.write("a.md")
        second = delete_entry("a.md")
        self.assertNotEqual(first["trashPath"], second["trashPath"])
        names = self.trash_names()
        self.assertEqual(len(names), 2)
        for name in names:
            self.assertTrue(name.endswith("-a.md"), name)
        self.assertTrue(names[1].startswith(names[0].split("-", 1)[0] + "-"))

    def test_delete_refuses_root_and_protected_entries(self) -> None:
        for name in (".plans", ".trash", ".generated_artifacts"):
            (self.root / name).mkdir()
        self.write(".plans/v1-pilot.md", "# plan\n")
        for protected in ("", ".plans", ".trash", ".generated_artifacts"):
            with self.assertRaises(WorkspaceConflict) as caught:
                delete_entry(protected)
            self.assertEqual(caught.exception.status_code, 409)
        for name in (".plans", ".trash", ".generated_artifacts"):
            self.assertTrue((self.root / name).exists())
        self.assertEqual(self.trash_names(), [])
        # mục con của `.plans` không phải "chính .plans" → vẫn xoá mềm được
        self.assertTrue(
            delete_entry(".plans/v1-pilot.md")["trashPath"].startswith(".trash/")
        )
        self.assertFalse((self.root / ".plans" / "v1-pilot.md").exists())

    def test_delete_rejects_escape_and_depth(self) -> None:
        deep = "/".join(["a"] * (workspace_files.MAX_DEPTH + 1))
        for bad in ("/etc/passwd", "../outside", "a/../../outside", "C:\\x", "a\x00b", deep):
            with self.assertRaises(InvalidWorkspacePath):
                delete_entry(bad)
        with self.assertRaises(WorkspaceConflict):
            delete_entry("")
        self.assertFalse((self.root / ".trash").exists())

    @unittest.skipIf(os.name == "nt", "Symlink tests require POSIX environment")
    def test_delete_symlink_entry_does_not_touch_target(self) -> None:
        target = self.write("real.md", "real")
        os.symlink(target, self.root / "link.md")
        delete_entry("link.md")
        self.assertTrue(target.exists())
        self.assertEqual(target.read_text(encoding="utf-8"), "real")
        self.assertFalse((self.root / "link.md").exists())

    @unittest.skipIf(os.name == "nt", "Symlink tests require POSIX environment")
    def test_write_apis_refuse_symlinked_parent(self) -> None:
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        os.symlink(outside.name, self.root / "link-dir")
        for call in (touch_file, make_directory):
            with self.assertRaises(WorkspaceFileError) as caught:
                call("link-dir/x.md")
            self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(list(os.scandir(outside.name)), [])


if __name__ == "__main__":
    unittest.main()
