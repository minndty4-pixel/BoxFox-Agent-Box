/**
 * Anthropic Messages ingress — the dialect Claude Code (`/v1/messages`) speaks,
 * translated onto the router's OpenAI-shaped engine.
 *
 * The vendored 9Router pair (`vendor/9router/openai-to-claude.mjs` and
 * `vendor/9router/claude-to-openai.mjs`) translates the OUTBOUND direction
 * (OpenAI → Anthropic request, Anthropic → OpenAI response); ingress needs both
 * inverses, so this module mirrors those two files and
 * `tests/anthropic-ingress.test.mjs` pins the round trip against them. Framing
 * follows the same rule 9Router uses: `event: <type>` + `data: <json>` + a blank
 * line, and never `[DONE]` for the Anthropic dialect.
 *
 * Nothing is invented. Anthropic-only fields the OpenAI-side path cannot carry
 * (`top_k`, `metadata`, `mcp_servers`, …) are dropped because they have no
 * equivalent; `thinking` becomes the router's own `thinkingLevel`, which every
 * adapter translates or drops per model metadata; and a content block the router
 * cannot represent is a 400 instead of a silent drop.
 */
import { RouterError, safeError } from './errors.mjs';

const MAX_TOKENS_CEILING = 64000;
const MAX_TOOL_NAME_LENGTH = 64;
const TITLE_INSTRUCTION = 'Please write a 5-10 word title for the following conversation:';
const TITLE_FALLBACK = 'BoxFox session';
const CHARS_PER_TOKEN = 4;
const SIGNATURE_TTL_MS = 60 * 60 * 1000;
const SIGNATURE_LIMIT = 2000;

/**
 * Gemini-backed providers hand back an opaque `thought_signature` on every
 * functionCall, and reject a replayed call that lost it ("Function call is
 * missing a thought_signature in functionCall parts").
 *
 * An OpenAI-dialect client can echo it because it rides along as a field on the
 * tool call; Claude Code cannot — Anthropic tool_use blocks have no such field —
 * so the ingress remembers the signature under the tool call id it handed out
 * and re-attaches it when that id comes back in a tool_result round trip. This
 * mirrors 9Router's `open-sse/services/thoughtSignatureStore.js` (RAM tier).
 * Signatures are opaque and short-lived: one hour, newest 2000 kept.
 */
const thoughtSignatures = new Map();

function rememberSignature(id, signature) {
  if (typeof id !== 'string' || !id || typeof signature !== 'string' || !signature) return;
  const now = Date.now();
  for (const [key, entry] of thoughtSignatures) if (entry.expiresAt <= now) thoughtSignatures.delete(key);
  thoughtSignatures.delete(id);
  thoughtSignatures.set(id, { signature, expiresAt: now + SIGNATURE_TTL_MS });
  while (thoughtSignatures.size > SIGNATURE_LIMIT) thoughtSignatures.delete(thoughtSignatures.keys().next().value);
}

/** Remembered thought signature for a tool call id, or null once it expired. */
export function thoughtSignatureFor(id) {
  if (typeof id !== 'string' || !id) return null;
  const entry = thoughtSignatures.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { thoughtSignatures.delete(id); return null; }
  return entry.signature;
}

/** Test seam: drop everything remembered (the store never leaks across runs). */
export function resetThoughtSignatures() {
  thoughtSignatures.clear();
}

/** A signature the client echoed back on a thinking block, if it sent one. */
function echoedSignature(content) {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'thinking' && typeof block.signature === 'string' && block.signature) return block.signature;
  }
  return null;
}

/** Anthropic stop_reason is the mirror of the vendored `claudeFinishReason()`. */
const STOP_REASONS = Object.freeze({
  stop: 'end_turn',
  end_turn: 'end_turn',
  length: 'max_tokens',
  max_tokens: 'max_tokens',
  tool_calls: 'tool_use',
  tool_use: 'tool_use',
  stop_sequence: 'stop_sequence',
  content_filter: 'refusal',
});

const ERROR_TYPES = Object.freeze({
  AUTH: 'authentication_error',
  POLICY_DENIED: 'permission_error',
  MODEL_NOT_FOUND: 'not_found_error',
  NOT_FOUND: 'not_found_error',
  RATE_LIMIT: 'rate_limit_error',
  CAPABILITY: 'invalid_request_error',
  INVALID_REQUEST: 'invalid_request_error',
});

function invalid(message) {
  return new RouterError('INVALID_REQUEST', message, 400);
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

/** Text of an Anthropic `system`/message content value (string or text blocks). */
export function anthropicText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n');
}

/**
 * An Anthropic image block becomes the OpenAI-side `image_url` part the rest of
 * the pipeline already understands: a base64 block turns into a data URI (the
 * Gemini/Antigravity adapter sends it as `inlineData`, the Anthropic adapter as
 * a base64 source, OpenAI-compatible gateways forward it verbatim) and a remote
 * `url` block is passed through. A source shape with no equivalent is a 400.
 */
function imagePart(block) {
  const source = block?.source;
  if (!source || typeof source !== 'object') throw invalid('Anthropic image blocks need a source object.');
  if (source.type === 'base64') {
    if (typeof source.data !== 'string' || !source.data || typeof source.media_type !== 'string' || !source.media_type) {
      throw invalid('Anthropic base64 image blocks need both media_type and data.');
    }
    return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } };
  }
  if (source.type === 'url') {
    if (typeof source.url !== 'string' || !source.url) throw invalid('Anthropic url image blocks need a url.');
    return { type: 'image_url', image_url: { url: source.url } };
  }
  throw invalid(`Unsupported Anthropic image source "${source.type || 'missing'}". Send a base64 block or an http(s) url.`);
}

/** Text carried by a `tool_result` block; its images travel separately. */
function toolResultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    const text = block.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
    if (text) return text;
    const images = block.content.filter(item => item?.type === 'image');
    return images.length ? '' : JSON.stringify(block.content);
  }
  if (block.content === undefined || block.content === null) return '';
  return JSON.stringify(block.content);
}

function toolResultImages(block) {
  if (!Array.isArray(block.content)) return [];
  return block.content.filter(item => item?.type === 'image').map(imagePart);
}

/** A tool result's tool_use_id, as the OpenAI `tool_call_id` the engine expects. */
function toolUseId(value) {
  if (typeof value !== 'string' || !value) throw invalid('Anthropic tool_result blocks need a tool_use_id.');
  return value;
}

/** Text-only parts collapse to a string; anything with an image keeps the array form. */
function contentValue(parts) {
  if (!parts.length) return null;
  if (parts.some(part => part.type !== 'text')) return parts;
  return parts.map(part => part.text).join('\n');
}

function toolChoiceValue(choice) {
  if (choice === undefined || choice === null) return undefined;
  if (typeof choice === 'string') {
    if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
    throw invalid(`Unsupported tool_choice "${choice}".`);
  }
  if (typeof choice !== 'object') throw invalid('tool_choice must be an object or a string.');
  if (choice.type === 'any') return 'required';
  if (choice.type === 'tool') {
    if (typeof choice.name !== 'string' || !choice.name) throw invalid('tool_choice type "tool" needs a name.');
    return { type: 'function', function: { name: choice.name } };
  }
  if (choice.type === 'none') return 'none';
  if (choice.type === 'auto') return 'auto';
  // 9Router falls back to "auto" for anything else; an unknown choice must never
  // break a session, and it must never force a tool either.
  return 'auto';
}

/**
 * Anthropic thinking budgets become the router's own levels so every adapter can
 * translate them (effort style for OpenAI/Gemini, budget_tokens for Anthropic)
 * or drop them per the model's published metadata. `disabled` and unusable
 * budgets simply produce no field.
 */
function thinkingLevel(value) {
  if (!value || typeof value !== 'object' || value.type !== 'enabled') return null;
  const budget = Number(value.budget_tokens);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  if (budget <= 4096) return 'low';
  if (budget <= 12288) return 'medium';
  return 'high';
}

/**
 * Anthropic Messages request → the OpenAI-shaped body `RouterEngine.generate()`
 * accepts. `system`, text/image blocks, `tool_use`/`tool_result` round trips,
 * `tools[].input_schema`, `tool_choice`, sampling and stop sequences are all
 * mapped; see the module header for what is intentionally dropped.
 */
export function anthropicToOpenAI(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Anthropic request body must be a JSON object.');
  if (typeof body.model !== 'string' || !body.model.trim()) throw invalid('model is required. Use a router model id: connectionId/modelId or an alias name.');
  const maxTokens = Number(body.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw invalid('max_tokens must be a positive integer.');
  if (maxTokens > MAX_TOKENS_CEILING) throw invalid(`max_tokens must be 1–${MAX_TOKENS_CEILING}; the request asked for ${maxTokens}.`);

  const messages = [];
  const system = anthropicText(body.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system' || message.role === 'developer') {
      const text = anthropicText(message.content);
      if (text) messages.push({ role: 'system', content: text });
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') throw invalid(`Unsupported Anthropic role "${message.role}". Use "user" or "assistant".`);
    const blocks = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: typeof message.content === 'string' ? message.content : '' }];
    const parts = [];
    const toolCalls = [];
    const toolMessages = [];
    const clientSignature = message.role === 'assistant' ? echoedSignature(message.content) : null;

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      // Assistant thinking is model-internal: the OpenAI-side path has no field
      // for it, and replaying it to another provider would be a different
      // request than the one the user made.
      if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
      if (block.type === 'text') {
        if (typeof block.text === 'string' && block.text) parts.push({ type: 'text', text: block.text });
        continue;
      }
      if (block.type === 'image') { parts.push(imagePart(block)); continue; }
      if (message.role === 'assistant' && block.type === 'tool_use') {
        if (typeof block.name !== 'string' || !block.name) throw invalid('Anthropic tool_use blocks need a name.');
        const id = typeof block.id === 'string' && block.id ? block.id : `toolu_${messages.length}_${toolCalls.length}`;
        // Gemini providers need their own opaque signature on a replayed call,
        // and Claude Code has nowhere to keep it: prefer whatever the client
        // echoed, then the block itself, then what the ingress remembered.
        const signature = block.thought_signature || thoughtSignatureFor(id) || clientSignature;
        toolCalls.push({
          id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          ...(signature ? { thought_signature: signature, thoughtSignature: signature } : {}),
        });
        continue;
      }
      if (message.role === 'user' && block.type === 'tool_result') {
        toolMessages.push({ role: 'tool', tool_call_id: toolUseId(block.tool_use_id), content: toolResultText(block) });
        // An OpenAI tool message is text-only, so an image a tool returned would
        // vanish; it rides in the user turn that follows, tagged with its call id.
        for (const image of toolResultImages(block)) { parts.push({ type: 'text', text: `[Image from tool result ${block.tool_use_id}]` }); parts.push(image); }
        continue;
      }
      throw invalid(`Unsupported Anthropic content block "${block.type}" in a ${message.role} message.`);
    }

    if (message.role === 'assistant') {
      if (parts.length || toolCalls.length) {
        messages.push({ role: 'assistant', content: contentValue(parts), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      }
      continue;
    }
    messages.push(...toolMessages);
    if (parts.length) messages.push({ role: 'user', content: contentValue(parts) });
  }

  if (!messages.some(message => message.role === 'user' || message.role === 'tool')) throw invalid('Provide at least one user message.');

  const translated = { model: body.model.trim(), messages, stream: body.stream === true };

  if (Array.isArray(body.tools) && body.tools.length) {
    translated.tools = body.tools.map(tool => {
      if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !tool.name) throw invalid('Anthropic tools need a name.');
      if (tool.name.length > MAX_TOOL_NAME_LENGTH) throw invalid(`Anthropic tool name "${tool.name}" is longer than ${MAX_TOOL_NAME_LENGTH} characters.`);
      const schema = tool.input_schema ?? { type: 'object', properties: {} };
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw invalid(`Anthropic tool "${tool.name}" needs an object input_schema.`);
      return { type: 'function', function: { name: tool.name, description: typeof tool.description === 'string' ? tool.description : '', parameters: schema } };
    });
  }

  const choice = toolChoiceValue(body.tool_choice);
  if (choice !== undefined) translated.tool_choice = choice;
  const level = thinkingLevel(body.thinking);
  if (level) translated.thinkingLevel = level;
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || !Number.isFinite(body.temperature)) throw invalid('temperature must be a number.');
    translated.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    if (typeof body.top_p !== 'number' || !Number.isFinite(body.top_p)) throw invalid('top_p must be a number.');
    translated.top_p = body.top_p;
  }
  translated.max_tokens = maxTokens;
  if (body.stop_sequences !== undefined) {
    if (!Array.isArray(body.stop_sequences) || !body.stop_sequences.every(value => typeof value === 'string' && value)) throw invalid('stop_sequences must be an array of non-empty strings.');
    if (body.stop_sequences.length) translated.stop = body.stop_sequences;
  }

  // The ingress may add its own routing hints without changing the client body.
  for (const field of ['connectionId', 'modelId', 'aliasId', 'providerId']) {
    if (typeof body[field] === 'string' && body[field]) translated[field] = body[field];
  }
  return translated;
}

/** OpenAI-side finish_reason → Anthropic stop_reason. */
export function anthropicStopReason(finishReason) {
  return STOP_REASONS[String(finishReason ?? 'stop')] || 'end_turn';
}

// ---------------------------------------------------------------------------
// Response translation: router engine events → Anthropic protocol events.
// One state machine serves both dialects, so the streamed frames and the
// non-streaming message object can never disagree about content or stop reason.
// ---------------------------------------------------------------------------

export function createAnthropicState({ id, model, inputTokens = 0 }) {
  return {
    id,
    model,
    inputTokens: Math.max(0, Math.round(count(inputTokens) ?? 0)),
    started: false,
    finished: false,
    open: null,
    blocks: [],
    toolCalls: new Map(),
    nextIndex: 0,
    usageEvent: null,
    stopReason: null,
    stopSequence: null,
  };
}

function ensureStarted(state, out) {
  if (state.started) return;
  state.started = true;
  out.push({
    type: 'message_start',
    message: {
      id: state.id,
      type: 'message',
      role: 'assistant',
      model: state.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      // The provider's real count is only known at the end; this is the same
      // 4-characters-per-token estimate /v1/messages/count_tokens reports, not a
      // fabricated number, and message_delta carries the reported usage.
      usage: { input_tokens: state.inputTokens, output_tokens: 0 },
    },
  });
}

function contentBlockStart(block) {
  if (block.type === 'text') return { type: 'text', text: '' };
  if (block.type === 'thinking') return { type: 'thinking', thinking: '' };
  return { type: 'tool_use', id: block.id, name: block.name, input: {} };
}

function openBlock(state, out, type, extra = {}) {
  ensureStarted(state, out);
  closeBlock(state, out);
  const block = { index: state.nextIndex++, type, text: '', thinking: '', arguments: '', id: '', name: '', ...extra };
  state.blocks.push(block);
  state.open = block;
  out.push({ type: 'content_block_start', index: block.index, content_block: contentBlockStart(block) });
  return block;
}

function closeBlock(state, out) {
  const block = state.open;
  if (!block) return;
  if (block.type === 'tool_use') {
    // The OpenAI-side stream fragments tool arguments; Anthropic clients expect
    // `input_json_delta`, so the buffered JSON is released once, at block stop.
    out.push({ type: 'content_block_delta', index: block.index, delta: { type: 'input_json_delta', partial_json: block.arguments || '{}' } });
  }
  out.push({ type: 'content_block_stop', index: block.index });
  state.open = null;
}

function anthropicUsage(state) {
  const usage = state.usageEvent || {};
  const cached = count(usage.cached_tokens) ?? 0;
  const created = count(usage.cache_creation_input_tokens) ?? 0;
  const prompt = count(usage.prompt_tokens);
  // Anthropic's input_tokens excludes cache reads and writes; the engine's
  // prompt_tokens includes them (same convention as the vendored translator).
  const inputTokens = prompt === null ? state.inputTokens : Math.max(0, prompt - cached - created);
  const outputTokens = count(usage.completion_tokens)
    ?? Math.ceil((state.blocks.reduce((total, block) => total + block.text.length + block.thinking.length, 0)) / CHARS_PER_TOKEN);
  const result = { input_tokens: inputTokens, output_tokens: outputTokens };
  if (cached) result.cache_read_input_tokens = cached;
  if (created) result.cache_creation_input_tokens = created;
  return result;
}

function toolInput(argumentsText) {
  try { return JSON.parse(argumentsText || '{}'); } catch { return {}; }
}

/**
 * Applies one router engine event to the state and returns the Anthropic
 * protocol events it produced (`message_start` … `message_stop`).
 */
export function anthropicApply(state, event) {
  const out = [];
  if (!state || !event) return out;
  if (event.type === 'delta') {
    const delta = event.delta || {};
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : (typeof delta.reasoning === 'string' ? delta.reasoning : null);
    if (reasoning) {
      const block = state.open && state.open.type === 'thinking' ? state.open : openBlock(state, out, 'thinking');
      block.thinking += reasoning;
      out.push({ type: 'content_block_delta', index: block.index, delta: { type: 'thinking_delta', thinking: reasoning } });
    }
    if (typeof delta.content === 'string' && delta.content) {
      const block = state.open && state.open.type === 'text' ? state.open : openBlock(state, out, 'text');
      block.text += delta.content;
      out.push({ type: 'content_block_delta', index: block.index, delta: { type: 'text_delta', text: delta.content } });
    }
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const key = call.index ?? state.toolCalls.size;
      const record = state.toolCalls.get(key) || { id: '', name: '', arguments: '' };
      if (typeof call.id === 'string' && call.id) record.id = call.id;
      if (typeof call.function?.name === 'string') record.name += call.function.name;
      if (typeof call.function?.arguments === 'string') record.arguments += call.function.arguments;
      // Gemini providers attach an opaque signature to each function call; the
      // Anthropic dialect has no field for it, so keep it for the round trip.
      const signature = call.thought_signature || call.thoughtSignature;
      if (typeof signature === 'string' && signature) record.signature = signature;
      state.toolCalls.set(key, record);
    }
    return out;
  }
  if (event.type === 'usage') {
    state.usageEvent = event.usage && typeof event.usage === 'object' ? event.usage : null;
    return out;
  }
  if (event.type === 'finish') {
    if (state.finished) return out;
    state.finished = true;
    state.stopReason = anthropicStopReason(event.finishReason);
    ensureStarted(state, out);
    closeBlock(state, out);
    for (const record of state.toolCalls.values()) if (record.signature) rememberSignature(record.id, record.signature);
    // Tool blocks open here, once their id, name and arguments are complete (the
    // engine fragments all three across deltas), then release the buffered JSON
    // as a single input_json_delta immediately followed by content_block_stop.
    for (const record of state.toolCalls.values()) {
      if (!record.id && !record.name && !record.arguments) continue;
      const block = openBlock(state, out, 'tool_use', { id: record.id || `toolu_${state.nextIndex}`, name: record.name });
      block.arguments = record.arguments;
      closeBlock(state, out);
    }
    out.push({ type: 'message_delta', delta: { stop_reason: state.stopReason, stop_sequence: state.stopSequence }, usage: anthropicUsage(state) });
    out.push({ type: 'message_stop' });
  }
  return out;
}

/** The non-streaming Anthropic `message` object for the events applied so far. */
export function anthropicMessageBody(state) {
  const content = [];
  for (const block of state.blocks) {
    if (block.type === 'text' && block.text) content.push({ type: 'text', text: block.text });
    else if (block.type === 'thinking' && block.thinking) content.push({ type: 'thinking', thinking: block.thinking });
    else if (block.type === 'tool_use') {
      content.push({ type: 'tool_use', id: block.id || `toolu_${block.index}`, name: block.name, input: toolInput(block.arguments) });
    }
  }
  return {
    id: state.id,
    type: 'message',
    role: 'assistant',
    model: state.model,
    content,
    stop_reason: state.stopReason || 'end_turn',
    stop_sequence: state.stopSequence || null,
    usage: anthropicUsage(state),
  };
}

/** `event: <type>\ndata: <json>\n\n` — the Anthropic SSE frame; never `[DONE]`. */
export function anthropicFrame(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Anthropic error body for a router error, keeping the HTTP status. */
export function anthropicError(error) {
  const safe = error instanceof RouterError ? error : safeError(error);
  const type = ERROR_TYPES[safe.code] || (safe.status >= 500 ? 'api_error' : 'invalid_request_error');
  return { type: 'error', error: { type, message: safe.message } };
}

/**
 * The `count_tokens` estimate: 4 characters per token over `system`, `tools` and
 * every message block. Image payloads contribute no characters — a base64 blob
 * divided by four would be a wildly wrong number, and the router does not invent
 * pixel-based token costs.
 */
function charCount(value) {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((total, item) => total + charCount(item), 0);
  if (!value || typeof value !== 'object') return 0;
  switch (value.type) {
    case 'text': return charCount(value.text);
    case 'thinking': return charCount(value.thinking);
    case 'tool_use': return charCount(value.name) + charCount(value.input);
    case 'tool_result': return charCount(value.content);
    case 'image': return 0;
    default: return Object.entries(value).reduce((total, [key, item]) => total + key.length + charCount(item), 0);
  }
}

export function estimateInputTokens(body) {
  const value = body && typeof body === 'object' ? body : {};
  let chars = charCount(value.system) + charCount(value.tools);
  for (const message of Array.isArray(value.messages) ? value.messages : []) chars += charCount(message);
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

// ---------------------------------------------------------------------------
// Claude Code housekeeping: the CLI fires warm-up, title-extraction and
// lightweight count traffic that must not spend a provider call. Each pattern
// below is structural or a documented Claude Code prompt, and every one of them
// is gated on the claude-cli user agent — a real user request always carries
// tools, so the two prompt-based patterns additionally require a tool-less body.
// ---------------------------------------------------------------------------

function cliTitle(messages) {
  const source = [...messages].reverse().find(message => message.role === 'user');
  const raw = anthropicText(source?.content)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Please write a \d+-\d+ word title for the following conversation:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  const title = raw.split(' ').filter(Boolean).slice(0, 6).join(' ');
  return (title || TITLE_FALLBACK).slice(0, 80);
}

/**
 * Returns `{kind, text, stopReason}` when the request is one of the known Claude
 * Code housekeeping calls, otherwise null (the request goes to a real model).
 */
export function claudeCliHousekeeping(body, userAgent = '') {
  if (!String(userAgent).toLowerCase().includes('claude-cli')) return null;
  const messages = (Array.isArray(body?.messages) ? body.messages : []).filter(message => message && typeof message === 'object');
  if (!messages.length) return null;
  const last = messages[messages.length - 1];
  const lastText = anthropicText(last.content).trim();
  // Pattern 1 — title extraction: the CLI prefills the assistant turn with an
  // open JSON object and completes it with the model's answer.
  if (last.role === 'assistant' && lastText === '{') return { kind: 'title', text: `"title": ${JSON.stringify(cliTitle(messages))}}`, stopReason: 'end_turn' };
  if (messages.length === 1 && last.role === 'user' && lastText === 'Warmup') return { kind: 'warmup', text: 'Warmup acknowledged.', stopReason: 'end_turn' };
  if (messages.length === 1 && last.role === 'user' && lastText === 'count') return { kind: 'count', text: 'count', stopReason: 'end_turn' };
  // A user request always advertises tools; the two prompt-shaped patterns are
  // additionally guarded so a real turn can never be answered locally.
  const hasTools = Array.isArray(body?.tools) && body.tools.length > 0;
  if (hasTools) return null;
  const system = anthropicText(body?.system);
  if (system.includes(TITLE_INSTRUCTION) || messages.some(message => message.role === 'user' && anthropicText(message.content).includes(TITLE_INSTRUCTION))) {
    return { kind: 'title', text: cliTitle(messages), stopReason: 'end_turn' };
  }
  if (system.includes('isNewTopic')) return { kind: 'naming', text: JSON.stringify({ isNewTopic: true, title: cliTitle(messages) }), stopReason: 'end_turn' };
  return null;
}

/** The engine events a housekeeping answer is streamed from. */
export function housekeepingEvents(answer) {
  // No usage event: the state machine falls back to the count_tokens estimate of
  // the request and the answer, so the answer never reports invented provider usage.
  return [
    { type: 'delta', delta: { content: answer.text } },
    { type: 'finish', finishReason: answer.stopReason || 'stop' },
  ];
}
