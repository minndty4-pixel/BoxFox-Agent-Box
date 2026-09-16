# Devin — public-docs-only

## Phạm vi bằng chứng

Đây là bản ghi **public-docs-only** cho Devin của Cognition. Không có quyền truy cập mã nguồn harness, prompt hệ thống, fleet scheduler, VM image, tool executor, thuật toán context/compaction, cơ chế credential nội bộ hay dữ liệu khách hàng.

**Ngày truy cập/kiểm tra nguồn: 2026-09-15 (UTC).** Tài liệu và sản phẩm có thể thay đổi sau ngày này.

Nguồn công khai chính thức:

- Giới thiệu: <https://docs.devin.ai/get-started/devin-intro>
- Tạo session qua API: <https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions>
- Session tools: <https://docs.devin.ai/work-with-devin/devin-session-tools>
- Knowledge: <https://docs.devin.ai/product-guides/knowledge>
- Security profiles: <https://docs.devin.ai/product-guides/security-profiles>
- Secrets: <https://docs.devin.ai/product-guides/secrets>
- Devin CLI và handoff: <https://docs.devin.ai/work-with-devin/devin-cli>

## Hành vi đã công bố

Tài liệu mô tả Devin là agent phần mềm hoạt động theo session và có API để tạo/quản lý session. Các trang công khai còn mô tả:

- **Knowledge**: nội dung tổ chức quản lý để agent dùng khi làm việc.
- **Security profiles**: chính sách quản trị có thể hạn chế network, MCP, Git/GitHub CLI và áp dụng cho session/automation theo cấu hình.
- **Secrets**: bề mặt cấu hình secret được sản phẩm hỗ trợ; không suy diễn cách secret được lưu hoặc truyền bên trong.
- **CLI/handoff**: có workflow đưa công việc giữa môi trường CLI và cloud session.

## Điều không được kết luận

Không thể suy ra một security profile là capability model chính xác, sandbox có đặc tính nào, mọi session có cùng quyền, hay Knowledge được nạp vào context bằng thuật toán nào. Tài liệu public về API/session cũng không chứng minh artifact store, event store, PR workflow hoặc retry semantics ở mức nội bộ.

## Bài học cho BoxFox

- Admin policy, project knowledge, session configuration và secret references nên là các đối tượng tách biệt.
- BoxFox chỉ truyền opaque credential handle vào worker; agent transcript/prompt không nhận raw secret.
- Handoff cloud/local cần record task/session lineage và policy context, không chỉ copy văn bản.
- Không tạo code-reference từ sản phẩm đóng. Cần ghi URL công khai và phân biệt rõ hành vi public với quyết định thiết kế BoxFox.
