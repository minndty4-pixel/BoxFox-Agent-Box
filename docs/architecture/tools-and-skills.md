# Kiến trúc Hệ thống Công cụ (Tools & Skills) của BoxFox Agent Box

> **Trạng thái:** Đề xuất kiến trúc kỹ thuật sản phẩm cho Lớp L5 (Tools & Skills).  
> **Nguồn tham chiếu:** 
> - [Hermes Agent (`research_code/hermes-agent-main/`)](https://github.com/NousResearch/hermes-agent) (Module `environments/`, `computer_use/`, `terminal_tool.py`, `code_execution_tool.py`, `browser_tool.py`).
> - [OpenCode (`research_code/opencode-dev/`)](https://github.com/anomalyco/opencode) (`LspTool`, `EditTool`, `ApplyPatchTool`, `ShellTool`, `GrepTool`, `Truncate`).
> - **Devin** (Cognition Devbox Architecture), **Cursor** (Agentic IDE), **Vorflux** (Adversarial In-Browser Verification), **Aider** (Repo Map) & **SWE-agent** (ACI).

---

## 1. Vị trí của Lớp L5 trong Kiến trúc 7 Tầng của BoxFox

BoxFox là môi trường **AI Computer tự lưu trữ (Self-Hosted AI Computer)** được cô lập hoàn toàn. Mọi hành động của Agent đều phải tuân thủ nghiêm ngặt mô hình bảo mật:

```text
[L1: User Interface] ── (WebSocket / UI Events)
         │
[L2: Controller] ───── (Task Epochs, Leases, Human Approvals)
         │
[L3: Agent Core] ───── (Plan/Act Loop, Prompt Composer, Model Router)
         │
[L4: Security Gateway] (Policy Engine, IFC Labels, Temporal Leases, Audit Ledger)
         │  ▲ (Mọi lệnh gọi Tool đều phải được kiểm duyệt & cấp Lease tại đây)
         ▼  │
[L5: Tools & Skills] ── (Registry, Argument Coercion, Smart Truncation, Tool Suites)
         │
         ├───> [L6: Sandbox / AI Computer] (Docker Container, noVNC X11, Dev Server)
         └───> [L7: External World]        (Internet Web Egress — Gated by Lease)
```

### Nguyên tắc Bất biến của Hệ thống Tool:
1. **Model không có quyền trực tiếp:** Mô hình chỉ phát sinh đề xuất gọi tool (`tool_call`); việc thực thi chỉ xảy ra khi L4 Security Gateway kiểm tra tính hợp lệ của nhãn dữ liệu (IFC) và Temporal Capability Lease.
2. **Cô lập ranh giới vật lý (Physical Boundary):** Tất cả các công cụ thực thi lệnh shell, compile mã nguồn, chạy server hay mở web đều diễn ra bên trong Guest Sandbox (L6), không bao giờ thoát ra máy tính Host.
3. **Bảo vệ cửa sổ ngữ cảnh (Context Window Protection):** Mọi kết quả trả về từ Tool (stdout, stderr, nội dung file) đều đi qua bộ lọc cắt tỉa thông minh (`smart truncator`) để chống tràn token và ngăn chặn tấn công Prompt Injection từ dữ liệu bên ngoài.

---

## 2. Danh Mục Công Cụ Chuyên Dụng (9 Nhóm Trụ Cột)

Trang này gom công cụ theo chín nhóm trụ cột cho dễ đọc; **nguồn sự thật** về việc nhóm nào bật cho
vai nào là `backend/src/agentbox/agent_core/tool_groups.py` và `roles.py` (vòng 27: 35 công cụ
orchestrator, 11 nhóm, trong đó nhóm 8 và nhóm 9 là của việc nghiên cứu).

```text
                    ┌─── Nhóm 1: Sandbox & VM Manipulation (6 tools)
                    ├─── Nhóm 2: Filesystem & Code Editing (6 tools)
                    ├─── Nhóm 3: Code Intelligence & AST LSP (5 tools)
[BoxFox Tool Suite] ├─── Nhóm 4: Terminal & Ephemeral Execution (6 tools)
   (ships 35)       ├─── Nhóm 5: Computer Use & UI Testing (6 tools)
                    ├─── Nhóm 6: Memory, History & Web Research (6 tools)
                    ├─── Nhóm 7: Orchestration & Governance (9 tools)
                    ├─── Nhóm 8: Research Source Ledger (3 tools)   ← vòng 27
                    └─── Nhóm 9: Research Dossier (5 tools)         ← vòng 27
```

---

### Nhóm 1: Thao tác Máy ảo & Container Sandbox (6 Tools)
*Thừa hưởng từ Hermes `environments/docker.py`, `file_sync.py` và Devin Devbox.*

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `sandbox_status` | *(none)* | `cpu_pct, mem_mb, disk_gb, novnc_active, uptime` | Kiểm tra tình trạng sức khỏe, tài nguyên phần cứng và trạng thái hiển thị của container máy ảo. |
| `sandbox_network_toggle` | `enabled: bool` | `network_state, ip_address` | Bật/tắt mạng Internet của sandbox. Chuyển đổi giữa chế độ cách ly hoàn toàn (Air-gapped) và chế độ Online khi cần tải dependencies. |
| `sandbox_snapshot_create` | `name: str, description?: str` | `snapshot_id, created_at` | Tạo điểm khôi phục nhanh trạng thái container trước khi thực thi các script nguy hiểm hoặc cài đặt phức tạp. |
| `sandbox_snapshot_restore` | `snapshot_id: str` | `restored: bool, duration_ms` | Phục hồi lại toàn bộ hệ thống file container về trạng thái snapshot khi xảy ra lỗi nghiêm trọng. |
| `sandbox_file_sync` | `direction: "host_to_guest" \| "guest_to_host", paths: str[]` | `synced_files: int, errors: str[]` | Đồng bộ hóa tập tin hai chiều an toàn giữa thư mục làm việc của Host và Container Sandbox. |
| `sandbox_port_forward` | `container_port: int, host_port?: int` | `public_url, status` | Mở cổng dịch vụ nội bộ (ví dụ: port 3000, 5173, 8080) ra giao diện ngoài để người dùng và agent kiểm thử web. |

---

### Nhóm 2: Thao tác Tệp tin & Soạn thảo Mã Nguồn (6 Tools)
*Thừa hưởng từ OpenCode `read.ts`, `write.ts`, `edit.ts`, `apply_patch.ts` và Cursor Diff Review.*

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `file_read` | `path: str, offset?: int, limit?: int` | `content: str, total_lines: int, is_truncated: bool` | Đọc tệp tin có hỗ trợ phân trang dòng, đọc offset và phát hiện tệp nhị phân/hình ảnh. |
| `file_write` | `path: str, content: str, overwrite: bool` | `bytes_written: int, path: str` | Ghi tệp tin mới hoặc ghi đè toàn bộ tệp tin có kiểm soát an toàn. |
| `file_edit_block` | `path: str, target_content: str, replacement_content: str` | `applied: bool, line_start: int, diff: str` | Chỉnh sửa một khối mã nguồn liên tục với yêu cầu chuỗi mục tiêu phải là duy nhất (đảm bảo độ chính xác tuyệt đối). |
| `file_apply_patch` | `path: str, patch_diff: str` | `applied_chunks: int, rejected_chunks: int` | Áp dụng Git Unified Diff patch cho nhiều khối sửa đổi không liền kề trong cùng một file. |
| `codebase_grep` | `query: str, is_regex: bool, path?: str, glob?: str` | `matches: {file, line, content}[]` | Tìm kiếm văn bản siêu tốc bằng động cơ Ripgrep nguyên bản, hỗ trợ regex và phân biệt hoa/thường. |
| `codebase_glob` | `pattern: str, base_dir?: str` | `files: str[]` | Tìm kiếm danh sách tệp tin theo mẫu wildcard (ví dụ `**/*.tsx`, `src/**/*.py`). |

---

### Nhóm 3: Code Intelligence, AST & Phân Tích Cú Pháp (5 Tools)
*Thừa hưởng từ OpenCode `lsp.ts`, `ast-grep`, Aider Repo Map và SWE-agent.*

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `lsp_diagnostics` | `path?: str` | `diagnostics: {file, line, severity, message}[]` | Truy vấn trực tiếp Language Server để lấy toàn bộ lỗi biên dịch, linter và typecheck ngay sau khi sửa code. |
| `lsp_definitions` | `path: str, line: int, character: int` | `locations: {file, line_range}[]` | Nhảy đến vị trí khai báo gốc của một hàm, biến, interface hoặc class trong toàn bộ repo. |
| `lsp_references` | `path: str, line: int, character: int` | `references: {file, line, snippet}[]` | Tìm tất cả các vị trí đang sử dụng hàm/biến được chỉ định trong toàn bộ dự án. |
| `ast_grep_search` | `pattern: str, language: str, path?: str` | `matches: {file, range, ast_node}[]` | Tìm kiếm cấu trúc theo cây cú pháp trừu tượng (AST) không bị ảnh hưởng bởi khoảng trắng hay cách format code. |
| `repo_map_generate` | `focus_files?: str[], max_tokens?: int` | `repo_map_summary: str` | Tạo bản đồ tổng quan cấu trúc dự án (danh sách class, methods, signatures có xếp hạng PageRank) giúp Agent hiểu nhanh kiến trúc lớn với chi phí token cực thấp. |

---

### Nhóm 4: Thực thi Lệnh & Ephemeral Runtime (6 Tools)
*Thừa hưởng từ Hermes `code_execution_tool.py`, OpenCode `shell.ts` và `task.ts`.*

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `terminal_exec` | `command: str, cwd?: str, timeout_ms?: int` | `stdout: str, stderr: str, exit_code: int` | Chạy lệnh shell (bash/powershell) đồng bộ trong sandbox với giới hạn thời gian chạy và mã thoát. |
| `terminal_spawn_background` | `command: str, cwd?: str` | `task_id: str, pid: int` | Khởi chạy các tiến trình chạy dài (dev server, vite, database, test runner watcher) chạy ngầm. |
| `process_manage` | `action: "list" \| "status" \| "kill", task_id?: str` | `processes: {id, pid, status, cpu, mem}[]` | Quản lý, kiểm tra tài nguyên hoặc gửi tín hiệu dừng (`SIGTERM`/`SIGINT`) cho tiến trình ngầm. |
| `process_send_input` | `task_id: str, input_text: str` | `delivered: bool` | Gửi dữ liệu stdin vào tiến trình đang chạy (dành cho các câu lệnh tương tác hỏi prompt). |
| `terminal_output_truncate` | `raw_output: str, max_lines?: int` | `truncated_output: str, dropped_lines: int` | Thuật toán cắt tỉa thông minh các log quá dài, giữ nguyên phần đầu và phần đuôi chứa stack trace lỗi. |
| `execute_code` | `language: "python" \| "javascript", code: str` | `stdout: str, stderr: str, return_value?: any` | Thực thi tức thì một đoạn mã tính toán trong sub-kernel cô lập mà không cần tạo file rác trên đĩa. |

---

### Nhóm 5: Computer Use & Kiểm Thử Giao Diện Web (6 Tools)
*Thừa hưởng từ Hermes `computer_use/`, `browser_cdp_tool.py` và Vorflux Adversarial Testing.*

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `computer_screen_capture` | *(none)* | `image_base64: str, width: int, height: int` | Chụp ảnh màn hình framebuffer noVNC của Sandbox để LLM nhận diện giao diện đồ họa. |
| `computer_mouse_action` | `action: "click" \| "double_click" \| "right_click" \| "move" \| "drag", x: int, y: int` | `success: bool` | Điều khiển con trỏ chuột trong máy ảo tại tọa độ màn hình chính xác. |
| `computer_keyboard_action` | `action: "type" \| "press" \| "hotkey", text?: str, keys?: str[]` | `success: bool` | Giả lập gõ văn bản và bấm các phím tắt hệ thống (`Ctrl+C`, `Enter`, `Alt+Tab`). |
| `browser_open_url` | `url: str, headless: bool` | `page_title: str, loaded: bool` | Điều khiển trình duyệt trong máy ảo mở URL nội bộ (localhost) hoặc URL tài liệu bên ngoài. |
| `browser_verify_ui` | `url: str, wait_selector?: str` | `screenshot: str, console_errors: str[], dom_summary: str` | Tự động mở trang web dev, đợi render, bắt toàn bộ lỗi console log và thẩm định visual bug (Vorflux style). |
| `browser_cdp_eval` | `expression: str` | `result: any, exception_details?: str` | Thực thi mã JavaScript trực tiếp trên DevTools Protocol của tab trình duyệt đang mở để kiểm tra state client. |

---

### Nhóm 6: Bộ Nhớ, Lịch Sử & Nghiên Cứu Tài Liệu (6 Tools)
*Thừa hưởng từ Hermes `memory_tool.py`, `session_search_tool.py` và `web_tools.py`.*

> **Ghi chú:** tên tham số lấy từ `backend/src/agentbox/agent_core/tool_contracts.py`; tài liệu cũ ghi
> `max_results`/`web_extract` là sai (`web_extract` không tồn tại — tool thật là `web_fetch`).

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `web_search` | `query: str, queries?: str[], source?: str, count?: int, site?: str, freshness?: "day" \| "week" \| "month" \| "year", lang?: str, exclude?: str[]` | `results: {title, url, snippet, provider, alsoFrom}[], queries: str[], perQuery: {query, count, error?}[], deduped: int, dropped: int, cached: bool` | Tìm kiếm trên Internet. **Không có phân trang**: `query` là chân chính, `queries` thêm tối đa 2 chân nữa trong **một** lời gọi, `count` là trần **mỗi chân**; kết quả khử trùng rồi gộp. Chân `web` là một chuỗi (Firecrawl không khoá → Brave/Tavily/Exa/Parallel nếu có khoá); `source="papers"` đi chuỗi học thuật riêng (OpenAlex → Crossref → Europe PMC → arXiv). Lượt lặp trong 300 s ăn bộ đệm (`cached: true`). |
| `web_fetch` | `url: str, offset?: int, ref?: str` | `title: str, text: str, textChars: int, truncated: bool, nextOffset: int \| null, ref: str, readTier: str, untrusted: true` | Đọc **thật** một trang/PDF: dựng bảng, thang năm tầng (HTML → JATS → `pdfplumber` → đầu đọc → ảnh), và lưu **toàn bộ** bản đã đọc vào bộ đệm đọc kể cả khi câu trả lời bị cắt ở trần ngữ cảnh. |
| `read_source` | `ref?: str, url?: str, offset?: int, maxChars?: int, find?: str[]` | `text: str, textChars: int, nextOffset: int \| null, fromStore: bool, matches: {term, offset}[]` | Đọc tiếp tài liệu dài **từ bộ đệm** theo mẩu (không tải lại), và tìm một đoạn bên trong bằng tối đa 4 từ khoá **bỏ dấu** (`chuyen tuyen` khớp `chuyển tuyến`). Chỉ dùng khi cần thêm đất hoặc cần định vị một câu. |
| `paper_citations` | `workId?: str, doi?: str, direction?: "backward" \| "forward", limit?: int` | `work: str, total: int, count: int, results: {title, doi, openalexId, year}[]` | Đi theo đồ thị trích dẫn của **một** bài qua OpenAlex (không khoá): `forward` = ai trích dẫn nó, `backward` = nó dựa trên gì. Dùng để tới **nguồn gốc** của một khẳng định thay vì tin một câu nhắc gián tiếp. |
| `agent_memory` | `action: "save" \| "recall" \| "delete", key: str, value?: str` | `results: {key, value, score}[]` | Lưu trữ và truy xuất các quy tắc dự án, kiến thức ghi nhớ qua nhiều phiên làm việc (Vector/SQLite). |
| `session_search` | `query: str, session_id?: str` | `matches: {turn_id, summary, snippet}[]` | Tìm kiếm lại các quyết định kỹ thuật hoặc đoạn code đã từng thực hiện trong lịch sử các phiên trước. |

---

### Nhóm 7: Tự Động Hóa Coding, Điều Phối & Quản Trị (9 Tools)
*Thừa hưởng từ Aider Git Workflow, OpenCode `question.ts`, `plan.ts` và BoxFox Security Gateway.*

| Tên Tool | Đầu vào chính | Đầu ra | Mục đích chuyên dụng |
| :--- | :--- | :--- | :--- |
| `git_status` | *(none)* | `modified: str[], untracked: str[], branch: str` | Kiểm tra trạng thái cây làm việc git hiện tại. |
| `git_diff_inspect` | `path?: str, staged?: bool` | `diff_text: str, stats: {insertions, deletions}` | Xem toàn bộ mã thay đổi so với HEAD để Agent tự review chất lượng code trước khi bàn giao. |
| `git_commit_checkpoint` | `message: str, files?: str[]` | `commit_hash: str, branch: str` | Tự động tạo git commit ghi dấu mốc hoàn thành sạch sẽ cho mỗi epoch công việc. |
| `test_runner_affected` | `changed_files?: str[]` | `passed: bool, total: int, failures: {test, error}[]` | Tự động nhận diện framework test (pytest, vitest, jest) và chạy các bài test bị ảnh hưởng trực tiếp. |
| `code_format_lint` | `paths: str[]` | `formatted_files: str[], fixed_issues: int` | Tự động chạy Prettier/Black/Ruff/Biome để đảm bảo mã nguồn tuân thủ coding conventions. |
| `ask_user_question` | `question: str, options?: str[], is_multi_select?: bool` | `selected_options: str[], write_in?: str` | Tương tác hỏi người dùng câu hỏi có lựa chọn hoặc nhận phản hồi dạng văn bản khi có điểm mơ hồ. |
| `plan_mode_transition` | `proposed_plan_path: str` | `approved: bool, feedback?: str` | Quản lý chuyển đổi trạng thái giữa Lập kế hoạch (Plan Mode) và Thực thi (Act Mode) có sự phê duyệt của người dùng. |
| `request_capability_lease` | `action: str, target: str, duration_sec: int, reason: str` | `lease_id: str, granted: bool` | Xin cấp quyền thực thi tạm thời (Temporal Lease) từ Controller cho các hành vi rủi ro cao. |
| `delegate_subagent` | `agent_role: str, task_objective: str, context: dict` | `subagent_result: str, artifacts: str[]` | Khởi tạo một subagent chuyên trách (ví dụ: research agent, tester agent) và chờ nhận kết quả. |

---

## 3. Hệ Thống Kiểm Thử (Pytest Test Suites)

Tất cả các bài kiểm thử được thiết lập tại `backend/tests/` với các thư mục chuyên biệt:

```text
backend/tests/
├── unit/
│   ├── test_tool_schema_validation.py      # Kiểm tra 100% JSON Schema của 42 tools
│   ├── test_file_editing_algorithms.py     # Kiểm tra thuật toán block edit & patch parser
│   ├── test_smart_truncator.py             # Kiểm tra thuật toán cắt ngắn log an toàn
│   └── test_ast_grep_and_repo_map.py       # Kiểm tra cấu trúc cây AST và repo map
├── security/
│   ├── test_path_traversal_guards.py       # Kiểm tra chặn truy cập ngoài workspace sandbox
│   ├── test_command_injection_guards.py    # Kiểm tra chặn đứng mã độc shell (rm -rf, fork bomb)
│   ├── test_temporal_lease_enforcement.py  # Kiểm tra Security Gateway chặn lệnh khi chưa có lease
│   └── test_network_airgap_toggle.py       # Kiểm tra đóng băng kết nối Internet của container
├── integration/
│   ├── test_docker_sandbox_lifecycle.py    # Kiểm tra khởi tạo, cấp phát tài nguyên Docker thật
│   ├── test_terminal_background_process.py # Chạy tiến trình ngầm, gửi stdin, stream stdout
│   ├── test_lsp_server_interaction.py      # Kết nối pyright / tsserver thật để lấy diagnostics
│   └── test_novnc_screen_capture.py        # Chụp ảnh thật từ framebuffer màn hình X11
└── e2e/
    ├── test_swe_bugfix_scenario.py         # Kịch bản sửa lỗi phần mềm hoàn chỉnh
    └── test_vorflux_ui_verification.py     # Kịch bản kiểm thử giao diện web tự động
```

---

## 4. Lộ Trình Triển Khai Chi Tiết

- **Giai đoạn 1 (Nền tảng & Coding Engine - 17 tools)**:
  - Base Tool Architecture (`BaseTool`, `ToolResult`, `ToolContext`, `ToolRegistry`).
  - Nhóm 2 (Filesystem & Sửa Code - 6 tools).
  - Nhóm 3 (Code Intelligence & AST LSP - 5 tools).
  - Nhóm 4 (Terminal & Ephemeral Execution - 6 tools).
  - Bộ Unit Tests tương ứng.
- **Giai đoạn 2 (Máy ảo & Kiểm soát An toàn - 6 tools)**:
  - Nhóm 1 (Sandbox & VM Manipulation - 6 tools) kết nối Docker Engine.
  - Bộ Security & Isolation Tests tương ứng.
- **Giai đoạn 3 (Tự động hóa Coding & Quản trị - 9 tools)**:
  - Nhóm 7 (Git Workflow, Test Runner, Linter, Plan Transition, Lease - 9 tools).
- **Giai đoạn 4 (Giao diện đồ họa & Nghiên cứu sâu - 10 tools)**:
  - Nhóm 5 (Computer Use & Web Verification - 6 tools).
  - Nhóm 6 (Memory, History & Web Research - 6 tools).
  - Toàn bộ Integration & End-to-End Tests.
