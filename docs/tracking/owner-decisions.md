# Sổ chốt việc của chủ nhà (owner decisions)

Tệp này ghi lại **các quyết định đã chốt**, kèm lý do đo được và việc nào bị ảnh hưởng, để các vòng sau tra cứu và
chỉnh sửa. Khi một quyết định thay đổi, **không xoá dòng cũ**: đổi `Trạng thái` thành `Đã thay thế` và ghi dòng mới
xuống phần *Lịch sử sửa đổi* ở cuối tệp.

Quy ước: `Trạng thái` nhận một trong `Đã chốt` (chủ nhà chốt, chưa thi công), `Đang thi công`, `Đã xong`,
`Đã thay thế`. Mọi số đo trong tệp này đến từ `docs/tracking/test-rounds.md` § *Vòng 21* / § *Vòng 22* / § *Vòng 23* và
`docs/tracking/bug-register.md` § 6.22 / § 6.23 / § 6.31.

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
đợt 1 cùng D-1): không có `spawn_peer` — cây con **phẳng một tầng** (bảo đảm theo cấu trúc: vai của con không mang `delegate_task`, mã không có tham số `max_depth`); `await_children` chờ **tới lúc bạn
giao** và tỉnh dậy bằng chính biên nhận giao hàng, ba con số 300 s chỉ là **lưới an toàn** — chạm lưới thì `peer_wait_end`
mang `status='timeout'` và lượt **không** bị đánh `failed` (đo sống: lượt `bb142655d9634b7f86270717b985e3fb` chờ đúng
**300 001 ms** rồi vẫn `completed`); tool trong một bước vẫn **tuần tự**, song song là fan-out **theo cha**
(`BOXFOX_PEER_FANOUT`, mặc định 3 con mỗi cha, trần toàn cục 8); trần `timeoutSeconds` của `await_children` bị kẹp ở 300 s
kèm notice `PEER_WAIT_CLAMPED`. D-13 kèm theo: T14 (`parallelReadTools`) **không** làm trong vòng 22 — cờ này được khai thì
trả notice `PEER_MESH_NOTICE` nói thẳng nó chưa có hiệu lực. D-14 (mốc bật `enforce`) vẫn `Đã chốt`: thuộc đợt bằng chứng sống.

**Cập nhật thi công vòng 22 (2026-09-22, đợt 3 — bằng chứng sống).** **D-8 đã xong.** Cổng bằng chứng chạy trong lượt: phân loại
lời gọi công cụ của lượt, **một** phép dò `find` khi lượt có ghi (loại trừ hai thư mục mà chính harness ghi), chấm theo R1–R5, rồi
ghim kết quả vào nhật ký và vào `turn.end`; mọi lỗi của cổng rơi về `not_measurable` — **không** đổi văn câu trả lời, **không** đổi
`status` phiên. Giao diện đọc khối `journal` của API (trước đây ném đi) và hiện nhãn ba trạng thái; lượt **thiếu** trường `evidence`
(phiên cũ) được coi là `unverified`, không bao giờ xanh.

**Nguyên văn quyết định đã chốt của D-14, ghi thẳng vào đây (2026-09-22):**

> Bật `enforce` khi **20 phiên** đã có số trong `~/BoxFox/logs/harness.jsonl` **và** tỉ lệ báo động sai của cổng (đo ở chế độ `warn`)
> **< 10 %**; **DEV (người bảo trì) đổi mặc định**, chủ nhà không phải làm gì.

Chi tiết đã chốt kèm theo (không phải đoán): đếm **phiên** chứ không đếm lượt; "có số" nghĩa là S4 của
`scripts/eval/rushed_index.py` trả `status='measured'` (dòng `turn.end` đã có `data.evidenceMissing`); tỉ lệ báo động sai =
(số lượt bị S4 gắn cờ mà soi lại thấy **có** bằng chứng thật) / (tổng số lượt bị gắn cờ), DEV đối chiếu hàng `E:` và `artifacts`;
chưa đủ điều kiện thì giữ `warn`, chạy tiếp, không đổi gì. Đổi `EVIDENCE_DEFAULT_MODE` trong `limits.py` sang `enforce` là bước duy
nhất (env vẫn đè được), và kiểm lại bằng `curl -s -H 'X-BoxFox-Admin: 1' http://127.0.0.1:3102/api/agent/runtime-info` ⇒
`gate.evidenceMode`. Đồng hồ đếm hiện tại: `python3 scripts/eval/rushed_index.py --json` in `sessions=` / `S4=` / `flagged=`.

## 3. Việc chủ nhà giao thêm trong cùng vòng (chưa chốt phương án, đã chốt là phải làm)

| Mã | Việc | Chốt là phải làm | Số đo hiện tại | Trạng thái |
|---|---|---|---|---|
| D-6 | Nội dung tệp đính kèm phải đi tới box, và menu `+` phải bấm được | Có | Trước: menu có trong DOM nhưng bị cắt (BUG-39); `user` event chỉ mang tên tệp; `.uploaded_artifacts` rỗng (BUG-40). Sau (vòng 22): hit-test `true` ở **cả bốn** mục menu; `.uploaded_artifacts` **5 → 7 tệp** khớp byte; event `user` và ngữ cảnh gửi model đều mang `absolutePath` thật | Đã xong |
| D-7 | Agent con phải **nhìn thấy nhau**: test chờ review, kết quả review về cả `main` và `test`; plan chạy song song research rồi chờ research trả; các luồng check và long task tương tự | Có | Sau (vòng 22 đợt 2): con có `peer_read` + `await_children` (chờ **tới lúc bạn giao**, lưới an toàn 300 s) + nhận giao hàng `deliverTo` với biên nhận idempotent; chuỗi sống `main → testing → review` xanh — 2 con cùng lượt, 2 biên nhận `injected`, cha chờ 10 869 ms rồi `done` (trước: con chạy tuần tự, không có công cụ peer, chỉ cha làm trung gian) | Đã xong |
| D-8 | Câu trả lời cuối phải mang **bằng chứng sống** của việc đã làm (đặc biệt khi đổi mã hoặc đổi UI/UX) | Có | Sau (vòng 22 đợt 3): cổng bằng chứng chấm **mỗi lượt** (R1–R5, thuần, không I/O), mỗi lần ghi tệp sinh diff + sha256 **tại chỗ ghi**, câu trả lời cuối mang nhãn ba trạng thái `verified`/`unverified`/`not_measurable`, một hàng `E:` vào nhật ký, số của cổng vào `turn.end` (S4 của eval rời `not_measured`); mặc định `warn` — nâng `enforce` theo **đúng** mốc D-14. Trước: không có cổng nào, nhãn `done` luôn xanh, store bỏ `session.journal` | Đã xong |
| D-9 | Bảng Sub-agents phải tách theo **từng turn** | Có | Sau (vòng 22 đợt 2): bảng đọc sổ con theo `parent_turn` — chip `Lượt 1 · 2`, nút `tất cả lượt`, khối theo lượt riêng (BUG-43 đã sửa); trước: lượt `2+2` (3 s) vẫn hiện con của lượt trước | Đã xong |
| D-10 | Kiến trúc được phép nặng, **ưu tiên ổn định**, chấp nhận tốn thêm token/bước/thời gian | Có | — | Đã chốt |

**Cập nhật thi công vòng 22 (2026-09-22).** **D-6 đã xong** — tệp vào box **đúng byte**, đường dẫn tuyệt đối do harness suy ra
(chứ không lấy từ trình duyệt) nằm trong cả event `user` lẫn ngữ cảnh gửi model, mục Google Drive nói thật "chưa kết nối".
**D-7** (con nhìn thấy nhau), **D-8** (bằng chứng sống trong câu trả lời cuối) và **D-9** (bảng Sub-agents theo từng turn) vẫn
`Đã chốt`: chúng thuộc đợt peer-mesh và đợt bằng chứng sống của vòng 22, chưa thi công. **D-10** đã được áp ngay trong đợt 1
(ưu tiên ổn định, chấp nhận tốn thêm bước/token) nên không đổi trạng thái.

## 4. Vòng 23–24 — câu chốt về "bằng chứng sống" và dạng câu trả lời cuối (2026-09-23) — D-16…D-32

### 4.1 Vòng 23 — mười một câu chốt về "bằng chứng sống" (D-16…D-25)

Chủ nhà gửi **ảnh chụp giao diện** kèm câu chốt "không phải block. hẳn luôn. chỉ dùng file markdown thôi":
câu trả lời cuối của lượt trước bị nền tảng render thành **chip "the uploaded file"**, ảnh chụp chỉ nằm trong
khối gập nên không mở được ảnh nào; mặt chủ nhà muốn là **ảnh chụp render của dự án hiện ngay trong câu trả lời**.
Vì kế hoạch thi công bị lệch mặt hiển thị, chủ nhà yêu cầu lập **kế hoạch mới** cho phần này và trả lời 11 câu hỏi
(ba đợt, 03:5x–05:0x UTC). Toàn bộ câu trả lời **đã được áp vào kế hoạch**
(`/code/.plans/v1-evidence-report.md`, vòng 23).

| Mã | Quyết định | Chốt | Lý do đo được | Việc bị ảnh hưởng | Trạng thái |
|---|---|---|---|---|---|
| D-16 | Ảnh bằng chứng là **cửa sổ/tab render của chính dự án trong box**; **không** lấy ảnh desktop của box làm bằng chứng | Có | Ảnh `3120.png` chủ nhà gửi: bằng chứng phải là diff/màn hình **của dự án**, không phải màn hình nền của máy ảo | `tools/system_media.py` + `tool_contracts.py` (tham số `target`), `sandbox/executor.py`, `deploy/docker/capture.py` | Đang thi công |
| D-17 | Ảnh là bằng chứng **trạng thái đã hoàn thiện**, chụp ở **bước báo cáo**; **không** ảnh "trước/sau", không ảnh dở dang | Có | Hai hàng ảnh của lượt `9481bf87` (ảnh "trước" nhãn `nhan truoc khi doi`) không chứng minh được việc đã xong | `AGENT.md` §3.4, `runtime.py` (chỉ dẫn vai + kỹ năng mới), kỹ năng `final-report` | Đang thi công |
| D-18 | **Cổng không kiểm khuôn câu trả lời**; câu trả lời cuối để phiên chính tự quyết; việc chính là **prompt/kỹ năng** | Có | Cổng hiện chỉ chấm khẳng định/độ dài (`test-rounds.md`, §6.25 mục BUG-69) | `evidence_gate.py` (chỉ chỉnh kỹ thuật), kỹ năng `final-report`, `AGENT.md` | Đang thi công |
| D-19 | Mặt câu trả lời cuối **chỉ markdown**: bỏ hẳn hàng "tệp đã thay đổi", hàng "lệnh đã chạy", khối gập "Bằng chứng" | Có | Ảnh `3119.png` (11 dòng "the uploaded file"), `3121.png`, `3123.png` (khối đóng trong chat) | `frontend/src/components/chat/HarnessStepView.tsx`, `MarkdownRenderer.tsx` | Đang thi công |
| D-20 | **Bỏ luôn dòng trạng thái cổng** (đã kiểm chứng / chưa kiểm chứng) khỏi mặt câu trả lời; hậu kiểm để dành cho **"agent verify"** ở vòng sau ("test, review, verify và main") | Có | Chủ nhà: "trạng thái cổng bỏ, chúng ta về sau sẽ có plan để agent đi kiểm chứng chứ k kiểm chứng bừa" | `HarnessStepView.tsx` (huy hiệu `:2589-2638`), `runtime.py` payload `assistant.data.evidence` giữ nguyên | Đang thi công |
| D-21 | Ảnh do **model tự viết vào câu trả lời bằng markdown**; app không liệt kê ảnh hộ, không dựng khối/dải/nút nào quanh câu trả lời | Có | Ảnh `3122.png` là mặt đúng: lưới ảnh mở nằm ngay trong câu trả lời | `MarkdownRenderer.tsx` (tile ảnh + lightbox + link tệp) | Đang thi công |
| D-22 | **Một việc có thể nhiều ảnh**; mỗi ảnh mang **nhãn ngắn của model nói ảnh chứng minh chức năng nào**; tên tệp đặt đọc được | Có | Chủ nhà: "ví dụ 1 việc chủ giao k phải là 1 bức, có thể chụp nhiều bức dựa theo sự thay đổi" | `capture.py` (`label` vào tên tệp), kỹ năng `final-report`, `MarkdownRenderer.tiles` | Đang thi công |
| D-23 | Bằng chứng **tuỳ use case**: quan sát được trên giao diện ⇒ ảnh render; backend/RAG/CLI ⇒ **chạy test thật rồi chụp kết quả**, lưu tệp kết quả và dẫn link | Có | Chủ nhà: "backend thay đổi, ảnh hưởng đến hệ thống RAG thì agent phải tự biết, quay, cap màn khi test thực tế" | kỹ năng `final-report`, `runtime.evidence_pointers`, kho `.generated_artifacts/captures/evidence/<sid8>/` | Đang thi công |
| D-24 | Nhãn phần bằng chứng đi theo **ngôn ngữ của câu trả lời model** (không theo thiết lập giao diện) | Có | Câu trả lời tiếng Việt nhưng `en.ts` đang in nhãn tiếng Việt cho cả hai từ điển | `frontend/src/i18n/en.ts` (33 khoá), `answerLang.ts` (mới) | Đang thi công |
| D-25 | **Giữ nguyên kho lưu hiện có**: ảnh ở `.generated_artifacts/captures/<kind>/<sid8>/…`, tệp văn bằng chứng ở `.generated_artifacts/captures/evidence/<sid8>/…` | Có | Đường dẫn kho đã chạy ổn định từ vòng 22 đợt 3; đổi kho chỉ thêm rủi ro | không đổi mã lưu trữ; chỉ thêm hậu tố nhãn vào tên tệp ảnh | Đang thi công |

**Điều chuyển sang vòng sau (ghi để không trôi):** (a) mặt **"tệp đã thay đổi"** (diff/hunk) trên giao diện —
chủ nhà: "các phần tệp thay đổi sẽ được plan trong tương lai"; (b) **"agent verify"** — vai đi hậu kiểm thật
(test/review/verify/main) rồi báo cáo md + ảnh, thay chỗ cho huy hiệu cổng vừa bỏ (D-20).

---

### 4.2 Vòng 24 — bảy câu chốt về dạng câu trả lời cuối (2026-09-23) — D-26…D-32

Sau khi vòng 23 lên mã, chủ nhà bác **khuôn năm phần** của câu trả lời cuối và nêu bốn điểm (nguyên văn):

1. *"tùy từng trường hợp. ví dụ như nếu user giao việc thì mới nói đã làm gì hay còn gì"* — khuôn không được áp cứng
   cho mọi lượt.
2. *"Nếu không còn gì, tại sao lại nói? (thừa)"* — không in mục rỗng.
3. *"đây trả lời đang theo 1 form, chứ k linh động, harness phải trả lời được như thường, với các task kỹ thuật thì
   mới báo cáo. nó vẫn trả lời bình thường và báo cáo chứ k phải mỗi báo cáo, và báo cáo những gì đã làm"* — trả lời
   bình thường **cộng** báo cáo khi là việc kỹ thuật, không phải chỉ báo cáo.
4. *"Hiện tại form đã làm hỏng cả phần tóm tắt… ở phiên bản cũ, model sinh ra theo dạng tóm tắt, nếu user ấn show
   detail sẽ hiện cụ thể thay đổi, nhưng nếu theo form này đã làm hỏng toàn bộ"* — phải khôi phục **tóm tắt do model
   viết** + `View details` mới ra chi tiết.

Chủ nhà chỉ mặt **ĐÚNG** mẫu: lượt `9481bf87` ("Gói bằng chứng sống dạng ảnh chụp + ghi hình…", "Worked for 6m 31s").

Tinh chỉnh sau đó (nguyên văn): *"giúp tôi bổ sung, form kia là custom nghĩ là agent sẽ trả lời như bình thường. nhưng
form vào 1 chút, và nó có thể tự chọn ra ví dụ như đã làm gì. trả lời như bình thường. chỉ quan trọng nhất là phần
ảnh dãn chứng ở dưới"* ⇒ form giữ lại nhưng thành **menu nhẹ**, model tự chọn phần; **ảnh bằng chứng ở CUỐI là quan
trọng nhất**.

Ba câu hỏi khi soạn kế hoạch thi công (bản kế hoạch v3 đã được duyệt): câu 1 chủ nhà **bỏ trống** ("no preference,
use your best judgment") ⇒ áp phương án khuyến nghị — dạng câu trả lời nằm **trong kỹ năng**, prompt chỉ còn **một
con trỏ** ở bước tổng kết của lượt có việc; câu 2 chọn **giữ một dòng cứng ngắn trong prompt**; câu 3 chọn **giữ
`final-report` trong danh sách kỹ năng bật mặc định**.

| Mã | Quyết định | Chốt | Lý do đo được | Việc bị ảnh hưởng | Trạng thái |
|---|---|---|---|---|---|
| D-26 | Form năm phần thành **menu nhẹ**, không còn là khuôn cứng: model tự chọn phần hợp lượt | Có | Bốn điểm chủ nhà nêu (1)(3) + tinh chỉnh "form vào 1 chút… nó có thể tự chọn" | `runtime.py` (xoá `FINAL_REPORT_PARTS`/`FINAL_REPORT_GUIDANCE`/khối `=== FINAL REPORT ===`), kỹ năng `final-report` 2.0.0, `AGENT.md` §3.4 | Đã xong (`37926e0`) |
| D-27 | **Không in phần rỗng**: hết việc thì không có mục "còn lại", không có mục "cần chốt" | Có | Điểm (2): "Nếu không còn gì, tại sao lại nói? (thừa)" | kỹ năng `final-report` (mục *The menu, not a template*, luật `never print an empty part`) | Đã xong (`37926e0`) |
| D-28 | Vẫn **trả lời như thường**; lượt chỉ hỏi thì trả lời, **không** báo cáo; có việc kỹ thuật thì trả lời **kèm** báo cáo | Có | Điểm (3): "nó vẫn trả lời bình thường và báo cáo chứ k phải mỗi báo cáo" | kỹ năng `final-report` (*When to open it*), `RECAP_CLOSER` (chỉ lượt có việc mới thấy con trỏ; lượt chỉ đọc recap rỗng) | Đã xong (`37926e0`) |
| D-29 | Giữ **tóm tắt do model viết** ở mặt gấp + `View details` mới mở chi tiết; lượt `9481bf87` là mẫu | Có | Điểm (4): form cũ mở đầu bằng tiêu đề/danh sách nên `splitAuthoredSummary()` (`HarnessStepView.tsx:248`) trả `null` ⇒ mặt gấp thành lát cắt 6 dòng/600 ký tự (`:1078`) | kỹ năng (luật mở bài **một đoạn văn xuôi**), `HarnessStepView.test.tsx` (+2 ca DOM; **mã sản phẩm giao diện không đổi**) | Đã xong (`37926e0`) |
| D-30 | **Ảnh bằng chứng ở CUỐI câu trả lời là phần ưu tiên nhất** | Có | Tinh chỉnh: "chỉ quan trọng nhất là phần ảnh dãn chứng ở dưới" | kỹ năng (*The evidence part closes the answer*), ca kiểm DOM khẳng định ảnh là **khối cuối** khi mở chi tiết | Đã xong (`37926e0`) |
| D-31 | **Kỹ năng `final-report` là nơi chứa cả dạng câu trả lời**; prompt chỉ còn **một con trỏ**, ở bước tổng kết của **lượt có việc**; kỹ năng **ở lại** `DEFAULT_SKILLS` | Có | Câu hỏi 1 bỏ trống ⇒ phương án khuyến nghị; câu hỏi 3 chọn giữ ở danh sách mặc định. **Đánh đổi đã nhận**: model không mở kỹ năng thì lượt vẫn có ảnh bằng chứng (nhờ D-32) nhưng thiếu menu | `runtime.py` (`RECAP_CLOSER` đọc `skill_view`), kỹ năng, `skills/catalog.py` (chú thích), `AGENT.md` §3.4, `backend/tests/unit/test_runtime_prompt.py` | Đã xong (`37926e0`) |
| D-32 | **Một dòng bằng chứng cứng ở lại prompt** (chỉ phiên chính), câu điều kiện, ngắn | Có | Câu hỏi 2 chọn "giữ một dòng cứng ngắn"; D-18 giữ: con không nhận dòng này | `runtime.py:761` `ANSWER_EVIDENCE_LINE`, chèn ngay sau `=== ANSWER LENGTH ===` | Đã xong (`37926e0`) |

**Hậu kiểm sau khi bảy hàng trên lên mã.** Một vòng **soát mã** (risk **3/10**, "ship with mitigations": nguồn sự thật duy nhất đúng, con
trỏ tới được thật, hai chỗ ghim còn mềm) và một vòng **soát dọn** (luật "ảnh khép câu trả lời" bị chép bốn lần — bản trong `RECAP_CLOSER`
là bản duy nhất không có ghim nên đã bỏ vế đó; bỏ một gạch trùng luật trong kỹ năng; gọn tệp kiểm) ở commit `68125ea`, kèm **ghim chống
trôi cho D-26** (kỹ năng không được chứa câu bắt dùng đủ năm phần, phải giữ `pick by content, not habit`). Số đo sống của vòng ở
`test-rounds.md` § *Vòng 24*; lượt provider thật **có** gọi `skill_view {"id": "final-report"}` nên đánh đổi của D-31 không xảy ra ở lượt đo.

**Điều còn treo (ghi để không trôi):** (a) footer lightbox "mở trong Files" chưa nối (`MediaLightboxModal.tsx:35`
`artifactPath?` có, `ChatPanel.tsx:707-715` chưa truyền); (b) dòng meta của tile (`PNG · kích thước · bytes`) chưa dựng;
(c) `frontend/vite.config.ts` vẫn bind `127.0.0.1`, preview phải đi qua `frontend/.tmp/vite.preview.config.mjs`;
(d) "agent verify" (vai đi hậu kiểm thật) vẫn là việc của vòng sau, như đã ghi ở §4.1.

## 5. Ràng buộc kỹ thuật phải giữ khi thi công

1. **Không thêm giá trị `status` mới** cho phiên: luồng đang lọc `running` / `awaiting_decision`
   (`runtime.py:1199`, `runtime_commands.py:29-31`) và giao diện ánh xạ giá trị lạ thành `failed`
   (`frontend/src/components/panels/SubagentInspectorPanel.tsx:170`). Mọi trạng thái "chưa xong" đi qua `partial` kèm bản ghi.
2. **Không viết đường upload mới**: dùng `POST /__box/file/upload` (`deploy/docker/ide-proxy.py:540-568`) và
   `frontend/src/lib/workspace/http.ts:70-87`.
3. **Số RULE-5 cấp ở phía box**, không cấp ở trình duyệt (`docs/naming.md:24` hiện chưa có mã nào cấp số).
4. **Di trú cơ sở dữ liệu phải cộng thêm** (`_add_missing_columns()`, `backend/src/agentbox/memory/session_store.py:67-86`).
5. `store.events()` chỉ trả tối đa 500 dòng (`session_store.py:136-139`) — mọi bảng mới phải tự lọc theo `turn`.

## 6. Lịch sử sửa đổi

| Ngày | Việc | Người chốt |
|---|---|---|
| 2026-09-22 | Lập sổ; chốt D-1…D-5 theo khuyến nghị, ghi nhận D-6…D-10 là việc phải làm | Nam Nam |
| 2026-09-22 | Chốt D-11…D-15 (năm câu hỏi khi soạn kế hoạch thi công): không cho con tự sinh, chờ tới khi nhận output, giữ tool tuần tự, mốc `enforce` theo số S4, con 40/300 kèm chẩn đoán kẹt | Nam Nam |
| 2026-09-22 | Đợt 1 vòng 22 thi công xong: D-1…D-5 và D-6 chuyển `Đã xong` kèm số đo thi công; D-1 bổ sung số con **40 bước / 300 s** theo D-15; D-7…D-10 giữ `Đã chốt` (thuộc đợt sau) | Nam Nam |
| 2026-09-22 | Đợt 2 vòng 22 (mesh agent con) thi công xong: D-7 và D-9 chuyển `Đã xong` kèm số đo sống; D-11, D-12, D-13 và D-15 ghi nhận **đã áp xong**; D-14 giữ `Đã chốt` (đợt bằng chứng sống); T14 (`parallelReadTools`) để lại vòng sau theo D-13 | Nam Nam |
| 2026-09-22 | Đợt 3 vòng 22 (bằng chứng sống) thi công xong: D-8 chuyển `Đã xong` kèm số đo sống; D-14 ghi **nguyên văn** vào D-8 kèm ngày chốt và đồng hồ đếm (`sessions=` / `S4=` / `flagged=`); cổng vẫn mặc định `warn` cho tới mốc 20 phiên | Nam Nam |
| 2026-09-23 | Vòng 23: chủ nhà gửi ảnh chụp và yêu cầu kế hoạch mới cho phần bằng chứng sống; chốt D-16…D-25 (11 câu qua ba đợt hỏi) — mặt câu trả lời cuối chỉ còn markdown, cổng rời giao diện, nhãn theo ngôn ngữ câu trả lời, kho lưu giữ nguyên | Nam Nam |
| 2026-09-23 | Vòng 24: chủ nhà bác khuôn năm phần (bốn điểm nguyên văn) rồi tinh chỉnh "form vào 1 chút, ảnh bằng chứng ở dưới là quan trọng nhất"; chốt D-26…D-32 (ba lựa chọn phỏng vấn) — dạng câu trả lời dời vào kỹ năng `final-report`, prompt còn **một dòng bằng chứng cứng** cho phiên chính + **một con trỏ** ở bước tổng kết của lượt có việc; thi công xong ở `37926e0` | Nam Nam |
