import { RouterError } from '../errors.mjs';

export function baseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function providerError(status, retryable = status === 429 || status >= 500) {
  if (status === 401 || status === 403) return new RouterError('AUTH', 'Provider authentication failed. Reconnect or replace the credential.', status, false);
  if (status === 404) return new RouterError('MODEL_NOT_FOUND', 'The provider no longer exposes this model. Refreshing model inventory may resolve it.', 404, true);
  if (status === 429) return new RouterError('RATE_LIMIT', 'Provider rate limit or quota reached. Try again later.', status, true);
  return new RouterError('UNAVAILABLE', 'Provider is unavailable or returned an invalid response.', status || 502, retryable);
}

export async function ensureOk(response) {
  if (!response.ok) throw providerError(response.status);
  return response;
}

export async function jsonOrProviderError(response) {
  await ensureOk(response);
  try { return await response.json(); }
  catch { throw new RouterError('UNAVAILABLE', 'Provider is unavailable or returned an invalid response.', 502, true); }
}

export async function* sseEvents(response) {
  await ensureOk(response);
  if (!response.body) throw new RouterError('UNAVAILABLE', 'Provider is unavailable or returned an invalid response.', 502, true);
  const decoder = new TextDecoder();
  let buffer = '';
  let event = null;
  let data = [];
  const flush = () => {
    if (!data.length && !event) return null;
    const value = { event, data: data.join('\n') };
    event = null; data = [];
    return value;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const match = buffer.match(/\r?\n/);
      if (!match) break;
      const index = match.index;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + match[0].length);
      if (!line) {
        const value = flush();
        if (value) yield value;
        continue;
      }
      if (line.startsWith(':')) continue;
      const split = line.indexOf(':');
      const field = split < 0 ? line : line.slice(0, split);
      const value = split < 0 ? '' : line.slice(split + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  }
  buffer += decoder.decode();
  if (buffer) {
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
  }
  const value = flush();
  if (value) yield value;
}

export function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

export function modelRecord(id, name = id, capabilities = {}) {
  return {
    id,
    name: name || id,
    source: 'live',
    stale: false,
    capabilities: { streaming: 'reported', tools: 'unknown', vision: 'unknown', reasoning: 'unknown', ...capabilities },
  };
}

export function normalizeFinishReason(value) {
  if (value === 'tool_use' || value === 'tool_calls') return 'tool_calls';
  if (value === 'max_tokens' || value === 'length') return 'length';
  if (value === 'content_filter') return 'content_filter';
  return 'stop';
}
