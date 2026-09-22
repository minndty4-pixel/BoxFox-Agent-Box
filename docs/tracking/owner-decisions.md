# Sổ chốt việc của chủ nhà (owner decisions)

Tệp này ghi lại **các quyết định đã chốt**, kèm lý do đo được và việc nào bị ảnh hưởng, để các vòng sau tra cứu và
chỉnh sửa. Khi một quyết định thay đổi, **không xoá dòng cũ**: đổi `Trạng thái` thành `Đã thay thế` và ghi dòng mới
xuống phần *Lịch sử sửa đổi* ở cuối tệp.

Quy ước: `Trạng thái` nhận một trong `Đã chốt` (chủ nhà chốt, chưa thi công), `Đang thi công`, `Đã xong`,
`Đã thay thế`. Mọi số đo trong tệp này đến từ `docs/tracking/test-rounds.md` § *Vòng 21* và
`docs/tracking/bug-register.md` § 6.22.

## 1. Năm quyết định chốt ngày 2026-09-22

Chủ nhà: Nam Nam (minndty3@gmail.com). Nguồn: năm câu hỏi cuối bảng trong
`docs/plan/v21-boxfox-plan.md` § Kế hoạch F; khuyến nghị đã gửi và **được chốt nguyên theo khuyến nghị**.

| Mã | Quyết định | Chốt | Lý do đo được | Việc bị ảnh hưởng | Trạng thái |
|---|---|---|---|---|---|
| D-1 | Ngân sách bước: `MAX_STEPS_DEFAULT` 16 → **40**, trần giữ 60; hết bước hoặc hết hạn thì trả **`partial`** thay vì `failed`; tách mã `STEP_BUDGET_EXHAUSTED` / `DEADLINE_EXCEEDED` | Có | Việc vừa phải chỉ tốn 8 bước (phiên `dddebffb887a4f6ca814c1514367d38d`), nhưng con chạm 10 bước / 120 s thì `answerChars = 0` (BUG-42) | `backend/src/agentbox/agent_core/limits.py`, `failures.py`, `runtime.py` | Đã chốt |
| D-2 | Cơ chế `--apply` cho kế hoạch: **sao lưu trước khi áp dụng**, giữ `--renumber-lone`, chỉ xoá kế hoạch thử khi **không** bản ghi `P:` nào trỏ tới | Có | Lượt dán nội dung Markdown gọi `write_plan` bị từ chối 4 lần rồi nhận ở lần thứ năm (`/tmp/runA.txt`) | `backend/src/agentbox/skills/runtime_commands.py`, `agent_core/plan_quality.py` | Đã chốt |
| D-3 | Chống kế hoạch trùng: **từ chối một lần** khi độ trùng rơi vào dải mơ hồ jaccard 0,5–0,75 | Có | Cùng một kế hoạch bị từ chối 2 lần: `steps-unanchored` (4/11 bước có mốc) rồi `plan-no-steps` | `agent_core/plan_quality.py`, `scripts/eval/rubric.py` | Đã chốt |
| D-4 | Giới hạn độ dài câu trả lời cho đường phổ biến nhất: **60 000 ký tự cảnh báo**, **150 000 ký tự từ chối** | Có | Câu trả lời dài làm lượt dễ đứt ngân sách; ngưỡng lấy theo mức đã quan sát trong vòng 21 | `backend/src/agentbox/agent_core/runtime.py`, `failures.py` | Đã chốt |
| D-5 | Giữ **`.session-history`** trong box, chưa dọn | Có | Đo được 9 thư mục phiên, 15 tệp, **128 KB** trong box `agentbox-box` — còn rẻ hơn chi phí dựng lại lịch sử | `deploy/docker/box-entrypoint.sh`, `session_files.py` | Đã chốt |

## 2. Năm câu hỏi của vòng 22 — đã chốt ngày 2026-09-22

Năm câu này sinh ra khi soạn kế hoạch thi công cho D-6…D-10. Chủ nhà trả lời trực tiếp; câu trả lời **đã được áp
vào kế hoạch** (`docs/plan/v22-boxfox-plan.md`).

| Mã | Câu hỏi | Chốt | Áp vào kế hoạch |
|---|---|---|---|
| D-11 | Con có được tự sinh anh em (`spawn_peer`) không? | **Không.** Mọi việc sinh con do **phiên chính** điều phối; con chỉ "nhìn thấy nhau" ở mức đọc/đợi/nhận kết quả của nhau | Bỏ `spawn_peer` khỏi phạm vi vòng 22; con vẫn có `peer_read` + `await_children` + nhận giao hàng |
| D-12 | Trần thời gian chờ giữa các con? | **Chờ đến khi con kia nhả output.** Trần 300 s mỗi lần chờ và 300 s tổng mỗi lượt chỉ là **lưới an toàn** để lượt không trông như treo | Chạm lưới an toàn ⇒ trả `timeout`/`partial`, không bao giờ `failed` |
| D-13 | Đọc song song nhiều tool trong một bước? | **Giữ nguyên như hiện nay (tuần tự trong một bước).** Song song là do phiên chính điều phối **nhiều con** cùng lúc (ví dụ nhiều `explore` cùng chạy) | Tắt mặc định, để vòng sau; điểm song song của vòng 22 là fan-out theo cha |
| D-14 | Khi nào bật `enforce` cho cổng bằng chứng? | **Đủ 20 phiên có số S4** trong `~/BoxFox/logs/harness.jsonl` và **tỉ lệ báo sai < 10 %** thì DEV đổi mặc định sang `enforce` | Ghi vào D-8; cổng vẫn mặc định `warn` cho tới mốc đó |
| D-15 | Ngân sách phiên con? | **40 bước / 300 s** (thay cho 24/240 dự kiến). Kèm yêu cầu: chạm trần bước hoặc hạn chót thì con **phải tự xác định đang kẹt ở đâu**, sửa một lần nếu đường cũ sai, rồi trả `partial` kèm chẩn đoán | Cập nhật D-1 cho phiên con; thêm việc "chẩn đoán kẹt" vào phần ngân sách bước |

> Ghi chú cho D-15: "chẩn đoán kẹt" không phải một lượt model mới toanh — nó là **một** lượt gọi có trần, nằm trong
> hạn chót còn lại của chính lượt đó, và phải trả về bốn thứ: đã làm gì, kẹt ở đâu, còn lại gì, thử gì tiếp.

## 3. Việc chủ nhà giao thêm trong cùng vòng (chưa chốt phương án, đã chốt là phải làm)

| Mã | Việc | Chốt là phải làm | Số đo hiện tại | Trạng thái |
|---|---|---|---|---|
| D-6 | Nội dung tệp đính kèm phải đi tới box, và menu `+` phải bấm được | Có | Menu có trong DOM nhưng bị cắt (BUG-39); `user` event chỉ mang tên tệp; `.uploaded_artifacts` rỗng (BUG-40) | Đã chốt |
| D-7 | Agent con phải **nhìn thấy nhau**: test chờ review, kết quả review về cả `main` và `test`; plan chạy song song research rồi chờ research trả; các luồng check và long task tương tự | Có | Chưa có: con chạy tuần tự, không có `peer_read` / `await_children`, `session_search` khoá theo sid của chính nó | Đã chốt |
| D-8 | Câu trả lời cuối phải mang **bằng chứng sống** của việc đã làm (đặc biệt khi đổi mã hoặc đổi UI/UX) | Có | Không có cổng kiểm tra nào; nhãn `done` luôn xanh; store bỏ `session.journal` | Đã chốt |
| D-9 | Bảng Sub-agents phải tách theo **từng turn** | Có | Lượt `2+2` (3 s) vẫn hiện con của lượt trước (BUG-43) | Đã chốt |
| D-10 | Kiến trúc được phép nặng, **ưu tiên ổn định**, chấp nhận tốn thêm token/bước/thời gian | Có | — | Đã chốt |

## 4. Ràng buộc kỹ thuật phải giữ khi thi công

1. **Không thêm giá trị `status` mới** cho phiên: luồng đang lọc `running` / `awaiting_decision`
   (`runtime.py:1199`, `runtime_commands.py:29-31`) và giao diện ánh xạ giá trị lạ thành `failed`
   (`frontend/src/components/panels/SubagentInspectorPanel.tsx:170`). Mọi trạng thái "chưa xong" đi qua `partial` kèm bản ghi.
2. **Không viết đường upload mới**: dùng `POST /__box/file/upload` (`deploy/docker/ide-proxy.py:540-568`) và
   `frontend/src/lib/workspace/http.ts:70-87`.
3. **Số RULE-5 cấp ở phía box**, không cấp ở trình duyệt (`docs/naming.md:24` hiện chưa có mã nào cấp số).
4. **Di trú cơ sở dữ liệu phải cộng thêm** (`_add_missing_columns()`, `backend/src/agentbox/memory/session_store.py:67-86`).
5. `store.events()` chỉ trả tối đa 500 dòng (`session_store.py:136-139`) — mọi bảng mới phải tự lọc theo `turn`.

## 5. Lịch sử sửa đổi

| Ngày | Việc | Người chốt |
|---|---|---|
| 2026-09-22 | Lập sổ; chốt D-1…D-5 theo khuyến nghị, ghi nhận D-6…D-10 là việc phải làm | Nam Nam |
| 2026-09-22 | Chốt D-11…D-15 (năm câu hỏi khi soạn kế hoạch thi công): không cho con tự sinh, chờ tới khi nhận output, giữ tool tuần tự, mốc `enforce` theo số S4, con 40/300 kèm chẩn đoán kẹt | Nam Nam |
