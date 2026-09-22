// Part A / task 7: mỗi dòng usage phải nói được con số tiền của nó ĐẾN TỪ ĐÂU.
// Ba tầng, theo đúng thứ tự ưu tiên: `reported` (nhà cung cấp tự gửi tiền) >
// giá đã chốt trên dòng model (`manual` của người dùng, `ping` của nhà cung cấp,
// `documented` của tài liệu) > không có gì. Tiền không bao giờ được bịa: dòng
// không giải được giá thì `cost` ở lại null, và con số router tự tính mang
// `estimated: true` để không trộn lẫn với số nhà cung cấp gửi.
//
// Fixture hồi quy là bốn dòng dữ liệu thật, ghi trong tests/fixtures/usage-live.json:
// OpenRouter tự báo tiền, DeepSeek chỉ gửi token (tính theo bảng giá công bố),
// Gemini chưa có giá, và một connection thuê bao (costMode `included`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '../src/providers/index.mjs';
import { documentedPricing } from '../src/providers/deepseek.mjs';
import { DEEPSEEK_PRICE_AS_OF } from '../src/pricing.mjs';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';
import { RouterError } from '../src/errors.mjs';
import { costFromUsage, normalizePrice } from '../src/pricing.mjs';

const FIXTURES = JSON.parse(readFileSync(new URL('./fixtures/usage-live.json', import.meta.url), 'utf8'));

const json = (value, options = {}) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
const usageFrame = events => events.find(event => event.type === 'usage')?.usage;
const unreachable = async () => { throw new RouterError('UNAVAILABLE', 'no network in this test', 502); };

/** Router tạm cho mỗi test: store riêng + adapter thật với `fetchImpl` giả. */
function fixture(t, { fetchImpl = unreachable, providers: extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-test-'));
  const store = new RouterStore({ dataDir: dir });
  const service = new ProviderService({ store, providers: { ...createProviders({ fetchImpl }), ...extra } });
  const engine = new RouterEngine({ service, deadlineMs: 5000 });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, service, engine };
}

/** Một lượt gọi một model không stream, thu hết event. */
async function generate(engine, body) {
  const events = [];
  for await (const event of engine.generate(body)) events.push(event);
  return events;
}

const call = (connectionId, modelId) => ({ connectionId, modelId, messages: [{ role: 'user', content: 'hello' }], stream: false });
const lastUsage = store => store.list('usage')[0];

/**
 * Ba tầng của engine, chạy đúng các hàm production: `reportedCost` (tầng
 * `reported`) → `service.priceFor` (giá đã chốt trên dòng model) →
 * `costFromUsage` (phép tính). `at` luôn truyền tay để test không phụ thuộc
 * đồng hồ thật (bảng giá DeepSeek đổi theo giờ cao điểm).
 */
function resolveCost({ service, providerId, modelId, usage, reported = null, costMode = 'metered', price = null, at = new Date() }) {
  if (reported !== null) return { cost: reported, basis: 'reported', estimated: false };
  const adapter = service.providers[providerId];
  const model = {
    id: modelId,
    pricing: price
      ? normalizePrice({ ...price, source: price.source || 'manual' })
      : adapter?.documentedPricing?.({ id: modelId }, new Date()) || null,
  };
  const resolved = service.priceFor(model, { providerId, costMode }, at);
  if (!resolved) return { cost: null, basis: null, estimated: false };
  const calculated = costFromUsage({ usage, price: resolved });
  return calculated ? { cost: calculated.cost, basis: resolved.source, estimated: true } : { cost: null, basis: null, estimated: false };
}

test('the four real-data fixtures are priced exactly as recorded', async t => {
  const f = fixture(t);
  assert.equal(FIXTURES.length, 4, 'the fixture file keeps its four rows');
  for (const row of FIXTURES) {
    const result = resolveCost({
      service: f.service,
      providerId: row.providerId,
      modelId: row.modelId,
      usage: row.usage,
      reported: row.reportedCost ?? null,
      costMode: row.costMode || 'metered',
      price: row.price ?? null,
      at: row.at ? new Date(row.at) : new Date(),
    });
    assert.equal(result.basis, row.expect.basis, `${row.id}: cost basis`);
    if (row.expect.cost === null) assert.equal(result.cost, null, `${row.id}: no number is invented`);
    else assert.ok(Math.abs(result.cost - row.expect.cost) < 1e-9, `${row.id}: expected ${row.expect.cost}, got ${result.cost}`);
  }
});

test('a cost the provider reports is copied with its own basis and never overwritten', async t => {
  const reported = 0.00688541304;
  const usage = { prompt_tokens: 10847, completion_tokens: 544, total_tokens: 11391, cost: reported };
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ data: [{ id: 'deepseek/deepseek-pro-latest' }] })
      : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage })),
  });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  // Ngay cả khi router có giá để tính, số của nhà cung cấp vẫn là số cuối cùng.
  f.service.patch(connection.id, { modelPricing: { modelId: 'deepseek/deepseek-pro-latest', input: 5, output: 5 } });

  const events = await generate(f.engine, call(connection.id, 'deepseek/deepseek-pro-latest'));
  const record = lastUsage(f.store);
  assert.equal(record.cost, reported);
  assert.equal(record.costBasis, 'reported');
  assert.equal(record.estimated, false);
  const frame = usageFrame(events);
  assert.equal(frame.cost, reported, 'the provider’s own figure still travels to the client');
  assert.equal(frame.costBasis, undefined, 'the router does not stamp a basis on a reported number');
  assert.equal(frame.estimated, undefined, 'client frames never carry the estimate flag');
});

test('a price published in the model list prices a row the provider did not cost', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ data: [{ id: 'vendor/model-a', pricing: { prompt: '0.0000005', completion: '0.000002' } }] })
      : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } })),
  });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  const model = f.service.connection(connection.id).models.find(row => row.id === 'vendor/model-a');
  assert.equal(model.pricing.source, 'ping', 'the listing carried a price, so the row does');
  assert.equal(model.pricing.input, 0.5);
  assert.equal(model.pricing.output, 2);

  const events = await generate(f.engine, call(connection.id, 'vendor/model-a'));
  const record = lastUsage(f.store);
  assert.equal(record.costBasis, 'ping');
  assert.equal(record.estimated, true);
  assert.ok(Math.abs(record.cost - 0.0007) < 1e-12, `expected 0.0007, got ${record.cost}`);
  assert.equal(usageFrame(events).cost, undefined, 'the estimate stays inside the router');
});

test('a manual price is what the estimate uses, not the published one', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).includes('/models')
      ? json({ data: [{ id: 'deepseek/deepseek-pro-latest', pricing: { prompt: '0.0000001', completion: '0.0000004' } }] })
      : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, cached_tokens: 800, completion_tokens: 50 } })),
  });
  const connection = f.service.create({ providerId: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.invalid/api/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  f.service.patch(connection.id, { modelPricing: { modelId: 'deepseek/deepseek-pro-latest', input: 0.3, output: 1.2, cachedInput: 0.006 } });

  await generate(f.engine, call(connection.id, 'deepseek/deepseek-pro-latest'));
  const record = lastUsage(f.store);
  assert.equal(record.costBasis, 'manual', 'the user’s price wins over the published one');
  assert.ok(Math.abs(record.cost - 0.000125) < 1e-12, `expected (200×0.3 + 800×0.006 + 50×1.2)/1e6, got ${record.cost}`);
});

test('a manual price shows through the snapshot and a scan never overwrites it', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] })
      : json({ choices: [{ message: { content: 'BOXFOX_OK' }, finish_reason: 'stop' }], usage: { prompt_cache_hit_tokens: 11776, prompt_cache_miss_tokens: 189, completion_tokens: 25, total_tokens: 11990 } })),
  });
  const connection = f.service.create({ providerId: 'deepseek', name: 'DeepSeek', endpoint: 'https://deepseek.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  const row = () => f.service.snapshot().connections.find(entry => entry.id === connection.id).models.find(model => model.id === 'deepseek-flash');
  assert.equal(row().pricing.source, 'documented', 'a scan attaches the documented table');
  assert.equal(row().pricing.currency, 'USD');
  assert.equal(row().pricing.unit, 'per_million_tokens');

  const patched = f.service.patch(connection.id, { modelPricing: { modelId: 'deepseek-flash', input: 0.3, output: 1.2, cachedInput: 0.006 } });
  const manual = patched.models.find(model => model.id === 'deepseek-flash').pricing;
  assert.equal(manual.source, 'manual');
  assert.equal(manual.input, 0.3);
  assert.equal(manual.output, 1.2);
  assert.equal(manual.cachedInput, 0.006);
  assert.equal(manual.asOf, new Date().toISOString().slice(0, 10));
  assert.equal(typeof manual.updatedAt, 'number');
  assert.equal(row().pricing.source, 'manual', 'the manual price survives a re-read');

  await f.service.discover(connection.id);
  const after = row().pricing;
  assert.equal(after.source, 'manual', 'a scan never overwrites a price the user set');
  assert.equal(after.input, 0.3);
  assert.equal(after.output, 1.2);
  assert.equal(after.cachedInput, 0.006);
  assert.equal(after.updatedAt, manual.updatedAt, 'and it is not even restamped');

  f.service.patch(connection.id, { modelPricing: { modelId: 'deepseek-flash', clear: true } });
  const cleared = row().pricing;
  assert.equal(cleared.source, 'documented', 'clearing a manual price hands the row back to the documented table');
  assert.equal(cleared.input, documentedPricing({ id: 'deepseek-flash' }, new Date()).input);
  // Giá tài liệu đóng dấu ngày chốt bảng, không phải ngày chạy: so với hằng của bảng,
  // nếu không ca này chỉ xanh đúng một ngày rồi đỏ (đã xảy ra 2026-09-21).
  assert.equal(cleared.asOf, DEEPSEEK_PRICE_AS_OF);
});

test('a price can be set on a model that only exists because the user typed it', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ error: { message: 'Not Found' } }, { status: 404 })
      : json({ choices: [{ message: { content: 'BOXFOX_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } })),
  });
  const connection = f.service.create({ providerId: 'custom', name: 'TokenHarbor', endpoint: 'https://tokenharbor.ai/v1', apiKey: 'test-only-key' });
  await assert.rejects(f.service.discover(connection.id), error => error.code === 'NO_MODEL_LIST');
  f.service.patch(connection.id, { customModel: { id: 'tokenharbor/qwen3-max' } });
  const patched = f.service.patch(connection.id, { modelPricing: { modelId: 'tokenharbor/qwen3-max', input: 0.4, output: 1.6 } });
  assert.equal(patched.models.find(model => model.id === 'tokenharbor/qwen3-max').pricing.source, 'manual');

  await generate(f.engine, call(connection.id, 'tokenharbor/qwen3-max'));
  const record = lastUsage(f.store);
  assert.equal(record.costBasis, 'manual');
  assert.equal(record.estimated, true);
  assert.ok(Math.abs(record.cost - 0.00056) < 1e-12, `expected (1000×0.4 + 100×1.6)/1e6, got ${record.cost}`);
});

test('a price on an id that is not on the connection names the missing step', async t => {
  const f = fixture(t, { fetchImpl: async () => json({ data: [] }) });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  assert.throws(
    () => f.service.patch(connection.id, { modelPricing: { modelId: 'never-added', input: 1, output: 1 } }),
    error => error.code === 'MODEL_NOT_FOUND' && error.status === 404 && /Add the model id first, then set a price\./.test(error.message),
  );
});

test('an unusable price is refused and the stored one is kept', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ data: [{ id: 'gateway/model-a' }] })
      : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })),
  });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  f.service.patch(connection.id, { modelPricing: { modelId: 'gateway/model-a', input: 1, output: 2 } });
  const cases = [
    { input: 1, output: 2, cachedInput: -1 },
    { input: 'free', output: 2 },
    { input: 1, output: 2000 },
    { input: -1, output: 2 },
    { output: 2 },
  ];
  for (const values of cases) {
    assert.throws(
      () => f.service.patch(connection.id, { modelPricing: { modelId: 'gateway/model-a', ...values } }),
      error => error.code === 'INVALID_PRICE' && error.status === 400 && /Enter an input and an output price in USD per million tokens \(0–1000\)\./.test(error.message),
      `refused: ${JSON.stringify(values)}`,
    );
  }
  const model = f.service.connection(connection.id).models.find(row => row.id === 'gateway/model-a');
  assert.equal(model.pricing.input, 1, 'the price from before the refused patches is untouched');
  assert.equal(model.pricing.output, 2);
});

test('a stored price that no longer parses is dropped instead of shown', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ data: [{ id: 'gateway/model-a' }] })
      : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })),
  });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  f.service.patch(connection.id, { modelPricing: { modelId: 'gateway/model-a', input: 1, output: 2 } });
  const stored = f.service.connection(connection.id);
  stored.models[0].pricing = { input: 'cheap', output: null, source: 'manual' };
  f.store.put('connection', stored);

  // Con số hỏng không bao giờ thành tiền, kể cả trước khi có ai kịp lành nó.
  assert.equal(f.service.priceFor(f.service.connection(connection.id).models[0], f.service.connection(connection.id)), null);
  await generate(f.engine, call(connection.id, 'gateway/model-a'));
  assert.equal(lastUsage(f.store).cost, null, 'an unreadable price is not used to invent a number');
  assert.equal(lastUsage(f.store).costBasis, null);

  // Store cũ/hỏng tự lành khi router dựng lại service (đúng đường `sanitizeAllConnections`
  // của lần khởi động): trường không đọc được bị xoá khỏi dòng model.
  new ProviderService({ store: f.store, providers: f.service.providers });
  assert.equal(f.service.connection(connection.id).models[0].pricing, undefined, 'a price the router cannot read is not displayed as if it were a price');
});

test('DeepSeek rows are priced from the documented table when the provider reports no cost', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ object: 'list', data: [{ id: 'deepseek-flash' }] })
      : json({ choices: [{ message: { content: 'BOXFOX_OK' }, finish_reason: 'stop' }], usage: { prompt_cache_hit_tokens: 11776, prompt_cache_miss_tokens: 189, completion_tokens: 25, total_tokens: 11990 } })),
  });
  const connection = f.service.create({ providerId: 'deepseek', name: 'DeepSeek', endpoint: 'https://deepseek.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  const model = f.service.connection(connection.id).models.find(row => row.id === 'deepseek-flash');
  assert.equal(model.pricing.source, 'documented');

  const tokens = { input: 11965, cached: 11776, output: 25 };
  const offPeak = costFromUsage({ usage: tokens, price: documentedPricing(model, new Date('2026-09-20T03:00:00Z')) }).cost;
  const peak = costFromUsage({ usage: tokens, price: documentedPricing(model, new Date('2026-09-23T02:00:00Z')) }).cost;

  await generate(f.engine, call(connection.id, 'deepseek-flash'));
  const record = lastUsage(f.store);
  assert.equal(record.costBasis, 'documented');
  assert.equal(record.estimated, true);
  assert.ok(record.cost > 0, 'a number is recorded instead of null');
  assert.ok([offPeak, peak].includes(record.cost), `the amount matches the documented row for the hour it ran in (${record.cost})`);
});

test('a subscription connection never records an estimated cost', async t => {
  const adapter = {
    fallbackModels: [],
    async *generate() {
      yield { type: 'delta', delta: { content: 'ok' } };
      yield { type: 'usage', usage: { prompt_tokens: 1000, completion_tokens: 100 } };
      yield { type: 'finish', finishReason: 'stop' };
    },
    quota: async () => ({ updatedAt: new Date().toISOString(), models: [], consumption: null }),
  };
  const f = fixture(t, { providers: { claude: adapter } });
  const connection = f.service.create({ providerId: 'claude' });
  assert.equal(f.service.connection(connection.id).costMode, 'included', 'an account-backed connection is not billed per token');
  // Even a price on the row stays out of the record: the plan is already paid for.
  f.store.saveCredentials(connection.id, { accessToken: 'test-only-token' });
  const stored = f.service.connection(connection.id);
  stored.authState = 'ready';
  stored.discoveryState = 'ready';
  stored.models = [{
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    source: 'live',
    stale: false,
    enabled: true,
    health: 'ready',
    thinkingType: 'none',
    capabilities: { streaming: 'reported', tools: 'unknown', vision: 'unknown', reasoning: 'unknown' },
    pricing: normalizePrice({ input: 3, output: 15, source: 'manual' }),
  }];
  f.store.put('connection', stored);

  await generate(f.engine, call(connection.id, 'claude-sonnet-4-6'));
  const record = lastUsage(f.store);
  assert.equal(record.status, 'passed');
  assert.equal(record.cost, null);
  assert.equal(record.costBasis, null);
  assert.equal(record.estimated, false);
});

test('an included connection still records the cost its own provider reported', async t => {
  let usage = { prompt_tokens: 1000, completion_tokens: 100, cost: 0.0069 };
  const adapter = {
    fallbackModels: [],
    async *generate() {
      yield { type: 'delta', delta: { content: 'ok' } };
      yield { type: 'usage', usage };
      yield { type: 'finish', finishReason: 'stop' };
    },
    quota: async () => ({ updatedAt: new Date().toISOString(), models: [], consumption: null }),
  };
  const f = fixture(t, { providers: { claude: adapter } });
  const connection = f.service.create({ providerId: 'claude' });
  assert.equal(f.service.connection(connection.id).costMode, 'included');
  f.store.saveCredentials(connection.id, { accessToken: 'test-only-token' });
  const stored = f.service.connection(connection.id);
  stored.authState = 'ready';
  stored.discoveryState = 'ready';
  stored.models = [{
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    source: 'live',
    stale: false,
    enabled: true,
    health: 'ready',
    thinkingType: 'none',
    capabilities: { streaming: 'reported', tools: 'unknown', vision: 'unknown', reasoning: 'unknown' },
    pricing: normalizePrice({ input: 3, output: 15, source: 'manual' }),
  }];
  f.store.put('connection', stored);

  // A figure the provider itself sent is a fact, not our arithmetic: it is copied
  // verbatim even on a subscription connection, where our own estimate is suppressed.
  await generate(f.engine, call(connection.id, 'claude-sonnet-4-6'));
  const reported = lastUsage(f.store);
  assert.equal(reported.cost, 0.0069, 'the provider reported this number; the rule that drops `included` estimates must not drop it');
  assert.equal(reported.costBasis, 'reported');
  assert.equal(reported.estimated, false);

  // With nothing reported the exemption stands: the manual price on the row stays out.
  usage = { prompt_tokens: 1000, completion_tokens: 100 };
  await generate(f.engine, call(connection.id, 'claude-sonnet-4-6'));
  const silent = lastUsage(f.store);
  assert.equal(silent.cost, null);
  assert.equal(silent.costBasis, null);
  assert.equal(silent.estimated, false);
});

test('a request whose provider sends no usage keeps cost and its basis empty', async t => {
  const adapter = {
    fallbackModels: [],
    discover: async () => ({ models: [{ id: 'model-a', name: 'Model A', source: 'live' }] }),
    async *generate() {
      yield { type: 'delta', delta: { content: 'ok' } };
      yield { type: 'finish', finishReason: 'stop' };
    },
    quota: async () => ({ updatedAt: new Date().toISOString(), models: [], consumption: null }),
  };
  const f = fixture(t, { providers: { custom: adapter } });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  f.service.patch(connection.id, { modelPricing: { modelId: 'model-a', input: 1, output: 2 } });

  await generate(f.engine, call(connection.id, 'model-a'));
  const record = lastUsage(f.store);
  assert.equal(record.status, 'passed');
  assert.equal(record.cost, null, 'no tokens means no amount, not a zero');
  assert.equal(record.costBasis, null);
  assert.equal(record.estimated, false);
});

test('a fallback target does not inherit the cost of the attempt that failed', async t => {
  const adapter = {
    fallbackModels: [],
    discover: async () => ({ models: [{ id: 'model-a', name: 'Model A', source: 'live' }] }),
    async *generate({ connection }) {
      if (connection.name === 'First') {
        yield { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.5 } };
        throw new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached. Try again later.', 429, true);
      }
      yield { type: 'delta', delta: { content: 'ok' } };
      yield { type: 'usage', usage: { prompt_tokens: 20, completion_tokens: 4 } };
      yield { type: 'finish', finishReason: 'stop' };
    },
    quota: async () => ({ updatedAt: new Date().toISOString(), models: [], consumption: null }),
  };
  const f = fixture(t, { providers: { custom: adapter } });
  const first = f.service.create({ providerId: 'custom', name: 'First', endpoint: 'https://first.invalid/v1', apiKey: 'test-only-key' });
  const second = f.service.create({ providerId: 'custom', name: 'Second', endpoint: 'https://second.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(first.id);
  await f.service.discover(second.id);

  await generate(f.engine, { providerId: 'custom', modelId: 'model-a', messages: [{ role: 'user', content: 'hello' }], stream: false });
  const record = lastUsage(f.store);
  assert.equal(record.status, 'passed');
  assert.equal(record.connectionId, second.id);
  assert.equal(record.modelId, 'model-a');
  assert.equal(record.cost, null, 'the cost of the discarded attempt does not describe this one');
  assert.equal(record.costBasis, null);
  assert.equal(record.estimated, false);
});

test('the public model list stays free of prices', async t => {
  const f = fixture(t, {
    fetchImpl: async url => (String(url).endsWith('/models')
      ? json({ data: [{ id: 'vendor/model-a', pricing: { prompt: '0.0000005', completion: '0.000002' } }] })
      : json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })),
  });
  const connection = f.service.create({ providerId: 'custom', name: 'Gateway', endpoint: 'https://gateway.invalid/v1', apiKey: 'test-only-key' });
  await f.service.discover(connection.id);
  assert.ok(f.service.publicModels().length > 0, 'the listing is not empty');
  for (const model of f.service.publicModels()) assert.equal('pricing' in model, false, `${model.id} carries no price`);
});
