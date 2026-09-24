import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from './providerStore'

const snapshot = { providers: [], connections: [], aliases: [], keys: [], usage: [], defaultRoute: { connectionId: null, modelId: null, aliasId: null }, health: { status: 'ok' as const, version: 'test' } }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
beforeEach(() => useProviderStore.setState({ snapshot: null, loading: false, busy: false, error: null }))
afterEach(() => vi.unstubAllGlobals())

describe('providerStore backend state', () => {
  it('does not show stale online state when the engine becomes unavailable', async () => {
    useProviderStore.setState({ snapshot })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Engine offline') }))
    await expect(useProviderStore.getState().load()).rejects.toThrow('Engine offline')
    expect(useProviderStore.getState().snapshot).toBeNull()
    expect(useProviderStore.getState().error).toBe('Engine offline')
  })

  it('preserves a one-time client key when the mutation succeeds but reload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ key: 'disposable-test-key' })).mockRejectedValueOnce(new Error('Reload offline')))
    await expect(useProviderStore.getState().request('/api/router/keys', 'POST', { name: 'test' })).resolves.toEqual({ key: 'disposable-test-key' })
    expect(useProviderStore.getState().error).toBe('Reload offline')
    expect(useProviderStore.getState().busy).toBe(false)
  })

  it('ignores older state responses that arrive after a newer refresh', async () => {
    let resolveOld!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve })).mockResolvedValueOnce(json(snapshot)))
    const old = useProviderStore.getState().load()
    await useProviderStore.getState().load()
    resolveOld(json({ ...snapshot, health: { status: 'ok', version: 'old' } }))
    await old
    expect(useProviderStore.getState().snapshot?.health.version).toBe('test')
  })

  it('uses the local admin header and keeps credentials out of browser storage', async () => {
    const fetchMock = vi.fn(async () => json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await useProviderStore.getState().load()
    expect(fetchMock.mock.calls[0]).toEqual(expect.arrayContaining(['/api/router/state', expect.objectContaining({ headers: { 'X-BoxFox-Admin': '1' }, credentials: 'same-origin' })]))
    expect(localStorage.getItem('boxfox-provider-store')).toBeNull()
  })

  it('probes one model without locking the form or painting the global error', async () => {
    const fetchMock = vi.fn(async (url: string, _init: RequestInit = {}) => (url === '/api/router/state' ? json(snapshot) : json({ status: 'passed' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(useProviderStore.getState().probeModel('conn 1', 'model/two')).resolves.toEqual({ status: 'passed', latencyMs: expect.any(Number) })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/router/connections/conn%201/models/model%2Ftwo/test')
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', headers: { 'X-BoxFox-Admin': '1' }, credentials: 'same-origin' }))
    expect(useProviderStore.getState().busy).toBe(false)
    expect(useProviderStore.getState().error).toBeNull()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/router/state')
  })

  it('returns the router envelope for a refused probe and still reloads the snapshot', async () => {
    const message = 'Provider authentication failed: email_verification_required. Reconnect or replace the credential.'
    const fetchMock = vi.fn(async (url: string, _init: RequestInit = {}) =>
      url === '/api/router/state'
        ? json(snapshot)
        : new Response(JSON.stringify({ error: { code: 'AUTH', message, retryable: false } }), { status: 403, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(useProviderStore.getState().probeModel('connection-1', 'th-orchestra')).resolves.toEqual({ status: 'failed', httpStatus: 403, code: 'AUTH', message })
    expect(useProviderStore.getState().error).toBeNull()
    expect(useProviderStore.getState().busy).toBe(false)
    expect(useProviderStore.getState().snapshot).toEqual(snapshot)
  })

  it('hands the key ring of a connection to the UI unchanged and adds nothing to it', async () => {
    const ringed = {
      connection: {
        id: 'openrouter-key', providerId: 'openrouter', name: 'OpenCode Free', enabled: true, credentialPresent: true,
        authState: 'ready', discoveryState: 'ready', inferenceState: 'unknown', models: [], error: null, quota: null, revision: 4,
        activeKeyId: 'key-2',
        keys: [
          { id: 'key-1', label: 'Key 1', prefix: 'sk-or-', state: 'cooling', cooldownUntil: 1_758_700_000_000, resetAt: null, lastErrorCode: 'RATE_LIMIT', lastErrorMessage: '429 rate limit · retry-after 30s', lastUsedAt: 1_758_600_000_000 },
          { id: 'key-2', label: 'Key 2', prefix: 'sk-or-', state: 'ready', cooldownUntil: null, resetAt: null, lastErrorCode: null, lastErrorMessage: null, lastUsedAt: 1_758_600_500_000 },
        ],
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...snapshot, connections: [ringed.connection] })))
    await useProviderStore.getState().load()

    // The store is a pass through: whatever the router decorated stays byte for byte,
    // and the UI is the only layer that decides how to draw a ring.
    expect(useProviderStore.getState().snapshot?.connections[0]).toEqual(ringed.connection)
    expect(Object.keys(useProviderStore.getState().snapshot!.connections[0])).toContain('keys')
  })

  it('reports a refused key write with its code and still reloads the ring the router kept', async () => {
    const message = 'Provider returned 429 for this key.'
    let state = snapshot
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/router/state') return json(state)
      state = { ...snapshot, health: { status: 'ok', version: 'after-429' } }
      return new Response(JSON.stringify({ error: { code: 'RATE_LIMIT', message, retryable: true } }), { status: 429, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await useProviderStore.getState().load()

    const rejection = useProviderStore.getState().request('/api/router/connections/openrouter-key/keys/key-1/try', 'POST')
    await expect(rejection).rejects.toMatchObject({ code: 'RATE_LIMIT', status: 429, message })
    // The banner gets the sentence, the ring gets the router's own view, and nothing is stuck busy.
    expect(useProviderStore.getState().error).toBe(message)
    expect(useProviderStore.getState().snapshot?.health.version).toBe('after-429')
    expect(useProviderStore.getState().busy).toBe(false)
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/router/state')
  })
})
