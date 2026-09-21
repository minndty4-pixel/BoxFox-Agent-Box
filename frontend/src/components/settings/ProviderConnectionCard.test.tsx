// Task 3 of plan B: the API connection card is compressed and the model rows are
// 26-30 px tall. These cases lock the compressed layout, the two honest sentences
// about the saved key, the non-blocking per-model probe and the unchanged
// `enabledModelIds` semantics.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderView } from './ProviderView'
import { useProviderStore } from '../../store/providerStore'
import type { ProviderConnection, ProviderModel, ProviderSnapshot } from '../../types/provider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AUTH_MESSAGE = 'Provider authentication failed: email_verification_required. Reconnect or replace the credential.'

function model(id: string, over: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id, name: id, enabled: true, source: 'live',
    capabilities: { streaming: 'verified', tools: 'verified', vision: 'unknown' },
    ...over,
  }
}

function probe(status: 'passed' | 'failed', latencyMs: number, httpStatus = status === 'passed' ? 200 : 503) {
  return { status, httpStatus, latencyMs, testedAt: '2026-09-20T10:00:00Z', error: status === 'passed' ? null : 'Provider rejected the probe.' }
}

const models: ProviderModel[] = [
  model('gpt-5-mini', { name: 'GPT-5 mini', health: 'ready', lastProbe: probe('passed', 958), capabilities: { streaming: 'verified', tools: 'verified', vision: 'verified' } }),
  model('gpt-5', { name: 'GPT-5', health: 'ready', lastProbe: probe('passed', 1310) }),
  model('claude-sonnet-4.5', { name: 'Claude Sonnet 4.5', health: 'unavailable', lastProbe: probe('failed', 402) }),
  model('deepseek-v3.2', { name: 'DeepSeek V3.2', health: 'rate_limited', lastProbe: probe('failed', 505, 429) }),
  model('gpt-5-nano', { name: 'GPT-5 nano', health: 'slow', lastProbe: probe('failed', 30000) }),
  model('gemini-2.5-pro', { name: 'Gemini 2.5 Pro', health: 'failed', lastProbe: probe('failed', 398, 403) }),
  model('qwen3-max', { name: 'Qwen3 Max' }),
  model('th-orchestra', { name: 'th-orchestra', enabled: false, source: 'custom', capabilities: { streaming: 'unknown', tools: 'unknown', vision: 'unsupported' } }),
]

const connection: ProviderConnection = {
  id: 'openrouter-key', providerId: 'openrouter', name: 'OpenRouter key', endpoint: null, email: null, accountLabel: 'account@example.test', projectId: null,
  revision: 3, enabled: true, credentialPresent: true, authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready', inferenceState: 'unknown',
  models, lastTestedAt: '2026-09-20T10:00:00Z', lastModelSyncAt: '2026-09-20T10:15:00Z', autoSync: true, error: null, quota: null,
}

const expiredConnection: ProviderConnection = { ...connection, revision: 4, authState: 'expired', error: AUTH_MESSAGE }


const snapshot: ProviderSnapshot = {
  providers: [
    { id: 'antigravity', name: 'Antigravity', authMethod: 'oauth', protocol: 'antigravity', icon: '/providers/antigravity.png', category: 'oauth', runtimeAvailable: true, availability: 'ready', routerVisible: true, discoveryClass: 'account-live' },
    { id: 'openrouter', name: 'OpenRouter', authMethod: 'api_key', protocol: 'openai', icon: '/providers/openrouter.png', category: 'free', runtimeAvailable: true, availability: 'ready', routerVisible: true, defaultEndpoint: 'https://openrouter.ai/api/v1', discoveryClass: 'openai-compat' },
    { id: 'openai', name: 'OpenAI', authMethod: 'api_key', protocol: 'openai', icon: '/providers/openai.svg' },
    { id: 'anthropic', name: 'Anthropic', authMethod: 'api_key', protocol: 'anthropic', icon: '/providers/anthropic.svg' },
    { id: 'gemini', name: 'Google Gemini', authMethod: 'api_key', protocol: 'gemini', icon: '/providers/gemini.svg' },
    { id: 'custom', name: 'OpenAI-compatible', authMethod: 'api_key', protocol: 'openai', icon: '/providers/custom.svg' },
  ],
  connections: [connection], aliases: [], keys: [], usage: [], defaultRoute: { connectionId: null, modelId: null, aliasId: null }, health: { status: 'ok', version: 'test' },
}

// A third-party gateway whose `/models` listing was refused by the provider itself.
const customFailedSnapshot: ProviderSnapshot = {
  ...snapshot,
  connections: [{
    ...connection,
    id: 'tokenharbor', providerId: 'custom', name: 'TokenHarbor', endpoint: 'https://tokenharbor.ai/v1',
    accountLabel: null, revision: 5, discoveryState: 'failed', inferenceState: 'failed',
    lastDiscoveryAttemptAt: 1758391200000, error: AUTH_MESSAGE,
    models: [model('tokenharbor/qwen3-max', { name: 'qwen3-max', enabled: false, source: 'custom', capabilities: { streaming: 'unknown', tools: 'unknown', vision: 'unsupported' } })],
  }],
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useProviderStore.setState({ snapshot, error: null, busy: false, loading: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function render() { await act(async () => root.render(<ProviderView initialTab="api" />)) }

const rowFor = (modelId: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Enable ${modelId}"]`)!.parentElement!
const buttonIn = (scope: HTMLElement, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!
const selectProvider = (providerId: string) => host.querySelector<HTMLButtonElement>(`[data-provider-row="${providerId}"]`)!.click()
function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const patches = (fetchMock: ReturnType<typeof vi.fn>, url: string) => fetchMock.mock.calls.filter(call => call[0] === url && (call[1] as RequestInit | undefined)?.method === 'PATCH')

describe('Provider connection card', () => {
  it('keeps the collapsed card compact and hides the edit fields until Edit is pressed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(snapshot)))
    await render()
    expect(host.textContent).toContain('auth ready')
    expect(host.textContent).toContain('models ready')
    expect(host.textContent).toContain('8 models · Data: live · Last sync')
    expect(host.textContent).toContain('7 / 8 active')
    expect(host.textContent).toContain('2 verified ready')
    expect(host.textContent).toContain('gpt-5-mini · 958ms')
    expect(rowFor('th-orchestra').textContent).toContain('th-orchestra')
    expect(host.textContent).toContain('Test inference')
    expect(host.textContent).not.toContain('BOXFOX_OK')
    expect(host.querySelector('input[type="password"]')).toBeNull()
    expect(host.textContent).not.toContain('Replace API key')
    const edit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Edit')!
    expect(edit.getAttribute('aria-expanded')).toBe('false')
    act(() => edit.click())
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('Replace API key')
    expect([...host.querySelectorAll<HTMLInputElement>('input')].some(input => input.value === 'OpenRouter key')).toBe(true)
  })

  it('sends exactly one probe request and leaves the other buttons usable while it runs', async () => {
    let releaseProbe!: (response: Response) => void
    const pendingProbe = new Promise<Response>((resolve) => { releaseProbe = resolve })
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST' && url.endsWith('/models/gpt-5-mini/test')) return pendingProbe
      return json(snapshot)
    })
    vi.stubGlobal('fetch', fetchMock)
    await render()
    act(() => buttonIn(rowFor('gpt-5-mini'), 'Test').click())
    await act(async () => undefined)
    const probeCalls = fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/models/gpt-5-mini/test'))
    expect(probeCalls).toHaveLength(1)
    expect(probeCalls[0][0]).toBe('/api/router/connections/openrouter-key/models/gpt-5-mini/test')
    expect((probeCalls[0][1] as RequestInit).method).toBe('POST')
    expect(buttonIn(rowFor('gpt-5-mini'), 'Testing…').getAttribute('aria-busy')).toBe('true')
    const manage = buttonIn(host, 'Manage models')
    expect(manage.disabled).toBe(false)
    act(() => manage.click())
    expect(host.textContent).toContain('Available Models (OpenRouter key)')
    await act(async () => { releaseProbe(json({ status: 'passed' })) })
  })

  it('shows the router message when the provider refuses the saved key', async () => {
    let state = snapshot
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST' && String(url).endsWith('/models/gpt-5-mini/test')) {
        state = { ...snapshot, connections: [expiredConnection] }
        return json({ error: { code: 'AUTH', message: AUTH_MESSAGE, retryable: false } }, 403)
      }
      return json(state)
    })
    vi.stubGlobal('fetch', fetchMock)
    await render()
    act(() => buttonIn(rowFor('gpt-5-mini'), 'Test').click())
    await act(async () => undefined)
    expect(host.textContent).toContain(AUTH_MESSAGE)
    expect(host.textContent).toContain('Key saved on host; the provider refused it (auth expired).')
    expect(host.textContent).toContain('Refresh models to retry, or replace the key in Edit.')
  })

  it('sends the full enabled id set from a row checkbox and an empty set from Disable all', async () => {
    const fetchMock = vi.fn(async () => json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await render()
    act(() => rowFor('gpt-5-mini').querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => undefined)
    act(() => buttonIn(host, 'Disable all').click())
    await act(async () => undefined)
    const calls = patches(fetchMock, '/api/router/connections/openrouter-key')
    expect(calls).toHaveLength(2)
    expect(JSON.parse(String((calls[0][1] as RequestInit).body))).toEqual({ enabledModelIds: ['gpt-5', 'claude-sonnet-4.5', 'deepseek-v3.2', 'gpt-5-nano', 'gemini-2.5-pro', 'qwen3-max'] })
    expect(JSON.parse(String((calls[1][1] as RequestInit).body))).toEqual({ enabledModelIds: [] })
  })

  it('marks a hand-typed model row with the custom chip and its own probe state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(snapshot)))
    await render()
    const handTyped = rowFor('th-orchestra')
    expect(handTyped.textContent).toContain('custom')
    expect(handTyped.textContent).toContain('Untested')
    expect(handTyped.textContent).toContain('vision unsupported')
    const verifiedRow = rowFor('gpt-5-mini')
    expect(verifiedRow.textContent).toContain('vision')
    expect(verifiedRow.textContent).toContain('958 ms')
    expect(verifiedRow.textContent).not.toContain('Untested')
  })

  // Task 4 of plan A: entering a third-party gateway. A listing failure is a state
  // with its own sentences and its own three ways out, not one red line.
  it('turns a failed custom listing into a structured card with the router message and three ways out', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit = {}) => json(customFailedSnapshot))
    vi.stubGlobal('fetch', fetchMock)
    await render()
    act(() => selectProvider('custom'))
    await act(async () => undefined)

    expect(host.textContent).toContain('Models could not be listed')
    expect(host.textContent).toContain(AUTH_MESSAGE)
    expect(host.textContent).toContain('Last attempt:')
    expect(host.textContent).toContain("Some gateways require a verified account before /models or /chat/completions works. The message above is the provider's own.")
    expect(host.textContent).toContain('1 model(s) added by hand — tested one by one.')

    // `Retry` is the same handler the `Refresh models` button already called.
    act(() => buttonIn(host, 'Retry').click())
    await act(async () => undefined)
    expect(fetchMock.mock.calls.some(call => String(call[0]) === '/api/router/connections/tokenharbor/test' && (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(true)

    // `Add model by hand` opens the manager with the hand-typed form already out.
    act(() => buttonIn(host, 'Add model by hand').click())
    expect(host.querySelector('input[placeholder="e.g. meta-llama/llama-3.3-70b-instruct"]')).toBeTruthy()
    expect(buttonIn(host, 'Add & Test')).toBeTruthy()
  })

  // F3 of the round-17 verification: a passing per-model probe clears `error`,
  // and the ways out of a listing that never worked vanished with it. The state
  // is the gate.
  it('keeps the ways out of a failed listing when a passing probe has cleared the error line', async () => {
    const cleared: ProviderSnapshot = {
      ...customFailedSnapshot,
      connections: customFailedSnapshot.connections.map((entry) => ({ ...entry, revision: 6, error: null })),
    }
    vi.stubGlobal('fetch', vi.fn(async () => json(cleared)))
    await render()
    act(() => selectProvider('custom'))
    await act(async () => undefined)

    expect(host.textContent).toContain('Models could not be listed')
    expect(host.textContent).toContain('The endpoint did not return a model list. Retry, or add each model id by hand.')
    expect(host.textContent).toContain('Last attempt:')
    expect(buttonIn(host, 'Retry')).toBeTruthy()
    expect(buttonIn(host, 'Add model by hand')).toBeTruthy()
    expect(buttonIn(host, 'Edit endpoint & key')).toBeTruthy()
    expect(host.textContent).toContain('1 model(s) added by hand — tested one by one.')
  })

  // F2's UI half: the second failed refresh leaves the list `degraded`, and the
  // sentence that explains the hand-typed rows must survive that state too.
  it('still explains the hand-typed rows when a failed refresh left the list degraded', async () => {
    const degraded: ProviderSnapshot = {
      ...customFailedSnapshot,
      connections: customFailedSnapshot.connections.map((entry) => ({ ...entry, discoveryState: 'degraded' as const })),
    }
    vi.stubGlobal('fetch', vi.fn(async () => json(degraded)))
    await render()
    act(() => selectProvider('custom'))
    await act(async () => undefined)

    expect(host.textContent).toContain('Models could not be listed')
    expect(host.textContent).toContain(AUTH_MESSAGE)
    expect(host.textContent).toContain('1 model(s) added by hand — tested one by one.')
  })

  // Review finding 3: the block used to be gated on `error` as well, so a connection
  // whose models ARE listed announced "Models could not be listed" and offered the
  // listing ways out whenever an unrelated error was set (a credential refresh, a key
  // the provider refuses). Only the state may claim the state.
  it('does not claim a failed model list when the error is not a listing failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...snapshot, connections: [expiredConnection] })))
    useProviderStore.setState({ snapshot: { ...snapshot, connections: [expiredConnection] } })
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain(AUTH_MESSAGE)
    expect(text).not.toContain('Models could not be listed')
    expect(text).not.toContain('Add model by hand')
    expect(text).not.toContain('Last attempt:')
  })

  // Review finding 7: the compacted row prints only the number, so the status word and
  // the reason have to live in the title — after a reload a failed probe was otherwise
  // distinguishable from a passing one by the colour of the text alone.
  it('names the probe status, code and reason in the latency title', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(snapshot)))
    await render()
    const cell = (modelId: string, text: string) => [...rowFor(modelId).querySelectorAll<HTMLSpanElement>('span')].find(span => span.textContent?.trim() === text)!
    expect(cell('gemini-2.5-pro', '398 ms').title).toBe('Failed · failed · HTTP 403 · 398 ms · Provider rejected the probe.')
    expect(cell('gpt-5-mini', '958 ms').title).toBe('Passed · ready · HTTP 200 · 958 ms')
    expect(cell('qwen3-max', 'Untested').title).toBe('Not tested yet — Test probes this model once')
  })

  it('focuses the Base URL from Edit endpoint & key without clearing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(customFailedSnapshot)))
    await render()
    act(() => selectProvider('custom'))
    await act(async () => undefined)
    act(() => buttonIn(host, 'Edit endpoint & key').click())
    await act(async () => undefined)

    const base = [...host.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === 'https://tokenharbor.ai/v1')!
    expect(document.activeElement).toBe(base)
    expect(host.textContent).toContain('Usually ends with /v1. The router calls https://tokenharbor.ai/v1/models and https://tokenharbor.ai/v1/chat/completions.')
  })

  it('derives the endpoint hint from what is being typed in the add form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...customFailedSnapshot, connections: [] })))
    await render()
    act(() => selectProvider('custom'))
    await act(async () => undefined)

    expect(host.textContent).toContain('Usually ends with /v1. The router calls {base}/models and {base}/chat/completions.')
    const endpoint = host.querySelector<HTMLInputElement>('input[placeholder="http://127.0.0.1:8000/v1"]')!
    act(() => setValue(endpoint, 'https://gateway.example.test/v1/'))
    expect(host.textContent).toContain('The router calls https://gateway.example.test/v1/models and https://gateway.example.test/v1/chat/completions.')
  })
})
