// DeepSeek's own reasoning controls, on top of the OpenAI-compatible adapter.
//
// The generic OpenAI-compatible adapter publishes `minimal|low|medium|high` for
// every model on the endpoint, because OpenAI-compatible `/models` payloads
// carry no reasoning metadata. DeepSeek documents a different set, so the
// default list would (a) hide the level DeepSeek actually calls `max`,
// (b) advertise two compatibility aliases as if they were native levels, and
// (c) — because the shared adapter drops the field for `none`/`auto` — leave
// thinking ON when the caller asks for `none`, which is DeepSeek's default.
//
// Documentation (`api-docs.deepseek.com/api/create-chat-completion`, read
// 2026-09-20):
//
//   `reasoning_effort`: "Possible values: [none, low, high, max]. Controls the
//   thinking mode toggle and the thinking effort. none disables thinking mode;
//   low/high/max enable thinking mode. The default effort is high. For
//   compatibility with existing software, minimal is accepted and mapped to
//   low, and medium/xhigh are accepted and mapped to high."
//   `thinking`: `{type: enabled|disabled}`, "Default value: enabled".
//   `max_tokens`: "1 … 384K. When not set, the default is 8K in non-thinking
//   mode, 64K in thinking mode (128K with reasoning_effort set to max)".
//   Tool calls: "required and named tool choices are not supported in thinking
//   mode; the API returns a 400 error. Disable thinking mode first."
//   Models & Pricing: `deepseek-flash` = DeepSeek-V4.1-Flash, context 1M, vision
//   supported; `deepseek-v4-pro` = DeepSeek-V4-Pro-0813, vision not supported.
//
// Live probe on the real key (2026-09-20, both models, `max_tokens` 40–60,
// `Reply with exactly: OK`): `none` → 200 without `reasoning_content`; minimal /
// low / medium / high / max / xhigh → 200 with `reasoning_content`; an unknown
// value → 422 `unknown variant`; `tool_choice: "required"` and a named tool in
// thinking mode → 400 "Thinking mode does not support this tool_choice", and the
// same request with `reasoning_effort: "none"` → 200 with a tool call.
import { createOpenAIAdapter } from './openai.mjs';
import { documentedDeepseekPrice } from '../pricing.mjs';

/**
 * Giá DeepSeek công bố cho một model tại thời điểm `at`, kèm nguồn `documented`.
 *
 * DeepSeek không gửi giá trong `/models`, nên đây là tầng duy nhất router biết
 * ngoài giá người dùng tự đặt. Adapter biết luật riêng của nhà cung cấp mình nên
 * bảng giá nằm ở đây chứ không nhét vào `common.mjs`. Trả `null` cho id không có
 * trong bảng — thà trống còn hơn sai.
 *
 * `at` là thời điểm *của lượt gọi*: giá DeepSeek đổi theo giờ cao điểm, nên cả
 * lúc dựng dòng model và lúc ghi chi phí đều phải tra lại theo giờ thật của lượt
 * đó. Bỏ trống `at` nghĩa là "bây giờ".
 */
export function documentedPricing(model, at = new Date()) {
  const price = documentedDeepseekPrice(typeof model === 'string' ? model : model?.id, at);
  return price ? { ...price, source: 'documented' } : null;
}

/** The levels DeepSeek documents. `minimal`/`medium`/`xhigh` are aliases, not levels. */
export const DEEPSEEK_THINKING_LEVELS = Object.freeze(['none', 'low', 'high', 'max']);
/** Documented compatibility aliases: "minimal … mapped to low, and medium/xhigh … mapped to high". */
export const DEEPSEEK_LEVEL_ALIASES = Object.freeze({ minimal: 'low', medium: 'high', xhigh: 'high' });
/** "The default effort is high." */
export const DEEPSEEK_DEFAULT_LEVEL = 'high';

/**
 * Translates a caller level onto DeepSeek's documented `reasoning_effort`.
 *
 * - `none` stays `none`: DeepSeek needs the field to switch thinking OFF, while
 *   the shared adapter would drop it and leave thinking on.
 * - documented aliases collapse onto `low`/`high` so the wire value is a real
 *   DeepSeek level.
 * - `auto`/absent → `null` (provider default: thinking on at `high`).
 * - anything else → `null`: DeepSeek answers 422 for an unknown variant, so an
 *   unrecognised level must never be forwarded.
 */
export function deepseekEffort(level) {
  const value = typeof level === 'string' ? level.trim().toLowerCase() : '';
  if (!value || value === 'auto') return null;
  if (DEEPSEEK_LEVEL_ALIASES[value]) return DEEPSEEK_LEVEL_ALIASES[value];
  return DEEPSEEK_THINKING_LEVELS.includes(value) ? value : null;
}

/**
 * A restricted tool choice is only served with thinking off ("Disable thinking
 * mode first to use them"), so such a request decides the effort by itself.
 */
export function deepseekRestrictsTools(body = {}) {
  const choice = body?.tool_choice;
  if (typeof choice === 'string') return choice === 'required';
  if (!choice || typeof choice !== 'object') return false;
  return ['required', 'any', 'tool', 'function'].includes(choice.type);
}

/** Documented thinking metadata: DeepSeek takes an effort level and defaults to `high`. */
export function deepseekThinking(model = {}) {
  return {
    contextWindow: model?.contextWindow ?? null,
    thinkingType: 'effort',
    defaultThinking: model?.defaultThinking ?? DEEPSEEK_DEFAULT_LEVEL,
    thinkingLevels: [...DEEPSEEK_THINKING_LEVELS],
  };
}

/**
 * Ids DeepSeek ships as natively multimodal: the V4.1-Flash GA id and the
 * experimental vision build. Upstream lists them one by one and generalises the
 * capability to the dotted V4 releases (`open-sse/providers/capabilities.js:116-127`).
 */
const DEEPSEEK_VISION_IDS = new Set(['deepseek-flash', 'deepseek-v4-flash-vision-exp']);
/**
 * Real image input starts with the dotted V4 releases — probed live on the V4.1
 * line — while the non-dotted V4 ids accept image blocks and ignore them, so the
 * plain `*deepseek-v4*` pattern carries no vision upstream
 * (`open-sse/providers/capabilities.js:380-389`); the dotted pattern is matched
 * first there, so a dotted id wins over everything else, as it does here.
 */
const DEEPSEEK_VISION_DOTTED = 'deepseek-v4.';

/**
 * Documented capabilities of a discovered model. Vision is the one that matters:
 * `deepseek-v4-pro` answers an image request with 200 and a wrong answer instead of
 * an error, so the record has to say it cannot read images, and a model that *can*
 * read them must not lose the badge to a generic pattern (that was the V4.1-Flash
 * bug upstream fixed in v0.5.81).
 */
export function deepseekCapabilities(model = {}) {
  const id = String(model?.id || '').toLowerCase();
  const vision = id.includes(DEEPSEEK_VISION_DOTTED) || DEEPSEEK_VISION_IDS.has(id) ? 'reported' : 'unsupported';
  return { streaming: 'reported', tools: 'reported', vision, reasoning: 'reported' };
}

export function createDeepSeekAdapter({ fetchImpl }) {
  const upstream = createOpenAIAdapter({ fetchImpl });
  const describe = model => ({ ...model, ...deepseekThinking(model), capabilities: { ...model?.capabilities, ...deepseekCapabilities(model) } });
  return {
    ...upstream,
    // Bảng giá công bố của DeepSeek (tầng `documented`) nằm ở adapter vì nó chỉ
    // đúng cho connection của chính provider này, không đúng cho một id gõ tay ở
    // gateway khác. Service đọc đúng khóa này khi dựng dòng model và khi tính chi
    // phí, nên nó phải nằm trên chính object adapter.
    documentedPricing,
    // Stored rows are re-described through this hook when a connection is
    // normalized, so a row discovered before this rule existed still heals.
    thinkingMetadata: model => deepseekThinking(model || {}),
    // The manual rule (a model the user types in by hand) publishes the same
    // set DeepSeek documents for a discovered one, so the two mechanisms agree
    // and the hand-typed row survives the next normalization unchanged.
    manualThinkingLevels: () => [...DEEPSEEK_THINKING_LEVELS],
    async discover(args) {
      const { models, ...rest } = await upstream.discover(args);
      return { ...rest, models: (models || []).map(describe) };
    },
    async *generate(args) {
      const body = { ...(args.body || {}) };
      const level = body.thinkingLevel ?? body.reasoning_effort;
      const effort = deepseekRestrictsTools(body) ? 'none' : deepseekEffort(level);
      delete body.thinkingLevel;
      if (effort) body.reasoning_effort = effort; else delete body.reasoning_effort;
      yield* upstream.generate({ ...args, body });
    },
  };
}
