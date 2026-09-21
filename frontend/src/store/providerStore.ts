import { create } from 'zustand'
import { api, ProviderApiError } from '../lib/providerApi'
import type { ProviderSnapshot } from '../types/provider'

export type ModelProbeResult =
  | { status: 'passed'; latencyMs: number }
  | { status: 'failed'; httpStatus: number; code: string; message: string }

interface ProviderStore {
  snapshot: ProviderSnapshot | null
  loading: boolean
  busy: boolean
  error: string | null
  load: () => Promise<void>
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>
  probeModel: (connectionId: string, modelId: string, signal?: AbortSignal) => Promise<ModelProbeResult>
}

function errorMessage(error: unknown) {
  if (error instanceof ProviderApiError || error instanceof Error) return error.message
  return 'Router request failed.'
}

let loadRevision = 0
let pendingRequests = 0

export const useProviderStore = create<ProviderStore>((set, get) => ({
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
  load: async () => {
    const revision = ++loadRevision
    set({ loading: true, error: null })
    try {
      const snapshot = await api<ProviderSnapshot>('/api/router/state')
      if (revision === loadRevision) set({ snapshot, loading: false })
    } catch (error) {
      if (revision === loadRevision) set({ snapshot: null, loading: false, error: errorMessage(error) })
      throw error
    }
  },
  request: async (path, method = 'POST', body) => {
    pendingRequests++
    set({ busy: true, error: null })
    try {
      const result = await api(path, { method, body })
      // A successful mutation must not lose a one-time key if state refresh fails.
      await get().load().catch(() => undefined)
      return result
    } catch (error) {
      // Mutations such as a model probe can persist useful state even when the
      // probe itself fails (for example rate_limited/unavailable). Reload that
      // state so the card reports the durable result rather than “Not tested”.
      await get().load().catch(() => undefined)
      set({ error: errorMessage(error) })
      throw error
    } finally {
      pendingRequests--
      set({ busy: pendingRequests > 0 })
    }
  },
  /**
   * Probe one model. Deliberately does NOT go through `request()`: one upstream
   * ping can take up to 90 s, and `request()` would hold the global `busy` flag
   * (freezing every button on the screen) and paint the global error banner for a
   * failure that the model row already reports next to the button that caused it.
   * The result is returned to the caller; the router persists health/lastProbe
   * even on failure, so the state reload in `finally` is what makes it durable.
   */
  probeModel: async (connectionId, modelId, signal) => {
    const started = performance.now()
    try {
      await api(`/api/router/connections/${encodeURIComponent(connectionId)}/models/${encodeURIComponent(modelId)}/test`, { method: 'POST', signal })
      return { status: 'passed', latencyMs: Math.round(performance.now() - started) }
    } catch (error) {
      if (error instanceof ProviderApiError) return { status: 'failed', httpStatus: error.status, code: error.code, message: error.message }
      return { status: 'failed', httpStatus: 0, code: 'REQUEST_FAILED', message: errorMessage(error) }
    } finally {
      await get().load().catch(() => undefined)
    }
  },
}))
