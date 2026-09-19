import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'

export interface SkillItem {
  id: string; name: string; category: string; description: string; instructions: string
  enabled: boolean; tags: string[]; source: 'hermes' | 'claude-code' | 'boxfox'
  readiness?: string; relatedSkills?: string[]
}
interface Settings { enabled: string[]; revision: number; initialized: boolean }
export interface SkillsState {
  skills: SkillItem[]; error: string | null; revision: number; searchQuery: string; selectedCategory: string
  load: () => Promise<void>; loadInstructions: (id: string) => Promise<void>
  setSearchQuery: (q: string) => void; setSelectedCategory: (cat: string) => void
  toggleSkill: (id: string) => void; enableAll: () => void; disableAll: () => void
  getEnabledPromptGuidelines: () => string
}
let saving: Promise<void> = Promise.resolve()
export const useSkillsStore = create<SkillsState>((set, get) => {
  const save = (select: (skills: SkillItem[]) => string[]) => {
    saving = saving.then(async () => {
      const state = get()
      const result = await agentApi<Settings>('/skill-settings', { enabled: select(state.skills), revision: state.revision }, 'PUT')
      set({ skills: get().skills.map(s => ({ ...s, enabled: result.enabled.includes(s.id) })), revision: result.revision, error: null })
    }).catch(async error => { await get().load().catch(() => {}); set({ error: String(error) }) })
  }
  return {
    skills: [], error: null, revision: 0, searchQuery: '', selectedCategory: 'all',
    load: async () => {
      try {
        const catalog = await agentApi<{ skills: SkillItem[] }>('/catalog')
        let settings = await agentApi<Settings>('/skill-settings')
        if (!settings.initialized) {
          let legacy: Record<string, boolean> = {}
          try { legacy = JSON.parse(localStorage.getItem('boxfox_skills_config_v1') ?? '{}') } catch { /* invalid legacy state */ }
          settings = await agentApi<Settings>('/skill-settings', { importLegacy: true, enabled: catalog.skills.filter(s => legacy[s.id] ?? s.enabled).map(s => s.id) }, 'PUT')
        }
        set({ skills: catalog.skills.map(s => ({ ...s, enabled: settings.enabled.includes(s.id) })), revision: settings.revision, error: null })
      } catch (error) { set({ error: String(error) }); throw error }
    },
    loadInstructions: async id => {
      try {
        const result = await agentApi<{ content: string }>(`/skills/${encodeURIComponent(id)}`)
        set({ skills: get().skills.map(s => s.id === id ? { ...s, instructions: result.content } : s) })
      } catch (error) { set({ error: String(error) }) }
    },
    setSearchQuery: searchQuery => set({ searchQuery }), setSelectedCategory: selectedCategory => set({ selectedCategory }),
    toggleSkill: id => save(skills => skills.filter(s => s.id === id ? !s.enabled : s.enabled).map(s => s.id)),
    enableAll: () => save(skills => skills.map(s => s.id)), disableAll: () => save(() => []),
    getEnabledPromptGuidelines: () => get().skills.filter(s => s.enabled).map(s => `${s.id}: ${s.description}`).join('\n'),
  }
})
