export type ProviderId = string
export type CapabilityEvidence = 'unknown' | 'reported' | 'verified' | 'unsupported'
export interface ProviderDefinition {
  id: ProviderId
  name: string
  authMethod: 'oauth' | 'api_key'
  icon: string
  protocol: string
  category?: 'oauth' | 'free' | 'api_key'
  discoveryClass?: 'account-live' | 'openai-compat' | 'provider-specific' | 'static-only'
  availability?: 'ready' | 'planned'
  implementationStatus?: 'ready' | 'experimental' | 'planned' | 'unavailable'
  runtimeAvailable?: boolean
  routerVisible?: boolean
  defaultEndpoint?: string
  authHint?: string
  authModes?: Array<'oauth' | 'device' | 'import' | 'api_key' | 'anonymous' | 'service_account'>
  riskNotice?: string
  capabilities?: { chat: boolean; streaming: boolean; tools: CapabilityEvidence; vision: CapabilityEvidence }
}
export interface ProviderModel {
  id: string; name: string; enabled: boolean; source?: 'live' | 'static' | 'registry' | 'probe' | 'custom'; stale?: boolean; thinkingLevels?: string[];
  upstreamModelId?: string; thinkingLevel?: string | null; quotaFamily?: 'gemini' | 'claude_gpt' | null; probeStatus?: 'registry' | 'passed' | 'fallback'; lastProbedAt?: string | null;
  health?: 'unknown' | 'ready' | 'unavailable' | 'rate_limited' | 'slow' | 'failed'
  lastProbe?: { status: 'passed' | 'failed'; httpStatus: number; latencyMs: number; testedAt: string; error: string | null }
  capabilities: Record<'streaming' | 'tools' | 'vision', CapabilityEvidence> & { reasoning?: CapabilityEvidence }
}
export interface ProviderConnection {
  id: string; providerId: ProviderId; name: string; endpoint: string | null; email: string | null; accountLabel: string | null; projectId: string | null;
  revision: number; enabled: boolean; credentialPresent: boolean;
  authState: 'required' | 'ready' | 'expired'; projectState: 'not_applicable' | 'pending' | 'ready' | 'required' | 'failed';
  discoveryState: 'pending' | 'ready' | 'degraded' | 'failed'; inferenceState: 'unknown' | 'ready' | 'failed';
  models: ProviderModel[]; lastTestedAt: string | null; lastModelSyncAt?: string | null; nextModelSyncAt?: string | null; autoSync?: boolean; error: string | null; quota: ProviderQuota | null;
}
export interface ProviderQuota {
  updatedAt: string; plan?: string | null; models: Array<{ modelId: string; upstreamModelId?: string; quotaFamily?: 'gemini' | 'claude_gpt' | null; remainingFraction: number | null; resetAt: string | null; source?: string }>;
  weekly?: Array<{ id: string; name: string; remainingFraction: number | null; resetAt: string | null }>;
  consumption: unknown | null
}
export interface RouteTarget { connectionId: string; modelId: string }
export interface RouterAlias { id: string; name: string; strategy: 'fallback' | 'round_robin'; targets: RouteTarget[]; enabled: boolean; error?: string | null }
export interface ProviderRoutingConfig { id: ProviderId; roundRobin: boolean; connectionOrder: string[] }
export interface ProviderDefault { connectionId: string | null; modelId: string | null; aliasId: string | null }
export interface RouterClientKey { id: string; name: string; prefix: string; allowedModels: string[]; enabled: boolean; createdAt: string; lastUsedAt: string | null }
export interface RouterUsage {
  id: string; requestId: string; connectionId: string | null; modelId: string | null; aliasId: string | null; clientKeyId: string | null;
  status: 'passed' | 'failed' | 'cancelled'; latencyMs: number; inputTokens: number | null; cachedTokens: number | null; cacheCreationTokens: number | null; reasoningTokens: number | null; outputTokens: number | null; totalTokens: number | null; cost: number | null; error: string | null; createdAt: string;
}
export interface ProviderSnapshot { providers: ProviderDefinition[]; connections: ProviderConnection[]; providerConfigs?: ProviderRoutingConfig[]; aliases: RouterAlias[]; defaultRoute: ProviderDefault; keys: RouterClientKey[]; usage: RouterUsage[]; health: { status: 'ok'; version: string } }
export interface OAuthAttempt {
  id: string;
  connectionId: string;
  providerId?: string;
  flowType?: 'authorization_code' | 'device_code';
  status: 'pending' | 'exchanging' | 'completed' | 'failed' | 'cancelled' | 'expired';
  authorizationUrl: string;
  userCode?: string | null;
  verificationUri?: string | null;
  expiresAt: string;
  error: string | null;
}
export interface RouterRequestMeta { requestId: string; connectionId: string; modelId: string; aliasId: string | null }
