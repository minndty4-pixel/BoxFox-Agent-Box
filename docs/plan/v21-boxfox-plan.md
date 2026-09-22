# Kế hoạch vòng 21 — năm việc chủ nhà giao (2026-09-22)

> Vòng này **chỉ viết kế hoạch và báo cáo**; chưa sửa code sản phẩm. Mọi số đo sống nằm ở
> `docs/tracking/test-rounds.md` § *Vòng 21*, ảnh ở `/code/.generated_artifacts/images/r21_*.png`.
> Kế hoạch gồm sáu phần A–F; mỗi việc có mã (`A1`, `A2`…), nhãn phụ thuộc `**[parallel]**` /
> `**[after A1, A2]**`, lệnh kiểm chứng cụ thể, và phần nghiệm thu riêng.

## 0. Bối cảnh, phạm vi, bằng chứng

Năm việc chủ nhà giao trong đợt này, cùng trạng thái **đo được** (không phải suy đoán):

| # | Việc | Trạng thái đo sống | Bằng chứng |
|---|---|---|---|
| A | Upload trong dấu `+`: nội dung tệp phải tới agent | **KHÔNG ĐẠT** — menu còn bị cắt, tệp chỉ còn cái tên | ảnh `r21_local_02_menu_clipped.png`, `r21_local_04_sent.png`, event `user` của phiên `0ef73471…` |
| B | `maxSteps` 16 → 40, hai lỗi quanh trần bước/hạn chót | **ĐO ĐƯỢC** — cha 8 bước xong; con 10 bước ⇒ `DEADLINE`, mất trắng 9 bước | log `/tmp/runD.txt`, phiên con `ea948649…` |
| C | Kiến trúc để sub-agent nhìn thấy nhau | **CHƯA CÓ** — chỉ cha nhìn con, con không nhìn ai | `runtime.py:2531-2534`, `roles.py:7-11`, `runtime.py:1944-1967`, `runtime.py:1991-1995` |
| D | Bằng chứng sống gắn vào câu trả lời cuối | **CHƯA CÓ cổng nào** — chỉ có câu lệnh trong prompt | `runtime.py:1696`, `:1712-1727`; `plan_quality.py` chỉ chặn plan |
| E | Bảng Sub-agents theo từng turn | **KHÔNG ĐẠT** — turn 3 vẫn hiện con của turn 2 | ảnh `r21_perTurn_03_turn3_with_stale_child.png`; `SubagentInspectorPanel.tsx:162-196`; `harnessChatStore.ts:294` |

Hai việc phụ chủ nhà nhắc kèm: (i) báo lại tình trạng model `muse spark 1.2/1.3` — **cả hai chạy được**
(đo sống, xem § Vòng 21), (ii) **F — năm việc chủ nhà chốt** lấy từ
`docs/tracking/test-rounds.md` § *Cần chủ nhà chốt sau vòng này*.

Nguyên tắc áp cho cả sáu phần: **không thêm giá trị `status` mới** (`runtime.py:1199`,
`runtime_commands.py:29-31`, giao diện ánh xạ giá trị lạ thành `failed` — `SubagentInspectorPanel.tsx:170`),
**mọi thay đổi schema chỉ ghi thêm cột** qua `_add_missing_columns()` (`session_store.py:67-86`),
và **mọi hành vi mới phải đo được** bằng một dòng `turn_end` / `system_log`.

---

## Kế hoạch A — Nội dung tệp đính kèm phải đi tới box

### A.0 Hiện trạng, đo sống

Ba chặng đang đứt, cả ba đều đo được:

1. **Menu vô hình.** Mục menu có trong DOM (`itemRect [290,642,226,45]`) nhưng
   `document.elementFromPoint` tại tâm mục đó trả về khung chat ⇒ mục bị **cắt** bởi tổ tiên
   `flex min-w-0 items-center gap-1.5 overflow-hidden` (`frontend/src/components/panels/ChatInputBar.tsx:268`),
   trong khi popover đặt `absolute bottom-full` (`frontend/src/components/chat/AttachmentPicker.tsx:159`).
   Chủ nhà nhìn thấy "chưa có upload" chính vì lý do này.
2. **Nội dung không đi.** Chỉ ảnh được đọc bằng `FileReader` thành `dataUrl`
   (`AttachmentPicker.tsx:56-68`); tệp thường chỉ giữ `{id, name, size, source: 'computer', isFolderItem}` (`:69-77`).
   Lúc gửi, tên được nhét vào chuỗi `` `[Attached Files: ${…}]` `` (`ChatInputBar.tsx:113-115`).
   Đo sống: event `user` của phiên `0ef73471c38d4c63a593755345213dcf` đúng bằng
   `"…in ra nguyên văn dòng đầu tiên…\n\n[Attached Files: probe-upload.txt]"` — **không có nội dung, không có đường dẫn**.
3. **Không có gì trong box.** Sau khi gửi: `docker exec agentbox-box ls .uploaded_artifacts` → **rỗng**,
   `find /home/agent/workspace -name '*probe-upload*'` → **không có**. Agent phải đi tìm rồi kết luận
   "tệp không tồn tại" và lượt đó chết bằng `TURN_EMPTY_RESPONSE`.

Đường ống để nối **đã có sẵn**, chỉ chưa ai gọi:

| Mảnh | Ở đâu | Ghi chú |
|---|---|---|
| Nhận tệp phía box | `deploy/docker/ide-proxy.py:540-568` `POST /__box/file/upload?path=&name=` | gate bằng `X-BoxFox-Api-Key`, ghi 64 KiB mỗi lần, trả 403 nếu thiếu khoá |
| Hàm ghi | `deploy/docker/workspace_files.py:743-754` → `:698-741` | `dir_fd` + `O_NOFOLLOW`, `chown 1000:1000`, mode `0o640` |
| Client phía giao diện | `frontend/src/lib/workspace/http.ts:70-87` `upload(targetDir, filename, blob)` | đang chỉ dùng cho panel Workspace Files |
| Cấu hình box | `frontend/src/lib/boxApi.ts` | mặc định `http://localhost:8081`, khoá `boxfox-local-dev-token` |
| Thư mục đích | `deploy/docker/box-entrypoint.sh:15-24` | `/home/agent/workspace/.uploaded_artifacts`, `chmod 0750`, `chown 1000:1000` |
| Luật tên | `docs/naming.md:24` RULE-5 `.uploaded_artifacts/<số>.<ext>` | **chưa có code nào cấp số** — đây là quyết định thi công |
| Trần hiện có | `workspace_files.py:47` `MAX_UPLOAD_SIZE = 256 MiB`; đọc text `:46` 1 MiB (413 ở `:484`) | chưa có trần phía client |

Ràng buộc phía model: ảnh phải là data URL `data:image/png|jpeg|webp;base64,` và ≤ 700 000 ký tự
(`backend/src/agentbox/agent_core/runtime.py:1177-1178`); `file_read` chỉ đọc text, cắt 30 000 ký tự
(`backend/src/agentbox/sandbox/worker.py:343-344`) ⇒ **PNG/PDF đọc thẳng sẽ lỗi**.

### A.1 Việc

- **A1 [parallel]** — Sửa gốc phần cắt: bỏ `overflow-hidden` khỏi hàng công cụ
  (`ChatInputBar.tsx:268`) **hoặc** render popover qua portal (`createPortal` ra `body`) và định vị theo
  `getBoundingClientRect` của nút `+`. Giữ chip đính kèm. Không dùng `z-index` để chữa — gốc là clipping.
- **A2 [after A1]** — `AttachmentPicker` giữ **đối tượng `File`** (thêm trường `file?: File` vào
  `AttachedFile`, `AttachmentPicker.tsx:11-18`), không chỉ `name`/`size`.
- **A3 [after A2]** — Lúc gửi, `ChatInputBar` gọi `upload('.uploaded_artifacts', name, file)`
  (`lib/workspace/http.ts:70-87`) cho **từng** tệp; chờ xong mới gửi lượt. Tệp lỗi ⇒ chip đỏ + chặn gửi
  (không gửi lượt "tên suông" như hiện nay).
- **A4 [after A3]** — **Cấp số RULE-5 ở phía box**, không ở giao diện: thêm `next_upload_index()` ghi
  bộ đếm một chiều trong `.uploaded_artifacts/.counter` (khoá `O_EXCL`, tăng trước khi ghi, không zero-pad).
  Giao diện chỉ gửi `name=<ext>`; box trả `path` đã cấp. Lý do: hai tab gửi cùng lúc không đè số.
- **A5 [after A3]** — Prompt nhận **đường dẫn thật** thay cho `[Attached Files: …]`:
  `"[Tệp đính kèm đã lưu trong box: .uploaded_artifacts/3101.md]"`; nhắc luật đọc tệp nằm ở
  `deploy/docker/box-entrypoint.sh` … (bổ sung một dòng vào prompt hệ thống, `runtime.py:1108-1117`,
  vì hiện prompt không nói quy ước đường dẫn nào).
- **A6 [after A4]** — Ghi **metadata đính kèm** vào event `user` (`runtime.py:1193`) và bản sao ở
  `backend/src/agentbox/skills/runtime_commands.py:129`: `{attachments: [{path, name, bytes, kind}]}`. Giao diện đã có chỗ đọc ảnh
  (`frontend/src/components/chat/HarnessStepView.tsx:979` đọc `turn.userEvent.data.image`, render `:1001-1012`);
  tệp thường cần hàng chip mới.
- **A7 [after A2]** — Ảnh: gửi **tất cả** ảnh, không chỉ ảnh đầu (`ChatInputBar.tsx:116` gọi
  `find(...)`); áp trần 700 000 ký tự và `MAX_INLINE_MEDIA = 2` / 512 KiB (`runtime.py:137-138`) ngay ở client.
- **A8 [after A3]** — Thư mục: hai dòng `AttachmentPicker.tsx:65`, `:75` **đặt** `isFolderItem: isFolder` nhưng không nơi nào đọc cờ đó,
  và `webkitRelativePath` không được đọc ở đâu trong `frontend/src` ⇒ cây thư mục bị làm phẳng; hoặc giữ cây theo
  `webkitRelativePath`, hoặc chặn rõ ràng "thư mục chưa hỗ trợ".
- **A9 [after A3]** — Google Drive (`AttachmentPicker.tsx:96-104`) hiện là **stub** trả tên giả
  `Architecture_Blueprint_2026.gdoc`; hoặc gỡ mục khỏi menu, hoặc ghi rõ "chưa hỗ trợ" — không được giả.
- **A10 [after A5]** — Tệp nhị phân: thêm `file_read_binary` trả `dataUrl` (ảnh) / base64 cắt ngắn, hoặc
  mở rộng `file_read` nhận `.png` (hiện `UnicodeDecodeError` tại `worker.py:343-344`).
- **A11 [after A3]** — Trần và dọn rác: pre-flight ở client (mặc định 25 MiB/tệp, 100 MiB/lượt), và
  **retention cho `.uploaded_artifacts`** (hiện không có) theo mẫu `deploy/docker/session_files.py:88-93`
  + `retention()` `:837-893`: giữ 200 tệp / 512 MiB, mỗi lần dọn ghim một bản ghi `X:`.
- **A12 [parallel]** — Test: `AttachmentPicker` chưa có test nào; thêm vitest cho (menu portal, chip, gọi
  `upload`), giữ `frontend/src/lib/workspace/http.test.ts:53-58` (khoá + `octet-stream`), và thêm ca box
  `deploy/docker/tests/test_ide_proxy_workspace.py:178-224` cho đường cấp số RULE-5.

### A.2 Nghiệm thu phần A

```bash
# 1. Menu không còn bị cắt (hit-test là tiêu chí, không phải ảnh)
agent-browser --session <tên> click @<nút +> && agent-browser --session <tên> eval \
  '(()=>{const b=[...document.querySelectorAll("button")].find(x=>/Tải lên tệp/.test(x.textContent));const r=b.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return t===b||b.contains(t)})()'
# 2. Nội dung tới box — endpoint đọc THÂN THÔ, không phải multipart (`ide-proxy.py:555-566` đọc `self.rfile`)
curl -s -X POST -H 'X-BoxFox-Api-Key: boxfox-local-dev-token' \
  -H 'Content-Type: application/octet-stream' --data-binary @/var/tmp/probe-upload.txt \
  'http://127.0.0.1:8081/__box/file/upload?path=.uploaded_artifacts&name=probe-upload.txt'
docker exec agentbox-box sh -lc 'ls -l /home/agent/workspace/.uploaded_artifacts'
# 3. Lượt gửi kèm tệp: event `user` phải chứa đường dẫn, và agent trả về đúng dòng đầu
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>' | python3 -c 'import json,sys;d=json.load(sys.stdin);print([e for e in d["events"] if e["type"]=="user"][-1])'
```

## Kế hoạch B — Ngân sách bước và hạn chót

### B.0 Hiện trạng, đo sống

| Hằng số | Giá trị | Nơi |
|---|---|---|
| `MAX_STEPS_DEFAULT` | 16 | `backend/src/agentbox/agent_core/limits.py:16` |
| `MAX_STEPS_MAX` | 60 | `limits.py:17` |
| `DEADLINE_DEFAULT_SECONDS` | 180 | `limits.py:18` |
| `DEADLINE_MAX_SECONDS` | 600 | `limits.py:19` |
| `CHILD_MAX_STEPS` | 10 | `limits.py:20` |
| `CHILD_DEADLINE_SECONDS` | 120 | `limits.py:21` |

Đo sống vòng này:

- **Cha, việc vừa phải:** đọc 2 tệp + grep + viết báo cáo + đọc lại ⇒ **8 bước**, `completed`
  (phiên `dddebffb887a4f6ca814c1514367d38d`). Không chạm trần 16 bước, không chạm 180 s.
- **Con, việc nhỏ mà nhiều bước:** `delegate_task role=explore` liệt kê 5 mục workspace ⇒ con chạy
  **10/10 bước**, hết **120 s** ⇒ `DEADLINE`, `answerChars = 0`, cha nhận `status=failed`
  (phiên con `ea9486495da646d7aac4ccd4214ea8ed`, 33 tool call). **Toàn bộ 9 bước làm được bị vứt.**
  Đây đúng là ảnh chủ nhà gửi: `Error code: DEADLINE`, `Worked for 180s`.
- Trần bước đánh `failed` một việc đã xong: mã `MAX_STEPS` (`backend/src/agentbox/agent_core/failures.py:52`);
  hạn chót: mã `DEADLINE` (`failures.py:118-119`). Cả hai **không có đường trả về phần đã làm**.
- Lượt `TURN_EMPTY_RESPONSE` (mã ở `failure` của lượt) cũng đánh `failed` và **không thử lại**
  (phiên `0ef73471…`, 5 bước, model trả thought mà không có text/tool call) — lỗi thứ ba, đo được vòng này.

### B.1 Việc

- **B1 [parallel]** — `MAX_STEPS_DEFAULT` 16 → **40**, giữ `MAX_STEPS_MAX = 60`; cập nhật
  `runtime-info` (`limits` khối đã trả về ở `api/server.py`), tài liệu, và test hằng số.
- **B2 [parallel]** — Tách hai mã lỗi, mỗi mã nói rõ **việc đã làm được tới đâu**: `STEP_BUDGET_EXHAUSTED`
  và `DEADLINE_EXCEEDED` (thay vì dùng chung `failed`), kèm `stepsUsed`, `deadlineUsedMs`, `toolsRun`.
- **B3 [after B2]** — **Trả về phần đã làm thay vì vứt**: khi chạm trần/hạn chót, harness xin một câu trả lời
  chốt ngắn ("tóm tắt những gì đã kiểm chứng + việc còn dở"), ghim nó thành `assistant` cuối, đánh dấu
  lượt `partial` (đã có sẵn cơ chế `partial` — `runtime.py:1719-1727`), và ghim `X:` blocker vào journal
  (`_journal_blocker`, `runtime.py:648-670`). Không thêm `status` mới.
- **B4 [after B2]** — Ngân sách theo vai: orchestrator 40/300 s, con `CHILD_MAX_STEPS` 10 → **24**,
  `CHILD_DEADLINE_SECONDS` 120 → **240**; con của con (nếu mở ở phần C) nhỏ hơn cha.
- **B5 [after B1]** — **Không cắt im lặng**: đã có `DEADLINE_CLAMPED` (`limits.py:64`, `runtime.py:1079-1092`);
  mở rộng cho `maxSteps` (`STEPS_CLAMPED`) và trả cả `requested` so với `applied`.
- **B6 [after B3]** — `TURN_EMPTY_RESPONSE`: thử lại **một** lượt với `tool_choice` ép buộc, hết cách mới
  đánh `failed`; lỗi này phải hiện mã chứ không phải băng đỏ trống.
- **B7 [parallel]** — Đo để lần sau khỏi đoán: ghi `stepsUsed` / `deadlineUsedMs` vào `turn_end`
  (`runtime.py:1436-1454`, `:1724-1726`) và vào `system_log`, để `scripts/eval/rushed_index.py` đếm được.
- **B8 [parallel]** — Hai lỗi đã sửa ở đợt trước giữ nguyên hồi quy (C1 clamp im lặng, C2
  `TRUNCATED_OUTPUT_MAX_TOKENS = 2048` + một lượt thử lại — `limits.py:71-72`), thêm test chống tái phát.

### B.2 Nghiệm thu phần B

```bash
# Trần bước: chạy lại đúng việc từng đỏ
python3 scripts/run-harness.py  # nếu chưa chạy
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json' \
  -d '{"prompt":"<việc 27 bước>","maxSteps":40,"deadlineSeconds":300}' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>/turns'
# Kỳ vọng: status=completed, stepsUsed=27, không có mã MAX_STEPS/DEADLINE
# Hạn chót: việc con chạm 120 s phải trả partial (answerChars > 0) thay vì failed
python3 -m pytest backend/tests/unit -q -k "limits or deadline or steps"
```

## Kế hoạch C — Sub-agent nhìn thấy nhau (kiến trúc định tuyến)

### C.0 Hiện trạng

- Mỗi cha chỉ có **một** đường sinh con, chạy tuần tự: `runtime.py:2531-2534`
  (`async with self.child_slots: … await task`); `child_slots = asyncio.Semaphore(3)` là trần **toàn tiến trình**
  (`runtime.py:967`), không phải theo cha ⇒ hai phiên cha tranh nhau 3 slot.
- Tool trong một bước cũng chạy tuần tự (`runtime.py:1730-1741`, trần 16 ở `:1728`).
- Con **không** đọc/không chờ/không nhắn được bạn: tập tool là frozenset theo vai (`roles.py:7-11`,
  gán `:148-158`, giao với tool của cha `:163-165`); không có tool peer nào trong `tool_contracts.py:17-117`;
  `session_search` chỉ orchestrator và **khoá theo sid của chính nó** (`roles.py:159-160`, `runtime.py:1944-1945`,
  `:1966-1967`).
- Con không hỏi được người dùng: `runtime.py:1991-1995` (`DECISION_UNAVAILABLE`).
- Kết quả con trả về cha là một dict có trần (`runtime.py:2556-2563`), cha đọc tối đa 20 000 ký tự (`:1762-1763`);
  sự kiện `child` bắn lên luồng của cha lúc bắt đầu/kết thúc (`:2523-2530`, `:2564`).
- `store.events()` trả tối đa 500 hàng (`memory/session_store.py:136-139`) ⇒ mọi thiết kế "đọc luồng của bạn"
  phải chấp nhận cửa sổ 500.

### C.1 Kiến trúc đề xuất — "bảng bàn giao có định tuyến" (routed handoff), ba tầng

**Tầng 1 — sổ con theo phiên cha (C1).** Mọi lần sinh con ghi một hàng `children`
(`session_id`, `parent_id`, `turn`, `step`, `role`, `goal`, `status`, `delivered_to`). Đây là nguồn duy nhất
cho cả giao diện (phần E) và cho định tuyến (C3). Ghi thêm cột, không đổi `status`.

**Tầng 2 — đọc/đợi bạn cùng cha (C2, C4).** Hai tool mới, chỉ mở cho con **cùng một cha** (không mở toàn cục):
`peer_read(sessionId, afterSeq)` và `await_children(ids, mode=all|any, timeoutSeconds)`. Cả hai đọc qua
`store.events()` nên bị chặn tự nhiên ở 500 hàng; không tool nào cho phép ghi vào phiên bạn.

**Tầng 3 — giao hàng có địa chỉ (C3).** `delegate_task` thêm trường tuỳ chọn
`deliverTo: ['main'] | ['peer:<sid>'] | ['plan'] | '<role>'`, và child event mang `deliveredTo`.
Người nhận chỉ nhận **kết quả đã qua trần**; người gửi không bao giờ ghi trực tiếp vào hội thoại của người nhận.
Đây là điều kiện để "test chạy tới đâu thì chờ review, review xong trả kết quả cho main **và** test, test chạy tiếp"
mà không phá tính ổn định: không có đường nào cho con tự ý chèn lời vào lượt của người khác.

**Điều kiện ổn định (bắt buộc, vì chủ nhà chấp nhận "nặng đô" nhưng phải chạy):**
bounded fan-out theo cha (mặc định 3, cấu hình được), ngân sách con kế thừa từ cha (B4), chờ có timeout cứng,
`child` giữ nguyên bộ `status` hiện có (`started`/`completed`/`partial`/`failed`), mọi lần giao hàng ghim `S:`/`E:`
vào journal, và **chỉ orchestrator được hỏi người dùng**.

### C.2 Việc

- **C1 [parallel]** — Bảng `children` + cột `turn`/`step` (migration ghi thêm, `session_store.py:67-86`); ghi
  hàng lúc `start` và cập nhật lúc kết thúc trong `runtime.py:2492-2565`.
- **C2 [after C1]** — `peer_read`: kiểm tra `parent_id` trùng nhau trước khi trả; trả tối đa N hàng, cắt theo
  trần như `session_search`.
- **C3 [after C1]** — `deliverTo` trong schema `tool_contracts.py:76-98` + kiểm tra quyền trong `runtime.py:2492-2494`
  (hiện chỉ chặn "leaf không được delegate") — thêm luật "chỉ giao cho người cùng cây".
- **C4 [after C2]** — `await_children(ids, mode, timeoutSeconds)`; chờ `any` để lấy kết quả sớm nhất, chờ `all`
  làm barrier; hết timeout trả `{status: 'timeout', done: [...], pending: [...]}` chứ **không** nuốt im lặng.
- **C5 [after C1]** — Fan-out theo cha thay cho semaphore toàn cục (`runtime.py:967`): `Semaphore` đặt trong
  từng phiên cha; đo bằng test hai phiên cha chạy đồng thời.
- **C6 [after C4]** — Chạy song song trong một bước: thay vòng `for` tuần tự (`runtime.py:1730-1741`) bằng
  `asyncio.gather` **chỉ cho tool đọc** (đọc tệp, grep, web, peer_read) — tool ghi (`file_write`, `terminal_exec`)
  vẫn tuần tự theo thứ tự model gọi.
- **C7 [after C3]** — Prompt: bổ sung hợp đồng bàn giao vào `runtime.py:858-865` (`CHILD_RESULT_CONTRACT`) và
  dòng ở `runtime.py:65`; nói rõ con **không** nhận lệnh từ bạn, chỉ nhận hàng qua `deliverTo`.
- **C8 [after C3]** — Vòng đời: ghim `X:` khi con chết (`answerChars = 0`) để lần sau hiện "đã mất gì";
  `stop` của cha phải dừng con theo (`runtime.py:1198-1208`).
- **C9 [after C1]** — Giao diện: hàng con hiện `turn/step`, mũi tên `deliveredTo`, và nhãn "đang chờ bạn"
  (`SubagentInspectorPanel.tsx:162-207`).
- **C10 [parallel]** — Test: `backend/tests/unit/test_delegation_contract.py` thêm ca `deliverTo`; test mới
  cho `peer_read` (khác cha ⇒ từ chối), `await_children` timeout, trần fan-out theo cha; test tích hợp
  "test → review → test → main" bằng model giả (scripted).

### C.3 Nghiệm thu phần C

```bash
python3 -m pytest backend/tests/unit -q -k "delegation or peer or await_children"
# Sống: chuỗi ba vai, một lượt
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json' \
  -d '{"prompt":"delegate_task role=testing goal=… (deliverTo peer:review, rồi chờ review rồi chạy tiếp); rồi trả kết quả cho main"}' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>/turns'
# Kỳ vọng: 3 phiên con, đúng chuỗi con→con→con, mỗi lần giao hàng có một hàng `child` mang deliveredTo,
# tổng thời gian <= deadline của cha, và main nhận được kết quả cuối
```

---

## Kế hoạch D — Bằng chứng sống gắn vào câu trả lời cuối

### D.0 Hiện trạng

- **Không có cổng nào.** Câu trả lời cuối chỉ được kiểm một điều kiện: có text và `finish_reason` hợp lệ
  (`runtime.py:1696`); sau đó phát thẳng ra (`runtime.py:1712-1713`) và đóng lượt (`:1719-1727`).
- Bằng chứng sống **đang có sẵn nhưng không ai đối chiếu**: `tool_end {id, name, args, result}` (`runtime.py:1769`),
  ảnh/ghi hình trong `.generated_artifacts/captures/<sid8>/` (`deploy/docker/capture.py:47`, phục vụ qua
  `/__box/file/media?path=` — `deploy/docker/ide-proxy.py:495`), và bản ghi journal `E:` (`agent_core/journal.py:304-315`).
- **Chỉ plan có cổng**: `check_plan_quality` + `plan_eval.evaluate_plan` (`runtime.py:2195`, `:2213`, `:2260`).
- Giao diện đang **khoe màu xanh vô điều kiện**: `FinalAnswerBlock` ghim badge `done`
  (`frontend/src/components/chat/HarnessStepView.tsx:1534-1537`) dù không có bằng chứng nào; dòng "receipt"
  chỉ đếm lệnh (`:134-146`). Store **bỏ luôn** `session.journal` khi làm mới (`harnessChatStore.ts:285-338`),
  dù backend đã trả (`api/server.py:285-293`, route `:573`).
- Đo lường đã có nhưng đang `not_measured`: S3 (ghi mà không kiểm) chạy được, S4 (claim thiếu bằng chứng)
  bị ghim `not_measured` (`scripts/eval/rushed_index.py:167-195`, test `backend/tests/unit/test_eval_setup.py:280-289`);
  rubric C2/C3 đã định nghĩa trong `scripts/eval/rubric.py:39-52`.

### D.1 Việc

- **D1 [parallel]** — Module thuần `backend/src/agentbox/agent_core/evidence_gate.py` (gương của
  `plan_quality.py`, không I/O): đầu vào là text cuối + danh sách `tool_end` của lượt + journal `E:` của lượt;
  đầu ra `{verdict, unsupported: [...], checked: n, missing: [...]}`. Luật tối thiểu: mỗi khẳng định có
  đường dẫn tệp / lệnh / URL / ảnh phải khớp một `tool_end` cùng lượt; câu khẳng định không có bằng chứng
  thì **không** bị xoá, chỉ bị đếm và gắn nhãn.
- **D2 [after D1]** — Cổng gọi tại `runtime.py` giữa `:1697` và `:1727`, ba mức
  `BOXFOX_EVIDENCE_GATE = off | warn | enforce` (mặc định **`warn`** ở vòng đầu). `enforce` chỉ bật sau khi
  đo được tỉ lệ dương tính giả < 10 %.
- **D3 [after D2]** — Một lượt sửa (bounded): nếu `verdict = insufficient` và mức `enforce`, gửi lại **một**
  lần với danh sách `missing` và yêu cầu "hoặc bổ sung bằng chứng, hoặc ghi rõ *chưa kiểm*". Quá một lượt thì
  trả lời như cũ + ghim nhãn.
- **D4 [after D1]** — Ghi kết quả vào ba chỗ: event `assistant` (`runtime.py:1713`) thêm `evidence`,
  `turn_end` (`:1446-1454`), và một bản ghi `E:` do harness ghim (`runtime.py:2455` hiện chỉ ghim `plan`,
  `:2484` ghim `decision`) — dùng đúng schema `journal.py:267-268` (`turn`, `step`) và `:304-315`.
- **D5 [after D4]** — Giao diện: `FinalAnswerBlock` thay badge xanh vô điều kiện bằng ba trạng thái
  **đã kiểm / một phần / chưa kiểm**; dòng receipt thêm "n bằng chứng, m khẳng định chưa kiểm"; bấm vào mở
  danh sách `tool_end` tương ứng trong cùng lượt (`TurnBlock`, `HarnessStepView.tsx:853-1196`).
- **D6 [after D4]** — Store đọc `session.journal` (`harnessChatStore.ts:285-338`) và hiện `E:`/`X:` của lượt;
  API đã có, chỉ thiếu phía đọc.
- **D7 [parallel]** — Đo: nối S4 vào bộ đếm thật (thay `not_measured`) bằng chính `evidence_gate` chạy chế độ
  `warn`; ghim số vào `system_log` để `scripts/eval/rushed_index.py` đọc.
- **D8 [parallel]** — Test: dùng lại oracle có sẵn của fixture Q3 (`paths_in_answer_exist`, `claims_have_evidence`
  — `scripts/eval/fixtures/Q3.json:33-35`) làm ca đơn vị; thêm ca "khẳng định không có tool_end" và
  "đường dẫn nêu ra không tồn tại trong box".

### D.2 Nghiệm thu phần D

```bash
python3 -m pytest backend/tests/unit -q -k "evidence_gate or plan_quality"
# Sống, ba lượt cố định: (1) sửa code thật, (2) chỉ nói suông, (3) lượt hỏi đáp thường
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json' \
  -d '{"prompt":"Sửa backend/src/agentbox/agent_core/limits.py cho MAX_STEPS_DEFAULT=40 rồi chứng minh bằng lệnh"}' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>/turns'
# Kỳ vọng: event `assistant` có `evidence.verdict=sufficient` và có ít nhất 1 `tool_end` là lệnh kiểm chứng;
# lượt (2) phải có `verdict=insufficient` + nhãn "chưa kiểm" trong khi status vẫn `completed`
```

---

## Kế hoạch E — Bảng Sub-agents theo từng turn

### E.0 Hiện trạng, đo sống

- Ảnh chủ nhà gửi: đang hỏi câu 2 mà bảng vẫn có `Explore` của turn 1. Đo lại vòng này đúng như vậy:
  turn 2 sinh con `ea948649…`; **turn 3** (hỏi `2+2`, 3 s, không gọi tool nào) xong mà bảng vẫn ghi
  `SPECIALISTS PIPELINE · 1 TOTAL · Explore Specialist FAILED · 33 tools executed`
  (`/code/.generated_artifacts/images/r21_perTurn_03_turn3_with_stale_child.png`).
- Gốc: `childrenMap` dựng từ **mọi** event `child` của phiên (`SubagentInspectorPanel.tsx:162-196`,
  lọc ở `:167`, render ở `:347`/`:361`), và store **không cắt theo turn**
  (`harnessChatStore.ts:294` `const allEvents = [...prevEvents, ...newEvents]`).
- Event `child` hiện **không mang turn/step** (`runtime.py:2523-2530`, `:2564`) ⇒ giao diện không có dữ liệu
  để phân turn, kể cả muốn.

### E.1 Việc

- **E1 [parallel]** — Thêm `turn`, `step`, `parentTurnId`, `deliveredTo` vào event `child`
  (`runtime.py:2523-2530`, `:2564`). **Chưa có bộ đếm lượt để đọc**: `turn_end` chỉ mang `step`
  (`runtime.py:1446-1454`), và `turnId` trong `system_log` là **số bước** (ghi ở `runtime.py:1574`, `:1748`,
  `:1752`, `:1801`), không phải số lượt. Việc E1 vì vậy gồm cả việc **thêm bộ đếm lượt một chiều theo phiên**
  (tăng trong `submit`, ghim vào `turn_end` và `system_log`); E3 mới là bên đọc, và mốc lượt thật hiện nay chỉ suy ra được
  từ event `user` — đúng như `HarnessStepView.tsx:761-767` đang làm để gom bước theo lượt.
- **E2 [after E1]** — Giao diện lọc theo turn hiện tại, mặc định **chỉ turn đang xem**, kèm công tắc
  "tất cả turn"; mỗi hàng con ghim nhãn `turn N · step M` (`SubagentInspectorPanel.tsx:347-380`).
- **E3 [after E1]** — Store giữ mốc turn: hoặc cắt `allEvents` theo `user` event gần nhất, hoặc giữ mảng con
  theo turn; giữ nguyên hàng con khi làm mới (`harnessChatStore.ts:285-338`).
- **E4 [after E2]** — Bấm một hàng con ⇒ nhảy đúng bước cha đã sinh nó — chip con sẵn có nằm ở `HarnessStepView.tsx:1119`
  (`data-timeline="child"`, `onOpenTab('subagents', …)`), nhúng vào `TurnBlock` (`:1209-1292`),
  để "main không track nhầm" như chủ nhà nói.
- **E5 [parallel]** — Tương thích ngược: event cũ không có `turn` ⇒ gán vào turn theo `user` event gần nhất
  đứng trước; test bằng dữ liệu thật của phiên `0ef73471…` (đã chụp trong `/tmp`).
- **E6 [parallel]** — Test vitest: hook chọn con theo turn, ca "turn mới không có con thì bảng rỗng",
  ca "hai turn hai con thì đếm đúng 1 + 1".

### E.2 Nghiệm thu phần E

```bash
cd frontend && npx vitest run src/components/panels/SubagentInspectorPanel   # khớp hai tệp đang có: .stream / .target
# Sống: ba lượt liên tiếp trong một chat — lượt 1 delegate explore, lượt 2 delegate review, lượt 3 hỏi 2+2
# Kỳ vọng (ảnh chụp lại): lượt 3 hiện 0 TOTAL; bật "tất cả turn" hiện 2 TOTAL với nhãn turn 1 / turn 2
```

---

## Kế hoạch F — Năm việc chủ nhà chốt (một chỗ, có khuyến nghị)

| # | Câu hỏi của agent local | Khuyến nghị | Vì sao (đo được) |
|---|---|---|---|
| 1 | `maxSteps` mặc định 16 → **40**? | **Có**, kèm B2–B3: đổi 16 → 40 **và** trả về phần đã làm thay vì `failed` | Việc vừa phải chỉ tốn 8 bước, nhưng việc dài đã đỏ vì trần bước (20 bước ⇒ `failed`; chạy lại 40 bước ⇒ xong ở 27 bước). Nâng trần mà không có partial chỉ đổi chỗ đỏ |
| 2 | Chạy `migrate_plans --apply` trên box sống? `--renumber-lone`, xoá hai plan thử, đổi tên `v4`? | **Có `--apply`, nhưng theo thứ tự an toàn**: sao lưu `sessions.sqlite` + `.plans/` ⇒ `--dry-run` lại ⇒ `--apply`; **giữ** `--renumber-lone`; **chỉ xoá** hai plan thử nếu không `P:` record nào trỏ tới; đổi tên `v4` trong cùng lượt (cùng nhóm identity, RULE-10) | Dry-run đợt 20 đã cho `wrote=0` trên sáu tệp ⇒ chạy thật được; hai plan thử là thứ duy nhất không hoàn tác được |
| 3 | Dải identity mơ hồ `0,5 ≤ j < 0,75`: từ chối một lần hay gộp? | **Từ chối một lần** (như khuyến nghị cũ) | Gộp sai thì kế hoạch cũ bị ghi đè — mất dữ liệu; từ chối sai chỉ tốn một câu hỏi. Luật đánh số đã đổi sang "chỉ tăng trong cùng nhóm identity" (đợt 20) nên đường lùi đã rẻ |
| 4 | Trần độ dài plan: từ chối khi > 150 000 ký tự hay chỉ cảnh báo? | **Hai mức**: cảnh báo ở 60 000, **từ chối** ở 150 000, và khi từ chối thì nói rõ "tách thành A/B" | Đo vòng này: agent phải viết lại plan **5 lần** mới qua cổng P1–P8; plan 4 643 **byte** vẫn sai tên hằng số và bịa `turnId`/`deadlineMs`. Plan dài hơn nữa chỉ làm cổng chậm, không làm plan đúng |
| 5 | Gốc thư mục theo phiên: `.session-history` hay `.sessions/`? | **Giữ `.session-history`** | BOX-1 đã viết cứng khuôn này trong `deploy/docker/session_files.py`; đo lúc này: **15 tệp trên 9 phiên** trong `.session-history` của box và **1 421 hàng `events` / 10 phiên** trong `~/BoxFox/harness/sessions.sqlite` đang trỏ vào khuôn đó — đổi tên là phá đọc, không phải đổi gu |

Ghi chú cho #1: nếu chủ nhà muốn "hơn 40 tuỳ hành vi", thì cần **hai** con số chứ không một —
`maxSteps` (trần) và `softBudget` (mốc xin câu trả lời chốt). B3 chính là chỗ nhận `softBudget`
(mặc định 0,8 × trần), nên "hơn 40" chỉ là tăng trần còn chất lượng lượt giữ nhờ mốc mềm.

---

## Nghiệm thu chung của vòng 21

Chạy trước khi mở PR cho mỗi phần (mỗi mục có lệnh riêng ở trên), cộng ba lệnh dưới đây:

```bash
cd backend && python3 -m pytest tests/unit -q           # toàn bộ unit của harness
cd frontend && npx vitest run                           # toàn bộ unit của giao diện
cd deploy/docker && python3 -m pytest tests -q          # ide-proxy + workspace_files
```

Điều kiện đóng vòng: (1) ảnh `+` hiện đủ bốn mục và mục "Tải lên tệp" không còn bị cắt; (2) lượt gửi kèm tệp
có đường dẫn thật trong event `user` và tệp nằm trong `.uploaded_artifacts`; (3) lượt chạm trần bước/hạn chót
trả `partial` có nội dung, không `failed` trắng; (4) bảng Sub-agents rỗng ở lượt không có con;
(5) lượt sửa code thật có `evidence.verdict=sufficient`; (6) chuỗi test → review → test chạy được trong một lượt.

## Bảng lỗi mới của vòng 21

| Mã | Tên | Đo sống ở đâu | Phần sửa |
|---|---|---|---|
| BUG-39 | Menu `+` có mục trong DOM nhưng bị `overflow-hidden` cắt ⇒ người dùng thấy "chưa có upload" | `r21_local_02_menu_clipped.png`; hit-test tâm mục trả về khung chat | A1 |
| BUG-40 | Nội dung tệp đính kèm không đi tới agent; chỉ còn tên trong `[Attached Files: …]`; `.uploaded_artifacts` rỗng | event `user` phiên `0ef73471…`; `docker exec … ls .uploaded_artifacts` | A2–A6 |
| BUG-41 | `TURN_EMPTY_RESPONSE` đánh `failed` cả lượt dù model đã làm việc, không thử lại, không trả phần đã làm | phiên `0ef73471…`, 5 bước, thought có, text không | B6 |
| BUG-42 | Con chạm `DEADLINE` (10 bước/120 s) ⇒ `answerChars = 0`, mất cả 9 bước; cha chỉ nhận `status=failed` | phiên con `ea948649…`, 33 tool call | B2–B4 |
| BUG-43 | Bảng Sub-agents không theo turn: con của turn 2 hiện ở turn 3 | `r21_perTurn_03_turn3_with_stale_child.png`; `SubagentInspectorPanel.tsx:162-196`, `harnessChatStore.ts:294` | E1–E3 |

Danh tính lỗi đi theo RULE-20 (mã HOA, số không zero-pad, bộ đếm chạy tiếp) — bản đầy đủ nằm ở
`docs/tracking/bug-register.md` § 6.22.
