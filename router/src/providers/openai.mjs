import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents, baseUrl } from './common.mjs';

function headers(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

export function createOpenAIAdapter({ fetchImpl }) {
  return {
    async discover({ connection, credentials, signal }) {
      const data = await jsonOrProviderError(await fetchImpl(`${baseUrl(connection.endpoint)}/models`, { headers: headers(credentials.apiKey), signal }));
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      return { models: list.map(item => typeof item === 'string' ? modelRecord(item) : modelRecord(item?.id, item?.name || item?.id)).filter(m => m.id) };
    },
    async *generate({ connection, credentials, body, signal }) {
      const stream = body.stream !== false;
      const response = await fetchImpl(`${baseUrl(connection.endpoint)}/chat/completions`, {
        method: 'POST', headers: headers(credentials.apiKey), body: JSON.stringify({ ...body, stream, ...(stream && connection.providerId === 'openai' ? { stream_options: { ...body.stream_options, include_usage: true } } : {}) }), signal,
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
