/**
 * Nguồn dữ liệu cho bảng Nhật ký hệ thống (việc 5, bản v2 — kế hoạch §3).
 *
 * Đường duy nhất tới dữ liệu là route CHỈ ĐỌC của harness
 * `GET /api/agent/system-log` (§3.1): nhật ký nằm trên HOST, ngoài box, nên giao
 * diện phải đi qua harness chứ không qua container. Bảng tự làm mới theo nhịp 2
 * giây trong lúc đang mở (§3.4) — hàng đợi `setInterval` thường, không SSE, không
 * thêm thư viện.
 *
 * Trạng thái "chưa có tệp log" (harness chưa chạy lần nào) là dữ liệu THẬT:
 * API trả `exists: false` kèm danh sách rỗng, và bảng hiện đúng như vậy chứ
 * không bịa dòng nào.
 */
import { useCallback, useEffect, useState } from 'react'
import { agentApi } from '../lib/agentApi'

/** Một dòng JSONL của nhật ký, đúng shape mà hai writer ghi ra. */
export interface SystemLogEntry {
  ts: string
  level: string
  source: string
  event: string
  runId?: string
  sessionId?: string
  turnId?: number
  code?: string
  message?: string
  durationMs?: number
  data?: Record<string, unknown>
}

/** Payload của `GET /api/agent/system-log`. */
export interface SystemLogSnapshot {
  entries: SystemLogEntry[]
  count: number
  exists: boolean
  file: string
  lines: number
  cap: number
  runId: string | null
  version: string | null
  commit: string | null
}

export interface SystemLogFilters {
  /** `all` hoặc một trong `info`/`warn`/`error`. */
  level: string
  /** `all` hoặc `harness`/`router`. */
  source: string
  /** Rỗng = mọi phiên; khớp theo tiền tố (bảng hiện 8 ký tự đầu). */
  sessionId: string
  lines: number
}

export const SYSTEM_LOG_DEFAULT_LINES = 200
export const SYSTEM_LOG_REFRESH_MS = 2000

/** Query path cho API; bỏ qua bộ lọc đang để `all` để URL đọc được. */
export function systemLogQueryPath(filters: SystemLogFilters): string {
  const params = new URLSearchParams()
  if (filters.level && filters.level !== 'all') params.set('level', filters.level)
  if (filters.source && filters.source !== 'all') params.set('source', filters.source)
  const session = filters.sessionId.trim()
  if (session) params.set('sessionId', session)
  params.set('lines', String(filters.lines))
  return `/system-log?${params.toString()}`
}

export async function fetchSystemLog(filters: SystemLogFilters): Promise<SystemLogSnapshot> {
  return agentApi<SystemLogSnapshot>(systemLogQueryPath(filters))
}

export function useSystemLog(
  filters: SystemLogFilters,
  options: { intervalMs?: number; fetcher?: typeof fetchSystemLog } = {},
) {
  const { intervalMs = SYSTEM_LOG_REFRESH_MS, fetcher = fetchSystemLog } = options
  const { level, source, lines } = filters
  const sessionId = filters.sessionId.trim()
  const [snapshot, setSnapshot] = useState<SystemLogSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Nút "làm mới" của bảng: tăng token để lần đọc lại chạy ngay, không chờ nhịp.
  const refresh = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const next = await fetcher({ level, source, sessionId, lines })
        if (!alive) return
        setSnapshot(next)
        setError(null)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    const timer = setInterval(() => void load(), intervalMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [fetcher, intervalMs, level, source, sessionId, lines, reloadToken])

  return { snapshot, error, refresh }
}
