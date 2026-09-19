# Phát hiện mới — vòng kiểm thử đợt 4 (2026-09-19 21:40 UTC)

Nguồn: vòng kiểm thử độc lập `test-part4` chạy trên hệ thống thật (trình duyệt thật, box thật) sau khi đợt 4 hoàn thành.

Kết quả tổng: **PARTIAL PASS** — mọi luồng đã kiểm đều chạy đúng; luật "agent tự mở tab nhưng không cướp tab" chạy không tất định ở cấu hình mặc định (B12) và đã được sửa ở commit 51f1452, có chứng minh chạy thật ở cấu hình mặc định.

## A. Việc đã xác nhận chạy đúng trên hệ thống thật

| Hạng mục | Kết quả |
|---|---|
| Luồng quyết định | Duyệt, từ chối, hết hạn (timeout), dừng phiên khi đang chờ (`cancelled`/`session_cancelled`) — tất cả đúng; bộ đếm ngược lấy từ thời hạn thật của máy chủ (8:55 → 8:46); trả lời hai lần: 200 rồi 409 |
| Ô soạn tin khi đang chờ | Giữ trạng thái bận, nút Stop còn dùng được, gõ prompt thường bị chặn tại chỗ (**0 POST**) và giữ nguyên bản nháp |
| Plan | Chip mở đúng tab; Duyệt / Yêu cầu sửa ghi thật qua `POST /__box/plans/review` và đọc lại được |
| Thao tác file | Tạo, đổi tên, di chuyển, xoá vào `.trash` (kiểm bằng `ls` trong box); huy hiệu integrity hiện trên cây file và trong khung xem trước |
| Cuộn chat | Nút nhảy xuống có `data-unseen-count`; phím `End` chạy, bị bỏ qua khi đang gõ; khôi phục vị trí đọc theo phiên (120 → 155 px) |
| Chip transcript | Decision / plan / phiên con đều mở đúng tab và đúng đối tượng |
| Nút Compact | Không còn bị cắt ở 900/1100/1920 px, nhãn không bị cụt |
| Chặn phiên con hỏi người dùng | Chứng minh bằng một lần uỷ nhiệm thật: phiên con nhận `DECISION_UNAVAILABLE`, không có `decision_requested` nào được phát |
| `thinkingLevel` | `THINKING_LEVEL_UNSUPPORTED` ở cả lúc tạo phiên và lúc chạy lượt; `'HIGH'` được chuẩn hoá thành `"high"` |
| `/skill` thiếu task | Trả `SKILL_TASK_REQUIRED` |

## B. Lỗi mới tìm thấy

| Mã | Mức | Mô tả | Nơi | Trạng thái |
|---|---|---|---|---|
| B12 | Trung bình–Cao | Luật tự mở tab không tất định ở cấu hình mặc định: tắt điều kiện "chỉ mở khi tôi rảnh" thì tab mở trong ≤3 giây, nhưng để mặc định thì 4 lần chạy chỉ 2 lần mở (t≈20–24 giây) và 2 lần không bao giờ mở, kể cả khi người dùng không làm gì suốt 64 giây. Hai nguyên nhân: (a) `ChatPanel.tsx` gọi `noteUserActivity()` **trước** chốt bỏ qua cuộn lập trình, nên chính việc tự cuộn của agent lại gia hạn cửa sổ 15 giây mãi mãi; (b) `uiStore.ts` xếp hàng đợi intent nhưng **không bao giờ** xả hàng khi điều kiện chặn hết hiệu lực | `ChatPanel.tsx:228-233`, `uiStore.ts:288-303` | ĐÃ SỬA |
| B13 | Thấp–Trung bình | `thinkingLevel` sai vẫn lọt khi lượt chạy đổi model: nhánh đổi route đặt `metadata=None` nên bỏ qua kiểm tra, giá trị `"ultrapower"` được lưu nguyên và lượt kết thúc `failed` | `runtime.py:541-556` | ĐÃ SỬA |
| B2c | Thấp | Trong tab Files, thẻ dạng lưới hiện nhãn chấm integrity bằng tiếng Anh trong khi chấm ở thanh công cụ cùng panel hiện tiếng Việt; dạng lưới không hiện `confidentiality` | `ExplorerGrid.tsx:180` vs `entryView.tsx:93` | ĐÃ SỬA |
| B4 | Thấp | Kéo thanh chia panel không được tính là hoạt động của người dùng, nên tab có thể tự mở trong lúc người dùng đang kéo | thanh chia panel | ĐÃ SỬA |
| B6 | Thấp | `tabIntentTargets.files` được ghi lại nhưng không component nào dùng, nên intent cho tab Files mở tab mà không chọn file | `WorkspaceFilesPanel` | ĐÃ SỬA |
| B7 | — | Rút lại: không thể có hai yêu cầu quyết định cùng lúc trong một phiên gốc vì lượt thứ hai bị chặn bằng 409 `SESSION_BUSY` | — | ĐÃ RÚT |

## C. Xác minh lại (vòng 6, 2026-09-19 23:25)

Vòng kiểm chứng độc lập thứ sáu chạy trên đúng năm bản sửa của `51f1452`, không sửa mã nguồn. Kết quả: **PASSED toàn bộ**.

| Ca | Kết quả | Số đo chính |
|---|---|---|
| B12a — tự cuộn của agent không gia hạn cửa sổ | PASS | `lastUserActivityAt` giữ 0 qua 6 đợt cuộn; `ui_intent` → tab hoạt động = **1 ms** |
| B12b — intent trong cửa sổ được xếp hàng rồi xả | PASS | intent ở Δt 6914 ms ⇒ xếp hàng; xả **15002 ms** sau lần gõ thật cuối |
| B12c — tab ghim không bị cướp | PASS | xếp hàng 24 giây, `activeTab` vẫn `decisions`, huy hiệu `1` |
| B12d — tắt điều kiện "chỉ mở khi rảnh" | PASS | mở 7594 ms sau lần gõ cuối |
| B13 — mức thinking khi đổi model | PASS | **400 `THINKING_LEVEL_UNSUPPORTED`**, route không đổi, phiên `completed`; model không có mức ⇒ bỏ im lặng |
| B2c — chấm trên lưới khớp thanh công cụ | PASS | hổ phách "Integrity: Out of scope — unverified" + đỏ "Confidentiality: Secret" |
| B4 — kéo thanh chia tính là hoạt động | PASS | xả **15001 ms** sau lần kéo cuối |
| B6 — intent Files chọn đúng tệp | PASS | breadcrumb `workspace > fixtures > vendor` + khung xem trước |
| Hồi quy R1–R6 | PASS | thinking stream, `/compact` (`8580→3641`), 0 thẻ lượt ma, Stop khi đang chờ, 403/404/400, băng lỗi 409 trong chat |

Không phát hiện lỗi mới trong năm bản sửa. Hai ghi chú không chặn: (1) dạng cây và huy hiệu vẫn in chuỗi tiếng Việt cứng từ `lib/labels.ts` trong khi tiêu đề chấm đã theo i18n — chia tách có từ trước; (2) `agent-browser record stop` treo lần thứ hai, phải diệt daemon rồi ghép lại bằng `ffmpeg -c copy`.

## D. Việc còn nợ

1. ~~Ảnh container phải được dựng lại.~~ **ĐÃ XONG ở vòng 7**: `docker compose build` tạo `agentbox-sandbox:latest` (manifest `sha256:cf06992844d6…`); ba tệp trong ảnh khớp hash repo (`ide-proxy.py a7a83b02…`, `plan_files.py de901085…`, `workspace_files.py fc391ce1…`).
2. **Không có bản ghi hình (`.webm`) cho đợt 4** — chỉ có ảnh chụp; vòng 6 đã bù bằng `recordings/r6_walkthrough.webm` (283,7 giây).
3. **Xác thực CLI Claude Code thật** vẫn không kiểm được trong môi trường này (không có binary, không có thông tin đăng nhập).
