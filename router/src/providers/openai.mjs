import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents, baseUrl, thinkingFromProviderPayload, EFFORT_LEVELS } from './common.mjs';

function headers(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

/**
 * BUG-4/R2: OpenAI's `/models` payload carries no reasoning or context metadata.
 * When a compatible gateway does report it (OpenRouter-shaped
 * `context_length`/`reasoning`/`supported_parameters` fields) that payload wins;
 * otherwise the record uses OpenAI's own control, `reasoning_effort`
 * (minimal|low|medium|high), and leaves the context window null rather than
 * inventing one.
 */
function thinkingFromOpenAIModel(item) {
  const payload = thinkingFromProviderPayload(item || {});
  return {
    contextWindow: payload.contextWindow,
    thinkingType: 'effort',
    thinkingLevels: payload.thinkingLevels.length ? payload.thinkingLevels : [...EFFORT_LEVELS],
    defaultThinking: payload.defaultThinking,
  };
}

export function createOpenAIAdapter({ fetchImpl }) {
  return {
    // Stored rows are re-described when the service normalizes a connection:
    // OpenAI-compatible endpoints take an effort level, and the context window
    // stays whatever the payload reported (BUG-4/R2).
    thinkingMetadata: model => ({
      thinkingType: 'effort',
      thinkingLevels: Array.isArray(model?.thinkingLevels) && model.thinkingLevels.length ? model.thinkingLevels : [...EFFORT_LEVELS],
      defaultThinking: model?.defaultThinking ?? null,
      contextWindow: model?.contextWindow ?? null,
    }),
    async discover({ connection, credentials, signal }) {
      const data = await jsonOrProviderError(await fetchImpl(`${baseUrl(connection.endpoint)}/models`, { headers: headers(credentials.apiKey), signal }));
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      return { models: list.map(item => typeof item === 'string' ? modelRecord(item, item, {}, thinkingFromOpenAIModel({ id: item })) : modelRecord(item?.id, item?.name || item?.id, {}, thinkingFromOpenAIModel(item))).filter(m => m.id) };
    },
    async *generate({ connection, credentials, body, signal }) {
      const stream = body.stream !== false;
      const requestPayload = { ...body, stream, ...(stream && connection.providerId === 'openai' ? { stream_options: { ...body.stream_options, include_usage: true } } : {}) };
      const level = body.thinkingLevel || body.reasoning_effort;
      if (level && level !== 'none' && level !== 'auto') {
        requestPayload.reasoning_effort = level;
      }
      delete requestPayload.thinkingLevel;
      const response = await fetchImpl(`${baseUrl(connection.endpoint)}/chat/completions`, {
        method: 'POST', headers: headers(credentials.apiKey), body: JSON.stringify(requestPayload), signal,
      });
      if (!stream) {
        const data = await jsonOrProviderError(response);
        const choice = data?.choices?.[0];
        const message = choice?.message || {};
        const reasoning = message.reasoning_content || message.reasoning || message.thought;
        if (message.content || message.tool_calls?.length || reasoning) yield { type: 'delta', delta: { ...(message.content ? { content: message.content } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}), ...(message.tool_calls?.length ? { tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) } : {}) } };
        if (data?.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
        return;
      }
      for await (const event of sseEvents(response)) {
        if (!event.data || event.data === '[DONE]') continue;
        const data = parseJson(event.data); if (!data || data.error) throw providerError(data?.error?.status || 502);
        const choice = data.choices?.[0];
        const reasoning = choice?.delta?.reasoning_content || choice?.delta?.reasoning || choice?.delta?.thought;
        if (choice?.delta && (choice.delta.content || choice.delta.tool_calls?.length || reasoning)) {
          yield { type: 'delta', delta: { ...choice.delta, ...(reasoning ? { reasoning_content: reasoning } : {}) } };
        }
        if (data.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
      }
    },
    async quota() { return { updatedAt: new Date().toISOString(), models: [], consumption: null }; },
  };
}
