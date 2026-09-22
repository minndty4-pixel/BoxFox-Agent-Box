# Kế hoạch đợt "foundation" — năm quyết định của chủ nhà, ngân sách bước, và đường ống tệp đính kèm (2026-09-22)

> Đây là bản **để thi công**: mỗi việc có mã, tệp + dòng cụ thể, thay đổi cụ thể, rủi ro, và một lệnh/test
> kiểm chứng chạy được. Bản phác cùng nội dung nằm ở `docs/plan/v21-boxfox-plan.md` Phần A/B/F — kế hoạch này
> **thay thế** phần phác đó bằng số liệu đã đối chiếu lại với code.
>
> Nguồn sự thật: `docs/tracking/owner-decisions.md` (D-1…D-10, chốt 2026-09-22, chủ nhà Nam Nam),
> `docs/tracking/bug-register.md` § 6.22 (BUG-39…BUG-43), `docs/tracking/test-rounds.md` § *Vòng 21* (số đo sống),
> ảnh `/code/.generated_artifacts/images/r21_*.png`.
>
> Phần C của bản phác (sub-agent nhìn thấy nhau, BUG-43) **không** nằm trong đợt này — đó là đợt kế tiếp.

## 0. Phạm vi, luật bất biến, và thứ tự thi công

### 0.1 Sáu việc của đợt này

| Mã | Việc | Nguồn | Giai đoạn |
|---|---|---|---|
| D-1 | `maxSteps` 16 → 40; tách `STEP_BUDGET_EXHAUSTED` / `DEADLINE_EXCEEDED`; hết bước/hạn chót **chẩn đoán chỗ tắc** rồi trả `partial` có nội dung; con **40 bước / 300 s** (chủ nhà chốt 2026-09-22, xem § 0.5); `TURN_EMPTY_RESPONSE` thử lại một lần; ghi `stepsUsed`/`deadlineUsedMs` | `owner-decisions.md` D-1 + § 0.5 | 2 |
| D-2 | `migrate_plans.py`: sao lưu trước `--apply`, giữ `--renumber-lone`, chỉ xoá kế hoạch thử khi **không** bản ghi `P:` nào trỏ tới | D-2 | 3 |
| D-3 | Chống kế hoạch trùng: từ chối **một lần** ở dải jaccard 0,5–0,75 | D-3 | 3 |
| D-4 | Trần độ dài **câu trả lời**: cảnh báo 60 000 ký tự, từ chối 150 000 ký tự | D-4 | 4 |
| D-5 | Giữ `.session-history` trong box | D-5 | 3 |
| D-6 | Nội dung tệp đính kèm phải tới box + menu `+` phải bấm được (BUG-39, BUG-40) | D-6 | 1 |

### 0.2 Ba luật bất biến (áp cho mọi việc dưới đây)

1. **Không thêm giá trị `status` mới** cho phiên. Luồng đang lọc `running` / `awaiting_decision`
   (`runtime.py:1147`, `runtime_commands.py:29-31`) và giao diện ánh xạ giá trị lạ thành `failed`
   (`frontend/src/components/panels/SubagentInspectorPanel.tsx:170`). Mọi trạng thái "chưa xong" đi qua
   `partial` + một bản ghi bền (`notice` / `blocker` / hàng `X:` trong journal).
2. **Thay đổi schema chỉ ghi thêm cột** qua `_add_missing_columns()`
   (`backend/src/agentbox/memory/session_store.py:67-86`).
3. **Mọi hành vi mới phải đo được**: một dòng `system_log` và/hoặc một trường trong `turn_end`, nếu không thì
   vòng sau lại phải đoán (xem B9, D2).

### 0.3 Bảy chỗ kế hoạch này **cố ý** khác bản phác vòng 21 (vì code đã kiểm lại)

| # | Bản phác | Thực tế trong code | Kế hoạch làm |
|---|---|---|---|
| 1 | "chưa có bộ đếm RULE-5" → đề xuất tệp `.counter` | `list_directory` liệt kê cả tệp ẩn; `deploy/docker/tests/test_workspace_files.py:103` **khoá** hành vi đó (`.env` phải hiện) | Cấp số bằng `max(số đang có) + 1` + giữ chỗ bằng `O_CREAT\|O_EXCL` (A3). Không thêm tệp trạng thái, không đổi `list_directory` |
| 2 | D-4 đọc như "trần độ dài **plan**", và `plan_eval.py` đang cảnh báo ở 40 000 | `owner-decisions.md` D-4 ghi rõ "giới hạn độ dài **câu trả lời**"; `plan_eval.py:72-75` (`PLAN_WARN_CHARS = 40_000`, `PLAN_MAX_CHARS = 150_000`) đã chạy | Ngưỡng **plan giữ nguyên**; 60 000 / 150 000 áp cho **câu trả lời** (Phần D) |
| 3 | Con 40 bước / 300 s | `limits.py:20-21` là `CHILD_MAX_STEPS = 10`, `CHILD_DEADLINE_SECONDS = 120` | Con **40 bước / 300 s** — **chủ nhà đã chốt** ngày 2026-09-22 (§ 0.5); vẫn bị `min()` kẹp theo cấu hình cha (`runtime.py:2504-2511`) |
| 4 | "thêm `turnId`/`deadlineMs`" | `turn_id` trong `system_log` chính là **số bước** (`runtime.py:1748`); `turn_end` chưa có số luỹ kế | Ghi `stepsUsed` / `deadlineUsedMs` (tên mới, không đụng `turn_id` cũ) — B9 |
| 5 | `AttachmentPicker` "đã có test" | **Chưa có tệp test nào** cho component này | A1/A2/A9 viết `frontend/src/components/chat/AttachmentPicker.test.tsx` từ đầu |
| 6 | `migrate_plans.py` "chỉ còn bật `--apply`" | Script **không có** bước sao lưu và **không có** đường xoá nào | C1 (sao lưu) + C2 (`--delete-orphan` có cổng `P:`) là việc **mới**, và C3 mới stage được vào box (`Dockerfile` không COPY tệp này) |
| 7 | Ảnh: "gửi tất cả ảnh" | `api/server.py:150` đặt `client_max_size = 1048576` (1 MiB) cho **cả** request turn | Ảnh inline vẫn ≤ 700 000 ký tự **mỗi ảnh**, thêm trần **tổng 800 000 ký tự** cho cả lượt (A7) |

### 0.4 Thứ tự thi công (năm giai đoạn)

| Giai đoạn | Việc | Vì sao thứ tự này |
|---|---|---|
| **1** | A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 (A11 song song ngay; A9 song song sau A2) | Sửa gốc cái menu trước (A1), rồi mới nối đường ống; số RULE-5 phải ở box (A3) trước khi giao diện gọi (A4–A6) |
| **2** | B1 → B2 → B7 → B3 → B4 → B5 → B10 → B6 → B8 (song song: B9) | Đổi hằng số + tách mã (B1–B2) trước, rồi mới đổi đường ra của lượt (B3–B4), truyền lên cha (B5), dựng hợp đồng chẩn đoán của con (B10), rồi mới nới ngân sách con + prompt (B6) |
| **3** | C1 → C2 → C3 (song song: C4, C5) | Migration chạy trên bản sao trước, box sống sau |
| **4** | D1 → D2 | Ngưỡng + cổng đo trên đường câu trả lời |
| **5** | E1 → E2 → E3 → E4 | Ba bộ test, một lượt thử sống qua `localhost:3100`, rồi ghi sổ |

Tổng: **11 + 10 + 5 + 2 + 5 = 33 việc**, trong đó **8 việc** chạy song song được (A1, A11, B1, B9, C1, C4, C5, D1).

### 0.5 Chủ nhà đã chốt hai điều (2026-09-22, ghi vào `owner-decisions.md` ở E4)

1. **Ngân sách phiên con: 40 bước / 300 s** (không phải 24/240 như bản nháp đầu). ⇒ `limits.py:20-21` thành
   `CHILD_MAX_STEPS = 40`, `CHILD_DEADLINE_SECONDS = 300` (B1, B6). Phiên chính giữ nguyên như D-1: mặc định **40**,
   trần **60**, hạn chót mặc định **180 s**, trần **600 s**. Con vẫn bị `min()` kẹp theo cấu hình cha
   (`runtime.py:2504-2511`), nên `300 s` là **trần**, không phải bảo đảm: với cấu hình cha mặc định (180 s) con nhận 180 s.
2. **Chạm trần bước hoặc hạn chót thì phải chẩn đoán chỗ tắc, không được kết thúc trắng.** Trước khi trả `partial`,
   lượt (cha **hoặc** con) phải: đọc lại trạng thái hiện tại (tệp đã sửa, kết quả lệnh cuối, việc còn dở), và nếu đường
   đã đi là sai thì **làm đúng một lần**; sau đó trả `partial` kèm **chẩn đoán ngắn** bốn phần: đã làm gì / tắc ở đâu /
   còn lại gì / thử gì tiếp. Có **trần cứng**: giữ chỗ `WRAP_UP_STEPS_RESERVED = 3` bước cho việc chẩn đoán, và **một**
   lời gọi chốt có trần (tools-off, `WRAP_UP_MAX_TOKENS`, `WRAP_UP_TIMEOUT_SECONDS`, trong hạn chót còn lại) — việc này
   là **B10** dưới đây; con chạm trần phải trả chẩn đoán đó cho cha (B5), và **ca nghiệm thu bắt buộc** là: một phiên con
   dùng hết ngân sách **không** còn trả `failed` trắng mà trả `partial` + `answerChars > 0` + chẩn đoán 4 phần (E1 ca (f)).

Ghi vào `docs/tracking/owner-decisions.md` ở E4: cập nhật hàng **D-1** (số của con 40/300) và thêm **một hàng mới**
cho yêu cầu chẩn đoán chỗ tắc (ngày 2026-09-22, chủ nhà Nam Nam), **không** xoá hàng cũ.

---

## Phần A — Nội dung tệp đính kèm phải đi tới box (D-6, BUG-39, BUG-40)

### A.0 Hiện trạng, đã kiểm lại bằng code và bằng máy sống (2026-09-22)

Ba chặng đứt, cả ba đo được:

1. **Menu bị cắt.** Mục "Tải lên tệp tin" có trong DOM (`itemRect [290,642,226,45]`) nhưng
   `document.elementFromPoint` tại tâm trả về khung chat. Tổ tiên cắt là hàng công cụ
   `flex min-w-0 items-center gap-1.5 overflow-hidden` (`frontend/src/components/panels/ChatInputBar.tsx:268`),
   popover lại đặt `absolute bottom-full left-0 mb-2 w-60 … z-50`
   (`frontend/src/components/chat/AttachmentPicker.tsx:159`) ⇒ gốc là **clipping**, không phải `z-index`.
   `HarnessModelPicker` ngay cạnh đó **không** dính lỗi vì nó render qua portal
   (`frontend/src/components/chat/HarnessModelPicker.tsx:187-197` ngoài-click, `:199-217` tính vị trí,
   `:259-263` `createPortal`). **Đây là mẫu để copy.**
2. **Nội dung không đi.** Chỉ ảnh được đọc bằng `FileReader.readAsDataURL` vào `dataUrl`
   (`AttachmentPicker.tsx:56-68`); tệp thường chỉ giữ `{id, name, size, source: 'computer', isFolderItem}`
   (`:69-77`) — **không** giữ đối tượng `File` (kiểu ở `:11-18` không có trường `file`). Lúc gửi,
   `ChatInputBar.tsx:113-115` dựng chuỗi `` `[Attached Files: ${names.join(', ')}]` ``, và chỉ ảnh **đầu tiên**
   được gửi (`:116` `attachments.find(...)`).
   Đo sống: event `user` của phiên `0ef73471c38d4c63a593755345213dcf` chỉ có tên tệp.
3. **Không có gì trong box.** Kiểm lại hôm nay: `docker exec agentbox-box ls -la /home/agent/workspace/.uploaded_artifacts`
   → chỉ có `.` và `..` (chủ `agent:agent`, mode `drwxr-x---`).

Đường ống **đã có sẵn**, chỉ thiếu người gọi và bộ cấp số:

| Mảnh | Ở đâu | Trạng thái |
|---|---|---|
| Nhận tệp phía box | `deploy/docker/ide-proxy.py:540-568` `POST /__box/file/upload?path=&name=` | chạy; gate `X-BoxFox-Api-Key`; đọc **thân thô** 64 KiB mỗi lần, **không** multipart |
| Hàm ghi | `deploy/docker/workspace_files.py:743-754` → `:698-741` | chạy; `dir_fd` + `O_NOFOLLOW`, `fchown(1000,1000)`, `fchmod(0o640)`, trần `MAX_UPLOAD_SIZE = 256 MiB` (`:47`) |
| Client | `frontend/src/lib/workspace/http.ts:70-87` `upload(targetDir, filename, body)` | chạy; khoá + `application/octet-stream`; đã có test `http.test.ts:53-65` |
| Người gọi đang có | `frontend/src/hooks/useWorkspaceFiles.ts:473` | panel Workspace Files — **đúng đường này**, chỉ thiếu ô soạn tin |
| Thư mục đích | `deploy/docker/box-entrypoint.sh:15-24` | `.uploaded_artifacts` mode `0750`, chủ `1000:1000` |
| Luật tên RULE-5 | `docs/naming.md:24` `.uploaded_artifacts/<số>.<ext>`, không zero-pad, đơn điệu tăng | **chưa có code nào cấp số** |
| Quyền xoá | `workspace_files.py:72` `PROTECTED_PATHS` | `.uploaded_artifacts` **chưa** được bảo vệ (`.plans`, `.session-history`, `.generated_artifacts`, `.trash` thì có) |
| Ghi nhiều luồng | `deploy/docker/ide-proxy.py:73-74` `ThreadingHTTPServer` | hai lần upload chạy song song được ⇒ bộ cấp số phải nguyên tử |
| Tạo thư mục con | `workspace_files.py:1182` `_ensure_dirs()` (đang dùng cho `extract_zip`), `:816` `make_directory()` | có sẵn; `_open_dir_fd` (`:257-269`) **không** tự tạo thư mục |

Ràng buộc phía model: ảnh phải là data URL `data:image/png|jpeg|webp;base64,` và ≤ 700 000 ký tự
(`backend/src/agentbox/agent_core/runtime.py:1177-1178`); `MAX_INLINE_MEDIA = 2` / `MAX_INLINE_MEDIA_BYTES = 512 KiB`
(`runtime.py:137-138`); thân request turn bị chặn 1 MiB (`backend/src/agentbox/api/server.py:150`
`client_max_size=1048576`); `file_read` chỉ đọc text và cắt 30 000 ký tự
(`backend/src/agentbox/sandbox/worker.py:343-344`) ⇒ **PNG/PDF đọc thẳng sẽ `UnicodeDecodeError`**.

### A.1 Việc

**A1 [parallel] — Popover `+` render qua portal (BUG-39)**

- **Mục tiêu:** mục menu bấm được (hit-test thật), không dùng `z-index` để chữa.
- **Tệp:** `frontend/src/components/chat/AttachmentPicker.tsx:106-160` (khối `return`, popover `:158-233`);
  mẫu copy: `frontend/src/components/chat/HarnessModelPicker.tsx:10` (`import { createPortal }`), `:187-197`, `:199-217`, `:259-263`.
  Đồng thời `frontend/src/components/chat/RepoPicker.tsx:100` (cùng hàng công cụ, cùng lỗi tiềm ẩn).
- **Việc:** bọc popover trong `createPortal(<div className="fixed z-50 …">, document.body)`; tính vị trí từ
  `triggerRef.current.getBoundingClientRect()` và kẹp vào `window.innerWidth/innerHeight`; gắn listener `resize`/`scroll`;
  ngoài-click phải kiểm **cả** `triggerRef` và `panelRef` (nút `+` là trigger, panel nằm ngoài cây DOM của nút);
  giữ nguyên `Escape` để đóng. **Không** sửa hàng công cụ `ChatInputBar.tsx:264-268` (ý định bỏ `flex-wrap` để Mic/Send
  không rớt dòng vẫn đúng, chỉ có hệ quả `overflow-hidden` là phải né).
- **Rủi ro:** panel rộng 240 px (`w-60`) có thể tràn mép ở cột chat hẹp → vị trí phải kẹp hai chiều;
  hai popover trong cùng hàng (Attachment, Repo) phải đóng cái kia khi mở? Không bắt buộc — ngoài-click đã lo.
- **Nghiệm thu:** tệp test mới `frontend/src/components/chat/AttachmentPicker.test.tsx`: render trong một tổ tiên
  `overflow-hidden` (dựng lại đúng ca sống), click nút `+`, rồi với **từng** mục trong bốn mục:
  `const r = item.getBoundingClientRect(); document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)` phải là chính mục đó
  hoặc con của nó; thêm ca `Escape` và ngoài-click.

**A2 [after A1] — Giữ đối tượng `File`, đường dẫn tương đối, trần phía client**

- **Mục tiêu:** trình duyệt còn giữ tệp thật để gửi đi; thư mục không bị làm phẳng; tệp quá lớn bị chặn trước khi gửi.
- **Tệp:** `frontend/src/components/chat/AttachmentPicker.tsx:11-18` (kiểu `AttachedFile`), `:52-79` (`handleFiles`),
  `:109-141` (ba input ẩn), `frontend/src/components/panels/ChatInputBar.tsx:62` (state), `:179-211` (hàng chip).
- **Việc:**
  1. `AttachedFile` thêm `file?: File`, `relativePath?: string`, `sizeBytes?: number`; **bỏ** `isFolderItem`
     (đang được `:65`, `:75` đặt nhưng không nơi nào đọc).
  2. `handleFiles` giữ nguyên `file` cho **mọi** tệp; `relativePath` lấy từ
     `(file as File & { webkitRelativePath?: string }).webkitRelativePath` khi chọn thư mục, và `undefined` khi chọn tệp.
  3. Trần phía client: **25 MiB/tệp**, **20 tệp/lượt**, **100 MiB/lượt**; vượt thì không thêm chip, hiện dòng lỗi
     trong popover (state `error` hiện ở `:160-166`).
  4. Ba input ẩn thêm `data-testid="attach-image-input"` / `"attach-file-input"` / `"attach-folder-input"` —
     để test và bài thử sống chọn đúng input (input đang `className="hidden"`, Playwright vẫn set được files).
  5. Hàng chip (`ChatInputBar.tsx:179-211`) hiện thêm kích thước (`file.size`) và tên đường dẫn rút gọn khi là thư mục.
- **Rủi ro:** `isFolderItem` bị xoá là thay đổi kiểu đã export — grep cho thấy không consumer nào đọc (chỉ `:65`, `:75`);
  `ChatInputBar` là consumer duy nhất.
- **Nghiệm thu:** trong `AttachmentPicker.test.tsx`: chọn 1 tệp → chip có `file instanceof File` và `sizeBytes`;
  chọn thư mục giả (`userEvent.upload` với `webkitRelativePath`) → `relativePath === 'proj/src/a.ts'`;
  tệp 26 MiB (khai bằng `new File([new Uint8Array(26*1024*1024)], …)`) → không có chip, có dòng lỗi.

**A3 [after A2] — Box cấp số RULE-5 và tạo thư mục con (quyết định D-6)**

- **Mục tiêu:** số tệp do **box** cấp (không do trình duyệt), hai tab gửi cùng lúc không đè nhau; thư mục giữ được cây.
- **Tệp:** `deploy/docker/workspace_files.py:698-741` (`write_as_agent`), `:743-754` (`write_upload`),
  `:72` (`PROTECTED_PATHS`), `:1182` (`_ensure_dirs`); `deploy/docker/ide-proxy.py:540-568` (route upload);
  `deploy/docker/tests/test_workspace_files.py`, `deploy/docker/tests/test_ide_proxy_workspace.py:178-224`.
- **Việc:**
  1. Tách thân ghi của `write_as_agent` thành `_write_fd(fd, data_or_iter, max_bytes)` (giữ nguyên
     `fchown 1000:1000` + `fchmod 0o640` + trần `max_bytes`), để nhánh cấp số mở fd riêng rồi dùng lại đúng thân đó.
  2. `write_upload(target_dir_rel, filename, body_iter, size_hint, *, assign_number=False, mkdirs=False, max_bytes=UPLOAD_MAX_BYTES)`:
     - `assign_number=True`: lấy `ext` từ `ext_of(filename)`; vòng lặp chọn `n = max(số nguyên trong thư mục đích) + 1`
       rồi `os.open(f'{n}{ext}', O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, dir_fd=…)`; gặp `FileExistsError` thì tăng và thử lại
       (tối đa 200 lần) ⇒ **giữ chỗ nguyên tử**, an toàn với `ThreadingHTTPServer`; không zero-pad (RULE-5).
     - `mkdirs=True`: gọi `_ensure_dirs(target_dir, split_segments(target_dir))` trước khi mở thư mục.
     - Trả `{"path": joined, "name": name, "sizeBytes": written}` (`name` luôn có, kể cả khi không cấp số).
  3. `UPLOAD_MAX_BYTES = 25 * 1024 * 1024` trong `workspace_files.py`; route truyền `max_bytes=UPLOAD_MAX_BYTES`
     (thay trần 256 MiB cho đường composer, panel Workspace Files vẫn đi cùng route nên nhận cùng trần — ghi rõ
     trong `docs/architecture/workspace-files.md`).
  4. Route đọc thêm hai tham số `assign` / `mkdirs` (`'1'`, `'true'` đều nhận) và trả `name`.
  5. Thêm `.uploaded_artifacts` vào `PROTECTED_PATHS` (`:72`) — hôm nay panel có thể xoá cả gốc upload.
- **Rủi ro:** `O_EXCL` cần `dir_fd` đã mở (đúng như luồng hiện tại); trần 25 MiB làm panel không còn upload được tệp
  lớn như trước — **cố ý** (D-6 yêu cầu trần), phải ghi vào docs để không ai tưởng là hồi quy.
- **Nghiệm thu:** `deploy/docker/tests/test_workspace_files.py` thêm ca: cấp số liên tiếp ra `1.md`, `2.md`;
  hai lời gọi song song (`ThreadPoolExecutor`) không bao giờ trả cùng số; tệp 26 MiB → `WorkspaceTooLarge` (413);
  `mkdirs` tạo `.uploaded_artifacts/proj/src`. `deploy/docker/tests/test_ide_proxy_workspace.py:178-224` thêm ca
  `?path=.uploaded_artifacts&name=notes.md&assign=1` → `200` + `{"path": ".uploaded_artifacts/1.md", "name": "1.md"}`
  và tệp có chủ `AGENT_UID/AGENT_GID`, mode `0o640`.

**A4 [after A3] — Client gọi được đường cấp số**

- **Tệp:** `frontend/src/lib/workspace/types.ts:87-97`, `frontend/src/lib/workspace/http.ts:70-87`,
  `frontend/src/lib/workspace/mock.ts:98-100`, `frontend/src/lib/workspace/http.test.ts:53-65`.
- **Việc:** `upload(targetDir, filename, body, options?: { assignNumber?: boolean; mkdirs?: boolean; signal?: AbortSignal })`
  → thêm `&assign=1` / `&mkdirs=1` vào query khi bật; kiểu trả về thêm `name?: string`.
  `MockWorkspaceRepository.upload` đếm số trong bộ nhớ khi `assignNumber` và trả `{path, name, sizeBytes: body.size}`.
  **Giữ nguyên** hành vi mặc định để `http.test.ts:53-65` (URL `?path=up&name=x.txt`, hai header, thân truyền nguyên)
  vẫn xanh.
- **Rủi ro:** `useWorkspaceFiles.upload` (`:473`) không truyền options ⇒ hành vi panel không đổi — đúng ý.
- **Nghiệm thu:** `npx vitest run src/lib/workspace` xanh; thêm ca mới khẳng định URL có `assign=1` + `mkdirs=1`
  và payload trả về có `name`.

**A5 [after A4] — Hàm upload cho ô soạn tin**

- **Tệp mới:** `frontend/src/lib/chat/attachmentUpload.ts` (+ `attachmentUpload.test.ts`).
- **Việc:** `uploadAttachments(files: AttachedFile[], deps: { repo: WorkspaceRepository; targetDir?: string; onProgress?: (done, total) => void }): Promise<OutgoingAttachment[]>`
  - `OutgoingAttachment = { name: string; path: string; absolutePath: string; sizeBytes: number; kind: 'file' | 'folder-item' }`;
  - tuần tự từng tệp (không song song: thứ tự số phải theo thứ tự người dùng thấy), mỗi tệp gọi
    `repo.upload(dir, file.name, file, { assignNumber: true, mkdirs: Boolean(relativePath) })`;
  - `relativePath` ⇒ `targetDir` là `<dir>/<thư mục cha của relativePath>`;
  - `absolutePath = '/home/agent/workspace/' + path` (dạng tuyệt đối để agent `file_read` thẳng);
  - một tệp lỗi ⇒ **dừng cả lượt** và ném lỗi kèm tên tệp (không gửi lượt nửa vời).
- **Rủi ro:** đường dẫn tuyệt đối hard-code `/home/agent/workspace` — lấy từ hằng số đã có
  (`frontend/src/lib/boxApi.ts` cùng tầng cấu hình) thay vì rải chuỗi trong component.
- **Nghiệm thu:** `attachmentUpload.test.ts` với repo giả: 2 tệp + 1 tệp trong thư mục ⇒ 3 lời gọi, đúng thứ tự,
  `absolutePath` đúng; ca repo ném lỗi ⇒ hàm ném và **không** trả mảng một phần.

**A6 [after A5] — Nối vào đường gửi (bỏ chuỗi `[Attached Files: …]`)**

- **Tệp:** `frontend/src/components/panels/ChatInputBar.tsx:42` (kiểu adapter), `:109-141` (`handleSend`), `:116`,
  `:113-115`, `:167`; `frontend/src/components/panels/ChatPanel.tsx:378-410` (adapter `onSend`);
  `frontend/src/store/harnessChatStore.ts:69` (kiểu `send`), `:385` (thân), `:480-481` (`submitTurn`);
  `frontend/src/components/panels/ChatInputBar.controlSend.test.tsx:142`.
- **Việc:**
  1. Adapter: `onSend: (prompt: string, images?: string[] | null, attachments?: OutgoingAttachment[]) => void | Promise<boolean>`
     (thay tham số `image` đơn).
  2. `handleSend` thành `async`: gọi `uploadAttachments(...)` **trước** khi gửi; trong lúc chờ, nút Gửi chuyển sang
     trạng thái "đang tải"; lỗi ⇒ chip đỏ + giữ nguyên bản nháp (dùng lại `restoreDraft` ở `:135-141`);
     text gửi đi = đúng những gì người dùng gõ (**không** còn chuỗi `[Attached Files: …]`);
     `images` = **tất cả** ảnh có `dataUrl`, cắt còn 2 ảnh đầu và tổng ≤ 800 000 ký tự.
  3. `ChatPanel` truyền tiếp `attachments`; `harnessSend`→`store.send` nhận thêm tham số; `submitTurn` gửi
     `{ prompt, image: images?.[0], images, attachments, route, invocationId }` (giữ `image` để tương thích
     với harness cũ trong lúc triển khai).
  4. Đường router (`routerSend(prompt, undefined, image)`) giữ một ảnh: `images?.[0]` — router chat chưa có hợp đồng nhiều ảnh.
- **Rủi ro:** `handleSend` giờ bất đồng bộ ⇒ phải chặn gửi hai lần (dùng state đang-gửi); test cũ
  `ChatInputBar.controlSend.test.tsx:142` khẳng định **đúng hai** tham số ⇒ cập nhật thành
  `toHaveBeenCalledWith('/skill', undefined, undefined)` (thay đổi có ý thức, ghi vào phần D-6 của sổ).
- **Nghiệm thu:** `npx vitest run src/components/panels/ChatInputBar src/components/panels/ChatPanel` xanh;
  thêm ca mới: chọn 1 tệp giả → `onSend` nhận `attachments[0].absolutePath` và text không chứa `[Attached Files`;
  ca repo lỗi → `onSend` **không** được gọi và ô nhập giữ nguyên nội dung.

**A7 [after A6] — Harness nhận `attachments` + nhiều ảnh**

- **Tệp:** `backend/src/agentbox/skills/runtime_commands.py:13-25` (`submit` + idempotency), `:117-131` (nhánh message/command),
  `backend/src/agentbox/agent_core/runtime.py:1145` (`start`), `:1177-1178` (guard ảnh), `:1190-1193` (content + `user`),
  `backend/src/agentbox/api/server.py:301` (route `turns`).
- **Việc:**
  1. `submit(sid, prompt, image=None, route=None, invocation_id=None, attachments=None)`; đưa `attachments` **vào**
     khoá idempotency (`request = json.dumps([prompt, image, route, attachments], sort_keys=True)`, `:20`) — nếu không,
     lần thử lại của cùng `invocationId` với tệp khác sẽ trả kết quả cũ.
  2. `start(..., images=None, attachments=None)`: chuẩn hoá `images = [i for i in (images or []) if i]` (nếu có `image` đơn
     thì gộp vào); kiểm **từng** ảnh bằng đúng luật cũ (`data:image/png|jpeg|webp;base64,`, ≤ 700 000 ký tự),
     ≤ `MAX_INLINE_MEDIA` (2) và tổng ≤ `INLINE_IMAGE_CHARS_TOTAL = 800_000` (mới, vì `client_max_size = 1048576` ở
     `api/server.py:150`); `content` = text + N khối `image_url` (`:1190`).
  3. `_validate_attachments(rows)` mới trong `runtime.py`: tối đa 25 mục; `path` (tương đối) phải khớp
     `validate_rel_path`-style (không `..`, không tuyệt đối, không NUL); `name` ≤ 200 ký tự; `sizeBytes` số ≥ 0;
     sai ⇒ `ValueError('ATTACHMENTS_INVALID: …')` → 400 (middleware `api/server.py:142-143`).
  4. Event `user` (`:1193`) mang thêm `attachments` và `images`; prompt gửi model có thêm khối do **harness** dựng
     (một nguồn duy nhất): hàm thuần `attachment_prompt_block(attachments)` trong `agent_core` trả
     `[Tệp đính kèm đã lưu trong box]\n- /home/agent/workspace/.uploaded_artifacts/7.md (báo cáo.md, 12 KB)\n…`
     và được nối vào `content`/`prompt` ở `:1190` cùng nhánh command `runtime_commands.py:129-130`.
- **Rủi ro:** nhồi đường dẫn vào prompt làm tăng ngữ cảnh (25 tệp × ~80 ký tự ≈ 2 000 ký tự — chấp nhận được);
  nhánh command (`:129`) cũng phải dựng khối, nếu quên thì skill-path mất đường dẫn.
- **Nghiệm thu:** `backend/tests/unit/test_turn_attachments.py` (mới, dùng `FixtureModel`/`FixtureExecutor` như
  `test_limits_turn`): (a) `POST /turns` với 2 attachments ⇒ event `user` có đúng 2 mục + text gửi model chứa
  cả hai đường dẫn tuyệt đối; (b) 3 ảnh ⇒ 400 `IMAGE_LIMIT`; (c) `path: '../../etc/passwd'` ⇒ 400 `ATTACHMENTS_INVALID`;
  (d) gửi hai lần cùng `invocationId` với attachments khác nhau ⇒ `INVOCATION_CONFLICT`.
  `backend/tests/unit/test_inline_media_bound.py` thêm ca tổng > 800 000 ký tự.

**A8 [after A7] — Đọc được tệp nhị phân**

- **Mục tiêu:** agent không chết `UnicodeDecodeError` khi `file_read` một `.png`/`.pdf` vừa tải lên.
- **Tệp:** `backend/src/agentbox/sandbox/worker.py:343-344` (`file_read`), `:79` (`PLAN_MAX_BYTES` là mẫu trần),
  `backend/tests/unit/test_file_tools.py`.
- **Việc:** trong `file_read`, phát hiện nhị phân (đuôi trong danh sách ảnh/pdf/zip **hoặc** 8 KiB đầu có byte `\x00`)
  ⇒ trả `{'content': base64[:30000], 'encoding': 'base64', 'truncated': True, 'bytesRead': n}`; nhánh text giữ nguyên.
  Không thêm op mới (worker đang có `SESSION_OPS` cố định ở `:313`).
- **Rủi ro:** base64 dài gấp 4/3; trần 30 000 ký tự cũ vẫn áp, cộng cảnh báo `truncated` để model biết.
- **Nghiệm thu:** `python3 -m pytest backend/tests/unit -q -k file_tools` xanh + ca mới: fixture PNG 1 KiB ⇒ không ném,
  `encoding == 'base64'`; fixture `.md` ⇒ `encoding` vắng mặt, nội dung nguyên.

**A9 [after A2] — Thư mục và Google Drive nói thật**

- **Tệp:** `frontend/src/components/chat/AttachmentPicker.tsx:96-104` (`handleGoogleDrive`), `:130-141` (input thư mục),
  `:158-233` (danh sách mục); `docs/architecture/workspace-files.md` (ghi chú).
- **Việc:** (a) mục Google Drive **không còn** tạo tệp giả `Architecture_Blueprint_2026.gdoc` — hoặc bỏ khỏi menu,
  hoặc render `disabled` + dòng chữ "chưa kết nối" (không có chip nào được thêm); (b) `relativePath` từ A2 được
  dùng để giữ cây thư mục (A5/A3 đã lo phần ghi); (c) nhãn chip nói rõ tệp thuộc thư mục nào khi có `relativePath`.
- **Rủi ro:** người dùng đang mong Drive hoạt động — giữ dòng chữ giải thích thay vì im lặng bỏ mục.
- **Nghiệm thu:** `AttachmentPicker.test.tsx`: click "Google Drive" ⇒ **không** có `onAttach` nào được gọi;
  HTML có chữ "chưa kết nối".

**A10 [after A7] — Giao diện hiện chip tệp đính kèm trên bong bóng người dùng**

- **Tệp:** `frontend/src/components/chat/HarnessStepView.tsx:979` (`data.image`), `:1001-1012` (render ảnh + lightbox),
  `:1015` (markdown của `data.text`) + tệp test `HarnessStepView.{chips,media}.test.tsx`.
- **Việc:** đọc `(turn.userEvent?.data?.images as string[] | undefined) ?? (turn.userEvent?.data?.image ? [turn.userEvent.data.image] : [])`
  (giữ tương thích event cũ), render N ảnh; thêm hàng chip cho `data.attachments`
  (`{name, path, sizeBytes}` — hiện tên + kích thước, `title` là đường dẫn tuyệt đối).
- **Rủi ro:** event cũ không có `images`/`attachments` phải render y như trước (không có chip).
- **Nghiệm thu:** `npx vitest run src/components/chat/HarnessStepView` xanh; ca mới: event `user` có 2 attachment
  ⇒ 2 chip; event cũ chỉ có `image` ⇒ 1 ảnh, không chip lạ.

**A11 [parallel] — Retention cho `.uploaded_artifacts` (D-6)**

- **Tệp mới:** `deploy/docker/upload_files.py` (+ `deploy/docker/tests/test_upload_files.py`); sửa
  `deploy/docker/session_ops.py:208-251` (`op_captures_prune` → thêm `op_uploads_prune`), `deploy/docker/session_files.py:88-93` + `:837-893`
  (mẫu để copy: `CAPTURE_KEEP_PER_KIND`, `retention(root, *, session, protect, dry_run)`), `deploy/docker/Dockerfile:294-296` (COPY),
  `deploy/docker/smoke-test.sh:150-153` (kiểm staged), `backend/src/agentbox/sandbox/worker.py:313` (`SESSION_OPS`).
- **Việc:** `upload_files.retention(root, *, dry_run=False, protect=())` giữ **200 tệp / 500 MiB**, xoá theo mtime cũ nhất
  trước, trả `{removed, kept, freedBytes, dryRun}`; `upload_files.prune(...)` ghim **một** hàng `X:` vào journal phiên
  gọi nó (y như `op_captures_prune` đang làm) và **luôn** giữ lại số cao nhất (tệp mới nhất) để bộ đếm A3 còn mốc.
- **Rủi ro:** đây là đường **duy nhất** được xoá tệp; phải có `dry_run` và test khẳng định `dry_run` không xoá byte nào
  (`unlink` chỉ nằm trong `prune`, `giống luật "no unlink outside retention"` của `session_files.retention`).
- **Nghiệm thu:** `cd deploy/docker && python3 -m pytest tests/test_upload_files.py -q` xanh (giữ trần, xoá cũ trước,
  tệp mới nhất không bao giờ bị xoá, `dry_run` không đổi gì, đúng một hàng `X:`).

### A.2 Nghiệm thu phần A

```bash
# 1. Menu không còn bị cắt — hit-test là tiêu chí, không phải ảnh
agent-browser --session foundation open http://localhost:3100
agent-browser --session foundation click 'button[title="Thêm đính kèm / Tệp tin / Hình ảnh"]'
agent-browser --session foundation eval '(()=>{const b=[...document.querySelectorAll("button")].find(x=>/Tải lên tệp/.test(x.textContent));const r=b.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return t===b||b.contains(t)})()'
#   → phải là true

# 2. Nội dung tới box — endpoint đọc THÂN THÔ, không phải multipart
printf 'foundation-probe-%s\n' "$(date -u +%s)" > /var/tmp/probe-upload.txt
curl -s -X POST -H 'X-BoxFox-Api-Key: boxfox-local-dev-token' -H 'Content-Type: application/octet-stream' \
  --data-binary @/var/tmp/probe-upload.txt \
  'http://127.0.0.1:8081/__box/file/upload?path=.uploaded_artifacts&name=probe.md&assign=1'
#   → {"path": ".uploaded_artifacts/<n>.md", "name": "<n>.md", "sizeBytes": 20}
docker exec agentbox-box sh -lc 'ls -l /home/agent/workspace/.uploaded_artifacts'
docker exec agentbox-box sh -lc 'cat /home/agent/workspace/.uploaded_artifacts/<n>.md' | diff - /var/tmp/probe-upload.txt
#   → không khác byte nào

# 3. Lượt gửi kèm tệp: event `user` phải mang đường dẫn thật
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print([e for e in d["events"] if e["type"]=="user"][-1])'

# 4. Hai lần upload song song không trùng số
for i in 1 2 3 4; do curl -s -X POST -H 'X-BoxFox-Api-Key: boxfox-local-dev-token' \
  --data-binary @/var/tmp/probe-upload.txt \
  "http://127.0.0.1:8081/__box/file/upload?path=.uploaded_artifacts&name=p.md&assign=1" & done; wait
docker exec agentbox-box sh -lc 'ls -1 /home/agent/workspace/.uploaded_artifacts | sort -n | uniq -d'
#   → rỗng (không có số nào bị cấp hai lần)
```

---

## Phần B — Ngân sách bước và hạn chót (D-1, BUG-41, BUG-42)

### B.0 Hiện trạng, đã kiểm lại

| Hằng số | Giá trị | Nơi |
|---|---|---|
| `MAX_STEPS_DEFAULT` | 16 | `backend/src/agentbox/agent_core/limits.py:16` |
| `MAX_STEPS_MAX` | 60 | `limits.py:17` |
| `DEADLINE_DEFAULT_SECONDS` / `DEADLINE_MAX_SECONDS` | 180 / 600 | `limits.py:18-19` |
| `CHILD_MAX_STEPS` / `CHILD_DEADLINE_SECONDS` | 10 / 120 | `limits.py:20-21` |

Đường ra hiện tại của một lượt:

- Trần bước: `runtime.py:1773-1784` — phát **một** bản ghi `blocker` (`blocker_record` `:1265-1281`,
  `_journal_blocker` `:648-670`, hàng `X:` trong journal) rồi `raise ValueError('MAX_STEPS: iteration budget
  reached; work may be incomplete')`; rơi vào `except Exception` `:1792-1804` ⇒ `close_turn('error')`,
  `store.save(..., 'failed')`, `emit('error', …)`. **Mọi việc đã làm bị vứt.**
- Hạn chót: `asyncio.timeout(config['deadlineSeconds'])` (`runtime.py:1472`) ⇒ `TimeoutError` ⇒
  `classify_failure` trả `('DEADLINE', 'DEADLINE: the turn ran out of time before an answer was produced')`
  (`failures.py:119`) ⇒ cùng đường `failed`.
- Đo sống: cha 8 bước là xong việc vừa phải (phiên `dddebffb887a4f6ca814c1514367d38d`); con
  `ea9486495da646d7aac4ccd4214ea8ed` (`delegate_task role=explore`) chạy **10/10 bước**, 33 tool call, 120 s
  ⇒ `DEADLINE`, `answerChars = 0`, cha nhận `status=failed`. Trần bước từng đánh `failed` một lượt đã xong việc
  (20 bước; chạy lại với `maxSteps: 40` thì xong ở 27 bước — `docs/tracking/test-rounds.md` § Vòng 20/21).
- `TURN_EMPTY_RESPONSE`: `runtime.py:1696` `raise ValueError('Model did not produce a complete non-empty final response')`
  ⇒ `failures.py:152-153`; **không thử lại**. Đo sống: phiên `0ef73471…` chết ở bước 5, có `thought`, không text/tool call.
- `turn_end` (`runtime.py:1436-1454`) mang `{step, status, finishReason, toolCalls, contextEstimate, outputTokens?}` —
  **chưa có** `stepsUsed` / `deadlineUsedMs`; `system_log` `turn.end`/`turn.failed` (`:1724-1726`, `:1789-1790`, `:1801-1803`)
  đã có `steps` và `durationMs`.
- `maxSteps` bị kẹp im lặng ở `runtime.py:1082` (`min(MAX_STEPS_MAX, max(1, …))`); hạn chót thì đã có notice
  `DEADLINE_CLAMPED` (`limits.py:64`, phát ở `runtime.py:1099-1105`) kèm cờ `deadlineClamped` — `maxSteps` chưa có gì tương đương.

### B.1 Việc

**B1 [parallel] — Đổi ngân sách (số của chủ nhà)**

- **Tệp:** `backend/src/agentbox/agent_core/limits.py:16-21`, `:64-72` (chỗ đặt mã notice mới);
  `frontend/src/components/settings/HarnessEditor.test.tsx:43,213,287`, `HarnessList.test.tsx:31,160`,
  `HarnessFlowVisualizer.test.tsx:37`, `SettingsModal.test.tsx:18`, `InstructionsTab.test.tsx:14`,
  `frontend/src/store/harnessStore.workspace.test.ts:9`.
- **Việc:** `MAX_STEPS_DEFAULT = 40`; `MAX_STEPS_MAX = 60` **giữ nguyên**; `CHILD_MAX_STEPS = 40`;
  `CHILD_DEADLINE_SECONDS = 300` (chủ nhà chốt 2026-09-22 — § 0.5); thêm các hằng mới cùng chỗ:
  `STEP_BUDGET_NOTICE_CODE = 'STEP_BUDGET_EXHAUSTED'`, `DEADLINE_NOTICE_CODE = 'DEADLINE_EXCEEDED'`,
  `WRAP_UP_STEPS_RESERVED = 3` (số bước giữ chỗ cho chẩn đoán chỗ tắc — B3/B10),
  `WRAP_UP_MAX_TOKENS = 1024`, `WRAP_UP_TIMEOUT_SECONDS = 30`, `WRAP_UP_READ_TOOL_CALLS = 2` (trần số tool đọc trong
  cửa sổ chẩn đoán khi đã hết hạn chót — B4/B10), `DIAGNOSIS_MIN_CHARS = 80` (dưới ngưỡng này coi như chẩn đoán rỗng)
  (Phần D thêm `ANSWER_WARN_CHARS` / `ANSWER_MAX_CHARS`).
  Sửa sáu fixture giao diện từ 16 → 40 (`HarnessList.test.tsx:160` còn có chuỗi
  `'20 of 20 tools · 16 steps (engine default) · 180 s (engine default)'`).
- **Rủi ro:** `HarnessEditor.test.tsx:213` khẳng định chuỗi `'allowed 1 – 60 · engine default 16'` — sửa theo hằng số,
  không hard-code lại 40 ở test (đọc từ một hằng chung nếu tiện).
- **Nghiệm thu:** `cd backend && python3 -m pytest tests/unit -q -k "runtime_info or limits"` xanh
  (`test_runtime_info.py:194` đọc thẳng `limits.MAX_STEPS_DEFAULT` nên tự đúng);
  `cd frontend && npx vitest run src/components/settings src/store` xanh.

**B2 [after B1] — Tách hai mã, không còn `MAX_STEPS`/`DEADLINE` chung chung**

- **Tệp:** `backend/src/agentbox/agent_core/failures.py:52` (`KNOWN_PREFIXES`), `:119` (nhánh `TimeoutError`);
  `backend/src/agentbox/agent_core/runtime.py:1784` (câu `raise`), `:671` (chữ trong hàng journal);
  test: `backend/tests/unit/test_failure_classification.py:35-36,52`, `backend/tests/unit/test_limits_notice.py:149`.
- **Việc:** thêm `'STEP_BUDGET_EXHAUSTED'` và `'DEADLINE_EXCEEDED'` vào `KNOWN_PREFIXES`, **giữ** `'MAX_STEPS'`/`'DEADLINE'`
  (event/log cũ còn nằm trong DB, không được đổi nghĩa chúng); `classify_failure(TimeoutError)` trả
  `('DEADLINE_EXCEEDED', 'DEADLINE_EXCEEDED: the turn ran out of time before an answer was produced')`;
  câu `raise` ở `:1784` thành `ValueError('STEP_BUDGET_EXHAUSTED: iteration budget reached; work may be incomplete')`;
  chữ ở `:671` đổi tiền tố theo mã mới (giữ nguyên phần "the work on disk may already be done").
- **Rủi ro:** ba test đang khoá chuỗi cũ (`test_failure_classification.py:35-36` khẳng định `'DEADLINE'`;
  `:52` liệt kê `'MAX_STEPS'`; `test_limits_notice.py:149` khẳng định tiền tố `MAX_STEPS:`) ⇒ **đổi có ý thức**, ghi vào
  nhật ký vòng (E4). `test_eval_setup.py:421` và `frontend/.../HarnessStepView.media.test.tsx:158` chỉ dùng `'DEADLINE'`
  làm **đầu vào** ⇒ không đụng.
- **Nghiệm thu:** `cd backend && python3 -m pytest tests/unit -q -k "failure_classification or limits_notice"` xanh
  sau khi sửa ba dòng khẳng định; thêm ca: `classify_failure(ValueError('STEP_BUDGET_EXHAUSTED: …'))[0] == 'STEP_BUDGET_EXHAUSTED'`.

**B3 [after B2] — Chạm trần bước: chẩn đoán chỗ tắc rồi trả `partial` (BUG-42 + yêu cầu mới ở § 0.5)**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:1773-1784` (nhánh trần bước), `:1472-1474` (vòng
  `for step in range(config['maxSteps'])`), `:1655-1697` (mẫu **một** lời gọi provider có trần đã có — cơ chế
  `truncated_retry`/`truncated_partial` của vòng 20),
  `:1714-1727` (mẫu đường `partial` đã có), `:648-670` (ghim `X:`), `:1436-1454` (`close_turn`), `:1210` (`seconds_left`).
- **Việc (một cơ chế, hai chặng — **không** chỉ một lời gọi trần trụi):**
  1. **Giữ chỗ bước cho chẩn đoán.** `wrap_up_at = max(0, config['maxSteps'] - WRAP_UP_STEPS_RESERVED)` (B1: `3` bước).
     Khi `step >= wrap_up_at` và lượt chưa có câu trả lời cuối, vòng lặp vào **chế độ chẩn đoán**: cuối `messages` chèn
     `DIAGNOSIS_PROMPT` (hàm **thuần** `diagnosis_prompt(reason, steps_left)` đặt cạnh các helper khác trong `runtime.py`):
     *"You are almost out of steps (<steps_left> left). Do NOT start new work. (1) Re-read the state you touched: the files
     you changed, the last command output you got, what is still undone. (2) If the path you took was wrong, do the single
     correct action now. (3) Then answer in plain text with four short parts: what is done / where you are stuck / what is
     left / what to try next."* Trong cửa sổ này model **được dùng tool như bình thường** (đó là chỗ "làm đúng một lần"
     xảy ra được) nhưng chỉ còn tối đa `WRAP_UP_STEPS_RESERVED` vòng; text (không tool call) ⇒ chốt lượt ngay.
     Trần 3 bước **chính là** biên của phần "sửa lại một lần" — không có thêm đếm nào.
  2. **Lời gọi chốt có trần khi hết sạch bước.** Hết vòng mà vẫn chưa có text ⇒ **một** lời gọi
     `self.client.complete(messages + [{'role': 'user', 'content': diagnosis_prompt(...)}], [], config['route'], max_tokens=WRAP_UP_MAX_TOKENS)`
     trong `asyncio.timeout(min(WRAP_UP_TIMEOUT_SECONDS, seconds_left(budget) or WRAP_UP_TIMEOUT_SECONDS))`; tools rỗng
     (`max_tokens = 1024` ⇒ chẩn đoán ngắn, không phình).
  Có text và `len(text.strip()) >= DIAGNOSIS_MIN_CHARS` (B1: 80) ⇒ ghi hàng `assistant` vào `messages`,
  `emit('assistant', {'text': …, 'final': True})`, `close_turn('partial', …)`, `store.save(sid, messages, 'completed')`,
  `emit('finish', {'status': 'completed'})`,
  `system_log.write('turn.end', …, status='completed', partial=True, diagnosis=True, steps=steps_used)`, **cộng** notice bền
  `{'code': STEP_BUDGET_NOTICE_CODE, 'partial': True, 'diagnosis': True, 'stepsUsed': n, 'maxSteps': config['maxSteps'],
  'reservedSteps': WRAP_UP_STEPS_RESERVED, 'message': '…'}`, cộng đúng **một** bản ghi `blocker` + hàng `X:` như hiện nay
  (giữ nguyên cơ chế **và** giữ nguyên nhãn máy `note: 'max-steps'` — nhãn này đang bị test khoá, không phải chỗ để đổi tên;
  cái đổi là **mã notice** và **mã lỗi**).
  Không có text / ngắn hơn `DIAGNOSIS_MIN_CHARS` / lỗi / hết phản hồi fixture (`StopIteration`→`RuntimeError` phải bắt trong `try`)
  ⇒ **giữ nguyên** đường dự phòng hôm nay (`failed` + `error` với mã mới).
- **Rủi ro:** ba bước cuối bị "giữ chỗ" nên lượt hữu ích ngắn đi 3 bước — chấp nhận, vì `MAX_STEPS_DEFAULT = 40` (đã đo:
  việc vừa phải 8 bước, việc dài 27 bước). Lượt chốt là **lời gọi provider thứ hai** trong lượt (bounded 30 s, 1 024 token)
  — chấp nhận theo D-10; và nó phải nằm **trong** ngân sách còn lại để không biến `partial` thành `failed`.
- **Nghiệm thu:** test mới `backend/tests/unit/test_turn_partial_budget.py` (copy fixture từ `test_limits_notice.py`:
  `answer`, `call`, `FixtureModel`, `FixtureExecutor`, `notices`, `blockers`) gồm bốn ca:
  (a) model luôn xin tool, còn **một** phản hồi text cho lượt chốt ⇒ phiên `completed`, `turn_end.status == 'partial'`,
  lời gọi cuối không có tool (`tools == []`), có đúng một notice `STEP_BUDGET_EXHAUSTED` (`diagnosis: True`), đúng một `blocker`,
  hàng `X:` có `step`;
  (b) lượt chốt trả text rỗng ⇒ phiên `failed`, event cuối là `error` với `code == 'STEP_BUDGET_EXHAUSTED'`;
  (b2) lượt chốt trả text **ngắn hơn** `DIAGNOSIS_MIN_CHARS` ⇒ cũng `failed` (không nhận "ok" làm chẩn đoán);
  (c) hai test cũ trong `test_limits_notice.py` (trần bước ghim đúng một `blocker` + một hàng `X:`) **vẫn xanh**
  (fixture không còn phản hồi ⇒ rơi vào nhánh dự phòng) — nếu chúng đỏ, sửa theo
  hợp đồng mới chứ không nới lỏng khẳng định;
  (d0 — **chế độ chẩn đoán trong trần 3 bước**) với `maxSteps: 4` (⇒ `wrap_up_at = 1`): bước 1 chạy bình thường, rồi trong cửa sổ
  chẩn đoán (bước 2–4) model gọi **hai** tool đọc + **một** tool ghi (đường cũ sai ⇒ sửa lại một lần) và trả text ⇒
  có đúng **một** tool ghi được thực thi, lượt `partial`, và text cuối chứa **cả bốn** phần (khẳng định theo bốn nhãn trong `DIAGNOSIS_PROMPT`).

**B4 [after B3] — Chạm hạn chót: cùng đường chẩn đoán (BUG-42 + § 0.5)**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:1792-1804` (nhánh `except Exception`), `:1472-1474`
  (`asyncio.timeout(config['deadlineSeconds'])`), `:1210` (`seconds_left`), `backend/src/agentbox/agent_core/tool_groups.py`
  (nhóm tool **đọc** — dùng cho cửa sổ đọc lại trạng thái).
- **Việc:** khi `code in {DEADLINE_NOTICE_CODE, 'DEADLINE'}` và lượt chưa có câu trả lời cuối, chạy **cùng** đường chẩn đoán của
  B3 nhưng **ngoài** ngân sách đã hết, trong **một** `asyncio.timeout(WRAP_UP_TIMEOUT_SECONDS)` mới, theo hai nhịp:
  1. **Đọc lại trạng thái (nhịp có tool, tối đa `WRAP_UP_READ_TOOL_CALLS = 2` lời gọi tool **đọc**):** gọi model với tools **đọc**
     (danh sách lấy từ `tool_groups.py`, không tự chép tay) + `diagnosis_prompt`; nếu model xin tool đọc thì thực thi, tối đa 2 lời gọi,
     rồi gọi lại **một** lần nữa. Đây là chỗ thoả "đọc lại tệp đã sửa / kết quả lệnh cuối" khi **không còn thời gian**.
  2. **Chẩn đoán (nhịp không tool):** nếu nhịp 1 chưa ra text, **một** lời gọi tools-rỗng với `WRAP_UP_MAX_TOKENS` trong phần thời gian còn lại.
  Có text và `>= DIAGNOSIS_MIN_CHARS` ⇒ đi đúng đường `partial` của B3 với notice `DEADLINE_EXCEEDED`
  (`diagnosis: True`, `deadlineUsedMs`, `deadlineSeconds`, `readToolCalls`) và cộng `deadlineUsedMs` vào `turn_end`; không có text
  ⇒ nhánh `failed` hiện tại (mã `DEADLINE_EXCEEDED`). Vì hạn chót **không** hoàn lại bước, nhịp 1 chỉ được chạy khi
  `WRAP_UP_READ_TOOL_CALLS > 0` và luôn nằm trong cùng một trần thời gian.
  Thứ tự bắt buộc: lượt chẩn đoán chạy **trước** `close_turn`, để cặp `turn_start`/`turn_end` đóng đúng **một lần** với
  `status='partial'` — gọi `close_turn('error')` trước rồi mới chốt sẽ sinh hai cặp và giao diện đọc phải cái sai.
- **Rủi ro:** đây là lời gọi provider **duy nhất** được phép chạy trên đường đã hết hạn — trần `WRAP_UP_TIMEOUT_SECONDS` cứng,
  tối đa 3 lời gọi (đọc → đọc → chẩn đoán) và **một** lần cho cả lượt; provider chậm ⇒ rơi về `failed` như hôm nay (không tệ hơn).
  Nhịp đọc lại có thể đọc phải tệp lớn ⇒ dùng đúng đường `file_read` hiện có (đã cắt 30 000 ký tự, A8 mở rộng cho tệp nhị phân).
- **Nghiệm thu:** trong `test_turn_partial_budget.py`:
  (d) model ném `asyncio.TimeoutError` ở bước 2, lượt chẩn đoán trả text ⇒ `status == 'completed'`, `turn_end.status == 'partial'`,
  một notice `DEADLINE_EXCEEDED` có `deadlineUsedMs` và `diagnosis: True`;
  (d2) model xin **đọc** đúng một tệp trong nhịp 1 rồi trả chẩn đoán ⇒ tool đọc được thực thi **một** lần và vẫn ra `partial`
  (khẳng định "đọc lại trạng thái" thật sự xảy ra, không chỉ nằm trong prompt);
  (d3) model xin **ba** tool đọc ⇒ chỉ **hai** lời gọi được thực thi (`WRAP_UP_READ_TOOL_CALLS`), lời thứ ba bị từ chối;
  (e) lượt chẩn đoán cũng timeout ⇒ `failed` + `code == 'DEADLINE_EXCEEDED'`.

**B5 [after B4] — Con `partial` truyền đúng lên cha**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:1389-1399` (`truncated_turn`), `:2546-2548`, `:2560-2563`;
  `backend/tests/unit/test_child_truncation.py` (giữ xanh), `test_turn_partial_budget.py` (thêm ca).
- **Việc:** đổi `truncated_turn(sid)` → `partial_turn(sid)` trả **mã lý do** (hoặc `None`) khi lượt gần nhất có notice bền
  với mã thuộc `{PROVIDER_OUTPUT_TRUNCATED, STEP_BUDGET_EXHAUSTED, DEADLINE_EXCEEDED}`; `delegate` đặt
  `status='partial'` và `result['reason'] = <mã>`; giữ nguyên nhánh cũ cho `PROVIDER_OUTPUT_TRUNCATED` (test C2 vẫn phải xanh).
  **Chẩn đoán của con phải đi cùng:** khi con chạm trần bước/hạn chót, câu trả lời của con **chính là** chẩn đoán bốn phần
  (B10) ⇒ `answerChars` phải `> 0` và `result['diagnosis'] = True` (trường mới, chỉ đặt khi lời cuối thoả
  `len(text.strip()) >= DIAGNOSIS_MIN_CHARS`). Cha **không** phải suy đoán: một dòng trong kết quả trả về nói rõ
  "con dừng vì <mã> và đây là chỗ nó tắc", để cha biết đường đi tiếp thay vì thấy `failed` trắng như BUG-42.
- **Rủi ro:** đổi tên hàm công khai trong module — grep thấy chỉ dùng ở `delegate` và `test_child_truncation.py`;
  giữ một alias `truncated_turn = partial_turn`? Không cần, sửa cả hai chỗ là đủ (ghi rõ trong PR).
- **Nghiệm thu:** `python3 -m pytest backend/tests/unit -q -k "child_truncation or partial_budget"` xanh; ca mới:
  con chạm trần bước ⇒ cha nhận `status='partial'`, `reason='STEP_BUDGET_EXHAUSTED'`, `answerChars > 0`, `is_error is False`.

**B10 [after B5] — Con chạm trần: chẩn đoán về tới cha (yêu cầu mới của chủ nhà, § 0.5)**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:2492-2565` (`delegate`, ghim ngân sách con `:2504-2511`, hai event `child`
  `:2523-2530`/`:2564`, dict kết quả `:2556-2563`), `:1389-1399` (`partial_turn` sau B5), `backend/src/agentbox/agent_core/roles.py`
  (prompt vai), `backend/tests/unit/test_child_truncation.py`, `backend/tests/unit/test_delegation_contract.py`.
- **Việc:** bảo đảm đường chẩn đoán của B3/B4 dùng được **từ trong con** và kết quả đi tới cha:
  1. Cửa sổ giữ chỗ (`WRAP_UP_STEPS_RESERVED`) tính theo `maxSteps` **của con** (đã bị `min()` kẹp), không tính theo cha —
     con `maxSteps: 12` vẫn còn 3 bước chẩn đoán, không bị cha lấy mất.
  2. Câu chẩn đoán của con **là** câu trả lời cuối của con (nguồn duy nhất, không sinh thêm bản sao thứ hai): `partial_turn`
     trả mã lý do, `delegate` đặt `status='partial'`, `reason=<mã>`, `diagnosis=True`, `answerChars=len(text)` (B5).
  3. Event `child` thứ hai (`:2564`) mang thêm `diagnosis: True` và `stuckReason: <mã>` **nếu** có chẩn đoán; dict kết quả trả
     cho cha giữ nguyên trần kích thước hiện có (không dán cả transcript, chỉ câu chẩn đoán như `answer` hiện nay).
  4. Trong `CHILD_RESULT_CONTRACT`/prompt vai (`roles.py`) một dòng: "nếu hết ngân sách, trả bốn phần: đã làm / tắc ở đâu /
     còn lại / thử gì tiếp" — cùng một câu trong `DIAGNOSIS_PROMPT`, không chép thành hai bản khác nhau.
- **Rủi ro:** con chạm trần giờ trả **nhiều chữ hơn** trước (trước là 0) ⇒ cộng dồn vào context cha; đã bị chặn bởi
  `WRAP_UP_MAX_TOKENS` và bởi trần `answer` hiện có của `delegate`. Con `failed` **thật** (provider lỗi) vẫn là `failed`.
- **Nghiệm thu (ca bắt buộc theo yêu cầu chủ nhà):** test mới
  `backend/tests/unit/test_child_diagnosis.py::test_budget_exhausted_child_returns_diagnosis` (dùng `FixtureModel`/
  `FixtureExecutor`, gọi thẳng `delegate` với `role='explore'` và con `maxSteps: 3`):
  (a) con dùng hết bước và không có text ⇒ **trước đây**: `status='failed'`, `answerChars=0` (đúng BUG-42);
  **bây giờ**: cha nhận `status='partial'`, `reason='STEP_BUDGET_EXHAUSTED'`, `diagnosis is True`, `answerChars > 0`,
  `is_error is False`, và text chẩn đoán có **cả bốn** phần;
  (b) cùng cấu hình nhưng lượt chẩn đoán của con timeout ⇒ `failed` như cũ (không nuốt lỗi thật);
  (c) con chạm **hạn chót** (deadline path của B4) ⇒ cũng `partial` + `diagnosis is True`, `reason='DEADLINE_EXCEEDED'`;
  (d) event `child` thứ hai có `diagnosis: True` và `stuckReason` khớp mã trong notice.

**B6 [after B1] — Ngân sách con 40 bước / 300 s (chủ nhà chốt)**

- **Tệp:** `backend/src/agentbox/agent_core/limits.py:20-21`, `backend/src/agentbox/agent_core/runtime.py:2504-2511`
  (clamp `min(CHILD_MAX_STEPS, …)` / `min(CHILD_DEADLINE_SECONDS, …)`), `backend/tests/unit/test_delegation_contract.py`.
- **Việc:** hằng số đã đổi ở B1 (`40` / `300`); kiểm hai chỗ clamp dùng `min()` nên con **không bao giờ vượt** cha
  (giữ nguyên luật): cha mặc định (`maxSteps: 40`, `deadlineSeconds: 180`) ⇒ con coi như nhận `40` bước / `180 s`; cha
  `maxSteps: 60`, `deadlineSeconds: 600` ⇒ con `40` / `300`. Ghi rõ trong PR rằng **300 s là trần**, không phải bảo đảm.
  Thêm vào `CHILD_RESULT_CONTRACT` (`runtime.py:~858`) một câu nói con biết ngân sách của nó (40 bước / 300 s, kẹp theo cha)
  để con tự chia việc — nếu chọn không sửa prompt thì **bỏ** gạch đầu dòng này, nhưng phải nói rõ trong PR.
- **Rủi ro:** con 40 bước × 3 slot song song làm lượt cha dài hơn (thời gian thực) — D-10 đã cho phép; trần thời gian con
  (300 s) **lớn hơn** hạn chót mặc định của cha (180 s) nên luôn bị `min()` kẹp xuống trong cấu hình mặc định (không có
  lượt nào thực sự dài thêm vì con).
- **Nghiệm thu:** test: một phiên cha `maxSteps: 60`, `deadlineSeconds: 600` ⇒ `create` của con có `maxSteps == 40`,
  `deadlineSeconds == 300`; cha `maxSteps: 12` ⇒ con `12`, `deadlineSeconds` con `≤` cha; cha mặc định ⇒ con `40` bước
  và `deadlineSeconds == 180` (bị kẹp, **không** phải 300).

**B7 [after B2] — Không cắt `maxSteps` im lặng (`STEPS_CLAMPED`)**

- **Tệp:** `backend/src/agentbox/agent_core/limits.py` (thêm `STEPS_CLAMP_NOTICE_CODE = 'STEPS_CLAMPED'`),
  `backend/src/agentbox/agent_core/runtime.py:1079-1105` (khối kẹp hiện có của hạn chót), `:1290-1298` (`session_metrics`),
  `backend/tests/unit/test_limits_notice.py`.
- **Việc:** dùng **cùng** hình dạng với `DEADLINE_CLAMPED`: `requested` vs `applied`, đúng **một** notice khi bị kẹp,
  thêm cờ `stepsClamped: True` vào `config` phiên; `session_metrics` trả thêm `stepsClamped`.
- **Rủi ro:** notice thêm vào transcript — không đụng logic cắt (chỉ nói ra).
- **Nghiệm thu:** `test_limits_notice.py` thêm ca: `maxSteps: 999` ⇒ một notice `STEPS_CLAMPED` với `requested=999`,
  `applied=60`; `maxSteps: 40` ⇒ **không** notice, không cờ.

**B8 [after B1] — `TURN_EMPTY_RESPONSE` thử lại đúng một lần (BUG-41)**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:1696-1697` (chỗ kiểm câu trả lời trọn vẹn), `:1663-1675`
  (mẫu thử lại một lần đã có của C2), `backend/src/agentbox/agent_core/failures.py:152-153`;
  `router/src/providers/deepseek.mjs:30-31` (ràng buộc: `tool_choice: 'required'` + chế độ thinking ⇒ provider trả 400).
- **Việc:** khi rơi đúng nhánh `TURN_EMPTY_RESPONSE` (không tool call, không text, `finish_reason` không phải `stop`/`end_turn`),
  thử lại **một** lần:
  - route **không** có `thinkingLevel` ⇒ gửi kèm `tool_choice: 'required'` (chèn vào bản sao của `config['route']` cho **một** request,
    không lưu vào config) để model buộc phải hành động;
  - route **có** `thinkingLevel` ⇒ gửi `tools=[]` + một dòng chỉ dẫn "answer in plain text now" (đúng cách C2 đã hạ trần output).
  Lượt thử lại có text (hoặc có tool call) ⇒ đi tiếp bình thường như chưa có gì xảy ra, kèm
  `system_log.write('turn.retry', …, reason='empty_response')` và notice `{'code': 'TURN_EMPTY_RESPONSE_RETRY', 'attempt': 1}`.
  Vẫn rỗng ⇒ `raise` như hôm nay (mã `TURN_EMPTY_RESPONSE` đã hiện trên băng đỏ — `HarnessStepView.notice.test.tsx` có chỗ đọc mã).
  **Chú ý khi sửa test:** `FixtureModel.complete` hiện có chữ ký `(messages, tools, route, max_tokens=4096, on_thought=None, on_content=None)`
  (khác thứ tự với `RouterClient.complete`), nên thêm `tool_choice=None` (hoặc `**kwargs`) và ghi vào `self.requests` để ca kiểm đọc được.
- **Rủi ro:** `tool_choice` mới với provider khác (Anthropic/OpenCode) — router đã dịch (`router/src/anthropic.mjs:329-330`,
  `router/src/providers/anthropic.mjs:42`), nhưng nếu provider từ chối thì lượt thử lại đó hỏng và rơi về `failed` như cũ
  (một lần, không vòng lặp).
- **Nghiệm thu:** `backend/tests/unit/test_child_truncation.py` giữ xanh; thêm ca trong `test_turn_partial_budget.py`:
  phản hồi 1 = `finish_reason='length'`, `text=''`, không tool call, không `thinkingLevel` ⇒ có **đúng hai** request tới model,
  request thứ hai có `tool_choice == 'required'`; phản hồi 2 = text ⇒ lượt `completed`, **không** có event `error`.

**B9 [parallel] — Đo được: `stepsUsed` / `deadlineUsedMs` (D-1)**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:1436-1454` (`close_turn`), `:1724-1726` (`turn.end`),
  `:1801-1803` (`turn.failed`), `scripts/eval/rushed_index.py:150-170,264-277` (đọc `turn_start`/`turn_end`);
  test: `backend/tests/unit/test_stream_delta_events.py` hoặc `test_turn_partial_budget.py`.
- **Việc:** `turn_end` mang thêm `stepsUsed` (số bước **đã dùng** của cả lượt, không phải số của riêng bước — hiện có
  `steps_used` là biến cục bộ trong `_run`), `deadlineUsedMs` (`(time.time() - started) * 1000`), `toolsRun`
  (số lần `tool_end` trong lượt). Cập nhật `rushed_index.py` để đọc thẳng ba khoá đó, chỉ rơi về phép tính cũ
  (tỉ lệ `durationMs/deadlineSeconds`) khi khoá vắng mặt (hồi tương thích với lượt cũ).
- **Rủi ro:** `turn_end` xuất hiện **mỗi bước** (`close_turn` gọi cuối mỗi bước) ⇒ ba khoá luỹ kế chỉ có nghĩa ở
  lần đóng **cuối**; quy ước: ghi giá trị luỹ kế ở mọi lần đóng (đọc lần cuối cùng là số của cả lượt) và **nói rõ**
  trong docstring của `close_turn`.
- **Nghiệm thu:** test khẳng định `turn_end` cuối cùng của một lượt 3 bước có `stepsUsed == 3` và `deadlineUsedMs > 0`;
  `python3 scripts/eval/rushed_index.py --help` chạy được và một lượt cũ (không có khoá mới) vẫn ra báo cáo.

### B.2 Nghiệm thu phần B

```bash
cd backend && python3 -m pytest tests/unit -q -k "limits or deadline or steps or partial or child_truncation or failure_classification"
cd backend && python3 -m pytest tests/unit -q                     # toàn bộ: không hồi quy
# Sống (chỉ khi router còn model — vòng 21 đo được muse-spark-1.2/1.3 chạy):
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json' \
  -d '{"prompt":"đếm từ 1 tới 3 rồi trả lời","maxSteps":40,"deadlineSeconds":300}' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>/turns'
#   → turn_end cuối có stepsUsed, deadlineUsedMs; không có mã STEP_BUDGET_EXHAUSTED/DEADLINE_EXCEEDED cho việc ngắn
# Sống: ép ngân sách bước xuống 4 để chạy đúng đường chẩn đoán (phải ra partial + chẩn đoán 4 phần, không phải failed trắng):
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json' \
  -d '{"prompt":"liệt kê tệp trong workspace rồi đọc 3 tệp bất kỳ","maxSteps":4}' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>/turns'
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);n=[e for e in d["events"] if e["type"]=="notice" and e["data"].get("code")=="STEP_BUDGET_EXHAUSTED"];print(n, d["session"]["status"])'
#   → một notice có "diagnosis": true, và d["session"]["status"] == "completed" (turn_end.status == "partial")
# Sống: con chạm trần ⇒ cha nhận chẩn đoán (yêu cầu mới của chủ nhà):
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' -H 'Content-Type: application/json' \
  -d '{"prompt":"dùng delegate_task role=explore để đọc 3 tệp trong workspace; con chỉ có maxSteps=3"}' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>/turns'
curl -s -H 'X-BoxFox-Admin: 1' -H 'Origin: http://localhost:3100' \
  'http://127.0.0.1:3102/api/agent/sessions/<sid>' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print([e["data"] for e in d["events"] if e["type"]=="child"])'
#   → event `child` thứ hai có "diagnosis": true, "stuckReason": "STEP_BUDGET_EXHAUSTED", "status": "partial", answerChars > 0
```

---

## Phần C — Ba quyết định về kế hoạch và lịch sử (D-2, D-3, D-5)

### C.0 Hiện trạng, đã kiểm lại

**D-2 — `migrate_plans.py`** (`deploy/docker/migrate_plans.py`, 251 dòng) đã có sẵn **phần lớn** cơ chế:
`--apply` mặc định tắt (`:233`), `--renumber-lone` mặc định tắt (`:236-237`), không bao giờ ghi đè (đích đã tồn tại ⇒
`MigrationError` `:50`), chạy lại lần hai báo `nothingToDo` (`:197`, `:245-246`), `run()` `:188-227`,
`apply_header` `:169-175` (tệp tạm + `os.replace`), `apply_rename` `:178-185`. **Thiếu hai thứ chủ nhà yêu cầu:**

1. **Không có bước sao lưu nào** — `--apply` ghi thẳng.
2. **Không có đường xoá nào** — và do đó cũng không có cổng "chỉ xoá khi không bản ghi `P:` nào trỏ tới".

Thêm nữa tệp này **chưa được stage vào image** (`deploy/docker/Dockerfile:280-299` không COPY nó), nên hôm nay chỉ
chạy được từ ngoài (bản sao) chứ không chạy được trong box.

Hình dạng thật của một bản ghi `P:` (đọc từ box sống hôm nay,
`/home/agent/workspace/.session-history/67bdfd4b/journal.jsonl`):

```json
{"kind":"plan","id":"P:boxfox-5-upgrades@v1","session":"67bdfd4b…","actor":"agent",
 "text":"kế hoạch boxfox-5-upgrades v1 đã ghi (4643 B)","status":"draft",
 "data":{"identity":"boxfox-5-upgrades","version":1,"slug":"boxfox-5-upgrades",
         "relativePath":".plans/v1-boxfox-5-upgrades.md"}}
```

⇒ Cổng xoá kiểm được bằng **file** (`data.identity`, `data.relativePath`) mà không cần đọc SQLite của harness.
Bản ghi chuẩn trong DB (`~/BoxFox/harness/sessions.sqlite`, bảng `journal`, `kind='plan'`) hôm nay có **1 hàng**
(`P:boxfox-5-upgrades@v1`) — dùng làm phép kiểm thứ hai.

Trạng thái `.plans` sống hôm nay: **2 tệp**, cả hai **đã có** header (`v1-agent-box-plan.md` do bootstrap-plans gieo,
`v1-boxfox-5-upgrades.md` do harness ghi) ⇒ một lần `--apply` hôm nay là **không có gì để làm**; bản chạy thật để
chứng minh cơ chế phải chạy trên **bản sao** (đúng cách vòng 20 đã làm: `wrote=6`, lần hai `nothingToDo=true`).
Ghi chú: tệp do harness ghi **không** có dòng `Slug:` — đúng thiết kế (`agent_core/plan_header.py` ghi `Slug` **chỉ khi**
model xin slug khác), không phải lỗi.

**D-3 — dải jaccard mơ hồ.** Logic nằm ở `backend/src/agentbox/agent_core/plan_registry.py`, **không** phải
`plan_files.py`: `MERGE_THRESHOLD = 0.75` (`:62`), `AMBIGUOUS_THRESHOLD = 0.5` (`:63`), `resolve_identity` (`:445-471`)
trả `merge` khi `score >= 0.75`, `ambiguous` khi `score >= 0.5`, còn lại `new`; `plan_registration` ném
`PlanRegistrationError('identity-ambiguous', …)` (`:717-720`) với câu chữa ở `:88`. Test khoá biên:
`backend/tests/unit/test_plan_registry.py` (`49→new`, `50→ambiguous`, `74→ambiguous`, `75→merge`),
`test_write_plan.py:549-564` (`PLAN_EVAL_REJECTED: (identity-ambiguous)`), `test_plan_eval.py:468`.
Đo sống vòng 21: cùng một kế hoạch bị từ chối ở lần 4 rồi **được nhận ở lần 5**.

**D-5 — `.session-history`.** BOX-1 viết cứng khuôn trong `deploy/docker/session_files.py:46`
(`SESSION_HISTORY_DIRNAME = ".session-history"`), `journal.jsonl`/`journal.md` ở `:56-57`, retention ở `:88-93` + `:837-893`;
`deploy/docker/backfill_history.py:43` mặc định `DEFAULT_ROOT = "/home/agent/workspace/.session-history"`;
`box-entrypoint.sh:15-24` tạo thư mục với `chmod 0750` + `chown 1000:1000`. Đo lại hôm nay trong box:
**8 thư mục phiên + `INDEX.json`, 15 tệp, 128 KB** (khớp số vòng 21). ⇒ **Không đổi gì**, chỉ thêm một test chống
đổi tên trong im lặng.

### C.1 Việc

**C1 [parallel] — `migrate_plans.py`: sao lưu trước khi ghi**

- **Tệp:** `deploy/docker/migrate_plans.py:188-227` (`run`), `:230-246` (`main`), `:43` (`DEFAULT_ROOT`);
  test `deploy/docker/tests/test_migrate_plans.py`.
- **Việc:** `run(root, *, apply=False, merges=(), renumber=False, backup_dir=None)`:
  khi `apply=True`, **trước** mọi lần ghi, sao chép **từng byte** mọi tệp `vN-*.md` dưới `root` (đệ quy, bỏ tệp tạm
  `_is_temporary_name`) vào `backup_dir` (mặc định `<root>/../.plans-backups/<UTC ISO>/`, tức
  `/home/agent/workspace/.plans-backups/…` — **ngoài** `.plans` vì bộ đọc `plan_files.py` đi đệ quy trong `.plans`
  và sẽ nhặt luôn bản sao) + `manifest.json` gồm báo cáo dry-run và `sha256` từng tệp.
  Ghi được backup **hoặc** không chạy: lỗi ghi ⇒ `MigrationError` → exit 2, **không** byte nào của `.plans` bị sửa.
  Cờ mới: `--backup-dir` (đổi chỗ), `--no-backup` **không** được thêm (chủ nhà chốt "sao lưu trước khi áp dụng").
- **Rủi ro:** `.plans-backups` là thư mục mới trong workspace ⇒ phải ghi vào `docs/naming.md`/`docs/architecture/workspace-files.md`
  và **không** đặt nó trong `PROTECTED_PATHS` (nó là rác có thể xoá tay) nhưng phải nêu trong thông báo kết quả.
- **Nghiệm thu:** trong `test_migrate_plans.py`: chạy `--apply` trên **bản sao** ⇒ `backup_dir` có đủ tệp, `sha256` khớp
  tệp gốc trước khi sửa, và `wrote > 0`; chạy **không** `--apply` ⇒ **không** có thư mục backup nào được tạo;
  ca `backup_dir` trỏ vào nơi không ghi được ⇒ exit 2 và md5 của mọi tệp `.plans` **không đổi**.

**C2 [after C1] — Cổng `P:` trước khi xoá kế hoạch thử**

- **Tệp:** `deploy/docker/migrate_plans.py` (thêm `plan_references()` + cờ `--delete-orphan`),
  `deploy/docker/tests/test_migrate_plans.py`, `deploy/docker/tests/test_fixtures/` (thêm một `.session-history` giả có/không có hàng `P:`).
- **Việc:**
  1. `plan_references(sessions_root, *, relative_path, identity=None) -> list[dict]`: quét
     `<sessions_root>/*/journal.jsonl` (mặc định `/home/agent/workspace/.session-history`), đọc từng dòng JSON,
     giữ `kind == 'plan'`, khớp `data.relativePath == relative_path` **hoặc** (`identity` cho trước và
     `data.identity == identity`); trả về `[{session, id, status}]` để báo cáo in ra được **ai** đang giữ.
  2. Cờ `--delete-orphan ĐƯỜNG_DẪN_TƯƠNG_ĐỐI` (lặp được, ví dụ `--delete-orphan v1-test-plan.md`):
     - có bản ghi `P:` trỏ tới ⇒ **từ chối** (`MigrationError`, exit 2) kèm danh sách người giữ;
     - không có ⇒ chỉ xoá khi `--apply`; `--dry-run` in ra `{"delete": [...]}` và không chạm đĩa;
     - đường dẫn phải qua `plan_files.validate_rel_path`-style guard (`FILENAME_RE` `:45` + không `..`), xoá bằng
       `Path.unlink()` trên đường dẫn đã kiểm (không đi qua symlink: kiểm `path.is_symlink()` ⇒ từ chối).
  3. Báo cáo thêm khoá `deleted`, `backedUp`, `references` để lần chạy sau đọc lại được.
- **Rủi ro:** đây là đường **duy nhất** xoá một kế hoạch ⇒ cổng phải là *từ chối mặc định*; `.session-history` là bản
  đọc được ở box, còn bản chuẩn nằm ở DB harness nên **luật là "thấy bản ghi thì từ chối"**, không phải "chỉ khi chắc chắn".
- **Nghiệm thu:** `cd deploy/docker && python3 -m pytest tests/test_migrate_plans.py -q` xanh, gồm:
  xoá bị từ chối khi fixture có hàng `P:` trỏ đúng `relativePath`; xoá thành công khi không có; `--dry-run` không xoá;
  `--apply` với tệp đã xoá ⇒ `nothingToDo`; và ca biên: hàng `P:` chỉ khớp `identity` (khác `relativePath`) ⇒ vẫn từ chối.
  Phép kiểm thứ hai (bản chuẩn, chạy tay trên máy sống):
  `python3 -c "import sqlite3,os;p=os.path.expanduser('~/BoxFox/harness/sessions.sqlite');c=sqlite3.connect('file:'+p+'?mode=ro',uri=True);print(c.execute(\"select count(*) from journal where kind='plan'\").fetchall())"`

**C3 [after C2] — Stage vào box + runbook `--apply` an toàn**

- **Tệp:** `deploy/docker/Dockerfile:291-296` (khối COPY), `deploy/docker/smoke-test.sh:150-153` (kiểm staged),
  `docs/architecture/workspace-files.md` (mục `.plans` + `.plans-backups`).
- **Việc:** `COPY migrate_plans.py /usr/local/bin/migrate_plans.py` (cùng `upload_files.py` của A11);
  smoke-test kiểm hai tệp đã staged; runbook vào plan + docs:
  1. sao lưu DB harness (host, **không** dùng `sqlite3` CLI vì máy không có):
     `python3 -c "import sqlite3,os;src=sqlite3.connect(os.path.expanduser('~/BoxFox/harness/sessions.sqlite'));dst=sqlite3.connect('/var/tmp/sessions-backup.sqlite');src.backup(dst);dst.close();print('backup ok')"`
  2. `docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py` (dry-run, đọc JSON)
  3. `docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --apply` (tệp sẽ tự sao lưu `.plans-backups/…`)
  4. chạy lại dry-run ⇒ `nothingToDo: true`.
- **Rủi ro:** thêm tệp vào image ⇒ phải build lại box (`docs/setup`); nếu chưa build lại thì runbook dùng đường
  `docker cp deploy/docker/migrate_plans.py agentbox-box:/usr/local/bin/` (ghi rõ cả hai đường).
- **Nghiệm thu:** `bash deploy/docker/smoke-test.sh` báo đã staged; `docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --help` in ra `--backup-dir` và `--delete-orphan`;
  dry-run trên box sống ⇒ `wrote=0`, `nothingToDo=true`, **không** có thư mục `.plans-backups` mới.

**C4 [parallel] — D-3: từ chối **một lần** ở dải jaccard 0,5–0,75**

- **Tệp:** `backend/src/agentbox/agent_core/plan_registry.py:62-63`, `:411-475` (`resolve_identity` — **hàm thuần**,
  chữ ký `(proposed_slug, *, index=None, declared_identity=None, relates_to=None, directory='')`), `:370-393`
  (`IdentityDecision`, `to_payload()`), `:88` (câu chữa), `:694-720` (`plan_registration`, `identity-ambiguous`);
  `backend/src/agentbox/agent_core/runtime.py:2167-2169` (`plan_registration_for` — chỗ gọi registry) và
  `:2442-2457` (`pin_plan`, `session_journal.append` ra hàng `P:…@vN`, `status='draft'`);
  `backend/src/agentbox/memory/session_store.py:212-245` (`journal_tail(sid, kinds=…)` — đường **đọc** hàng nhật ký);
  test `backend/tests/unit/test_plan_registry.py` (biên `:78`, `:335-340`, `:496-503`), `backend/tests/unit/test_write_plan.py:549-564`.
- **Việc:** giữ nguyên `identity-ambiguous` cho **lần đầu** (không gộp khi chưa chắc — gộp nhầm là mất dữ liệu không hoàn tác được),
  nhưng ghi lại lời từ chối để **lần gửi lại nguyên văn** được nhận:
  1. Thêm tham số `ambiguity_ticket=None` cho `resolve_identity` và `plan_registration`. Vé khớp
     (`ticket['slug'] == proposed_slug` **và** `ticket['directory'] == directory` **và** chưa có hàng `P:` nào cho slug đó)
     ⇒ ở nhánh `ambiguous` trả `_decision_for_new(...)` với `matched_by='ambiguity-ticket'`, **giữ** `score` +
     `matched_identity` + `candidates` trong `IdentityDecision` để nhật ký nói được "đã từng mơ hồ".
  2. Chỗ gọi (`runtime.plan_registration_for`) đọc vé bằng `store.journal_tail(sid, kinds=['fact'])` và dò
     `payload['record']['data']['identityAmbiguityTicket']`; khi bị từ chối (`identity-ambiguous`) thì **ghi vé**
     bằng `session_journal.append(self.executor, self.store, sid, 'fact', <câu tiếng Việt>, data={'identityAmbiguityTicket': {...}}, status='info')`.
  3. **Vì sao vé là `kind='fact'` (`F:`), không phải `kind='plan'` (`P:`):** cổng xoá của C2 đọc hàng `P:` có
     `data.relativePath`; một bản bị **từ chối** thì không có tệp nào để giữ, nên vé không được phép đóng vai "người giữ"
     một kế hoạch không tồn tại. Vé không mang `relativePath`. Nhóm *dữ kiện bền* trong `brief()` cũng hiện câu này cho model
     ⇒ model biết đường gửi lại.
  4. **Vé tiêu đúng một lần** — luật là "chỉ dùng khi **chưa** có hàng `P:` nào cho slug đó": lần nhận được sẽ ghim `P:`
     ⇒ từ đó mọi lần gửi lại đi theo chỉ mục (gộp `≥ 0.75` với chính nó, hoặc từ chối vì truy vết), **không** bao giờ
     được "ép chủ đề mới" lần thứ hai. Không cần ghi thêm trạng thái "đã dùng" ⇒ không thêm bảng, không thêm cột.
  5. Bản ghi `P:` nhận được **giữ** `data.identityAmbiguity = {score, nearestIdentity}`: `pin_plan` (`:2442-2457`) nhận thêm
     một trường tuỳ chọn từ `write_plan`, ghi vào `data` — để UI/nhật ký đọc được "bản này từng nằm trong dải mơ hồ".
  6. Câu chữa ở `:88` đổi thành: khai báo `identity` mới rõ ràng, **hoặc** gửi lại **nguyên văn** để nhận là kế hoạch mới.
- **Rủi ro:** vé thành "cửa sau" cho mọi lần gửi lại ⇒ chặn bằng luật "chưa có `P:`" và bằng ca test lần 3;
  vé phải **không** đổi nhánh `merge` (`≥ 0.75` vẫn gộp như cũ, không đi qua vé) — test biên `0.75` cũ phải giữ xanh.
- **Nghiệm thu:** `python3 -m pytest backend/tests/unit -q -k "plan_registry or write_plan or plan_eval"` xanh, gồm ca mới:
  (a) lần gửi 1 ⇒ `identity-ambiguous` + **một** hàng `F:` mang `identityAmbiguityTicket`;
  (b) lần gửi 2 **cùng nội dung** ⇒ thành công, hàng `P:` mang `data.identityAmbiguity`;
  (c) lần gửi 3 cùng nội dung ⇒ **không** sinh tệp `v1-…` thứ hai (đi nhánh gộp `version == 2`, hoặc từ chối vì truy vết) —
  đây là bằng chứng "vé tiêu một lần";
  (d) biên cũ `0.75` vẫn `merge`, `0.49` vẫn nhóm mới như cũ.

**C5 [parallel] — D-5: `.session-history` được giữ (test chống đổi tên)**

- **Tệp:** `deploy/docker/tests/test_session_files.py` (thêm ca), `deploy/docker/box-entrypoint.sh:15-24` (không sửa),
  `docs/tracking/owner-decisions.md` (đổi trạng thái D-5, xem E4).
- **Việc:** thêm ca khẳng định `session_files.SESSION_HISTORY_DIRNAME == '.session-history'`,
  `journal.jsonl`/`journal.md` đúng tên, và `backfill_history.DEFAULT_ROOT` kết thúc bằng
  `/home/agent/workspace/.session-history`; kèm một dòng trong docs nói **vì sao** (đổi tên = phá 8 thư mục phiên + 15 tệp
  đang có, và phá bản đọc `~/BoxFox/harness/sessions.sqlite`).
- **Rủi ro:** không có (test thuần).
- **Nghiệm thu:** `cd deploy/docker && python3 -m pytest tests/test_session_files.py -q` xanh.

### C.2 Nghiệm thu phần C

```bash
cd deploy/docker && python3 -m pytest tests/test_migrate_plans.py tests/test_session_files.py -q
# Bản sao (chứng minh cơ chế) — không đụng .plans sống:
rm -rf /var/tmp/plans-copy && cp -a /home/agent/workspace/.plans /var/tmp/plans-copy   # trong box: docker exec
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --root /var/tmp/plans-copy            # dry-run
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --root /var/tmp/plans-copy --apply    # có backup
docker exec agentbox-box sh -lc 'ls -l /var/tmp/plans-backups/*/ && python3 -c "import json,glob;print(json.load(open(glob.glob(\"/var/tmp/plans-backups/*/manifest.json\")[0]))[\"wrote\"])"'
# Cổng P: trên box sống — kế hoạch đang có vé P: PHẢI bị từ chối xoá:
docker exec agentbox-box python3 /usr/local/bin/migrate_plans.py --delete-orphan v1-boxfox-5-upgrades.md
#   → {"error": "… đang được bản ghi P:boxfox-5-upgrades@v1 giữ …"} và exit code 2
cd backend && python3 -m pytest tests/unit -q -k "plan_registry or write_plan"
```

---

## Phần D — Trần độ dài **câu trả lời** (D-4)

### D.0 Hiện trạng, đã kiểm lại

- Ngưỡng **kế hoạch** đã chạy: `plan_eval.PLAN_MAX_CHARS = 150_000`, `PLAN_WARN_CHARS = 40_000`
  (`backend/src/agentbox/agent_core/plan_eval.py:72-75`), P7 = 0 khi `chars > PLAN_MAX_CHARS` (`:582-591`),
  câu chữa `'plan-too-long'` (`:96-99`). **Giữ nguyên** — D-4 nói về câu trả lời.
- Câu trả lời **không** có trần nào: `runtime.py:1696` chỉ kiểm "trọn vẹn và không rỗng", rồi `:1712-1713`
  phát nguyên văn và `:1702-1708` lưu nguyên hàng `assistant` vào `messages`.
- Hệ quả đo được (vòng 21): lượt nào trả lời dài là lượt đó dễ đứt ngân sách bước/hạn chót — và tới hôm nay
  đứt ngân sách nghĩa là **mất trắng** (BUG-42). Phần D này chặn ở **đầu ra**, Phần B chặn ở **đầu vào**.

### D.1 Việc

**D1 [parallel] — Hằng số + một dòng chỉ dẫn trong prompt**

- **Tệp:** `backend/src/agentbox/agent_core/limits.py` (cạnh `:64-72`): `ANSWER_WARN_CHARS = 60_000`,
  `ANSWER_MAX_CHARS = 150_000`, `ANSWER_LENGTH_WARN_CODE = 'ANSWER_LENGTH_WARN'`,
  `ANSWER_TOO_LONG_CODE = 'ANSWER_TOO_LONG'`; `backend/src/agentbox/agent_core/runtime.py:1108-1117` (khối prompt hệ thống).
- **Việc:** thêm vào prompt hệ thống một dòng: câu trả lời cuối giữ **dưới 60 000 ký tự**; nội dung dài phải ghi ra tệp
  trong workspace và **trích đường dẫn** thay vì dán vào câu trả lời. Dòng này phải là **một** chỗ (hằng số trong `limits.py`),
  không chép tay vào nhiều prompt vai.
- **Rủi ro:** prompt dài thêm ~120 ký tự cho mọi phiên — không đáng kể; đổi prompt là đổi hành vi model ⇒ đo lại ở E3.
- **Nghiệm thu:** `python3 -m pytest backend/tests/unit -q -k "runtime_info or prompt"` xanh; một ca khẳng định
  mọi prompt hệ thống (orchestrator + từng vai trong `roles.py`) đều chứa câu chỉ dẫn (không vai nào bị bỏ sót).

**D2 [after D1] — Cổng đo ở ranh giới câu trả lời**

- **Tệp:** `backend/src/agentbox/agent_core/runtime.py:1696-1727` (đường trả lời cuối cùng), `:1719-1721` (cờ `partial`),
  `:1724-1726` (`turn.end`); test mới `backend/tests/unit/test_answer_length.py`.
- **Việc:**
  - `chars = len(text)`; khi `ANSWER_WARN_CHARS < chars <= ANSWER_MAX_CHARS`: phát **một** notice bền
    `{'code': ANSWER_LENGTH_WARN_CODE, 'chars': chars, 'limit': ANSWER_WARN_CHARS, 'message': '…'}` +
    `system_log.write('answer.length', level='warn', …)`; câu trả lời **giữ nguyên**.
  - `chars > ANSWER_MAX_CHARS`: cắt `text` còn `ANSWER_MAX_CHARS` ký tự + một dòng cuối
    `\n[Answer truncated at 150000 chars — the full content must be written to a file in the workspace]`,
    phát notice bền `ANSWER_TOO_LONG_CODE` với `chars` / `keptChars`, ghim **một** hàng `X:` (dùng lại
    `_journal_blocker`-style qua `session_journal.insert_row`), và đặt lượt là `partial` (cùng cờ `partial` đã có ở
    `:1719`) ⇒ `turn_end.status == 'partial'` nhưng **vẫn `completed`** ở hàng `sessions` (luật bất biến #1).
  - Hàng `assistant` trong `messages` lưu **bản đã cắt** (ngữ cảnh gửi đi không được phình theo).
- **Rủi ro:** cắt giữa chừng làm mất thông tin ⇒ bù bằng dòng chỉ dẫn "ghi ra tệp" ngay trong văn bản cắt, cộng
  notice nói rõ `chars` gốc; và `stream` đã hiện cho người dùng nhiều hơn phần lưu (chấp nhận: transcript là bản chuẩn,
  ghi rõ trong docs).
- **Nghiệm thu:** `backend/tests/unit/test_answer_length.py` (fixture `answer()` như `test_child_truncation.py`):
  (a) text 70 000 ký tự ⇒ **một** notice `ANSWER_LENGTH_WARN`, text nguyên vẹn, `turn_end.status == 'completed'`;
  (b) text 200 000 ký tự ⇒ **một** notice `ANSWER_TOO_LONG` (`chars=200000`, `keptChars=150000`), hàng assistant cuối
  có đúng 150 000 + dòng cắt, `turn_end.status == 'partial'`, hàng `sessions` vẫn `completed`;
  (c) text 12 000 ký tự ⇒ **không** notice nào (không nhiễu).
  Giao diện: `npx vitest run src/components/chat/HarnessStepView` xanh + ca mới khẳng định notice `ANSWER_TOO_LONG`
  hiện qua bộ render notice sẵn có (`HarnessStepView.notice.test.tsx`).

### D.2 Nghiệm thu phần D

```bash
cd backend && python3 -m pytest tests/unit -q -k "answer_length or plan_eval"
# Ngưỡng plan KHÔNG được đổi trong đợt này:
python3 -c "from agentbox.agent_core.plan_eval import PLAN_WARN_CHARS, PLAN_MAX_CHARS; print(PLAN_WARN_CHARS, PLAN_MAX_CHARS)"  # 40000 150000
cd frontend && npx vitest run src/components/chat/HarnessStepView
```

---

## Phần E — Kiểm thử, nghiệm thu sống, ghi chép

### E.1 Việc

**E1 [after A*, B*, C*, D*] — Ba bộ unit test, chạy đủ**

- **Việc:** chạy và giữ xanh cả ba bộ; mọi khẳng định **cố ý đổi** phải nằm trong một danh sách ở PR
  (B2: ba dòng; B3: hợp đồng trần bước **+ chẩn đoán bốn phần**; A6: `ChatInputBar.controlSend.test.tsx:142`).
- **Nghiệm thu:**
  ```bash
  cd backend && python3 -m pytest tests/unit -q
  cd backend && python3 -m pytest tests/unit -q -k "partial_budget or child_diagnosis"   # ca bắt buộc của chủ nhà
  cd frontend && npx vitest run
  cd frontend && npx tsc -b --noEmit          # kiểu adapter `onSend` đổi ⇒ bắt buộc
  cd deploy/docker && python3 -m pytest tests -q
  ```
- **Ca (f) — bắt buộc theo yêu cầu mới (§ 0.5):** `backend/tests/unit/test_child_diagnosis.py::test_budget_exhausted_child_returns_diagnosis`
  phải **xanh**: con dùng hết ngân sách (cả trần bước lẫn hạn chót) trả `partial` + `answerChars > 0` + chẩn đoán **bốn phần**
  cho cha, **không** còn `failed` trắng như BUG-42 (`answerChars = 0`); ca con lỗi provider thật vẫn `failed`.

**E2 [after A7, B3] — Tích hợp ở tầng harness (có/không có attachment)**

- **Việc:** một ca chạy thật qua HTTP của harness (`aiohttp.test_utils`, mẫu `test_limits_notice.py:65-102`):
  mở phiên → `POST /turns` với `{prompt, attachments:[{path:'uploads/x.md', name:'x.md', sizeBytes:12}]}` →
  đọc lại `GET /sessions/{sid}`: event `user` có `attachments`, text gửi model (đọc từ `FixtureModel.requests`) chứa
  `/home/agent/workspace/uploads/x.md`; và một ca chạm trần bước nhỏ (`maxSteps: 1`) ⇒ `turn_end.status == 'partial'`
  với nội dung không rỗng; cộng một ca `delegate` với con `maxSteps: 3` ⇒ kết quả trả về cha có `diagnosis is True`
  và `answerChars > 0` (nửa tích hợp của ca (f) ở E1, chạy qua HTTP thật của harness thay vì gọi thẳng `delegate`).
- **Nghiệm thu:** `python3 -m pytest backend/tests/unit -q -k "turn_attachments or partial_budget"` xanh.

**E3 [after A1-A10, B1-B10] — Một lượt thử sống đầu-cuối qua `localhost:3100` (tiêu chí đóng đợt)**

- **Điều kiện chạy:** harness `:3102`, router `:3101`, Vite `:3100`; harness **chỉ nhận `Origin` loopback**
  (`backend/src/agentbox/api/server.py:119-139`) ⇒ mọi lượt thử sống phải đi qua `http://localhost:3100`
  (URL xem trước công khai là chỉ-đọc). Box `agentbox-box` phải đang chạy.
- **Việc:** kịch bản `agent-browser`, ghi ảnh vào `/code/.generated_artifacts/images/foundation_*.png`:
  ```bash
  printf 'FOUNDATION-E2E-%s\n' "$(date -u +%Y%m%dT%H%M%S)" > /var/tmp/foundation-e2e.md
  agent-browser --session foundation open http://localhost:3100
  agent-browser --session foundation click 'button[title="Thêm đính kèm / Tệp tin / Hình ảnh"]'
  agent-browser --session foundation upload '[data-testid="attach-file-input"]' /var/tmp/foundation-e2e.md
  agent-browser --session foundation snapshot                      # thấy chip tên tệp + kích thước
  agent-browser --session foundation screenshot /code/.generated_artifacts/images/foundation_e2e_01_chip.png
  agent-browser --session foundation fill 'textarea[aria-label="Message"]' 'Đọc tệp vừa đính kèm và in ra đúng dòng đầu tiên.'
  agent-browser --session foundation press Enter
  agent-browser --session foundation screenshot /code/.generated_artifacts/images/foundation_e2e_02_sent.png
  ```
  Ba phép kiểm **bắt buộc** (đây là tiêu chí đóng đợt, không phải ảnh):
  1. **Nội dung vào box, đúng byte:**
     `docker exec agentbox-box sh -lc 'ls -l /home/agent/workspace/.uploaded_artifacts'` phải có `<n>.md` **mới**;
     `docker exec agentbox-box sh -lc 'cat /home/agent/workspace/.uploaded_artifacts/<n>.md' | diff - /var/tmp/foundation-e2e.md`
     ⇒ **không khác byte nào**.
  2. **Đường dẫn vào lượt:** event `user` cuối của phiên phải có `attachments[0].path` khớp `<n>.md` và text gửi model
     chứa đường dẫn tuyệt đối (đọc bằng lệnh `curl` ở A.2 mục 3).
  3. **Menu bấm được:** hit-test ở A.2 mục 1 trả `true` **trước** khi bấm (đây là bằng chứng BUG-39 đã hết).
- **Rủi ro:** router không có model ⇒ bước "agent trả lời" không chạy được; khi đó ghi rõ trong log là
  "chưa đo được phần model" và **vẫn** đóng đợt bằng ba phép kiểm trên (chúng không cần model).
- **Nghiệm thu:** ba phép kiểm trên xanh; ảnh lưu ở `/code/.generated_artifacts/images/foundation_*.png`.

**E4 [after E3] — Ghi chép (bắt buộc, cùng PR)**

- **Tệp:** `docs/tracking/test-rounds.md` (thêm mục `## Vòng 22 — đợt foundation (…, ngày …)`),
  `docs/tracking/bug-register.md` (§ 6.22 → cập nhật trạng thái BUG-39…BUG-42; BUG-43 để **nguyên** vì thuộc đợt peer-mesh),
  `docs/tracking/owner-decisions.md` (bảng § 1: D-1 → ghi **số của con 40 bước / 300 s** (chốt 2026-09-22) rồi `Đang thi công`
  → `Đã xong` khi E3 xanh; D-2…D-5 → `Đang thi công` khi bắt đầu, `Đã xong` khi E3 xanh; § 2: D-6 → `Đã xong` khi E3 xanh;
  **thêm một hàng mới** cho yêu cầu "chẩn đoán chỗ tắc khi chạm trần/hạn chót" (D-11, `Đã chốt`, ngày 2026-09-22, chủ nhà Nam Nam)
  — **không** xoá hàng cũ, **không** đổi mã D-1…D-10; thêm một dòng vào § 4 *Lịch sử sửa đổi* với ngày + tên chủ nhà),
  `docs/naming.md` (nếu A3/C1 sinh tên mới).
- **Việc:** mỗi mục ghi **số đo**, không ghi cảm nhận: số tệp trong `.uploaded_artifacts` trước/sau, byte khớp,
  `stepsUsed` của lượt thử, mã notice xuất hiện, số hàng `X:` mới, `stepsUsed`/`diagnosis` của lượt con chạm trần,
  `CHILD_MAX_STEPS`/`CHILD_DEADLINE_SECONDS` thực tế nhận được (bị kẹp theo cha hay không). Bảng lỗi theo RULE-20 (mã HOA,
  không zero-pad, bộ đếm chạy tiếp — số tiếp theo của § 6.22 là **44**).
- **Nghiệm thu:** `git diff --stat` chỉ chạm bốn tệp docs trên + các tệp code của A/B/C/D; mọi con số trong log truy được về
  một lệnh đã chạy.

**E5 [after A1, A2, A6, A10] — Bàn giao thiết kế cho phần giao diện**

- **Việc:** ba mặt giao diện của đợt này (popover `+` sau khi portal, hàng chip đính kèm trong ô soạn tin, hàng chip
  tệp đính kèm trên bong bóng người dùng) phải dùng mockup của đợt thiết kế song song (thư mục `docs/design/v22/`,
  đợt `design-v22`), gắn vào **Design-tab** của plan approval. Nếu mockup chưa có khi thi công A1/A2/A6/A10, việc
  thi công **giữ nguyên hành vi + bố cục hiện tại**, chỉ đổi vị trí render (portal) và thêm chip — không tự thiết kế lại.
- **Rủi ro:** mockup tới sau ⇒ lệch nhỏ về nhãn/chỗ đứng; chấp nhận được vì A1/A2/A6/A10 là thay đổi cấu trúc, không phải mỹ thuật.
- **Nghiệm thu:** ảnh E3 khớp bố cục mockup (hoặc ghi rõ chỗ lệch + lý do trong PR).

### E.2 Điều kiện đóng đợt

**Ba lệnh chạy toàn kho (chạy trước khi ghi sổ):**

```bash
cd backend && python3 -m pytest tests/unit -q
cd frontend && npx vitest run && npx tsc -b --noEmit
cd deploy/docker && python3 -m pytest tests -q
```

**Bốn lệnh nghiệm thu sống** (nguyên văn ở `A.2`, mục 1–4) + hai lệnh sống của Phần B (**B.2**) + các phép kiểm dưới đây:

1. Menu `+` bấm được (hit-test `true`) và **cả bốn** mục đúng như hiển thị (Drive nói thật "chưa kết nối").
2. Lượt gửi kèm tệp: `.uploaded_artifacts/<số>.<ext>` **mới** trong box, nội dung **khớp byte**, đường dẫn thật trong
   event `user` **và** trong ngữ cảnh gửi model.
3. Hai lần upload song song không trùng số (`uniq -d` rỗng).
4. Lượt chạm trần bước/hạn chót: hàng `sessions` `completed`, `turn_end.status == 'partial'`, **một** notice
   `STEP_BUDGET_EXHAUSTED`/`DEADLINE_EXCEEDED` với `diagnosis: True`, câu trả lời cuối **không rỗng** và có **bốn phần**
   (đã làm / tắc ở đâu / còn lại / thử gì tiếp), một `blocker` + một hàng `X:`.
5. **Con** dùng hết ngân sách ⇒ cha nhận `status='partial'`, `diagnosis is True`, `answerChars > 0` (không còn `failed` trắng
   như đo ở BUG-42); con lỗi provider thật vẫn `failed`. Ngân sách con nhận được là `min(40, cha)` bước / `min(300, cha)` giây.
6. `maxSteps: 999` ⇒ **một** notice `STEPS_CLAMPED`; `maxSteps` mặc định trong `runtime-info` = **40**.
7. `migrate_plans.py --apply` trên **bản sao** ⇒ có `.plans-backups/<UTC>/` + `manifest.json` khớp sha256, chạy lại ⇒
   `nothingToDo`; `--delete-orphan` **từ chối** tệp đang có vé `P:` (exit 2).
8. Dải jaccard: lần 1 từ chối, lần 2 (nguyên văn) nhận và `P:` mang `identityAmbiguity`, lần 3 không sinh `v1-…` thứ hai.
9. Câu trả lời 200 000 ký tự ⇒ notice `ANSWER_TOO_LONG`, `turn_end.status == 'partial'`; 70 000 ⇒ chỉ cảnh báo;
   ngưỡng plan vẫn `40 000 / 150 000`.
10. Ba bộ test xanh + `tsc -b --noEmit` sạch; bốn tệp docs đã cập nhật (kể cả hàng mới cho yêu cầu chẩn đoán chỗ tắc).

---

## Bảng rủi ro tổng

| Rủi ro | Ảnh hưởng | Cách chặn |
|---|---|---|
| Trần 25 MiB làm panel Workspace Files không upload được tệp lớn như trước | người dùng thấy hồi quy | Ghi rõ trong `docs/architecture/workspace-files.md` + thông báo lỗi nói ra con số (A3) |
| Lượt chốt + cửa sổ chẩn đoán (B3/B4) thêm lời gọi provider | tốn token, chậm thêm ≤ 30 s | Ba trần cứng: `WRAP_UP_STEPS_RESERVED = 3`, `WRAP_UP_READ_TOOL_CALLS = 2`, `WRAP_UP_TIMEOUT_SECONDS = 30`; chỉ chạy khi đã chạm trần/hạn chót |
| Giữ chỗ 3 bước làm việc hữu ích ngắn đi | lượt 40 bước còn 37 bước "bình thường" | Số đo vòng 21: việc vừa phải 8 bước, việc dài 27 bước ⇒ 37 vẫn dư; `WRAP_UP_STEPS_RESERVED` là hằng số đổi được |
| Chẩn đoán sai (model mô tả nhầm chỗ tắc) | người dùng tin nhầm | Chẩn đoán là **văn bản của model**, có `stepsUsed`/`reason`/đường dẫn trong notice để người đọc đối chiếu; E3 kiểm bằng byte trên đĩa chứ không tin lời |
| Trần con 300 s > hạn chót mặc định của cha 180 s | tưởng con được 300 s | `min()` với cấu hình cha (`runtime.py:2504-2511`) ⇒ 180 s khi cha mặc định; B6 khẳng định bằng test |
| `.plans-backups` mọc trong workspace | rác | Nằm ngoài `.plans` (bộ đọc đệ quy sẽ nhặt bản sao), ghi vào docs, xoá tay được |
| `--delete-orphan` xoá nhầm một kế hoạch đang được dùng | mất dữ liệu | Mặc định **từ chối** khi thấy hàng `P:`; `--dry-run` không chạm đĩa; backup của C1 chạy trước |
| Ảnh inline làm thân request vượt 1 MiB (`server.py:150`) | 413, lượt chết | Trần tổng 800 000 ký tự (A7) + cắt còn 2 ảnh ở client (A6) |
| Nhân `partial` cho con làm cha xử lý khác đi | hành vi cũ phụ thuộc `status == 'completed'` | B5 đổi **một** chỗ (`delegate`), giữ nguyên bộ `status` cũ; `test_child_truncation.py` là lưới |
| Đổi `MAX_STEPS`/`DEADLINE` sang mã mới | log/event cũ đọc theo mã cũ | Giữ cả hai mã cũ trong `KNOWN_PREFIXES`, chỉ **đổi mã mới** (B2) |
| `tool_choice: 'required'` bị provider từ chối | lượt thử lại (B8) hỏng | Chọn nhánh theo `thinkingLevel`; provider từ chối ⇒ rơi về `failed` như cũ, không vòng lặp |

## Những chỗ **không** làm trong đợt này (để không phình phạm vi)

1. **Sub-agent nhìn thấy nhau** (C1–C10 của bản phác) — đợt kế tiếp, không đụng `delegate` ngoài B5/B6.
2. **BUG-43** (bảng Sub-agents theo turn) — thuộc đợt peer-mesh; đợt này chỉ giữ nguyên `child` event.
3. **Bằng chứng sống ở câu trả lời cuối** (Phần D của bản phác) — đợt `evidence-proof` đã có plan riêng
   (`docs/plan/v22/evidence-proof.md`).
4. **Ngưỡng độ dài plan** (`plan_eval.py:72-75`) — giữ 40 000/150 000; D-4 chỉ áp cho câu trả lời.
5. **Đổi `list_directory` để ẩn tệp ẩn** — không đổi (test `test_workspace_files.py:103` đang khoá hành vi `.env` phải hiện).

## Giao với các đợt song song (đọc trước khi xếp lịch hợp nhất)

Đợt này là **đợt nền**: hai đợt khác đang soạn cùng lúc sẽ đụng vào đúng những dòng ở đây. Thứ tự đề nghị:
**foundation trước**, rồi mới tới các đợt kia — vì ngữ nghĩa `partial` của lượt và bộ đếm bước là thứ hai đợt kia
giả định đã có.

| Đợt | Tệp chồng lấn | Điểm chạm cụ thể | Đề nghị |
|---|---|---|---|
| `v1-peer-mesh.md` (18 việc: fan-out, `peer_read`, `await_children`) | `runtime.py` (`delegate` `:2492-2565`, `turn_end`, `session_metrics`, `runtime_info`), `limits.py`, `session_store.py` | B5/B6/B10 đổi `delegate` (con `partial` + **chẩn đoán** + trần 40/300); peer T5/T6/T7 **viết lại** `delegate` (nhiều con, `wait=false`) và T2/T3 thêm `turn` vào **cùng** dict `child`/`turn_end`; T13 thêm trần thời gian con (900 s) vào `limits.py` | Hợp nhất B5/B6/B10 trước; peer dùng lại `stepsUsed`/`deadlineUsedMs` (B9) chứ không đặt tên mới; trần của peer phải **lớn hơn hoặc bằng** `CHILD_MAX_STEPS`/`CHILD_DEADLINE_SECONDS` (B1 = 40/300); cửa sổ chẩn đoán (`WRAP_UP_STEPS_RESERVED`) phải trừ vào ngân sách con **của peer** nữa |
| `v1-evidence-proof.md` (bằng chứng sống ở câu trả lời cuối) | `runtime.py` (đường trả lời cuối `:1696-1727`), `HarnessStepView.tsx` | D2 cắt câu trả lời ở 150 000 và đặt `partial`; đợt kia thêm **cổng bằng chứng** trên cùng đoạn code | Làm D2 trước (nhỏ, có hằng số riêng), rồi cổng bằng chứng đứng cạnh — hai cổng độc lập, không chung `notice` |
| `v1-peer-mesh.md` T4 (BUG-43: bảng Sub-agents theo lượt) | `SubagentInspectorPanel.tsx`, `harnessChatStore.ts` | Đợt này **không** chạm (A10 chỉ đọc `userEvent`) | Không xung đột |
| đợt thiết kế `design-v22` | `docs/design/v22/` | A1/A2/A6/A10 dùng mockup (E5) | Gắn mockup vào Design-tab của plan approval |

## Chủ nhà đã chốt (2026-09-22) — không còn câu hỏi mở ở Phần B

**Ngân sách phiên con: 40 bước / 300 s** ⇒ `CHILD_MAX_STEPS = 40`, `CHILD_DEADLINE_SECONDS = 300` (B1, B6), vẫn bị `min()`
kẹp theo cấu hình cha (cha mặc định 180 s ⇒ con 180 s). **Kèm theo: yêu cầu chẩn đoán chỗ tắc** khi chạm trần/hạn chót
(cả cha lẫn con) — `WRAP_UP_STEPS_RESERVED = 3` bước + tối đa `WRAP_UP_READ_TOOL_CALLS = 2` lời gọi tool đọc + **một** lời gọi
chốt có trần, rồi trả `partial` với chẩn đoán bốn phần (B3, B4, B10; ca nghiệm thu bắt buộc ở E1 và B10).

Cả hai điều được ghi vào `docs/tracking/owner-decisions.md` ở **E4** (hàng D-1 cập nhật số của con; thêm một hàng mới cho
yêu cầu chẩn đoán, mã **D-11**, ngày 2026-09-22, chủ nhà Nam Nam; không xoá hàng cũ). Phần còn lại của kế hoạch **không** đổi
so với các quyết định D-1…D-6 đã khoá trước đó.

