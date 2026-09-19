import { RouterError } from '../errors.mjs';

export function baseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function providerError(status, retryable = status === 429 || status >= 500, detail = null) {
  const msgSuffix = detail ? `: ${detail.slice(0, 300)}` : '';
  if (status === 401 || status === 403) return new RouterError('AUTH', `Provider authentication failed${msgSuffix}. Reconnect or replace the credential.`, status, false);
  if (status === 404) return new RouterError('MODEL_NOT_FOUND', `The provider no longer exposes this model${msgSuffix}. Refreshing model inventory may resolve it.`, 404, true);
  if (status === 429) return new RouterError('RATE_LIMIT', `Provider rate limit or quota reached${msgSuffix}. Try again later.`, status, true);
  return new RouterError('UNAVAILABLE', detail ? `Provider error (${status}): ${detail.slice(0, 300)}` : 'Provider is unavailable or returned an invalid response.', status || 502, retryable);
}

export async function ensureOk(response) {
  if (!response.ok) {
    let detail = null;
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        detail = json.error?.message || json.message || text;
      } catch {
        detail = text;
      }
    } catch {}
    throw providerError(response.status, undefined, detail);
  }
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

export function isReasoningModel(id, name = '', capabilities = {}, supportedParams = []) {
  if (capabilities?.reasoning && capabilities.reasoning !== 'unknown') {
    return capabilities.reasoning === 'reported' || Boolean(capabilities.reasoning);
  }
  if (Array.isArray(supportedParams) && (supportedParams.includes('reasoning') || supportedParams.includes('thinking'))) {
    return true;
  }
  const checkStr = `${id || ''} ${name || ''}`.toLowerCase();
  return Boolean(
    /(?:^|[-_/])(r1|o1|o3|o4|deepseek|qwq|claude-3[-.]7|claude-opus-5|claude-sonnet-5|gpt-5|gpt-6|codex|thinking|reasoning|inkling|poolside|flash-thinking)(?:[-_/]|$)/i.test(checkStr) ||
    /think|reason|deepseek|r1|nex-agi|nex-n/i.test(checkStr)
  );
}

export function withThinkingLevels(record, supportedParams = []) {
  const isReasoning = isReasoningModel(record.id, record.name, record.capabilities, supportedParams);
  return {
    ...record,
    ...(isReasoning ? { thinkingLevels: ['low', 'medium', 'high'] } : {}),
  };
}

