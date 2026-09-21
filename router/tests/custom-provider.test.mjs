// Part A / tasks 1–3: người dùng tự khai một endpoint OpenAI-compatible bên thứ
// ba (URL + key). Router phải nói RÕ vì sao việc dò danh sách model thất bại —
// không có đường dẫn /models, danh sách rỗng, trả về không phải JSON, hay lời
// của chính cổng (sai key / tài khoản chưa xác minh) — và khi cổng không có danh
// sách thì người dùng gõ tay từng id rồi bấm Test để biết tên + key + cấu hình có
// hợp lệ. Id gõ tay được lưu, gửi và hiển thị NGUYÊN VĂN: không chuẩn hoá, không
// đổi dấu, không thêm bớt tiền tố.
//
// Fixture hồi quy là cổng TokenHarbor thật (connection
// 6c498e9d-f581-455c-849c-e24c37f25ae5, endpoint https://tokenharbor.ai/v1):
// trước khi tài khoản được xác minh, `GET /v1/models` trả HTTP 403 với thân
// `{"error":{"message":"Verify your email address to use the API. …",
//   "type":"email_verification_required","code":"email_verification_required"}}`
// và router phơi ra thành "Provider authentication failed: Verify your email
// address to use the API. … Reconnect or replace the credential."
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '../src/providers/index.mjs';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';

const json = (value, options = {}) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
const MODEL_ID = 'tokenharbor/qwen3-max';
const ENDPOINT = 'https://tokenharbor.ai/v1';
const completion = () => json({ choices: [{ message: { content: 'BOXFOX_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

/**
 * Stub cổng bên thứ ba: `models` trả lời `GET /models`, `completion` trả lời
 * `POST /chat/completions`, và mọi request được ghi lại (url + body) để khoá
 * đúng id router gửi lên.
 */
function endpointStub({ models, completion: answer }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : null });
    return String(url).endsWith('/models') ? models() : answer();
  };
  return { calls, fetchImpl };
}

/** Một connection `custom` trong store tạm, đúng khuôn các file test đã có. */
function fixture(t, stub) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-test-'));
  const store = new RouterStore({ dataDir: dir });
  const providers = createProviders({ fetchImpl: stub.fetchImpl });
  const service = new ProviderService({ store, providers });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const created = service.create({ providerId: 'custom', name: 'TokenHarbor', endpoint: ENDPOINT, apiKey: 'test-only-key' });
  return { store, service, created };
}

const notFound = () => json({ error: { message: 'Not Found' } }, { status: 404 });

test('a /models 404 names the missing listing instead of a generic outage', async t => {
  const stub = endpointStub({ models: notFound, completion });
  const f = fixture(t, stub);
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST' && error.status === 404);
  const connection = f.service.connection(f.created.id);
  assert.equal(connection.discoveryState, 'failed');
  assert.match(connection.error, /does not expose a \/models listing/);
  assert.match(connection.error, /Add each model id by hand and test it\./);
  assert.deepEqual(connection.models, [], 'nothing is invented when the endpoint lists nothing');
  assert.equal(typeof connection.lastDiscoveryAttemptAt, 'number', 'the attempt is stamped even when it fails');
  assert.equal(f.service.snapshot().connections.some(c => c.id === f.created.id), true, 'the connection stays durable for the retry button');
});

test('a 403 keeps the gateway message verbatim (the TokenHarbor case)', async t => {
  const body = { error: { message: 'Verify your email address to use the API.', type: 'email_verification_required', code: 'email_verification_required' } };
  const stub = endpointStub({ models: () => json(body, { status: 403 }), completion });
  const f = fixture(t, stub);
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'AUTH' && error.status === 403);
  const connection = f.service.connection(f.created.id);
  assert.equal(connection.discoveryState, 'failed');
  assert.match(connection.error, /Provider authentication failed: Verify your email address to use the API\./, 'the provider’s own sentence survives');
  assert.equal(connection.authState, 'expired', 'a rejected key is account-level evidence');
  assert.deepEqual(connection.models, []);
  assert.equal(typeof connection.lastDiscoveryAttemptAt, 'number');
});

test('an empty model list is named, with the hand-typed path suggested', async t => {
  const stub = endpointStub({ models: () => json({ object: 'list', data: [] }), completion });
  const f = fixture(t, stub);
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODELS' && error.status === 502);
  const connection = f.service.connection(f.created.id);
  assert.equal(connection.discoveryState, 'failed');
  assert.match(connection.error, /The endpoint returned an empty model list\. Add each model id by hand and test it\./);
  assert.deepEqual(connection.models, []);
});

test('a 200 that is not JSON points at the base URL', async t => {
  const stub = endpointStub({ models: () => new Response('<html>gateway</html>', { status: 200 }), completion });
  const f = fixture(t, stub);
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'UNAVAILABLE');
  const connection = f.service.connection(f.created.id);
  assert.equal(connection.discoveryState, 'failed');
  assert.match(connection.error, /did not return a model list in JSON\. Check that the base URL points at the right path \(usually ends with \/v1\)\./);
});

test('every provider on the shared OpenAI adapter gets the same classification', async () => {
  const adapter = status => createProviders({ fetchImpl: async () => json({ error: {} }, { status }) });
  // `custom` is the user-declared endpoint; `openai` and `deepseek` share the
  // adapter, so a gateway without /models must read the same for all of them.
  for (const providerId of ['custom', 'openai', 'deepseek']) {
    const connection = { id: `${providerId}-connection`, providerId, endpoint: ENDPOINT };
    await assert.rejects(adapter(404)[providerId].discover({ connection, credentials: { apiKey: 'test-only-key' } }), error => error.code === 'NO_MODEL_LIST');
    await assert.rejects(adapter(403)[providerId].discover({ connection, credentials: { apiKey: 'test-only-key' } }), error => error.code === 'AUTH');
  }
});

test('a hand-typed model id is stored, sent and displayed verbatim', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  const patched = f.service.patch(f.created.id, { customModel: { id: 'tokenharbor/qwen3-max' } });
  const model = patched.models.find(m => m.id === 'tokenharbor/qwen3-max');
  assert.ok(model, 'the row exists under the exact id the user typed');
  assert.equal(model.id, 'tokenharbor/qwen3-max', 'the id is compared with assert.equal, not includes');
  assert.equal(model.source, 'custom');
  assert.equal(model.enabled, true);
  assert.equal(model.stale, false);
  assert.equal(f.service.connection(f.created.id).models.find(m => m.id === 'tokenharbor/qwen3-max').id, 'tokenharbor/qwen3-max', 'the store keeps the same spelling after a re-read');
});

test('a blank model id is refused with INVALID_MODEL', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  for (const id of ['   ', '']) {
    assert.throws(() => f.service.patch(f.created.id, { customModel: { id } }), error => error.code === 'INVALID_MODEL' && error.status === 400, `id ${JSON.stringify(id)} is refused`);
  }
  assert.throws(() => f.service.patch(f.created.id, { customModel: { id: 'bad\u0007id' } }), error => error.code === 'INVALID_MODEL', 'control characters are refused');
  assert.throws(() => f.service.patch(f.created.id, { customModel: { id: 'x'.repeat(192) } }), error => error.code === 'INVALID_MODEL', 'an over-long id is refused');
  assert.deepEqual(f.service.connection(f.created.id).models, [], 'nothing reached the connection');
});

test('a passing probe sends the hand-typed id byte for byte', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });
  const result = await f.service.testInference(f.created.id, MODEL_ID);
  assert.equal(result.status, 'passed');
  const probe = stub.calls.find(call => call.url.endsWith('/chat/completions'));
  assert.equal(probe.body.model, MODEL_ID, 'the router sends the id exactly as typed');
  assert.deepEqual(probe.body.messages, [{ role: 'user', content: 'Reply exactly: BOXFOX_OK' }]);
  assert.equal(probe.body.max_tokens, 64);
  assert.equal(probe.body.stream, false);
  const connection = f.service.connection(f.created.id);
  const model = connection.models.find(m => m.id === MODEL_ID);
  assert.equal(model.probeStatus, 'passed');
  assert.equal(model.health, 'ready');
  assert.equal(typeof model.lastProbe.latencyMs, 'number');
  assert.equal(connection.inferenceState, 'ready');
});

test('a 404 on a hand-typed id answers "is this name right?"', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion: () => json({ error: { message: 'model “tokenharbor/qwen3-max” not found' } }, { status: 404 }) });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });
  await assert.rejects(f.service.testInference(f.created.id, MODEL_ID), error => error.status === 404);
  assert.equal(stub.calls.find(call => call.url.endsWith('/chat/completions')).body.model, MODEL_ID, 'the failing probe also carries the id byte for byte');
  const connection = f.service.connection(f.created.id);
  const model = connection.models.find(m => m.id === MODEL_ID);
  assert.equal(model.health, 'unavailable');
  assert.equal(model.lastProbe.status, 'failed');
  assert.match(model.lastProbe.error, /The endpoint did not recognise this model id\. The router sends the id exactly as typed: tokenharbor\/qwen3-max/);
  assert.match(model.lastProbe.error, /not found/, 'the gateway’s own words are appended when it sent any');
  assert.notEqual(connection.authState, 'expired', 'a missing model is not an expired account');
});

test('a model the user turned off can still be tested', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });
  f.service.patch(f.created.id, { enabledModelIds: [] });
  assert.equal(f.service.connection(f.created.id).models.find(m => m.id === MODEL_ID).enabled, false);
  const result = await f.service.testInference(f.created.id, MODEL_ID);
  assert.equal(result.status, 'passed', 'the probe is about the id, not about the enable switch');
  assert.equal(f.service.connection(f.created.id).models.find(m => m.id === MODEL_ID).probeStatus, 'passed');
});

test('testing an id that is not on the connection names the missing step', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  await assert.rejects(f.service.testInference(f.created.id, 'never-added'), error => error.code === 'MODEL_NOT_FOUND' && error.status === 404 && /This model is not on the connection\. Add the model id first, then test it\./.test(error.message));
  assert.equal(stub.calls.some(call => call.url.endsWith('/chat/completions')), false, 'nothing is sent upstream for an unknown id');
});

test('a hand-typed model survives a failed scan and is never marked stale', async t => {
  const stub = endpointStub({ models: notFound, completion });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID, capabilities: { reasoning: true } } });
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST');
  const connection = f.service.snapshot().connections.find(c => c.id === f.created.id);
  const model = connection.models.find(m => m.id === MODEL_ID);
  assert.ok(model, 'the id the user typed is still stored after the scan failed');
  assert.equal(model.source, 'custom');
  assert.equal(model.stale, false, 'a hand-typed row never came from a scan, so it cannot go stale');
  assert.equal(model.enabled, true);
  assert.match(connection.error, /does not expose a \/models listing/);
  assert.equal(typeof connection.lastDiscoveryAttemptAt, 'number');
});

test('the connection carries the billing mode the cost labels need', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  assert.equal(f.service.connection(f.created.id).costMode, 'metered', 'a self-declared API endpoint is billed per token');
  const subscription = f.service.create({ providerId: 'claude' });
  assert.equal(f.service.connection(subscription.id).costMode, 'included', 'an account-backed connection is not a metered one');
  // A record written before these fields existed heals on read instead of
  // showing up as `undefined` in the UI.
  const stale = f.service.connection(f.created.id);
  delete stale.costMode;
  delete stale.lastDiscoveryAttemptAt;
  f.store.put('connection', stale);
  const healed = f.service.sanitizeConnection(f.service.connection(f.created.id));
  assert.equal(healed.costMode, 'metered');
  assert.equal(healed.lastDiscoveryAttemptAt, null, 'no attempt has been recorded yet');
  assert.equal(f.service.snapshot().connections.find(c => c.id === f.created.id).costMode, 'metered', 'the healed value is persisted');
});

// Hai lỗi của luồng "gõ tay": (1) `validTarget` đòi `discoveryState === 'ready'`,
// nên một endpoint không có `/models` không bao giờ định tuyến được đúng cái id
// người dùng vừa khai và vừa Test thành công; (2) một lần dò lại thành công thay
// cả danh sách model và âm thầm xoá những dòng gõ tay. Dòng gõ tay là lời khai
// của người dùng, không phải kết quả dò, nên nó phải định tuyến được và phải
// sống sót qua lần dò — trong khi mọi luật còn lại giữ nguyên.
test('a hand-typed model is routable when the endpoint has no model listing', async t => {
  const stub = endpointStub({ models: notFound, completion });
  const f = fixture(t, stub);
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST');
  assert.equal(f.service.connection(f.created.id).discoveryState, 'failed');
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });

  assert.equal(f.service.validTarget({ connectionId: f.created.id, modelId: MODEL_ID }), true, 'the id the user typed is a route');
  assert.ok(f.service.publicModels().some(model => model.id === `${f.created.id}/${MODEL_ID}`), 'and clients can select it');
  const engine = new RouterEngine({ service: f.service, deadlineMs: 5000 });
  const events = [];
  for await (const event of engine.generate({ connectionId: f.created.id, modelId: MODEL_ID, messages: [{ role: 'user', content: 'hello' }], stream: false })) events.push(event);
  assert.ok(events.some(event => event.type === 'finish'), 'the request runs instead of ending in "no target available"');
  assert.equal(stub.calls.find(call => call.url.endsWith('/chat/completions')).body.model, MODEL_ID);
});

test('a hand-typed model still obeys every other routing rule', async t => {
  const stub = endpointStub({ models: notFound, completion: () => json({ error: { message: 'model not found' } }, { status: 404 }) });
  const f = fixture(t, stub);
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST');
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });
  const routable = () => f.service.validTarget({ connectionId: f.created.id, modelId: MODEL_ID });
  assert.equal(routable(), true);

  f.service.patch(f.created.id, { enabledModelIds: [] });
  assert.equal(routable(), false, 'a model the user turned off is not a target');
  await assert.rejects(f.service.testInference(f.created.id, MODEL_ID), error => error.status === 404);
  f.service.patch(f.created.id, { enabledModelIds: [MODEL_ID] });
  assert.equal(f.service.connection(f.created.id).models.find(model => model.id === MODEL_ID).health, 'unavailable');
  assert.equal(routable(), false, 'a probe the endpoint refused takes the row out of routing until it passes');

  f.service.patch(f.created.id, { enabled: false });
  assert.equal(routable(), false, 'a disabled connection routes nothing');
  f.service.patch(f.created.id, { enabled: true });
  const expired = f.service.connection(f.created.id);
  expired.authState = 'expired';
  f.store.put('connection', expired);
  assert.equal(routable(), false, 'a rejected key is still a rejected key');
});

test('a discovered row still needs a successful scan to be routable', async t => {
  const stub = endpointStub({ models: () => json({ data: [{ id: 'gateway/model-a' }] }), completion });
  const f = fixture(t, stub);
  await f.service.discover(f.created.id);
  assert.equal(f.service.connection(f.created.id).models[0].source, 'live');
  assert.equal(f.service.validTarget({ connectionId: f.created.id, modelId: 'gateway/model-a' }), true);
  const downgraded = f.service.connection(f.created.id);
  downgraded.discoveryState = 'failed';
  f.store.put('connection', downgraded);
  assert.equal(f.service.validTarget({ connectionId: f.created.id, modelId: 'gateway/model-a' }), false, 'only a hand-typed row may be routed without a successful scan');
});

test('a successful scan keeps the models the user typed by hand', async t => {
  let listing = [{ id: 'gateway/model-a' }, { id: 'gateway/model-b' }];
  const stub = endpointStub({ models: () => json({ data: listing }), completion });
  const f = fixture(t, stub);
  await f.service.discover(f.created.id);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID, capabilities: { reasoning: true } } });
  f.service.patch(f.created.id, { enabledModelIds: ['gateway/model-a', MODEL_ID] });

  const refreshed = await f.service.discover(f.created.id);
  const kept = refreshed.models.find(model => model.id === MODEL_ID);
  assert.ok(kept, 'the id the user typed survives a 200 refresh');
  assert.equal(kept.source, 'custom');
  assert.equal(kept.enabled, true, 'and keeps the enable flag the user chose');
  assert.equal(kept.thinkingType, 'effort', 'and the metadata of the hand-typed row');
  assert.deepEqual(refreshed.models.map(model => model.id).sort(), [MODEL_ID, 'gateway/model-a', 'gateway/model-b'].sort(), 'no row is invented and none is dropped');
  assert.equal(refreshed.models.find(model => model.id === 'gateway/model-b').enabled, false, 'the choice the user made about a discovered row stands too');

  // Một model thật sự rời danh sách vẫn bị xoá: dòng gõ tay là ngoại lệ, không
  // phải luật mới cho mọi dòng.
  listing = [{ id: 'gateway/model-a' }];
  const second = await f.service.discover(f.created.id);
  assert.deepEqual(second.models.map(model => model.id).sort(), [MODEL_ID, 'gateway/model-a'].sort());
  assert.equal(f.service.validTarget({ connectionId: f.created.id, modelId: MODEL_ID }), true, 'the hand-typed row is still routable after the refresh');
});

// Ba lỗi lộ ra trong vòng kiểm chứng 17 (F1/F2/F3). Mỗi lỗi có một ca ở đây
// trước khi sửa, và mỗi ca khoá lại đúng hành vi mà kế hoạch đã hứa.
//
// F1: `capabilities` chỉ được ghi ở nhánh TẠO MỚI, nên gõ lại một id đã có chỉ
// đổi được `name` — hai ô Vision/Reasoning trong form là đường một chiều.
test('re-declaring an id the user already typed rewrites name and both declared flags', async t => {
  const stub = endpointStub({ models: () => json({ data: [] }), completion });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID, name: 'First spelling', capabilities: { vision: true, reasoning: false } } });
  const first = f.service.connection(f.created.id).models.filter(model => model.id === MODEL_ID);
  assert.equal(first.length, 1, 'a re-declaration never adds a second row');
  assert.equal(first[0].name, 'First spelling');
  assert.equal(first[0].capabilities.vision, 'reported', 'the vocabulary the UI reads: declared evidence is `reported`');
  assert.equal(first[0].capabilities.reasoning, 'unknown');
  assert.deepEqual(first[0].thinkingLevels, [], 'a row that does not reason publishes no level');

  f.service.patch(f.created.id, { customModel: { id: MODEL_ID, name: 'Second spelling', capabilities: { vision: false, reasoning: true } } });
  const second = f.service.connection(f.created.id).models.filter(model => model.id === MODEL_ID);
  assert.equal(second.length, 1, 'the correction edits the same row');
  assert.equal(second[0].name, 'Second spelling', 'the name follows the newest declaration');
  assert.equal(second[0].capabilities.vision, 'unknown', 'a wrong Vision box can be corrected');
  assert.equal(second[0].capabilities.reasoning, 'reported');
  assert.equal(second[0].thinkingType, 'effort', 'the metadata matches the flag that was just declared');
  assert.deepEqual(second[0].thinkingLevels, ['auto', 'low', 'medium', 'high'], 'the shared adapter’s own set for a generic OpenAI-compatible endpoint');
});

// F2: một connection đã có dòng gõ tay bước vào lần `Refresh models` hỏng đầu
// tiên đã ra `discoveryState: 'degraded'` (catch giữ danh sách cũ) — trạng thái
// mà `validTarget` không nhận, nên đúng một cú bấm đưa id gõ tay từ 200 xuống
// 503 mà không nói vì sao.
test('a failed refresh leaves a hand-typed model routable', async t => {
  const stub = endpointStub({ models: notFound, completion });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST');
  assert.equal(f.service.connection(f.created.id).discoveryState, 'degraded', 'the failed scan keeps the row it did not find');

  const connection = f.service.connection(f.created.id);
  assert.match(connection.error, /does not expose a \/models listing/);
  assert.equal(connection.models.find(model => model.id === MODEL_ID).stale, false);
  assert.equal(f.service.validTarget({ connectionId: f.created.id, modelId: MODEL_ID }), true, 'a failed refresh must not take the typed id off the routes');
  assert.ok(f.service.publicModels().some(model => model.id === `${f.created.id}/${MODEL_ID}`), 'and clients still see it');

  const engine = new RouterEngine({ service: f.service, deadlineMs: 5000 });
  const events = [];
  for await (const event of engine.generate({ connectionId: f.created.id, modelId: MODEL_ID, messages: [{ role: 'user', content: 'hello' }], stream: false })) events.push(event);
  assert.ok(events.some(event => event.type === 'finish'), 'the request runs instead of ending in NO_ROUTE');

  // Một connection chưa từng có danh sách nào vẫn đi qua đúng trạng thái `failed`
  // như trước: `degraded` chỉ là hình dạng của cùng lần dò hỏng khi còn dòng cũ.
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST');
  assert.equal(f.service.connection(f.created.id).discoveryState, 'degraded');
  assert.equal(f.service.validTarget({ connectionId: f.created.id, modelId: MODEL_ID }), true, 'and it stays routable after a second failed refresh');
});

// F3: một probe đạt xoá `error`, nên khối "Models could not be listed" biến mất
// dù đường dò danh sách vẫn hỏng. Phép thử đạt là bằng chứng cho MỘT model.
test('a passing probe does not wipe the listing failure it did not fix', async t => {
  const stub = endpointStub({ models: notFound, completion });
  const f = fixture(t, stub);
  f.service.patch(f.created.id, { customModel: { id: MODEL_ID } });
  await assert.rejects(f.service.discover(f.created.id), error => error.code === 'NO_MODEL_LIST');
  const result = await f.service.testInference(f.created.id, MODEL_ID);
  assert.equal(result.status, 'passed');

  const connection = f.service.connection(f.created.id);
  assert.equal(connection.inferenceState, 'ready');
  assert.equal(connection.discoveryState, 'degraded');
  assert.equal(connection.models.find(model => model.id === MODEL_ID).probeStatus, 'passed');
  assert.match(connection.error, /does not expose a \/models listing/, 'the reason the listing failed is still on the record');
});
