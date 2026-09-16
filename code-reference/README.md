# Curated upstream source evidence

This directory is a **read-only curated research evidence snapshot**, not BoxFox runtime code or a dependency. It retains a substantial, selectively scoped set of directly relevant upstream files at verified commits for the harness and router research: enough to substantiate documented architecture, protocol, credential, security, prompt, skill, and subagent findings without vendoring complete upstream repositories. Full research clones remain outside this repository at `/code/research` and are deliberately not vendored here.

## Layout and provenance

Each `<area>/<project>/<commit>/` has:

- `manifest.json`: one entry per retained file, including its upstream-relative and local paths, pinned GitHub blob URL, SHA-256, topic, license, and permitted reuse class.
- `LICENSES/LICENSE`: the upstream top-level license preserved with the snapshot.
- `upstream/`: original relative paths, without edits or generated artifacts.

The manifest shape is defined by [`schema/snapshot-manifest.schema.json`](schema/snapshot-manifest.schema.json). All current entries are `reference-only`: they support analysis and attribution, and are not authorization to make BoxFox runtime derive from them. Any future `copy` or `adapt` entry needs a separate legal/security review and retained attribution.

## Scope

| Area | Project | Pinned commit | Evidence focus |
| --- | --- | --- | --- |
| Agent harness | Hermes Agent | `69fd61b0efbe2bf7f412714ed8c35e40dfddc534` | agent loop, prompts/tools, skill bundle/loader, Claude Code/Codex/OpenCode/Claude Design skills, delegation |
| Agent harness | OpenCode | `e03db9bc6908f75c9334d8aa997deeaac81c0298` | sessions, prompt/context compaction, permissions, skills, tools and child tasks |
| Model router | 9Router | `17c4cc76877bd1755030a8414f8d0083f48dcccf` | OpenAI/Anthropic/Responses ingress, translators, OAuth and API-key storage boundary |
| Model router | OmniRoute | `7cabac4985e8abcd7a34bad285698eebb924c46a` | catch-all ingress, routing/fallback, protocol translation, token refresh and response sanitation |
| Model router | Claude Code Router | `cbe5f7bb3b3511ac31274559f2e9f387cab6fe40` | gateway pipeline, routing policy, credential pool, OAuth, sanitization, limits and proxy certificates |
| Model router | LiteLLM | `c8114ba41ff76365e3fb065dd3c7ca387598fd98` | router/fallback, proxy auth, protocol transformations, credentials and rate limiting |

LiteLLM `enterprise/` is explicitly excluded. No `.env` files, keys, OAuth tokens, cookies, credential databases, installed dependencies, build output, or generated files belong here.

## Verification

Install the verifier dependency once, then run from the repository root:

```bash
python3 -m pip install -r code-reference/requirements.txt
python3 code-reference/scripts/verify_code_reference.py
python3 -m unittest discover -s code-reference/tests -v
```

The verifier fails if no snapshots are present and validates every manifest with Draft 2020-12 JSON Schema (`jsonschema` is required and reports a clear setup error if unavailable), SHA-256 of every retained source file, safe paths, percent-encoded fixed blob URLs, license copies, and excluded material. It treats the scoped research notes as a mapping contract: each named snapshot path and direct pinned source citation must be retained and declared. It scans relevant source, build, and configuration inputs in `backend/`, `frontend/`, `deploy/`, `scripts/`, `test/`, and `benchmark/` for imports or `COPY` references to `code-reference`—including Dockerfiles, Compose files, package manifests/locks, and supported build/config files—while deliberately ignoring prose files to avoid false positives. It also requires package metadata to remain inside the evidence-only `upstream/` tree.

Regression coverage is in `tests/`; run it with:

```bash
python3 -m unittest discover -s code-reference/tests -v
```
