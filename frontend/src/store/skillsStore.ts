import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'

export interface SkillItem {
  id: string
  name: string
  category: string
  description: string
  instructions: string
  enabled: boolean
  tags: string[]
  source: 'hermes' | 'claude-code' | 'boxfox'
}

const DEFAULT_HERMES_SKILLS: SkillItem[] = [
  {
    id: 'systematic-debugging',
    name: 'Systematic Debugging',
    category: 'software-development',
    source: 'claude-code',
    description: 'Scientific 5-step root cause analysis: Reproduce -> Isolate -> Hypothesize -> Fix surgically -> Regression check.',
    instructions:
      '1. Reproduce with minimal script/test.\n2. Isolate failure locus with logs/exec.\n3. Formulate falsifiable hypothesis.\n4. Apply surgical fix only.\n5. Run entire test suite to verify no regressions.',
    enabled: true,
    tags: ['debugging', 'claude-code', 'reliability'],
  },
  {
    id: 'test-driven-development',
    name: 'Test-Driven Development (TDD)',
    category: 'software-development',
    source: 'claude-code',
    description: 'Strict Red-Green-Refactor development cycle ensuring robust test coverage before writing production logic.',
    instructions:
      '1. Red: Write failing automated unit test first.\n2. Green: Implement minimum code required to pass.\n3. Refactor: Polish structure while tests stay green.',
    enabled: true,
    tags: ['testing', 'tdd', 'claude-code'],
  },
  {
    id: 'simplify-code',
    name: 'Simplify Code',
    category: 'software-development',
    source: 'hermes',
    description: 'Aggressively simplify architecture, eliminate dead abstractions and unnecessary wrappers.',
    instructions:
      '- Favor flat, explicit code over deep inheritance trees.\n- Remove unused variables and dead imports.\n- Keep functions focused on a single responsibility.',
    enabled: true,
    tags: ['refactoring', 'clarity', 'hermes'],
  },
  {
    id: 'codebase-inspection',
    name: 'Codebase Inspection',
    category: 'software-development',
    source: 'claude-code',
    description: 'Pre-execution reconnaissance: inspect project layout, config files, and conventions before proposing edits.',
    instructions:
      '- Inspect repository structure first.\n- Match naming conventions and indentations.\n- Never guess file paths or signatures.',
    enabled: true,
    tags: ['reconnaissance', 'grounding', 'claude-code'],
  },
  {
    id: 'requesting-code-review',
    name: 'Self-Critique & Code Review',
    category: 'software-development',
    source: 'claude-code',
    description: 'Automated pre-completion review checking security boundaries, edge cases, and injection risks.',
    instructions:
      '- Check for path traversal and command injection vulnerabilities.\n- Verify syntax and linter cleanliness.\n- Ensure all temporary debug artifacts are cleaned up.',
    enabled: true,
    tags: ['review', 'security', 'claude-code'],
  },
  {
    id: 'subagent-driven-development',
    name: 'Subagent-Driven Development',
    category: 'software-development',
    source: 'hermes',
    description: 'Deconstruct complex goals into discrete phases for specialized subagents (Explore, Build, Review, Test).',
    instructions:
      '- Delegate discovery to Explore subagent.\n- Assign surgical edits to Code & Build.\n- Run verification through Review & Test subagents.',
    enabled: true,
    tags: ['multi-agent', 'orchestration', 'hermes'],
  },
  {
    id: 'ast-grep',
    name: 'AST-Grep Structural Search',
    category: 'code-intelligence',
    source: 'hermes',
    description: 'Search code patterns based on syntax tree AST rather than fragile regex string matching.',
    instructions:
      '- Query function signatures and decorator patterns semantically.\n- Tolerates arbitrary whitespace, comment placement and multiline formatting.',
    enabled: false,
    tags: ['ast', 'search', 'code-intel'],
  },
  {
    id: 'grill-me',
    name: 'Requirements Interview (Grill-Me)',
    category: 'productivity',
    source: 'hermes',
    description: 'Proactively ask clarifying questions when requirements are underspecified or architectural tradeoffs exist.',
    instructions:
      '- Identify ambiguity in requirements.\n- Present clear trade-off choices with a recommended default.\n- Ask targeted questions to lock down design before coding.',
    enabled: false,
    tags: ['interview', 'design', 'hermes'],
  },
]

const STORAGE_KEY = 'boxfox_skills_config_v1'

function loadSavedSkills(): SkillItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_HERMES_SKILLS
    const saved = JSON.parse(raw) as Record<string, boolean>
    return DEFAULT_HERMES_SKILLS.map((s) => ({
      ...s,
      enabled: saved[s.id] !== undefined ? saved[s.id] : s.enabled,
    }))
  } catch {
    return DEFAULT_HERMES_SKILLS
  }
}

function persistSkills(skills: SkillItem[]) {
  try {
    const map = skills.reduce<Record<string, boolean>>((acc, s) => {
      acc[s.id] = s.enabled
      return acc
    }, {})
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Ignore quota issues
  }
}

export interface SkillsState {
  load: () => Promise<void>
  loadInstructions: (id: string) => Promise<void>
  error: string | null
  skills: SkillItem[]
  searchQuery: string
  selectedCategory: string
  setSearchQuery: (q: string) => void
  setSelectedCategory: (cat: string) => void
  toggleSkill: (id: string) => void
  enableAll: () => void
  disableAll: () => void
  getEnabledPromptGuidelines: () => string
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  error: null,
  load: async () => {
    try {
      const result = await agentApi<{ skills: SkillItem[] }>('/catalog')
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>
      set({ skills: result.skills.map(s => ({ ...s, enabled: saved[s.id] ?? s.enabled })), error: null })
    } catch (error) { set({ error: String(error) }); throw error }
  },
  loadInstructions: async (id) => {
    try {
      const result = await agentApi<{ content: string }>(`/skills/${encodeURIComponent(id)}`)
      set((state) => ({ skills: state.skills.map(s => s.id === id ? { ...s, instructions: result.content } : s), error: null }))
    } catch (error) { set({ error: String(error) }) }
  },
  skills: loadSavedSkills(),
  searchQuery: '',
  selectedCategory: 'all',

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedCategory: (selectedCategory) => set({ selectedCategory }),

  toggleSkill: (id) =>
    set((state) => {
      const next = state.skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
      persistSkills(next)
      return { skills: next }
    }),

  enableAll: () =>
    set((state) => {
      const next = state.skills.map((s) => ({ ...s, enabled: true }))
      persistSkills(next)
      return { skills: next }
    }),

  disableAll: () =>
    set((state) => {
      const next = state.skills.map((s) => ({ ...s, enabled: false }))
      persistSkills(next)
      return { skills: next }
    }),

  getEnabledPromptGuidelines: () => {
    const enabled = get().skills.filter((s) => s.enabled)
    if (!enabled.length) return ''
    return (
      '\n=== ACTIVE HERMES & CLAUDE CODE SKILLS ===\n' +
      enabled
        .map((s) => `### Skill: ${s.name} (${s.source.toUpperCase()})\n${s.instructions}`)
        .join('\n\n')
    )
  },
}))
