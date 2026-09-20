// OpenCode Free Provider Adapter for BoxFox Router
// Adapted from 9Router MIT-licensed open-sse/providers/registry/opencode.js and open-sse/executors/opencode.js

import { randomUUID } from 'node:crypto';
import { jsonOrProviderError, modelRecord, normalizeFinishReason, parseJson, providerError, sseEvents } from './common.mjs';
import { RouterError } from '../errors.mjs';

const BASE_URL = 'https://opencode.ai';
const CHAT_URL = 'https://opencode.ai/zen/v1/chat/completions';
const RESPONSES_URL = 'https://opencode.ai/zen/v1/responses';
const MODELS_URL = 'https://opencode.ai/zen/v1/models';

export const OPENCODE_MODELS = Object.freeze([
  { ...modelRecord('muse-spark-1.2-contributor-free', 'Muse Spark 1.2 Contributor Free', {}, { thinkingType: 'effort', thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] }) },
  { ...modelRecord('muse-spark-1.3-contributor-free', 'Muse Spark 1.3 Contributor Free', {}, { thinkingType: 'effort', thinkingLevels: ['auto', 'none', 'low', 'medium', 'high'] }) },
]);

function isResponsesModel(modelId) {
  const m = String(modelId || '').toLowerCase();
  return m.includes('muse-spark') || m.includes('responses');
}

function opencodeHeaders(stream = true, apiKey = null) {
  return {
    'Content-Type': 'application/json',
    Authorization: apiKey ? `Bearer ${apiKey}` : 'Bearer public',
    'User-Agent': 'opencode',
    'x-opencode-client': 'desktop',
    'x-opencode-session': `ses_${randomUUID().replace(/-/g, '')}`,
    'x-opencode-request': `msg_${randomUUID().replace(/-/g, '')}`,
    'x-opencode-project': 'global',
    Accept: stream ? 'text/event-stream' : '*/*',
  };
}

export function createOpenCodeAdapter({ fetchImpl }) {
  return {
    fallbackModels: OPENCODE_MODELS.map(model => ({ ...model, source: 'static', stale: false, enabled: true })),

    async discover({ connection, credentials, signal } = {}) {
      try {
        const rawBase = (connection?.endpoint || 'https://opencode.ai').replace(/\/+$/, '');
        const base = rawBase.includes('/zen/v1') ? rawBase : `${rawBase}/zen/v1`;
        const modelsUrl = `${base}/models`;
        const response = await fetchImpl(modelsUrl, {
          headers: opencodeHeaders(false, credentials?.apiKey),
          signal,
        });
        if (response.ok) {
          const data = await response.json();
          const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (list.length) {
            return {
              models: list.map(item => {
                const isFreeOrCurated = item.id.includes('contributor-free') || item.id.includes('-free') || OPENCODE_MODELS.some(m => m.id === item.id);
                return {
                  ...modelRecord(item.id, item.name || item.id),
                  enabled: isFreeOrCurated,
                  stale: false,
                  source: 'live',
                };
              }),
            };
          }
        }
      } catch {
        /* best effort fallback */
      }
      return {
        // Curated fallback: the inventory call did not answer, so this is not
        // live data (BUG-4/R2).
        models: OPENCODE_MODELS.map(m => ({ ...m, source: 'static', stale: false, enabled: true })),
      };
    },

    async *generate({ connection, credentials, body, signal }) {
      const stream = body.stream !== false;
      const modelId = body.model;
      const rawBase = (connection?.endpoint || 'https://opencode.ai').replace(/\/+$/, '');
      const base = rawBase.includes('/zen/v1') ? rawBase : `${rawBase}/zen/v1`;
      const isResponses = isResponsesModel(modelId);
      const targetUrl = isResponses
        ? `${base}/responses`
        : `${base}/chat/completions`;

      let requestBody;
      if (isResponses) {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const instructions = messages.find(m => m.role === 'system' || m.role === 'developer')?.content;
        const input = messages.filter(m => m.role !== 'system' && m.role !== 'developer').map(m => ({
          type: 'message',
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string'
            ? [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }]
            : m.content,
        }));
        if (input.length === 0) {
          input.push({
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }],
          });
        }
        requestBody = {
          model: modelId,
          input,
          ...(instructions ? { instructions: typeof instructions === 'string' ? instructions : JSON.stringify(instructions) } : {}),
          max_output_tokens: Math.max(1000, body.max_output_tokens || body.max_tokens || 1000),
          stream,
          store: false,
        };
      } else {
        requestBody = { ...body, stream };
      }

      const response = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: opencodeHeaders(stream, credentials?.apiKey),
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let parsed = null;
        try { parsed = JSON.parse(errorText); } catch { /* ignore */ }
        let message = parsed?.error?.message || parsed?.message;
        if (!message) {
          if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
            message = `OpenCode API returned HTTP ${response.status} (${response.statusText || 'Endpoint Error'})`;
          } else {
            message = errorText.slice(0, 300) || `OpenCode error HTTP ${response.status}`;
          }
        }
        if (response.status === 429) throw new RouterError('RATE_LIMIT', message, 429, true);
        throw new RouterError('PROVIDER_ERROR', message, response.status, response.status >= 500);
      }

      if (!stream) {
        const data = await jsonOrProviderError(response);
        if (isResponses) {
          const items = Array.isArray(data) ? data : Array.isArray(data?.output) ? data.output : [];
          const msgItem = items.find(item => item.type === 'message');
          let text = '';
          if (msgItem?.content) {
            if (typeof msgItem.content === 'string') {
              text = msgItem.content;
            } else if (Array.isArray(msgItem.content)) {
              for (const part of msgItem.content) {
                if (part.type === 'output_text' && part.text) text += part.text;
                else if (typeof part === 'string') text += part;
              }
            }
          }
          if (text) {
            yield { type: 'delta', delta: { content: text } };
          }
          if (data?.usage) {
            yield {
              type: 'usage',
              usage: {
                prompt_tokens: data.usage.input_tokens || 0,
                completion_tokens: data.usage.output_tokens || 0,
                total_tokens: data.usage.total_tokens || ((data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)),
              },
            };
          }
          yield { type: 'finish', finishReason: 'stop' };
          return;
        }

        const choice = data?.choices?.[0];
        const message = choice?.message || {};
        const reasoning = message.reasoning_content || message.reasoning || message.thought;
        if (message.content || message.tool_calls?.length || reasoning) {
          yield { type: 'delta', delta: { ...(message.content ? { content: message.content } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}), ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) } };
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

        if (isResponses) {
          if (data.type === 'response.output_text.delta' && data.delta) {
            yield { type: 'delta', delta: { content: data.delta } };
          }
          if ((data.type === 'response.reasoning.delta' || data.type === 'response.thought.delta') && data.delta) {
            yield { type: 'delta', delta: { reasoning_content: data.delta } };
          }
          if (data.type === 'response.completed' || data.type === 'response.done') {
            if (data.response?.usage) {
              const u = data.response.usage;
              yield {
                type: 'usage',
                usage: {
                  prompt_tokens: u.input_tokens || 0,
                  completion_tokens: u.output_tokens || 0,
                  total_tokens: u.total_tokens || ((u.input_tokens || 0) + (u.output_tokens || 0)),
                },
              };
            }
            yield { type: 'finish', finishReason: 'stop' };
          }
          continue;
        }

        const choice = data.choices?.[0];
        const reasoning = choice?.delta?.reasoning_content || choice?.delta?.reasoning || choice?.delta?.thought;
        if (choice?.delta && (choice.delta.content || choice.delta.tool_calls?.length || reasoning)) {
          yield { type: 'delta', delta: { ...choice.delta, ...(reasoning ? { reasoning_content: reasoning } : {}) } };
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
