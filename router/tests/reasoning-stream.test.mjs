// R1 / BUG-2: streamed deltas that carry only `reasoning_content` are client
// output, not noise. They must reach the SSE client, count towards the output
// byte guard, and be collected into the non-stream `message.reasoning_content`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';
import { createRouterServer } from '../src/server.mjs';

const reasoningModel = {
  id: 'reasoning-model',
  name: 'Reasoning model',
  source: 'live',
  stale: false,
  contextWindow: 200000,
  thinkingType: 'effort',
  defaultThinking: 'medium',
  thinkingLevels: ['low', 'medium', 'high'],
  capabilities: { streaming: 'reported', tools: 'reported', vision: 'unsupported' },
};
const thoughts = ['Suy nghĩ một. ', 'Suy nghĩ hai. ', 'Suy nghĩ ba.'];
const expected = thoughts.join('');

async function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-reasoning-test-'));
  const store = new RouterStore({ dataDir: dir });
  const adapter = {
    discover: async () => ({ models: [reasoningModel] }),
    quota: async () => null,
    async *generate() {
      for (const thought of thoughts) yield { type: 'delta', delta: { reasoning_content: thought } };
      yield { type: 'usage', usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, reasoning_tokens: 5 } };
      yield { type: 'finish', finishReason: 'stop' };
    },
    ...overrides,
  };
  const service = new ProviderService({ store, providers: { custom: adapter, openai: adapter } });
  const engine = new RouterEngine({ service, deadlineMs: 5000 });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const connection = service.create({ providerId: 'custom', name: 'Reasoning simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'SECRET-SIMULATOR' });
  await service.discover(connection.id);
  return { dir, store, service, engine, adapter, connection: service.connection(connection.id) };
}

async function events(engine, input, options) {
  const out = [];
  for await (const event of engine.generate(input, options)) out.push(event);
  return out;
}

const request = connectionId => ({ connectionId, modelId: reasoningModel.id, messages: [{ role: 'user', content: 'hello' }], stream: true });

test('reasoning-only deltas are emitted to the client, not filtered away', async t => {
  const f = await fixture(t);
  const out = await events(f.engine, request(f.connection.id));
  const deltas = out.filter(event => event.type === 'delta');
  assert.equal(deltas.length, 3, 'every reasoning-only delta reaches the client');
  assert.deepEqual(deltas.map(event => event.delta.reasoning_content), thoughts);
  assert.equal(deltas.every(event => event.delta.content === undefined), true);
  assert.equal(out[0].type, 'start');
  assert.deepEqual(out.at(-1), { type: 'finish', finishReason: 'stop' });
  assert.equal(f.store.list('usage')[0].status, 'passed');
  assert.equal(f.store.list('usage')[0].reasoningTokens, 5);
});

test('the non-stream HTTP response carries reasoning_content (BUG-2)', async t => {
  const f = await fixture(t);
  const hosts = [];
  const server = createRouterServer({ ...f, oauth: {}, allowedHosts: hosts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  hosts.push(new URL(base).host);
  const headers = { 'X-BoxFox-Admin': '1', 'Content-Type': 'application/json' };
  const input = { ...request(f.connection.id), stream: false };
  const response = await fetch(`${base}/api/router/chat`, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  const result = await response.json();
  const message = result.choices[0].message;
  assert.equal(message.reasoning_content, expected, 'the reasoning accumulator receives the streamed deltas');
  assert.equal(message.content, null);
  assert.equal(result.choices[0].finish_reason, 'stop');
  assert.ok(result.boxfox.requestId);
});

test('the SSE response streams each reasoning-only delta as its own chunk', async t => {
  const f = await fixture(t);
  const hosts = [];
  const server = createRouterServer({ ...f, oauth: {}, allowedHosts: hosts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  hosts.push(new URL(base).host);
  const headers = { 'X-BoxFox-Admin': '1', 'Content-Type': 'application/json' };
  const response = await fetch(`${base}/api/router/chat`, { method: 'POST', headers, body: JSON.stringify(request(f.connection.id)) });
  const text = await response.text();
  assert.ok(text.endsWith('data: [DONE]\n\n'));
  const chunks = text.split('\n\n').map(frame => frame.replace(/^data: /, '')).filter(frame => frame.startsWith('{')).map(frame => JSON.parse(frame));
  const reasoning = chunks.filter(chunk => chunk.choices?.[0]?.delta?.reasoning_content);
  assert.deepEqual(reasoning.map(chunk => chunk.choices[0].delta.reasoning_content), thoughts);
  assert.equal(chunks.some(chunk => chunk.choices?.[0]?.delta?.content), false);
});

test('reasoning deltas count towards the 8 MiB output guard', async t => {
  const megabyte = 'x'.repeat(1024 * 1024);
  const f = await fixture(t, {
    async *generate() {
      yield { type: 'delta', delta: { reasoning_content: megabyte.repeat(4) } };
      yield { type: 'delta', delta: { reasoning_content: megabyte.repeat(5) } };
      yield { type: 'finish', finishReason: 'stop' };
    },
  });
  const seen = [];
  await assert.rejects((async () => {
    for await (const event of f.engine.generate(request(f.connection.id))) seen.push(event);
  })(), error => error.code === 'OUTPUT_LIMIT' && error.status === 502);
  assert.equal(seen.filter(event => event.type === 'delta').length, 1, 'the first 4 MiB delta is below the limit, the second one is not');
  assert.equal(f.store.list('usage')[0].status, 'failed');
});

test('empty deltas are still dropped and never count as a complete response', async t => {
  const f = await fixture(t, {
    async *generate() {
      yield { type: 'delta', delta: { content: '', reasoning_content: '' } };
      yield { type: 'delta', delta: { role: 'assistant' } };
      yield { type: 'finish', finishReason: 'stop' };
    },
  });
  await assert.rejects(events(f.engine, request(f.connection.id)), error => error.code === 'UNAVAILABLE' && error.status === 502);
});
