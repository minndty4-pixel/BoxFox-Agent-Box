# Port/adaptation acceptance map

| Feature | Source | BoxFox runtime | Changes / acceptance |
| --- | --- | --- | --- |
| Catalog and icon resolver | 9router registry; OmniRoute provider catalog; upstream provider assets | catalog.mjs, ProviderIcon.tsx, public/providers | Unified OAuth/free/API metadata with auth modes and discovery class; catalog presence is separate from runtime support; local logos + alt/fallback |
| OAuth/client binding | OmniRoute oauth/providers/antigravity.ts, googleClientBinding | providers/antigravity.mjs, oauth.mjs, service.mjs | State verified, single-use callback/cancel/timeout, encrypted issuer binding, single-flight refresh; core/provider tests |
| Project onboarding | OmniRoute antigravityProjectBootstrap.ts | providers/antigravity.mjs | String/object project, bounded done:false polling, manual project, no fabricated ID; provider tests |
| Executors | 9router antigravity executor + request pipeline architecture | providers/*.mjs, engine.mjs | Adapted minimal executors, injected safe fetch, request-local session/project/translation state; HTTP simulator + isolation tests |
| Translation | 9router Gemini format/request/response translators | vendor/9router/*.mjs | Selected text/tools/usage helpers adapted, preserve field names, resolve local schema refs; JSON/SSE/Unicode/tools regression |
| Multi-account and account health | 9router connection selection; OmniRoute admission principles | service.mjs, engine.mjs | Enabled authorized inventory, round-robin over eligible accounts, health split; core tests |
| Alias/fallback | 9router combo/fallback architecture | engine.mjs, service.mjs | Ordered targets, cooldown/shared deadline, no fallback after emitted content, key allowlist; core tests |
| Model synchronization | OmniRoute modelSyncScheduler | model-sync.mjs, service.mjs | Six-hour bounded sync, manual refresh, single-flight discovery, stale/degraded inventory cannot route; core tests |
| Quota/usage | OmniRoute Antigravity usage; 9Router weekly quota | providers/antigravity.mjs, store.mjs | retrieveUserQuota takes precedence over catalog quota; weekly families and plan are best effort; unknown tokens/cost stay null; provider tests |
| Gateway client key | Upstream gateway-key behavior | server.mjs, store.mjs | One-time secret, SHA-256 hash, revoke/allowlist/last-used; core HTTP tests |

The Gemini helpers are adapted subsets, not claims of complete upstream feature parity. Provider API adapters are BoxFox-specific implementations of those protocols. Behavioral reuse (selection, gateway policy) is documented separately from verbatim module copying.

## Discovery decision from the reread

The upstream provider screens are larger because they combine a registry, authentication modes, curated seed models, live model discovery, aliases and batch testing. In 9Router, the provider model route uses provider-specific discovery (including `/models` for API providers and an Antigravity `models` RPC), then falls back to cached or curated inventory where appropriate. OmniRoute makes the same distinction explicitly with account-live, OpenAI-compatible and static-only providers; its automatic sync is opt-in and scheduled, with bounded cache/live fallback.

BoxFox exposes the merged upstream catalog but labels each entry `ready`, `experimental`, `planned` or `unavailable`. Only wired adapters may create connections. The four API protocols query real upstream inventory, while Antigravity starts discovery after OAuth/project setup and is resynchronized on schedule or after model-not-found. A failed probe keeps the durable connection and may expose disabled stale/static reference models, but it is never presented as an inference-ready route.

Usage accounting follows the shared upstream convention: prompt/input tokens are cache-inclusive, cache-read and cache-write tokens are tracked separately, output/completion tokens remain distinct, and reasoning tokens are retained when reported. Totals use provider-reported `total_tokens` when available, otherwise the normalized input plus output counts. Cost uses a provider-reported value only; the 9Router pricing formula (fresh input × input rate + cache read × cached rate + cache write × creation rate + output × output rate, with reasoning premium where declared) is documented for a future pricing registry, so BoxFox shows `No data` instead of estimating against an unknown model.

Deferred: Codex/Claude Code/Copilot/Kiro OAuth; Responses/Anthropic/Gemini ingress; advanced fusion/auto-combo; prompt compression; image/audio; MITM.

User override: the original Git chat UI is preserved and Router Test is not mounted. Router testing is available within Provider account detail and HTTP harness; reattaching the test transport to the original chat UI is deferred until the user confirms the approach.
