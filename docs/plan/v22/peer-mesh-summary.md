# Tóm tắt kế hoạch vòng 22 — mesh agent con (con nhìn thấy nhau, đường ống chờ cho việc dài)

Bản đầy đủ: `docs/plan/v22/peer-mesh.md` (6 pha, **17 việc**; mục T14 là việc tuỳ chọn để vòng sau, không tính
vào vòng này). Mỗi việc có tệp·dòng, rủi ro và lệnh nghiệm thu.
Số đo hiện trạng được **kiểm lại trong mã** ngày 2026-09-22, nhánh `vorflux/v21-boxfox-plan` @ `e9ce91d`;
bốn đính chính so với bản mô tả đầu vào nằm ở §0.3 của bản đầy đủ.
**Ba câu hỏi mở của vòng đã được chủ nhà trả lời** — chốt nằm ở §0.1 và §4 của bản đầy đủ.

## Vấn đề, trong một đoạn

Hôm nay một cha chỉ sinh **một** con và **chờ con đó xong** (`runtime.py:2531-2535`, `child_slots = asyncio.Semaphore(3)`
toàn tiến trình `runtime.py:967`). Con không có tool nào để đọc/đợi/nhắn bạn (`roles.py:7-11`, `tool_contracts.py:17-117`),
`session_search` khoá theo sid của chính nó (`roles.py:159-160`, `runtime.py:1912-1967`), con không hỏi được người dùng
(`runtime.py:1991-1995`). Vì vậy ba luồng chủ nhà mô tả — test chờ review rồi chạy tiếp; plan song song research rồi chờ
research; các luồng kiểm tra/việc dài lặp lại khuôn đó — **không có đường nào chạy**.

## Cách làm: một sổ con ở giữa, bốn primitive hai phía

| Tầng | Nội dung | Việc |
|---|---|---|
| **Sổ** | bảng `children` (parent_id, parent_turn, spawn_step, role, goal, status, deliveries, waiting_for) + bảng `child_deliveries` (khoá duy nhất chống giao lặp) + cột `sessions.turn_count` | T1–T3 |
| **Nhìn** | `peer_read(sessionId, afterSeq, limit)` — chỉ anh em **cùng một cha**, cửa sổ có trần, bỏ ảnh/base64 | T8 |
| **Chờ** | `await_children(targets, mode, timeoutSeconds?)` — mặc định **chờ tới lúc bạn giao xong kết quả** (đánh thức bằng sự kiện giao hàng); hai con số 300 s chỉ là **lưới an toàn**; chạm lưới ⇒ `timeout`/`partial`, **không bao giờ** `failed` | T9 |
| **Giao** | `deliverTo: ['main']`, `['peer:<sid>']`, `['role:<role>']` — biên nhận idempotent, bơm kết quả **đã trần** vào context người nhận ở ranh giới bước | T11, T12 |
| **Nở** | fan-out **theo cha** (mặc định 3, trần 6) + trần toàn cục 8, thay `Semaphore(3)`; `main` sinh **nhiều `explore` cùng lúc** — đây là **nguồn song song của vòng này**; `delegate_task(wait=false)` sinh con không chặn | T5, T6 |
| **An toàn** | kết thúc lượt cha ⇒ dừng con (T7); watchdog quét sổ con + khôi phục sau khởi động (T10); trần + công tắc giết + đo chi phí (T13) | T5–T13 |

## Sáu pha, 17 việc

| Pha | Việc | Ghi chú |
|---|---|---|
| 1. Dữ liệu & lượt | T1 sổ con + di trú ghi thêm · T2 bộ đếm lượt + `turn` mọi event · T3 `child` event mang `turn`/`step` · T4 bảng Sub-agents **theo từng lượt** (BUG-43) | Không đổi hành vi, gộp được ngay |
| 2. Nhiều con cùng lúc | T5 fan-out theo cha (**đầu tàu song song**) · T6 `wait=false` · T7 dừng con khi lượt cha đóng | T5–T7 phải vào cùng PR |
| 3. Nhìn & chờ | T8 `peer_read` · T9 `await_children` (chờ tới lúc giao) · T10 watchdog | Cần T6 xong trước |
| 4. Giao hàng | T11 `deliverTo` + biên nhận · T12 bơm vào vòng bước của người nhận | Trái tim của L1/L2 |
| 5. Trần & đo | T13 đo chi phí + trần + công tắc | Trong vòng này |
| 6. Đầu-cuối & tài liệu | T15 giao diện "đang chờ &lt;bạn&gt; giao kết quả" · T16 chuỗi `review → test → main` · T17 chạy sống + số đo · T18 nhật ký/sổ lỗi/sổ chốt/ADR | T16 là điều kiện đóng vòng |
| *(vòng sau)* | *(tuỳ chọn)* T14 chạy song song tool ĐỌC trong một bước — **giữ nguyên hành vi tuần tự hôm nay**, cờ mặc định `off` | Q3: không cần cho L1–L3, chạm tài nguyên dùng chung của box |

## Chủ nhà đã chốt (ba câu hỏi của vòng này)

1. **Q1 — con KHÔNG tự sinh việc.** Không có `spawn_peer`, không có công tắc `BOXFOX_PEER_SPAWN`; **`main` là bên
   duy nhất** sinh con và điều phối đường ống. Con vẫn có đủ ba quyền cần thiết: **đọc** bạn (`peer_read`),
   **chờ** bạn (`await_children`), **nhận** kết quả bạn giao (`peer_delivery`).
2. **Q2 — chờ kết thúc khi bạn giao xong kết quả**, không phải sau một khoảng cố định ("test cứ kiểm cho tới lúc
   nào đó thì dừng lại chờ review xong rồi nhận báo cáo"). Lưới an toàn 300 s/lần chờ và 300 s/tổng-lượt chỉ để
   lượt không bao giờ trông như treo; chạm lưới ⇒ `timeout`/`partial` và **không bao giờ** `failed`.
3. **Q3 — giữ nguyên cách một agent gọi nhiều tool trong một bước (tuần tự).** Song song thật đến từ việc `main`
   điều phối **nhiều con một lúc** (fan-out theo cha: mặc định 3, trần 6).
4. **Ngân sách con: 40 bước / 300 s** ⇒ `CHILD_MAX_STEPS = 40`, `CHILD_DEADLINE_SECONDS = 300`; mọi trần khác của
   con (`CHILD_WALL_MAX_SECONDS = 900`) phải **≥** hai giá trị này.
5. **Con không hỏi người dùng, không tự sinh việc** — con chỉ **đọc, chờ và nhận** (bất biến #6 ở §0.4 bản đầy đủ).

## Bốn thứ phải nhớ khi thi công

1. **Không thêm `status` mới.** Phiên lọc `running`/`awaiting_decision` (`runtime.py:1199`, `runtime_commands.py:29-31`),
   giao diện ánh xạ giá trị lạ thành `failed` (`SubagentInspectorPanel.tsx:170`). "Đang chờ" là **event riêng**
   (`peer_wait`) + cột `waiting_for`, không phải trạng thái phiên.
2. **Giao hàng là ghi-thêm, có khoá duy nhất.** `UNIQUE(child_id, recipient, recipient_turn)` + chuyển
   `pending → injected` trong một transaction ⇒ bơm hai lần là không thể; ghi biên nhận cũng là lúc **đánh thức**
   người đang chờ (cùng transaction), nên không polling và không trễ nhịp. Người nhận đã chết ⇒ biên nhận `skipped`.
3. **Chờ không có thời lượng cố định; trần chỉ là lưới an toàn.** Ba lớp giữ lượt kết thúc được: lưới an toàn mỗi
   lần chờ (300 s), hạn mức hoãn hạn chót mỗi lượt (300 s), và D-1 (hết bước/hết hạn ⇒ `partial` **có nội dung**).
   Mọi con số đều phải đo được bằng một dòng event hoặc một dòng `system_log`.
4. **Đo bằng số, không bằng cảm nhận**: `finish` và `turn.end` mang `turn`, `waitedMs`, `childCount`, `childSteps`,
   `childTokens`; `session_metrics` thêm khối `peers`; `runtime_info` trả trần để giao diện không chép tay.

## Công tắc và mặc định (nói rõ)

| Công tắc | Mặc định | Tắt thì được gì |
|---|---|---|
| `BOXFOX_PEER_MESH` | **on** | `off` ⇒ y hệt hành vi hôm nay (uỷ thác chặn, không quảng cáo tool peer) |
| `BOXFOX_PEER_FANOUT` | 3 (trần 6) | `1` ⇒ mỗi cha một con như cũ |
| `BOXFOX_PARALLEL_READ_TOOLS` | **off** (Q3) | Giữ đúng hành vi hôm nay; cờ chỉ có nghĩa nếu T14 được làm ở vòng sau |
| con tự sinh anh em (`spawn_peer`) | **không tồn tại** | Ngoài phạm vi (Q1) — không thêm công tắc nào |

## Điều kiện đóng vòng (đo được)

Lượt cha sinh **nhiều con cùng lúc** (≥ 2) với `turn` đúng; `test` chờ `review` và chạy tiếp ở đúng mốc **review giao
xong** (không phải hết lưới 300 s); review giao **cả** `main` và `test` với đúng 2 biên nhận và 1 `peer_delivery`,
không message nào bị bơm hai lần; chạm lưới an toàn ⇒ `timeout` + `pending` mà lượt vẫn `completed`/`partial`,
**không** `failed`; kết thúc lượt cha ⇒ không còn con nào sống; bảng Sub-agents ở lượt không có con thì **rỗng**;
vòng lô tool `runtime.py:1728-1769` **không bị sửa** và không có `spawn_peer` trong schema; có báo cáo chi phí tăng
thêm (bước/token/giây) và `BOXFOX_PEER_MESH=off` cho đúng hành vi hôm nay.
