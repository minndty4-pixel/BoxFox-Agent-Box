import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'

/**
 * Chỉ dẫn của chủ sở hữu (Settings → Instructions): đọc/ghi qua `GET|PUT /api/agent/owner-settings`.
 * Bản đã lưu (`instructions` + `revision`) tách khỏi bản đang gõ (`draft`) để chuyện "có thay đổi
 * chưa lưu" là một câu trả lời được, không phải một phỏng đoán.
 */
interface OwnerSettingsPayload {
  instructions: string
  revision: number
}

export type OwnerSettingsStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'failed'

interface OwnerSettingsState {
  /** Bản harness đang giữ. */
  instructions: string
  revision: number
  /** Bản trong ô nhập. */
  draft: string
  status: OwnerSettingsStatus
  /** Lỗi của lần lưu gần nhất — giữ nguyên bản nháp khi có lỗi. */
  error: string | null
  /** Lỗi của lần nạp gần nhất: chưa đọc được thì đừng sửa như thể đã biết bản đang lưu. */
  loadError: string | null
  loaded: boolean
  loadedAt: number | null

  load: () => Promise<void>
  ensureLoaded: () => Promise<boolean>
  setDraft: (value: string) => void
  isDirty: () => boolean
  discard: () => void
  reset: () => void
  save: () => Promise<boolean>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

let inflight: Promise<void> | null = null

export const useOwnerSettingsStore = create<OwnerSettingsState>()((set, get) => ({
  instructions: '',
  revision: 0,
  draft: '',
  status: 'idle',
  error: null,
  loadError: null,
  loaded: false,
  loadedAt: null,

  load: async () => {
    set({ status: 'loading', error: null, loadError: null })
    try {
      const data = await agentApi<OwnerSettingsPayload>('/owner-settings')
      set({
        instructions: data.instructions ?? '',
        revision: data.revision ?? 0,
        draft: data.instructions ?? '',
        status: 'idle',
        loaded: true,
        loadedAt: Date.now(),
      })
    } catch (error) {
      set({ status: 'idle', loaded: false, loadError: message(error) })
      throw error
    }
  },

  /** Đường gửi cần biết chỉ dẫn đã có trong tay chưa; lỗi mạng trả về `false`, không ném. */
  ensureLoaded: async () => {
    if (get().loaded) return true
    inflight ??= get()
      .load()
      .catch(() => undefined)
      .finally(() => {
        inflight = null
      })
    await inflight
    return get().loaded
  },

  setDraft: (draft) => set({ draft, status: get().status === 'failed' ? 'idle' : get().status, error: null }),
  isDirty: () => get().draft !== get().instructions,
  discard: () => set({ draft: get().instructions, status: 'idle', error: null }),
  // "Reset to empty" chỉ dọn ô nhập; việc ghi rỗng lên harness vẫn phải qua Save để có biên nhận revision.
  reset: () => set({ draft: '', status: 'idle', error: null }),

  save: async () => {
    const { draft, revision } = get()
    set({ status: 'saving', error: null })
    try {
      const data = await agentApi<OwnerSettingsPayload>('/owner-settings', { instructions: draft, revision }, 'PUT')
      const stored = data.instructions ?? draft
      set({
        instructions: stored,
        draft: stored,
        revision: data.revision ?? revision,
        status: 'saved',
        error: null,
        loaded: true,
        loadedAt: Date.now(),
      })
      return true
    } catch (error) {
      // Giữ nguyên nháp và revision cũ: lỗi không được biến thành "đã lưu".
      set({ status: 'failed', error: message(error) })
      return false
    }
  },
}))
