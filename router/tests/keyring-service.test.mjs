// Vòng 29 — ring sống trên storage cũ (`service.mjs`).
//
// Một khoá LÀ một dòng `credentials` đã có sẵn: không dòng nào bị mã hoá lại,
// không khoá nào phải gõ lại. Tệp này kiểm bốn việc mà cả vòng này dựa vào: di
// trú một lần và idempotent, thêm/xoá khoá đổi `credentialPresent`/`authState`
// nhưng không reset `models`, `import` bê nguyên khoá sang connection khác (kể
// cả ciphertext không đổi), và xoá connection không bao giờ lấy đi dòng của
// connection khác.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterError } from '../src/errors.mjs';

const model = { id: 'model-1', name: 'Model', capabilities: { streaming: 'reported', tools: 'reported', vision: 'unsupported' } };
async function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-keyring-'));
  const store = new RouterStore({ dataDir: dir });
  const adapter = {
    discover: async () => ({ models: [model] }),
    quota: async () => null,
    async *generate() { yield { type: 'delta', delta: { content: 'BOXFOX_OK' } }; yield { type: 'finish', finishReason: 'stop' }; },
    ...overrides,
  };
  const service = new ProviderService({ store, providers: { custom: adapter, opencode: adapter, antigravity: adapter } });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const c = service.create({ providerId: 'custom', name: 'Local simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'SECRET-SIMULATOR' });
  await service.discover(c.id);
  return { dir, store, service, adapter, c: service.connection(c.id) };
}
const cipherOf = (store, id) => store.db.prepare('SELECT encrypted FROM credentials WHERE id=?').get(id)?.encrypted ?? null;
/** Snapshot ĐÃ TRANG TRÍ của ring — đúng hình dạng mà giao diện đọc. */
const ringOf = (service, id) => service.connections().find(connection => connection.id === id).keys;

test('the ring is built once from the credential row already on disk — and never for a connection without one', async t => {
  const f = await fixture(t);
  const first = f.service.connection(f.c.id);
  assert.deepEqual(first.keys.map(key => key.id), [f.c.id], 'the existing row keeps its id and becomes the first key');
  assert.equal(first.keys[0].label, 'Local simulator');
  assert.equal(first.keys[0].prefix, 'SECRET…', 'only six characters of the secret ever leave the store');
  const createdAt = first.keys[0].createdAt;
  const again = f.service.connection(f.c.id);
  assert.deepEqual(again.keys[0], first.keys[0], 'reading it twice changes nothing');
  assert.equal(again.keys[0].createdAt, createdAt);

  const anonymous = f.service.create({ providerId: 'opencode' });
  const read = f.service.connection(anonymous.id);
  assert.equal('keys' in read, false, 'no credential row ⇒ no ring: `keys` absent is the legacy shape the UI reads');
  assert.equal(f.store.credentials(anonymous.id), null);

  const snapshot = f.service.snapshot();
  assert.deepEqual(snapshot.connections.find(c => c.id === f.c.id).keys.map(key => key.state), ['ready']);
  assert.equal(snapshot.connections.find(c => c.id === anonymous.id).keys, undefined);
  assert.equal(JSON.stringify(snapshot).includes('SECRET-SIMULATOR'), false, 'a secret never reaches a snapshot');
  assert.equal(f.service.hasCallableKeys(f.c.id), true);
});

test('adding and removing keys moves credentialPresent/authState without touching the model inventory', async t => {
  const f = await fixture(t);
  const before = f.service.connection(f.c.id);
  const added = f.service.addKey(f.c.id, { label: 'Key 2', key: 'SECOND-SECRET' });
  assert.equal(added.keys.length, 2);
  assert.equal(added.keys[1].label, 'Key 2');
  assert.equal(added.keys[1].prefix, 'SECOND…');
  assert.equal(added.keys[1].state, 'ready');
  assert.equal(added.credentialPresent, true);
  assert.equal(added.authState, 'ready');
  assert.deepEqual(added.models.map(m => m.id), before.models.map(m => m.id), 'a new key is not a new endpoint: models stay');
  assert.equal(JSON.stringify(added).includes('SECOND-SECRET'), false);

  const secondRow = added.keys[1].id;
  assert.equal(f.store.credentials(secondRow).apiKey, 'SECOND-SECRET');
  const blob = await f.service.credentials(f.c.id, null, secondRow);
  assert.equal(blob.apiKey, 'SECOND-SECRET');
  assert.equal(blob.id, secondRow, 'the key identity is injected at read time');
  assert.equal(f.store.credentials(secondRow).id, undefined, 'and never written into the blob on disk');
  await assert.rejects(f.service.credentials(f.c.id, null, 'not-a-key'), e => e.code === 'NOT_FOUND' && e.status === 404);

  const labelled = f.service.replaceKey(f.c.id, secondRow, { label: 'Khoá 2' });
  assert.equal(labelled.keys[1].label, 'Khoá 2');
  assert.equal(f.store.credentials(secondRow).apiKey, 'SECOND-SECRET', 'a label change is not a secret change');

  const one = f.service.removeKey(f.c.id, f.c.id);
  assert.deepEqual(one.keys.map(key => key.id), [secondRow]);
  assert.equal(one.authState, 'ready', 'one key left is still a working connection');
  assert.equal(f.store.credentials(f.c.id), null, 'the removed key took its own row with it');

  const empty = f.service.removeKey(f.c.id, secondRow);
  assert.deepEqual(empty.keys, [], 'the last key can go: the ring is empty, the connection stays');
  assert.equal(empty.credentialPresent, false);
  assert.equal(empty.authState, 'required');
  assert.equal(f.service.validTarget({ connectionId: f.c.id, modelId: model.id }), false, 'a connection with no key leaves routing');
  assert.ok(f.service.connection(f.c.id), 'and it is still in the store');
  await assert.rejects(f.service.credentials(f.c.id), e => e.code === 'AUTH' && e.status === 401);
  assert.equal(f.service.keyRing.pick(f.service.connection(f.c.id)), null);
});

test('every key carries its own identity so three keys cannot share one provider session', async t => {
  const f = await fixture(t);
  const added = f.service.addKey(f.c.id, { key: 'aaa-111' });
  const grown = f.service.addKey(f.c.id, { label: 'Key 3', key: 'bbb-222' });
  assert.equal(grown.keys.length, 3);
  const identities = [];
  for (const key of grown.keys) identities.push((await f.service.credentials(f.c.id, null, key.id)).id);
  assert.deepEqual(identities, grown.keys.map(key => key.id));
  assert.equal(new Set(identities).size, 3, 'three keys, three session identities');
  assert.equal(f.store.credentials(f.c.id).apiKey, 'SECRET-SIMULATOR', 'the blobs on disk are exactly as they were');
  const withHeaders = await f.service.credentials(f.c.id);
  assert.equal(withHeaders.id, grown.keys[0].id, 'no keyId means the first key of the ring');
  assert.equal(added.keys.length, 2);
});

test('import moves every key to the end of the target ring, keeps the ciphertext, and refuses the shapes it cannot serve', async t => {
  const f = await fixture(t);
  const target = f.service.create({ providerId: 'custom', name: 'Target', endpoint: f.c.endpoint, apiKey: 'target-secret' });
  await f.service.discover(target.id);
  const source = f.service.create({ providerId: 'custom', name: 'Source (key 2)', endpoint: f.c.endpoint, apiKey: 'source-secret' });
  await f.service.discover(source.id);
  const otherEndpoint = f.service.create({ providerId: 'custom', name: 'Other endpoint', endpoint: 'http://127.0.0.1:9998/v1', apiKey: 'other-secret' });
  const foreignProvider = f.service.create({ providerId: 'opencode' });
  const drySource = f.service.create({ providerId: 'custom', name: 'Drained', endpoint: f.c.endpoint, apiKey: 'drained-secret' });
  f.service.removeKey(drySource.id, drySource.id);

  const before = { target: cipherOf(f.store, target.id), source: cipherOf(f.store, source.id) };
  const imported = f.service.importKeys(target.id, source.id);
  assert.deepEqual(imported.keys.map(key => key.id), [target.id, source.id], 'keys are appended in order, the target keeps the top of the ring');
  assert.equal(imported.keys[1].label, 'Source (key 2)', 'a legacy key keeps its only name it ever had');
  assert.equal(imported.keys[1].prefix, 'source…');
  assert.equal(imported.keys[1].state, 'ready');
  assert.equal(imported.authState, 'ready');
  assert.deepEqual(f.service.connection(source.id).keys, [], 'the source stays alive with an empty ring');
  assert.equal(f.service.connection(source.id).authState, 'required');
  assert.equal(f.service.validTarget({ connectionId: source.id, modelId: model.id }), false);
  assert.equal(cipherOf(f.store, source.id), before.source, 'no re-encrypt: the ciphertext of the moved row is byte-identical');
  assert.equal(cipherOf(f.store, target.id), before.target);
  assert.equal((await f.service.credentials(target.id, null, source.id)).apiKey, 'source-secret', 'the moved key still opens its own row');
  assert.equal(JSON.stringify(f.service.snapshot()).includes('source-secret'), false);

  const refuses = async (run, code, status, message) => {
    await assert.rejects(run, error => error.code === code && error.status === status && message.test(error.message));
  };
  await refuses(async () => f.service.importKeys(target.id, ''), 'INVALID_REQUEST', 400, /Choose a connection to move keys from/);
  await refuses(async () => f.service.importKeys(target.id, target.id), 'INVALID_REQUEST', 400, /Choose a different connection/);
  await refuses(async () => f.service.importKeys(target.id, 'missing-source'), 'NOT_FOUND', 404, /Connection not found/);
  await refuses(async () => f.service.importKeys('missing-target', target.id), 'NOT_FOUND', 404, /Connection not found/);
  await refuses(async () => f.service.importKeys(target.id, foreignProvider.id), 'INVALID_REQUEST', 400, /same provider/);
  await refuses(async () => f.service.importKeys(target.id, otherEndpoint.id), 'INVALID_REQUEST', 400, /same endpoint/);
  await refuses(async () => f.service.importKeys(target.id, drySource.id), 'INVALID_REQUEST', 400, /no key to move/);
  f.service.patch(drySource.id, { enabled: false });
  const disabled = f.service.patch(target.id, { enabled: false });
  assert.equal(disabled.enabled, false);
  await refuses(async () => f.service.importKeys(target.id, drySource.id), 'INVALID_REQUEST', 400, /Enable the target connection/);
  f.service.patch(target.id, { enabled: true });
  for (let index = 0; index < 8; index += 1) f.service.addKey(target.id, { key: `padded-${index}` });
  assert.equal(f.service.connection(target.id).keys.length, 10);
  await refuses(async () => f.service.importKeys(target.id, f.c.id), 'INVALID_REQUEST', 400, /at most 10 keys/);
});

test('a connection with keys refuses deletion, and a shell whose ring is empty never takes another connection’s row', async t => {
  const f = await fixture(t);
  await assert.rejects(async () => f.service.remove(f.c.id), error => error.code === 'KEYS_PRESENT' && error.status === 409 && /keys on this connection/.test(error.message));

  const target = f.service.create({ providerId: 'custom', name: 'Target', endpoint: f.c.endpoint, apiKey: 'target-secret' });
  const source = f.service.create({ providerId: 'custom', name: 'Source', endpoint: f.c.endpoint, apiKey: 'source-secret' });
  f.service.importKeys(target.id, source.id);
  f.service.remove(source.id);
  assert.equal(f.store.credentials(source.id).apiKey, 'source-secret', 'deleting the emptied shell left the row it no longer owns alone');
  assert.deepEqual(f.service.connection(target.id).keys.map(key => key.id), [target.id, source.id]);
  assert.equal((await f.service.credentials(target.id, null, source.id)).apiKey, 'source-secret', 'the target still serves the moved key');
  await assert.rejects(async () => f.service.remove(target.id), error => error.code === 'KEYS_PRESENT' && error.status === 409);
  f.service.removeKey(target.id, source.id);
  assert.equal(f.store.credentials(source.id), null, 'dropping the key from its new home drops the shared row — nobody else referenced it');
  await assert.rejects(async () => f.service.remove(target.id), error => error.code === 'KEYS_PRESENT' && error.status === 409, 'the target still holds its own key');
  f.service.removeKey(target.id, target.id);
  f.service.remove(target.id);
  await assert.rejects(async () => f.service.connection(target.id), error => error.code === 'NOT_FOUND' && error.status === 404);
  assert.equal(f.store.credentials(target.id), null);
});

test('“try now” clears one key’s cooldown and reports no probe when no model is named', async t => {
  const f = await fixture(t);
  const added = f.service.addKey(f.c.id, { key: 'second-secret' });
  const keyId = added.keys[1].id;
  f.service.keyRing.park(keyId, { retryAfterMs: 600_000, error: { code: 'RATE_LIMIT', message: 'Free usage limit reached for this session.' }, modelId: model.id });
  const parked = ringOf(f.service, f.c.id)[1];
  assert.equal(parked.state, 'exhausted');
  assert.equal(parked.cooldownUntil > Date.now(), true);
  assert.equal(f.service.keyRing.lastError(f.service.connection(f.c.id)).code, 'RATE_LIMIT');

  const result = await f.service.tryKey(f.c.id, keyId);
  assert.equal(result.probe, null, 'no model named ⇒ no provider call, just a cleared key');
  assert.equal(result.connection.activeKeyId, keyId);
  assert.equal(result.connection.keys[1].state, 'ready');
  assert.equal(result.connection.keys[1].cooldownUntil, null);
  assert.equal(result.connection.keys[1].lastErrorCode, null);
  await assert.rejects(async () => f.service.tryKey(f.c.id, 'not-a-key'), error => error.code === 'NOT_FOUND' && error.status === 404);
});

test('a probe pinned to one key goes out with that key’s identity, and a 429 parks it again', async t => {
  const seen = []; let attempts = 0;
  const f = await fixture(t, { async *generate({ credentials }) {
    seen.push(credentials.id); attempts += 1;
    if (attempts === 1) throw new RouterError('RATE_LIMIT', 'Free usage limit reached for this session.', 429, true);
    yield { type: 'delta', delta: { content: 'BOXFOX_OK' } };
    yield { type: 'finish', finishReason: 'stop' };
  } });
  const added = f.service.addKey(f.c.id, { key: 'second-secret' });
  const keyId = added.keys[1].id;
  await assert.rejects(f.service.tryKey(f.c.id, keyId, { modelId: model.id }), error => error.code === 'RATE_LIMIT' && error.status === 429);
  assert.deepEqual(seen, [keyId], 'the probe went out with the key that was tried, not with the connection’s first key');
  const parked = ringOf(f.service, f.c.id)[1];
  assert.equal(parked.state, 'exhausted', 'a probe 429 parks the key by the same rule as a normal turn');
  assert.equal(parked.cooldownUntil > Date.now(), true);
  const passed = await f.service.tryKey(f.c.id, keyId, { modelId: model.id });
  assert.equal(passed.probe.status, 'passed');
  assert.equal(passed.connection.activeKeyId, keyId);
  assert.deepEqual(seen, [keyId, keyId], 'pinning a key is what makes the second probe use it again');
  assert.equal(f.store.credentials(f.c.id).apiKey, 'SECRET-SIMULATOR', 'neither probe touched the other key’s row');
});
