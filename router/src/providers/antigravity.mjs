// Antigravity protocol helper/adaptor. Behavior is adapted from the MIT-licensed
// 9router and OmniRoute reference snapshots recorded in router/port-manifest.json.
import { createHash, randomUUID } from 'node:crypto';
import { openAIToGeminiRequest } from '../vendor/9router/openai-to-gemini.mjs';
import { geminiChunkToEvents } from '../vendor/9router/gemini-to-openai.mjs';
import { RouterError } from '../errors.mjs';
import { jsonOrProviderError, modelRecord, parseJson, providerError, sseEvents } from './common.mjs';
import {
  ANTIGRAVITY_MODELS,
  antigravityModelSpec,
  quotaFamilyForModel,
  registryModelsForInventory,
  resolveAntigravityModel,
  unknownProbeCandidates,
} from './antigravity-models.mjs';

const BUILTIN_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || ['1071006060591', '-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'].join('');
const BUILTIN_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || ['GOCSPX-', 'K58FWR486LdL', 'J1mLB8sXC4z6qDAf'].join('');
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo';
const BOOTSTRAP_BASE = 'https://cloudcode-pa.googleapis.com';
const RUNTIME_BASES = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
const DISCOVERY_BASES = [...RUNTIME_BASES, 'https://daily-cloudcode-pa.sandbox.googleapis.com'];
const MAX_RUNTIME_ATTEMPTS_PER_BASE = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_UNKNOWN_MODEL_PROBES = 2;
const IDE_VERSION = process.env.ANTIGRAVITY_IDE_VERSION || '2.11.0';
const IDE_USER_AGENT = `antigravity/ide/${IDE_VERSION} darwin/arm64`;
const IDE_NODE_USER_AGENT = `antigravity/${IDE_VERSION} darwin/arm64 google-api-nodejs-client/10.3.0`;
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];
const NON_CHAT = /(?:^|[-_])(image|imagen|audio|tts|embedding|embed|video|veo)(?:[-_]|$)/i;
const GEMINI_OUTPUT_FLOOR = Object.freeze({ low: 8192, medium: 16384, high: 65535 });

function client() {
  const clientId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() || BUILTIN_CLIENT_ID;
  const clientSecret = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() || (clientId === BUILTIN_CLIENT_ID ? BUILTIN_CLIENT_SECRET : '');
  return { clientId, clientSecret, source: clientId === BUILTIN_CLIENT_ID ? 'embedded_public_client' : 'environment' };
}
function platformEnum() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 2 : 1;
  if (process.platform === 'linux') return process.arch === 'arm64' ? 4 : 3;
  if (process.platform === 'win32') return 5;
  return 0;
}
function metadata() { return { ideType: 9, platform: platformEnum(), pluginType: 2 }; }
function contentHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': IDE_USER_AGENT,
    'X-Client-Name': 'antigravity',
    'X-Client-Version': IDE_VERSION,
  };
}
function oauthHeaders() { return { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': IDE_NODE_USER_AGENT }; }
function projectFrom(value) {
  const raw = value?.cloudaicompanionProject;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw.id === 'string') return raw.id.trim();
  const nested = value?.response?.cloudaicompanionProject;
  if (typeof nested === 'string') return nested.trim();
  if (nested && typeof nested.id === 'string') return nested.id.trim();
  return '';
}
function tierFrom(value) {
  const tiers = Array.isArray(value?.allowedTiers) ? value.allowedTiers : [];
  return tiers.find(t => t?.isDefault && typeof t.id === 'string')?.id?.trim() || 'legacy-tier';
}
function isDiscoverable(id, info) { return Boolean(id && info?.isInternal !== true && !NON_CHAT.test(id)); }
function displayName(id, info) { return info?.displayName || info?.name || id; }
function planLabel(data) {
  if (!data || typeof data !== 'object') return null;
  const raw = String(
    data?.paidTier?.displayName
    || data?.paidTier?.name
    || data?.paidTier?.id
    || data?.subscriptionTier
    || data?.subscriptionType
    || data?.currentTier?.displayName
    || data?.currentTier?.name
    || data?.currentTier?.id
    || tierFrom(data)
    || '',
  ).toUpperCase();
  if (raw.includes('ULTRA')) return 'Ultra';
  if (raw.includes('PRO') || raw.includes('PREMIUM') || raw.includes('GOOGLE_ONE')) return 'Pro';
  if (raw.includes('ENTERPRISE')) return 'Enterprise';
  if (raw.includes('BUSINESS') || raw.includes('STANDARD')) return 'Business';
  if (raw.includes('PLUS')) return 'Plus';
  if (raw.includes('LITE') || raw.includes('LIGHT')) return 'Lite';
  return raw ? 'Free' : null;
}
function quotaBuckets(data) {
  const candidates = [data?.buckets, data?.quotaBuckets, data?.quotas, data?.userQuota?.buckets].find(Array.isArray) || [];
  return candidates.flatMap(bucket => {
    if (!bucket || typeof bucket !== 'object') return [];
    const modelId = String(bucket.modelId || bucket.model || bucket.id || '').trim();
    if (!modelId) return [];
    const fraction = Number(bucket.remainingFraction);
    return [{ modelId, remainingFraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null, resetAt: typeof bucket.resetTime === 'string' ? bucket.resetTime : null, source: 'retrieveUserQuota' }];
  });
}
function weeklyBuckets(data) {
  const groups = Array.isArray(data?.groups) ? data.groups : Array.isArray(data?.quotaSummary?.groups) ? data.quotaSummary.groups : [];
  const result = [];
  for (const group of groups) for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
    const bucketText = `${bucket?.bucketId || ''} ${bucket?.displayName || ''}`.toLowerCase();
    if (!bucketText.includes('weekly') || bucket?.disabled === true) continue;
    const fraction = Number(bucket.remainingFraction);
    const family = /gemini/i.test(group.displayName || '') ? ['gemini_weekly', 'Gemini (Weekly)'] : /claude|gpt/i.test(group.displayName || '') ? ['claude_gpt_weekly', 'Claude & GPT (Weekly)'] : null;
    if (family) result.push({ id: family[0], name: family[1], remainingFraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null, resetAt: typeof bucket.resetTime === 'string' ? bucket.resetTime : null });
  }
  return result;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}

function retryAfterMs(response, message = '') {
  const value = response?.headers?.get?.('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date) && date > Date.now()) return date - Date.now();
  }
  const reset = String(message).match(/reset after\s*(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (!reset) return null;
  const total = Number(reset[1] || 0) * 3_600_000 + Number(reset[2] || 0) * 60_000 + Number(reset[3] || 0) * 1000;
  return total > 0 ? total : null;
}

async function antigravityResponseError(response) {
  const bodyText = await response.clone().text().catch(() => '');
  const body = parseJson(bodyText);
  const raw = [body?.error?.message, body?.message, typeof body?.error === 'string' ? body.error : null, bodyText].filter(Boolean).join('\n');
  const message = raw.slice(0, 2000);
  console.error(`[Antigravity Upstream Error HTTP ${response.status}]`, message);
  const retryMs = retryAfterMs(response, message);
  let error;
  if (response.status === 401 || response.status === 403) error = providerError(response.status);
  else if (/model.{0,40}(?:not found|not supported|unsupported|invalid|unknown|does not exist)|(?:not found|unsupported).{0,40}model/i.test(message)) {
    error = new RouterError('MODEL_NOT_FOUND', 'The provider no longer exposes this model. Refreshing model inventory may resolve it.', 404, true);
  } else if (/policy|safety|blocked|permission denied/i.test(message)) {
    error = new RouterError('POLICY_DENIED', 'The provider rejected this request because of an upstream policy.', 403, false);
  } else if (/capacity|overload|high traffic|temporar(?:y|ily) unavailable/i.test(message)) {
    error = new RouterError('CAPACITY', 'The provider is temporarily at capacity. Retry shortly.', 503, true);
  } else if (/quota|resource[_ ]exhausted|rate.?limit|too many requests|limit.{0,20}exceed|reset after/i.test(message)) {
    error = new RouterError('RATE_LIMIT', 'The provider confirmed that a quota or rate limit was reached.', 429, true);
  } else if (response.status === 429) {
    error = new RouterError('CAPACITY', 'The provider temporarily rejected the request; account quota could not be confirmed.', 503, true);
  } else error = providerError(response.status);
  error.providerStatus = response.status;
  error.retryAfterMs = retryMs;
  return error;
}

function recordForSpec(spec, info = {}, overrides = {}) {
  return {
    ...modelRecord(spec.id, spec.name, spec.capabilities),
    source: overrides.source || 'registry',
    stale: false,
    upstreamModelId: spec.upstreamModelId,
    thinkingLevel: spec.thinkingLevel,
    thinkingLevels: spec.thinkingLevel ? [spec.thinkingLevel] : [],
    quotaFamily: spec.quotaFamily,
    upstreamDisplayName: displayName(overrides.liveId || spec.id, info),
    probeStatus: overrides.probeStatus || 'registry',
    lastProbedAt: overrides.lastProbedAt || null,
  };
}

function applyModelThinking(translated, spec) {
  if (!spec.thinkingLevel) return translated;
  translated.generationConfig ||= {};
  translated.generationConfig.thinkingConfig = { thinkingLevel: spec.thinkingLevel, includeThoughts: true };
  const floor = GEMINI_OUTPUT_FLOOR[spec.thinkingLevel];
  if (floor && (!Number.isFinite(Number(translated.generationConfig.maxOutputTokens)) || Number(translated.generationConfig.maxOutputTokens) < floor)) translated.generationConfig.maxOutputTokens = floor;
  return translated;
}

async function loadCodeAssist(fetchImpl, accessToken, signal) {
  const response = await fetchImpl(`${BOOTSTRAP_BASE}/v1internal:loadCodeAssist`, { method: 'POST', headers: contentHeaders(accessToken), body: JSON.stringify({ metadata: metadata() }), signal });
  if (!response.ok) throw providerError(response.status);
  const data = await response.json();
  return { projectId: projectFrom(data), tierId: tierFrom(data), data };
}

async function onboard(fetchImpl, accessToken, tierId, signal) {
  const body = JSON.stringify({ tier_id: tierId, metadata: metadata() });
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetchImpl(`${BOOTSTRAP_BASE}/v1internal:onboardUser`, { method: 'POST', headers: contentHeaders(accessToken), body, signal });
    if (!response.ok) throw providerError(response.status);
    const data = await response.json().catch(() => ({}));
    const projectId = projectFrom(data);
    if (projectId) return projectId;
    if (data?.done === false && attempt < 4) { await sleep(2000, signal); continue; }
    if (data?.done === false) throw new RouterError('PROJECT_DISCOVERY', 'Could not establish the account project. Retry discovery.', 502, true);
    throw new RouterError('PROJECT_REQUIRED', 'This account requires a Google Cloud project ID. Enter it in Provider.', 409, false);
  }
  throw new RouterError('PROJECT_DISCOVERY', 'Could not establish the account project. Retry discovery.', 502, true);
}

async function ensureProject(fetchImpl, accessToken, suppliedProjectId, signal) {
  if (suppliedProjectId) return suppliedProjectId;
  const first = await loadCodeAssist(fetchImpl, accessToken, signal);
  if (first.projectId) return first.projectId;
  const assigned = await onboard(fetchImpl, accessToken, first.tierId, signal);
  if (assigned) return assigned;
  const second = await loadCodeAssist(fetchImpl, accessToken, signal);
  if (second.projectId) return second.projectId;
  throw new RouterError('PROJECT_DISCOVERY', 'Could not establish the account project. Retry discovery.', 502, true);
}

async function fetchModels(fetchImpl, accessToken, projectId, signal) {
  let last = null;
  for (const base of DISCOVERY_BASES) {
    try {
      const response = await fetchImpl(`${base}/v1internal:fetchAvailableModels`, { method: 'POST', headers: contentHeaders(accessToken), body: JSON.stringify(projectId ? { project: projectId } : {}), signal });
      if (!response.ok) {
        const error = await antigravityResponseError(response);
        if (error.code === 'AUTH' || error.code === 'RATE_LIMIT' || error.retryable === false) throw error;
        last = error;
        continue;
      }
      return await response.json();
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error?.code === 'AUTH' || error?.code === 'RATE_LIMIT' || error?.retryable === false) throw error;
      last = error;
    }
  }
  throw last || new RouterError('UNAVAILABLE', 'Provider is unavailable or returned an invalid response.', 502, true);
}

async function bestEffortRuntime(fetchImpl, action, accessToken, projectId, signal) {
  for (const base of RUNTIME_BASES) {
    try {
      const response = await fetchImpl(`${base}/v1internal:${action}`, { method: 'POST', headers: contentHeaders(accessToken), body: JSON.stringify(projectId ? { project: projectId } : {}), signal });
      if (response.ok) return await response.json();
      if (response.status === 401 || response.status === 403) throw await antigravityResponseError(response);
    } catch (error) {
      if (signal?.aborted || error?.code === 'AUTH') throw error;
    }
  }
  return null;
}

function uuidFromSeed(seed) {
  const bytes = createHash('sha256').update(String(seed)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function requestIdentity(connection, model, contents) {
  const sessionId = `${randomUUID()}${Date.now()}`;
  const conversationId = uuidFromSeed(`antigravity:conversation:${connection.id}:${sessionId}`);
  const trajectoryId = uuidFromSeed(`antigravity:trajectory:${connection.id}:${sessionId}:${model}`);
  const step = Math.max(1, Number(contents?.length || 1) * 2 - 1);
  return { sessionId, requestId: `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}` };
}

export function createAntigravityAdapter({ fetchImpl }) {
  const configured = client();
  const oauthConfig = Object.freeze({
    source: configured.source,
    flowType: 'authorization_code',
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: [...SCOPES],
    redirect: { scheme: 'http', host: 'localhost', defaultPort: 51121, path: '/oauth-callback', loopbackOnly: true },
  });
  const adapter = {
    oauthConfig,
    fallbackModels: ANTIGRAVITY_MODELS.map(model => ({ ...recordForSpec(model), source: 'static', stale: true, enabled: false, probeStatus: 'fallback' })),
    buildAuthUrl({ redirectUri, state }) {
      const redirect = new URL(redirectUri);
      if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirect.hostname) || redirect.pathname !== '/oauth-callback') throw new RouterError('AUTH', 'OAuth redirect must use the BoxFox loopback callback.', 400);
      const params = new URLSearchParams({ client_id: configured.clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES.join(' '), state, access_type: 'offline', prompt: 'consent' });
      return `${AUTHORIZE_URL}?${params}`;
    },
    async exchangeCode({ code, redirectUri, signal }) {
      const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: oauthHeaders(), body: new URLSearchParams({ grant_type: 'authorization_code', client_id: configured.clientId, client_secret: configured.clientSecret, code, redirect_uri: redirectUri }).toString(), signal });
      const tokens = await jsonOrProviderError(response);
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw providerError(401);
      let email = null;
      try {
        const user = await fetchImpl(`${USERINFO_URL}?alt=json`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal });
        if (user.ok) email = (await user.json())?.email || null;
      } catch { /* best effort */ }
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, oauthClient: { clientId: configured.clientId, clientSecret: configured.clientSecret }, email };
    },
    async refresh({ credentials, signal }) {
      if (!credentials.refreshToken) throw new RouterError('AUTH', 'Provider authentication failed. Reconnect or replace the credential.', 401);
      const issuer = credentials.oauthClient;
      if (!issuer?.clientId) throw new RouterError('AUTH', 'Provider authentication failed. Reconnect or replace the credential.', 401);
      const params = { grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: issuer.clientId };
      if (issuer.clientSecret) params.client_secret = issuer.clientSecret;
      const tokens = await jsonOrProviderError(await fetchImpl(TOKEN_URL, { method: 'POST', headers: oauthHeaders(), body: new URLSearchParams(params).toString(), signal }));
      if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw providerError(401);
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
    },
    async discover({ connection, credentials, signal }) {
      const projectId = await ensureProject(fetchImpl, credentials.accessToken, connection.projectId || credentials.projectId, signal);
      const data = await fetchModels(fetchImpl, credentials.accessToken, projectId, signal);
      const entries = data?.models && typeof data.models === 'object' ? Object.entries(data.models) : [];
      const models = registryModelsForInventory(entries).map(({ spec, liveId, info }) => recordForSpec(spec, info, { liveId }));
      const previousProbes = new Map((connection.models || []).filter(model => model.source === 'probe' && (model.probeStatus === 'passed' || model.lastProbe?.status === 'passed')).map(model => [model.id, model]));
      const unknown = unknownProbeCandidates(entries).filter(([id, info]) => isDiscoverable(id, info));
      const pending = [];
      for (const [id, info] of unknown) {
        const previous = previousProbes.get(id);
        if (previous) {
          models.push({ ...previous, name: displayName(id, info), stale: false, source: 'probe', probeStatus: 'passed' });
        } else if (pending.length < MAX_UNKNOWN_MODEL_PROBES) pending.push([id, info]);
      }
      for (const [id, info] of pending) {
        const began = Date.now();
        const probeSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
        try {
          let meaningful = false; let finished = false;
          for await (const event of adapter.generate({
            connection: { ...connection, projectId }, credentials,
            body: { model: id, messages: [{ role: 'user', content: 'Reply exactly: BOXFOX_OK' }], max_tokens: 32, stream: false },
            signal: probeSignal,
          })) {
            if (event.type === 'delta' && (event.delta?.content || event.delta?.tool_calls?.length)) meaningful = true;
            if (event.type === 'finish') finished = true;
          }
          if (meaningful && finished) {
            const spec = resolveAntigravityModel(id);
            models.push({
              ...recordForSpec({ ...spec, name: displayName(id, info) }, info, { source: 'probe', liveId: id, probeStatus: 'passed', lastProbedAt: new Date().toISOString() }),
              lastProbe: { status: 'passed', httpStatus: 200, latencyMs: Date.now() - began, testedAt: new Date().toISOString(), error: null },
            });
          }
        } catch {
          // Unknown models stay diagnostics-only until a later sync proves a
          // complete inference response. Known registry models are unaffected.
        }
      }
      if (!models.length) throw new RouterError('NO_MODELS', 'Provider did not return any eligible models.', 502, true);
      return { models, projectId, projectState: 'ready', inventorySource: 'live', email: credentials.email || undefined, credentials: { projectId } };
    },
    async *generate({ connection, credentials, body, signal }) {
      const projectId = connection.projectId || credentials.projectId;
      if (!projectId) throw new RouterError('PROJECT_REQUIRED', 'This account requires a Google Cloud project ID. Enter it in Provider.', 409);
      const spec = resolveAntigravityModel(body.model);
      const model = spec.upstreamModelId;
      const translated = applyModelThinking(openAIToGeminiRequest(model, body), spec);
      const identity = requestIdentity(connection, model, translated.contents);
      const request = {
        project: projectId, model, userAgent: 'antigravity', requestType: 'agent', requestId: identity.requestId,
        request: { ...translated, sessionId: identity.sessionId, safetySettings: undefined },
      };
      let last = null; let emitted = false;
      for (const base of RUNTIME_BASES) {
        for (let attempt = 0; attempt < MAX_RUNTIME_ATTEMPTS_PER_BASE; attempt++) {
          try {
            // OmniRoute always uses Cloud Code's SSE endpoint, including for JSON callers.
            // Some models reject generateContent after the service injects stream_options;
            // BoxFox collects these provider events into JSON at the ingress boundary.
            const response = await fetchImpl(`${base}/v1internal:streamGenerateContent?alt=sse`, { method: 'POST', headers: { ...contentHeaders(credentials.accessToken), Accept: 'text/event-stream' }, body: JSON.stringify(request), signal });
            if (!response.ok) throw await antigravityResponseError(response);
            const state = { toolIndex: 0, hadToolCall: false };
            let meaningful = false; let finished = false;
            for await (const item of sseEvents(response)) {
              if (!item.data || item.data === '[DONE]') continue;
              const data = parseJson(item.data);
              if (!data) throw providerError(502);
              if (data.error) {
                const status = Number(data.error.code) || 502;
                const message = String(data.error.message || '');
                if (/model.{0,40}(?:not found|not supported|unsupported|invalid|unknown|does not exist)/i.test(message)) throw new RouterError('MODEL_NOT_FOUND', 'The provider no longer exposes this model. Refreshing model inventory may resolve it.', 404, true);
                if (status === 429 && /quota|resource[_ ]exhausted|rate.?limit|limit.{0,20}exceed/i.test(message)) throw new RouterError('RATE_LIMIT', 'The provider confirmed that a quota or rate limit was reached.', 429, true);
                throw providerError(status);
              }
              for (const event of geminiChunkToEvents(data, state)) {
                if (event.type === 'delta' && (event.delta?.content || event.delta?.tool_calls?.length)) { meaningful = true; emitted = true; }
                if (event.type === 'finish') finished = true;
                yield event;
              }
            }
            if (meaningful && finished) return;
            throw new RouterError('UNAVAILABLE', 'Provider returned no complete response.', 502, true);
          } catch (error) {
            if (signal?.aborted) throw signal.reason;
            if (emitted || error?.retryable === false || error?.code === 'AUTH') throw error;
            last = error;
            const transient = ['UNAVAILABLE', 'CAPACITY', 'RATE_LIMIT'].includes(error?.code) || Number(error?.status) >= 500;
            if (!transient || attempt + 1 >= MAX_RUNTIME_ATTEMPTS_PER_BASE) break;
            const delay = Number(error?.retryAfterMs) || Math.min(1000 * (2 ** attempt), 4000);
            if (delay > MAX_RETRY_AFTER_MS) break;
            await sleep(delay, signal);
          }
        }
      }
      throw last || new RouterError('UNAVAILABLE', 'Provider is unavailable or returned an invalid response.', 502, true);
    },
    async quota({ connection, credentials, signal }) {
      const projectId = connection.projectId || credentials.projectId;
      if (!projectId) throw new RouterError('PROJECT_REQUIRED', 'This account requires a Google Cloud project ID. Enter it in Provider.', 409);
      const [data, userQuota, weekly, subscription] = await Promise.all([
        fetchModels(fetchImpl, credentials.accessToken, projectId, signal),
        bestEffortRuntime(fetchImpl, 'retrieveUserQuota', credentials.accessToken, projectId, signal),
        bestEffortRuntime(fetchImpl, 'retrieveUserQuotaSummary', credentials.accessToken, projectId, signal),
        loadCodeAssist(fetchImpl, credentials.accessToken, signal).then(value => value.data).catch(() => null),
      ]);
      const live = new Map(quotaBuckets(userQuota).map(value => [value.modelId, value]));
      const inventory = new Map(Object.entries(data?.models || {}));
      const eligible = (connection.models || []).filter(model => antigravityModelSpec(model.id) || model.source === 'probe');
      const models = [];
      for (const model of eligible) {
        const spec = resolveAntigravityModel(model.id);
        const candidates = [...new Set([model.id, model.upstreamModelId, spec.upstreamModelId, ...spec.liveIds].filter(Boolean))];
        const liveId = candidates.find(id => live.has(id));
        if (liveId) {
          const quota = live.get(liveId);
          models.push({ ...quota, modelId: model.id, upstreamModelId: spec.upstreamModelId, quotaFamily: spec.quotaFamily });
          continue;
        }
        const inventoryId = candidates.find(id => inventory.has(id));
        const quota = inventory.get(inventoryId)?.quotaInfo || {};
        const fraction = typeof quota.remainingFraction === 'number' ? quota.remainingFraction : NaN;
        models.push({
          modelId: model.id,
          upstreamModelId: spec.upstreamModelId,
          quotaFamily: quotaFamilyForModel(model.id),
          remainingFraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null,
          resetAt: typeof quota.resetTime === 'string' ? quota.resetTime : null,
          source: 'fetchAvailableModels',
        });
      }
      return { updatedAt: new Date().toISOString(), plan: planLabel(subscription), models, weekly: weeklyBuckets(weekly), consumption: null };
    },
  };
  return adapter;
}
