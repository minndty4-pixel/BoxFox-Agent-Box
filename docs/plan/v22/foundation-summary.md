# Tóm tắt kế hoạch đợt "foundation" (bản ngắn để chủ nhà đọc trước)

> **TL;DR:** Vòng 21 đo được hai lỗi chặn việc (nội dung tệp đính kèm không tới box, lượt hết bước/hạn chót mất sạch
> công đã làm) cộng năm chốt của chủ nhà; kế hoạch này sửa gốc cả hai lỗi, nâng ngân sách bước lên mức chủ nhà chốt
> (cha 40, con **40 bước / 300 s**), buộc lượt chạm trần **chẩn đoán chỗ tắc** thay vì kết thúc trắng, và biến mọi
> giới hạn thành con số đọc lại được — 33 việc, 5 giai đoạn, không thêm trạng thái phiên mới.

Bản đầy đủ: `docs/plan/v22/foundation.md` (33 việc, 5 giai đoạn). Số đo sống: `docs/tracking/test-rounds.md`
§ *Vòng 21*; bảng lỗi: `docs/tracking/bug-register.md` § 6.22; sổ chốt: `docs/tracking/owner-decisions.md`
(D-1…D-10, chốt **2026-09-22**, chủ nhà **Nam Nam**).

## Một dòng cho mỗi việc

| Việc | Hiện trạng đo được | Kế hoạch |
|---|---|---|
| **A. Tệp đính kèm phải tới box** (D-6, BUG-39, BUG-40) | Menu `+` có trong DOM nhưng bị `overflow-hidden` cắt (`ChatInputBar.tsx:268`); tệp chỉ còn cái tên trong chuỗi `[Attached Files: …]`; `.uploaded_artifacts` **rỗng** (kiểm lại hôm nay) | 11 việc A1–A11: popover render **qua portal** (theo mẫu `HarnessModelPicker.tsx:259-263`), giữ đối tượng `File` + `webkitRelativePath`, **box cấp số RULE-5** (`max+1` + `O_CREAT\|O_EXCL`, an toàn với `ThreadingHTTPServer`), trần 25 MiB/tệp, đường dẫn tuyệt đối vào prompt + event `user`, gửi **tối đa 2 ảnh** (tổng ≤ 800 000 ký tự vì request bị chặn 1 MiB), `file_read` đọc được tệp nhị phân, Drive **không còn bịa tên tệp giả**, retention 200 tệp/500 MiB có `X:` |
| **B. Ngân sách bước & hạn chót** (D-1, BUG-41, BUG-42 + yêu cầu mới của chủ nhà) | Cha 8 bước là xong việc vừa phải; con chạm **10 bước/120 s** ⇒ `DEADLINE`, `answerChars = 0`, **mất cả 9 bước**; `TURN_EMPTY_RESPONSE` không thử lại | 10 việc B1–B10: 16 → **40** (trần 60 giữ nguyên), con **40 bước / 300 s** (chủ nhà chốt 2026-09-22, vẫn bị `min()` kẹp theo cha), tách mã `STEP_BUDGET_EXHAUSTED` / `DEADLINE_EXCEEDED`, chạm trần/hạn chót thì **giữ chỗ 3 bước để đọc lại trạng thái + sửa lại một lần nếu đường đã sai**, rồi **một** lời gọi chốt có trần ⇒ trả `partial` với **chẩn đoán bốn phần** (đã làm / tắc ở đâu / còn lại / thử gì tiếp) — giữ nguyên bộ `status` cũ; `TURN_EMPTY_RESPONSE` thử lại **một lần**, `STEPS_CLAMPED` không cắt im lặng, `turn_end` mang `stepsUsed`/`deadlineUsedMs` để đo |
| **C. Ba quyết định về kế hoạch & lịch sử** (D-2, D-3, D-5) | `migrate_plans.py` **không có** bước sao lưu và **không có** đường xoá; tệp này **chưa được stage** vào image; dải jaccard 0,5–0,75 nằm ở `plan_registry.py:62-63`; `.session-history` = **8 phiên + INDEX, 15 tệp, 128 KB** | 5 việc C1–C5: `--apply` **sao lưu trước** (`/home/agent/workspace/.plans-backups/<UTC>/` + `manifest.json` sha256, hỏng backup thì không ghi), `--delete-orphan` **từ chối khi có hàng `P:`**, giữ `--renumber-lone`, stage vào `/usr/local/bin` + runbook sao lưu `sessions.sqlite`, **từ chối một lần** ở dải mơ hồ (lần gửi lại nguyên văn được nhận, có ghim `identityAmbiguity`), và một test chống đổi tên `.session-history` |
| **D. Trần độ dài câu trả lời** (D-4) | Chỉ có kiểm "trọn vẹn và không rỗng" (`runtime.py:1696`); **ngưỡng plan** 40 000/150 000 đã chạy ở `plan_eval.py:72-75` | 2 việc D1–D2: câu trả lời **cảnh báo ở 60 000**, **từ chối ở 150 000** (cắt + notice bền + lượt `partial` + một hàng `X:`), cộng một dòng chỉ dẫn trong prompt ("dài thì ghi ra tệp"); **ngưỡng plan giữ nguyên** |
| **E. Kiểm thử & ghi chép** | Ba bộ test đang xanh; chưa có test nào cho `AttachmentPicker` | 5 việc E1–E5: ba bộ unit + `tsc --noEmit`, một ca tích hợp qua HTTP của harness, **một lượt thử sống đầu-cuối qua `localhost:3100`** (hit-test menu + upload thật + `diff` byte trong box), bốn tệp docs, và bàn giao mockup cho ba mặt giao diện |

## Ba thứ phải nhớ khi thi công

1. **Không thêm `status` mới** — mọi thứ "chưa xong" đi qua `partial` + một bản ghi bền (`notice` / `blocker` / hàng `X:`).
2. **Đường ống upload đã có** — `POST /__box/file/upload` + `lib/workspace/http.ts` + `.uploaded_artifacts` đã chạy
   (panel Workspace Files gọi nó); thiếu **người gọi từ ô soạn tin** và **bộ cấp số ở box**.
3. **Số RULE-5 cấp ở phía box** bằng `max + 1` rồi giữ chỗ `O_EXCL` — **không** thêm tệp trạng thái, vì
   `list_directory` đang cố ý hiện tệp ẩn (`test_workspace_files.py:103` khoá hành vi `.env`).

## Năm chỗ kế hoạch **cố ý** khác bản phác vòng 21

| # | Bản phác | Kế hoạch |
|---|---|---|
| 1 | tệp bộ đếm `.counter` trong `.uploaded_artifacts` | `max + 1` + `O_EXCL` (không để tệp ẩn mọc trong explorer) |
| 2 | D-4 đọc như trần độ dài **plan** | D-4 là trần **câu trả lời**; ngưỡng plan 40 000/150 000 **giữ nguyên** |
| 3 | con 40 bước/300 s | con **40 bước / 300 s** — chủ nhà **đã chốt** ngày 2026-09-22 (xem mục "Chủ nhà đã chốt") |
| 4 | "thêm `turnId`/`deadlineMs`" | ghi `stepsUsed`/`deadlineUsedMs` (`turn_id` cũ là **số bước**, không đụng) |
| 5 | `AttachmentPicker` "đã có test" | **chưa có** — A1/A2/A9 viết mới; ba khẳng định cũ phải đổi **có ý thức** (B2, B3, A6) |

## Chủ nhà đã chốt (2026-09-22) — hết câu hỏi mở

1. **Ngân sách phiên con: 40 bước / 300 s** ⇒ `CHILD_MAX_STEPS = 40`, `CHILD_DEADLINE_SECONDS = 300` (B1, B6);
   vẫn bị `min()` kẹp theo cấu hình cha nên cha mặc định (180 s) ⇒ con 180 s. Phiên chính giữ mặc định **40**, trần **60**,
   hạn chót mặc định **180 s**, trần **600 s**.
2. **Chạm trần/hạn chót phải chẩn đoán chỗ tắc, không kết thúc trắng:** đọc lại tệp đã sửa + kết quả lệnh cuối + việc còn dở,
   sửa lại **một lần** nếu đường đã sai, rồi trả `partial` kèm chẩn đoán **bốn phần** (đã làm / tắc ở đâu / còn lại / thử gì tiếp).
   Trần cứng: `WRAP_UP_STEPS_RESERVED = 3` bước, tối đa `WRAP_UP_READ_TOOL_CALLS = 2` tool đọc, **một** lời gọi chốt
   (`WRAP_UP_TIMEOUT_SECONDS = 30`, `WRAP_UP_MAX_TOKENS = 1024`) trong hạn chót còn lại — việc **B10**, ca nghiệm thu bắt buộc ở E1/B10.
   Bằng chứng cụ thể: con dùng hết ngân sách giờ trả `partial` + `answerChars > 0` + chẩn đoán, **không** còn `failed` trắng như BUG-42.

Cả hai được ghi vào `docs/tracking/owner-decisions.md` ở **E4** (hàng D-1 cập nhật số của con; **thêm một hàng mới**, mã D-11,
cho yêu cầu chẩn đoán; không xoá hàng cũ).

## Đợt này là đợt **nền** — chạy trước hai đợt đang soạn song song

Hai đợt khác đang soạn cùng lúc (`docs/plan/v22/peer-mesh.md` — mesh agent con; `docs/plan/v22/evidence-proof.md`
— bằng chứng ở câu trả lời cuối) đều **giả định** ngữ nghĩa `partial` của lượt và bộ đếm bước đã có. Đợt peer-mesh
đã tự ghi trong handoff của họ rằng T9–T12 cần D-1 (Phần B ở đây) vào trước. Vì vậy: **hợp nhất đợt này trước**, rồi
mới tới hai đợt kia; khi hợp nhất, peer-mesh dùng lại `stepsUsed`/`deadlineUsedMs` (B9), giữ trần con ≥ `CHILD_MAX_STEPS`/`CHILD_DEADLINE_SECONDS`
(B1 = 40/300), và **trừ** cửa sổ chẩn đoán (`WRAP_UP_STEPS_RESERVED`) vào ngân sách con của chính nó.
