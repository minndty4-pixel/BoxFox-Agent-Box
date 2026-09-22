"""A11 (kế hoạch v1 Phần A, D-6) — retention cho `.uploaded_artifacts`.

Bốn điều được khoá ở đây, vì đây là đường **duy nhất** được xoá tệp người dùng tải lên:

1. trần 200 tệp / 500 MiB, xoá **mtime cũ nhất trước**;
2. **không bao giờ** xoá tệp neo số RULE-5 (số cao nhất của mỗi thư mục) — nếu không, bộ đếm A3
   tụt xuống và box cấp lại số đã dùng;
3. `retention(dry_run=True)` không xoá một byte nào (và `prune(dry_run=True)` cũng vậy);
4. đúng **một** hàng `X:` cho cả lượt dọn.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

DOCKER_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOCKER_DIRECTORY))

import upload_files  # noqa: E402


def write_file(root: Path, name: str, size: int, mtime: float) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    os.utime(path, (mtime, mtime))
    return path


class RetentionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name) / upload_files.UPLOAD_DIR_NAME
        self.root.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def names(self) -> list[str]:
        return sorted(os.listdir(self.root))

    # --- 1. trần số tệp -----------------------------------------------------
    def test_file_cap_deletes_oldest_first(self) -> None:
        for index in range(205):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)

        report = upload_files.retention(self.root)

        self.assertEqual(report["removedFiles"], 5)
        self.assertEqual(sorted(report["removed"]), ["1.md", "2.md", "3.md", "4.md", "5.md"])
        self.assertEqual(report["keptFiles"], 200)
        self.assertEqual(report["freedBytes"], 50)

    def test_byte_cap_deletes_until_under_500_mib(self) -> None:
        # 30 tệp × 20 MiB = 600 MiB ⇒ phải xoá ít nhất 100 MiB, tệp cũ nhất trước.
        for index in range(30):
            write_file(self.root, f"{index + 1}.bin", 20 * 1024 * 1024, 1000 + index)

        report = upload_files.retention(self.root)

        self.assertEqual(report["removedFiles"], 5)
        self.assertEqual(report["removed"], ["1.bin", "2.bin", "3.bin", "4.bin", "5.bin"])
        self.assertLessEqual(report["keptBytes"], upload_files.UPLOAD_KEEP_MAX_BYTES)

    # --- 2. cái neo số RULE-5 ----------------------------------------------
    def test_newest_number_is_never_removed_even_when_over_cap(self) -> None:
        # Hàng trăm tệp cùng mtime: nếu chỉ sắp theo mtime thì tệp số cao nhất rất dễ bị xoá.
        for index in range(300):
            write_file(self.root, f"{index + 1}.md", 10, 1000)

        report = upload_files.retention(self.root)

        self.assertEqual(report["removedFiles"], 100)
        self.assertNotIn("300.md", report["removed"])
        self.assertIn("300.md", report["kept"])
        self.assertEqual(report["anchors"], ["300.md"])

    def test_anchor_is_the_highest_number_of_each_directory(self) -> None:
        # Cây con do `mkdirs` tạo cũng có dãy số riêng ⇒ mỗi thư mục một cái neo.
        for index in range(210):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)
        write_file(self.root / "proj" / "src", "1.ts", 10, 500)
        write_file(self.root / "proj" / "src", "9.ts", 10, 400)

        report = upload_files.retention(self.root)

        self.assertIn("9.ts", report["kept"])
        self.assertIn("210.md", report["kept"])

    def test_non_numbered_files_are_still_pruned(self) -> None:
        for index in range(200):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)
        write_file(self.root, "probe.md", 10, 1)  # người vận hành đặt tay, không theo RULE-5

        report = upload_files.retention(self.root)

        self.assertEqual(report["removed"], ["probe.md"])

    def test_protected_paths_are_never_removed_but_still_count_toward_the_cap(self) -> None:
        for index in range(201):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)

        report = upload_files.retention(self.root, protect=[self.root / "1.md"])

        # Tệp được bảo vệ không bị xoá, nhưng vẫn là một tệp trên đĩa ⇒ trần vẫn phải giữ:
        # xoá tệp cũ nhất CÓ THỂ xoá là `2.md`, không phải để thư mục phình thêm một tệp.
        self.assertEqual(report["removed"], ["2.md"])
        self.assertEqual(report["keptFiles"], 200)
        self.assertIn("1.md", report["kept"])
        self.assertIn(str(self.root / "1.md"), report["skippedProtected"])

    # --- 3. dry_run không xoá byte nào --------------------------------------
    def test_retention_dry_run_deletes_nothing(self) -> None:
        for index in range(205):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)

        report = upload_files.retention(self.root, dry_run=True)

        self.assertTrue(report["dryRun"])
        self.assertEqual(report["removedFiles"], 5)
        self.assertEqual(len(self.names()), 205)  # chưa mất tệp nào
        before = sum(path.stat().st_size for path in self.root.iterdir())
        self.assertEqual(before, 2050)
        self.assertNotIn("deleted", report)

    def test_prune_dry_run_deletes_nothing_and_pins_nothing(self) -> None:
        for index in range(205):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)
        pinned: list[dict] = []

        report = upload_files.prune(self.root, session="abc12345", dry_run=True,
                                    journal=lambda payload: pinned.append(payload) or {"id": "X:abc12345-1"})

        self.assertEqual(len(self.names()), 205)
        self.assertEqual(pinned, [])
        self.assertEqual(report["pinned"], [])
        self.assertEqual(report["freedBytes"], 50)

    # --- 4. xoá thật + đúng một hàng `X:` -----------------------------------
    def test_prune_deletes_planned_files_and_pins_exactly_one_marker_row(self) -> None:
        for index in range(210):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)
        pinned: list[dict] = []

        report = upload_files.prune(
            self.root,
            session="abc12345",
            journal=lambda payload: pinned.append(payload) or {"id": "X:abc12345-7"},
        )

        self.assertEqual(len(self.names()), 200)
        self.assertEqual(report["removedFiles"], 10)
        self.assertEqual(report["removedBytes"], 100)
        self.assertEqual(report["freedBytes"], 100)
        self.assertEqual(report["pinned"], ["X:abc12345-7"])
        self.assertEqual(len(pinned), 1)
        record = pinned[0]["record"]
        self.assertEqual(record["kind"], "blocker")
        self.assertEqual(record["status"], "done")
        self.assertEqual(record["actor"], "box-retention")
        self.assertIn("bỏ 10 tệp / 100 B", record["text"])
        self.assertEqual(record["numbers"]["removedFiles"], 10)
        self.assertEqual(pinned[0]["session"], "abc12345")

    def test_prune_without_session_writes_no_marker(self) -> None:
        for index in range(205):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)
        pinned: list[dict] = []

        report = upload_files.prune(self.root, journal=lambda payload: pinned.append(payload))

        self.assertEqual(report["removedFiles"], 5)
        self.assertEqual(pinned, [])
        self.assertEqual(report["pinned"], [])

    def test_prune_with_nothing_to_remove_writes_no_marker(self) -> None:
        write_file(self.root, "1.md", 10, 1000)
        pinned: list[dict] = []

        report = upload_files.prune(self.root, session="abc12345",
                                    journal=lambda payload: pinned.append(payload))

        self.assertEqual(report["removedFiles"], 0)
        self.assertEqual(pinned, [])
        self.assertEqual(self.names(), ["1.md"])

    def test_missing_root_is_reported_not_raised(self) -> None:
        report = upload_files.retention(self.root / "khong-ton-tai")
        self.assertTrue(report["ok"])
        self.assertEqual(report["removedFiles"], 0)
        self.assertEqual(report["keptFiles"], 0)

    def test_symlink_is_not_followed_or_deleted(self) -> None:
        for index in range(200):
            write_file(self.root, f"{index + 1}.md", 10, 1000 + index)
        outside = Path(self.temporary_directory.name) / "outside.md"
        outside.write_bytes(b"secret")
        os.symlink(outside, self.root / "link.md")

        report = upload_files.retention(self.root)

        self.assertEqual(report["removedFiles"], 0)
        self.assertTrue(outside.exists())
        self.assertIn(str(self.root / "link.md"), report["skippedProtected"])


class SessionOpsWiringTest(unittest.TestCase):
    """`uploads_prune` phải nằm trong `OPS` để `worker.py` gọi được qua `run_op`."""

    def test_uploads_prune_is_registered(self) -> None:
        import session_ops

        self.assertIn("uploads_prune", session_ops.OPS)
        self.assertIs(session_ops.OPS["uploads_prune"], session_ops.op_uploads_prune)

    def test_run_op_delegates_to_upload_files_prune(self) -> None:
        import session_ops

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / upload_files.UPLOAD_DIR_NAME
            root.mkdir(parents=True)
            for index in range(205):
                write_file(root, f"{index + 1}.md", 10, 1000 + index)

            result = session_ops.run_op("uploads_prune", {"uploadRoot": str(root), "dryRun": True})

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["removedFiles"], 5)
        self.assertTrue(result["dryRun"])


if __name__ == "__main__":
    unittest.main()
