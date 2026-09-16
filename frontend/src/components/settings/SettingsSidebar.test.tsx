import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { SettingsSidebar } from './SettingsSidebar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let roots: Root[] = []

function render() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(<SettingsSidebar />))
  return host
}

beforeEach(() => useUiStore.setState({ isSettingsOpen: true, settingsTab: 'harness', providerInitialTab: 'router' }))
afterEach(() => { roots.forEach((root) => act(() => root.unmount())); roots = []; document.body.innerHTML = '' })

describe('SettingsSidebar', () => {
  it('keeps Back to app available in compact navigation without extra close buttons', () => {
    const host = render()
    const back = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Back to app'))
    expect(back?.parentElement?.className).not.toContain('hidden')
    expect(host.querySelector('[aria-label*="Close"]')).toBeNull()
    act(() => back?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(useUiStore.getState().isSettingsOpen).toBe(false)
  })
  it('opens the unified Provider settings from compact navigation', () => {
    const host = render()
    const aside = host.querySelector('aside')
    const provider = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Provider'))
    expect(aside?.className).toContain('max-h-34')
    expect(host.querySelector('.overflow-x-auto')).toBeTruthy()
    expect(provider).toBeTruthy()
    act(() => provider?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(useUiStore.getState().settingsTab).toBe('provider')
    expect(useUiStore.getState().providerInitialTab).toBe('router')
  })

  it('maps legacy API-key and router tabs into Provider initial tabs', () => {
    act(() => useUiStore.getState().setSettingsTab('llm_api_keys', 'AGENTS'))
    expect(useUiStore.getState().settingsTab).toBe('provider')
    expect(useUiStore.getState().providerInitialTab).toBe('api')

    act(() => useUiStore.getState().setSettingsTab('router', 'AGENTS'))
    expect(useUiStore.getState().settingsTab).toBe('provider')
    expect(useUiStore.getState().providerInitialTab).toBe('router')
  })
})
