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
| F-1c | Cao (phòng ngừa, cùng gốc) | Trần của router là **byte**, ngân sách của `ContextCompressor` là **token** — hai thước đo không bao giờ gặp nhau, nên vẫn còn đường vượt trần khi không tin nhắn cũ nào đủ lớn để lộ ra: phiên 1 813 206 B còn **674 074 B** sau hai lượt rút, nhưng riêng trường chữ của trợ lý đã **416 891 B** và trường `tool_calls` **385 408 B** | ĐÃ SỬA — `runtime.shrink_request_to_budget()` là lượt rút cuối trong `RouterClient.complete()`: nếu thân vẫn trên ngân sách **900 KB** thì cắt chữ của các tin nhắn cũ, từ cũ nhất tới sát tin nhắn `user` cuối cùng, dừng ngay khi vừa ngân sách, không đụng vào bước đang chạy và không sửa transcript; ghi `model.request_trimmed` mức `warn` kèm số ký tự được giải phóng. Nếu không cắt được gì (một tin nhắn sống quá lớn) thì trả nguyên danh sách để lỗi thật vẫn tới người dùng | `test_inline_media_bound.py` (12 ca, thêm ba ca: thân dưới ngân sách trả nguyên; ngân sách cắt tin nhắn chữ cũ nhất trước; một tin nhắn cũ khổng lồ vẫn trả lỗi thật cho tầng gọi) |

Ghi chú kèm theo (không sửa trong đợt này): `RouterClient` vẫn gắn cứng `http://127.0.0.1:3101`
(không có biến môi trường), và trần 1 MiB của router cũng không cấu hình được — vòng kiểm chứng
phải dựng một bản router sao 128 MiB ở cổng khác để chứng minh rằng đổi trần **một mình** không
giải quyết được gì, vì đường gọi không đi qua đó.
