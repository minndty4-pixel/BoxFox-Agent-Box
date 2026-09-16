import { create } from 'zustand'
import { api, ProviderApiError } from '../lib/providerApi'
import type { ProviderSnapshot } from '../types/provider'

interface ProviderStore {
  snapshot: ProviderSnapshot | null
  loading: boolean
  busy: boolean
  error: string | null
  load: () => Promise<void>
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>
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
}))
