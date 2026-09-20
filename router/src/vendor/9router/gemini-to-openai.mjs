// Adapted from 9router open-sse/translator/response/gemini-to-openai.js (MIT).

// Fallback ids must be unique across the whole process: the Anthropic ingress remembers a
// thought signature under the id it handed to the client and looks it up when the id comes
// back in a `tool_result`, so two requests minting the same id in the same millisecond
// (same index, `Date.now()` resolution) would cross-attach another request's signature —
// which Gemini rejects. A monotonic counter plus the timestamp removes the collision.
let fallbackCallCounter = 0;

export function geminiFinishReason(reason, hadToolCall = false) {
  const normalized = String(reason || '').toUpperCase();
  if (hadToolCall && ['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(normalized)) return 'tool_calls';
  if (normalized === 'MAX_TOKENS') return 'length';
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(normalized)) return 'content_filter';
  return 'stop';
}

export function geminiUsage(response) {
  const usage = response?.usageMetadata;
  if (!usage) return null;
  const prompt = typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : NaN;
  const completion = typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : NaN;
  const total = typeof usage.totalTokenCount === 'number' ? usage.totalTokenCount : NaN;
  const reasoning = typeof usage.thoughtsTokenCount === 'number' ? usage.thoughtsTokenCount : NaN;
  const normalized = {};
  if (Number.isFinite(prompt)) normalized.prompt_tokens = prompt;
  if (Number.isFinite(completion)) normalized.completion_tokens = completion;
  if (Number.isFinite(total)) normalized.total_tokens = total;
  else if (Number.isFinite(prompt) || Number.isFinite(completion)) normalized.total_tokens = (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
  if (Number.isFinite(reasoning)) normalized.reasoning_tokens = reasoning;
  return Object.keys(normalized).length ? normalized : null;
}

export function geminiChunkToEvents(chunk, state = { toolIndex: 0, hadToolCall: false }) {
  const response = chunk?.response || chunk;
  const candidate = response?.candidates?.[0];
  const candidateSig = candidate?.thoughtSignature || candidate?.thought_signature || null;
  if (candidateSig) state.lastThoughtSignature = candidateSig;
  const events = [];
  for (const part of candidate?.content?.parts || []) {
    const sigFound = part?.thoughtSignature || part?.thought_signature || part?.functionCall?.thoughtSignature || part?.functionCall?.thought_signature || candidateSig || null;
    if (sigFound) {
      state.lastThoughtSignature = sigFound;
    }
    if (part?.thought === true) {
      if (typeof part?.text === 'string' && part.text) {
        events.push({ type: 'delta', delta: { reasoning_content: part.text } });
      }
      continue;
    }
    if (typeof part?.text === 'string' && part.text) events.push({ type: 'delta', delta: { content: part.text } });
    if (part?.functionCall) {
      const index = state.toolIndex++;
      state.hadToolCall = true;
      const sig = part.functionCall?.thoughtSignature || part.functionCall?.thought_signature || part.thoughtSignature || part.thought_signature || state.lastThoughtSignature || null;
      events.push({ type: 'delta', delta: { tool_calls: [{
        index,
        id: part.functionCall.id || `call_${index}_${(fallbackCallCounter += 1).toString(36)}_${Date.now().toString(36)}`,
        type: 'function',
        function: { name: part.functionCall.name || 'tool', arguments: JSON.stringify(part.functionCall.args || {}) },
        ...(sig ? { thought_signature: sig, thoughtSignature: sig } : {}),
      }] } });
    }
  }
  const usage = geminiUsage(response);
  if (usage) events.push({ type: 'usage', usage });
  if (candidate?.finishReason) events.push({ type: 'finish', finishReason: geminiFinishReason(candidate.finishReason, state.hadToolCall) });
  return events;
}
