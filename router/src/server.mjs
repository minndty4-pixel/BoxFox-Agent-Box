import http from 'node:http';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { assert, RouterError, safeError, errorEnvelope } from './errors.mjs';

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  assert((req.headers['content-type'] || '').split(';')[0] === 'application/json', 'JSON content type required.', 'INVALID_REQUEST', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; assert(size <= 1048576, 'Request is too large.', 'INVALID_REQUEST', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert(value && typeof value === 'object' && !Array.isArray(value), 'JSON object required.'); return value; }
  catch (e) { if (e instanceof RouterError) throw e; throw new RouterError('INVALID_REQUEST', 'Invalid JSON.'); }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
export function createRouterServer({ service, engine, oauth, frontendDir = null, allowedOrigins = ['http://localhost:3100', 'http://127.0.0.1:3100'], allowedHosts = ['localhost:3100', '127.0.0.1:3100', 'localhost:3101', '127.0.0.1:3101'] }) {
  function admin(req) {
    assert(req.headers['x-boxfox-admin'] === '1', 'Local administration header required.', 'FORBIDDEN', 403);
    assert(!req.headers.origin || allowedOrigins.includes(req.headers.origin), 'Origin not allowed.', 'FORBIDDEN', 403);
    assert(!req.headers['sec-fetch-site'] || ['same-origin', 'same-site', 'none'].includes(req.headers['sec-fetch-site']), 'Cross-site administration is forbidden.', 'FORBIDDEN', 403);
  }
  async function generate(req, res, input, clientKey) {
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError')); };
    res.on('close', cancel); req.on('aborted', cancel);
    let meta = null, content = '', finishReason = null, usage = null; const toolCalls = new Map();
    const stream = input.stream === true;
    const write = async value => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (!res.write(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)) await once(res, 'drain', { signal: controller.signal });
    };
    const chunk = (delta, reason = null, extra = {}) => ({ id: `chatcmpl-${meta.requestId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: `${meta.connectionId}/${meta.modelId}`, choices: [{ index: 0, delta, finish_reason: reason }], ...extra });
    try {
      for await (const event of engine.generate(input, { key: clientKey, signal: controller.signal })) {
        if (event.type === 'start') { meta = event.meta; if (stream) await write(chunk({ role: 'assistant' }, null, { boxfox: meta })); }
        if (event.type === 'delta') {
          content += event.delta.content || '';
          for (const call of event.delta.tool_calls || []) {
            const index = call.index ?? 0, old = toolCalls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (call.id) old.id = call.id;
            if (call.function?.name) old.function.name += call.function.name;
            old.function.arguments += call.function?.arguments || ''; toolCalls.set(index, old);
          }
          if (stream) await write(chunk(event.delta));
        }
        if (event.type === 'usage') { usage = event.usage; if (stream) await write({ ...chunk({}, null), choices: [], usage }); }
        if (event.type === 'finish') { finishReason = event.finishReason; if (stream) await write(chunk({}, finishReason)); }
      }
      if (stream) { await write('[DONE]'); res.end(); }
      else json(res, 200, { id: `chatcmpl-${meta.requestId}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: `${meta.connectionId}/${meta.modelId}`, choices: [{ index: 0, message: { role: 'assistant', content: content || null, ...(toolCalls.size ? { tool_calls: [...toolCalls.values()] } : {}) }, finish_reason: finishReason }], usage, boxfox: meta });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (res.headersSent) { await write({ ...errorEnvelope(e), boxfox: meta }).catch(() => {}); res.end(); }
      else json(res, safeError(e).status, errorEnvelope(e));
    } finally { res.removeListener('close', cancel); req.removeListener('aborted', cancel); }
  }
  const server = http.createServer(async (req, res) => {
    try {
      assert(allowedHosts.includes(req.headers.host), 'Host not allowed.', 'FORBIDDEN', 403);
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname; const method = req.method;
      if (path === '/api/router/health' && method === 'GET') return json(res, 200, { status: 'ok', version: '0.1.0' });
      if (path.startsWith('/api/router/') || path === '/v1/router/generate') admin(req);
      if (path === '/v1/router/generate' && method === 'POST') {
        const input = await body(req); assert(input.messages?.length === 1 && input.messages[0].role === 'user', 'Router Test accepts exactly one user message.');
        return await generate(req, res, input, null);
      }
      if (path === '/v1/models' || path === '/v1/chat/completions') {
        const key = service.store.authenticateKey((req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1]);
        assert(key, 'Valid BoxFox API key required.', 'AUTH', 401);
        if (path === '/v1/models' && method === 'GET') return json(res, 200, { object: 'list', data: service.publicModels(key) });
        if (path === '/v1/chat/completions' && method === 'POST') return await generate(req, res, await body(req), key);
      }
      if (path === '/v1/messages' && method === 'POST') {
        const rawAuth = req.headers['x-api-key'] || (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
        const key = service.store.authenticateKey(rawAuth);
        assert(key, 'Valid BoxFox API key required.', 'AUTH', 401);
        const input = await body(req);
        const messages = [];
        if (input.system) messages.push({ role: 'system', content: typeof input.system === 'string' ? input.system : String(input.system) });
        for (const m of input.messages || []) {
          const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(c => c?.text || '').join('\n') : '';
          messages.push({ role: m.role, content });
        }
        return await generate(req, res, { ...input, messages }, key);
      }
      if (path === '/api/router/state' && method === 'GET') return json(res, 200, service.snapshot());
      if (path === '/api/router/providers' && method === 'GET') return json(res, 200, service.snapshot().providers);
      const providerDetail = path.match(/^\/api\/router\/providers\/([^/]+)$/);
      if (providerDetail && method === 'GET') return json(res, 200, service.provider(decodeURIComponent(providerDetail[1])));
      if (providerDetail && method === 'PUT') return json(res, 200, service.setProviderConfig(decodeURIComponent(providerDetail[1]), await body(req)));
      if (path === '/api/router/connections' && method === 'GET') return json(res, 200, service.store.list('connection'));
      if (path === '/api/router/connections' && method === 'POST') {
        const created = service.create(await body(req));
        // API providers can expose their inventory immediately. Keep the
        // connection durable when the upstream is temporarily unavailable so
        // the UI can show the discovery error and offer a retry.
        if (created.credentialPresent && created.providerId !== 'antigravity') {
          try { await service.discover(created.id, AbortSignal.timeout(30000)); } catch { /* surfaced on the connection */ }
        }
        return json(res, 201, service.connection(created.id));
      }
      const modelTest = path.match(/^\/api\/router\/connections\/([^/]+)\/models\/([^/]+)\/test$/);
      if (modelTest && method === 'POST') return json(res, 200, await service.testInference(decodeURIComponent(modelTest[1]), decodeURIComponent(modelTest[2]), AbortSignal.timeout(90000)));
      const connection = path.match(/^\/api\/router\/connections\/([^/]+)(?:\/(test|models\/refresh|quota))?$/);
      if (connection) {
        const id = decodeURIComponent(connection[1]);
        if (!connection[2] && method === 'PATCH') return json(res, 200, service.patch(id, await body(req)));
        if (!connection[2] && method === 'DELETE') { service.remove(id); return json(res, 200, { deleted: true }); }
        if (['test', 'models/refresh'].includes(connection[2]) && method === 'POST') return json(res, 200, await service.discover(id, AbortSignal.timeout(60000)));
        if (connection[2] === 'quota' && method === 'GET') return json(res, 200, await service.quota(id, AbortSignal.timeout(20000)));
      }
      if ((path === '/callback' || path === '/auth/callback') && method === 'GET') return await oauth.handleHttpCallback(req, res);
      if (path === '/api/router/oauth/attempts' && method === 'POST') return json(res, 201, await oauth.start((await body(req)).connectionId));
      const attemptCallback = path.match(/^\/api\/router\/oauth\/attempts\/([^/]+)\/callback$/);
      if (attemptCallback && method === 'POST') {
        const payload = await body(req);
        return json(res, 200, await oauth.manualCallback(attemptCallback[1], payload.callbackUrl || payload.code));
      }
      const attempt = path.match(/^\/api\/router\/oauth\/attempts\/([^/]+)$/);
      if (attempt && method === 'GET') return json(res, 200, oauth.get(attempt[1]));
      if (attempt && method === 'DELETE') return json(res, 200, oauth.cancel(attempt[1]));
      if (path === '/api/router/aliases' && method === 'POST') return json(res, 201, service.alias(await body(req)));
      const alias = path.match(/^\/api\/router\/aliases\/([^/]+)$/);
      if (alias && method === 'PATCH') return json(res, 200, service.alias(await body(req), alias[1]));
      if (alias && method === 'DELETE') { service.store.delete('alias', alias[1]); service.repairDefault(); return json(res, 200, { deleted: true }); }
      if (path === '/api/router/default' && method === 'PUT') return json(res, 200, service.setDefault(await body(req)));
      if (path === '/api/router/keys' && method === 'GET') return json(res, 200, service.store.list('key').map(k => service.store.publicKey(k)));
      if (path === '/api/router/keys' && method === 'POST') {
        const value = await body(req); assert(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120, 'Key name required.');
        const allowed = value.allowedModels ?? []; assert(Array.isArray(allowed) && allowed.length <= 200 && allowed.every(m => typeof m === 'string' && service.publicModels(null).some(x => x.id === m)), 'Allowlist must contain enabled model IDs or aliases.');
        return json(res, 201, service.store.addKey(value.name.trim(), [...new Set(allowed)]));
      }
      const key = path.match(/^\/api\/router\/keys\/([^/]+)$/);
      if (key && method === 'DELETE') { const record = service.store.get('key', key[1]); assert(record, 'Key not found.', 'NOT_FOUND', 404); record.enabled = false; service.store.put('key', record); return json(res, 200, { revoked: true }); }
      if (path === '/api/router/usage' && method === 'GET') return json(res, 200, service.store.list('usage').slice(0, 200));
      if (frontendDir && method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/v1/')) {
        const root = resolve(frontendDir), file = resolve(root, `.${decodeURIComponent(path)}`); assert(file === root || file.startsWith(root + sep), 'Invalid path.');
        let target = file; try { if (!(await stat(target)).isFile()) target = resolve(root, 'index.html'); } catch { target = resolve(root, 'index.html'); }
        const data = await readFile(target); res.writeHead(200, { 'Content-Type': `${mime[extname(target)] || 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); return res.end(data);
      }
      throw new RouterError('NOT_FOUND', 'Endpoint not found.', 404);
    } catch (e) { if (!res.headersSent && !res.destroyed) json(res, safeError(e).status, errorEnvelope(e)); else res.end(); }
  });
  server.requestTimeout = 110000; server.headersTimeout = 10000;
  return server;
}
