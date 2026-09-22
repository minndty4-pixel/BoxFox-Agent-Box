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
| BOX-5 | `<workspace>/.plans-backups/<UTC>/manifest.json` — `createdAt`, `root`, `fileCount`, `totalBytes`, `reason` (báo cáo dry-run của chính lần chạy đó), `files[]` với `relativePath` + `sizeBytes` + `sha256` | `deploy/docker/migrate_plans.py` | `sha256` để chứng minh bản sao là từng byte của bản gốc, không phải lời hứa |
| BOX-5 | Bản sao giữ **đúng cây con** của `.plans` (`subplans/v2-x.md` → `<UTC>/subplans/v2-x.md`) | `deploy/docker/migrate_plans.py` | Khôi phục = `cp -a <UTC>/. <workspace>/.plans/` |

Ba hệ quả của luật này:

1. **Nằm NGOÀI `.plans`, cạnh nó.** Bộ đọc `plan_files.py` đi đệ quy trong `.plans` và sẽ nhặt bản
   sao thành những kế hoạch thứ hai; ngoài ra `<UTC>/v1-…` không có header nên còn sinh `mismatch`.
2. **Không nằm trong `PROTECTED_PATHS`** (`deploy/docker/workspace_files.py`) — đây là rác đọc được và
   xoá được tay; chỉ `--delete-orphan` mới có cổng từ chối, còn bản sao thì `rm -rf` là xong.
3. **Không đặt lại bộ đếm, không ghi đè:** mỗi lần chạy một thư mục `<UTC>` mới — kể cả khi chỗ đã
   được chỉ bằng `--backup-dir`; ghi hỏng thì cả thư mục vừa tạo bị bỏ đi và `.plans` không đổi một
   byte (*hoặc có bản sao, hoặc không chạy*).

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
