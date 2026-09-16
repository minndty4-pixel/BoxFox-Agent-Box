#!/usr/bin/env python3
"""Verify BoxFox's curated, non-runtime source evidence snapshots.

The verifier intentionally treats research notes as a mapping contract: every concrete
`code-reference/.../upstream/...` path named by the supported research documents must
exist on disk and have a matching manifest record. Direct pinned GitHub source links in
those same notes are also retained as local snapshot evidence.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote, unquote

try:
    import jsonschema
except ImportError:  # pragma: no cover - exercised in environments without the optional package
    jsonschema = None

REFERENCE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = REFERENCE_ROOT.parent
SCHEMA_PATH = REFERENCE_ROOT / "schema" / "snapshot-manifest.schema.json"
DOC_ROOTS = (
    REPOSITORY_ROOT / "docs" / "research" / "agent-harness" / "opencode",
    REPOSITORY_ROOT / "docs" / "research" / "agent-harness" / "hermes-agent",
    REPOSITORY_ROOT / "docs" / "research" / "model-router",
)
MANIFEST_RE = re.compile(r"^[0-9a-f]{40}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
SNAPSHOT_ROOT_RE = re.compile(
    r"code-reference/(?P<area>[a-z-]+)/(?P<project>[a-z0-9-]+)/(?P<commit>[0-9a-f]{40})/(?P<suffix>[^`\s]*)"
)
EXCLUDED_PARTS = frozenset({
    ".git", ".next", ".pytest_cache", ".mypy_cache", ".turbo", "__pycache__",
    "build", "coverage", "dist", "node_modules", "vendor",
})
RUNTIME_SCAN_ROOTS = ("backend", "frontend", "deploy", "scripts", "test", "benchmark")
# Only inspect executable source and build/configuration inputs. In particular, do not
# treat prose (Markdown, text, documentation) as runtime evidence of an import/COPY.
RUNTIME_INPUT_SUFFIXES = frozenset({
    ".bash", ".bat", ".cjs", ".cfg", ".cmd", ".conf", ".dockerfile", ".env", ".gradle",
    ".ini", ".js", ".json", ".jsx", ".mjs", ".properties", ".ps1", ".py", ".sh",
    ".toml", ".ts", ".tsx", ".xml", ".yaml", ".yml",
})
RUNTIME_INPUT_NAMES = frozenset({
    "Cargo.lock", "Containerfile", "Dockerfile", "Gemfile", "Gemfile.lock", "Makefile", "Pipfile",
    "Pipfile.lock", "Procfile", "buildspec.yml", "compose.yaml", "compose.yml", "docker-compose.yaml",
    "docker-compose.yml", "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml",
    "poetry.lock", "requirements.txt", "uv.lock", "yarn.lock",
})
RUNTIME_INPUT_PREFIXES = (".env.", "Containerfile.", "Dockerfile.", "compose.", "docker-compose.")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def safe_relative(value: str) -> bool:
    path = Path(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and "\\" not in value


def encoded_blob_url(repository: str, commit: str, upstream_path: str) -> str:
    """Build a GitHub blob URL, escaping each path segment (not its `/` separator)."""
    encoded_path = "/".join(quote(segment, safe="._-~") for segment in upstream_path.split("/"))
    return f"{repository}/blob/{commit}/{encoded_path}"


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def load_schema(schema_path: Path = SCHEMA_PATH) -> dict:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError("schema does not declare Draft 2020-12")
    if jsonschema is None:
        raise RuntimeError("jsonschema is required to validate snapshot manifests; install the jsonschema package")
    jsonschema.Draft202012Validator.check_schema(schema)
    return schema


def validate_manifest_schema(manifest: object, schema: dict) -> list[str]:
    if jsonschema is None:
        return ["jsonschema is unavailable"]
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    return [f"schema violation at {'/'.join(str(part) for part in error.absolute_path) or '<root>'}: {error.message}"
            for error in sorted(validator.iter_errors(manifest), key=lambda item: list(item.absolute_path))]


def verify_manifest(manifest_path: Path, errors: list[str], schema: dict) -> None:
    snapshot_root = manifest_path.parent
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(errors, f"{manifest_path}: invalid JSON: {exc}")
        return
    for message in validate_manifest_schema(manifest, schema):
        fail(errors, f"{manifest_path}: {message}")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("project"), dict) or not isinstance(manifest.get("files"), list):
        return

    project = manifest["project"]
    commit = project.get("commit", "")
    repository = project.get("repository", "")
    if not isinstance(commit, str) or not MANIFEST_RE.fullmatch(commit):
        fail(errors, f"{manifest_path}: project.commit must be a full 40-character SHA")
        return
    if snapshot_root.name != commit:
        fail(errors, f"{manifest_path}: commit directory and project.commit differ")
    if not isinstance(repository, str) or not repository.startswith("https://github.com/"):
        fail(errors, f"{manifest_path}: repository must be a GitHub HTTPS URL")
        return
    if not (snapshot_root / "LICENSES" / "LICENSE").is_file():
        fail(errors, f"{manifest_path}: missing retained top-level LICENSE")

    observed: set[str] = set()
    for item in manifest["files"]:
        if not isinstance(item, dict):
            continue  # JSON Schema already supplies the specific error.
        upstream_path = item.get("upstream_path")
        local_path = item.get("local_path")
        if not isinstance(upstream_path, str) or not isinstance(local_path, str):
            continue
        if not safe_relative(upstream_path) or not safe_relative(local_path):
            fail(errors, f"{manifest_path}: unsafe path: {local_path!r}")
            continue
        allowed_license = upstream_path == "LICENSE" and local_path == "LICENSES/LICENSE"
        if local_path != f"upstream/{upstream_path}" and not allowed_license:
            fail(errors, f"{manifest_path}: local/upstream path mismatch: {local_path}")
        expected_url = encoded_blob_url(repository, commit, upstream_path)
        if item.get("pinned_blob_url") != expected_url:
            fail(errors, f"{manifest_path}: unpinned or non-encoded blob URL for {upstream_path}")
        target = snapshot_root / local_path
        try:
            target.resolve().relative_to(snapshot_root.resolve())
        except ValueError:
            fail(errors, f"{manifest_path}: path escapes snapshot: {local_path}")
            continue
        if not target.is_file():
            fail(errors, f"{manifest_path}: missing retained file {local_path}")
        elif item.get("sha256") != digest(target):
            fail(errors, f"{manifest_path}: SHA-256 mismatch for {local_path}")
        if local_path in observed:
            fail(errors, f"{manifest_path}: duplicate entry {local_path}")
        observed.add(local_path)

    retained = {str(path.relative_to(snapshot_root)) for path in (snapshot_root / "upstream").rglob("*") if path.is_file()}
    retained.add("LICENSES/LICENSE")
    if observed != retained:
        fail(errors, f"{manifest_path}: manifest entries do not exactly cover retained evidence files")
    for path in snapshot_root.rglob("*"):
        relative = path.relative_to(snapshot_root)
        parts = set(relative.parts)
        if parts & EXCLUDED_PARTS or path.name == ".env" or path.name.startswith(".env."):
            fail(errors, f"{manifest_path}: excluded material present: {relative}")
        if project.get("id") == "litellm" and "enterprise" in parts:
            fail(errors, f"{manifest_path}: LiteLLM enterprise material is excluded: {relative}")
    if (snapshot_root / "__init__.py").exists():
        fail(errors, f"{manifest_path}: snapshot root exposes a Python package marker")
    if any(path.name in {"package.json", "pyproject.toml"} and path.relative_to(snapshot_root).parts[0] != "upstream" for path in snapshot_root.rglob("*")):
        fail(errors, f"{manifest_path}: package metadata must remain within upstream evidence")


def expand_braces(path: str) -> list[str]:
    match = re.search(r"\{([^{}]+)\}", path)
    if not match:
        return [path]
    return sum((expand_braces(path[:match.start()] + choice + path[match.end():]) for choice in match.group(1).split(",")), [])


def mapped_doc_paths() -> list[tuple[Path, int, Path, str]]:
    """Return each concrete snapshot mapping in the research notes.

    Mapping tables use both complete `code-reference/...` paths and fenced snippets
    where a snapshot root is followed by `upstream/...` lines. Ellipses/placeholders
    describe a pattern rather than a concrete file and are intentionally ignored.
    """
    mappings: list[tuple[Path, int, Path, str]] = []
    for docs_root in DOC_ROOTS:
        if not docs_root.exists():
            continue
        for document in sorted(docs_root.glob("*.md")):
            active_snapshot: Path | None = None
            for number, line in enumerate(document.read_text(encoding="utf-8").splitlines(), 1):
                match = SNAPSHOT_ROOT_RE.search(line)
                if match:
                    active_snapshot = REFERENCE_ROOT / match["area"] / match["project"] / match["commit"]
                    suffix = match["suffix"].rstrip(".,;:)")
                    if suffix.startswith("upstream/"):
                        mappings.append((document, number, active_snapshot, unquote(suffix)))
                stripped = line.strip().split("#", 1)[0].rstrip()
                if active_snapshot and stripped.startswith("upstream/"):
                    path = stripped.split()[0].rstrip(".,;:")
                    mappings.append((document, number, active_snapshot, unquote(path)))
    return mappings


def verify_document_mappings(errors: list[str]) -> None:
    manifests: dict[Path, set[str]] = {}
    for manifest_path in REFERENCE_ROOT.glob("*/**/manifest.json"):
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifests[manifest_path.parent] = {entry["local_path"] for entry in data.get("files", []) if isinstance(entry, dict)}
        except (OSError, json.JSONDecodeError):
            continue
    for document, line, snapshot, raw_path in mapped_doc_paths():
        if "..." in raw_path or "<" in raw_path:
            continue
        for local_path in expand_braces(raw_path):
            target = snapshot / local_path
            if local_path.endswith("/"):
                valid = target.is_dir() and any(str(file.relative_to(snapshot)) in manifests.get(snapshot, set()) for file in target.rglob("*") if file.is_file())
            else:
                valid = target.is_file() and local_path in manifests.get(snapshot, set())
            if not valid:
                fail(errors, f"{document.relative_to(REPOSITORY_ROOT)}:{line}: mapped snapshot path is absent or undeclared: {local_path}")


def verify_direct_source_citations(errors: list[str]) -> None:
    """Ensure each pinned GitHub blob cited in scoped research notes is retained."""
    by_origin: dict[tuple[str, str], tuple[Path, set[str]]] = {}
    for manifest_path in REFERENCE_ROOT.glob("*/**/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            project = manifest["project"]
            by_origin[(project["repository"], project["commit"])] = (
                manifest_path.parent,
                {entry["upstream_path"] for entry in manifest["files"] if isinstance(entry, dict)},
            )
        except (OSError, json.JSONDecodeError, KeyError, TypeError):
            continue
    for docs_root in DOC_ROOTS:
        if not docs_root.exists():
            continue
        for document in docs_root.glob("*.md"):
            text = document.read_text(encoding="utf-8")
            for repository, commit in by_origin:
                pattern = re.escape(f"{repository}/blob/{commit}/") + r"([^\s\)\]#`]+)"
                for raw_path in re.findall(pattern, text):
                    upstream_path = unquote(raw_path)
                    _, declared = by_origin[(repository, commit)]
                    if upstream_path.endswith("/"):
                        valid = any(item.startswith(upstream_path) for item in declared)
                    else:
                        valid = upstream_path in declared
                    if not valid:
                        fail(
                            errors,
                            f"{document.relative_to(REPOSITORY_ROOT)}: pinned source citation is absent or undeclared: {upstream_path}",
                        )


def is_runtime_input(path: Path) -> bool:
    """Return whether a path is source, build, lock, or configuration input."""
    return (
        path.name in RUNTIME_INPUT_NAMES
        or path.name.startswith(RUNTIME_INPUT_PREFIXES)
        or path.suffix.lower() in RUNTIME_INPUT_SUFFIXES
    )


def verify_runtime_non_import(errors: list[str]) -> None:
    for root_name in RUNTIME_SCAN_ROOTS:
        root = REPOSITORY_ROOT / root_name
        if not root.exists():
            continue
        for path in root.rglob("*"):
            relative = path.relative_to(REPOSITORY_ROOT)
            if (
                not path.is_file()
                or not is_runtime_input(path)
                or EXCLUDED_PARTS & set(relative.parts)
            ):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if "code-reference" in text or "code_reference" in text:
                fail(errors, f"runtime/build input references or COPYs code-reference: {relative}")


def main() -> int:
    errors: list[str] = []
    try:
        schema = load_schema(SCHEMA_PATH)
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError) as exc:
        fail(errors, f"schema validation setup failed: {exc}")
        schema = {}
    manifests = sorted(REFERENCE_ROOT.glob("*/**/manifest.json"))
    if not manifests:
        fail(errors, "no snapshot manifests found under code-reference")
    for manifest in manifests:
        verify_manifest(manifest, errors, schema)
    verify_document_mappings(errors)
    verify_direct_source_citations(errors)
    verify_runtime_non_import(errors)
    if errors:
        print("code-reference verification failed:", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"Verified {len(manifests)} curated source snapshots, schema, documentation mappings, and runtime isolation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
