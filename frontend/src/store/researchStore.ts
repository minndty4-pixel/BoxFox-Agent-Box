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
  asBool,
  asRecord,
  asString,
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
  /**
   * Mốc `seq` đã tiêu thụ của TỪNG phiên (`sessionId -> seq`). Đổi phiên không được kéo `seq` về 0
   * cho mọi phiên: làm vậy thì mọi sự kiện lịch sử của phiên mới bị coi là "mới", và một thẻ trạng
   * thái đã bị người dùng đóng lại mọc lên (D-4).
   *
   * Phiên CHƯA có khoá ở đây là phiên chưa từng nhận payload CÓ sự kiện: payload đầu tiên như vậy là
   * ảnh chụp lịch sử (D-9 — đừng ghim mốc `0` từ một payload rỗng rồi coi lịch sử là mới).
   */
  seenSeqBySession: Record<string, number>
  /** Lời hỏi 409 khi tắt mode lúc run còn chạy: có thì phải neo thẻ vào nút Research. */
  exitChoice: ResearchExitChoice | null
  /**
   * D-4: thẻ trạng thái của `/research status`. Server phát sự kiện `research_run` mang `message`
   * nhưng giao diện KHÔNG có chỗ nào đọc ⇒ lệnh đúng ở tầng server mà im lặng với người dùng.
   * `null` khi chưa có (hoặc sau khi người dùng đóng).
   */
  statusCard: ResearchStatusCard | null

  /**
   * `events` là danh sách sự kiện của phiên đang mở (rỗng khi phiên chưa tải xong).
   *
   * Chỉ sự kiện VƯỢT mốc `seenSeqBySession` của chính phiên ấy mới là "mới"; payload ĐẦU TIÊN có sự
   * kiện của một phiên là ảnh chụp lịch sử, không phải tin mới.
   */
  sync: (sessionId: string, config: unknown, events: readonly { seq: number; type: string; data: Record<string, unknown> }[]) => void
  refresh: () => Promise<void>
  refreshDetail: (researchId: string) => Promise<void>
  /** Bật/tắt mode; trả `'exit-choice'` khi server yêu cầu chọn số phận run trước. */
  setMode: (on: boolean, by: 'toggle' | 'command') => Promise<'ok' | 'exit-choice' | 'error'>
  resolveExit: (choice: 'pause' | 'background') => Promise<void>
  clearExitChoice: () => void
  /** Đóng thẻ `/research status` (sự kiện cũ vẫn còn trên luồng, không tự mọc lại). */
  dismissStatusCard: () => void
  answerPrompt: (promptId: string, body: ResearchPromptAnswerBody) => Promise<boolean>
  dismissPrompt: (promptId: string) => Promise<void>
  updateJob: (researchId: string, body: { action: string; revision?: number } & Record<string, unknown>) => Promise<boolean>
}

/** Dữ liệu thẻ trạng thái suy từ sự kiện `research_run` của `/research status`. */
export interface ResearchStatusCard {
  researchId: string
  message: string
  status: string
  phase: string
  background: boolean
  /** `seq` của sự kiện nguồn — để biết thẻ này đã cũ hay chưa. */
  seq: number
}

/** Sự kiện `research_run` kiểu `status` mới nhất có `message` ⇒ thẻ trạng thái; không có ⇒ `null`. */
function statusCardFrom(events: readonly { seq: number; type: string; data: Record<string, unknown> }[]): ResearchStatusCard | null {
  let newest: ResearchStatusCard | null = null
  for (const event of events) {
    if (event.type !== 'research_run') continue
    const data = asRecord(event.data)
    if (asString(data.kind) !== 'status') continue
    const message = asString(data.message)
    if (!message) continue
    // Giữ sự kiện có `seq` lớn nhất: nhiều lần `/research status` trong một vòng thì thẻ mới nhất thắng.
    if (newest && event.seq <= newest.seq) continue
    newest = {
      researchId: asString(data.researchId),
      message,
      status: asString(data.status),
      phase: asString(data.phase),
      background: asBool(data.background),
      seq: event.seq,
    }
  }
  return newest
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
  statusCard: null,
  seenSeqBySession: {},

  sync: (sessionId, config, events) => {
    if (!sessionId) {
      set({ sessionId: '', mode: RESEARCH_MODE_OFF, jobs: [], detail: null, detailId: '', lastEventSeq: 0, exitChoice: null, statusCard: null, seenSeqBySession: {} })
      return
    }
    const mode = readResearchMode(config)
    const switched = sessionId !== get().sessionId
    const seenSeqBySession = get().seenSeqBySession
    const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0)
    // Mốc của TỪNG phiên: sự kiện chỉ "mới" khi vượt mốc đã tiêu thụ của chính phiên đó.
    const mark = seenSeqBySession[sessionId]
    const known = mark !== undefined
    // Phiên CHƯA từng thấy: payload đầu tiên CÓ sự kiện là ẢNH CHỤP LỊCH SỬ (cùng luật với
    // `firstHydration` của `harnessChatStore`), nên mốc khởi đầu là `seq` lớn nhất — nếu không thì một
    // `research_run`/`status` từ tuần trước sẽ mọc lên như trạng thái hiện tại (§4.1 dòng ~205: thẻ
    // trạng thái là bản phát lại theo yêu cầu, không phải trạng thái nền).
    // Payload RỖNG không được ghi mốc: `useResearchSync` gọi `sync(..., events ?? [])` ở lần render đầu
    // (phiên chưa tải xong), và mốc `0` ghi từ đó biến chính ảnh chụp lịch sử ấy thành "mới" — mở lại
    // phiên là thẻ `/research status` cũ mọc lại dù chưa ai gõ lệnh (D-9, vòng kiểm thử P2–P5 lần 3).
    const baseline = known ? mark : maxSeq
    const fresh = events.filter((event) => isResearchEvent(event) && event.seq > baseline)
    const nextMark = Math.max(baseline, maxSeq)
    const lastEventSeq = events.reduce((max, event) => Math.max(max, event.seq), switched ? 0 : get().lastEventSeq)
    const modeChanged = switched || mode.on !== get().mode.on || mode.activeRunId !== get().mode.activeRunId
      || mode.revision !== get().mode.revision
    // D-4: chỉ nhận sự kiện MỚI của phiên này (phiên chưa từng thấy ⇒ không nhận gì từ lịch sử).
    // Đổi phiên thì xoá thẻ cũ; còn lại giữ thẻ cho tới khi người dùng đóng.
    const statusCard = statusCardFrom(fresh) ?? (switched ? null : get().statusCard)
    set({
      sessionId,
      mode,
      lastEventSeq,
      statusCard,
      // Không có sự kiện nào ⇒ chưa biết gì về phiên này: giữ nguyên sổ mốc (đừng ghim `0`).
      seenSeqBySession: events.length === 0 ? seenSeqBySession : { ...seenSeqBySession, [sessionId]: nextMark },
    })
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

  dismissStatusCard: () => set({ statusCard: null }),

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
