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
        if (message.content || message.tool_calls?.length) yield { type: 'delta', delta: { ...(message.content ? { content: message.content } : {}), ...(message.tool_calls?.length ? { tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) } : {}) } };
        if (data?.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
        return;
      }
      for await (const event of sseEvents(response)) {
        if (!event.data || event.data === '[DONE]') continue;
        const data = parseJson(event.data); if (!data || data.error) throw providerError(data?.error?.status || 502);
        const choice = data.choices?.[0];
        if (choice?.delta && (choice.delta.content || choice.delta.tool_calls?.length)) yield { type: 'delta', delta: choice.delta };
        if (data.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
      }
    },
    async quota() { return { updatedAt: new Date().toISOString(), models: [], consumption: null }; },
  };
}
