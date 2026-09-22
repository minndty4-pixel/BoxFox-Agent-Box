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
- Chạy lại lần hai báo "không có gì để làm" (idempotent: tệp đã có header thì bỏ qua).
- `--merge a=b` đổi tên nhóm `a` thành tên nhóm `b`; **từ chối nếu tên đích đã tồn tại** — không
  bao giờ ghi đè một bản kế hoạch.
- `--renumber-lone` đổi `vN-…` thành `v1-…` cho nhóm chỉ có một bản; **mặc định tắt**, vì đổi số
  là đổi đường dẫn (link trong event stream cũ trỏ theo đường dẫn cũ). Khi bật, header cũng ghi
  `Version: v1` cho khớp tên file (bộ đọc của box gắn `mismatch` nếu lệch); số cũ vẫn nằm trong báo
  cáo ở khoá `originalVersion`.

Dùng trong box (đường dẫn tương đối so với gốc `.plans`):

    python3 migrate_plans.py                       # xem trước, in JSON
    python3 migrate_plans.py --merge v3-clinical-patient-record-lookup=v4-research-patient-record-lookup
    python3 migrate_plans.py --renumber-lone --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import plan_files  # noqa: E402

DEFAULT_ROOT = os.environ.get("BOXFOX_PLANS_ROOT", "/home/agent/workspace/.plans")
FILENAME_RE = re.compile(r"^v([1-9][0-9]{0,9})-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.md$")


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


def run(root: Path, *, apply=False, merges=(), renumber=False) -> dict:
    entries = scan(root)
    changes, warnings = rename_changes(entries, merges, renumber)
    headers = plan_headers(final_entries(entries, changes))
    plan = {"root": str(root), "apply": bool(apply), "scanned": len(entries),
            "headers": headers, "warnings": warnings,
            "merges": [item for item in changes if item["action"] == "merge"],
            "renumbers": [item for item in changes if item["action"] == "renumber"],
            "wrote": 0, "renamed": 0, "skipped": 0,
            "nothingToDo": not (headers or changes)}

    if not apply:
        return plan

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
    return plan


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Nạp header phiên bản cho .plans (mặc định dry-run)")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="gốc .plans (mặc định %(default)s)")
    parser.add_argument("--apply", action="store_true", help="GHI thật (mặc định chỉ xem trước)")
    parser.add_argument("--merge", action="append", default=[],
                        metavar="NGUỒN=ĐÍCH", help="gộp nhóm NGUỒN vào tên nhóm ĐÍCH (đổi tên cả nhóm)")
    parser.add_argument("--renumber-lone", action="store_true",
                        help="nhóm chỉ có một bản thì đổi về v1-… (đổi đường dẫn — mặc định tắt)")
    args = parser.parse_args(argv)
    try:
        report = run(Path(args.root), apply=args.apply, merges=tuple(args.merge), renumber=args.renumber_lone)
    except MigrationError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["nothingToDo"]:
        print("không có gì để làm", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
