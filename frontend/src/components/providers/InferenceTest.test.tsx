import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InferenceTest } from './InferenceTest'
import type { ProviderConnection } from '../../types/provider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const connection: ProviderConnection = { id: 'test-connection', providerId: 'custom', name: 'Test provider', endpoint: 'http://localhost/v1', email: null, accountLabel: null, projectId: null, revision: 1, enabled: true, credentialPresent: true, authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready', inferenceState: 'unknown', lastTestedAt: null, error: null, quota: null, models: [{ id: 'test-model', name: 'Test model', enabled: true, capabilities: { streaming: 'reported', tools: 'reported', vision: 'unknown' } }] }
const meta = { requestId: 'test-request', connectionId: connection.id, modelId: 'test-model', aliasId: null }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
let root: Root
let host: HTMLDivElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function send() { await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Test inference')!.click() }) }
describe('Provider inference verification', () => {
  it('shows real target, request, response and unknown usage without initializing agent chat', async () => {
    const fetchMock = vi.fn(async (path: string) => path === '/v1/router/generate' ? json({ boxfox: meta, choices: [{ message: { content: 'BOXFOX_OK' }, finish_reason: 'stop' }] }) : json({ providers: [], connections: [], aliases: [], keys: [], usage: [], health: { status: 'ok', version: 'test' } }))
    vi.stubGlobal('fetch', fetchMock)
    act(() => root.render(<InferenceTest connection={connection} />))
    await send()
    expect(host.textContent).toContain('passed')
    expect(host.textContent).toContain('BOXFOX_OK')
    expect(host.textContent).toContain('test-request')
    expect(host.textContent).toContain('Tokens: No data / No data')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/router/generate')
  })
  it('never counts HTTP authorization failures or incomplete responses as passed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/v1/router/generate' ? json({ error: { code: 'AUTH', message: 'Authorization failed' } }, 401) : json({})))
    act(() => root.render(<InferenceTest connection={connection} />))
    await send()
    expect(host.textContent).toContain('failed: Authorization failed')
    expect(host.textContent).not.toContain('passed')
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/v1/router/generate' ? json({ boxfox: meta, choices: [{ message: { content: 'partial' }, finish_reason: null }] }) : json({})))
    await send()
    expect(host.textContent).toContain('failed: Incomplete inference response')
  })
  it('disables inference when only authorization is ready but discovery is not', () => {
    act(() => root.render(<InferenceTest connection={{ ...connection, discoveryState: 'pending' }} />))
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
  })
  it('allows verifying a hand-typed model on a connection whose discovery failed', () => {
    // `validTarget` của router mở đúng một cửa cho connection dò hỏng: model `source === 'custom'`.
    // Panel này là chỗ duy nhất kiểm chứng model gõ tay, nên nút Test phải bật ở đúng cửa đó.
    const degraded: ProviderConnection = { ...connection, discoveryState: 'degraded', models: [{ ...connection.models[0], source: 'custom' }] }
    act(() => root.render(<InferenceTest connection={degraded} />))
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false)
  })
  it('keeps inference locked when discovery failed and the model was not typed by hand', () => {
    const failed: ProviderConnection = { ...connection, discoveryState: 'failed', models: [{ ...connection.models[0], source: 'live' }] }
    act(() => root.render(<InferenceTest connection={failed} />))
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
  })
})
