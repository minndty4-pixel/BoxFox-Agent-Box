import { createAntigravityAdapter } from './antigravity.mjs';
import { createAnthropicAdapter } from './anthropic.mjs';
import { createGeminiAdapter } from './gemini.mjs';
import { createOpenAIAdapter } from './openai.mjs';
import { createClaudeAdapter } from './claude.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createCopilotAdapter } from './copilot.mjs';
import { createClineAdapter } from './cline.mjs';
import { createOpenCodeAdapter } from './opencode.mjs';
import { createOpenRouterAdapter } from './openrouter.mjs';
import { PROVIDER_CATALOG } from '../catalog.mjs';

export function createProviders({ fetchImpl }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createProviders requires fetchImpl');
  const openai = createOpenAIAdapter({ fetchImpl });
  const antigravity = createAntigravityAdapter({ fetchImpl });
  const claude = createClaudeAdapter({ fetchImpl });
  const codex = createCodexAdapter({ fetchImpl });
  const copilot = createCopilotAdapter({ fetchImpl });
  const cline = createClineAdapter({ fetchImpl });
  const opencode = createOpenCodeAdapter({ fetchImpl });
  const openrouter = createOpenRouterAdapter({ fetchImpl });

  const providers = {
    antigravity,
    agy: antigravity,
    claude,
    codex,
    github: copilot,
    'ghe-copilot': copilot,
    cline,
    opencode,
    openrouter,
    openai,
    anthropic: createAnthropicAdapter({ fetchImpl }),
    gemini: createGeminiAdapter({ fetchImpl }),
    custom: createOpenAIAdapter({ fetchImpl }),
  };
  for (const provider of PROVIDER_CATALOG) {
    if (provider.adapter === 'openai' && !providers[provider.id]) providers[provider.id] = createOpenAIAdapter({ fetchImpl });
  }
  return providers;
}
