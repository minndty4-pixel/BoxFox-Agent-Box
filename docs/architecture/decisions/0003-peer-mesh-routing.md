# ADR-0003: Định tuyến, giao hàng và trần cho mesh agent con

- **Trạng thái:** Đã chốt và đã thi công (vòng 22, đợt 2 — T1…T17); T14 (`parallelReadTools`) để lại vòng sau theo D-13.
- **Ngày:** 2026-09-22
- **Quyết định liên quan:** `docs/tracking/owner-decisions.md` (D-7, D-11, D-12, D-13, D-15), `docs/architecture/agent-harness.md` §6 và §8, `docs/tracking/bug-register.md` §6.24, `docs/tracking/test-rounds.md` § *Vòng 22 — đợt 2*.

## Bối cảnh và thuật ngữ

**Agent con** là phiên con do phiên chính sinh ra qua `delegate_task`, có event stream và ngữ cảnh riêng. **Sổ con** là bảng `children` trong `~/BoxFox/harness/sessions.sqlite` — nguồn sự thật về một con. **Bảng giao hàng** là bảng `child_deliveries`: mỗi hàng là một **biên nhận** cho một cặp (con, người nhận, lượt người nhận). **Fan-out** là số con một cha được chạy cùng lúc. **Wake-up** là việc bơm kết quả của con vào vòng bước đang chạy của người nhận. **Watchdog** là vòng quét định kỳ đóng những hàng con còn `started` mà không ai còn chạy.

Trước đợt 2, mesh chưa tồn tại ở mức sản phẩm: một cha chỉ có một đường sinh con và chạy tuần tự; trần con là **một** `Semaphore(3)` dùng chung cả tiến trình nên hai cha tranh nhau ba slot; con không có cách nào đọc, đợi hay nhận kết quả của con khác; cha hết lượt thì con vẫn sống tiếp. Chủ nhà chốt D-7 ("agent con phải nhìn thấy nhau") và trả lời bốn câu hỏi D-11…D-15 (không cho con tự sinh anh em; chờ tới lúc bạn giao; giữ tool tuần tự; ngân sách con 40 bước / 300 s kèm chẩn đoán kẹt).

## Quyết định đã chốt

| # | Quyết định | Hằng số / hình dạng | Việc |
|---|---|---|---|
| 1 | **Fan-out theo cha, giữ trần toàn cục** | `FANOUT_PER_PARENT_DEFAULT = 3`, `FANOUT_PER_PARENT_MAX = 6`, `FANOUT_GLOBAL_CEILING = 8`, `CHILDREN_PER_TURN_MAX = 12`, `FANOUT_QUEUE_WAIT_SECONDS = 30` | T5 |
| 2 | **Sổ con là nguồn sự thật** | bảng `children` + `child_deliveries`, khoá duy nhất `(child_id, recipient, recipient_turn)` | T1, T3, T11 |
| 3 | **Chờ tới lúc bạn GIAO, không chờ đồng hồ** | `PEER_WAIT_SAFETY_SECONDS = PEER_WAIT_MAX_SECONDS = PEER_WAIT_TOTAL_MAX_SECONDS = 300`, `PEER_WAIT_FORCE_GRACE_SECONDS = 30` | T9, T10 |
| 4 | **Giao hàng có định tuyến, biên nhận idempotent** | `PEER_DELIVER_MAX = 4` địa chỉ, `PEER_WAIT_RESULT_CHARS = 16_000` | T11 |
| 5 | **Wake-up bơm kết quả vào vòng bước** | `notify_peer_delivery` + `drain_peer_deliveries` | T12 |
| 6 | **Công tắc giết ba lớp** | `BOXFOX_PEER_MESH=off`, `BOXFOX_PEER_FANOUT=1`, `BOXFOX_PEER_WAIT_MAX=<giây>` | T5, T10, T13 |
| 7 | **Con KHÔNG tự sinh anh em; cây con phẳng một tầng** | không có `spawn_peer`; cây phẳng **theo cấu trúc** (vai của con không mang `delegate_task`, nên nó không có đường nào sinh con) — không có tham số `max_depth` nào trong mã | T5, D-11 |
| 8 | **Hết lượt cha ⇒ con dừng; watchdog ba lưới** | `PARENT_TURN_ENDED`, `WATCHDOG_TIMEOUT` (`CHILD_WALL_MAX_SECONDS = 900`), `ORPHAN`, `RESTART` | T7, T10 |

Chi tiết từng quyết định:

1. **Fan-out theo cha.** Trần đặt theo từng cha (mặc định 3, trần 6 qua `BOXFOX_PEER_FANOUT`) và vẫn giữ **một** trần toàn cục 8 — đủ cho hai cha × ba con mà không tăng tải mặc định của máy. Hết chỗ, lượt **không** treo: sau `FANOUT_QUEUE_WAIT_SECONDS = 30` model nhận lỗi tool `FANOUT_BUSY`. Trần thứ hai `CHILDREN_PER_TURN_MAX = 12` chặn vòng lặp sinh con trong một lượt 40 bước (mã `CHILDREN_PER_TURN_EXHAUSTED`).
2. **Sổ con.** Hàng `children` mang `session_id`, `parent_id`, `parent_turn`, `spawn_step`, `role`, `goal`, `status`, `reason`, `deliveries`, `waiting_for`, `waiting_since`, `started`, `finished`, `steps_used`, `output_tokens`, `answer_chars`. Bảng giao hàng là bảng **riêng** để biên nhận có khoá duy nhất — cùng một kết quả không thể bơm hai lần vào cùng một người nhận ở cùng một lượt.
3. **Chờ bằng sự kiện.** `await_children` ngủ tới khi biên nhận giao hàng được ghi (đánh thức trong cùng nhịp, không polling) chứ không chờ một khoảng cố định. Ba con số 300 s là **lưới an toàn**: chạm lưới thì `peer_wait_end` mang `status='timeout'` và lượt **không** bị đánh `failed` (D-12). Watchdog đánh thức cưỡng bức sau `300 + 30` giây.
4. **Giao hàng có định tuyến.** `deliverTo` nhận tối đa `PEER_DELIVER_MAX = 4` địa chỉ; địa chỉ hiểu `role:<vai>`, `peer:<sid>` và `main`. Giao hàng phân giải **một lần** lúc con đóng sổ: một địa chỉ chưa tồn tại thành hàng `skipped` kèm `reason`, **không** dò lại. Cửa sổ dò mỗi giây trong `PEER_TARGET_GRACE_SECONDS = 20` nằm ở phía **người chờ** (`await_children`), nơi anh em có thể được sinh ngay sau lời gọi — người gửi đã đóng sổ nên không có gì để chờ.
5. **Wake-up.** Người nhận đang chạy một lượt thì kết quả vào **vòng bước kế tiếp** của chính lượt đó; người nhận đang rảnh thì kết quả chờ sẵn và được bơm ở bước đầu của lượt sau.
6. **Công tắc giết.** `BOXFOX_PEER_MESH=off` là công tắc của **cả mesh**: không tool peer, uỷ thác chặn như bản trước đợt 2. `BOXFOX_PEER_FANOUT=1` hạ về một con mỗi cha. `BOXFOX_PEER_WAIT_MAX=<giây>` chỉ **hạ** được trần chờ, không nâng. Cả ba đọc env **mỗi lần hỏi**, nên đổi công tắc có hiệu lực ngay mà không phải khởi động lại harness. Cờ nào vòng này không đổi hành vi (`parallelReadTools` — Q3/T14) đi kèm notice `PEER_MESH_NOTICE` nói thẳng nó không có hiệu lực.
7. **Cây con phẳng một tầng.** Con chỉ "nhìn thấy nhau" ở mức đọc (`peer_read`), đợi (`await_children`) và nhận giao hàng. Mọi con đều cùng cha, không có `lineage` sâu và không có vòng lặp cha–con, nên mọi trần ở mục 1 là trần của cả cây. Bảo đảm này là **cấu trúc**, không phải một con số: mã không có tham số `max_depth`, và nó không cần — vai của con (`ROLE_SKILLS`/`allowed_tools`) không mang `delegate_task`, nên không có đường nào để một con sinh ra con.
8. **Dừng và dọn.** Hết lượt cha ⇒ `reap_children` đóng mọi con còn sống bằng `PARENT_TURN_ENDED` (T7). Watchdog quét mỗi 10 s và đóng ba loại hàng còn sót: quá `CHILD_WALL_MAX_SECONDS = 900` (`WATCHDOG_TIMEOUT`, huỷ task), hàng `started` của tiến trình **trước** (`RESTART` — không hồi sinh, thao tác tool không chạy lại), và con mồ côi không còn cha hoạt động (`ORPHAN`).

## Lựa chọn đã cân nhắc và lý do loại

| Lựa chọn | Vì sao không dùng |
|---|---|
| Giữ **một** `Semaphore(3)` toàn tiến trình | Hai phiên cha tranh nhau ba slot và một cha không thể có bốn con; trần theo cha là thứ người dùng nhìn thấy trong bảng Sub-agents, còn trần toàn cục chỉ để giữ tải máy. |
| Cho con tự sinh anh em (`spawn_peer`) | Chủ nhà chốt **không** (D-11): mọi việc sinh con do phiên chính điều phối; con tự sinh thì trần theo cha vô nghĩa và cây con không còn phẳng một tầng. |
| Chờ và trả kết quả con qua tin nhắn tự do | Không có biên nhận thì không biết kết quả đã vào lượt hay chưa, và cùng một kết quả có thể vào hai lần. Bảng giao hàng + khoá duy nhất trả lời câu đó bằng dữ liệu. |
| Chờ theo đồng hồ cố định (ví dụ 60 s) | Việc thật dài ngắn khác nhau; chờ cố định thì hoặc cắt việc đang chạy tốt, hoặc bắt người dùng đợi vô ích. Lưới an toàn 300 s giữ đúng vai trò "đừng để lượt trông như treo". |
| Đọc song song nhiều tool trong một bước (T14) | Giữ nguyên tuần tự theo D-13; điểm song song của vòng 22 là **fan-out theo cha**. Cờ `parallelReadTools` vẫn được nhận và trả notice, không im lặng. |
| Bơm kết quả con vào **lượt mới** thay vì vòng bước đang chạy | Người dùng phải gửi thêm một câu mới để thấy kết quả; wake-up giữ đúng một lượt và đúng một câu trả lời cuối. |

## Hệ quả

- **Đo được từng lượt.** `finish` mang `childCount`, `childSteps`, `childTokens`, `childDeliveries`; sổ con ghi `steps_used` / `output_tokens` cho từng con. Token của con cộng **cả chuỗi bước** của con đó, không phải bước cuối — bài học từ một khiếm khuyết đo sống trong chính đợt này (BUG-49).
- **Giao diện.** Bảng Sub-agents tách theo **từng lượt** (D-9, BUG-43): "đang chờ `<vai>` giao kết quả" (kèm "lưới an toàn còn …"), mũi tên "đã giao cho …", huy hiệu "đã nhận từ … · N chars".
- **Luật chờ của cha.** Cha **không** chờ con ruột đã đóng: một con của chính cha đã kết thúc thì kết quả của nó nằm trong lượt cha rồi, cha không cần biên nhận (BUG-48).
- **Rủi ro còn lại.** (1) Bảng `child_deliveries` phình theo số cặp (con, người nhận, lượt) — chưa có việc dọn. (2) Trần toàn cục 8 là hằng số của tiến trình, không phải cấu hình theo phiên. (3) Cờ `BOXFOX_PEER_WAIT_MAX` chỉ tác dụng từ lúc hỏi, nên hai lượt trong cùng một tiến trình có thể chạy hai trần khác nhau nếu người vận hành đổi env giữa hai lượt.
- **Việc còn lại.** T14 (`parallelReadTools`) và `spawn_peer` **không** thuộc vòng 22; mọi thay đổi mesh sau này phải giữ bốn bất biến: sổ con là nguồn sự thật, biên nhận có khoá duy nhất, chạm lưới an toàn không bao giờ làm lượt `failed`, và một con không tự sinh con.
