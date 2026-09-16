# OpenCode: quyền và ngữ cảnh

## Thuật ngữ, nguồn và giới hạn

- **Permission rule**: quy tắc đối với một loại thao tác và pattern đầu vào, với kết quả `allow`, `ask` hoặc `deny`.
- **Approval**: phản hồi con người cho một yêu cầu đang chờ; OpenCode có `once`, `always`, `reject`.
- **Compaction**: tạo tóm tắt để giảm lịch sử gửi mô hình khi context dài.
- **Context window**: ngân sách đầu vào/đầu ra mà mô hình/provider chấp nhận.
- **Policy enforcement point**: điểm executor phải kiểm tra quyết định policy trước hành động.

Nguồn kiểm chứng là OpenCode commit [`e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298), MIT, và tài liệu [Permissions](https://opencode.ai/docs/permissions). Nội dung dưới đây không chứng nhận một sandbox cho OpenCode và không nên được dùng làm bảo đảm an ninh cho BoxFox.

## Permission engine và approval

`Permission.evaluate()` duyệt ruleset đã hợp nhất và chọn **rule khớp sau cùng**; nếu không có rule, nó trả `ask`. `Permission.ask()` kiểm từng pattern của thao tác: gặp `deny` thì lỗi ngay, toàn bộ `allow` thì chạy, còn lại tạo request chờ trong state theo instance/session và phát event. `reply()` xử lý:

- `once`: cho phép đúng request đang chờ;
- `always`: thêm rule `allow` tạm vào state và mở các request chờ cùng session phù hợp;
- `reject`: từ chối request đó và các approval còn chờ của cùng session.

Tài liệu công khai ghi rõ `allow` chạy không hỏi, `ask` hỏi người dùng, `deny` chặn; pattern wildcard và rule khớp cuối thắng. Nó cũng liệt kê quyền liên quan tool như `bash`, `edit`, `task`, `skill`, `webfetch`, `external_directory` và `doom_loop`.

| Kết luận kiểm chứng | Nguồn ghim commit | Snapshot đã lưu giữ | Phân loại |
| --- | --- | --- | --- |
| Evaluate, queue pending, reply once/always/reject | [`permission/index.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/permission/index.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/permission/index.ts` | `reference-only` |
| Lược đồ permission event/request | [`packages/schema/src/v1/permission.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/schema/src/v1/permission.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/schema/src/v1/permission.ts` | `reference-only` |
| Tool context gọi permission check | [`session/tools.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/tools.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/tools.ts` | `reference-only` |
| Quyền theo loại tool/input | [Permissions docs](https://opencode.ai/docs/permissions) | không snapshot tài liệu web; lưu URL trong ghi chép | public documentation |

### Lớp hiển thị không phải lớp cưỡng chế

Hàm `visibleTools()` có thể bỏ tool bị deny khỏi catalog, còn `SystemPrompt.skills()` cũng không đưa skill tool khi bị disabled. Đây là UX tốt: model ít có cơ hội đề xuất action không được phép. Nhưng executor phải tiếp tục gọi `Permission.ask()`/policy cho mọi tool call; việc một tool không có trong prompt không bảo vệ trước plugin, tool injection, lỗi adapter hay lời gọi trực tiếp.

OpenCode tài liệu hóa `--auto`: các yêu cầu không bị deny có thể tự approve. BoxFox không nên nhân bản mặc định đó ở môi trường nhiều agent; auto-approval phải là grant có scope, hạn dùng, principal, mục tiêu và audit event rõ ràng.

## Ngữ cảnh và compaction

`SessionCompaction` có hai công việc có thể thấy trong mã:

1. **Prune output tool**: đánh dấu `compacted` cho output hoàn tất khi tổng ước lượng vượt ngưỡng, bảo vệ phần context gần nhất.
2. **Tóm tắt lịch sử**: chọn lịch sử, lấy compaction agent/model, dựng prompt với tóm tắt trước đó, tạo assistant message ở mode `compaction`, gọi processor không có tool, rồi lưu summary/part và có thể tạo synthetic follow-up để tiếp tục.

Mã giữ message/part và phát event compaction; khi overflow có xử lý replay và thay media quá lớn bằng marker. Đây là bằng chứng compaction là thao tác có dữ liệu session nhìn thấy, chứ không chỉ là biến cục bộ. Nó không chứng minh rằng nhãn nhạy cảm, provenance hoặc dữ liệu bắt buộc sẽ luôn được bảo toàn: các khái niệm đó không được suy ra từ tóm tắt văn bản mô hình.

| Nội dung | Nguồn ghim commit | Snapshot đã lưu giữ | Phân loại |
| --- | --- | --- | --- |
| Chọn history, tạo compacting message, replay/continue | [`session/compaction.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/compaction.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/compaction.ts` | `reference-only` |
| Overflow/context threshold | [`session/overflow.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/overflow.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/overflow.ts` | `reference-only` |
| Summary service | [`session/summary.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/summary.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/summary.ts` | `reference-only` |

## Mô hình context cho BoxFox

BoxFox nên giữ phân lớp thay vì đẩy mọi thứ vào một tóm tắt:

| Lớp | Ví dụ | Cách xử lý đề xuất |
| --- | --- | --- |
| Ổn định | system policy, identity, workspace capability | nguồn có version; không để compaction sửa |
| Ngữ cảnh có provenance | user instruction, project rule, skill, artifact reference | lưu URL/path/hash/trust label; summary chỉ tham chiếu hoặc mang nhãn |
| Biến động | transcript, tool output, progress | có thể truncate/compact theo retention policy |

Summary phải mang `sourceMessageIds`, nhãn dữ liệu, hash/provenance và giới hạn sử dụng. Một summary không được trở thành kênh rửa nhãn hoặc tăng quyền. Khi resume/reconnect, client cần nhận event có sequence và projector phải kiểm tra thiếu đoạn; pattern event của OpenCode là tham khảo hữu ích nhưng BoxFox cần thiết kế cơ chế bền vững riêng.

## Các kiểm tra bắt buộc khi chuyển thành sản phẩm

1. Quyết định allow/ask/deny ở executor, không phải chỉ trong prompt/UI.
2. Quyền child là giao của parent và grant, không rộng hơn parent.
3. Approval có expiry, revocation và audit; `always` không mặc định vượt session/run.
4. Sandbox OS/network/credential tách khỏi permission rules; raw token không vào context/sandbox agent.
5. Compaction, checkpoint, summary, artifact và child result giữ nhãn/provenance.
6. Kiểm thử cả đường tool built-in, plugin, MCP và API trực tiếp cho cùng một enforcement point.
