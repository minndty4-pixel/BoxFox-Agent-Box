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
| Nợ-3 | Nén context tự động theo ngưỡng token | CHƯA KÍCH HOẠT ĐƯỢC — model khai báo cửa sổ ~1.000.000 token; chỉ kiểm chứng nhánh nén gọi tay |

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
