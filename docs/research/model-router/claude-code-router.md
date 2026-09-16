# Claude Code Router: mẫu gateway có policy, credential pool và trace

## Snapshot

- Upstream: <https://github.com/musistudio/claude-code-router>
- Commit kiểm tra: [`cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`](https://github.com/musistudio/claude-code-router/tree/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40)
- Giấy phép: [MIT](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/LICENSE)
- Giá trị chính cho BoxFox: cấu trúc gateway TypeScript tách protocol, routing, credential health, fallback và observability. Đây không là code production được chép nguyên khối.

## Client interception/configuration

CCR mô tả mình là local gateway/control plane; Quick Start hướng cài Desktop/CLI, start server `127.0.0.1:3456`, chọn Agent Config rồi apply profile cho Claude Code, Codex và client khác. Xem [README Quick Start](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/README.md#quick-start). Đây là đường **cấu hình client** lành mạnh: client gọi local endpoint do operator chọn, không cần TLS MITM.

Trong BoxFox, mỗi client adapter cần adapter versioned, preview thay đổi, backup/undo và credential BoxFox scoped. Không ghi token provider vào file client; client chỉ biết key/identity gọi BoxFox, còn BoxFox broker sở hữu secret upstream.

## Pipeline và protocol adapters

`GatewayRequestPipeline.proxyRequest` tạo request ID/trace, forward header, loại bỏ header route không đáng tin, normalise local auth, xử lý compatibility, routing, upstream và logging. Xem [`gateway/request/pipeline.ts`](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/request/pipeline.ts). Đây là mẫu tốt để BoxFox tách phase, ghi trace mutation và không để client cung cấp header nội bộ.

`protocol-adapter.ts` minh hoạ một khác biệt nhỏ nhưng quan trọng: Gemini có model trong URL, vì vậy adapter đưa model vào body để route rồi khôi phục body/rewrite URL khi egress. Xem [`routing/protocol-adapter.ts`](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing/protocol-adapter.ts). Các protocol endpoint, model registry, policy engine và config compiler tách riêng trong [`packages/core/src/routing`](https://github.com/musistudio/claude-code-router/tree/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing).

**Áp dụng BoxFox:** canonical request giữ `input_protocol`, model location, tool/media/reasoning capability và original source metadata; egress adapter chỉ là nơi rewrite URL/header/body. Mọi adapter phải có fixture contract request + SSE + tool call + lỗi; trả capability error thay vì silently transform mất semantic.

## Route, fallback, rate limit và credential pool

`upstream/executor.ts` là evidence trung tâm. Nó:

- chọn protocol từ path, rewrite target provider/model/fallback theo protocol;
- lập execution attempts, chọn credential trong provider pool;
- đọc cooldown/limit, retry lỗi mạng/status, quyết định fallback;
- phát `x-ccr-*` diagnostics và route trace cho attempt/fallback.

Nguồn: [`gateway/upstream/executor.ts`](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/upstream/executor.ts).

`credential-pool.ts` tính usage theo window, cooldown credential riêng khi upstream trả 401/403/429/5xx và clear sau thành công. Xem [`providers/credential-pool.ts`](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/providers/credential-pool.ts). Điều này phù hợp với BoxFox: fallback selection phải account/credential-aware, không vô tình lặp credential bị rate limit.

Tuy vậy BoxFox không expose credential chain in headers cho client nếu nó làm lộ topology/account; audit nội bộ chỉ dùng opaque IDs. Retry/fallback chỉ cho eligible error, request policy/capability-compatible và trước stream commitment.

## OAuth/API key và third-party credentials

CCR có provider preset, `oauth-plugin.ts`, account services và credential pool: [`packages/core/src/providers`](https://github.com/musistudio/claude-code-router/tree/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/providers). Mã này là bằng chứng tính năng, không chứng minh mọi OAuth/subscription provider cho phép proxy/rotation. BoxFox cần phân biệt:

1. **API key BYOK/tổ chức:** user/org cấp trực tiếp cho broker; broker vault hoá, gán handle với provider/model/scope/budget và hỗ trợ revoke.
2. **OAuth/third-party:** UI bắt đầu consent; broker giữ state/PKCE/callback/token encryption/refresh; agent only has handle. Cần hiện rõ nguồn credential và consent.

Raw token không đi trong prompt, tool call, sandbox environment, route trace hoặc source snapshot. API key ingress của BoxFox chỉ xác thực caller vào router, hoàn toàn khác provider credential ở egress.

## Observability và security

CCR có `RequestRouteTraceRecorder` trong pipeline và nhóm [`observability`](https://github.com/musistudio/claude-code-router/tree/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/observability). `sensitive-headers.ts` denylist `authorization`, cookie, API-key và pattern token/secret/credential/key để fail-closed khi log: [source](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/observability/sensitive-headers.ts).

BoxFox thêm: redaction body/data label trước queue/log, correlation với session/agent/approval, retention policy, RBAC audit reader và trace không chứa raw provider credential. Router không được là policy engine cho quyền tool/filesystem; nó gọi security policy với destination/data-label context.

## MITM caveat

CCR reference được dùng ở đây cho cấu hình endpoint local/gateway và pipeline, **không** làm cơ sở để BoxFox chặn TLS. Khi client cho cấu hình base URL, ưu tiên nó. Bất kỳ interception TLS nào cần nghiên cứu/threat model riêng như đã nêu trong [OmniRoute](omniroute.md#mitm-evidence-và-caveat-bắt-buộc).

## Mapping code-reference thực tế

Mọi file sau tồn tại trong snapshot [`claude-code-router/cbe5…/manifest.json`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/manifest.json), đều `reference-only`, và không được copy/adapt/import runtime.

| Chủ đề | Snapshot thực tế | Evidence ghim commit |
|---|---|---|
| Pipeline/protocol | [`request/pipeline.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/gateway/request/pipeline.ts), [`protocol-adapter.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/routing/protocol-adapter.ts), [`protocol-endpoints.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/routing/protocol-endpoints.ts) | [pipeline](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/request/pipeline.ts), [adapter](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing/protocol-adapter.ts), [endpoints](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing/protocol-endpoints.ts) |
| Policy/fallback | [`policy-engine.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/routing/policy-engine.ts), [`failure-classifier.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/routing/failure-classifier.ts), [`upstream/executor.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/gateway/upstream/executor.ts) | [policy](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing/policy-engine.ts), [classifier](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing/failure-classifier.ts), [executor](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/upstream/executor.ts) |
| Credential/rate/API-key | [`credential-pool.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/providers/credential-pool.ts), [`oauth-plugin.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/providers/oauth-plugin.ts), [`window-limiter.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/gateway/limits/window-limiter.ts) | [pool](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/providers/credential-pool.ts), [OAuth](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/providers/oauth-plugin.ts), [limits](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/limits/window-limiter.ts) |
| Header safety/log model | [`upstream-header-sanitizer.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/gateway/core-runtime/upstream-header-sanitizer.ts), [`request-log-model.ts`](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/observability/request-log-model.ts) | [sanitizer](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/core-runtime/upstream-header-sanitizer.ts), [log model](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/observability/request-log-model.ts) |

`sensitive-headers.ts` được liên kết như evidence upstream-only trong phần phân tích, nhưng không nằm trong curated snapshot; bảng này không ngụ ý nó đã được snapshot.
