import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultRoute, useRouterStore } from './routerStore'

function state() { return useRouterStore.getState() }
function completeTimer() { vi.runAllTimers() }

beforeEach(() => {
  localStorage.clear()
  state().reset()
  vi.useFakeTimers()
})

afterEach(() => vi.useRealTimers())

describe('useRouterStore', () => {
  it('reuses the non-terminal route for a source and persists every setup mutation', () => {
    const id = state().createOrResumeRoute('anthropic')
    expect(state().createOrResumeRoute('anthropic')).toBe(id)
    state().beginAuthorization(id)
    expect(JSON.parse(localStorage.getItem('boxfox_router_mock_v2') ?? '{}').routes[0].state).toBe('login_required')
    state().completeMockAuthorization(id)
    expect(state().routes).toHaveLength(1)
  })

  it('does not enable a route without a current, successful authorization verification and consent', () => {
    const id = state().createOrResumeRoute('anthropic')
    state().beginAuthorization(id)
    state().completeMockAuthorization(id)
    const authorized = state().routes[0]
    expect(state().verification).toMatchObject({ routeId: id, routeRevision: authorized.revision, auth: 'ready', status: 'passed' })
    state().enableRoute(id, false, authorized.revision)
    state().enableRoute(id, true, authorized.revision - 1)
    expect(state().routes[0].state).toBe('ready_to_confirm')
    state().enableRoute(id, true, authorized.revision)
    expect(state().routes[0].state).toBe('connected')
  })

  it('provides per-source model fixtures and a separate credential reference flow', () => {
    const qwen = state().createOrResumeRoute('qwen')
    expect(state().routes[0].state).toBe('credential_required')
    state().completeMockCredentialReference(qwen)
    expect(state().routes[0].models.map((model) => model.id)).toEqual(['qwen-max-mock', 'qwen-plus-mock'])

    const openai = state().createOrResumeRoute('openai')
    state().beginAuthorization(openai)
    state().completeMockAuthorization(openai)
    expect(state().routes.find((route) => route.id === openai)?.models[0].id).toBe('gpt-5-codex-mock')
  })

  it('runs endpoint verification asynchronously and ignores stale results', () => {
    const id = state().createOrResumeRoute('custom')
    expect(state().updateDraft(id, { endpoint: 'http://localhost:3001/v1' })).toBe(true)
    state().verifyRoute(id, true)
    expect(state().routes[0].state).toBe('testing')
    state().updateDraft(id, { endpoint: 'http://localhost:3002/v1' })
    completeTimer()
    expect(state().routes[0].state).toBe('draft')
    expect(state().routes[0].models).toEqual([])
  })

  it.each(['https://user:pass@example.com/v1', 'ftp://example.com/v1', 'https://example.com/v1?api_key=x', 'https://example.com/v1#secret', 'http://169.254.169.254/latest', 'http://[fe80::1]/v1'])('rejects unsafe endpoint %s without persisting it', (endpoint) => {
    const id = state().createOrResumeRoute('custom')
    expect(state().updateDraft(id, { endpoint })).toBe(false)
    expect(state().routes[0].endpoint).toBeNull()
    expect(JSON.stringify(localStorage.getItem('boxfox_router_mock_v2'))).not.toContain(endpoint)
  })

  it('sanitizes invalid persisted JSON and clears defaults when removing routes', () => {
    localStorage.setItem('boxfox_router_mock_v2', JSON.stringify({ routes: [{ id: 'bad', sourceId: 'custom', endpoint: 'https://key@example.com', credentialHandle: 'secret' }], defaultRoute: { routeId: 'bad', modelId: 'x' } }))
    expect(createDefaultRoute()).toMatchObject({ routeId: null, modelId: null })
    expect(state().routes).toEqual([])

    const id = state().createOrResumeRoute('anthropic')
    state().beginAuthorization(id); state().completeMockAuthorization(id)
    const revision = state().routes[0].revision
    state().enableRoute(id, true, revision)
    state().setDefault(id, state().routes[0].models[0].id)
    state().disconnectRoute(id)
    state().removeRoute(id)
    expect(state().defaultRoute).toMatchObject({ routeId: null, modelId: null })
  })
})
