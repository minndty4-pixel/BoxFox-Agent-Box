// Adapted from 9router open-sse/translator/request/openai-to-gemini.js (MIT).
import {
  cleanJSONSchemaForAntigravity,
  convertOpenAIContentToParts,
  extractTextContent,
  normalizeGeminiContents,
  sanitizeGeminiFunctionName,
  tryParseJSON,
} from './gemini.mjs';

function toolNameMap(messages) {
  const result = new Map();
  for (const message of messages || []) {
    for (const call of message?.tool_calls || []) {
      if (call?.id && call?.function?.name) result.set(call.id, call.function.name);
    }
  }
  return result;
}

export function openAIToGeminiRequest(model, body, { antigravity = false, projectId = null, sessionId = null } = {}) {
  const result = { contents: [], generationConfig: {} };
  if (body.temperature !== undefined) result.generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined) result.generationConfig.topP = body.top_p;
  if (body.max_tokens !== undefined) result.generationConfig.maxOutputTokens = Math.min(body.max_tokens, 64000);

  const names = toolNameMap(body.messages);
  const toolResponses = new Map((body.messages || []).filter(m => m.role === 'tool' && m.tool_call_id).map(m => [m.tool_call_id, m.content]));
  for (const message of body.messages || []) {
    if (['system', 'developer'].includes(message.role)) {
      const text = extractTextContent(message.content, '\n');
      if (text) {
        const existing = result.systemInstruction?.parts?.[0]?.text;
        result.systemInstruction = { role: 'user', parts: [{ text: existing ? `${existing}\n${text}` : text }] };
      }
      continue;
    }
    if (message.role === 'user') {
      const parts = convertOpenAIContentToParts(message.content);
      if (parts.length) result.contents.push({ role: 'user', parts });
      continue;
    }
    if (message.role === 'assistant') {
      const parts = [];
      const text = extractTextContent(message.content);
      if (text) parts.push({ text });
      for (const call of message.tool_calls || []) {
        if (call?.type !== 'function' || !call.function?.name) continue;
        parts.push({ functionCall: { id: call.id, name: sanitizeGeminiFunctionName(call.function.name), args: tryParseJSON(call.function.arguments || '{}', {}) } });
      }
      if (parts.length) result.contents.push({ role: 'model', parts });
      continue;
    }
    if (message.role === 'tool' && message.tool_call_id) {
      const parsed = tryParseJSON(toolResponses.get(message.tool_call_id), null);
      result.contents.push({ role: 'user', parts: [{ functionResponse: {
        id: message.tool_call_id,
        name: sanitizeGeminiFunctionName(names.get(message.tool_call_id) || 'tool'),
        response: parsed && typeof parsed === 'object' ? parsed : { result: message.content ?? '' },
      } }] });
    }
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    const functionDeclarations = body.tools.filter(tool => tool?.type === 'function' && tool.function?.name).map(tool => ({
      name: sanitizeGeminiFunctionName(tool.function.name),
      description: tool.function.description || '',
      parameters: cleanJSONSchemaForAntigravity(tool.function.parameters || { type: 'object', properties: {} }),
    }));
    if (functionDeclarations.length) {
      result.tools = [{ functionDeclarations }];
      const choice = body.tool_choice;
      result.toolConfig = { functionCallingConfig: { mode: choice === 'none' ? 'NONE' : choice === 'required' || typeof choice === 'object' ? 'ANY' : 'AUTO', ...(typeof choice === 'object' && choice.function?.name ? { allowedFunctionNames: [sanitizeGeminiFunctionName(choice.function.name)] } : {}) } };
    }
  }
  result.contents = normalizeGeminiContents(result.contents);
  if (!antigravity) return result;
  return {
    project: projectId,
    model,
    userAgent: 'antigravity',
    requestType: 'agent',
    requestId: `agent-${crypto.randomUUID()}`,
    request: { ...result, sessionId: sessionId || `${crypto.randomUUID()}${Date.now()}` },
  };
}
