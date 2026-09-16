// Unified provider metadata adapted from the 9Router registry and OmniRoute
// provider catalog. Catalog presence never implies runtime support: only an
// entry with a wired `adapter` may create a BoxFox connection.

const icon = id => `/providers/${id}.png`;

const oauth = [
  { id: 'claude', name: 'Claude Code', protocol: 'claude-code', discoveryClass: 'account-live', authModes: ['oauth', 'import'] },
  { id: 'antigravity', name: 'Antigravity', protocol: 'antigravity', discoveryClass: 'account-live', authModes: ['oauth'], riskNotice: 'Account-backed routing may be subject to the provider subscription terms.' },
  { id: 'agy', name: 'Antigravity CLI', protocol: 'antigravity', discoveryClass: 'account-live', authModes: ['oauth', 'import'], authHint: 'Import an Antigravity CLI login or authorize with Google.' },
  { id: 'codex', name: 'OpenAI Codex', protocol: 'codex', discoveryClass: 'account-live', authModes: ['oauth', 'import'] },
  { id: 'github', name: 'GitHub Copilot', protocol: 'copilot', discoveryClass: 'account-live', authModes: ['device', 'import'] },
  { id: 'ghe-copilot', name: 'GitHub Enterprise Copilot', protocol: 'copilot', discoveryClass: 'account-live', authModes: ['device'], authHint: 'Requires the GitHub Enterprise instance URL before device authorization.' },
  { id: 'qoder', name: 'Qoder', protocol: 'qoder', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'cursor', name: 'Cursor IDE', protocol: 'cursor', discoveryClass: 'account-live', authModes: ['device', 'import'] },
  { id: 'xai-oauth', name: 'xAI OAuth (Grok)', protocol: 'xai-oauth', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'grok-cli', name: 'Grok CLI (Grok Build)', protocol: 'grok-cli', discoveryClass: 'account-live', authModes: ['oauth', 'import'] },
  { id: 'gemini-cli', name: 'Gemini CLI', protocol: 'gemini-cli', discoveryClass: 'account-live', authModes: ['oauth', 'import'] },
  { id: 'kiro', name: 'Kiro AI', protocol: 'kiro', discoveryClass: 'static-only', authModes: ['device', 'import'] },
  { id: 'amazon-q', name: 'Amazon Q', protocol: 'amazon-q', discoveryClass: 'static-only', authModes: ['device', 'import'] },
  { id: 'gitlab-duo', name: 'GitLab Duo', protocol: 'gitlab-duo', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'zed', name: 'Zed IDE', protocol: 'zed', discoveryClass: 'static-only', authModes: ['import'] },
  { id: 'zed-hosted', name: 'Zed Hosted Models', protocol: 'zed-hosted', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'trae', name: 'Trae', protocol: 'trae', discoveryClass: 'account-live', authModes: ['oauth', 'import'] },
  { id: 'kimi-coding', name: 'Kimi Code CLI', protocol: 'kimi', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'kimi', name: 'Kimi', protocol: 'kimi', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'kilocode', name: 'Kilo Code', protocol: 'kilocode', discoveryClass: 'static-only', authModes: ['oauth', 'anonymous'] },
  { id: 'cline', name: 'Cline', protocol: 'cline', discoveryClass: 'account-live', authModes: ['oauth', 'import'] },
  { id: 'clinepass', name: 'ClinePass', protocol: 'clinepass', discoveryClass: 'static-only', authModes: ['oauth', 'api_key'] },
  { id: 'codebuddy-intl', name: 'CodeBuddy', protocol: 'codebuddy-intl', discoveryClass: 'static-only', authModes: ['oauth'] },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN', protocol: 'codebuddy-cn', discoveryClass: 'static-only', authModes: ['device', 'api_key'] },
  { id: 'xiaomi-mimo', name: 'Xiaomi MiMo', protocol: 'xiaomi-mimo', discoveryClass: 'static-only', authModes: ['oauth'] },
  { id: 'openference', name: 'Openference', protocol: 'openference', discoveryClass: 'account-live', authModes: ['oauth'] },
  { id: 'devin-desktop', name: 'Devin Desktop', protocol: 'devin', discoveryClass: 'static-only', authModes: ['import'] },
  { id: 'devin-cli', name: 'Devin CLI', protocol: 'devin', discoveryClass: 'account-live', authModes: ['import'] },
];

const free = [
  { id: 'opencode', name: 'OpenCode Free', protocol: 'opencode', discoveryClass: 'account-live', authModes: ['anonymous'] },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openrouter', discoveryClass: 'openai-compat', authModes: ['api_key'] },
  { id: 'nvidia', name: 'NVIDIA NIM', protocol: 'nvidia', discoveryClass: 'openai-compat', authModes: ['api_key'] },
  { id: 'ollama', name: 'Ollama Cloud', protocol: 'ollama', discoveryClass: 'openai-compat', authModes: ['api_key'] },
  { id: 'vertex', name: 'Vertex AI', protocol: 'vertex', discoveryClass: 'provider-specific', authModes: ['service_account'] },
  { id: 'cloudflare-ai', name: 'Cloudflare', protocol: 'cloudflare-ai', discoveryClass: 'provider-specific', authModes: ['api_key'] },
  { id: 'poolside', name: 'Poolside', protocol: 'poolside', discoveryClass: 'static-only', authModes: ['api_key'] },
  { id: 'byteplus', name: 'BytePlus ModelArk', protocol: 'byteplus', discoveryClass: 'openai-compat', authModes: ['api_key'] },
  { id: 'kimchi', name: 'Kimchi', protocol: 'kimchi', discoveryClass: 'static-only', authModes: ['oauth'] },
  { id: 'api-airforce', name: 'API.airforce', protocol: 'api-airforce', discoveryClass: 'static-only', authModes: ['api_key'] },
  { id: 'bazaarlink', name: 'Bazaarlink', protocol: 'bazaarlink', discoveryClass: 'static-only', authModes: ['api_key'] },
  { id: 'kilo-gateway', name: 'Kilo Gateway', protocol: 'kilo-gateway', discoveryClass: 'static-only', authModes: ['api_key'] },
];

const api = [
  ['alicode', 'Alibaba'], ['alicode-intl', 'Alibaba Coding'], ['alims-intl', 'Alibaba Studio'], ['alitp-intl', 'Alibaba Token Plan'],
  ['anthropic', 'Anthropic'], ['azure', 'Azure OpenAI'], ['baidu', 'Baidu Qianfan'], ['blackbox', 'Blackbox AI'],
  ['cerebras', 'Cerebras'], ['chutes', 'Chutes AI'], ['cohere', 'Cohere'], ['commandcode', 'Command Code'],
  ['deepseek', 'DeepSeek'], ['featherless', 'Featherless'], ['fireworks', 'Fireworks AI'], ['glm-cn', 'GLM (China)'],
  ['glm', 'GLM Coding'], ['groq', 'Groq'], ['xai', 'xAI (Grok) API'], ['hyperbolic', 'Hyperbolic'], ['llm7', 'LLM7'],
  ['minimax', 'Minimax (China)'], ['mistral', 'Mistral'], ['morph', 'Morph'], ['nebius', 'Nebius AI'],
  ['ollama-local', 'Ollama Local'], ['openai', 'OpenAI'], ['opencode-go', 'OpenCode Go'], ['perplexity', 'Perplexity'],
  ['siliconflow', 'SiliconFlow'], ['together', 'Together AI'], ['vercel-ai-gateway', 'Vercel AI Gateway'],
  ['volcengine-ark', 'Volcengine Ark'], ['vertex-api', 'Vertex AI API'], ['custom', 'OpenAI-compatible endpoint'],
];

const OPENAI_ENDPOINTS = {
  openai: 'https://api.openai.com/v1', openrouter: 'https://openrouter.ai/api/v1', deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1', xai: 'https://api.x.ai/v1', mistral: 'https://api.mistral.ai/v1',
  perplexity: 'https://api.perplexity.ai', together: 'https://api.together.xyz/v1', fireworks: 'https://api.fireworks.ai/inference/v1',
  cerebras: 'https://api.cerebras.ai/v1', nebius: 'https://api.studio.nebius.ai/v1', siliconflow: 'https://api.siliconflow.com/v1',
  hyperbolic: 'https://api.hyperbolic.xyz/v1', ollama: 'https://ollama.com/v1', chutes: 'https://llm.chutes.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1', byteplus: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
};
const OPENAI_ADAPTERS = new Set(Object.keys(OPENAI_ENDPOINTS));

function adapterFor(id) {
  if (id === 'antigravity' || id === 'agy') return 'antigravity';
  if (id === 'claude') return 'claude';
  if (id === 'codex') return 'codex';
  if (id === 'github' || id === 'ghe-copilot') return 'copilot';
  if (id === 'cline') return 'cline';
  if (id === 'opencode') return 'opencode';
  if (id === 'openrouter') return 'openrouter';
  if (id === 'anthropic') return 'anthropic';
  if (id === 'gemini') return 'gemini';
  if (OPENAI_ADAPTERS.has(id) || id === 'custom') return 'openai';
  return null;
}

function build(entry, category, authMethod) {
  const adapter = adapterFor(entry.id);
  const isReady = adapter && ['antigravity', 'claude', 'codex', 'copilot', 'cline', 'opencode', 'openrouter', 'openai', 'anthropic', 'gemini'].includes(adapter);
  const implementationStatus = adapter ? (isReady ? 'ready' : 'experimental') : 'planned';
  return {
    ...entry,
    authMethod,
    category,
    icon: icon(entry.id === 'vertex-api' ? 'vertex-partner' : entry.id),
    adapter,
    routerVisible: Boolean(adapter) || category !== 'api_key',
    runtimeAvailable: Boolean(adapter),
    availability: implementationStatus === 'planned' ? 'planned' : 'ready',
    implementationStatus,
    authModes: entry.authModes ?? ['api_key'],
    authHint: entry.authHint ?? (authMethod === 'oauth' ? 'Authorize or import a provider account.' : 'Configure a provider API key.'),
    capabilities: { chat: true, streaming: true, tools: implementationStatus === 'ready' ? 'reported' : 'unknown', vision: 'unknown' },
    ...(OPENAI_ENDPOINTS[entry.id] ? { defaultEndpoint: OPENAI_ENDPOINTS[entry.id] } : {}),
  };
}

export const PROVIDER_CATALOG = [
  ...oauth.map(entry => build(entry, 'oauth', 'oauth')),
  ...free.map(entry => build(entry, 'free', entry.authModes.includes('oauth') ? 'oauth' : 'api_key')),
  ...api.map(([id, name]) => build({ id, name, protocol: id, discoveryClass: 'openai-compat', authModes: ['api_key'] }, 'api_key', 'api_key')),
  build({ id: 'gemini', name: 'Google Gemini', protocol: 'gemini', discoveryClass: 'provider-specific', authModes: ['api_key'] }, 'api_key', 'api_key'),
];

export const PROVIDER_ENDPOINTS = {
  ...OPENAI_ENDPOINTS,
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  cline: 'https://api.cline.bot/api/v1',
  opencode: 'https://opencode.ai',
  openrouter: 'https://openrouter.ai/api/v1',
};
