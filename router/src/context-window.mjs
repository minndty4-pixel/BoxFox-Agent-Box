// Phần 1 của đợt 18: một cửa sổ ngữ cảnh, một nguồn gốc, một chỗ trả lời.
//
// Before this module the same question had three different answers: the router
// published `null` for the owner's own DeepSeek connection (its `/models` payload
// carries no context length), the harness guessed `64000` from the name, and the
// UI guessed `64000` again and printed "ước lượng". Two real DeepSeek V4 rows on
// this machine publish 1048576, so both guesses were wrong for the models the
// owner actually runs — while the *old* DeepSeek families really are small
// (`deepseek-r1` 64000, `deepseek-v3.2` 163840), which is why this table matches
// model families by name instead of the word "deepseek".
//
// Owner decision (2026-09-21): when a model name matches the table, the table wins
// over whatever the provider reports, and the provider's own number is kept beside
// it as `contextWindowReported` so a stale table can still show itself.
//
// The table is data, not an inference rule: a name that matches nothing returns
// `null` and lets the provider's payload (or the harness's labelled floor) answer.

/** The provenances a context window may carry, in precedence order (`reported` is not a declaration). */
export const CONTEXT_WINDOW_SOURCES = Object.freeze(['manual', 'documented', 'reported']);

/** The day the shipped rows below were read off the providers' own pages/accounts. */
export const CONTEXT_WINDOW_TABLE_AS_OF = '2026-09-21';

/**
 * Where the rows came from — kept next to the table so the next reader can re-check
 * it instead of trusting it:
 * - `deepseek-flash`, `deepseek-v4-pro`: the owner's DeepSeek account alias for
 *   DeepSeek-V4.1-Flash / -Pro (the account's own `/models` payload has no number).
 * - `deepseek-v4.1-flash`, `deepseek-v4-flash`, `deepseek-v4-pro-0813`,
 *   `deepseek-v4-flash-vision-exp`: read live on OpenRouter's public model list
 *   (2026-09-21) and on TokenHarbor — every one of them publishes 1048576.
 * - `deepseek-v4-flash-0731`, and the alias `~deepseek/deepseek-v4-flash-latest`
 *   (which the family rule catches): OpenRouter's top-level `context_length` is
 *   1310720 while the same row's `top_provider.context_length` says 1048576.
 * The rows below hold the family's round 1M anyway (owner decision, 2026-09-21).
 * These rows are a family decision, not a per-build measurement: the number in use
 * is the table's, and the provider's own number stays beside it as
 * `contextWindowReported`, so a disagreement like the 1310720 row above shows up on
 * the row itself instead of hiding in this note.
 * Old families are deliberately absent — `deepseek-r1` (64000) and `deepseek-v3.2`
 * (163840) publish their own, smaller numbers and must keep them.
 * - `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`: OpenCode publishes no
 *   window for its `-free` ids (read live 2026-09-21: `contextWindow: null`, which is
 *   why the harness used to fall back to 86 732-token compactions). The rows below
 *   carry 1M because the same models' `:free` builds are published at 1000000 on
 *   OpenRouter's live model list the same day (`nvidia/nemotron-3-ultra-550b-a55b:free`,
 *   `nvidia/nemotron-3.5-lightning:free`) while their paid builds publish 262144 — the
 *   round number is the safer floor of the two, and the harness's own 200000-token
 *   compaction cap keeps the working threshold well below both.
 */
export const CONTEXT_WINDOW_TABLE_SOURCE_NOTES = Object.freeze({
  'deepseek-flash': 'DeepSeek account alias (= DeepSeek-V4.1-Flash)',
  'deepseek-v4-pro': 'DeepSeek account alias',
  'deepseek-v4.1-flash': 'TokenHarbor + OpenRouter, both publish 1048576',
  'deepseek-v4-flash': 'OpenRouter, publishes 1048576 (top_provider 1024000)',
  'deepseek-v4-flash-0731': 'OpenRouter, publishes 1310720 (top_provider 1048576)',
  'deepseek-v4-pro-0813': 'OpenRouter, publishes 1048576',
  'deepseek-v4-flash-vision-exp': 'OpenRouter vision build, publishes 1048576',
  'nemotron-3-ultra-free': 'OpenCode publishes nothing; OpenRouter publishes 1000000 for the same `:free` model',
  'nemotron-3.5-lightning-free': 'OpenCode publishes nothing; OpenRouter publishes 1000000 for the same `:free` model',
});

const MILLION = 1_000_000;

// Explicit ids first: these are the ids that exist on this machine today. An exact
// row wins over the family rule below, so a future row that needs a different
// number only has to be added here.
const CONTEXT_WINDOW_ROWS = Object.freeze({
  'nemotron-3-ultra-free': MILLION,
  'nemotron-3.5-lightning-free': MILLION,
  'deepseek-flash': MILLION,
  'deepseek-v4-pro': MILLION,
  'deepseek-v4-flash': MILLION,
  'deepseek-v4-flash-vision-exp': MILLION,
  'deepseek-v4-flash-0731': MILLION,
  'deepseek-v4-pro-0813': MILLION,
  'deepseek-v4.1-flash': MILLION,
});

// The family rule catches the builds and aliases of the same V4/V4.1 line:
// `deepseek-v4.1-flash-vision`, `deepseek-v4-flash-latest`, every `:free`, and the
// vendor-qualified alias `~deepseek/deepseek-pro-latest` (the vendor prefix is
// stripped before matching). It deliberately does NOT catch `deepseek-r1`,
// `deepseek-v3*`, `deepseek-chat`, `deepseek-coder`, nor any other vendor's model.
const DEEPSEEK_V4_FAMILY = /^deepseek-(?:v4(?:\.1)?-)?(?:flash|pro)(?:-|$)/;

/** `~deepseek/deepseek-v4.1-flash:free` → `deepseek-v4.1-flash`. */
function normalise(value) {
  let key = String(value ?? '').trim().toLowerCase();
  if (!key) return '';
  key = key.replace(/^~/, '');
  key = key.replace(/[^/]*\//, ''); // drop a vendor prefix (`tokenharbor/`, `deepseek/deepseek-…`)
  key = key.replace(/:(?:free|batch|extended)$/, '');
  return key.replace(/[\s_]+/g, '-');
}

/** A number we are willing to act on, or `null`. Zero and negatives are not windows. */
function windowFrom(value) {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) return null;
  return Math.trunc(number);
}

/**
 * Look a model up in the shipped table, by id first and display name second.
 * @returns {{tokens:number, source:'documented', match:'exact'|'family'}|null}
 */
export function contextWindowFromName(id, name) {
  const keys = [normalise(id), normalise(name)].filter(Boolean);
  for (const key of keys) {
    if (Object.hasOwn(CONTEXT_WINDOW_ROWS, key)) {
      return { tokens: CONTEXT_WINDOW_ROWS[key], source: 'documented', match: 'exact' };
    }
  }
  for (const key of keys) {
    if (DEEPSEEK_V4_FAMILY.test(key)) return { tokens: MILLION, source: 'documented', match: 'family' };
  }
  return null;
}

/**
 * Resolve one model row. Precedence, one way and no ambiguity:
 * `declared` (the user's own number) → the table (`documented`) → `reported`
 * (the provider's payload or documented adapter rule) → `null`.
 *
 * `contextWindowReported` carries the provider's number only when it differs from
 * the number in use — that is the number worth comparing a table against.
 */
export function resolveContextWindow({ id = '', name = '', reported = null, declared = null } = {}) {
  const reportedValue = windowFrom(reported);
  const declaredValue = windowFrom(declared);
  const beside = (inUse) => (reportedValue !== null && reportedValue !== inUse ? reportedValue : null);
  if (declaredValue !== null) {
    return { contextWindow: declaredValue, contextWindowSource: 'manual', contextWindowReported: beside(declaredValue) };
  }
  const table = contextWindowFromName(id, name);
  if (table) {
    return { contextWindow: table.tokens, contextWindowSource: 'documented', contextWindowReported: beside(table.tokens) };
  }
  if (reportedValue !== null) {
    return { contextWindow: reportedValue, contextWindowSource: 'reported', contextWindowReported: null };
  }
  return { contextWindow: null, contextWindowSource: null, contextWindowReported: null };
}
