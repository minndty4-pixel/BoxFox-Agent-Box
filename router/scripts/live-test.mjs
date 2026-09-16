// This harness never treats authentication/rate-limit errors as successful inference.
const base = process.env.BOXFOX_ROUTER_URL || 'http://localhost:3100';
const headers = { 'X-BoxFox-Admin': '1', 'Content-Type': 'application/json' };
const report = { ranAt: new Date().toISOString(), source: 'Antigravity live inference', tests: [] };
function result(name, status, detail) { report.tests.push({ name, status, detail }); }
try {
  const stateResponse = await fetch(base + '/api/router/state', { headers, signal: AbortSignal.timeout(5000) });
  if (!stateResponse.ok) throw new Error('Engine administration unavailable.');
  const state = await stateResponse.json();
  const connection = state.connections.find(c => c.providerId === 'antigravity' && c.enabled && c.authState === 'ready' && c.projectState === 'ready' && c.discoveryState === 'ready' && c.models.some(m => m.enabled));
  if (!connection) {
    result('Account/project/model discovery', 'blocked', 'User must log in to Antigravity and finish model discovery.');
    result('JSON inference', 'blocked', 'No eligible live account.'); result('SSE inference', 'blocked', 'No eligible live account.');
  } else {
    result('Account/project/model discovery', 'passed', `Connection ${connection.id}; project and discovery ready. Inference is tested separately.`);
    for (const stream of [false, true]) {
      const name = stream ? 'SSE inference' : 'JSON inference';
      try {
        const response = await fetch(base + '/v1/router/generate', { method: 'POST', headers, body: JSON.stringify({ connectionId: connection.id, modelId: connection.models.find(m => m.enabled).id, messages: [{ role: 'user', content: 'Reply with a short greeting.' }], max_tokens: 128, stream }), signal: AbortSignal.timeout(100000) });
        if (response.status !== 200) { result(name, 'failed', `HTTP ${response.status}; not successful inference.`); continue; }
        if (stream) {
          const text = await response.text(); const chunks = text.split(/\r?\n\r?\n/).filter(x => x.startsWith('data: ') && !x.includes('[DONE]')).map(x => JSON.parse(x.slice(6)));
          const valid = !chunks.some(c => c.error) && chunks.some(c => c.choices?.some(x => typeof x.delta?.content === 'string' && x.delta.content.length > 0)) && chunks.some(c => c.choices?.some(x => x.finish_reason)) && text.includes('data: [DONE]');
          result(name, valid ? 'passed' : 'failed', valid ? `Valid OpenAI SSE; request ${chunks.find(c => c.boxfox)?.boxfox.requestId}.` : 'SSE did not include valid completed content.');
        } else {
          const value = await response.json(); const valid = value.object === 'chat.completion' && typeof value.choices?.[0]?.message?.content === 'string' && value.choices[0].message.content.length > 0 && value.choices[0].finish_reason && value.boxfox?.requestId;
          result(name, valid ? 'passed' : 'failed', valid ? `Valid OpenAI JSON; request ${value.boxfox.requestId}.` : 'No valid completed content.');
        }
      } catch { result(name, 'failed', 'Request failed or timed out. No prompt, response or credential logged.'); }
    }
    result('Quota', connection.quota ? 'passed' : 'skipped', connection.quota ? 'Provider supplied quota data; inspect updatedAt in Provider.' : 'No provider quota data refreshed.');
  }
  for (const name of ['Browser one-turn chat', 'Stop', 'Engine restart/persisted credential', 'Tool-call', 'Disconnect/reconnect']) result(name, 'skipped', 'Requires interactive live acceptance after user login.');
} catch { result('Engine health', 'blocked', 'Start BoxFox Router and frontend first.'); }
console.log(JSON.stringify(report, null, 2));
if (report.tests.some(t => t.status === 'failed')) process.exitCode = 1;
else if (report.tests.some(t => t.status === 'blocked')) process.exitCode = 2;
