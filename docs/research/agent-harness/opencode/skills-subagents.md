# OpenCode: skills và subagent

## Phạm vi và thuật ngữ

**Skill** là gói chỉ dẫn tái sử dụng, thường có `SKILL.md`, mô tả ngắn và nội dung chỉ nạp khi agent yêu cầu. **Subagent** là agent con xử lý một phần việc trong child session. **Lineage** là chuỗi parent/child giúp truy ngược nguồn gốc uỷ quyền.

Nguồn kiểm chứng: OpenCode commit [`e03db9bc6908f75c9334d8aa997deeaac81c0298`](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298), giấy phép MIT. Tài liệu công khai: [Skills](https://opencode.ai/docs/skills), [Agents](https://opencode.ai/docs/agents), [Permissions](https://opencode.ai/docs/permissions).

## Skill: khám phá, catalog trước, nội dung sau

`Skill` quét `SKILL.md` trong config OpenCode, `.claude`, `.agents`, đường dẫn cấu hình và URL catalog. Nó parse YAML frontmatter, phát lỗi khi parse hỏng, cảnh báo skill trùng tên, và giữ metadata `name`, `description`, `location`, `content`. Built-in `customize-opencode` được đăng ký trước, sau đó skill trên đĩa cùng tên có thể override.

Theo [Skills](https://opencode.ai/docs/skills), OpenCode hỗ trợ nguồn project/global OpenCode, Claude-compatible và agent-compatible. Agent được thấy tên/mô tả/location của skill trong catalog; `skill` tool mới trả toàn bộ nội dung, thư mục gốc và danh sách file mẫu. `SkillTool` gọi `ctx.ask` cho quyền `skill` trước khi trả content. Tải từ URL dùng `index.json`, cache nội bộ và cơ chế staging/rename khi đổi version.

```text
scan nguồn local / remote catalog
  → parse & validate frontmatter → catalog có provenance location
  → lọc catalog theo permission của agent
  → system prompt chỉ đưa catalog
  → agent gọi skill(name) → permission check → nạp nội dung
```

| Kết luận kiểm chứng | Nguồn ghim commit | Snapshot đã lưu giữ | Phân loại |
| --- | --- | --- | --- |
| Discovery local, external-compatible, config URL | [`skill/index.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/skill/index.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/skill/index.ts` | `reference-only` |
| Remote index/download/cache/staging | [`skill/discovery.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/skill/discovery.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/skill/discovery.ts` | `reference-only` |
| On-demand load và hỏi quyền | [`tool/skill.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/skill.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/tool/skill.ts` | `reference-only` |
| Catalog được đưa vào system prompt | [`session/system.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/system.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/system.ts` | `reference-only` |

### Diễn giải an toàn cho BoxFox

Skill từ repository, home directory hoặc URL là **input không tin cậy** cho đến khi pipeline trust xác nhận. Tải dần là pattern tốt để giảm context, nhưng không thay thế review/quarantine. BoxFox nên catalog trước với `skillId`, publisher, version/commit, SHA-256, license, trust state và capability yêu cầu; chỉ nạp nội dung sau khi policy cho phép. Không đưa snapshot `code-reference/` vào đường discovery của runtime.

## Subagent là child session

`TaskTool` nhận `description`, `prompt`, `subagent_type`, tùy chọn `task_id` để resume và cờ `background`. Khi chạy, nó:

1. Đếm chuỗi `parentID` và từ chối khi vượt `subagent_depth` (mặc định 1 nếu không cấu hình).
2. Hỏi quyền `task` cho loại subagent, trừ đường gọi nội bộ đã đánh dấu `bypassAgentCheck`.
3. Tra agent con, tạo hoặc lấy lại child session có `parentID`.
4. Chọn model của subagent hoặc kế thừa model/provider từ assistant message cha.
5. Gọi `SessionPrompt.prompt` trong child session, rồi trả output được bọc trong thẻ có `task id`.
6. Khi background được bật qua experimental flag, dùng `BackgroundJob`, gửi kết quả synthetic về parent; cancel parent cũng hủy job/subsession liên quan.

Tài liệu [Agents](https://opencode.ai/docs/agents) xác nhận UI có child session và điều hướng parent/child. Cờ background trong mã nguồn là experimental tại snapshot này; không nên coi là tính năng mặc định ổn định.

| Kết luận kiểm chứng | Nguồn ghim commit | Snapshot đã lưu giữ | Phân loại |
| --- | --- | --- | --- |
| Tạo/resume child session, depth, foreground/background, cancel | [`tool/task.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/task.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/tool/task.ts` | `reference-only` |
| Quy tắc quyền khi spawn | [`agent/subagent-permissions.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/agent/subagent-permissions.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/agent/subagent-permissions.ts` | `reference-only` |
| Điều phối subtask từ prompt | [`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/prompt.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/prompt.ts` | `reference-only` |
| Cancel runner và background job có liên quan | [`session/run-state.ts`](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/run-state.ts) | `code-reference/agent-harness/opencode/e03db9bc6908f75c9334d8aa997deeaac81c0298/upstream/packages/opencode/src/session/run-state.ts` | `reference-only` |

### Giới hạn quan trọng của pattern hiện có

`deriveSubagentSessionPermission()` giữ deny và `external_directory` từ session cha, nhưng comment mã nguồn nói quyền của agent cha không tự quản trị capability của child; capability còn do quyền subagent quyết định. Vì vậy đây **không** là bằng chứng cho bất biến “child không thể mạnh hơn parent”.

BoxFox phải áp dụng bất biến nghiêm hơn tại policy service: quyền hiệu lực của child là **giao** của quyền parent, profile của child, grant task và sandbox capability, không phải hợp quyền. Cần lưu `parentSessionId`, `taskId`, depth, token/chi phí, deadline, lý do huỷ và provenance của kết quả. Child không được tự tăng quyền, ủy quyền vượt depth hoặc nhận raw credential của parent.

## Mẫu áp dụng cho BoxFox

- Dùng child session, không chỉ nhét một đoạn prompt vào parent; đây là cơ sở cho audit, cancel và resume.
- Phân biệt delegation request, grant policy và execution record.
- Dùng background chỉ với file/resource lease để tránh hai agent sửa cùng scope.
- Đưa summary có provenance từ child về parent thay vì chép toàn bộ transcript mặc định.
- Tôn trọng MIT khi có bản sao thực sự; nếu chỉ lấy pattern, ghi `reference-only` trong manifest.
