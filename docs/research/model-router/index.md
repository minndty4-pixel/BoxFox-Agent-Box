# Nghiên cứu model router cho BoxFox

**Router mô hình** là dịch vụ nhận một yêu cầu suy luận, chọn mô hình/nhà cung cấp/thông tin xác thực (credential) phù hợp, rồi trả về kết quả theo giao thức mà client đã dùng. Nó không phải harness: harness điều phối agent, còn router không được quyết định quyền tool, quyền dữ liệu hay sandbox.

Nghiên cứu này kiểm tra mã nguồn tại các commit cố định ngày 2026-09-15. Mọi liên kết `blob` dưới đây ghim đúng commit; số lượng provider hoặc tuyên bố tiếp thị trong README không phải cam kết cho BoxFox.

## Đọc theo nhu cầu

- [So sánh](comparison.md): chọn mẫu thiết kế, không chọn sản phẩm để nhúng nguyên vẹn.
- [Đề xuất kiến trúc](architecture-proposal.md): đường đi chuẩn và biên an toàn của BoxFox.
- [9Router](9router.md): gateway local đa client, chuyển đổi định dạng và combo.
- [OmniRoute](omniroute.md): gateway nhiều client với policy và MITM là tính năng đặc quyền.
- [Claude Code Router](claude-code-router.md): mẫu chính cho gateway có kiểu dữ liệu, pool credential, trace và fallback.
- [LiteLLM](litellm.md): thư viện Python/proxy tùy chọn cho adapter nhà cung cấp và chiến lược routing.

## Thuật ngữ tối thiểu

| Thuật ngữ | Nghĩa trong tài liệu |
|---|---|
| **Client adapter** | Mã cấu hình hoặc tích hợp giúp Claude Code, Codex hay client khác gọi endpoint BoxFox thay vì endpoint gốc. Đây là opt-in, không mặc định chặn lưu lượng. |
| **Ingress / egress** | Ingress nhận HTTP từ client; egress gọi nhà cung cấp ở phía ngoài. |
| **Canonical request** | Biểu diễn nội bộ chung, độc lập với OpenAI Chat/Responses, Anthropic Messages hoặc Gemini. |
| **Protocol adapter** | Bộ chuyển request/stream/response giữa canonical form và giao thức của client hoặc provider. Chuyển đổi luôn có thể mất tính năng; phải báo capability. |
| **Alias** | Tên model ổn định do BoxFox đặt, ví dụ `coding-default`, tách client khỏi tên/deployment thật. |
| **Fallback** | Thử mục tiêu khác sau lỗi được phân loại là có thể thử lại. Không được chuyển sang đích chưa được policy, consent và capability cho phép. |
| **OAuth** | Uỷ quyền người dùng qua luồng đăng nhập; token truy cập/refresh token là bí mật. |
| **Credential handle** | Định danh mờ (opaque) tham chiếu secret trong vault/broker, không phải token thô truyền vào sandbox agent. |
| **SSE** | Server-Sent Events, luồng HTTP một chiều thường dùng để phát token/chunk. |
| **MITM** | Man-in-the-Middle: proxy giải mã/chuyển tiếp TLS nhờ chứng chỉ CA cài trên máy. Nó là quyền hệ thống cao, không phải cách kết nối mặc định. |

## Phạm vi và nguồn

| Dự án | Snapshot đã kiểm | Giấy phép | Vai trò tham khảo |
|---|---|---|---|
| 9Router | [`17c4cc76877bd1755030a8414f8d0083f48dcccf`](https://github.com/decolua/9router/tree/17c4cc76877bd1755030a8414f8d0083f48dcccf) | MIT | registry translator/executor, combo, OAuth local |
| OmniRoute | [`7cabac4985e8abcd7a34bad285698eebb924c46a`](https://github.com/diegosouzapw/OmniRoute/tree/7cabac4985e8abcd7a34bad285698eebb924c46a) | MIT | authz, route alias/combo, cảnh báo MITM |
| Claude Code Router (CCR) | [`cbe5f7bb3b3511ac31274559f2e9f387cab6fe40`](https://github.com/musistudio/claude-code-router/tree/cbe5f7bb3b3511ac31274559f2e9f387cab6fe40) | MIT | mẫu gateway/policy/pool/trace ưu tiên |
| LiteLLM | [`c8114ba41ff76365e3fb065dd3c7ca387598fd98`](https://github.com/BerriAI/litellm/tree/c8114ba41ff76365e3fb065dd3c7ca387598fd98) | MIT ngoài `enterprise/` | adapter/provider library hoặc dependency tùy chọn |

`code-reference/model-router/<project>/<commit>/` chứa snapshot bằng chứng đã tạo. Mọi file snapshot hiện có đều mang `reuse_class: reference-only`: chỉ đọc/đối chiếu, không import vào runtime, copy hay adapt trực tiếp. Nếu BoxFox sau này tự viết adapter hoặc đánh giá dependency, đó là công việc độc lập với snapshot và phải qua review giấy phép/bảo mật. Snapshot chỉ giữ file MIT cần thiết, `LICENSES/`, manifest và checksum; không giữ `.env`, database credential, cookie, API key, OAuth access/refresh token, hay `litellm/enterprise`.
