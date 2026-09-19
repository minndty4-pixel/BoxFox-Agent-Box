// OpenAI Codex Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/codex.js and open-sse/executors/codex.js

import { jsonOrProviderError, modelRecord, parseJson, providerError, sseEvents, EFFORT_LEVELS } from './common.mjs';
import { RouterError } from '../errors.mjs';

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const CODEX_CLI_VERSION = '0.154.0';

// Curated Codex catalog (BUG-4/R2). Codex models take an effort level
// (`reasoning_effort`, i.e. the Responses API `reasoning.effort`), so the shared
// record declares `thinkingType: 'effort'`. The catalog is authored, not fetched,
// which is why `discover()` labels these records `static`.
// NOTE: this adapter keeps the Codex CLI request shape and does not forward the
// requested level upstream yet; the level is accepted and recorded, not applied.
export const CODEX_MODELS = Object.freeze([
  { ...modelRecord('gpt-6-astra', 'GPT 6.0 Astra', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.6-sol', 'GPT 5.6 Sol', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.6-terra', 'GPT 5.6 Terra', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.6-luna', 'GPT 5.6 Luna', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.5', 'GPT 5.5', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.4', 'GPT 5.4', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.4-mini', 'GPT 5.4 Mini', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
  { ...modelRecord('gpt-5.3-codex-spark', 'GPT 5.3 Codex Spark', {}, { thinkingType: 'effort', thinkingLevels: EFFORT_LEVELS }) },
]);

function codexHeaders(token, accountId = null) {
  const cleanToken = token?.trim() || '';
  return {
    Authorization: cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
    originator: 'codex_cli_rs',
    'User-Agent': `codex_cli_rs/${CODEX_CLI_VERSION}`,
    ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
  };
}

function normalizeCodexInput(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const input = [];
  for (const m of messages) {
    if (!m) continue;
    const role = (m.role === 'system') ? 'developer' : m.role;
    let text = typeof m.content === 'string' ? m.content : '';
    if (Array.isArray(m.content)) {
      text = m.content.map(c => typeof c === 'string' ? c : c?.text || '').join('\n');
    }
    input.push({
      type: 'message',
      role,
      content: [{ type: 'input_text', text }],
    });
  }
  return {
    model: body.model,
    input,
    stream: true,
    store: false,
  };
}

export function createCodexAdapter({ fetchImpl }) {
  const oauthConfig = Object.freeze({
    source: 'embedded_public_client',
    flowType: 'authorization_code',
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    codeChallengeMethod: 'S256',
    redirect: { scheme: 'http', host: 'localhost', defaultPort: 1455, path: '/auth/callback', loopbackOnly: true },
  });

  return {
    oauthConfig,
    fallbackModels: CODEX_MODELS.map(model => ({ ...model, source: 'static', stale: true, enabled: false })),

    buildAuthUrl({ redirectUri, state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: CODEX_CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access',
        state,
        ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
      });
      return `${AUTHORIZE_URL}?${params}`;
    },

    async exchangeCode({ code, redirectUri, codeVerifier, signal }) {
      const bodyParams = {
        grant_type: 'authorization_code',
        client_id: CODEX_CLIENT_ID,
        code,
        redirect_uri: redirectUri,
      };
      if (codeVerifier) bodyParams.code_verifier = codeVerifier;
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(bodyParams).toString(),
        signal,
      });
      const tokens = await jsonOrProviderError(response);
      if (!tokens.access_token) throw providerError(401);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      };
    },

    async refresh({ credentials, signal }) {
      if (!credentials.refreshToken) throw new RouterError('AUTH', 'Refresh token not available for OpenAI Codex.', 401);
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CODEX_CLIENT_ID,
          refresh_token: credentials.refreshToken,
        }).toString(),
        signal,
      });
      const tokens = await jsonOrProviderError(response);
      if (!tokens.access_token) throw providerError(401);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      };
    },

    async discover() {
      // Curated Codex catalog; no live inventory call backs these ids, so the
      // record must not claim `live` (BUG-4/R2).
      return {
        models: CODEX_MODELS.map(m => ({ ...m, source: 'static', stale: false, enabled: true })),
      };
    },

    async *generate({ connection, credentials, body, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) throw new RouterError('AUTH', 'Codex credentials missing.', 401);
      const codexPayload = normalizeCodexInput(body);

      const response = await fetchImpl(connection.endpoint || RESPONSES_URL, {
        method: 'POST',
        headers: codexHeaders(token, credentials.accountId),
        body: JSON.stringify(codexPayload),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let parsed = null;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }
        const message = parsed?.error?.message || errorText || `Codex error HTTP ${response.status}`;
        if (response.status === 401) throw new RouterError('AUTH', message, 401);
        if (response.status === 429) throw new RouterError('RATE_LIMIT', message, 429, true);
        throw new RouterError('PROVIDER_ERROR', message, response.status, response.status >= 500);
      }

      for await (const sse of sseEvents(response)) {
        if (!sse.data || sse.data === '[DONE]') continue;
        const data = parseJson(sse.data);
        if (!data) continue;

        if (data.type === 'response.output_text.delta' && data.delta) {
          yield { type: 'delta', delta: { content: data.delta } };
        } else if (data.type === 'response.function_call_arguments.delta' && data.delta) {
          yield {
            type: 'delta',
            delta: {
              tool_calls: [{
                index: 0,
                id: data.call_id || `call_${Date.now()}`,
                type: 'function',
                function: { name: '', arguments: data.delta },
              }],
            },
          };
        } else if (data.type === 'response.completed') {
          const usage = data.response?.usage;
          if (usage) {
            yield {
              type: 'usage',
              usage: {
                prompt_tokens: usage.input_tokens || 0,
                completion_tokens: usage.output_tokens || 0,
                total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
              },
            };
          }
          yield { type: 'finish', finishReason: 'stop' };
        }
      }
    },

    async quota({ credentials, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) return { updatedAt: new Date().toISOString(), models: [], consumption: null };
      try {
        const response = await fetchImpl('https://chatgpt.com/backend-api/wham/usage', {
          headers: codexHeaders(token, credentials.accountId),
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
