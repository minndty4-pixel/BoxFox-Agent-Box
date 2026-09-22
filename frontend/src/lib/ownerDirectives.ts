import { agentApi } from './agentApi'

/** Tiêu đề khối mà harness gắn vào cuối system message (runtime.py `create()`). */
export const OWNER_DIRECTIVES_HEADING = '=== OWNER-CONFIGURED DIRECTIVES ==='

/** Trần ký tự của engine khi runtime-info chưa nạp được. */
export const INSTRUCTIONS_FALLBACK_CHARS = 12000
/** Ngưỡng amber: sát mốc cắt thì bộ đếm đổi màu để mốc cắt không còn bất ngờ. */
export const INSTRUCTIONS_WARN_AT = 11000
/** Kẹp bước/thời gian khi chưa biết trần thật của engine (limits.maxStepsMax / deadlineMaxSeconds). */
export const STEPS_MAX_FALLBACK = 60
export const DEADLINE_MAX_FALLBACK = 600

export interface RuntimeInfoLimits {
  instructionsChars: number
  maxStepsDefault: number
  maxStepsMax: number
  deadlineDefaultSeconds: number
  deadlineMaxSeconds: number
  childMaxSteps: number
  childDeadlineSeconds: number
}

export interface RuntimeInfoToolGroup {
  key: string
  tools: string[]
  alwaysOn: boolean
}

export interface RuntimeInfo {
  toolGroups: RuntimeInfoToolGroup[]
  tools: string[]
  limits: RuntimeInfoLimits
  retry: Record<string, unknown>
  roles: Array<Record<string, unknown>>
}

let cached: RuntimeInfo | null = null
let inflight: Promise<RuntimeInfo | null> | null = null

/** Bản runtime-info đã nạp (null khi chưa nạp hoặc lần nạp trước thất bại). */
export function cachedRuntimeInfo(): RuntimeInfo | null {
  return cached
}

/**
 * Đọc bảng sự thật của engine: `GET /api/agent/runtime-info` (task 9).
 * Nạp một lần cho cả app, không bao giờ ném lỗi ra UI — nơi gọi tự quyết định nói gì khi `null`.
 */
export function loadRuntimeInfo(): Promise<RuntimeInfo | null> {
  if (cached) return Promise.resolve(cached)
  inflight ??= agentApi<RuntimeInfo>('/runtime-info')
    .then((info) => {
      cached = info
      return info
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Trần ký tự của harness; thiếu runtime-info thì rơi về hằng số của kế hoạch. */
export function instructionsLimit(info: RuntimeInfo | null = cached): number {
  const value = info?.limits?.instructionsChars
  return typeof value === 'number' && value > 0 ? value : INSTRUCTIONS_FALLBACK_CHARS
}

/** Trần `maxSteps` thật của engine. */
export function stepsCeiling(info: RuntimeInfo | null = cached): number {
  const value = info?.limits?.maxStepsMax
  return typeof value === 'number' && value > 0 ? value : STEPS_MAX_FALLBACK
}

/** Trần `deadlineSeconds` thật của engine. */
export function deadlineCeiling(info: RuntimeInfo | null = cached): number {
  const value = info?.limits?.deadlineMaxSeconds
  return typeof value === 'number' && value > 0 ? value : DEADLINE_MAX_FALLBACK
}

/**
 * Tên công cụ hợp lệ của engine, hoặc `null` khi chưa biết.
 * `null` nghĩa là KHÔNG được kẹp: thà giữ điều người dùng gõ còn hơn xoá trắng vì thiếu dữ liệu.
 */
export function validToolNames(info: RuntimeInfo | null = cached): string[] | null {
  const tools = info?.tools
  return Array.isArray(tools) && tools.length > 0 ? tools : null
}

/** Giữ lại đúng những tên engine biết; `known = null` thì trả về nguyên bản. */
export function narrowTools(tools: string[], known: string[] | null): string[] {
  if (!known) return [...tools]
  const allowed = new Set(known)
  return tools.filter((tool) => allowed.has(tool))
}

/** Bậc màu của bộ đếm ký tự: ok → warn (sát mốc cắt) → over (tới mốc cắt). */
export function instructionsTone(count: number, limit: number): 'ok' | 'warn' | 'over' {
  if (count >= limit) return 'over'
  const warnAt = Math.min(INSTRUCTIONS_WARN_AT, Math.max(0, limit - 1000))
  return count >= warnAt ? 'warn' : 'ok'
}

/** `12000` → `'12,000'` — con số trong câu phải đọc được, không phải `12000`. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
