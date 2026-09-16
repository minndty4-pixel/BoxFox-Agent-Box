// GitHub Copilot Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/github.js and open-sse/executors/github.js

import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents } from './common.mjs';
import { RouterError } from '../errors.mjs';

const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';
const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';

export const COPILOT_MODELS = Object.freeze([
  { ...modelRecord('gpt-5.2', 'GPT-5.2'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('gpt-5.3-codex', 'GPT-5.3 Codex'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('gpt-5.4', 'GPT-5.4'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('claude-sonnet-4.5', 'Claude Sonnet 4.5'), thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] },
  { ...modelRecord('claude-haiku-4.5', 'Claude Haiku 4.5') },
]);

function copilotHeaders(token) {
  const cleanToken = token?.trim() || '';
  return {
    Authorization: cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`,
    'copilot-integration-id': 'vscode-chat',
    'editor-version': 'vscode/1.110.0',
    'editor-plugin-version': 'copilot-chat/0.38.0',
    'user-agent': 'GitHubCopilotChat/0.38.0',
    'openai-intent': 'conversation-panel',
    'x-github-api-version': '2025-04-01',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
}

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const USER_INFO_URL = 'https://api.github.com/user';

export function createCopilotAdapter({ fetchImpl }) {
  const oauthConfig = Object.freeze({
    source: 'embedded_public_client',
    flowType: 'device_code',
    clientId: GITHUB_CLIENT_ID,
    deviceCodeUrl: DEVICE_CODE_URL,
    tokenUrl: TOKEN_URL,
    scopes: ['read:user'],
  });

  return {
    oauthConfig,
    fallbackModels: COPILOT_MODELS.map(model => ({ ...model, source: 'static', stale: true, enabled: false })),

    async startDeviceFlow() {
      const response = await fetchImpl(DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: GITHUB_CLIENT_ID,
          scope: 'read:user',
        }).toString(),
      });
      const data = await jsonOrProviderError(response);
      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri || 'https://github.com/login/device',
        expiresIn: Number(data.expires_in || 900),
        interval: Number(data.interval || 5),
      };
    },

    async pollDeviceToken({ deviceCode, signal }) {
      let intervalMs = 5000;
      const deadline = Date.now() + 15 * 60 * 1000;

      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason;
        await new Promise(r => setTimeout(r, intervalMs));
        if (signal?.aborted) throw signal.reason;

        const response = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: GITHUB_CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }).toString(),
          signal,
        });

        const data = await response.json().catch(() => ({}));
        if (data.access_token) {
          // Exchange for Copilot internal token
          let copilotToken = null;
          try {
            const copilotRes = await fetchImpl(COPILOT_TOKEN_URL, {
              headers: {
                Authorization: `Bearer ${data.access_token}`,
                Accept: 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'GitHubCopilotChat/0.26.7',
                'editor-version': 'vscode/1.85.0',
              },
              signal,
            });
            if (copilotRes.ok) {
              copilotToken = await copilotRes.json();
            }
          } catch { /* best effort */ }

          // Get user info
          let userInfo = null;
          try {
            const userRes = await fetchImpl(USER_INFO_URL, {
              headers: {
                Authorization: `Bearer ${data.access_token}`,
                Accept: 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.26.7',
              },
              signal,
            });
            if (userRes.ok) {
              userInfo = await userRes.json();
            }
          } catch { /* best effort */ }

          return {
            accessToken: copilotToken?.token || data.access_token,
            githubAccessToken: data.access_token,
            expiresAt: copilotToken?.expires_at ? copilotToken.expires_at * 1000 : Date.now() + 1800 * 1000,
            email: userInfo?.email || userInfo?.login || null,
            accountLabel: userInfo?.login || 'GitHub User',
          };
        }

        if (data.error === 'authorization_pending') {
          continue;
        } else if (data.error === 'slow_down') {
          intervalMs += 5000;
          continue;
        } else if (data.error === 'expired_token') {
          throw new RouterError('AUTH', 'Device code expired. Please start again.', 400);
        } else if (data.error === 'access_denied') {
          throw new RouterError('AUTH', 'Access denied by user.', 403);
        } else if (data.error) {
          throw new RouterError('AUTH', data.error_description || data.error, 400);
        }
      }
      throw new RouterError('AUTH', 'Device authentication timed out.', 408);
    },

    async discover({ connection, credentials, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) return { models: COPILOT_MODELS.map(m => ({ ...m, source: 'static', stale: false, enabled: true })) };
      try {
        const response = await fetchImpl(COPILOT_MODELS_URL, {
          headers: copilotHeaders(token),
          signal,
        });
        if (response.ok) {
          const data = await response.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          if (list.length) {
            return {
              models: list.map(item => modelRecord(item.id, item.name || item.id)),
            };
          }
        }
      } catch { /* best effort */ }
      return { models: COPILOT_MODELS.map(m => ({ ...m, source: 'live', stale: false, enabled: true })) };
    },

    async *generate({ connection, credentials, body, signal }) {
      const token = credentials.accessToken || credentials.apiKey;
      if (!token) throw new RouterError('AUTH', 'GitHub Copilot credentials missing.', 401);
      const stream = body.stream !== false;

      const response = await fetchImpl(connection.endpoint || COPILOT_CHAT_URL, {
        method: 'POST',
        headers: copilotHeaders(token),
        body: JSON.stringify({ ...body, stream }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let parsed = null;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }
        const message = parsed?.error?.message || errorText || `Copilot error HTTP ${response.status}`;
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
        if (!data || data.error) throw providerError(data?.error?.status || 502);
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
