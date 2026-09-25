/**
 * Trạng thái `/research` của phiên đang mở (P4 — giao diện).
 *
 * Vì sao cần store riêng: `ResearchPanel` cũ hỏi `/research/jobs` mỗi 5000 ms. Hợp đồng §5.12 nói
 * phải bỏ vòng hỏi đó — chi tiết run chỉ được tải lại khi có sự kiện `research_*` MỚI trên luồng sự
 * kiện phiên (vòng 1200 ms đã có sẵn để hỏi luồng). Store này nhận `sync(sessionId, config, events)`
 * từ `useResearchSync`, đối chiếu `seq`, và chỉ gọi mạng khi có sự kiện mới.
 */
import { create } from 'zustand'
import {
  activeJob,
  asRecord,
  isResearchEvent,
  readJobs,
  readJob,
  readResearchMode,
  RESEARCH_MODE_OFF,
  type ResearchJob,
  type ResearchMode,
} from '../lib/researchMode'
import {
  answerResearchPrompt,
  dismissResearchPrompt,
  fetchResearchJobDetail,
  fetchResearchJobs,
  patchResearchJob,
  setResearchMode,
  type ResearchExitChoice,
  type ResearchPromptAnswerBody,
} from '../lib/researchApi'

interface ResearchState {
  sessionId: string
  mode: ResearchMode
  jobs: ResearchJob[]
  /** Chi tiết run đang mở (tab Research đọc `scope`, `prompts`, bằng chứng phân trang). */
  detail: ResearchJob | null
  detailId: string
  loading: boolean
  error: string | null
  /** `seq` lớn nhất của sự kiện `research_*` đã xử lý — vòng 1200 ms không tải lại vô ích. */
  lastEventSeq: number
  /** Lời hỏi 409 khi tắt mode lúc run còn chạy: có thì phải neo thẻ vào nút Research. */
  exitChoice: ResearchExitChoice | null

  sync: (sessionId: string, config: unknown, events: readonly { seq: number; type: string; data: Record<string, unknown> }[]) => void
  refresh: () => Promise<void>
  refreshDetail: (researchId: string) => Promise<void>
  /** Bật/tắt mode; trả `'exit-choice'` khi server yêu cầu chọn số phận run trước. */
  setMode: (on: boolean, by: 'toggle' | 'command') => Promise<'ok' | 'exit-choice' | 'error'>
  resolveExit: (choice: 'pause' | 'background') => Promise<void>
  clearExitChoice: () => void
  answerPrompt: (promptId: string, body: ResearchPromptAnswerBody) => Promise<boolean>
  dismissPrompt: (promptId: string) => Promise<void>
  updateJob: (researchId: string, body: { action: string; revision?: number } & Record<string, unknown>) => Promise<boolean>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useResearchStore = create<ResearchState>((set, get) => ({
  sessionId: '',
  mode: RESEARCH_MODE_OFF,
  jobs: [],
  detail: null,
  detailId: '',
  loading: false,
  error: null,
  lastEventSeq: 0,
  exitChoice: null,

  sync: (sessionId, config, events) => {
    if (!sessionId) {
      set({ sessionId: '', mode: RESEARCH_MODE_OFF, jobs: [], detail: null, detailId: '', lastEventSeq: 0, exitChoice: null })
      return
    }
    const mode = readResearchMode(config)
    const switched = sessionId !== get().sessionId
    const fresh = events.filter((event) => isResearchEvent(event) && event.seq > get().lastEventSeq)
    const lastEventSeq = events.reduce((max, event) => Math.max(max, event.seq), switched ? 0 : get().lastEventSeq)
    const modeChanged = switched || mode.on !== get().mode.on || mode.activeRunId !== get().mode.activeRunId
      || mode.revision !== get().mode.revision
    set({ sessionId, mode, lastEventSeq })
    if (switched || fresh.length > 0 || modeChanged) void get().refresh()
  },

  refresh: async () => {
    const sessionId = get().sessionId
    if (!sessionId) return
    set({ loading: true })
    try {
      const payload = await fetchResearchJobs(sessionId)
      const jobs = readJobs(payload)
      set({ jobs, error: null, loading: false })
      const foreground = activeJob(jobs, get().mode.activeRunId)
      if (foreground) void get().refreshDetail(foreground.researchId)
    } catch (error) {
      set({ error: message(error), loading: false })
    }
  },

  refreshDetail: async (researchId) => {
    if (!researchId) return
    try {
      const payload = await fetchResearchJobDetail(researchId)
      const detail = readJob(asRecord(payload).job ?? payload)
      set({ detail, detailId: researchId, error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  },

  setMode: async (on, by) => {
    const sessionId = get().sessionId
    if (!sessionId) return 'error'
    try {
      const outcome = await setResearchMode(sessionId, { on, by })
      if (outcome.kind === 'exit-choice') {
        set({ exitChoice: outcome.choice })
        return 'exit-choice'
      }
      set({ exitChoice: null, mode: readResearchMode({ researchMode: outcome.result.mode }) })
      void get().refresh()
      return 'ok'
    } catch (error) {
      set({ error: message(error) })
      return 'error'
    }
  },

  resolveExit: async (choice) => {
    const sessionId = get().sessionId
    const active = get().exitChoice?.prompt.researchId || get().mode.activeRunId
    set({ exitChoice: null })
    if (!sessionId) return
    try {
      const outcome = await setResearchMode(sessionId, { on: false, by: 'toggle', exitChoice: choice, activeRun: choice })
      if (outcome.kind === 'ok') {
        set({ mode: readResearchMode({ researchMode: outcome.result.mode }) })
      }
      if (active) void get().refreshDetail(active)
      void get().refresh()
    } catch (error) {
      set({ error: message(error) })
    }
  },

  clearExitChoice: () => set({ exitChoice: null }),

  answerPrompt: async (promptId, body) => {
    try {
      await answerResearchPrompt(promptId, body)
      const active = get().mode.activeRunId || get().detailId
      void get().refresh()
      if (active) void get().refreshDetail(active)
      return true
    } catch (error) {
      set({ error: message(error) })
      return false
    }
  },

  dismissPrompt: async (promptId) => {
    try {
      await dismissResearchPrompt(promptId)
      const active = get().mode.activeRunId || get().detailId
      if (active) void get().refreshDetail(active)
    } catch (error) {
      set({ error: message(error) })
    }
  },

  updateJob: async (researchId, body) => {
    try {
      await patchResearchJob(researchId, body)
      void get().refresh()
      void get().refreshDetail(researchId)
      return true
    } catch (error) {
      set({ error: message(error) })
      return false
    }
  },
}))
