"""Kiểm thử `session_files.py` — khung thư mục phiên, nhật ký, checkpoint, dọn dẹp.

Thuần stdlib, chạy trong thư mục tạm: không DB, không X11, không mạng.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import session_files
from session_files import SessionFilesError

SID = "ab12cd34" + "e" * 24
OTHER = "ab12cd34" + "f" * 24          # cùng 8 hex đầu với SID → ca đụng độ
DISTINCT = "99887766" + "a" * 24


class BaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / ".session-history"
        self.captures = Path(self._tmp.name) / "captures"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def paths(self, sid: str = SID):
        return session_files.session_paths(self.root, sid)


class Sid8Test(BaseTest):
    def test_takes_first_eight_hex_without_root(self) -> None:
        self.assertEqual(session_files.sid8_of(SID), "ab12cd34")

    def test_collision_escalates_to_twelve_hex(self) -> None:
        # Phiên khác đã chiếm thư mục 8 hex đầu → phiên này phải lùi sang 12 hex, nếu không hai
        # phiên ghi chung một thư mục và trộn nhật ký của nhau.
        first = session_files.session_paths(self.root, SID)
        session_files.session_ensure(first)
        self.assertEqual(session_files.sid8_of(OTHER, root=self.root), "ab12cd34ffff")
        self.assertEqual(session_files.sid8_of(SID, root=self.root), "ab12cd34")
        self.assertEqual(session_files.sid8_of(DISTINCT, root=self.root), "99887766")

    def test_rejects_non_hex_and_short_ids(self) -> None:
        for bad in ("", "../../etc/passwd", "ab12cd3", "ab12cd34-1", "z" * 12):
            with self.assertRaises(SessionFilesError):
                session_files.sid8_of(bad)
        # Chữ HOA được chuẩn hoá, không bị coi là id sai (harness có lúc gửi kèm chữ HOA).
        self.assertEqual(session_files.sid8_of("ABCDEF12" + "0" * 24), "abcdef12")


class SessionLayoutTest(BaseTest):
    def test_ensure_creates_layout_and_writes_session_json_once(self) -> None:
        paths = self.paths()
        first = session_files.session_ensure(paths, {"role": "orchestrator", "goal": "đợt 20"})
        self.assertTrue(first["created"])
        self.assertTrue(paths.session_json.exists())
        self.assertTrue(paths.checkpoints_dir.is_dir())
        body = json.loads(paths.session_json.read_text(encoding="utf-8"))
        self.assertEqual(set(body), {"session", "sid8", "role", "parent", "created", "goal", "workspace"})
        self.assertEqual(body["session"], SID)
        self.assertEqual(body["role"], "orchestrator")
        self.assertTrue(body["created"].endswith("Z"))

        # Lần hai: không ghi đè, `goal` cũ giữ nguyên (một phiên một dòng đã chốt).
        second = session_files.session_ensure(paths, {"role": "subagent", "goal": "khác"})
        self.assertFalse(second["created"])
        self.assertEqual(json.loads(paths.session_json.read_text(encoding="utf-8"))["role"],
                         "orchestrator")

    def test_paths_reject_escape_out_of_history(self) -> None:
        with self.assertRaises(SessionFilesError) as caught:
            session_files.session_paths(self.root, "../../etc/passwd")
        self.assertEqual(caught.exception.code, "SESSION_FILES_BAD_ID")
        with self.assertRaises(SessionFilesError) as caught:
            session_files._assert_inside(self.root, Path(self._tmp.name) / "outside")
        self.assertEqual(caught.exception.code, "SESSION_FILES_BAD_PATH")


class JournalAppendTest(BaseTest):
    def _record(self, seq: int, text: str = "một bước", kind: str = "step") -> dict:
        return {"seq": seq, "ts": "2026-09-21T16:48:01.222Z", "kind": kind,
                "id": f"{session_files.KIND_MARKER[kind]}:ab12cd34-{seq}", "session": SID,
                "sid8": "ab12cd34", "turn": 7, "step": 3, "actor": "agent", "text": text,
                "status": "done", "refs": [], "evidence": [], "data": {}}

    def test_append_is_append_only_and_mirrors_markdown(self) -> None:
        paths = self.paths()
        session_files.journal_append(paths, self._record(1, "bước một"))
        result = session_files.journal_append(paths, self._record(2, "bước hai"))
        lines = paths.journal_jsonl.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(json.loads(lines[0])["text"], "bước một")
        self.assertEqual(json.loads(lines[1])["text"], "bước hai")
        self.assertEqual(result["lines"], 2)
        md = paths.journal_md.read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(len(md), session_files.JOURNAL_MD_MAX_LINES)
        self.assertIn("S:ab12cd34-2", md[-1])  # mới nhất ở cuối
        self.assertIn("S:ab12cd34-1", "\n".join(md))

    def test_long_text_is_cut_with_a_mark_not_silently_dropped(self) -> None:
        paths = self.paths()
        body = self._record(1, "x" * (session_files.JOURNAL_TEXT_MAX_CHARS + 500))
        session_files.journal_append(paths, body)
        stored = json.loads(paths.journal_jsonl.read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(len(stored["text"]), session_files.JOURNAL_TEXT_MAX_CHARS)
        self.assertTrue(stored["data"]["truncated"])
        self.assertEqual(stored["data"]["textChars"], session_files.JOURNAL_TEXT_MAX_CHARS + 500)

    def test_bad_kind_and_empty_text_raise_journal_degraded(self) -> None:
        paths = self.paths()
        for item in ({"kind": "bogus", "text": "x"}, {"kind": "step", "text": "   "}, "không phải dict"):
            with self.assertRaises(SessionFilesError) as caught:
                session_files.journal_append(paths, item)
            self.assertEqual(caught.exception.code, "JOURNAL_DEGRADED")
        self.assertFalse(paths.journal_jsonl.exists())

    def test_markdown_mirror_never_exceeds_the_line_ceiling(self) -> None:
        paths = self.paths()
        for seq in range(1, 421):
            session_files.journal_append(paths, self._record(seq, f"bước {seq}"))
        md = paths.journal_md.read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(len(md), session_files.JOURNAL_MD_MAX_LINES)
        self.assertIn("bỏ", md[2])  # nói rõ đã bỏ bao nhiêu, không cắt im lặng
        self.assertIn("S:ab12cd34-420", md[-1])
        self.assertEqual(len(paths.journal_jsonl.read_text(encoding="utf-8").splitlines()), 420)


class CheckpointFileTest(BaseTest):
    def _messages(self, count: int = 3) -> list[dict]:
        return [{"role": "user", "content": f"câu {index}"} for index in range(count)]

    def test_names_start_at_001_and_json_has_the_owner_machine_shape(self) -> None:
        paths = self.paths()
        result = session_files.checkpoint_write(paths, self._messages(2), {"checkpointNumber": 1})
        self.assertEqual(result["status"], "recorded")
        self.assertEqual(Path(result["file"]).name, "ck-ab12cd34-001.json")
        self.assertEqual(Path(result["md"]).name, "ck-ab12cd34-001.md")
        body = json.loads(Path(result["file"]).read_text(encoding="utf-8"))
        self.assertEqual(set(body), {"timestamp", "message_count", "messages"})
        self.assertEqual(body["message_count"], 2)
        self.assertTrue(body["timestamp"].endswith("Z"))
        # `messages` byte-đúng thứ được ghi vào cột `messages` của SQLite (cùng json.dumps).
        self.assertEqual(result["messagesBytes"],
                         len(json.dumps(self._messages(2), ensure_ascii=False).encode("utf-8")))

    def test_counter_is_per_directory_and_has_no_gaps(self) -> None:
        paths = self.paths()
        self.assertEqual(session_files.checkpoint_next_number(paths), 1)
        session_files.checkpoint_write(paths, self._messages(1), {"checkpointNumber": 1})
        self.assertEqual(session_files.checkpoint_next_number(paths), 2)
        # Không truyền số → tự lấy số kế tiếp, không nhảy cóc.
        session_files.checkpoint_write(paths, self._messages(1), {})
        names = sorted(entry.name for entry in paths.checkpoints_dir.iterdir())
        self.assertEqual(names, ["ck-ab12cd34-001.json", "ck-ab12cd34-001.md",
                                 "ck-ab12cd34-002.json", "ck-ab12cd34-002.md"])

    def test_over_ceiling_writes_no_json_and_says_why_in_markdown(self) -> None:
        paths = self.paths()
        big = [{"role": "user", "content": "x" * (session_files.CHECKPOINT_FILE_MAX_BYTES + 1024)}]
        result = session_files.checkpoint_write(paths, big, {"checkpointNumber": 4, "rowId": 77})
        self.assertEqual(result["status"], "degraded")
        self.assertIsNone(result["file"])
        self.assertFalse((paths.checkpoints_dir / "ck-ab12cd34-004.json").exists())
        md = Path(result["md"]).read_text(encoding="utf-8").splitlines()
        self.assertTrue(md[0].startswith("> Transcript vượt trần 8 MiB"))
        self.assertIn("#77", md[0])
        self.assertNotIn("xxxx", md[0])
        # Không để lại file tạm nửa vời.
        self.assertEqual([entry.name for entry in paths.checkpoints_dir.iterdir()
                          if entry.name.endswith(".tmp")], [])

    def test_markdown_drops_base64_and_keeps_one_line_per_tool_and_image(self) -> None:
        messages = [
            {"role": "assistant", "content": [
                {"type": "tool_use", "name": "computer_screen_capture", "input": {"action": "screenshot"}},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + "A" * 5000}},
            ], "tool_calls": [{"function": {"name": "file_read", "arguments": "{\"path\":\"a.py\"}"}}]},
            {"role": "tool", "tool_call_id": "call_1", "name": "file_read",
             "content": "y" * (session_files.SUMMARY_MESSAGE_CHARS + 10)},
        ]
        md = session_files.render_checkpoint_md(messages, numbers={"messageCount": 2})
        self.assertNotIn("AAAA", md)
        self.assertIn("[tool] file_read", md)
        self.assertIn("5000 ký tự base64 đã bỏ", md)
        self.assertIn("[cắt 10 ký tự]", md)
        self.assertIn("## [1] assistant", md)

    def test_prune_keeps_only_the_newest_pairs(self) -> None:
        paths = self.paths()
        for number in range(1, session_files.CHECKPOINT_KEEP_PER_SESSION + 4):
            session_files.checkpoint_write(paths, self._messages(1), {"checkpointNumber": number})
        names = sorted(entry.name for entry in paths.checkpoints_dir.iterdir())
        self.assertEqual(len(names), session_files.CHECKPOINT_KEEP_PER_SESSION * 2)
        self.assertNotIn("ck-ab12cd34-001.json", names)
        self.assertNotIn("ck-ab12cd34-003.json", names)
        self.assertIn("ck-ab12cd34-004.json", names)


class CaptureIndexTest(BaseTest):
    def test_index_line_is_one_line_and_reads_back(self) -> None:
        session_files.capture_index_append(self.captures, sid=SID, item={"kind": "screen", "step": 3})
        session_files.capture_index_append(self.captures, sid=SID, item={"kind": "screen", "step": 4})
        path = self.captures / "ab12cd34" / "index.jsonl"
        self.assertEqual(len(path.read_text(encoding="utf-8").splitlines()), 2)
        rows = session_files.capture_index_rows(self.captures, SID)
        self.assertEqual([row["step"] for row in rows], [3, 4])
        self.assertTrue(Path(rows[0]["path"] if rows[0].get("path") else path).exists())

    def test_bad_session_id_raises_before_touching_disk(self) -> None:
        with self.assertRaises(SessionFilesError):
            session_files.capture_index_append(self.captures, sid="../etc", item={})


class RetentionTest(BaseTest):
    def _write(self, kind: str, name: str, size: int, age: float = 0.0) -> Path:
        directory = self.captures / kind / "ab12cd34"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / name
        path.write_bytes(b"x" * size)
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        return path

    def test_keeps_newest_files_per_kind_and_reports_what_it_removed(self) -> None:
        for index in range(session_files.CAPTURE_KEEP_PER_KIND + 5):
            self._write("screen", f"ab12cd34_003_screen-{index}.png", 10, age=1000 - index)
        report = session_files.retention(self.captures)
        self.assertEqual(report["removedFiles"], 5)
        self.assertEqual(report["keptFiles"], session_files.CAPTURE_KEEP_PER_KIND)
        self.assertEqual(len(list((self.captures / "screen" / "ab12cd34").iterdir())),
                         session_files.CAPTURE_KEEP_PER_KIND)
        removed_names = {Path(entry).name for entry in report["removed"]}
        self.assertEqual(removed_names, {f"ab12cd34_003_screen-{index}.png" for index in range(5)})

    def test_protected_and_dry_run_files_survive(self) -> None:
        paths = [self._write("screen", f"ab12cd34_003_screen-{index}.png", 10, age=1000 - index)
                 for index in range(session_files.CAPTURE_KEEP_PER_KIND + 3)]
        report = session_files.retention(self.captures, protect=[str(paths[0])], dry_run=True)
        self.assertEqual(report["skippedProtected"], 1)
        self.assertEqual(report["removedFiles"], 2)  # 203 file, 1 file được bảo vệ → 202 ứng viên
        self.assertTrue(all(path.exists() for path in paths))
        session_files.retention(self.captures, protect=[str(paths[0])])
        self.assertTrue(paths[0].exists())

    def test_record_ceiling_applies_to_mp4(self) -> None:
        for index in range(session_files.RECORD_KEEP_PER_SESSION + 2):
            self._write("screen", f"ab12cd34_003_screen-{index}.mp4", 10, age=500 - index)
        session_files.retention(self.captures)
        left = [entry.name for entry in (self.captures / "screen" / "ab12cd34").iterdir()]
        self.assertEqual(len(left), session_files.RECORD_KEEP_PER_SESSION)

    def test_legacy_flat_files_are_never_touched(self) -> None:
        flat = self.captures / "screen"
        flat.mkdir(parents=True, exist_ok=True)
        legacy = flat / "1789996506997-screen.png"
        legacy.write_bytes(b"old")
        report = session_files.retention(self.captures)
        self.assertTrue(legacy.exists())
        self.assertEqual(report["removedFiles"], 0)

    def test_session_filter_scopes_the_pass(self) -> None:
        self._write("screen", "ab12cd34_003_screen-1.png", 10)
        other = self.captures / "screen" / "99887766"
        other.mkdir(parents=True, exist_ok=True)
        (other / "99887766_001_screen.png").write_bytes(b"y" * 10)
        report = session_files.retention(self.captures, session=SID)
        self.assertEqual(report["keptFiles"], 1)
        self.assertTrue((other / "99887766_001_screen.png").exists())

    def test_byte_ceiling_removes_oldest_first(self) -> None:
        size = session_files.CAPTURE_MAX_BYTES_PER_SESSION // 3
        paths = [self._write("screen", f"ab12cd34_003_screen-{index}.png", size, age=100 - index)
                 for index in range(4)]
        report = session_files.retention(self.captures)
        self.assertEqual(report["removedFiles"], 1)
        self.assertFalse(paths[0].exists())
        self.assertTrue(all(path.exists() for path in paths[1:]))


class IndexFileTest(BaseTest):
    def test_task_and_session_entries_are_keyed_by_record_id(self) -> None:
        session_files.index_update(self.root, sid=SID, meta={"session": SID, "role": "orchestrator"})
        session_files.index_update(self.root, sid=SID, item={
            "kind": "task", "id": "T:ab12cd34-1", "ts": "2026-09-21T16:48:01.222Z",
            "session": SID, "sid8": "ab12cd34", "status": "doing", "text": "nhật ký dài hơi",
            "refs": [], "evidence": [], "data": {}})
        session_files.index_update(self.root, sid=SID, item={
            "kind": "checkpoint", "id": "C:ab12cd34-2", "seq": 2, "status": "recorded",
            "session": SID, "sid8": "ab12cd34", "text": "nén 13 → 6", "refs": ["T:ab12cd34-1"],
            "evidence": [], "data": {}, "numbers": {"checkpointNumber": 2}})
        index = session_files.index_read(self.root)
        self.assertEqual(index["sessions"]["ab12cd34"]["role"], "orchestrator")
        ids = [entry["id"] for entry in index["tasks"]]
        self.assertEqual(ids, ["T:ab12cd34-1", "C:ab12cd34-2"])
        self.assertTrue(index["tasks"][0]["blocked"] is False)
        self.assertEqual(index["tasks"][1]["checkpoint"]["checkpointNumber"], 2)
        self.assertTrue(Path(self.root, "INDEX.json").exists())

    def test_same_task_id_updates_in_place_and_marks_deleted_sessions(self) -> None:
        for status in ("doing", "done"):
            session_files.index_update(self.root, sid=SID, item={
                "kind": "task", "id": "T:ab12cd34-1", "status": status, "session": SID,
                "sid8": "ab12cd34", "text": "một việc", "refs": [], "evidence": [], "data": {}})
        session_files.index_update(self.root, sid=SID, meta={"session": SID}, deleted=True)
        index = session_files.index_read(self.root)
        self.assertEqual(len(index["tasks"]), 1)
        self.assertEqual(index["tasks"][0]["status"], "done")
        self.assertTrue(index["sessions"]["ab12cd34"]["sessionDeleted"])

    def test_broken_index_is_read_as_empty_not_fatal(self) -> None:
        Path(self.root).mkdir(parents=True, exist_ok=True)
        Path(self.root, "INDEX.json").write_text("{ khong-phai-json", encoding="utf-8")
        index = session_files.index_read(self.root)
        self.assertEqual(index["tasks"], [])
        self.assertEqual(index["sessions"], {})


class SessionOpsCliTest(BaseTest):
    """Lối vào CLI của `session_ops` — đúng khuôn mà `worker.py` sẽ gọi.

    `worker.py` đọc yêu cầu dưới dạng `{'name', 'args', 'session'}` (session là tham số **riêng**
    của `execute`), nên tầng CLI phải nhận được cả hai khuôn: session nằm trong `args` (test, thư
    viện) và session nằm ngoài (worker trong box). Sai chỗ này thì op chạy thật sẽ trả
    `SESSION_FILES_BAD_ARGS` ngay lượt đầu.
    """

    def _cli(self, payload):
        import io
        import sys as _sys
        import session_ops
        old = _sys.stdin
        _sys.stdin = io.StringIO(json.dumps(payload))
        try:
            buffer = io.StringIO()
            old_out = _sys.stdout
            _sys.stdout = buffer
            try:
                session_ops.main([])
            finally:
                _sys.stdout = old_out
        finally:
            _sys.stdin = old
        return json.loads(buffer.getvalue())

    def test_worker_envelope_carries_session_outside_args(self) -> None:
        result = self._cli({"name": "session_ensure", "args": {"root": str(self.root)}, "session": SID})
        self.assertTrue(result["ok"], result)
        self.assertTrue(result["created"])
        self.assertTrue(Path(result["sessionFile"]).is_file())

    def test_unknown_op_answers_is_error_instead_of_raising(self) -> None:
        result = self._cli({"name": "khong-co-op-nay", "args": {}, "session": SID})
        self.assertTrue(result["is_error"])
        self.assertEqual(result["code"], "SESSION_FILES_BAD_OP")

    def test_missing_session_is_reported_not_guessed(self) -> None:
        result = self._cli({"name": "journal_append", "args": {"kind": "task", "text": "x"}})
        self.assertTrue(result["is_error"])
        self.assertEqual(result["code"], "SESSION_FILES_BAD_ARGS")


if __name__ == "__main__":
    unittest.main()
