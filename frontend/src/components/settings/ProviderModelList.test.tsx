// Round 29, second half of the Settings work: one row per model, however many connections
// of the provider serve it. These cases pin the deduplication, the sequential per-connection
// PATCH behind one checkbox, the half-on checkbox (`indeterminate`) and its honest partial
// failure line, and the single probe that goes through the highest ranked connection.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderModelList } from './ProviderModelList'
import { useProviderStore } from '../../store/providerStore'
import type { ProviderConnection, ProviderModel } from '../../types/provider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function model(id: string, over: Partial<ProviderModel> = {}): ProviderModel {
  return { id, name: id, enabled: false, source: 'live', capabilities: { streaming: 'verified', tools: 'verified', vision: 'unknown' }, ...over }
}

function connection(id: string, name: string, models: ProviderModel[]): ProviderConnection {
  return {
    id, providerId: 'openrouter', name, endpoint: null, email: null, accountLabel: null, projectId: null, revision: 1,
    enabled: true, credentialPresent: true, authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready',
    inferenceState: 'unknown', models, lastTestedAt: null, error: null, quota: null,
  }
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const failure = (status: number, message: string) => new Response(JSON.stringify({ error: { code: 'UPSTREAM', message, retryable: true } }), { status, headers: { 'content-type': 'application/json' } })
const enableBox = () => host.querySelector<HTMLInputElement>('input[aria-label="Enable gpt-5-mini"]')!
const patched = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useProviderStore.setState({ snapshot: null, error: null, busy: false, loading: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const renderList = (connections: ProviderConnection[]) => act(async () => root.render(<ProviderModelList connections={connections} />))

describe('Provider model list', () => {
  it('draws one row for a model two connections serve and says how many serve it', async () => {
    const alpha = connection('alpha', 'Alpha key', [model('gpt-5-mini')])
    const beta = connection('beta', 'Beta key', [model('gpt-5-mini')])
    await renderList([alpha, beta])

    expect(host.querySelectorAll('input[aria-label="Enable gpt-5-mini"]')).toHaveLength(1)
    const chip = [...host.querySelectorAll<HTMLSpanElement>('span')].find((span) => span.textContent === '2 connections')!
    expect(chip.title).toBe('Alpha key, Beta key')
    expect(host.textContent).toContain('One row per model · served by 2 connections.')
  })

  it('Toggles every serving connection one PATCH at a time, never in parallel', async () => {
    const alpha = connection('alpha', 'Alpha key', [model('gpt-5-mini', { enabled: true })])
    const beta = connection('beta', 'Beta key', [model('gpt-5-mini')])
    let release!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PATCH' && String(url).endsWith('/connections/alpha')) return first
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    await renderList([alpha, beta])

    act(() => enableBox().click())
    await act(async () => undefined)
    expect(patched(fetchMock)).toHaveLength(1)

    await act(async () => { release(json({})) })
    const calls = patched(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call[0])).toEqual(['/api/router/connections/alpha', '/api/router/connections/beta'])
    expect(JSON.parse(String((calls[1][1] as RequestInit).body))).toEqual({ enabledModelIds: ['gpt-5-mini'] })
  })

  it('shows a half-on checkbox while only some connections serve the model, and a full one once all do', async () => {
    const alpha = connection('alpha', 'Alpha key', [model('gpt-5-mini', { enabled: true })])
    const beta = connection('beta', 'Beta key', [model('gpt-5-mini')])
    vi.stubGlobal('fetch', vi.fn(async () => json({})))
    await renderList([alpha, beta])

    expect(enableBox().checked).toBe(false)
    expect(enableBox().indeterminate).toBe(true)

    // The store reloaded and handed the list the new snapshots: every serving connection
    // now has the model on.
    await renderList([alpha, connection('beta', 'Beta key', [model('gpt-5-mini', { enabled: true })])])
    expect(enableBox().checked).toBe(true)
    expect(enableBox().indeterminate).toBe(false)
  })

  it('says how many connections took a change when one of them refuses it', async () => {
    const connections = ['alpha', 'beta', 'gamma'].map((id) => connection(id, `${id} key`, [model('gpt-5-mini')]))
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PATCH' && String(url).endsWith('/connections/beta')) return failure(503, 'Router is reloading connections.')
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    await renderList(connections)

    await act(async () => enableBox().click())
    expect(patched(fetchMock)).toHaveLength(3)
    expect(host.textContent).toContain('Enabled in 2 of 3 connections.')
  })

  it('probes through the highest ranked connection once and names it when others serve the model too', async () => {
    const alpha = connection('alpha', 'Alpha key', [model('gpt-5-mini')])
    const beta = connection('beta', 'Beta key', [model('gpt-5-mini')])
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST' && String(url).endsWith('/test')) return json({ status: 'passed' })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    await renderList([alpha, beta])

    const test = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Test')!
    await act(async () => test.click())

    const probes = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/test'))
    expect(probes).toHaveLength(1)
    expect(probes[0][0]).toBe('/api/router/connections/alpha/models/gpt-5-mini/test')
    expect(host.textContent).toContain('Tested via Alpha key')
  })
})
