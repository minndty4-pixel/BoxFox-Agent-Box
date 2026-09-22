# Sổ theo dõi lỗi — BoxFox Agent Box

Cập nhật: 2026-09-20 05:20 UTC — mọi phát hiện ở mục A và B đã được sửa trong commit 6d9aba7.

Quy ước cột **Trạng thái**:

- `ĐÃ SỬA` — có mã sửa trong cây làm việc và có test hoặc bằng chứng chạy thật.
- `ĐÃ SỬA (chờ xác minh)` — có mã sửa, chưa có bằng chứng chạy thật sau khi khởi động lại dịch vụ.
- `HOÃN` — biết lỗi, cố ý chưa sửa trong đợt này; ghi rõ lý do.
- `MỚI` — phát hiện ở đợt kiểm thử gần nhất, chưa sửa.

## 1. Đợt 1 — 25 lỗi từ vòng kiểm thử E2E ngày 2026-09-19

| Mã | Mức | Nội dung | Nơi sửa | Trạng thái |
|---|---|---|---|---|
| BUG-1 | Cao | `/compact` trên hội thoại ngắn làm phiên `failed` (`CONTEXT_LIMIT: summary did not reduce context enough`) | `backend/src/agentbox/agent_core/compression.py` | ĐÃ SỬA |
| BUG-2 | Cao | Router lọc bỏ delta chỉ có `reasoning_content` ⇒ không bao giờ có thinking stream | `router/src/engine.mjs`, `router/src/server.mjs` | ĐÃ SỬA |
| BUG-3 | Cao | UI bịa text suy luận ("Cryptographically verified by Cloud Code signature") | `frontend/src/components/chat/HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-4 | Cao | Model không có `contextWindow` / `thinkingType` / `defaultThinking` thật | `router/src/providers/*`, `router/src/service.mjs` | ĐÃ SỬA |
| BUG-5 | TB | `thinkingLevel` bị lọc bỏ khi tạo phiên | `backend/src/agentbox/agent_core/runtime.py` | ĐÃ SỬA |
| BUG-6 | TB | Toggle "Auto-compact enabled" chỉ là giao diện | `frontend/src/components/panels/ContextUsageBar.tsx` | ĐÃ SỬA |
| BUG-7 | TB | Thông báo nén không có số token, nằm trong khối đã thu gọn, không bấm được | `HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-8 | TB | Chat render theo khối, không theo dòng thời gian; mất text giữa lượt | `HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-9 | TB | Nhãn ảnh chụp cứng `1280 × 720 · PNG` | `HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-10 | TB | Không có tóm tắt cuối + expander; ảnh không gắn câu trả lời | `HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-11 | TB | `/claude-code` hardcode `role='build'`, lỗi `CHILD_FAILED` khi thiếu CLI | `backend/src/agentbox/skills/{commands,runtime_commands}.py` | ĐÃ SỬA |
| BUG-12 | Thấp | Catalog tĩnh bị gắn nhãn `source:'live'` | `router/src/providers/*` | ĐÃ SỬA |
| BUG-13 | Thấp | `RouterView.tsx` là UI chết | `frontend/src/components/settings/RouterView.tsx` | HOÃN — không nằm trong phạm vi đợt này; xoá cùng lúc với rà soát code chết |
| BUG-14 | Thấp | 6/8 phím tắt hiển thị nhưng đánh dấu `mock: true` | `frontend/src/components/shell/ShortcutsPopover.tsx` | HOÃN — cần chốt lại bộ phím tắt thật trước khi bỏ cờ |
| BUG-15 | Thấp | Code chết: `agent_core/engine.py`, `agent_loop.py`, thư mục `tools/` | `backend/src/agentbox/` | HOÃN — xoá code chết là thay đổi rộng, nên làm thành đợt riêng |
| BUG-16 | Thấp | UI gộp 3 store chat trong một khung | `frontend/src/components/panels/ChatPanel.tsx` | HOÃN — gộp store là tái cấu trúc lớn, cần thiết kế trước |
| BUG-17 | Cao | Lỗi HTTP 400 bị im lặng hoàn toàn | `frontend/src/components/panels/ChatPanel.tsx`, `store/harnessChatStore.ts` | ĐÃ SỬA |
| BUG-18 | TB–Cao | Thẻ lượt "ma" `Worked for 1s` nằm trên prompt đầu | `HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-19 | TB | Thời lượng sai ở lượt đã huỷ (`Worked for 1702s`) | `HarnessStepView.tsx` | ĐÃ SỬA |
| BUG-20 | TB | Rò rỉ transport mock vào chat thật (`Received interrupt command…`) | `frontend/src/components/panels/ChatPanel.tsx` | ĐÃ SỬA |
| BUG-21 | TB | Không bấm được `/stop` khi agent đang chạy | `frontend/src/components/panels/ChatInputBar.tsx` | ĐÃ SỬA |
| BUG-22 | Thấp | Nhãn Context Window bị cắt ở 900 px | `frontend/src/components/panels/ContextUsageBar.tsx` | ĐÃ SỬA |
| BUG-23 | Thấp | Không thu gọn theo màn hình nhỏ (390×844) | `frontend/src/App.tsx`, `components/shell/Sidebar.tsx`, `components/shell/useViewportWidth.ts` | ĐÃ SỬA |
| BUG-24 | Thấp | Đổi phiên hiện "No conversation yet" vài giây | `frontend/src/components/panels/ChatPanel.tsx` | ĐÃ SỬA |
| BUG-25 | Thấp | Trộn ngôn ngữ: chuỗi tiếng Việt cứng trong shell, lỗi box API tiếng Việt | `frontend/src/i18n/*`, `components/panels/PlanPanel.tsx`, `HarnessStepView.tsx` | ĐÃ SỬA một phần — xem mục 3 |

### Bằng chứng đợt 1

- Router: `cd router && /opt/node24/bin/node --test tests/*.test.mjs` → 63 pass / 0 fail.
- Backend: `.venv/bin/python -m pytest backend/tests -q` → 3 failed / 266 passed / 2 skipped (3 lỗi là lỗi môi trường có sẵn).
- Frontend: `cd frontend && npx vitest run` → 4 failed / 467 passed — đúng 4 lỗi có sẵn từ trước.
- Ảnh chụp: `images/f1-inline-error-400.png`, `images/u3-context-bar-900px.png`, `images/u4-narrow-390px.png`, `f2-f7-live-session-c1f656c9-chronological.png`, `f2-f4-live-capture-inline-under-tool-row.png`, `f7-live-compaction-notice-open.png`.

## 2. Đợt 4 — việc mới (Decision, plan tự mở, ghi file, kênh `ui_intent`, cuộn chat)

Hợp đồng chốt: `docs/plan/next-batch-contract.md`. Kế hoạch: `docs/plan/next-batch-workspace-decisions-plan.md`.

| # | Việc | Nơi sửa | Trạng thái |
|---|---|---|---|
| Đ4-1 | Tool `ask_user` / `request_approval`, sự kiện `decision_requested` → `decision_resolved`, trạng thái `awaiting_decision`, route trả lời, hết hạn = từ chối | `backend/src/agentbox/agent_core/{tool_contracts,runtime}.py`, `api/server.py` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 5, 6) |
| Đ4-2 | Tool `write_plan` + sự kiện `plan_written` + `ui_intent` | `backend/src/agentbox/sandbox/worker.py`, `agent_core/runtime.py` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 5, 6) |
| Đ4-3 | API ghi workspace: `mkdir`, `touch`, `rename`, `move`, `delete` (vào `.trash`) | `deploy/docker/{workspace_files,ide-proxy}.py` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-4 | Trạng thái duyệt plan thật (`.reviews`), sửa cache manifest theo mtime thư mục con | `deploy/docker/plan_files.py` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-5 | Decision thật trên giao diện: bỏ demo, một `PermissionCard` dùng chung, đếm ngược theo `deadline` thật | `frontend/src/components/panels/DecisionsPanel.tsx`, `PermissionCard.tsx` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-6 | Tab Plan tự mở khi có `plan_written`, `planRevision` cho `usePlanFiles`, bỏ nhánh mock | `frontend/src/store/uiStore.ts`, `hooks/usePlanFiles.ts`, `PlanPanel.tsx` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-7 | Luật không cướp tab (`requestTabIntent`): tôn trọng tab đang ghim, 15 giây hoạt động gần nhất, huy hiệu khi bị chặn | `frontend/src/store/uiStore.ts`, `App.tsx` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-8 | Chip trong transcript bấm được (sub-agent, plan, file, decision) | `frontend/src/components/chat/HarnessStepView.tsx`, `ChatPanel.tsx` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-9 | Hoàn thiện cuộn chat: số tin nhắn mới, phím `End`/`Shift+G`, giữ vị trí đọc, khôi phục vị trí theo phiên | `frontend/src/components/panels/ChatPanel.tsx` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |
| Đ4-10 | Giao diện thao tác file: tạo/đổi tên/xoá/di chuyển, xác nhận xoá nói rõ `.trash`, trạng thái file > 1 MiB, huy hiệu integrity | `frontend/src/components/panels/workspace/*`, `hooks/useWorkspaceFiles.ts`, `lib/workspace/*` | ĐÃ SỬA — ĐÃ XÁC MINH (vòng 4, 6) |

## 3. Đợt 4 — lỗi tìm thấy sau khi làm, đã sửa và xác minh

Nguồn: vòng kiểm thử trình duyệt trên hệ thống thật (vòng 4) và vòng kiểm chứng độc lập (vòng 6).
Chi tiết: `docs/tracking/findings-round4.md`.

| Mã | Mức | Mô tả ngắn | Trạng thái |
|---|---|---|---|
| B12 | Trung bình–Cao | Luật tự mở tab không tất định ở cấu hình mặc định (tự cuộn của agent gia hạn cửa sổ 15 giây; hàng đợi intent không bao giờ được xả) | ĐÃ SỬA (51f1452) — ĐÃ XÁC MINH (vòng 5 và vòng 6) |
| B13 | Thấp–Trung bình | `thinkingLevel` sai vẫn lọt khi lượt chạy đổi model | ĐÃ SỬA (51f1452) — ĐÃ XÁC MINH (vòng 6) |
| B2c | Thấp | Thẻ dạng lưới hiện nhãn chấm integrity bằng tiếng Anh và không hiện `confidentiality` | ĐÃ SỬA (51f1452) — ĐÃ XÁC MINH (vòng 6) |
| B4 | Thấp | Kéo thanh chia panel không được tính là hoạt động người dùng | ĐÃ SỬA (51f1452) — ĐÃ XÁC MINH (vòng 6) |
| B6 | Thấp | Intent cho tab Files mở tab mà không chọn file | ĐÃ SỬA (51f1452) — ĐÃ XÁC MINH (vòng 6) |
| B7 | — | Hai quyết định cùng lúc trong một phiên gốc là bất khả (409 `SESSION_BUSY`) | ĐÃ RÚT |
| N-1 | Thấp | `/skill <id>` thiếu nhiệm vụ không có mã lỗi máy đọc được | ĐÃ SỬA (6d9aba7) — ĐÃ XÁC MINH (vòng 4) |
| N-2 | Thấp | `thinkingLevel` sai được lưu nguyên lúc tạo phiên | ĐÃ SỬA (6d9aba7) — ĐÃ XÁC MINH (vòng 4) |
| NEW-1 | Trung bình | Nút Compact bị cắt ở khung hẹp 900–1100 px | ĐÃ SỬA (6d9aba7) — ĐÃ XÁC MINH (vòng 4) |
| R-1 … R-9 | Cao → Thấp | Phát hiện của vòng rà soát tích hợp (phiên con hỏi người dùng, cướp tab khi tải lại, `awaiting_decision` không tính là bận, đường dẫn được bảo vệ, …) | ĐÃ SỬA (6d9aba7) — ĐÃ XÁC MINH (vòng 4, 6) |

## 4. Việc còn nợ (không phải lỗi)

| # | Việc | Trạng thái |
|---|---|---|
| Nợ-1 | Dựng lại ảnh container để các tệp mới nằm trong image | ĐÃ XONG — `docker compose build` xong, `agentbox-sandbox:latest` (manifest `sha256:cf06992844d6…`), ba tệp trong ảnh khớp hash repo (`ide-proxy.py a7a83b02…`, `plan_files.py de901085…`, `workspace_files.py fc391ce1…`) |
| Nợ-2 | Xác thực `/claude-code` bằng CLI thật | CHƯA LÀM ĐƯỢC trong môi trường này — box không có binary `claude` và không có thông tin đăng nhập; chỉ xác minh được nhánh `SETUP_REQUIRED` |
| Nợ-3 | Nén context tự động theo ngưỡng token | **ĐÃ XONG vòng 19** — ngưỡng nay là `min(phần trăm, trần byte 301 200)` nên chạm được: đo sống hai lần nén tự động `summary` khi ngữ cảnh vượt ngưỡng, xem §6.20 |

## 5. Việc còn lại của BUG-25

Chuỗi lỗi tiếng Việt trong lớp container (`deploy/docker/capture.py`, `browser_capture.py`) là **thông báo lỗi kỹ thuật** trả cho giao diện; giao diện hiển thị nguyên văn. Cần chuyển các thông báo người dùng nhìn thấy sang khoá i18n ở phía frontend, hoặc trả mã lỗi và để frontend dịch. Chưa làm trong đợt 1 vì đụng tới ánh xạ lỗi chung; ghi ở đây để không mất dấu.

## 6. Đợt 7 — sáu việc chủ sở hữu giao (2026-09-20, sáng)

Kế hoạch của đợt: [round7-batch-plan.md](../plan/round7-batch-plan.md). Ba bản kế hoạch riêng:
[chất lượng đầu ra](../plan/agent-output-quality-plan.md), [benchmark](../plan/cua-benchmark-plan.md),
[nhật ký hệ thống](../plan/dev-system-log-plan.md).

| Mã | Lỗi / việc | Mức | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| BUG-26 | Harness phát lại **toàn bộ** văn bản tích luỹ ở mỗi delta (`assistant_delta`, `thought`); nơi đọc cộng dồn nên đầu ra lặp: đo được **tỷ lệ 38,0** (lượt chính) và **13,8** (lượt con) giữa tổng độ dài delta và văn bản cuối | HIGH | ĐÃ SỬA (`0800349`) — ĐÃ ĐO LẠI sống: **1,0** cả hai lượt | `r7_delta_repro.json` (trước) vs `r7_delta_after_fix.json` (sau) |
| BUG-26b | Bảng sub-agent đọc `tool_end` theo khoá `tool_call_id` trong khi harness phát khoá `id` ⇒ kết quả không gắn vào dòng, mọi dòng treo ở "running" | HIGH | ĐÃ SỬA (`0800349`) | `SubagentInspectorPanel.stream.test.tsx` (4 ca) |
| BUG-27 | Câu lỗi hiện đúng chữ `Agent run failed` khi `error` rỗng (`ServerDisconnectedError`, `ConnectionResetError`, `Exception()`…), không retry lỗi tạm thời | HIGH | ĐÃ SỬA (`0800349`) — ĐÃ XÁC MINH sống: `UPSTREAM_HTTP_503` kèm câu giải thích của router | `r7_delta_after_fix.json`, `r7_cua_and_failure_evidence.json` |
| BUG-27b | Câu lỗi dự phòng ở store (`harnessChatStore.ts`) vẫn là chuỗi trần khi hàng cũ có `message` rỗng | MEDIUM | ĐÃ SỬA (`0f5b127`) | `harnessChatStore.test.ts` (2 ca mới) |
| BUG-28 | Hợp đồng chuyển việc cho sub-agent trống: schema không mô tả tham số, không nêu cấu trúc kết quả, câu trả lời con không bị chặn trần (JSON phình trong event) | HIGH | ĐÃ SỬA (`b0ba53b`) — ĐÃ ĐO LẠI sống: câu trả lời con bị chặn ở 8 075 ký tự kèm `truncated: true` | `after_delegate.json` |
| BUG-29 | `write_plan` nhận plan không có mục nghiệm thu, không có rủi ro, không có nguồn — không có cổng chất lượng nào | HIGH | ĐÃ SỬA (`b0ba53b`) — cổng `PLAN_QUALITY_REJECTED` chạy trước khi ghi tệp | `test_plan_quality.py` (14 ca) |
| BUG-30 | `/claude-code` là ngõ cụt: ảnh box không có `node`/`claude`/`bwrap`; harness không truyền `ANTHROPIC_*`; readiness đòi đăng nhập tài khoản; box không tới được router | HIGH | ĐÃ SỬA phần mã (`7bf7d84`, `dad8178`, `51ecba6`) — CHƯA XÁC MINH sống vì container thật chưa tạo lại và cầu nối còn tắt (mặc định) | `deploy/docker/README-claude-code.md` |
| BUG-31 | Log hệ thống cho dev chưa có; test đơn vị ghi thẳng vào thư mục log thật của người vận hành | MEDIUM | ĐÃ SỬA (`0800349`, `006e466`, `aa30ffb`) | `test_system_log.py` (8 ca), `backend/tests/conftest.py` |
| N-4 | Bảng Terminal trong box thì agent đọc được; nhật ký dev nay ở host (`~/BoxFox/logs`) nên agent không thấy, nhưng **chưa có bảng xem trong app** | — | CHƯA LÀM (bản v2 của kế hoạch nhật ký) | `dev-system-log-plan.md` §3 |
| N-5 | Sản phẩm **không có công cụ tìm kiếm web**; năng lực web duy nhất là `browser_use`, mà box mặc định tắt mạng | — | CHƯA LÀM — cần chủ sở hữu quyết định mở mạng theo phiên | `agent-output-quality-plan.md` §4 (ca Q5/Q6) |

### 6.1 Năm lỗi vòng kiểm chứng đợt 7 — ĐÃ SỬA (`9e25bea`)

| Mã | Lỗi | Mức | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| F1 | Một bản ghi màn hình hiện thành **hai** player + hai thumbnail: bộ trích media nhận luôn đường dẫn mà `action=start` trả về (chưa có `durationSec`), và danh sách media không khử trùng | MEDIUM | ĐÃ SỬA — chỉ bản ghi đã xong mới là media, danh sách khử trùng theo đường dẫn | `HarnessStepView.media.test.tsx` (2 ca) |
| F2 | Phiên `failed` hiện chip `IDLE` ở thanh bên: nhánh ánh xạ gộp mọi trạng thái không phải running/completed thành `idle` | MEDIUM | ĐÃ SỬA — giữ trạng thái thật, `failed` → `loi` → nhãn `ERROR`; **giữ nguyên khung chip cũ và khoá i18n có sẵn**, không đổi thiết kế | `sidebarStatus.test.ts` (3 ca) |
| F3 | `computer_use key <tên sai>` báo thành công: `xdotool` in `No such key name … Ignoring it.` rồi thoát 0 | MEDIUM | ĐÃ SỬA — cảnh báo đó là lỗi, có nêu tên phím sai | `test_sandbox_worker_computer_use.py` (4 ca) |
| F4 | `computer_use` báo đã gửi phím vào cửa sổ không được focus | MEDIUM | ĐÃ SỬA — `type`/`key` kiểm tra cửa sổ đang focus trước, báo `No focused window…` | cùng tệp trên |
| F7 | Thanh ngữ cảnh bỏ qua nén: đọc `step` cuối nên vẫn hiện số **trước** khi nén cho tới lượt sau | MEDIUM | ĐÃ SỬA — event `compression` mới hơn thì thắng | 2 ca mới trong `ContextUsageBar.test.tsx` |

Ghi chú F3: worker được host đọc từ repo và gửi vào box bằng `python3 -c`, nên bản sửa có hiệu lực ngay sau khi harness khởi động lại — không cần dựng lại ảnh container.

### 6.2 Hai lỗi còn nợ của vòng kiểm chứng đợt 7 — ĐÃ SỬA ở đợt 9

| Mã | Lỗi | Trạng thái | Cách sửa và bằng chứng |
|---|---|---|---|
| F5 | `inspect_element` trả `ambiguous_target` khi cửa sổ Chromium khớp nhiều tab, làm agent đốt bước | **ĐÃ SỬA** | Thêm bước chọn **theo trạng thái hiển thị**: khi điểm hình học hoà nhau (nhiều tab CÙNG một cửa sổ), `browser_capture._select_target` hỏi `document.visibilityState`/`hasFocus` của từng ứng viên qua `Target.attachToTarget` và chọn tab tiền cảnh — tất định, trần 24 tab. Nếu vẫn mơ hồ, payload lỗi mang thêm `candidates`/`tabs` (chỉ `targetId`, `title`, `url` — không bao giờ có URL debugger) để agent tự thu hẹp. Live: đúng toạ độ (640,300) trước đây trả `reason: ambiguous_target` với 34 tab `vi.wikipedia.org`, nay trả `{"type":"dom","selector":"#main-content","tag":"div"}`. Test: `VisibleTargetTest` (6 ca), `SafeTabListTest` (2 ca); kiểm ngược: bỏ bước chọn theo hiển thị thì 3 ca đỏ |
| F6 | Desktop trong box bị client kéo nhỏ tận 286×311 qua `Xvnc -AcceptSetDesktopSize` | **ĐÃ SỬA** | Giữ auto-fit, chặn **sàn** kích thước: `capture.ensure_desktop_size()` (gọi trước chụp màn hình, trước `record start`, và trước hit-test của `inspect_element`) + `worker.ensure_desktop_size()` (gọi trước mọi thao tác `computer_use` theo toạ độ). Cỡ đích lấy từ `BOX_SCREEN` (mặc định 1280×800). Khi đặt lại được, payload mang `desktopRestored {from,to}`; khi thất bại, `desktopWarning` (không ném lỗi — ảnh vẫn là ảnh thật). Host ghi cả hai vào nhật ký DEV (`box.desktop_restored` / `box.desktop_warning`). Live: kéo xuống 286×311 rồi chụp → `desktopRestored {'from': '286x311', 'to': '1280x800'}`, ảnh 1280×800; `computer_use click` → cùng ghi chú; log ghi `box.desktop_restored` với `sessionId`/`tool`. Test: `test_sandbox_worker_desktop_floor.py` (7 ca), `DesktopFloorTest` (6 ca), `test_sandbox_executor_desktop_note.py` (5 ca); kiểm ngược: bỏ hàm chặn sàn thì 2 ca đỏ, bỏ chuyển tiếp ghi chú thì 1 ca đỏ |

Ghi chú vận hành: hai bản sửa này nằm trong `deploy/docker/*.py` và `sandbox/worker.py`.
`worker.py` được host truyền vào box theo từng lệnh nên có hiệu lực ngay; còn
`browser_capture.py`/`inspect_element.py`/`capture.py` phải nằm trong **ảnh** container
— lần kiểm chứng này chép tay ba tệp đó vào container đang chạy rồi khởi động lại
`ide-proxy` (không đụng X/Chromium). Lần tạo lại container tiếp theo sẽ lấy đúng các
tệp trong kho.

### 6.3 Chín phát hiện của vòng soát mã đợt 8 — bảy lỗi, một ghi chú, một nit

Nguồn: sub-agent `review`, kết luận REQUEST CHANGES trên chuỗi 11 commit (HEAD `af155e1`).
Toàn bộ được xử lý trong `16eedda`.

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| BUG-32 | Cao | Lượt gọi model thử lại giữ nguyên văn bản đã bỏ: `streamed` tạo một lần cho cả bước, không đặt lại trong vòng retry ⇒ câu trả lời cũ dán vào câu trả lời mới (làm sống lại BUG-26 trên đường retry) | ĐÃ SỬA — `_reset_stream()` đặt lại `content`/`thought` trước mỗi lần thử lại; event `UPSTREAM_RETRY` mang thêm `reset: True` | `test_stream_delta_events.py::test_retry_after_a_partial_stream_drops_the_abandoned_text` (mới, dùng `fail_after=n` của `StreamingModel`) |
| BUG-33 | Cao (an ninh) | Cầu nối quang sai mở luôn **mặt quản trị** của router cho box: cùng một `handler`, mà `/api/router/*` và `/v1/router/generate` chỉ gác bằng header `x-boxfox-admin: 1` (không phải bí mật) + kiểm Origin và `sec-fetch-site` đều lọt khi thiếu header; phần kiểm địa chỉ chỉ chặn `0.0.0.0`/`::` nên địa chỉ LAN/công cộng vẫn qua | ĐÃ SỬA — tai nghe cầu nối chỉ phục vụ bốn đường suy luận (`BRIDGE_PATHS`), mọi đường khác trả 404 kèm dòng `router.bridge_denied`; `isPrivateAddress()` chỉ nhận loopback + dải riêng | 2 ca cầu nối trong `anthropic-ingress.test.mjs`; kiểm ngược: tắt cổng `BRIDGE_PATHS` thì ca đó đỏ |
| BUG-34 | TB | Thông báo `UPSTREAM_RETRY` không có nơi nhận: `applyTimelineEvent` không có nhánh `notice` nên người dùng vẫn thấy lượt đứng im rồi lỗi | ĐÃ SỬA — `HarnessStepView` có nhánh `notice` dùng lại khung chú thích sẵn có, `reset: True` xoá phần đã stream, và bảng sub-agent cũng xoá `thought`/`output` | `HarnessStepView.notice.test.tsx` (2 ca); kiểm ngược: bỏ nhánh `reset` thì ca thứ hai đỏ |
| BUG-35 | TB | Trí nhớ chữ ký suy luận có thể gán nhầm của request khác: khoá là id do router phát, mà nhánh Gemini không có id thì dùng `call_${index}_${Date.now()}` — trùng mili-giây là trùng khoá | ĐÃ SỬA — thêm bộ đếm tăng dần toàn tiến trình vào id dự phòng; ghi rõ vòng đời (mất khi router khởi động lại) trong `anthropic.mjs` | `anthropic-ingress.test.mjs` (khoá chữ ký) |
| BUG-36 | TB | Tham số công cụ không phân tích được thành JSON thì **âm thầm** hoá `{}`: client chạy công cụ không tham số, người dùng thấy lỗi công cụ không giải thích được | ĐÃ SỬA — hàm dựng thân trả lỗi có mã `TOOL_ARGUMENTS_INVALID` (502) nêu tên công cụ và 80 ký tự đầu; đường stream vẫn phát `input_json_delta` thô nên mất mát là hữu hình | ca cũ khoá hành vi mất mát đã được thay bằng 2 khẳng định mới |
| BUG-37 | Thấp | Đọc sai loại lỗi hết giờ: `httpx.ReadTimeout`/`ConnectTimeout` kế thừa `TimeoutException`/`TransportError` chứ **không** phải `TimeoutError` của Python, nên rơi vào nhánh `UPSTREAM_UNREACHABLE: … closed the connection …` — ngược hẳn lời khuyên | ĐÃ SỬA — `_is_timeout()` nhận cả họ `*Timeout`; `UPSTREAM_TIMEOUT` là mã riêng, câu chữ là "did not answer in time", và không thử lại | `test_failure_classification.py` (12 ca) |
| BUG-38 | Nit | `HARNESS_PORT` đọc lúc import: giá trị không phải số làm chết harness bằng `ValueError` trần, và danh sách host cho phép giữ nguyên cổng 3102 khi đã đổi cổng | ĐÃ SỬA — `harness_port()`/`allowed_hosts()` đọc mỗi lần gọi, báo lỗi có tên biến, vẫn giữ cổng mặc định trong danh sách | `test_harness_port_override.py` (4 ca) |

Hai phát hiện được xử lý bằng ghi chú, không bằng mã:

- **#6 (Thấp)** — `_suffix()` không có ngữ nghĩa đặt lại; nay docstring nói rõ một `current` không phải tiền tố nghĩa là provider đã bắt đầu tích luỹ lại, và nơi đọc có móc đặt lại.
- **#8 (ghi chú)** — token router nằm trong argv của `docker exec` phía host (`claude_executor.py`): cố ý, đã có ca khẳng định trong `test_claude_executor.py`.

### 6.4 Hai lỗi vòng kiểm chứng độc lập đợt 9 tìm thêm — ĐÃ SỬA (`65039ae` + đợt này)

Nguồn: sub-agent `testing` (`test-round9-verify`), chạy đúng kịch bản CUA nhẹ → nặng và
delegation trên cây `65039ae`, kết luận `PARTIAL` vì đúng hai lỗi dưới đây.

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| F6b | Cao (làm hỏng hợp đồng) | `deploy/docker/capture.py` gọi `.decode()` lên đầu ra của `_run_as_agent()` — mà hàm này chạy `text=True` nên đầu ra là `str`: nhánh "đặt lại thất bại" ném `AttributeError`, `/__box/capture` và `/__box/record/start` trả **HTTP 500** thay vì trả ảnh kèm `desktopWarning`. Đo sống: `BOX_SCREEN=9999x9999` trên cổng tạm :8099 → `500 {"error": "Lỗi nội bộ."}`, log proxy `AttributeError("'str' object has no attribute 'decode'")` | ĐÃ SỬA — thêm `_output_text()` nhận cả `str` lẫn `bytes`; warning vẫn là `xrandr exit <n>: <200 ký tự đầu>` | `DesktopFloorTest` +3 ca: đầu ra `str` vẫn ra `desktopWarning` (không ném), đầu ra rỗng cho warning sạch, `_output_text` nhận cả hai kiểu |
| F8 | Cao (đốt ngân sách bước) | `worker.py` luôn chạy `xdotool mousemove --sync`; cờ này chỉ trả về khi con trỏ **đổi** vị trí, nên khi con trỏ đã ở đúng toạ độ đích nó chờ hết 15 s (đo trong box: 15.16 s và 15.15 s, so với 0.0 s ở điểm mới), mà lệnh bị cắt ở `timeout=15` ⇒ lần bấm thứ hai vào cùng một chỗ báo lỗi hết giờ. Đây là thứ làm lượt CUA nặng của đợt 7 đốt 20/20 bước rồi `MAX_STEPS` | ĐÃ SỬA — `_pointer_move()` di chuyển **không** `--sync` rồi tự chờ bằng `xdotool getmouselocation` (trần 20 lần × 50 ms); mọi thao tác chuột theo toạ độ đi qua `_pointer_click()` | `test_sandbox_worker_pointer.py` (5 ca): không còn `--sync` ở bất kỳ lệnh nào, bốn thao tác chuột đều di chuyển trước, con trỏ đã đúng chỗ chỉ thăm dò 1 lần, vị trí không khớp dừng sau 20 lần mà vẫn bấm, `type`/`key` không đụng con trỏ |

### 6.5 Hai lỗi lộ ra khi chạy `/claude-code` thật đầu tiên — ĐÃ SỬA (đợt này)

Nguồn: lượt `/claude-code` đầu tiên chạy thật qua cầu nối router (2026-09-20 07:2x–07:4x), sau khi
image được build lại và `status` của executor đã là `ready`.

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| F9 | Cao | Con của lệnh không được truyền `deadlineSeconds`, nên rơi về mặc định **180 giây** của `create_session` — phiên đặt 600 giây vẫn kết thúc `DEADLINE: the turn ran out of time before an answer was produced`, dù ngân sách của phiên còn nguyên | ĐÃ SỬA — `_command_task` truyền ngân sách của **phiên** vào cả hai đường tạo con (`budget = session['config'].get('deadlineSeconds', 180)`), không đẻ thêm hằng số thứ hai | `test_skill_commands.py::test_command_child_inherits_the_session_time_budget` (mới) |
| F10 | Cao | Không đặt `BOXFOX_ANTHROPIC_MODEL` thì CLI tự chọn model mặc định của nó (`claude-opus-5[1m]`), model **không có** trên router BoxFox, nên lượt chết ngay: `There's an issue with the selected model (claude-opus-5[1m])`. Lần chạy thật đầu tiên chết đúng như vậy dù cấu hình `*_DEFAULT_SONNET_MODEL`/`*_DEFAULT_HAIKU_MODEL` đã đúng | ĐÃ SỬA — `router_config()` lấy model sonnet (hoặc haiku) đã cấu hình làm `ANTHROPIC_MODEL` khi biến này trống; giá trị người dùng đặt thẳng vẫn thắng, readiness báo lại qua `models` | `test_claude_worker_router.py::test_the_cli_never_falls_back_to_its_own_default_model` + `::test_cli_environment_carries_the_resolved_model` (mới) |

### 6.6 Tám phát hiện của vòng soát mã đợt 10 — bảy sửa, một ghi nhận (đợt này)

Nguồn: sub-agent `review` đọc `git diff 58598c1..95076b5` (vòng 10). Kết luận chung: **APPROVE WITH
COMMENTS**, điểm rủi ro **3/10** — ba phát hiện mức TB, ba mức Thấp, hai nit. Cả bảy phát hiện cần sửa
đều đã sửa trong đợt này.

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| R10-1 | TB | Nhánh **lỗi** của công cụ web ghi nguyên `str(exc)` vào nhật ký DEV, mà câu đó có cả truy vấn (`no result for '<truy vấn>'`) lẫn URL đầy đủ — trái hợp đồng ở `docs/research/host-web-tools.md` §3, và nút "Copy diagnostics" của bảng nhật ký sẽ mang nội dung người dùng ra khỏi máy. Ca kiểm cũ chỉ khẳng định đường thành công | ĐÃ SỬA — `WebError` mang thêm `log_message` (bản không nội dung); `failures.log_safe_failure()` dùng bản đó và bỏ luôn vết lỗi ở nhánh an toàn; `runtime` ghi `tool.error` bằng bản an toàn; dòng `web.error` thêm `queryChars`/`host` | `test_web_tools.py::test_a_failed_call_never_writes_the_query_or_the_url` (mới), `test_failure_classification.py` +2 ca |
| R10-2 | TB | `ORCHESTRATOR_SOP_GUIDANCE` (runtime.py) vẫn khẳng định "is the ONLY role with browser access, **there is NO web-search tool**", trong khi `roles.py` cùng commit cấp `web_search`/`web_fetch` cho vai gốc — một request vừa nói "không có" vừa quảng cáo hai công cụ đó | ĐÃ SỬA — câu Phase 1 nói đúng: `research` chạm browser **và** hai công cụ host, vai gốc cũng giữ hai công cụ đó | `test_brain_cognition.py::test_the_orchestrator_guidance_matches_the_tools_it_really_holds` (mới) |
| R10-3 | TB | `test_eval_setup.py` khẳng định `pins['repo']['dirty'] is True` kèm chú thích "cây này đang có tệp chưa commit" — cây sạch là bộ kiểm đỏ thêm một ca (vòng soát đo `3 failed, 479 passed`) | ĐÃ SỬA — ca cũ chỉ khẳng định **được đo** và đúng kiểu; thêm ca dựng repo tạm để kiểm cả cây sạch lẫn cây bẩn | `test_eval_setup.py::test_repo_state_sees_an_uncommitted_file_and_says_so` (mới); bộ kiểm nay `2 failed, 488 passed` — hai ca đỏ còn lại là hai ca cũ phụ thuộc môi trường |
| R10-4 | Thấp | `reset --file all` chạy qua cả `*.previous.jsonl`, nên `harness.previous.jsonl` bị đổi thành `harness.previous.previous.jsonl` — trái lời hứa "đúng một tệp previous" ở docstring và trợ giúp CLI | ĐÃ SỬA — bỏ qua tệp đã là previous; tệp đang ghi vẫn được xoay **thay** bản previous cũ | `test_system_log.py::test_cli_reset_all_leaves_exactly_one_previous_file` (mới) |
| R10-5 | Thấp | Chuỗi nhà cung cấp tìm kiếm chỉ bắt `WebError`, nên nhà cung cấp trả **200 với thân không phải JSON** làm đứt cả chuỗi (đo được: firecrawl trả `200 text/html` là trang chặn, Brave chưa từng được gọi) | ĐÃ SỬA — mỗi nhà cung cấp còn bắt `ValueError`/`KeyError`/`TypeError` và kiểm kết quả phải là danh sách; lỗi được ghi vào danh sách lý do rồi đi tiếp | `test_web_tools.py::test_the_provider_chain_survives_a_challenge_page` (mới) |
| R10-6 | Ghi chú | `web_fetch` là kênh GET ra ngoài do cả `orchestrator` lẫn `research` giữ: một trang bị tiêm nhiễm có thể xúi agent tải `https://ke-tan-cong/?<ngữ cảnh>` — chiều **rò ra**, khác chiều nội dung bẩn vào | ĐÃ GHI NHẬN — thêm dòng "Rủi ro còn lại: kênh ra" vào `docs/research/host-web-tools.md` §3 kèm cách siết (bỏ `web_*` khỏi vai gốc, hoặc danh sách đích cho phép). Chưa đổi quyền vì chủ sở hữu đã chốt phương án này | `docs/research/host-web-tools.md` §3 |
| R10-7 | Nit | `worker.py` xác nhận con trỏ tới nơi bằng `f'X={x}' in out`, nên đích `(64, 3)` gặp con trỏ thật ở `(640, 300)` là "tới nơi" ngay | ĐÃ SỬA — so khớp theo dòng `X=<số>`/`Y=<số>` | `test_sandbox_worker_pointer.py::test_a_prefix_of_the_real_coordinates_does_not_count_as_arrival` (mới) |
| R10-8 | Nit | `scripts/eval/README.md` §2 ghi "Thêm **hai** biến kết nối" nhưng liệt kê bốn tên | ĐÃ SỬA — sửa thành "bốn biến" | `scripts/eval/README.md` §2 |

### 6.7 F-1 — trần 1 MiB của router làm chết nhiệm vụ CUA nặng — ĐÃ SỬA (đợt này)

Nguồn: vòng kiểm chứng độc lập đợt 10, ca T21 (nhiệm vụ nặng để mô hình tự chọn chụp màn hình
giữa các bước). Đây là lỗi **có sẵn**, không nằm trong diff của vòng 10 — nhưng nó chặn đúng
hạng mục "CUA nhẹ → nặng" mà chủ sở hữu yêu cầu, nên được sửa luôn.

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| F-1 | Cao (chặn nhiệm vụ dài) | Router từ chối thân request trên **1 MiB** (`router/src/server.mjs:27`), mà mỗi lần chụp màn hình được nhét vào thân dưới dạng base64 và `ContextCompressor` chỉ đếm **token** nên không bao giờ thấy trần byte. Đo được (lượt rút ảnh): thân request 1 107 315 ký tự, trong đó **1 018 908 ký tự là ảnh base64** (mỗi ảnh 77–104 KB); mọi lượt gọi sau đó chết với `UPSTREAM_HTTP_413: Request is too large.` — tái hiện 3 lần (một phiên chết ở bước 11, một phiên mới chết sau 4 ảnh) | ĐÃ SỬA — `runtime.bound_inline_media()` giữ ảnh của **2 lần chụp mới nhất** và tổng tối đa **512 KB** trong thân request; ảnh cũ rút về phần chữ đi kèm (vẫn còn đường dẫn tệp). Bản lưu trong store không đổi, nên giao diện chat vẫn thấy mọi ảnh. Áp tại `RouterClient.complete()` — nơi duy nhất dựng thân request — và ghi `model.media_pruned` khi có ảnh bị rút | `test_inline_media_bound.py` (9 ca): không ảnh thì trả nguyên danh sách; 5 ảnh → chỉ 2 ảnh cuối còn inline, phần chữ giữ đường dẫn; danh sách gốc không bị sửa; trần byte thắng trần số lượng; 12 ảnh 90 KB: thân trước 1 107 315 B > 1 MiB, sau khi rút < 1 MiB |
| F-1b | Cao (phát hiện khi đo lại trên `fa57325`) | Sau khi đã chặn ảnh, thân request vẫn **vượt trần 17 382 B** (1 739 044 B so với 1 048 576 B) vì chữ ký suy luận của Gemini bị nhân đôi thành `thought_signature` **và** `thoughtSignature` trong cùng một `tool_call`. Đo trên năm phiên lớn nhất: riêng cặp chữ ký chiếm **761 888 B** ở phiên nặng nhất, 380 944 B ở phiên 1,8 MB; không có đường nào tỉa phần này | ĐÃ SỬA — `runtime.dedupe_thought_signatures()` chỉ giữ `thought_signature` trong bản gửi đi và trả về số ký tự đã bỏ; transcript lưu trong store không bị sửa. Chạy trong `RouterClient.complete()`, ghi `model.signature_deduped` kèm `chars` | `test_inline_media_bound.py`: ba ca cho hàm này (cặp trùng bị gộp, chỉ một khoá thì giữ nguyên, danh sách gốc không bị sửa) |
| F-1c | Cao (chặn nhiệm vụ dài, cùng gốc) | Trần của router là **byte**, ngân sách của `ContextCompressor` là **token** — hai thước đo không bao giờ gặp nhau, nên vẫn còn đường vượt trần khi không tin nhắn cũ nào đủ lớn để lộ ra. Đo trên phiên `584d61c8` (25 bước, chết ở bước 25): thân đầy đủ **1 754 163 B**; sau khi bó ảnh và gộp chữ ký còn **1 060 902 B — vẫn quá trần 12 326 B**, mà danh sách `messages` khi đó chỉ 1 043 364 B, nên phép đo cũ (chỉ nhìn `messages`) không bao giờ thấy phần vượt. Phần lớn khối lượng nằm ở chữ ký trong `tool_calls` (1 387 656 B) và `thought` (60 914 B), không phải ở `content` | ĐÃ SỬA — `runtime.shrink_request_to_budget(body, messages)` đo **cả thân request** (prompt vai + lược đồ công cụ + tham số), rồi hạ theo thứ tự ít mất mát nhất, dừng ngay khi vừa ngân sách **900 KB**: cắt chữ cũ → bỏ `thought` cũ → rút tham số `tool_calls` cũ (giữ nguyên `id` và tên công cụ, nên cặp gọi/kết quả vẫn khớp) → giữ 1 ảnh chụp mới nhất → bỏ nốt ảnh → **bỏ hẳn lượt gọi cũ nhất** (lượt giảm duy nhất không bị chặn bởi khối lượng một lượt: Gemini từ chối lượt gọi bị mất chữ ký, nhưng lượt gọi không nằm trong request thì không cần chữ ký — phần đuôi `LIVE_TAIL = 8` tin nhắn và mọi tin nhắn `user` không bao giờ bị đụng). Chỉ đụng phần lịch sử trước bước đang chạy, không sửa transcript; ghi `model.request_trimmed` mức `warn` kèm `chars` và `phase`. `request_body_bytes()` nay dựng thân bằng đúng lời gọi `httpx` dùng cho `json=` nên số đo là `Content-Length` thật của router | `test_inline_media_bound.py` (**19 ca**): đo cả prompt + lược đồ công cụ; thứ tự ít mất mát nhất; cặp gọi/kết quả giữ `id`; ảnh mới nhất là thứ bị bỏ cuối cùng; ca tái hiện hình dạng thật của phiên chết vì 413; và ca nhiệm vụ 30 bước liên tục chụp màn hình — thân thô 5 537 602 B nhưng thân gửi đi luôn dưới trần (886 254 B ở bước cuối) |

| F-1f | Trung bình (nén sớm, tốn lượt gọi; đo được) | Ước lượng ngữ cảnh đếm **hai lần** cùng một chữ ký suy luận: một phản hồi Gemini mang cùng giá trị dưới hai tên (`thought_signature` và `thoughtSignature`) và bản lưu giữ cả hai, nên mỗi lượt gọi bị tính gấp đôi. Diễn lại các phiên lưu trữ: `9ec9bf1d` **1 075 446** và `08f2483c` **1 051 631** token, trong khi nhà cung cấp chỉ tính **358 771** token đầu vào cho cùng request | ĐÃ SỬA — `compression._one_signature()` bỏ tên thứ hai khi đếm (router cũng chỉ nhận một bản qua `runtime.dedupe_thought_signatures()`); cùng hai phiên đó nay còn **576 592** và **509 005** token, tức nằm dưới ngưỡng nén 697 132 — nhiệm vụ nặng không còn bị nén sớm vì một kích thước không có thật | `backend/tests/unit/test_context_estimate.py` (10 ca, thêm 2): chữ ký trùng chỉ được đếm một lần; transcript không chữ ký giữ nguyên công thức cũ |
| F-1g | Thấp (đúng đắn của request, cùng gốc) | `_drop_oldest_round()` duyệt kết quả công cụ của một lượt **không có biên**, nên lượt cũ nhất có thể kéo cả những quan sát mới nhất vào tập bị bỏ — trái với chính docstring của nó. Không thể chỉ cắt phần đuôi: một lượt phải đi cùng kết quả của nó, nếu không request còn lại kết quả mồ côi | ĐÃ SỬA — vòng lặp ưu tiên lượt nằm **trọn vẹn** ngoài `LIVE_TAIL`; lượt vắt qua ranh giới chỉ được dùng khi không còn lượt nào khác, và khi đó cả cặp vẫn đi cùng nhau | `backend/tests/unit/test_inline_media_bound.py` (21 ca, thêm 2): lượt cũ nhất đi cùng kết quả, đuôi nguyên vẹn, không có kết quả mồ côi; lượt vắt qua ranh giới vẫn hợp lệ |
| F-1e | Cao (chặn nhiệm vụ dài, cùng gốc) | Nhiệm vụ CUA chỉ có **một** lời nhắc, nên `ContextCompressor.compact()` tìm thấy `cut = users[-1] = 1`, không tỉa được gì và kết lượt bằng `CONTEXT_LIMIT: current turn/tools exceed the context budget` — đo trên phiên `9ec9bf1d` (66 tin nhắn, ước lượng **1 075 446** so với trần chết 995 904). Bản cũ còn đẩy **toàn bộ** lịch sử vào lượt tóm tắt (~900 KB, ~250k token) nên nhà cung cấp trả 90 giây và lượt chết ở nhánh `CONTEXT_LIMIT: summary failed`; và phép tỉa khẩn cấp coi `str(content)` của một ảnh chụp là "kết quả công cụ dài", thay chính ảnh mới nhất — thứ mô hình đang nhìn — bằng `[Tool output truncated to fit context budget.]` | ĐÃ SỬA — `compact()` gộp chính phần giữa của nhiệm vụ khi lịch sử chỉ có một lời nhắc: tiền tố hệ thống, lời nhắc và `MISSION_TAIL = 10` tin nhắn mới nhất giữ nguyên, và điểm cắt không bao giờ tách kết quả công cụ khỏi lời gọi sinh ra nó. Đầu vào cho lượt tóm tắt do `summarizer_material()` dựng: ảnh thành `[inline capture left out of the summary input]`, bỏ chữ ký và khối lớn, và lấy mẫu đều khi vượt `SUMMARY_INPUT_CHARS = 120 000`; phép tỉa một ảnh chụp nay giữ phần chữ và bỏ phần ảnh; lượt tỉa khẩn cấp không còn đi qua phần đuôi đang chạy | `backend/tests/unit/test_context_estimate.py` (8 ca, thêm 4): nhiệm vụ một lời nhắc được gộp thay vì chết; đầu vào tóm tắt phẳng và bị chặn; lịch sử ngắn đến tay bộ tóm tắt nguyên vẹn; tỉa ảnh cũ giữ chữ và không đụng ảnh mới nhất. **Diễn lại phiên thật `9ec9bf1d`**: `beforeEstimate 1075446 → afterEstimate 314771`, đầu vào tóm tắt từ ~900 KB còn **15 397 ký tự** |
| F-1d | Cao (chặn nhiệm vụ dài, cùng gốc) | Ước lượng ngữ cảnh đếm **ảnh base64 như chữ**, nên phiên `08f2483c` bị ước lượng **1 051 631** token trong khi router báo **358 771** token đầu vào cho cùng request; `before` vượt `context_window - output_reserve`, và khi lượt tóm tắt gặp 429 / hết 90 giây thì bộ nén đi vào nhánh duy nhất làm chết cả lượt: `CONTEXT_LIMIT: summary failed` | ĐÃ SỬA — `compression.estimate_tokens()` thay mỗi phần ảnh inline bằng một khoản `IMAGE_TOKEN_ALLOWANCE = 1600` (cách nhà cung cấp tính token ảnh) và cộng khoản đó vào ước lượng chữ; cùng phiên đó nay còn **952 417** | `backend/tests/unit/test_context_estimate.py` (4 ca): ảnh 400 KB không được tính theo base64; ảnh to hơn không kéo ước lượng lên; transcript không ảnh giữ nguyên công thức cũ |

Ghi chú kèm theo (không sửa trong đợt này): `RouterClient` vẫn gắn cứng `http://127.0.0.1:3101`
(không có biến môi trường), và trần 1 MiB của router cũng không cấu hình được — vòng kiểm chứng
phải dựng một bản router sao 128 MiB ở cổng khác để chứng minh rằng đổi trần **một mình** không
giải quyết được gì, vì đường gọi không đi qua đó.

### 6.8 Ba việc chủ sở hữu giao tối 2026-09-20 (đợt 13) — ĐÃ SỬA (đợt này)

Nguồn: chủ sở hữu giao bốn việc lúc 14:28 UTC kèm hai ảnh chụp (`3066.png` — chat đỏ
`Agent request failed / Not found`, chip `DeepSeek Low`; `3067.png` — hàng nhà cung cấp
`DeepSeek: DeepSeek Pro Latest`, `Passed · 6990 ms`). Ba việc dưới đây là ba lỗi tìm thấy khi làm.

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| T-1 | Cao (mọi lượt gọi model mới đều chết) | `frontend/src/store/harnessStore.ts` gắn cứng `thinkingLevels: ['low','medium','high']` cho `AVAILABLE_MODELS` và mức mặc định của bộ chọn là `'medium'`, nên **mọi** lượt gửi đều mang `thinkingLevel: 'medium'`. Model `~deepseek/deepseek-pro-latest` chỉ công bố `['max','high','low']`, và `runtime.resolve_thinking_level()` từ chối đúng như thiết kế: `POST /api/agent/sessions` trả **`THINKING_LEVEL_UNSUPPORTED: model publishes max/high/low; requested medium`**, không có id phiên — đúng ảnh chụp của chủ sở hữu. Cùng hình dạng đó ở tám model khác đã đo (`~deepseek/deepseek-flash-latest`, `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4-flash-vision-exp`, `deepseek/deepseek-v4-pro-0813`, `~deepseek/deepseek-v4-flash-latest`, `deepseek/deepseek-v4-flash-0731`, và `gemini-3.5-flash-lite` sau này) | ĐÃ SỬA — tệp mới `frontend/src/lib/harnessThinking.ts` là nguồn duy nhất quyết định mức: khớp đúng thì giữ nguyên chính tả của nhà cung cấp; mức lạ thì lấy mức công bố đầu tiên; còn lại lấy mức **gần nhất theo hạng**, hoà thì chọn mức **thấp hơn**. `harnessChatStore.send()` nhận thêm tham số `thinkingLevels` thứ sáu và chỉ gắn `thinkingLevel` khi có giá trị; `ChatPanel` truyền `thinkingLevels` công bố của model đang chọn; `HarnessModelPicker` có `useEffect` kéo mức đang chọn về mức công bố khi model đổi; `harnessStore` mở kiểu thành `string` vì nhà cung cấp còn công bố `max`/`xhigh` | `frontend/src/lib/harnessThinking.test.ts` (9 ca), `frontend/src/store/harnessChatStore.retry.test.ts` (2 ca đầu: `medium` → `low` đúng tuyến đường đã lưu; giữ `high` khi model công bố; giữ nguyên khi model không công bố gì). **Xác minh sống qua giao diện**: chip đọc `DeepSeek Low`, phiên `c7cb1e8f` lưu `route.thinkingLevel = "low"`, lượt trả `assistant {"text": "2+2 = 4."}` + `finish {"status":"completed"}` |
| T-2 | Cao (chat hỏng vĩnh viễn, không tự gỡ) | `backend/src/agentbox/api/server.py:75` có `except KeyError: return {'error': 'Not found'}, 404`, nên **mọi** `KeyError` — id phiên không tồn tại, khoá thiếu trong payload, bất cứ thứ gì — đều thành một chữ `Not found` trần. `frontend/src/lib/agentApi.ts` ném `Error('Not found')` **không mã**, `harnessChatStore` rơi vào `catch → status:'failed', error: String(error)`, và id chết vẫn nằm trong `localStorage` (`boxfox-harness-session:<chatId>`) nên **mọi lần gửi sau đều hỏng lại** — đúng ảnh `3066.png` | ĐÃ SỬA — lớp mới `ApiError(code, message, status)` + `missing_session(sid)` trả `SESSION_NOT_FOUND` kèm chính id và lý do (`session <id> is not known to this harness; it was deleted or the harness started with an empty store`); `except KeyError` nay ghi `logger.exception` và trả **500** `INTERNAL_ERROR` kèm `method`/`path`, không còn giả vờ 404; `known_session()` kiểm id **trước** `runtime.submit` ở cả ba tuyến `session`/`turn`/`stop`; `agentApi` giữ mã máy trong câu lỗi; `send()` gặp `SESSION_NOT_FOUND` thì xoá id hỏng và **mở phiên mới rồi gửi lại đúng một lần** | `backend/tests/unit/test_session_lifecycle.py` +2 ca (id lạ → 404 `SESSION_NOT_FOUND` ở cả ba tuyến; `KeyError` nội bộ → 500 `INTERNAL_ERROR` có tên khoá); `frontend/src/store/harnessChatStore.retry.test.ts` (2 ca: `SESSION_NOT_FOUND` mở phiên mới và gửi lại đúng một lần, `turnCalls == ['/sessions/dead-sid/turns','/sessions/fresh-sid/turns']`, `error` ở lại `null`; `UPSTREAM_HTTP_429` **không** tạo phiên nào và gửi đúng một lần). **Đo lại trên harness mới**: `GET/POST turn/POST stop` trên id `deadbeef…` đều trả 404 `{"error": "SESSION_NOT_FOUND: session deadbeef… is not known to this harness; …", "code": "SESSION_NOT_FOUND"}` (trước khi sửa: `{"error": "Not found"}`) |
| R-1 | Cao (một lần 429 là mất cả lượt; còn tốn gấp đôi lượt gọi) | Chính sách cũ có **đúng một** lần thử lại, `asyncio.sleep(1.5)`, gated bởi `failures.is_transient()` — mà hàm này chỉ khớp `status >= 500`, nên **429 không bao giờ được thử lại**: một lần chạm hạn mức nhà cung cấp là kết thúc lượt ngay, không backoff, không jitter, không đọc `Retry-After`, không ngân sách chờ, không đếm lần thử nào hiện ra cho người dùng. Ngược lại, `RouterClient.complete()` có `except Exception:` gọi bản không-stream **vô điều kiện**, nên một lần 429 ở đường stream thành **hai** lượt gọi nhà cung cấp liền nhau. Siêu dữ liệu lỗi của router (`error.code`, `error.retryable`, `error.retryAfterMs`) bị bỏ hết khi câu lỗi bị làm phẳng thành `RuntimeError(f'Router HTTP {status}: {message}')` | ĐÃ SỬA — `failures.retry_advice()` là **một** điểm quyết định duy nhất: tối đa 3 lần thử lại, hạng 429 chờ `Retry-After` với sàn 2 s và trần 30 s, hạng 5xx/đứt stream đi 1 s → 4 s → 12 s ± 20 % jitter, ngân sách chờ mỗi lượt 60 s, cửa sổ còn lại tối thiểu 5 s; `is_transient()` nay chính là `retry_advice(...) is not None`. `runtime.router_refusal()` giữ `router_status`/`router_code`/`retryable`/`retry_after_ms` trên ngoại lệ; nhánh không-stream chỉ chạy khi **không** có phán quyết router dưới 500 (nên 429 không còn bị gọi đôi); vòng bước ghi `UPSTREAM_RETRY` (kèm `attempt`, `maxRetries`, `waitMs`, `reason`) và `UPSTREAM_RETRY_EXHAUSTED` (kèm `attempts`, `waitMs`); băng lỗi cuối lượt nay nêu `[after 3 retries in 7.0s]` | `backend/tests/unit/test_retry_policy.py` (**13 ca**): 429 tôn trọng `Retry-After` 9 s và sàn 2 s và trần 30 s; 5xx/stream theo hệ số; 4xx (`400`, `404`, `PermissionError`) không bao giờ thử lại; `TimeoutError`/`UPSTREAM_TIMEOUT` không thử lại; hết số lần / hết ngân sách / hết cửa sổ thì dừng; `is_transient` nay đúng với 429; và ba ca chạy **lượt thật** (hai 429 rồi thành công → 3 lượt gọi, thông báo `attempt == [1,2]`, `finish completed`; bỏ cuộc sau `DEFAULT_MAX_RETRIES` → 4 lượt gọi, `UPSTREAM_RETRY_EXHAUSTED` với `attempts == 3`; 400 hỏng ngay lượt đầu, không thông báo). Thiết kế: `docs/plan/retry-policy.md` |

### 6.9 Vòng soát mã đợt 13 (8 phát hiện) và một lỗi sống mới gặp khi nhập khoá Google — ĐÃ SỬA (đợt này)

Nguồn thứ nhất: sub-agent `review` đọc `git diff main...HEAD` của đợt 13 (`f8eade5`, 16 tệp,
+946/−62). Kết luận **Ship with mitigations**, điểm rủi ro **5/10**. Tám phát hiện, cả tám đã sửa.
Nguồn thứ hai: lượt gửi thật đầu tiên trên `Google Gemini · Gemini 2.5 Flash` sau khi nhập khoá
Google (đợt 14) — chat đỏ `UPSTREAM_HTTP_400 … Thinking level is not supported for this model.`

| Mã | Mức | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| R14-1 | Cao (bản sửa T-2 không có tác dụng) | `harnessChatStore.send()` khi gặp `SESSION_NOT_FOUND` chỉ ghi id mới vào `localStorage`, còn **mọi** nơi đọc lại ưu tiên `sessions[chatId].id` — nên vòng poll 1200 ms và lượt gửi kế tiếp vẫn nhắm id đã chết: khung chat ở lại `failed`, và mỗi lần gửi lại còn chạy thêm một lượt mồ côi ở nhà cung cấp. Đo sống trước khi sửa: xoá phiên `68f7ed66…` rồi gửi lại → `localStorage` đã đổi sang `2c4b34de…` và phiên mới **đã trả lời**, nhưng giao diện vẫn hiện băng đỏ `Agent request failed / session 68f7ed66… was deleted…` | ĐÃ SỬA — sau `id = await openSession()` ghi luôn vào store (`sessions[chatId] = { …current, id, error: null }`) trước `submitTurn`, nên poll và lượt sau dùng id mới | `frontend/src/store/harnessChatStore.retry.test.ts` ca phiên cũ nay khẳng định `sessions[CHAT].id === 'fresh-sid'`, `error === null`, `turnCalls == ['/sessions/dead-sid/turns','/sessions/fresh-sid/turns']`, và **không lời gọi nào sau lượt gửi lại trỏ vào id chết**. **Xác minh sống sau khi sửa** (xoá phiên và gửi trong cùng một nhịp): `DELETE …/18358f20` → `POST …/18358f20/turns` **404** → `POST /api/agent/sessions` → `POST …/e197d82a/turns`; khoá `boxfox-harness-session:session-mu9yhydm` = `e197d82a…`; 0 lời gọi về id chết sau khi tạo phiên mới; màn hình không còn băng đỏ (`r14_stale_recovery_after.png`, đối chiếu `r14_stale_before.png`) |
| R14-2 | Trung bình (dọn dẹp không bao giờ chạy) | `refresh()` dọn chat chết theo **câu chữ** `errStr.includes('404') \|\| errStr.includes('not found')`, mà T-2 vừa đổi câu lỗi thành `SESSION_NOT_FOUND: … is not known to this harness …` — nhánh dọn thành mã chết | ĐÃ SỬA — nhánh dọn nay hỏi `isStaleSession(error)` (khớp mã) và vẫn giữ hai phép khớp cũ cho lỗi cũ; đồng thời xoá cả `storageKey(chatId)` lẫn `storageKey(id)` khi dọn | `harnessChatStore.retry.test.ts` hai ca mới: `SESSION_NOT_FOUND` dọn im lặng và xoá khoá `localStorage`; câu chữ cũ `'Not found'` vẫn dọn. **Sống**: sau khi xoá phiên, vòng poll tự dọn và lần gửi kế tiếp mở phiên mới ngay (`r14_stale_purge_after.png`) |
| R14-3 | Trung bình (lọt đúng lỗi T-1 qua đường alias) | Tuyến alias không mang `thinkingLevels`, nên `resolveThinkingLevel(undefined, 'medium')` trả nguyên `medium` và mức đó đi thẳng tới một model chỉ công bố `max/high/low` — đúng thứ T-1 vừa chặn cho model trực tiếp | ĐÃ SỬA — `RouterTestChat.routerChatOptions()` gắn `thinkingLevels` cho mỗi alias bằng **giao** mức của mọi đích (`aliasThinkingLevels`), trả `undefined` khi có đích không công bố mức nào hoặc giao rỗng; `send()` chỉ gắn mức cho tuyến alias khi biết mức | `frontend/src/components/panels/routerChatOptions.test.ts` (3 ca: giao hai đích; một đích không công bố → trống; hai đích không mức chung → trống); `harnessChatStore.retry.test.ts` +2 ca (alias không biết mức → tuyến không có `thinkingLevel`; alias biết `low/medium/high` → gửi `medium`) |
| R14-4 | Thấp (đổi 404 thành 500) | `GET /api/agent/skills/<lạ>/readiness` rơi vào `except KeyError` mới của T-2 nên trả **500 `INTERNAL_ERROR`** thay vì 404 như trước | ĐÃ SỬA — tuyến `readiness` kiểm `sid not in runtime.catalog.items` trước và ném `ApiError('SKILL_NOT_FOUND', …, 404)` | `backend/tests/unit/test_session_lifecycle.py` ca mới: tên kỹ năng lạ → 404 `SKILL_NOT_FOUND` kèm tên |
| R14-5 | Thấp | `retryable: false` do router gửi kèm bị giữ lại nhưng **không** được dùng: một lỗi 425 mà chính router đã thử lại vẫn bị harness thử lại | ĐÃ SỬA — `_retry_reason()` đọc `exc.retryable`: `False` là phán quyết cuối, trừ 429 và họ mã hạn mức (`RATE_LIMIT`/`CAPACITY`/`UPSTREAM_HTTP_429`) vẫn thử lại được | `test_retry_policy.py::test_a_router_verdict_of_retryable_false_stops_the_retry` |
| R14-6 | Thấp | `UPSTREAM_RETRY_EXHAUSTED` luôn nói "gave up after N retries" kể cả khi lý do là hết ngân sách chờ hoặc hết cửa sổ lượt — câu chữ sai ở đúng chỗ người dùng đọc để hiểu vì sao lượt chết | ĐÃ SỬA — `failures.stop_reason()` trả `permanent/attempts/budget/window`; thông báo chọn câu theo lý do (`the per-turn retry budget of 60s is spent` / `too little turn time left for another attempt`) và mang thêm trường `stopReason` | `test_retry_policy.py::test_stop_reason_names_why_the_loop_gave_up` (5 khẳng định) + ca bỏ cuộc khẳng định `stopReason == 'attempts'` |
| R14-7 | Thấp | Hai lỗi nhỏ cùng gốc "một lượt gọi lại không miễn phí": (a) một 5xx vẫn đi qua nhánh không-stream nên thành **hai** lượt gọi nhà cung cấp; (b) bộ chọn lọc `thinkingLevels.length > 1` nên model chỉ công bố **một** mức bị coi như không có mức, trong khi `ChatPanel` đọc danh sách thô — chip đọc `Medium` mà tuyến gửi `high` | ĐÃ SỬA — (a) nhánh không-stream chỉ chạy khi router **không** đưa ra phán quyết nào (`verdict is not None → raise`); (b) cả hai chỗ lọc nay dùng `length > 0`, và `ChatPanel` tính `effectiveLevel` từ danh sách mức công bố rồi in đúng mức sẽ gửi | `test_retry_policy.py` (ca 4xx/429 khẳng định số lượt gọi) + `harnessChatStore.retry.test.ts` ca "model chỉ công bố `['high']` thì gửi `high`" |
| R14-8 | Thấp–Trung bình (chất lượng kiểm) | Ba lỗ hổng của bộ kiểm: ca phiên cũ trả **mọi** GET lành nên không thể bắt R14-1; `test_spent_deadline_never_retries` chỉ khẳng định lại nhánh mặc định; cổng chặn gọi đôi của R14-7a không có ca nào | ĐÃ SỬA — tệp kiểm viết lại: một sổ `deadSessions` để id chết **thật sự** trả 404, khẳng định theo từng tuyến đường (`turnCalls`), thêm ca model một mức, ca alias, hai ca dọn phiên, và ca nhánh không-stream; `test_spent_deadline_never_retries` nay phân biệt `TimeoutError`/`UPSTREAM_TIMEOUT`/`ReadTimeout` (không thử lại) với `ServerDisconnectedError` (thử lại, `reason: 'stream'`) | `harnessChatStore.retry.test.ts` 10 ca; `test_retry_policy.py` 18 ca |
| T-3 | Cao (mọi lượt trên họ Gemini 2.5 đều chết) | Danh mục của router quảng cáo `thinkingLevels: ['low','medium','high']` cho **cả** họ Gemini 2.5, Gemma và `gemini-3.5-transcribe` (`router/src/providers/gemini.mjs` đọc cờ `thinking: true` của `models.list`), nhưng API Google **từ chối** `generationConfig.thinkingConfig.thinkingLevel` cho các model đó: `400 INVALID_ARGUMENT: Thinking level is not supported for this model.` Lượt gửi thật đầu tiên trên `Google Gemini · Gemini 2.5 Flash` chết đúng như vậy (`UPSTREAM_HTTP_400`, chat đỏ), và T-1 khiến mức luôn được gửi kèm. Đo trực tiếp trên endpoint Google (2026-09-20, 12 model): nhận mức — `gemini-flash-lite-latest`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3.8-flash`; từ chối — `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemma-4-31b-it`, `gemini-3.5-transcribe`, `antigravity-preview-09-2026`, `deep-research-preview-04-2026`. Đây là lỗi **của mã**, không phải của model (model yếu hay mạnh đều trả cùng 400) | ĐÃ SỬA (phần harness) — `failures.level_refusal()` nhận đúng lớp lỗi này (chỉ 4xx, và câu lỗi phải nói về mức); vòng bước trong `runtime` gặp nó thì **bỏ `thinkingLevel` khỏi route và gọi lại ngay**, phát thông báo `THINKING_LEVEL_REFUSED` (kèm `level`, `model`) và **không** tính vào số lần thử lại vì đây là sửa yêu cầu chứ không phải chờ nhà cung cấp. Danh mục phía router vẫn quảng cáo thừa mức cho họ 2.5 — việc của router, xem ghi chú dưới | `backend/tests/unit/test_retry_policy.py` +3 ca: lượt bị từ chối mức vẫn `completed` sau **2** lượt gọi, lượt thứ hai không kèm `thinkingLevel`, không có sự kiện `error`, đúng một thông báo `THINKING_LEVEL_REFUSED`; một 400 khác (JSON sai) vẫn chết ngay lượt đầu; `level_refusal` bỏ qua 429/5xx nhắc tới chữ "thinking" |

Ghi chú kèm theo (chưa sửa trong đợt này, thuộc phần `router/`): `GEMINI_THINKING_LEVELS` được
gắn cho mọi model có `thinking: true`, nên họ Gemini 2.5 vẫn hiện nút mức trong bộ chọn và mỗi
lượt lại tốn thêm **một** lượt gọi bị từ chối trước khi harness bỏ mức. Hợp đồng model record
(`router/CONTRACT.md` §Model record) cấm suy đoán theo tên model, nên cách sửa đúng là để adapter
Gemini dịch mức thành `thinkingBudget` cho họ 2.5 hoặc chỉ công bố mức khi có bằng chứng provider —
cần một vòng riêng cho router.

#### 6.9.1 Đo lại T-3 trên giao diện thật, và một cái bẫy vận hành gặp phải khi đo

Lần đo đầu trên cổng 3102 **vẫn đỏ** dù mã đã sửa: tiến trình harness đang chạy được dựng lúc
**15:00:45**, còn ba tệp của bản sửa (`failures.py`, `runtime.py`, `server.py`) được ghi lúc **15:23:10**
— tức là tiến trình cũ nạp mã đợt 13. Đây là bẫy vận hành, không phải lỗi mã: **phải dựng lại harness
sau mỗi lần sửa backend**, nếu không thì mọi phép đo sống đều đo mã cũ.

Sau khi dựng lại (`kill 828038` → `nohup .venv/bin/python scripts/run-harness.py`, log
`/var/tmp/r10/harness_r14.log`, pid **858826**, cây làm việc sạch tại `d03dce7`), cùng một khung chat
`gemini-2.5-flash` + mức `low` (phiên `c7cb1e8fe0244029bae315bd729335bd`) cho chuỗi sự kiện:

| Lượt | Sự kiện | Kết quả |
|---|---|---|
| 15:45 (mã cũ) | `step {iteration:1}` → `error {code: UPSTREAM_HTTP_400, "… Thinking level is not supported for this model."}` | chat đỏ, **không** có thông báo bỏ mức — đây là ảnh \"trước\" |
| 15:47 (mã mới) | `step {iteration:1}` → `notice {code: THINKING_LEVEL_REFUSED, level: \"low\", model: \"gemini-2.5-flash\"}` → `assistant_delta` → `usage` → `assistant \"2+2=4.\\n5+7=12.\"` → `finish {status: completed}` | **không** sự kiện `error`, `status: completed` |

Bằng chứng ảnh `/code/.generated_artifacts/images/r14_thinking_refused_ui_after.png` chứa **cả hai**
lượt trong một khung: lượt 15:45 là băng đỏ, lượt 15:47 là thông báo `UPSTREAM_HTTP_400: the provider
does not accept the thinking level "low" for this model — retrying without it (…)` rồi dòng trả lời
`gemini-2.5-flash  done · 4.3k | 14` — một cặp trước/sau trên đúng giao diện thật.

Ghi nhận thêm (chấp nhận được, chưa cần sửa): việc bỏ mức là **theo từng lượt**, không ghi vào cấu hình
phiên. Lượt thứ hai (15:48, hỏi `3+3`) lại phát `THINKING_LEVEL_REFUSED` và `route` của phiên vẫn ghi
`thinkingLevel: \"low\"`. Như vậy mỗi lượt trên họ Gemini 2.5 vẫn tốn **một** lượt gọi bị từ chối —
đúng chi phí đã ghi ở ghi chú trên, và cách chữa gốc vẫn là sửa danh mục phía `router/`. Chọn giữ
hành vi này vì phương án còn lại (tự xoá mức đã chọn của người dùng khỏi cấu hình phiên) là **âm thầm
đổi ý định của người dùng** chỉ vì một lỗi danh mục — khi router được sửa thì mức phải có tác dụng trở lại.

### 6.10 Gán đúng điều khiển thinking theo model ở router — ĐÃ SỬA (đợt này)

Nguồn: chủ sở hữu yêu cầu đo lại mức thinking cho họ flash rồi "tra tài liệu Google AI Studio để kiểm tra
và gán vào theo model". Gốc là ghi chú cuối §6.9: adapter Gemini gắn **một** danh sách mức cho mọi model
có cờ `thinking: true` của `models.list`.

**Tài liệu (đọc ngày 2026-09-20)** — `ai.google.dev/gemini-api/docs/openai` (bảng tương thích OpenAI) và
`ai.google.dev/gemini-api/docs/gemini-3`:

- Gemini **3 trở lên** điều khiển suy luận bằng enum `thinkingLevel`; `reasoning_effort` ánh xạ thẳng vào đó.
- Gemini **2.5 trở xuống** dùng `thinkingBudget` dạng số; tài liệu ghi `reasoning_effort` low → **1 024**,
  medium → **8 192**, `none` tắt suy luận (trừ 2.5 Pro); trần ngân sách của họ 2.5 là **24 576**.
- Hai trường **không được gửi cùng lúc**.

**Đo trực tiếp** trên `generativelanguage.googleapis.com` bằng khoá Google thật (lượt rất nhẹ, 1–32 token ra):

| Model | `thinkingLevel: low` | `thinkingLevel: minimal` | `thinkingBudget: 512` |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 200, `medium`/`high` cho ~60 thoughts token | 200 | 200 (59 thoughts token) |
| `gemini-flash-latest` | 200 | **400** "Thinking level MINIMAL is not supported for this model" | 200 (không báo thoughts) |
| `gemini-flash-lite-latest` | 200, `reasoning_tokens: 61` | — | — |
| `gemini-2.5-flash` | **400** "Thinking level is not supported for this model" | — | **200** (10 thoughts token) |
| `gemma-4-31b-it` | **400** | — | **400** "Unknown name thinkingBudget" |

**Sửa** (`router/src/providers/gemini.mjs`): thêm `geminiThinkingControl(id)` trả `effort` / `budget` /
`none` theo họ model mà tài liệu phân định (`gemini-2.5|2.0|1.5` → `budget`, `gemma` → `none`, còn lại
`effort`); record model theo đó (`thinkingType`, và `thinkingLevels` rỗng khi không có điều khiển nào).
Trên đường gửi, `thinkingLevel` bị **viết lại thành `thinkingBudget`** cho họ `budget`
(minimal 512 / low 1 024 / medium 8 192 / high–max 24 576) và **bỏ hẳn** cho họ `none`; họ `effort` giữ
nguyên `thinkingLevel` như cũ. Bản đồ của thư viện vendor (`openai-to-gemini.mjs`) luôn ghi
`thinkingLevel` khi có mức, nên chỗ sửa nằm **sau** nó.

**Đo lại sống**: dựng lại router (pid 867258) rồi `POST …/models/refresh` cho kết nối `2b922915…`:

- `gemini-2.5-flash` → `thinkingType: budget` + mức `low/medium/high`; `GET /v1/chat/completions` với
  `reasoning_effort: low` nay trả **200** kèm `reasoning_content` (trước là 400 chết lượt).
- `gemma-4-31b-it` → `thinkingType: none`, `thinkingLevels: []`; request gửi đi không còn trường thinking nào.

Ghi chú kèm theo, **không sửa vì thuộc model**: `gemma-4-31b-it` trả **500 "Internal error encountered"**
trên **đường SSE** (`streamGenerateContent?alt=sse`) kể cả khi gọi thẳng Google với thân request trần,
trong khi `generateContent` cùng thân trả **200** — lỗi phía model/nhà cung cấp, không phải do BoxFox.
Chủ sở hữu đã bỏ Gemma khỏi phạm vi, nên chỉ ghi lại.

Bộ kiểm router: **91 pass / 0 fail** (89 cũ + 2 ca mới: `thinking-mapping.test.mjs` — mức thành
`thinkingBudget` theo tài liệu và Gemma không gửi trường nào; `model-metadata.test.mjs` — record chọn
đúng điều khiển theo họ model).

Ghi chú thêm của cùng cái bẫy vận hành (do tác nhân kiểm thử phát hiện, 2026-09-20 16:05): lần dựng lại
harness lúc 15:46 **thiếu bốn biến** `BOXFOX_ANTHROPIC_BASE_URL/AUTH_TOKEN/DEFAULT_SONNET_MODEL/DEFAULT_HAIKU_MODEL`,
nên `GET /api/agent/executors/claude-code` đổi từ `{"auth":"router","settingsFile":true}` sang
`{"auth":"account","settingsFile":false,"authenticated":true}` — tức bộ thực thi `/claude-code` **im lặng**
chuyển từ đường router sang tài khoản, dù mã không đổi. Đã dựng lại kèm đủ bốn biến (pid 870296) và
endpoint trả lại đúng giá trị cũ. Bài học: dựng lại harness phải kèm môi trường cầu nối, và phải kiểm
`/api/agent/executors/claude-code` ngay sau khi dựng.

### 6.11 Khoá DeepSeek (API gốc) — lắp đặt, và bộ điều khiển suy luận riêng của nhà cung cấp — ĐÃ SỬA (đợt này)

**Lắp đặt (2026-09-20 17:45–17:52):** chủ sở hữu đưa khoá API gốc của DeepSeek. Kết nối mới trong router:
`providerId deepseek`, id `7ee21256-8675-4ee3-a802-fcedbed8b7ef`, endpoint `https://api.deepseek.com/v1`
(giá trị mặc định của catalog cho provider `deepseek`), khoá nằm trong kho credential đã mã hoá.
Số dư đọc từ `GET /user/balance`: **2,00 USD**. `GET /models` trả **đúng hai** model: `deepseek-flash`
(= DeepSeek-V4.1-Flash) và `deepseek-v4-pro` (= DeepSeek-V4-Pro-0813). Discovery `ready`, cả hai model
`enabled`, `source: live`.

**Lỗi T-5 — router quảng cáo bộ mức của OpenAI cho một nhà cung cấp có bộ mức riêng.** Adapter
OpenAI-compatible dùng chung công bố `minimal|low|medium|high` cho **mọi** model trên endpoint, vì payload
`/models` kiểu OpenAI không mang metadata suy luận. DeepSeek tài liệu hoá bộ khác, nên danh sách kế thừa
đó: (a) **giấu mức `max`** mà DeepSeek thật sự nhận; (b) quảng cáo `minimal`/`medium` như mức bản địa
trong khi chúng chỉ là bí danh tương thích; (c) vì adapter chung **bỏ hẳn** trường khi mức là
`none`/`auto`, lượt xin `none` vẫn chạy ở chế độ suy luận — mà suy luận lại là **mặc định** của DeepSeek.

Tài liệu (`api-docs.deepseek.com/api/create-chat-completion`, đọc 2026-09-20):

- `reasoning_effort`: "Possible values: [none, low, high, max]. Controls the thinking mode toggle and the
  thinking effort. none disables thinking mode; low/high/max enable thinking mode. **The default effort is
  high.** For compatibility with existing software, **minimal is accepted and mapped to low**, and
  **medium/xhigh are accepted and mapped to high**."
- `thinking`: `{type: enabled|disabled}`, "Default value: **enabled**".
- `max_tokens`: 1…384K; "When not set, the default is 8K in non-thinking mode, **64K in thinking mode**
  (128K with `reasoning_effort` set to `max`)".
- Tool calls: "**required and named tool choices are not supported in thinking mode; the API returns a
  400 error. Disable thinking mode first to use them.**"
- Models & Pricing: `deepseek-flash` — context **1M**, trần ra **384K**, **Vision ✓**;
  `deepseek-v4-pro` — **Vision: Not supported**. Cả hai: Json Output ✓, Tool Calls ✓.

Đo trực tiếp trên khoá thật (lượt rất nhẹ, `max_tokens` 40–60, `Reply with exactly: OK`):

| Mức gửi đi | `deepseek-flash` | `deepseek-v4-pro` |
|---|---|---|
| `none` | 200, **không** có `reasoning_content` | 200, không có `reasoning_content` |
| `minimal` / `low` / `medium` / `high` / `max` / `xhigh` | 200, có `reasoning_content` | 200, có `reasoning_content` |
| `bogus` (giá trị lạ) | **422** `Failed to deserialize … reasoning_effort: unknown variant` | **422** cùng thông báo |
| `thinking: {type: disabled}` + `reasoning_effort: high` | 200, **không** suy luận (công tắc thắng) | — |
| `tool_choice: required` / tên hàm, khi đang suy luận | **400** `Thinking mode does not support this tool_choice` | — |
| cùng request đó với `reasoning_effort: none` | 200, trả `tool_calls` bình thường | — |
| ảnh PNG 16×16 xanh (đường gốc) | 200, đáp **"Blue"** (đúng) | 200, đáp **"White"** (sai — không đọc ảnh) |
| luồng SSE | 33 chunk, `reasoning_content` trong delta, **usage ở chunk cuối** (`reasoning_tokens: 30`) | — |

**Sửa** (`router/src/providers/deepseek.mjs`, đăng ký riêng trong `providers/index.mjs`):

- `DEEPSEEK_THINKING_LEVELS = ['none','low','high','max']`, `defaultThinking: 'high'`,
  `DEEPSEEK_LEVEL_ALIASES = {minimal: low, medium: high, xhigh: high}` — công bố đúng bộ tài liệu, không
  bịa mức và không giấu `max`.
- `deepseekEffort(level)`: `none` → giữ `none` (DeepSeek cần trường này để **tắt** suy luận, khác adapter
  chung vốn bỏ đi); bí danh → `low`/`high`; `auto`/thiếu → bỏ trường (mặc định nhà cung cấp);
  giá trị lạ → bỏ trường, **không bao giờ** chuyển tiếp (nhà cung cấp trả 422).
- `deepseekRestrictsTools(body)`: `tool_choice` bị hạn chế (`required`/`any`/tên hàm) → gửi
  `reasoning_effort: none`, đúng cách tài liệu chỉ để request được phục vụ.
- `deepseekCapabilities`: `vision: 'reported'` cho dòng flash, `'unsupported'` cho dòng pro (tài liệu +
  phép dò ảnh ở trên); `tools: 'reported'`.
- `thinkingMetadata` để hàng đã lưu tự lành khi kết nối được chuẩn hoá.
- `CONTRACT.md` ghi rõ ngoại lệ DeepSeek của luật "no thinking field for none".

**Bộ kiểm router: 98 pass / 0 fail** (91 cũ + 7 ca mới trong `router/tests/deepseek.test.mjs`: bộ mức và
capabilities khi discover, adapter OpenAI dùng chung **không** bị đổi, `reasoning_effort` trên đường gửi,
`none` thật sự tắt suy luận, bí danh thu gọn + giá trị lạ không được chuyển tiếp, `tool_choice` hạn chế,
và hàng lưu sẵn tự lành).

**Đo lại sống sau khi dựng lại router (pid 913296, log `/var/tmp/r15/router_r15.log`):**

- Nút `Test` của giao diện cho cả hai model: `status: passed`.
- Quét mức qua `/api/router/chat` (đúng đường harness dùng) cho **cả hai** model: `none` → 0 ký tự suy
  luận, `low`/`high`/`max` → có suy luận, và usage trả `reasoning_tokens` (10–19). Mức thiếu → mặc định
  nhà cung cấp (suy luận bật, `high`). Mức `medium` (bí danh) → 200 kèm suy luận.
- `GET /v1/models` (khoá box) liệt kê `7ee21256-…/deepseek-flash` và `…/deepseek-v4-pro`;
  `POST /v1/chat/completions` với `low`, `none`, `max` đều 200, `none` không kèm `reasoning_content`.
- Ảnh qua router: `deepseek-flash` → **"Red"** (đúng), `deepseek-v4-pro` → "Brown" (sai).
- Giao diện: bộ chọn model (`Single Models`) hiện `DeepSeek · deepseek-flash` và `DeepSeek · deepseek-v4-pro`.

**Chủ ý KHÔNG công bố `contextWindow: 1000000`** dù tài liệu ghi context 1M: trần thân request của router
là **1 MiB** (`server.mjs`, mã `INVALID_REQUEST`/413) còn ngưỡng nén của harness là
`(contextWindow − reserve) × 0,7`; với cửa sổ 1M, ngưỡng đó (≈ 2,8 MB văn bản) **vượt** trần 1 MiB và lượt
nặng sẽ chết bằng `UPSTREAM_HTTP_413` — đúng lớp lỗi F-1 đã sửa. Bỏ trống `contextWindow` giữ nguyên hành
vi cũ: bảng tên trong `runtime.resolve_context_window` cho `deepseek` **64 000** (ngưỡng nén ≈ 43k token
≈ 172 KB, an toàn dưới trần).

**Bẫy vận hành gặp trong đợt này (không phải lỗi mã, ghi để lần sau khỏi mất thời gian):** `POST
/api/agent/sessions` của harness nhận **các trường route ở cấp cao nhất** (`connectionId`, `modelId`,
`thinkingLevel`). Gửi lồng `{"route": {…}}` thì khoá lạ bị **bỏ qua im lặng**, phiên lưu route rỗng, và
lượt đầu chết với `UPSTREAM_HTTP_503: … No enabled, authorized model is available for this route.`
(hiện rõ trong nhật ký hệ thống là `"model": null, "connectionId": null`). Phiên mẫu đúng:
`5803c1a842454db2a26ad9482a3c0765`.

**Kiểm chứng qua harness (phiên `5803c1a8…`)** — mức thinking đi tới nhà cung cấp thật:

| Lượt | Mức | Kết quả |
|---|---|---|
| "Compute 37*89" | `high` | `completed`, đáp `3293`, usage `reasoning_tokens: 8` |
| "Compute 41*73" | `none` | `completed`, đáp `2993`, **không** có token suy luận |
| "Reply with exactly: OK" | `none` | `completed`, `OK` |
| "Reply with exactly: OK" | `high` | `completed`, `OK`, `reasoning_tokens: 0` (model tự chọn không suy luận cho câu hỏi tầm thường) |

Route lưu trong config phiên: `{"connectionId": "7ee21256-…", "modelId": "deepseek-flash",
"thinkingLevel": "high"}`, `contextWindow` 64000.

### 6.12 Cơ chế "nhập tay" của DeepSeek chết ở cả hai đầu — ĐÃ SỬA (`87bc2d6`)

**Yêu cầu của chủ sở hữu:** DeepSeek phải có **hai cơ chế** như mọi model khác — (1) ping/dò tự công bố
model kèm bộ mức suy luận, (2) người dùng **tự nhập** bộ mức đó bằng tay — và **`max` phải được thêm cho
riêng DeepSeek** (vòng 15 chỉ sửa được cơ chế 1, xem §6.11).

Khi đo lại cơ chế 2, **hai lỗi độc lập** lộ ra; cả hai đều làm mức `max` không thể tới được nhà cung cấp.

**Lỗi A — router tự bịa danh sách chung cho model nhập tay.** Nhánh `customModel` của `service.patch()`
dùng hằng số `['auto','low','medium','high']` cho **mọi** model nhập tay có `reasoning`, nên model DeepSeek
nhập tay lại thiếu `none` và `max`, đồng thời công bố `medium` như một mức gốc (DeepSeek không có `medium`
— đó chỉ là bí danh của `high`). Hệ quả trùng với T-5: hàng nhập tay và hàng dò được nói hai chuyện khác
nhau về cùng một nhà cung cấp.

**Lỗi B — biểu mẫu "Custom Model" của giao diện chưa từng tới router.** `handleAddCustomModel` trong
`frontend/src/components/settings/ModelManagerModal.tsx` gửi **một bản sao của toàn bộ mảng `models`** cộng
id mới trong `enabledModelIds`. Router trả thẳng:
`INVALID_REQUEST: Select only models discovered for this connection.` (đo sống bằng
`PATCH /api/router/connections/7ee21256-…` với thân `{"models":[…],"enabledModelIds":[…]}`), và `models`
cũng không phải trường mà PATCH của kết nối nhận. Nghĩa là **cơ chế nhập tay không hoạt động ở bất kỳ nhà
cung cấp nào**, không riêng DeepSeek — lỗi này có từ trước vòng 15 và bị §6.11 che khuất.

**Sửa**

- `router/src/providers/deepseek.mjs`: thêm hook `manualThinkingLevels()` trả
  `[...DEEPSEEK_THINKING_LEVELS]` = `none · low · high · max` — bộ mà adapter của nhà cung cấp tự công bố là
  nguồn duy nhất của luật, nên **hai cơ chế tự khớp nhau**.
- `router/src/service.mjs`: thêm hàm mức mô-đun `manualThinkingLevels(provider)`; nhánh `customModel` gọi
  nó thay cho hằng số. Adapter nào không có hook (mọi nhà cung cấp khác) vẫn nhận danh sách mặc định
  `['auto','low','medium','high']` — không đổi hành vi cũ.
- `frontend/src/components/settings/ModelManagerModal.tsx`: biểu mẫu gửi **khai báo** `customModel`
  (`id`, `name`, `capabilities`) thay vì bản sao danh sách. Không đổi một dòng JSX nào (luật "giao diện
  không đổi" của chủ sở hữu vẫn giữ); nhãn nút vẫn là "Add & Enable".

**Đo lại sống trên router đã dựng lại (pid 940356, log `/var/tmp/r16/router_r16.log`)**

| Phép đo | Kết quả |
|---|---|
| Hàng nhập tay **cũ** (`r15-manual-probe`, tạo trước khi sửa, đang giữ `auto/low/medium/high`) sau khi dựng lại | `['none','low','high','max']`, `thinkingType: effort` — **tự lành** |
| Hàng nhập tay **mới** trên kết nối DeepSeek | `source: custom`, `thinkingLevels: ['none','low','high','max']`, **có `max`**, không có `medium` |
| Hàng nhập tay trên kết nối `custom` (TokenHarbor) | `['auto','low','medium','high']` — giữ nguyên luật chung, **không** có `max` |

**Ca kiểm thử thêm:** `router/tests/deepseek.test.mjs` +2 ("model DeepSeek nhập tay công bố đúng bộ tài
liệu, có `max`", "luật nhập tay vẫn chung cho mọi nhà cung cấp khác, không có `max`"),
`frontend/src/components/settings/ModelManagerModal.test.tsx` +1 (khẳng định PATCH mang `customModel` và
**không** mang `models`/`enabledModelIds` — đã chứng minh **đỏ** trên mã trước khi sửa rồi **xanh** sau khi
sửa). **Bộ router: 100 pass / 0 fail.** `npx tsc -b --noEmit` mã 0; eslint không thêm phát hiện mới.

### 6.13 Hai lỗi trong đường "nhập tay" lộ ra khi thi công kế hoạch vòng 17 — ĐÃ SỬA (`574a5aa`)

Vòng 17 dựng luồng endpoint bên thứ ba (kế hoạch đã duyệt: `/code/.plans/v1-api-provider-area.md`). Khi đo lại
trên router thật, hai lỗi cũ lộ ra — cả hai đều nằm trên đường mà chủ sở hữu yêu cầu, và cả hai đều bị luồng dò
tự động che khuất cho tới nay.

**Lỗi C — model nhập tay trên kết nối dò hỏng thì không bao giờ chạy được.** `validTarget()`
(`router/src/service.mjs`) đòi `discoveryState === 'ready'`. Với endpoint không có `/models` (hoặc bị từ chối
key), trạng thái dò là `failed`, nên dòng model người dùng gõ tay **không phải đích hợp lệ**: nó bị lọc khỏi
`GET /v1/models` và lượt gọi trả `No enabled, authorized model is available for this route.` — đúng cái ca mà
tính năng này sinh ra để phục vụ (ghi chú bảng 14329).

**Lỗi D — một lần dò THÀNH CÔNG xoá im lặng các dòng gõ tay.** Nhánh thành công của `#discover` thay cả danh
mục bằng kết quả nhà cung cấp trả về; dòng `source: 'custom'` biến mất (đo sống trước khi sửa: `r16-manual-generic`
biến mất sau một lần `POST /:id/models/refresh` trả 200). Kế hoạch chỉ yêu cầu sống sót qua lần dò **thất bại**,
nhưng cùng một cơ chế: người dùng gõ tay một model rồi bấm `Refresh models` là mất nó.

**Sửa:** `validTarget()` nhận dòng `source === 'custom'` khi kết nối đang bật, `authState === 'ready'` và
`discoveryState === 'failed'` (mọi luật khác giữ nguyên, kể cả kiểm tra project của antigravity và
`health !== 'unavailable'`); `#discover` giữ lại các dòng gõ tay khi dò thành công. Bốn ca kiểm thử mới trong
`router/tests/custom-provider.test.mjs`. Bộ router: **152 pass / 0 fail**.

### 6.14 Ba lỗi của đường "nhập tay" lộ ra khi KIỂM CHỨNG vòng 17 — ĐÃ SỬA (`91647e7`)

Vòng 17 thi công xong thì tác nhân kiểm thử chạy bốn làn sống trên `f63f82b` (router `:3101`, harness `:3102`,
Vite `:3100`, và một stub OpenAI-compatible trên `127.0.0.1:3199` có chế độ lỗi + bộ ghi request). Ba lỗi dưới
đây nằm **cùng một đường** mà chủ sở hữu yêu cầu (nhập id bằng tay rồi Test), nên cả ba được sửa trong một commit
với năm ca hồi quy **đỏ-trước-xanh-sau** (3 ca router, 2 ca giao diện).

**F1 (vừa) — khai lại một id đã có chỉ sửa được `name`.** Nhánh `customModel` của `service.patch` chỉ ghi
`name` (và bật dòng lên) khi dòng đã tồn tại; `capabilities`/`thinkingLevels` chỉ được ghi ở nhánh **tạo mới**.
Kế hoạch (dòng 240) nói rõ gõ lại một id là cách cập nhật `name` **và** `capabilities`, nên hai ô
Vision/Reasoning trong form là đường **một chiều**: chọn sai lần đầu là không sửa được nữa.
*Đo trước khi sửa:* PATCH cùng id với cờ đảo ngược → `vision supported / reasoning unknown` giữ nguyên.
*Sau khi sửa:* cờ đảo đúng, `thinkingType: effort`, `thinkingLevels ['auto','low','medium','high']`, **một** dòng;
một id mới cùng cờ cho **cùng** bộ trường (cập nhật = tạo mới); PATCH không mang `capabilities` vẫn chỉ đổi tên;
`streaming`/`tools` — hai trường form không có — giữ nguyên bằng chứng.

**F2 (cao) — một lần `Refresh models` hỏng làm id gõ tay rơi khỏi định tuyến.** Catch của `#discover` giữ lại
danh sách cũ và đặt `discoveryState: 'degraded'`; `validTarget()` chỉ nhận `failed` (bản sửa ở §6.13), nên
`degraded` — hình dạng khác của **cùng một lần dò hỏng** — làm dòng gõ tay thành đích không hợp lệ.
*Đo trước khi sửa:* dò 404 → `failed`, lượt gọi `POST /v1/chat/completions` = **200 `BOXFOX_OK`**; thêm **một**
lần refresh hỏng → `degraded`, cùng lượt gọi = **503 `NO_ROUTE`**, không có dòng usage nào.
*Sau khi sửa:* `degraded` được nhận; lượt gọi lại **200 `BOXFOX_OK`** (40/5 token, ghi ledger), `GET /v1/models`
**63** mục có dòng đó. Mọi luật còn lại giữ nguyên (connection bật, `authState ready`, project Antigravity,
`health !== 'unavailable'`).

**F3 (vừa) — Test đạt làm mất khối "Models could not be listed".** `testInference` thành công xoá `error`, mà
khối lỗi dò lại được cổng theo `error`, nên sau một lần Test đạt người dùng mất cả lý do lẫn ba lối thoát
(`Retry` / `Add model by hand` / `Edit endpoint & key`) dù đường dò danh sách vẫn hỏng.
*Đo trước khi sửa:* `{discoveryState: 'failed', error: null}` → pill `models failed` nhưng **không** có khối.
*Sau khi sửa:* giao diện cổng theo `discoveryState === 'failed' || error` (kèm một câu thay thế khi chưa có lời
nhà cung cấp), và `testInference` chỉ xoá `error` khi `discoveryState === 'ready'` — phép thử đạt là bằng chứng
cho **một model**, không phải cho đường dò danh sách. Khối hiện đủ ở **cả hai** dạng, `Last attempt` giữ nguyên.

**Ca kiểm thử thêm:** `router/tests/custom-provider.test.mjs` +3 và
`frontend/src/components/settings/ProviderConnectionCard.test.tsx` +2. Lần đo đỏ trước khi sửa:
`tests 3 / pass 0 / fail 3` (router) và `2 failed | 8 passed` (tệp giao diện). **Bộ router: 155 pass / 0 fail**;
frontend **736 pass / 4 fail** (đúng bộ đỏ có sẵn); `tsc -b --noEmit` mã 0. `CONTRACT.md` thêm một câu ghi luật
mới (khai lại id ghi cả hai cờ; dòng gõ tay định tuyến được khi dò `failed`/`degraded`; probe đạt không xoá lỗi dò).

### 6.15 Vòng soát mã vòng 17 (7 phát hiện) — ĐÃ SỬA (`2a0075c`)

Một tác nhân soát mã độc lập đọc trọn `bff9f3d..91647e7` (chỉ đọc; bộ router 155/155 và
`src/components/settings` 38/38 đều xanh). Sáu phát hiện là lỗi, một là câu hỏi sản phẩm; năm lỗi
đã sửa trong `2a0075c`, lỗi còn lại (nhãn `supported`) sửa cùng lượt, và câu hỏi đã có quyết định.

**P1 (vừa) — token ghi cache bị tính tiền hai lần.** `usage.mjs` chuẩn hoá `input` thành **tổng** đầu vào:
`prompt_tokens = input-only + cache-hit + cache-write` (đúng cho payload Anthropic và cho hàng đã lưu trong store),
nhưng `costFromUsage` tính `miss = input - hit` — trong đó đã chứa phần ghi cache — rồi cộng thêm
`cacheWrite * (cacheWriteInput ?? input)` lần nữa. Đây là chỗ **duy nhất** trong bộ thay đổi ghi ra một con số tiền sai.
*Đo trên mô-đun thật:* payload `{input_tokens:189, cache_read:11776, cache_creation:900, output:25}`, giá
`{input:0.15, cachedInput:0.003, cacheWriteInput:1.5, output:0.6}` → router **0,01055** so với số thật **0,00785**
(gấp 1,34 lần; nếu thiếu giá cache-write thì 0,009875 so với 0,007175).
*Sau khi sửa:* `write = min(cacheWrite, max(0, input - hit))`, `miss = max(0, input - hit - write)`; hàng kiểu
Anthropic qua `normalizeUsage()` cho **12865 / 11776 / 900 / 25** → **0,00785**; hàng DeepSeek sống (không có ghi cache)
không đổi. Đính chính kèm theo: câu công thức trong kế hoạch đã được sửa (có ghi chú ngày), và ca kiểm thử
`costFromUsage reads the router normalized usage names…` được viết lại để dựng hàng từ `normalizeUsage()` thật —
ca này **đỏ** trên mã trước khi sửa (`not ok 107`, `pass 154 / fail 1`).

**P2 (thấp–vừa) — một từ vựng thứ năm không ai đọc.** Dòng gõ tay được ghi `vision: 'supported'`, nhưng từ vựng
duy nhất trong mã là `unknown | reported | verified | unsupported` (`frontend/src/types/provider.ts`), và huy hiệu
`Vision Supported` trong trình quản lý model chỉ hiện với `reported | verified`. Hệ quả: ô Vision người dùng **tự
tích** không hiện bằng chứng ở đâu cả (Reasoning sống sót nhờ `thinkingLevels` không rỗng).
*Sau khi sửa:* ghi `reported` ở cả bốn chỗ; `CONTRACT.md` ghi rõ bốn từ và nghĩa "đã khai, chưa xác minh".
Hai ca router cập nhật theo.

**P3 (thấp–vừa) — khối "Models could not be listed" hiện cho lỗi không phải lỗi dò danh sách.** Cổng cũ là
`discoveryState === 'failed' || error`, mà `error` còn được đặt bởi đường **làm mới credential** và bởi một lần
Test trả `AUTH` trên connection `ready`. Hai trường hợp đó danh sách model **đang có**, nhưng thẻ vẫn nói "không
liệt kê được model" kèm `Last attempt:` của lần dò và ba lối thoát của đường dò.
*Sau khi sửa:* khối chỉ hiện khi `discoveryState` là `failed` hoặc `degraded`; lỗi khác trên connection `ready`
hiện thành **một dòng riêng** (không tiêu đề, không `Last attempt`). Ca giao diện mới
"does not claim a failed model list when the error is not a listing failure" **đỏ** trên mã trước khi sửa.

**P4 (thấp) — cảnh báo ngày lễ chưa tới người đọc.** Kế hoạch yêu cầu cửa sổ cao điểm DeepSeek phải ghi rõ trong
**tooltip và tài liệu**; cảnh báo mới chỉ nằm ở chú thích mã.
*Sau khi sửa:* `PEAK_HOLIDAY_CAVEAT` nằm trong cả hai câu tooltip `documented` và trong đoạn "Model price" của
`CONTRACT.md`; ca giao diện về nguồn giá cập nhật theo (đỏ nếu thiếu).

**P5 (thấp) — `costMode: 'included'` vẫn ghi được cost do nhà cung cấp tự báo.** Miễn trừ chỉ nằm trong
`priceFor`, nên tầng `reported` bỏ qua `costMode`; một gateway thuê bao trả `cost` trong usage sẽ vẫn được ghi.
**Quyết định (chọn hướng b — ghi và hiển thị):** con số đó là số **của nhà cung cấp**, không phải số ta bịa, nên
nó ở lại hàng với `costBasis: 'reported'`; miễn trừ `included` áp cho **phép ước lượng của ta** mà thôi.
`CONTRACT.md` nói rõ điều này, và một ca mới trong `router/tests/cost.test.mjs` ghim **cả hai** nửa: connection
`included` + provider báo `cost` → `0,0069` / `reported` / `estimated false`; cùng connection không báo gì → `null`.

**P6 (thấp) — bộ lọc Free đọc hình dạng giá cũ.** `(m as any).pricing?.prompt === '0'` là hình dạng payload thô
trước vòng 17; dòng model nay mang `pricing` đã chuẩn hoá (`input`/`cachedInput`/`output`), nên nhánh đó chết và
tab Free bỏ sót đúng những model giá 0.
*Sau khi sửa:* một hàm `isFreeModel` dùng chung cho tab Free và nút `Enable all free`, bằng đúng luật của router
(`openrouter.mjs`: id chứa `:free`, hoặc `pricing.input === 0`). Ca giao diện mới ghim cả hai chiều (model giá 0
hiện, model trả tiền không hiện).

**P7 (thấp) — lần Test hỏng chỉ còn được báo bằng màu.** Hàng model gọn in `{latencyMs} ms` và tô màu theo
`health`, còn lý do chỉ hiện khi probe vừa chạy trong phiên; sau khi tải lại, một model hỏng chỉ khác ở màu chữ.
*Sau khi sửa:* `title` của ô đó mang trạng thái + `health` + mã HTTP + lý do
(`Failed · unavailable · HTTP 403 · 12 ms · Provider rejected the probe.`).

`CONTRACT.md` giữ nguyên lời hứa "cạnh `input` là tổng đầu vào" bằng cách nói thẳng ra, thay vì để người đọc tự
suy từ công thức. **Sau `2a0075c`:** router **156 pass / 0 fail**; frontend **738 pass / 4 fail** (đúng bộ đỏ có
sẵn: 3 ca `Sidebar.test.tsx` + 1 ca `workspace/index.test.ts`); `tsc -b --noEmit` mã 0.

### 6.16 Vòng 18 — hai lỗi chủ sở hữu báo: cửa sổ ngữ cảnh 64 000 do đoán theo tên, và bản ghi màn hình không xem được

**P1 (vừa) — cùng một câu hỏi "cửa sổ ngữ cảnh của model này là bao nhiêu" có BA câu trả lời khác nhau.**
Chủ sở hữu báo thanh ngữ cảnh in `37.5k / 64.0k (59%) est.` cho một model DeepSeek trong khi nhà cung cấp công bố
1M. Đo trên máy này (2026-09-21) cho thấy cả ba tầng đều tự đoán theo tên, và không tầng nào hỏi tầng kia:

| Tầng | Chỗ đoán | Số nó đoán cho họ DeepSeek V4 |
| --- | --- | --- |
| Router | `router/src/providers/common.mjs:143` đọc `context_length`/`context_window`/`top_provider.context_length`/`max_context_length`; payload `/models` của DeepSeek chỉ có `{id, object, owned_by}` | không có gì → `deepseek.mjs:92` công bố `contextWindow: null` |
| Harness | bảng tên trong `backend/src/agentbox/agent_core/runtime.py:592-599` (`deepseek`/`qwen` → 64 000) | **64 000** |
| Giao diện | `frontend/src/components/panels/ContextUsageBar.tsx:144` (`deepseek`/`qwen` → `64_000`) | **64 000**, in kèm `est.` |

Chuỗi truyền: `/api/router/state` mang `null` → `backend/src/agentbox/api/server.py:176-177` chỉ chép giá trị khi
truthy nên không chép gì → harness rơi vào bảng tên → `config['contextWindow'] = 64000` → giao diện in `64.0k`.
Nghịch lý: chính vì số 64 000 được gắn nhãn `est.` nên trông như đã có nguồn, trong khi đó là con số duy nhất
không ai công bố.
*Quyết định của chủ sở hữu (đã chốt, không hỏi lại):* với một dòng model **đã biết**, bảng tên thắng; số nhà cung
cấp vẫn được giữ bên cạnh ở `contextWindowReported` để đối chiếu; những dòng cũ (`deepseek-r1` 64 000,
`v3.2` 163 840) **không** vào bảng, giữ nguyên số nhà cung cấp.
*Sau khi sửa:* một bảng duy nhất `router/src/context-window.mjs` (`CONTEXT_WINDOW_TABLE_AS_OF = '2026-09-21'`, bảy
dòng V4/V4.1, regex họ `^deepseek-(?:v4(?:\.1)?-)?(?:flash|pro)(?:-|$)`) và ba nguồn có tên
`'manual' | 'documented' | 'reported' | null`; bảng tên Python trong harness **bị xoá**;
`resolve_context_window()` trả về **cặp** `(số, nguồn)` và sàn an toàn của harness (128 000) mang nhãn `'fallback'`;
`ContextUsageBar` bỏ hẳn phép đoán theo tên; đường khai tay `PATCH /api/router/state`
`{modelContextWindow:{modelId,contextWindow,clear?}}` cho người dùng chỉnh bất cứ dòng nào. Phiên cũ được lành lúc
harness khởi động (`HarnessRuntime.heal_context_windows`, gắn vào `app.on_startup`), chỉ bỏ qua phiên có
`contextWindowSource == 'manual'`.
*Số đo sống sau khi sửa* (router và harness khởi động lại, 2026-09-21):
`/api/router/state` → `deepseek-flash` = **1000000 / documented / reported null**; TokenHarbor `deepseek-v4.1-flash`
= **1000000 / documented / reported 1048576**; OpenRouter `deepseek/deepseek-v3.2` = **163840 / reported** (dòng cũ
không có bảng, giữ đúng số nhà cung cấp). `/v1/models` (61 dòng) đọc đúng cùng bộ số. Phiên mới tạo với
`deepseek-flash`: `config.contextWindow == 1000000`, `contextWindowSource == 'documented'` (trước đợt này:
`64000`, không có nguồn); phiên khai tay `32768`: `32768 / manual`.
Đợt đầu của phép lành ghi lại: trong 50 phiên lưu sẵn, **4 phiên còn `64000`** và **22 phiên ở 1048576** (Gemini
công bố 1048576) đều thành `(số, nguồn)`; lần khởi động thứ hai **đổi 0 dòng** (phép lành là idempotent).
Ghi chú trung thực: hai phiên rất cũ khai `30000` và `250000` **trước** đợt này không có trường nguồn, nên phép lành
coi chúng như số không nhãn và đưa về số của định tuyến — từ đợt này trở đi mọi lời khai tay đều mang nhãn `manual`
và được bảo vệ. Ba tầng cùng đọc một số: router **174 ca / 0 đỏ** (`router/tests/context-window.test.mjs` 16 ca
mới, đỏ trước khi sửa: `1000000 !== 32768`, `Missing expected exception: 0 không phải một cửa sổ`), harness
**543 đạt** (`test_context_window_heal.py` 4 ca mới), giao diện `ContextUsageBar.test.tsx` **19 đạt** (4 ca mới đỏ
trước khi sửa: `7 failed | 12 passed`).

**P2 (vừa) — bản ghi màn hình `.mp4` hiện thành `<img>`.** `frontend/src/components/panels/ChatPanel.tsx:678-684`
render `<MediaLightboxModal src caption sourceUrl />` mà **quên `type`**, và
`frontend/src/components/chat/MediaLightboxModal.tsx:36` mặc định `type = 'image'`. Hậu quả: tệp `.mp4` rơi vào
nhánh `<img>` nên khung xem chỉ hiện alt text (`Sandbox Screen Recording`), đúng như ảnh chủ sở hữu gửi.
Cùng một giá trị sai đó còn làm **hai** chỗ khác: nút `Download` lưu `.mp4` thành `boxfox-image-capture-<ts>.png`
(`:137-145`), và thanh tua chỉ hiện khi `type === 'video'` (`:300`). Người gọi thứ ba là
`frontend/src/components/panels/RouterTestChat.tsx:126` cũng thiếu `type`, tức lỗi có ba cửa chứ không một.
Vận chuyển thì đúng: `HTTP/1.0 200 OK`, `Content-Type: video/mp4`, `Accept-Ranges: bytes`, byte-range trả
`HTTP/1.0 206 Partial Content Content-Range: bytes 0-1023/7438731`; tệp là H.264 Constrained Baseline,
yuv420p, 1280×800, 15 fps. Trước đợt này **không có ca kiểm thử nào** cho khung xem.
*Sau khi sửa:* `type` là trường **bắt buộc** của `LightboxMediaProps` (xoá giá trị mặc định), nên `tsc` chỉ ra mọi
cửa quên truyền; tên tệp tải về lấy đuôi thật của đường dẫn trước, rồi mới tới `type` (`downloadExtension()`);
và một bản ghi không nhận được `stop` sạch vẫn mở được, nói thẳng thời lượng chưa biết
(`Duration unknown — this recording did not stop cleanly`) thay vì coi như tệp ảnh.
*Trạng thái:* **ĐÃ SỬA trong mã**; phép kiểm sống (mở một bản ghi thật trong khung xem, đọc thẻ `<video>` và tên
tệp tải về) nằm ở phần nghiệm thu cuối vòng — ghi lại kết quả ở `test-rounds.md`.

### 6.17 Vòng 18 (tiếp) — bốn yêu cầu còn lại của chủ sở hữu: ba lỗi thật, hai lỗi đã sửa cùng lượt

**P3 (vừa) — tab Instructions chỉ là hình vẽ.** Settings → Instructions là tiêu đề, phụ đề và **một `<textarea>`
không kiểm soát** (không `value`, không `onChange`, không ai đọc giá trị). Gõ chữ thì chữ nằm đó, đổi tab là mất, và
**không đường nào ghi** trường `instructions` mà harness đã biết đọc và ghép vào system message
(`runtime.py:842-847`, khối `=== OWNER-CONFIGURED DIRECTIVES ===`). Nói cách khác: cả hai đầu đã sẵn sàng, chỉ thiếu
đúng khúc nối.
*Sau khi sửa:* `owner_settings.py` (một document + `revision`, `REVISION_CONFLICT` khi lệch, lưu chuỗi nguyên văn),
hai route `GET/PUT /api/agent/owner-settings`, `ownerSettingsStore` + `InstructionsTab.tsx` có kiểm soát, bộ đếm
`{{n}} / 12.000 ký tự` chuyển màu ở 11 000 và ở mốc cắt, chip `UNSAVED CHANGES`, biên nhận `Saved … · revision n`,
trạng thái lỗi giữ nguyên bản nháp và ghi `NOT SAVED` chứ không bao giờ nói "đã lưu", bốn ví dụ chèn tại con trỏ, một
câu hỏi chặn mất dữ liệu khi Esc/đổi tab, và sổ phiên ghi `instructionsChars` để chat cũ nói thẳng
`not recorded for this chat`. Mốc 12 000 ký tự có **một** nguồn: `INSTRUCTIONS_MAX_CHARS` trong
`backend/src/agentbox/agent_core/limits.py`, dùng ở cả route lẫn `runtime.py`, và một ca backend so hai nơi với nhau.
*Đo sống:* `GET /api/agent/owner-settings` → `{"instructions":"","revision":0}`; `PUT` với revision cũ → **409
`REVISION_CONFLICT: reload owner settings`**; một phiên thật tạo bằng thân request mới lặp lại `instructions` và
đuôi system message đúng khối trên.

**P4 (vừa) — ô `Model` của sổ harness ghi giá trị router không định tuyến được.** Ô này ghi id trần hoặc tên hiển
thị, trong khi `router/src/engine.mjs:14-24` chỉ nhận tên alias hoặc chuỗi có `/`. Đo sống hôm nay với khoá harness:
`{"model":"deepseek-v4-pro"}` → **HTTP 404 `MODEL_NOT_FOUND`** và `{"model":"Claude 3.7 Sonnet"}` → **404** y hệt,
còn `7ee21256-8675-4ee3-a802-fcedbed8b7ef/deepseek-flash` → **200**. Nghĩa là một harness "đã lưu" vẫn có thể chết ở
lượt đầu, và lỗi hiện ra như lỗi nhà cung cấp.
*Sau khi sửa:* ô `Model` lấy danh mục **sống** từ `providerStore` và chỉ ghi hai dạng chạy được
(`model:<connectionId>:<modelId>` / `alias:<id>`), có hàm thuần `isRoutableModel()` dùng ở **cả** store (từ chối giá
trị không định tuyến) **và** editor, ô bị khoá kèm lý do khi danh mục chưa nạp. Bản mẫu giữ `mainModel: 'default'` và
mô tả của chúng được sửa cho khớp trạng thái thật, thay vì khôi phục tên seam cũ (những tên đó cũng 404).
*Kèm theo:* editor có `Steps per turn` (1–60) và `Turn deadline` (5–600) kèm câu nói trần của vai trò con, khối
`Tool access` đếm từ `runtime-info` (nhóm `Questions & approvals` luôn bật) cùng câu luật "chỉ được lấy công cụ đi"
(engine trả `Tool not permitted for this role`), khối `Retries` **chỉ-đọc** nói rõ ba số đó sống ở `failures.py`, và
`HarnessFlowVisualizer` in đúng danh sách công cụ của registry — **năm** cái tên chưa từng tồn tại
(`file_multi_replace`, `diagram_generate`, `dir_list`, `git_diff`, `read_url_content`) đã biến mất.

**P5 (thấp–vừa) — thang tự nối lại của màn Máy dừng sau 4 lượt, và cách trả nợ cũ là hai nút bấm.**
`lib/vnc/state.ts` có `VNC_MAX_ATTEMPTS = 4`; hết trần thì giao diện hiện khối hổ phách `NO FRAME AVAILABLE` cùng
`Retry connection`, buộc chủ sở hữu bấm tay trong khi lý do hỏng (mất mạng, `timeout`, socket đóng) tự khỏi được.
Trần đó là **cố ý**: mỗi lượt hỏng trình duyệt ghi một dòng đỏ WebSocket không tắt được, nên trả nợ bằng cách bỏ trần
sẽ biến một tab bỏ quên thành máy bơm nhật ký.
*Sau khi sửa:* bỏ trần, giữ thang `3 → 8 → 20` và **giữ mãi nấc 20 s**; `exhausted` chỉ còn nghĩa "lý do này không
tự khỏi" (`mixedContent`, `insecureContext`, `unsupported`, `security`, `credentials`, `disabled`, `skipped`) — sáu
lý do đó không thử lại vì thử lại là vô nghĩa. Món nợ nhật ký được trả bằng `visibilitychange` trong `useVncScreen`:
tab bị ẩn thì **không** hẹn giờ và **không** mở socket, quay lại thì hẹn lại từ nấc 3 s — nên trần thực tế là khoảng
một lượt mỗi 25 giây khi panel đang mở và tab đang hiện, và bằng **0** khi tab bị ẩn. Giao diện bỏ cả hai nút
`Retry connection`, thay bằng lớp phủ mờ `Connecting to desktop…` + `Attempt n · Auto-retry in Xs` + thanh tiến trình
2 px, chỉ hiện từ lượt 6 mới có link "How to start the box"; nhánh lý do không tự khỏi giữ thẻ tĩnh, và một dải
`Reconnected · live frame resumed` hiện 4 giây khi khung hình trở lại.
*Kèm theo:* công tắc bảng Workspace (một `IconButton` `PanelRight`) — trước vòng này **không có** điều khiển bố cục
nào trong mã (`Layout:` mà chủ sở hữu thấy nằm trong iframe code-server, không phải sản phẩm); bảng ẩn thì cột chat
giãn hết, ý định mở tab của agent **xếp hàng** thay vì mất, và nội dung đọc gom vào cột 768 px ở giữa. Số đo điểm
ảnh ở góc khung hình bị xoá — con số đó là kích thước đã **thương lượng** (`lib/vnc/fit.ts:153` đặt
`rfb.resizeSession = true`), nên nó chỉ còn trong ngăn kéo `Details`, nơi có nhãn và ngữ cảnh.

### 6.18 Vòng soát mã độc lập đợt 18 (7 phát hiện + 1 câu hỏi) — ĐÃ SỬA (`074a8ae`)

Vòng soát đọc trọn diff `a061f03..fc51864` trên ba tầng (router, harness, giao diện), mở lại bản ghi phiên thật ở
chế độ chỉ-đọc và dựng script riêng trong `/var/tmp` để tái hiện — không sửa tệp nào trong repo. Kết luận: `RISK SCORE 4`,
`OVERALL RISK Medium`, ngưỡng 7, `VERDICT Ship with mitigations`. Bảy phát hiện dưới đây đã sửa hết; mỗi cái có ca kiểm
chứng riêng, và cận trên `2 000 000` mà vòng soát ghi là "chưa đo" nay cũng có ca.

**R1 (vừa) — bản ghi bị cắt ngang vẫn không có đường mở, vì bản sửa nằm ngoài commit được soát.** `fc51864` giữ
`HarnessStepView.tsx` trả `null` cho MỌI hàng `tool_end` có `args.action === 'start'`, mà tệp của chủ sở hữu
(`1789929795687-screen.mp4`, phiên `bb0c66e24f68446fb5152b3e7739dcc2`, seq 39458) chỉ tồn tại dưới dạng một hàng
`start`: lượt chết vì DEADLINE trước khi kịp chạy `stop`, và trong cả DB không có hàng `stop` nào cho đường dẫn đó
(12 sự kiện `computer_screen_record`, hai tệp chưa từng `stop`). Bản sửa nằm trong cây làm việc nhưng chưa được commit,
nên **bản được soát** vẫn không đạt D3.
*Sau khi sửa:* `extractToolMedia(event, { allowStartMedia })` + một memo `startAllowedSeqs` trong `TurnBlock` chỉ cho
hàng `start` đi qua khi **không** hàng nào khác trong cùng lượt nói về chính tệp ấy, và nhiều hàng `start` cùng một tệp
thì chỉ hàng đầu tiên được hiện — nên một bản ghi đã đóng vẫn đúng một player. Hai ca mới trong
`HarnessStepView.media.test.tsx`.

**R2 (thấp–vừa) — nút [👁 View] trong chat im lặng khi bảng Workspace đang ẩn.** `ReferencedFilesList` →
`uiStore.selectFile` → `openTab('files')`, mà `openTab` **cố ý** không chạm `workspaceHidden`; bấm View lúc bảng ẩn thì
không hiện gì, và tab Files đổi ngầm để lần sau người dùng nhìn thấy một trạng thái mình không hề chọn. Kế hoạch E2 đã
liệt kê bốn điểm gọi cần đi qua `showTab`; điểm này bị bỏ sót.
*Sau khi sửa:* `selectFile` đi qua `showTab('files')` (hiện bảng + ghim tab + kích hoạt). Ba ca mới trong
`uiStore.workspace.test.ts`, gồm ca hàng đợi đóng băng của tab khác được xả đúng luật cũ-trước.

**R3 (thấp) — một nút vặn đã đặt thì không xoá được.** `setHarnessTuning` bỏ qua mọi giá trị `undefined`, trong khi
trình sửa ghi `undefined` khi ô nhập bị xoá trống — nên đặt `Steps per turn` = 20, xoá ô, lưu: số 20 ở lại và ô tự điền
lại 20; placeholder "mặc định của engine" không bao giờ quay lại được.
*Sau khi sửa:* `null` là tín hiệu **XOÁ** (xoá hẳn khoá, không gán `undefined`, nên `in`/`Object.keys` cũng sạch), còn
thiếu khoá/`undefined` vẫn là "không đụng tới"; trình sửa gửi `null` cho ô trống và cho trường hợp bật lại đủ bộ công cụ.
Ba ca mới trong `harnessStore.workspace.test.ts`.

**R4 (thấp) — một bản ghi phiên không có nhãn nguồn bị đọc thành `reported`.** `ContextUsageBar` coi nhãn thiếu là
`reported`, nên bốn phiên cũ giữ `contextWindow 128000` không nguồn (route `{}` nên bản vá lúc khởi động bỏ qua) hiện
`128.0k` **trần trụi** — không `est.`, không tooltip — trong khi trước đợt 18 con số ấy ít ra còn mang dấu ước lượng.
*Sau khi sửa:* nhãn thiếu (hoặc lạ) đọc là `fallback`, nên số hiện kèm `est.` và tooltip nói thẳng chưa có nguồn; câu
chữ của `fallbackHint` được viết lại cho đúng cả hai ca ("harness đang giữ {{tokens}} token, không phải số nhà cung cấp
báo"), và `reported` thật thì vẫn không `est.`/không tooltip. Một ca mới trong `ContextUsageBar.test.tsx`.

**R5 (thấp) — `contextWindowReported` có thể bằng chính số đang dùng.** Nhánh PATCH đặt số tay gán thẳng
`model.contextWindowReported = published`, không kiểm lại luật "chỉ khi khác" mà `resolveContextWindow` và hai nhánh
kia đã theo (`router/CONTRACT.md`). Tái hiện trong script riêng: gieo `1048576` rồi `PATCH` đúng `1048576` → dòng
`{contextWindow: 1048576, source: 'manual', contextWindowReported: 1048576}`.
*Sau khi sửa:* chỉ giữ số nhà cung cấp khi nó **khác** số đang dùng. Một ca mới trong `context-window.test.mjs`, kèm
nửa đối chứng (hai số khác nhau thì số nhà cung cấp vẫn ở lại).

**R6 (thấp, câu hỏi mở) — `for_engine()` không có người gọi ở production.** Tab Instructions hứa tài liệu áp cho phiên
MỚI, nhưng chỉ đường giao diện gửi chỉ dẫn kèm yêu cầu; một phiên tạo từ script/lịch chạy không nhận được gì dù tài
liệu đã lưu.
*Sau khi sửa:* route tạo phiên đọc tài liệu đang lưu khi yêu cầu **không** mang `instructions` (cắt bằng đúng trần
`INSTRUCTIONS_MAX_CHARS`), chỉ dẫn client gửi kèm vẫn thắng, tài liệu rỗng thì hành vi cũ giữ nguyên. Engine không đổi
luật: nó vẫn chỉ đọc `values['instructions']`. Một ca route mới trong `test_owner_settings.py`.

**R7 (nit) — ghi chú nguồn gốc tự mâu thuẫn với chính dòng của nó.** `CONTEXT_WINDOW_TABLE_SOURCE_NOTES` ghi
`deepseek-v4-flash` "OpenRouter, published 1310720" trong khi dòng đó là `1_000_000`; đọc lại `/api/v1/models` của
OpenRouter hôm nay: **mọi** dòng V4/V4.1 công bố **1048576**, riêng `deepseek-v4-flash-0731` và alias
`~deepseek/deepseek-v4-flash-latest` công bố **1310720** trong khi `top_provider.context_length` của chính chúng là
1048576. Ghi chú nay nói đúng phép đo, đúng dòng lệch, và nói rõ dòng bảng là **quyết định của cả họ** chứ không phải
phép đo từng build — số nhà cung cấp vẫn nhìn thấy được ở `contextWindowReported` thay vì trốn trong ghi chú.

**Còn để ngỏ (không phải lỗi trong mã):** đường tải thật của tệp `.mp4` chưa `stop` chỉ đo được từ trong máy ảo agent
(thư mục capture không nhìn thấy từ máy này) — thuộc phần kiểm chứng sống của đợt; và kết luận `Ship with mitigations`
của vòng soát dựa trên diff, không dựa trên việc chạy lại bộ kiểm thử.

### 6.19 Vòng 19 — OpenCode Free không dùng được: bốn cổng của bậc miễn phí (đồng bộ 9Router v0.5.81)

**Triệu chứng đo được.** Bậc miễn phí của OpenCode từ chối gần như mọi thứ: `POST /zen/v1/responses` trả `403` với
`{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode"}`. Adapter trong cây lúc
đó gửi `User-Agent: opencode` (không số), không gửi tool nào cho đường Responses, mint `x-opencode-session` bằng
`randomUUID()` (`ses_<32 hex>`), và tôn trọng `stream:false` của người gọi — **cả bốn** điều đó đều là cổng chặn.

**Nguyên nhân, đo từng biến một** (`Authorization: Bearer public`, 2026-09-21, cùng một payload nền):

| Dạng yêu cầu | Kết quả |
|---|---|
| `User-Agent: opencode` (không số) | **403 FreeTierError** |
| `User-Agent: opencode/1.18.31` | 200 |
| `tools: []` | **403 FreeTierError** |
| 2 tool mồi `bash` + `read` (description `This tool is currently unavailable and must not be used.`) | 200 |
| `stream: false` | **403 FreeTierError** |
| `stream: true` | 200 |
| `x-opencode-session: ses_<32 hex>` (uuid) | **403 FreeTierError** |
| `x-opencode-session: ses_<12 hex><14 base62>` | 200 |
| `reasoning_effort: "high"` trong body | **400** `invalid_request_error` (param `reasoning_effort`) |
| `reasoning: {effort:'high', summary:'auto'}` | 200 |
| `reasoning.effort: 'none'` | **400** |
| item `reasoning` cũ replay lại | bị từ chối ở tài khoản khác / khi `store:false` |
| kết quả tool mang ảnh, gộp vào `function_call_output` dạng mảng | 200 nhưng **câu trả lời rỗng** |
| kết quả tool mang ảnh, tách thành lượt người dùng riêng | 200, **đọc đúng màu ảnh 4/4** |

`GET /zen/v1/models` trả 200 với 74 dòng; **8 id** chạy được không cần khoá (`muse-spark-1.2-contributor-free`,
`muse-spark-1.3-contributor-free`, `jev-1.13-free`, `deepseek-v4-flash-free`, `mimo-v2.5-free`,
`ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`); các id **không** có hậu tố `-free`
(`muse-spark-1.2`, `muse-spark-1.3`) trả **401 `AuthError: Missing API key`**, nên chúng được khám phá nhưng để **tắt**.

**Sau khi sửa** (`router/src/providers/opencode.mjs`): UA có phiên bản (nhận UA hợp lệ của người gọi, còn lại dùng
`opencode/1.18.31`); **luôn** `stream:true` ở phía thượng nguồn rồi tự gộp khi người gọi cần bản không-stream; hai tool mồi
luôn đi kèm bộ tool của người gọi (không nhân đôi nếu người gọi đã gửi); phiên `ses_<12hex><14base62>` **dùng lại theo
danh tính cuộc trò chuyện** (6 giờ, trần 200 phiên; có `session_id` trong body thì dịch từ đó) vì quota tính theo phiên —
mint phiên mới mỗi request chính là cách tự tạo `429`; `x-opencode-request` suy từ phiên + lượt người dùng cuối nên thử
lại một lượt dùng lại một id; `reasoning_effort` được dịch thành `reasoning.effort` (`none`/`auto` thì bỏ hẳn khối
`reasoning`); item `reasoning` cũ và `encrypted_content` bị lọc khỏi `input`; ảnh trong kết quả tool tách thành lượt người
dùng riêng; lỗi được phân biệt rõ (`403` dạng client-shape → `AUTH` không thử lại, `429` → `RATE_LIMIT` có thử lại, lỗi
giữa luồng sau `200` thì ném lỗi thay vì kết thúc như thành công). Hợp đồng dây được ghi ở `router/CONTRACT.md`.

**Đo sống sau khi sửa** (qua chính adapter, `fetch` thật): khám phá 74 dòng/8 id bật; lượt gọi tool thật **1,1 s**
(`finish=tool_calls`, usage 659 in/87 out); lượt có ảnh trong kết quả tool trả lời đúng nội dung ảnh (**5,4 s**); người gọi
`stream:false` nhận câu trả lời thật (**7,6 s**). `router/tests/opencode.test.mjs` thêm **15 ca**; toàn bộ router
**193/193 đạt**.

**Nguồn để đối chiếu:** 9Router v0.5.81 (`/var/tmp/9router`, commit `a8c9d38`) — mục *"OpenCode / OpenCode Go: resolve 403
FreeTierError and 429 rate limits with canonical session format, valid User-Agent, and stable upstream session reuse;
force stream and declare `forceStream` for free-tier SSE aggregation; cloak decoy tools, normalize Muse Free tool choice,
and strip prior reasoning items on Responses models"*. Bản clone đã `git fetch` lại: **không có commit mới hơn**.

### 6.20 Vòng 19 — nén ngữ cảnh: ngưỡng 70 % không bao giờ chạm tới, và bốn thứ đi kèm (port HERMES/PI)

**Triệu chứng đo được.** Một nhiệm vụ dài không bao giờ được nén: `ContextCompressor(config['contextWindow'])` lấy
`output_reserve = min(4096, window // 4)`, rồi ngưỡng `int((window - reserve) * 0.7)`. Trên cửa sổ 1 000 000 token mà
model khai, ngưỡng là **697 132 token** (`int((1 000 000 − 4 096) × 0,7)`), trong khi trần thật của một request chỉ là **900 KiB** thân bài
(`ROUTER_BODY_BUDGET`) ≈ **307 000 token ước lượng**. Nghĩa là `shrink_request_to_budget` cắt văn bản/ý nghĩ/đối
số/phương tiện trước khi ngưỡng kịp chạm, log `model.request_trimmed` ở mức warn và **không có checkpoint**, rồi các
lượt sau bị từ chối `UPSTREAM_HTTP_413`. Ba lỗi đi kèm: bộ nén gọi ở đầu **mỗi** bước nên một bản tóm tắt hỏng đốt một
lượt tóm tắt mỗi bước (không có chống-thrash); trần tóm tắt cứng `max_tokens=2048` trong khi bản tóm tắt chỉ được nhận
khi `finish_reason == 'stop'` (nên nhiệm vụ dài nhận `Incomplete summary`); và phép đo ngữ cảnh chia 3 byte/token thay
vì đọc hoá đơn thật của router.

**Đã port (v1, giữ nguyên hình dạng)** — `backend/src/agentbox/agent_core/compression.py` (252 → 559 dòng),
`limits.py`, `runtime.py`, `skills/runtime_commands.py`:

| Việc | Ngưỡng / luật mới | Nguồn đối chiếu |
|---|---|---|
| P1 ngưỡng tuyệt đối đặt được | `threshold = min(threshold_tokens or percent, byte_threshold)` | HERMES `_derive_trigger` :2433, `_apply_threshold_tokens_cap` :2518, `resolve_model_threshold` :1807 |
| P2 trần theo BYTE | `byte_threshold = ROUTER_BODY_BUDGET // 3 - 6000` = **301 200** token | đo sống 2026-09-20: body 1 060 902 B, `messages` 1 043 364 B |
| P3 đo bằng hoá đơn thật | `usage_reading()` + `context_estimate(messages, tools, usage)` | PI `estimateContextTokens` :217-245 |
| P4 tỉa nhiều lượt | khử trùng lặp md5 trước, rồi mỗi kết quả cũ thành một dòng (`PRUNE_MIN_CHARS = 200`) | HERMES `_prune_old_tool_results` :3045, `_dedupe_tool_results` :2920 |
| P5 đuôi theo ngân sách token | `min(20 % ngân sách, 25 000)`, sàn 8 message | HERMES `LEAN_TAIL_CAP_TOKENS` :842, `_MAX_TAIL_MESSAGE_FLOOR` :1060 |
| P6 trần tóm tắt co theo độ lớn | `min(8192, max(2048, 2 % của before))` | PI `maxTokens = min(0.8*reserve, …)` :684 |
| D chống-thrash | hỏng/vô hiệu thì im lặng **300 s** | HERMES `_ANTI_THRASH_RECOVERY_SECONDS` :2501 |
| E xác nhận tiến bộ | nén xong mà vẫn ≥ 95 % ngưỡng ⇒ cờ `ineffective` | HERMES `compression_made_progress` :403-427 |
| Banner | nói thẳng công cụ vẫn hoạt động bình thường | HERMES `SUMMARY_PREFIX` :199-239 |

**Không port (có lý do):** `_effective_threshold_percent` (70 → 75 % cho cửa sổ < 512k — cửa sổ lớn đã bị trần byte
chặn trước), micro-compaction, lưu phiên con/theo dòng, `tail_mode="lean"`, khoá lại chữ ký suy luận, đuổi ảnh gửi đi,
23 mẫu regex `overflow` của PI.

**Ngưỡng trước/sau theo cửa sổ thật:**

| Cửa sổ khai | Ngưỡng cũ (70 % cứng) | Ngưỡng mới | Ghi chú |
|---|---|---|---|
| 1 000 000 | 697 132 | **301 200** | trần byte thắng; nay nằm dưới mốc `UPSTREAM_HTTP_413` |
| 128 000 | 86 732 | 86 732 | không đổi (trần byte ở trên) |
| 32 768 | 20 070 | 20 070 | không đổi (trần byte ở trên); đo sống: nén tự động ở 20 408 và 21 127 |

**Bằng chứng sống** (harness chạy mã mới, `deepseek-flash`, cửa sổ khai tay 32 768 để ngưỡng chạm được trong ngân sách):
phiên `b2cfba9a245b4e84bb06f0ae468f6192` sinh **hai** sự kiện `compression` `{"kind":"summary","beforeEstimate":20408,
"afterEstimate":16267}` và `{"beforeEstimate":21127,"afterEstimate":13869}`, hai checkpoint `reason=summary` (id 13, 14)
được ghi **trước** khi thay danh sách, và lượt kế tiếp mở bằng 15 message thay vì 24. Cửa sổ khai tay đã được xoá lại
(`deepseek-flash` về `1000000 / documented`, `muse-spark-1.2-contributor-free` về `null`).

**Ghi chú trung thực — cửa sổ quá nhỏ vẫn từ chối thật.** Khai 8 192 thì lượt chết `CONTEXT_LIMIT: current turn/tools
exceed the context budget` (prompt hệ thống + schema công cụ không lọt nổi ngân sách 6 144); khai 32 768 rồi đổ một kết
quả công cụ ~33 000 token trong một lượt thì chết `CONTEXT_LIMIT: summary did not reduce context enough`. Cả hai là
nhánh fail-closed có chủ đích (bản gốc còn nguyên), không phải lỗi mới — và cũng là lý do ngưỡng byte phải khác ngưỡng
phần trăm chứ không thay thế nó.

**Nguồn để đối chiếu:** HERMES `agent/context_compressor.py` (5 367 dòng) tại commit `ea0c2b82`; PI monorepo
`packages/coding-agent/src/core/compaction/compaction.ts`. Không có mã nào chép nguyên: mọi hằng số ở trên đều được
đo lại trong BoxFox trước khi chốt.

### 6.21 Vòng soát mã độc lập đợt 19 (4 phát hiện) — ba sửa, một ghi nhận có chủ đích

Vòng soát mã độc lập (`r19-review`, dải `00b7a8a..374a70a`) kết luận **"Ship with mitigations"**, điểm rủi ro **4/10**
(mức Trung bình), và đề nghị (a): sửa hai phát hiện F1 + F3 trước lượt kiểm chứng cuối. Cả ba phát hiện có mã đều đã
sửa trong đợt này, mỗi bản sửa kèm một bài test khoá lại; F4 ghi nhận là quyết định có chủ đích, không sửa.

**F1 — mức Cao — đuôi nguyên văn có thể co về 0.** `tail_cut` trả chỉ số đuôi theo ngân sách token, rồi vòng
"không để kết quả công cụ mồ côi" tiến `cut` qua loạt `role == 'tool'` liền nhau cho tới khi gặp hàng gọi. Khi
transcript **kết thúc** bằng một loạt song song dài hơn `tail_budget` (BoxFox cho tới **16** lời gọi một bước, và
lượt nén chạy ở đầu **mỗi** bước — `runtime.py:1101-1108`), vòng đó chạm `len(result)`, bản gộp thay mọi thứ sau
tiền tố hệ thống và model nhận `[system, summary]`: không còn lượt người dùng nào lẫn kết quả mới nhất, mà phiên thì
đã bị lưu ở dạng đã gộp. Bằng chứng của vòng soát: `collapse_mech.py` cửa sổ 32 768, 45 157 token → `out_len=2` cho
`batch=8` và `batch=9` (một loạt 7 thì thoát, vì thân kết quả nhỏ hơn ngân sách đuôi).

Bản sửa: hàm mới `keep_tail(messages, cut)` (`compression.py:180-199`) — khi `cut` đã chạm cuối danh sách thì lùi về
`len − MAX_TAIL_MESSAGE_FLOOR` rồi lùi tiếp qua các hàng `tool`, nên đuôi bắt đầu ở hàng gọi và **cả loạt** được giữ
cùng nhau; gọi ở **cả hai** nhánh (`compression.py:479` cho đường thường, `:486` cho nhánh nhiệm-vụ-một-lời-nhắc).
Sau bản sửa, chính bài đo của vòng soát in `out_len=11` cho `batch=8` và `12` cho `batch=9`. Bài test khoá:
`test_the_fold_never_takes_the_whole_tail_of_a_parallel_batch` (`test_compression_port.py:297`) — kiểm cả hàm
`keep_tail` lẫn kết quả `compact` (cặp gọi/kết quả không rời nhau, kết quả mới nhất còn nguyên văn, `len(result) > 2`);
đã xác nhận bài này **đỏ** khi trả `keep_tail` về hành vi cũ (`cut == len` → `IndexError`) và **xanh** sau khi sửa.

**F2 — mức Trung bình — `compact()` có thể trả bản sao y nguyên và báo một lần nén chưa hề xảy ra.** Ngưỡng khởi động
đo bằng số có neo hoá đơn (`context_estimate` với `usage` thật), còn hai phép kiểm sau đo bằng ước lượng thô. Khi nhà
cung cấp đếm nhiều token hơn `bytes/3` cho cùng nội dung, hàm vào vòng tỉa rồi thoát sớm, trả `deepcopy` không đổi kèm
event `{'kind':'prune', …, 'pruned':0}`; `runtime.py:1110` đối chiếu **danh tính** nên ghi thêm một checkpoint trùng,
lưu lại phiên và phát event `compression` mà giao diện hiện thành `Context compacted: …`.

Bản sửa: hai nhánh thoát sớm của vòng tỉa (`compression.py:498` và `:528`) nay trả **chính danh sách cũ** và `None`
khi `pruned <= 0` — đúng hợp đồng no-op mà nhánh `cut <= 1` đã dùng từ trước, nên người gọi không thấy khác danh tính,
không checkpoint trùng, không event. Phần chia đôi thước đo vẫn giữ nguyên có chủ đích: khi `pruned > 0` thì event
vẫn mang hai con số thô và việc tỉa là thật. Bài test khoá:
`test_a_usage_trigger_with_nothing_to_prune_is_a_no_op` (`test_compression_port.py:165`) — cũng đã xác nhận đỏ/xanh
theo cùng cách.

**F3 — mức Trung bình — nhánh chat với `tools: []` không được nguỵ trang, và cú từ chối theo hình dạng bị xếp là lỗi
khoá.** Bậc miễn phí của OpenCode từ chối payload không có công cụ (`403 FreeTierError`); đường tóm tắt của harness gọi
`client.complete(history, [], route, …)` — tức `tools: []` — nên `/compact` trên một model opencode làm `engine.mjs`
đặt `authState = 'expired'` và đưa **cả** nhà cung cấp ra khỏi vòng xoay, lượt chết với `NO_ROUTE`. Bản sửa:
nhánh chat nay **luôn** gửi công cụ của người gọi cộng hai công cụ mồi còn thiếu, và `tool_choice: 'none'` khi người
gọi không mang công cụ nào (`router/src/providers/opencode.mjs:668-672`), nên hình dạng BoxFox gửi không còn chạm
cổng đó. Hai bài test mới trong `router/tests/opencode.test.mjs`
("a chat model with no caller tools still carries the decoys", "a chat model keeps the caller's tools and gains the
missing decoy") khoá cả hai chiều. Việc xếp `403` là lỗi khoá vẫn giữ: với bậc miễn phí đó là lệch hình dạng vĩnh
viễn, thử lại không chữa được, và `requestScopedClientError` cố ý để `403` thuộc phạm vi tài khoản.

**F4 — mức Thấp — ghi nhận, không sửa.** (1) `threshold_tokens` không có điểm gọi nào trong mã chạy, nhưng nó là bề
mặt công khai có test (`test_the_threshold_can_be_an_absolute_number`) giữ đúng cửa vào "ngưỡng tuyệt đối" của bản
port; (2) dòng `if (FORCE_AUTO_TOOL_CHOICE.includes(modelId)) requestBody.tool_choice = 'auto'` trong nhánh Responses
là vô hại (nhánh đó vốn đã gửi `auto`), giữ lại làm bản đối chiếu có tên của danh sách `forceAutoToolChoiceModels`
bên 9Router — bỏ đi thì mất đối chiếu mà hành vi không đổi.

**Đính chính số của chính bản ghi này.** Ngưỡng 70 % cũ ghi sai ở §6.20: đúng là **697 132** cho cửa sổ
1 000 000 (`int((1 000 000 − 4 096) × 0,7)`) và **20 070** cho cửa sổ 32 768 — không phải 697 232 và 20 270. Con số
ngưỡng **mới** (301 200 / 86 732 / 20 070) và mọi bằng chứng sống không đổi.

### 6.22 Vòng 21 — năm việc chủ nhà giao: bốn lỗi đo sống và một lỗi giao diện (chưa sửa, đã lên kế hoạch)

Vòng 21 không sửa mã sản phẩm (đợt này chỉ đo và lên kế hoạch). Năm lỗi dưới đây **đã đo sống**, mỗi lỗi
trỏ thẳng tới phần sửa trong `docs/plan/v21-boxfox-plan.md`; nhật ký đầy đủ ở
`docs/tracking/test-rounds.md` § *Vòng 21*.

**Cập nhật vòng 22 (2026-09-22).** Đợt foundation của vòng 22 đã sửa **bốn** lỗi dưới đây rồi đo lại; bảng và số đo ở § 6.23.
Trạng thái mới: **BUG-39 — ĐÃ SỬA** (popover render qua portal; hit-test trả `true` ở **cả bốn** mục, mục Drive nói thật "chưa kết nối"),
**BUG-40 — ĐÃ SỬA** (tệp vào box **đúng byte**, đường dẫn tuyệt đối có trong event `user` **và** trong ngữ cảnh gửi model, chuỗi
`[Attached Files: …]` bị bỏ), **BUG-41 — ĐÃ SỬA** (một lượt thử lại có ép công cụ trước khi chịu thua), **BUG-42 — ĐÃ SỬA**
(chạm trần bước hoặc hạn chót ⇒ `partial` + chẩn đoán bốn phần thay vì `failed` trắng; con nhận tới 40 bước / 300 s).
**BUG-43 giữ nguyên** vì thuộc đợt peer-mesh của vòng 22 (D-9) — đợt này không đụng tới.

**BUG-39 — mức Trung bình — menu `+` đủ mục trong DOM nhưng bị `overflow-hidden` cắt, người dùng thấy "chưa có upload".**
Khi menu đang mở, `document.elementFromPoint` tại tâm mục `Tải lên hình ảnh` (`itemRect [290,642,226,45]`) trả về khung
chat ⇒ mục không phải phần tử trên cùng, tức không vẽ ra. Tổ tiên cắt là `flex min-w-0 items-center gap-1.5 overflow-hidden`
(`frontend/src/components/panels/ChatInputBar.tsx:268`) trong khi popover đặt `absolute bottom-full`
(`frontend/src/components/chat/AttachmentPicker.tsx:159`). Lặp lại được ở cả địa chỉ công khai lẫn `localhost:3100`.
Sửa theo `A1` (bỏ `overflow-hidden` hoặc render bằng portal, không chữa bằng `z-index`).

**BUG-40 — mức Cao — nội dung tệp đính kèm không bao giờ tới box; agent chỉ nhận cái tên.**
Chỉ ảnh được đọc bằng `FileReader` thành `dataUrl` (`AttachmentPicker.tsx:56-68`); tệp thường chỉ giữ `name`/`size`
(`:69-77`) và lúc gửi trở thành chuỗi `` `[Attached Files: ${…}]` `` (`ChatInputBar.tsx:113-115`). Đo sống: event `user` của
phiên `0ef73471c38d4c63a593755345213dcf` đúng bằng phần text cộng `\n\n[Attached Files: probe-upload.txt]`, không nội dung
và không đường dẫn; sau lượt `docker exec agentbox-box ls .uploaded_artifacts` **rỗng** và
`find /home/agent/workspace -name '*probe-upload*'` **không có**. Agent phải tự đi tìm, kết luận "tệp không tồn tại".
Đường ống nhận tệp đã có sẵn nhưng **chưa có đường nào gọi từ ô soạn tin** (panel Workspace Files đã gọi nó —
`frontend/src/hooks/useWorkspaceFiles.ts:473`): `POST /__box/file/upload` (`deploy/docker/ide-proxy.py:540-568`),
`workspace_files.write_upload` (`deploy/docker/workspace_files.py:743-754`), client `frontend/src/lib/workspace/http.ts:70-87`,
thư mục đích tạo lúc boot (`deploy/docker/box-entrypoint.sh:15-24`); luật tên RULE-5 (`docs/naming.md:24`) **chưa có code
nào cấp số** — kế hoạch `A2–A6` giao việc cấp số cho phía box.

**BUG-41 — mức Trung bình — `TURN_EMPTY_RESPONSE` đánh `failed` cả lượt dù model đã làm việc, không thử lại, không trả phần đã làm.**
Phiên `0ef73471…` chết ở bước 5: `error {code: TURN_EMPTY_RESPONSE}` với `thought` đã có nhưng không có text và không có
tool call; người dùng mất trọn lượt, không có câu trả lời một phần. Sửa theo `B6` (một lượt thử lại có ép công cụ, hết cách
mới `failed`), cùng họ với lỗi C2 đã sửa ở đợt 20.

**BUG-42 — mức Cao — con chạm `DEADLINE` (10 bước/120 s) thì mất trắng phần đã làm, cha chỉ nhận `failed`.**
Phiên con `ea9486495da646d7aac4ccd4214ea8ed` (`delegate_task role=explore`) chạy 10/10 bước, 33 tool call, hết 120 s ⇒
`DEADLINE: the turn ran out of time before an answer was produced`, `answerChars = 0`; cha nhận `status=failed` và phải nói
với người dùng là "không có bằng chứng nào". Cùng mã lỗi `DEADLINE` như ảnh chủ nhà gửi (`Error code: DEADLINE`,
`Worked for 180s`); lượt gốc trong ảnh là chủ nhà báo, vòng này không tái hiện được (phiên gốc đã bị dọn khỏi store) —
vòng này tái hiện được cùng mã lỗi ở **agent con** (120 s). Trần bước
cũng đánh `failed` một việc đã xong (`failures.py:52`). Sửa theo `B2–B4`: tách mã `STEP_BUDGET_EXHAUSTED` /
`DEADLINE_EXCEEDED`, **trả `partial` có nội dung thay vì `failed`**, nâng ngân sách con lên 24 bước/240 s, và ghim `X:`
blocker để lần sau biết đã mất gì.

**BUG-43 — mức Trung bình — bảng Sub-agents không theo turn: con của turn trước hiện ở turn sau.**
Đo sống: lượt 2 sinh con `ea948649…`; lượt 3 hỏi `2+2` (xong trong 3 s, không gọi tool nào) mà bảng vẫn ghi
`SPECIALISTS PIPELINE · 1 TOTAL · Explore Specialist FAILED · 33 tools executed`
(`/code/.generated_artifacts/images/r21_perTurn_03_turn3_with_stale_child.png`). Gốc: `childrenMap` dựng từ **mọi** event
`child` của phiên (`frontend/src/components/panels/SubagentInspectorPanel.tsx:162-196`, render `:347`/`:361`) và store không
cắt theo turn (`frontend/src/store/harnessChatStore.ts:294`); event `child` cũng **không mang `turn`/`step`**
(`backend/src/agentbox/agent_core/runtime.py:2523-2530`, `:2564`) nên giao diện không có dữ liệu để phân. Sửa theo `E1–E3`.

**Ghi nhận đúng, không phải lỗi.** (1) Trần mặc định 16 bước **không** chặn việc vừa phải: lượt đọc hai tệp + grep + viết
báo cáo + đọc lại xong ở **bước 8** (phiên `dddebffb…`). (2) `muse-spark-1.2-contributor-free` và
`muse-spark-1.3-contributor-free` của OpenCode Free đều chạy được (`status: passed`, có usage), nên không có việc "thiếu model".
(3) Địa chỉ xem trước công khai chỉ để **xem**: harness chỉ nhận `Origin` loopback
(`backend/src/agentbox/api/server.py:119-139`), nên mọi lượt chạy phải đi qua `localhost:3100` — đúng thiết kế, không phải lỗi.

### 6.23 Vòng 22 (đợt 1 — foundation) — bốn lỗi vòng 21 đã sửa và đo lại, một lỗi mới (BUG-44)

Đợt 1 của `docs/plan/v22-boxfox-plan.md` sửa bốn lỗi đo sống ở vòng 21, đo lại bằng ba bộ test và một lượt thử sống đầu-cuối qua
`localhost:3100`; chính lượt đo đó lộ thêm **một** lỗi (BUG-44) thuộc đợt bằng chứng sống. Nhật ký đầy đủ (số đo, lệnh, phiên):
`docs/tracking/test-rounds.md` § *Vòng 22*.

| Mã | Mức | Nội dung | Nơi sửa | Trạng thái |
|---|---|---|---|---|
| BUG-39 | TB | Menu `+` đủ mục trong DOM nhưng bị `overflow-hidden` cắt | `frontend/src/components/chat/AttachmentPicker.tsx`, `frontend/src/components/panels/ChatInputBar.tsx` | ĐÃ SỬA |
| BUG-40 | Cao | Nội dung tệp đính kèm không bao giờ tới box; agent chỉ nhận cái tên | `frontend/src/lib/chat/attachmentUpload.ts`, `frontend/src/components/panels/ChatInputBar.tsx`, `backend/src/agentbox/agent_core/{attachments,runtime}.py`, `backend/src/agentbox/skills/runtime_commands.py`, `backend/src/agentbox/api/server.py`, `deploy/docker/{workspace_files,upload_files,ide-proxy}.py` | ĐÃ SỬA |
| BUG-41 | TB | `TURN_EMPTY_RESPONSE` đánh `failed` cả lượt dù model đã làm việc | `backend/src/agentbox/agent_core/runtime.py` | ĐÃ SỬA |
| BUG-42 | Cao | Con (và lượt chính) chạm trần bước/hạn chót thì mất trắng phần đã làm | `backend/src/agentbox/agent_core/{limits,failures,runtime}.py` | ĐÃ SỬA |
| BUG-43 | TB | Bảng Sub-agents không theo turn | — | HOÃN — thuộc đợt peer-mesh của vòng 22 (D-9) |
| BUG-44 | TB | Câu trả lời về tệp đính kèm có thể in **nội dung cũ trong ngữ cảnh** mà không mở tệp; không cổng nào bắt | — | MỚI — thuộc đợt bằng chứng sống (D-8) của vòng 22 |

**BUG-39 — đã sửa, đo lại sống.** Popover nay render qua **portal** nên không còn bị tổ tiên `overflow-hidden`
(`frontend/src/components/panels/ChatInputBar.tsx`) cắt. Số đo sau sửa, cùng phép thử vòng 21: `document.elementFromPoint` tại tâm
**cả bốn** mục trả `true` (`Tải lên hình ảnh`, `Tải lên tệp tin` — có dòng `Tối đa 25 MB/tệp · 20 tệp/lượt`, `Tải lên thư mục`,
`Google Drive`); mục Drive ở trạng thái `disabled: true` và hiện đúng câu "Chưa kết nối — không đính kèm được tài liệu Drive".
Bài kiểm giao diện khoá hành vi này trong `frontend/src/components/chat/AttachmentPicker*.test.tsx` và `ChatInputBar.*.test.tsx`.

**BUG-40 — đã sửa, đo lại sống.** Đường gửi nay **tải tệp lên box trước**, rồi gửi kèm chỉ đường dẫn
(`frontend/src/lib/chat/attachmentUpload.ts`), harness kiểm và suy ra đường dẫn tuyệt đối
(`backend/src/agentbox/agent_core/attachments.py`) rồi ghép khối `[Tệp đính kèm đã lưu trong box]` vào text gửi model.
Số đo: `.uploaded_artifacts` **5 → 7 tệp** trong đợt (`6.md` 31 B, `7.md` 34 B), cả hai **khớp byte** với tệp gốc;
event `user` của phiên `c4cf5256d3174303b363cd3896ba0246` mang
`{name: 7.md, path: .uploaded_artifacts/7.md, absolutePath: /home/agent/workspace/.uploaded_artifacts/7.md, sizeBytes: 34, kind: file}`;
hàng `messages` của phiên trong `~/BoxFox/harness/sessions.sqlite` (ngữ cảnh gửi model) chứa khối
`[Tệp đính kèm đã lưu trong box]` với dòng `- /home/agent/workspace/.uploaded_artifacts/6.md (6.md, 31 B)`;
phiên **mới** `92f76c90467d4dfaaa3bbb3d40278069` (không ngữ cảnh cũ) nhận **chỉ đường dẫn tương đối** rồi gọi
`file_read {"path": "/home/agent/workspace/.uploaded_artifacts/6.md"}` và trả về đúng dòng đầu của tệp
(`stepsUsed 2`, `toolsRun 1`). Số RULE-5 nay do **box** cấp bằng `O_CREAT|O_EXCL` + thử lại số kế (BOX-6, `docs/naming.md` § 9):
bốn lượt tải song song cùng lúc cho `2.md 3.md 4.md 5.md`, `uniq -d` rỗng.

**BUG-41 — đã sửa.** Ranh giới câu trả lời cuối nay **thử lại một lần** khi model kết thúc mà không có text và không có tool call:
lần thử lại ghim notice `TURN_EMPTY_RESPONSE_RETRY` kèm `attempt`/`how` và một hàng `system_log.write('turn.retry', …)`; chỉ khi lần
thử lại cũng rỗng thì lượt mới chịu thua như trước. Bài khoá: `backend/tests/unit/test_harness_runtime.py` (nhánh thử lại) và
`test_turn_partial_budget.py`.

**BUG-42 — đã sửa, đo lại sống.** Hai mã nay tách hẳn (`STEP_BUDGET_EXHAUSTED`, `DEADLINE_EXCEEDED`; mã cũ giữ lại chỉ để đọc
bản ghi cũ), và cả hai đường đều đóng bằng **chẩn đoán bốn phần** thay vì `failed` trắng. Số đo: lượt `maxSteps: 4`
(phiên `1cbb482079de430091e2de76f18144ae`) kết thúc `partial` với `turn_end {status: partial, stepsUsed: 2, toolsRun: 1, deadlineUsedMs: 4953, partial: true, diagnosis: true}`
và **đúng một** notice `STEP_BUDGET_EXHAUSTED {diagnosisChars: 465, reservedSteps: 3}`; câu trả lời cuối 465 ký tự, đủ bốn phần
(đã làm / đang kẹt ở / còn lại / thử tiếp theo); hàng `sessions` vẫn `completed` (không thêm giá trị `status` mới). Lượt con
`explore` `122a9a866b1342249b9affc749d9030d` nhận `maxSteps 5` / `deadlineSeconds 300` (kẹp theo cha) và trả về cha
`{status: partial, answerChars: 948, reason: STEP_BUDGET_EXHAUSTED, diagnosis: true, stuckReason: STEP_BUDGET_EXHAUSTED, is_error: false}`.
Ngân sách mới của con: `CHILD_MAX_STEPS = 40`, `CHILD_DEADLINE_SECONDS = 300` — vẫn bị kẹp theo cha như trước, nên trần thật là
`min(40, maxSteps của cha)`. Không lượt đo nào sinh hàng `X:` mới (nhánh ghim blocker chỉ chạy khi chẩn đoán không kịp).

**BUG-44 — mức Trung bình — model trả lời về tệp đính kèm bằng nội dung của **lượt trước**, không mở tệp; không cổng nào bắt.**
Đo sống trong chính lượt E3 đầu tiên (phiên `c4cf5256d3174303b363cd3896ba0246`): người dùng gửi `6.md` **mới** rồi hỏi dòng đầu tiên;
`turn_end` ghi `toolsRun: 0` (không có lần đọc nào) nhưng câu trả lời vẫn nêu đúng đường dẫn tuyệt đối và in **nội dung cũ** của tệp
(`LIVE-E2E-1790075144940`, của lượt trước trong cùng phiên), trong khi tệp trên đĩa lúc đó đã là `FOUNDATION-E2E-20260922T111913`.
Nội dung cũ **trông đúng** (đúng đường dẫn, đúng khuôn) nên người đọc không có cách nào biết là sai — đây là mặt trái của D-6:
đường dẫn tới nơi được, nhưng **không gì ép model mở tệp**, và **không cổng nào** kiểm câu trả lời cuối
(`frontend/src/components/chat/HarnessStepView.tsx` ghim badge `done` vô điều kiện; store bỏ `session.journal`). Cùng ngày, khi model
**có** gọi `file_read` (phiên `92f76c90467d4dfaaa3bbb3d40278069`) thì câu trả lời đúng từng ký tự, nên lỗi nằm ở đường "không đọc"
chứ không ở đường truyền tệp. Hướng sửa: **cổng bằng chứng** của D-8 (`docs/plan/v22-evidence-proof.md`); đợt này ghi nhận,
không sửa — đúng phạm vi đã chốt.

**Ghi nhận, không phải lỗi.** (1) `test_terminal_tools.py::test_terminal_exec_echo` **đỏ sẵn có** vì `bash` của sandbox không có
lệnh `Write-Output` (`Exited with code 127`) — không liên quan đợt này; bộ backend còn lại **902 passed**. (2) Không dựng lại ảnh box:
`worker.py` được gửi **nội tuyến** trong mỗi lần gọi, nên thay đổi phía box (`read_file_payload`, `SESSION_OP_NAMES`) có hiệu lực ngay.
(3) `frontend/.env.local` (tệp **không** được theo dõi, dùng cho đường xem trước) trỏ API về `"."`, nên bộ frontend phải chạy với
`VITE_BOX_API_URL=http://localhost:8081` — với biến đó **118 tệp / 958 bài passed**.
