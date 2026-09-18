import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderView } from './ProviderView'
import { useProviderStore } from '../../store/providerStore'
import type { ProviderSnapshot } from '../../types/provider'

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
    expect(host.textContent).toContain('OAuth Providers')
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
})
