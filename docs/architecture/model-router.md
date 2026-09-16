# Kiến trúc Model Router của BoxFox

> **Trạng thái:** Đề xuất kiến trúc. Nó thay mô tả router chỉ dựa vào một thư viện bằng một gateway đa giao thức, nhưng không cam kết provider, OAuth hay proxy nào đã triển khai. [Mô hình bảo mật và IFC](security-model.md) là nguồn chuẩn quy phạm cho data classification, approval/lease, egress, declassification, audit và giới hạn claim; router chỉ thực thi route constraints nhận từ cổng chính sách đó.
>
> **Nguồn tham khảo đã kiểm:** [9Router `17c4cc76877bd1755030a8414f8d0083f48dcccf`](https://github.com/decolua/9router/tree/17c4cc76877bd1755030a8414f8d0083f48dcccf), [OmniRoute `7cabac4985e8abcd7a34bad285698eebb924c46a`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a), [Claude Code Router `cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`](https://github.com/musistudio/claude-code-router/tree/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40) và [LiteLLM `c8114ba41ff76365e3fb065dd3c7ca387598fd98`](https://github.com/BerriAI/litellm/tree/c8114ba41ff76365e3fb065dd3c7ca387598fd98). Ghi chép, giới hạn và evidence file nằm trong [`docs/research/model-router/`](../research/model-router/); snapshot liên kết tại [`code-reference/model-router/`](../../code-reference/model-router/). LiteLLM là adapter/dependency tùy chọn, không phải policy engine.

## 1. Thuật ngữ

- **Model router (bộ định tuyến mô hình):** gateway chọn route/model/provider phù hợp và chuẩn hóa request/response.
- **Provider (nhà cung cấp):** dịch vụ hoặc endpoint chạy model, gồm cloud, local và self-hosted.
- **Protocol ingress (đầu vào giao thức):** lớp nhận giao thức client, như OpenAI-compatible chat/completions, Anthropic Messages hay API nội bộ BoxFox.
- **Canonical request (yêu cầu chuẩn):** biểu diễn trung lập provider mà policy và routing dùng làm nguồn sự thật.
- **Adapter (bộ chuyển đổi):** thành phần chuyển đổi canonical protocol với protocol/provider cụ thể.
- **Alias (bí danh model):** tên ổn định do BoxFox quản lý, ví dụ `coding-default`, không phải tên model provider hay nhãn UI tự do.
- **Route (tuyến):** lựa chọn cụ thể alias → provider account → model revision → endpoint/protocol.
- **Credential broker (bộ môi giới credential):** dịch vụ giữ credential và phát hành quyền dùng ngắn hạn, không gửi raw secret vào agent sandbox.
- **Opaque handle (handle mờ):** mã tham chiếu không tiết lộ token; chỉ broker giải được.
- **OAuth:** Open Authorization, luồng người dùng cho phép bên thứ ba truy cập mà không đưa mật khẩu cho BoxFox.
- **API key:** khóa gọi API do người dùng/tổ chức cung cấp.
- **Fallback (dự phòng):** thử route khác khi lỗi phù hợp, không phá classification/policy.
- **MITM (Man-in-the-Middle):** proxy chặn/giải mã lưu lượng bằng chứng chỉ trung gian; là lựa chọn nghiên cứu đặc quyền cao, không phải mặc định.
- **RFC 3339:** chuẩn biểu diễn thời điểm có múi giờ; ví dụ deadline trong giao thức chuẩn.

## 2. Boundary và luồng chuẩn

```text
Client adapter
  → protocol ingress → canonical request → alias + routing policy
  → credential broker → provider adapter → provider/local runtime
  → stream/tool-call normalizer → client adapter
                    ↘ redacted audit / metrics / trace
```

Router là một service phía control plane, tách khỏi agent sandbox. Agent harness chỉ gọi **BoxFox Router API**; browser/terminal/tool không nhận provider token. Router nhận data classification và egress constraints từ [mô hình bảo mật và IFC](security-model.md#7-bí-mật-dữ-liệu-dẫn-xuất-và-egress), nhưng không tự hạ nhãn, cấp approval/lease hay tự cho phép dữ liệu rời máy.

| Thành phần | Trách nhiệm | Không được làm |
|---|---|---|
| Client adapter/ingress | xác thực client, parse protocol, limit input/stream | tin model name của client như quyền truy cập |
| Canonical validator | schema, capability, artifact/message part refs, correlation ID | nối raw secret vào canonical request |
| Routing policy | chọn alias/route đủ capability, classification, quota/budget | fallback sang route classification cấm |
| Credential broker | resolve handle đúng principal/route, inject tại egress | trả raw token cho harness, log hay sandbox |
| Provider adapter | chuyển protocol, truyền stream, map lỗi/usage | diễn giải tool call là hành động đã được phép |
| Normalizer | trả event chuẩn hoá, preserve call IDs/order | bỏ mất cancellation, finish/error hoặc usage |
| Observability | log đã redaction, metric/trace/audit | log prompt, authorization header hoặc token mặc định |

## 3. Canonical router protocol

### 3.1 Request

`POST /v1/router/generate` là hợp đồng nội bộ ổn định; ingress tương thích provider chỉ là adapter bên ngoài.

```json
{
  "request_id": "uuid",
  "correlation_id": "harness-run-id",
  "principal": {"tenant_id": "…", "user_id": "…", "service": "harness"},
  "alias": "coding-default",
  "operation": "agent_turn",
  "messages": [{"role": "system|user|assistant|tool", "parts": [{"type": "text|image|tool_call|tool_result", "ref": "artifact-or-inline-id"}]}],
  "tools": [{"name": "…", "input_schema": {}}],
  "requirements": {"stream": true, "vision": false, "tool_calling": true, "min_context_tokens": 32000},
  "data_constraints": {"classification": "public|internal|secret", "egress_policy_id": "…"},
  "budget": {"max_cost": "…", "max_output_tokens": 4096, "deadline": "RFC3339"},
  "idempotency_key": "…",
  "policy_revision": "…",
  "trace": {"parent_span_id": "…"}
}
```

Nội dung inline bị giới hạn kích thước và vẫn phải có tham chiếu provenance/classification. Router từ chối alias không biết, capability không hỗ trợ, policy revision cũ, schema tool sai hoặc route không thỏa data constraints trước khi liên hệ provider.

### 3.2 Stream and errors

Phong bì sự kiện chuẩn là `{request_id, sequence, type, payload}`. Các type bắt buộc: `response.started`, `text.delta`, `reasoning.summary` (chỉ summary mà provider công khai và an toàn cho người dùng), `tool_call.delta`, `tool_call.completed`, `usage`, `response.completed`, `response.cancelled`, `response.failed`.

ID tool call giữ ổn định từ delta đầu tiên đến lúc hoàn tất. Router chuẩn hóa stop reason, tool format và token usage đặc thù provider nhưng không dispatch tool; harness vẫn xác minh từng call qua policy/executor riêng. Lỗi dùng `{category, retryable, provider_code?, route_id?, safe_message}` với các category `AUTH` (xác thực), `RATE_LIMIT` (vượt giới hạn tốc độ), `TIMEOUT` (hết thời gian), `UNAVAILABLE` (provider không sẵn sàng), `CAPABILITY` (thiếu năng lực), `POLICY_DENIED` (policy từ chối), `BUDGET_EXCEEDED` (vượt ngân sách), `INVALID_REQUEST` (request sai), `CANCELLED` (đã hủy).

## 4. Catalog, aliases and policy

Catalog model do server quản lý ghi các sự kiện route bất biến:

```text
ModelAlias { alias, purpose, allowed_classifications, required_capabilities,
             ordered_route_ids, fallback_group, status }
Route { route_id, provider_id, provider_model_id, protocol, endpoint_ref,
        credential_handle_ref, capabilities, context_limit, regions,
        cost_version, rate_limit_profile, health }
```

UI chọn alias từ catalog; không bao giờ biến chuỗi hiển thị thành endpoint/model ID. Policy giải alias theo:

1. luật data classification/egress từ IFC; `secret` không được chọn cloud chỉ vì rẻ hơn;
2. capability bắt buộc: context length, image input, structured output, tool calling, streaming và ràng buộc vùng/residency;
3. entitlement của principal tổ chức/người dùng và route health;
4. budget, quota và deadline theo run.

Local route là route thường với `provider_kind=local`; việc thiếu hoặc lỗi local route được phép là block hiển thị rõ, không phải quyền tự động xuất dữ liệu đã phân loại. Declassification rõ ràng vẫn là thao tác người dùng riêng, có audit dưới security policy, không bao giờ là công tắc tiện dụng của router.

## 5. Credential broker

Có hai đường credential được hỗ trợ:

1. **API key do người dùng hoặc tổ chức cung cấp.** Người dùng/tổ chức lưu nó tại secret storage của broker; router chỉ lưu `credential_handle`, chủ sở hữu, provider scope, metadata expiry/rotation và tham chiếu audit.
2. **Kết nối bên thứ ba do người dùng cho phép.** OAuth callback và xử lý refresh token diễn ra tại endpoint broker/control-plane. Agent chỉ nhận metadata kết nối và opaque handle; không bao giờ nhận access token, refresh token, cookie hay authorization header.

```text
Harness request (alias, principal) → Router policy
  → broker.authorize(handle, principal, route, scopes, expiry)
  → short-lived provider auth injected in outbound adapter request
  → provider response; token discarded/redacted
```

Broker kiểm ownership của handle, tenant isolation, provider/model/route allowlist, scope, revocation và expiry. Nó hỗ trợ rotation/revocation mà không phải ghi lại harness state. Raw credential không được xuất hiện trong prompt, tool args, artifact payload, sandbox environment, client response, event, trace hay log thường. Provider response vô tình echo nội dung giống secret được xử lý theo policy classification/redaction của artifact; chỉ scrub log không phải confidentiality boundary.

Interception subscription/session và MITM **không** là credential path mặc định. Chúng cần một quyết định research/security được phê duyệt riêng, consent rõ của người dùng, certificate lifecycle/isolation, domain allowlist, audit và review pháp lý/điều khoản provider. Không được dùng chúng để âm thầm biến một tài khoản bên thứ ba thành provider pool chung.

## 6. Fallback, rate limiting and compatibility

Fallback chỉ bắt đầu sau canonical error được đánh dấu retryable. Retry dùng backoff có trần, deadline còn lại và một budget ledger duy nhất. Fallback candidate phải thỏa classification, egress, principal entitlement và capability yêu cầu tương đương hoặc chặt hơn. Nó không thể chuyển local/secret-only sang cloud, đổi tenant credential, bỏ yêu cầu vision/tool hoặc vượt cost cap đã cạn.

Rate limiting diễn ra trước provider dispatch theo principal, tổ chức, credential handle, route và provider profile. Router trả retry-after có cấu trúc; harness quyết định pause/replan/cancel. Health check có thể ảnh hưởng thứ tự nhưng không mang dữ liệu prompt người dùng.

Adapter cần kiểm thử độc lập bằng protocol fixture cho: request translation, server-sent stream chunk, multi-tool-call ID, tool result, cancellation, usage, finish reason, chunk sai và error conversion. Nguồn nghiên cứu cho thấy nhiều client/provider protocol tồn tại; vì vậy BoxFox cô lập ingress/egress adapter thay vì hứa một proxy sẽ giống hệt cho mọi coding client.

## 7. Observability and audit

Mỗi quyết định phát trace có `request_id`, correlation/run ID, alias, route ID đã chọn, catalog/policy revision, classification decision, capability match, fallback reason, latency, token/usage và cost estimate. Sensitive field theo allowlist: log không có raw prompt, artifact body, API key, OAuth token, cookie, authorization header hay kết quả resolve opaque handle.

Audit record còn định danh principal, chỉ **handle ID** của credential, data egress classification, provider/region route, outcome và revocation/approval reference. Truy cập trace đã redaction và artifact content được ủy quyền độc lập. Metric gồm route success/error/latency, rate-limit block, fallback count, capability mismatch, policy block, cost và lỗi stream normalization. Observability trả lời “route nào đã được dùng và vì sao?” mà không biến thành kho prompt bóng.

## 8. API surface and staged roadmap

| API group | Consumer | Minimum contract |
|---|---|---|
| `/v1/router/generate`, `/cancel` | harness | canonical request/event stream; idempotency/correlation |
| catalog read | UI/harness | aliases, capabilities, availability; no endpoint secrets |
| credential connection | authenticated user | create/revoke/rotate connection; opaque handle only |
| admin policy/catalog | administrator | versioned routes, alias order, provider limits, audit |
| provider/client adapters | external protocols | translation only; no security-policy ownership |

**Giai đoạn 0:** canonical schema, fake provider, event/audit đã redaction và test routing deny-by-default.  
**Giai đoạn 1:** một local provider và một provider API-key trực tiếp qua broker handle; kiểm catalog/capability và fallback có ràng buộc.  
**Giai đoạn 2:** streaming/tool-call normalizer, rate limit/cost ledger theo route, OAuth connection flow và route observability.  
**Giai đoạn 3:** thêm protocol/client adapter sau test fixture tương thích; residency/quota doanh nghiệp nếu cần.  
**Nghiên cứu sau này:** MITM/interception có consent rõ, nếu qua một quyết định security/legal/product độc lập.

Test nghiệm thu phải chứng minh: request `secret` không tạo cloud dispatch; fallback không bao giờ hạ classification; agent sandbox không lấy được raw credential; stream đã cancel không chạy tool; và log/trace không chứa secret fixture đã chèn.
