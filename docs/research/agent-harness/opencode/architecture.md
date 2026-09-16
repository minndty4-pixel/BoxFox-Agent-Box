# OpenCode: kiến trúc harness

## Phạm vi, nguồn và cách đọc

**Harness** là lớp chạy và điều phối agent: nhận yêu cầu, dựng ngữ cảnh, gọi mô hình, thực thi công cụ (tool), chờ phê duyệt và lưu kết quả. Tài liệu này mô tả phần có thể kiểm chứng trong OpenCode, không phải đặc tả BoxFox.

- Upstream: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- Snapshot đã kiểm tra: commit [`e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298), ngày commit 2026-09-14
- Giấy phép: [MIT](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/LICENSE)
- Tài liệu công khai của OpenCode: [Agents](https://opencode.ai/docs/agents), [Tools](https://opencode.ai/docs/tools), [Permissions](https://opencode.ai/docs/permissions)

Mọi đường dẫn `code-reference/...` dưới đây là **đường dẫn snapshot hiện có, được manifest và verifier kiểm tra**, không phải import runtime. Mỗi bản sao được đối chiếu manifest, SHA-256 và giấy phép; trạng thái tái sử dụng vẫn tuân theo trường `reuse_class` của manifest.

## Các đơn vị chạy

- **Project instance**: một ngữ cảnh chạy gắn với thư mục hiện hành và worktree Git.
- **Session**: hội thoại có định danh, lịch sử message/part, cấu hình agent và có thể có `parentID`.
- **Message / part**: message là đơn vị hội thoại; part là mảnh có kiểu như văn bản, lời gọi tool, file, reasoning hoặc compaction.
- **Agent**: cấu hình vai trò, prompt, mô hình và tập quyền. OpenCode phân biệt agent chính (*primary*) và agent con (*subagent*).
- **Run**: trạng thái thực thi đang hoạt động của một session; `SessionRunState` giữ runner theo `sessionID` và chuyển trạng thái busy/idle.

Theo [tài liệu Agents](https://opencode.ai/docs/agents), OpenCode có primary agent Build/Plan và subagent General/Explore/Scout; đây là cấu hình sản phẩm tại thời điểm tài liệu, không phải giao diện ổn định của API. `SessionRunState` tạo một runner mỗi session, chống chạy đồng thời không kiểm soát và hủy cả background job liên quan khi session bị hủy.

**Bằng chứng mã nguồn:**

| Kết luận kiểm chứng | Nguồn ghim commit | Snapshot đã lưu giữ | Khả năng tái sử dụng |
| --- | --- | --- | --- |
| Runner, busy/idle, cancel cascade | [`session/run-state.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/run-state.ts), [`session/status.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/status.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/{run-state,status}.ts` | `reference-only`; thiết kế lại theo runtime BoxFox |
| Lược đồ và lưu session/message/part | [`session/session.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/session.ts), [`session/schema.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/schema.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/{session,schema}.ts` | `reference-only` |
| Điều phối prompt và loop | [`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/prompt.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/prompt.ts` | `reference-only` |

## Luồng một lượt chạy

Đường đi chính có thể đọc từ `SessionPrompt` như sau:

```text
UI / CLI / HTTP API
  → SessionPrompt.prompt
  → chọn agent + provider/model + lịch sử
  → Instruction + SystemPrompt + SessionTools.resolve
  → LLM stream
  → SessionProcessor.process
       ↳ ghi text/reasoning/tool parts, thực thi tool, hỏi quyền
       ↳ yêu cầu compaction hoặc dừng/tiếp tục
  → SessionRunState cập nhật busy/idle
  → event bridge phát sự kiện cho client
```

`SessionPrompt` lấy các service cho session, agent, provider, processor, compaction, plugin, MCP (Model Context Protocol), LSP (Language Server Protocol), tool registry, instructions và permission; điều này cho thấy điều phối được tách thành service thay vì dồn vào một vòng lặp đơn. `SessionProcessor` nhận stream LLM, tạo snapshot trước stream, lưu tiến trình tool call và chuẩn hóa các kết quả stream thành part của session.

**Không nên suy diễn:** từ việc có `Snapshot.Service` không thể kết luận OpenCode cung cấp một sandbox filesystem an toàn, rollback giao dịch hoàn chỉnh hoặc event store phù hợp cho BoxFox. Đây là cơ chế theo dõi được gọi trong processor; ranh giới sandbox phải được BoxFox thực thi độc lập.

| Chi tiết | Nguồn ghim commit | Snapshot đã lưu giữ |
| --- | --- | --- |
| Service interface và vòng `prompt`/`loop` | [`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/prompt.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/prompt.ts` |
| Nhận stream, snapshot trước stream, cập nhật part | [`session/processor.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/processor.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/processor.ts` |
| Định nghĩa event/session schema | [`packages/schema/src/session-event.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/schema/src/session-event.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/schema/src/session-event.ts` |

## Event, reconnect và dữ liệu bền vững

OpenCode có event bridge và schema event cho trạng thái session, permission và compaction; `SessionStatus.set` phát status/idle event. Đó là bằng chứng cho mô hình client nhận trạng thái qua event. Tuy nhiên, chỉ từ các file được khảo sát **không đủ** để khẳng định toàn bộ event log là append-only, có thứ tự toàn cục, hoặc có giao thức reconnect/resume có bảo đảm giao nhận đúng một lần.

Khuyến nghị cho BoxFox là tách rõ:

1. nhật ký sự kiện bền vững (event store) có `sessionId`, `runId`, sequence và provenance;
2. projector làm nguồn dữ liệu đọc cho UI;
3. trạng thái chạy ngắn hạn như runner/cancel token;
4. artifact có checksum và ACL riêng.

Đây là diễn giải kiến trúc cho BoxFox, không phải tuyên bố OpenCode đã làm đủ bốn phần trên.

## Mẫu nên giữ và giới hạn cho BoxFox

**Nên giữ:** session con có lineage; runner một session; parts có trạng thái tool; ranh giới registry–tool executor–permission; compaction là sự kiện nhìn thấy được.

**Không sao chép nguyên xi:** implementation TypeScript/Effect, mặc định quyền cho phép rộng, hay cơ chế ẩn tool khỏi prompt. Việc tool không xuất hiện trong danh sách chỉ hỗ trợ trải nghiệm; quyền và sandbox mới là biên cưỡng chế.

**Cần bổ sung trong BoxFox:** task/run/turn rõ ràng, ngân sách thời gian/chi phí, capability token có thời hạn, provenance theo từng instruction/artifact, ràng buộc quyền child không vượt parent và sandbox thực thi độc lập.
