import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProviders } from '../src/providers/index.mjs';
import { createAntigravityAdapter } from '../src/providers/antigravity.mjs';
import { createSafeFetch } from '../src/network.mjs';
import { openAIToGeminiRequest } from '../src/vendor/9router/openai-to-gemini.mjs';
import { cleanJSONSchemaForAntigravity } from '../src/vendor/9router/gemini.mjs';
import { geminiChunkToEvents } from '../src/vendor/9router/gemini-to-openai.mjs';
import { ensureOk, parseRetryAfter, sseEvents } from '../src/providers/common.mjs';
async function collect(iterator) { const values = []; for await (const event of iterator) values.push(event); return values; }
const json = (value, options = {}) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
const messages = [{ role: 'user', content: 'Xin chào 🦊' }];
function splitSSE(frames) { const data = Buffer.from(frames.join('\r\n\r\n') + '\r\n\r\n'); return new Response(new ReadableStream({ start(c) { for (let i = 0; i < data.length; i++) c.enqueue(data.subarray(i, i + 1)); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }); }
test('SSE decoder preserves one-byte UTF8, CRLF and multi-line frames', async () => {
  const events = await collect(sseEvents(splitSSE(['event: delta\r\ndata: {"text":"🦊"}', ': heartbeat\r\ndata: a\r\ndata: b'])));
  assert.equal(events[0].data, '{"text":"🦊"}'); assert.equal(events[1].data, 'a\nb');
});
test('Gemini schema preserves user field names, local refs, nullable unions, arrays and original schema', () => {
  const schema = { type: 'object', $defs: { Value: { type: 'string' } }, properties: { title: { $ref: '#/$defs/Value' }, padding: { anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'string' } }] } }, required: ['title', 'padding', 'missing'] };
  const clean = cleanJSONSchemaForAntigravity(schema); assert.equal(clean.properties.title.type, 'string'); assert.equal(clean.properties.padding.type, 'array'); assert.deepEqual(clean.required, ['title', 'padding']); assert.ok(schema.$defs); assert.equal(clean.$defs, undefined); assert.equal(clean.properties.title.$ref, undefined);
});
test('Gemini translates system, tool IDs/results, ordered roles and function choice', () => {
  const body = { messages: [{ role: 'system', content: 'System' }, ...messages, { role: 'assistant', content: null, tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'lookup', arguments: '{"q":"🦊"}' } }] }, { role: 'tool', tool_call_id: 'call_x', content: '{"value":1}' }], tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }], tool_choice: 'required', max_tokens: 128 };
  const request = openAIToGeminiRequest('model', body); assert.equal(request.systemInstruction.parts[0].text, 'System'); assert.equal(request.contents[1].parts[0].functionCall.id, 'call_x'); assert.equal(request.contents[2].parts[0].functionResponse.id, 'call_x'); assert.equal(request.toolConfig.functionCallingConfig.mode, 'ANY'); assert.equal(request.generationConfig.maxOutputTokens, 128);
  const events = geminiChunkToEvents({ response: { candidates: [{ content: { parts: [{ functionCall: { id: 'upstream-id', name: 'lookup', args: { q: '🦊' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } } }); assert.equal(events[0].delta.tool_calls[0].id, 'upstream-id'); assert.equal(events.at(-1).finishReason, 'tool_calls'); assert.equal(events[1].usage.total_tokens, 7);
  assert.equal(geminiChunkToEvents({ candidates: [{ finishReason: 'MAX_TOKENS' }] })[0].finishReason, 'length'); assert.equal(geminiChunkToEvents({ candidates: [{ finishReason: 'SAFETY' }] })[0].finishReason, 'content_filter');
});
for (const providerId of ['openai', 'custom', 'anthropic', 'gemini']) test(`${providerId}: real local HTTP discovery and JSON/SSE inference translation`, async t => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; const request = raw ? JSON.parse(raw) : {}; received.push({ path: req.url, request, headers: req.headers });
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(providerId === 'gemini' ? { models: [{ name: 'models/text-model', supportedGenerationMethods: ['generateContent'] }] } : { data: [{ id: 'text-model' }] })); return; }
    const stream = request.stream || req.url.includes('streamGenerate'); const gemini = { candidates: [{ content: { parts: [{ text: 'Xin chào 🦊' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 } };
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const frames = providerId === 'anthropic' ? ['event: message_start\ndata: {"message":{"usage":{"input_tokens":2}}}', 'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Xin chào 🦊"}}', 'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}'] : providerId === 'gemini' ? ['data: ' + JSON.stringify(gemini)] : ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'Xin chào 🦊' }, finish_reason: null }] }), 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), 'data: [DONE]'];
      const data = Buffer.from(frames.join('\n\n') + '\n\n'); for (let i = 0; i < data.length; i++) res.write(data.subarray(i, i + 1)); res.end();
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(providerId === 'anthropic' ? { content: [{ type: 'text', text: 'Xin chào 🦊' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 } } : providerId === 'gemini' ? gemini : { choices: [{ message: { content: 'Xin chào 🦊' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const adapter = createProviders({ fetchImpl: createSafeFetch() })[providerId], connection = { id: providerId, providerId, endpoint: `http://127.0.0.1:${server.address().port}/v1` }, credentials = { apiKey: 'test-only-key' };
  assert.equal((await adapter.discover({ connection, credentials })).models[0].id, 'text-model');
  for (const stream of [false, true]) { const events = await collect(adapter.generate({ connection, credentials, body: { model: 'text-model', messages, stream, max_tokens: 128 } })); assert.equal(events.find(e => e.type === 'delta').delta.content, 'Xin chào 🦊'); assert.equal(events.find(e => e.type === 'finish').finishReason, 'stop'); assert.equal(events.find(e => e.type === 'usage').usage.total_tokens, 5); }
  assert.ok(received[1].request.messages || received[1].request.contents); assert.ok(received[1].headers.authorization || received[1].headers['x-api-key'] || received[1].headers['x-goog-api-key']);
});
test('Anthropic tool IDs, split arguments, usage and finish reason survive streaming', async () => {
  const adapter = createProviders({ fetchImpl: async () => splitSSE(['event: message_start\ndata: {"message":{"usage":{"input_tokens":3}}}', 'event: content_block_start\ndata: {"index":2,"content_block":{"type":"tool_use","id":"call_x","name":"lookup"}}', 'event: content_block_delta\ndata: {"index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\""}}', 'event: content_block_delta\ndata: {"index":2,"delta":{"type":"input_json_delta","partial_json":"🦊\\"}"}}', 'event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}']) }).anthropic;
  const events = await collect(adapter.generate({ connection: { endpoint: 'https://example.test' }, credentials: { apiKey: 'test' }, body: { messages, model: 'model', stream: true } })); const tools = events.filter(e => e.type === 'delta').flatMap(e => e.delta.tool_calls); assert.equal(tools[0].id, 'call_x'); assert.equal(tools.map(c => c.function.arguments).join(''), '{"q":"🦊"}'); assert.equal(events.find(e => e.type === 'finish').finishReason, 'tool_calls'); assert.equal(events.at(-1).usage.total_tokens, 7);
});
test('Antigravity OAuth compatible no-PKCE flow and refresh preserves issued client binding/rotation', async () => {
  const calls = []; const adapter = createAntigravityAdapter({ fetchImpl: async (url, init) => { calls.push([url, init]); return url.includes('userinfo') ? json({ email: 'test@example.test' }) : json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }); } });
  const url = new URL(adapter.buildAuthUrl({ state: 'STATE', redirectUri: 'http://localhost:51121/oauth-callback' })); assert.equal(url.searchParams.get('state'), 'STATE'); assert.equal(url.searchParams.has('code_challenge'), false);
  const credentials = await adapter.exchangeCode({ code: 'test-only-code', redirectUri: 'http://localhost:51121/oauth-callback' }); assert.ok(credentials.oauthClient.clientId); assert.equal(credentials.email, 'test@example.test');
  const refreshed = await adapter.refresh({ credentials: { ...credentials, oauthClient: { clientId: 'original-client', clientSecret: 'original-secret' } } }); const request = new URLSearchParams(calls.at(-1)[1].body); assert.equal(request.get('client_id'), 'original-client'); assert.equal(request.get('client_secret'), 'original-secret'); assert.equal(refreshed.refreshToken, 'rotated'); await assert.rejects(adapter.refresh({ credentials: { refreshToken: 'token-without-binding' } }), e => e.status === 401);
});
for (const project of ['project-string', { id: 'project-object' }]) test(`Antigravity project ${typeof project}, real inventory and unknown quota`, async () => {
  const adapter = createAntigravityAdapter({ fetchImpl: async url => url.includes('loadCodeAssist') ? json({ cloudaicompanionProject: project }) : json({ models: { 'gemini-3.8-flash-medium': { displayName: 'Gemini 3.8 Flash Medium', quotaInfo: { remainingFraction: null } }, 'gemini-2.5-pro': {}, 'image-model': {}, 'internal-model': { isInternal: true } } }) });
  const connection = { id: 'account' }, credentials = { accessToken: 'test-only-token' }; const result = await adapter.discover({ connection, credentials }); assert.deepEqual(result.models.map(model => model.id), ['gemini-3.8-flash-medium', 'gemini-3.8-flash']); assert.equal(result.projectId, typeof project === 'string' ? project : project.id); const quota = await adapter.quota({ connection: { projectId: result.projectId, models: result.models }, credentials }); assert.equal(quota.models[0].remainingFraction, null);
});
test('Antigravity done:false polls bounded; settled project retained; BYOP classified; manual project bypasses bootstrap', async () => {
  let onboards = 0; const seen = [];
  const adapter = createAntigravityAdapter({ fetchImpl: async url => { seen.push(url); if (url.includes('loadCodeAssist')) return json({ allowedTiers: [{ id: 'standard', isDefault: true }] }); if (url.includes('onboardUser')) return json(++onboards === 1 ? { done: false } : { done: true, response: { cloudaicompanionProject: { id: 'assigned-project' } } }); return json({ models: { 'gemini-3.8-flash-medium': {} } }); } });
  const credentials = { accessToken: 'test' }; assert.equal((await adapter.discover({ connection: {}, credentials })).projectId, 'assigned-project'); assert.equal(onboards, 2);
  seen.length = 0; await adapter.discover({ connection: { projectId: 'manual-project' }, credentials }); assert.equal(seen.some(url => url.includes('loadCodeAssist') || url.includes('onboardUser')), false);
  const byop = createAntigravityAdapter({ fetchImpl: async url => json(url.includes('onboardUser') ? { done: true } : {}) }); await assert.rejects(byop.discover({ connection: {}, credentials }), e => e.code === 'PROJECT_REQUIRED');
});
test('Antigravity request sessions isolate parallel accounts and never retry after stream content', async () => {
  const calls = []; const adapter = createAntigravityAdapter({ fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body), init.headers.Authorization]); return splitSSE(['data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'partial' }] } }] } }), 'data: not-json']); } });
  const run = id => collect(adapter.generate({ connection: { id, projectId: 'project-' + id }, credentials: { accessToken: 'token-' + id }, body: { model: 'discovered', messages, stream: true }, signal: AbortSignal.timeout(1000) }));
  await Promise.all([assert.rejects(run('one')), assert.rejects(run('two'))]); assert.equal(calls.length, 2); assert.notEqual(calls[0][1].request.sessionId, calls[1][1].request.sessionId); assert.equal(calls[0][1].project, 'project-one'); assert.equal(calls[1][2], 'Bearer token-two');
});
test('Antigravity always uses SSE and retries an empty pre-content response', async () => {
  const calls = [];
  const adapter = createAntigravityAdapter({ fetchImpl: async (url, init) => {
    calls.push([url, init.headers.Accept]);
    if (calls.length === 1) return splitSSE(['data: ' + JSON.stringify({ response: { candidates: [] } })]);
    return splitSSE(['data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'BOXFOX_OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 } } })]);
  } });
  const events = await collect(adapter.generate({ connection: { id: 'account', projectId: 'project' }, credentials: { accessToken: 'token' }, body: { model: 'model', messages, stream: false }, signal: AbortSignal.timeout(5000) }));
  assert.equal(calls.length, 2); assert.ok(calls.every(([url, accept]) => url.includes('streamGenerateContent?alt=sse') && accept === 'text/event-stream'));
  assert.equal(events.find(event => event.type === 'delta').delta.content, 'BOXFOX_OK'); assert.equal(events.find(event => event.type === 'finish').finishReason, 'stop');
});
for (const family of ['3.6', '3.7', '3.8']) for (const level of ['high', 'medium', 'low']) test(`Antigravity ${family} ${level} sends a clean upstream model and native thinking config`, async () => {
  const calls = [];
  const adapter = createAntigravityAdapter({ fetchImpl: async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return splitSSE(['data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'BOXFOX_OK' }] }, finishReason: 'STOP' }] } })]);
  } });
  const publicId = `gemini-${family}-flash-${level}`;
  await collect(adapter.generate({ connection: { id: 'account', projectId: 'project' }, credentials: { accessToken: 'token' }, body: { model: publicId, messages, stream: false, max_tokens: 64 }, signal: AbortSignal.timeout(5000) }));
  const envelope = calls[0];
  assert.equal(envelope.model, family === '3.8' ? publicId : `gemini-${family}-flash-tiered`);
  assert.equal(envelope.model.includes('('), false);
  assert.deepEqual(envelope.request.generationConfig.thinkingConfig, { thinkingLevel: level, includeThoughts: true });
  assert.ok(envelope.request.generationConfig.maxOutputTokens >= ({ low: 8192, medium: 16384, high: 65535 })[level]);
});
test('Antigravity discovery hides legacy/backing models and opens an unknown model only after a successful probe', async () => {
  let probes = 0;
  const adapter = createAntigravityAdapter({ fetchImpl: async url => {
    if (url.includes('loadCodeAssist')) return json({ cloudaicompanionProject: 'project' });
    if (url.includes('fetchAvailableModels')) return json({ models: {
      'gemini-3.8-flash-medium': {}, 'gemini-3.7-flash-tiered': {}, 'gemini-2.5-pro': {}, tab_flash_lite_preview: {}, 'gemini-4-flash-preview': { displayName: 'Gemini 4 Flash Preview' },
    } });
    probes++;
    return splitSSE(['data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'BOXFOX_OK' }] }, finishReason: 'STOP' }] } })]);
  } });
  const result = await adapter.discover({ connection: { id: 'account', models: [] }, credentials: { accessToken: 'token' }, signal: AbortSignal.timeout(5000) });
  assert.equal(probes, 1);
  assert.ok(result.models.some(model => model.id === 'gemini-4-flash-preview' && model.source === 'probe' && model.probeStatus === 'passed'));
  assert.equal(result.models.some(model => model.id === 'gemini-2.5-pro' || model.id.endsWith('-tiered') || model.id.startsWith('tab_')), false);
});
test('Antigravity classifies a 429 invalid-model response as model-not-found, not exhausted quota', async () => {
  const adapter = createAntigravityAdapter({ fetchImpl: async () => json({ error: { message: 'Requested model is not supported' } }, { status: 429 }) });
  await assert.rejects(collect(adapter.generate({ connection: { id: 'account', projectId: 'project' }, credentials: { accessToken: 'token' }, body: { model: 'gemini-4-invalid', messages, stream: false }, signal: AbortSignal.timeout(5000) })), error => error.code === 'MODEL_NOT_FOUND' && error.status === 404);
});
test('Antigravity quota prefers live user buckets and exposes weekly families and paid plan', async () => {
  const adapter = createAntigravityAdapter({ fetchImpl: async url => {
    if (url.includes('retrieveUserQuotaSummary')) return json({ groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'weekly', remainingFraction: 0.4, resetTime: '2030-01-01T00:00:00Z' }] }] });
    if (url.includes('retrieveUserQuota')) return json({ buckets: [{ modelId: 'gemini-3.8-flash-medium', remainingFraction: 0.25, resetTime: '2030-01-02T00:00:00Z' }] });
    if (url.includes('loadCodeAssist')) return json({ cloudaicompanionProject: 'project', currentTier: { id: 'free-tier', name: 'Free' }, paidTier: { id: 'google-ai-pro', name: 'Google AI Pro' } });
    return json({ models: { 'gemini-3.8-flash-medium': { quotaInfo: { remainingFraction: 0.9 } }, 'claude-sonnet-4-6': { quotaInfo: {} } } });
  } });
  const quota = await adapter.quota({ connection: { projectId: 'project', models: [{ id: 'gemini-3.8-flash-medium', source: 'registry' }, { id: 'claude-sonnet-4-6', source: 'registry' }] }, credentials: { accessToken: 'token' } });
  assert.equal(quota.plan, 'Pro'); assert.equal(quota.models.find(value => value.modelId === 'gemini-3.8-flash-medium').remainingFraction, 0.25); assert.equal(quota.models.find(value => value.modelId === 'gemini-3.8-flash-medium').source, 'retrieveUserQuota'); assert.equal(quota.models.find(value => value.modelId === 'gemini-3.8-flash-medium').quotaFamily, 'gemini'); assert.equal(quota.weekly[0].id, 'gemini_weekly');
});
test('Retry-After is read as seconds or an HTTP-date, and reaches the provider error as milliseconds', async () => {
  const failures = async response => ensureOk(response).then(() => null, error => error);
  const seconds = await failures(new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'Retry-After': '90' } }));
  assert.equal(seconds.code, 'RATE_LIMIT'); assert.equal(seconds.retryAfterMs, 90_000);
  assert.equal(seconds.providerMessage, 'slow down', 'the provider’s own words travel beside the router’s wrapped sentence');
  assert.equal(parseRetryAfter(' 45 '), 45_000, 'whitespace and a fractional value are still a number of seconds');
  assert.equal(parseRetryAfter('2.5'), 2_500);
  const date = await failures(new Response('slow down', { status: 429, headers: { 'Retry-After': new Date(Date.now() + 60_000).toUTCString() } }));
  assert.ok(date.retryAfterMs > 50_000 && date.retryAfterMs <= 60_000, 'an HTTP-date becomes the wait until it');
  const garbage = await failures(new Response('failure', { status: 429, headers: { 'Retry-After': 'soon' } }));
  assert.equal(garbage.retryAfterMs, undefined, 'a value nobody can read is no value at all');
  assert.equal(parseRetryAfter(null), null); assert.equal(parseRetryAfter(''), null);
});
for (const status of [400, 401, 403, 429]) test(`provider HTTP ${status} is never successful inference`, async () => {
  const adapter = createProviders({ fetchImpl: async () => new Response('failure', { status }) }).openai; await assert.rejects(collect(adapter.generate({ connection: { endpoint: 'https://example.test' }, credentials: { apiKey: 'test' }, body: { messages, stream: true } })), e => e.status === status);
});
