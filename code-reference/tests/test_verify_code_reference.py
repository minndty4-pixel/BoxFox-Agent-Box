from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_code_reference.py"
SPEC = importlib.util.spec_from_file_location("verify_code_reference", SCRIPT)
assert SPEC and SPEC.loader
verify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify)


class SnapshotVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.schema = verify.load_schema()

    @staticmethod
    def manifest(commit: str = "a" * 40) -> dict:
        return {
            "schema_version": 1,
            "snapshot_kind": "curated-source-evidence",
            "runtime_importable": False,
            "project": {
                "id": "fixture",
                "repository": "https://github.com/example/fixture",
                "commit": commit,
                "license": "MIT",
                "upstream_manifest": "package.json",
                "license_file": "LICENSE",
                "excluded": [".env"],
            },
            "files": [],
        }

    def test_schema_accepts_bracketed_next_route_path(self) -> None:
        manifest = self.manifest()
        manifest["files"] = [{
            "upstream_path": "src/app/api/[...catchAll]/route.ts",
            "local_path": "upstream/src/app/api/[...catchAll]/route.ts",
            "pinned_blob_url": verify.encoded_blob_url(
                manifest["project"]["repository"], manifest["project"]["commit"], "src/app/api/[...catchAll]/route.ts"
            ),
            "sha256": "0" * 64,
            "license": "MIT",
            "reuse_class": "reference-only",
            "topics": ["ingress"],
        }]
        self.assertEqual([], verify.validate_manifest_schema(manifest, self.schema))

    def test_blob_urls_percent_encode_path_segments(self) -> None:
        self.assertEqual(
            "https://github.com/example/fixture/blob/" + "a" * 40 + "/src/app/api/%5B...catchAll%5D/route%20name.ts",
            verify.encoded_blob_url(
                "https://github.com/example/fixture", "a" * 40, "src/app/api/[...catchAll]/route name.ts"
            ),
        )

    def test_schema_rejects_incomplete_entry(self) -> None:
        manifest = self.manifest()
        manifest["files"] = [{"upstream_path": "README.md"}]
        errors = verify.validate_manifest_schema(manifest, self.schema)
        self.assertTrue(errors)
        self.assertIn("required property", " ".join(errors))

    def test_detects_hash_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / ("a" * 40)
            (snapshot / "LICENSES").mkdir(parents=True)
            (snapshot / "LICENSES" / "LICENSE").write_text("MIT\n")
            (snapshot / "upstream").mkdir()
            (snapshot / "upstream" / "README.md").write_text("actual\n")
            manifest = self.manifest()
            manifest["files"] = [
                {
                    "upstream_path": "LICENSE",
                    "local_path": "LICENSES/LICENSE",
                    "pinned_blob_url": verify.encoded_blob_url(manifest["project"]["repository"], "a" * 40, "LICENSE"),
                    "sha256": verify.digest(snapshot / "LICENSES" / "LICENSE"),
                    "license": "MIT", "reuse_class": "reference-only", "topics": ["license"],
                },
                {
                    "upstream_path": "README.md", "local_path": "upstream/README.md",
                    "pinned_blob_url": verify.encoded_blob_url(manifest["project"]["repository"], "a" * 40, "README.md"),
                    "sha256": "0" * 64, "license": "MIT", "reuse_class": "reference-only", "topics": ["overview"],
                },
            ]
            manifest_path = snapshot / "manifest.json"
            manifest_path.write_text(json.dumps(manifest))
            errors: list[str] = []
            verify.verify_manifest(manifest_path, errors, self.schema)
            self.assertTrue(any("SHA-256 mismatch" in error for error in errors), errors)

    def test_detects_unretained_pinned_source_citation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "code-reference"
            commit = "a" * 40
            snapshot = reference / "agent-harness" / "fixture" / commit
            snapshot.mkdir(parents=True)
            (snapshot / "manifest.json").write_text(json.dumps(self.manifest(commit)))
            docs = root / "docs"
            docs.mkdir()
            (docs / "citation.md").write_text(
                f"https://github.com/example/fixture/blob/{commit}/missing.py\n"
            )
            original_reference, original_docs, original_repo = verify.REFERENCE_ROOT, verify.DOC_ROOTS, verify.REPOSITORY_ROOT
            try:
                verify.REFERENCE_ROOT, verify.DOC_ROOTS, verify.REPOSITORY_ROOT = reference, (docs,), root
                errors: list[str] = []
                verify.verify_direct_source_citations(errors)
            finally:
                verify.REFERENCE_ROOT, verify.DOC_ROOTS, verify.REPOSITORY_ROOT = original_reference, original_docs, original_repo
            self.assertTrue(any("pinned source citation" in error for error in errors), errors)

    def test_main_rejects_zero_manifests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "code-reference"
            reference.mkdir()
            (reference / "schema").mkdir()
            (reference / "schema" / "snapshot-manifest.schema.json").write_text(
                (Path(__file__).resolve().parents[1] / "schema" / "snapshot-manifest.schema.json").read_text()
            )
            original_reference, original_schema, original_docs, original_repo = (
                verify.REFERENCE_ROOT, verify.SCHEMA_PATH, verify.DOC_ROOTS, verify.REPOSITORY_ROOT
            )
            try:
                verify.REFERENCE_ROOT = reference
                verify.SCHEMA_PATH = reference / "schema" / "snapshot-manifest.schema.json"
                verify.DOC_ROOTS = ()
                verify.REPOSITORY_ROOT = Path(directory)
                with contextlib.redirect_stderr(io.StringIO()) as stderr:
                    self.assertEqual(1, verify.main())
            finally:
                verify.REFERENCE_ROOT, verify.SCHEMA_PATH, verify.DOC_ROOTS, verify.REPOSITORY_ROOT = (
                    original_reference, original_schema, original_docs, original_repo
                )
            self.assertIn("no snapshot manifests found", stderr.getvalue())

    def test_runtime_scan_ignores_prose_but_checks_build_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deploy").mkdir()
            (root / "deploy" / "notes.md").write_text("code-reference is research-only\n")
            (root / "deploy" / "compose.yaml").write_text("services: {} # code-reference\n")
            original_root, original_roots = verify.REPOSITORY_ROOT, verify.RUNTIME_SCAN_ROOTS
            try:
                verify.REPOSITORY_ROOT = root
                verify.RUNTIME_SCAN_ROOTS = ("deploy",)
                errors: list[str] = []
                verify.verify_runtime_non_import(errors)
            finally:
                verify.REPOSITORY_ROOT, verify.RUNTIME_SCAN_ROOTS = original_root, original_roots
            self.assertEqual(1, len(errors), errors)
            self.assertIn("compose.yaml", errors[0])

    def test_detects_runtime_copy_reference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deploy").mkdir()
            (root / "deploy" / "Dockerfile").write_text("COPY code-reference /app/reference\n")
            original_root, original_roots = verify.REPOSITORY_ROOT, verify.RUNTIME_SCAN_ROOTS
            try:
                verify.REPOSITORY_ROOT = root
                verify.RUNTIME_SCAN_ROOTS = ("deploy",)
                errors: list[str] = []
                verify.verify_runtime_non_import(errors)
            finally:
                verify.REPOSITORY_ROOT, verify.RUNTIME_SCAN_ROOTS = original_root, original_roots
            self.assertTrue(any("runtime/build input" in error for error in errors), errors)

    def test_detects_broken_document_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "code-reference"
            commit = "a" * 40
            snapshot = reference / "agent-harness" / "fixture" / commit
            snapshot.mkdir(parents=True)
            (snapshot / "manifest.json").write_text(json.dumps(self.manifest(commit)))
            docs = root / "docs"
            docs.mkdir()
            (docs / "mapping.md").write_text(
                f"`code-reference/agent-harness/fixture/{commit}/upstream/missing.py`\n"
            )
            original_reference, original_docs, original_repo = verify.REFERENCE_ROOT, verify.DOC_ROOTS, verify.REPOSITORY_ROOT
            try:
                verify.REFERENCE_ROOT, verify.DOC_ROOTS, verify.REPOSITORY_ROOT = reference, (docs,), root
                errors: list[str] = []
                verify.verify_document_mappings(errors)
            finally:
                verify.REFERENCE_ROOT, verify.DOC_ROOTS, verify.REPOSITORY_ROOT = original_reference, original_docs, original_repo
            self.assertTrue(any("mapped snapshot path" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
