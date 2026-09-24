// Vòng 29 — key ring: luật nghỉ, thứ tự thử, trạng thái khoá và lỗi thật.
//
// Tệp này kiểm phần thuần trí nhớ của cơ chế (`src/keyring.mjs`): công thức 30 s
// mặc định / `retry-after` chỉ nâng / trần 2 phút là quy ước của dự án, thứ tự
// "khoá trên cùng được dùng trước", và việc lỗi thật của provider được giữ
// nguyên thay vì bọc thành một câu tổng hợp.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_COOLDOWN_MAX_MS,
  KEY_COOLDOWN_MS,
  KeyRing,
  MAX_KEYS_PER_CONNECTION,
  classifyState,
  cooldownFor,
  headOf,
} from '../src/keyring.mjs';

const key = (id, label = id) => ({ id, label, prefix: 'abcdef…', createdAt: 1, lastUsedAt: null });
const connection = (...keys) => ({ id: 'connection-1', name: 'OpenCode Free', keys });
const pool = () => connection(key('row-1', 'Key 1'), key('row-2', 'Key 2'), key('row-3', 'Key 3'));

test('key cooldown is 30 s by default, may only be raised by Retry-After, and is capped at the project convention', () => {
  assert.equal(KEY_COOLDOWN_MS, 30_000);
  assert.equal(KEY_COOLDOWN_MAX_MS, 120_000);
  assert.equal(MAX_KEYS_PER_CONNECTION, 10);
  assert.equal(cooldownFor(undefined), 30_000, 'no header at all');
  assert.equal(cooldownFor(null), 30_000);
  assert.equal(cooldownFor(3_000), 30_000, 'Retry-After: 3 must not cool a key less than the default');
  assert.equal(cooldownFor(90_000), 90_000, 'Retry-After: 90 is honoured');
  assert.equal(cooldownFor(600_000), 120_000, 'Retry-After: 600 hits the cap');
  assert.equal(cooldownFor('soon'), 30_000, 'garbage is no answer');
  assert.equal(cooldownFor(-5), 30_000, 'a negative wait is no wait');
});

test('headOf never leaks more than six characters of a secret', () => {
  assert.equal(headOf('SECRET-SIMULATOR'), 'SECRET…');
  assert.equal(headOf('SECRET-SIMULATOR').replace('…', '').length, 6);
  assert.equal(headOf('short'), 'short', 'a short secret is kept whole — it is still only that secret’s first characters');
  assert.equal(headOf(''), null, 'a blob with no secret has no prefix');
  assert.equal(headOf(undefined), null);
  assert.equal(headOf(null), null);
});

test('a cooling key that mentions quota is exhausted; any other failure is an error, and an expired window is ready again', () => {
  const now = Date.now();
  // "429 thường" không nói gì tới hạn mức: chỉ là một cửa sổ nghỉ, không phải "hết hạn mức".
  const cooling = { cooldownUntil: now + 30_000, lastError: { code: 'RATE_LIMIT', message: 'Too many requests. Retry later.' } };
  const exhausted = { cooldownUntil: now + 30_000, lastError: { code: 'RATE_LIMIT', message: 'OpenCode Free quota reached for this session.' } };
  assert.equal(classifyState(exhausted, now), 'exhausted');
  assert.equal(classifyState(cooling, now), 'cooling');
  assert.equal(classifyState({ lastError: { code: 'AUTH', message: 'Provider authentication failed.' } }, now), 'error');
  assert.equal(classifyState({ lastError: { code: 'UNAVAILABLE', message: 'Provider error (502): bad gateway' } }, now), 'error');
  assert.equal(classifyState({ cooldownUntil: now - 1, lastError: { code: 'RATE_LIMIT', message: 'quota' } }, now), 'ready', 'the window is over, so the key is back in rotation');
  assert.equal(classifyState({}, now), 'ready');
  assert.equal(classifyState(undefined, now), 'ready');
});

test('the router’s own wrapper sentence never decides cooling vs exhausted — the provider’s words do', () => {
  const now = Date.now();
  // Every 429 that goes through `providerError()` is wrapped in "Provider rate limit or
  // quota reached…", which contains the word "quota". Classifying on the whole message
  // would make `cooling` (and its countdown) unreachable for the OpenAI-compatible,
  // Gemini and Antigravity adapters, so the provider's own words are read first.
  const wrapped = providerMessage => ({
    cooldownUntil: now + 30_000,
    lastError: { code: 'RATE_LIMIT', message: `Provider rate limit or quota reached: ${providerMessage}. Try again later.`, providerMessage },
  });
  assert.equal(classifyState(wrapped('too many requests, slow down'), now), 'cooling', 'a plain rate limit stays cooling');
  assert.equal(classifyState(wrapped('quota reached for credential #2'), now), 'exhausted', 'quota-shaped provider words are exhausted');
  assert.equal(classifyState(wrapped('usage limit reached'), now), 'exhausted');
  // No provider words at all: the wrapped sentence is all there is, and it says quota.
  assert.equal(classifyState({ cooldownUntil: now + 30_000, lastError: { code: 'RATE_LIMIT', message: 'Provider rate limit or quota reached. Try again later.' } }, now), 'exhausted');
});

test('the ring serves the top key first, skips cooling keys, and returns them to rotation when the window ends', () => {
  const ring = new KeyRing();
  const c = pool();
  assert.equal(ring.pick(c).id, 'row-1', 'the first key in ring order is the one that serves');
  assert.equal(ring.hasCallable(c), true);
  const now = Date.now();
  ring.park('row-1', { retryAfterMs: 3_000, error: { code: 'RATE_LIMIT', message: 'slow down' } });
  assert.equal(ring.pick(c).id, 'row-2');
  ring.park('row-2', { error: { code: 'RATE_LIMIT', message: 'slow down' } });
  assert.equal(ring.pick(c).id, 'row-3');
  ring.park('row-3', { error: { code: 'RATE_LIMIT', message: 'quota reached for this session' } });
  assert.equal(ring.pick(c), null, 'every key is cooling');
  assert.equal(ring.hasCallable(c), false);
  assert.equal(ring.pick(c, now + 31_000).id, 'row-1', 'the window is over and the top key leads again');
  assert.equal(ring.hasCallable(c, now + 31_000), true);
  assert.equal(ring.pick({ id: 'empty', keys: [] }), null, 'a connection with no ring has nothing to serve');
  assert.equal(ring.pick({ id: 'legacy' }), null);
});

test('parking a key remembers the real provider error untouched, and clear() forgets it', () => {
  const ring = new KeyRing();
  const c = pool();
  const real = Object.assign(new Error('OpenCode Free quota reached for this session.'), { code: 'RATE_LIMIT', status: 429, retryAfterMs: 90_000 });
  ring.park('row-1', { retryAfterMs: 90_000, error: real, modelId: 'muse-spark-1.2-contributor-free' });
  assert.equal(ring.lastError(c), real, 'the error object itself travels on — never rewrapped');
  assert.equal(ring.lastError(c).code, 'RATE_LIMIT');
  assert.equal(ring.lastError(c).retryAfterMs, 90_000, 'the harness can still read the wait from retry_advice');
  ring.clear('row-1');
  assert.equal(ring.lastError(c), null, 'a key nobody remembers has no verdict');
  assert.equal(ring.pick(c).id, 'row-1');
});

test('state() decorates the stored ring for the snapshot without ever returning a secret', () => {
  const ring = new KeyRing();
  const resetTime = new Date(Date.now() + 3_600_000).toISOString();
  const c = { ...pool(), activeKeyId: 'row-2', quota: { models: [{ modelId: 'free-model', resetTime }] } };
  ring.park('row-1', { retryAfterMs: 600_000, error: { code: 'RATE_LIMIT', message: 'Free usage limit reached for this session.' }, modelId: 'free-model' });
  ring.note('row-3', { code: 'UNAVAILABLE', message: 'Provider error (502): bad gateway.' });
  const state = ring.state(c);
  assert.deepEqual(state.keys.map(entry => entry.id), ['row-1', 'row-2', 'row-3'], 'ring order is preserved');
  const [first, second, third] = state.keys;
  assert.equal(first.state, 'exhausted');
  assert.equal(first.cooldownUntil > Date.now(), true);
  assert.equal(first.cooldownUntil <= Date.now() + KEY_COOLDOWN_MAX_MS, true, 'the cap holds even against Retry-After: 600');
  assert.equal(first.resetAt, Date.parse(resetTime), 'resetAt is the epoch-ms moment the quota opens again');
  assert.equal(first.lastErrorCode, 'RATE_LIMIT');
  assert.match(first.lastErrorMessage, /usage limit/);
  assert.equal(first.lastUsedAt, null);
  assert.equal(second.state, 'ready');
  assert.equal(second.cooldownUntil, null);
  assert.equal(third.state, 'error');
  assert.equal(state.activeKeyId, 'row-2');
  assert.equal(JSON.stringify(state).includes('SECRET'), false, 'only prefixes ever leave the store');
  assert.equal(ring.state({ ...c, activeKeyId: 'row-gone' }).activeKeyId, null, 'an active key that left the ring is not reported');
  assert.deepEqual(ring.state({ id: 'legacy' }), { keys: [], activeKeyId: null });
});
