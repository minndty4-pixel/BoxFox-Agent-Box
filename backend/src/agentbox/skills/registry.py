"""Compatibility facade backed by the canonical, full-source SkillCatalog."""
from dataclasses import dataclass, field
from .catalog import SkillCatalog, DEFAULT_SKILLS


@dataclass
class AgentSkill:
    id: str
    name: str
    category: str
    description: str
    instructions: str
    enabled_by_default: bool = True
    tags: list = field(default_factory=list)


class SkillsRegistry:
    def __init__(self):
        self.catalog = SkillCatalog()
        self._enabled_ids = set(DEFAULT_SKILLS)

    def get(self, sid):
        item = self.catalog.items.get(sid)
        if item is None:
            return None
        return AgentSkill(sid, item['name'], item['category'], item['description'],
                          self.catalog.read(sid)['content'], sid in DEFAULT_SKILLS, item['tags'])

    def list_all(self):
        return [self.get(sid) for sid in self.catalog.items]

    def is_enabled(self, sid):
        return sid in self._enabled_ids

    def enable(self, sid):
        if sid in self.catalog.items:
            self._enabled_ids.add(sid)

    def disable(self, sid):
        self._enabled_ids.discard(sid)

    def get_enabled_skills(self):
        return [self.get(sid) for sid in sorted(self._enabled_ids)]

    def render_skills_prompt(self, skill_ids=None):
        ids = list(dict.fromkeys(skill_ids if skill_ids is not None else sorted(self._enabled_ids)))
        return '\n\n'.join(f'### Skill: {skill.name} (`{skill.id}`)\n{skill.instructions}'
                           for sid in ids if (skill := self.get(sid)))


skills_registry = SkillsRegistry()
CORE_HERMES_SKILLS = skills_registry.list_all()
