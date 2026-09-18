# BoxFox harness v0 — Hermes Agent và OpenCode

Ngày khảo sát: 2026-09-18. Tài liệu được lập trước triển khai. Nguồn chính là snapshot local trong `research_code/`; không dùng tên “Hermes-inspired” để ngụ ý đã port toàn bộ sản phẩm Hermes. Phụ lục manifest ghi SHA-256 từng nguồn, vì snapshot ZIP không có commit Git độc lập.

## 1. Phạm vi và thứ tự

1. Đọc runtime Hermes, OpenCode và BoxFox; ghi kiến trúc, khác biệt, kế hoạch này.
2. Port các thành phần phù hợp: vòng lặp, context/compaction, session, skill catalog/load, delegation, tool boundary; giữ nguyên source skill và license.
3. Nối harness thật vào chat hiện tại; tách 9 sub-agent; không thiết kế lại composer.
4. Kiểm thử unit/integration, HTTP, session/restart, browser UI, sandbox screenshot/video/browser/computer và inference thật nếu model sẵn sàng.

“Port v0” không bao gồm gateway Telegram/Discord, lịch cron, thanh toán, curator tự sửa skill, remote MCP hoặc toàn bộ CLI/TUI của Hermes. Những phần đó không phục vụ harness BoxFox hiện tại; không đăng ký tool giả. Tất cả skill upstream được kiểm kê; chỉ skill có môi trường/công cụ phù hợp mới được nạp cho agent. Catalog không đồng nghĩa dependency đã được cài.

## 2. Kiến trúc Hermes (source thực tế)

Root nguồn: `research_code/hermes-agent-main/hermes-agent-main/`.

### Harness và vòng lặp

`run_agent.py` là facade `AIAgent`; khởi tạo ở `agent/agent_init.py`. `agent/conversation_loop.py` điều khiển một lượt với turn lease, preflight, request assembly, provider call, response intake, tool round và finalizer. Các phase nằm trong `agent/turn_*.py`. Giới hạn iteration, deadline và cancellation thuộc runtime, không giao cho model tự quyết định. API errors/empty output/overflow có đường phục hồi riêng; tool errors trở lại transcript để agent có thể sửa.

`agent/tool_executor.py` parse arguments thành JSON object, không coi JSON lỗi là `{}` hợp lệ. Tool call có identity ổn định. Kết quả đi qua observe → commit → project; flush tiến độ trước khi chiếu lên UI. Batch độc lập có thể chạy đồng thời, công cụ có tác động phụ phải giữ thứ tự. Output lớn được spill ra artifact, context chỉ giữ bản rút gọn với đường dẫn. Tool schema và quyền thực thi là hai lớp khác nhau.

### Context và compression

`agent/system_prompt.py` ghép identity, platform/tool guidance, context files, memory và danh mục skill. Prefix và toolset được cố định trong conversation để giữ cache. Đổi cấu hình skill mặc định có hiệu lực session kế tiếp; không nối toàn bộ skill vào mọi request.

`agent/context_compressor.py`, `context_compressor_summary.py`, `conversation_compression.py` và `micro_compaction.py`:

- Tính pressure gồm messages + tool schemas + output reserve, theo context window của model.
- Prune tool output cũ trước khi trả tiền cho summary; giữ tool instruction như skill đã load.
- Chọn head/tail theo token, kéo boundary về trọn nhóm assistant tool-call + tất cả tool results.
- Giữ latest user task và in-flight exchange. Không biến yêu cầu cũ trong summary thành mệnh lệnh mới.
- Summary là background reference với goal, decisions, constraints, files/artifacts, evidence và outstanding work; không tiếp tục stale task chỉ vì có trong summary.
- Summary rỗng, lỗi auth/quota, cancellation hoặc `finish_reason=length` không được thay thế lịch sử gốc.
- Lưu checkpoint trước thay đổi; session ID giữ nguyên. Micro-compaction xử lý exchange tăng dần, defrag rolling summary và failure cooldown. Native compaction là đường riêng theo provider.

BoxFox v0 dùng prune + bounded summary nguyên tắc trên, không tuyên bố hỗ trợ native Responses compaction hoặc toàn bộ micro-compaction của Hermes. Token estimate phải ghi là estimate; usage thực lấy từ router.

### Session và memory

`agent/session_persistence.py` và `hermes_state*.py` lưu transcript SQLite, state, usage và lineage. Marker bền vững gắn vào message, không dùng `id(object)` để deduplicate vì Python tái sử dụng identity. Ephemeral recovery scaffolding không trở thành user history. `agent/memory_manager.py` điều phối builtin memory + external provider, session-start/end/pre-compress hooks. Memory dài hạn khác transcript và khác summary. Child không được tự ghi shared memory.

### Skills — toàn bộ cơ chế

`skills/` chứa bundled, `optional-skills/` chứa gói tùy chọn. `tools/skills_tool.py` scan, parse frontmatter, lọc disabled/platform, list metadata, `skill_view` đọc đầy đủ SKILL.md và linked files trong package. Frontmatter: name, description, version, author, license, platforms, metadata.hermes tags/category/related_skills/config. Skill gồm instruction + scripts/references/templates/assets, không chỉ vài bullet tóm tắt.

`skills_hub*` lo nguồn/install; `skills_sync*` lo đồng bộ; `skill_manager*` quản lý nội dung; `skills_guard.py`, `skills_ast_audit.py`, `skill_provenance.py` lo nguồn và kiểm tra; `skill_usage.py`/`skill_ledger.py` ghi usage; `agent/curator.py` đánh giá skill do agent tạo, archive có thể phục hồi, không tự sửa bundled/pinned. Inline shell preprocessing có thể chạy code, vì vậy BoxFox không tự bật khi đọc skill. Dependencies/MCP/provider secrets phải được cấu hình riêng.

Phụ lục machine-readable chứa **mọi** SKILL.md của cả hai cây và hash; runtime bundle giữ nguyên text cùng tài nguyên. UI hiển thị metadata; bật skill không tự chạy script. Loaded skill chỉ đi vào session được bật, đọc đầy đủ và được kiểm tra đường dẫn.

### Delegation

`tools/delegate_tool*.py`: goal + context hoặc batch tasks, context child riêng, concurrency giới hạn (upstream default 3), depth giới hạn. `delegate_tool_toolsets.py` lấy giao quyền parent/child, loại delegate/clarify/shared-memory/messaging/scheduling ở leaf. `delegate_tool_child_run.py` quản lý lifecycle; summary trả về parent, không chép toàn bộ transcript vào parent. Process/kernel child có chủ sở hữu, cleanup khi child kết thúc. Background delegation process-local, không tự phục hồi sau restart.

### Tools, computer và browser

`tools/registry.py` + `model_tools.py` + `toolsets.py`: registry, discovery, schemas, requirement checks, toolsets theo session. Nhóm chính: file, terminal/process, code execution, browser, web/search, vision/media, skills, memory/session search, todo/delegation; các nhóm connector/vendor nằm ở edge.

`tools/environments/docker.py` chọn môi trường thực thi. `tools/browser_tool*` và `browser_cdp_tool.py` quản lý tab/session, snapshot, actions, lifecycle theo backend. `tools/computer_use/backend.py` định nghĩa CaptureResult/UIElement/ActionResult; action transport success không đồng nghĩa task success. Cần chụp/đọc lại để xác minh. Driver host của Hermes không tự trở thành driver VM BoxFox: BoxFox phải dùng container được cấu hình, không fallback sang desktop máy người dùng.

## 3. OpenCode dùng để đối chiếu

Root: `research_code/opencode-dev/opencode-dev/`.

- `packages/core/src/session/run-coordinator.ts`: serialize theo session key; các session độc lập chạy song song; interrupt đợi cleanup, coalesce wake.
- `packages/core/src/session/input.ts`, `store.ts`, `runner/`: admission bền vững tách model execution, parent/session/message identity; không tự replay side effects khi crash.
- `packages/opencode/src/session/compaction.ts`: prune output cũ, bảo vệ skill và tail gần đây, overflow reserve; summary có status thật. `packages/core/src/session/compaction.ts` xây prompt.
- `packages/core/src/tool/registry.ts`: representation tool thống nhất, settlement và output bounding; executor thực thi permission, catalog chỉ lọc hiển thị.
- `packages/core/src/skill/discovery.ts`: path segment checks, bounded concurrency; `tool/skill.ts`/`skill.ts` discovery/load theo location.
- Agent, task child, permission và toolset phục vụ coding; BoxFox bổ sung vai trò Research và VM tools theo môi trường riêng.

Không copy Effect/TypeScript runtime sang Python bằng import giả. Các behavior được adapt, ghi rõ trong manifest và test contract tương ứng.

## 4. So sánh baseline BoxFox

| Thành phần | Hiện trạng trước port | Thay đổi v0 |
|---|---|---|
| Engine | while-loop đơn giản; urllib chặn async; không cancellation/deadline xuyên suốt | Async model client, budget, tool dispatch có policy, cancellation |
| Session | SimpleSessionMemory RAM | SQLite transcript/checkpoint/events/child lineage; restart đọc lại |
| Context | 3 chuỗi prompt, chưa compression | Stable prefix, prune/summary, reserve, cặp tool toàn vẹn |
| Skills | 8 summary hardcoded; UI localStorage độc lập | Bundle upstream đầy đủ, lazy load, API catalog và session selection |
| Subagents | 4 card ghép, chưa dispatch | 9 core riêng, parent/child execution, intersection quyền |
| Media | Capture host; record chỉ sửa dict | Tool gọi sandbox thật, record artifact xác minh |
| Chat | Gửi thẳng router dù chọn harness | Harness → backend agent → router/tool; Single Model tiếp tục router |
| Auth | engine gọi /v1 với admin header | Endpoint nội bộ router có đúng auth contract |

## 5. Chín sub-agent

| ID | Trách nhiệm và output | Quyền v0 |
|---|---|---|
| explore | Map file, symbol, dependencies, evidence | Read/search |
| plan | Steps, constraints, acceptance criteria | Read/search |
| design | Interfaces, UI/system design và tradeoffs | Read/search |
| build | Implement scoped changes, artifact list | Workspace + sandbox execution |
| debug | Reproduction, root cause, targeted fix | Workspace + sandbox execution |
| review | Findings với file/evidence/severity | Read/search |
| simplify | Behavior-preserving refactor | Workspace + sandbox execution |
| testing | Test execution, screenshot/video/browser evidence | Sandbox execution/media |
| research | Sources, quotes/links, uncertainty, comparison | Read + sandbox browser/research |

Orchestrator lựa chọn vai trò theo task, không ép mọi yêu cầu qua 9 agent. Child dùng model override nếu đã chọn, nếu không kế thừa route thật của parent; không gán tên model tĩnh không tồn tại. Leaf không delegate tiếp. Context và transcript độc lập; kết quả lỗi giữ nguyên để parent quyết định làm thay. Deadline chung, child timeout và max steps. Khi không có Docker, VM tools trả unavailable có lý do.

## 6. Kế hoạch triển khai

1. Vendor: LICENSE Hermes/OpenCode, module portable và toàn bộ skill packages; source hash manifest, không sửa snapshot nghiên cứu.
2. Backend: session store, context compressor, role registry, delegation, skill load, runtime API trên loopback :3102. Events có sequence để reload/poll.
3. Tool adapter: sandbox subprocess backend, CDP/browser, X11 computer actions, capture và ffmpeg record; không báo thành công khi không có file.
4. UI: giữ composer; 9 subagent core và dynamic topology; harness settings/skill settings tham gia runtime request; lưu session ID theo chat.
5. Launcher + proxy API agent; chạy các test bên dưới sau khi code hoàn chỉnh.

## 7. Kiểm thử và tiêu chí

- Session multi-turn/restart/isolation/concurrent admission; child lineage; không tự lặp tool sau interrupt/crash.
- Model fixture qua HTTP thật, tool execution và summary; malformed args, tool denied, budget/deadline/Stop; summary failure giữ nguyên lịch sử.
- Compaction không đứt tool pairs, giữ latest goal và stable system; oversized tools/schema overflow được báo.
- Skills full read, linked file traversal, optional/default disabled, UI chọn skills tới backend; license/hash parity.
- Mỗi role có core prompt/tool policy riêng; disabled role không spawn; child không nâng quyền.
- Sandbox: file write/read, shell, screenshot PNG, video MP4 có frame, browser navigate/read/click/type, computer click/type và screenshot sau action. Test deterministic và live tách riêng.
- Frontend typecheck/test/build; browser mở Harness, 9 role, chọn model thật, chat và Stop/reload.
- Inference live chỉ passed khi provider trả nội dung hợp lệ; Docker unavailable/credentials unavailable phải blocked/skipped, không tính mock là live.

## 8. Đề xuất sau v0

Tách workspace child cho các tác vụ ghi song song; context-window metadata lấy trực tiếp router thay cấu hình mặc định; memory provider bền vững có quyền rõ ràng; tool approval/lease IFC đầy đủ; differential benchmark context compression; native stream events từ model và replay có event cursor. Đo latency/token/cost theo role trước khi tối ưu prompt hay thay upstream.

## 9. Báo cáo thực thi

Được cập nhật sau khi triển khai và kiểm thử. Chưa có kết quả live tại thời điểm tạo tài liệu.
