// Round 15: DeepSeek documents its own reasoning controls, so the router must not
// publish the generic OpenAI-compatible effort list for it.
//
// Docs (`api-docs.deepseek.com/api/create-chat-completion`, read 2026-09-20):
// `reasoning_effort` values are `none|low|high|max`, `none` disables thinking,
// the default effort is `high`, and `minimal`/`medium`/`xhigh` are compatibility
// aliases mapped to `low`/`high`. Live probe on the real key the same day: every
// accepted value answers 200, `none` answers without `reasoning_content`, an
// unknown value answers 422, and a restricted `tool_choice` answers 400 unless
// thinking is off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '../src/providers/index.mjs';
import { DEEPSEEK_THINKING_LEVELS } from '../src/providers/deepseek.mjs';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';

const json = (value, options = {}) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
const messages = [{ role: 'user', content: 'Xin chào 🦊' }];
const connection = { id: 'deepseek-connection', providerId: 'deepseek', endpoint: 'https://api.deepseek.com/v1' };
const credentials = { apiKey: 'test-only-key' };
const completion = () => json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

async function collect(iterator) {
  const values = [];
  for await (const event of iterator) values.push(event);
  return values;
}

function recorder(response) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.body) calls.push(typeof init.body === 'string' ? JSON.parse(init.body) : init.body);
    return response(url);
  };
  return { calls, fetchImpl };
}

async function send(body) {
  const { calls, fetchImpl } = recorder(completion);
  const adapter = createProviders({ fetchImpl }).deepseek;
  await collect(adapter.generate({ connection, credentials, body: { model: 'deepseek-flash', messages, stream: false, ...body } }));
  return calls[0];
}

test('DeepSeek discovers the documented level set, default and capabilities', async () => {
  const data = [{ id: 'deepseek-flash', object: 'model', owned_by: 'deepseek' }, { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' }];
  const adapter = createProviders({ fetchImpl: async url => (url.includes('/models') ? json({ object: 'list', data }) : completion()) }).deepseek;
  const { models } = await adapter.discover({ connection, credentials });
  assert.deepEqual(models.map(m => m.id), ['deepseek-flash', 'deepseek-v4-pro']);
  for (const model of models) {
    assert.equal(model.thinkingType, 'effort', `${model.id} takes an effort level`);
    assert.deepEqual(model.thinkingLevels, [...DEEPSEEK_THINKING_LEVELS], `${model.id} publishes none/low/high/max only`);
    assert.deepEqual(model.thinkingLevels, ['none', 'low', 'high', 'max']);
    assert.equal(model.defaultThinking, 'high', 'the documented default effort is high');
    assert.equal(model.contextWindow, null, 'the payload carries no context length, so none is invented');
    assert.equal(model.capabilities.tools, 'reported');
  }
  assert.equal(models[0].capabilities.vision, 'reported', 'flash reads images (documented and probed)');
  assert.equal(models[1].capabilities.vision, 'unsupported', 'v4-pro answers image requests with a wrong answer, not an error');
});

test('the shared OpenAI-compatible adapter keeps its own list', async () => {
  const fetchImpl = async url => (url.includes('/models') ? json({ data: [{ id: 'gpt-5.4' }] }) : completion());
  const providers = createProviders({ fetchImpl });
  const openai = await providers.openai.discover({ connection: { ...connection, providerId: 'openai' }, credentials });
  assert.deepEqual(openai.models[0].thinkingLevels, ['minimal', 'low', 'medium', 'high'], 'the DeepSeek rule is scoped to the DeepSeek adapter');
});

test('DeepSeek sends reasoning_effort and never thinkingLevel', async () => {
  const low = await send({ thinkingLevel: 'low' });
  assert.equal(low.reasoning_effort, 'low');
  assert.equal('thinkingLevel' in low, false);
  assert.equal('thinking' in low, false);
  assert.equal((await send({ thinkingLevel: 'high' })).reasoning_effort, 'high');
  assert.equal((await send({ thinkingLevel: 'max' })).reasoning_effort, 'max');
});

test('none switches thinking off instead of sending nothing', async () => {
  for (const level of ['none', 'NONE', ' none ']) {
    const request = await send({ thinkingLevel: level });
    assert.equal(request.reasoning_effort, 'none', `level ${level} keeps DeepSeek's documented switch-off`);
  }
});

test('the documented aliases collapse and an unknown level is never forwarded', async () => {
  assert.equal((await send({ thinkingLevel: 'minimal' })).reasoning_effort, 'low');
  assert.equal((await send({ thinkingLevel: 'medium' })).reasoning_effort, 'high');
  assert.equal((await send({ thinkingLevel: 'xhigh' })).reasoning_effort, 'high');
  for (const level of ['bogus', 'ultra', undefined, 'auto']) {
    const request = await send(level === undefined ? {} : { thinkingLevel: level });
    assert.equal('reasoning_effort' in request, false, `level ${level} stays with the provider default`);
  }
  assert.equal((await send({ reasoning_effort: 'low' })).reasoning_effort, 'low', 'a caller that speaks the provider field directly still works');
});

test('a restricted tool_choice turns thinking off, which is the documented remedy', async () => {
  for (const tool_choice of ['required', { type: 'required' }, { type: 'function', function: { name: 'get_time' } }]) {
    const request = await send({ thinkingLevel: 'high', tools: [{ type: 'function', function: { name: 'get_time' } }], tool_choice });
    assert.equal(request.reasoning_effort, 'none', `tool_choice ${JSON.stringify(tool_choice)} disables thinking`);
  }
  for (const tool_choice of ['auto', 'none', undefined]) {
    const request = await send({ thinkingLevel: 'high', tool_choice });
    assert.equal(request.reasoning_effort, 'high', 'an unrestricted choice keeps the level');
  }
});

test('a stored DeepSeek row heals to the documented metadata', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-deepseek-'));
  const store = new RouterStore({ dataDir: dir });
  const providers = createProviders({ fetchImpl: async url => (url.includes('/models') ? json({ data: [{ id: 'deepseek-flash' }] }) : completion()) });
  const service = new ProviderService({ store, providers });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const created = service.create({ providerId: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', apiKey: 'test-only-key' });
  await service.discover(created.id);
  assert.deepEqual(service.connection(created.id).models[0].thinkingLevels, [...DEEPSEEK_THINKING_LEVELS]);
  const stale = service.connection(created.id);
  stale.models[0].thinkingLevels = ['minimal', 'low', 'medium', 'high'];
  stale.models[0].defaultThinking = null;
  store.put('connection', stale);
  const healed = service.sanitizeConnection(service.connection(created.id));
  assert.deepEqual(healed.models[0].thinkingLevels, [...DEEPSEEK_THINKING_LEVELS], 'the adapter re-derives its own metadata');
  assert.equal(healed.models[0].defaultThinking, 'high');
  assert.equal(healed.models[0].thinkingType, 'effort');
});

test('a hand-typed DeepSeek model publishes the documented levels, max included', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-deepseek-manual-'));
  const store = new RouterStore({ dataDir: dir });
  const providers = createProviders({ fetchImpl: async url => (url.includes('/models') ? json({ data: [{ id: 'deepseek-flash' }] }) : completion()) });
  const service = new ProviderService({ store, providers });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const created = service.create({ providerId: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', apiKey: 'test-only-key' });
  const patched = service.patch(created.id, { customModel: { id: 'deepseek-next', name: 'DeepSeek next', capabilities: { reasoning: true } } });
  const manual = patched.models.find(m => m.id === 'deepseek-next');
  assert.equal(manual.source, 'custom');
  assert.equal(manual.enabled, true);
  assert.deepEqual(manual.thinkingLevels, [...DEEPSEEK_THINKING_LEVELS], 'the manual rule publishes the documented set');
  assert.ok(manual.thinkingLevels.includes('max'), 'the max level DeepSeek documents is offered');
  assert.equal(manual.thinkingLevels.includes('medium'), false, 'no compatibility alias is advertised as a native level');
  assert.equal(manual.thinkingType, 'effort');
  // The two mechanisms must agree: normalizing the row keeps the same set, so a
  // hand-typed model does not change its levels when the router restarts.
  const healed = service.sanitizeConnection(service.connection(created.id)).models.find(m => m.id === 'deepseek-next');
  assert.deepEqual(healed.thinkingLevels, manual.thinkingLevels);
});

test('the manual rule stays generic for every other provider, with no max', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-manual-generic-'));
  const store = new RouterStore({ dataDir: dir });
  const providers = createProviders({ fetchImpl: async url => (url.includes('/models') ? json({ data: [{ id: 'model-1' }] }) : completion()) });
  const service = new ProviderService({ store, providers });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const created = service.create({ providerId: 'custom', name: 'Local simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'test-only-key' });
  const reasoning = service.patch(created.id, { customModel: { id: 'manual-reasoner', capabilities: { reasoning: true } } });
  assert.deepEqual(reasoning.models.find(m => m.id === 'manual-reasoner').thinkingLevels, ['auto', 'low', 'medium', 'high'], 'only DeepSeek gains max');
  const plain = service.patch(created.id, { customModel: { id: 'manual-plain' } });
  assert.deepEqual(plain.models.find(m => m.id === 'manual-plain').thinkingLevels, [], 'a model without reasoning publishes no level');
  assert.equal(plain.models.find(m => m.id === 'manual-plain').thinkingType, 'none');
});
