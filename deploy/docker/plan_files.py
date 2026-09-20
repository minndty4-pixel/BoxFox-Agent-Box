#!/usr/bin/env python3
"""Quét và đọc an toàn các file kế hoạch chỉ-đọc trong ``.plans``.

Ngoài phần quét/đọc chỉ-đọc, module này còn giữ **trạng thái duyệt plan** do người
dùng bấm trong tab Plan (``.reviews`` — hợp đồng §2 của
``docs/plan/next-batch-contract.md``): ``write_review``/``read_reviews``. Thư mục
``.reviews`` không bao giờ được coi là một plan.

Quy tắc ánh xạ identity → file (cố định, đảo ngược được)::

    identity TRẦN  →  <root>/.reviews/<identity>.json      (dấu "/" thành thư mục con)
    "pilot"        →  .reviews/pilot.json
    "designs/login"→  .reviews/designs/login.json

``identity`` là giá trị ``GET /__box/plans`` dùng để nhóm plan (``slug`` ở gốc
``.plans/``, ``dir/slug`` khi lồng nhau) và **không bao giờ** kèm tiền tố ``vN-`` —
số version nằm ở tên file ``vN-<slug>.md``. Vì dấu ``/`` trở thành thư mục con thật,
ánh xạ là song ánh (không cần thay ``/`` bằng ``__``): ``designs/login`` và
``designs__login`` là hai file khác nhau, không bao giờ ghi đè nhau. Hai hàm
``identity_to_review_relative_path``/``identity_from_review_relative_path`` là cặp
ánh xạ thuận/nghịch, và ``read_reviews`` dùng đúng hàm nghịch đó để dựng lại identity.
Mọi identity không khớp ``_IDENTITY_RE`` (kể cả ``..``, đoạn bắt đầu bằng dấu chấm,
identity quá dài) bị từ chối 400 trước khi chạm đĩa.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

MAX_DEPTH = 16
MAX_ENTRIES = 2_000
MAX_FILE_SIZE = 1_024 * 1_024

# Trạng thái duyệt plan (người dùng bấm trong tab Plan).
REVIEWS_DIR_NAME = ".reviews"
REVIEW_DECISIONS = ("approved", "changes_requested")
REVIEW_FILE_SUFFIX = ".json"
# Identity dài nhất mà một plan thật có thể có: tên file là `v1-<slug>.md`, mà tên
# thành phần trên filesystem tối đa 255 byte → slug ≤ 255 - len("v1-") - len(".md").
# Chặn sớm để identity không bao giờ sinh ra tên file dài quá giới hạn.
MAX_IDENTITY_LENGTH = 255 - len("v1-") - len(".md")
# Ghi chú duyệt plan phải ngắn; giữ dưới trần body JSON 64KB của ide-proxy (`_read_json_body`)
# để nhánh 413 của hợp đồng thực sự chạm tới được qua HTTP.
MAX_NOTE_SIZE = 16 * 1024
# ide-proxy chạy root; file/thư mục do nó ghi phải thuộc user agent (1000:1000).
AGENT_UID = 1000
AGENT_GID = 1000

_SLUG = r"[a-z0-9]+(?:-[a-z0-9]+)*"
_VERSION = r"[1-9][0-9]{0,9}"
_FILENAME_RE = re.compile(rf"^v({_VERSION})-({_SLUG})\.md$")
_IDENTITY_RE = re.compile(rf"^(?:{_SLUG}/)*{_SLUG}$")

_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


class PlanFileError(Exception):
    """Lỗi có mã HTTP xác định khi xử lý file kế hoạch."""

    status_code = 500
    public_message = "Không thể đọc file kế hoạch."


class InvalidPlanRequest(PlanFileError):
    status_code = 400
    public_message = "Yêu cầu file kế hoạch không hợp lệ."


class PlanNotFound(PlanFileError):
    status_code = 404
    public_message = "Không tìm thấy file kế hoạch."


class PlanCollision(PlanFileError):
    status_code = 409
    public_message = "Phiên bản kế hoạch đang bị xung đột."


class PlanTooLarge(PlanFileError):
    status_code = 413
    public_message = "File kế hoạch vượt quá giới hạn kích thước."


class InvalidPlanEncoding(PlanFileError):
    status_code = 422
    public_message = "File kế hoạch không phải UTF-8 hợp lệ."


@dataclass(frozen=True)
class PlanVersion:
    """Metadata của một phiên bản file kế hoạch."""

    version: int
    relative_path: str
    size_bytes: int
    modified_at: str
    status: str

    def to_payload(self) -> dict[str, object]:
        return {
            "version": self.version,
            "label": f"v{self.version}",
            "relativePath": self.relative_path,
            "sizeBytes": self.size_bytes,
            "modifiedAt": self.modified_at,
            "status": self.status,
        }


@dataclass(frozen=True)
class PlanGroup:
    """Một identity và các phiên bản hợp lệ của nó."""

    identity: str
    relative_directory: str
    slug: str
    versions: tuple[PlanVersion, ...]

    def to_payload(self, review: dict | None = None) -> dict[str, object]:
        """``review`` là trạng thái duyệt gần nhất (hoặc ``None`` nếu chưa duyệt)."""

        return {
            "identity": self.identity,
            "relativeDirectory": self.relative_directory,
            "slug": self.slug,
            "versions": [version.to_payload() for version in self.versions],
            "review": review,
        }


@dataclass(frozen=True)
class PlanManifest:
    """Kết quả quét xác định, không chứa đường dẫn tuyệt đối."""

    plans: tuple[PlanGroup, ...]
    ignored_count: int
    warnings: tuple[str, ...]
    collisions: frozenset[tuple[str, int]]
    reviews: dict[str, dict] = field(default_factory=dict)

    def to_payload(self) -> dict[str, object]:
        return {
            "plans": [
                plan.to_payload(self.reviews.get(plan.identity)) for plan in self.plans
            ],
            "ignoredCount": self.ignored_count,
            "warnings": list(self.warnings),
        }

    def version_for(self, identity: str, version: int) -> PlanVersion | None:
        for group in self.plans:
            if group.identity == identity:
                return next(
                    (item for item in group.versions if item.version == version), None
                )
        return None


@dataclass(frozen=True)
class PlanDocument:
    """Nội dung Markdown và metadata của một file kế hoạch."""

    identity: str
    version: int
    relative_path: str
    markdown: str
    size_bytes: int
    modified_at: str
    status: str

    def to_payload(self) -> dict[str, object]:
        return {
            "identity": self.identity,
            "version": self.version,
            "label": f"v{self.version}",
            "relativePath": self.relative_path,
            "markdown": self.markdown,
            "sizeBytes": self.size_bytes,
            "modifiedAt": self.modified_at,
            "status": self.status,
        }


@dataclass(frozen=True)
class _Candidate:
    identity: str
    relative_directory: str
    slug: str
    version: int
    relative_path: str
    size_bytes: int
    modified_at: str


def validate_identity(identity: str) -> tuple[str, str]:
    """Kiểm tra identity và trả về thư mục tương đối cùng slug cuối."""

    if not isinstance(identity, str) or not _IDENTITY_RE.fullmatch(identity):
        raise InvalidPlanRequest
    parts = identity.split("/")
    return "/".join(parts[:-1]), parts[-1]


def identity_to_review_relative_path(identity: str) -> str:
    """Ánh xạ THUẬN identity trần → đường dẫn tương đối trong ``.reviews``.

    ``designs/login`` → ``designs/login.json``: dấu ``/`` của plan lồng nhau trở thành
    thư mục con thật, nên không cần thay bằng ``__`` và không có nguy cơ hai identity
    khác nhau ghi vào cùng một file. identity ở đây là giá trị TRẦN (không có ``vN-``).
    """

    return f"{identity}{REVIEW_FILE_SUFFIX}"


def identity_from_review_relative_path(relative: str) -> str:
    """Ánh xạ NGHỊCH của ``identity_to_review_relative_path`` (dùng khi ĐỌC lại).

    Trả identity trần; ``ValueError`` nếu chuỗi không thể là đường dẫn review. Ánh xạ
    đúng là nghịch đảo: ``identity_from_review_relative_path(identity_to_review_relative_path(x)) == x``.
    """

    text = str(relative).replace("\\", "/") if os.name == "nt" else str(relative)
    if not text.endswith(REVIEW_FILE_SUFFIX) or text.startswith("/"):
        raise ValueError(relative)
    identity = text[: -len(REVIEW_FILE_SUFFIX)]
    if not identity:
        raise ValueError(relative)
    return identity


def validate_version(version: object) -> int:
    """Kiểm tra version dương với nhiều nhất mười chữ số."""

    if isinstance(version, bool):
        raise InvalidPlanRequest
    value = str(version)
    if not re.fullmatch(_VERSION, value):
        raise InvalidPlanRequest
    return int(value)


def _modified_at(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def _is_temporary_name(name: str) -> bool:
    return (
        name.endswith("~")
        or name.startswith(".#")
        or name.startswith("~$")
        or name.endswith((".tmp", ".swp", ".bak"))
    )


def _warning(relative_path: Path, reason: str) -> str:
    return f"Đã bỏ qua «{relative_path.as_posix()}»: {reason}."


def _walk_plan_entries(root_input: int | Path) -> tuple[list[_Candidate], int, list[str]]:
    candidates: list[_Candidate] = []
    ignored_count = 0
    warnings: list[str] = []
    total_entries = 0

    def walk(target: int | Path, relative_directory: Path, depth: int) -> bool:
        nonlocal ignored_count, total_entries
        try:
            entries = sorted(os.scandir(target), key=lambda item: item.name)
        except OSError:
            ignored_count += 1
            warnings.append(_warning(relative_directory, "không thể đọc thư mục"))
            return True

        for entry in entries:
            total_entries += 1
            relative_path = (
                Path(entry.name)
                if relative_directory == Path()
                else relative_directory / entry.name
            )
            if total_entries > MAX_ENTRIES:
                warnings.append(
                    f"Đã chạm ngưỡng tối đa {MAX_ENTRIES} mục; các file còn lại bị bỏ qua."
                )
                ignored_count += 1
                return False

            if entry.name == REVIEWS_DIR_NAME:
                # Trạng thái duyệt do box ghi — không phải plan. Bỏ qua IM LẶNG
                # (không tăng ignored_count/warnings) vì đây là thư mục của chính ta.
                continue
            if entry.name.startswith("."):
                ignored_count += 1
                warnings.append(_warning(relative_path, "segment ẩn"))
                continue
            if _is_temporary_name(entry.name):
                ignored_count += 1
                warnings.append(_warning(relative_path, "file tạm hoặc bản sao lưu"))
                continue
            try:
                if entry.is_symlink():
                    ignored_count += 1
                    warnings.append(_warning(relative_path, "liên kết tượng trưng"))
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if depth + 1 > MAX_DEPTH:
                        ignored_count += 1
                        warnings.append(_warning(relative_path, "vượt quá độ sâu 16"))
                        continue
                    if not re.fullmatch(_SLUG, entry.name):
                        ignored_count += 1
                        warnings.append(_warning(relative_path, "tên thư mục không hợp lệ"))
                        continue
                    if isinstance(target, int) and os.name != "nt":
                        try:
                            child_fd = os.open(
                                entry.name,
                                os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW,
                                dir_fd=target,
                            )
                        except OSError:
                            ignored_count += 1
                            warnings.append(_warning(relative_path, "không thể mở thư mục an toàn"))
                            continue
                        try:
                            if not walk(child_fd, relative_path, depth + 1):
                                return False
                        finally:
                            os.close(child_fd)
                    else:
                        if not walk(Path(entry.path), relative_path, depth + 1):
                            return False
                    continue
                if not entry.is_file(follow_symlinks=False):
                    ignored_count += 1
                    warnings.append(_warning(relative_path, "không phải file thường"))
                    continue
                if entry.name.endswith("-summary.md"):
                    continue
                match = _FILENAME_RE.fullmatch(entry.name)
                if not match:
                    ignored_count += 1
                    warnings.append(_warning(relative_path, "tên file không hợp lệ"))
                    continue
                metadata = entry.stat(follow_symlinks=False)
            except OSError:
                ignored_count += 1
                warnings.append(_warning(relative_path, "không thể đọc metadata"))
                continue

            version = int(match.group(1))
            slug = match.group(2)
            relative_directory_text = relative_directory.as_posix()
            identity = (
                slug
                if relative_directory_text == "."
                else f"{relative_directory_text}/{slug}"
            )
            candidates.append(
                _Candidate(
                    identity=identity,
                    relative_directory="" if relative_directory_text == "." else relative_directory_text,
                    slug=slug,
                    version=version,
                    relative_path=relative_path.as_posix(),
                    size_bytes=metadata.st_size,
                    modified_at=_modified_at(metadata.st_mtime),
                )
            )
        return True

    if isinstance(root_input, int) and os.name != "nt":
        walk(root_input, Path(), 0)
    else:
        walk(Path(root_input), Path(), 0)
    return candidates, ignored_count, warnings


def _open_root_fd(root: str | Path) -> int | Path | None:
    if os.name == "nt":
        p = Path(root)
        if not p.is_dir():
            if not p.exists():
                return None
            raise PlanFileError
        return p
    try:
        return os.open(root, os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise PlanFileError from error


_MANIFEST_CACHE: dict[str, tuple[tuple, PlanManifest]] = {}


def _manifest_watermark(root: str | Path) -> tuple | None:
    """Vân tay rẻ tiền của cây plan + review; ``None`` = "lần này không dùng cache".

    Cache cũ chỉ so mtime của THƯ MỤC GỐC, nên một file mới nằm trong thư mục con
    ``slug/`` bị bỏ sót (mtime đổi ở thư mục con, không phải thư mục gốc). Vân tay
    gộp ba nhóm, mỗi mục là ``(kind, đường dẫn tương đối, mtime_ns, số đo)``:

    - ``d``: thư mục gốc và mọi thư mục con mà scanner đi vào, kèm số mục — thêm/
      xoá/đổi tên bất kỳ mục nào đều đổi mtime của chính thư mục chứa nó;
    - ``f``: mỗi file có tên khớp mẫu plan, kèm size — sửa nội dung tại chỗ vẫn cho
      manifest mới (``sizeBytes``/``modifiedAt`` không bị cũ);
    - ``r``: cả cây ``.reviews`` — payload của ``GET /__box/plans`` mang trường
      ``review`` nên một review mới/sửa phải phá cache.

    Trả ``None`` khi không dựng được vân tay (lỗi đọc, quá ``MAX_ENTRIES``): khi đó
    bỏ cache để không bao giờ phục vụ manifest cũ.
    """

    parts: list[tuple] = []
    total = 0

    def fold_reviews(directory: Path, relative: Path, depth: int) -> bool:
        try:
            metadata = os.stat(directory)
            entries = sorted(os.scandir(directory), key=lambda item: item.name)
        except FileNotFoundError:
            return True  # chưa ai duyệt plan nào
        except OSError:
            return False
        parts.append(("r", relative.as_posix(), metadata.st_mtime_ns, len(entries)))
        for entry in entries:
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                if entry.is_symlink():
                    continue
                child = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            parts.append((
                "r",
                f"{relative.as_posix()}/{entry.name}",
                child.st_mtime_ns,
                0 if is_dir else child.st_size,
            ))
            if is_dir and depth + 1 <= MAX_DEPTH:
                if not fold_reviews(Path(entry.path), relative / entry.name, depth + 1):
                    return False
        return True

    def walk(directory: Path, relative: Path, depth: int) -> bool:
        nonlocal total
        try:
            metadata = os.stat(directory)
            entries = sorted(os.scandir(directory), key=lambda item: item.name)
        except OSError:
            return False
        parts.append(("d", relative.as_posix(), metadata.st_mtime_ns, len(entries)))
        for entry in entries:
            total += 1
            if total > MAX_ENTRIES:
                return False
            name = entry.name
            if name == REVIEWS_DIR_NAME:
                if not fold_reviews(directory / name, relative / name, depth + 1):
                    return False
                continue
            if name.startswith(".") or _is_temporary_name(name):
                continue
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if depth + 1 > MAX_DEPTH or not re.fullmatch(_SLUG, name):
                        continue
                    if not walk(Path(entry.path), relative / name, depth + 1):
                        return False
                    continue
                if entry.is_file(follow_symlinks=False) and _FILENAME_RE.fullmatch(name):
                    child = entry.stat(follow_symlinks=False)
                    parts.append((
                        "f", (relative / name).as_posix(), child.st_mtime_ns, child.st_size
                    ))
            except OSError:
                continue
        return True

    if not walk(Path(root), Path(), 0):
        return None
    return tuple(sorted(parts))


def scan_plans(root: str | Path) -> PlanManifest:
    """Quét file hợp lệ dưới root với sort, xử lý collision và cache theo vân tay."""

    try:
        os.stat(root)
    except OSError:
        return PlanManifest((), 0, (), frozenset())

    root_key = str(Path(root).resolve())
    watermark = _manifest_watermark(root)
    cached = _MANIFEST_CACHE.get(root_key)
    if watermark is not None and cached is not None and cached[0] == watermark:
        return cached[1]

    root_target = _open_root_fd(root)
    if root_target is None:
        return PlanManifest((), 0, (), frozenset())
    try:
        candidates, ignored_count, warnings = _walk_plan_entries(root_target)
    finally:
        if isinstance(root_target, int):
            os.close(root_target)

    by_key: dict[tuple[str, int], list[_Candidate]] = {}
    for candidate in candidates:
        by_key.setdefault((candidate.identity, candidate.version), []).append(candidate)

    collisions = frozenset(key for key, items in by_key.items() if len(items) > 1)
    if collisions:
        for identity, version in sorted(collisions):
            paths = sorted(candidate.relative_path for candidate in by_key[(identity, version)])
            warnings.append(
                f"Đã bỏ qua phiên bản xung đột {identity}@v{version}: {', '.join(paths)}."
            )
            ignored_count += len(by_key[(identity, version)])

    grouped: dict[str, list[_Candidate]] = {}
    for key, items in by_key.items():
        if key not in collisions:
            grouped.setdefault(key[0], []).append(items[0])

    plans: list[PlanGroup] = []
    for identity in sorted(grouped):
        versions = sorted(grouped[identity], key=lambda item: item.version, reverse=True)
        plans.append(
            PlanGroup(
                identity=identity,
                relative_directory=versions[0].relative_directory,
                slug=versions[0].slug,
                versions=tuple(
                    PlanVersion(
                        version=item.version,
                        relative_path=item.relative_path,
                        size_bytes=item.size_bytes,
                        modified_at=item.modified_at,
                        status=(
                            "draft"
                            if len(versions) > 1 and index == 0
                            else "approved"
                        ),
                    )
                    for index, item in enumerate(versions)
                ),
            )
        )
    manifest = PlanManifest(
        tuple(plans), ignored_count, tuple(warnings), collisions, read_reviews(root)
    )
    if watermark is not None:
        _MANIFEST_CACHE[root_key] = (watermark, manifest)
    else:
        _MANIFEST_CACHE.pop(root_key, None)
    return manifest


def _open_document_fd(root: str | Path, relative_directory: str, filename: str) -> int:
    if os.name == "nt":
        full_path = Path(root) / relative_directory / filename
        if not full_path.is_file():
            raise PlanNotFound
        return os.open(str(full_path), os.O_RDONLY | getattr(os, "O_BINARY", 0))
    root_fd = _open_root_fd(root)
    if root_fd is None or not isinstance(root_fd, int):
        raise PlanNotFound
    directory_fds = [root_fd]
    try:
        current_fd = root_fd
        for segment in filter(None, relative_directory.split("/")):
            next_fd = os.open(
                segment,
                os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW,
                dir_fd=current_fd,
            )
            directory_fds.append(next_fd)
            current_fd = next_fd
        return os.open(filename, os.O_RDONLY | _O_NOFOLLOW, dir_fd=current_fd)
    finally:
        for descriptor in reversed(directory_fds):
            os.close(descriptor)


def _read_open_file(descriptor: int) -> tuple[bytes, os.stat_result]:
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise PlanNotFound
        if metadata.st_size > MAX_FILE_SIZE:
            raise PlanTooLarge
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, MAX_FILE_SIZE + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_FILE_SIZE:
                raise PlanTooLarge
        return b"".join(chunks), metadata
    finally:
        os.close(descriptor)


def read_plan(root: str | Path, identity: str, version: object) -> PlanDocument:
    """Quét lại rồi đọc một file qua directory FD chống traversal và race."""

    relative_directory, slug = validate_identity(identity)
    parsed_version = validate_version(version)
    manifest = scan_plans(root)
    key = (identity, parsed_version)
    if key in manifest.collisions:
        raise PlanCollision
    selected = manifest.version_for(identity, parsed_version)
    if selected is None:
        raise PlanNotFound

    try:
        descriptor = _open_document_fd(
            root, relative_directory, f"v{parsed_version}-{slug}.md"
        )
        content, metadata = _read_open_file(descriptor)
    except PlanFileError:
        raise
    except OSError as error:
        if error.errno in (errno.ENOENT, errno.ENOTDIR, errno.ELOOP):
            raise PlanNotFound from error
        raise PlanFileError from error

    try:
        markdown = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise InvalidPlanEncoding from error

    return PlanDocument(
        identity=identity,
        version=parsed_version,
        relative_path=selected.relative_path,
        markdown=markdown,
        size_bytes=metadata.st_size,
        modified_at=_modified_at(metadata.st_mtime),
        status=selected.status,
    )


# ---------------------------------------------------------------------------
# Trạng thái duyệt plan — `.reviews/<identity>.json` (hợp đồng §2)
#
# Người dùng bấm "Duyệt" / "Yêu cầu sửa" trong tab Plan → ide-proxy gọi
# ``write_review`` (root) → file do user agent sở hữu. ``GET /__box/plans`` đọc lại
# bằng ``read_reviews`` và gắn vào từng bản ghi qua trường ``review``.
# ---------------------------------------------------------------------------
def _open_or_make_child(dir_fd: int, segment: str, *, create: bool) -> int | None:
    """Mở thư mục con ``segment`` (không đi theo symlink); tạo nếu thiếu và ``create``."""

    try:
        return os.open(segment, os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW, dir_fd=dir_fd)
    except FileNotFoundError:
        if not create:
            return None
        try:
            os.mkdir(segment, 0o750, dir_fd=dir_fd)
        except FileExistsError:
            pass
        except OSError as error:
            raise _review_write_failure(error) from error
        try:
            created_fd = os.open(
                segment, os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW, dir_fd=dir_fd
            )
        except OSError as error:
            raise PlanFileError from error
        try:
            os.fchown(created_fd, AGENT_UID, AGENT_GID)
            os.fchmod(created_fd, 0o750)
        except OSError:
            pass
        return created_fd
    except NotADirectoryError as error:
        raise InvalidPlanRequest from error  # `.reviews` đang là file thường
    except OSError as error:
        if error.errno == errno.ELOOP:
            # Symlink: từ chối thay vì ghi ra ngoài `.plans` (ide-proxy chạy root).
            raise InvalidPlanRequest from error
        raise PlanFileError from error


def _open_reviews_fd(root: str | Path, relative_directory: str = "", *, create: bool) -> int | None:
    """fd của ``<root>/.reviews[/<relative_directory>]``; ``None`` nếu thiếu (create=False)."""

    root_fd = _open_root_fd(root)
    if root_fd is None or not isinstance(root_fd, int):
        raise PlanNotFound
    opened: list[int] = [root_fd]
    keep: int | None = None
    try:
        current = root_fd
        segments = [REVIEWS_DIR_NAME, *filter(None, relative_directory.split("/"))]
        for segment in segments:
            child_fd = _open_or_make_child(current, segment, create=create)
            if child_fd is None:
                return None
            opened.append(child_fd)
            current = child_fd
        keep = current
        return keep
    finally:
        for descriptor in opened:
            if descriptor != keep:
                try:
                    os.close(descriptor)
                except OSError:
                    pass


def _parse_review(identity: str, raw: bytes) -> dict | None:
    """Phân tích JSON của một review; None nếu không hợp lệ (bỏ qua có chủ ý)."""

    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("decision") not in REVIEW_DECISIONS:
        return None
    note = data.get("note")
    updated_at = data.get("updatedAt")
    if isinstance(updated_at, bool) or not isinstance(updated_at, (int, float)):
        updated_at = None
    return {
        # identity lấy từ ĐƯỜNG DẪN, không tin trường trong file: kẻ ghi được file
        # cũng không mạo danh được review của plan khác.
        "identity": identity,
        "decision": data["decision"],
        "note": note if isinstance(note, str) else "",
        "updatedAt": float(updated_at) if updated_at is not None else None,
    }


def _read_review_record(dir_fd: int, name: str, identity: str) -> dict | None:
    """Đọc MỘT file review qua dir_fd; None nếu không đọc được / không hợp lệ."""

    try:
        descriptor = os.open(name, os.O_RDONLY | _O_NOFOLLOW, dir_fd=dir_fd)
    except OSError:
        return None
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_FILE_SIZE:
            return None
        chunks: list[bytes] = []
        remaining = metadata.st_size
        while remaining > 0:
            chunk = os.read(descriptor, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    except OSError:
        return None
    finally:
        os.close(descriptor)
    return _parse_review(identity, raw)


def _read_review_record_path(path: Path, identity: str) -> dict | None:
    """Bản dùng ``Path`` (Windows) của ``_read_review_record``."""

    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) > MAX_FILE_SIZE:
        return None
    return _parse_review(identity, raw)


def _collect_reviews(target: int | Path, relative: Path, out: dict[str, dict], depth: int = 0) -> None:
    """Thu review trong một thư mục (fd POSIX hoặc Path), đệ quy theo identity lồng nhau."""

    try:
        entries = sorted(os.scandir(target), key=lambda item: item.name)
    except OSError:
        return
    for entry in entries:
        name = entry.name
        try:
            if entry.is_symlink() or name.startswith(".") or _is_temporary_name(name):
                continue
            if entry.is_dir(follow_symlinks=False):
                if depth + 1 > MAX_DEPTH or not re.fullmatch(_SLUG, name):
                    continue
                if isinstance(target, int) and os.name != "nt":
                    try:
                        child_fd = os.open(
                            name, os.O_RDONLY | _O_DIRECTORY | _O_NOFOLLOW, dir_fd=target
                        )
                    except OSError:
                        continue
                    try:
                        _collect_reviews(child_fd, relative / name, out, depth + 1)
                    finally:
                        os.close(child_fd)
                else:
                    _collect_reviews(Path(entry.path), relative / name, out, depth + 1)
                continue
            if not entry.is_file(follow_symlinks=False) or not name.endswith(REVIEW_FILE_SUFFIX):
                continue
            try:
                # Dùng ĐÚNG ánh xạ nghịch của lúc ghi (identity trần), rồi kiểm lại
                # bằng validate_identity: file lạ/đặt sai chỗ bị bỏ qua, không đoán.
                identity = identity_from_review_relative_path((relative / name).as_posix())
                validate_identity(identity)
            except (ValueError, InvalidPlanRequest):
                continue
            if isinstance(target, int) and os.name != "nt":
                record = _read_review_record(target, name, identity)
            else:
                record = _read_review_record_path(Path(entry.path), identity)
            if record is not None:
                out[identity] = record
        except OSError:
            continue


def read_reviews(root: str | Path) -> dict[str, dict]:
    """Đọc mọi review dưới ``<root>/.reviews`` → ``{identity: record}``.

    Best-effort: thư mục thiếu/không đọc được thì trả ``{}`` — manifest plan vẫn
    phải phục vụ được dù trạng thái duyệt hỏng.
    """

    out: dict[str, dict] = {}
    if os.name == "nt":
        directory = Path(root) / REVIEWS_DIR_NAME
        if directory.is_dir():
            _collect_reviews(directory, Path(), out)
        return out
    try:
        reviews_fd = _open_reviews_fd(root, "", create=False)
    except PlanFileError:
        return out
    if reviews_fd is None:
        return out
    try:
        _collect_reviews(reviews_fd, Path(), out)
    finally:
        os.close(reviews_fd)
    return out


def _write_all(descriptor: int, data: bytes) -> None:
    """Ghi hết ``data`` (xử lý short-write); lỗi ghi → PlanFileError."""

    view = memoryview(data)
    offset = 0
    while offset < len(view):
        written = os.write(descriptor, view[offset:])
        if written <= 0:
            raise PlanFileError
        offset += written


def _review_temporary_name(slug: str) -> str:
    """Tên file tạm cho ghi nguyên tử — NGẮN và không phụ thuộc độ dài ``slug``.

    Không dùng ``.<slug>.<pid>.tmp``: identity dài nhất hợp lệ cộng thêm phần tên tạm
    sẽ vượt giới hạn tên thành phần (255 byte). Băm slug thay vì nhúng nó, và tên tạm
    bắt đầu bằng dấu chấm nên ``read_reviews`` luôn bỏ qua.
    """

    digest = hashlib.blake2s(slug.encode("utf-8"), digest_size=8).hexdigest()
    return f".tmp-{digest}-{os.getpid()}"


def _review_write_failure(error: OSError) -> PlanFileError:
    """Lỗi khi ghi file review: tên quá dài là lỗi NGƯỜI GỌI (400), còn lại là hệ thống."""

    if error.errno == errno.ENAMETOOLONG:
        return InvalidPlanRequest("'identity' quá dài.")
    return PlanFileError


def _write_review_file(root: str | Path, relative_directory: str, slug: str, record: dict) -> None:
    """Ghi nguyên tử ``.reviews/<identity>.json`` (tmp + rename) và hạ quyền về agent.

    Đường dẫn đích suy từ identity bằng ``identity_to_review_relative_path``: ``slug`` là
    đoạn CUỐI, ``relative_directory`` là các đoạn trước (rỗng khi plan ở gốc ``.plans/``).
    """

    payload = json.dumps(record, ensure_ascii=False).encode("utf-8")
    if os.name == "nt":
        directory = Path(root) / REVIEWS_DIR_NAME
        if relative_directory:
            directory = directory / relative_directory
        temporary = directory / _review_temporary_name(slug)
        try:
            directory.mkdir(parents=True, exist_ok=True)
            temporary.write_bytes(payload)
            os.replace(temporary, directory / f"{slug}{REVIEW_FILE_SUFFIX}")
        except OSError as error:
            raise _review_write_failure(error) from error
        return

    reviews_fd = _open_reviews_fd(root, relative_directory, create=True)
    if reviews_fd is None:
        raise PlanFileError
    temporary_name = _review_temporary_name(slug)
    try:
        try:
            os.unlink(temporary_name, dir_fd=reviews_fd)  # dọn tàn dư của lần ghi trước
        except OSError:
            pass
        try:
            descriptor = os.open(
                temporary_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | _O_NOFOLLOW,
                0o640,
                dir_fd=reviews_fd,
            )
        except OSError as error:
            raise _review_write_failure(error) from error
        try:
            _write_all(descriptor, payload)
            try:
                os.fchown(descriptor, AGENT_UID, AGENT_GID)
            except OSError:
                pass
            try:
                os.fchmod(descriptor, 0o640)
            except OSError:
                pass
        finally:
            os.close(descriptor)
        try:
            # rename thay thế: review cũ bị ghi đè trong một bước nguyên tử.
            os.rename(temporary_name, f"{slug}.json", src_dir_fd=reviews_fd, dst_dir_fd=reviews_fd)
        except OSError as error:
            raise _review_write_failure(error) from error
    except BaseException:
        try:
            os.unlink(temporary_name, dir_fd=reviews_fd)
        except OSError:
            pass
        raise
    finally:
        os.close(reviews_fd)


def write_review(root: str | Path, identity: object, decision: object, note: object = "") -> dict:
    """Ghi trạng thái duyệt của một plan; trả ``{identity, decision, note, updatedAt}``.

    400 khi ``identity`` sai quy tắc tên (dùng lại ``validate_identity``) hoặc
    ``decision`` ngoài ``{approved, changes_requested}``; 413 khi ``note`` quá lớn.

    File đích theo đúng cặp ánh xạ thuận/nghịch ở docstring module: identity **trần**,
    ``/`` thành thư mục con (``designs/login`` → ``.reviews/designs/login.json``).
    """

    relative_directory, slug = validate_identity(identity)
    if len(identity) > MAX_IDENTITY_LENGTH:
        raise InvalidPlanRequest("'identity' quá dài.")
    if not isinstance(decision, str) or decision not in REVIEW_DECISIONS:
        raise InvalidPlanRequest("'decision' phải là approved hoặc changes_requested.")
    if note is None:
        note = ""
    if not isinstance(note, str):
        raise InvalidPlanRequest("'note' phải là chuỗi.")
    if len(note.encode("utf-8")) > MAX_NOTE_SIZE:
        raise PlanTooLarge
    record: dict = {
        "identity": identity,
        "decision": decision,
        "note": note,
        "updatedAt": time.time(),
    }
    _write_review_file(root, relative_directory, slug, record)
    return record
