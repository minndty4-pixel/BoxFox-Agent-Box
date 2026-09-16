import { randomUUID } from 'node:crypto';
import { RouterError, assert, safeError } from './errors.mjs';
import { validateEndpoint } from './network.mjs';
import { PROVIDER_CATALOG, PROVIDER_ENDPOINTS } from './catalog.mjs';
import { isAntigravityModelValid } from './providers/antigravity-models.mjs';
export { PROVIDER_CATALOG };
function label(value, fallback) {
  assert(value === undefined || typeof value === 'string', 'Name must be text.');
  const text = (value ?? fallback).trim();
  assert(text.length > 0 && text.length <= 120, 'Name must be 1–120 characters.');
  return text;
}
function secret(value) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= 32768, 'Enter a valid API key.'); return value.trim(); }
function projectId(value) {
  if (value === null || value === '') return null;
  assert(typeof value === 'string' && /^[a-z][a-z0-9-]{4,62}$/.test(value), 'Enter a valid Google Cloud project ID.');
  return value;
}
function probeHealth(error) {
  const safe = safeError(error);
  if (safe.code === 'MODEL_NOT_FOUND' || safe.status === 404) return 'unavailable';
  if (safe.code === 'RATE_LIMIT' || safe.status === 429) return 'rate_limited';
  if (safe.code === 'TIMEOUT' || safe.code === 'CAPACITY' || safe.status === 504) return 'slow';
  return 'failed';
}

export class ProviderService {
  constructor({ store, providers }) {
    this.store = store;
    this.providers = providers;
    this.refreshes = new Map();
    this.discoveries = new Map();
    this.active = new Map();
    this.sanitizeAllConnections();
  }
  sanitizeConnection(c) {
    if (!c || c.providerId !== 'antigravity') return c;
    let modified = false;
    if (Array.isArray(c.models)) {
      const originalCount = c.models.length;
      c.models = c.models.filter(m => isAntigravityModelValid(m.id));
      if (c.models.length !== originalCount) modified = true;
    }
    if (c.quota && Array.isArray(c.quota.models)) {
      const originalQuotaCount = c.quota.models.length;
      c.quota.models = c.quota.models.filter(m => isAntigravityModelValid(m.modelId));
      if (c.quota.models.length !== originalQuotaCount) modified = true;
    }
    if (modified) {
      this.store.put('connection', c);
    }
    return c;
  }
  sanitizeAllConnections() {
    try {
      const list = this.store.list('connection');
      for (const c of list) {
        this.sanitizeConnection(c);
      }
    } catch { /* best effort on startup */ }
  }
  connection(id) { const c = this.store.get('connection', id); assert(c, 'Connection not found.', 'NOT_FOUND', 404); return c; }
  provider(id) { const provider = PROVIDER_CATALOG.find(value => value.id === id); assert(provider, 'Provider not found.', 'NOT_FOUND', 404); return { ...provider, connections: this.store.list('connection').filter(value => value.providerId === id) }; }
  snapshot() {
    return { providers: PROVIDER_CATALOG, connections: this.store.list('connection'), providerConfigs: this.store.list('provider_config'), aliases: this.store.list('alias'), defaultRoute: this.store.getDefault(), keys: this.store.list('key').map(k => this.store.publicKey(k)), usage: this.store.list('usage').slice(0, 200), health: { status: 'ok', version: '0.1.0' } };
  }
  providerConfig(id) {
    this.provider(id);
    return this.store.get('provider_config', id) || { id, roundRobin: false, connectionOrder: [] };
  }
  setProviderConfig(id, values) {
    const current = this.providerConfig(id);
    const connections = this.store.list('connection').filter(connection => connection.providerId === id);
    const connectionIds = new Set(connections.map(connection => connection.id));
    const roundRobin = values.roundRobin ?? current.roundRobin;
    assert(typeof roundRobin === 'boolean', 'Round robin must be boolean.');
    const requested = values.connectionOrder ?? current.connectionOrder;
    assert(Array.isArray(requested) && requested.every(value => typeof value === 'string' && connectionIds.has(value)) && new Set(requested).size === requested.length, 'Connection order contains an invalid account.');
    const connectionOrder = [...requested, ...connections.map(connection => connection.id).filter(value => !requested.includes(value))];
    return this.store.put('provider_config', { id, roundRobin, connectionOrder });
  }
  create(values) {
    const provider = PROVIDER_CATALOG.find(p => p.id === values.providerId);
    assert(provider && this.providers[provider.id], 'Unsupported provider.');
    assert(provider.runtimeAvailable && this.providers[provider.id], `The ${provider.name} adapter is not integrated yet.`, 'ADAPTER_REQUIRED', 501);
    const isOAuth = provider.authMethod === 'oauth' || ['antigravity', 'agy', 'codex', 'claude', 'github', 'cline'].includes(provider.id);
    const isAnonymous = provider.id === 'opencode' || provider.authModes?.includes('anonymous');
    const endpoint = (isOAuth || isAnonymous)
      ? (values.endpoint ? validateEndpoint(values.endpoint) : (PROVIDER_ENDPOINTS[provider.id] || null))
      : validateEndpoint(values.endpoint || PROVIDER_ENDPOINTS[provider.id] || '');
    let credential = null;
    if (values.apiKey !== undefined && values.apiKey.trim()) credential = { apiKey: secret(values.apiKey) };
    else if (values.accessToken || values.token) credential = { accessToken: secret(values.accessToken || values.token), refreshToken: values.refreshToken ? secret(values.refreshToken) : null };
    assert(isOAuth || isAnonymous || credential, 'An API key is required.');
    const fallback = this.providers[provider.id]?.fallbackModels || [];
    const c = {
      id: randomUUID(), providerId: provider.id, name: label(values.name, provider.name), endpoint, email: null, accountLabel: null,
      projectId: values.projectId ? projectId(values.projectId) : null, revision: 1, enabled: true, credentialPresent: Boolean(credential) || isAnonymous,
      authState: (credential || isAnonymous) ? 'ready' : 'required', projectState: provider.id === 'antigravity' ? 'pending' : 'not_applicable',
      discoveryState: (credential || isAnonymous) ? 'ready' : 'pending', inferenceState: 'unknown',
      models: fallback.map(m => ({ ...m, enabled: true, source: 'static' })),
      lastTestedAt: null, lastModelSyncAt: null, nextModelSyncAt: null,
      autoSync: provider.discoveryClass !== 'static-only', error: null, quota: null,
    };
    if (credential) this.store.saveCredentials(c.id, credential);
    this.store.put('connection', c);
    this.setProviderConfig(provider.id, { connectionOrder: [...this.providerConfig(provider.id).connectionOrder, c.id] });
    return c;
  }
  patch(id, values) {
    const c = this.connection(id);
    const invalidates = values.apiKey !== undefined || values.endpoint !== undefined || values.projectId !== undefined || values.accessToken !== undefined || values.token !== undefined;
    if (values.name !== undefined) c.name = label(values.name, c.name);
    if (values.endpoint !== undefined) { assert(!['antigravity', 'agy', 'codex', 'claude', 'github', 'cline', 'opencode'].includes(c.providerId), 'Managed endpoints cannot be overwritten.'); c.endpoint = validateEndpoint(values.endpoint); }
    if (values.projectId !== undefined) c.projectId = projectId(values.projectId);
    if (values.enabled !== undefined) { assert(typeof values.enabled === 'boolean', 'Enabled must be boolean.'); c.enabled = values.enabled; }
    if (values.autoSync !== undefined) { assert(typeof values.autoSync === 'boolean', 'Auto sync must be boolean.'); c.autoSync = values.autoSync; }
    if (values.customModel && typeof values.customModel.id === 'string') {
      const modelId = values.customModel.id.trim();
      if (modelId) {
        const existing = c.models.find(m => m.id === modelId);
        if (existing) {
          existing.enabled = true;
          if (values.customModel.name) existing.name = values.customModel.name.trim();
        } else {
          c.models.push({
            id: modelId,
            name: values.customModel.name?.trim() || modelId,
            source: 'custom',
            stale: false,
            enabled: true,
            capabilities: {
              streaming: 'reported',
              tools: 'unknown',
              vision: values.customModel.capabilities?.vision ? 'supported' : 'unknown',
              reasoning: values.customModel.capabilities?.reasoning ? 'supported' : 'unknown',
            },
            thinkingLevels: values.customModel.capabilities?.reasoning ? ['auto', 'low', 'medium', 'high'] : [],
          });
        }
      }
    }
    if (values.enabledModelIds !== undefined) {
      assert(Array.isArray(values.enabledModelIds) && values.enabledModelIds.every(id => typeof id === 'string' && c.models.some(m => m.id === id)), 'Select only models discovered for this connection.');
      c.models = c.models.map(m => ({ ...m, enabled: values.enabledModelIds.includes(m.id) }));
    }
    if (values.apiKey !== undefined || values.accessToken !== undefined || values.token !== undefined) {
      assert(c.providerId !== 'antigravity', 'Use account authorization for Antigravity.');
      const val = (values.apiKey ?? values.accessToken ?? values.token)?.trim();
      if (val) {
        this.store.saveCredentials(id, {
          apiKey: secret(val),
          accessToken: secret(val),
          ...(values.refreshToken ? { refreshToken: secret(values.refreshToken) } : {}),
        });
        c.credentialPresent = true; c.authState = 'ready';
      }
    }
    if (values.projectId !== undefined) {
      const credential = this.store.credentials(id);
      if (credential) this.store.saveCredentials(id, { ...credential, projectId: c.projectId });
    }
    if (invalidates) {
      const fallback = this.providers[c.providerId]?.fallbackModels || [];
      c.revision++; c.models = fallback.map(m => ({ ...m, enabled: true, source: 'static' })); c.discoveryState = 'ready'; c.inferenceState = 'unknown'; c.lastTestedAt = null; c.error = null; c.quota = null;
      if (c.providerId === 'antigravity') c.projectState = c.projectId ? 'ready' : 'pending';
      this.cancelConnection(id);
    }
    if (!c.enabled) this.cancelConnection(id);
    this.store.put('connection', c);
    this.repairDefault();
    return c;
  }
  remove(id) {
    const removed = this.connection(id); this.cancelConnection(id); this.store.removeCredentials(id); this.store.delete('connection', id);
    const config = this.providerConfig(removed.providerId); this.setProviderConfig(removed.providerId, { connectionOrder: config.connectionOrder.filter(value => value !== id) });
    for (const alias of this.store.list('alias')) {
      alias.targets = alias.targets.filter(t => t.connectionId !== id);
      if (!alias.targets.length) alias.enabled = false;
      this.store.put('alias', alias);
    }
    this.repairDefault();
  }
  cancelConnection(id) { for (const run of this.active.values()) if (run.connectionId === id) run.controller.abort(new DOMException('Cancelled', 'AbortError')); }
  async credentials(id, signal) {
    const c = this.connection(id);
    let credentials = this.store.credentials(id);
    assert(credentials, 'Connect an account or configure an API key first.', 'AUTH', 401);
    if (c.providerId === 'antigravity' && Number(credentials.expiresAt) <= Date.now() + 300000) {
      if (!this.refreshes.has(id)) {
        const revision = c.revision;
        const promise = this.providers.antigravity.refresh({ credentials, signal: AbortSignal.timeout(20000) }).then(refreshed => {
          const current = this.store.get('connection', id);
          assert(current && current.revision === revision, 'Credential configuration changed during refresh.', 'STALE_RESULT', 409);
          const merged = { ...credentials, ...refreshed, refreshToken: refreshed.refreshToken || credentials.refreshToken, oauthClient: credentials.oauthClient };
          this.store.saveCredentials(id, merged); current.authState = 'ready'; this.store.put('connection', current); return merged;
        }).catch(error => {
          const current = this.store.get('connection', id);
          if (current && current.revision === revision) {
            const safe = safeError(error);
            if (safe.code === 'AUTH') current.authState = 'expired';
            current.error = safe.message; this.store.put('connection', current);
          }
          throw error;
        }).finally(() => this.refreshes.delete(id));
        this.refreshes.set(id, promise);
      }
      credentials = await this.refreshes.get(id);
      signal?.throwIfAborted();
    }
    return { ...credentials, ...(c.projectId ? { projectId: c.projectId } : {}) };
  }
  async discover(id, signal = AbortSignal.timeout(60000)) {
    if (this.discoveries.has(id)) return this.discoveries.get(id);
    const promise = this.#discover(id, signal).finally(() => this.discoveries.delete(id));
    this.discoveries.set(id, promise);
    return promise;
  }
  async #discover(id, signal) {
    const initial = this.connection(id);
    const credentials = await this.credentials(id, signal);
    try {
      const found = await this.providers[initial.providerId].discover({ connection: initial, credentials, signal });
      const current = this.connection(id);
      assert(current.revision === initial.revision, 'Connection changed during discovery. Retry.', 'STALE_RESULT', 409);
      assert(Array.isArray(found.models) && found.models.length > 0, 'Provider did not return any eligible models.', 'NO_MODELS', 502);
      // Inventory is live, but a probe belongs to a particular model. Keep its
      // result across a refresh so a model that disappeared or failed is not
      // silently presented as untested again.
      const previous = new Map(current.models.map(m => [m.id, m]));
      const eligibleFound = current.providerId === 'antigravity'
        ? found.models.filter(m => isAntigravityModelValid(m.id))
        : found.models;
      current.models = eligibleFound.filter(m => typeof m.id === 'string' && m.id && m.id.length <= 200).map(m => ({
        ...previous.get(m.id), ...m, id: m.id, name: m.name || m.id, enabled: previous.get(m.id)?.enabled ?? m.enabled ?? true,
        source: m.source || 'live', stale: Boolean(m.stale), thinkingLevels: Array.isArray(m.thinkingLevels) ? m.thinkingLevels : [],
        capabilities: { streaming: 'reported', tools: 'unknown', vision: 'unknown', reasoning: 'unknown', ...m.capabilities },
      }));
      if (found.credentials) this.store.saveCredentials(id, { ...credentials, ...found.credentials });
      if (found.email) { current.email = found.email; current.accountLabel = found.email; }
      if (found.projectId) { current.projectId = found.projectId; this.store.saveCredentials(id, { ...this.store.credentials(id), projectId: found.projectId }); }
      current.authState = 'ready'; current.discoveryState = 'ready'; current.lastModelSyncAt = new Date().toISOString(); current.nextModelSyncAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); current.error = null;
      if (current.providerId === 'antigravity') current.projectState = found.projectState || (current.projectId ? 'ready' : 'required');
      this.store.put('connection', current);
      for (const alias of this.store.list('alias')) {
        const invalidTargets = alias.targets.filter(target => target.connectionId === id && !current.models.some(model => model.id === target.modelId));
        if (!invalidTargets.length) continue;
        alias.enabled = false;
        alias.error = 'One or more target models are no longer available. Choose a current model and enable this alias again.';
        this.store.put('alias', alias);
      }
      this.repairDefault(); return current;
    } catch (error) {
      const current = this.store.get('connection', id);
      if (current && current.revision === initial.revision) {
        const safe = safeError(error); current.error = safe.message; current.discoveryState = 'failed';
        if (safe.code === 'AUTH') current.authState = 'expired';
        if (current.providerId === 'antigravity') current.projectState = safe.code === 'PROJECT_REQUIRED' ? 'required' : current.projectId ? 'ready' : 'failed';
        const fallback = this.providers[current.providerId]?.fallbackModels;
        if (!current.models.length && Array.isArray(fallback) && fallback.length) {
          current.models = fallback.map(model => ({ ...model, enabled: false, source: 'static', stale: true, capabilities: { streaming: 'reported', tools: 'unknown', vision: 'unknown', reasoning: 'unknown', ...model.capabilities } }));
          current.discoveryState = 'degraded';
        } else if (current.models.length) {
          current.models = current.models.map(model => ({ ...model, stale: true }));
          current.discoveryState = 'degraded';
        }
        this.store.put('connection', current);
      }
      throw error;
    }
  }
  async testInference(id, modelId, signal = AbortSignal.timeout(90000)) {
    const connection = this.connection(id);
    assert(connection.models.some(model => model.id === modelId && model.enabled), 'Choose an enabled discovered model.', 'MODEL_NOT_FOUND', 404);
    const startedAt = Date.now();
    try {
      const credentials = await this.credentials(id, signal);
      let meaningful = false; let finished = false; let usage = null;
      for await (const event of this.providers[connection.providerId].generate({ connection, credentials, body: { model: modelId, messages: [{ role: 'user', content: 'Reply exactly: BOXFOX_OK' }], max_tokens: 64, stream: false }, signal })) {
        if (event.type === 'delta' && (event.delta?.content || event.delta?.tool_calls?.length)) meaningful = true;
        if (event.type === 'finish') finished = true;
        if (event.type === 'usage') usage = event.usage;
      }
      assert(meaningful && finished, 'Provider returned no complete response.', 'UNAVAILABLE', 502);
      const current = this.connection(id); current.inferenceState = 'ready'; current.lastTestedAt = new Date().toISOString(); current.error = null;
      current.models = current.models.map(model => model.id === modelId ? {
        ...model, health: 'ready', probeStatus: 'passed', lastProbedAt: current.lastTestedAt, lastProbe: { status: 'passed', httpStatus: 200, latencyMs: Date.now() - startedAt, testedAt: current.lastTestedAt, error: null },
      } : model);
      this.store.put('connection', current);
      return { status: 'passed', connectionId: id, modelId, usage, testedAt: current.lastTestedAt };
    } catch (error) {
      const current = this.store.get('connection', id);
      if (current && current.revision === connection.revision) {
        const safe = safeError(error);
        // A per-model test is a probe: it must not mark a healthy account as
        // broken. OmniRoute follows the same isolation rule for its model
        // probes. Authentication failures remain connection-level evidence.
        current.models = current.models.map(model => model.id === modelId ? {
          ...model, health: probeHealth(safe), lastProbe: { status: 'failed', httpStatus: safe.status, latencyMs: Date.now() - startedAt, testedAt: new Date().toISOString(), error: safe.message },
        } : model);
        if (safe.code === 'AUTH') { current.authState = 'expired'; current.error = safe.message; }
        this.store.put('connection', current);
      }
      if (safeError(error).code === 'RATE_LIMIT') {
        try { await this.quota(id, AbortSignal.timeout(5000)); } catch { /* inference error remains primary */ }
      }
      throw error;
    }
  }
  async quota(id, signal = AbortSignal.timeout(30000)) {
    const c = this.connection(id); const credentials = await this.credentials(id, signal);
    const result = await this.providers[c.providerId].quota({ connection: c, credentials, signal });
    const current = this.connection(id);
    assert(current.revision === c.revision, 'Connection changed during quota refresh.', 'STALE_RESULT', 409);
    current.quota = result; this.store.put('connection', current); return result;
  }
  validTarget(target) {
    const c = this.store.get('connection', target?.connectionId);
    return Boolean(c?.enabled && c.authState === 'ready' && c.discoveryState === 'ready' && (c.providerId !== 'antigravity' || c.projectState === 'ready') && c.models.some(m => m.id === target.modelId && m.enabled && m.health !== 'unavailable'));
  }
  alias(values, id = randomUUID()) {
    const old = this.store.get('alias', id);
    const alias = { ...old, ...values, id, name: label(values.name, old?.name || ''), enabled: values.enabled ?? old?.enabled ?? true };
    assert(/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(alias.name), 'Alias must start with a letter and contain only letters, numbers, dots, underscores or hyphens.');
    assert(!this.store.list('alias').some(a => a.id !== id && a.name === alias.name), 'Alias name is already used.');
    assert(['fallback', 'round_robin'].includes(alias.strategy), 'Choose fallback or round-robin.');
    assert(typeof alias.enabled === 'boolean', 'Enabled must be boolean.');
    assert(Array.isArray(alias.targets) && alias.targets.length > 0 && alias.targets.length <= 16, 'Choose 1–16 targets.');
    // Disabling a previously valid alias must still work after an account expires.
    assert(alias.targets.every(t => this.validTarget(t) || (!alias.enabled && old?.targets.some(o => o.connectionId === t?.connectionId && o.modelId === t?.modelId))), 'Each target must be enabled and discovered on an authorized connection.');
    assert(new Set(alias.targets.map(t => `${t.connectionId}/${t.modelId}`)).size === alias.targets.length, 'Alias targets must not be duplicated.');
    alias.targets = alias.targets.map(t => ({ connectionId: t.connectionId, modelId: t.modelId }));
    this.store.put('alias', alias); this.repairDefault(); return alias;
  }
  setDefault(value) {
    const v = { connectionId: value.connectionId || null, modelId: value.modelId || null, aliasId: value.aliasId || null };
    if (v.aliasId) { const alias = this.store.get('alias', v.aliasId); assert(alias?.enabled && alias.targets.some(t => this.validTarget(t)), 'Choose an enabled alias with an available target.'); v.connectionId = null; v.modelId = null; }
    else assert(this.validTarget(v), 'Choose an enabled model on an authorized connection.');
    return this.store.setDefault(v);
  }
  repairDefault() {
    const d = this.store.getDefault();
    const alias = d.aliasId ? this.store.get('alias', d.aliasId) : null;
    if (d.aliasId ? !alias?.enabled || !alias.targets.some(t => this.validTarget(t)) : d.connectionId && !this.validTarget(d)) this.store.setDefault({ connectionId: null, modelId: null, aliasId: null });
  }
  publicModels(key = null) {
    const direct = this.store.list('connection').flatMap(c => c.models.filter(m => this.validTarget({ connectionId: c.id, modelId: m.id })).map(m => ({ id: `${c.id}/${m.id}`, object: 'model', owned_by: c.providerId, name: m.name })));
    const aliases = this.store.list('alias').filter(a => a.enabled && a.targets.some(t => this.validTarget(t))).map(a => ({ id: a.name, object: 'model', owned_by: 'boxfox' }));
    return [...direct, ...aliases].filter(m => !key || !key.allowedModels.length || key.allowedModels.includes(m.id));
  }
}
