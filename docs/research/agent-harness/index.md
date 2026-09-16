# Nghiên cứu agent harness

**Agent harness (bộ chạy và điều phối agent)** là lớp quản lý vòng đời phiên, ngữ cảnh/prompt, lời gọi mô hình, tool, skill, quyền, agent con và kết quả. Chỉ mục này dẫn tới bằng chứng chi tiết; không lặp lại đặc tả kiến trúc BoxFox. Xem định nghĩa dùng chung trong [thuật ngữ](../terminology.md).

> **Trạng thái BoxFox:** các tài liệu ở đây là nghiên cứu và đề xuất. Chúng không khẳng định backend harness, sandbox hay policy được mô tả đã tồn tại trong BoxFox.

## Nguồn và mức bằng chứng

| Nhóm | Loại bằng chứng | Phiên bản / phạm vi | Điều được và không được kết luận |
|---|---|---|---|
| **Hermes Agent** | Mã nguồn mở MIT, commit ghim, snapshot có manifest/SHA-256 | [`69fd61b0efbe2bf7f412714ed8c35e40dfddc534`](https://github.com/NousResearch/hermes-agent/tree/69fd61b0efbe2bf7f412714ed8c35e40dfddc534) | Có thể nói về file đã đọc: loop, tool registry/executor, skills, delegation, context và provider. Không suy ra sandbox BoxFox hay copy cả runtime. |
| **OpenCode** | Mã nguồn mở MIT, commit ghim, snapshot có manifest/SHA-256 | [`e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298) | Có thể nói về session processor, prompt/instruction, tools, permission, compaction, skill và child session ở commit đó. Không coi tool filtering là security boundary hoặc suy ra sandbox hoàn chỉnh. |
| **Claude Code, Codex, Cursor, Devin, Vorflux** | **public-docs-only**, tài liệu chính thức được liên kết tại từng bản ghi | Không có mã nội bộ/snapshot | Chỉ mô tả hành vi và API/configuration công bố. Không suy đoán prompt, scheduler, model routing, credential store, sandbox, event store hoặc retention nội bộ. |

Snapshot là bằng chứng đọc-only trong [`code-reference/agent-harness/`](../../../code-reference/agent-harness/), không được import bởi runtime hoặc đưa vào skill discovery. Chạy verifier từ gốc repository:

```bash
python3 code-reference/scripts/verify_code_reference.py
```

## Bản đồ tài liệu

### Hermes Agent — nguồn tham khảo chính cho cấu trúc harness

| Chủ đề | Ghi chép chi tiết | Bằng chứng nổi bật | Giá trị cho BoxFox |
|---|---|---|---|
| Kiến trúc | [architecture](hermes-agent/architecture.md) | `run_agent.py`, conversation loop, tool/provider registry | Tách loop, registry và provider adapter; không import nguyên runtime. |
| Vòng lặp | [agent-loop](hermes-agent/agent-loop.md) | phase `turn_*`, executor tuần tự/có phân đoạn | State machine, retry/idempotency và event bền vững. |
| Prompt | [prompts](hermes-agent/prompts.md) | prompt builder, instruction/context handling | Compiler prompt có provenance và trust class. |
| Tool | [tools](hermes-agent/tools.md) | registry, schema, executor | Tách catalog/schema khỏi policy/executor/sandbox. |
| Skill | [skills](hermes-agent/skills.md) | discovery, guard/quarantine, `skills_list`/`skill_view` | Catalog trước, load sau; scan/trust không thay thế sandbox. |
| Subagent | [subagents](hermes-agent/subagents.md) | delegation, depth, concurrency, async recovery | Child session, lineage, budget, cancel và summary có bằng chứng. |
| Context / memory / session | [context-memory-sessions](hermes-agent/context-memory-sessions.md) | memory provider, compression, persistence | Event/checkpoint/provenance thay vì copy schema SQLite. |
| Provider / security | [providers-security](hermes-agent/providers-security.md) | profiles, fallback, credential-related boundary | Adapter độc lập; raw credential không vào agent sandbox. |

Hermes cũng đóng gói các hướng dẫn orchestration cho Claude Code, Codex, OpenCode và Claude Design. Chúng là **skill do Hermes phát hành**, không phải source/prompt nội bộ của các sản phẩm được nhắc tới; xem phần “Claude Code, Codex, OpenCode và Claude Design” trong [skills](hermes-agent/skills.md).

### OpenCode — nguồn đối chiếu cho session và permission

| Chủ đề | Ghi chép chi tiết | Bằng chứng nổi bật | Giá trị cho BoxFox |
|---|---|---|---|
| Kiến trúc | [architecture](opencode/architecture.md) | `SessionPrompt`, processor, run state, message/part | Phân tách service và child session; BoxFox phải tự có event store. |
| Prompt / tool | [prompts-tools](opencode/prompts-tools.md) | instruction scope, system/environment, registry, truncate | Prompt compiler có phân loại nguồn; tool output lớn là artifact có ACL. |
| Skill / subagent | [skills-subagents](opencode/skills-subagents.md) | skill catalog/load, `TaskTool`, depth/background/cancel | On-demand load; child quyền là giao, không dùng inheritance ngầm. |
| Permission / context | [permissions-context](opencode/permissions-context.md) | `allow`/`ask`/`deny`, approval, compaction/overflow | Cưỡng chế ở executor; summary giữ nhãn/provenance. |

### Nền tảng đóng — ghi chép public-docs-only

| Sản phẩm | Bản ghi | Hành vi công khai hữu ích | Giới hạn bắt buộc |
|---|---|---|---|
| Claude Code | [claude-code](closed-platforms/claude-code.md) | permission modes/rules, subagent controls, hooks/settings | Không có code/reference cho prompt, executor, sandbox hoặc state nội bộ. |
| OpenAI Codex | [codex](closed-platforms/codex.md) | tách sandbox và approval, instruction `AGENTS.md` theo scope | Không suy luận backend hoặc sandbox implementation. |
| Cursor | [cursor](closed-platforms/cursor.md) | rules, agent/cloud agent public surface, security guidance | Rules là context, không phải policy/sandbox; không có scheduler/VM evidence. |
| Devin | [devin](closed-platforms/devin.md) | session API, knowledge, security profiles, secrets configuration | Không suy diễn capability model, VM, credential hoặc event semantics. |
| Vorflux | [vorflux](closed-platforms/vorflux.md) | session/subsession, lifecycle và memory public surface | Không suy diễn isolation, credential, transcript schema hay router nội bộ. |

## Các ranh giới BoxFox cần giữ khi áp dụng

1. **Model đề nghị, server quyết định.** Tool catalog/prompt/UI chỉ hỗ trợ trải nghiệm; executor kiểm policy, capability, scope, epoch và expiry ngay trước hành động.
2. **Sandbox độc lập với approval.** Approval có audit không tạo filesystem/process/network isolation; sandbox không được giả định từ source tham chiếu.
3. **Child không mạnh hơn parent.** Quyền effective là giao của parent, profile child, grant task và sandbox capability; propagation summary giữ lineage/provenance.
4. **Content không tin cậy vẫn là data.** Workspace instructions, skills dự án, web/DOM, tool output và summary không tự thành trusted instruction.
5. **Credential ở broker.** Agent, transcript, prompt, log và sandbox chỉ nhận handle/kết quả được policy cho phép, không nhận token thô.
6. **Thiết kế product nằm ở tài liệu architecture.** Xem [kiến trúc harness đa agent](../../architecture/agent-harness.md), không gán các đề xuất đó cho Hermes/OpenCode hay nền tảng đóng.

Để đặt hai nguồn mở và các bề mặt công khai cạnh nhau trước khi chọn pattern, xem [so sánh harness](comparison.md).
