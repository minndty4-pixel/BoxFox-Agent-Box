# Phát hiện mới — vòng kiểm thử ngày 2026-09-19 (đợt 3)

Nguồn: (a) vòng kiểm thử E2E độc lập trên hệ thống đang chạy (`verify-e2e`, 30 PASS / 1 FAIL / 1 thông tin), (b) rà soát tích hợp độc lập nhánh `vorflux/fix-e2e-defects` (`review-part4`, 9 phát hiện).

Ký hiệu: `ĐANG SỬA` = có người đang sửa trong cây làm việc; `ĐÃ SỬA` = đã có mã + test; `MỞ` = chưa xử lý; `GHI NHẬN` = biết, cố ý để lại.

## A. Từ vòng kiểm thử E2E

| Mã | Mức | Mô tả | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| NEW-1 | Trung bình | Nút Compact bị cắt khi khung chat hẹp dù cửa sổ rộng: ở 900 px mép phải nút là 470 px so với mép khung 440 px (cắt 30 px, hiện "Co"); ở 1100 px cắt 32 px. Nguyên nhân: `ContextUsageBar.tsx` rút gọn theo breakpoint của **viewport** trong khi ràng buộc thật là bề rộng **khung chứa** | `images/r2_19_900_compact_clipped.png`, `images/r2_20_1100_compact_clipped.png` | ĐANG SỬA |
| N-1 | Thấp | `/skill <id>` không kèm task trả về thông báo không có mã lỗi máy đọc được, trong khi các đường lỗi khác đều có (`UNKNOWN_COMMAND`, `COMMAND_DISABLED`, `SKILL_DISABLED`) | ma trận slash command | ĐANG SỬA |
| N-2 | Thấp | `thinkingLevel` không hợp lệ vẫn được lưu nguyên văn khi tạo phiên (lượt chạy vẫn xong) | kiểm tra tạo phiên | ĐANG SỬA |
| B-1 | — | Không xác minh được "một tác vụ `/claude-code` thật chạy xong": box không có CLI Claude Code và không có thông tin đăng nhập. Đã xác minh đường `SETUP_REQUIRED` trung thực + một CLI giả để chứng minh phần truyền tham số | `r2_28_rec_setup_required.png` | GHI NHẬN (giới hạn môi trường) |

## B. Từ rà soát tích hợp

| Mã | Mức | Mô tả | Nơi | Trạng thái |
|---|---|---|---|---|
| R-1 | **Cao** | Yêu cầu quyết định phát ra từ phiên con (sub-agent) thì giao diện không thấy và không trả lời được, mà lượt chạy của phiên cha vẫn bị đốt hết hạn. `delegate_task` chặn phiên cha chờ phiên con, nhưng UI chỉ đọc quyết định của chat đang mở, và phiên con không bao giờ trở thành chat đang mở | `runtime.py:686,690,826-828`, `roles.py:149-154`, `DecisionsPanel.tsx:33-34`, `harnessChatStore.ts:435-445` | ĐANG SỬA |
| R-2 | Trung bình | Chốt "lần nạp đầu" chỉ áp cho tab `plan`, nên `ui_intent{tab:'decisions'}` phát lại từ nhật ký sự kiện vẫn cướp tab khi mở lại trang (một quyết định cũ ⇒ tab Decision tự mở; nhiều quyết định cũ ⇒ huy hiệu ảo tới sát trần 20) | `harnessChatStore.ts:232` | ĐANG SỬA |
| R-3 | Trung bình | Trạng thái `awaiting_decision` không được coi là "đang bận", nên người dùng gõ tiếp thì nhận 409 thô, nút Stop bị ẩn, và cách duy nhất để huỷ lượt đang chờ là gõ đúng chữ `/stop` | `ChatPanel.tsx:186,322,384`, `harnessChatStore.ts:351` | ĐANG SỬA |
| R-4 | Trung bình | `PROTECTED_PATHS` chỉ được kiểm ở `delete`; `rename`/`move` có thể di chuyển hoặc chôn các mục được bảo vệ. Ví dụ: đổi tên `.plans` ⇒ tab Plan trắng; chuyển `.trash` vào `src` ⇒ thùng rác hiện ra | `workspace_files.py:898,917,1000-1001` | ĐANG SỬA |
| R-5 | Thấp | Lỗi khi trả lời quyết định không hiện ở panel người dùng vừa bấm, chỉ hiện ở cột chat; hàng quay lại trạng thái "chờ" như chưa có gì xảy ra | `DecisionsPanel.tsx:73-81` | ĐANG SỬA |
| R-6 | Thấp | Trạng thái chết sau khi viết lại `PlanPanel`: `planVersion`/`setPlanVersion` không còn nơi dùng | `uiStore.ts:202,370-371` | ĐANG SỬA |
| R-7 | Thấp | `worker.write_plan` trả về `identity` dạng có tiền tố version — đúng dạng mà hợp đồng cấm; hiện vô hại vì `runtime.write_plan` bỏ qua trường này, nhưng là bẫy cho người đọc sau | `sandbox/worker.py:169` | ĐANG SỬA |
| R-8 | Thấp | Chú thích đầu tệp `PermissionCard.tsx` vẫn khẳng định bộ đếm ngược 10 phút là thật; nay chỉ đúng cho thẻ của transport giả | `PermissionCard.tsx:1-11` | ĐANG SỬA |
| R-9 | Thấp | Hợp đồng ghi `reason` gồm `file_selected`/`child_started` nhưng không producer nào phát; trạng thái "có định nghĩa mà không có thật" dễ khiến đợt sau viết sai | `docs/plan/next-batch-contract.md` §1 | ĐÃ SỬA (tài liệu) |

## C. Điểm đã được xác nhận là đúng (không cần sửa)

1. `plan_written.identity` khớp hai phía: bên phát dùng `plan_identity()` từ đường dẫn đã xác nhận, bên đọc nhóm theo đúng khoá đó; giá trị có tiền tố version không thể tới được giao diện.
2. Đơn vị thời hạn là epoch giây xuyên suốt; bộ đếm ngược nhân 1000 đúng một lần; ngân sách lượt chạy được tạm dừng khi chờ quyết định nên mốc 300/600 giây mới tới được.
3. `decision_resolved` đúng một lần cho mỗi mã trên cả bốn đường thoát (trả lời, hết hạn, dừng phiên, thoát tiến trình).
4. Đường ghi của container dùng chung bộ kiểm tra đường dẫn, `O_NOFOLLOW`, không xoá cứng, và `.trash` bị ẩn khỏi cả danh sách lẫn ảnh zip.
