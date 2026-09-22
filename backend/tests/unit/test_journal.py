"""Nhật ký tác vụ dài hơi: bộ tám dấu, mã bản ghi, khuôn một dòng JSONL, khối ký ức, bản `.md`.

Mô-đun này là **nguồn duy nhất** cho từ vựng dấu và hai hàm render; tầng file trong box
(`deploy/docker/session_files.py`) giữ bản sao vì box không import được gói Python của harness.
Hai bản bị khoá với nhau ngay ở đây (cùng đầu vào ⇒ cùng đầu ra byte-đúng) — không có test này
thì hai bên sẽ lệch nhau trong im lặng, và người đọc `.md` trong box sẽ thấy khác thứ harness
tưởng nó đã ghi.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import pytest

from agentbox.agent_core import journal
from agentbox.agent_core.journal import JournalError

_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT / "deploy" / "docker"))

import session_files  # noqa: E402  (cùng bố cục repo, chỉ để khoá hai bản render)

SID = "ab12cd34" + "e" * 24
SID8 = "ab12cd34"


def _record(kind: str, seq: int, text: str = "một bước", status: str = None, **extra) -> dict:
    body = {"ts": "2026-09-21T16:48:01.222Z", "kind": kind, "seq": seq, "sid8": SID8,
            "session": SID, "actor": "harness", "text": text, "refs": [], "evidence": [],
            "data": {}, "numbers": {}}
    body["id"] = f"{journal.KIND_MARKER[kind]}:{SID8}-{seq}"
    if kind == "plan":
        body["id"] = "P:long-task-journal@v2"
    if status:
        body["status"] = status
    body.update(extra)
    return body


def _rows(count: int = 100) -> list[dict]:
    kinds = list(journal.KIND_MARKER)
    statuses = {"task": "doing", "step": "done", "blocker": "blocked", "checkpoint": "recorded",
                "decision": "info", "plan": "approved", "fact": "info", "evidence": "info"}
    out = []
    for index in range(count):
        kind = kinds[index % len(kinds)]
        out.append(_record(kind, index + 1, f"bản ghi {index + 1} của {kind}",
                           status=statuses[kind],
                           data={"next": "việc kế tiếp"} if kind == "step" else {}))
    return out


class MintIdTest(unittest.TestCase):
    def test_exact_ids_from_the_plan(self) -> None:
        assert journal.mint_id("task", SID8, 1) == "T:ab12cd34-1"
        assert journal.mint_id("plan", SID8, 1, {"identity": "long-task-journal", "version": 2}) == \
            "P:long-task-journal@v2"
        assert journal.mint_id("checkpoint", SID8, 2) == "C:ab12cd34-2"

    def test_plan_id_ignores_seq_and_keeps_slug_version(self) -> None:
        assert journal.mint_id("plan", SID8, 9, {"slug": "v2-session-journal", "version": "v3"}) == \
            "P:v2-session-journal@v3"
        with pytest.raises(JournalError):
            journal.mint_id("plan", SID8, 1, None)
        with pytest.raises(JournalError):
            journal.mint_id("plan", SID8, 1, {"identity": "Co Dau Hai Cham", "version": 1})

    def test_rejects_unknown_kind_and_bad_seq(self) -> None:
        with pytest.raises(JournalError):
            journal.mint_id("khong-co", SID8, 1)
        for bad in (0, -1, "1", None, True):
            with pytest.raises(JournalError):
                journal.mint_id("step", SID8, bad)

    def test_no_minted_id_has_more_than_one_colon(self) -> None:
        for kind in journal.KIND_MARKER:
            plan = {"identity": "long-task-journal", "version": 2} if kind == "plan" else None
            value = journal.mint_id(kind, SID8, 7, plan)
            assert value.count(":") == 1, value
            assert journal.is_record_id(value)
            assert journal.kind_of_marker(value.split(":", 1)[0]) == kind


class RecordShapeTest(unittest.TestCase):
    def test_record_keeps_both_timestamp_spellings_and_the_marker(self) -> None:
        item = journal.record("step", "Đọc worker.py:227-246", sid=SID, seq=41, turn=7, step=3,
                              status="done", refs=["T:ab12cd34-1"],
                              evidence=[{"type": "file", "path": "worker.py", "lines": "227-246"}],
                              numbers={"messageCount": 13})
        assert item["id"] == "S:ab12cd34-41"
        assert item["timestamp"] == item["ts"]
        assert item["ts"].endswith("Z")
        assert item["numbers"] == {"messageCount": 13}
        line = journal.dumps(item)
        assert "\n" not in line
        assert json.loads(line)["text"] == "Đọc worker.py:227-246"

    def test_rejects_overlong_text_unknown_status_and_wild_refs(self) -> None:
        with pytest.raises(JournalError):
            journal.record("step", "x" * (journal.JOURNAL_TEXT_MAX_CHARS + 1), sid=SID, seq=1)
        assert len(journal.record("step", "x" * journal.JOURNAL_TEXT_MAX_CHARS, sid=SID,
                                  seq=1)["text"]) == journal.JOURNAL_TEXT_MAX_CHARS
        with pytest.raises(JournalError):
            journal.record("step", "ok", sid=SID, seq=1, status="khong-co")
        with pytest.raises(JournalError):
            journal.record("step", "ok", sid=SID, seq=1, refs=["không phải mã"])
        with pytest.raises(JournalError):
            journal.record("step", "ok", sid=SID, seq=1, evidence=[{"path": "thiếu type"}])
        with pytest.raises(JournalError):
            journal.record("plan", "thiếu plan", sid=SID, seq=1)

    def test_row_payload_carries_what_the_journal_table_cannot_hold(self) -> None:
        item = journal.record("blocker", "chờ quyền root", sid=SID, seq=3, status="blocked",
                              ts="2026-09-21T16:48:01.222Z")
        payload = journal.row_payload(item)
        assert set(payload) >= {"id", "sid8", "status", "refs", "evidence", "data"}
        assert "text" not in payload and "kind" not in payload
        assert journal.to_db_ts(item) == pytest.approx(1790009281.222, abs=0.001)
        assert journal.to_db_ts({"ts": "không-phải-ts"}) > 0  # hỏng thì lấy "bây giờ", không ném


class BriefTextTest(unittest.TestCase):
    def test_hundred_records_stay_under_the_char_ceiling_with_six_groups(self) -> None:
        brief = journal.brief_text(_rows(100))
        assert len(brief) <= journal.JOURNAL_BRIEF_MAX_CHARS
        assert brief.startswith(journal.JOURNAL_BRIEF_HEADER)
        headings = [line for line in brief.splitlines() if line.startswith("[") and ". " in line]
        assert len(headings) == 6, headings
        assert journal.journal_brief is journal.brief_text

    def test_each_group_respects_its_limit_and_newest_comes_first(self) -> None:
        brief = journal.brief_text(_rows(100))
        block = brief.split("[2. đã xong]")[1].split("[3. đang làm]")[0]
        lines = [line for line in block.splitlines() if line.startswith("- ")]
        assert 0 < len(lines) <= journal.JOURNAL_BRIEF_MAX_PER_GROUP
        numbers = [int(line.split(":")[1].split("-")[1].split(" ")[0]) for line in lines]
        assert numbers == sorted(numbers, reverse=True)

    def test_groups_are_pinned_even_when_empty_and_a_truncation_is_announced(self) -> None:
        empty = journal.brief_text([])
        lines = empty.splitlines()
        # tiêu đề + sáu nhóm, mỗi nhóm một dòng "không có bản ghi" — nhóm không bao giờ biến mất
        assert len(lines) == 1 + 6 * 2
        assert lines.count("- (không có bản ghi)") == 6
        tiny = journal.brief_text(_rows(100), max_chars=400)
        assert len(tiny) <= 400
        assert "bản ghi nữa" in tiny  # cắt thì phải nói đã cắt bao nhiêu

    def test_hang_ve_mo_ho_roi_vao_nhom_dang_tac_con_fact_thuong_thi_khong(self) -> None:
        """C4 (vòng 22): vé mơ hồ phải tới model, nhưng **không** mở nhóm thứ bảy cho hàng `fact`."""
        ticket = _record("fact", 7, "PLAN_IDENTITY_AMBIGUOUS: slug «kế hoạch mới» giống 66% nhóm «cũ»",
                         status="info", data={"identityAmbiguityTicket": {"slug": "kế hoạch mới",
                                                                    "score": 0.6667,
                                                                    "matchedIdentity": "cũ"}})
        plain = _record("fact", 8, "repo dùng CRLF cho backend", status="info")
        brief = journal.brief_text([ticket, plain])
        headings = [line for line in brief.splitlines() if line.startswith("[") and ". " in line]
        assert len(headings) == 6, 'vé không được sinh ra nhóm thứ bảy'
        blocked = brief.split("[4. đang tắc]")[1].split("[5.")[0]
        assert "F:ab12cd34-7" in blocked, 'vé phải nằm trong nhóm đang tắc'
        assert "F:ab12cd34-8" not in brief, 'một dữ kiện thường không thuộc nhóm nào trong sáu nhóm'

    def test_checkpoint_lines_appear_and_goals_come_from_newest_task(self) -> None:
        rows = [
            _record("task", 1, "mục tiêu đợt 20", status="open"),
            _record("checkpoint", 2, "nén 13 tin nhắn → 6", status="recorded",
                    numbers={"messageCount": 13}),
            _record("blocker", 3, "chờ quyền ghi file", status="blocked"),
            _record("step", 4, "đã xong bước một", status="done", data={"next": "viết test"}),
            _record("decision", 5, "chốt trần 8 MiB", status="info"),
        ]
        brief = journal.brief_text(rows)
        assert "T:ab12cd34-1" in brief
        assert "C:ab12cd34-2" in brief
        assert "X:ab12cd34-3" in brief
        assert "→ kế tiếp: viết test" in brief
        assert "D:ab12cd34-5" in brief


class RollupMdTest(unittest.TestCase):
    def test_line_ceiling_keeps_the_newest_and_announces_the_drop(self) -> None:
        rows = _rows(500)
        text = journal.rollup_md(rows)
        lines = text.splitlines()
        assert len(lines) <= journal.JOURNAL_MD_MAX_LINES
        assert f"S:{SID8}-500" in lines[-1] or "500" in lines[-1]
        assert "bỏ" in lines[2]
        assert text.endswith("\n")

    def test_small_ceilings_never_exceed_the_ceiling(self) -> None:
        rows = _rows(30)
        for ceiling in (2, 3, 4, 10):
            assert len(journal.rollup_md(rows, max_lines=ceiling).splitlines()) <= ceiling

    def test_deterministic_for_the_same_rows(self) -> None:
        rows = _rows(40)
        assert journal.rollup_md(rows) == journal.rollup_md(rows)

    def test_matches_the_box_side_mirror_byte_for_byte(self) -> None:
        rows = _rows(420)
        assert journal.rollup_md(rows) == session_files.render_journal_md(rows)
        assert journal.rollup_md(rows, max_lines=5) == session_files.render_journal_md(rows, max_lines=5)
        assert journal.rollup_md([], max_lines=3) == session_files.render_journal_md([], max_lines=3)


class VocabularyMirrorTest(unittest.TestCase):
    def test_marker_vocabulary_is_identical_on_both_sides_of_the_box(self) -> None:
        assert journal.KIND_MARKER == session_files.KIND_MARKER
        assert tuple(journal.KIND_MARKER) == tuple(session_files.KIND_MARKER)

    def test_shared_truncation_constants_agree(self) -> None:
        assert journal.JOURNAL_MD_MAX_LINES == session_files.JOURNAL_MD_MAX_LINES
        assert journal.JOURNAL_TEXT_MAX_CHARS == session_files.JOURNAL_TEXT_MAX_CHARS
        assert journal.JOURNAL_MD_MAX_TEXT_CHARS == session_files.JOURNAL_MD_MAX_TEXT_CHARS


class JsonlIoTest(unittest.TestCase):
    def test_append_line_is_append_only_and_load_lines_tolerates_garbage(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "journal.jsonl"
            journal.append_line(path, _record("step", 1, "một"))
            journal.append_line(path, _record("step", 2, "hai"))
            path.write_text(path.read_text(encoding="utf-8") + "{ dòng hỏng\n", encoding="utf-8")
            rows = journal.load_lines(path)
            assert [row["text"] for row in rows] == ["một", "hai"]
            assert journal.load_lines(Path(folder) / "khong-co.jsonl") == []

    def test_sid8_rejects_anything_that_is_not_hex(self) -> None:
        assert journal.sid8_of("AB12CD34" + "e" * 24) == SID8
        for bad in ("", "ab12cd3", "../../etc/passwd", "z" * 12):
            with pytest.raises(JournalError):
                journal.sid8_of(bad)
