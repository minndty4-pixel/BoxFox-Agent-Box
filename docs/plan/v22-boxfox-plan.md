# Kế hoạch vòng 22 — thi công ba đợt: **nền tảng → mesh agent con → bằng chứng sống**

Bản để chủ nhà duyệt. Ba bản chi tiết nằm cạnh tệp này: `docs/plan/v22/foundation.md` (33 việc),
`docs/plan/v22/peer-mesh.md` (17 việc + 1 việc tuỳ chọn), `docs/plan/v22/evidence-proof.md` (25 việc).
Bản trong kho: `docs/plan/v22-boxfox-plan.md` + `docs/plan/v22/…` (ba bản chi tiết), mockup ở `docs/design/v22/`.

Nguồn: năm việc chủ nhà giao ở vòng 21, năm quyết định **D-1…D-5** và năm câu trả lời **D-11…D-15** trong
`docs/tracking/owner-decisions.md`; số đo sống ở `docs/tracking/test-rounds.md` § *Vòng 21*; lỗi ở
`docs/tracking/bug-register.md` § 6.22 (BUG-39…BUG-43).

---

## 0. Chủ nhà đang duyệt cái gì

Ba đợt thi công độc lập nhưng **có thứ tự bắt buộc**, tổng **75 việc** (cộng 1 việc tuỳ chọn để vòng sau), nhằm biến
năm kết luận đo được ở vòng 21 thành sản phẩm chạy được:

1. **Nền tảng (33 việc)** — tệp đính kèm đi tới box, ngân sách bước 16 → 40 và **không mất trắng** khi chạm trần,
   ba quyết định về kế hoạch/lịch sử, trần độ dài câu trả lời.
2. **Mesh agent con (17 việc)** — con **nhìn thấy nhau**: `peer_read`, `await_children` (chờ **tới lúc bạn giao**),
   `deliverTo` với biên nhận idempotent, fan-out theo cha, watchdog; phiên chính điều phối nhiều con cùng lúc.
3. **Bằng chứng sống (25 việc)** — câu trả lời cuối mang bằng chứng của việc **đã chạy thật**: cổng `evidence_gate.py`
   ba mức, nhãn ba trạng thái, danh sách bằng chứng mở được trong UI.

**Điều kiện thành công của cả vòng**: mọi việc ở §7 phải xanh, và các đợt sau không được làm đổi hành vi hôm nay khi
tắt công tắc (`BOXFOX_PEER_MESH=off`, `BOXFOX_EVIDENCE_GATE=off`).

---

## 0.1 Năm câu chủ nhà vừa chốt (D-11…D-15) — hệ quả trực tiếp

| Mã | Chốt | Hệ quả trong kế hoạch |
|---|---|---|
| **D-11** | Con **không** tự sinh anh em; **phiên chính là bên duy nhất sinh và điều phối**; con chỉ đọc/đợi/nhận kết quả của nhau | Bỏ `spawn_peer` khỏi phạm vi (không thêm công tắc); giữ `peer_read`, `await_children`, nhận giao hàng. Bất biến #6 ở §1; peer §3 mục (10) |
| **D-12** | Chờ **đến khi con kia nhả output**; trần 300 s/lần và 300 s/tổng-lượt chỉ là **lưới an toàn** | `await_children` đánh thức bằng sự kiện giao hàng (không đợi hết trần); chạm lưới ⇒ `timeout`/`partial`, **không bao giờ** `failed`. peer T9, §3 mục (4) |
| **D-13** | **Giữ nguyên** cách một agent gọi nhiều tool trong một bước (tuần tự); song song đến từ **nhiều con do main sinh** | T14 chuyển thành việc **tuỳ chọn của vòng sau**, `BOXFOX_PARALLEL_READ_TOOLS` mặc định `off`; vòng lặp tool `runtime.py:1728-1769` **không bị sửa**; fan-out theo cha (3, trần 6) là đầu tàu |
| **D-14** | Bật `enforce` khi **≥ 20 phiên** có số S4 và tỉ lệ báo động sai **< 10 %**; **DEV** đổi mặc định | Cổng vẫn mặc định `warn`; mốc + ai bật + lệnh đo ghim ở evidence §6; ghi vào D-8 ở P6.3 |
| **D-15** | Con **40 bước / 300 s**, và chạm trần/hạn chót thì **phải tự xác định đang kẹt ở đâu** rồi trả `partial` kèm chẩn đoán | `limits.py` ⇒ `CHILD_MAX_STEPS = 40`, `CHILD_DEADLINE_SECONDS = 300` (vẫn `min()` theo cha); thêm việc **B10** + vùng chẩn đoán (`WRAP_UP_STEPS_RESERVED = 3`, một lời gọi chốt có trần) |

---

## 1. Bảy nguyên tắc bất biến (áp cho cả ba đợt)

1. **Không thêm giá trị `status` mới** cho phiên. Phiên lọc `running`/`awaiting_decision`
   (`runtime.py:1199`, `runtime_commands.py:29-31`); giao diện ánh xạ giá trị lạ thành `failed`
   (`SubagentInspectorPanel.tsx:170`). "Đang chờ" là **event riêng** (`peer_wait`) + cột `waiting_for`.
2. **Chạm trần thì trả `partial` kèm chẩn đoán bốn phần** (đã làm gì / tắc ở đâu / còn lại gì / thử gì tiếp),
   không bao giờ kết thúc trắng. Vùng chẩn đoán có trần cứng trong hạn chót còn lại của chính lượt đó.
3. **Không viết đường upload mới**: dùng `POST /__box/file/upload` (`ide-proxy.py:540-568`) + `lib/workspace/http.ts:70-87`;
   **số RULE-5 cấp ở phía box** (`max+1` + `O_CREAT|O_EXCL`), không cấp ở trình duyệt.
4. **Di trú cơ sở dữ liệu phải cộng thêm** (`_add_missing_columns()`, `session_store.py:67-86`); bảng mới phải tự lọc
   theo `turn` vì `store.events()` chỉ trả 500 dòng (`session_store.py:136-139`).
5. **Bằng chứng đi kèm, không viết lại văn của model** (khoá `evidence` trên event `assistant` + hàng `E:` theo
   `turn`/`step`); ca duy nhất được cắt văn là câu trả lời vượt 150 000 ký tự (D-4), và cổng mặc định là `warn`.
6. **Song song chỉ đến từ nhiều con do phiên chính sinh.** Con chỉ **đọc, chờ, nhận**; con không tự sinh phiên,
   không hỏi người dùng (giữ `PermissionError` cho `delegate_task` từ con như hôm nay).
7. **Mọi thứ chờ/kẹt đều có trần và có số** (`stepsUsed`, `deadlineUsedMs`, `waitedMs`, `childCount`), mọi tính năng
   nặng đều có **công tắc giết** và mặc định an toàn.

---

## 2. Thứ tự thi công (bắt buộc) và lý do

```
Đợt 1  NỀN TẢNG            (33 việc)  ──┐
      ├ Pha 1: A1…A11 (tệp đính kèm)    │  đợt nền: cấp ngữ nghĩa `partial`,
      ├ Pha 2: B1…B10 (ngân sách)       │  bộ đếm bước và prompt mà hai đợt
      ├ Pha 3: C1…C5 (kế hoạch/lịch sử) │  kia giả định đã có
      ├ Pha 4: D1…D2 (độ dài câu trả lời)│
      └ Pha 5: E1…E5 (test, sống, ghi sổ)┘
                     ↓
KHỐI DÙNG CHUNG: danh tính LƯỢT  (peer T2+T3 ⨯ evidence P1.1…P1.3)
      một bộ đếm `turn` duy nhất, `turn`/`step` trên mọi event, `journal.turn/step`
                     ↓
Đợt 2  MESH CON (17 việc)   →   Đợt 3  BẰNG CHỨNG SỐNG (25 việc)
```

**Vì sao thứ tự này**: hai đợt sau đều đọc `turn`/`step` và ngữ nghĩa `partial` của lượt; nếu làm ngược, mỗi đợt sẽ
tự dựng một bộ đếm lượt khác nhau rồi phải hợp nhất. Đợt 1 cũng là đợt duy nhất sửa `limits.py` ở phần B, nên phải
xong trước khi mesh thêm trần của nó (T13).

---

## 3. Đợt 1 — Nền tảng (33 việc, 5 giai đoạn)

Chi tiết: `docs/plan/v22/foundation.md` (nghiệm thu từng phần ở A.2, B.2, C.2, D.2, E.2).

| Phần | Việc | Thay đổi cốt lõi | Số đo chứng minh |
|---|---|---|---|
| **A** Tệp đính kèm | A1–A11 | Popover render **qua portal** (hết bị `overflow-hidden` cắt ở `ChatInputBar.tsx:268`); giữ đối tượng `File`; **box cấp số RULE-5**; đường dẫn tuyệt đối vào prompt **và** event `user`; tối đa 2 ảnh inline (tổng ≤ 800 000 ký tự, vì request bị chặn 1 MiB); trần 25 MiB/tệp; retention 200 tệp/500 MiB; `file_read` đọc được tệp nhị phân; Drive **không bịa tên tệp** | BUG-39, BUG-40 |
| **B** Ngân sách bước | B1–B10 | Cha **40** bước (trần 60) / 180 s (trần 600 s); con **40/300** kẹp theo cha; tách `STEP_BUDGET_EXHAUSTED` / `DEADLINE_EXCEEDED`; **`partial` + chẩn đoán 4 phần** thay cho `failed` trắng; `TURN_EMPTY_RESPONSE` thử lại **một lần**; `STEPS_CLAMPED` không cắt im lặng; `turn_end` mang `stepsUsed`/`deadlineUsedMs` | BUG-41, BUG-42 |
| **C** Kế hoạch & lịch sử | C1–C5 | `migrate_plans.py --apply` **sao lưu trước** (`/home/agent/workspace/.plans-backups/<UTC>/` + `manifest.json` sha256) và **vào image**; `--delete-orphan` **từ chối** khi có hàng `P:`; giữ `--renumber-lone`; dải jaccard 0,5–0,75 **từ chối một lần**; test chống đổi tên `.session-history` | D-2, D-3, D-5 |
| **D** Độ dài câu trả lời | D1–D2 | **60 000 cảnh báo / 150 000 từ chối** (cắt + notice bền + `partial`); ngưỡng **plan** giữ nguyên 40 000/150 000; thêm một dòng prompt "dài thì ghi ra tệp" | D-4 |
| **E** Test & ghi sổ | E1–E5 | Ba bộ test + `tsc -b --noEmit`; một ca tích hợp HTTP của harness; **một lượt thử sống** qua `localhost:3100` (hit-test menu + upload thật + so **byte** trong box); bốn tệp docs; gắn mockup vào Design-tab | — |

---

## 4. Đợt 2 — Mesh agent con (17 việc, 6 pha)

Chi tiết: `docs/plan/v22/peer-mesh.md` (nghiệm thu chung ở §3).

**Kiến trúc**: một **sổ con** ở giữa (`children` + `child_deliveries` + `sessions.turn_count`) và **bốn primitive**:

| Tầng | Nội dung | Việc |
|---|---|---|
| **Sổ** | `children` (parent_id, parent_turn, spawn_step, role, goal, status, waiting_for, deliveries) + `child_deliveries` (khoá duy nhất `UNIQUE(child_id, recipient, recipient_turn)`) | T1–T3 |
| **Nhìn** | `peer_read(sessionId, afterSeq, limit)` — chỉ anh em **cùng một cha**, cửa sổ có trần, bỏ ảnh/base64 | T8 |
| **Chờ** | `await_children(targets, mode=all/any, timeoutSeconds)` — **đánh thức ngay khi bạn giao hàng**; trần 300 s/lần, 300 s/tổng-lượt là lưới an toàn; phát `peer_wait`/`peer_wait_end` | T9 |
| **Giao** | `deliverTo = ['main'] | ['peer:<sid>'] | ['role:<role>']` — biên nhận idempotent, bơm kết quả **đã cắt trần** vào ngữ cảnh người nhận ở **ranh giới bước** | T11, T12 |
| **Nở** | fan-out **theo cha** (mặc định 3, trần 6) + trần toàn cục 8, thay `Semaphore(3)`; `delegate_task(wait=false)` sinh con **không chặn** | T5, T6 |
| **An toàn** | kết thúc lượt cha ⇒ dừng con (T7); watchdog quét sổ con (T10); trần + công tắc giết + **đo chi phí** (T13); bảng Sub-agents **theo từng lượt** (T4, đóng BUG-43) | T4, T7, T10, T13 |

**Ba luồng chủ nhà mô tả (phải chạy được, có test đầu-cuối T16)**:
- **L1 test ↔ review**: `test` kiểm tới một mức thì `await_children(['review'])`; `review` xong ⇒ giao **cả `main` và `test`**
  (2 biên nhận), `test` chạy tiếp từ bước kế và trích kết quả review vào câu trả lời cuối; `main` ghi nhận hoặc báo tiến độ.
- **L2 plan ↔ research**: `main` sinh `plan` và `research` song song; `plan` làm tới mức đã định rồi chờ; `research` trả ⇒
  giao cho `plan` (+ `main`, và người nhận tuỳ chọn) ⇒ `plan` chạy tiếp hoặc báo tiến độ.
- **L3 chuỗi khác**: cùng khuôn cho các cặp vai khác; **con không tự sinh** (D-11), nên chuỗi do `main` dựng.

**Công tắc**: `BOXFOX_PEER_MESH` **on** (tắt ⇒ y hệt hành vi hôm nay, có test riêng); fan-out 3/6; `spawn_peer` **không có**;
`BOXFOX_PARALLEL_READ_TOOLS` **off** (việc tuỳ chọn T14 của vòng sau).

**Nghiệm thu đóng đợt** (peer §3): 2 con song song mang `turn` đúng và lượt sau **rỗng**; chờ **tới lúc giao** (đo được
mốc ~2 s, không đợi hết 300 s); chạm lưới ⇒ `timeout`/`partial`; 2 biên nhận, không bơm lặp; kết thúc lượt cha ⇒
không còn con sống; báo cáo chi phí tăng thêm; `BOXFOX_PEER_MESH=off` ⇒ hành vi hôm nay.

---

## 5. Đợt 3 — Bằng chứng sống ở câu trả lời cuối (25 việc, 6 pha)

Chi tiết: `docs/plan/v22/evidence-proof.md` (nghiệm thu sống ở §5, mốc `enforce` ở §6).

| Pha | Việc | Nội dung |
|---|---|---|
| **P1** Nền | P1.1–P1.5 | Danh tính **lượt** cho `turn_start`/`turn_end`/`tool.end`; `turn`/`step` xuyên nhật ký; hằng số + công tắc; `worker.py` sinh **diff/sha256 tại chỗ** và ghi tệp bằng chứng (không cần dựng lại image); prune định kỳ |
| **P2** Bộ phân loại | P2.1–P2.3 | `evidence_gate.py` (khuôn `plan_quality.py`): bảng loại việc → bằng chứng, **năm luật R1–R5**, khối lời nhắc cho vòng vá |
| **P3** Cổng trong lượt | P3.1–P3.6 | Chèn cổng ngay trước khi phát câu trả lời; **một** phép dò box khi cần; **một** vòng vá (chỉ ở `enforce`, có guard ngân sách, nằm trong `asyncio.timeout` của lượt); ghim `E:`/`X:`; số vào `turn.end`; trần 60 000/150 000 (D-4) |
| **P4** Giao diện | P4.1–P4.5 | Store **không ném** `session.journal` nữa; nhãn ba trạng thái (**đã kiểm / chưa kiểm / chưa đo được** — thiếu dữ liệu ⇒ `chưa kiểm`, không bao giờ xanh); danh sách bằng chứng bấm mở được (media → lightbox, tệp → tab Files); biên nhận; test DOM bốn ca |
| **P5** Eval | P5.1–P5.3 | S4 (khẳng định không có bằng chứng) rời `not_measured` ⇒ `measured`; giữ `not_measured` khi log cũ; ghim + README; **đồng hồ đếm về mốc `enforce`** |
| **P6** Ghi sổ | P6.1–P6.3 | **BUG-44** (nhãn xanh vô điều kiện + store ném nhật ký + tool sửa tệp trả chuỗi rỗng nghĩa); nhật ký vòng; **D-8/D-14** vào sổ chốt |

**Mốc `enforce` (đã chốt, D-14)**: ≥ **20 phiên** có số trong `~/BoxFox/logs/harness.jsonl` **và** tỉ lệ báo động sai
**< 10 %** (đo ở `warn`) ⇒ **DEV** sửa `EVIDENCE_DEFAULT_MODE` sang `enforce`; chưa đủ thì giữ `warn` và chạy tiếp.

---

## 6. Điểm va chạm giữa ba đợt và luật hợp nhất

| Chỗ chạm | Đợt liên quan | Luật hợp nhất |
|---|---|---|
| `runtime.py` (`delegate` `:2492-2565`, `turn_end`, `child` event, `session_metrics`) | Nền B5/B6/B10 → Mesh T5/T6/T7/T13 | Làm B5/B6/B10 **trước**; mesh **dùng lại** `stepsUsed`/`deadlineUsedMs` (không đặt tên mới); trần mesh phải **≥** `CHILD_MAX_STEPS`/`CHILD_DEADLINE_SECONDS` (40/300) và **trừ** vùng chẩn đoán `WRAP_UP_STEPS_RESERVED` |
| Danh tính **lượt** (`turn`) | Mesh T2/T3 ⨯ Bằng chứng P1.1–P1.3 | **Một khối duy nhất** ngay sau giai đoạn 1 của đợt nền: một bộ đếm lượt, `turn`/`step` trên mọi event, `journal.turn/step`. Hai đợt kia **đọc** chứ không dựng lại |
| Đường câu trả lời cuối (`runtime.py:1696-1727`) | Nền D2 → Bằng chứng P3 | Làm D2 trước (nhỏ, hằng số riêng); cổng bằng chứng đứng cạnh, **hai cổng độc lập, hai `notice` khác nhau** |
| `limits.py` | Nền B1 → Mesh T13 → Bằng chứng P1.3 | Chỉ một đợt sửa ở một thời điểm; mọi trần mới đều là hằng số **có tên** + exposed qua `runtime-info` |
| `docs/tracking/owner-decisions.md` | Nền E4 → Mesh T18 → Bằng chứng P6.3 | **Một người viết cho mỗi lượt**: E4 ghi D-1/D-11; T18 ghi D-7/D-10/D-12/D-13; P6.3 ghi D-8/D-14. **Không xoá hàng cũ**, chỉ thêm dòng mới vào *Lịch sử sửa đổi* |
| `SubagentInspectorPanel.tsx`, `harnessChatStore.ts` | Mesh T4 (+ Bằng chứng P4.1 cùng tệp store) | T4 làm bảng theo lượt trước; P4.1 chỉ thêm nhánh `journal`/`evidenceByTurn`, không viết lại phần lượt |

---

## 7. Kiểm thử và điều kiện đóng vòng 22

**Ba lệnh toàn kho** (chạy ở mỗi cổng giai đoạn và trước khi mở PR):

```bash
cd backend && python3 -m pytest tests/unit -q
cd frontend && npx vitest run && npx tsc -b --noEmit
cd deploy/docker && python3 -m pytest tests -q
```

**Mười một việc nghiệm thu sống** (mỗi việc một lệnh, nguyên văn trong ba bản chi tiết):

1. Menu `+` **bấm được** (hit-test `true`) và cả bốn mục đúng như hiển thị (Drive nói thật "chưa kết nối").
2. Gửi kèm tệp ⇒ `.uploaded_artifacts/<số>.<ext>` **mới** trong box, nội dung **khớp byte**, đường dẫn thật có trong
   event `user` **và** trong ngữ cảnh gửi model.
3. Hai lần upload song song ⇒ không trùng số (`uniq -d` rỗng).
4. Lượt chạm trần bước/hạn chót ⇒ `turn_end.status == 'partial'`, **một** notice kèm `diagnosis: True`, câu trả lời cuối
   **không rỗng** và **đủ bốn phần**.
5. Con dùng hết ngân sách ⇒ cha nhận `status='partial'`, `diagnosis is True`, `answerChars > 0` (không còn `failed` trắng
   như BUG-42); ngân sách con = `min(40, cha)` bước / `min(300, cha)` giây.
6. `maxSteps: 999` ⇒ **một** notice `STEPS_CLAMPED`; `runtime-info` trả mặc định **40**.
7. `migrate_plans.py --apply` trên bản sao ⇒ có backup + `manifest.json` khớp sha256; chạy lại ⇒ `nothingToDo`;
   `--delete-orphan` **từ chối** tệp đang có vé `P:`.
8. Dải jaccard: lần 1 từ chối, lần 2 (nguyên văn) nhận và `P:` mang `identityAmbiguity`, không sinh `v1-…` thứ hai.
9. Câu trả lời 200 000 ký tự ⇒ `ANSWER_TOO_LONG` + `partial`; 70 000 ⇒ chỉ cảnh báo; ngưỡng plan vẫn 40 000/150 000.
10. **Mesh**: 2 con song song mang `turn` đúng, lượt sau rỗng; chờ **tới lúc giao**; 2 biên nhận cho `review → main` +
    `test`; kết thúc lượt cha ⇒ không còn con sống; `BOXFOX_PEER_MESH=off` ⇒ hành vi hôm nay.
11. **Bằng chứng**: một yêu cầu **đổi UI thật** ⇒ ảnh **trước/sau** trong `/code/.generated_artifacts/images/`,
    `assistant.data.evidence.verdict='sufficient'` với `artifacts[]` trỏ tệp có thật, `turn.end` có số của cổng, và ảnh UI
    cho thấy nhãn **đã kiểm** + danh sách bằng chứng mở được; lệnh P5.1 in ra `sessions=` / `S4=measured` / `flagged=`.

---

## 8. Chi phí, cờ và công tắc giết

| Cờ / trần | Mặc định | Tác dụng khi tắt / chạm trần |
|---|---|---|
| `BOXFOX_PEER_MESH` | **on** | `off` ⇒ y hệt hành vi hôm nay (uỷ thác chặn, không tool peer) |
| fan-out theo cha | **3** (trần 6, toàn cục 8) | đặt 1 ⇒ mỗi cha một con như cũ |
| chờ giữa các con | **tới lúc giao** | lưới an toàn 300 s/lần, 300 s/tổng-lượt ⇒ `timeout`/`partial` |
| trần tường con | **900 s** | bị watchdog đánh dấu một lần rồi dừng |
| `BOXFOX_PARALLEL_READ_TOOLS` | **off** (việc tuỳ chọn, vòng sau) | `off` ⇒ tool tuần tự như hôm nay |
| `BOXFOX_EVIDENCE_GATE` | **warn** | `off` ⇒ không có khoá `evidence`; `enforce` chỉ bật theo mốc D-14 |
| vùng chẩn đoán | **3 bước** + 1 lời gọi chốt (≤ 1024 token, ≤ 30 s) | trừ vào ngân sách của chính lượt đó (cả cha và con) |
| độ dài câu trả lời | **60 000 / 150 000** | cảnh báo / từ chối + `partial` |
| ngân sách bước | cha **40** (trần 60) / con **40** (kẹp theo cha) | lượt dài phải trả `partial` **kèm chẩn đoán**, không mất trắng |

**Chi phí chấp nhận được (D-10)**: mỗi lượt có mesh phải báo cáo **số tăng thêm** (`steps`, `outputTokens`, `waitedMs`,
`childCount`) trong `turn_end`/`session_metrics` để chủ nhà thấy giá thật của kiến trúc nặng; không có trần chi phí cứng,
chỉ có công tắc giết và số đo.

---

## 9. Rủi ro và cách chặn

| Rủi ro | Cách chặn |
|---|---|
| Vòng vá bằng chứng biến một lượt "thiếu bằng chứng" thành lượt `DEADLINE` không có câu trả lời | Vòng vá nằm trong `asyncio.timeout` của lượt, bỏ khi còn < 20 s, trần lồng `min(60, còn lại − 10)`; hết ngân sách ⇒ **không** gọi vòng vá |
| Giao hàng bơm hai lần ⇒ con làm lại việc | `UNIQUE(child_id, recipient, recipient_turn)` + chuyển `pending → injected` trong một transaction; người nhận đã chết ⇒ biên nhận `skipped` |
| Chờ nhau thành deadlock | Bảy luật chống deadlock (peer §1.6): mọi lần chờ có trần, không chờ chính mình, phát hiện chu trình theo `parent_turn`, huỷ theo cha, watchdog |
| Hai đợt sau dựng hai bộ đếm lượt khác nhau | Khối dùng chung ở §2, làm **một lần**; hai đợt chỉ đọc |
| Cổng bằng chứng báo sai quá nhiều ⇒ người dùng mất tin | Mặc định `warn`; mốc bật `enforce` là số đo (20 phiên, < 10 %); `chưa đo được` **không bao giờ** hiện thành xanh |
| Upload làm nghẽn request 1 MiB | Tối đa **2 ảnh** inline, tổng ≤ 800 000 ký tự; tệp khác chỉ gửi **đường dẫn** trong box |
| Bảng Sub-agents lại trộn lượt sau khi thêm mesh | T4 làm **trước** T5–T7; `turn`/`step` có trên **mọi** event `child`; lượt không có con ⇒ bảng **rỗng** |
| Reserved 3 bước làm giảm việc hữu ích | Chỉ giữ chỗ khi còn ≤ 3 bước hoặc ≤ 30 s; số dùng thật đi vào `turn_end` để đo |

---

## 10. Ghi sổ và tài liệu phải cập nhật

- `docs/tracking/bug-register.md`: **BUG-44** (nhãn xanh vô điều kiện; store ném `session.journal`; tool sửa tệp trong box
  trả chuỗi rỗng nghĩa) + ghi chú đóng BUG-38…BUG-43 khi việc tương ứng xong.
- `docs/tracking/test-rounds.md`: mục **Vòng 22** — số đo của ba đợt, ảnh bằng chứng, và mục "vòng sau".
- `docs/tracking/owner-decisions.md`: cập nhật **D-1** (con 40/300), thêm **D-11…D-15**, đánh dấu **D-6…D-10** theo tiến độ;
  giữ luật **không xoá hàng cũ**.
- `docs/plan/v22/`: ba bản chi tiết (`foundation.md`, `peer-mesh.md`, `evidence-proof.md`) + ba bản tóm tắt.
- `docs/design/v22/`: mockup HTML + `design-plan.json` (đã gắn vào Design-tab của lần duyệt này).
- **ADR** (một tệp cho cả ba đợt, hoặc một cho mesh): vì sao mesh chạy nền tảng trước, vì sao con không tự sinh,
  vì sao chờ "tới lúc giao" mà vẫn có lưới an toàn.

---

## 11. Bản vẽ giao diện (đã có, xem ở Design-tab)

| Mặt | Phương án khuyến nghị | Phương án thay thế |
|---|---|---|
| Bảng Sub-agents **theo lượt** | `turns-panel-per-turn.html` | `turns-panel-two-running.html`, `turns-panel-all-turns.html` |
| Con **đang chờ bạn** + khoảnh khắc nhận kết quả | `turns-waiting-child-waits-peer.html` | `turns-waiting-delivery-receipt.html` |
| Nhãn **ba trạng thái** + danh sách bằng chứng | `evidence-badge-verified.html` | `evidence-badge-warn.html`, `evidence-badge-partial.html` |
| Tệp đính kèm **đi tới box** | `attachments-popover-overlay.html` | `attachments-chip-row.html` |

---

## 12. Điều kiện dừng an toàn (báo chủ nhà, không tự đi tiếp)

Dừng và báo ngay nếu gặp một trong các ca sau: (a) test đỏ ở một cổng giai đoạn mà không sửa được trong 2 lần thử;
(b) quan sát thấy chờ nhau không kết thúc dù mọi trần đã đúng; (c) `BOXFOX_PEER_MESH=off` cho hành vi **khác** hôm nay;
(d) cổng bằng chứng đổi **văn** câu trả lời khi đang ở `warn`; (e) con chạm trần mà **không** trả chẩn đoán;
(f) upload tới box nhưng nội dung **không** khớp byte.
