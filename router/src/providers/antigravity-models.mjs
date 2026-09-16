// Antigravity public model registry adapted from 9Router's MIT-licensed
// open-sse/providers/registry/antigravity.js. Public IDs stay stable while
// upstream IDs and thinking controls remain provider implementation details.

const GEMINI_CAPABILITIES = Object.freeze({ tools: 'reported', vision: 'reported', reasoning: 'reported' });
const REASONING_CAPABILITIES = Object.freeze({ tools: 'reported', vision: 'unknown', reasoning: 'reported' });

function spec(id, name, options = {}) {
  const upstreamModelId = options.upstreamModelId || id;
  return Object.freeze({
    id,
    name,
    upstreamModelId,
    liveIds: Object.freeze([...new Set([id, upstreamModelId, ...(options.liveIds || [])])]),
    thinkingLevel: options.thinkingLevel || null,
    quotaFamily: options.quotaFamily || (/^gemini-/i.test(id) ? 'gemini' : /^(?:claude-|gpt-)/i.test(id) ? 'claude_gpt' : null),
    capabilities: Object.freeze(options.capabilities || (/^gemini-/i.test(id) ? GEMINI_CAPABILITIES : REASONING_CAPABILITIES)),
  });
}

export const ANTIGRAVITY_MODELS = Object.freeze([
  spec('gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)', { thinkingLevel: 'high' }),
  spec('gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)', { thinkingLevel: 'medium' }),
  spec('gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)', { thinkingLevel: 'low' }),
  spec('gemini-3.8-flash', 'Gemini 3.8 Flash', { upstreamModelId: 'gemini-3.8-flash-medium', liveIds: ['gemini-3.8-flash-medium'], thinkingLevel: 'medium' }),
  spec('gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)', { upstreamModelId: 'gemini-3.7-flash-tiered', thinkingLevel: 'high' }),
  spec('gemini-3.7-flash-medium', 'Gemini 3.7 Flash (Medium)', { upstreamModelId: 'gemini-3.7-flash-tiered', thinkingLevel: 'medium' }),
  spec('gemini-3.7-flash-low', 'Gemini 3.7 Flash (Low)', { upstreamModelId: 'gemini-3.7-flash-tiered', thinkingLevel: 'low' }),
  spec('gemini-3.6-flash-high', 'Gemini 3.6 Flash (High)', { upstreamModelId: 'gemini-3.6-flash-tiered', thinkingLevel: 'high' }),
  spec('gemini-3.6-flash-medium', 'Gemini 3.6 Flash (Medium)', { upstreamModelId: 'gemini-3.6-flash-tiered', thinkingLevel: 'medium' }),
  spec('gemini-3.6-flash-low', 'Gemini 3.6 Flash (Low)', { upstreamModelId: 'gemini-3.6-flash-tiered', thinkingLevel: 'low' }),
  spec('gemini-pro-agent', 'Gemini 3.1 Pro (High)', { liveIds: ['gemini-3.1-pro-high'] }),
  spec('gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)'),
  spec('claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'),
  spec('claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'),
  spec('gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)'),
]);

const BY_PUBLIC_ID = new Map(ANTIGRAVITY_MODELS.map(model => [model.id, model]));
const COVERED_LIVE_IDS = new Set(ANTIGRAVITY_MODELS.flatMap(model => model.liveIds));
export const RETIRED_OR_UNSUPPORTED_ANTIGRAVITY = /^(?:gemini-2\.|gemini-3\.5|gemini-3-flash|tab_)|(?:-tiered)$/i;
const LEGACY_OR_BACKING = RETIRED_OR_UNSUPPORTED_ANTIGRAVITY;

export function isAntigravityModelValid(id) {
  if (!id || typeof id !== 'string') return false;
  if (RETIRED_OR_UNSUPPORTED_ANTIGRAVITY.test(id)) return false;
  return BY_PUBLIC_ID.has(id) || COVERED_LIVE_IDS.has(id);
}

export function antigravityModelSpec(id) {
  return BY_PUBLIC_ID.get(id) || null;
}

export function resolveAntigravityModel(id) {
  const known = antigravityModelSpec(id);
  if (known) return known;
  return {
    id,
    name: id,
    upstreamModelId: id,
    liveIds: [id],
    thinkingLevel: null,
    quotaFamily: /^gemini-/i.test(id) ? 'gemini' : /^(?:claude-|gpt-)/i.test(id) ? 'claude_gpt' : null,
    capabilities: { tools: 'unknown', vision: 'unknown', reasoning: 'unknown' },
  };
}

export function registryModelsForInventory(entries) {
  const live = new Map(entries);
  return ANTIGRAVITY_MODELS.filter(model => model.liveIds.some(id => live.has(id))).map(model => {
    const liveId = model.liveIds.find(id => live.has(id));
    return { spec: model, liveId, info: live.get(liveId) || {} };
  });
}

export function unknownProbeCandidates(entries) {
  return entries.filter(([id, info]) => (
    id
    && info?.isInternal !== true
    && !COVERED_LIVE_IDS.has(id)
    && !LEGACY_OR_BACKING.test(id)
  ));
}

export function quotaFamilyForModel(id) {
  return resolveAntigravityModel(id).quotaFamily;
}
