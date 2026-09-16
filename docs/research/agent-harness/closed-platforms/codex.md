# OpenAI Codex — public-docs-only

## Phạm vi bằng chứng

Bản ghi này là **public-docs-only**. Nó không khẳng định bất kỳ chi tiết nội bộ nào của dịch vụ Codex, gồm prompt hệ thống, model routing, xử lý session, telemetry, kho credential hay sandbox implementation.

**Ngày truy cập/kiểm tra nguồn: 2026-09-15 (UTC).** Tài liệu và sản phẩm có thể thay đổi sau ngày này.

Nguồn chính thức công khai:

- Tổng quan Codex: <https://developers.openai.com/codex/>
- Slash commands và cấu hình người dùng công khai: <https://developers.openai.com/codex/guides/slash-commands/>
- Hướng dẫn `AGENTS.md`: <https://developers.openai.com/codex/guides/agents-md/>
- Sandbox và approvals: <https://developers.openai.com/codex/security/>
- Codex CLI mã nguồn công khai (chỉ khi cần kiểm tra phần CLI open source; không đại diện cho backend/dịch vụ): <https://github.com/openai/codex>

## Hành vi public có ích

Tài liệu Codex mô tả tách biệt hai khái niệm:

- **Sandbox**: ranh giới kỹ thuật cho thao tác lệnh, như quyền ghi workspace hoặc network tùy cấu hình.
- **Approval policy**: khi nào agent phải dừng để xin xác nhận trước hành động.

Tách biệt này quan trọng: approval không tự tạo isolation; sandbox cũng không thay thế UX hỏi người dùng. Tài liệu cũng mô tả `AGENTS.md` là chỉ dẫn theo repository/cây thư mục. Các file instruction được phát hiện theo phạm vi; chỉ dẫn gần hơn có thể áp dụng cho khu vực cụ thể hơn.

## Điều không được kết luận

Không dùng phần public để kết luận Codex backend lưu lịch sử thế nào, prompt system có nội dung gì, rule resolver cụ thể ra sao, hay sandbox cloud/local thực thi bằng công nghệ nào. Nếu một thành phần CLI có mã nguồn công khai, chỉ file/commit/license được xác minh mới có thể trở thành source evidence; bản ghi này không snapshot hoặc sao chép file đó.

## Bài học cho BoxFox

- Giữ sandbox và approval thành hai control plane khác nhau.
- Dùng instruction theo scope/path nhưng đưa qua provenance/trust pipeline.
- Khi cho phép interoperability với `AGENTS.md`, đừng coi nội dung file là policy; policy service vẫn quyết định capability.
- Không dựa vào tên mode CLI của Codex như một đặc tả BoxFox; BoxFox phải có semantics và test riêng.
