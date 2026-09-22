import { create } from 'zustand'

/**
 * Sổ ghi phiên: mỗi phiên đã mở ghi lại nó thuộc harness nào và mang bao nhiêu ký tự chỉ dẫn.
 * Tab Instructions đọc sổ này để nói thật "chat này đang chạy với bao nhiêu chỉ dẫn" — chat cũ
 * không có bản ghi thì nói thẳng là không ghi lại, không đoán.
 */
export interface SessionRecord {
  sessionId: string
  harnessId: string
  instructionsChars: number
  startedAt: number
  /** Có mặt khi phiên mở lúc chưa đọc được chỉ dẫn: lý do nói thẳng ra thay vì coi như đã gửi. */
  directivesSkipped?: string
}

interface SessionRecordState {
  records: Record<string, SessionRecord>
  /** Thứ tự mở phiên, để biết bản ghi nào mới nhất. */
  order: string[]
  record: (sessionId: string, data: Omit<SessionRecord, 'sessionId' | 'startedAt'> & { startedAt?: number }) => void
  get: (sessionId: string) => SessionRecord | undefined
  latest: () => SessionRecord | undefined
  reset: () => void
}

export const useSessionRecordStore = create<SessionRecordState>()((set, get) => ({
  records: {},
  order: [],

  record: (sessionId, data) =>
    set((state) => ({
      records: {
        ...state.records,
        [sessionId]: {
          sessionId,
          harnessId: data.harnessId,
          instructionsChars: data.instructionsChars,
          startedAt: data.startedAt ?? Date.now(),
          ...(data.directivesSkipped ? { directivesSkipped: data.directivesSkipped } : {}),
        },
      },
      order: [...state.order.filter((id) => id !== sessionId), sessionId],
    })),

  get: (sessionId) => get().records[sessionId],

  latest: () => {
    const state = get()
    const id = state.order[state.order.length - 1]
    return id ? state.records[id] : undefined
  },

  reset: () => set({ records: {}, order: [] }),
}))
