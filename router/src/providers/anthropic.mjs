import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents, baseUrl } from './common.mjs';

const ANTHROPIC_VERSION = '2023-06-01';
function headers(apiKey) { return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' }; }

/**
 * BUG-4/R2: Anthropic's `/models` payload carries neither a context window nor
 * thinking metadata, so the record uses Anthropic's published controls: a
 * 200K-token window for Claude 4.x, 1M when the id carries the long-context
 * `[1m]` marker, and token-budget thinking with the low/medium/high budget map.
 */
export function thinkingFromAnthropicId(id) {
  const longContext = /\[1m\]/i.test(String(id || ''));
  return {
    contextWindow: longContext ? 1_000_000 : 200_000,
    thinkingType: 'budget',
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinking: null,
  };
}

function toAnthropic(body) {
  const system = [];
  const messages = [];
  for (const message of body.messages || []) {
    if (message.role === 'system' || message.role === 'developer') { const text = typeof message.content === 'string' ? message.content : (message.content || []).filter(p => p?.type === 'text').map(p => p.text).join(''); if (text) system.push(text); continue; }
    if (message.role === 'tool') {
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '') }] });
      continue;
    }
    const content = [];
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(p => p?.type === 'text').map(p => p.text).join('') : '';
    if (text) content.push({ type: 'text', text });
    if (message.role === 'assistant') for (const call of message.tool_calls || []) content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input: parseJson(call.function?.arguments || '{}') || {} });
    if (content.length) messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
  }
  const request = { model: body.model, messages, max_tokens: body.max_tokens || 4096 };
  if (system.length) request.system = system.join('\n');
  if (body.temperature !== undefined) request.temperature = body.temperature;
  if (body.top_p !== undefined) request.top_p = body.top_p;
  if (body.tools?.length) request.tools = body.tools.map(tool => ({ name: tool.function.name, description: tool.function.description || '', input_schema: tool.function.parameters || { type: 'object', properties: {} } }));
  if (body.tool_choice && request.tools) request.tool_choice = typeof body.tool_choice === 'object' ? { type: 'tool', name: body.tool_choice.function?.name } : { type: body.tool_choice === 'required' ? 'any' : body.tool_choice };

  // R3 mapping for the `budget` thinking type: Anthropic spends
  // `thinking.budget_tokens` instead of an effort level. low/medium/high map to
  // 2048/8192/16384. A `fixed` model already carries its level in the model id,
  // so nothing is sent for it, and `none` never sends a thinking block.
  const level = body.thinkingLevel;
  if (level && level !== 'none' && level !== 'auto' && body.thinkingType !== 'fixed') {
    const budget = level === 'low' ? 2048 : level === 'medium' ? 8192 : 16384;
    request.thinking = { type: 'enabled', budget_tokens: budget };
    if (request.max_tokens <= budget) {
      request.max_tokens = budget + 4096;
    }
  }
  return request;
}

export function createAnthropicAdapter({ fetchImpl }) {
  return {
    // Stored rows are re-derived from the model id when the service normalizes a
    // connection (BUG-4/R2).
    thinkingMetadata: model => thinkingFromAnthropicId(model?.id),
    async discover({ connection, credentials, signal }) {
      const data = await jsonOrProviderError(await fetchImpl(`${baseUrl(connection.endpoint)}/models`, { headers: headers(credentials.apiKey), signal }));
      const list = Array.isArray(data?.data) ? data.data : [];
      // BUG-4/R2: `/models` reports no context/thinking metadata, so the record
      // follows Anthropic's documented controls (200K window, 1M with the `[1m]`
      // long-context marker, token-budget thinking).
      return { models: list.map(item => modelRecord(item?.id, item?.display_name || item?.id, { tools: 'reported' }, thinkingFromAnthropicId(item?.id))).filter(m => m.id) };
    },
    async *generate({ connection, credentials, body, signal }) {
      const stream = body.stream !== false;
      const request = { ...toAnthropic(body), stream };
      const response = await fetchImpl(`${baseUrl(connection.endpoint)}/messages`, { method: 'POST', headers: headers(credentials.apiKey), body: JSON.stringify(request), signal });
      if (!stream) {
        const data = await jsonOrProviderError(response);
        let toolIndex = 0;
        for (const block of data?.content || []) {
          if (block.type === 'thinking' && block.thinking) yield { type: 'delta', delta: { reasoning_content: block.thinking } };
          if (block.type === 'text' && block.text) yield { type: 'delta', delta: { content: block.text } };
          if (block.type === 'tool_use') yield { type: 'delta', delta: { tool_calls: [{ index: toolIndex++, id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) } }] } };
        }
        if (data?.usage) yield { type: 'usage', usage: { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens, total_tokens: Number(data.usage.input_tokens || 0) + Number(data.usage.output_tokens || 0) + Number(data.usage.cache_read_input_tokens || 0) + Number(data.usage.cache_creation_input_tokens || 0), cache_read_input_tokens: data.usage.cache_read_input_tokens, cache_creation_input_tokens: data.usage.cache_creation_input_tokens } };
        if (data?.stop_reason) yield { type: 'finish', finishReason: normalizeFinishReason(data.stop_reason) };
        return;
      }
      const toolIndexes = new Map(); let nextTool = 0; let inputTokens; let outputTokens; let cacheReadTokens; let cacheCreationTokens;
      for await (const event of sseEvents(response)) {
        const data = parseJson(event.data); if (!data || event.event === 'error' || data.type === 'error') throw providerError(data?.error?.type === 'overloaded_error' ? 503 : 502);
        if (event.event === 'message_start') { inputTokens = data.message?.usage?.input_tokens; cacheReadTokens = data.message?.usage?.cache_read_input_tokens; cacheCreationTokens = data.message?.usage?.cache_creation_input_tokens; }
        if (event.event === 'content_block_start' && data.content_block?.type === 'tool_use') {
          const index = nextTool++; toolIndexes.set(data.index, index);
          yield { type: 'delta', delta: { tool_calls: [{ index, id: data.content_block.id, type: 'function', function: { name: data.content_block.name, arguments: '' } }] } };
        }
        if (event.event === 'content_block_delta' && data.delta?.type === 'thinking_delta' && data.delta.thinking) {
          yield { type: 'delta', delta: { reasoning_content: data.delta.thinking } };
        }
        if (event.event === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) yield { type: 'delta', delta: { content: data.delta.text } };
        if (event.event === 'content_block_delta' && data.delta?.type === 'input_json_delta') yield { type: 'delta', delta: { tool_calls: [{ index: toolIndexes.get(data.index) ?? 0, function: { arguments: data.delta.partial_json || '' } }] } };
        if (event.event === 'message_delta') {
          outputTokens = data.usage?.output_tokens ?? outputTokens;
          if (data.delta?.stop_reason) yield { type: 'finish', finishReason: normalizeFinishReason(data.delta.stop_reason) };
        }
      }
      if (Number.isFinite(inputTokens) || Number.isFinite(outputTokens)) yield { type: 'usage', usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: Number(inputTokens || 0) + Number(outputTokens || 0) + Number(cacheReadTokens || 0) + Number(cacheCreationTokens || 0), cache_read_input_tokens: cacheReadTokens, cache_creation_input_tokens: cacheCreationTokens } };
    },
    async quota() { return { updatedAt: new Date().toISOString(), models: [], consumption: null }; },
  };
}
