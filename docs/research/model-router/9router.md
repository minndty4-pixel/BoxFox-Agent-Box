# 9Router: gateway local, translator và combo

## Snapshot và giới hạn bằng chứng

- Upstream: <https://github.com/decolua/9router>
- Commit kiểm tra: [`17c4cc76877bd1755030a8414f8d0083f48dcccf`](https://github.com/decolua/9router/tree/17c4cc76877bd1755030a8414f8d0083f48dcccf)
- Giấy phép: [MIT](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/LICENSE)
- Nhận định dưới đây là từ code snapshot; mô tả “40+ provider”, “token saving” trong README là tuyên bố upstream thay đổi theo thời điểm, không phải benchmark BoxFox.

## Nó kết nối client thế nào

README hướng các client coding tool đặt endpoint `http://localhost:20128/v1`, lấy API key từ dashboard và chọn model; xem [Quick Start](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/README.md#quick-start). Đây là **cấu hình client chủ động**, không cần intercept TLS. `handleChat` nhận JSON, phát hiện format endpoint OpenAI/Claude/Gemini/Responses, kiểm API key khi `requireApiKey` bật và chọn model/combo; xem [`src/sse/handlers/chat.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/sse/handlers/chat.js).

Điểm BoxFox nên học: adapter phải cho người dùng biết base URL, key BoxFox và alias cần cấu hình; có rollback. Không sao chép UI/API key local thành authority cho agent sandbox.

## Protocol và translation

`open-sse/translator/index.js` có registry converter. Nó ưu tiên converter trực tiếp; nếu không có thì source → OpenAI → target. Trước conversion, code làm sạch modality opt-in, gán `tool_call` ID, sửa tool response thiếu, chụp thinking/session intent; phía response cũng phản chiếu conversion và decloak tool name. Bằng chứng: [`translator/index.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/index.js), [formats](https://github.com/decolua/9router/tree/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/formats), [tool concern](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/concerns/toolCall.js).

Streaming được xử lý riêng; code gom SSE deltas thành tool calls cho non-stream/forced JSON và dịch response về format client. Xem [`streamingHandler.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/handlers/chatCore/streamingHandler.js) và [`sseToJsonHandler.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/handlers/chatCore/sseToJsonHandler.js).

**Diễn giải cho BoxFox:** translation phải có tests cho request, SSE, tool arguments/IDs, finish reason, usage và lỗi—not merely “đổi field JSON”. Pivot qua một format trung gian là fallback tiện dụng nhưng có loss; canonical form của BoxFox phải lưu capability/loss explicitly.

## Routing, alias, combo và fallback

- `handleChat` coi một model có nhiều mục tiêu là **combo**, phát hiện capability của request (vision, PDF, audio/video), ưu tiên model phù hợp, rồi chạy `fallback`, `round-robin` hoặc `fusion`: [`chat.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/sse/handlers/chat.js).
- `combo.js` định nghĩa phân tầng hard/soft capability và rotation state: [`combo.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/services/combo.js).
- Base executor thử URL fallback và retry theo status/lỗi: [`base.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/executors/base.js).

BoxFox chỉ nên adopt concept: alias → danh sách target + capability + policy/budget constraints. Fallback không được chọn provider/region/credential mới chỉ vì combo có nó; phải tạo execution plan sau policy. Không fallback sau khi đã phát content stream hữu ích.

## API key, OAuth và credential bên thứ ba

Repository có API key app, provider connection và dịch vụ refresh token. `connectionsRepo` liệt kê các field như `accessToken`, `refreshToken`, `apiKey`, `idToken` và serializes phần còn lại vào DB; xem [`connectionsRepo.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/lib/db/repos/connectionsRepo.js). Provider OAuth registry và service có tại [`src/lib/oauth`](https://github.com/decolua/9router/tree/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/lib/oauth), refresh có tại [`open-sse/services/tokenRefresh.js`](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/services/tokenRefresh.js).

Đây là bằng chứng về chức năng, **không** là mẫu lưu secret của BoxFox. BoxFox tách vault/credential broker khỏi router và agent: agent chỉ nhận opaque handle; vault quản lý encryption, scope, expiry, rotate/revoke; OAuth chỉ qua consent/PKCE được UI khởi tạo. Không snapshot token/database/.env, không import local credential.

## Security và điều cần tránh

- Code có kiểm API key tùy setting, nhưng local mode không key không đủ cho môi trường multi-user. BoxFox luôn phân biệt identity của caller, quyền agent và quyền credential.
- Translator có “tool cloaking” theo quirk OAuth ([source](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/index.js)); đổi tên tool không là policy/security control.
- Log request/provider có thể chứa payload nhạy cảm. BoxFox phải redact server-side trước persistence, với retention hạn chế.
- 9Router không là bằng chứng để bật MITM; đường config endpoint local đủ cho MVP.

## Mapping code-reference thực tế

Mọi file sau tồn tại trong snapshot [`9router/17c4…/manifest.json`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/manifest.json) và đều là `reference-only`; chúng không được copy/adapt hay import vào runtime. Liên kết **evidence** là `pinned_blob_url` trong manifest.

| Chủ đề | Snapshot thực tế | Evidence ghim commit |
|---|---|---|
| Ingress OpenAI/Anthropic/Responses | [`chat completions`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/src/app/api/v1/chat/completions/route.js), [`messages`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/src/app/api/v1/messages/route.js), [`responses`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/src/app/api/v1/responses/route.js) | [chat](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/app/api/v1/chat/completions/route.js), [messages](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/app/api/v1/messages/route.js), [responses](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/app/api/v1/responses/route.js) |
| Core/provider registry | [`chatCore.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/handlers/chatCore.js), [`executors/index.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/executors/index.js), [`providers/index.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/providers/index.js) | [core](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/handlers/chatCore.js), [executors](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/executors/index.js), [providers](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/providers/index.js) |
| Translation | [`claude-to-openai.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/translator/request/claude-to-openai.js), [`openai-to-claude.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/translator/response/openai-to-claude.js) | [request](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/request/claude-to-openai.js), [response](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/translator/response/openai-to-claude.js) |
| OAuth/API key/refresh | [`oauth/codex.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/src/lib/oauth/providers/codex.js), [`apiKeysRepo.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/src/lib/db/repos/apiKeysRepo.js), [`tokenRefresh.js`](../../../code-reference/model-router/9router/17c4cc76877bd1755030a8414f8d0083f48dcccf/upstream/open-sse/services/tokenRefresh.js) | [OAuth](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/lib/oauth/providers/codex.js), [API key](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/src/lib/db/repos/apiKeysRepo.js), [refresh](https://github.com/decolua/9router/blob/17c4cc76877bd1755030a8414f8d0083f48dcccf/open-sse/services/tokenRefresh.js) |

Các file upstream được nhắc trong phần phân tích nhưng không có trong bảng này là **evidence upstream-only**: không được ngụ ý là đã snapshot.
