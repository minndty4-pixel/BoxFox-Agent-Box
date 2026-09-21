// Round 15: the "Custom Model" form is the manual mechanism beside discovery —
// the user types the model id and declares whether it reasons. The form used to
// send a copy of the whole `models` array plus the new id in `enabledModelIds`,
// which the router rejects (`INVALID_REQUEST: Select only models discovered for
// this connection.`), so the manual mechanism never reached the router at all.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelManagerModal } from './ModelManagerModal'
import { useProviderStore } from '../../store/providerStore'
import type { ModelPricing, ProviderConnection, ProviderSnapshot } from '../../types/provider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const connection: ProviderConnection = {
  id: 'deepseek-connection', providerId: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1',
  email: null, accountLabel: null, projectId: null, revision: 1, enabled: true, credentialPresent: true,
  authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready', inferenceState: 'ready',
  lastTestedAt: null, error: null, quota: null,
  models: [
    {
      id: 'deepseek-flash', name: 'deepseek-flash', enabled: true, source: 'live', health: 'ready',
      capabilities: { streaming: 'reported', tools: 'reported', vision: 'reported', reasoning: 'reported' },
      thinkingLevels: ['none', 'low', 'high', 'max'], thinkingType: 'effort', defaultThinking: 'high',
    } as never,
  ],
}
const snapshot: ProviderSnapshot = { providers: [], connections: [connection], aliases: [], keys: [], usage: [], defaultRoute: { connectionId: 'deepseek-connection', modelId: 'deepseek-flash', aliasId: null }, health: { status: 'ok', version: 'test' } }

let root: Root
let host: HTMLDivElement
const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  calls.length = 0
  useProviderStore.setState({ snapshot, error: null, busy: false, loading: false })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : null })
    const payload = String(url).includes('/api/router/state') ? snapshot : connection
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent?.trim() === text)!
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('Model manager custom model form', () => {
  it('declares the model through customModel instead of rewriting the model list', async () => {
    await act(async () => root.render(<ModelManagerModal connection={connection} onClose={() => {}} />))

    act(() => button('Custom Model').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const idInput = host.querySelector<HTMLInputElement>('input[placeholder="e.g. meta-llama/llama-3.3-70b-instruct"]')!
    const nameInput = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Llama 3.3 70B"]')!
    type(idInput, 'deepseek-next')
    type(nameInput, 'DeepSeek next')

    const reasoning = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Reasoning'))!.querySelector('input')!
    act(() => reasoning.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const form = host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    const patch = calls.find(call => call.method === 'PATCH')!
    expect(patch.url).toBe('/api/router/connections/deepseek-connection')
    expect(patch.body).toEqual({
      customModel: { id: 'deepseek-next', name: 'DeepSeek next', capabilities: { vision: false, reasoning: true } },
    })
    expect(patch.body).not.toHaveProperty('models')
    expect(patch.body).not.toHaveProperty('enabledModelIds')
  })

  // Round 17: the row `Test` button goes through the non-blocking `probeModel`
  // action, so a slow upstream ping no longer disables every button in the modal
  // (and no longer paints the global error banner) — the result lands on the row.
  it('probes a row through the non-blocking action and reports HTTP and latency', async () => {
    useProviderStore.setState({ busy: true })
    await act(async () => root.render(<ModelManagerModal connection={connection} onClose={() => {}} />))

    const test = [...host.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent?.trim() === 'Test')!
    expect(test.disabled).toBe(false)

    await act(async () => { test.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })

    expect(calls.some(call => call.url.endsWith('/models/deepseek-flash/test') && call.method === 'POST')).toBe(true)
    const text = host.textContent ?? ''
    expect(text).toContain('Passed · HTTP 200')
    expect(text).toMatch(/Passed · HTTP 200 · \d+ ms/)
  })

  // `probeHealth()` answers `'failed'`, never `'error'`, so the red badge used to be
  // unreachable for a model whose only evidence is `health`.
  it('shows the failed badge for health: "failed" even without a lastProbe', async () => {
    const failed: ProviderConnection = {
      ...connection,
      discoveryState: 'failed',
      models: [{ ...connection.models[0], id: 'tokenharbor/qwen3-max', name: 'qwen3-max', health: 'failed', lastProbe: undefined } as never],
    }
    await act(async () => root.render(<ModelManagerModal connection={failed} onClose={() => {}} />))

    const badge = [...host.querySelectorAll<HTMLSpanElement>('span')].find(span => span.textContent?.trim() === 'Failed' && span.className.includes('rounded-full'))!
    expect(badge).toBeTruthy()
    expect(badge.className).toContain('rose')
    expect(host.textContent).not.toContain('Untested')
  })
})

// Round 17 (plan A8): the detail pane used to read OpenRouter-shaped
// `pricing.prompt`/`pricing.completion` and print a price with no author. The block
// now shows the price in use in USD per 1M tokens, names where it came from, and
// lets the user override it for this model only.
describe('Model manager price block', () => {
  const priceInput = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const pricing = (over: Partial<ModelPricing>): ModelPricing => ({
    currency: 'USD', unit: 'per_million_tokens', input: 0.28, cachedInput: null, output: 0.42, source: 'ping', asOf: '2026-09-01', ...over,
  })
  const pricedConnection = (over: Partial<ModelPricing>): ProviderConnection => ({
    ...connection,
    models: [{ ...connection.models[0], pricing: pricing(over) } as never],
  })
  const hasButton = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].some(candidate => candidate.textContent?.trim() === text)
  const click = (text: string) => act(() => button(text).dispatchEvent(new MouseEvent('click', { bubbles: true })))

  it('saves the three numbers through modelPricing', async () => {
    await act(async () => root.render(<ModelManagerModal connection={connection} onClose={() => {}} />))
    expect(host.textContent).toContain('Not set — cost stays blank')
    expect(host.textContent).toContain('Not set')

    click('Edit price')
    type(priceInput('Input price per million tokens'), '0.15')
    type(priceInput('Cached input price per million tokens'), '0.015')
    type(priceInput('Output price per million tokens'), '0.6')
    await act(async () => { button('Save price').dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })

    const patch = calls.find(call => call.method === 'PATCH')!
    expect(patch.url).toBe('/api/router/connections/deepseek-connection')
    expect(patch.body).toEqual({ modelPricing: { modelId: 'deepseek-flash', input: 0.15, cachedInput: 0.015, output: 0.6 } })
    expect(hasButton('Edit price')).toBe(true)
    // The editor re-seeds from the price in use, so a saved row whose store copy
    // has not caught up yet reopens blank instead of showing stale typing.
    click('Edit price')
    expect(priceInput('Input price per million tokens').value).toBe('')
  })

  it('refuses a blank or out-of-range price without calling the router', async () => {
    await act(async () => root.render(<ModelManagerModal connection={connection} onClose={() => {}} />))
    click('Edit price')
    type(priceInput('Output price per million tokens'), '0.6')
    await act(async () => { button('Save price').dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(calls.some(call => call.method === 'PATCH')).toBe(false)
    expect(host.textContent).toContain('Enter an input and an output price in USD per million tokens (0–1000).')

    type(priceInput('Input price per million tokens'), '2000')
    await act(async () => { button('Save price').dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(calls.some(call => call.method === 'PATCH')).toBe(false)

    type(priceInput('Input price per million tokens'), '0.15')
    await act(async () => { button('Save price').dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({ modelPricing: { modelId: 'deepseek-flash', input: 0.15, output: 0.6 } })
  })

  it('shows the price in use and where it came from', async () => {
    await act(async () => root.render(<ModelManagerModal connection={pricedConnection({})} onClose={() => {}} />))
    expect(host.textContent).toContain('$0.28 / 1M')
    expect(host.textContent).toContain('$0.42 / 1M')
    expect(host.textContent).toContain("From the provider's model list · as of 2026-09-01")
    expect(hasButton('Clear override')).toBe(false)

    click('Edit price')
    expect(priceInput('Input price per million tokens').value).toBe('0.28')
    expect(priceInput('Cached input price per million tokens').value).toBe('')
    expect(priceInput('Output price per million tokens').value).toBe('0.42')
  })

  it('clears a price the user set and keeps the door open to a manual override', async () => {
    await act(async () => root.render(<ModelManagerModal connection={pricedConnection({ source: 'manual', asOf: undefined })} onClose={() => {}} />))
    expect(host.textContent).toContain('Set by you')

    click('Edit price')
    expect(hasButton('Clear override')).toBe(true)
    await act(async () => { button('Clear override').dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })

    expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({ modelPricing: { modelId: 'deepseek-flash', clear: true } })
  })

  it('replaces the price with the plan wording for a subscription connection', async () => {
    await act(async () => root.render(<ModelManagerModal connection={{ ...connection, costMode: 'included' }} onClose={() => {}} />))
    expect(host.textContent).toContain('Included in the plan — this provider does not bill per token.')
    expect(hasButton('Edit price')).toBe(false)
    expect(priceInput('Input price per million tokens')).toBeNull()
  })
})

// Review finding 6: the Free tab matched `pricing.prompt === '0'` — the pre-round raw
// payload shape — so a model the router prices at `input: 0` was missing from a tab
// whose whole job is to find it. One predicate now serves the tab and the batch action,
// and it is the router's own rule (`src/providers/openrouter.mjs`).
describe('Model manager free filter', () => {
  it('keeps a model the provider prices at zero, not only ids with :free in them', async () => {
    const priced = (id: string, name: string, input: number, output: number) => ({
      id, name, enabled: false, source: 'live', health: 'ready',
      capabilities: { streaming: 'reported', tools: 'reported', vision: 'unknown' },
      pricing: { currency: 'USD', unit: 'per_million_tokens', input, cachedInput: null, output, source: 'ping' },
    })
    const freebie: ProviderConnection = {
      ...connection,
      id: 'openrouter-connection', providerId: 'openrouter',
      models: [priced('vendor/zeta-flash', 'Zeta Flash', 0, 0), priced('vendor/paid-pro', 'Paid Pro', 0.6, 2)] as never,
    }
    useProviderStore.setState({ snapshot: { ...snapshot, connections: [freebie] } })
    await act(async () => root.render(<ModelManagerModal connection={freebie} onClose={() => {}} />))

    act(() => button('Free Tier').dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(host.textContent).toContain('Zeta Flash')
    expect(host.textContent).not.toContain('Paid Pro')
  })
})
