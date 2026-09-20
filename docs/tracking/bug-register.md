# Sổ theo dõi lỗi — BoxFox Agent Box

Cập nhật: 2026-09-19 21:30 UTC — mọi phát hiện ở mục A và B đã được sửa trong commit 6d9aba7.

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

### 6.2 Hai lỗi còn nợ của vòng kiểm chứng đợt 7

| Mã | Lỗi | Trạng thái | Vì sao chưa sửa |
|---|---|---|---|
| F5 | `inspect_element` trả `ambiguous_target` khi cửa sổ Chromium khớp nhiều tab, làm agent đốt bước | CHƯA SỬA | Đây là chốt an toàn cố ý (soi nhầm tab = sai toạ độ). Cách sửa đúng là trả danh sách tab khớp trong payload lỗi để agent tự thu hẹp, cần đổi cả host lẫn container — để chủ sở hữu quyết định |
| F6 | Desktop trong box bị client kéo nhỏ tận 286×311 qua `Xvnc -AcceptSetDesktopSize` | CHƯA SỬA | Cờ này là **tính năng cố ý** (auto-fit cho noVNC khi tỉ lệ khung khác 1.6). Bỏ cờ là mất auto-fit; muốn giữ cả hai thì phải chặn cỡ nhỏ nhất ở tầng khác. Hiện xử lý được bằng cách đặt lại cỡ: `xrandr --output VNC-0 --mode 1280x800` |
