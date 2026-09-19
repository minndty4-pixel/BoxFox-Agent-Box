import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'
import { useHarnessStore } from './harnessStore'
import { useSkillsStore } from './skillsStore'
import { useUiStore } from './uiStore'
import type { TabIntent } from './uiStore'
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

// ── Quyết định thật của agent (hợp đồng §1 `decision_requested`/`decision_resolved`)

export type DecisionKind = 'question' | 'approval'
export type DecisionOptionKind = 'approve' | 'reject' | 'alternative'
export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
export type DecisionResolveReason = 'user' | 'timeout' | 'session_cancelled'

export interface DecisionOption {
  id: string
  label: string
  kind: DecisionOptionKind
}

/**
 * Một mục trong danh sách quyết định của phiên. Mọi trường đều lấy nguyên từ
 * event của harness: không có hạn chót, lựa chọn hay lý do nào do giao diện bịa.
 */
export interface DecisionEntry {
  id: string
  kind: DecisionKind
  question: string | null
  action: string | null
  reason: string | null
  options: DecisionOption[]
  /** Hạn chót, epoch giây (float) — đúng con số server gửi. */
  deadline: number | null
  defaultChoice: string | null
  status: DecisionStatus
  choice: string | null
  note: string | null
  resolvedReason: DecisionResolveReason | null
  resolvedAt: number | null
  /** `created` của event `decision_requested` (ms) — chỉ để hiện thứ tự. */
  requestedAt: number
}

interface State {
  sessions: Record<string, RunView>
  /** Quyết định thật theo từng phiên chat, dẫn xuất từ `events[]`. */
  decisions: Record<string, DecisionEntry[]>
  /** Số `seq` lớn nhất đã xử lý ý định mở tab — cùng một event không kích hoạt lại. */
  intentSeq: Record<string, number>
  fetchSavedSessions: () => Promise<SavedSessionRow[]>
  deleteSession: (id: string) => Promise<void>
  send: (chatId: string, prompt: string, selection: RouterChatSelection | null, image?: string | null, modelLabel?: string) => Promise<void>
  refresh: (chatId: string) => Promise<void>
  stop: (chatId: string) => Promise<void>
  /** Trả lời một quyết định qua harness; cập nhật ngay tại chỗ khi thành công. */
  answerDecision: (chatId: string, decisionId: string, choice: string, note?: string) => Promise<void>
  clearError: (chatId: string) => void
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const OPTION_KINDS: DecisionOptionKind[] = ['approve', 'reject', 'alternative']

/** `options` là 2–5 mục `{id, label, kind}`; mục méo bị bỏ, không bịa thêm. */
export function parseDecisionOptions(value: unknown): DecisionOption[] {
  if (!Array.isArray(value)) return []
  const options: DecisionOption[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { id?: unknown; label?: unknown; kind?: unknown }
    const id = asString(item.id)
    const label = asString(item.label)
    if (!id || !label) continue
    const kind = OPTION_KINDS.includes(item.kind as DecisionOptionKind)
      ? (item.kind as DecisionOptionKind)
      : 'alternative'
    options.push({ id, label, kind })
  }
  return options
}

export function decisionStatusFrom(value: unknown): DecisionStatus {
  return value === 'approved' || value === 'rejected' || value === 'expired' || value === 'cancelled'
    ? value
    : 'pending'
}

export function decisionReasonFrom(value: unknown): DecisionResolveReason | null {
  return value === 'user' || value === 'timeout' || value === 'session_cancelled' ? value : null
}

/**
 * Dựng danh sách quyết định từ `events[]`. Hàm THUẦN để test được.
 * `decision_resolved` tới trước `decision_requested` (dữ liệu cũ, phân trang)
 * vẫn tạo một mục để lịch sử không mất.
 */
export function parseDecisions(events: HarnessEvent[]): DecisionEntry[] {
  const byId = new Map<string, DecisionEntry>()
  for (const event of events) {
    if (event.type === 'decision_requested') {
      const id = asString(event.data.decisionId)
      if (!id || byId.has(id)) continue
      byId.set(id, {
        id,
        kind: event.data.kind === 'approval' ? 'approval' : 'question',
        question: asString(event.data.question),
        action: asString(event.data.action),
        reason: asString(event.data.reason),
        options: parseDecisionOptions(event.data.options),
        deadline: asNumber(event.data.deadline),
        defaultChoice: asString(event.data.defaultChoice),
        status: 'pending',
        choice: null,
        note: null,
        resolvedReason: null,
        resolvedAt: null,
        requestedAt: event.created,
      })
      continue
    }
    if (event.type === 'decision_resolved') {
      const id = asString(event.data.decisionId)
      if (!id) continue
      const entry = byId.get(id) ?? {
        id,
        kind: 'question' as DecisionKind,
        question: null,
        action: null,
        reason: null,
        options: [],
        deadline: null,
        defaultChoice: null,
        status: 'pending' as DecisionStatus,
        choice: null,
        note: null,
        resolvedReason: null,
        resolvedAt: null,
        requestedAt: event.created,
      }
      byId.set(id, {
        ...entry,
        status: decisionStatusFrom(event.data.status),
        choice: asString(event.data.choice),
        note: asString(event.data.note),
        resolvedReason: decisionReasonFrom(event.data.reason),
        resolvedAt: asNumber(event.data.resolvedAt),
      })
    }
  }
  return [...byId.values()]
}

/** Quyết định đang chờ trả lời — agent đang bị chặn ở đúng những mục này. */
export function pendingDecisions(decisions: DecisionEntry[]): DecisionEntry[] {
  return decisions.filter((entry) => entry.status === 'pending')
}

/**
 * Xử lý ý định mở tab của agent (hợp đồng §3/§4) cho các event MỚI.
 *
 * Trả về `seq` lớn nhất đã xử lý để vòng poll sau không kích hoạt lại cùng một
 * event. Bản plan cũ nạp từ lịch sử không tự mở tab; nhưng một
 * `decision_requested` chưa có `decision_resolved` thì luôn đáng mở — agent
 * đang chờ người dùng thật.
 */
export function dispatchTabIntents(params: {
  allEvents: HarnessEvent[]
  freshEvents: HarnessEvent[]
  lastSeq: number
  firstHydration: boolean
}): number {
  const { allEvents, freshEvents, lastSeq, firstHydration } = params
  if (freshEvents.length === 0) return lastSeq
  const ui = useUiStore.getState()
  // Cùng một lượt có thể mang cả event gốc lẫn `ui_intent` đi kèm của harness
  // (bản gợi ý cùng nội dung), nên gộp theo (tab, đích): một ý định chỉ xếp hàng
  // một lần, không nhân đôi số trên huy hiệu.
  const handled = new Set<string>()
  const request = (tab: TabIntent['tab'], target: TabIntent['target'], reason: string) => {
    const key = intentKey(tab, target)
    if (handled.has(key)) return
    handled.add(key)
    ui.requestTabIntent({ tab, target, reason })
  }
  for (const event of freshEvents) {
    if (event.type === 'plan_written') {
      if (firstHydration) continue
      // `identity` là định danh trần như `GET /__box/plans` trả về (hợp đồng §1,
      // đã sửa): không kèm `vN-`, không so với `relativePath`. Bản vừa ghi là
      // cặp (identity, version) — version là số nguyên riêng.
      const identity = asString(event.data.identity)
      const version = asNumber(event.data.version)
      ui.bumpPlanRevision()
      request(
        'plan',
        identity ? { identity, ...(version === null ? {} : { version }) } : null,
        'plan_written',
      )
      continue
    }
    if (event.type === 'decision_requested') {
      const id = asString(event.data.decisionId)
      const stillPending = !allEvents.some(
        (other) => other.type === 'decision_resolved' && String(other.data.decisionId) === String(id),
      )
      if (stillPending) {
        request('decisions', id ? { requestId: id } : null, 'decision_requested')
      }
      continue
    }
    // `ui_intent` là gợi ý của harness (hợp đồng §1/§3): UI vẫn tự quyết theo luật
    // auto-open, và những ý định không có event gốc đi kèm (ví dụ tab Files) cũng
    // được tôn trọng. Tab lạ thì bỏ qua.
    if (event.type === 'ui_intent') {
      const tab = asString(event.data.tab)
      if (tab !== 'plan' && tab !== 'decisions' && tab !== 'files' && tab !== 'subagents') continue
      if (firstHydration && tab === 'plan') continue
      const rawTarget = event.data.target
      request(
        tab,
        rawTarget && typeof rawTarget === 'object' ? (rawTarget as Record<string, unknown>) : null,
        asString(event.data.reason) ?? 'ui_intent',
      )
    }
  }
  return allEvents.reduce((max, event) => Math.max(max, event.seq), lastSeq)
}

/** Khoá gộp ý định trong một lượt: (tab, đích) — không phụ thuộc thứ tự khoá. */
function intentKey(tab: TabIntent['tab'], target: TabIntent['target']): string {
  const entries = Object.entries(target ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return `${tab}|${entries.map(([key, value]) => `${key}=${String(value)}`).join(',')}`
}


const storageKey = (chatId: string) => `boxfox-harness-session:${chatId}`
const isHexId = (s: string) => /^[0-9a-f]{16,64}$/i.test(s)
const empty = (): RunView => ({ id: null, status: 'idle', events: [], error: null })

export const useHarnessChatStore = create<State>((set, get) => ({
  sessions: {},
  decisions: {},
  intentSeq: {},
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
      // Ý định mở tab: chỉ xét event có `seq` vượt mốc đã xử lý, nên vòng poll
      // 1200ms không mở lại tab cho đúng một event.
      const lastIntentSeq = get().intentSeq[chatId] ?? 0
      const freshEvents = allEvents.filter(e => e.seq > lastIntentSeq)
      const firstHydration = !current.id && prevEvents.length === 0 && lastIntentSeq === 0
      const nextIntentSeq = dispatchTabIntents({ allEvents, freshEvents, lastSeq: lastIntentSeq, firstHydration })
      const isFailed = session.status === 'failed'
      const lastEvent = allEvents.at(-1)
      const lastIsError = lastEvent?.type === 'error'
      // Keep a reported error on screen until the user dismisses it or starts a new turn:
      // the 1200 ms poll must not wipe a message the user is still reading.
      const sessionError = isFailed && lastIsError
        ? String(lastEvent?.data?.message || 'Agent run failed')
        : (current.error ?? null)
      set((state) => {
        const parsed = parseDecisions(allEvents)
        const previousDecisions = state.decisions[chatId] ?? []
        // Trả lời thành công đã ghi ngay vào chỗ chứa cục bộ; vòng poll tới muộn
        // hơn không được kéo mục đó về `pending` khi event `decision_resolved`
        // chưa kịp tới.
        const decisions = parsed.map((entry) => {
          const previous = previousDecisions.find((item) => item.id === entry.id)
          return previous && previous.status !== 'pending' && entry.status === 'pending' ? previous : entry
        })
        return {
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
          decisions: { ...state.decisions, [chatId]: decisions },
          intentSeq: { ...state.intentSeq, [chatId]: nextIntentSeq },
        }
      })
    } catch (error) {
      const errStr = String(error)
      if (errStr.includes('404') || errStr.toLowerCase().includes('not found')) {
        // Session was deleted or not found in database: cleanly purge from cache without displaying red error
        set((state) => {
          const next = { ...state.sessions }
          delete next[chatId]
          const nextDecisions = { ...state.decisions }
          delete nextDecisions[chatId]
          const nextIntentSeq = { ...state.intentSeq }
          delete nextIntentSeq[chatId]
          return { sessions: next, decisions: nextDecisions, intentSeq: nextIntentSeq }
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

    const updatedEvents = [...current.events]
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

  answerDecision: async (chatId, decisionId, choice, note) => {
    const current = get().sessions[chatId] ?? empty()
    const id = current.id ?? (isHexId(chatId) ? chatId : localStorage.getItem(storageKey(chatId)))
    if (!id) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [chatId]: { ...current, error: 'DECISION_UNKNOWN_SESSION: no harness session for this chat' },
        },
      }))
      return
    }
    try {
      const result = await agentApi<{ status: string; decisionId: string; choice: string; outcome: string }>(
        `/sessions/${id}/decisions`,
        note ? { decisionId, choice, note } : { decisionId, choice },
      )
      set((state) => {
        const list = state.decisions[chatId] ?? parseDecisions(current.events)
        const decisions = list.map((entry) => {
          if (entry.id !== decisionId) return entry
          const optionKind = entry.options.find((option) => option.id === choice)?.kind
          const outcome = decisionStatusFrom(result?.outcome)
          return {
            ...entry,
            status: outcome !== 'pending' ? outcome : optionKind === 'reject' ? 'rejected' : 'approved',
            choice: result?.choice ?? choice,
            note: note ?? null,
            resolvedReason: 'user' as DecisionResolveReason,
            resolvedAt: Date.now() / 1000,
          }
        })
        return { decisions: { ...state.decisions, [chatId]: decisions } }
      })
      // Kéo `decision_resolved` về sớm để hàng trong transcript cũng tắt trạng
      // thái "đang chờ" — câu trả lời đã nằm trong store từ dòng trên rồi.
      void get().refresh(chatId)
    } catch (error) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [chatId]: { ...(state.sessions[chatId] ?? current), error: String(error) },
        },
      }))
    }
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
