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
  type ResearchPrompt,
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

/**
 * Lời hỏi `exit-choice` còn MỞ của bất kỳ run nào đang thấy.
 *
 * Luồng `/research off` bắt đầu ở SERVER: server tạo lời hỏi `exit-choice` rồi chỉ phát một sự kiện
 * `research_prompt` — giao diện chưa từng thấy 409. Nên thẻ thoát phải suy từ lời hỏi còn mở trong
 * dữ liệu đã tải (đây là đường thứ hai bên cạnh nhánh 409 của `setMode`).
 */
function exitChoiceFrom(jobs: readonly ResearchJob[], detail: ResearchJob | null): ResearchExitChoice | null {
  const pools = detail ? [detail.prompts, ...jobs.map((job) => job.prompts)] : jobs.map((job) => job.prompts)
  for (const prompts of pools) {
    const prompt: ResearchPrompt | undefined = prompts.find(
      (item) => item.status === 'open' && item.kind === 'exit-choice',
    )
    if (prompt) return { code: 'RESEARCH_EXIT_CHOICE_REQUIRED', prompt, message: prompt.note }
  }
  return null
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
      // F5: lời hỏi thoát do SERVER tạo (`/research off`) không đi qua nhánh 409 — suy nó từ lời hỏi
      // còn mở trong dữ liệu vừa tải, và tự xoá khi đã được trả lời/đóng.
      set({ jobs, error: null, loading: false, exitChoice: exitChoiceFrom(jobs, get().detail) })
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
      // F2: tuyến chi tiết trả `evidence/dossier/reviews/branches/coverage/usedSeconds` ở CẤP TRÊN
      // (ngoài `job`). Gộp thay vì chỉ đọc `job`, nếu không các tab Nguồn/Claim/Phản biện/Báo cáo
      // rỗng sau mỗi lần tải chi tiết; khoá của `job` thắng khi trùng.
      const envelope = asRecord(payload)
      const detail = readJob({ ...envelope, ...asRecord(envelope.job) })
      set({ detail, detailId: researchId, error: null, exitChoice: exitChoiceFrom(get().jobs, detail) })
    } catch (error) {
      set({ error: message(error) })
    }
  },

  setMode: async (on, by) => {
    const sessionId = get().sessionId
    if (!sessionId) return 'error'
    // F7: đang có lời hỏi thoát chưa chọn thì bấm nút lần nữa KHÔNG được gửi thêm một PUT không
    // `prompt` — mỗi lần như vậy server lại tạo thêm một lời hỏi `exit-choice` mở mãi mãi.
    if (!on && get().exitChoice) return 'exit-choice'
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
    const previous = get().exitChoice
    const active = previous?.prompt.researchId || get().mode.activeRunId
    set({ exitChoice: null })
    if (!sessionId) {
      set({ exitChoice: previous })
      return
    }
    try {
      // F7: gửi kèm CHÍNH lời hỏi đã nhận để server dùng lại nó, không tạo lời hỏi mới.
      const outcome = await setResearchMode(sessionId, {
        on: false, by: 'toggle', exitChoice: choice, activeRun: choice,
        ...(previous ? { prompt: previous.prompt } : {}),
      })
      if (outcome.kind === 'ok') {
        set({ mode: readResearchMode({ researchMode: outcome.result.mode }) })
        // Server KHÔNG tự đóng lời hỏi `exit-choice` sau khi đã chọn số phận run. Đóng nó ở đây, nếu
        // không nó còn `open` mãi: badge "Phản biện" đếm dư, và F5 lại suy nó ra và bật thẻ thoát
        // trở lại dù chế độ đã tắt. PHẢI đợi đóng xong rồi mới `refresh`, nếu không lần tải sau còn
        // thấy lời hỏi mở và dựng lại thẻ. Lỗi (lời hỏi đã đóng từ trước) thì bỏ qua.
        if (previous) {
          try {
            await dismissResearchPrompt(previous.prompt.promptId)
          } catch {
            /* lời hỏi đã đóng/dismissed — không sao */
          }
        }
      }
      if (active) void get().refreshDetail(active)
      void get().refresh()
    } catch (error) {
      // F8: PUT hỏng ⇒ trả lại lời hỏi cũ (không nuốt mất lựa chọn của người dùng).
      set({ exitChoice: previous, error: message(error) })
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
