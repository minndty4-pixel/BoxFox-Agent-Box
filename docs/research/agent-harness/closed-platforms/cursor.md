# Cursor — public-docs-only

## Phạm vi bằng chứng

Đây là bản ghi **public-docs-only** cho Cursor editor và Cursor Cloud/Background Agents. Không có mã nội bộ, prompt, scheduler, kiến trúc VM/container, format session, thuật toán model routing hay implementation kiểm soát secrets để kiểm tra trong tài liệu này.

**Ngày truy cập/kiểm tra nguồn: 2026-09-15 (UTC).** Tài liệu và sản phẩm có thể thay đổi sau ngày này.

Nguồn công khai chính thức:

- Rules: <https://cursor.com/docs/rules>
- Agent security: <https://cursor.com/docs/agent/security>
- Background agents: <https://cursor.com/docs/background-agent>
- Cloud Agents: <https://cursor.com/docs/cloud-agent>
- Cloud Agent security: <https://cursor.com/docs/cloud-agent/security>
- Cloud Agent secrets & network: <https://cursor.com/docs/cloud-agent/security-network>
- Cloud Agent API: <https://cursor.com/docs/cloud-agent/api/endpoints>

## Hành vi public có ích

Tài liệu Cursor mô tả **Rules** là chỉ dẫn cho Agent, với project rules trong `.cursor/rules`, user rules theo môi trường người dùng và team rules ở gói phù hợp. Rules là context/instruction, không phải một sandbox.

Trang Agent Security mô tả guardrail và phê duyệt cho hành động nhạy cảm. Dòng Cloud/Background Agents công bố khả năng chạy tác vụ nền/cloud, cấu hình repository/environment và có trang riêng về secrets/network/security. API Cloud Agents cung cấp bề mặt điều khiển được tài liệu hóa cho việc tạo/quản lý agent cloud.

## Điều không được kết luận

Không thể kết luận từ tài liệu public rằng Cursor có lineage format nào, worker isolation cụ thể ra sao, approval pipeline chạy theo thứ tự nào, secrets đi qua dịch vụ nào, hoặc mọi background agent đều được sandbox cùng một mức. Không sao chép rule/prompt/tool nội bộ, không coi marketing/security overview là đặc tả implementable.

## Bài học cho BoxFox

1. Phân biệt rules (dữ liệu chỉ dẫn) với policy/sandbox (cưỡng chế).
2. Với agent nền/cloud, công bố rõ scope repository, network egress, secret handle, retention và nơi người dùng phê duyệt.
3. Một API tạo agent cần trả trạng thái, artifact, cancellation và audit event; không chỉ trả text.
4. Không xây compatibility dựa trên chi tiết không được công bố. Nếu đọc `.cursor/rules`, gắn provenance và đánh giá trust như mọi instruction dự án.
