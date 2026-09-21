import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderView } from './ProviderView'
import { useProviderStore } from '../../store/providerStore'
import type { ProviderConnection, ProviderModel, ProviderSnapshot, RouterUsage } from '../../types/provider'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const snapshot: ProviderSnapshot = {
  providers: [
    { id: 'antigravity', name: 'Antigravity', authMethod: 'oauth', protocol: 'antigravity', icon: '/providers/antigravity.png', category: 'oauth', runtimeAvailable: true, availability: 'ready', routerVisible: true, discoveryClass: 'account-live' },
    { id: 'claude', name: 'Claude Code', authMethod: 'oauth', protocol: 'claude-code', icon: '/providers/claude.png', category: 'oauth', runtimeAvailable: false, availability: 'planned', routerVisible: true, discoveryClass: 'account-live' },
    { id: 'openrouter', name: 'OpenRouter', authMethod: 'api_key', protocol: 'openai', icon: '/providers/openrouter.png', category: 'free', runtimeAvailable: true, availability: 'ready', routerVisible: true, defaultEndpoint: 'https://openrouter.ai/api/v1', discoveryClass: 'openai-compat' },
    { id: 'openai', name: 'OpenAI', authMethod: 'api_key', protocol: 'openai', icon: '/providers/openai.svg' },
    { id: 'anthropic', name: 'Anthropic', authMethod: 'api_key', protocol: 'anthropic', icon: '/providers/anthropic.svg' },
    { id: 'gemini', name: 'Google Gemini', authMethod: 'api_key', protocol: 'gemini', icon: '/providers/gemini.svg' },
    { id: 'custom', name: 'OpenAI-compatible', authMethod: 'api_key', protocol: 'openai', icon: '/providers/custom.svg' },
  ], connections: [], aliases: [], keys: [], usage: [], defaultRoute: { connectionId: null, modelId: null, aliasId: null }, health: { status: 'ok', version: 'test' },
}
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useProviderStore.setState({ snapshot, error: null, busy: false, loading: false })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(tab: 'api' | 'router') { await act(async () => root.render(<ProviderView initialTab={tab} />)) }

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function model(id: string, over: Partial<ProviderModel> = {}): ProviderModel {
  return { id, name: id, enabled: true, capabilities: { streaming: 'reported', tools: 'reported', vision: 'unknown' }, ...over }
}

function connection(over: Partial<ProviderConnection> & { id: string; providerId: string; name: string }): ProviderConnection {
  return {
    endpoint: null, email: null, accountLabel: null, projectId: null, revision: 1, enabled: true, credentialPresent: true,
    authState: 'ready', projectState: 'not_applicable', discoveryState: 'ready', inferenceState: 'unknown',
    lastTestedAt: null, error: null, quota: null, models: [], ...over,
  }
}

const twoProviderSnapshot: ProviderSnapshot = {
  ...snapshot,
  connections: [
    connection({ id: 'openrouter-key', providerId: 'openrouter', name: 'OpenRouter key', models: [model('a'), model('b'), model('c')] }),
    connection({ id: 'openai-key', providerId: 'openai', name: 'OpenAI key', models: [model('d')] }),
  ],
}

const railRows = () => [...document.querySelectorAll<HTMLButtonElement>('[data-provider-row]')]
const selectedRows = () => railRows().filter((row) => row.getAttribute('aria-current') === 'true').map((row) => row.getAttribute('data-provider-row'))

function usageRow(over: Partial<RouterUsage> & { id: string }): RouterUsage {
  return {
    requestId: `req-${over.id}`, connectionId: null, modelId: null, aliasId: null, clientKeyId: null, status: 'passed', latencyMs: 120,
    inputTokens: null, cachedTokens: null, cacheCreationTokens: null, reasoningTokens: null, outputTokens: null, totalTokens: null,
    cost: null, error: null, createdAt: '2026-09-20T02:00:00.000Z', ...over,
  }
}

// One row per provenance, plus the two nulls that must stay distinguishable.
const costSnapshot: ProviderSnapshot = {
  ...snapshot,
  providers: [...snapshot.providers, { id: 'deepseek', name: 'DeepSeek', authMethod: 'api_key', protocol: 'openai', icon: '/providers/deepseek.svg' }],
  connections: [
    connection({ id: 'deepseek-connection', providerId: 'deepseek', name: 'DeepSeek', costMode: 'metered', models: [model('deepseek-flash')] }),
    connection({ id: 'antigravity-connection', providerId: 'antigravity', name: 'Antigravity account', costMode: 'included', models: [model('gemini-3.8-flash-high')] }),
  ],
  usage: [
    usageRow({ id: 'documented', connectionId: 'deepseek-connection', modelId: 'deepseek-flash', cost: 0.000079, costBasis: 'documented', estimated: true, inputTokens: 11965, cachedTokens: 11776, outputTokens: 25, createdAt: '2026-09-20T11:00:00.000Z' }),
    usageRow({ id: 'peak', connectionId: 'deepseek-connection', modelId: 'deepseek-flash', cost: 0.00021, costBasis: 'documented', estimated: true, createdAt: '2026-09-18T02:30:00.000Z' }),
    usageRow({ id: 'reported', connectionId: 'openrouter', modelId: '~deepseek/deepseek-pro-latest', cost: 0.00624294528, costBasis: 'reported', estimated: false, createdAt: '2026-09-20T15:01:57.574Z' }),
    usageRow({ id: 'unpriced', connectionId: 'deepseek-connection', modelId: 'deepseek-v4-pro', createdAt: '2026-09-20T12:30:00.000Z' }),
    usageRow({ id: 'included', connectionId: 'antigravity-connection', modelId: 'gemini-3.8-flash-high', createdAt: '2026-09-20T12:31:00.000Z' }),
    usageRow({ id: 'free', connectionId: 'deepseek-connection', modelId: 'deepseek-flash', cost: 0, costBasis: 'reported', estimated: false, createdAt: '2026-09-20T12:32:00.000Z' }),
  ],
}

/** The Cost cell of the usage row carrying `requestId`. */
function costCell(requestId: string) {
  const row = [...host.querySelectorAll('tr')].find((candidate) => candidate.textContent?.includes(requestId))!
  return [...row.querySelectorAll('td')][7]
}

/** The title of that cell — how BoxFox explains where the number came from. */
function costTitle(requestId: string) {
  return costCell(requestId).querySelector('[title]')?.getAttribute('title') ?? null
}

async function renderUsage() {
  useProviderStore.setState({ snapshot: costSnapshot, error: null, busy: false, loading: false })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(costSnapshot), { headers: { 'content-type': 'application/json' } })))
  await render('router')
  const usage = [...host.querySelectorAll('button')].find(button => button.textContent === 'Usage & Analytics')!
  act(() => usage.click())
}

describe('Provider UI', () => {
  it('shows all API adapters with local icons and no redundant close button', async () => {
    await render('api')
    expect([...host.querySelectorAll('img')].map(image => image.alt)).toEqual(['OpenRouter icon', 'OpenAI icon', 'Anthropic icon', 'Google Gemini icon', 'OpenAI-compatible icon'])
    expect(host.querySelector('[aria-label*="Close"]')).toBeNull()
    expect(host.textContent).toContain('Router engine ok')
    expect(host.textContent).toContain('No API connection configured yet.')
  })
  it('switches top-level tabs with arrow keys and binds the active tabpanel', async () => {
    await render('api')
    const apiTab = host.querySelector<HTMLButtonElement>('#provider-tab-api')!
    act(() => apiTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(host.querySelector('#provider-tab-router')?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('provider-tab-router')
    expect(host.textContent).toContain('Router providers')
  })
  it('provides common router management and an OpenAI-compatible endpoint example', async () => {
    await render('router')
    const access = [...host.querySelectorAll('button')].find(button => button.textContent === 'API Access')!
    act(() => access.click())
    expect(host.textContent).toContain('BoxFox endpoint')
    expect(host.textContent).toContain('/v1/chat/completions')
    expect(host.textContent).toContain('YOUR_BOXFOX_KEY')
    expect(host.textContent).toContain('No client keys created.')
  })
  it('shows the router provider catalog and honest empty model inventory before login', async () => {
    await render('router')
    expect(host.textContent).toContain('OAuth accounts')
    expect(host.textContent).toContain('No connections')
    const antigravity = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Antigravity'))!
    act(() => antigravity.click())
    expect(host.textContent).toContain('Connections & models')
    expect(host.textContent).toContain('Add account')
    const back = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Back to providers'))!
    act(() => back.click())
    expect(host.textContent).toContain('Claude Code')
    const models = [...host.querySelectorAll('button')].find(button => button.textContent === 'Models')!
    act(() => models.click())
    expect(host.textContent).toContain('Available models')
    expect(host.textContent).toContain('Provider sources')
    expect(host.textContent).toContain('No live models yet.')
  })
  it('shows token analytics with unknown values until a provider reports usage', async () => {
    await render('router')
    const usage = [...host.querySelectorAll('button')].find(button => button.textContent === 'Usage & Analytics')!
    act(() => usage.click())
    expect(host.textContent).toContain('Usage & analytics')
    expect(host.textContent).toContain('Input tokens')
    expect(host.textContent).toContain('Token composition')
    expect(host.textContent).toContain('No data')
  })
  it('lists every API provider in a rail whose group headings carry a count and a single current row', async () => {
    await render('api')
    expect(railRows().map(row => row.getAttribute('data-provider-row'))).toEqual(['openrouter', 'openai', 'anthropic', 'gemini', 'custom'])
    expect(selectedRows()).toEqual(['openrouter'])
    const headings = [...host.querySelectorAll<HTMLButtonElement>('button[aria-controls]')].filter(button => /Free Tier|API keys/.test(button.textContent ?? ''))
    expect(headings).toHaveLength(2)
    expect(headings[0].textContent).toContain('Free Tier')
    expect(headings[0].textContent).toContain('1')
    expect(headings[1].textContent).toContain('API keys')
    expect(headings[1].textContent).toContain('4')
    expect(railRows()[0].textContent).toContain('0 models')
    expect(railRows()[0].textContent).toContain('No connection · needs key')
  })
  it('narrows the rail to the searched provider and follows the selection in the pane header', async () => {
    await render('api')
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search providers"]')!
    await act(async () => { setValue(search, 'zzz') })
    expect(host.textContent).toContain('No provider matches "zzz".')
    await act(async () => { setValue(search, 'gemini') })
    expect(railRows().map(row => row.getAttribute('data-provider-row'))).toEqual(['gemini'])
    expect(host.querySelector('h2')!.textContent).toBe('OpenRouter')
    act(() => railRows()[0].click())
    expect(host.querySelector('h2')!.textContent).toBe('Google Gemini')
    expect(selectedRows()).toEqual(['gemini'])
  })
  it('shows only the selected provider connections and marks the other provider row with its own counts', async () => {
    useProviderStore.setState({ snapshot: twoProviderSnapshot, error: null, busy: false, loading: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(twoProviderSnapshot), { headers: { 'content-type': 'application/json' } })))
    await render('api')
    expect(host.querySelector('[data-provider-row="openrouter"]')!.textContent).toContain('3 models')
    expect(host.querySelector('[data-provider-row="openai"]')!.textContent).toContain('1 connection ready')
    expect(host.textContent).toContain('2 connected')
    expect(host.textContent).toContain('OpenRouter key')
    expect(host.textContent).not.toContain('OpenAI key')
    act(() => host.querySelector<HTMLButtonElement>('[data-provider-row="openai"]')!.click())
    expect(host.textContent).toContain('OpenAI key')
    expect(host.textContent).not.toContain('OpenRouter key')
  })
  it('moves the current provider row with ArrowDown', async () => {
    await render('api')
    act(() => railRows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    expect(selectedRows()).toEqual(['openai'])
    act(() => railRows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(selectedRows()).toEqual(['custom'])
  })
  it('caps a group at four rows behind a disclosure that shows the rest and folds back', async () => {
    const wide: ProviderSnapshot = {
      ...snapshot,
      providers: [
        ...snapshot.providers.filter(provider => provider.authMethod !== 'api_key'),
        ...['openrouter', 'openai', 'anthropic', 'gemini', 'custom', 'groq', 'mistral'].map((id, index) => ({
          id, name: id, authMethod: 'api_key' as const, protocol: 'openai' as const, icon: `/providers/${id}.svg`, ...(index === 0 ? { category: 'free' as const } : {}),
        })),
      ],
    }
    useProviderStore.setState({ snapshot: wide, error: null, busy: false, loading: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(wide), { headers: { 'content-type': 'application/json' } })))
    await render('api')
    expect(railRows()).toHaveLength(5)
    const more = [...host.querySelectorAll<HTMLButtonElement>('button[aria-controls]')].find(button => button.textContent?.includes('Show 2 more API keys'))!
    expect(more.getAttribute('aria-expanded')).toBe('false')
    act(() => more.click())
    expect(railRows()).toHaveLength(7)
    const fewer = [...host.querySelectorAll<HTMLButtonElement>('button[aria-controls]')].find(button => button.textContent?.includes('Show fewer API keys'))!
    expect(fewer.getAttribute('aria-expanded')).toBe('true')
    act(() => fewer.click())
    expect(railRows()).toHaveLength(5)
  })
  it('lists the router providers in the same rail, marks the selection and counts each group', async () => {
    await render('router')
    expect(railRows().map(row => row.getAttribute('data-provider-row'))).toEqual(['antigravity', 'claude', 'openrouter'])
    expect(selectedRows()).toEqual([])
    const headings = [...host.querySelectorAll<HTMLButtonElement>('button[aria-controls]')].filter(button => /OAuth accounts|Free Tier/.test(button.textContent ?? ''))
    expect(headings).toHaveLength(2)
    expect(headings[0].textContent).toContain('OAuth accounts')
    expect(headings[0].textContent).toContain('2')
    expect(headings[1].textContent).toContain('Free Tier')
    expect(headings[1].textContent).toContain('1')
    expect(host.querySelector('[data-provider-rail]')!.textContent).toContain('No connections')
    expect(host.textContent).toContain('Pick one on the left')
    expect(host.textContent).toContain('API-key providers remain available in the API tab.')
    act(() => host.querySelector<HTMLButtonElement>('[data-provider-row="claude"]')!.click())
    expect(selectedRows()).toEqual(['claude'])
    expect(host.textContent).toContain('Connections & models')
    act(() => host.querySelector<HTMLButtonElement>('[data-provider-row="openrouter"]')!.click())
    expect(selectedRows()).toEqual(['openrouter'])
    expect(host.textContent).toContain('Free Tier · discovery: openai-compat')
    expect(host.textContent).toContain('Add connection')
  })
  it('labels every cost cell with its provenance and says when no price is known', async () => {
    await renderUsage()
    const documented = costCell('req-documented')
    expect(documented.textContent).toContain('<$0.0001')
    expect(documented.textContent).toContain('est.')
    // The published peak window excludes Chinese public holidays and that calendar is
    // not shipped, so the tooltip that names the source also names the caveat.
    expect(costTitle('req-documented')).toContain('Estimated from the documented DeepSeek price (off-peak at 11:00 UTC)')
    expect(costTitle('req-documented')).toContain('Chinese public holidays are excluded from the published peak window')
    const peak = costCell('req-peak')
    expect(peak.textContent).toContain('$0.0002')
    expect(peak.textContent).toContain('est.')
    expect(costTitle('req-peak')).toContain('Estimated from the documented DeepSeek price (peak)')
    expect(costTitle('req-peak')).toContain('estimate up to 2× high')
    const reported = costCell('req-reported')
    expect(reported.textContent).toBe('$0.0062')
    expect(costTitle('req-reported')).toBe('Reported by the provider')
    const free = costCell('req-free')
    expect(free.textContent).toBe('$0')
    expect(costTitle('req-free')).toBe('Reported by the provider')
    expect(costCell('req-unpriced').textContent).toBe('No price')
    expect(costTitle('req-unpriced')).toBe('Set a price for this model in Providers → Manage models')
    expect(costCell('req-included').textContent).toBe('Included in plan')
    expect(costTitle('req-included')).toContain('subscription')
    expect(host.textContent).toContain('Reported 2 · Estimated 2 · No price 1 · Included 1')
    expect(host.textContent).toContain('Includes estimates')
    expect(host.textContent).toContain('$0.0065')
  })
  it('counts the models that carry a price on the connection card', async () => {
    const priced: ProviderSnapshot = {
      ...snapshot,
      providers: [{ id: 'deepseek', name: 'DeepSeek', authMethod: 'api_key', protocol: 'openai', icon: '/providers/deepseek.svg' }, ...snapshot.providers],
      connections: [
        connection({
          id: 'deepseek-connection', providerId: 'deepseek', name: 'DeepSeek',
          models: [
            model('deepseek-flash', { pricing: { currency: 'USD', unit: 'per_million_tokens', input: 0.28, cachedInput: null, output: 0.42, source: 'ping' } }),
            model('deepseek-v4-pro'),
          ],
        }),
      ],
    }
    useProviderStore.setState({ snapshot: priced, error: null, busy: false, loading: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(priced), { headers: { 'content-type': 'application/json' } })))
    await render('api')
    expect(selectedRows()).toEqual(['deepseek'])
    const chip = [...host.querySelectorAll('span')].find(span => span.textContent?.startsWith('Prices'))!
    expect(chip.textContent).toBe('Prices 1 / 2 models')
    expect(chip.getAttribute('title')).toContain('Manage models sets the rest.')
  })
})
