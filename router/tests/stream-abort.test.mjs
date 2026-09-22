// 9Router v0.5.81: "report aborts after HTTP 200 in-band (per-format error frames)
// instead of closing silently".
//
// Once the response header is out the status code can no longer change, so a stream that
// dies mid-answer has to say so in its own dialect: an OpenAI-compatible client gets the
// error frame first and the `[DONE]` terminator after it (a body that just ends looks like
// a finished answer, and the SDK raises on a payload carrying `error`), an Anthropic client
// gets `event: error` and never a `[DONE]`. Neither dialect may fabricate a successful
// finish_reason/stop_reason (`open-sse/utils/streamHelpers.js:128-158`,
// `open-sse/handlers/chatCore/streamingHandler.js:83-93`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';
import { RouterError } from '../src/errors.mjs';
import { createRouterServer } from '../src/server.mjs';

const model = { id: 'model-1', name: 'Model', capabilities: { streaming: 'reported', tools: 'reported', vision: 'unsupported' } };
const cannotFinish = () => new RouterError('UNAVAILABLE', 'Provider is unavailable or returned an invalid response.', 502, true);

async function fixture(t, overrides = {}, { deadlineMs = 2000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-router-abort-'));
  const store = new RouterStore({ dataDir: dir });
  const adapter = {
    discover: async () => ({ models: [model] }),
    quota: async () => null,
    async *generate() {
      yield { type: 'delta', delta: { role: 'assistant' } };
      yield { type: 'delta', delta: { content: 'Xin chào 🦊' } };
      yield { type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } };
      yield { type: 'finish', finishReason: 'stop' };
    },
    ...overrides,
  };
  const service = new ProviderService({ store, providers: { custom: adapter } });
  const engine = new RouterEngine({ service, deadlineMs });
  const connection = service.create({ providerId: 'custom', name: 'Local simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'SECRET-SIMULATOR' });
  await service.discover(connection.id);
  const key = store.addKey('stream-abort', []);
  const hosts = [];
  const server = createRouterServer({ store, service, engine, oauth: {}, allowedHosts: hosts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  hosts.push(new URL(base).host);
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve)).then(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  });
  const input = { model: `${connection.id}/${model.id}`, messages: [{ role: 'user', content: 'hello' }], stream: true };
  const chat = (body = {}, extra = {}) => fetch(base + '/v1/chat/completions', {
    method: 'POST',
    headers: { Host: hosts[0], Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify({ ...input, ...body }),
  });
  const messages = (body = {}) => fetch(base + '/v1/messages', {
    method: 'POST',
    headers: { Host: hosts[0], 'x-api-key': key.key, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: input.model, max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hello' }], ...body }),
  });
  return { store, service, engine, base, chat, messages, id: service.connection(connection.id).id };
}
/** The `data:` payloads of an OpenAI-dialect SSE body, in order. */
function payloads(text) {
  return text.split('\n\n').filter(Boolean).map(chunk => chunk.replace(/^data: /, ''));
}
function frames(text) {
  return text.split('\n\n').filter(Boolean).map(chunk => ({ event: chunk.match(/^event: (.+)$/m)?.[1], data: JSON.parse(chunk.replace(/^event: .+?\n/, '').replace(/^data: /, '')) }));
}

test('a stream that dies after HTTP 200 reports it in-band, then terminates the OpenAI stream', async t => {
  const f = await fixture(t, { async *generate() { yield { type: 'delta', delta: { content: 'Xin chào' } }; throw cannotFinish(); } });
  const response = await f.chat();
  assert.equal(response.status, 200, 'the status was decided before the stream started');
  const text = await response.text();
  const chunks = payloads(text);
  assert.equal(chunks.at(-1), '[DONE]', 'the terminator still ends the stream');
  assert.equal(JSON.parse(chunks[1]).choices[0].delta.content, 'Xin chào', 'the answer that did arrive stays');
  const error = JSON.parse(chunks.at(-2)).error;
  assert.equal(error.code, 'UNAVAILABLE');
  assert.equal(error.retryable, true);
  assert.ok(chunks.at(-2).includes('"error"'), 'the error frame itself carries the verdict');
  assert.equal(JSON.parse(chunks.at(-2)).boxfox.modelId, model.id, 'the frame names the request it belongs to');
  assert.equal(chunks.slice(0, -2).every(chunk => (JSON.parse(chunk).choices || []).every(choice => choice.finish_reason === null)), true, 'a dead stream never fakes a finish_reason');
});

test('a stream that passes the deadline reports the timeout in-band too', async t => {
  const f = await fixture(t, { async *generate({ signal }) {
    yield { type: 'delta', delta: { content: 'Xin chào' } };
    await new Promise((_, reject) => { const cancel = () => reject(signal.reason); if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true }); });
  } }, { deadlineMs: 300 });
  const chunks = payloads(await (await f.chat()).text());
  assert.equal(JSON.parse(chunks.at(-2)).error.code, 'TIMEOUT', 'the frame before the terminator names the reason');
  assert.equal(chunks.at(-1), '[DONE]');
});

test('a stream that dies after HTTP 200 reports it as an Anthropic error event, never [DONE]', async t => {
  const f = await fixture(t, { async *generate() { yield { type: 'delta', delta: { content: 'Xin chào' } }; throw cannotFinish(); } });
  const response = await f.messages();
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('[DONE]'), false, 'the Anthropic dialect has no terminator to fall back on');
  const parsed = frames(text);
  assert.equal(parsed.at(-1).event, 'error');
  assert.equal(parsed.at(-1).data.type, 'error');
  assert.equal(parsed.at(-1).data.error.type, 'api_error');
  assert.match(parsed.at(-1).data.error.message, /unavailable or returned an invalid response/);
  assert.deepEqual(parsed.slice(0, -1).map(frame => frame.event), ['message_start', 'content_block_start', 'content_block_delta'], 'the frames already sent stay as they were');
  assert.equal(parsed.some(frame => frame.event === 'message_stop'), false, 'a dead stream never claims a completed message');
});

test('a failure before any output keeps the HTTP status, and a normal stream carries no error frame', async t => {
  const early = await fixture(t, { async *generate() { throw cannotFinish(); } });
  const refused = await early.chat();
  assert.equal(refused.status, 502, 'nothing was sent yet, so the status is still the answer');
  assert.equal((await refused.json()).error.code, 'UNAVAILABLE');
  const earlyAnthropic = await early.messages();
  assert.equal(earlyAnthropic.status, 502);
  assert.equal((await earlyAnthropic.json()).type, 'error');

  const healthy = await fixture(t);
  const text = await (await healthy.chat()).text();
  assert.equal(text.includes('"error"'), false);
  assert.equal(text.endsWith('data: [DONE]\n\n'), true);
  const parsed = frames(await (await healthy.messages()).text());
  assert.deepEqual(parsed.map(frame => frame.event).slice(-2), ['message_delta', 'message_stop']);
  assert.equal(parsed.at(-2).data.delta.stop_reason, 'end_turn');
});
