// Round 17: one hand-typed model form serves both entry points (the model manager
// and the `Add model` disclosure on an API connection card). The router stores the
// id verbatim, so the form never rewrites it, and its `Test` button declares the
// model first and then probes it through the non-blocking `probeModel` action.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomModelForm } from './CustomModelForm'
import { useProviderStore } from '../../store/providerStore'
import type { ProviderConnection, ProviderSnapshot } from '../../types/provider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const connection: ProviderConnection = {
  id: 'tokenharbor', providerId: 'custom', name: 'TokenHarbor', endpoint: 'https://tokenharbor.ai/v1',
  email: null, accountLabel: null, projectId: null, revision: 3, enabled: true, credentialPresent: true,
  authState: 'ready', projectState: 'not_applicable', discoveryState: 'failed', inferenceState: 'ready',
  lastTestedAt: null, lastDiscoveryAttemptAt: 1758391200000,
  error: 'Provider rejected the key: email_verification_required', quota: null, models: [],
}
const snapshot: ProviderSnapshot = { providers: [], connections: [connection], aliases: [], keys: [], usage: [], defaultRoute: { connectionId: null, modelId: null, aliasId: null }, health: { status: 'ok', version: 'test' } }

let root: Root
let host: HTMLDivElement
const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let probeResponse: () => Response

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
const okProbe = () => json({ status: 'passed', latencyMs: 412 })

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  calls.length = 0
  probeResponse = okProbe
  useProviderStore.setState({ snapshot, error: null, busy: false, loading: false })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : null })
    if (String(url).includes('/api/router/state')) return json(snapshot)
    if (String(url).endsWith('/test')) return probeResponse()
    return json(connection)
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent?.trim() === text)!
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const render = async (target: ProviderConnection = connection) => { await act(async () => root.render(<CustomModelForm connection={target} />)) }
const idInput = () => host.querySelector<HTMLInputElement>('input[placeholder="e.g. meta-llama/llama-3.3-70b-instruct"]')!
const nameInput = () => host.querySelector<HTMLInputElement>('input[placeholder="e.g. Llama 3.3 70B"]')!
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() }) }
const click = async (element: HTMLElement) => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }) }

describe('CustomModelForm', () => {
  it('declares the id exactly as typed through customModel and nothing else', async () => {
    await render()
    type(idInput(), 'TokenHarbor/Qwen3-Max')
    type(nameInput(), 'Qwen3 Max')
    const reasoning = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Reasoning'))!.querySelector('input')!
    await click(reasoning)
    await submit()

    const patch = calls.find(call => call.method === 'PATCH')!
    expect(patch.url).toBe('/api/router/connections/tokenharbor')
    expect(patch.body).toEqual({
      customModel: { id: 'TokenHarbor/Qwen3-Max', name: 'Qwen3 Max', capabilities: { vision: false, reasoning: true } },
    })
    expect(patch.body).not.toHaveProperty('models')
    expect(patch.body).not.toHaveProperty('enabledModelIds')
    expect(host.textContent).toContain('TokenHarbor/Qwen3-Max')
  })

  it('declares with PATCH and then probes the model, reporting HTTP, latency and the answer', async () => {
    await render()
    type(idInput(), 'tokenharbor/qwen3-max')
    await click(button('Test'))

    // Declare first, probe second; the `GET /api/router/state` reloads that both
    // paths perform after a mutation are not part of that order.
    const mutations = calls.filter(call => call.method !== 'GET')
    expect(mutations.map(call => call.method)).toEqual(['PATCH', 'POST'])
    expect(mutations[0].body).toEqual({ customModel: { id: 'tokenharbor/qwen3-max', name: 'tokenharbor/qwen3-max', capabilities: { vision: false, reasoning: false } } })
    expect(mutations[1].url).toBe('/api/router/connections/tokenharbor/models/tokenharbor%2Fqwen3-max/test')

    const text = host.textContent ?? ''
    expect(text).toContain('HTTP 200')
    expect(text).toMatch(/Latency \d+ ms/)
    expect(text).toContain('Answered BOXFOX_OK')
    expect(text).toContain('Target: TokenHarbor / tokenharbor/qwen3-max')
  })

  it('shows the router message verbatim on a 403 and keeps the model declared', async () => {
    probeResponse = () => json({ error: { code: 'AUTH', message: 'Provider rejected the key: email_verification_required' } }, 403)
    await render()
    type(idInput(), 'tokenharbor/qwen3-max')
    await click(button('Test'))

    const text = host.textContent ?? ''
    expect(text).toContain('Provider rejected the key: email_verification_required')
    expect(text).toContain('HTTP 403')
    expect(text).toContain('Answered no')
    expect(text).toContain('The key was rejected upstream. Replace it in Edit, then test again.')
    // The declaration is the durable half: the id reached the router even though the probe failed.
    expect(calls.find(call => call.method === 'PATCH')!.body).toEqual({
      customModel: { id: 'tokenharbor/qwen3-max', name: 'tokenharbor/qwen3-max', capabilities: { vision: false, reasoning: false } },
    })
  })

  it('disables Test with a reason when no key is saved and never because of unrelated busy state', async () => {
    useProviderStore.setState({ busy: true })
    await render()
    type(idInput(), 'tokenharbor/qwen3-max')
    expect(button('Test').disabled).toBe(false)

    await render({ ...connection, credentialPresent: false })
    expect(button('Test').disabled).toBe(true)
    expect(host.textContent).toContain('Save an API key on this connection first, then test a model id.')
  })
})
