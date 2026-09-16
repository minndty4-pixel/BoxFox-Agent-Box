function finite(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function first(record, keys) {
  for (const key of keys) {
    const value = finite(record?.[key]);
    if (value !== null) return Math.max(0, value);
  }
  return null;
}

/**
 * Normalize the usage shapes used by OpenAI, Anthropic, Gemini and gateways.
 * `prompt_tokens` is kept cache-inclusive, matching the upstream router
 * convention; cache read/write counts are retained separately for analytics.
 */
export function normalizeUsage(value) {
  const record = value && typeof value === 'object' ? value : {};
  const promptDetails = record.prompt_tokens_details && typeof record.prompt_tokens_details === 'object' ? record.prompt_tokens_details : record.input_tokens_details;
  const completionDetails = record.completion_tokens_details && typeof record.completion_tokens_details === 'object' ? record.completion_tokens_details : {};
  const promptReported = first(record, ['prompt_tokens', 'input']);
  const inputOnly = first(record, ['input_tokens']);
  const cachedTokens = first(record, ['cached_tokens', 'cache_read_input_tokens', 'cacheRead']) ?? first(promptDetails, ['cached_tokens', 'cache_read_input_tokens', 'cacheRead']);
  const cacheCreationTokens = first(record, ['cache_creation_input_tokens', 'cache_write_tokens', 'cacheCreation']) ?? first(promptDetails, ['cache_creation_tokens', 'cache_write_tokens']);
  const inputTokens = promptReported ?? (inputOnly === null ? null : inputOnly + (cachedTokens || 0) + (cacheCreationTokens || 0));
  const outputTokens = first(record, ['completion_tokens', 'output', 'output_tokens']);
  const reasoningTokens = first(record, ['reasoning_tokens', 'reasoning']) ?? first(completionDetails, ['reasoning_tokens']);
  const reportedTotal = first(record, ['total_tokens', 'total']);
  const totalTokens = reportedTotal ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const cost = first(record, ['cost', 'cost_usd', 'cost_in_usd']);
  return {
    ...record,
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_tokens: cachedTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    reasoning_tokens: reasoningTokens,
    ...(cost !== null ? { cost } : {}),
  };
}

export function reportedCost(value) {
  return first(value && typeof value === 'object' ? value : {}, ['cost', 'cost_usd', 'cost_in_usd']);
}
