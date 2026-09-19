# Nhật ký các vòng kiểm thử — BoxFox Agent Box

Mỗi vòng ghi: phạm vi, cách chạy, kết quả, bằng chứng và lỗi tìm được. Số liệu lấy từ lần chạy cuối của vòng đó.

## Vòng 1 — E2E toàn hệ thống (2026-09-19, sáng)

- Phạm vi: 21 case trên UI 3100, harness 3102, router 3101, box 8081; bám theo kế hoạch 6 nhóm (chat, CUA, browser, router, slash command, giao diện hẹp).
- Kết quả: **15 PASS / 8 FAIL / 0 bị chặn**; tổng hợp được **25 lỗi** (BUG-1 … BUG-25).
- Báo cáo đầy đủ: `/code/.generated_artifacts/boxfox-ket-qua-kiem-thu.md` (bản tiếng Việt, 409 dòng).
- Ảnh/ghi hình: `images/06_capture_inline.png`, `images/07_thinking_block_expanded.png`, `images/12_capture_session_order.png`, `images/13_narrow_900.png`, `images/14_narrow_390.png`, `images/16_plan_panel.png`, `images/19_compaction_notice.png`, `recordings/boxfox_e2e_walkthrough_1920.webm`.

## Vòng 2 — xác minh độc lập đợt sửa (2026-09-19, tối)

- Phạm vi: 33 case trên hệ thống thật sau khi router và harness được khởi động lại; kiểm cả tính trung thực của chuỗi suy luận, thứ tự DOM so với SSE, ma trận slash command, nén context hai chiều, ưu tiên `contextWindow`, `/claude-code` thiếu CLI.
- Kết quả: **30 PASS / 1 FAIL / 1 thông tin**; trạng thái chung: PARTIAL.
- Lỗi tìm được: NEW-1 (nút Compact bị cắt ở khung hẹp 900–1100 px), N-1 (`/skill` thiếu mã lỗi), N-2 (`thinkingLevel` sai được lưu nguyên).
- Bằng chứng: `recordings/r2_walkthrough_v3.webm` (78 giây), `images/r2_19_900_compact_clipped.png`, `images/r2_20_1100_compact_clipped.png`, `images/r2_21_390x844.png`, `images/r2_23_rec_sessionF.png`, `images/r2_30_public_preview.png`.
- Ghi chú: không xác minh được "một tác vụ `/claude-code` thật chạy xong" vì box không có CLI và không có thông tin đăng nhập — chỉ xác minh được đường `SETUP_REQUIRED` trung thực cùng một CLI giả để chứng minh phần truyền tham số.

## Vòng 3 — rà soát tích hợp (2026-09-19, tối)

- Phạm vi: đọc mã hai commit đầu của nhánh, tập trung vào khớp hợp đồng giữa bốn luồng viết song song.
- Kết quả: 9 phát hiện — 1 Cao (R-1), 3 Trung bình (R-2, R-3, R-4), 5 Thấp (R-5 … R-9); kèm 4 điểm đã xác nhận đúng.
- Chi tiết: `docs/tracking/findings-round3.md`.

## Vòng 4 — xác minh đợt 4 trên hệ thống thật (2026-09-19, 21:40)

- Phạm vi: luồng quyết định (duyệt / từ chối / hết hạn / dừng khi đang chờ / trả lời hai lần), plan tự mở và duyệt thật, thao tác file qua giao diện so với `ls` trong box, chip transcript, cuộn chat, nút Compact; kèm săn lỗi mới trên toàn hệ thống.
- Kết quả: **PARTIAL PASS** — mọi luồng chạy đúng khi được kiểm, nhưng luật tự mở tab không tất định ở cấu hình mặc định.
- Lỗi mới: B12 (không tất định, Trung bình–Cao), B13, B2c, B4, B6; B7 rút lại (hai quyết định cùng lúc là bất khả vì lượt thứ hai bị chặn 409).
- Chi tiết: `docs/tracking/findings-round4.md`. Ảnh: `images/r4_*.png`.

## Con số kiểm thử đơn vị (sau khi sửa xong vòng 3, trước vòng 5)

| Bộ | Lệnh | Kết quả |
|---|---|---|
| Router | `cd router && /opt/node24/bin/node --test tests/*.test.mjs` | 64 pass / 0 fail |
| Backend | `.venv/bin/python -m pytest backend/tests -q` | 279 passed, 3 failed, 2 skipped — 3 lỗi là lỗi môi trường có sẵn |
| Container | `.venv/bin/python -m unittest discover -s deploy/docker/tests -p "test_*.py"` | 324 tests OK, exit 0 |
| Frontend | `cd frontend && npx vitest run` | 618 passed, 4 failed — 4 lỗi có sẵn từ trước |
| Kiểu | `cd frontend && npx tsc -b --noEmit` | exit 0 |

Ba lỗi backend có sẵn: hai test CUA/Playwright cần Internet trong khi box tắt mạng theo thiết kế, và `test_terminal_exec_echo` dùng lệnh PowerShell `Write-Output` trên box chỉ có bash.

Bốn lỗi frontend có sẵn: ba test trong `src/components/shell/Sidebar.test.tsx` (jsdom/`dispatchEvent`) và một test trong `src/lib/workspace/index.test.ts` (do tệp `.env.local` cục bộ đặt `VITE_BOX_API_URL=/`).
