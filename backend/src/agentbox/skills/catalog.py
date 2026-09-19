"""Lazy full-source skill loading adapted from Hermes skills_tool; never preprocess shell."""
from pathlib import Path
import hashlib
import yaml

ROOT = Path(__file__).resolve().parents[1] / 'vendor/hermes'
DEFAULT_SKILLS = {'codebase-inspection', 'systematic-debugging', 'requesting-code-review', 'simplify-code', 'test-driven-development', 'grounded-citations'}


class SkillCatalog:
    def __init__(self, root=ROOT):
        self.root = Path(root).resolve()
        self.items = {}
        for group in ['skills', 'optional-skills']:
            for path in sorted((self.root / group).rglob('SKILL.md')):
                content = path.read_text(encoding='utf-8')
                parts = content.split('---', 2)
                try:
                    meta = yaml.safe_load(parts[1]) if content.startswith('---') and len(parts) == 3 else {}
                except yaml.YAMLError:
                    meta = {}
                meta = meta if isinstance(meta, dict) else {}
                hermes = (meta.get('metadata') or {}).get('hermes', {})
                hermes = hermes if isinstance(hermes, dict) else {}
                sid = path.parent.name
                if sid in self.items:
                    sid = path.parent.relative_to(self.root).as_posix()
                self.items[sid] = {
                    'id': sid, 'name': str(meta.get('name', path.parent.name)),
                    'category': path.relative_to(self.root).parts[1],
                    'description': str(meta.get('description', 'Upstream skill package.')),
                    'source': 'hermes', 'enabled': sid in DEFAULT_SKILLS,
                    'optional': group == 'optional-skills', 'tags': hermes.get('tags', []),
                    'relatedSkills': hermes.get('related_skills', []),
                    'requirements': {'commands': meta.get('required_commands', []),
                                     'environment': meta.get('required_environment_variables', []),
                                     'files': meta.get('required_credential_files', [])},
                    'platforms': meta.get('platforms', []), 'readiness': 'requires-environment-check',
                    'instructions': '', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    '_path': path,
                }

    def list(self, enabled=None):
        return [{k: v for k, v in item.items() if k != '_path'} | (
            {'enabled': item['id'] in enabled} if enabled is not None else {}) for item in self.items.values()]

    def read(self, sid, file_path='SKILL.md'):
        if sid not in self.items:
            raise ValueError('Unknown skill')
        directory = self.items[sid]['_path'].parent.resolve()
        path = (directory / file_path).resolve()
        if not path.is_relative_to(directory) or not path.is_file():
            raise ValueError('Skill file must be inside its package')
        # Instruction files are read fully, without pagination or shell preprocessing.
        text = path.read_text(encoding='utf-8')
        linked = [p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()]
        return {'id': sid, 'content': text, 'file': file_path, 'linkedFiles': linked,
                'basePath': '/opt/boxfox-skills/' + directory.relative_to(self.root).as_posix(),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    def prompt(self, enabled):
        return '\n'.join(f"- {s['id']}: {s['description']}" for s in self.list() if s['id'] in enabled)
