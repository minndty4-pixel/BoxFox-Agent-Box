# Thuật ngữ và chữ viết tắt

Tài liệu này chuẩn hóa cách dùng từ cho các ghi chép [agent harness](agent-harness/index.md), [model router](model-router/index.md) và các đề xuất kiến trúc BoxFox. Khi một tài liệu dùng thuật ngữ theo nghĩa hẹp hoặc khác nghĩa dưới đây, tài liệu đó phải nói rõ phạm vi.

## Agent và vòng đời

| Thuật ngữ | Định nghĩa dùng trong nghiên cứu |
|---|---|
| **Agent (tác tử)** | Thành phần dùng mô hình để lập luận và đề nghị hành động. Phản hồi của model không phải quyết định bảo mật. |
| **Harness (bộ chạy và điều phối agent)** | Runtime ghép ngữ cảnh/prompt, gọi model, điều phối tool, session, ngân sách, kết quả và khôi phục. |
| **Session (phiên)** | Đơn vị hội thoại/công việc bền vững có định danh, owner và lịch sử; có thể là parent hoặc child. |
| **Task (việc)** | Mục tiêu cụ thể trong một session. BoxFox đề xuất tách task khỏi session để quản lý mục tiêu, epoch và quyền đúng thời điểm. |
| **Run (lần chạy)** | Một lần thực thi có thể resume của task, gắn route mô hình, ngân sách và trạng thái. |
| **Turn (lượt)** | Một chu kỳ input → gọi model → phản hồi/tool result hoặc dừng. Một turn có thể có nhiều message part. |
| **Subagent / child agent (agent con)** | Agent chuyên trách được parent giao một phạm vi hẹp, thường trong child session. |
| **Delegation (uỷ nhiệm)** | Việc parent tạo/giao task cho child. Nó không được tự cấp thêm quyền. |
| **Lineage (dòng cha–con)** | Liên kết truy vết parent session/run/task đến child và kết quả của child. |
| **Budget (ngân sách)** | Giới hạn có kiểm soát cho thời gian, token, chi phí, số child hoặc concurrency. |
| **Artifact (hiện vật)** | Đối tượng có ID bất biến như file, diff, ảnh, output tool, plan hoặc summary; có owner, quyền, hash và nguồn gốc. |
| **Event store (kho sự kiện)** | Nhật ký chỉ thêm, có thứ tự, là nguồn sự thật cho trạng thái. WebSocket/SSE chỉ vận chuyển sự kiện, không thay thế event store. |
| **Checkpoint** | Điểm khôi phục bền vững của run/session, chứa tham chiếu state và bằng chứng cần để resume an toàn. |
| **Resume / reconnect** | Khôi phục chạy sau ngắt quãng / nối lại client để nhận phần sự kiện còn thiếu. Không được dùng summary tự do làm nguồn sự thật duy nhất. |

## Ngữ cảnh, prompt và knowledge

| Thuật ngữ | Định nghĩa dùng trong nghiên cứu |
|---|---|
| **Context (ngữ cảnh)** | Tập prompt part, message, tool result, file/tài liệu và metadata được gửi cho model ở một request. |
| **Prompt composition (ghép prompt)** | Quy trình có cấu trúc kết hợp instruction, environment, history, catalog và schema tool, thay vì nối chuỗi tùy ý. |
| **System prompt** | Chỉ dẫn do harness kiểm soát. Nội dung từ workspace, web, skill hoặc tool output không tự trở thành system instruction. |
| **Instruction (chỉ dẫn)** | Hướng dẫn người dùng/dự án, ví dụ `AGENTS.md`, `CLAUDE.md` hoặc rules. Đây là input phải có provenance/trust, không phải policy thực thi. |
| **Skill (kỹ năng)** | Gói metadata và hướng dẫn tái sử dụng, thường có `SKILL.md`. Skill giúp model biết cách dùng năng lực nhưng không tự trao capability hay chạy mã. |
| **Catalog-first / progressive disclosure (catalog trước, nạp dần)** | Đưa metadata ngắn vào prompt trước; chỉ nạp toàn văn skill/tài liệu khi cần, sau kiểm tra policy. |
| **Memory (bộ nhớ)** | Ghi chú bền hơn một lượt. Mỗi record cần owner, scope, expiry, ACL và provenance; shared memory không là shared authority. |
| **Compaction (nén ngữ cảnh)** | Thay phần history dài bằng summary/retained window để vừa context window. Trong BoxFox, summary phải giữ source event range, nhãn và provenance. |
| **Context window (cửa sổ ngữ cảnh)** | Ngân sách input/output tối đa mà model hoặc provider chấp nhận. |
| **Provenance (nguồn gốc/dòng dẫn xuất)** | URL/path, commit/version, hash, actor, thời gian và quan hệ `derived_from` để truy vết nguồn của instruction/artifact/summary. |
| **Trust (độ tin cậy)** | Kết quả phân loại nguồn nội dung; không đồng nghĩa với quyền thực thi. Input chưa tin cậy phải không thể tự đổi policy. |
| **Quarantine (cô lập chờ xét)** | Trạng thái giữ skill/instruction chưa được tin cậy ngoài đường nạp bình thường cho tới khi scan/review/policy chấp nhận. |

## Tool, policy và isolation

| Thuật ngữ | Định nghĩa dùng trong nghiên cứu |
|---|---|
| **Tool (công cụ)** | Hành động có schema input/output do executor thực thi, như đọc file, shell, browser hoặc gọi dịch vụ. Khác với skill. |
| **Tool registry (sổ đăng ký tool)** | Catalog khai báo tên, schema, mô tả, executor và metadata capability của tool. |
| **Tool call** | Đề nghị có cấu trúc từ model để gọi tool. Nó chỉ được chạy sau policy decision và kiểm tra lại ở executor. |
| **Executor (bộ thực thi)** | Thành phần gọi tool thật; là policy enforcement point (điểm cưỡng chế chính sách), không tin chỉ vào UI/prompt. |
| **Capability (khả năng có cấp quyền)** | Quyền kỹ thuật có scope để thực hiện một thao tác. Một mô tả tool trong prompt không phải capability. |
| **Permission / policy (quyền / chính sách)** | Quy tắc server-side quyết định `allow`, `ask` hoặc `deny` theo actor, hành động, scope, nhãn, epoch và hạn dùng. |
| **Approval (phê duyệt)** | Chấp thuận có audit cho proposal cụ thể. Nó phải gắn scope/content hash/expiry và có thể thu hồi; không phải cờ UI chung chung. |
| **Grant** | Bản ghi capability được cấp với principal, scope, epoch và expiry rõ ràng. |
| **Sandbox** | Ranh giới thực thi kỹ thuật cho filesystem, process, network và credential. Approval và tool filtering không tự tạo sandbox. |
| **IFC (Information-Flow Control — kiểm soát luồng thông tin)** | Kiểm soát dữ liệu từ nguồn sang đích theo nhãn; summary, checkpoint và child result không được rửa nhãn. |
| **ACL (Access Control List — danh sách kiểm soát truy cập)** | Danh sách/quy tắc xác định ai được đọc, ghi hoặc quản trị một tài nguyên. |
| **Raw credential (thông tin xác thực thô)** | API key, OAuth token, cookie hoặc secret có thể dùng trực tiếp. Nó không được vào prompt, transcript, log hoặc sandbox agent. |
| **Opaque handle (handle mờ)** | Định danh tham chiếu credential do broker giải quyết; agent không thể dùng nó để đọc token thô. |

## Model router và giao thức

| Thuật ngữ | Định nghĩa dùng trong nghiên cứu |
|---|---|
| **Model router (bộ định tuyến mô hình)** | Lớp nhận request, chuẩn hóa giao thức, chọn model/provider/credential và trả stream/tool call đã chuẩn hóa. |
| **Provider (nhà cung cấp mô hình)** | Dịch vụ hoặc adapter cung cấp model/API. |
| **Model alias (bí danh model)** | Tên ổn định ở phía client được routing policy ánh xạ tới model/provider đủ điều kiện. |
| **Ingress** | Điểm nhận request từ client/giao thức cụ thể trước khi chuẩn hóa. |
| **Canonical request** | Biểu diễn request nội bộ chung sau khi adapter chuyển đổi giao thức. |
| **Adapter** | Lớp chuyển đổi giữa protocol/provider/client cụ thể và hợp đồng chung. Adapter không được nâng quyền. |
| **Fallback** | Chuyển route có kiểm soát sau lỗi/giới hạn. Chỉ dùng khi tương thích model/tool, policy, chi phí và data boundary còn hợp lệ. |
| **Credential broker** | Dịch vụ giữ/giải quyết credential hoặc handle theo policy; tách token thô khỏi harness và sandbox. |
| **Rate limit (giới hạn tốc độ)** | Giới hạn số request/token/chi phí theo thời gian để bảo vệ provider, tenant hoặc budget. |
| **Streaming** | Provider trả kết quả từng phần. Router phải chuẩn hóa trạng thái, cancel, usage và lỗi mà không làm mất semantics tool call. |
| **MITM (Man-in-the-Middle)** | Proxy chặn/chuyển tiếp lưu lượng, thường cần chứng chỉ hoặc quyền đặc biệt. Đây là lựa chọn nghiên cứu đặc quyền cao, không phải mặc định. |

## Viết tắt thường gặp

| Viết tắt | Nghĩa |
|---|---|
| **API** | Application Programming Interface — giao diện để chương trình trao đổi dữ liệu/yêu cầu. |
| **ACL** | Access Control List — danh sách kiểm soát truy cập. |
| **ACP** | Agent Client Protocol — giao thức giữa agent và client (tên/phạm vi tùy dự án). |
| **CLI** | Command-Line Interface — giao diện dòng lệnh. |
| **DOM** | Document Object Model — biểu diễn cấu trúc trang/tài liệu. |
| **IFC** | Information-Flow Control — kiểm soát luồng thông tin theo nhãn. |
| **LLM** | Large Language Model — mô hình ngôn ngữ lớn. |
| **LSP** | Language Server Protocol — giao thức dịch vụ ngôn ngữ cho editor/tool. |
| **MCP** | Model Context Protocol — giao thức kết nối agent với tool/tài nguyên từ server ngoài. |
| **MITM** | Man-in-the-Middle — chặn/chuyển tiếp lưu lượng qua thực thể trung gian. |
| **OAuth** | Open Authorization — cơ chế uỷ quyền thường dùng để cấp token truy cập có scope. |
| **SSE** | Server-Sent Events — kênh server phát sự kiện một chiều tới client. |
| **UI** | User Interface — giao diện người dùng. |
| **URL** | Uniform Resource Locator — địa chỉ tài nguyên trên mạng. |
| **WebSocket** | Giao thức kết nối hai chiều liên tục giữa client và server. |
