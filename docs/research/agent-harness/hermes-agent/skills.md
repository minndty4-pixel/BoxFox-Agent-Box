# Skills (gói chỉ dẫn/chuyên môn)

> **Bằng chứng và tái sử dụng:** quy ước chung ở [README nghiên cứu dùng chung](../../README.md#1-cách-đọc-và-mức-bằng-chứng); kiểm tra file giữ lại, hash và `reuse_class` tại [manifest Hermes](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/manifest.json). Mọi file hiện là `reference-only`; MIT chỉ có thể được xem xét ở review riêng, không phê duyệt copy hiện tại.

## Thuật ngữ và cấu trúc

Trong Hermes, một **skill** là thư mục có `SKILL.md` (YAML frontmatter: tên, mô tả, tác giả, license, nền tảng) và có thể có `references/`, `templates/`, `assets/`, `scripts/`. **Progressive disclosure (công bố dần)** nghĩa là model nhận catalog ngắn trước, chỉ đọc toàn văn skill hay file hỗ trợ khi cần; tránh làm phình system prompt.

Các bundled skill ở `skills/<category>/<name>/SKILL.md`; optional skill ở `optional-skills/...`. Vì optional không đồng nghĩa trusted, nguồn và scan vẫn phải được xem xét.

## Discovery, trust và load — đã xác minh

[`agent/skill_utils.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_utils.py) tập hợp thư mục skill, lọc platform/environment, bỏ các thư mục nguy hiểm/không liên quan và xử lý project trust/quarantine. Thứ tự được nghiên cứu gồm project-local đã trust (`.hermes/skills`, `.agents/skills`), profile-local `~/.hermes/skills`, `skills.create_dir` rồi external directory. Mã [`tools/skills_guard.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skills_guard.py) tham gia scan/quarantine project skill; vì vậy không phải skill nằm trong repo nào cũng tự động có mặt trong prompt.

[`agent/prompt_builder.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/prompt_builder.py) dựng catalog `<available_skills>` và cache index (LRU trong process và snapshot disk). [`tools/skills_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skills_tool.py) định nghĩa `skills_list` (metadata) và `skill_view` (toàn văn cùng support file liên kết). Nó chặn absolute path, Windows drive path, path traversal; các thư mục hỗ trợ không bị quét như skill độc lập. [`agent/skill_preprocessing.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_preprocessing.py) xử lý placeholder như biến thư mục skill/session theo cấu hình.

```text
scan thư mục đủ tin cậy → parse metadata → catalog ngắn trong prompt
  → model chọn skill → skills_list / skill_view → nạp SKILL.md cần thiết
  → mở references/templates/scripts một cách explicit
```

[`agent/skill_commands.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_commands.py) xử lý gọi và reload skill. Khi compact, [`agent/context_compressor.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/context_compressor.py) có thể thay nội dung lớn bằng marker `[SKILL_PRUNED: …]`; [`agent/conversation_compression.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/conversation_compression.py) bổ sung thông báo reload. Do đó “đã load” không nên được giả định mãi mãi.

## Tạo và bảo trì

[`tools/skill_manager_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skill_manager_tool.py), `skill_manager_batch.py`, `skill_manager_guards.py`, [`tools/skill_linter.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skill_linter.py), [`tools/skill_provenance.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skill_provenance.py) và curator/backup cung cấp tạo, vá, lint, provenance, backup/rollback. Theo code và hướng dẫn authoring, skill mới hợp lệ cần name, description, body/frontmatter hợp lệ; in-repo skill cần workflow file/git thay vì ghi tuỳ tiện qua tool manager.

## Claude Code, Codex, OpenCode và Claude Design

Bốn file dưới đây là **hướng dẫn orchestration do Hermes đóng gói**, không phải source code nội bộ hay prompt hệ thống của Anthropic/OpenAI/OpenCode/Claude Design:

| Skill Hermes đã kiểm tra | Nội dung đã xác minh | Provenance/license/reuse |
|---|---|---|
| [`claude-code/SKILL.md`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/skills/autonomous-ai-agents/claude-code/SKILL.md) | Hướng dẫn gọi Claude Code CLI qua terminal, print mode và PTY. | frontmatter: Hermes Agent + Teknium, MIT. Snapshot hiện là `reference-only`; mọi tái sử dụng cần review riêng. Không nói là source Claude Code. |
| [`codex/SKILL.md`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/skills/autonomous-ai-agents/codex/SKILL.md) | Hướng dẫn Codex CLI, sandbox, background process. | Hermes Agent, MIT; snapshot hiện là `reference-only`, cần review riêng trước mọi tái sử dụng. |
| [`opencode/SKILL.md`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/skills/autonomous-ai-agents/opencode/SKILL.md) | Hướng dẫn delegate tới OpenCode CLI. | Hermes Agent, MIT; snapshot hiện là `reference-only`, cần review riêng trước mọi tái sử dụng. |
| [`claude-design/SKILL.md`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/skills/creative/claude-design/SKILL.md) | Workflow tạo HTML artifact/prototype cục bộ, lấy cảm hứng từ trải nghiệm design. | BadTechBandit, MIT ở frontmatter; snapshot hiện là `reference-only`, cần review riêng; không tuyên bố là Claude source. |

Hermes còn có [`design-md/SKILL.md`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/skills/creative/design-md/SKILL.md), ghi tham chiếu Google `DESIGN.md`. Phần upstream bên ngoài không được Hermes pin commit trong skill; do đó BoxFox chỉ nên reference-only cho nội dung bên ngoài cho tới khi kiểm license/commit trực tiếp.

## Áp dụng cho BoxFox

Áp dụng pattern “catalog trước, load sau”, nhưng thêm catalog record gồm source URL, commit/hash, author/license, trust verdict, quyền được cấp và lifecycle. Quarantine là hàng rào nhập nội dung; executor/sandbox mới là hàng rào thực thi. Không để snapshot `code-reference` xuất hiện trên skill discovery path runtime.

| Bằng chứng | Tình trạng snapshot | Trạng thái hiện tại |
|---|---|---|
| [`agent/skill_utils.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_utils.py), [`agent/skill_commands.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_commands.py), [`agent/skill_preprocessing.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_preprocessing.py), [`agent/skill_bundles.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/agent/skill_bundles.py) | **Giữ lại:** các đường dẫn tương ứng dưới `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/agent/` | `reference-only` |
| Bốn `SKILL.md` ở bảng trên | **Giữ lại:** các đường dẫn tương ứng dưới `code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/skills/` | `reference-only`; review riêng trước mọi tái sử dụng |
| [`tools/skills_tool.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skills_tool.py), [`tools/skills_guard.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tools/skills_guard.py) | **Giữ lại:** [tools/skills_tool.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/skills_tool.py), [tools/skills_guard.py](../../../../code-reference/agent-harness/hermes-agent/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/upstream/tools/skills_guard.py) | `reference-only` |

Test hành vi: [`tests/agent/test_skill_utils.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_skill_utils.py), [`tests/agent/test_project_skills.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_project_skills.py), [`tests/agent/test_skills_auto_load.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_skills_auto_load.py), [`tests/agent/test_skill_commands_reload.py`](https://github.com/NousResearch/hermes-agent/blob/69fd61b0efbe2bf7f412714ed8c35e40dfddc534/tests/agent/test_skill_commands_reload.py).
