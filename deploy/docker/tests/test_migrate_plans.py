"""`migrate_plans.py` — nạp header cho tệp `.plans` cũ, mặc định KHÔNG ghi gì.

Sáu ca mà plan đợt 20 đặt tên: dry-run không ghi byte nào; `--apply` chèn header đúng cú pháp
`plan_files.py` đọc; chạy lại lần hai vô hại (idempotent); `--merge` đổi tên CẢ nhóm và từ chối khi
tên đích đã tồn tại; `--renumber-lone` mặc định tắt và khi bật thì đổi `vN-…` thành `v1-…`; tham số
sai bị từ chối bằng lỗi có mã chứ không đoán.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEPLOY = REPO / "deploy" / "docker"


def load_migrate():
    """Nạp `migrate_plans.py` theo đường dẫn (tệp nằm trong box, không phải gói Python)."""
    if str(DEPLOY) not in sys.path:
        sys.path.insert(0, str(DEPLOY))
    spec = importlib.util.spec_from_file_location("migrate_plans", DEPLOY / "migrate_plans.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migrate = load_migrate()


class MigratePlansTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / ".plans"
        self.root.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, name: str, body: str = "# Kế hoạch\n\n## Milestones\n1. Việc.\n") -> Path:
        path = self.root / name
        path.write_text(body, encoding="utf-8")
        return path

    def test_a_dry_run_writes_nothing_and_reports_the_plan(self) -> None:
        path = self.write("v5-itsdangerous-helper.md")
        before = path.read_bytes()

        report = migrate.run(self.root, apply=False)

        self.assertEqual(path.read_bytes(), before, "dry-run không được ghi một byte nào")
        self.assertEqual(report["headers"], [
            {"action": "header", "path": "v5-itsdangerous-helper.md", "identity": "itsdangerous-helper",
             "version": 5, "parent": None}])
        self.assertFalse(report["nothingToDo"])
        self.assertEqual(report["wrote"], 0)

    def test_apply_inserts_a_header_the_plan_reader_accepts(self) -> None:
        self.write("v5-itsdangerous-helper.md")
        self.write("v3-clinical-record.md", "# Bản 3\n\n## Milestones\n1. Việc.\n")
        self.write("v4-clinical-record.md", "# Bản 4\n\n## Milestones\n1. Việc.\n")

        report = migrate.run(self.root, apply=True)

        self.assertEqual(report["wrote"], 3)
        head = (self.root / "v4-clinical-record.md").read_text(encoding="utf-8").split("\n")
        self.assertEqual(head[:6], ["<!-- boxfox-plan", "Version: v4", "Identity: clinical-record",
                                    "Parent: v3", "Slug: clinical-record", "-->"])
        # Bản đầu của nhóm không có cha; bản lẻ cũng vậy.
        first = (self.root / "v3-clinical-record.md").read_text(encoding="utf-8")
        self.assertIn("Parent: none", first)
        self.assertIn("Parent: none", (self.root / "v5-itsdangerous-helper.md").read_text(encoding="utf-8"))
        # Cú pháp phải qua được ĐÚNG bộ đọc của box, không chỉ qua con mắt của test này.
        import plan_files

        header = plan_files.parse_plan_header((self.root / "v4-clinical-record.md").read_text(encoding="utf-8"))
        self.assertIsNotNone(header)
        self.assertEqual(header.status, "ok")
        self.assertEqual((header.version, header.identity, header.parent), (4, "clinical-record", 3))
        self.assertEqual(header.body_offset, 6, "thân kế hoạch bắt đầu ngay sau khối 6 dòng")

    def test_running_twice_is_harmless(self) -> None:
        self.write("v2-something.md")
        migrate.run(self.root, apply=True)
        after_first = (self.root / "v2-something.md").read_bytes()

        second = migrate.run(self.root, apply=True)

        self.assertTrue(second["nothingToDo"])
        self.assertEqual(second["wrote"], 0)
        self.assertEqual((self.root / "v2-something.md").read_bytes(), after_first,
                         "chạy lại không được chèn header thứ hai")

    def test_rerunning_the_same_merge_command_is_a_no_op_with_a_warning(self) -> None:
        self.write("v3-research-record-lookup.md", "# Bản 3\n\n## Milestones\n1. Việc.\n")
        self.write("v4-research-record-lookup.md", "# Bản 4\n\n## Milestones\n1. Việc.\n")
        merge = ("research-record-lookup=clinical-record-lookup",)
        migrate.run(self.root, apply=True, merges=merge)
        snapshot = {path.name: path.read_bytes() for path in sorted(self.root.glob("*.md"))}

        again = migrate.run(self.root, apply=True, merges=merge)

        self.assertTrue(again["nothingToDo"], "lần hai không còn gì để làm")
        self.assertEqual(again["wrote"], 0)
        self.assertEqual(again["renamed"], 0)
        self.assertEqual(len(again["warnings"]), 1)
        self.assertIn("nhóm nguồn 'research-record-lookup' không còn", again["warnings"][0])
        self.assertEqual({path.name: path.read_bytes() for path in sorted(self.root.glob("*.md"))}, snapshot)

    def test_merge_renames_the_whole_group_and_refuses_an_existing_target(self) -> None:
        self.write("v3-research-record-lookup.md", "# Bản 3\n\n## Milestones\n1. Việc.\n")
        self.write("v4-research-record-lookup.md", "# Bản 4\n\n## Milestones\n1. Việc.\n")

        report = migrate.run(self.root, apply=True,
                             merges=("research-record-lookup=clinical-record-lookup",))

        self.assertEqual([item["renameTo"] for item in report["merges"]],
                         ["v3-clinical-record-lookup.md", "v4-clinical-record-lookup.md"])
        self.assertFalse((self.root / "v3-research-record-lookup.md").exists())
        renamed = (self.root / "v4-clinical-record-lookup.md").read_text(encoding="utf-8")
        self.assertIn("Identity: clinical-record-lookup", renamed)
        self.assertIn("Parent: v3", renamed, "bản thứ hai của nhóm gộp phải trỏ về bản thứ nhất")

        # Tên đích đã tồn tại ⇒ từ chối, không bao giờ ghi đè một kế hoạch.
        self.write("v3-itsdangerous-helper.md")
        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, merges=("itsdangerous-helper=clinical-record-lookup",))
        self.assertIn("đã tồn tại", str(caught.exception))
        self.assertTrue((self.root / "v3-itsdangerous-helper.md").exists())

    def test_merge_into_an_existing_group_keeps_that_group_and_links_the_parent(self) -> None:
        """Ca thật của đợt 20: `v3-clinical-…-research` đã đúng nhóm, `v4-research-…` phải nhập vào."""
        self.write("v3-clinical-patient-record-lookup-research.md", "# Bản 3\n\n## Milestones\n1. Việc.\n")
        self.write("v4-research-patient-record-lookup.md", "# Bản 4\n\n## Milestones\n1. Việc.\n")

        report = migrate.run(self.root, apply=True,
                             merges=("research-patient-record-lookup=clinical-patient-record-lookup-research",))

        self.assertEqual([item["renameTo"] for item in report["merges"]], ["v4-clinical-patient-record-lookup-research.md"])
        self.assertTrue((self.root / "v3-clinical-patient-record-lookup-research.md").exists(),
                        "bản v3 đã đúng nhóm thì không bị đụng tới")
        head = (self.root / "v4-clinical-patient-record-lookup-research.md").read_text(encoding="utf-8").split("\n")
        self.assertEqual(head[:6], ["<!-- boxfox-plan", "Version: v4",
                                    "Identity: clinical-patient-record-lookup-research", "Parent: v3",
                                    "Slug: clinical-patient-record-lookup-research", "-->"])
        # Nhóm đích giờ có 2 bản và cả hai đều đọc được bằng ĐÚNG bộ đọc của box.
        import plan_files

        for name in ("v3-clinical-patient-record-lookup-research.md", "v4-clinical-patient-record-lookup-research.md"):
            header = plan_files.parse_plan_header((self.root / name).read_text(encoding="utf-8"))
            self.assertEqual(header.status, "ok", name)

    def test_merge_refuses_when_the_destination_filename_already_exists(self) -> None:
        self.write("v3-research-record-lookup.md", "# Bản 3\n\n## Milestones\n1. Việc.\n")
        self.write("v3-clinical-record-lookup.md", "# Đã có\n\n## Milestones\n1. Việc.\n")

        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, merges=("research-record-lookup=clinical-record-lookup",))
        self.assertIn("đã tồn tại", str(caught.exception))
        # Và không có gì bị đổi tên trong chế độ xem trước.
        self.assertTrue((self.root / "v3-research-record-lookup.md").exists())

    def test_renumber_lone_is_off_by_default_and_renames_when_asked(self) -> None:
        self.write("v6-add-public-term-len-helper.md")

        default = migrate.run(self.root, apply=False)
        self.assertEqual(default["renumbers"], [])
        self.assertTrue((self.root / "v6-add-public-term-len-helper.md").exists())

        asked = migrate.run(self.root, apply=True, renumber=True)
        self.assertEqual(asked["renumbers"], [
            {"action": "renumber", "path": "v6-add-public-term-len-helper.md",
             "renameTo": "v1-add-public-term-len-helper.md", "identity": "add-public-term-len-helper",
             "version": 1, "originalVersion": 6}])
        self.assertFalse((self.root / "v6-add-public-term-len-helper.md").exists())
        renamed = (self.root / "v1-add-public-term-len-helper.md").read_text(encoding="utf-8")
        self.assertIn("Version: v1", renamed, "header phải khớp tên file, không thì box gắn mismatch")
        self.assertIn("Parent: none", renamed)
        # Số cũ của bộ đếm chung vẫn còn dấu vết — ở báo cáo, không ở trong file.
        self.assertEqual(asked["renumbers"][0]["originalVersion"], 6)
        import plan_files

        header = plan_files.parse_plan_header(renamed)
        self.assertEqual((header.status, header.version), ("ok", 1))

    def test_the_cli_is_dry_run_by_default_and_prints_json(self) -> None:
        self.write("v2-something.md")
        command = [sys.executable, str(DEPLOY / "migrate_plans.py"), "--root", str(self.root)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["apply"])
        self.assertEqual(payload["wrote"], 0)
        self.assertNotIn("<!-- boxfox-plan", (self.root / "v2-something.md").read_text(encoding="utf-8"))

        bad = subprocess.run(command + ["--merge", "khong-co-dau-bang"], capture_output=True, text=True, timeout=60)
        self.assertEqual(bad.returncode, 2)
        self.assertIn("--merge cần dạng", json.loads(bad.stdout)["error"])


    def test_the_seeded_bootstrap_plan_already_carries_a_header(self) -> None:
        """Tệp mồi của box phải có header sẵn: nếu không, mọi box mới lại sinh một plan vô danh."""
        import plan_files

        seeded = DEPLOY / "bootstrap-plans" / "v1-agent-box-plan.md"
        header = plan_files.parse_plan_header(seeded.read_text(encoding="utf-8"))

        self.assertEqual(header.status, "ok")
        self.assertEqual((header.version, header.identity, header.parent), (1, "agent-box-plan", None))
        self.assertEqual(header.body_offset, 6)
        self.assertTrue(migrate.already_has_header(seeded))
        self.assertEqual([item["name"] for item in migrate.scan(seeded.parent) if not item["header"]], [],
                         "tệp mồi phải là tệp duy nhất trong thư mục mồi mà đã có header")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
