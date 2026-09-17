// OpenRouter Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/openrouter.js and OmniRoute openrouterQuotaFetcher.ts

import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents } from './common.mjs';
import { RouterError } from '../errors.mjs';

const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export const OPENROUTER_FALLBACK_MODELS = Object.freeze([
  { ...modelRecord('openrouter/free', 'Free Models Router'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('nex-agi/nex-n2.5-mini:free', 'Nex AGI: Nex-N2.5-Mini (Free)'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('nex-agi/nex-n2.5-pro:free', 'Nex AGI: Nex-N2.5-Pro (Free)'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('inclusionai/ling-3.0-flash-vl:free', 'inclusionAI: Ling 3.0 Flash VL (Free)') },
  { ...modelRecord('liquid/lfm-2.5-2.6b:free', 'LiquidAI: LFM2.5-2.6B (Free)') },
  { ...modelRecord('cohere/north-mini-code:free', 'Cohere: North Mini Code (Free)') },
  { ...modelRecord('deepseek/deepseek-r1:free', 'DeepSeek R1 (Free)'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('openai/gpt-4o-mini', 'GPT-4o Mini'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet'), thinkingLevels: ['auto', 'low', 'medium', 'high'] },
]);

function resolveBaseUrl(endpoint) {
  if (!endpoint) return DEFAULT_OPENROUTER_BASE;
  const clean = endpoint.trim().replace(/\/+$/, '');
  return clean.replace(/\/chat\/completions$/, '');
}

function resolveChatUrl(endpoint) {
  if (!endpoint) return `${DEFAULT_OPENROUTER_BASE}/chat/completions`;
  const clean = endpoint.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

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

      const baseUrl = resolveBaseUrl(connection.endpoint);
      let isFreeTier = false;

      // Check account tier
      try {
        const authRes = await fetchImpl(`${baseUrl}/auth/key`, { headers: openRouterHeaders(apiKey), signal }).catch(() => null);
        if (authRes?.ok) {
          const authData = await authRes.json().catch(() => null);
          if (authData?.data?.is_free_tier) isFreeTier = true;
        }
      } catch {
        /* best effort */
      }

      try {
        const response = await fetchImpl(`${baseUrl}/models`, {
          headers: openRouterHeaders(apiKey),
          signal,
        });

        if (response.ok) {
          const data = await response.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          if (list.length) {
            // Sort: prioritize free models first
            const sorted = [...list].sort((a, b) => {
              const aFree = a.id?.includes(':free') || a.id === 'openrouter/free' || a.pricing?.prompt === '0';
              const bFree = b.id?.includes(':free') || b.id === 'openrouter/free' || b.pricing?.prompt === '0';
              if (aFree && !bFree) return -1;
              if (!aFree && bFree) return 1;
              return 0;
            });

            return {
              models: sorted.map(item => {
                const isThinking = Boolean(item.architecture?.instruct_type || item.id.includes('r1') || item.id.includes('o1') || item.id.includes('o3'));
                const isFree = item.id?.includes(':free') || item.id === 'openrouter/free' || item.pricing?.prompt === '0';
                return {
                  ...modelRecord(item.id, item.name || item.id),
                  ...(isThinking ? { thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] } : {}),
                  // If account is free tier, default enable free models and disable paid models to avoid 402/429
                  ...(isFreeTier ? { enabled: Boolean(isFree) } : {}),
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
      const targetUrl = resolveChatUrl(connection.endpoint);

      const response = await fetchImpl(targetUrl, {
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

    async quota({ connection, credentials, signal }) {
      const apiKey = credentials.apiKey || credentials.accessToken;
      if (!apiKey) return { updatedAt: new Date().toISOString(), models: [], consumption: null };

      const baseUrl = resolveBaseUrl(connection?.endpoint);
      try {
        const [keyRes, creditsRes, authRes] = await Promise.all([
          fetchImpl(`${baseUrl}/key`, { headers: openRouterHeaders(apiKey), signal }).catch(() => null),
          fetchImpl(`${baseUrl}/credits`, { headers: openRouterHeaders(apiKey), signal }).catch(() => null),
          fetchImpl(`${baseUrl}/auth/key`, { headers: openRouterHeaders(apiKey), signal }).catch(() => null),
        ]);

        let keyData = null;
        if (keyRes?.ok) keyData = await keyRes.json().catch(() => null);

        let creditsData = null;
        if (creditsRes?.ok) creditsData = await creditsRes.json().catch(() => null);

        let authData = null;
        if (authRes?.ok) authData = await authRes.json().catch(() => null);

        const keyInfo = keyData?.data || authData?.data || {};
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
        const plan = isFree ? 'OpenRouter Free (50 req/day)' : 'OpenRouter Standard';

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
