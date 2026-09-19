import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'
import { useHarnessStore } from './harnessStore'
import { useSkillsStore } from './skillsStore'
import type { RouterChatSelection } from './routerChatStore'

export interface HarnessEvent { seq: number; type: string; data: Record<string, unknown>; created: number }
interface HarnessSession { id: string; status: string; events: HarnessEvent[] }
interface RunView { id: string | null; status: string; events: HarnessEvent[]; error: string | null; lastModelLabel?: string }
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
  send: (chatId: string, prompt: string, selection: RouterChatSelection | null, image?: string | null, modelLabel?: string) => Promise<void>
  refresh: (chatId: string) => Promise<void>
  stop: (chatId: string) => Promise<void>
  clearError: (chatId: string) => void
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
      const lastServerSeq = current.events.filter(e => e.type !== 'model_change').at(-1)?.seq ?? 0
      const session = await agentApi<HarnessSession>(`/sessions/${id}?after=${lastServerSeq}`)
      const prevEvents = current.events ?? []
      const newEvents = session.events.filter(e => !prevEvents.some(old => old.seq === e.seq && old.type === e.type))
      const allEvents = [...prevEvents, ...newEvents]
      const isFailed = session.status === 'failed'
      const lastEvent = allEvents.at(-1)
      const lastIsError = lastEvent?.type === 'error'
      // Keep a reported error on screen until the user dismisses it or starts a new turn:
      // the 1200 ms poll must not wipe a message the user is still reading.
      const sessionError = isFailed && lastIsError
        ? String(lastEvent?.data?.message || 'Agent run failed')
        : (current.error ?? null)
      set((state) => ({
        sessions: {
          ...state.sessions,
          [chatId]: {
            ...current,
            id,
            status: session.status,
            error: sessionError,
            events: allEvents,
          },
        },
      }))
    } catch (error) {
      const errStr = String(error)
      if (errStr.includes('404') || errStr.toLowerCase().includes('not found')) {
        // Session was deleted or not found in database: cleanly purge from cache without displaying red error
        set((state) => {
          const next = { ...state.sessions }
          delete next[chatId]
          return { sessions: next }
        })
        return
      }
      set((state) => ({ sessions: { ...state.sessions, [chatId]: { ...current, id, status: 'failed', error: errStr } } }))
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
  send: async (chatId, prompt, selection, image, modelLabel) => {
    const current = get().sessions[chatId] ?? empty()
    const control = /^\/(help|skills|agents|status|context|stop)\s*$/.test(prompt)
    if ((current.status === 'running' || current.status === 'starting') && !control) return
    if (control && current.id) {
      try {
        await agentApi(`/sessions/${current.id}/turns`, { prompt, invocationId: crypto.randomUUID() })
        await get().refresh(chatId)
      } catch (error) {
        set(state => ({ sessions: { ...state.sessions, [chatId]: { ...current, error: String(error) } } }))
      }
      return
    }

    const prevModel = current.lastModelLabel
    const newModel = modelLabel || (selection?.kind === 'model' ? selection.modelId : selection?.kind === 'alias' ? selection.aliasId : undefined)

    let updatedEvents = [...current.events]
    if (prevModel && newModel && prevModel !== newModel && updatedEvents.length > 0) {
      const changeEvent: HarnessEvent = {
        seq: Date.now(),
        type: 'model_change',
        data: { from: prevModel, to: newModel },
        created: Date.now(),
      }
      updatedEvents.push(changeEvent)
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [chatId]: {
          ...current,
          events: updatedEvents,
          lastModelLabel: newModel || current.lastModelLabel,
          status: 'starting',
          error: null,
        },
      },
    }))
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
      const thinkingLevel = useHarnessStore.getState().thinkingLevel
      const route = selection?.kind === 'model'
        ? { connectionId: selection.connectionId, modelId: selection.modelId, thinkingLevel }
        : selection?.kind === 'alias'
        ? { aliasId: selection.aliasId, thinkingLevel }
        : {}
      await agentApi(`/sessions/${id}/turns`, { prompt: prompt || 'Inspect the attached image.', image, route, invocationId: crypto.randomUUID() })
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

  clearError: (chatId: string) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [chatId]: {
          ...(state.sessions[chatId] ?? empty()),
          error: null,
        },
      },
    }))
  },
}))
