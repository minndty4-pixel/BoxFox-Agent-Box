import { create } from 'zustand'
import { loadRuntimeInfo } from '../lib/ownerDirectives'

/**
 * Bản reactive của bảng sự thật `GET /api/agent/runtime-info`.
 *
 * `lib/ownerDirectives.ts` đã giữ cache dùng chung cho cả app (và `harnessStore.
 * setHarnessTuning()` kẹp số bằng chính cache đó), nên store này KHÔNG tự gọi
 * mạng lần thứ hai — nó chỉ bọc cache ấy lại và thêm trạng thái để component
 * phân biệt được "chưa nạp" với "nạp lỗi".
 *
 * Quy tắc: khi `status === 'failed'` thì `info` bị xoá về `null` và mọi chỗ hiển
 * thị phải ghi `unavailable` — tuyệt đối không bày lại con số của lần chạy trước.
 */

export interface RuntimeToolGroup {
  key: string
  tools: string[]
  alwaysOn: boolean
}

export interface RuntimeRoleInfo {
  id: string
  name: string
  tools: string[]
  skills: string[]
}

export interface RuntimeRetryPolicy {
  maxRetries: number
  backoffSeconds: number[]
  rateLimitMaxSeconds: number
  budgetSeconds: number
  jitter: number
}

export interface RuntimeLimits {
  instructionsChars: number
  maxStepsDefault: number
  maxStepsMax: number
  deadlineDefaultSeconds: number
  deadlineMaxSeconds: number
  childMaxSteps: number
  childDeadlineSeconds: number
}

export interface RuntimeInfoView {
  toolGroups: RuntimeToolGroup[]
  tools: string[]
  roles: RuntimeRoleInfo[]
  retry: RuntimeRetryPolicy | null
  limits: RuntimeLimits | null
}

export type RuntimeInfoStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface RuntimeInfoState {
  info: RuntimeInfoView | null
  status: RuntimeInfoStatus
  error: string | null
  /** Nạp một lần cho cả app; `force` dùng cho nút thử lại. */
  load: (force?: boolean) => Promise<void>
}

/** Câu dùng chung khi chưa có số thật: ngắn, không hứa hẹn gì. */
export const RUNTIME_INFO_UNAVAILABLE = 'unavailable'

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Đọc payload thô thành dạng UI dùng được; thiếu trường thì trả `null`/rỗng chứ không bịa. */
function toView(raw: Record<string, unknown>): RuntimeInfoView {
  const toolGroups = Array.isArray(raw.toolGroups)
    ? raw.toolGroups.flatMap((entry): RuntimeToolGroup[] => {
        if (!entry || typeof entry !== 'object') return []
        const record = entry as Record<string, unknown>
        const key = typeof record.key === 'string' ? record.key : ''
        if (!key) return []
        return [{ key, tools: stringList(record.tools), alwaysOn: record.alwaysOn === true }]
      })
    : []

  const roles = Array.isArray(raw.roles)
    ? raw.roles.flatMap((entry): RuntimeRoleInfo[] => {
        if (!entry || typeof entry !== 'object') return []
        const record = entry as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id : ''
        if (!id) return []
        return [
          {
            id,
            name: typeof record.name === 'string' ? record.name : id,
            tools: stringList(record.tools),
            skills: stringList(record.skills),
          },
        ]
      })
    : []

  const retrySource = raw.retry && typeof raw.retry === 'object' ? (raw.retry as Record<string, unknown>) : null
  const maxRetries = numberOrNull(retrySource?.maxRetries)
  const rateLimitMaxSeconds = numberOrNull(retrySource?.rateLimitMaxSeconds)
  const budgetSeconds = numberOrNull(retrySource?.budgetSeconds)
  const jitter = numberOrNull(retrySource?.jitter)
  const backoffSeconds = Array.isArray(retrySource?.backoffSeconds)
    ? retrySource.backoffSeconds.filter((value): value is number => typeof value === 'number')
    : []
  const retry =
    retrySource &&
    maxRetries !== null &&
    rateLimitMaxSeconds !== null &&
    budgetSeconds !== null &&
    jitter !== null &&
    backoffSeconds.length > 0
      ? { maxRetries, backoffSeconds, rateLimitMaxSeconds, budgetSeconds, jitter }
      : null

  const limitsSource = raw.limits && typeof raw.limits === 'object' ? (raw.limits as Record<string, unknown>) : null
  const limitKeys = [
    'instructionsChars',
    'maxStepsDefault',
    'maxStepsMax',
    'deadlineDefaultSeconds',
    'deadlineMaxSeconds',
    'childMaxSteps',
    'childDeadlineSeconds',
  ] as const
  const limits =
    limitsSource && limitKeys.every((key) => numberOrNull(limitsSource[key]) !== null)
      ? (Object.fromEntries(limitKeys.map((key) => [key, numberOrNull(limitsSource[key])])) as unknown as RuntimeLimits)
      : null

  return { toolGroups, tools: stringList(raw.tools), roles, retry, limits }
}

export const useRuntimeInfoStore = create<RuntimeInfoState>((set, get) => ({
  info: null,
  status: 'idle',
  error: null,
  load: async (force = false) => {
    const { status, info } = get()
    if (status === 'loading') return
    if (!force && status === 'ready' && info) return

    set({ status: 'loading', error: null })
    const raw = await loadRuntimeInfo()
    if (!raw) {
      // Xoá luôn `info`: UI không được phép bày lại con số của lần chạy trước.
      set({ info: null, status: 'failed', error: 'runtime-info did not answer' })
      return
    }
    set({ info: toView(raw as unknown as Record<string, unknown>), status: 'ready', error: null })
  },
}))
