# OmniRoute: multi-client routing, authorization và cảnh báo MITM

## Snapshot

- Upstream: <https://github.com/diegosouzapw/OmniRoute>
- Commit kiểm tra: [`7cabac4985e8abcd7a34bad285698eebb924c46a`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a)
- Giấy phép: [MIT](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/LICENSE)
- Đây là project rất rộng và thay đổi nhanh. Ta chỉ dùng các file được nêu làm evidence, không kết luận mọi integration/provider hoạt động hay phù hợp điều khoản.

## Client adapter, alias và protocol

README mô tả gateway local `/v1` cho CLI/API-compatible clients; xem [README](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/README.md). Một đường routing đáng chú ý là `X-Route-Model`: `resolveRoutingModel` ưu tiên header hơn `body.model`, nhưng chú thích mã yêu cầu đồng bộ body và nhấn mạnh override vẫn qua per-key allowlist. Xem [`resolveRoutingModel.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/resolveRoutingModel.ts).

BoxFox áp dụng nguyên tắc, không áp dụng cơ chế không kiểm soát: header/path/body đều chỉ là request intent; policy kiểm alias/model/destination/credential sau canonicalization. Client adapter là opt-in config; model alias không là quyền vượt policy.

Router có handler chat/dispatch, alias/combo API, affinity pin và token refresh trong source tree: [`src/sse/handlers`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers), [`sessionAffinityPin.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/services/sessionAffinityPin.ts), [`src/app/api/v1`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a/src/app/api/v1). Các phần translator dùng package `@omniroute/open-sse`; cần snapshot đúng dependency/source được pin, không suy đoán chỉ từ README.

## Routing, fallback và account state

Code thể hiện combo/auto routing, admission theo target, circuit-breaker/rejected-request usage và fallback model. Xem [`chatDispatch.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/chatDispatch.ts), [`chatHelpers.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/chatHelpers.ts), [`comboTargetKeyPolicy.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/chat/comboTargetKeyPolicy.ts). Điều này củng cố hai yêu cầu BoxFox: xét capability/allowlist trên **mỗi fallback target**, và cô lập health/quota theo account/credential thay vì chỉ model.

OAuth connections được persist qua [`connectionPersistence.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/lib/oauth/connectionPersistence.ts); provider registry tại [`src/lib/oauth/providers`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a/src/lib/oauth/providers). Đây là evidence OAuth refresh/persistence, không phải license để trích token từ app/CLI khác hay để BoxFox lưu token thô trong DB agent.

## Authorization và security

`routeGuard.ts` chia route thành LOCAL_ONLY, ALWAYS_PROTECTED và MANAGEMENT; nhiều endpoint spawn process, mutate host hoặc export credential bị giới hạn loopback/auth. Xem [`routeGuard.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/server/authz/routeGuard.ts), pipeline tại [`pipeline.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/server/authz/pipeline.ts).

BoxFox dùng đây làm ví dụ thực tế: router admin/OAuth/host integration không được mở công khai mặc định; route “đã auth” vẫn cần scope, loopback/peer check và audit. Tuy nhiên policy nhãn IFC/quyền tool của BoxFox nằm ngoài router, không thay bằng route guard.

## MITM: evidence và caveat bắt buộc

OmniRoute chứa handler cho Claude Code/Codex/Cursor/OpenCode, proxy/system trust/DNS và transparent proxy: [`src/mitm`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a/src/mitm). Đây là interception, không phải cùng loại với cấu hình endpoint.

Các evidence đặc quyền cụ thể:

- route guard gọi enable MITM là host-level TLS interception, cài root CA/system DNS và ép local-only: [lines liên quan](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/server/authz/routeGuard.ts#L51-L53);
- `caTrust.ts` stage certificate rồi dùng `sudo` copy vào Linux trust store/update CA: [`caTrust.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/mitm/tproxy/caTrust.ts);
- `privilegedMitmStep.ts` chỉ chạy bước đặc quyền khi sudo gate cho phép: [`privilegedMitmStep.ts`](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/mitm/privilegedMitmStep.ts).

BoxFox **không** bật/copy cơ chế này trong MVP. Nếu từng nghiên cứu lại, cần consent, CA lifecycle/uninstall, local-only, target allowlist, no raw log, threat model và review pháp lý/ToS. Không sử dụng MITM để harvest OAuth/API key hay vượt kiểm soát client.

## Mapping code-reference thực tế

Mọi file sau tồn tại trong snapshot [`omniroute/7cab…/manifest.json`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/manifest.json), đều `reference-only`, và không được import/copy/adapt vào runtime.

| Chủ đề | Snapshot thực tế | Evidence ghim commit |
|---|---|---|
| Ingress + chat execution | [`catch-all route`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/src/app/api/[...omnirouteApiCatchAll]/route.ts), [`chat.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/src/sse/handlers/chat.ts), [`chatCore.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/handlers/chatCore.ts) | [route](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/app/api/%5B...omnirouteApiCatchAll%5D/route.ts), [chat](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/src/sse/handlers/chat.ts), [core](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/handlers/chatCore.ts) |
| Routing/fallback/admission | [`routing/index.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/services/routing/index.ts), [`accountFallback.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/services/accountFallback.ts), [`admission/controller.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/services/admission/controller.ts) | [routing](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/services/routing/index.ts), [fallback](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/services/accountFallback.ts), [admission](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/services/admission/controller.ts) |
| Translation/token refresh | [`claude-to-openai.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/translator/request/claude-to-openai.ts), [`openai-to-claude.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/translator/response/openai-to-claude.ts), [`tokenRefresh.ts`](../../../code-reference/model-router/omniroute/7cabac4985e8abcd7a34bad285698eebb924c46a/upstream/open-sse/services/tokenRefresh.ts) | [request](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/translator/request/claude-to-openai.ts), [response](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/translator/response/openai-to-claude.ts), [refresh](https://github.com/diegosouzapw/OmniRoute/blob/7cabac4985e8abcd7a34bad285698eebb924c46a/open-sse/services/tokenRefresh.ts) |

Các evidence MITM/authz (`resolveRoutingModel.ts`, `routeGuard.ts`, `caTrust.ts`) được liên kết trực tiếp ở phần trên nhưng **cố ý không snapshot**: chúng minh hoạ thao tác host/CA đặc quyền mà BoxFox không được copy/adapt trong MVP.
