# Tóm tắt kế hoạch vòng 22 — bằng chứng sống trong câu trả lời cuối (bản ngắn để chủ nhà đọc trước)

Bản đầy đủ: `docs/plan/v22/evidence-proof.md`. Gốc yêu cầu: **D-8** (`docs/tracking/owner-decisions.md`),
phần **D** của `docs/plan/v21-boxfox-plan.md`, **BUG-44** sẽ ghim ở `docs/tracking/bug-register.md`.
Quyết định D-8 đã **chốt** (chủ nhà, 2026-09-22): mặc định `warn`; DEV nâng lên `enforce` khi ≥ 20 phiên
có số trong `~/BoxFox/logs/harness.jsonl` và tỉ lệ báo động sai < 10 %.

**Một câu:** câu trả lời cuối hiện không mang bằng chứng nào — kế hoạch này dựng một *cổng* đọc việc **đã
chạy thật** (diff/hash do tool tự sinh, lệnh + exit code, tệp đã đổi, ảnh/ghi hình), ghim nhãn ba trạng thái
lên câu trả lời và mở một danh sách bằng chứng mở được trong UI — mặc định ở chế độ `warn`, không bao giờ
làm hỏng một lượt.

## Một dòng cho mỗi việc

| Việc | Kết luận đo được hôm nay | Kế hoạch |
|---|---|---|
| **P1. Nền: danh tính lượt + nhật ký + nguyên liệu** | Lượt không có số hiệu trong event/nhật ký; `journal` table chỉ 1 hàng `plan`, chưa từng có `E:`; tool sửa tệp trong box trả về chuỗi rỗng nghĩa (`'Updated <rel>'`) | 5 việc P1.1–P1.5: `turn` cho `turn_start`/`turn_end`/`tool.end` (khoá `turnId` **đã có** trong schema log), `turn`/`step` xuyên nhật ký, hằng số + công tắc, `worker.py` sinh diff/sha256 tại chỗ và ghi tệp bằng chứng, prune định kỳ |
| **P2. Bộ phân loại thuần** | Chưa có gì phân biệt "lượt chỉ đọc" với "lượt đã đổi mã" | 3 việc P2.1–P2.3: `evidence_gate.py` (khuôn `plan_quality.py`) — bảng loại việc → bằng chứng, năm luật phán R1–R5, khối lời nhắc cho vòng vá |
| **P3. Cổng trong lượt** | Điểm duy nhất kiểm câu trả lời là "có chữ, không rỗng" (`runtime.py:1696-1697`) | 6 việc P3.1–P3.6: chèn cổng giữa `:1697` và phát câu trả lời, phép dò box một `docker exec`, **một** vòng vá có guard ngân sách, ghim `E:`/`X:`, số vào `turn.end`, trần 60 000/150 000 (D-4) |
| **P4. Giao diện** | Nhãn `done` xanh vô điều kiện (`HarnessStepView.tsx:1534-1537`); store **ném** khối `journal` mà API đã trả | 5 việc P4.1–P4.5: store đọc `session.journal`, nhãn ba trạng thái (thiếu dữ liệu ⇒ `unverified`, không bao giờ `verified`), danh sách bằng chứng bấm mở được (media → lightbox, tệp → tab Files qua `showTab`), receipt, test DOM bốn ca |
| **P5. Eval** | S4 ("khẳng định không có bằng chứng") đang `not_measured`, ghim bởi `test_eval_setup.py:280-289` | 3 việc P5.1–P5.3: S4 đọc số mới ⇒ `measured` (kèm mốc nâng `enforce` trong `note`: ≥ 20 phiên, < 10 %), giữ `not_measured` khi log cũ, gỡ bản sao danh sách tool, cập nhật ghim + README |
| **P6. Ghi sổ** | — | 3 việc P6.1–P6.3: **BUG-44** (nhãn xanh + store ném nhật ký + tool trả chuỗi rỗng nghĩa), nhật ký vòng mới, cập nhật D-8 |

## Ba thứ phải nhớ khi thi công

1. **Mặc định `warn`, lượt tốt không bao giờ bị chặn** — `warn` không gọi thêm model, không đổi một chữ, không
   đổi `status` phiên. `enforce` mới có **một** vòng vá, và vòng vá phải nằm trong `asyncio.timeout` của lượt
   (`runtime.py:1472`): bỏ vá khi còn < 20 s, trần lồng `min(60, còn lại − 10)` — nếu không sẽ đổi một lượt
   "thiếu bằng chứng" thành một lượt chết vì `DEADLINE` không có câu trả lời.
2. **Không thêm `status` mới, không viết lại văn của model** — bằng chứng đi **kèm** (khoá `evidence` trong
   event `assistant`, hàng `E:` với `turn`/`step`), dùng đúng `E:` (`status='info'`) và `X:`
   (`blocked/failed/resolved/done`) đã có. Ca duy nhất viết lại văn là cắt câu trả lời quá 150 000 ký tự.
3. **Đừng dựng lại image nếu không cần** — `worker.py` được harness gửi vào box ở **mỗi** lần gọi
   (`executor.py:13`, `:104-107`) nên phần diff/hash không cần build; `retention()` + op `captures_prune`
   **đã có sẵn** trong container và quét theo `(kind, sid8)` không lọc phần mở rộng, nên thư mục
   `captures/evidence/` được dọn miễn phí. Ngược lại, box **không có egress** và workspace **không phải git
   repo**: bằng chứng do harness kéo về, "diff" phải tự sinh, đừng trông vào `git diff`.

## Đã chốt: khi nào bật `enforce` (D-8, chủ nhà chốt 2026-09-22)

Không còn câu hỏi mở. **DEV (người bảo trì) đổi mặc định sang `enforce`** khi đủ hai điều kiện: **20 phiên**
đã có số trong `~/BoxFox/logs/harness.jsonl` (đếm phiên, không đếm lượt) **và** tỉ lệ **báo động sai < 10 %**
(soi lại các lượt bị S4 gắn cờ với hàng `E:`/artifacts). Chưa đủ thì giữ `warn`, chạy tiếp, không đổi gì.
Hai con số ấy lấy từ một lệnh ở §6 bản đầy đủ (in `sessions=` / `S4=measured` / `flagged=`), và P5.1 ghi luôn
mốc này vào `note` của tín hiệu S4 để người đọc bảng thấy ngay ngưỡng.

## Ghi chú về mô hình dùng để kiểm (chủ nhà hỏi)

Không đổi so với vòng 21: OpenCode Free, khoá `oc_sk_…`, `muse-spark-1.3-contributor-free` chạy được.
Lượt nghiệm thu của vòng này cần một yêu cầu **đổi UI thật** để có ảnh trước/sau — dùng đúng model đó.
