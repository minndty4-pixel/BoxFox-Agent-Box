# OpenCode: prompt và công cụ

## Thuật ngữ và nguồn

- **Prompt composition**: ghép chỉ dẫn, môi trường, lịch sử và định nghĩa tool thành đầu vào mô hình.
- **System prompt**: chỉ dẫn hệ thống do harness cung cấp, tách với yêu cầu người dùng.
- **Instruction**: chỉ dẫn theo người dùng/dự án, chẳng hạn `AGENTS.md`.
- **Tool registry**: danh mục tool có schema, mô tả và executor.
- **MCP (Model Context Protocol)**: giao thức kết nối tool/tài nguyên từ server bên ngoài.

Nguồn là OpenCode ở commit [`e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298), MIT. Xem thêm tài liệu công khai: [Rules](https://opencode.ai/docs/rules), [Tools](https://opencode.ai/docs/tools), [Permissions](https://opencode.ai/docs/permissions).

## Cấu tạo prompt đã kiểm chứng

`SessionPrompt` phối hợp lịch sử session với `Instruction`, `SystemPrompt`, agent, provider/model, MCP, LSP và tool registry. `SystemPrompt.provider()` chọn template theo loại model/provider; `SystemPrompt.environment()` đưa vào thư mục làm việc, worktree, Git, platform, ngày hiện tại và project references; `SystemPrompt.skills()` chỉ công bố **catalog** skill để agent dùng tool nạp nội dung khi cần.

`Instruction` tìm `AGENTS.md`, fallback `CLAUDE.md` và `CONTEXT.md` cũ. Nó đọc nguồn global, nguồn gần thư mục hiện hành và các file/URL trong cấu hình. Khi đọc một file, `resolve()` còn có thể đưa instruction gần file đó vào cùng message và theo dõi phần đã gắn để tránh lặp trong message. Tài liệu [Rules](https://opencode.ai/docs/rules) lưu ý URL instruction có timeout năm giây.

```text
template theo provider/model
+ environment và project references
+ instruction global/dự án/cấu hình
+ catalog skill và MCP instruction được phép
+ lịch sử message/part, file đính kèm, yêu cầu mới
+ JSON Schema của tool được phép
→ lời gọi provider
```

Đây là mô hình quan sát được ở commit đã ghim. Thứ tự cuối cùng và nội dung chi tiết còn phụ thuộc `SessionPrompt`, provider transform, plugin và cấu hình tại thời điểm chạy; không nên coi sơ đồ là giao kèo API.

| Nội dung | Nguồn ghim commit | Snapshot đã lưu giữ | Phân loại |
| --- | --- | --- | --- |
| Ghép system prompt, environment, skill/MCP catalog | [`session/system.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/system.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/system.ts` | `reference-only` |
| Tìm/đọc/dedupe instruction | [`session/instruction.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/instruction.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/instruction.ts` | `reference-only` |
| Template prompt theo model | [`session/prompt/`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/prompt) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/prompt/` | `reference-only`; kiểm tra từng file trước khi copy |
| Điều phối lượt prompt | [`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/prompt.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/prompt.ts` | `reference-only` |

### Điểm an toàn cần tách riêng

Instruction từ workspace hoặc URL là dữ liệu không mặc nhiên đáng tin. OpenCode có khả năng nạp chúng; điều đó **không** biến chúng thành policy bảo mật. BoxFox cần lưu provenance (nguồn, hash, thời điểm, trust level), quét/quarantine skill hoặc instruction dự án và chỉ policy service/sandbox mới được quyết định quyền thực thi.

## Registry, thực thi và kết quả tool

`ToolRegistry` tập hợp tool built-in như shell, đọc/ghi/sửa file, glob/grep, task, skill, web fetch/search, question, todo, LSP, patch; nó cũng nạp custom tool từ thư mục cấu hình và plugin. `SessionTools.resolve()` chuyển tool registry sang schema phù hợp với provider/model, tạo context có `sessionID`, `messageID`, `callID`, abort signal và callback `ask`, rồi gọi hook trước/sau khi thực thi.

Kết quả tool được ghi thành part có input, output, metadata, thời gian và có thể có file attachment. Khi output quá lớn, module truncate lưu phần đầy đủ vào đường dẫn và trả về kết quả rút gọn để giữ context; đây là kỹ thuật quản lý token, không phải cơ chế kiểm soát truy cập.

| Nội dung | Nguồn ghim commit | Snapshot đã lưu giữ | Phân loại |
| --- | --- | --- | --- |
| Danh mục built-in/custom/plugin tool | [`tool/registry.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/registry.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/tool/registry.ts` | `reference-only` |
| Chuyển registry sang AI SDK tool, context và hook | [`session/tools.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/tools.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/tools.ts` | `reference-only` |
| Ghi tool call từ LLM stream | [`session/processor.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/processor.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/processor.ts` | `reference-only` |
| Giới hạn output | [`tool/truncate.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/truncate.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/tool/truncate.ts` | `reference-only` |

### Đánh giá quyền lúc thực thi

Context tool gọi `Permission.ask()` với ruleset hợp nhất từ agent và session. Tool MCP resource cũng yêu cầu quyền `read` trước khi liệt kê/đọc resource. Điều đó là bằng chứng cho **điểm kiểm tra tập trung ở luồng tool**.

Tuy vậy, `Permission.visibleTools()` có thể lọc tool khỏi danh sách hiển thị theo rule `deny`. Đây chỉ là lớp giảm khả năng model gọi nhầm tool. BoxFox không được dùng lọc prompt/catalog như một ranh giới an ninh: executor phải xác thực capability và sandbox phải từ chối thao tác ngoài phạm vi dù model vẫn có schema tool.

## Mẫu áp dụng có chọn lọc cho BoxFox

1. Duy trì registry khai báo schema tách executor; mỗi lần gọi có `runId`, `turnId`, `callId`, policy decision và artifact reference.
2. Công bố danh mục ít dữ liệu trước, nạp payload skill/tool documentation khi cần để tiết kiệm context.
3. Ghi input/output có giới hạn, nhưng artifact đầy đủ phải có ACL, checksum và provenance.
4. Đưa instruction từ URL/project qua pipeline phân loại và trust; không gộp trực tiếp vào trusted system prompt.
5. Không copy implementation MIT nếu không cần: đọc pattern và viết adapter BoxFox riêng là lựa chọn mặc định.
