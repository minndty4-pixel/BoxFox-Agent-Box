#!/usr/bin/env python3
"""Retention cho `.uploaded_artifacts` — đường dọn tệp người dùng tải lên (đợt 22, D-6).

Vì sao phải có: box chỉ có **một** đường ghi tệp người dùng lên (RULE-5, A3) và trước đợt này
không có đường dọn nào, nên một vòng lặp dán ảnh sẽ làm đầy đĩa box mà không ai đếm. Ngược lại,
dọn quá tay sẽ phá bộ đếm RULE-5 (A3 đọc `max(số đang có) + 1`), nên luật ở đây bị khoá hai đầu:

- **Giữ 200 tệp / 500 MiB** (trần có tên, chủ nhà chỉnh sau), xoá **mtime cũ nhất trước**;
- **Không bao giờ xoá cái neo số**: tệp có số RULE-5 cao nhất của MỖI thư mục được giữ lại, để
  số cấp ra không bao giờ đi lùi (vi phạm `docs/naming.md` RULE-5 — "tăng một chiều").

`unlink` chỉ nằm trong `prune()`: `retention()` **chỉ lập kế hoạch** và trả báo cáo, nên gọi
`retention(dry_run=True)` không thể xoá một byte nào (test khoá điều này). `prune()` cũng là chỗ
ghim **đúng một** hàng `X:` vào nhật ký phiên — cùng luật với `session_ops.op_captures_prune`
(một lượt dọn = một dòng, không bao giờ một dòng cho mỗi tệp).

Mô-đun THUẦN (stdlib) để test được bằng thư mục tạm và để `box-entrypoint.sh`/`worker.py` đều
import được nó trong box.
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Trần + vị trí
# ---------------------------------------------------------------------------
WORKSPACE_ROOT = Path(os.environ.get("AGENT_WORKSPACE", "/home/agent/workspace"))
UPLOAD_DIR_NAME = ".uploaded_artifacts"
UPLOAD_ROOT = Path(os.environ.get("UPLOAD_ROOT", str(WORKSPACE_ROOT / UPLOAD_DIR_NAME)))

# Trần D-6: 200 tệp / 500 MiB. Đĩa box còn nhiều chỗ — con số này để một vòng lặp dán ảnh
# không bao giờ biến box thành cái đĩa đầy, không phải vì thiếu chỗ.
UPLOAD_KEEP_MAX_FILES = 200
UPLOAD_KEEP_MAX_BYTES = 500 * 1024 * 1024

# Bản ghi ghim mỗi lượt dọn — giữ nguyên bộ chữ của `session_ops` (cùng một luật nhật ký).
PRUNE_RECORD_KIND = "blocker"
PRUNE_RECORD_STATUS = "done"
PRUNE_RECORD_ACTOR = "box-retention"
PRUNE_RECORD_MARKER_NOTE = "dọn tệp tải lên theo trần 200 tệp / 500 MiB"


class UploadFilesError(Exception):
    """Lỗi tầng retention — người gọi hạ xuống `notice`, không để chết lượt."""

    code = "UPLOAD_FILES_FAILED"

    def __init__(self, message, *, code: str = None, details: dict = None):
        super().__init__(str(message))
        self.message = str(message)
        self.code = code or type(self).code
        self.details = dict(details or {})


def root_path(root=None) -> Path:
    return Path(root or UPLOAD_ROOT)


def _entries(root: Path, protected: set) -> tuple[list[dict], list[str]]:
    """Liệt kê tệp thường dưới `root` (đi cả cây con) — bỏ qua symlink và thư mục.

    Tệp được bảo vệ VẪN nằm trong danh sách (kèm cờ `protected`) để nó tính vào trần dung lượng:
    một tệp được giữ mà không tính là một tệp thì trần chỉ đúng trên giấy.
    """
    entries: list[dict] = []
    skipped: list[str] = []
    if not root.is_dir():
        return entries, skipped
    for current, _dirs, names in os.walk(root):
        for name in sorted(names):
            path = Path(current) / name
            if path.is_symlink() or not path.is_file():
                skipped.append(str(path))
                continue
            try:
                stat = path.stat()
            except OSError:
                skipped.append(str(path))
                continue
            guarded = str(path) in protected or name in protected
            if guarded:
                skipped.append(str(path))
            stem = name.rsplit(".", 1)[0] if "." in name else name
            entries.append({
                "path": path,
                "name": name,
                "protected": guarded,
                "dir": str(current),
                "bytes": int(stat.st_size),
                "mtime": float(stat.st_mtime),
                # Tệp KHÔNG theo RULE-5 (ví dụ `probe.md` do người vận hành đặt) vẫn được dọn
                # theo cùng trần, chỉ là nó không đóng vai "cái neo số" nào.
                "number": int(stem) if stem.isdigit() else None,
            })
    return entries, skipped


def _anchors(entries: list[dict]) -> set[str]:
    """Tệp neo của MỖI thư mục: số RULE-5 cao nhất, hoặc tệp mới nhất nếu thư mục không có số.

    Xoá cái neo sẽ làm `workspace_files.highest_upload_number` tụt xuống và box cấp lại số đã
    dùng — đúng thứ RULE-5 cấm. Trần byte vì vậy chấp nhận vượt một tệp thay vì phá dãy số.
    """
    by_dir: dict[str, list[dict]] = {}
    for entry in entries:
        by_dir.setdefault(entry["dir"], []).append(entry)
    anchors: set[str] = set()
    for group in by_dir.values():
        numbered = [entry for entry in group if entry["number"] is not None]
        pick = (
            max(numbered, key=lambda entry: (entry["number"], entry["mtime"]))
            if numbered
            else max(group, key=lambda entry: (entry["mtime"], entry["name"]))
        )
        anchors.add(str(pick["path"]))
    return anchors


def retention(root=None, *, dry_run: bool = False, protect=()) -> dict:
    """Lập kế hoạch dọn (không xoá gì) và trả báo cáo đủ để người gọi tự quyết.

    Trả `{removed, kept, freedBytes, dryRun, removedFiles, keptBytes, ...}`. `removed` là **dự
    kiến** khi `dry_run=True`; muốn xoá thật phải gọi `prune()`.
    """
    root_obj = root_path(root)
    protected = {str(value) for value in (protect or []) if str(value or "").strip()}
    entries, skipped = _entries(root_obj, protected)
    anchors = _anchors(entries)

    total_files = len(entries)
    total_bytes = sum(entry["bytes"] for entry in entries)
    planned: list[dict] = []
    for entry in sorted(entries, key=lambda item: (item["mtime"], item["name"])):
        if entry["protected"] or str(entry["path"]) in anchors:
            continue
        if total_files <= UPLOAD_KEEP_MAX_FILES and total_bytes <= UPLOAD_KEEP_MAX_BYTES:
            break
        planned.append(entry)
        total_files -= 1
        total_bytes -= entry["bytes"]

    planned_paths = {str(entry["path"]) for entry in planned}
    kept = [entry for entry in entries if str(entry["path"]) not in planned_paths]
    planned_bytes = sum(entry["bytes"] for entry in planned)
    return {
        "ok": True,
        "root": str(root_obj),
        "dryRun": bool(dry_run),
        "removed": [entry["name"] for entry in planned],
        "kept": [entry["name"] for entry in kept],
        # Kế hoạch đầy đủ (đường dẫn + số byte) — `prune()` xoá ĐÚNG danh sách này, không đoán lại.
        "planned": [{"path": str(entry["path"]), "name": entry["name"], "bytes": entry["bytes"]}
                    for entry in planned],
        "freedBytes": planned_bytes,
        "removedFiles": len(planned),
        "removedBytes": planned_bytes,
        "keptFiles": len(kept),
        "keptBytes": sum(entry["bytes"] for entry in kept),
        "skippedProtected": skipped,
        "anchors": sorted(Path(path).name for path in anchors),
    }


def _default_journal(payload: dict) -> dict:
    """Ghim hàng `X:` qua `session_ops` — import TRỄ để không thành vòng import.

    `session_ops` nhập `upload_files` ở cấp mô-đun (để đăng ký op `uploads_prune`), nên nhập
    sớm ở đây sẽ tạo vòng. Trong box cả hai file nằm cùng `/usr/local/bin`.
    """
    import session_ops  # noqa: PLC0415 — cố ý: phá vòng import

    return session_ops.op_journal_append(payload)


def prune(
    root=None,
    *,
    session: str = None,
    history_root=None,
    sid8: str = None,
    dry_run: bool = False,
    protect=(),
    update_index: bool = False,
    journal=None,
) -> dict:
    """Dọn thật: xoá đúng những tệp `retention()` đã lập kế hoạch, rồi ghim **một** hàng `X:`.

    Đây là **đường duy nhất** trong box được `unlink` tệp tải lên. `dry_run=True` chỉ trả báo
    cáo kế hoạch: không xoá byte nào và không ghim hàng nhật ký nào.
    """
    report = retention(root, dry_run=dry_run, protect=protect)
    report["deleted"] = []
    if not dry_run:
        # Xoá đúng danh sách `retention()` đã lập kế hoạch (không quét lại rồi tự đoán tệp nào).
        deleted_bytes = 0
        for item in report["planned"]:
            try:
                Path(item["path"]).unlink()
            except FileNotFoundError:
                continue
            except OSError:
                continue
            report["deleted"].append(item["name"])
            deleted_bytes += item["bytes"]
        report["removed"] = list(report["deleted"])
        report["removedFiles"] = len(report["deleted"])
        report["removedBytes"] = deleted_bytes
        report["freedBytes"] = deleted_bytes

    pinned: list[str] = []
    session_text = str(session or "").strip().lower()
    if report["removedFiles"] and session_text and not dry_run:
        payload = {
            "session": session_text,
            "root": history_root,
            "sid8": sid8,
            "updateIndex": bool(update_index),
            "record": {
                "kind": PRUNE_RECORD_KIND,
                "status": PRUNE_RECORD_STATUS,
                "actor": PRUNE_RECORD_ACTOR,
                "text": (f"{PRUNE_RECORD_MARKER_NOTE}: bỏ {report['removedFiles']} tệp / "
                         f"{report['removedBytes']} B (còn {report['keptFiles']} tệp / "
                         f"{report['keptBytes']} B)."),
                "numbers": {"removedFiles": report["removedFiles"],
                            "removedBytes": report["removedBytes"],
                            "keptFiles": report["keptFiles"], "keptBytes": report["keptBytes"]},
                "data": {"origin": PRUNE_RECORD_ACTOR, "removed": report["removed"][:50]},
            },
        }
        writer = journal or _default_journal
        try:
            written = writer(payload)
            pinned.append(str((written or {}).get("id") or ""))
        except UploadFilesError:
            raise
        except Exception as exc:  # nhật ký hỏng KHÔNG được làm hỏng việc dọn đã xong
            report["journalError"] = str(exc)
    report["pinned"] = [item for item in pinned if item]
    return report
