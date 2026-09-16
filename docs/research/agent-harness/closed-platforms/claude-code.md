# Claude Code — public-docs-only

## Phạm vi bằng chứng

Đây là bản ghi **public-docs-only**: chỉ mô tả hành vi được tài liệu chính thức công khai. Không có snapshot mã nội bộ, không suy đoán scheduler, prompt hệ thống, mô hình lưu session, thuật toán compaction, sandbox implementation hay cách Anthropic quản lý credential ở phía trong.

**Ngày truy cập/kiểm tra nguồn: 2026-09-15 (UTC).** Claude Code là sản phẩm thay đổi nhanh; các chi tiết mode và ngưỡng phiên bản dưới đây chỉ là trạng thái mà tài liệu official công bố tại ngày này, không phải cam kết bất biến cho bản cài đặt khác.

- Trang sản phẩm/tài liệu: <https://code.claude.com/docs/en/overview>
- Quyền: <https://code.claude.com/docs/en/permissions>
- Permission modes: <https://code.claude.com/docs/en/permission-modes>
- Subagents: <https://code.claude.com/docs/en/sub-agents>
- Hooks: <https://code.claude.com/docs/en/hooks>
- Settings: <https://code.claude.com/docs/en/settings>
- Agent SDK permissions (ranh giới public API): <https://code.claude.com/docs/en/agent-sdk/permissions>

## Hành vi đã công bố

**Claude Code** là công cụ coding agent. Tài liệu public mô tả các điểm sau:

- Quy tắc quyền có thể allow/ask/deny tool hoặc pattern; lệnh `/permissions` cho người dùng xem/chỉnh trạng thái quyền.
- **Permission mode** là chế độ mặc định cho cách công cụ xin phê duyệt; rule cụ thể và cấu hình có thể thay đổi hành vi này.
- **Subagent** là agent chuyên trách do phiên chính gọi. Có thể deny `Agent` để chặn toàn bộ delegation, hoặc `Agent(tên-subagent)` để chặn một subagent. Theo trang [Subagents](https://code.claude.com/docs/en/sub-agents), nếu không đặt `permissionMode`, subagent kế thừa mode của parent. Khi parent ở `default`, `dontAsk` hoặc `plan`, cấu hình `permissionMode` của subagent được dùng **trừ** `bypassPermissions`: subagent khai báo mode này vẫn giữ mode của parent. Khi parent ở `bypassPermissions`, `acceptEdits` hoặc `auto`, subagent chạy cùng mode parent và Claude Code bỏ qua `permissionMode` đã đặt. Ngoại lệ `bypassPermissions` này yêu cầu Claude Code v2.1.267+; alias `manual` cho `default` yêu cầu v2.1.200+. Đây là semantics theo tài liệu tại ngày kiểm tra, không phải quan hệ tăng/giảm quyền tổng quát mà BoxFox có thể sao chép.
- **Hook** là chương trình/callback cấu hình chạy tại các điểm vòng đời công cụ. Hook là extension point, không thay thế lớp deny/ask policy mà tài liệu Agent SDK mô tả.
- Settings là cấu hình người dùng/dự án cho hành vi, tool và permission.

## Điều không được kết luận

Các tài liệu trên không công bố đầy đủ prompt, tool executor, event store, format transcript, cách compact context, thứ tự chính xác của rule/hook trong mọi client, OS/container sandbox hay internal service. Vì vậy không dùng Claude Code làm bằng chứng code-reference, không copy prompt/tool nội bộ và không phát biểu rằng nó có một cơ chế sandbox cụ thể nếu trang công khai không nói rõ.

## Bài học cho BoxFox

1. Có thể tham khảo UX: permission mode, rule có scope và chặn delegation theo loại subagent.
2. BoxFox phải tự định nghĩa policy precedence, thời hạn/revocation, audit và sandbox; không suy luận chúng từ sản phẩm đóng.
3. Nếu tương thích cấu hình/tool name, tách adapter khỏi policy core; adapter không được nâng quyền.
4. Chỉ dẫn nào lấy từ trang public phải lưu URL và ngày kiểm tra; không có `code-reference` cho bản ghi này.
