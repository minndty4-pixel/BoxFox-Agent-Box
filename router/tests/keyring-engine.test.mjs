// Vòng 29 §1.2 — vòng khoá lồng trong vòng target của `engine.generate()`.
//
// Một connection giữ nhiều khoá; lượt chạy luôn bắt đầu ở khoá TRÊN CÙNG chưa nghỉ
// ("khoá trên cùng được dùng trước", không con trỏ xoay vòng). Chỉ một 429 mới đổi khoá,
// và chỉ khi chưa có nội dung nào đi ra client: park khoá đó rồi thử khoá kế tiếp ngay
// trong cùng request. 400/4xx request-scoped, 5xx và AUTH giữ nguyên hành vi cũ.
// Cả ring nghỉ ⇒ lỗi THẬT của provider đi ra nguyên vẹn, và lượt đó không tốn một lần
// gọi provider nào vì phép kiểm nghỉ nằm trước lời gọi adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';
import { RouterError } from '../src/errors.mjs';
import { logPath } from '../src/system-log.mjs';

const model = { id: 'model-1', name: 'Model', capabilities: { streaming: 'reported', tools: 'reported', vision: 'unsupported' } };
const request = id => ({ connectionId: id, modelId: model.id, messages: [{ role: 'user', content: 'hello' }], stream: true });

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-keyring-engine-'));
  const store = new RouterStore({ dataDir: dir });
  const calls = [];
  const adapter = {
    discover: async () => ({ models: [model] }),
    quota: async () => null,
    async *generate() { throw new RouterError('UNAVAILABLE', 'No adapter configured for this test.', 502, true); },
  };
  const service = new ProviderService({ store, providers: { custom: adapter } });
  const engine = new RouterEngine({ service, deadlineMs: 3000 });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const c = service.create({ providerId: 'custom', name: 'Local simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'FIRST-SECRET' });
  await service.discover(c.id);
  service.addKey(c.id, { key: 'SECOND-SECRET' });
  service.addKey(c.id, { key: 'THIRD-SECRET' });
  const keys = service.connections().find(connection => connection.id === c.id).keys.map(key => key.id);
  return { store, service, engine, adapter, calls, c: service.connection(c.id), keys, ring: () => service.connections().find(connection => connection.id === c.id) };
}

/** Adapter trả lời được CHỈ khi khoá đang dùng là `winner`. */
const answersOnly = (f, winner) => async function* ({ credentials }) {
  f.calls.push(credentials.id);
  if (credentials.id !== winner) throw new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached for this session.', 429, true);
  yield { type: 'delta', delta: { content: 'answered' } };
  yield { type: 'finish', finishReason: 'stop' };
};

async function collect(engine, input) {
  const events = [];
  for await (const event of engine.generate(input)) events.push(event);
  return events;
}

async function outcome(engine, input) {
  try {
    await collect(engine, input);
    return null;
  } catch (error) {
    return error;
  }
}

test('a 429 hands the request to the next key in ring order, and the usage row names the key that answered', async t => {
  const f = await fixture(t);
  f.adapter.generate = answersOnly(f, f.keys[2]);

  const events = await collect(f.engine, request(f.c.id));
  assert.equal(events[0].meta.connectionId, f.c.id);
  assert.deepEqual(f.calls, f.keys, 'one attempt per key, in ring order — the key that 429 is never asked twice in a turn');

  const usage = f.store.list('usage')[0];
  assert.equal(usage.status, 'passed');
  assert.equal(usage.keyId, f.keys[2], 'usage names the key that actually served the turn');
  assert.equal(usage.keyLabel, 'Key 3');

  const ring = f.ring().keys;
  assert.equal(ring[0].state, 'exhausted', 'a quota-shaped 429 reads as "hết hạn mức"');
  assert.equal(ring[1].state, 'exhausted');
  assert.equal(ring[2].state, 'ready');
  assert.ok(ring[0].cooldownUntil > Date.now(), 'the parked key carries the window shown by the interface');
  assert.ok(ring[2].lastUsedAt !== null, 'lastUsedAt is the one ring field that is written to disk');
  assert.equal(f.ring().activeKeyId, f.keys[2]);
  assert.equal(f.service.connection(f.c.id).activeKeyId, f.keys[2], 'and it survives a fresh read of the record');
});

test('a parked key is skipped on the next turn and comes back to the ring when its window ends', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const f = await fixture(t);
  f.adapter.generate = answersOnly(f, f.keys[2]);

  await collect(f.engine, request(f.c.id));
  assert.deepEqual(f.calls, f.keys);

  f.calls.length = 0;
  const second = await collect(f.engine, request(f.c.id));
  assert.deepEqual(f.calls, [f.keys[2]], 'the two parked keys are not asked again — the turn goes straight to the top key still in rotation');
  assert.equal(second[0].meta.connectionId, f.c.id);

  f.calls.length = 0;
  t.mock.timers.tick(31_000);
  await collect(f.engine, request(f.c.id));
  assert.equal(f.calls[0], f.keys[0], 'once the 30 s window is over the top key serves first again');
  assert.deepEqual(f.calls.slice(0, 3), f.keys, 'and it is asked in ring order like before');
});

test('every key parked throws the provider’s own error, and the next turn costs zero provider calls', async t => {
  const f = await fixture(t);
  let attempt = 0;
  f.adapter.generate = async function* ({ credentials }) {
    attempt += 1;
    f.calls.push(credentials.id);
    throw Object.assign(new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached for this session.', 429, true), { retryAfterMs: 45_000 });
  };

  const failure = await outcome(f.engine, request(f.c.id));
  assert.equal(attempt, 3, 'three keys, three attempts — no attempt is repeated');
  assert.deepEqual(f.calls, f.keys);
  assert.equal(failure.code, 'RATE_LIMIT');
  assert.equal(failure.status, 429);
  assert.equal(failure.message, 'Provider rate limit or quota reached for this session.', 'the provider’s own wording travels out — never a cooldown notice');
  assert.equal(failure.retryAfterMs, 45_000, 'and its own number travels with it, so the harness can still read retry advice');
  for (const key of f.ring().keys) assert.equal(key.state, 'exhausted', `${key.label} is parked`);

  const before = f.calls.length;
  const blocked = await outcome(f.engine, request(f.c.id));
  assert.equal(blocked.code, 'RATE_LIMIT');
  assert.equal(blocked.message, 'Provider rate limit or quota reached for this session.');
  assert.equal(blocked.retryAfterMs, 45_000);
  assert.equal(f.calls.length, before, 'a fully parked ring is checked before the adapter is called: zero provider calls');
});

test('a request-scoped 400 parks nothing, and the next turn asks the top key again', async t => {
  const f = await fixture(t);
  f.adapter.generate = async function* ({ credentials }) {
    f.calls.push(credentials.id);
    throw new RouterError('UNAVAILABLE', 'Provider error (400): This model’s maximum context length is 65536 tokens.', 400);
  };

  const failure = await outcome(f.engine, request(f.c.id));
  assert.equal(failure.status, 400);
  assert.deepEqual(f.calls, [f.keys[0]], 'a request-shaped error is not a reason to try another key');
  const ring = f.ring().keys;
  assert.equal(ring[0].state, 'error', 'the key keeps the error as information only');
  assert.equal(ring[0].cooldownUntil, null, 'and it is not parked');
  assert.equal(ring[1].state, 'ready');
  assert.equal(ring[2].state, 'ready');

  f.calls.length = 0;
  const second = await outcome(f.engine, request(f.c.id));
  assert.match(second.message, /maximum context length/);
  assert.deepEqual(f.calls, [f.keys[0]], 'the same key is asked again on the next turn');
});

test('5xx and AUTH keep today’s account rules and never move a key', async t => {
  const unavailable = await fixture(t);
  unavailable.adapter.generate = async function* ({ credentials }) {
    unavailable.calls.push(credentials.id);
    throw new RouterError('UNAVAILABLE', 'Provider returned an invalid response.', 502, true);
  };
  const failed = await outcome(unavailable.engine, request(unavailable.c.id));
  assert.equal(failed.status, 502);
  assert.deepEqual(unavailable.calls, [unavailable.keys[0]], 'a 5xx does not rotate keys');
  const marked = unavailable.service.connection(unavailable.c.id);
  assert.equal(marked.inferenceState, 'failed', 'the account verdict keeps its old rule');
  assert.equal(unavailable.ring().keys[0].cooldownUntil, null);

  const auth = await fixture(t);
  auth.adapter.generate = async function* ({ credentials }) {
    auth.calls.push(credentials.id);
    throw new RouterError('AUTH', 'Provider authentication failed. Reconnect or replace the credential.', 401, false);
  };
  const denied = await outcome(auth.engine, request(auth.c.id));
  assert.equal(denied.code, 'AUTH');
  assert.deepEqual(auth.calls, [auth.keys[0]], 'a 401 does not rotate keys either');
  assert.equal(auth.service.connection(auth.c.id).authState, 'expired');
  assert.equal(auth.ring().keys[0].cooldownUntil, null);
});

test('a 429 after the stream has started parks the key but never switches mid-stream', async t => {
  const f = await fixture(t);
  f.adapter.generate = async function* ({ credentials }) {
    f.calls.push(credentials.id);
    yield { type: 'delta', delta: { content: 'partial answer' } };
    throw new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached for this session.', 429, true);
  };

  const failure = await outcome(f.engine, request(f.c.id));
  assert.equal(failure.status, 429);
  assert.deepEqual(f.calls, [f.keys[0]], 'content already went out, so the request cannot be replayed on another key');
  assert.equal(f.ring().keys[0].state, 'exhausted', 'the key still takes the park it earned');
  assert.equal(f.ring().keys[1].cooldownUntil, null);
});

test('a round-robin alias leaves out a connection whose whole ring is parked', async t => {
  const f = await fixture(t);
  const other = f.service.create({ providerId: 'custom', name: 'Other', endpoint: f.c.endpoint, apiKey: 'OTHER-SECRET' });
  await f.service.discover(other.id);
  const alias = f.service.alias({ name: 'pool', strategy: 'round_robin', targets: [{ connectionId: f.c.id, modelId: model.id }, { connectionId: other.id, modelId: model.id }] });
  const order = () => f.engine.selection({ aliasId: alias.id }, null).targets.map(target => target.connectionId);

  assert.ok(order().includes(f.c.id));
  const refusal = () => new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached.', 429, true);
  for (const keyId of f.keys) f.service.keyRing.park(keyId, { error: refusal() });
  assert.deepEqual(order(), [other.id], 'a fully parked ring is not admitted into the rotation');
  for (const keyId of f.keys) f.service.keyRing.clear(keyId);
  assert.ok(order().includes(f.c.id), 'and it is admitted again once its keys are clear');
});

// ── Vòng sửa lỗi sau phản biện (F5 + dấu vết xoay khoá) ───────────────────────

test('token and cost numbers belong to the attempt, not to the target: a failed key’s partial usage never lands on the key that answered', async t => {
  const f = await fixture(t);
  let attempt = 0;
  f.adapter.generate = async function* ({ credentials }) {
    f.calls.push(credentials.id);
    attempt += 1;
    if (attempt === 1) {
      yield { type: 'usage', usage: { prompt_tokens: 111, completion_tokens: 7, total_tokens: 118 } };
      throw new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached for this session.', 429, true);
    }
    yield { type: 'delta', delta: { content: 'answered' } };
    yield { type: 'finish', finishReason: 'stop' };
  };

  await collect(f.engine, request(f.c.id));
  assert.deepEqual(f.calls, [f.keys[0], f.keys[1]], 'khoá 429 nhường lượt cho khoá kế tiếp');
  const usage = f.store.list('usage')[0];
  assert.equal(usage.status, 'passed');
  assert.equal(usage.keyId, f.keys[1], 'dòng usage ghi tên khoá đã trả lời');
  assert.equal(usage.inputTokens, null, 'số dở dang của khoá 1 không thành số của khoá 2');
  assert.equal(usage.cachedTokens, null);
  assert.equal(usage.outputTokens, null);
  assert.equal(usage.totalTokens, null);
  assert.equal(usage.cost, null);
});

test('a mid-request rotation leaves one line in the developer log, and it carries no secret', async t => {
  const f = await fixture(t);
  f.adapter.generate = answersOnly(f, f.keys[1]);
  await collect(f.engine, request(f.c.id));

  const row = f.store.list('usage')[0];
  const entries = (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.event === 'router.key_parked');
  const mine = entries.filter(entry => entry.requestId === row.requestId);
  assert.equal(mine.length, 1, 'một khoá bị nghỉ ⇒ đúng một dòng, gắn được vào lượt này');
  assert.equal(mine[0].level, 'info');
  assert.equal(mine[0].code, 'RATE_LIMIT');
  assert.equal(mine[0].provider, 'custom');
  assert.equal(mine[0].model, model.id);
  assert.equal(mine[0].data.keyId, f.keys[0], 'dòng log ghi tên khoá vừa bị nghỉ');
  assert.equal(mine[0].data.keyLabel, f.ring().keys[0].label);
  assert.equal(JSON.stringify(entries).includes('FIRST-SECRET'), false, 'không dòng log nào mang theo secret');
});
