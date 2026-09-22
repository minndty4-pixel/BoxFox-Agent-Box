# Sổ chốt việc của chủ nhà (owner decisions)

Tệp này ghi lại **các quyết định đã chốt**, kèm lý do đo được và việc nào bị ảnh hưởng, để các vòng sau tra cứu và
chỉnh sửa. Khi một quyết định thay đổi, **không xoá dòng cũ**: đổi `Trạng thái` thành `Đã thay thế` và ghi dòng mới
xuống phần *Lịch sử sửa đổi* ở cuối tệp.

Quy ước: `Trạng thái` nhận một trong `Đã chốt` (chủ nhà chốt, chưa thi công), `Đang thi công`, `Đã xong`,
`Đã thay thế`. Mọi số đo trong tệp này đến từ `docs/tracking/test-rounds.md` § *Vòng 21* / § *Vòng 22* và
`docs/tracking/bug-register.md` § 6.22 / § 6.23.

## 1. Năm quyết định chốt ngày 2026-09-22

Chủ nhà: Nam Nam (minndty3@gmail.com). Nguồn: năm câu hỏi cuối bảng trong
`docs/plan/v21-boxfox-plan.md` § Kế hoạch F; khuyến nghị đã gửi và **được chốt nguyên theo khuyến nghị**.

| Mã | Quyết định | Chốt | Lý do đo được | Việc bị ảnh hưởng | Trạng thái |
|---|---|---|---|---|---|
| D-1 | Ngân sách bước: `MAX_STEPS_DEFAULT` 16 → **40**, trần giữ 60; hết bước hoặc hết hạn thì trả **`partial`** thay vì `failed`; tách mã `STEP_BUDGET_EXHAUSTED` / `DEADLINE_EXCEEDED`. Con theo D-15: `CHILD_MAX_STEPS` 10 → **40**, `CHILD_DEADLINE_SECONDS` 120 → **300 s** (vẫn kẹp theo cha) | Có | Việc vừa phải chỉ tốn 8 bước (phiên `dddebffb887a4f6ca814c1514367d38d`), nhưng con chạm 10 bước / 120 s thì `answerChars = 0` (BUG-42) | `backend/src/agentbox/agent_core/limits.py`, `failures.py`, `runtime.py`, `scripts/eval/rushed_index.py` | Đã xong |
| D-2 | Cơ chế `--apply` cho kế hoạch: **sao lưu trước khi áp dụng**, giữ `--renumber-lone`, chỉ xoá kế hoạch thử khi **không** bản ghi `P:` nào trỏ tới | Có | Lượt dán nội dung Markdown gọi `write_plan` bị từ chối 4 lần rồi nhận ở lần thứ năm (`/tmp/runA.txt`) | `backend/src/agentbox/skills/runtime_commands.py`, `agent_core/plan_quality.py`, `deploy/docker/migrate_plans.py` | Đã xong |
| D-3 | Chống kế hoạch trùng: **từ chối một lần** khi độ trùng rơi vào dải mơ hồ jaccard 0,5–0,75 | Có | Cùng một kế hoạch bị từ chối 2 lần: `steps-unanchored` (4/11 bước có mốc) rồi `plan-no-steps` | `agent_core/plan_quality.py`, `agent_core/plan_registry.py`, `scripts/eval/rubric.py` | Đã xong |
| D-4 | Giới hạn độ dài câu trả lời cho đường phổ biến nhất: **60 000 ký tự cảnh báo**, **150 000 ký tự từ chối** | Có | Câu trả lời dài làm lượt dễ đứt ngân sách; ngưỡng lấy theo mức đã quan sát trong vòng 21 | `backend/src/agentbox/agent_core/runtime.py`, `failures.py`, `limits.py`, `frontend/src/components/chat/HarnessStepView.tsx` | Đã xong |
| D-5 | Giữ **`.session-history`** trong box, chưa dọn | Có | Đo được 9 thư mục phiên, 15 tệp, **128 KB** trong box `agentbox-box` — còn rẻ hơn chi phí dựng lại lịch sử | `deploy/docker/box-entrypoint.sh`, `session_files.py`, `deploy/docker/tests/test_session_files.py` | Đã xong |

**Cập nhật thi công vòng 22 (2026-09-22, đợt 1 — foundation).** Năm quyết định trên **đã xong**, đo lại bằng ba bộ test và
lượt thử sống qua `localhost:3100`:

- **D-1** — `GET /api/agent/runtime-info` trả `maxStepsDefault: 40`, `maxStepsMax: 60`, `childMaxSteps: 40`,
  `childDeadlineSeconds: 300`; `maxSteps: 999` bị kẹp về 60 kèm **đúng một** notice `STEPS_CLAMPED` và cờ `stepsClamped`;
  lượt `maxSteps: 4` (phiên `1cbb482079de430091e2de76f18144ae`) kết thúc `partial` với chẩn đoán bốn phần 465 ký tự, hàng
  `sessions` vẫn `completed` — không thêm giá trị `status` mới.
- **D-2** — `migrate_plans.py --apply` sao lưu trước khi áp dụng (nhánh `--backup-dir`), `--delete-orphan` **từ chối** khi còn
  bản ghi `P:` trỏ tới tệp (mã thoát 2).
- **D-3** — từ chối **một lần** rồi để lại vé dùng-một-lần cho đúng cặp (slug, thư mục); gửi lại nguyên văn được nhận là kế
  hoạch mới và vé không lọt sang slug hay phiên khác.
- **D-4** — trần 60 000 / 150 000 ký tự có notice `ANSWER_LENGTH_WARN` / `ANSWER_TOO_LONG` đi qua đúng bộ render notice sẵn có.
- **D-5** — `.session-history` vẫn được giữ; bài kiểm ghim tên thư mục và tên nhật ký, cấm đổi tên.

Số đo đầy đủ: `docs/tracking/test-rounds.md` § *Vòng 22* và `docs/tracking/bug-register.md` § 6.23.

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

**Cập nhật thi công vòng 22 (2026-09-22, đợt 2 — mesh agent con).** D-11, D-12, D-13 và D-15 **đã áp xong** (D-15 xong từ
đợt 1 cùng D-1): không có `spawn_peer` — cây con **phẳng một tầng**, `max_depth = 1`; `await_children` chờ **tới lúc bạn
giao** và tỉnh dậy bằng chính biên nhận giao hàng, ba con số 300 s chỉ là **lưới an toàn** — chạm lưới thì `peer_wait_end`
mang `status='timeout'` và lượt **không** bị đánh `failed` (đo sống: lượt `bb142655d9634b7f86270717b985e3fb` chờ đúng
**300 001 ms** rồi vẫn `completed`); tool trong một bước vẫn **tuần tự**, song song là fan-out **theo cha**
(`BOXFOX_PEER_FANOUT`, mặc định 3 con mỗi cha, trần toàn cục 8); trần `timeoutSeconds` của `await_children` bị kẹp ở 300 s
kèm notice `PEER_WAIT_CLAMPED`. D-13 kèm theo: T14 (`parallelReadTools`) **không** làm trong vòng 22 — cờ này được khai thì
trả notice `PEER_MESH_NOTICE` nói thẳng nó chưa có hiệu lực. D-14 (mốc bật `enforce`) vẫn `Đã chốt`: thuộc đợt bằng chứng sống.

## 3. Việc chủ nhà giao thêm trong cùng vòng (chưa chốt phương án, đã chốt là phải làm)

| Mã | Việc | Chốt là phải làm | Số đo hiện tại | Trạng thái |
|---|---|---|---|---|
| D-6 | Nội dung tệp đính kèm phải đi tới box, và menu `+` phải bấm được | Có | Trước: menu có trong DOM nhưng bị cắt (BUG-39); `user` event chỉ mang tên tệp; `.uploaded_artifacts` rỗng (BUG-40). Sau (vòng 22): hit-test `true` ở **cả bốn** mục menu; `.uploaded_artifacts` **5 → 7 tệp** khớp byte; event `user` và ngữ cảnh gửi model đều mang `absolutePath` thật | Đã xong |
| D-7 | Agent con phải **nhìn thấy nhau**: test chờ review, kết quả review về cả `main` và `test`; plan chạy song song research rồi chờ research trả; các luồng check và long task tương tự | Có | Sau (vòng 22 đợt 2): con có `peer_read` + `await_children` (chờ **tới lúc bạn giao**, lưới an toàn 300 s) + nhận giao hàng `deliverTo` với biên nhận idempotent; chuỗi sống `main → testing → review` xanh — 2 con cùng lượt, 2 biên nhận `injected`, cha chờ 10 869 ms rồi `done` (trước: con chạy tuần tự, không có công cụ peer, chỉ cha làm trung gian) | Đã xong |
| D-8 | Câu trả lời cuối phải mang **bằng chứng sống** của việc đã làm (đặc biệt khi đổi mã hoặc đổi UI/UX) | Có | Không có cổng kiểm tra nào; nhãn `done` luôn xanh; store bỏ `session.journal` | Đã chốt |
| D-9 | Bảng Sub-agents phải tách theo **từng turn** | Có | Sau (vòng 22 đợt 2): bảng đọc sổ con theo `parent_turn` — chip `Lượt 1 · 2`, nút `tất cả lượt`, khối theo lượt riêng (BUG-43 đã sửa); trước: lượt `2+2` (3 s) vẫn hiện con của lượt trước | Đã xong |
| D-10 | Kiến trúc được phép nặng, **ưu tiên ổn định**, chấp nhận tốn thêm token/bước/thời gian | Có | — | Đã chốt |

**Cập nhật thi công vòng 22 (2026-09-22).** **D-6 đã xong** — tệp vào box **đúng byte**, đường dẫn tuyệt đối do harness suy ra
(chứ không lấy từ trình duyệt) nằm trong cả event `user` lẫn ngữ cảnh gửi model, mục Google Drive nói thật "chưa kết nối".
**D-7** (con nhìn thấy nhau), **D-8** (bằng chứng sống trong câu trả lời cuối) và **D-9** (bảng Sub-agents theo từng turn) vẫn
`Đã chốt`: chúng thuộc đợt peer-mesh và đợt bằng chứng sống của vòng 22, chưa thi công. **D-10** đã được áp ngay trong đợt 1
(ưu tiên ổn định, chấp nhận tốn thêm bước/token) nên không đổi trạng thái.

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
| 2026-09-22 | Đợt 1 vòng 22 thi công xong: D-1…D-5 và D-6 chuyển `Đã xong` kèm số đo thi công; D-1 bổ sung số con **40 bước / 300 s** theo D-15; D-7…D-10 giữ `Đã chốt` (thuộc đợt sau) | Nam Nam |
| 2026-09-22 | Đợt 2 vòng 22 (mesh agent con) thi công xong: D-7 và D-9 chuyển `Đã xong` kèm số đo sống; D-11, D-12, D-13 và D-15 ghi nhận **đã áp xong**; D-14 giữ `Đã chốt` (đợt bằng chứng sống); T14 (`parallelReadTools`) để lại vòng sau theo D-13 | Nam Nam |
