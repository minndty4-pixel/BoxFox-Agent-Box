# Tóm tắt kế hoạch vòng 22 (bản ngắn để chủ nhà đọc trước)

Bản đầy đủ: `docs/plan/v22-boxfox-plan.md`. Ba bản chi tiết: `docs/plan/v22/foundation.md` (33 việc),
`docs/plan/v22/peer-mesh.md` (17 việc), `docs/plan/v22/evidence-proof.md` (25 việc). Bản trong kho:
`docs/plan/v22-boxfox-plan.md` + `docs/plan/v22/`. Mockup: `docs/design/v22/` (xem ở Design-tab).

**Một câu:** ba đợt thi công có thứ tự bắt buộc — **nền tảng → mesh agent con → bằng chứng sống** — biến năm kết luận
đo được ở vòng 21 thành sản phẩm chạy được, tổng **75 việc**, không thêm `status` phiên nào, mọi tính năng nặng đều
có công tắc giết.

## Ba đợt

| Đợt | Việc | Làm gì | Vì sao đợt này trước |
|---|---|---|---|
| **1. Nền tảng** | 33 (5 giai đoạn) | Tệp đính kèm **đi tới box** (menu `+` hết bị cắt, box cấp số RULE-5, đường dẫn thật vào prompt + event); ngân sách cha 16 → **40**, con **40/300**, chạm trần ⇒ **`partial` + chẩn đoán 4 phần** chứ không `failed` trắng; `--apply` kế hoạch **sao lưu trước**; jaccard 0,5–0,75 từ chối một lần; câu trả lời **60 000 cảnh báo / 150 000 từ chối** | Hai đợt kia giả định đã có `partial` + số bước + danh tính lượt |
| **2. Mesh agent con** | 17 (+1 tuỳ chọn) | Sổ con + `peer_read` + `await_children` (**chờ tới lúc bạn giao**, lưới an toàn 300/300) + `deliverTo` với **biên nhận idempotent**; fan-out theo cha (3, trần 6); watchdog; bảng Sub-agents **theo từng lượt** (đóng BUG-43) | Đợt 2 đọc `turn`/`step` và ngân sách bước của đợt 1 |
| **3. Bằng chứng sống** | 25 (6 pha) | `evidence_gate.py` chấm theo **việc đã chạy thật** (diff/sha256, lệnh + exit code, tệp đổi, ảnh trước/sau); nhãn ba trạng thái thay nhãn xanh vô điều kiện; danh sách bằng chứng mở được; S4 rời `not_measured` | Cần danh tính lượt + nhật ký đã hoàn chỉnh |

## Năm câu bạn đã chốt (D-11…D-15) — đã áp hết

1. **Con không tự sinh anh em** — `main` là bên duy nhất sinh và điều phối; con chỉ đọc/đợi/nhận.
2. **Chờ đến khi con kia nhả output**; trần 300 s/lần + 300 s/tổng-lượt chỉ là lưới an toàn (chạm lưới ⇒ `timeout`/`partial`).
3. **Giữ nguyên tool tuần tự** trong một bước; song song đến từ **nhiều con do `main` sinh** (nhiều `explore` cùng lúc).
4. **Bật `enforce`** khi ≥ 20 phiên có số S4 và tỉ lệ báo động sai < 10 %; **DEV** đổi mặc định.
5. **Con 40 bước / 300 s**, và chạm trần thì **tự xác định đang kẹt ở đâu** rồi trả `partial` kèm chẩn đoán bốn phần.

## Ba thứ phải nhớ khi thi công

1. **Không thêm `status` phiên mới** — "đang chờ" là event riêng (`peer_wait`) + cột `waiting_for`.
2. **Khối dùng chung "danh tính lượt"** (peer T2/T3 ⨯ evidence P1.1–P1.3) làm **một lần** ngay sau đợt nền; hai đợt kia chỉ đọc.
3. **Cổng bằng chứng mặc định `warn`** — không bao giờ đổi văn câu trả lời, không bao giờ làm hỏng lượt tốt; `chưa đo được`
   **không bao giờ** hiện thành xanh.

## Đóng vòng khi nào

Ba bộ test xanh (`pytest tests/unit`, `vitest run && tsc -b --noEmit`, `pytest deploy/docker/tests`) cộng **11 việc nghiệm thu
sống** ở §7 của bản đầy đủ: menu bấm được; tệp khớp **byte** trong box; chạm trần ⇒ `partial` + chẩn đoán; con hết ngân sách
⇒ cha nhận chẩn đoán; `STEPS_CLAMPED` đúng một lần; backup kế hoạch khớp sha256; jaccard từ chối một lần rồi nhận; câu trả lời
200 000 ký tự ⇒ `partial`; mesh chờ **tới lúc giao** + 2 biên nhận + không con nào sống sau lượt cha; đổi UI thật ⇒
`verdict='sufficient'` + ảnh trước/sau + nhãn **đã kiểm** trong UI.

## Chi phí

Chấp nhận tốn thêm (D-10), nhưng **phải đo**: `turn_end`/`session_metrics` mang `steps`, `outputTokens`, `waitedMs`,
`childCount` của mỗi lượt có mesh. Công tắc giết: `BOXFOX_PEER_MESH=off`, `BOXFOX_EVIDENCE_GATE=off`,
`BOXFOX_PARALLEL_READ_TOOLS=off` (mặc định, việc vòng sau).
