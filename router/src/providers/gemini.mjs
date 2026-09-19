import { openAIToGeminiRequest } from '../vendor/9router/openai-to-gemini.mjs';
import { geminiChunkToEvents } from '../vendor/9router/gemini-to-openai.mjs';
import { jsonOrProviderError, modelRecord, withThinkingLevels, parseJson, providerError, sseEvents, baseUrl } from './common.mjs';

function headers(apiKey) { return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }; }
function modelId(name) { return String(name || '').replace(/^models\//, ''); }

export function createGeminiAdapter({ fetchImpl }) {
  return {
    async discover({ connection, credentials, signal }) {
      const data = await jsonOrProviderError(await fetchImpl(`${baseUrl(connection.endpoint)}/models`, { headers: headers(credentials.apiKey), signal }));
      return { models: (data?.models || []).filter(m => m?.name && (!m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))).map(m => withThinkingLevels(modelRecord(modelId(m.name), m.displayName || modelId(m.name), { tools: 'reported', vision: 'reported' }))) };
    },
    async *generate({ connection, credentials, body, signal }) {
      const stream = body.stream !== false;
      const model = modelId(body.model);
      const request = openAIToGeminiRequest(model, body);
      const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      const response = await fetchImpl(`${baseUrl(connection.endpoint)}/models/${encodeURIComponent(model)}:${action}`, { method: 'POST', headers: headers(credentials.apiKey), body: JSON.stringify(request), signal });
      const state = { toolIndex: 0, hadToolCall: false };
      if (!stream) {
        const data = await jsonOrProviderError(response); for (const event of geminiChunkToEvents(data, state)) yield event; return;
      }
      for await (const item of sseEvents(response)) { if (!item.data || item.data === '[DONE]') continue; const data = parseJson(item.data); if (!data || data.error) throw providerError(data?.error?.code || 502); for (const event of geminiChunkToEvents(data, state)) yield event; }
    },
    async quota() { return { updatedAt: new Date().toISOString(), models: [], consumption: null }; },
  };
}
