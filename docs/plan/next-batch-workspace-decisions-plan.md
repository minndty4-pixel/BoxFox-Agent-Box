# Plan tiếp theo — Workspace, Decision, Plan Document, tự mở tab, cuộn chat

Trạng thái hiện tại lấy từ khảo sát mã nguồn ngày 2026-09-19 (mọi số dòng đã kiểm chứng).

## 0. Nguyên tắc

1. Việc gì agent làm được thì phải có **sự kiện** để giao diện biết. Không dùng đồng hồ đoán.
2. Tab tự mở phải **không cướp vị trí đọc** của người dùng. Nếu người dùng đang đọc hoặc đang gõ thì chỉ hiện huy hiệu, không nhảy tab.
3. Mọi hành động nguy hiểm (ghi/xoá file, chạy lệnh) phải đi qua **một** đường xin phép, có thời hạn và mặc định là từ chối.
4. Không có dữ liệu giả trong sản phẩm. Xoá `mock` khỏi đường chạy thật.

---

## 1. Workspace file tab — từ "gần mock" thành thật

### Hiện trạng

- Đã thật một phần: `WorkspaceFilesPanel.tsx:26-60` → `useWorkspaceFiles.ts` → `SandboxWorkspaceRepository` (`lib/workspace/index.ts:26-30`, `lib/workspace/http.ts:21-92`).
- Endpoint thật ở `deploy/docker/ide-proxy.py`: `GET /__box/files` (:411), `GET /__box/file/content` (:424), media/thumbnail/download (:437-462), `POST /__box/files/zip` (:464), upload (:482, cần API key), unzip (:512, cần API key).
- Giới hạn: sâu 16, 2000 mục, đọc 1 MiB, upload 256 MiB, giải nén 256 MiB, 200 đường dẫn.
- Mock chỉ còn trong `lib/workspace/mock.ts` + `lib/mock/workspace.ts`, dùng khi `VITE_WORKSPACE_SOURCE=mock`.
- **Thiếu**: tạo thư mục, tạo file, đổi tên, xoá, di chuyển. `ContextMenu.tsx:70-83` chỉ có Download / Zip / Unzip / Open-in-IDE.
- **Thiếu test component** cho `WorkspaceFilesPanel/TreeView/ExplorerGrid/PreviewStudio/ContextMenu/Breadcrumb`.

### Việc cần làm

| Bước | Nội dung | Nơi sửa |
|---|---|---|
| 1 | Thêm API ghi: `mkdir`, `touch` (tạo file rỗng), `rename`, `move`, `delete` (đưa vào thùng rác trong workspace thay vì xoá thẳng) | `deploy/docker/workspace_files.py`, `ide-proxy.py` cạnh :464-523 |
| 2 | Giữ nguyên toàn bộ kiểm tra đường dẫn (:153-171) cho các API mới; bắt buộc `X-BoxFox-Api-Key` cho mọi thao tác ghi | `workspace_files.py` |
| 3 | Mở rộng hợp đồng `WorkspaceRepository` + bản sandbox + bản mock | `lib/workspace/types.ts:56-74`, `http.ts`, `mock.ts` |
| 4 | Nối vào hook và menu: mục "Tạo file", "Tạo thư mục", "Đổi tên", "Xoá", kéo thả để di chuyển; hộp thoại xác nhận cho xoá | `hooks/useWorkspaceFiles.ts:354-414`, `workspace/ContextMenu.tsx` |
| 5 | Trạng thái thật cho file lớn: hiện "File vượt 1 MiB, tải về để xem" thay vì lỗi khó hiểu | `PreviewStudio` |
| 6 | Hiện huy hiệu `integrity`/`confidentiality` (đã có heuristic ở `workspace_files.py:321-346`) trên cây file và trong trình xem | `TreeView`, `PreviewStudio` |
| 7 | Test: unittest cho 5 API mới + test component cho panel, menu, breadcrumb | `deploy/docker/tests/test_workspace_files.py`, `frontend/src/components/panels/workspace/*.test.tsx` |
| 8 | Bỏ hẳn nhánh mock khỏi gói sản phẩm (hoặc chỉ cho phép khi `import.meta.env.DEV`) | `lib/workspace/index.ts:9,28` |

**Nghiệm thu**: trong UI tạo được file/thư mục, đổi tên, xoá, di chuyển; các thao tác này đều thấy được từ `ls` trong box; không có đường nào tạo được file ngoài `WORKSPACE_ROOT`.

---

## 2. Decision — agent hỏi người dùng, người dùng duyệt/từ chối

### Hiện trạng

- Hợp đồng dữ liệu đã có: `permission_requested` / `permission_resolved` (`types/transport.ts:87-93`), reducer `agentStore.ts:294-318`, `PermissionCard.tsx:27-157`, `lib/permissions.ts:19-24`.
- Nhưng **không có nguồn thật**: chỉ `MockTransport` phát sự kiện (`lib/transport/mock.ts:108-110,156-169`); `DecisionsPanel.tsx` có `INITIAL_DEMO_REQUESTS/GROUPS = []` và một `PermissionCard` thứ hai (:589-696).
- Backend **không có gì**: `api/server.py:123-140` không có route decision; `runtime.py` không phát sự kiện xin phép; không có tool hỏi người dùng (`tool_contracts.py:11-29`); `RiskTier.DANGEROUS` (`tools/base.py:17-22`) không được dùng làm cổng.

### Việc cần làm

**Backend**

1. Thêm hai tool vào `agent_core/tool_contracts.py`:
   - `ask_user`: câu hỏi + danh sách lựa chọn (2-5), không chặn lâu (dùng cho câu hỏi thường).
   - `request_approval`: hành động cụ thể + lý do + thời hạn, **chặn** cho tới khi có trả lời.
2. Trong `runtime.py:449-472`, khi gặp hai tool này: phát event `decision_requested` (sessionId, decisionId, kind, question/action, options, deadline) rồi `await` một `asyncio.Future` trong `self.pending[decisionId]`.
3. Thêm trạng thái phiên `awaiting_decision` để UI phân biệt "đang chờ người dùng" với "đang chạy".
4. Route mới `POST /api/agent/sessions/{sid}/decisions` (đặt cạnh `api/server.py:123-140`) nhận `{decisionId, choice, note}`; tra `self.pending`, đặt kết quả, phát `decision_resolved`.
5. Hết thời hạn → mặc định **từ chối**, phát `decision_resolved` với `reason:'timeout'` và ghi vào nhật ký phiên.
6. Mọi yêu cầu nguy hiểm (xoá file, chạy lệnh ngoài allowlist) đi qua `request_approval`: một đường duy nhất.
7. Test: vòng đời decision (tạo → chờ → trả lời → tiếp tục), hết hạn → từ chối, huỷ phiên khi đang chờ → Future được giải phóng.

**Frontend**

8. `DecisionsPanel` dùng dữ liệu thật: đọc từ store, bỏ `INITIAL_DEMO_*`, dùng **một** `PermissionCard` chung thay vì bản sao thứ hai.
9. Gửi trả lời qua API harness thật (`POST .../decisions`), không qua transport mock.
10. Tab Decision **tự bật** khi có yêu cầu mới nếu người dùng đang không bận (xem mục 4) + huy hiệu đếm số việc đang chờ (đã có ở `App.tsx:202,216-229`).
11. Trong chat: mỗi yêu cầu là một hàng có nút "Mở tab Decision"; khi agent đang chờ, hiện dải "Agent đang chờ bạn quyết định" ngay dưới câu hỏi.
12. Đồng hồ đếm ngược lấy từ `deadline` thật của server.
13. Test: panel hiện yêu cầu thật, trả lời được, tự bật tab, hết hạn hiện đúng.

**Nghiệm thu**: `/claude-code` hoặc một lệnh nguy hiểm bị chặn sẽ tạo một yêu cầu thật; người dùng bấm Duyệt thì lượt chạy tiếp; bấm Từ chối thì agent dừng hành động đó và nói rõ; không trả lời trong hạn thì tự từ chối và có ghi vết.

---

## 3. Plan Document — agent viết plan thì plan vào thư mục và tab tự mở

### Hiện trạng

- Plan chỉ vào thư mục khi container khởi động: `deploy/docker/box-entrypoint.sh:26-37` copy `bootstrap-plans/*.md` vào `/home/agent/workspace/.plans/`.
- Không có tool, không có endpoint, không có người ghi. Nhưng đường ghi file của agent (`sandbox/worker.py:153-157`, `file_ops.py:113-170`) **cho phép** ghi `.plans/v2-<slug>.md` nếu agent tự làm.
- Quy tắc tên do bộ đọc ép: `^v([1-9][0-9]{0,9})-([a-z0-9]+(-[a-z0-9]+)*)\.md$` (`plan_files.py:18-22`).
- Đọc: `GET /__box/plans` (`ide-proxy.py:592`) và `/__box/plans/content` (:604).
- Frontend: `usePlanFiles.ts` **chỉ tải khi mount** (:114-119), `PlanPanel.tsx` còn nhánh mock `PLAN_VERSIONS` (:26) và `plan_updated` chỉ đến từ kịch bản mock (`lib/mock/scenario.ts:459,501`).
- Lỗi tiềm ẩn: cache manifest theo mtime **thư mục gốc** (`plan_files.py:330-345`) nên file mới trong thư mục con `slug/` có thể không được thấy.

### Việc cần làm

| Bước | Nội dung | Nơi sửa |
|---|---|---|
| 1 | Thêm tool `write_plan` (kind: plan) cho agent: nhận `slug`, `markdown`, tự tính version kế tiếp, ghi `.plans/vN-slug.md` đúng quy tắc tên, từ chối ghi đè version đã có | `sandbox/worker.py` (thêm action), `agent_core/tool_contracts.py` |
| 2 | Sau khi ghi thành công, phát event `plan_written` {identity, version, relativePath, title, bytes} từ `runtime.py:449-472` | `agent_core/runtime.py` |
| 3 | Sửa cache manifest để so mtime của cả thư mục con (hoặc bỏ cache khi có `plan_written`) | `deploy/docker/plan_files.py:330-345` |
| 4 | Đưa `usePlanFiles` lên tầng store (hoặc thêm tín hiệu `planRevision` trong `uiStore`) để panel làm mới khi có `plan_written` | `hooks/usePlanFiles.ts`, `store/uiStore.ts` |
| 5 | Tab Plan **tự mở** khi có `plan_written` (theo luật ở mục 4) và tự chọn đúng version vừa tạo | `App.tsx:192-307`, `store/uiStore.ts:182-186` |
| 6 | Bỏ nhánh mock `PLAN_VERSIONS`; khi thư mục rỗng thì hiện trạng thái rỗng thật | `PlanPanel.tsx:26,57-65` |
| 7 | Nút "Duyệt" / "Yêu cầu sửa" ghi trạng thái thật (file phụ hoặc endpoint trả lời plan), không chỉ đổi nhãn trình bày | `plan_files.py`, `ide-proxy.py`, `PlanPanel.tsx` |
| 8 | Test: ghi plan → event → danh sách có version mới; panel tự mở; duyệt/từ chối ghi đúng; file trong thư mục con vẫn được phát hiện | `deploy/docker/tests/test_plan_files.py`, `hooks/usePlanFiles.test.tsx`, test `PlanPanel` |

**Nghiệm thu**: khi agent lên plan, file xuất hiện trong `/home/agent/workspace/.plans/` với tên đúng quy tắc, tab Plan tự mở, danh sách version có bản mới, và người dùng duyệt được ngay trong tab.

---

## 4. Agent tự mở tab workspace (cơ chế chung)

### Hiện trạng

- Tab: `PanelTabId` (`store/uiStore.ts:25-36`), `ALL_PANEL_TABS` (:38-50), `openTab` (:182-186), `selectFile` (:205-208).
- Đã có tiền lệ mở tab từ chat: `ChatPanel.tsx:289` (decisions), `:290` (plan), `:315-333` (subagents), `:618-626` (file). Nhưng **chip sub-agent trong transcript đang không bấm được** (`HarnessStepView.tsx:728-740`, không có `onClick`).
- `useUiStore.getState().openTab(...)` là điểm nối chuẩn cho lời gọi lập trình.

### Việc cần làm

1. Định nghĩa kênh `ui_intent` ở backend: `{tab, target?}` phát kèm khi agent viết plan, tạo decision, hoặc mở một file cụ thể.
2. Frontend nhận `ui_intent` trong `harnessChatStore` và gọi `openTab` **có điều kiện**:
   - Không cướp tab nếu trong 15 giây gần nhất người dùng có gõ phím hoặc cuộn trong khung chat.
   - Không cướp nếu người dùng đã tự ghim tab (`uiStore` thêm cờ `pinnedTab`).
   - Nếu bị chặn: hiện huy hiệu trên tab + một hàng trong chat "Agent vừa tạo plan — mở tab".
3. Thêm tuỳ chọn trong Settings: "Agent được tự mở tab" (mặc định bật) và "Chỉ mở khi tôi rảnh" (mặc định bật).
4. Làm chip trong transcript bấm được: sub-agent → tab Subagents đúng phiên con; plan → tab Plan đúng version; file → tab Files đúng đường dẫn; decision → tab Decision.
5. Test: điều kiện không cướp tab, huy hiệu khi bị chặn, chip bấm được.

---

## 5. Cuộn chat (hoàn thiện thêm sau bản sửa hôm nay)

Bản sửa hôm nay đã làm: bám đáy khi agent viết, dừng khi người dùng cuộn lên, nút mũi tên xuống đáy. Phần còn lại:

1. Nút mũi tên hiện **số tin nhắn mới** kể từ lúc người dùng rời đáy.
2. Phím tắt: `End` hoặc `Shift+G` để về đáy và bám lại; `Esc` giữ nguyên là dừng agent.
3. Sau khi một tab tự mở, khung chat **giữ nguyên vị trí đọc** (không cuộn lại).
4. Khi quay lại tab, khôi phục vị trí cuộn của từng phiên (lưu theo `sessionId` trong `uiStore`).
5. Test: số tin nhắn mới, phím tắt, khôi phục vị trí.

---

## 6. Thứ tự thực hiện đề xuất

1. **Đợt 1** — Decision thật (backend + frontend): đây là thứ chặn nhiều tính năng khác (duyệt plan, xin quyền xoá file).
2. **Đợt 2** — `write_plan` + `plan_written` + tab Plan tự mở.
3. **Đợt 3** — Workspace ghi file (mkdir/rename/delete/move) + test component.
4. **Đợt 4** — Kênh `ui_intent` + luật không cướp tab + chip bấm được.
5. **Đợt 5** — Hoàn thiện cuộn chat.

Mỗi đợt giữ nguyên quy tắc: có test, không dùng dữ liệu giả, và cập nhật tài liệu khi hành vi đổi.
