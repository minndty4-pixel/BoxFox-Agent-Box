import { create } from 'zustand'
import type { ConnectionMethod, DefaultRoute, RouterModel, RouterSource, RouteState, SourceVerification, UpstreamRoute } from '../types/router'

const STORAGE_KEY = 'boxfox_router_mock_v2'
const LEGACY_STORAGE_KEY = 'boxfox_router_mock_v1'
const secretQueryKeys = /token|secret|key|password|credential|auth|signature|sig/i
let nextId = 0

export const ROUTER_SOURCES: RouterSource[] = [
  { id: 'antigravity', name: 'Antigravity', sourceKind: 'cli_adapter', connectionMethod: 'explicit_local_endpoint', protocol: 'unknown', adapterAvailable: false, summary: 'Connect through an authorized BoxFox adapter.', caveat: 'Client interception is not supported. An authorized adapter is required.' },
  { id: 'anthropic', name: 'Claude Code / Anthropic', sourceKind: 'account', connectionMethod: 'managed_authorization', protocol: 'anthropic', adapterAvailable: true, summary: 'Authorize a supported Anthropic account path.', caveat: 'Mock only. This does not claim subscription or OAuth support.' },
  { id: 'openai', name: 'Codex / OpenAI', sourceKind: 'account', connectionMethod: 'managed_authorization', protocol: 'responses', adapterAvailable: true, summary: 'Authorize a supported OpenAI account path.', caveat: 'Mock only. BoxFox does not read Codex credentials.' },
  { id: 'google', name: 'Gemini CLI / Google', sourceKind: 'account', connectionMethod: 'managed_authorization', protocol: 'gemini', adapterAvailable: true, summary: 'Authorize a supported Google account path.', caveat: 'Mock only. CLI account state is never imported.' },
  { id: 'cursor', name: 'Cursor', sourceKind: 'cli_adapter', connectionMethod: 'explicit_local_endpoint', protocol: 'unknown', adapterAvailable: false, summary: 'Use an explicitly installed, authorized adapter.', caveat: 'No token-file import, proxy configuration, or interception.' },
  { id: 'kiro', name: 'Kiro', sourceKind: 'cli_adapter', connectionMethod: 'explicit_local_endpoint', protocol: 'unknown', adapterAvailable: false, summary: 'Use an explicitly installed, authorized adapter.', caveat: 'No MITM, certificates, or client traffic interception.' },
  { id: 'copilot', name: 'GitHub Copilot', sourceKind: 'account', connectionMethod: 'managed_authorization', protocol: 'openai', adapterAvailable: true, summary: 'Authorize a supported GitHub account path.', caveat: 'Availability and account entitlement remain unverified in mock mode.' },
  { id: 'qwen', name: 'Qwen', sourceKind: 'api_provider', connectionMethod: 'credential_reference', protocol: 'openai', adapterAvailable: true, summary: 'Use a host-owned credential reference.', caveat: 'The browser stores only an opaque mock handle, never a key.' },
  { id: 'cline', name: 'Cline', sourceKind: 'cli_adapter', connectionMethod: 'explicit_local_endpoint', protocol: 'unknown', adapterAvailable: false, summary: 'Select a real upstream or configured adapter.', caveat: 'Cline is a client, not an inference provider.' },
  { id: 'opencode', name: 'OpenCode', sourceKind: 'cli_adapter', connectionMethod: 'explicit_local_endpoint', protocol: 'unknown', adapterAvailable: false, summary: 'Select a real upstream or configured adapter.', caveat: 'OpenCode is a client, not an inference provider.' },
  { id: 'custom', name: 'Custom endpoint', sourceKind: 'custom_endpoint', connectionMethod: 'explicit_local_endpoint', protocol: 'openai', adapterAvailable: true, summary: 'Test one exact endpoint you control.', caveat: 'No scanning, public tunnel, proxy, or URL credentials.' },
]

const capabilities = (streaming: RouterModel['capabilities']['streaming'] = 'reported'): RouterModel['capabilities'] => ({ streaming, tools: 'unknown', vision: 'unknown' })
const MODEL_FIXTURES: Record<string, RouterModel[]> = {
  anthropic: [{ id: 'claude-sonnet-mock', name: 'Claude Sonnet (reported mock)', capabilities: capabilities() }, { id: 'claude-haiku-mock', name: 'Claude Haiku (reported mock)', capabilities: capabilities() }],
  openai: [{ id: 'gpt-5-codex-mock', name: 'GPT-5 Codex (reported mock)', capabilities: capabilities() }, { id: 'gpt-5-mini-mock', name: 'GPT-5 mini (reported mock)', capabilities: capabilities() }],
  google: [{ id: 'gemini-2.5-pro-mock', name: 'Gemini 2.5 Pro (reported mock)', capabilities: capabilities() }, { id: 'gemini-2.5-flash-mock', name: 'Gemini 2.5 Flash (reported mock)', capabilities: capabilities() }],
  copilot: [{ id: 'copilot-chat-mock', name: 'Copilot Chat (reported mock)', capabilities: capabilities() }, { id: 'copilot-fast-mock', name: 'Copilot Fast (reported mock)', capabilities: capabilities() }],
  qwen: [{ id: 'qwen-max-mock', name: 'Qwen Max (reported mock)', capabilities: capabilities() }, { id: 'qwen-plus-mock', name: 'Qwen Plus (reported mock)', capabilities: capabilities() }],
  custom: [{ id: 'custom-chat-mock', name: 'chat-model (reported mock)', capabilities: capabilities('unknown') }],
}

export function createDefaultRoute(): DefaultRoute {
  return { routeId: null, modelId: null, fallback: { enabled: false }, revision: 0 }
}

function makeId(prefix: string) {
  nextId += 1
  return `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`
}

function modelsFor(sourceId: string) {
  return MODEL_FIXTURES[sourceId]?.map((model) => ({ ...model, capabilities: { ...model.capabilities } })) ?? []
}

function sourceFor(sourceId: string) {
  return ROUTER_SOURCES.find((source) => source.id === sourceId)
}

function isSafeEndpoint(value: string): string | null {
  const endpoint = value.trim()
  if (!endpoint) return 'Enter one exact endpoint URL.'
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { return 'Enter a valid http or https endpoint URL.' }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'Only http and https endpoints are allowed.'
  if (parsed.username || parsed.password) return 'Endpoint URLs cannot include user information.'
  if (parsed.hash) return 'Endpoint URLs cannot include fragments.'
  if ([...parsed.searchParams.keys()].some((key) => secretQueryKeys.test(key))) return 'Endpoint URLs cannot include secret-like query parameters.'
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === '0.0.0.0' || hostname === '::' || hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('169.254.')) return 'Endpoint URLs cannot target unspecified, link-local, or private IPv6 metadata addresses.'
  if (/^169\.254\.169\.254$|^metadata(?:\.google\.internal)?$|^100\.100\.100\.200$/.test(hostname)) return 'Endpoint URLs cannot target metadata services.'
  return null
}

function validRoute(value: unknown): UpstreamRoute | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<UpstreamRoute>
  const source = typeof candidate.sourceId === 'string' ? sourceFor(candidate.sourceId) : undefined
  if (!source || typeof candidate.id !== 'string' || !/^[\w-]{1,120}$/.test(candidate.id)) return null
  if (candidate.endpoint !== null && (typeof candidate.endpoint !== 'string' || isSafeEndpoint(candidate.endpoint))) return null
  const persistedState: RouteState = candidate.state === 'connected' || candidate.state === 'adapter_required' || candidate.state === 'credential_required' || candidate.state === 'unavailable' || candidate.state === 'disconnected' || candidate.state === 'draft' ? candidate.state : 'draft'
  // Verification is intentionally not persisted. A restart returns unfinished routes to a resumable setup state.
  const state = persistedState === 'draft' && source.connectionMethod === 'credential_reference' ? 'credential_required' : persistedState
  const models = modelsFor(source.id)
  const enabledModelIds = state === 'connected' && Array.isArray(candidate.enabledModelIds) ? candidate.enabledModelIds.filter((id): id is string => typeof id === 'string' && models.some((model) => model.id === id)) : []
  return {
    id: candidate.id, sourceId: source.id, sourceKind: source.sourceKind, displayName: typeof candidate.displayName === 'string' && candidate.displayName.trim() ? candidate.displayName.slice(0, 120) : `My ${source.name}`,
    connectionMethod: source.connectionMethod, endpoint: candidate.endpoint ?? null, upstreamSourceId: null, protocol: source.protocol, access: 'only_me',
    credentialHandle: state === 'connected' && typeof candidate.credentialHandle === 'string' && /^mock-handle-[\w-]{1,120}$/.test(candidate.credentialHandle) ? candidate.credentialHandle : null,
    accountLabel: state === 'connected' && typeof candidate.accountLabel === 'string' ? candidate.accountLabel.slice(0, 120) : null,
    state, revision: typeof candidate.revision === 'number' && Number.isSafeInteger(candidate.revision) && candidate.revision > 0 ? candidate.revision : 1,
    enabledModelIds, lastVerificationId: null, models: state === 'connected' || state === 'disconnected' ? models : [], error: typeof candidate.error === 'string' ? candidate.error.slice(0, 300) : null,
  }
}

function readPersisted(): Pick<RouterState, 'routes' | 'defaultRoute'> {
  const empty = { routes: [] as UpstreamRoute[], defaultRoute: createDefaultRoute() }
  if (typeof localStorage === 'undefined') return empty
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) { localStorage.removeItem(LEGACY_STORAGE_KEY); return empty }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return empty
    const routes = Array.isArray((parsed as { routes?: unknown }).routes) ? (parsed as { routes: unknown[] }).routes.map(validRoute).filter((route): route is UpstreamRoute => route !== null) : []
    const savedDefault = (parsed as { defaultRoute?: unknown }).defaultRoute
    const validDefault = savedDefault && typeof savedDefault === 'object' ? savedDefault as Partial<DefaultRoute> : undefined
    const route = routes.find((item) => item.id === validDefault?.routeId && item.state === 'connected' && item.enabledModelIds.includes(validDefault?.modelId ?? ''))
    return { routes, defaultRoute: route ? { routeId: route.id, modelId: validDefault?.modelId ?? null, fallback: { enabled: false }, revision: typeof validDefault?.revision === 'number' ? validDefault.revision : 0 } : createDefaultRoute() }
  } catch { return empty }
}

function persist(state: Pick<RouterState, 'routes' | 'defaultRoute'>) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify({ routes: state.routes, defaultRoute: state.defaultRoute }))
}

function mutate(set: (partial: Partial<RouterState> | ((state: RouterState) => Partial<RouterState>)) => void, updater: (current: RouterState) => Partial<RouterState>) {
  set((current) => {
    const next = updater(current)
    persist({ routes: next.routes ?? current.routes, defaultRoute: next.defaultRoute ?? current.defaultRoute })
    return next
  })
}

interface RouterState {
  sources: RouterSource[]
  routes: UpstreamRoute[]
  defaultRoute: DefaultRoute
  verification: SourceVerification | null
  createOrResumeRoute: (sourceId: string) => string
  updateDraft: (routeId: string, values: { endpoint?: string; displayName?: string }) => boolean
  beginAuthorization: (routeId: string) => void
  completeMockAuthorization: (routeId: string) => void
  completeMockCredentialReference: (routeId: string) => void
  verifyRoute: (routeId: string, endpointConsent: boolean) => void
  completeVerification: (routeId: string, verificationId: string) => void
  enableRoute: (routeId: string, dataUseConsent: boolean, consentRevision: number) => void
  setDefault: (routeId: string, modelId: string) => void
  disconnectRoute: (routeId: string) => void
  removeRoute: (routeId: string) => void
  reset: () => void
}

const initial = readPersisted()

export const useRouterStore = create<RouterState>((set, get) => ({
  sources: ROUTER_SOURCES,
  routes: initial.routes,
  defaultRoute: initial.defaultRoute,
  verification: null,
  createOrResumeRoute: (sourceId) => {
    const source = sourceFor(sourceId)
    if (!source) return ''
    const existing = get().routes.find((route) => route.sourceId === sourceId && !['connected', 'disconnected'].includes(route.state))
    if (existing) return existing.id
    const id = makeId('route')
    const state: RouteState = source.adapterAvailable ? (source.connectionMethod === 'credential_reference' ? 'credential_required' : 'draft') : 'adapter_required'
    const route: UpstreamRoute = { id, sourceId, sourceKind: source.sourceKind, displayName: `My ${source.name}`, connectionMethod: source.connectionMethod, endpoint: null, upstreamSourceId: null, protocol: source.protocol, access: 'only_me', credentialHandle: null, accountLabel: null, state, revision: 1, enabledModelIds: [], lastVerificationId: null, models: [], error: state === 'adapter_required' ? 'An authorized BoxFox adapter is required before this source can route requests.' : null }
    mutate(set, (current) => ({ routes: [...current.routes, route], verification: null }))
    return id
  },
  updateDraft: (routeId, values) => {
    const currentRoute = get().routes.find((route) => route.id === routeId)
    if (!currentRoute) return false
    const endpointError = values.endpoint === undefined ? null : isSafeEndpoint(values.endpoint)
    if (endpointError) {
      mutate(set, (current) => ({ routes: current.routes.map((route) => route.id === routeId ? { ...route, error: endpointError } : route) }))
      return false
    }
    mutate(set, (current) => ({ routes: current.routes.map((route) => route.id === routeId ? { ...route, displayName: values.displayName?.trim() || route.displayName, endpoint: values.endpoint?.trim() ?? route.endpoint, state: 'draft', models: [], enabledModelIds: [], lastVerificationId: null, error: null, revision: route.revision + 1 } : route), verification: null }))
    return true
  },
  beginAuthorization: (routeId) => mutate(set, (current) => ({ routes: current.routes.map((route) => route.id === routeId && route.connectionMethod === 'managed_authorization' ? { ...route, state: 'login_required', error: null, revision: route.revision + 1, models: [], lastVerificationId: null } : route), verification: null })),
  completeMockAuthorization: (routeId) => {
    const route = get().routes.find((item) => item.id === routeId)
    if (!route || route.connectionMethod !== 'managed_authorization' || route.state !== 'login_required') return
    const routeRevision = route.revision + 1
    const verification: SourceVerification = { id: makeId('verify'), routeId, routeRevision, endpoint: null, status: 'passed', auth: 'ready', reachability: 'not_applicable', models: modelsFor(route.sourceId), error: null, simulated: true }
    mutate(set, (current) => ({ verification, routes: current.routes.map((item) => item.id === routeId ? { ...item, state: 'ready_to_confirm', credentialHandle: `mock-handle-account-${routeId}`, accountLabel: 'Authorized mock account', models: verification.models, lastVerificationId: verification.id, revision: routeRevision, error: null } : item) }))
  },
  completeMockCredentialReference: (routeId) => {
    const route = get().routes.find((item) => item.id === routeId)
    if (!route || route.connectionMethod !== 'credential_reference' || route.state !== 'credential_required') return
    const routeRevision = route.revision + 1
    const verification: SourceVerification = { id: makeId('verify'), routeId, routeRevision, endpoint: null, status: 'passed', auth: 'ready', reachability: 'not_applicable', models: modelsFor(route.sourceId), error: null, simulated: true }
    mutate(set, (current) => ({ verification, routes: current.routes.map((item) => item.id === routeId ? { ...item, state: 'ready_to_confirm', credentialHandle: `mock-handle-credential-${routeId}`, accountLabel: 'Host-held mock credential', models: verification.models, lastVerificationId: verification.id, revision: routeRevision, error: null } : item) }))
  },
  verifyRoute: (routeId, endpointConsent) => {
    const route = get().routes.find((item) => item.id === routeId)
    if (!route || route.connectionMethod !== 'explicit_local_endpoint') return
    const endpointError = route.endpoint ? isSafeEndpoint(route.endpoint) : 'Enter one exact endpoint URL.'
    if (!endpointConsent || endpointError) {
      mutate(set, (current) => ({ routes: current.routes.map((item) => item.id === routeId ? { ...item, error: endpointError ?? 'Confirm the exact endpoint before testing.' } : item) }))
      return
    }
    const routeRevision = route.revision + 1
    const verification: SourceVerification = { id: makeId('verify'), routeId, routeRevision, endpoint: route.endpoint, status: 'running', auth: 'unknown', reachability: 'unknown', models: [], error: null, simulated: true }
    mutate(set, (current) => ({ verification, routes: current.routes.map((item) => item.id === routeId ? { ...item, state: 'testing', revision: routeRevision, lastVerificationId: verification.id, models: [], enabledModelIds: [], error: null } : item) }))
    setTimeout(() => get().completeVerification(routeId, verification.id), 0)
  },
  completeVerification: (routeId, verificationId) => {
    const verification = get().verification
    const route = get().routes.find((item) => item.id === routeId)
    if (!verification || !route || verification.id !== verificationId || verification.routeId !== routeId || verification.routeRevision !== route.revision || route.state !== 'testing') return
    const invalid = Boolean(route.endpoint?.includes('fail') || route.endpoint?.includes('invalid'))
    const completed: SourceVerification = { ...verification, status: invalid ? 'failed' : 'passed', auth: invalid ? 'unknown' : 'ready', reachability: invalid ? 'unreachable' : 'reachable', models: invalid ? [] : modelsFor(route.sourceId), error: invalid ? { code: 'ENDPOINT_UNREACHABLE', safeMessage: 'Mock test could not reach this exact endpoint. Check it and retry.', retryable: true } : null }
    mutate(set, (current) => ({ verification: completed, routes: current.routes.map((item) => item.id === routeId ? { ...item, state: invalid ? 'unavailable' : 'ready_to_confirm', models: completed.models, lastVerificationId: completed.id, error: completed.error?.safeMessage ?? null } : item) }))
  },
  enableRoute: (routeId, dataUseConsent, consentRevision) => {
    const route = get().routes.find((item) => item.id === routeId)
    const verification = get().verification
    if (!route || !dataUseConsent || route.state !== 'ready_to_confirm' || route.revision !== consentRevision || route.models.length === 0 || !verification || verification.routeId !== routeId || verification.id !== route.lastVerificationId || verification.routeRevision !== route.revision || verification.status !== 'passed' || verification.auth !== 'ready') return
    mutate(set, (current) => ({ routes: current.routes.map((item) => item.id === routeId ? { ...item, state: 'connected', enabledModelIds: item.models.map((model) => model.id), error: null, revision: item.revision + 1 } : item), verification: null }))
  },
  setDefault: (routeId, modelId) => mutate(set, (current) => {
    const route = current.routes.find((item) => item.id === routeId)
    if (!route || route.state !== 'connected' || !route.enabledModelIds.includes(modelId)) return {}
    return { defaultRoute: { routeId, modelId, fallback: { enabled: false }, revision: current.defaultRoute.revision + 1 } }
  }),
  disconnectRoute: (routeId) => mutate(set, (current) => {
    const routes = current.routes.map((route) => route.id === routeId ? { ...route, state: 'disconnected' as const, enabledModelIds: [], revision: route.revision + 1 } : route)
    return { routes, defaultRoute: current.defaultRoute.routeId === routeId ? { ...createDefaultRoute(), revision: current.defaultRoute.revision + 1 } : current.defaultRoute, verification: current.verification?.routeId === routeId ? null : current.verification }
  }),
  removeRoute: (routeId) => mutate(set, (current) => {
    const routes = current.routes.filter((route) => route.id !== routeId)
    return { routes, defaultRoute: current.defaultRoute.routeId === routeId ? { ...createDefaultRoute(), revision: current.defaultRoute.revision + 1 } : current.defaultRoute, verification: current.verification?.routeId === routeId ? null : current.verification }
  }),
  reset: () => {
    if (typeof localStorage !== 'undefined') { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY) }
    set({ routes: [], defaultRoute: createDefaultRoute(), verification: null })
  },
}))

export function sourceConnectionLabel(method: ConnectionMethod) {
  if (method === 'managed_authorization') return 'Account authorization'
  if (method === 'credential_reference') return 'Credential reference'
  return 'Explicit endpoint'
}
