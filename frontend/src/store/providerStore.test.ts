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
})
