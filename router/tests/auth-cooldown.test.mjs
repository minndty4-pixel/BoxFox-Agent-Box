// 9Router v0.5.81: "do not cool down an account for request-scoped 4xx errors".
//
// A 400 caused by the request itself (context overflow, malformed body, unsupported
// parameter, content policy on one input) says nothing about the credential, so cooling
// the account down only removes a healthy connection from rotation — and with a single
// connection every later request in the window fails with a copy of that very error
// ("all 1 accounts locked for <model> | lastError=[400]: ..."), which hides the real
// cause and makes unrelated sessions look rate-limited
// (`open-sse/services/accountFallback.js:48-60`). Account-scoped statuses keep their
// rules: 401/403 still expire the credential, 429 still takes a strike and a cooldown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';
import { RouterError, requestScopedClientError } from '../src/errors.mjs';

const model = { id: 'model-1', name: 'Model', capabilities: { streaming: 'reported', tools: 'reported', vision: 'unsupported' } };
async function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-cooldown-'));
  const store = new RouterStore({ dataDir: dir });
  const calls = [];
  const adapter = {
    discover: async () => ({ models: [model] }),
    quota: async () => null,
    async *generate() {
      calls.push(Date.now());
      yield { type: 'delta', delta: { content: 'Xin chào 🦊' } };
      yield { type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } };
      yield { type: 'finish', finishReason: 'stop' };
    },
    ...overrides,
  };
  const service = new ProviderService({ store, providers: { custom: adapter } });
  const engine = new RouterEngine({ service, deadlineMs: 2000 });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const c = service.create({ providerId: 'custom', name: 'Local simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'SECRET-SIMULATOR' });
  await service.discover(c.id);
  return { store, service, engine, adapter, calls, c: service.connection(c.id) };
}
const request = id => ({ connectionId: id, modelId: model.id, messages: [{ role: 'user', content: 'hello' }], stream: true });
async function outcome(engine, id) {
  try {
    for await (const event of engine.generate(request(id))) void event;
    return null;
  } catch (error) {
    return error;
  }
}

test('the request-scoped status rule keeps the account-scoped statuses out of it', () => {
  for (const [status, scoped] of [[400, true], [405, true], [409, true], [413, true], [422, true], [451, true]]) {
    assert.equal(requestScopedClientError(new RouterError('UNAVAILABLE', 'Provider error.', status)), scoped, `${status} is about this request`);
  }
  // 401/403 (the credential), 402 (billing), 404 (stale model inventory) and 429 (rate
  // limit) still belong to the connection, and a server-side status never gets here.
  for (const status of [401, 402, 403, 404, 429, 500, 502, 503, 504]) {
    assert.equal(requestScopedClientError(new RouterError('UNAVAILABLE', 'Provider error.', status)), false, `${status} is account-scoped`);
  }
  assert.equal(requestScopedClientError(new RouterError('CANCELLED', 'Request cancelled.', 499)), true, 'a cancellation is nobody’s account verdict either');
  assert.equal(requestScopedClientError(new RouterError('POLICY_DENIED', 'Denied by the key allowlist.', 403)), false, 'an account-scoped code survives its status');
  assert.equal(requestScopedClientError({ status: 422, message: 'unsupported parameter' }), true, 'a plain provider error object is classified the same way');
});

test('a request-scoped 4xx leaves the account healthy and takes no cooldown', async t => {
  const f = await fixture(t, {
    async *generate() {
      throw Object.assign(new Error('Provider error (400): This model\'s maximum context length is 65536 tokens.'), { status: 400 });
    },
  });
  const before = f.service.connection(f.c.id);
  const failure = await outcome(f.engine, f.c.id);
  assert.equal(failure.code, 'UNAVAILABLE');
  assert.equal(failure.status, 400);
  assert.equal(failure.retryable, false, 'another account cannot answer a request-shaped error, so the engine fails over to nothing');
  const after = f.service.connection(f.c.id);
  assert.equal(after.inferenceState, before.inferenceState, 'a bad request is not a bad account');
  assert.equal(after.error, before.error, 'and its message is never written onto the account');
  assert.equal(after.authState, before.authState, 'the credential is untouched');
  assert.equal(f.engine.cooldowns.size, 0, 'nothing takes the target out of rotation');
  assert.equal(f.engine.rateLimitStrikes.size, 0, 'and no strike is filed against it');
});

test('a 400 does not lock the single connection out of the next request', async t => {
  const failures = [];
  const f = await fixture(t, {
    async *generate() {
      failures.push(Date.now());
      throw new RouterError('UNAVAILABLE', 'Provider error (400): unsupported parameter.', 400);
    },
  });
  await outcome(f.engine, f.c.id);
  // The same connection is asked again: with a single connection a cooled-down target
  // makes every later request fail with a copy of this error instead of the real one.
  const second = await outcome(f.engine, f.c.id);
  assert.equal(failures.length, 2, 'the provider — not a cooldown window — decides again');
  assert.equal(second.code, 'UNAVAILABLE');
  assert.match(second.message, /unsupported parameter/, 'the caller keeps seeing the real cause');
});

test('a capability rejection is request-scoped too', async t => {
  const f = await fixture(t, { async *generate() { throw new RouterError('CAPABILITY', 'This model does not support the requested operation.', 400); } });
  const before = f.service.connection(f.c.id);
  const failure = await outcome(f.engine, f.c.id);
  assert.equal(failure.code, 'CAPABILITY');
  assert.equal(f.service.connection(f.c.id).inferenceState, before.inferenceState);
  assert.equal(f.engine.cooldowns.size, 0);
});

test('401 still expires the credential and 429 still cools the target down', async t => {
  const auth = await fixture(t, { async *generate() { throw new RouterError('AUTH', 'Provider authentication failed. Reconnect or replace the credential.', 401, false); } });
  assert.equal((await outcome(auth.engine, auth.c.id)).code, 'AUTH');
  const expired = auth.service.connection(auth.c.id);
  assert.equal(expired.authState, 'expired', 'an account-scoped 401 still marks the credential');
  assert.equal(expired.inferenceState, 'failed');
  assert.match(expired.error, /authentication failed/);

  const limited = await fixture(t, { async *generate() { throw new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached. Try again later.', 429, true); } });
  await outcome(limited.engine, limited.c.id);
  assert.equal(limited.engine.rateLimitStrikes.get(`${limited.c.id}/${model.id}`).count, 1, 'the first 429 is a strike');
  assert.equal(limited.engine.cooldowns.size, 0, 'one strike is not yet a cooldown');
  await outcome(limited.engine, limited.c.id);
  assert.equal(limited.engine.rateLimitStrikes.get(`${limited.c.id}/${model.id}`).count, 2);
  assert.ok(limited.engine.cooldowns.get(`${limited.c.id}/${model.id}`) > Date.now(), 'the second 429 inside the window cools the target down');
  const callsBefore = limited.calls.length;
  const blocked = await outcome(limited.engine, limited.c.id);
  assert.equal(blocked.code, 'RATE_LIMIT');
  assert.equal(limited.calls.length, callsBefore, 'a cooling-down target is skipped instead of being called again');
});
