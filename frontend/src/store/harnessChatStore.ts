import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'
import { useHarnessStore } from './harnessStore'
import { useSkillsStore } from './skillsStore'
import type { RouterChatSelection } from './routerChatStore'

export interface HarnessEvent { seq: number; type: string; data: Record<string, unknown>; created: number }
interface HarnessSession { id: string; status: string; events: HarnessEvent[] }
interface RunView { id: string | null; status: string; events: HarnessEvent[]; error: string | null }
export interface SavedSessionRow {
  id: string
  role: string
  status: string
  updated: number
  config: Record<string, unknown>
}

interface State {
  sessions: Record<string, RunView>
  fetchSavedSessions: () => Promise<SavedSessionRow[]>
  deleteSession: (id: string) => Promise<void>
  send: (chatId: string, prompt: string, selection: RouterChatSelection | null, image?: string | null) => Promise<void>
  refresh: (chatId: string) => Promise<void>
  stop: (chatId: string) => Promise<void>
}


const storageKey = (chatId: string) => `boxfox-harness-session:${chatId}`
const isHexId = (s: string) => /^[0-9a-f]{16,64}$/i.test(s)
const empty = (): RunView => ({ id: null, status: 'idle', events: [], error: null })

export const useHarnessChatStore = create<State>((set, get) => ({
  sessions: {},
  refresh: async (chatId) => {
    const current = get().sessions[chatId] ?? empty()
    const id = current.id ?? (isHexId(chatId) ? chatId : localStorage.getItem(storageKey(chatId)))
    if (!id) return
    try {
      const session = await agentApi<HarnessSession>(`/sessions/${id}?after=${current.events.at(-1)?.seq ?? 0}`)
      set((state) => ({ sessions: { ...state.sessions, [chatId]: { id, status: session.status, error: null,
        events: [...(state.sessions[chatId]?.events ?? []), ...session.events.filter(e => !(state.sessions[chatId]?.events ?? []).some(old => old.seq === e.seq))] } } }))
    } catch (error) {
      set((state) => ({ sessions: { ...state.sessions, [chatId]: { ...current, id, error: String(error) } } }))
    }
  },
  fetchSavedSessions: async () => {
    try {
      const data = await agentApi<{ sessions: Array<{ id: string; role: string; status: string; updated: number; config: Record<string, unknown> }> }>('/sessions')
      return data.sessions || []
    } catch {
      return []
    }
  },
  deleteSession: async (id: string) => {
    try {
      await agentApi(`/sessions/${id}`, undefined, 'DELETE')
      localStorage.removeItem(storageKey(id))
      set((state) => {
        const next = { ...state.sessions }
        delete next[id]
        return { sessions: next }
      })
    } catch (error) {
      console.error('Failed to delete session:', error)
      throw error
    }
  },
  send: async (chatId, prompt, selection, image) => {
    const current = get().sessions[chatId] ?? empty()
    if (current.status === 'running' || current.status === 'starting') return
    set((state) => ({ sessions: { ...state.sessions, [chatId]: { ...current, status: 'starting', error: null } } }))
    try {
      let id = current.id ?? (isHexId(chatId) ? chatId : localStorage.getItem(storageKey(chatId)))
      if (!id) {
        const harnessStore = useHarnessStore.getState()
        const isSingleModel = harnessStore.activeType === 'model'
        const harness = harnessStore.getHarnessById(harnessStore.activeHarnessId)
        await useSkillsStore.getState().load()
        const skills = useSkillsStore.getState().skills.filter(s => s.enabled).map(s => s.id)
        const route = selection?.kind === 'model' ? { connectionId: selection.connectionId, modelId: selection.modelId }
          : selection?.kind === 'alias' ? { aliasId: selection.aliasId } : {}
        
        // Single Model Mode: When user selects Single Model, override entire harness with this single model
        const singleModelId = isSingleModel ? (selection?.kind === 'model' ? `model:${selection.connectionId}:${selection.modelId}` : harnessStore.activeModelId) : null

        const session = await agentApi<HarnessSession>('/sessions', {
          ...route,
          skills,
          subagents: isSingleModel && singleModelId
            ? harness?.subagents?.map(s => ({ ...s, model: singleModelId })) ?? []
            : harness?.subagents,
          ...(singleModelId ? { singleModel: singleModelId, model: singleModelId }
              : (harness?.mainModel && harness.mainModel !== 'default' ? { model: harness.mainModel } : {}))
        })
        id = session.id
        localStorage.setItem(storageKey(chatId), id)
        localStorage.setItem(storageKey(id), id)
      }
      set((state) => ({ sessions: { ...state.sessions, [chatId]: { ...current, id, status: 'running', error: null } } }))
      await agentApi(`/sessions/${id}/turns`, { prompt: prompt || 'Inspect the attached image.', image })
      await get().refresh(chatId)
    } catch (error) {
      set((state) => ({ sessions: { ...state.sessions, [chatId]: { ...(state.sessions[chatId] ?? current), status: 'failed', error: String(error) } } }))
    }
  },

  stop: async (chatId) => {
    const id = get().sessions[chatId]?.id ?? (isHexId(chatId) ? chatId : null)
    if (!id) return
    try { await agentApi(`/sessions/${id}/stop`, {}); await get().refresh(chatId) }
    catch (error) { set((state) => ({ sessions: { ...state.sessions, [chatId]: { ...state.sessions[chatId], error: String(error) } } })) }
  },
}))
