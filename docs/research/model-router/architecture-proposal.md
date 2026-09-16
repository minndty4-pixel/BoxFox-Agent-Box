# Đề xuất kiến trúc model router cho BoxFox

> Trạng thái: đề xuất kiến trúc, **chưa được triển khai**. Router không cấp quyền, không chạy tool, không đọc secret thô trong sandbox và không thay thế policy/security service của BoxFox.

## Mục tiêu và nguyên tắc

Router cho sản phẩm nhiều agent phải để một harness/agent gọi nhiều provider mà không buộc harness biết từng SDK. Nó bảo toàn hợp đồng protocol ở biên, chọn route có kiểm soát và tạo bằng chứng truy vết. Quyết định cho phép dữ liệu đi đâu nằm ở policy/security service, không nằm trong prompt hay model alias.

1. **Deny by default:** alias, provider, credential, protocol, vùng dữ liệu và fallback đều cần được policy cho phép.
2. **Least privilege:** credential handle có owner, scope, provider/model allowlist, expiry, quota và revoke; handle của child agent không mạnh hơn parent.
3. **Không raw secret trong agent:** sandbox chỉ nhận `credential_handle` hoặc quyền gọi router; broker/vault mới đổi handle thành secret tại egress.
4. **Không downgrade âm thầm:** adapter trả về `unsupported_capability` khi route mất tool, vision, reasoning, JSON schema, cache control hoặc định dạng stream cần thiết; chỉ downgrade khi caller/policy cho phép rõ.
5. **Audit không nhạy cảm:** trace có ID, alias, capability, policy decision, provider/credential opaque ID, latency/cost/attempt; body/header/token bị redaction trước persistence.

## Luồng chuẩn

```text
harness hoặc client ngoài
  → client adapter (cấu hình endpoint/biến môi trường/profile, opt-in)
  → protocol ingress (authn, size/rate limit, version validation)
  → canonical request + capability declaration
  → policy gate (principal, data label, destination, model, budget, consent)
  → alias/model routing policy
  → credential broker (opaque handle → secret tại egress)
  → provider adapter
  → retry/fallback có điều kiện
  → stream + tool-call normalizer
  → protocol egress tới client
  → event/audit log đã che dữ liệu nhạy cảm
```

### 1. Client adapter và ingress

Adapter là đường **ưu tiên**: BoxFox tạo profile/cấu hình cho từng client (base URL local, API key BoxFox và alias). Ví dụ các dự án tham khảo đều chỉ ra endpoint local: [9Router README](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/README.md) dùng `/v1`; [CCR README](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/README.md) mô tả Agent Config và gateway local. Adapter phải hiển thị file/biến sẽ sửa, backup, xác nhận người dùng và có lệnh gỡ.

Ingress hỗ trợ từng protocol bằng route/version explicit, xác thực API key/identity riêng của BoxFox, giới hạn kích thước và correlation ID. Không tin `model`, `X-Route-Model`, URL hay header định tuyến do client gửi: coi chúng là *ý định* để đưa vào policy. OmniRoute đã thể hiện lý do: header override phải vẫn qua per-key allowlist ([source](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/resolveRoutingModel.ts)).

### 2. Canonical request và adapter

Canonical request nên có ít nhất:

```text
request_id, principal, agent_session_id, parent_request_id,
input_protocol/version, requested_alias, messages/content parts,
tools + JSON Schema, tool_choice, stream, response_format,
reasoning/media/cache requirements, data_labels, destination_constraints,
credential_handle?, budget, idempotency_key
```

Canonical stream event tách `message_start`, text/thinking delta, tool-call start/argument delta/end, usage, error và `done`. Provider adapter khai báo `capabilities` và conversion loss. Học từ 9Router: translator có direct route và pivot qua OpenAI, đồng thời sửa ID tool/response ([source](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/index.js)); học từ LiteLLM: tên tool cần reverse map duy nhất để round-trip an toàn ([source](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/llms/anthropic/chat/transformation.py)).

Không dùng OpenAI format làm “canonical” tuyệt đối: nó có ích làm dialect phổ biến nhưng không biểu đạt trọn vẹn tất cả semantic Anthropic/Gemini/Responses. Canonical model phải giữ source metadata và adapter chịu trách nhiệm round-trip contract test.

### 3. Alias, policy, route và fallback

`coding-default` chỉ giải ra execution plan sau khi policy xác nhận: principal được dùng alias; labels được gửi sang destination; provider/model đáp ứng capability; credential handle dùng được; chi phí/quota/network region còn hợp lệ.

Execution plan là danh sách mục tiêu đã được duyệt trước (provider capability + model + credential-handle ID + timeout + retry class), có `policy_version` và trace ID. Trình tự attempt:

1. chọn mục tiêu primary còn quota/healthy;
2. refresh/rotate credential chỉ trong broker nếu được phép;
3. retry cùng mục tiêu khi lỗi transient và request idempotent/safe;
4. fallback sang mục tiêu kế tiếp **đã duyệt**, chỉ trước khi downstream nhận nội dung hữu ích của stream;
5. khi đã commit stream, giữ route hoặc trả lỗi chuẩn; không ghép nửa câu trả lời của hai model.

CCR là tham chiếu tốt: executor ghi credential candidates, cooldown, retry/fallback và header diagnostic ([source](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/upstream/executor.ts)); pool của nó đánh dấu cooldown sau 401/403/429/5xx ([source](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/providers/credential-pool.ts)). LiteLLM có Router strategy/cooldown/fallback để cân nhắc dependency ([source](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/router.py#L705-L790)).

### 4. Hai đường credential

| Đường | Dòng đời yêu cầu |
|---|---|
| **API key của người dùng/tổ chức** | Người dùng nhập vào UI/broker qua kênh bảo mật → vault mã hoá lưu secret → broker tạo handle scoped → router đổi handle tại egress → rotation/revoke/audit. Không đưa key vào prompt, env của sandbox hay event body. |
| **Kết nối bên thứ ba qua OAuth/credential handle** | Người dùng bắt đầu consent ở UI → callback broker xác thực state/PKCE → vault lưu token mã hoá → broker refresh đúng provider → router chỉ dùng handle. Hiển thị account/provider/scope/expiry; người dùng revoke được. |

Không tự động import browser cookie, token CLI, keychain hay subscription credential. Tính hợp lệ về điều khoản dịch vụ và sự đồng ý thuộc policy/UX trước cả khi routing. Dự án tham khảo có đường OAuth/local persistence, chẳng hạn [9Router connection repo](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/lib/db/repos/connectionsRepo.js), nhưng BoxFox không sao chép cách lưu raw field `accessToken`, `refreshToken`, `apiKey` ở DB runtime.

### 5. Log, privacy và vận hành

- Tách audit event (immutable, metadata) khỏi debug trace có TTL ngắn; mặc định không lưu prompt/response đầy đủ.
- Che `Authorization`, cookie, API key, token, secret và cả header provider mới theo pattern fail-closed, tương tự [CCR sensitive headers](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/observability/sensitive-headers.ts).
- Metric: success/failure class, first-token/total latency, retry/fallback, quota, cost estimate, conversion loss; không dùng raw content làm label metric.
- Circuit breaker/cooldown theo provider **và credential handle**, không làm một account lỗi chặn toàn hệ thống.

## MITM: lựa chọn nghiên cứu sau, không mặc định

MITM TLS cần CA tin cậy trên host và có thể sửa DNS/system proxy; nó nhìn thấy prompt, tool output và credential trên luồng bị chặn. OmniRoute tự ghi rõ route enable MITM là local-only vì cài root CA/hệ thống DNS và bề mặt host-level TLS ([route guard](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/server/authz/routeGuard.ts)); mã còn cài CA vào trust store Linux bằng lệnh đặc quyền ([caTrust.ts](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/mitm/tproxy/caTrust.ts)).

Vì vậy MVP BoxFox chỉ dùng adapter cấu hình tường minh. Muốn nghiên cứu MITM sau này phải có ADR, threat model, consent theo client/host, UI cảnh báo rõ, CA riêng và uninstall kiểm chứng, local-only, allowlist target, không log raw traffic, hard kill switch, kiểm thử rollback và đánh giá điều khoản dịch vụ. Không coi MITM là cách lấy OAuth/API key.

## Lộ trình triển khai đề xuất

1. **Contract:** canonical types, protocol conformance fixtures, one provider mock, redaction/event schema.
2. **Safe direct route:** OpenAI-compatible ingress + một provider API key do broker giữ; alias/policy/capability/budget tối thiểu.
3. **Compatibility:** Anthropic Messages, OpenAI Responses, Gemini adapters; stream/tool call test matrix; BoxFox client profiles.
4. **Reliability:** health, quota, credential-handle rotation, retry/fallback pre-commit và route trace.
5. **OAuth:** consent/PKCE/vault/revoke cho từng integration được duyệt; không import/harvest token.
6. **Tùy chọn:** đánh giá LiteLLM adapter dependency, multiple provider, admin controls. MITM chỉ sau ADR độc lập.

## Mapping code-reference thực tế

Các snapshot dưới đây đã có manifest, checksum và `reuse_class: reference-only`; chúng là evidence, không phải code để copy/adapt/import. Mỗi liên kết **evidence** trỏ tới blob URL ghim commit trong manifest.

| Phần đề xuất | Snapshot thực tế | Evidence ghim commit |
|---|---|---|
| Canonical translation/tool stream | [9Router request translator](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/translator/request/claude-to-openai.js), [response translator](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/translator/response/openai-to-claude.js), [LiteLLM Anthropic transformation](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/llms/anthropic/chat/transformation.py) | [9Router request](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/request/claude-to-openai.js), [9Router response](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/response/openai-to-claude.js), [LiteLLM](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/llms/anthropic/chat/transformation.py) |
| Execution plan + fallback | [CCR executor](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/gateway/upstream/executor.ts), [failure classifier](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/routing/failure-classifier.ts), [LiteLLM router](../../../code-reference/model-router/litellm/c8114ba41ff76365e3fb065dd3c7ca387598fd98/upstream/litellm/router.py) | [executor](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/upstream/executor.ts), [classifier](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/routing/failure-classifier.ts), [router](https://github.com/BerriAI/litellm/blob/c8114ba41ff76365e3fb065dd3c7ca387598fd98/litellm/router.py) |
| Credential health + redaction | [CCR credential pool](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/providers/credential-pool.ts), [upstream header sanitizer](../../../code-reference/model-router/claude-code-router/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/upstream/packages/core/src/gateway/core-runtime/upstream-header-sanitizer.ts) | [pool](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/providers/credential-pool.ts), [sanitizer](https://github.com/musistudio/claude-code-router/blob/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40/packages/core/src/gateway/core-runtime/upstream-header-sanitizer.ts) |
| OmniRoute routing/fallback caution | [chat handler](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/src/sse/handlers/chat.ts), [account fallback](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/services/accountFallback.ts) | [chat](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/chat.ts), [fallback](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/services/accountFallback.ts) |

`resolveRoutingModel.ts`, `routeGuard.ts`, `caTrust.ts` và CCR `sensitive-headers.ts` vẫn được liên kết trực tiếp trong phần phân tích như **upstream-only evidence**; chúng không có trong curated snapshot, nên không được mô tả là snapshot.
