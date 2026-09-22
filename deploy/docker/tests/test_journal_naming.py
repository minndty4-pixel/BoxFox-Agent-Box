"""Quy tắc đánh số/đặt tên của đợt 20 (P1, P4, P5) — chạy trên cây file thật trong thư mục tạm.

P1: tên file lịch sử nén `ck-<sid8>-<n>.json` + `.md`, nội dung `.json` đúng khuôn bản ghi của
    máy chủ nhà (`timestamp`, `message_count`, `messages`) và là JSON hợp lệ.
P4: `.session-history/INDEX.json` + nhật ký khoá theo `T:`/`P:`/`C:`.
P5: **không** tên bản ghi/file nào chứa dấu hai chấm (ngoài dấu phân cách của mã bản ghi).
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import session_files
import session_ops

SID = "ab12cd34" + "e" * 24
SID8 = "ab12cd34"
KIND_MARKER = {"task": "T", "plan": "P", "step": "S", "decision": "D",
               "evidence": "E", "checkpoint": "C", "fact": "F", "blocker": "X"}


class NamingBaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / ".session-history"
        self.captures = Path(self._tmp.name) / "captures"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def op(self, name: str, **args) -> dict:
        return session_ops.execute(name, {"session": SID, "root": str(self.root), **args})

    def record(self, kind: str, seq: int, text: str = "một việc dài hơi", **extra) -> dict:
        body = {"kind": kind, "seq": seq, "ts": "2026-09-21T16:48:01.222Z",
                "id": f"{KIND_MARKER[kind]}:{SID8}-{seq}", "session": SID, "sid8": SID8,
                "text": text, "status": extra.pop("status", "done"), "refs": [], "evidence": [],
                "data": extra.pop("data", {}), "actor": "harness"}
        body.update(extra)
        return body


class CheckpointFrameTest(NamingBaseTest):
    """P1 — khuôn tên và khuôn khoá của tệp lịch sử nén."""

    def test_names_use_ck_sid8_number_and_json_is_valid(self) -> None:
        result = self.op("checkpoint_write", messages=[{"role": "user", "content": "câu 1"}],
                         numbers={"checkpointNumber": 2, "rowId": 8})
        self.assertEqual(Path(result["file"]).name, f"ck-{SID8}-002.json")
        self.assertEqual(Path(result["md"]).name, f"ck-{SID8}-002.md")
        body = json.loads(Path(result["file"]).read_text(encoding="utf-8"))  # JSON hợp lệ
        self.assertEqual(sorted(body), ["message_count", "messages", "timestamp"])
        self.assertEqual(body["messages"], [{"role": "user", "content": "câu 1"}])
        self.assertEqual(body["message_count"], 1)

    def test_a_record_without_words_does_not_erase_the_checkpoint_files(self) -> None:
        """Ca sống của bản 0.1: `journalRecord` không có `text` -> box từ chối, và cả op mất kết quả.

        Kết quả op **phải** còn: cặp file đã ghi xong trước đó, và chỗ gọi cần biết đúng phần còn
        thiếu (dòng nhật ký), chứ không phải tưởng rằng không có file nào.
        """
        result = self.op("checkpoint_write", messages=[{"role": "user", "content": "câu 1"}],
                         journalRecord={"kind": "checkpoint"})
        self.assertTrue(result["ok"], result)
        self.assertTrue(Path(result["file"]).exists())
        self.assertEqual(result["journal"]["ok"], False)
        self.assertEqual(result["journal"]["code"], "JOURNAL_DEGRADED")
        self.assertIn("phải có chữ", result["journal"]["error"])

    def test_one_checkpoint_writes_exactly_one_c_line_pointing_at_the_files(self) -> None:
        self.op("session_ensure")
        result = self.op("checkpoint_write", messages=[{"role": "user", "content": "câu 1"}],
                         numbers={"messageCountBefore": 58, "messageCountAfter": 8},
                         journalRecord={"kind": "checkpoint", "text": "nén 58 → 8 tin nhắn"})
        paths = session_files.session_paths(self.root, SID)
        rows = session_files.journal_rows(paths)
        checkpoints = [row for row in rows if row["kind"] == "checkpoint"]
        self.assertEqual(len(checkpoints), 1)
        row = checkpoints[0]
        self.assertEqual(row["id"], f"C:{SID8}-{result['checkpointNumber']}")
        self.assertEqual(row["data"]["relPath"], result["relPath"])
        self.assertEqual(row["data"]["mdRelPath"], result["mdRelPath"])
        self.assertEqual(row["numbers"]["messageCountBefore"], 58)
        self.assertEqual(result["journal"]["id"], row["id"])

    def test_every_file_name_of_the_session_has_no_colon(self) -> None:
        paths = session_files.session_paths(self.root, SID)
        session_files.checkpoint_write(paths, [{"role": "user", "content": "x"}],
                                      {"checkpointNumber": 1})
        names = sorted(entry.name for entry in paths.checkpoints_dir.iterdir())
        self.assertEqual(names, [f"ck-{SID8}-001.json", f"ck-{SID8}-001.md"])
        for name in names:
            self.assertNotIn(":", name)


class IndexKeyingTest(NamingBaseTest):
    """P4 — INDEX.json và nhật ký cùng khoá `T:`/`P:`/`C:`."""

    def _seed(self) -> dict:
        self.op("journal_append", record=self.record("task", 1, "nhật ký tác vụ dài",
                                                     status="doing"))
        self.op("journal_append", record=self.record(
            "plan", 2, "kế hoạch v2", id=None,
            data={"identity": "long-task-journal", "version": 2, "slug": "long-task-journal"},
            status="approved"))
        self.op("checkpoint_write", messages=[{"role": "user", "content": "trước nén"}],
                numbers={"checkpointNumber": 1, "rowId": 5},
                journalRecord={"kind": "checkpoint", "seq": 3, "session": SID,
                               "text": "nén 13 → 6 tin nhắn", "refs": [f"T:{SID8}-1"],
                               "status": "recorded"})
        return session_files.index_read(self.root)

    def test_index_has_index_json_keyed_by_record_id(self) -> None:
        index = self._seed()
        ids = {entry["id"] for entry in index["tasks"]}
        self.assertIn(f"T:{SID8}-1", ids)
        self.assertIn(f"P:long-task-journal@v2", ids)
        self.assertIn(f"C:{SID8}-1", ids)
        self.assertTrue(Path(self.root, "INDEX.json").exists())

    def test_journal_rows_use_the_same_ids_as_the_index(self) -> None:
        self._seed()
        paths = session_files.session_paths(self.root, SID)
        rows = session_files.journal_rows(paths)
        ids = [row["id"] for row in rows]
        self.assertEqual(ids, [f"T:{SID8}-1", "P:long-task-journal@v2", f"C:{SID8}-1"])
        index = session_files.index_read(self.root)
        self.assertEqual(sorted(ids), sorted({entry["id"] for entry in index["tasks"]}))
        plan = next(entry for entry in index["tasks"] if entry["id"].startswith("P:"))
        self.assertEqual(plan["plan"], {"identity": "long-task-journal", "version": 2})


class NamingSweepTest(NamingBaseTest):
    """P5 — quét cả cây sau một lượt chạy giả: không tên file/bản ghi nào có dấu hai chấm."""

    def _run_a_session(self) -> None:
        self.op("session_ensure", role="orchestrator", goal="nhật ký dài hơi")
        for index, kind in enumerate(KIND_MARKER, start=1):
            body = self.record(kind, index, f"bản ghi {kind}")
            if kind == "plan":
                body["id"] = "P:long-task-journal@v1"
                body["data"] = {"identity": "long-task-journal", "version": 1}
            self.op("journal_append", record=body)
        self.op("checkpoint_write", messages=[{"role": "user", "content": "trước nén"}],
                numbers={"checkpointNumber": 1, "rowId": 1})
        session_files.capture_index_append(self.captures, sid=SID, item={
            "kind": "screen", "relPath": f"captures/screen/{SID8}/{SID8}_003_screen.png"})

    def test_no_file_in_the_session_tree_contains_a_colon(self) -> None:
        self._run_a_session()
        trees = [self.root, self.captures]
        for tree in trees:
            for parent, directories, files in os.walk(tree):
                for name in directories + files:
                    self.assertNotIn(":", name, f"{Path(parent) / name} có dấu hai chấm")

    def test_record_ids_carry_exactly_one_colon_after_the_marker(self) -> None:
        self._run_a_session()
        paths = session_files.session_paths(self.root, SID)
        rows = session_files.journal_rows(paths)
        self.assertEqual(len(rows), len(KIND_MARKER))
        for row in rows:
            self.assertEqual(row["id"].count(":"), 1, row["id"])
            self.assertEqual(row["id"].split(":", 1)[0], KIND_MARKER[row["kind"]])

    def test_session_tree_matches_the_planned_layout(self) -> None:
        self._run_a_session()
        paths = session_files.session_paths(self.root, SID)
        self.assertTrue(paths.session_json.exists())
        self.assertTrue(paths.journal_jsonl.exists())
        self.assertTrue(paths.journal_md.exists())
        self.assertEqual(sorted(entry.name for entry in paths.checkpoints_dir.iterdir()),
                         [f"ck-{SID8}-001.json", f"ck-{SID8}-001.md"])
        self.assertLessEqual(len(paths.journal_md.read_text(encoding="utf-8").splitlines()),
                             session_files.JOURNAL_MD_MAX_LINES)


class OpsContractTest(NamingBaseTest):
    """Mặt op: hỏng thì trả lỗi, **không bao giờ** ném ra ngoài một lượt chạy."""

    def test_run_op_never_raises_and_names_the_code(self) -> None:
        bad = session_ops.run_op("khong-co-op-nay", {})
        self.assertTrue(bad["is_error"])
        self.assertEqual(bad["code"], "SESSION_FILES_BAD_OP")
        bad_id = session_ops.run_op("session_ensure", {"session": "../../etc"})
        self.assertTrue(bad_id["is_error"])
        self.assertEqual(bad_id["code"], "SESSION_FILES_BAD_ID")

    def test_prune_pins_exactly_one_x_record_per_run(self) -> None:
        self.op("session_ensure")
        directory = self.captures / "screen" / SID8
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(session_files.CAPTURE_KEEP_PER_KIND + 3):
            path = directory / f"{SID8}_003_screen-{index}.png"
            path.write_bytes(b"x" * 8)
            stamp = 1000 - index
            os.utime(path, (stamp, stamp))
        report = self.op("captures_prune", captureRoot=str(self.captures), updateIndex=False)
        self.assertEqual(report["removedFiles"], 3)
        rows = session_files.journal_rows(session_files.session_paths(self.root, SID))
        pinned = [row for row in rows if str(row.get("id", "")).startswith("X:")]
        self.assertEqual(len(pinned), 1)
        self.assertEqual(report["pinned"], [pinned[0]["id"]])
        self.assertEqual(pinned[0]["numbers"]["removedFiles"], 3)
        self.assertEqual(pinned[0]["status"], "done")

    def test_prune_dry_run_pins_nothing_and_deletes_nothing(self) -> None:
        self.op("session_ensure")
        directory = self.captures / "screen" / SID8
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{SID8}_003_screen.png"
        path.write_bytes(b"x" * 8)
        report = self.op("captures_prune", captureRoot=str(self.captures), dryRun=True)
        self.assertTrue(report["dryRun"])
        self.assertTrue(path.exists())
        self.assertEqual(report["pinned"], [])
        self.assertEqual(session_files.journal_rows(session_files.session_paths(self.root, SID)), [])


if __name__ == "__main__":
    unittest.main()
