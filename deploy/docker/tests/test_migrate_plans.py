"""`migrate_plans.py` — nạp header cho tệp `.plans` cũ, mặc định KHÔNG ghi gì.

Sáu ca mà plan đợt 20 đặt tên: dry-run không ghi byte nào; `--apply` chèn header đúng cú pháp
`plan_files.py` đọc; chạy lại lần hai vô hại (idempotent); `--merge` đổi tên CẢ nhóm và từ chối khi
tên đích đã tồn tại; `--renumber-lone` mặc định tắt và khi bật thì đổi `vN-…` thành `v1-…`; tham số
sai bị từ chối bằng lỗi có mã chứ không đoán.

Vòng 22 (plan `v1-boxfox-foundation`, phần C) thêm hai nhóm ca cho hai chốt của chủ nhà:

* `BackupBeforeApplyTest` — D-2: `--apply` **luôn** sao lưu từng byte vào `.plans-backups/<UTC>/`
  (hoặc `--backup-dir`) kèm `manifest.json` có `sha256`; dry-run không tạo thư mục nào; không ghi
  được bản sao ⇒ `MigrationError`/exit 2 và `.plans` **không đổi một byte**.
* `DeleteOrphanGateTest` — D-2: `--delete-orphan` là đường xoá duy nhất nên **từ chối mặc định** khi
  có hàng `P:` giữ tệp đó (khớp `data.relativePath` **hoặc** `data.identity`); không có hàng nào thì
  `--dry-run` chỉ in khoá `"delete"` còn `--apply` mới xoá — sau khi đã sao lưu.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEPLOY = REPO / "deploy" / "docker"
# Nhật ký phiên giả để thử cổng `P:` mà KHÔNG đụng `.session-history` sống của box.
FIXTURES = Path(__file__).resolve().parent / "test_fixtures" / "session-history"
SESSIONS_HELD = FIXTURES / "held"
SESSIONS_FREE = FIXTURES / "free"
SESSIONS_IDENTITY_ONLY = FIXTURES / "identity-only"


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


class _TempPlansRoot(unittest.TestCase):
    """Gốc `.plans` tạm + chỗ sao lưu tạm — dùng chung cho các ca ở dưới."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / ".plans"
        self.root.mkdir()
        self.backups = self.base / "backups"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, name: str, body: str = "# Kế hoạch\n\n## Milestones\n1. Việc.\n") -> Path:
        path = self.root / name
        path.write_text(body, encoding="utf-8")
        return path

    def digests(self) -> dict:
        """md5 mọi tệp `.md` trong `.plans` — để khẳng định "không đổi một byte nào"."""
        return {path.relative_to(self.root).as_posix(): hashlib.md5(path.read_bytes()).hexdigest()
                for path in sorted(self.root.rglob("*.md"))}


class BackupBeforeApplyTest(_TempPlansRoot):
    """D-2 / C1 — `--apply` sao lưu TRƯỚC khi ghi; không ghi được bản sao thì không ghi gì."""

    def test_apply_backs_up_every_plan_byte_for_byte_before_writing(self) -> None:
        first = self.write("v5-itsdangerous-helper.md")
        self.write("v3-clinical-record.md", "# Bản 3\n\n## Milestones\n1. Việc.\n")
        (self.root / "subplans").mkdir()
        nested = self.root / "subplans" / "v2-nested-plan.md"
        nested.write_text("# Lồng\n\n## Milestones\n1. Việc.\n", encoding="utf-8")
        # Tệp tạm của một lần ghi dở phải bị BỎ QUA: nó không phải một kế hoạch để sao lưu.
        (self.root / "v4-half-written.md.tmp").write_text("dở", encoding="utf-8")
        before = {path.relative_to(self.root).as_posix(): path.read_bytes()
                  for path in self.root.rglob("*.md")}
        backed_up = {"v3-clinical-record.md", "v5-itsdangerous-helper.md",
                     "subplans/v2-nested-plan.md"}

        report = migrate.run(self.root, apply=True, backup_dir=self.backups)

        self.assertEqual(report["wrote"], 2, "hai tệp mức một được chèn header")
        self.assertEqual(set(report["backedUp"]), backed_up, "bản sao đi ĐỆ QUY, bỏ tệp tạm")
        # `--backup-dir` đổi CHỖ chứ không đổi LUẬT: bản sao vẫn nằm trong một thư mục con <UTC>,
        # nên hai lần chạy không bao giờ ghi đè bản sao của nhau.
        backup = Path(report["backupDirectory"])
        self.assertEqual(backup.parent, self.backups)
        self.assertTrue(backup.name.endswith("Z"), backup.name)
        self.assertEqual(len(list(self.backups.iterdir())), 1, "mỗi lần chạy đúng MỘT thư mục bản sao")
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["fileCount"], 3)
        self.assertEqual(manifest["totalBytes"], sum(len(before[name]) for name in backed_up))
        for item in manifest["files"]:
            original = before[item["relativePath"]]
            self.assertEqual((backup / item["relativePath"]).read_bytes(), original,
                             f"bản sao của {item['relativePath']} phải là TỪNG BYTE của bản gốc")
            self.assertEqual(item["sha256"], hashlib.sha256(original).hexdigest())
            self.assertNotIn("<!-- boxfox-plan", (backup / item["relativePath"]).read_text(encoding="utf-8"),
                             "bản sao là trạng thái TRƯỚC khi ghi")
        self.assertIn("<!-- boxfox-plan", first.read_text(encoding="utf-8"))
        # `reason` là báo cáo dry-run của CHÍNH lần chạy đó: đọc lại biết bản sao thuộc việc gì.
        self.assertEqual(manifest["reason"]["wrote"], 0)
        self.assertEqual([item["path"] for item in manifest["reason"]["headers"]],
                         ["v3-clinical-record.md", "v5-itsdangerous-helper.md"])

    def test_dry_run_never_creates_a_backup_directory(self) -> None:
        self.write("v2-something.md")

        report = migrate.run(self.root, apply=False, backup_dir=self.backups)

        self.assertFalse(self.backups.exists(), "dry-run không được tạo thư mục sao lưu (cả chỗ đã chỉ)")
        self.assertFalse((self.base / ".plans-backups").exists(), "cũng không tạo chỗ mặc định")
        self.assertEqual(report["backedUp"], [])
        self.assertIsNone(report["backupDirectory"])

    def test_the_default_backup_directory_sits_beside_the_plans_directory(self) -> None:
        """Ngoài `.plans`: bộ đọc `plan_files.py` đi đệ quy trong đó và sẽ nhặt bản sao thành plan."""
        default = migrate.default_backup_dir(self.root)

        self.assertEqual(default.parent, self.base / ".plans-backups")
        self.assertTrue(default.name.endswith("Z"), default.name)
        self.assertNotEqual(default.parent, self.root)
        # Cùng một luật cho chỗ do người dùng chỉ: đổi CHỖ, không đổi LUẬT (một thư mục <UTC> mỗi lần).
        explicit = migrate.default_backup_dir(self.root, self.backups)
        self.assertEqual(explicit.parent, self.backups)
        self.assertTrue(explicit.name.endswith("Z"), explicit.name)

    def test_a_backup_that_cannot_be_written_stops_the_run_and_changes_nothing(self) -> None:
        self.write("v5-itsdangerous-helper.md")
        blocker = self.base / "not-a-directory"
        blocker.write_text("tệp thường", encoding="utf-8")
        before = self.digests()

        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, apply=True, backup_dir=blocker / "sub")

        self.assertIn("không sao lưu được", str(caught.exception))
        self.assertEqual(self.digests(), before, "hỏng bản sao ⇒ không byte nào của .plans bị sửa")

        command = [sys.executable, str(DEPLOY / "migrate_plans.py"), "--root", str(self.root),
                   "--apply", "--backup-dir", str(blocker / "sub")]
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)

        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("không sao lưu được", json.loads(result.stdout)["error"])
        self.assertEqual(self.digests(), before)
        self.assertFalse((self.root / "v5-itsdangerous-helper.md").read_text(encoding="utf-8").startswith("<!--"))

    def test_a_second_apply_does_nothing_and_creates_no_new_backup(self) -> None:
        self.write("v2-something.md")
        migrate.run(self.root, apply=True, backup_dir=self.backups)

        again = migrate.run(self.root, apply=True, backup_dir=self.backups / "lan-hai")

        self.assertTrue(again["nothingToDo"])
        self.assertEqual(again["wrote"], 0)
        self.assertEqual(again["backedUp"], [])
        self.assertFalse((self.backups / "lan-hai").exists(), "không có gì để ghi ⇒ không có bản sao rác")


class DeleteOrphanGateTest(_TempPlansRoot):
    """D-2 / C2 — `--delete-orphan`: cổng `P:` từ chối mặc định, chỉ `--apply` mới xoá."""

    def test_a_plan_held_by_a_journal_row_is_refused(self) -> None:
        path = self.write("v1-test-plan.md")

        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, delete_orphans=("v1-test-plan.md",), sessions_root=SESSIONS_HELD)

        message = str(caught.exception)
        self.assertIn("đang được bản ghi P:test-plan@v1", message)
        self.assertIn("67bdfd4b", message, "câu từ chối phải nói được AI đang giữ")
        self.assertTrue(path.exists(), "từ chối nghĩa là tệp còn nguyên")

    def test_the_cli_exits_2_on_a_held_plan(self) -> None:
        self.write("v1-test-plan.md")
        command = [sys.executable, str(DEPLOY / "migrate_plans.py"), "--root", str(self.root),
                   "--sessions-root", str(SESSIONS_HELD), "--delete-orphan", "v1-test-plan.md"]

        result = subprocess.run(command, capture_output=True, text=True, timeout=60)

        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("P:test-plan@v1", json.loads(result.stdout)["error"])
        self.assertTrue((self.root / "v1-test-plan.md").exists(), "từ chối trước khi chạm đĩa")

    def test_a_row_that_matches_only_the_identity_is_enough_to_refuse(self) -> None:
        """Đường dẫn đổi được (kế hoạch chuyển thư mục); `data.identity` thì không."""
        self.write("v1-test-plan.md")

        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, delete_orphans=("v1-test-plan.md",),
                        sessions_root=SESSIONS_IDENTITY_ONLY)

        self.assertIn("đang được bản ghi P:test-plan@v1", str(caught.exception))
        self.assertTrue((self.root / "v1-test-plan.md").exists())

    def test_an_unreferenced_plan_is_deleted_only_with_apply(self) -> None:
        path = self.write("v1-test-plan.md")

        preview = migrate.run(self.root, delete_orphans=("v1-test-plan.md",), sessions_root=SESSIONS_FREE)

        self.assertEqual([item["relativePath"] for item in preview["delete"]], ["v1-test-plan.md"])
        self.assertEqual(preview["deleted"], 0)
        self.assertEqual(preview["references"], {"v1-test-plan.md": []})
        self.assertFalse(preview["nothingToDo"])
        self.assertTrue(path.exists(), "xem trước không được xoá")

        report = migrate.run(self.root, apply=True, delete_orphans=("v1-test-plan.md",),
                             sessions_root=SESSIONS_FREE, backup_dir=self.backups)

        self.assertEqual(report["deleted"], 1)
        self.assertFalse(path.exists())
        self.assertIn("v1-test-plan.md", report["backedUp"], "tệp bị xoá vẫn còn trong bản sao")
        manifest = json.loads((Path(report["backupDirectory"]) / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([item["relativePath"] for item in manifest["files"]], ["v1-test-plan.md"])
        body = "# Kế hoạch\n\n## Milestones\n1. Việc.\n".encode("utf-8")
        self.assertEqual(manifest["files"][0]["sha256"], hashlib.sha256(body).hexdigest())

    def test_a_plan_already_deleted_is_nothing_to_do(self) -> None:
        self.write("v1-test-plan.md")
        migrate.run(self.root, apply=True, delete_orphans=("v1-test-plan.md",),
                    sessions_root=SESSIONS_FREE, backup_dir=self.backups)

        again = migrate.run(self.root, apply=True, delete_orphans=("v1-test-plan.md",),
                            sessions_root=SESSIONS_FREE, backup_dir=self.backups / "lan-hai")

        self.assertTrue(again["nothingToDo"])
        self.assertEqual(again["deleted"], 0)
        self.assertEqual(again["delete"], [])
        self.assertFalse((self.backups / "lan-hai").exists())

    def test_the_delete_path_refuses_a_symlink_and_a_path_outside_plans(self) -> None:
        outside = self.base / "outside.md"
        outside.write_text("# ngoài\n", encoding="utf-8")
        link = self.root / "v1-link-plan.md"
        link.symlink_to(outside)

        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, delete_orphans=("v1-link-plan.md",), sessions_root=SESSIONS_FREE)

        self.assertIn("liên kết tượng trưng", str(caught.exception))
        self.assertTrue(outside.exists(), "tệp ngoài .plans phải nguyên vẹn")

        for bad in ("../outside.md", "subplans/v1-x.md", "v1-test-plan.json", ""):
            with self.assertRaises(migrate.MigrationError):
                migrate.run(self.root, delete_orphans=(bad,), sessions_root=SESSIONS_FREE)

    def test_plan_references_reads_holders_and_survives_a_broken_line(self) -> None:
        self.assertEqual(migrate.plan_references(SESSIONS_HELD, relative_path="v1-test-plan.md"),
                         [{"session": "67bdfd4bd6fa4398bd0273e62dd2acc0", "id": "P:test-plan@v1",
                           "status": "draft"}])
        # Nhật ký ghi `.plans/v1-test-plan.md`; cờ nhận đường dẫn tính từ gốc `.plans` — cả hai dạng.
        self.assertEqual(migrate.plan_references(SESSIONS_HELD, relative_path=".plans/v1-test-plan.md"),
                         migrate.plan_references(SESSIONS_HELD, relative_path="v1-test-plan.md"))
        # Bộ quét đọc HẾT nhật ký: hàng của kế hoạch khác vẫn thấy (chỉ khác là không khớp đích).
        self.assertEqual([item["id"] for item in
                          migrate.plan_references(SESSIONS_FREE, relative_path="v2-other-plan.md")],
                         ["P:other-plan@v2"])
        self.assertEqual(migrate.plan_references(SESSIONS_FREE, relative_path="v1-test-plan.md",
                                                 identity="test-plan"), [])
        self.assertEqual(migrate.plan_references(self.base / "không-có-thư-mục",
                                                 relative_path="v1-test-plan.md"), [])

    def test_an_unreadable_journal_counts_as_a_holder(self) -> None:
        """"Thấy bản ghi thì từ chối" ⇒ không đọc được nhật ký KHÔNG phải "không có ai giữ"."""
        sessions = self.base / "sessions"
        (sessions / "abc12345" / "journal.jsonl").mkdir(parents=True)
        self.write("v1-test-plan.md")

        holders = migrate.plan_references(sessions, relative_path="v1-test-plan.md")

        self.assertEqual([(item["session"], item["unreadable"]) for item in holders],
                         [("abc12345", True)])
        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.run(self.root, delete_orphans=("v1-test-plan.md",), sessions_root=sessions)
        self.assertIn("không đọc được", str(caught.exception))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
