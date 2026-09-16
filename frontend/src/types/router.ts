export type SourceKind = 'account' | 'api_provider' | 'cli_adapter' | 'custom_endpoint'
export type ConnectionMethod = 'managed_authorization' | 'credential_reference' | 'explicit_local_endpoint'
export type CapabilityEvidence = 'unknown' | 'reported' | 'verified' | 'unsupported'
export type RouteState = 'draft' | 'login_required' | 'testing' | 'ready_to_confirm' | 'connected' | 'adapter_required' | 'credential_required' | 'unavailable' | 'disconnected'
export type RouterProtocol = 'openai' | 'anthropic' | 'responses' | 'gemini' | 'unknown'

export interface RouterSource {
  id: string
  name: string
  sourceKind: SourceKind
  connectionMethod: ConnectionMethod
  summary: string
  caveat: string
  protocol: RouterProtocol
  adapterAvailable: boolean
}

export interface RouterModel {
  id: string
  name: string
  capabilities: Record<'streaming' | 'tools' | 'vision', CapabilityEvidence>
}

/** Non-secret projection of a future host-owned route. credentialHandle is an opaque mock identifier only. */
export interface UpstreamRoute {
  id: string
  sourceId: string
  sourceKind: SourceKind
  displayName: string
  connectionMethod: ConnectionMethod
  endpoint: string | null
  upstreamSourceId: string | null
  protocol: RouterProtocol
  access: 'only_me'
  credentialHandle: string | null
  accountLabel: string | null
  state: RouteState
  revision: number
  enabledModelIds: string[]
  lastVerificationId: string | null
  models: RouterModel[]
  error: string | null
}

export interface SourceVerification {
  id: string
  routeId: string
  routeRevision: number
  endpoint: string | null
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  auth: 'unknown' | 'ready' | 'login_required' | 'credential_required'
  reachability: 'unknown' | 'reachable' | 'unreachable' | 'not_applicable'
  models: RouterModel[]
  error: null | { code: string; safeMessage: string; retryable: boolean }
  simulated: true
}

export interface DefaultRoute {
  routeId: string | null
  modelId: string | null
  fallback: { enabled: false }
  revision: number
}
