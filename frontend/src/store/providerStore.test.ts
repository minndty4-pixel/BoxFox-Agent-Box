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
})
