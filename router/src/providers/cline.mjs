// Cline Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/cline.js, shared/clineAuth.js & shared/clineEnvelope.js

import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents } from './common.mjs';
import { RouterError } from '../errors.mjs';

const AUTHORIZE_URL = 'https://api.cline.bot/api/v1/auth/authorize';
const TOKEN_URL = 'https://api.cline.bot/api/v1/auth/token';
const REFRESH_URL = 'https://api.cline.bot/api/v1/auth/refresh';
const CHAT_URL = 'https://api.cline.bot/api/v1/chat/completions';

export const CLINE_MODELS = Object.freeze([
  { ...modelRecord('anthropic/claude-opus-4.7', 'Claude Opus 4.7'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('anthropic/claude-opus-4.6', 'Claude Opus 4.6'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('openai/gpt-5.3-codex', 'GPT-5.3 Codex'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('openai/gpt-5.4', 'GPT-5.4'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview') },
  { ...modelRecord('google/gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite Preview') },
  { ...modelRecord('kwaipilot/kat-coder-pro', 'KAT Coder Pro') },
]);

export function getClineAccessToken(token) {
  if (typeof token !== 'string') return '';
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase().startsWith('workos:')) return trimmed;
  // Cline OAuth access tokens are WorkOS JWTs (base64url eyJ...).
  // ClinePass API keys are NOT JWTs and must be sent verbatim.
  const isWorkOsJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed);
  return isWorkOsJwt ? `workos:${trimmed}` : trimmed;
}

function clineHeaders(token) {
  const cleanToken = getClineAccessToken(token);
  return {
    Authorization: cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`,
    'HTTP-Referer': 'https://cline.bot',
    'X-Title': 'Cline',
    'User-Agent': 'BoxFox/0.1.0 (external, sdk-cli)',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
}

export function unwrapClineEnvelope(data) {
  if (data && typeof data === 'object' && data.success === true && data.data && typeof data.data === 'object') {
    return data.data;
  }
  return data;
}

export function createClineAdapter({ fetchImpl }) {
  const oauthConfig = Object.freeze({
    source: 'embedded_public_client',
    flowType: 'authorization_code',
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    refreshUrl: REFRESH_URL,
    redirect: { scheme: 'http', host: 'localhost', defaultPort: 51121, path: '/oauth-callback', loopbackOnly: true },
  });

  return {
    oauthConfig,
    fallbackModels: CLINE_MODELS.map(model => ({ ...model, source: 'static', stale: true, enabled: false })),

    buildAuthUrl({ redirectUri }) {
      const params = new URLSearchParams({
        client_type: 'extension',
        callback_url: redirectUri,
        redirect_uri: redirectUri,
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeCode({ code, redirectUri, signal }) {
      // 1. Try decoding token payload directly from base64 code parameter
      try {
        let base64 = code.trim();
        const padding = 4 - (base64.length % 4);
        if (padding !== 4) base64 += '='.repeat(padding);
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        const lastBrace = decoded.lastIndexOf('}');
        if (lastBrace !== -1) {
          const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1));
          if (tokenData.accessToken || tokenData.access_token) {
            return {
              accessToken: tokenData.accessToken || tokenData.access_token,
              refreshToken: tokenData.refreshToken || tokenData.refresh_token || null,
              email: tokenData.email || tokenData.userInfo?.email || null,
              accountLabel: tokenData.email || (tokenData.firstName ? `${tokenData.firstName} ${tokenData.lastName || ''}`.trim() : null),
              expiresAt: tokenData.expiresAt ? new Date(tokenData.expiresAt).getTime() : Date.now() + 3600 * 1000,
            };
          }
        }
      } catch {
        /* fallback to POST token exchange */
      }

      // 2. Fallback to upstream token exchange endpoint
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_type: 'extension',
          redirect_uri: redirectUri,
        }),
        signal,
      });

      const data = await jsonOrProviderError(response);
      const token = data.data?.accessToken || data.accessToken || data.access_token;
      if (!token) throw providerError(401);

      return {
        accessToken: token,
        refreshToken: data.data?.refreshToken || data.refreshToken || data.refresh_token || null,
        email: data.data?.userInfo?.email || data.email || null,
        accountLabel: data.data?.userInfo?.email || data.email || 'Cline User',
        expiresAt: data.data?.expiresAt ? new Date(data.data.expiresAt).getTime() : Date.now() + 3600 * 1000,
      };
    },

    async refresh({ credentials, signal }) {
      if (!credentials.refreshToken) throw new RouterError('AUTH', 'Refresh token not available for Cline.', 401);
      const response = await fetchImpl(REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
        }),
        signal,
      });
      const data = await jsonOrProviderError(response);
      const token = data.data?.accessToken || data.accessToken || data.access_token;
      if (!token) throw providerError(401);
      return {
        accessToken: token,
        refreshToken: data.data?.refreshToken || data.refreshToken || credentials.refreshToken,
        expiresAt: data.data?.expiresAt ? new Date(data.data.expiresAt).getTime() : Date.now() + 3600 * 1000,
      };
    },

    async discover() {
      return {
        models: CLINE_MODELS.map(m => ({ ...m, source: 'live', stale: false, enabled: true })),
      };
    },

    async *generate({ connection, credentials, body, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) throw new RouterError('AUTH', 'Cline credentials missing.', 401);
      const stream = body.stream !== false;

      const response = await fetchImpl(connection.endpoint || CHAT_URL, {
        method: 'POST',
        headers: clineHeaders(token),
        body: JSON.stringify({ ...body, stream }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let parsed = null;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }
        const message = parsed?.error?.message || parsed?.message || errorText || `Cline error HTTP ${response.status}`;
        if (response.status === 401) throw new RouterError('AUTH', message, 401);
        if (response.status === 429) throw new RouterError('RATE_LIMIT', message, 429, true);
        throw new RouterError('PROVIDER_ERROR', message, response.status, response.status >= 500);
      }

      if (!stream) {
        let data = await jsonOrProviderError(response);
        data = unwrapClineEnvelope(data);
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
        let data = parseJson(event.data);
        if (!data) continue;
        data = unwrapClineEnvelope(data);
        if (data.error) throw providerError(data?.error?.status || 502);
        const choice = data.choices?.[0];
        if (choice?.delta && (choice.delta.content || choice.delta.tool_calls?.length)) {
          yield { type: 'delta', delta: choice.delta };
        }
        if (data.usage) yield { type: 'usage', usage: data.usage };
        if (choice?.finish_reason) yield { type: 'finish', finishReason: normalizeFinishReason(choice.finish_reason) };
      }
    },

    async quota() {
      return { updatedAt: new Date().toISOString(), models: [], consumption: null };
    },
  };
}
