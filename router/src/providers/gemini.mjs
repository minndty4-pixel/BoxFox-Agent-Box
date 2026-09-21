import { openAIToGeminiRequest } from '../vendor/9router/openai-to-gemini.mjs';
import { geminiChunkToEvents } from '../vendor/9router/gemini-to-openai.mjs';
import { jsonOrProviderError, modelRecord, parseJson, providerError, sseEvents, baseUrl, GEMINI_THINKING_LEVELS } from './common.mjs';

function headers(apiKey) { return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }; }
function modelId(name) { return String(name || '').replace(/^models\//, ''); }

/**
 * BUG-4/R2, T-3: Gemini's `models.list` reports the context window as
 * `inputTokenLimit` and thinking support as the boolean `thinking` field, but the
 * flag says nothing about **which** control the model takes, and Google keeps two
 * mutually exclusive ones (ai.google.dev/gemini-api/docs/openai and
 * /gemini-api/docs/gemini-3): the 2.5 generation takes the numeric
 * `thinkingBudget`, Gemini 3 and later take the enum `thinkingLevel`. Feeding a
 * level to a 2.5 model answers `400 Thinking level is not supported for this
 * model`, and Gemma answers the same for both controls.
 *
 * Those family prefixes are the documented rule behind the two controls, and the
 * `-latest` aliases carry no generation in their id. Measured against
 * generativelanguage.googleapis.com with a live Google key on 2026-09-20:
 * `gemini-3.5-flash-lite`, `gemini-flash-latest` and `gemini-flash-lite-latest`
 * accept `thinkingLevel` (medium/high return ~60 thoughts tokens, low returns
 * none); `gemini-2.5-flash` refuses `thinkingLevel` and accepts
 * `thinkingBudget: 512` (10 thoughts tokens); `gemma-4-31b-it` refuses both.
 */
export const GEMINI_BUDGET_FAMILIES = Object.freeze(['gemini-2.5', 'gemini-2.0', 'gemini-1.5']);
export const GEMINI_NO_THINKING_FAMILIES = Object.freeze(['gemma']);
/** Documented translation for the budget control: `reasoning_effort` low/medium map to 1024/8192, and the budget ceiling of the 2.5 generation is 24576. */
export const GEMINI_BUDGET_BY_LEVEL = Object.freeze({ minimal: 512, low: 1024, medium: 8192, high: 24576, max: 24576 });

/** Which control a Gemini model takes on the wire: `effort`, `budget` or `none`. */
export function geminiThinkingControl(id) {
  const name = String(id || '').toLowerCase();
  if (GEMINI_NO_THINKING_FAMILIES.some(prefix => name.startsWith(prefix))) return 'none';
  if (GEMINI_BUDGET_FAMILIES.some(prefix => name.startsWith(prefix))) return 'budget';
  return 'effort';
}

function thinkingFromGeminiModel(model) {
  const control = model?.thinking === true ? geminiThinkingControl(modelId(model?.name)) : 'none';
  return {
    contextWindow: model?.inputTokenLimit ?? null,
    thinkingType: control,
    thinkingLevels: control === 'none' ? [] : GEMINI_THINKING_LEVELS,
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
      // R3/T-3 mapping: the shared OpenAI-to-Gemini mapper always writes
      // `generationConfig.thinkingConfig.thinkingLevel` when a level is present,
      // but `effort` is only the control of the Gemini 3 generation. Models of the
      // 2.5 generation refuse a level outright and take the documented
      // `thinkingBudget` instead, and Gemma refuses both, so the field is rewritten
      // or dropped here. `none`/`auto` levels never reach the mapper with a config.
      const level = body.thinkingLevel || body.reasoning_effort;
      const control = geminiThinkingControl(model);
      const request = openAIToGeminiRequest(model, body);
      if (request.generationConfig?.thinkingConfig) {
        if (control === 'none') delete request.generationConfig.thinkingConfig;
        else if (control === 'budget') request.generationConfig.thinkingConfig = { thinkingBudget: GEMINI_BUDGET_BY_LEVEL[level] ?? GEMINI_BUDGET_BY_LEVEL.medium, includeThoughts: true };
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
