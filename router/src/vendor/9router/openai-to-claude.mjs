// OpenAI to Anthropic Claude request translator
// Adapted from 9Router MIT-licensed open-sse/translator/request/openai-to-claude.js

export function openAIToClaudeRequest(body, stream = false) {
  const model = body.model;
  const max_tokens = typeof body.max_tokens === 'number' && body.max_tokens > 0
    ? body.max_tokens
    : (typeof body.max_completion_tokens === 'number' && body.max_completion_tokens > 0 ? body.max_completion_tokens : 4096);

  const result = {
    model,
    max_tokens,
    stream: Boolean(stream),
  };

  if (typeof body.temperature === 'number') {
    result.temperature = body.temperature;
  }
  if (typeof body.top_p === 'number') {
    result.top_p = body.top_p;
  }

  const systemParts = [];
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const processedMessages = [];

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content)
        ? msg.content.map(c => typeof c === 'string' ? c : c?.text || '').join('\n')
        : '';
      if (text.trim()) systemParts.push(text.trim());
      continue;
    }

    if (msg.role === 'tool') {
      processedMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || '',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
        }],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts = [];
      if (typeof msg.content === 'string' && msg.content.trim()) {
        parts.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item?.type === 'text' && item.text) parts.push({ type: 'text', text: item.text });
        }
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc?.type === 'function' && tc.function?.name) {
            let parsed = {};
            try { parsed = JSON.parse(tc.function.arguments || '{}'); } catch { parsed = { raw: tc.function.arguments }; }
            parts.push({
              type: 'tool_use',
              id: tc.id || `toolu_${Date.now()}`,
              name: tc.function.name,
              input: parsed,
            });
          }
        }
      }
      if (parts.length > 0) {
        processedMessages.push({ role: 'assistant', content: parts });
      }
      continue;
    }

    // User message
    const parts = [];
    if (typeof msg.content === 'string') {
      parts.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'text' && item.text) {
          parts.push({ type: 'text', text: item.text });
        } else if (item.type === 'image_url' && item.image_url?.url) {
          const url = item.image_url.url;
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            });
          }
        }
      }
    }
    if (parts.length > 0) {
      processedMessages.push({ role: 'user', content: parts });
    }
  }

  // Merge consecutive messages with the same role (Anthropic requires alternating user/assistant)
  const mergedMessages = [];
  for (const m of processedMessages) {
    const prev = mergedMessages[mergedMessages.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = [...prev.content, ...m.content];
    } else {
      mergedMessages.push({ role: m.role, content: [...m.content] });
    }
  }

  result.messages = mergedMessages;
  if (systemParts.length > 0) {
    result.system = systemParts.join('\n\n');
  }

  // Tools mapping
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    result.tools = body.tools.filter(t => t?.type === 'function' && t.function?.name).map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
  }

  return result;
}
