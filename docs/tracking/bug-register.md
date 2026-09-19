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
| Đ4-1 | Tool `ask_user` / `request_approval`, sự kiện `decision_requested` → `decision_resolved`, trạng thái `awaiting_decision`, route trả lời, hết hạn = từ chối | `backend/src/agentbox/agent_core/{tool_contracts,runtime}.py`, `api/server.py` | ĐÃ SỬA (chờ xác minh) |
| Đ4-2 | Tool `write_plan` + sự kiện `plan_written` + `ui_intent` | `backend/src/agentbox/sandbox/worker.py`, `agent_core/runtime.py` | ĐÃ SỬA (chờ xác minh) |
| Đ4-3 | API ghi workspace: `mkdir`, `touch`, `rename`, `move`, `delete` (vào `.trash`) | `deploy/docker/{workspace_files,ide-proxy}.py` | ĐANG LÀM |
| Đ4-4 | Trạng thái duyệt plan thật (`.reviews`), sửa cache manifest theo mtime thư mục con | `deploy/docker/plan_files.py` | ĐANG LÀM |
| Đ4-5 | Decision thật trên giao diện: bỏ demo, một `PermissionCard` dùng chung, đếm ngược theo `deadline` thật | `frontend/src/components/panels/DecisionsPanel.tsx`, `PermissionCard.tsx` | ĐANG LÀM |
| Đ4-6 | Tab Plan tự mở khi có `plan_written`, `planRevision` cho `usePlanFiles`, bỏ nhánh mock | `frontend/src/store/uiStore.ts`, `hooks/usePlanFiles.ts`, `PlanPanel.tsx` | ĐANG LÀM |
| Đ4-7 | Luật không cướp tab (`requestTabIntent`): tôn trọng tab đang ghim, 15 giây hoạt động gần nhất, huy hiệu khi bị chặn | `frontend/src/store/uiStore.ts`, `App.tsx` | ĐANG LÀM |
| Đ4-8 | Chip trong transcript bấm được (sub-agent, plan, file, decision) | `frontend/src/components/chat/HarnessStepView.tsx`, `ChatPanel.tsx` | ĐANG LÀM |
| Đ4-9 | Hoàn thiện cuộn chat: số tin nhắn mới, phím `End`/`Shift+G`, giữ vị trí đọc, khôi phục vị trí theo phiên | `frontend/src/components/panels/ChatPanel.tsx` | ĐANG LÀM |
| Đ4-10 | Giao diện thao tác file: tạo/đổi tên/xoá/di chuyển, xác nhận xoá nói rõ `.trash`, trạng thái file > 1 MiB, huy hiệu integrity | `frontend/src/components/panels/workspace/*`, `hooks/useWorkspaceFiles.ts`, `lib/workspace/*` | ĐANG LÀM |

## 3. Việc còn lại của BUG-25

Chuỗi lỗi tiếng Việt trong lớp container (`deploy/docker/capture.py`, `browser_capture.py`) là **thông báo lỗi kỹ thuật** trả cho giao diện; giao diện hiển thị nguyên văn. Cần chuyển các thông báo người dùng nhìn thấy sang khoá i18n ở phía frontend, hoặc trả mã lỗi và để frontend dịch. Chưa làm trong đợt 1 vì đụng tới ánh xạ lỗi chung; ghi ở đây để không mất dấu.
