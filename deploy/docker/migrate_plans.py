#!/usr/bin/env python3
"""Nạp header phiên bản cho các tệp `.plans` cũ — **mặc định chỉ xem trước**.

Vì sao cần: `plan_files.py` nhóm kế hoạch theo TÊN FILE (đường dẫn là biên an toàn), nhưng bộ đếm
phiên bản cũ lấy `max(mọi tệp trong .plans) + 1`, nên hai slug mới toanh nhận `v5` và `v6` — số của
bộ đếm chung, không phải của nhóm chúng thuộc về (đo sống 2026-09-21, hai slug cách nhau 6 phút).
Header `<!-- boxfox-plan … -->` là thứ nói ra phiên bản THẬT của một nhóm, để người đọc (và UI) không
phải suy từ tên file. Script này chỉ **thêm header** + (tuỳ chọn) đổi tên, và không bao giờ sửa nội
dung kế hoạch.

An toàn là mặc định:

- **Không có `--apply` thì không ghi một byte nào** (dry-run in ra kế hoạch rồi thoát).
- **`--apply` luôn sao lưu trước**: mọi tệp `vN-*.md` dưới gốc (đệ quy, bỏ tệp tạm) được sao **từng
  byte** vào `<gốc>/../.plans-backups/<UTC>/` (đổi chỗ bằng `--backup-dir`) kèm `manifest.json` giữ
  báo cáo dry-run của chính lần chạy đó và `sha256` từng tệp. Không ghi được bản sao ⇒
  `MigrationError` (exit 2) và **không byte nào** của `.plans` bị sửa — *hoặc có bản sao, hoặc không
  chạy*. Không có cờ tắt: "sao lưu trước khi áp dụng" là chốt của chủ nhà (D-2), không phải tuỳ chọn.
  Vì sao bản sao nằm **ngoài** `.plans`: bộ đọc `plan_files.py` đi đệ quy trong `.plans` và sẽ nhặt
  luôn bản sao thành những kế hoạch thứ hai.
- Chạy lại lần hai báo "không có gì để làm" (idempotent: tệp đã có header thì bỏ qua).
- `--merge a=b` đổi tên nhóm `a` thành tên nhóm `b`; **từ chối nếu tên đích đã tồn tại** — không
  bao giờ ghi đè một bản kế hoạch.
- `--renumber-lone` đổi `vN-…` thành `v1-…` cho nhóm chỉ có một bản; **mặc định tắt**, vì đổi số
  là đổi đường dẫn (link trong event stream cũ trỏ theo đường dẫn cũ). Khi bật, header cũng ghi
  `Version: v1` cho khớp tên file (bộ đọc của box gắn `mismatch` nếu lệch); số cũ vẫn nằm trong báo
  cáo ở khoá `originalVersion`.
- `--delete-orphan vN-slug.md` là **đường duy nhất** xoá một kế hoạch, nên nó **từ chối mặc định**:
  chỉ xoá khi **không** bản ghi `P:` nào trong `.session-history` giữ tệp đó (khớp
  `data.relativePath` **hoặc** `data.identity`). Thấy bản ghi ⇒ `MigrationError` + exit 2 kèm danh
  sách người giữ; không thấy ⇒ `--dry-run` chỉ in khoá `"delete"`, `--apply` mới `unlink()` (và bản
  sao ở bước trên đã giữ nguyên byte của tệp bị xoá). Cổng này **không** phải "chỉ khi chắc chắn":
  bản chuẩn của nhật ký nằm ở `~/BoxFox/harness/sessions.sqlite` (kiểm tay trên máy sống), còn
  `.session-history` là bản đọc được trong box.
- Đường xoá **chỉ mức một** (`FILENAME_RE` không cho dấu `/`) và **không đi qua liên kết tượng
  trưng**: `path.is_symlink()` ⇒ từ chối.

Dùng trong box (đường dẫn tương đối so với gốc `.plans`):

    python3 migrate_plans.py                       # xem trước, in JSON
    python3 migrate_plans.py --merge v3-clinical-patient-record-lookup=v4-research-patient-record-lookup
    python3 migrate_plans.py --renumber-lone --apply
    python3 migrate_plans.py --delete-orphan v1-test-plan.md         # xem trước: in "delete", không xoá
    python3 migrate_plans.py --delete-orphan v1-test-plan.md --apply # xoá, sau khi đã sao lưu
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import plan_files  # noqa: E402

DEFAULT_ROOT = os.environ.get("BOXFOX_PLANS_ROOT", "/home/agent/workspace/.plans")
# Nhật ký phiên trong box: nguồn để cổng `P:` của `--delete-orphan` hỏi "ai đang giữ kế hoạch này".
DEFAULT_SESSIONS_ROOT = os.environ.get("BOXFOX_SESSION_HISTORY_ROOT",
                                       "/home/agent/workspace/.session-history")
# Tên thư mục sao lưu, đặt **cạnh** `.plans` (không nằm trong) — xem vì sao ở docstring đầu file.
BACKUP_PARENT_NAME = ".plans-backups"
FILENAME_RE = re.compile(r"^v([1-9][0-9]{0,9})-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
# Cùng bộ luật bỏ tệp tạm với bộ đọc `.plans` (`plan_files._is_temporary_name`): một bản sao thứ hai
# của luật này là chỗ để hai bên lệch nhau.
is_temporary_name = plan_files._is_temporary_name


class MigrationError(RuntimeError):
    """Điều kiện từ chối (tên đích đã tồn tại, tham số sai) — in ra rồi thoát mã 2."""


def header_block(version: int, identity: str, parent, slug: str) -> str:
    """Khối header đúng cú pháp `plan_files.py` đọc (xem `HEADER_PATTERNS`)."""
    lines = ["<!-- boxfox-plan", f"Version: v{version}", f"Identity: {identity}",
             f"Parent: {'v' + str(parent) if parent else 'none'}", f"Slug: {slug}", "-->"]
    return "\n".join(lines) + "\n\n"


def read_head(path: Path, size: int = 8192) -> str:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return handle.read(size)


def already_has_header(path: Path) -> bool:
    return bool(re.search(r"^<!--\s*boxfox-plan\s*$", read_head(path), re.MULTILINE))


def scan(root: Path):
    """Mọi tệp `vN-slug.md` ở mức một trong `.plans/`, sắp theo tên."""
    if not root.is_dir():
        raise MigrationError(f"không thấy thư mục .plans: {root}")
    entries = []
    for path in sorted(root.glob("*.md")):
        match = FILENAME_RE.match(path.name)
        if not match:
            continue
        entries.append({"path": path, "name": path.name, "version": int(match.group(1)),
                        "slug": match.group("slug"), "identity": match.group("slug"),
                        "header": already_has_header(path)})
    return entries


def group_by_slug(entries):
    groups = {}
    for entry in entries:
        groups.setdefault(entry["identity"], []).append(entry)
    return groups


def rename_changes(entries, merges, renumber):
    """Đổi tên cần làm: `--merge` trước (cả nhóm), rồi `--renumber-lone` cho nhóm còn một bản.

    Không bao giờ ghi đè: tên đích đã tồn tại ⇒ `MigrationError`.
    """
    changes, warnings = [], []
    taken = {entry["name"] for entry in entries}
    existing = {entry["identity"] for entry in entries}
    for pair in merges:
        if "=" not in pair:
            raise MigrationError(f"--merge cần dạng <nguồn>=<đích>, nhận {pair!r}")
        source, target = (part.strip() for part in pair.split("=", 1))
        members = [entry for entry in entries if entry["identity"] == source]
        if not members:
            if target in existing:
                # Nhóm nguồn đã biến mất và nhóm đích có mặt ⇒ việc gộp này đã xong ở lần chạy
                # trước. Báo lại rồi bỏ qua, để "chạy lại lần hai" là vô hại.
                warnings.append(
                    f"--merge {source}→{target}: nhóm nguồn {source!r} không còn (đã gộp trước đó?) — bỏ qua")
                continue
            raise MigrationError(f"--merge: không có nhóm nào tên {source!r}")
        for entry in sorted(members, key=lambda item: item["version"]):
            destination = f"v{entry['version']}-{target}.md"
            if destination in taken:
                raise MigrationError(f"--merge: tên đích {destination!r} đã tồn tại — không bao giờ ghi đè")
            taken.discard(entry["name"])
            taken.add(destination)
            changes.append({"action": "merge", "path": entry["name"], "renameTo": destination,
                            "identity": target, "version": entry["version"]})
    if renumber:
        merged = {item["path"] for item in changes}
        seen = {}
        for entry in entries:
            if entry["name"] in merged:
                continue
            seen.setdefault(entry["identity"], []).append(entry)
        for identity, members in sorted(seen.items()):
            if len(members) != 1 or members[0]["version"] == 1:
                continue
            entry = members[0]
            destination = f"v1-{identity}.md"
            if destination in taken:
                raise MigrationError(f"--renumber-lone: tên đích {destination!r} đã tồn tại")
            taken.discard(entry["name"])
            taken.add(destination)
            # Số trong header PHẢI khớp tên file, nếu không bộ đọc của box gắn
            # `header_status: "mismatch"` vĩnh viễn. Số cũ giữ trong báo cáo (`originalVersion`)
            # để còn dấu vết của bộ đếm chung, không nhét vào file.
            changes.append({"action": "renumber", "path": entry["name"], "renameTo": destination,
                            "identity": identity, "version": 1, "originalVersion": entry["version"]})
    return changes, warnings


def final_entries(entries, changes):
    """Bản sao của `entries` với tên/định danh SAU khi đổi tên (để tính cha theo nhóm đích)."""
    by_name = {change["path"]: change for change in changes}
    final = []
    for entry in entries:
        change = by_name.get(entry["name"])
        final.append({**entry, "currentName": entry["name"],
                      "finalName": change["renameTo"] if change else entry["name"],
                      "identity": change["identity"] if change else entry["identity"],
                      "version": change["version"] if change else entry["version"]})
    return final


def plan_headers(final_entries_list):
    """Chèn header cho tệp chưa có; `Parent` là bản liền trước **trong cùng nhóm đích**."""
    changes = []
    for identity, members in sorted(group_by_slug(final_entries_list).items()):
        ordered = sorted(members, key=lambda item: item["version"])
        for index, entry in enumerate(ordered):
            if entry["header"]:
                continue
            parent = ordered[index - 1]["version"] if index else None
            changes.append({"action": "header", "path": entry["currentName"], "identity": identity,
                            "version": entry["version"], "parent": parent})
    return changes


def apply_header(path: Path, change) -> None:
    body = path.read_text(encoding="utf-8")
    block = header_block(change["version"], change["identity"], change["parent"], change["identity"])
    temporary = path.with_name(path.name + ".migrating")
    temporary.write_text(block + body, encoding="utf-8")
    os.chmod(temporary, path.stat().st_mode & 0o777)
    os.replace(temporary, path)


def apply_rename(path: Path, change, header=None) -> Path:
    destination = path.with_name(change["renameTo"])
    if destination.exists():
        raise MigrationError(f"tên đích {destination.name!r} vừa xuất hiện — dừng, không ghi đè")
    os.replace(path, destination)
    if header is not None:
        apply_header(destination, header)
    return destination


# --------------------------------------------------------------------------- sao lưu trước khi ghi


def utc_stamp() -> str:
    """Dấu thời gian UTC làm được tên thư mục (`:` thay bằng `-`, ISO 8601 rút gọn)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def default_backup_dir(root) -> Path:
    """`<gốc>/../.plans-backups/<UTC>/` — cạnh `.plans`, KHÔNG nằm trong nó (xem docstring đầu)."""
    return Path(root).resolve().parent / BACKUP_PARENT_NAME / utc_stamp()


def backup_sources(root: Path):
    """Mọi tệp `vN-*.md` dưới gốc (đệ quy, theo tên); bỏ tệp tạm và liên kết tượng trưng."""
    sources = []
    for path in sorted(Path(root).rglob("*.md")):
        if path.is_symlink() or not path.is_file():
            continue
        if is_temporary_name(path.name) or not FILENAME_RE.match(path.name):
            continue
        sources.append(path)
    return sources


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_backup(root: Path, backup_dir, report) -> dict:
    """Sao **từng byte** mọi tệp `vN-*.md` vào `backup_dir` rồi ghi `manifest.json`.

    *Hoặc có bản sao, hoặc không chạy*: mọi lỗi ở đây thành `MigrationError` để `main()` thoát mã 2
    **trước** khi một byte nào của `.plans` bị sửa. `report` là báo cáo dry-run của chính lần chạy
    này ("định làm gì") — nhúng vào manifest để đọc lại biết bản sao thuộc lần nào.
    """
    target = Path(backup_dir)
    created = not target.exists()
    entries, manifest = [], None
    try:
        target.mkdir(parents=True, exist_ok=True)
        for path in backup_sources(root):
            relative = path.relative_to(root).as_posix()
            data = path.read_bytes()
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            digest = sha256_bytes(data)
            # Đọc LẠI bản vừa ghi: "đã sao lưu" phải là số đo, không phải lời hứa.
            if sha256_bytes(destination.read_bytes()) != digest:
                raise OSError(f"bản sao của «{relative}» không khớp sha256 sau khi ghi")
            entries.append({"relativePath": relative, "backupPath": str(destination),
                            "sizeBytes": len(data), "sha256": digest})
        manifest = {"createdAt": utc_iso(), "root": str(root), "backupDirectory": str(target),
                    "fileCount": len(entries),
                    "totalBytes": sum(item["sizeBytes"] for item in entries),
                    "reason": copy.deepcopy(report), "files": entries}
        (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                              encoding="utf-8")
    except (OSError, ValueError) as exc:
        # Lần chạy này không để lại rác: thư mục do chính nó tạo thì bị bỏ đi cùng.
        if created:
            shutil.rmtree(target, ignore_errors=True)
        raise MigrationError(
            f"không sao lưu được .plans vào «{target}»: {type(exc).__name__}: {exc} — KHÔNG ghi gì") from exc
    return {"directory": str(target), "manifest": str(target / "manifest.json"),
            "files": entries, "createdAt": manifest["createdAt"]}


# --------------------------------------------------------------------------- cổng P: trước khi xoá


def norm_relative(value) -> str:
    """`'.plans/v1-x.md'` → `'v1-x.md'`: nhật ký ghi đường dẫn tính từ GỐC `.plans`."""
    text = str(value or "").strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    text = text.lstrip("/")
    if text == ".plans":
        return ""
    if text.startswith(".plans/"):
        text = text[len(".plans/"):]
    return text


def plan_references(sessions_root, *, relative_path, identity=None) -> list[dict]:
    """Ai đang giữ một kế hoạch: các hàng `P:` trong `<sessions_root>/*/journal.jsonl`.

    Khớp `data.relativePath` (đã chuẩn hoá: nhật ký ghi `.plans/v1-x.md`) **hoặc** `data.identity`
    khi `identity` được cho. Trả `[{session, id, status}]` — đủ để câu từ chối nói **ai** đang giữ.
    Nhật ký **không đọc được** cũng tính là người giữ (`unreadable: True`): luật ở đây là "thấy bản
    ghi thì từ chối", nên không đọc được thì không được coi là "không có ai giữ".
    """
    wanted_path = norm_relative(relative_path)
    wanted_identity = str(identity or "").strip().strip("/")
    root = Path(sessions_root)
    found: list[dict] = []
    if not root.is_dir():
        return found
    for journal in sorted(root.glob("*/journal.jsonl")):
        session = journal.parent.name
        try:
            text = journal.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            found.append({"session": session, "id": None, "status": None, "unreadable": True,
                          "reason": f"{type(exc).__name__}: {exc}"})
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                continue  # dòng hỏng: bỏ qua dòng đó, không bỏ qua cả tệp
            if not isinstance(record, dict) or record.get("kind") != "plan":
                continue
            data = record.get("data") if isinstance(record.get("data"), dict) else {}
            path_hit = bool(wanted_path) and norm_relative(data.get("relativePath")) == wanted_path
            identity_hit = bool(wanted_identity) and str(data.get("identity") or "") == wanted_identity
            if not (path_hit or identity_hit):
                continue
            found.append({"session": str(record.get("session") or session),
                          "id": record.get("id") or None, "status": record.get("status") or None})
    return found


def holder_label(item) -> str:
    """Một người giữ, đọc được trong câu từ chối: `P:boxfox-5-upgrades@v1 (phiên 67bdfd4b…)`."""
    if item.get("unreadable"):
        return f"(nhật ký phiên {item.get('session')} không đọc được)"
    record_id = str(item.get("id") or "")
    # Mã trong nhật ký ĐÃ mang tiền tố loại bản ghi (`P:…@v1`); chỉ thêm khi nó thiếu.
    label = record_id if record_id.startswith("P:") else f"P:{record_id or '?'}"
    return f"{label} (phiên {item.get('session')})"


def plan_deletes(root: Path, targets, *, sessions_root=None):
    """Chuẩn bị đường xoá: mỗi đích qua guard đường dẫn **và** cổng `P:` (từ chối mặc định)."""
    root = Path(root)
    sessions = Path(sessions_root or DEFAULT_SESSIONS_ROOT)
    deletes, references = [], {}
    for raw in targets or ():
        name = norm_relative(raw)
        match = FILENAME_RE.match(name)
        if not match or ".." in name.split("/"):
            raise MigrationError(
                f"--delete-orphan cần một đường dẫn tương đối dạng vN-slug.md trong .plans "
                f"(chỉ mức một, không có ..), nhận {raw!r}")
        slug = match.group("slug")
        holders = plan_references(sessions, relative_path=name, identity=slug)
        references[name] = holders
        if holders:
            who = ", ".join(holder_label(item) for item in holders)
            raise MigrationError(
                f"«{name}» đang được bản ghi {who} giữ — không xoá: một kế hoạch đã có dấu trong "
                f"nhật ký phiên thì không còn là kế hoạch thử. Xoá tay nếu bạn thật sự muốn.")
        path = root / name
        if path.is_symlink():
            raise MigrationError(f"«{name}» là liên kết tượng trưng — đường xoá này không đi qua nó")
        if not path.exists():
            continue  # đã xoá ở lần chạy trước ⇒ vô hại (xem `nothingToDo`)
        deletes.append({"relativePath": name, "identity": slug, "sizeBytes": path.stat().st_size})
    return deletes, references


def run(root: Path, *, apply=False, merges=(), renumber=False, backup_dir=None,
        delete_orphans=(), sessions_root=None) -> dict:
    entries = scan(root)
    changes, warnings = rename_changes(entries, merges, renumber)
    headers = plan_headers(final_entries(entries, changes))
    deletes, references = plan_deletes(root, delete_orphans, sessions_root=sessions_root)
    plan = {"root": str(root), "apply": bool(apply), "scanned": len(entries),
            "headers": headers, "warnings": warnings,
            "merges": [item for item in changes if item["action"] == "merge"],
            "renumbers": [item for item in changes if item["action"] == "renumber"],
            "delete": deletes, "references": references,
            "wrote": 0, "renamed": 0, "skipped": 0, "deleted": 0,
            "backedUp": [], "backupDirectory": None,
            "nothingToDo": not (headers or changes or deletes)}

    if not apply:
        return plan

    # Bản sao TRƯỚC mọi lần ghi. Không có gì để ghi thì không tạo thư mục rác: một lần `--apply`
    # vô hại không nên để lại dấu vết.
    if not plan["nothingToDo"]:
        backup = write_backup(root, backup_dir or default_backup_dir(root), plan)
        plan["backedUp"] = [item["relativePath"] for item in backup["files"]]
        plan["backupDirectory"] = backup["directory"]
        plan["backupManifest"] = backup["manifest"]

    by_name = {entry["name"]: entry for entry in entries}
    rename_map = {change["path"]: change for change in changes}
    pending = list(headers)
    pending_by_path = {change["path"]: change for change in pending}

    for name, change in rename_map.items():
        entry = by_name[name]
        header = pending_by_path.get(name)
        target = apply_rename(entry["path"], change, header=header)
        plan["renamed"] += 1
        if header is not None:
            plan["wrote"] += 1
        # `Parent` của bản gộp đã tính theo nhóm ĐÍCH (xem `final_entries`), nên chỉ cần ghi.
        pending_by_path.pop(name, None)
        _ = target

    for change in pending_by_path.values():
        path = root / change["path"]
        if not path.exists():
            continue
        if already_has_header(path):
            plan["skipped"] += 1
            continue
        apply_header(path, change)
        plan["wrote"] += 1

    for item in deletes:
        path = root / item["relativePath"]
        # Kiểm LẠI ngay trước khi xoá: tệp có thể đã đổi giữa hai bước (chỉ mục đọc ở đầu hàm).
        if path.is_symlink():
            raise MigrationError(f"«{item['relativePath']}» vừa thành liên kết tượng trưng — dừng")
        if not path.exists():
            continue
        path.unlink()
        plan["deleted"] += 1
    return plan


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Nạp header phiên bản cho .plans (mặc định dry-run)")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="gốc .plans (mặc định %(default)s)")
    parser.add_argument("--apply", action="store_true", help="GHI thật (mặc định chỉ xem trước)")
    parser.add_argument("--merge", action="append", default=[],
                        metavar="NGUỒN=ĐÍCH", help="gộp nhóm NGUỒN vào tên nhóm ĐÍCH (đổi tên cả nhóm)")
    parser.add_argument("--renumber-lone", action="store_true",
                        help="nhóm chỉ có một bản thì đổi về v1-… (đổi đường dẫn — mặc định tắt)")
    parser.add_argument("--backup-dir", default=None, metavar="THƯ_MỤC",
                        help="chỗ ghi bản sao trước khi ghi (mặc định <gốc>/../.plans-backups/<UTC>)")
    parser.add_argument("--delete-orphan", action="append", default=[], metavar="ĐƯỜNG_DẪN_TƯƠNG_ĐỐI",
                        help="xoá một kế hoạch thử (lặp được); TỪ CHỐI nếu có bản ghi P: giữ nó")
    parser.add_argument("--sessions-root", default=DEFAULT_SESSIONS_ROOT,
                        help="gốc .session-history để tra bản ghi P: (mặc định %(default)s)")
    args = parser.parse_args(argv)
    try:
        report = run(Path(args.root), apply=args.apply, merges=tuple(args.merge),
                     renumber=args.renumber_lone, backup_dir=args.backup_dir,
                     delete_orphans=tuple(args.delete_orphan), sessions_root=args.sessions_root)
    except MigrationError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["backedUp"]:
        print(f"đã sao lưu {len(report['backedUp'])} tệp vào {report['backupDirectory']} "
              f"(thư mục rác đọc được — xoá tay khi không cần)", file=sys.stderr)
    if report["nothingToDo"]:
        print("không có gì để làm", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
