import { randomUUID } from 'node:crypto';
import { RouterError, assert, safeError } from './errors.mjs';
import { normalizeUsage, reportedCost } from './usage.mjs';

export class RouterEngine {
  constructor({ service, deadlineMs = 90000 }) { this.service = service; this.store = service.store; this.rotation = new Map(); this.cooldowns = new Map(); this.rateLimitStrikes = new Map(); this.deadlineMs = deadlineMs; }
  selection(body, key) {
    let selected;
    if (body.aliasId) selected = { aliasId: body.aliasId };
    else if (body.providerId && (body.modelId || body.model)) selected = { providerId: body.providerId, modelId: body.modelId || body.model };
    else if (body.connectionId) selected = { connectionId: body.connectionId, modelId: body.modelId || body.model };
    else if (body.model) {
      const alias = this.store.list('alias').find(a => a.name === body.model);
      if (alias) selected = { aliasId: alias.id };
      else {
        const split = body.model.indexOf('/');
        assert(split > 0, 'Unknown model. Use an identifier returned by /v1/models.', 'MODEL_NOT_FOUND', 404);
        selected = { connectionId: body.model.slice(0, split), modelId: body.model.slice(split + 1) };
      }
    } else selected = this.store.getDefault();
    let targets; let alias = null;
    if (selected.providerId) {
      const config = this.service.providerConfig(selected.providerId);
      const rank = new Map(config.connectionOrder.map((id, index) => [id, index]));
      targets = this.store.list('connection')
        .filter(connection => connection.providerId === selected.providerId && this.service.validTarget({ connectionId: connection.id, modelId: selected.modelId }))
        .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
        .map(connection => ({ connectionId: connection.id, modelId: selected.modelId }));
      if (config.roundRobin && targets.length) {
        const rotationKey = `provider:${selected.providerId}:${selected.modelId}`;
        const offset = (this.rotation.get(rotationKey) || 0) % targets.length;
        targets = [...targets.slice(offset), ...targets.slice(0, offset)];
        this.rotation.set(rotationKey, (offset + 1) % targets.length);
      }
    } else if (selected.aliasId) {
      alias = this.store.get('alias', selected.aliasId);
      assert(alias?.enabled, 'Alias is missing or disabled.', 'MODEL_NOT_FOUND', 404);
      targets = alias.targets.filter(t => this.service.validTarget(t));
      if (alias.strategy === 'round_robin' && targets.length) {
        const admitted = targets.filter(t => (this.cooldowns.get(`${t.connectionId}/${t.modelId}`) || 0) <= Date.now());
        if (admitted.length) targets = admitted;
        const offset = this.rotation.get(alias.id) || 0;
        const start = offset % targets.length;
        targets = [...targets.slice(start), ...targets.slice(0, start)];
        this.rotation.set(alias.id, (offset + 1) % targets.length);
      }
    } else targets = [selected];
    const identifier = alias?.name || (selected.providerId ? `${selected.providerId}/${selected.modelId}` : `${selected.connectionId}/${selected.modelId}`);
    assert(!key || !key.allowedModels.length || key.allowedModels.includes(identifier), 'API key does not allow this model or alias.', 'POLICY_DENIED', 403);
    targets = targets.filter(t => this.service.validTarget(t));
    assert(targets.length, 'No enabled, authorized model is available for this route.', 'NO_ROUTE', 503);
    return { targets, alias, identifier };
  }
  async *generate(body, { key = null, signal } = {}) {
    assert(Array.isArray(body.messages) && body.messages.length > 0 && body.messages.length <= 200, 'Provide 1–200 chat messages.');
    assert(body.messages.every(m => m && ['system', 'user', 'assistant', 'tool', 'developer'].includes(m.role)), 'Invalid message role.');
    assert(body.messages.every(m => typeof m.content === 'string' || (m.role === 'assistant' && m.content == null && Array.isArray(m.tool_calls)) || (Array.isArray(m.content) && m.content.every(p => (p?.type === 'text' && typeof p.text === 'string') || (p?.type === 'image_url' && Boolean(p.image_url?.url))))), 'Invalid message content. Expected text, image_url, or tool_calls.');
    assert(body.stream === undefined || typeof body.stream === 'boolean', 'stream must be boolean.');
    assert(body.tools === undefined || (Array.isArray(body.tools) && body.tools.length <= 128 && body.tools.every(t => t.type === 'function' && typeof t.function?.name === 'string' && t.function.name.length <= 64)), 'Invalid tools.');
    assert(body.max_tokens === undefined || (Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 64000), 'max_tokens must be 1–64000.');
    const selection = this.selection(body, key);
    const requestId = randomUUID(); const began = Date.now();
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(this.deadlineMs);
    const combined = AbortSignal.any([controller.signal, deadline, ...(signal ? [signal] : [])]);
    const record = { requestId, connectionId: null, modelId: null, aliasId: selection.alias?.id || null, clientKeyId: key?.id || null, status: 'failed', latencyMs: 0, inputTokens: null, cachedTokens: null, cacheCreationTokens: null, reasoningTokens: null, outputTokens: null, totalTokens: null, cost: null, error: null };
    let lastError; let emitted = false; let succeeded = false; let outputBytes = 0; const reactiveRefresh = new Set();
    try {
      for (let targetIndex = 0; targetIndex < selection.targets.length; targetIndex++) {
        const target = selection.targets[targetIndex];
        combined.throwIfAborted();
        if ((this.cooldowns.get(`${target.connectionId}/${target.modelId}`) || 0) > Date.now()) {
          lastError = new RouterError('RATE_LIMIT', 'This target is cooling down after a provider limit.', 429, true); continue;
        }
        const connection = this.service.connection(target.connectionId);
        const model = connection.models.find(m => m.id === target.modelId);
        if (body.tools?.length && model.capabilities.tools === 'unsupported') { lastError = new RouterError('CAPABILITY', 'Selected model does not support tools.'); continue; }
        record.connectionId = connection.id; record.modelId = model.id;
        record.inputTokens = null; record.cachedTokens = null; record.cacheCreationTokens = null; record.reasoningTokens = null; record.outputTokens = null; record.totalTokens = null; record.cost = null;
        this.service.active.set(requestId, { connectionId: connection.id, controller });
        try {
          const credentials = await this.service.credentials(connection.id, combined);
          const outgoing = { ...body, model: model.id, stream: body.stream !== false };
          delete outgoing.connectionId; delete outgoing.modelId; delete outgoing.aliasId;
          // BUG-4/R3: `thinkingType: 'none'` models get no thinking field at all,
          // even when the caller sends a stored default level the model cannot use.
          if (model.thinkingType === 'none') { delete outgoing.thinkingLevel; delete outgoing.reasoning_effort; }
          let started = false; let finishReason = null; let meaningful = false;
          let pendingUsage = null;
          const ensureStarted = () => ({ type: 'start', meta: { requestId, connectionId: connection.id, modelId: model.id, aliasId: selection.alias?.id || null } });
          for await (const event of this.service.providers[connection.providerId].generate({ connection, credentials, body: outgoing, signal: combined })) {
            combined.throwIfAborted();
            assert(this.service.validTarget(target), 'Connection or model disabled during request.', 'CANCELLED', 499);
            if (event.type === 'delta') {
              // BUG-2: a delta that carries only reasoning is still client output.
              const reasoning = typeof event.delta?.reasoning_content === 'string' ? event.delta.reasoning_content : event.delta?.reasoning;
              const useful = Boolean(event.delta?.content || event.delta?.tool_calls?.length || (typeof reasoning === 'string' && reasoning.length > 0));
              if (!useful) continue;
              outputBytes += Buffer.byteLength(JSON.stringify(event.delta));
              assert(outputBytes <= 8 * 1024 * 1024, 'Provider response exceeded the output limit.', 'OUTPUT_LIMIT', 502);
              if (!started) { yield ensureStarted(); started = true; }
              meaningful = true; emitted = true; yield event;
            } else if (event.type === 'finish') finishReason = event.finishReason || 'stop';
            else if (event.type === 'usage') {
              const usage = normalizeUsage(event.usage);
              record.inputTokens = usage.prompt_tokens;
              record.cachedTokens = usage.cached_tokens;
              record.cacheCreationTokens = usage.cache_creation_input_tokens;
              record.reasoningTokens = usage.reasoning_tokens;
              record.outputTokens = usage.completion_tokens;
              record.totalTokens = usage.total_tokens;
              record.cost = reportedCost(usage);
              pendingUsage = { ...event, usage };
              if (started) { yield event; pendingUsage = null; }
            }
          }
          assert(meaningful && finishReason, 'Provider returned no complete response.', 'UNAVAILABLE', 502);
          if (pendingUsage) yield pendingUsage;
          const current = this.store.get('connection', connection.id);
          if (current && current.revision === connection.revision) { current.inferenceState = 'ready'; current.lastTestedAt = new Date().toISOString(); current.error = null; this.store.put('connection', current); }
          this.rateLimitStrikes.delete(`${connection.id}/${model.id}`);
          this.cooldowns.delete(`${connection.id}/${model.id}`);
          record.status = 'passed'; succeeded = true;
          yield { type: 'finish', finishReason }; return;
        } catch (error) {
          const safe = combined.aborted ? safeError(combined.reason) : safeError(error);
          lastError = safe;
          const current = this.store.get('connection', connection.id);
          if (current && current.revision === connection.revision && !combined.aborted) {
            const isFatalConnection = safe.code === 'AUTH' || safe.code === 'UNAVAILABLE' || safe.status === 502 || safe.status === 503 || safe.status === 504;
            if (isFatalConnection) {
              current.inferenceState = 'failed';
              current.error = safe.message;
              if (safe.code === 'AUTH') current.authState = 'expired';
              this.store.put('connection', current);
            }
          }
          if (safe.code === 'RATE_LIMIT') {
            const strikeKey = `${connection.id}/${model.id}`;
            const prior = this.rateLimitStrikes.get(strikeKey);
            const count = prior && Date.now() - prior.at < 5 * 60_000 ? prior.count + 1 : 1;
            this.rateLimitStrikes.set(strikeKey, { count, at: Date.now() });
            try { await this.service.quota(connection.id, AbortSignal.timeout(5000)); } catch { /* inference error remains primary */ }
            if (count >= 2) {
              const duration = Math.min(Math.max(Number(safe.retryAfterMs) || 30_000, 5_000), 5 * 60_000);
              this.cooldowns.set(strikeKey, Date.now() + duration);
            }
          }
          if (!emitted && !combined.aborted && (safe.code === 'MODEL_NOT_FOUND' || safe.status === 404) && !reactiveRefresh.has(connection.id)) {
            reactiveRefresh.add(connection.id);
            try {
              await this.service.discover(connection.id, AbortSignal.any([combined, AbortSignal.timeout(60000)]));
              if (this.service.validTarget(target)) { targetIndex--; continue; }
            } catch (refreshError) { lastError = safeError(refreshError); }
          }
          if (emitted || combined.aborted || !safe.retryable) throw safe;
        }
      }
      throw lastError || new RouterError('NO_ROUTE', 'No usable route is available.', 503);
    } catch (error) {
      const safe = combined.aborted ? safeError(combined.reason) : safeError(error);
      record.status = safe.code === 'CANCELLED' ? 'cancelled' : 'failed'; record.error = safe.message;
      throw safe;
    } finally {
      if (!succeeded && !record.error) { record.status = 'cancelled'; record.error = 'Request cancelled.'; }
      controller.abort(new DOMException('Finished', 'AbortError'));
      this.service.active.delete(requestId); record.latencyMs = Date.now() - began; this.store.addUsage(record);
    }
  }
}
