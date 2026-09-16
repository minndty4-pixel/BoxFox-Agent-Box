// Claude Code Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/claude.js and open-sse/executors/default.js

import { jsonOrProviderError, modelRecord, parseJson, providerError, sseEvents } from './common.mjs';
import { openAIToClaudeRequest } from '../vendor/9router/openai-to-claude.mjs';
import { claudeChunkToEvents } from '../vendor/9router/claude-to-openai.mjs';
import { RouterError } from '../errors.mjs';

const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages?beta=true';
const SCOPES = ['org:create_api_key', 'user:profile', 'user:inference'];

export const CLAUDE_MODELS = Object.freeze([
  { ...modelRecord('cc/claude-opus-5', 'Claude Opus 5'), upstreamModelId: 'claude-opus-5', thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('cc/claude-fable-5-1', 'Claude Fable 5.1'), upstreamModelId: 'claude-fable-5-1', thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('cc/claude-fable-5', 'Claude Fable 5'), upstreamModelId: 'claude-fable-5', thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('cc/claude-sonnet-5', 'Claude Sonnet 5'), upstreamModelId: 'claude-sonnet-5', thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('cc/claude-haiku-4-5-20251001', 'Claude 4.5 Haiku'), upstreamModelId: 'claude-haiku-4-5-20251001' },
  { ...modelRecord('claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet'), upstreamModelId: 'claude-3-7-sonnet-20250219', thinkingLevels: ['auto', 'low', 'medium', 'high'] },
  { ...modelRecord('claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet'), upstreamModelId: 'claude-3-5-sonnet-20241022' },
]);

function claudeHeaders(token) {
  const cleanToken = token?.trim() || '';
  return {
    Authorization: cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
    'Anthropic-Version': '2023-06-01',
    'Anthropic-Beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28',
    'Anthropic-Dangerous-Direct-Browser-Access': 'true',
    'User-Agent': 'claude-cli/0.2.29 (external, sdk-cli)',
    'X-App': 'cli',
  };
}

export function createClaudeAdapter({ fetchImpl }) {
  const oauthConfig = Object.freeze({
    source: 'embedded_public_client',
    flowType: 'authorization_code',
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: [...SCOPES],
    codeChallengeMethod: 'S256',
    redirect: { scheme: 'http', host: 'localhost', defaultPort: 51121, path: '/oauth-callback', loopbackOnly: true },
  });

  return {
    oauthConfig,
    fallbackModels: CLAUDE_MODELS.map(model => ({ ...model, source: 'static', stale: true, enabled: false })),

    buildAuthUrl({ redirectUri, state }) {
      const params = new URLSearchParams({
        code: 'true',
        client_id: CLAUDE_CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: SCOPES.join(' '),
        state,
      });
      return `${AUTHORIZE_URL}?${params}`;
    },

    async exchangeCode({ code, redirectUri, signal }) {
      let authCode = code;
      let codeState = '';
      if (authCode.includes('#')) {
        const parts = authCode.split('#');
        authCode = parts[0];
        codeState = parts[1] || '';
      }
      const tokenPayload = {
        code: authCode,
        state: codeState,
        grant_type: 'authorization_code',
        client_id: CLAUDE_CLIENT_ID,
        redirect_uri: redirectUri,
      };
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokenPayload),
        signal,
      });
      const tokens = await jsonOrProviderError(response);
      if (!tokens.access_token) throw providerError(401);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: Date.now() + Number(tokens.expires_in || 28800) * 1000,
        email: tokens.email || null,
      };
    },

    async refresh({ credentials, signal }) {
      if (!credentials.refreshToken) throw new RouterError('AUTH', 'Refresh token not available for Claude Code.', 401);
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: CLAUDE_CLIENT_ID,
        }),
        signal,
      });
      const tokens = await jsonOrProviderError(response);
      if (!tokens.access_token) throw providerError(401);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresAt: Date.now() + Number(tokens.expires_in || 28800) * 1000,
      };
    },

    async discover() {
      // Curated Claude Code models catalog
      return {
        models: CLAUDE_MODELS.map(m => ({ ...m, source: 'live', stale: false, enabled: true })),
      };
    },

    async *generate({ connection, credentials, body, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) throw new RouterError('AUTH', 'Claude Code credentials missing.', 401);
      const stream = body.stream !== false;
      const modelId = body.model;
      const matched = CLAUDE_MODELS.find(m => m.id === modelId);
      const targetModel = matched?.upstreamModelId || modelId.replace(/^cc\//, '');
      const claudePayload = openAIToClaudeRequest({ ...body, model: targetModel }, stream);

      const response = await fetchImpl(connection.endpoint || MESSAGES_URL, {
        method: 'POST',
        headers: claudeHeaders(token),
        body: JSON.stringify(claudePayload),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let parsed = null;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }
        const message = parsed?.error?.message || errorText || `Claude error HTTP ${response.status}`;
        if (response.status === 401) throw new RouterError('AUTH', message, 401);
        if (response.status === 429) throw new RouterError('RATE_LIMIT', message, 429, true);
        throw new RouterError('PROVIDER_ERROR', message, response.status, response.status >= 500);
      }

      if (!stream) {
        const data = await response.json();
        for (const event of claudeChunkToEvents(data)) {
          yield event;
        }
        return;
      }

      const state = { toolIndex: 0, currentTool: null, hadToolCall: false, promptTokens: 0, cachedTokens: 0 };
      for await (const sse of sseEvents(response)) {
        if (!sse.data || sse.data === '[DONE]') continue;
        const data = parseJson(sse.data);
        if (!data) continue;
        for (const event of claudeChunkToEvents(data, state)) {
          yield event;
        }
      }
    },

    async quota({ credentials, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) return { updatedAt: new Date().toISOString(), models: [], consumption: null };
      try {
        const response = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
          headers: claudeHeaders(token),
          signal,
        });
        if (response.ok) {
          const data = await response.json();
          return { updatedAt: new Date().toISOString(), ...data };
        }
      } catch { /* best effort */ }
      return { updatedAt: new Date().toISOString(), models: [], consumption: null };
    },
  };
}
