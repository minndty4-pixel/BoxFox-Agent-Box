# LiteLLM: thư viện adapter và proxy router tùy chọn

## Snapshot và giấy phép

- Upstream: <https://github.com/BerriAI/litellm>
- Commit kiểm tra: [`c8114ba41ff76365e3fb065dd3c7ca387598fd98`](https://github.com/BerriAI/litellm/tree/c8114ba41ff76365e3fb065dd3c7ca387598fd98)
- Giấy phép: [MIT cho phần ngoài `enterprise/`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/LICENSE); `enterprise/` áp dụng license riêng và **bị loại khỏi code-reference**.
- Vai trò trong nghiên cứu: evidence để đánh giá độc lập khả năng dùng dependency hoặc tự viết adapter trong service router Python; snapshot không là dependency vendored, không là toàn bộ kiến trúc BoxFox và không import enterprise code.

## Cách dùng và client protocol

README mô tả hai mode: Python SDK `completion()` và Proxy Server; proxy nhận OpenAI-compatible client qua base URL local. Ví dụ Proxy `litellm --model gpt-4o` và OpenAI client gọi `http://0.0.0.0:4000`; xem [README](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/README.md). `proxy_server.py` định nghĩa `/v1/chat/completions` cùng các route compatible Azure/OpenAI; xem [`proxy_server.py`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/proxy/proxy_server.py#L10964-L11050).

Nếu một quyết định dependency sau này phê duyệt LiteLLM, BoxFox vẫn đặt nó sau canonical router/provider adapter; multi-agent harness không gọi trực tiếp provider raw keys. Adapter BoxFox vẫn xác thực caller, policy/check destination và lấy secret qua broker.

## Translation và tool-call correctness

LiteLLM chứa transformations theo provider/protocol. Một ví dụ có giá trị là Anthropic: code chuẩn hoá/sanitize tool name nhưng tạo forward/reverse map **per request** để tránh collision như `foo/bar` và `foo_bar`, và giữ map trong internal `litellm_params` không serialise upstream. Xem [`anthropic/chat/transformation.py`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/llms/anthropic/chat/transformation.py).

BoxFox cần giữ nguyên nguyên tắc này: tool name/ID mapping phải bijective trong một request, có lifecycle stream, không lẫn metadata nội bộ vào provider body. Các feature provider-specific nên đi qua capability matrix và contract tests, không qua generic “OpenAI compatible” claim.

## Router, alias, rate limit và fallback

`Router.__init__` nhận model list (nhiều deployment dưới cùng alias), model-group alias, retry policy, `fallbacks`, `context_window_fallbacks`, `content_policy_fallbacks`, cooldown, health, routing strategy và optional fallback access check. Evidence tại [`router.py#L705-L830`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/router.py#L705-L830). Source còn xử lý router stream/fallback để không fallback sau content đã commit; tìm theo [`router.py`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/router.py).

Chiến lược có simple shuffle, least busy, usage/latency/cost based, LAR1 và routes group; strategy lowest cost ghi token usage theo model group trong cache: [`lowest_cost.py`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/router_strategy/lowest_cost.py).

BoxFox dùng pattern, nhưng policy decision đến trước strategy: chỉ candidates policy-approved mới đi vào router library. Cost/latency optimizer không được tự chuyển dữ liệu sang provider/region hoặc tài khoản chưa consent. Thêm budget theo user/org/agent task, circuit breaker theo credential handle, and idempotency-aware retry.

## API key, OAuth và credentials

LiteLLM có provider auth/proxy auth và virtual key features, nhưng tại snapshot này documentation/source có cả OSS lẫn enterprise paths. Không xem LiteLLM như vault cho BoxFox. Dù dùng SDK/proxy, BoxFox vẫn cần:

- secret ingress: API key của BoxFox xác thực client/harness;
- secret egress: broker vault giữ API key provider hoặc OAuth access/refresh token;
- agent/sandbox: chỉ request scope + opaque `credential_handle`;
- OAuth: user consent + PKCE/state + encrypted storage + refresh/revoke at broker, không import cookie/token.

Không snapshot `enterprise/`, môi trường deploy, database Prisma, `.env` hoặc test fixtures chứa key. Đánh giá dependency phải pin version, scan license/SBOM, verify supported provider protocols, review CVEs và test redaction.

## Security và observability

Proxy handler gắn `user_api_key` identity metadata trước khi xử lý completion (xem [`proxy_server.py`](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/proxy/proxy_server.py#L10964-L11050)). Đây là gợi ý attribution, không đủ cho IFC/policy của BoxFox. BoxFox cần logs đã redact, policy version, destination/data label, credential opaque ID, route attempt, latency/cost/usage—not raw prompt/token/header.

LiteLLM không khiến MITM cần thiết: client dùng base URL Proxy. BoxFox mặc định dùng cấu hình endpoint, và giữ MITM ngoài scope cho tới khi có threat model/consent riêng.

## Mapping code-reference thực tế

Mọi file sau tồn tại trong snapshot [`litellm/c811…/manifest.json`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/manifest.json), đều `reference-only`, và không được copy/adapt/import runtime. `enterprise/` không nằm trong snapshot.

| Chủ đề | Snapshot thực tế | Evidence ghim commit |
|---|---|---|
| OpenAI-compatible ingress | [`proxy_server.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/proxy/proxy_server.py), [`auth_checks.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/proxy/auth/auth_checks.py) | [proxy](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/proxy/proxy_server.py), [auth](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/proxy/auth/auth_checks.py) |
| Routing/fallback | [`router.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/router.py), [`dynamic_rate_limiter.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/proxy/hooks/dynamic_rate_limiter.py) | [router](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/router.py), [rate limiter](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/proxy/hooks/dynamic_rate_limiter.py) |
| Translation/tool map | [`anthropic/chat/transformation.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/llms/anthropic/chat/transformation.py), [`openai/responses/transformation.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/llms/openai/responses/transformation.py) | [Anthropic](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/llms/anthropic/chat/transformation.py), [Responses](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/llms/openai/responses/transformation.py) |
| Credential/sensitive-data reference | [`credential_accessor.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/litellm_core_utils/credential_accessor.py), [`sensitive_data_routing.py`](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/proxy/hooks/sensitive_data_routing.py) | [credential](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/litellm_core_utils/credential_accessor.py), [sensitive data](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/proxy/hooks/sensitive_data_routing.py) |

Một dependency LiteLLM trong tương lai là quyết định độc lập; snapshot không phải dependency vendored và không cấp quyền copy/adapt mã.
