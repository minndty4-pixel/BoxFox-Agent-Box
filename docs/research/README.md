# Nghiên cứu kỹ thuật BoxFox

Đây là chỉ mục và sổ bằng chứng cho các kết luận kỹ thuật dùng khi thiết kế BoxFox. Nó không phải mã runtime, không phải cam kết rằng BoxFox đã triển khai các chức năng mô tả, và không thay thế [mô hình bảo mật/IFC](../architecture/security-model.md), [kiến trúc harness](../architecture/agent-harness.md), [kiến trúc router](../architecture/model-router.md) hay [sandbox](../architecture/sandbox.md).

Đi từ [chỉ mục tài liệu dự án](../README.md) nếu chưa biết cần đọc nhánh nào. Sau khi đọc một kết luận ở đây, đi theo liên kết **đến thiết kế BoxFox** ở cuối nhánh tương ứng; không coi một pattern upstream là quyết định sản phẩm tự động.

## 1. Cách đọc và mức bằng chứng

| Nhãn | Ý nghĩa | Được phép kết luận |
|---|---|---|
| **Mã nguồn mở đã kiểm tra** | File upstream tại commit đã ghim được liên kết; phần file được giữ lại có snapshot, manifest và checksum. | Chỉ kết luận điều đọc được từ file/tài liệu được trích. Phạm vi snapshot có thể là curated (chọn lọc), nên xem manifest trước khi giả định một file được lưu cục bộ. |
| **public-docs-only** | Chỉ dùng tài liệu chính thức công khai của sản phẩm đóng hoặc dịch vụ hosted. | Chỉ mô tả hành vi/bề mặt công bố; không suy đoán prompt, scheduler, credential store, sandbox hay implementation nội bộ. |
| **Đề xuất BoxFox** | Diễn giải hoặc hướng thiết kế cho BoxFox. | Không phải hành vi hiện có của dự án tham chiếu hay của runtime BoxFox. |
| **Bối cảnh/giả thuyết lịch sử** | Ghi chép đầu vào, số liệu hoặc định hướng của một giai đoạn nghiên cứu trước. | Phải đối chiếu nguồn gốc, ngày kiểm tra và trạng thái runtime trước khi dùng làm quyết định hay số liệu hiện tại. |

Các URL GitHub dạng `blob/<commit>` ghim đúng phiên bản nguồn. [Snapshot mã nguồn tham chiếu](../../code-reference/README.md) chỉ để kiểm chứng; nó không là dependency, không được runtime import và không nằm trên đường khám phá skill.

```bash
python3 code-reference/scripts/verify_code_reference.py
```

> Không đưa `.env`, API key, OAuth token, cookie, credential database, dependency cài sẵn hay output sinh tự động vào snapshot. Manifest của từng dự án xác định đường dẫn, SHA-256, giấy phép, URL upstream và trạng thái reuse. Hiện snapshot là `reference-only` trừ khi manifest nói rõ khác.

## 2. Điều hướng theo câu hỏi

| Câu hỏi | Đọc | Sau đó nối tới |
|---|---|---|
| Harness quản lý prompt, tool, skill, phiên và agent con thế nào? | [Chỉ mục agent harness](agent-harness/index.md) | [Kiến trúc harness đa agent](../architecture/agent-harness.md) |
| Các sản phẩm đóng công bố gì mà không suy đoán nội bộ? | [Nền tảng public-docs-only](agent-harness/index.md#nền-tảng-đóng--public-docs-only) | [So sánh harness](agent-harness/comparison.md) |
| Router nhận nhiều giao thức, chọn model và giữ credential ở đâu? | [Chỉ mục model router](model-router/index.md) | [Kiến trúc model router](../architecture/model-router.md) |
| Pattern nguồn nào phù hợp hoặc không phù hợp với BoxFox? | [So sánh harness](agent-harness/comparison.md) và [so sánh router](model-router/comparison.md) | Kế hoạch và ADR được liên kết trong từng tài liệu |
| IFC, nhãn, approval, lease và các giới hạn claim được đánh giá ra sao? | [Mô hình bảo mật](../architecture/security-model.md) và [đánh giá Agent Box](../plan/agent-box-evaluation.md) | [Kế hoạch sản phẩm](../plan/agent-box-plan.md) |
| Nền tảng Agent Box/GUI có ý nghĩa thị trường hay benchmark gì? | [Research brief](research-brief.md) và [phụ lục computer use](research-addendum-computeruse.md) | Kế hoạch sản phẩm; xác minh lại số liệu trước khi sử dụng |
| Tính năng Element Selector nên học gì từ sản phẩm khác? | [Nghiên cứu cạnh tranh Element Selector](element-selector-competitive-research.md) | [Kế hoạch v1](../plan/element-selector-plan-v1.md), [kiến trúc Element Selector](../architecture/element-selector.md) |

## 3. Thuật ngữ dùng chung

- [Thuật ngữ và chữ viết tắt](terminology.md) — định nghĩa Việt–Anh dùng xuyên suốt ghi chép harness/router.
- Thuật ngữ về chính sách dữ liệu và quyền lấy [mô hình bảo mật](../architecture/security-model.md) làm nguồn chuẩn; glossary chỉ hỗ trợ đọc nghiên cứu, không thay thế đặc tả.

## 4. Agent harness — bộ chạy và điều phối agent

Bắt đầu ở [chỉ mục harness](agent-harness/index.md) để biết ranh giới bằng chứng, cấu trúc tài liệu và cách đọc. [So sánh/áp dụng](agent-harness/comparison.md) tách rõ điều được xác minh từ mã nguồn, hành vi public-docs-only và đề xuất BoxFox.

### 4.1 Hermes Agent — mã nguồn mở MIT

Commit đã ghim: `69fd61b0efbe2bf7f412714ed8c35e40dfddc534`.

- [Kiến trúc](agent-harness/hermes-agent/architecture.md), [vòng lặp agent](agent-harness/hermes-agent/agent-loop.md), [prompt](agent-harness/hermes-agent/prompts.md), [tools](agent-harness/hermes-agent/tools.md).
- [Skills](agent-harness/hermes-agent/skills.md), [subagents](agent-harness/hermes-agent/subagents.md), [context/memory/session](agent-harness/hermes-agent/context-memory-sessions.md), [provider và security](agent-harness/hermes-agent/providers-security.md).

### 4.2 OpenCode — mã nguồn mở MIT

Commit đã ghim: `e03db9bc6908f75c9334d8aa997deeaac81c0298`.

- [Kiến trúc](agent-harness/opencode/architecture.md), [prompt và tools](agent-harness/opencode/prompts-tools.md), [skills và subagents](agent-harness/opencode/skills-subagents.md), [permission và context](agent-harness/opencode/permissions-context.md).

### 4.3 Nền tảng đóng — public-docs-only

- [Claude Code](agent-harness/closed-platforms/claude-code.md), [OpenAI Codex](agent-harness/closed-platforms/codex.md), [Cursor](agent-harness/closed-platforms/cursor.md), [Devin](agent-harness/closed-platforms/devin.md), [Vorflux](agent-harness/closed-platforms/vorflux.md).

### 4.4 Từ bằng chứng đến BoxFox

- [Kiến trúc harness đa agent](../architecture/agent-harness.md) — proposal cho vòng đời session/task/run/turn, prompt, tool, skill, child session, artifact và event store.
- [Mô hình bảo mật](../architecture/security-model.md) — policy, nhãn, approval/lease và kiểm tra tại thời điểm thực thi mà harness phải gọi.
- [ADR-0001: shell isolation](../architecture/decisions/0001-shell-isolation-options.md) và [ADR-0002: desktop control đồng thời](../architecture/decisions/0002-concurrent-desktop-control.md) — các lựa chọn thực thi vẫn mở.
- [Kế hoạch sản phẩm](../plan/agent-box-plan.md) và [đánh giá](../plan/agent-box-evaluation.md) — thứ tự triển khai, tiêu chí thành công và benchmark.

## 5. Model router — bộ định tuyến mô hình

Bắt đầu ở [chỉ mục router](model-router/index.md); [bảng so sánh](model-router/comparison.md) và [đề xuất kiến trúc](model-router/architecture-proposal.md) tách evidence upstream khỏi thiết kế BoxFox.

- [9Router](model-router/9router.md), [OmniRoute](model-router/omniroute.md), [Claude Code Router](model-router/claude-code-router.md), [LiteLLM](model-router/litellm.md) — ghi chép từng dự án, giao thức, routing/fallback và boundary credential.
- [Kiến trúc Model Router BoxFox](../architecture/model-router.md) — protocol chuẩn, alias/policy, credential broker bằng opaque handle, fallback giới hạn và audit che dữ liệu nhạy cảm.
- [Mô hình bảo mật](../architecture/security-model.md) — quyền egress và policy cần được quyết ngoài router/harness; raw credential không được đi vào sandbox.
- [Đánh giá Agent Box](../plan/agent-box-evaluation.md) — egress quan sát được là một phần của đánh giá, không suy ra chỉ từ log router.

## 6. Bối cảnh sản phẩm và các nghiên cứu có trước

Các tài liệu này vẫn được chỉ mục để tránh mất nguồn gốc, nhưng không cùng mức evidence với snapshot mới nếu chúng không có commit/manifest kèm theo:

- [Research brief](research-brief.md) — input cho việc hình thành kế hoạch Agent Box, người dùng mục tiêu, định vị và giả thuyết ban đầu.
- [Phụ lục computer use / GUI agent](research-addendum-computeruse.md) — benchmark, prompt injection qua màn hình và nền sandbox/GUI tham chiếu; kiểm tra lại thời điểm và nguồn trước khi trích số liệu.
- [Nghiên cứu cạnh tranh Element Selector](element-selector-competitive-research.md) — quan sát thiết kế cho nhánh DOM Inspector; đi tiếp đến [kế hoạch v1](../plan/element-selector-plan-v1.md).

## 7. Nguyên tắc dùng kết quả nghiên cứu

1. **Nguồn không phải sản phẩm.** Chỉ chuyển một pattern thành BoxFox sau khi xác định owner, API boundary, threat model, test và chính sách quyền.
2. **Prompt không phải enforcement.** Ẩn tool, rule dự án, skill hay system prompt chỉ ảnh hưởng ngữ cảnh model; executor, policy và sandbox phải kiểm lại mỗi hành động.
3. **Quyền không tăng theo delegation.** Quyền hiệu lực của child session là giao của parent, profile child, grant task và capability sandbox hiện thời.
4. **Không truyền raw credential cho agent.** Router/credential broker dùng handle mờ; transcript, prompt, log và sandbox không giữ token thô.
5. **Nén không được rửa nguồn gốc.** Summary, checkpoint, artifact và kết quả agent con phải duy trì nhãn, provenance và liên kết nguồn.
6. **Giấy phép đi cùng file.** Chỉ copy/chuyển thể khi manifest của đúng file cho phép, giữ attribution và qua review pháp lý/bảo mật; mặc định là `reference-only`.
7. **Không tạo tài liệu mồ côi.** Nghiên cứu mới phải được thêm vào chỉ mục này, liên kết đến snapshot hoặc nguồn public-docs-only và chỉ rõ tài liệu thiết kế BoxFox nhận kết luận đó.
