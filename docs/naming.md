# Quy luật đặt tên và đánh số

Tài liệu này ghi lại **cách hệ thống và agent đặt tên tệp, tăng số, và giữ bộ đếm** — để một cái tên
tự nói được nó thuộc vòng nào, phiên nào, bản thứ mấy, mà không cần mở tệp. Đợt 20 đo trên máy chủ
nhà: **151 tệp lịch sử nén, 70 khoá phiên, 375 ảnh/ghi hình, 22 hàng checkpoint** — và tách được
**9 luật do hệ thống tự sinh (không ai đổi được)** khỏi **20 luật chỉ là thói quen lặp lại**. Phần
"thói quen" nào chạm tới dữ liệu chạy thật thì đợt này được **viết vào code** thay vì mong agent nhớ.

## 1. Hai loại luật

| Loại | Nghĩa | Hệ quả thi công |
|---|---|---|
| **BẮT BUỘC** | Nền tảng hoặc harness tự tạo tên và tự tăng số; agent không đổi được tên, bề rộng, hay thứ tự | Chỉ cần dùng đúng; sai là do đọc nhầm, không phải do quên |
| **THÓI QUEN** | Không có cơ chế nào ép; chỉ là khuôn lặp lại quan sát được | Muốn giữ thì phải **viết vào code hoặc vào skill**; tài liệu này là bản ghi, không phải bộ ép |

## 2. Luật bắt buộc (hệ thống cấp)

| Mã | Khuôn | Bề rộng | Ví dụ |
|---|---|---|---|
| RULE-1 | `.session-history/<khoá-agent>/compaction_NNN.md` | 3 chữ số, bắt đầu `001`, **liên tục, cộng dồn** | `general_agent/compaction_001.md` … `_032.md` |
| RULE-2 | `<khoá-agent>` = `general_agent` cho agent chính, `subagent_<task-id>` cho tác vụ con | — | 1 + 69 = 70 thư mục |
| RULE-3 | `.virtual_views/<khoá-agent>/virtual_view_NNN.md` song song 1-1 với `RULE-1` | 3 chữ số | `diff` bảng số tệp hai cây = giống hệt |
| RULE-4 | `.trimmed-tool-output/<khoá-agent>/msg_NNNN.txt`, số là **chỉ số tin nhắn gốc** | 4 chữ số, **có lỗ trống** | `msg_0003.txt`, `msg_0005.txt` |
| RULE-5 | `.uploaded_artifacts/<số>.<ext>`, số do nền tảng cấp | không zero-pad, tăng một chiều | `3061.png` … `3090.png` |
| RULE-6 | `video_<hash8>_<epoch>_grid_<N>.png` | `N` **bắt đầu từ `0`** | `video_e12e05ed7d_1789986451_grid_0.png` |
| RULE-7 | `/memory/sessions/<ISO8601-cơ-bản>-<session-id>.jsonl`, bản con thêm `-subagent-<task-id>` | — | `20260919T151406Z-35bb01f2-…-subagent-scout-001.jsonl` |
| RULE-8 | Nội dung `compaction_NNN.md` là **JSON** (`timestamp`, `message_count`, `messages`) dù đuôi `.md` | — | dòng 1–4 của mọi tệp |
| RULE-29 | **Số tăng đơn điệu theo thời gian, chỉ ghi thêm, không chèn giữa, không ghi đè** | — | 32/32 bản ghi `general_agent` sắp theo số là sắp theo thời gian |

## 3. Luật do code ép trong box (đợt 20)

Ba khuôn dưới đây trước đây là "thói quen"; đợt 20 chuyển thành **hằng số có tên trong code**, sai là
có test đỏ:

| Mã | Khuôn | Ai ép | Ghi chú |
|---|---|---|---|
| BOX-1 | `<workspace>/.session-history/<sid8>/` — `session.json`, `journal.jsonl`, `journal.md`, `checkpoints/` | `deploy/docker/session_files.py` | `<sid8>` = 8 ký tự đầu của id phiên; hai phiên chạy song song không lẫn tệp |
| BOX-2 | `checkpoints/ck-<sid8>-<n>.json` + `.md`, `n` **3 chữ số bắt đầu `001`**, đếm theo thư mục phiên, cộng dồn không lỗ | `deploy/docker/session_files.py` | `.json` là bản máy đọc (đúng bằng `messages` đã lưu), `.md` là bản người đọc; ghi tạm rồi đổi tên, **không để lại tệp nửa vời** |
| BOX-3 | `<capture root>/<sid8>/<sid8>_<step>_<slug>.<ext>` | `deploy/docker/capture.py` | Đường dẫn phẳng cũ vẫn đọc được (không phá 100 000 hàng `events` cũ) |
| BOX-4 | Trần dung lượng ảnh/ghi hình: **200 tệp/loại/phiên, 512 MiB/phiên, 4 GiB/toàn box, 40 mp4/phiên** | `deploy/docker/session_files.py` | Mỗi lần dọn ghim một bản ghi `X:` nói rõ đã xoá gì |

Bản ghi nhật ký dùng tiền tố một ký tự, mỗi dòng một bản ghi JSONL (tám mã, theo
`agent_core/journal.py`):

| Tiền tố | `kind` | Nghĩa | Trạng thái hợp lệ |
|---|---|---|---|
| `T:` | `task` | một việc/mục tiêu của phiên | `open`, `doing`, `done`, `blocked` |
| `P:` | `plan` | ghim kế hoạch đã ghi: `P:<identity>@v<số>` | `draft`, `approved`, `superseded` |
| `S:` | `step` | một bước đã chạy | `doing`, `done`, `failed` |
| `D:` | `decision` | một quyết định (của người dùng hoặc của agent) | `approved`, `rejected`, `info` |
| `E:` | `evidence` | bằng chứng sinh ra (tệp, ảnh, lệnh) | `info` |
| `C:` | `checkpoint` | một lần nén: số tin nhắn, ước lượng token trước/sau | `recorded`, `degraded` |
| `F:` | `fact` | một sự kiện đã đo, còn đúng về sau | `info`, `superseded` |
| `X:` | `blocker` | chỗ tắc / hành động dọn dẹp | `blocked`, `failed`, `resolved`, `done` |

Mã bản ghi: `T:<sid8>-<n>`, `S:<sid8>-<n>`… (một chiều, `1`-based), riêng `P:` lấy mã từ
`<slug>@v<số>`. Khối "ký ức" chèn vào system prompt được dựng lại từ chính các bản ghi này (nhóm
`mục tiêu` / `đã xong` / `đang làm` / `đang tắc` / `việc kế tiếp` / `quyết định còn mở`).

## 4. Luật chỉ là thói quen (agent phải tự giữ)

| Mã | Khuôn | Nơi quy định |
|---|---|---|
| RULE-9 | `v<N>-<feature>.md` + `v<N>-<feature>-summary.md`, **cùng số `N`**, sửa thì tăng **cả hai** | skill lập kế hoạch |
| RULE-10 | Một kế hoạch một tiêu đề; giữ tiêu đề cũ = sửa bản cũ, tiêu đề khác = kế hoạch mới | ràng buộc nền tảng |
| RULE-11 | Các phần kế hoạch đánh chữ cái `## Kế hoạch A…F` | thói quen |
| RULE-12 | Việc trong một phần đánh số liên tục kèm nhãn phụ thuộc `**[parallel]**` / `**[after X, Y]**` | thói quen |
| RULE-13 | Kế hoạch nhiều nhánh: mã việc = **chữ nhánh + số** (`C1`, `D4`); nhãn phụ thuộc viết tiếng Việt | thói quen |
| RULE-14 | Kế hoạch con: `.plans/subplans/r<N>-<chủ đề>.md` (+ `-summary.md`) | thói quen |
| RULE-15 | Bản nháp một phần: `.plans/r<N>-section-<chủ đề>.md` | thói quen |
| RULE-16 | Mockup: `designs/r<N>-<scope>-<biến thể>.html`; kế hoạch thiết kế: `designs/design-plan-r<N>-<scope>.json`; mỗi agent một `<scope>` riêng | skill thiết kế |
| RULE-17 | Mã tác vụ con: `<chữ vai><vòng>[<lô>]-<slug>`; vai `r`/`b`/`d`/`p`/`ex`; lô `b`/`c` = lô hai/ba | thói quen |
| RULE-18 | Nhật ký vòng `## Vòng <N> — <tên> (<ngày>)`, `N` **không đặt lại**, cho phép `15b`, `17c`, dải `16–17` | thói quen |
| RULE-19 | Sổ lỗi: `## <số>.` rồi từ §6 chuyển sang `### 6.<N>` phẳng, không đặt lại | thói quen |
| RULE-20 | Mã lỗi `<TIỀN TỐ>-<số>` viết HOA, số không zero-pad, **bộ đếm chạy tiếp qua các đợt** | thói quen |
| RULE-21 | Bảng tiến độ mỗi vòng: 4 dòng cố định (Router / Harness / Giao diện / Kiểu) | thói quen |
| RULE-22 | Bảng lỗi mỗi đợt: cột cố định, từ vựng `ĐÃ SỬA` / `HOÃN` / `MỚI` | thói quen |
| RULE-23 | Artefact: `<vòng>_<slug>.<ext>` hoặc `<vòng>-<slug>.<ext>`, nhóm theo loại hoặc theo vòng | thói quen |
| RULE-24 | Báo cáo kiểm thử **một tệp cố định**, danh tính nằm ở `--title` chứ không ở tên tệp | thói quen |
| RULE-26 | **Hậu tố chữ cái sau một số = cùng đối tượng, lô/biến thể kế tiếp** (`Vòng 15b`, `r20b-*`, `c06a`–`c06e`) | thói quen |
| RULE-27 | Mọi bộ đếm một chiều và `1`-based, **trừ hai ngoại lệ có chủ đích**: `grid_<k>` từ `0`, và `msg_NNNN` theo chỉ số tin nhắn (có lỗ) | nửa hệ thống, nửa thói quen |
| RULE-28 | Thư mục tạm `/var/tmp/<vòng>/` không zero-pad, không hậu tố khi vòng chỉ có một lô | thói quen |

## 5. Bất biến chung

1. **Một chiều, chỉ ghi thêm.** Không đặt lại bộ đếm, không chèn giữa, không ghi đè bản cũ.
2. **`1`-based**, trừ hai ngoại lệ ở RULE-27.
3. **Bề rộng cố định theo cây**, không theo số lượng: 3 chữ số cho `compaction`/`checkpoint`, 4 cho
   `msg`.
4. **Không dấu hai chấm, không số thập phân trong tên tệp.** Phân tách bằng `_` hoặc `-`; slug viết
   thường kebab-case. (Ngoại lệ duy nhất là phần mở rộng của đường dẫn hệ thống, ví dụ `T:` trong
   nhật ký — đó là *nội dung* tệp, không phải tên tệp.)
5. **Hậu tố chữ cái không tạo đối tượng mới** — nó là lô kế tiếp của cùng đối tượng.
6. **Số phải đọc được từ tên tệp.** Nếu muốn biết "bản thứ mấy" mà phải mở tệp ra đếm thì tên đang
   thiếu luật.

## 6. Cách kiểm nhanh

```bash
# Lịch sử nén: bề rộng 3, liên tục, không tệp lạ
find .session-history -name 'compaction_*.md' | sed 's#.*/##' | sort | head
find .session-history -type f ! -regex '.*/compaction_[0-9][0-9][0-9]\.md'   # phải rỗng

# Bộ đếm có đơn điệu theo thời gian không (khoá timestamp ở dòng 2)
for f in .session-history/general_agent/compaction_*.md; do sed -n '2p' "$f"; done | sort -c

# Thư mục phiên trong box: hai phiên song song không lẫn tệp
ls -R "$BOX_WORKSPACE/.session-history"
```

Kiểm ở mức code: `deploy/docker/tests/test_session_files.py` và
`deploy/docker/tests/test_journal_naming.py` là nơi luật BOX-1…BOX-4 bị ép bằng test.

## 7. Thư mục sao lưu kế hoạch `.plans-backups` (đợt 22)

Chốt D-2 của chủ nhà: **sao lưu trước khi áp dụng**. `migrate_plans.py --apply` vì vậy luôn sao **từng
byte** mọi tệp `vN-*.md` dưới `.plans` (đệ quy, bỏ tệp tạm) vào một thư mục mới **trước** khi ghi:

| Mã | Khuôn | Ai ép | Ghi chú |
|---|---|---|---|
| BOX-5 | `<workspace>/.plans-backups/<UTC>/` — `<UTC>` = `%Y-%m-%dT%H-%M-%SZ`, mỗi lần chạy một thư mục | `deploy/docker/migrate_plans.py` | Đổi **chỗ** bằng `--backup-dir DIR` — bản sao vẫn vào `DIR/<UTC>/`, đổi chỗ chứ không đổi luật; không có cờ tắt |
| BOX-5 | `<workspace>/.plans-backups/<UTC>-<số>/` — `<số>` = `2`, `3`, … khi `<UTC>` đã có chủ | `deploy/docker/migrate_plans.py` (`free_backup_directory`) | `<UTC>` chỉ có độ phân giải **giây**, nên hai lượt `--apply` trong cùng một giây phải nhận hai thư mục anh em; dấu `-<số>` là chỗ trốn duy nhất để "mỗi lần chạy một thư mục" đúng cả trong trường hợp đó (BUG-46) |
| BOX-5 | `<workspace>/.plans-backups/<UTC>/manifest.json` — `createdAt`, `root`, `fileCount`, `totalBytes`, `reason` (báo cáo dry-run của chính lần chạy đó), `files[]` với `relativePath` + `sizeBytes` + `sha256` | `deploy/docker/migrate_plans.py` | `sha256` để chứng minh bản sao là từng byte của bản gốc, không phải lời hứa |
| BOX-5 | Bản sao giữ **đúng cây con** của `.plans` (`subplans/v2-x.md` → `<UTC>/subplans/v2-x.md`) | `deploy/docker/migrate_plans.py` | Khôi phục = `cp -a <UTC>/. <workspace>/.plans/` |

Ba hệ quả của luật này:

1. **Nằm NGOÀI `.plans`, cạnh nó.** Bộ đọc `plan_files.py` đi đệ quy trong `.plans` và sẽ nhặt bản
   sao thành những kế hoạch thứ hai; ngoài ra `<UTC>/v1-…` không có header nên còn sinh `mismatch`.
2. **Không nằm trong `PROTECTED_PATHS`** (`deploy/docker/workspace_files.py`) — đây là rác đọc được và
   xoá được tay; chỉ `--delete-orphan` mới có cổng từ chối, còn bản sao thì `rm -rf` là xong.
3. **Không đặt lại bộ đếm, không ghi đè:** mỗi lần chạy một thư mục `<UTC>` mới — kể cả khi chỗ đã
   được chỉ bằng `--backup-dir`; ghi hỏng thì cả thư mục vừa tạo bị bỏ đi và `.plans` không đổi một
   byte (*hoặc có bản sao, hoặc không chạy*). Trùng **giây** thì lấy thư mục anh em kế tiếp
   (`<UTC>-2`, `<UTC>-3`, …): khuôn `<UTC>` là tên duy nhất theo giây, không phải theo lần chạy, nên
   luật "mỗi lần một thư mục" phải được giữ bằng hậu tố chứ không thể dựa vào đồng hồ (BUG-46).

## 8. Vì sao `.session-history` KHÔNG đổi tên (D-5, đợt 22)

Chủ nhà chốt D-5: **giữ nguyên** luật BOX-1 (`<workspace>/.session-history/<sid8>/…`). Đổi tên nó — hoặc
đổi `journal.jsonl`/`journal.md` — là phá dữ liệu đang có ở ba nơi cùng lúc: (a) các thư mục phiên +
`INDEX.json` đã nằm đúng chỗ đó trong box (đo 2026-09-22: **8 → 9 thư mục phiên, 15 → 16 tệp, 128 → 140 KB
chỉ trong một buổi** — con số tự tăng khi có phiên mới, nên đổi tên là mất dữ liệu đang sống), (b) bản
đầy đủ ở `~/BoxFox/harness/sessions.sqlite` (bảng `journal`) tra theo id phiên, và (c) `backfill_history.DEFAULT_ROOT`
= `/home/agent/workspace/.session-history`. Ca test chống đổi tên: `deploy/docker/tests/test_session_files.py`
→ `SessionHistoryKeptTest` — khoá cả ba nơi, kể cả `box-entrypoint.sh` (`chmod 0750` + `chown 1000:1000`).

## 9. Số RULE-5 do BOX cấp, và trần dọn `.uploaded_artifacts` (D-6, đợt 22)

RULE-5 ở §2 vẫn đúng nguyên chữ ("số do nền tảng cấp") — đợt 22 chỉ định rõ **nền tảng = box**, và ghi
cơ chế đó thành luật có test đỏ khi sai:

| Mã | Khuôn | Ai ép | Ghi chú |
|---|---|---|---|
| BOX-6 | `.uploaded_artifacts/<số>.<ext>` — số do **box** cấp: `max(số đang có trong thư mục đích) + 1`, không zero-pad, bắt đầu từ **1** | `deploy/docker/workspace_files.py` (`write_upload(..., assign_number=True)`) | Không có tệp trạng thái: bộ đếm là `max + 1`. Tệp không có đuôi thì tên chỉ là số (`1`, `2`, …); tệp khác trong thư mục (`probe.md`) không tính vào dãy |
| BOX-6 | Cấp số bằng `O_CREAT\|O_EXCL` + thử lại số kế | `deploy/docker/workspace_files.py`, gọi từ `deploy/docker/ide-proxy.py` (`POST /__box/file/upload?assign=1`) | `ide-proxy` chạy `ThreadingHTTPServer`, nên hai tab gửi cùng lúc vẫn không bao giờ trùng số; đầy 200 lần thử ⇒ `409` chứ **không** ghi đè |
| BOX-6 | Tệp trong thư mục vừa chọn giữ nguyên cây: `<dir>/<thư mục cha>` + `mkdirs=1` (thư mục mới mode `0750`, chủ `1000:1000`) | `deploy/docker/workspace_files.py` (`_ensure_dirs`) | Không có `mkdirs` thì thư mục thiếu là `404`, không tự đoán chỗ ghi |
| BOX-6 | Trần một lần tải: **25 MiB/tệp** cho MỌI caller của route (kể cả panel Workspace Files) | `deploy/docker/workspace_files.py` (`UPLOAD_MAX_BYTES`) | **Cố ý** (D-6), không phải hồi quy của trần 256 MiB cũ |
| BOX-6 | Trần lưu trữ: **200 tệp / 500 MiB**, xoá **mtime cũ nhất trước**, giữ **số cao nhất của mỗi thư mục** | `deploy/docker/upload_files.py` (`UPLOAD_KEEP_MAX_FILES`, `UPLOAD_KEEP_MAX_BYTES`) | Neo số là điều kiện sống còn: xoá nó thì bộ đếm tụt và box cấp lại số đã dùng |

Hai hệ quả:

1. **`unlink` chỉ nằm trong `upload_files.prune`.** `upload_files.retention(...)` chỉ lập kế hoạch và
   trả báo cáo, nên `retention(dry_run=True)` không thể xoá một byte nào (test khoá điều này ở
   `deploy/docker/tests/test_upload_files.py`). Một lượt dọn ghim **đúng một** bản ghi `X:` (cùng luật
   BOX-4), không bao giờ một dòng cho mỗi tệp đã xoá.
2. **`.uploaded_artifacts` nằm trong `PROTECTED_PATHS`** (`deploy/docker/workspace_files.py`): panel
   Workspace Files không xoá/đổi tên được cả gốc, chỉ dọn được qua đường retention ở trên.

## 10. Tệp đính kèm của một lượt, và `file_read` trên tệp nhị phân (D-6, D-15 — đợt 22)

Hai khuôn dưới đây sinh ra từ BUG-39/BUG-40 và từ lượt đo sống ở vòng 22: mô hình chỉ đọc được tệp nếu
biết **đường dẫn thật trong box**, và chỉ biết mình đang cầm tệp nhị phân nếu harness nói thẳng ra.

| Mã | Khuôn | Ai ép | Ghi chú |
|---|---|---|---|
| BOX-7 | Hàng `attachments[]` của một lượt: `{name, path, absolutePath, sizeBytes, kind}`, `kind` ∈ {`file`, `folder-item`} | `backend/src/agentbox/agent_core/attachments.py` | `path` là đường dẫn **tương đối** trong workspace (không mở đầu `/`, không `..`, không byte NUL); `absolutePath` do **harness suy** = `/home/agent/workspace/<path>` — client gửi `absolutePath` gì cũng bị bỏ (bài kiểm gửi hẳn `/etc/passwd`) |
| BOX-7 | Khối ghim vào text gửi model: dòng đầu **`[Tệp đính kèm đã lưu trong box]`**, mỗi tệp một dòng **`- <absolutePath> (<name>, <size>)`** | `attachments.attachment_prompt_block`, gọi ở `agent_core/runtime.py` và `skills/runtime_commands.py` | Một nguồn cho cả hai đường (lượt thường và command/skill); `<size>` theo `format_size` (`23 B` / `12 KB` / `1.5 MB`) |
| BOX-7 | Trần một lượt: **20 tệp** ở ô soạn tin, **25 tệp** ở harness, **2 ảnh** inline, ảnh `≤ 700 000` ký tự, tổng ảnh `≤ 800 000` ký tự | `frontend/src/components/chat/AttachmentPicker.tsx` (`MAX_ATTACHMENTS_PER_TURN`, `MAX_ATTACHMENT_BYTES`, `MAX_ATTACHMENT_BYTES_PER_TURN`), `attachments.py` (`MAX_ATTACHMENTS`, `MAX_INLINE_MEDIA`, `MAX_INLINE_IMAGE_CHARS`, `INLINE_IMAGE_CHARS_TOTAL`) | Ô soạn tin chặn mềm (25 MiB/tệp, 100 MiB/lượt); harness là cổng ngoài ⇒ HTTP 400 `ATTACHMENTS_INVALID` / `IMAGE_LIMIT` / `IMAGE_LIMIT_TOTAL`, lượt không chạy. Hai con số tệp **khác nhau có chủ đích**: giao diện chặn sớm, harness chặn muộn |
| BOX-7 | Mỗi tệp trong khối là **đúng MỘT dòng**: `name`/`path`/`absolutePath` đi qua `one_line` (bỏ ký tự điều khiển, gộp khoảng trắng, chặn 500 ký tự đường dẫn / 200 ký tự tên) | `attachments.one_line`, `MAX_ATTACHMENT_PATH`, `MAX_ATTACHMENT_NAME` | Tên tệp là dữ liệu của client: một `
` lọt vào khối sẽ giả thêm dòng mà mô hình tin là lời của harness |
| BOX-7 | `sizeBytes` là **lời khai** của client, phải hữu hạn và dưới `MAX_ATTACHMENT_BYTES` (1 TiB); `format_size` trả `?` với mọi số không dùng được | `attachments.validate_attachments`, `attachments.format_size` | Vượt trần ⇒ 400 `ATTACHMENTS_INVALID`; số vô cực/NaN/hằng số khổng lồ trước bản vá nổ `OverflowError` ⇒ HTTP 500 |
| BOX-7 | Khối đi **cùng phiên con** của đường command/skill: nó đứng trước câu của người dùng trong thân của con | `skills/runtime_commands.py` (`_command_task`) | Mô hình làm việc thật của đường lệnh là con; chỉ ghép vào phiên cha thì tệp vẫn vô hình — đúng triệu chứng BUG-40 |
| BOX-8 | `file_read` trên tệp nhị phân trả **thêm** `encoding: "base64"`, `bytesRead`, `sizeBytes`, `truncated`; `content` cắt ở **30 000** ký tự base64 = **22 500 byte** đầu | `backend/src/agentbox/sandbox/worker.py` (`read_file_payload`, `BINARY_READ_CHARS`) | Nhị phân = **36 đuôi** trong `BINARY_EXTENSIONS`, hoặc 8 KiB đầu có byte `0x00`, hoặc tệp đuôi chữ mà giải mã UTF-8 hỏng; `truncated` nói **sự thật của phép đọc** (1 KiB nằm trọn ⇒ `False`) |
| BOX-8 | Đường tool native (không qua box) mở đầu bằng **`[Binary file: <tên>, size: <N> bytes]`** | `backend/src/agentbox/tools/file_ops.py` | Kèm `metadata["is_binary"] = True`; tệp chữ giữ nguyên hợp đồng cũ (không có `encoding`/`bytesRead`) |

Ba hệ quả:

1. **Tệp đính kèm là dữ liệu của client, đường dẫn tuyệt đối thì không.** `validate_attachments` chỉ nhận
   đường dẫn tương đối rồi tự dựng `absolutePath`, nên mô hình không bị đẩy ra ngoài workspace dù thân
   request gửi lên có gì.
2. **Không còn chuỗi giả `[Attached Files: …]`.** Trước đây ô soạn tin chỉ ghép **tên** tệp vào text
   (BUG-40) — mô hình "biết" có tệp mà không có cách nào mở; nay thứ duy nhất nói về tệp là khối
   `[Tệp đính kèm đã lưu trong box]` với đường dẫn đọc được.
3. **Đọc hỏng không làm chết lượt.** Trước A8, `file_read` gọi thẳng `read_text` nên một tệp `.png`/`.pdf`
   làm lượt chết `UnicodeDecodeError`, mô hình không đọc được gì và người dùng không biết vì sao; nay
   đường nhị phân trả base64 kèm số byte, còn tệp đuôi chữ hỏng UTF-8 rơi xuống đúng đường đó.
4. **Khối là chỗ tin cậy, nên client không ghép được dòng nào trong đó.** Tên và đường dẫn đi qua
   `one_line`, số đi qua trần `MAX_ATTACHMENT_BYTES`, và cả danh sách được kiểm ở **cửa admission**
   (`RuntimeCommands.submit`) TRƯỚC khi ghi hàng `command_invocations`: một lượt sai là 400, không
   phải một hàng `running` mắc kẹt chặn luôn lần thử lại cùng `invocationId`.

## 11. Phòng hồ sơ `.research` và mã dòng sổ nguồn `r<N>` (vòng 27)

Đường research không kể chuyện vào chat rồi quên: kết quả đọng lại thành **hồ sơ** trong workspace, và mỗi
câu trong hồ sơ trỏ về **một dòng sổ nguồn** do harness cấp số. Tên phòng, tên tệp và mã dòng là hợp đồng
đóng băng ở `docs/plan/v27/subplans/flow.md` và ở trang `docs/architecture/research-agent.md` §2 — frontend
và backend đọc đúng những khuôn dưới đây.

| Mã | Khuôn | Ai ép | Ghi chú |
|---|---|---|---|
| BOX-9 | `<workspace>/.research/<việc>/v<N>-<việc>.md` — phòng `.research`, `<việc>` khớp `^[a-z0-9]+(-[a-z0-9]+)*$`, `N` bắt đầu từ **1**, **không zero-pad** | `backend/src/agentbox/sandbox/worker.py` (`DOSSIER_ROOM`, `DOSSIER_PATH_RE`, `DOSSIER_VERSION_RE`), `agent_core/limits.py` (`DOSSIER_ROOM`, `RESEARCH_SLUG_RE`) | Ghi lại một phiên bản đã có ⇒ `DOSSIER_VERSION_TAKEN`: bản cũ là bằng chứng, muốn sửa thì viết `v2` |
| BOX-9 | Sổ nguồn nằm cạnh hồ sơ: `<việc>/sources.jsonl` (máy đọc) + `<việc>/sources.md` (người đọc) ở **mức ≥ 2**; `tables/<tên>.md` + `review.md` ở **mức 3** | `worker.py` (`dossier_write_payload`, `dossier_sources_jsonl`, `dossier_sources_markdown`, `DOSSIER_TABLE_NAME_RE`) | `<tên>` là **một tên tệp**, không phải đường dẫn: `tables/gia-theo-quy.md` hợp lệ, `../x` là `DOSSIER_TABLE_INVALID` |
| BOX-9 | Mở đầu mỗi tệp hồ sơ: khối comment `<!-- boxfox-research` … `-->` bảy khoá `Version / ResearchId / Profile / Level / Critique / Gate / Rows` | `agent_core/research_header.py` (`HEADER_KEYS`); harness **dựng sẵn** rồi mới giao `markdown` cho `dossier_write` | Comment HTML chứ không front matter YAML: chủ nhà mở tệp trong trình duyệt workspace và không thấy khối này (cùng lựa chọn với `.plans/`, ADR-0003) |
| BOX-9 | Trần: **256 KiB mỗi tệp** (`DOSSIER_MAX_BYTES`), **400 dòng sổ mỗi hồ sơ** (`RESEARCH_MAX_ROWS_PER_DOSSIER`), đoạn trích **≥ 80** ký tự (`RESEARCH_MIN_EXCERPT_CHARS`) và cắt ở **2 000** (`SOURCE_EXCERPT_MAX_CHARS`) | `worker.py` (`DOSSIER_TOO_LARGE`), `agent_core/limits.py`, `agent_core/research_ledger.py` | Sàn 80 là điều kiện để một dòng được coi là **có bằng chứng**; 2 000 là chỗ harness **cắt**, không phải chỗ mô hình tự cắt |
| BOX-9 | **Mã dòng do harness cấp**: `r1`, `r2`, … — `max(số đang có) + 1` của **phiên**, không zero-pad; kỹ năng dạy viết `[r<N>]` trong câu và `**Nguồn:**` ở cuối | `backend/src/agentbox/memory/session_store.py` (`next_source_row_id`, `source_add`), `agent_core/research_quality.py` (`pinned_row_ids` quét `\b(r\d{1,4})\b`) | Mã có trong hồ sơ mà sổ không có ⇒ `research-sources-unproven` (cổng `enforce` từ chối hồ sơ); ghi lại cùng `row_id` là **idempotent** — trả hàng cũ, không sinh dòng thứ hai |
| BOX-9 | Mục bắt buộc theo mức: 1 = `Câu hỏi / Phát hiện / Nguồn`; 2 = + `Mâu thuẫn còn lại / Việc chưa làm`; 3 = + `Phản biện` | `agent_core/research_quality.py` (`DOSSIER_SECTIONS`, `missing_sections`, `SECTION_LABELS`) | Thiếu mục ⇒ `research-shape-missing`; tên mục khớp **không phân biệt hoa thường** và nhận cả biến thể tiếng Anh (`question`, `findings`, `sources`, `conflict`, `open`, `critique`) |

Hai hệ quả:

1. **Số là danh tính, không phải thứ tự trình bày.** Mã dòng đọc từ **mã lớn nhất** trong sổ của phiên, nên
   đánh số lại một hàng là chuyện không có: hồ sơ cũ vẫn trỏ đúng hàng cũ, và cổng chất lượng chỉ cần đối
   chiếu tập mã hai bên.
2. **Hồ sơ là tệp khách của workspace.** Mọi lần ghi đi qua op hộp `dossier_write` với đường dẫn khớp
   `DOSSIER_PATH_RE`, nên đường research không tự ý ghi ra ngoài `.research/` — giống `.plans/` (BOX-1) và
   `.uploaded_artifacts/` (BOX-6).
