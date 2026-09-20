import { openAIToGeminiRequest } from '../vendor/9router/openai-to-gemini.mjs';
import { geminiChunkToEvents } from '../vendor/9router/gemini-to-openai.mjs';
import { jsonOrProviderError, modelRecord, parseJson, providerError, sseEvents, baseUrl, GEMINI_THINKING_LEVELS } from './common.mjs';

function headers(apiKey) { return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }; }
function modelId(name) { return String(name || '').replace(/^models\//, ''); }

/**
 * BUG-4/R2: Gemini's `models.list` reports the context window as
 * `inputTokenLimit` and thinking support as the boolean `thinking` field, so the
 * record is mapped from the payload. Google maps OpenAI `reasoning_effort`
 * directly onto Gemini `thinking_level` (low|medium|high); Gemini 3 has no token
 * budget field, so a model that only reports `thinking: false` gets no levels.
 */
function thinkingFromGeminiModel(model) {
  const supportsThinking = model?.thinking === true;
  return {
    contextWindow: model?.inputTokenLimit ?? null,
    thinkingType: supportsThinking ? 'effort' : 'none',
    thinkingLevels: supportsThinking ? GEMINI_THINKING_LEVELS : [],
    defaultThinking: null,
  };
}

export function createGeminiAdapter({ fetchImpl }) {
  return {
    async discover({ connection, credentials, signal }) {
      const data = await jsonOrProviderError(await fetchImpl(`${baseUrl(connection.endpoint)}/models`, { headers: headers(credentials.apiKey), signal }));
      return { models: (data?.models || []).filter(m => m?.name && (!m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))).map(m => modelRecord(modelId(m.name), m.displayName || modelId(m.name), { tools: 'reported', vision: 'reported' }, thinkingFromGeminiModel(m))) };
    },
    async *generate({ connection, credentials, body, signal }) {
      const stream = body.stream !== false;
      const model = modelId(body.model);
      // R3 mapping for the `effort` thinking type: the level is forwarded as
      // Gemini's `generationConfig.thinkingConfig.thinkingLevel` (Google maps
      // `reasoning_effort` onto the same field). Gemini 3 rejects a token
      // budget, so no `thinkingBudget` is ever sent here; `none`/`auto`/absent
      // send no thinking config at all.
      const level = body.thinkingLevel || body.reasoning_effort;
      const request = openAIToGeminiRequest(model, body);
      if (level && level !== 'none' && level !== 'auto') {
        request.generationConfig ||= {};
        request.generationConfig.thinkingConfig = { thinkingLevel: level, includeThoughts: true };
      }
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
