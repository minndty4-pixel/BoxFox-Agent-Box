// Anthropic Claude SSE events to BoxFox Router events translator
// Adapted from 9Router MIT-licensed open-sse/translator/response/claude-to-openai.js

export function claudeFinishReason(stopReason, hadToolCall = false) {
  if (hadToolCall || stopReason === 'tool_use') return 'tool_calls';
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'stop_sequence') return 'stop';
  return 'stop';
}

export function claudeChunkToEvents(chunk, state = { toolIndex: 0, currentTool: null, hadToolCall: false, promptTokens: 0, cachedTokens: 0 }) {
  if (!chunk || typeof chunk !== 'object') return [];
  const events = [];
  const eventType = chunk.type;

  // Non-streaming response format
  if (chunk.role === 'assistant' && Array.isArray(chunk.content)) {
    for (const block of chunk.content) {
      if (block.type === 'text' && block.text) {
        events.push({ type: 'delta', delta: { content: block.text } });
      } else if (block.type === 'tool_use') {
        state.hadToolCall = true;
        events.push({
          type: 'delta',
          delta: {
            tool_calls: [{
              index: state.toolIndex++,
              id: block.id || `call_${Date.now()}`,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
              },
            }],
          },
        });
      }
    }
    if (chunk.usage) {
      const input = Number(chunk.usage.input_tokens) || 0;
      const output = Number(chunk.usage.output_tokens) || 0;
      const cached = Number(chunk.usage.cache_read_input_tokens) || 0;
      events.push({
        type: 'usage',
        usage: {
          prompt_tokens: input + cached,
          completion_tokens: output,
          total_tokens: input + output + cached,
          cached_tokens: cached,
        },
      });
    }
    if (chunk.stop_reason) {
      events.push({ type: 'finish', finishReason: claudeFinishReason(chunk.stop_reason, state.hadToolCall) });
    }
    return events;
  }

  // Streaming SSE event types
  switch (eventType) {
    case 'message_start': {
      const u = chunk.message?.usage;
      if (u) {
        state.promptTokens = Number(u.input_tokens) || 0;
        state.cachedTokens = Number(u.cache_read_input_tokens) || 0;
      }
      break;
    }

    case 'content_block_start': {
      const block = chunk.content_block;
      if (block?.type === 'tool_use') {
        state.hadToolCall = true;
        state.currentTool = {
          index: state.toolIndex++,
          id: block.id,
          name: block.name,
          arguments: '',
        };
        events.push({
          type: 'delta',
          delta: {
            tool_calls: [{
              index: state.currentTool.index,
              id: state.currentTool.id,
              type: 'function',
              function: { name: block.name, arguments: '' },
            }],
          },
        });
      }
      break;
    }

    case 'content_block_delta': {
      const delta = chunk.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        events.push({ type: 'delta', delta: { content: delta.text } });
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        if (state.currentTool) {
          state.currentTool.arguments += delta.partial_json;
          events.push({
            type: 'delta',
            delta: {
              tool_calls: [{
                index: state.currentTool.index,
                id: state.currentTool.id,
                type: 'function',
                function: { name: '', arguments: delta.partial_json },
              }],
            },
          });
        }
      }
      break;
    }

    case 'content_block_stop': {
      state.currentTool = null;
      break;
    }

    case 'message_delta': {
      if (chunk.usage) {
        const output = Number(chunk.usage.output_tokens) || 0;
        events.push({
          type: 'usage',
          usage: {
            prompt_tokens: state.promptTokens + state.cachedTokens,
            completion_tokens: output,
            total_tokens: state.promptTokens + output + state.cachedTokens,
            cached_tokens: state.cachedTokens,
          },
        });
      }
      if (chunk.delta?.stop_reason) {
        events.push({ type: 'finish', finishReason: claudeFinishReason(chunk.delta.stop_reason, state.hadToolCall) });
      }
      break;
    }

    case 'message_stop': {
      if (!events.some(e => e.type === 'finish')) {
        events.push({ type: 'finish', finishReason: state.hadToolCall ? 'tool_calls' : 'stop' });
      }
      break;
    }
  }

  return events;
}
