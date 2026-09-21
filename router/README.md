# BoxFox native Router

Node.js **24+** is required (built-in SQLite). No Docker or external router service is needed.

From the project root run `powershell -File scripts/start.ps1`. The launcher starts and health-checks the host router, then starts Vite. Development UI: http://localhost:3100; engine: http://127.0.0.1:3101. Vite proxies `/api/router` and `/v1`.

Alternatively, in `router` run `npm run dev`, and in `frontend` run `npm run dev`. Production: build frontend with `npm run build`, then in `router` run `npm start`; the engine serves frontend and API on loopback port 3100. `BOXFOX_ROUTER_PORT` overrides the engine port. A custom frontend origin/port must also be explicitly configured in the server allowlists/proxy.

Credentials and SQLite live in `%LOCALAPPDATA%\BoxFox\router` on Windows, or `~/.local/share/boxfox/router` elsewhere, never in the repository by default. `BOXFOX_ROUTER_DATA_DIR` is an operator override (use a protected host directory outside repositories). Back up `master.key` and SQLite together. Losing the key makes credentials unrecoverable. Windows ACLs limit the directory to the current user; other OSes use owner-only permissions. This is a single-user loopback service, not a multi-user hosted gateway.

The API never returns credentials. Gateway keys are shown once and stored as SHA-256 hashes. Administration requires the local header, allowed Host and allowed Origin; an external client uses a generated Bearer key. Do not expose the engine using a public tunnel. Metadata DNS/IP destinations and redirects are blocked; explicitly configured loopback endpoints are supported.

Provider login is not inference verification. Check authorization, project setup, discovery and inference states independently. No quota, token count or cost is invented when unavailable; when the router estimates a cost it carries the source that produced it (`costBasis`) and is never shown as a provider-reported figure. Default logs do not include prompts or provider tokens.

The Router catalog is the union of the reviewed 9Router and OmniRoute account/free-tier entries. A visible card is not a claim of support: `ready` and `experimental` entries have a wired adapter, while `planned` entries expose their intended authentication and discovery settings with Connect disabled. Antigravity supports live discovery, disabled stale fallback inventory, scheduled/manual/reactive model refresh, per-model inference tests and best-effort plan/per-model/weekly quota.

See [CONTRACT.md](CONTRACT.md) for routes and event contracts. API model IDs are `connectionId/modelId` or alias names returned by `GET /v1/models`.

```sh
curl http://localhost:3100/v1/models -H "Authorization: Bearer YOUR_BOXFOX_KEY"
curl http://localhost:3100/v1/chat/completions -H "Authorization: Bearer YOUR_BOXFOX_KEY" -H "Content-Type: application/json" -d '{"model":"YOUR_ALIAS","messages":[{"role":"user","content":"Hello"}],"stream":true}'
curl http://localhost:3100/v1/messages -H "x-api-key: YOUR_BOXFOX_KEY" -H "Content-Type: application/json" -d '{"model":"YOUR_ALIAS","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

## Pointing Claude Code at the router

The router speaks Anthropic's Messages protocol, so the Claude Code CLI can use it as its API endpoint with **no Anthropic account, subscription or API key** — every request is routed to whichever provider connection the router is configured with. Make sure the selected model is one the connection actually serves (see `GET /v1/models`).

```sh
export ANTHROPIC_BASE_URL=http://127.0.0.1:3101/v1   # must end in /v1; 3100/v1 is the same thing via Vite/production
export ANTHROPIC_AUTH_TOKEN=bf_YOUR_BOXFOX_KEY       # a gateway key from Provider > Keys
unset ANTHROPIC_API_KEY                              # no Anthropic credential is used
export ANTHROPIC_DEFAULT_OPUS_MODEL=YOUR_ALIAS       # or connectionId/modelId
export ANTHROPIC_DEFAULT_SONNET_MODEL=YOUR_ALIAS
export ANTHROPIC_DEFAULT_HAIKU_MODEL=YOUR_ALIAS
claude
```

`ANTHROPIC_BASE_URL` is the router itself, so the model ids must be router model ids (`connectionId/modelId` or an alias name): the router does not translate a bare `claude-*` name into a provider model. A connection selected by an alias applies to all three model slots unless separate aliases are configured. Claude Code's small housekeeping calls (warm-up, title generation) are answered locally by the router, so they cost no tokens even if the model id they name is unavailable.

`npm test` runs local tests; the simulator exists only in tests. `npm run test:live` checks JSON/SSE through BoxFox after Antigravity login, emits passed/failed/blocked/skipped and exits 2 when blocked. HTTP 400/401/403/429 never count as successful inference. Interactive Stop/restart/tool/disconnect acceptance remains separate.

The original chat interface is preserved at the user's request. The standalone one-turn Router Test is not mounted; inference can be tested inside Provider or through the HTTP harness. `VITE_CHAT_MODE=agent` enables the existing agent transport; the default router-focused mode does not initialize MockTransport. Previous router mock data is not imported into live connections.
