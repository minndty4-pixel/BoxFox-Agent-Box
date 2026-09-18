"""Reproducible mechanical import; never execute upstream skill scripts."""
from pathlib import Path
import ast
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
HERMES = ROOT / 'research_code/hermes-agent-main/hermes-agent-main'
OPEN = ROOT / 'research_code/opencode-dev/opencode-dev'
DEST = ROOT / 'backend/src/agentbox/vendor'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    records = []
    skills = []
    for upstream, source in [('hermes', HERMES), ('opencode', OPEN)]:
        target = DEST / upstream
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / 'LICENSE', target / 'LICENSE')
    for group in ['skills', 'optional-skills']:
        for path in sorted((HERMES / group).rglob('*')):
            if not path.is_file() or '__pycache__' in path.parts or '.git' in path.parts:
                continue
            relative = path.relative_to(HERMES)
            target = DEST / 'hermes' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            records.append({'source': str(path.relative_to(ROOT)).replace('\\', '/'),
                            'target': str(target.relative_to(ROOT)).replace('\\', '/'),
                            'sha256': digest(path.read_bytes()), 'mode': 'verbatim'})
            if path.name == 'SKILL.md':
                skills.append({'id': path.parent.name, 'path': relative.as_posix(),
                               'optional': group == 'optional-skills',
                               'sha256': digest(path.read_bytes())})
    # Portable upstream module is copied unchanged and imported at runtime.
    source = HERMES / 'tools/computer_use/backend.py'
    target = DEST / 'hermes/computer_backend.py'
    shutil.copy2(source, target)
    records.append({'source': str(source.relative_to(ROOT)).replace('\\', '/'),
                    'target': str(target.relative_to(ROOT)).replace('\\', '/'),
                    'sha256': digest(source.read_bytes()), 'mode': 'verbatim'})
    source = HERMES / 'agent/tool_executor.py'
    text = source.read_text(encoding='utf-8')
    tree = ast.parse(text)
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_parse_tool_arguments')
    extracted = '"""Extracted verbatim from Hermes tool_executor.py. See ../manifest.json and LICENSE."""\nimport json\nfrom typing import Any, Optional\n\n' + ast.get_source_segment(text, node) + '\n'
    target = DEST / 'hermes/tool_arguments.py'
    target.write_text(extracted, encoding='utf-8')
    records.append({'source': str(source.relative_to(ROOT)).replace('\\', '/'), 'symbol': node.name,
                    'target': str(target.relative_to(ROOT)).replace('\\', '/'),
                    'sha256': digest(source.read_bytes()), 'mode': 'verbatim-function-with-imports'})
    source = OPEN / 'packages/opencode/src/agent/prompt/compaction.txt'
    shutil.copy2(source, DEST / 'opencode/compaction.txt')
    records.append({'source': str(source.relative_to(ROOT)).replace('\\', '/'),
                    'target': 'backend/src/agentbox/vendor/opencode/compaction.txt',
                    'sha256': digest(source.read_bytes()), 'mode': 'verbatim'})
    adapted = {
        'agent/context_compressor.py': 'backend/src/agentbox/agent_core/compression.py',
        'agent/session_persistence.py': 'backend/src/agentbox/memory/session_store.py',
        'tools/delegate_tool_toolsets.py': 'backend/src/agentbox/agent_core/roles.py',
        'tools/delegate_tool_child_run.py': 'backend/src/agentbox/agent_core/runtime.py',
        'tools/skills_tool.py': 'backend/src/agentbox/skills/catalog.py',
        'agent/conversation_loop.py': 'backend/src/agentbox/agent_core/runtime.py',
    }
    for src, dst in adapted.items():
        records.append({'source': 'research_code/hermes-agent-main/hermes-agent-main/' + src,
                        'target': dst, 'sha256': digest((HERMES / src).read_bytes()),
                        'mode': 'adapted-to-BoxFox-contracts', 'changes': 'Python async, BoxFox router, scoped Docker tools and SQLite; see architecture document.'})
    (DEST / 'manifest.json').write_text(json.dumps({'snapshot': 'local ZIP snapshot; upstream commit unavailable',
        'licenses': {'hermes': 'MIT, Copyright (c) 2025 Nous Research', 'opencode': 'MIT, Copyright (c) 2025 opencode'},
        'files': records, 'skills': skills}, indent=2, ensure_ascii=False), encoding='utf-8')
    appendix = ROOT / 'docs/architecture/hermes-skills-inventory.md'
    appendix.write_text('# Hermes skill inventory — v0\n\nGenerated from the local upstream snapshots. Full source and assets live in `backend/src/agentbox/vendor/hermes/`. Catalog membership does not assert runtime dependency availability.\n\n| Skill | Group | Source |\n|---|---|---|\n' + '\n'.join(
        f"| {s['id']} | {'optional' if s['optional'] else 'bundled'} | `{s['path']}` |" for s in skills) + '\n', encoding='utf-8')
    print(json.dumps({'skills': len(skills), 'source_files': len(records)}))


if __name__ == '__main__':
    main()
