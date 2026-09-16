# BoxFox Agent Box — tóm tắt kế hoạch

> **Trạng thái:** kế hoạch sản phẩm, không phải xác nhận rằng backend security hoặc harness đã triển khai.
>
> Tài liệu chủ: [Kế hoạch sản phẩm đầy đủ](agent-box-plan.md). Chi tiết runtime không lặp lại ở đây: xem [kiến trúc harness](../architecture/agent-harness.md), [kiến trúc model router](../architecture/model-router.md) và [kiến trúc sandbox](../architecture/sandbox.md).

## Sản phẩm và ưu tiên

BoxFox là một **AI Computer tự host**: người dùng giao việc cho agent trong workspace/desktop sandbox, xem tiến độ và artifact, rồi duyệt các quyết định cần thiết. Sản phẩm hướng tới các tác vụ coding, research và workflow browser/desktop có thể kéo dài qua nhiều bước.

**Ưu tiên đã chọn là harness sản phẩm nhiều agent.** Harness là bộ chạy và điều phối agent: quản lý phiên, ngữ cảnh, prompt, tool, skill, ngân sách, trạng thái, event và kết quả. Agent con là child session thực sự, không chỉ là model call: có lineage (chuỗi cha-con), giới hạn depth, quyền, budget, deadline và cancellation riêng.

## Năm quyết định sản phẩm cần giữ

1. **Quyền nằm ngoài mô hình.** Model không tự cấp, mở rộng hay hồi sinh quyền. Tool bị ẩn khỏi prompt không phải cơ chế bảo mật; executor vẫn phải kiểm ở lúc chạy.
2. **Tách nguồn, quyền chỉ đạo và đích dữ liệu.** Đây là ba câu hỏi khác nhau; một nhãn “an toàn” không đủ.
3. **Quyền có phạm vi và thời hạn.** Lease (giấy phép có hạn) gắn với hành động/đích, scope, hạn, số lần dùng và trạng thái liên quan; resume không làm sống lại lease cũ.
4. **Giữ provenance.** Provenance là dấu vết nguồn gốc/biến đổi. Nhãn và nguồn gốc phải đi qua summary, checkpoint, resume, artifact và kết quả agent con.
5. **Đo cả an toàn lẫn khả năng dùng.** Báo riêng Attack Success Rate (ASR — tỷ lệ tấn công thành công), utility/khả năng hoàn thành việc và số lần hỏi người dùng.

Sandbox là ranh giới thực thi thật; lọc chuỗi lệnh, `realpath` hoặc một container đang chạy không tự chứng minh giới hạn filesystem. Credential (bí mật xác thực) không được vào agent sandbox: router dùng broker và opaque handle, hỗ trợ API key hoặc OAuth được người dùng ủy quyền. OAuth là cơ chế ủy quyền mà không cần đưa mật khẩu trực tiếp.

## Trạng thái hiện tại đã xác minh

| Khu vực | Trạng thái | Điều không được suy ra |
|---|---|---|
| Backend | Các package trong `backend/src/agentbox/` mới là khung rỗng, chưa có runtime harness/security gateway hoàn chỉnh. | Không nói IFC, lease, policy hoặc multi-agent backend đã thực thi. |
| Frontend | React/TypeScript, UI workspace, transport abstraction và cấu hình harness có mặt; luồng agent còn có mock. | UI/card/nhãn hiển thị không phải enforcement server-side. |
| Sandbox desktop | Docker desktop, editor, terminal, màn hình và API phụ trợ có mã chạy. | Không coi đó là chứng minh shell scope hẹp hoặc egress đã được policy kiểm soát toàn diện. |
| Plan approval/benchmark | Có quy ước UI/tệp và tài liệu benchmark. | Nhãn `approved` hay fixture hiện có không là bằng chứng permission/đánh giá đầu-cuối. |

## Bản đồ cấp cao

```text
UI người dùng
   │
   ▼
Harness nhiều agent ──► cổng chính sách/audit ──► tool executor/sandbox
   │
   └──────────────────► model router ──► credential broker/provider adapters
```

- Harness điều phối session/task/run/turn, Plan/Act, prompt/context, delegation, retry/cancel/resume và event store.
- Cổng chính sách xét nhãn, approval, lease, budget và egress; không dùng model để đoán hành động an toàn.
- Tool executor chạy trong ranh giới đã kiểm chứng và trả artifact có provenance.
- Router chuẩn hóa request, chọn model/provider/route, che dữ liệu nhạy cảm trong observability và không fallback sang đích policy cấm.

Kiến trúc chi tiết nằm ở tài liệu chuyên trách để plan không lặp một kiến trúc dài:

- [Harness nhiều agent](../architecture/agent-harness.md): vòng đời, prompt, tools, skills, context, child sessions, artifacts và event/API.
- [Model router](../architecture/model-router.md): canonical protocol, adapters, credential, aliases, routing/fallback và logging.
- [Nghiên cứu](../research/agent-harness/) và [nghiên cứu router](../research/model-router/): bằng chứng nguồn; `code-reference/` chứa snapshot có commit, checksum và license, không được import vào runtime.

## Lộ trình theo phụ thuộc

| Pha | Kết quả cần có |
|---|---|
| **0. Bằng chứng và quyết định** | Research/snapshot có provenance và license; phân biệt implemented, mock và planned. |
| **1. Hợp đồng tin cậy** | Schema phiên/quyền/artifact/event, state machine và test bằng model/tool giả. |
| **2. Spike shell + egress** | Đo ranh giới filesystem/process/network trước khi mở shell như capability bảo mật. |
| **3. Vertical slice một agent** | Plan/Act, cổng model/tool, artifact và UI event thật, với enforcement server-side. |
| **4. Nền nhiều agent** | Child sessions, delegation contract, quyền con, budget/cancellation tree và scheduler. |
| **5. Router sản phẩm** | Canonical request, model catalog, credential broker, adapters, route/fallback/rate limit. |
| **6. Context/skills/desktop** | Progressive skill có provenance, compaction an toàn, browser/vision và UX desktop đã chốt. |
| **7. Đánh giá + hardening** | Invariant tests, benchmark tái tạo được và báo cáo ASR/utility/prompts/cost/latency. |

Không gắn lịch/nhân lực cố định cho đến khi hoàn tất spike shell và chốt phạm vi đội/người dùng. Không mở rộng delegation trước khi vertical slice có event, approval và tool enforcement thật.

## Hai quyết định còn mở

### Shell

[ADR-0001 — ba lựa chọn cô lập shell](../architecture/decisions/0001-shell-isolation-options.md) là nguồn chi tiết. Nó giữ worker ngắn hạn với mount riêng (khuyến nghị spike trước), sandbox tiến trình trong desktop và shell toàn workspace (phải giảm claim scope). Chưa lựa chọn nào đã triển khai; ADR nêu test sibling write, symlink race, host sentinel, secret không mount, process con và egress.

### Điều khiển desktop đồng thời

[ADR-0002 — điều khiển desktop đồng thời](../architecture/decisions/0002-concurrent-desktop-control.md) giữ quyết định hoãn và ba hướng xử lý stale action. Khuyến nghị bản đầu là user takeover tạm dừng agent; không bật side-effect computer use trước khi executor có test race.

## Giới hạn phải nói rõ

- Plan/skill/workspace do agent viết không phải chính sách được tin.
- Một approval chỉ có ý nghĩa khi gắn proposal ID, content hash, scope digest, epoch, actor, thời hạn và được server kiểm lại.
- User là người thực hiện lệnh không tự làm output terminal hoặc tài liệu đã đọc thành chỉ thị tin cậy.
- Tắt mạng desktop không có nghĩa mọi dữ liệu đều không rời máy nếu host vẫn gọi model/provider.
- MITM (Man-in-the-Middle — proxy/chứng chỉ trung gian chặn lưu lượng) và integration subscription/endpoint không chính thức không thuộc MVP mặc định.

Xem [bảng chuyển đầy đủ Phần 0–XVI](agent-box-plan.md#10-bảng-chuyển-từ-kế-hoạch-cũ-phần-0xvi) để tra nơi chứa nội dung của kế hoạch 2.844 dòng trước đây. Phần IX đã chuyển sang [mô hình bảo mật](../architecture/security-model.md); Phần XIII đã chuyển sang [kế hoạch đánh giá](agent-box-evaluation.md). Chỉ Phần XII (UI) còn chưa hoàn tất: bảo toàn chi tiết bằng `git show main:docs/plan/agent-box-plan.md` và trích xuất mục 12.1–12.7 sang frontend/spec chuyên trách.
