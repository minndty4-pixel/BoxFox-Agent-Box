# Tóm tắt kế hoạch vòng 21 (bản ngắn để chủ nhà đọc trước)

Bản đầy đủ: `docs/plan/v21-boxfox-plan.md`. Số đo sống: `docs/tracking/test-rounds.md` § *Vòng 21*.

## Một dòng cho mỗi việc

| Việc | Kết luận đo được | Kế hoạch |
|---|---|---|
| **A. Upload trong dấu `+`** | Không đạt ở **hai** tầng: menu có trong DOM nhưng bị `overflow-hidden` cắt nên vô hình; và nội dung tệp không bao giờ rời trình duyệt — agent chỉ nhận tên trong `[Attached Files: …]`, `.uploaded_artifacts` rỗng | 12 việc A1–A12: sửa gốc clipping (portal), giữ `File`, gọi `POST /__box/file/upload` có sẵn, cấp số RULE-5 **ở phía box**, đưa đường dẫn thật vào prompt + event `user`, ảnh gửi đủ, thư mục/Drive nói thật, trần + retention |
| **B. `maxSteps` / hạn chót** | Việc vừa phải chỉ tốn **8 bước**; việc của con chạm **10 bước/120 s** ⇒ `DEADLINE`, `answerChars = 0`, mất cả 9 bước đã làm | 8 việc B1–B8: 16 → **40**, tách `STEP_BUDGET_EXHAUSTED` / `DEADLINE_EXCEEDED`, **trả `partial` thay vì `failed`**, con 24 bước/240 s, không cắt im lặng, `TURN_EMPTY_RESPONSE` được thử lại một lượt, ghi `stepsUsed` để đo |
| **C. Sub-agent nhìn thấy nhau** | Chưa có: con chỉ có tool theo vai, `session_search` khoá theo sid của chính nó, con không hỏi được người dùng | Kiến trúc ba tầng: **sổ con** (có `turn/step/deliveredTo`) → **`peer_read` + `await_children`** (chỉ cùng một cha) → **giao hàng có địa chỉ** (`deliverTo`), cộng fan-out theo cha, chờ có timeout, prompt hợp đồng, test chuỗi test → review → test |
| **D. Bằng chứng sống cuối lượt** | Chưa có cổng nào; giao diện đang ghim badge xanh vô điều kiện; store bỏ luôn `session.journal` mà backend đã trả | 8 việc D1–D8: module thuần `evidence_gate.py`, ba mức `off/warn/enforce` (mặc định **warn**), một lượt sửa, ghim `E:` theo turn/step, badge ba trạng thái, nối S4 khỏi `not_measured` |
| **E. Bảng Sub-agents theo turn** | Sai: turn 3 (2+2, 3 s) vẫn hiện con của turn 2; event `child` không mang turn nên giao diện không thể phân | 6 việc E1–E6: thêm `turn/step` vào event `child`, lọc theo turn (có công tắc "tất cả turn"), store giữ mốc turn, bấm hàng con nhảy đúng bước cha, tương thích event cũ |
| **F. Năm việc chủ nhà chốt** | — | Khuyến nghị: (1) **có** 40 + partial; (2) **có** `--apply` nhưng sao lưu trước, giữ `--renumber-lone`, chỉ xoá plan thử nếu không `P:` nào trỏ tới; (3) **từ chối một lần** ở dải mơ hồ; (4) **hai mức** 60 000 cảnh báo / 150 000 từ chối; (5) **giữ `.session-history`** |

## Ba thứ phải nhớ khi thi công

1. **Không thêm `status` mới** — luồng đang lọc `running`/`awaiting_decision` và giao diện ánh xạ giá trị lạ
   thành `failed` (`SubagentInspectorPanel.tsx:170`); mọi thứ "chưa xong" đi qua `partial` + bản ghi `X:`.
2. **Đường ống upload đã có** — đừng viết đường mới; `POST /__box/file/upload` + `lib/workspace/http.ts` +
   `.uploaded_artifacts` là đủ: panel Workspace Files đã gọi đường đó
   (`hooks/useWorkspaceFiles.ts:473`), thiếu là người gọi **từ ô soạn tin** và bộ đếm số RULE-5.
3. **Bằng chứng phải đo được** — mỗi hành vi mới ghim một con số vào `turn_end` / `system_log`, nếu không thì
   S4 mãi là `not_measured` và vòng sau lại phải đoán.

## Model dùng cho các bài test (chủ nhà hỏi)

OpenCode Free, khoá `oc_sk_…`: **`muse-spark-1.3-contributor-free` và `muse-spark-1.2-contributor-free` đều chạy được**
(đo sống: `status: passed`, có usage trả về; giao diện hiện đủ 9 model `-free` trong menu "Single Models").
Không cần báo lại là thiếu model.
