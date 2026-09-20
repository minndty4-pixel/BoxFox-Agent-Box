import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouterStore } from '../src/store.mjs';
import { ProviderService } from '../src/service.mjs';
import { RouterEngine } from '../src/engine.mjs';
import { RouterError } from '../src/errors.mjs';
import { createRouterServer } from '../src/server.mjs';
import { openAIToClaudeRequest } from '../src/vendor/9router/openai-to-claude.mjs';
import { claudeFinishReason } from '../src/vendor/9router/claude-to-openai.mjs';
import {
  anthropicError,
  anthropicFrame,
  anthropicStopReason,
  anthropicToOpenAI,
  claudeCliHousekeeping,
  createAnthropicState,
  anthropicApply,
  anthropicMessageBody,
  estimateInputTokens,
  resetThoughtSignatures,
  thoughtSignatureFor,
} from '../src/anthropic.mjs';

const model = { id: 'model-1', name: 'Model', capabilities: { streaming: 'reported', tools: 'reported', vision: 'reported' } };
// A provider stream that exercises every response shape at once: thinking, text
// and a tool call whose id, name and arguments arrive fragmented.
async function* fullStream() {
  yield { type: 'delta', delta: { reasoning_content: 'Thinking about ' } };
  yield { type: 'delta', delta: { reasoning_content: 'the answer.' } };
  yield { type: 'delta', delta: { content: 'Hello ' } };
  yield { type: 'delta', delta: { content: 'world' } };
  yield { type: 'delta', delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] } };
  yield { type: 'delta', delta: { tool_calls: [{ index: 0, function: { arguments: '"fox"}' } }] } };
  yield { type: 'usage', usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } };
  yield { type: 'finish', finishReason: 'tool_calls' };
}
async function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boxfox-anthropic-test-'));
  const store = new RouterStore({ dataDir: dir });
  const calls = [];
  const adapter = {
    discover: async () => ({ models: [model] }),
    quota: async () => null,
    async *generate() { calls.push('generate'); yield* fullStream(); },
    ...overrides,
  };
  const service = new ProviderService({ store, providers: { custom: adapter } });
  const engine = new RouterEngine({ service, deadlineMs: 5000 });
  const connection = service.create({ providerId: 'custom', name: 'Local simulator', endpoint: 'http://127.0.0.1:9999/v1', apiKey: 'SECRET-SIMULATOR' });
  await service.discover(connection.id);
  const key = store.addKey('claude-code', []);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, service, engine, adapter, calls, key, id: service.connection(connection.id).id };
}
async function serve(t, f) {
  const hosts = [];
  const server = createRouterServer({ ...f, oauth: {}, allowedHosts: hosts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  hosts.push(new URL(base).host);
  const headers = { 'Content-Type': 'application/json', 'x-api-key': f.key.key, 'anthropic-version': '2023-06-01' };
  const send = (path, payload, extra = {}) => fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(payload) });
  return { base, headers, send };
}
function frames(text) {
  return text.split('\n\n').filter(Boolean).map(chunk => ({
    event: chunk.match(/^event: (.+)$/m)?.[1],
    data: JSON.parse(chunk.replace(/^event: .+\n/, '').replace(/^data: /, '')),
  }));
}

// ---------------------------------------------------------------------------
// Request translation
// ---------------------------------------------------------------------------

test('Anthropic system, sampling, stop sequences and tool schemas map onto the OpenAI body', () => {
  const translated = anthropicToOpenAI({
    model: 'conn/model',
    max_tokens: 4096,
    temperature: 0.4,
    top_p: 0.9,
    top_k: 20,
    metadata: { user_id: 'u1' },
    system: [{ type: 'text', text: 'You are Claude Code.' }, { type: 'text', text: 'Be brief.' }],
    stop_sequences: ['\n\nHuman:'],
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ name: 'lookup', description: 'Look things up', input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }],
  });
  assert.equal(translated.model, 'conn/model');
  assert.equal(translated.max_tokens, 4096);
  assert.equal(translated.temperature, 0.4);
  assert.equal(translated.top_p, 0.9);
  assert.deepEqual(translated.stop, ['\n\nHuman:']);
  assert.equal(translated.stream, false);
  assert.deepEqual(translated.messages[0], { role: 'system', content: 'You are Claude Code.\nBe brief.' });
  assert.deepEqual(translated.messages[1], { role: 'user', content: 'hello' });
  assert.deepEqual(translated.tools[0], {
    type: 'function',
    function: { name: 'lookup', description: 'Look things up', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
  });
  // Anthropic-only fields have no OpenAI-side equivalent and must not leak upstream.
  for (const field of ['top_k', 'metadata', 'inputs', 'system', 'stop_sequences', 'thinking']) assert.equal(field in translated, false, `${field} dropped`);
});

test('tool_use and tool_result round trip keep ids, names and JSON arguments', () => {
  const translated = anthropicToOpenAI({
    model: 'conn/model',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'what is in the file?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Reading it.' }, { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/tmp/f.txt', limit: 20 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'line one' }, { type: 'text', text: 'anything else?' }] },
    ],
  });
  assert.deepEqual(translated.messages[1], { role: 'assistant', content: 'Reading it.', tool_calls: [{ id: 'toolu_01', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/tmp/f.txt","limit":20}' } }] });
  assert.deepEqual(translated.messages[2], { role: 'tool', tool_call_id: 'toolu_01', content: 'line one' });
  assert.deepEqual(translated.messages[3], { role: 'user', content: 'anything else?' });
  assert.throws(() => anthropicToOpenAI({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'no id' }] }] }), /tool_use_id/);
});

test('a Gemini thought signature survives the Anthropic tool round trip', () => {
  // Gemini providers reject a replayed functionCall that lost its signature, and
  // Anthropic tool_use blocks have no field for it: the ingress remembers it by
  // tool call id and re-attaches it when the id comes back in the next request.
  resetThoughtSignatures();
  const state = createAnthropicState({ id: 'msg_sig', model: 'conn/model', inputTokens: 10 });
  for (const event of [
    { type: 'delta', delta: { tool_calls: [{ index: 0, id: 'call_1032309', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Lisbon"}' }, thought_signature: 'sig-abc' }] } },
    { type: 'finish', finishReason: 'tool_calls' },
  ]) anthropicApply(state, event);
  assert.equal(thoughtSignatureFor('call_1032309'), 'sig-abc');
  assert.equal(anthropicMessageBody(state).content[0].thought_signature, undefined, 'the signature never leaks into the Anthropic body');

  const translated = anthropicToOpenAI({
    model: 'conn/model',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'What is the weather in Lisbon?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1032309', name: 'get_weather', input: { city: 'Lisbon' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1032309', content: '17C and sunny' }] },
    ],
  });
  assert.deepEqual(translated.messages[1].tool_calls[0].thought_signature, 'sig-abc');
  assert.deepEqual(translated.messages[1].tool_calls[0].thoughtSignature, 'sig-abc');

  // A client that echoes the signature on a thinking block is honoured too, and
  // nothing is invented for a call the ingress never saw.
  const echoed = anthropicToOpenAI({
    model: 'conn/model',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig-echo' }, { type: 'tool_use', id: 'toolu_echo', name: 'lookup', input: {} }] },
    ],
  });
  assert.equal(echoed.messages[1].tool_calls[0].thought_signature, 'sig-echo');
  const unsigned = anthropicToOpenAI({
    model: 'conn/model',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_unknown', name: 'lookup', input: {} }] },
    ],
  });
  assert.equal('thought_signature' in unsigned.messages[1].tool_calls[0], false);
  resetThoughtSignatures();
});

test('tool_choice maps auto|any|tool|none and rejects a nameless tool choice', () => {
  const translate = tool_choice => anthropicToOpenAI({ model: 'm', max_tokens: 16, tool_choice, messages: [{ role: 'user', content: 'hi' }] }).tool_choice;
  assert.equal(translate(undefined), undefined);
  assert.equal(translate({ type: 'auto' }), 'auto');
  assert.equal(translate({ type: 'any' }), 'required');
  assert.equal(translate({ type: 'none' }), 'none');
  assert.deepEqual(translate({ type: 'tool', name: 'lookup' }), { type: 'function', function: { name: 'lookup' } });
  // 9Router falls back to auto for unknown shapes; a forced tool is never guessed.
  assert.equal(translate({ type: 'parallel' }), 'auto');
  assert.throws(() => translate({ type: 'tool' }), /needs a name/);
});

test('image blocks become image_url parts; unsupported sources are a clear 400', () => {
  const translated = anthropicToOpenAI({
    model: 'm',
    max_tokens: 32,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAABBBB' } },
      { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
    ] }],
  });
  assert.deepEqual(translated.messages.at(-1), { role: 'user', content: [
    { type: 'text', text: 'look' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAABBBB' } },
    { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
  ] });
  const bad = content => () => anthropicToOpenAI({ model: 'm', max_tokens: 8, messages: [{ role: 'user', content }] });
  assert.throws(bad([{ type: 'image', source: { type: 'file', file_id: 'f1' } }]), /Unsupported Anthropic image source "file"/);
  assert.throws(bad([{ type: 'image', source: { type: 'base64', data: 'x' } }]), /media_type and data/);
  // A screenshot a tool returned cannot ride in an OpenAI tool message; it moves
  // to the user turn that follows, tagged with the call it came from.
  const withToolImage = anthropicToOpenAI({ model: 'm', max_tokens: 32, messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_9', name: 'screenshot', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: [{ type: 'text', text: 'captured' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ZZZ' } }] }] },
  ] });
  assert.deepEqual(withToolImage.messages.at(-2), { role: 'tool', tool_call_id: 'toolu_9', content: 'captured' });
  assert.deepEqual(withToolImage.messages.at(-1), { role: 'user', content: [
    { type: 'text', text: '[Image from tool result toolu_9]' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,ZZZ' } },
  ] });
});

test('thinking maps to the router level, assistant thinking blocks are dropped, unknown blocks are a 400', () => {
  assert.equal(anthropicToOpenAI({ model: 'm', max_tokens: 8, thinking: { type: 'enabled', budget_tokens: 2048 }, messages: [{ role: 'user', content: 'hi' }] }).thinkingLevel, 'low');
  assert.equal(anthropicToOpenAI({ model: 'm', max_tokens: 8, thinking: { type: 'enabled', budget_tokens: 8192 }, messages: [{ role: 'user', content: 'hi' }] }).thinkingLevel, 'medium');
  assert.equal(anthropicToOpenAI({ model: 'm', max_tokens: 8, thinking: { type: 'enabled', budget_tokens: 32000 }, messages: [{ role: 'user', content: 'hi' }] }).thinkingLevel, 'high');
  assert.equal('thinkingLevel' in anthropicToOpenAI({ model: 'm', max_tokens: 8, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'hi' }] }), false);
  const translated = anthropicToOpenAI({ model: 'm', max_tokens: 8, messages: [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'redacted_thinking', data: 'x' }, { type: 'text', text: 'answer' }] },
    { role: 'user', content: 'go on' },
  ] });
  assert.deepEqual(translated.messages[0], { role: 'assistant', content: 'answer' });
  assert.throws(() => anthropicToOpenAI({ model: 'm', max_tokens: 8, messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }] }), /Unsupported Anthropic content block "document"/);
  assert.throws(() => anthropicToOpenAI({ model: 'm', max_tokens: 8, messages: [{ role: 'system', content: 'x' }] }), /at least one user message/);
  assert.throws(() => anthropicToOpenAI({ max_tokens: 8, messages: [{ role: 'user', content: 'x' }] }), /model is required/);
  assert.throws(() => anthropicToOpenAI({ model: 'm', max_tokens: 99999, messages: [{ role: 'user', content: 'x' }] }), /max_tokens must be 1–64000/);
});

test('the ingress request is the inverse of the vendored OpenAI to Anthropic translator', () => {
  const anthropic = {
    model: 'm',
    max_tokens: 2048,
    system: [{ type: 'text', text: 'You are Claude Code.' }],
    tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }],
    messages: [
      { role: 'user', content: [
        { type: 'text', text: 'what is in this image?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_7', name: 'Read', input: { file_path: '/tmp/a.png' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_7', content: 'a fox' }] },
    ],
  };
  const claude = openAIToClaudeRequest(anthropicToOpenAI(anthropic));
  assert.equal(claude.system, 'You are Claude Code.');
  assert.equal(claude.max_tokens, 2048);
  assert.deepEqual(claude.tools, [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }]);
  const blocks = claude.messages.flatMap(message => message.content);
  assert.deepEqual(blocks.find(block => block.type === 'image'), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
  assert.deepEqual(blocks.find(block => block.type === 'tool_use'), { type: 'tool_use', id: 'toolu_7', name: 'Read', input: { file_path: '/tmp/a.png' } });
  assert.deepEqual(blocks.find(block => block.type === 'tool_result'), { type: 'tool_result', tool_use_id: 'toolu_7', content: 'a fox' });
});

// ---------------------------------------------------------------------------
// Response translation
// ---------------------------------------------------------------------------

test('stop reasons map to Anthropic and round trip with the vendored claudeFinishReason', () => {
  assert.equal(anthropicStopReason('stop'), 'end_turn');
  assert.equal(anthropicStopReason('length'), 'max_tokens');
  assert.equal(anthropicStopReason('tool_calls'), 'tool_use');
  assert.equal(anthropicStopReason('tool_use'), 'tool_use');
  assert.equal(anthropicStopReason('content_filter'), 'refusal');
  assert.equal(anthropicStopReason(undefined), 'end_turn');
  assert.equal(anthropicStopReason('something-new'), 'end_turn');
  assert.equal(claudeFinishReason(anthropicStopReason('stop')), 'stop');
  assert.equal(claudeFinishReason(anthropicStopReason('length')), 'length');
  assert.equal(claudeFinishReason(anthropicStopReason('tool_calls')), 'tool_calls');
});

test('the streaming state machine emits Anthropic frames in protocol order', () => {
  const framesOut = [];
  const state = createAnthropicState({ id: 'msg_1', model: 'claude-sonnet-4-5', inputTokens: 30 });
  const feed = event => { for (const frame of anthropicApply(state, event)) framesOut.push(frame); };
  feed({ type: 'delta', delta: { reasoning_content: 'think' } });
  feed({ type: 'delta', delta: { content: 'Hello ' } });
  feed({ type: 'delta', delta: { content: 'world' } });
  feed({ type: 'delta', delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{' } }] } });
  feed({ type: 'delta', delta: { tool_calls: [{ index: 0, function: { arguments: '"q":1}' } }] } });
  feed({ type: 'usage', usage: { prompt_tokens: 30, cached_tokens: 5, completion_tokens: 12 } });
  feed({ type: 'finish', finishReason: 'tool_calls' });
  assert.deepEqual(framesOut.map(frame => frame.type), [
    'message_start',
    'content_block_start', 'content_block_delta', // thinking block
    'content_block_stop',                          // closed when the text block opens
    'content_block_start', 'content_block_delta', 'content_block_delta', // text block
    'content_block_stop',                          // closed at finish
    'content_block_start', 'content_block_delta', 'content_block_stop', // tool block
    'message_delta', 'message_stop',
  ]);
  assert.deepEqual(framesOut[0], { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 0 } } });
  assert.deepEqual(framesOut.map(frame => frame.index).filter(index => index !== undefined), [0, 0, 0, 1, 1, 1, 1, 2, 2, 2]);
  assert.deepEqual(framesOut[1], { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
  assert.deepEqual(framesOut[2].delta, { type: 'thinking_delta', thinking: 'think' });
  assert.deepEqual(framesOut[4], { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
  assert.deepEqual(framesOut[5].delta, { type: 'text_delta', text: 'Hello ' });
  assert.deepEqual(framesOut[8], { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} } });
  assert.deepEqual(framesOut[9].delta, { type: 'input_json_delta', partial_json: '{"q":1}' });
  assert.deepEqual(framesOut[10], { type: 'content_block_stop', index: 2 });
  assert.deepEqual(framesOut[11], { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: 25, output_tokens: 12, cache_read_input_tokens: 5 } });
  assert.deepEqual(framesOut[12], { type: 'message_stop' });
  assert.ok(framesOut.every(frame => frame.index === undefined || Number.isInteger(frame.index)));
  assert.equal(anthropicFrame(framesOut[0]).startsWith('event: message_start\ndata: {'), true);
  assert.equal(anthropicFrame(framesOut.at(-1)), 'event: message_stop\ndata: {"type":"message_stop"}\n\n');
});

test('the non-streaming message object carries text, thinking and parsed tool input', () => {
  const state = createAnthropicState({ id: 'msg_2', model: 'claude-sonnet-4-5', inputTokens: 30 });
  for (const event of [{ type: 'delta', delta: { content: 'Hello ' } }, { type: 'delta', delta: { reasoning_content: 'why' } }, { type: 'delta', delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup', arguments: '{"q":"fox"}' } }] } }, { type: 'usage', usage: { prompt_tokens: 30, completion_tokens: 12 } }, { type: 'finish', finishReason: 'tool_calls' }]) anthropicApply(state, event);
  assert.deepEqual(anthropicMessageBody(state), {
    id: 'msg_2',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [
      { type: 'text', text: 'Hello ' },
      { type: 'thinking', thinking: 'why' },
      { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'fox' } },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 30, output_tokens: 12 },
  });
  const textOnly = createAnthropicState({ id: 'msg_3', model: 'm', inputTokens: 4 });
  for (const event of [{ type: 'delta', delta: { content: 'done' } }, { type: 'finish', finishReason: 'stop' }]) anthropicApply(textOnly, event);
  assert.equal(anthropicMessageBody(textOnly).stop_reason, 'end_turn');
  assert.deepEqual(anthropicMessageBody(textOnly).usage, { input_tokens: 4, output_tokens: 1 });
  // An unparseable argument payload must NOT become a silent `{}`: the caller would run the
  // tool with no parameters and the user would see an unexplainable tool failure.
  const broken = createAnthropicState({ id: 'msg_4', model: 'm' });
  for (const event of [{ type: 'delta', delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 't', arguments: 'not json' } }] } }, { type: 'finish', finishReason: 'tool_calls' }]) anthropicApply(broken, event);
  assert.throws(() => anthropicMessageBody(broken), error => {
    assert.equal(error.code, 'TOOL_ARGUMENTS_INVALID');
    assert.match(error.message, /Tool t returned unparsable arguments: not json/);
    return true;
  });
  // The streamed path still hands the raw buffer to the client as `input_json_delta`, which
  // is the protocol's own mechanism — the loss is visible there, never hidden.
  const streamed = createAnthropicState({ id: 'msg_5', model: 'm' });
  const frames = [];
  for (const event of [{ type: 'delta', delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 't', arguments: 'not json' } }] } }, { type: 'finish', finishReason: 'tool_calls' }]) frames.push(...anthropicApply(streamed, event));
  const delta = frames.find(frame => frame.type === 'content_block_delta' && frame.delta?.type === 'input_json_delta');
  assert.equal(delta.delta.partial_json, 'not json', 'the raw payload reaches the client');
});

test('router errors become Anthropic error bodies with the vendor error types', () => {
  assert.deepEqual(anthropicError(new RouterError('AUTH', 'Valid BoxFox API key required.', 401)), { type: 'error', error: { type: 'authentication_error', message: 'Valid BoxFox API key required.' } });
  assert.equal(anthropicError(new RouterError('MODEL_NOT_FOUND', 'Unknown model.', 404)).error.type, 'not_found_error');
  assert.equal(anthropicError(new RouterError('POLICY_DENIED', 'Denied.', 403)).error.type, 'permission_error');
  assert.equal(anthropicError(new RouterError('RATE_LIMIT', 'Slow down.', 429)).error.type, 'rate_limit_error');
  assert.equal(anthropicError(new RouterError('NO_ROUTE', 'No route.', 503)).error.type, 'api_error');
});

// ---------------------------------------------------------------------------
// HTTP ingress
// ---------------------------------------------------------------------------

test('/v1/messages streams the Anthropic frame order and never sends [DONE]', async t => {
  const f = await fixture(t);
  const { send } = await serve(t, f);
  const response = await send('/v1/messages', {
    model: `${f.id}/${model.id}`,
    max_tokens: 1024,
    stream: true,
    system: [{ type: 'text', text: 'You are Claude Code.' }],
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.match(response.headers.get('request-id'), /^msg_/);
  const text = await response.text();
  assert.equal(text.includes('[DONE]'), false, 'the Anthropic dialect has no [DONE] terminator');
  const parsed = frames(text);
  assert.deepEqual(parsed.map(frame => frame.event), [
    'message_start',
    'content_block_start', 'content_block_delta', 'content_block_delta',
    'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_delta',
    'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_stop',
    'message_delta', 'message_stop',
  ]);
  assert.equal(parsed.every(frame => frame.event === frame.data.type), true, 'the event name matches the payload type');
  assert.equal(parsed[0].data.message.model, `${f.id}/${model.id}`);
  assert.equal(parsed[0].data.message.role, 'assistant');
  assert.equal(parsed[0].data.message.content.length, 0);
  assert.equal(parsed[0].data.message.usage.output_tokens, 0);
  assert.deepEqual(parsed.filter(frame => frame.event === 'content_block_delta').map(frame => frame.data.delta.type), ['thinking_delta', 'thinking_delta', 'text_delta', 'text_delta', 'input_json_delta']);
  const final = parsed.at(-2).data;
  assert.deepEqual(final.delta, { stop_reason: 'tool_use', stop_sequence: null });
  assert.deepEqual(final.usage, { input_tokens: 30, output_tokens: 12 });
});

test('/v1/messages answers a non-streaming Anthropic message object', async t => {
  const f = await fixture(t);
  const { send } = await serve(t, f);
  const response = await send('/v1/messages', { model: `${f.id}/${model.id}`, max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const body = await response.json();
  assert.equal(body.type, 'message');
  assert.equal(body.role, 'assistant');
  assert.equal(body.model, `${f.id}/${model.id}`);
  assert.deepEqual(body.content.map(block => block.type), ['thinking', 'text', 'tool_use']);
  assert.deepEqual(body.content[1], { type: 'text', text: 'Hello world' });
  assert.deepEqual(body.content[2].input, { q: 'fox' });
  assert.equal(body.stop_reason, 'tool_use');
  assert.equal(body.stop_sequence, null);
  assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 12 });
});

test('/v1/messages/count_tokens estimates from system, tools and messages without a provider call', async t => {
  const f = await fixture(t);
  const { send } = await serve(t, f);
  assert.equal(estimateInputTokens({ system: 'abcd', messages: [{ role: 'user', content: 'efgh' }] }), 6);
  const response = await send('/v1/messages/count_tokens', { model: 'claude-sonnet-4-5', system: 'abcd', messages: [{ role: 'user', content: 'efgh' }] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { input_tokens: 6 });
  const withImage = await send('/v1/messages/count_tokens', { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'abcd' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(4000) } }] }] });
  const textOnly = await send('/v1/messages/count_tokens', { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'abcd' }] }] });
  assert.equal((await withImage.json()).input_tokens, (await textOnly.json()).input_tokens, 'image payloads are not counted as text');
  assert.equal(f.calls.length, 0, 'no provider call');
});

test('/v1/messages accepts x-api-key and Bearer and refuses anonymous calls', async t => {
  const f = await fixture(t);
  const { base, send } = await serve(t, f);
  const body = JSON.stringify({ model: `${f.id}/${model.id}`, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
  const bearer = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.key.key}` }, body });
  assert.equal(bearer.status, 200);
  const missing = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { type: 'error', error: { type: 'authentication_error', message: 'Valid BoxFox API key required.' } });
  const wrong = await send('/v1/messages', { model: 'm', max_tokens: 16, messages: [] }, { 'x-api-key': 'bf_not-a-key' });
  assert.equal(wrong.status, 401);
  const counts = await fetch(`${base}/v1/messages/count_tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }) });
  assert.equal(counts.status, 401);
  // The OpenAI-compatible endpoints keep their Bearer-only gate.
  const openai = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': f.key.key }, body });
  assert.equal(openai.status, 401);
});

test('a model the key may not use is refused before any provider call', async t => {
  const f = await fixture(t);
  const restricted = f.store.addKey('restricted', ['some/other-model']);
  const { base } = await serve(t, f);
  const response = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': restricted.key },
    body: JSON.stringify({ model: `${f.id}/${model.id}`, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.type, 'permission_error');
  assert.equal(f.calls.length, 0);
});

test('engine failures reach the client as Anthropic errors, including mid-stream', async t => {
  const f = await fixture(t);
  const { send } = await serve(t, f);
  const unknown = await send('/v1/messages', { model: 'no-such-model', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { type: 'error', error: { type: 'not_found_error', message: 'Unknown model. Use an identifier returned by /v1/models.' } });
  const midstream = await fixture(t, { async *generate() { yield { type: 'delta', delta: { content: 'partial' } }; throw new RouterError('UNAVAILABLE', 'Provider vanished.', 502, true); } });
  const { send: send2 } = await serve(t, midstream);
  const response = await send2('/v1/messages', { model: `${midstream.id}/${model.id}`, max_tokens: 16, stream: true, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(response.status, 200);
  const parsed = frames(await response.text());
  assert.equal(parsed.at(-1).event, 'error');
  assert.equal(parsed.at(-1).data.type, 'error');
  assert.deepEqual(parsed.at(-1).data.error, { type: 'api_error', message: 'Provider vanished.' });
});

// ---------------------------------------------------------------------------
// Claude Code housekeeping
// ---------------------------------------------------------------------------

test('claude-cli housekeeping patterns are recognised, and only for the CLI', () => {
  const userAgent = 'claude-cli/2.0.1 (external, cli)';
  assert.equal(claudeCliHousekeeping({ messages: [{ role: 'user', content: 'Warmup' }] }, userAgent).kind, 'warmup');
  assert.equal(claudeCliHousekeeping({ messages: [{ role: 'user', content: 'count' }] }, userAgent).kind, 'count');
  const title = claudeCliHousekeeping({ messages: [{ role: 'user', content: 'Make a plan for a patient lookup agent' }, { role: 'assistant', content: '{' }] }, userAgent);
  assert.equal(title.kind, 'title');
  assert.equal(JSON.parse(`{${title.text}`).title, 'Make a plan for a patient');
  const instructed = claudeCliHousekeeping({ system: 'Please write a 5-10 word title for the following conversation:', messages: [{ role: 'user', content: '<conversation>Deploy the router</conversation>' }] }, userAgent);
  assert.equal(instructed.text, 'Deploy the router');
  const naming = claudeCliHousekeeping({ system: [{ type: 'text', text: 'Return JSON {"isNewTopic": true}' }], messages: [{ role: 'user', content: 'Fix the router' }] }, userAgent);
  assert.deepEqual(JSON.parse(naming.text), { isNewTopic: true, title: 'Fix the router' });
  // Never swallow a real request: no CLI user agent, a tool-carrying turn, or an
  // unrelated conversation all go to a real model.
  assert.equal(claudeCliHousekeeping({ messages: [{ role: 'user', content: 'Warmup' }] }, 'node-fetch'), null);
  assert.equal(claudeCliHousekeeping({ tools: [{ name: 'Bash', input_schema: {} }], system: 'Please write a 5-10 word title for the following conversation:', messages: [{ role: 'user', content: 'x' }] }, userAgent), null);
  assert.equal(claudeCliHousekeeping({ messages: [{ role: 'user', content: 'explain this repo' }] }, userAgent), null);
  assert.equal(claudeCliHousekeeping({ messages: [{ role: 'assistant', content: 'done' }] }, userAgent), null);
});

test('housekeeping traffic is answered locally with a valid Anthropic response', async t => {
  const f = await fixture(t);
  const { send } = await serve(t, f);
  const warmup = await send('/v1/messages', { model: 'claude-haiku-4-5', max_tokens: 1, stream: true, messages: [{ role: 'user', content: 'Warmup' }] }, { 'user-agent': 'claude-cli/2.0.1 (external, cli)' });
  assert.equal(warmup.status, 200);
  const parsed = frames(await warmup.text());
  assert.deepEqual(parsed.map(frame => frame.event), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.deepEqual(parsed[2].data.delta, { type: 'text_delta', text: 'Warmup acknowledged.' });
  assert.equal(parsed.at(-2).data.delta.stop_reason, 'end_turn');
  assert.equal(parsed.at(-2).data.usage.output_tokens > 0, true);
  const title = await send('/v1/messages', { model: 'claude-haiku-4-5', max_tokens: 32, messages: [{ role: 'user', content: 'Summarise the router ingress work' }, { role: 'assistant', content: '{' }] }, { 'user-agent': 'claude-cli/2.0.1 (external, cli)' });
  const body = await title.json();
  assert.equal(body.type, 'message');
  assert.equal(JSON.parse(`{${body.content[0].text}`).title, 'Summarise the router ingress work');
  assert.equal(f.calls.length, 0, 'housekeeping never reaches a provider');
});

// The sandbox reaches the router only through the docker bridge gateway. The bridge
// listener must bind one explicit private address, stay off by default, and serve the
// INFERENCE endpoints only — the agent in the box is exactly the client it is opened for,
// so the administration surface must never be reachable there.
test('bridge listener is opt-in and binds one private address', async () => {
  const engine = { generate: async function* () { yield { type: 'delta', text: 'hi' }; yield { type: 'finish', reason: 'stop' }; } };
  const service = { active: new Map(), store: { authenticateKey: () => ({ id: 'k' }) }, snapshot: () => ({}), publicModels: () => [] };
  const off = createRouterServer({ service, engine, oauth: { routes: [] }, allowedHosts: ['127.0.0.1:3101'] });
  assert.equal(off.bridge, undefined, 'no bridge server unless the owner opts in');
  const on = createRouterServer({ service, engine, oauth: { routes: [] }, allowedHosts: ['127.0.0.1:3101', '172.18.0.1:3101'], bridgeHost: '172.18.0.1' });
  assert.ok(on.bridge, 'bridge server exists when configured');
  assert.throws(() => createRouterServer({ service, engine, oauth: { routes: [] }, bridgeHost: '0.0.0.0' }), /private or loopback/);
  // A LAN or public address is refused too: the bridge is for the container network only.
  assert.throws(() => createRouterServer({ service, engine, oauth: { routes: [] }, bridgeHost: '8.8.8.8' }), /private or loopback/);
  assert.throws(() => createRouterServer({ service, engine, oauth: { routes: [] }, bridgeHost: '192.0.2.10' }), /private or loopback/);
  for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.4', '172.18.0.1', '172.31.255.254']) {
    const server = createRouterServer({ service, engine, oauth: { routes: [] }, bridgeHost: host });
    assert.ok(server.bridge, `bridge accepts the private address ${host}`);
    server.bridge.close();
    server.close();
  }
});

test('the bridge serves inference only, never the administration surface', async t => {
  const f = await fixture(t);
  const server = createRouterServer({
    service: f.service, engine: f.engine, oauth: { routes: [] },
    allowedHosts: ['127.0.0.1:3101', '172.18.0.1:3101'], bridgeHost: '127.0.0.1',
  });
  t.after(() => { server.bridge.close(); server.close(); });
  await new Promise(resolve => server.bridge.listen(0, '127.0.0.1', resolve));
  // `fetch` refuses to set the Host header, and the server's host allow-list keys on it,
  // so the probe uses node:http directly with `host: '127.0.0.1:3101'` (the allowed value).
  const call = (path, options = {}) => new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: server.bridge.address().port, path, method: options.method || 'GET',
      headers: { host: '127.0.0.1:3101', 'x-boxfox-admin': '1', ...(options.headers || {}) },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(body || '{}') }));
    });
    request.on('error', reject);
    request.end(options.body || '');
  });

  // Inference endpoint: reachable, exactly as on the main listener.
  const models = await call('/v1/models', { headers: { authorization: `Bearer ${f.key.key}` } });
  assert.equal(models.status, 200);
  assert.ok(Array.isArray((await models.json()).data));

  // Everything else is refused, including every admin path the sandbox must not reach.
  for (const [path, options] of [
    ['/api/router/state', {}],
    ['/api/router/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"from-the-box"}' }],
    ['/api/router/connections', {}],
    ['/v1/router/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' }],
    ['/api/router/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' }],
    ['/callback', {}],
  ]) {
    const response = await call(path, options);
    assert.equal(response.status, 404, `${path} must not be served by the bridge`);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  // The bridge refusal is logged, so the owner can see attempts from inside the box.
  const logFile = join(process.env.BOXFOX_SYSTEM_LOG_DIR || join(tmpdir(), 'boxfox-logs'), 'router.jsonl');
  const logged = readFileSync(logFile, 'utf8').trim().split('\n').some(line => line.includes('router.bridge_denied'));
  assert.ok(logged, 'a denied bridge request is recorded in the router log');
});
