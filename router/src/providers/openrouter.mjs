// OpenRouter Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/openrouter.js and OmniRoute openrouterQuotaFetcher.ts

import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents } from './common.mjs';
import { RouterError } from '../errors.mjs';

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/key';
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

export const OPENROUTER_FALLBACK_MODELS = Object.freeze([
  { ...modelRecord('google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash (Free)'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B Instruct (Free)') },
  { ...modelRecord('deepseek/deepseek-r1:free', 'DeepSeek R1 (Free)'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('deepseek/deepseek-chat:free', 'DeepSeek V3 (Free)') },
  { ...modelRecord('openai/gpt-4o-mini', 'GPT-4o Mini'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet'), thinkingLevels: ['auto', 'low', 'medium', 'high'] },
]);

function openRouterHeaders(apiKey) {
  const cleanKey = apiKey?.trim() || '';
  return {
    Authorization: cleanKey.startsWith('Bearer ') ? cleanKey : `Bearer ${cleanKey}`,
    'HTTP-Referer': 'http://localhost:3100',
    'X-Title': 'BoxFox',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
}

export function createOpenRouterAdapter({ fetchImpl }) {
  return {
    fallbackModels: OPENROUTER_FALLBACK_MODELS.map(model => ({ ...model, source: 'static', stale: true, enabled: false })),

    async discover({ connection, credentials, signal }) {
      const apiKey = credentials?.apiKey || credentials?.accessToken;
      if (!apiKey) {
        return { models: OPENROUTER_FALLBACK_MODELS.map(m => ({ ...m, source: 'static', stale: false, enabled: true })) };
      }

      try {
        const response = await fetchImpl(MODELS_URL, {
          headers: openRouterHeaders(apiKey),
          signal,
        });

        if (response.ok) {
          const data = await response.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          if (list.length) {
            return {
              models: list.map(item => {
                const isThinking = Boolean(item.architecture?.instruct_type || item.id.includes('r1') || item.id.includes('o1') || item.id.includes('o3'));
                return {
                  ...modelRecord(item.id, item.name || item.id),
                  ...(isThinking ? { thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] } : {}),
                };
              }),
            };
          }
        }
      } catch {
        /* best effort */
      }
      return { models: OPENROUTER_FALLBACK_MODELS.map(m => ({ ...m, source: 'live', stale: false, enabled: true })) };
    },

    async *generate({ connection, credentials, body, signal }) {
      const apiKey = credentials.apiKey || credentials.accessToken;
      if (!apiKey) throw new RouterError('AUTH', 'OpenRouter API key missing.', 401);
      const stream = body.stream !== false;

      const response = await fetchImpl(connection.endpoint || CHAT_URL, {
        method: 'POST',
        headers: openRouterHeaders(apiKey),
        body: JSON.stringify({ ...body, stream }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let parsed = null;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }
        const message = parsed?.error?.message || errorText || `OpenRouter error HTTP ${response.status}`;
        if (response.status === 401) throw new RouterError('AUTH', message, 401);
        if (response.status === 429) throw new RouterError('RATE_LIMIT', message, 429, true);
        throw new RouterError('PROVIDER_ERROR', message, response.status, response.status >= 500);
      }

      if (!stream) {
        const data = await jsonOrProviderError(response);
        const choice = data?.choices?.[0];
        const message = choice?.message || {};
        if (message.content || message.tool_calls?.length) {
          yield { type: 'delta', delta: { ...(message.content ? { content: message.content } : {}), ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) } };
        }
        if (data?.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
        return;
      }

      for await (const event of sseEvents(response)) {
        if (!event.data || event.data === '[DONE]') continue;
        const data = parseJson(event.data);
        if (!data) continue;
        if (data.error) throw providerError(data?.error?.status || 502);
        const choice = data.choices?.[0];
        if (choice?.delta && (choice.delta.content || choice.delta.tool_calls?.length)) {
          yield { type: 'delta', delta: choice.delta };
        }
        if (data.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
      }
    },

    async quota({ credentials, signal }) {
      const apiKey = credentials.apiKey || credentials.accessToken;
      if (!apiKey) return { updatedAt: new Date().toISOString(), models: [], consumption: null };

      try {
        const [keyRes, creditsRes] = await Promise.all([
          fetchImpl(KEY_URL, { headers: openRouterHeaders(apiKey), signal }).catch(() => null),
          fetchImpl(CREDITS_URL, { headers: openRouterHeaders(apiKey), signal }).catch(() => null),
        ]);

        let keyData = null;
        if (keyRes?.ok) keyData = await keyRes.json().catch(() => null);

        let creditsData = null;
        if (creditsRes?.ok) creditsData = await creditsRes.json().catch(() => null);

        const keyInfo = keyData?.data || {};
        const creditsInfo = creditsData?.data || {};

        const limit = typeof keyInfo.limit === 'number' ? keyInfo.limit : null;
        const limitRemaining = typeof keyInfo.limit_remaining === 'number' ? keyInfo.limit_remaining : null;
        const totalCredits = typeof creditsInfo.total_credits === 'number' ? creditsInfo.total_credits : null;
        const totalUsage = typeof creditsInfo.total_usage === 'number' ? creditsInfo.total_usage : null;

        let remainingFraction = 1;
        if (limit != null && limitRemaining != null && limit > 0) {
          remainingFraction = Math.max(0, Math.min(1, limitRemaining / limit));
        } else if (totalCredits != null && totalUsage != null && totalCredits > 0) {
          remainingFraction = Math.max(0, Math.min(1, (totalCredits - totalUsage) / totalCredits));
        }

        const isFree = keyInfo.is_free_tier === true;
        const plan = isFree ? 'OpenRouter Free' : 'OpenRouter Standard';

        return {
          updatedAt: new Date().toISOString(),
          plan,
          models: [
            {
              modelId: 'openrouter/credits',
              upstreamModelId: 'credits',
              quotaFamily: 'claude_gpt',
              remainingFraction,
              resetAt: keyInfo.limit_reset ? new Date(keyInfo.limit_reset).toISOString() : null,
              source: 'openrouter',
            },
          ],
          consumption: {
            usage: keyInfo.usage || 0,
            usageDaily: keyInfo.usage_daily || 0,
            totalCredits,
            totalUsage,
          },
        };
      } catch {
        /* best effort */
      }
      return { updatedAt: new Date().toISOString(), models: [], consumption: null };
    },
  };
}
