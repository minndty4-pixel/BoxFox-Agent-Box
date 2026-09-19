# Workspace Files — API mặt box

> **Cập nhật**: 2026-08-28 — thêm nhóm endpoint `/__box/files*` và `/__box/file/*` để
> giao diện web duyệt/đọc/ghi file trong `/home/agent/workspace`. Tài liệu này bổ
> sung cho [sandbox.md](./sandbox.md) — chỉ mô tả phần box, không mô tả frontend.
>
> **Cập nhật**: 2026-09-19 (đợt 3) — thêm 5 route GHI file (`mkdir`, `touch`,
> `rename`, `move`, `delete`) với secret-gate trả **401**, xoá mềm vào `.trash`, và
> trạng thái duyệt plan (`POST /__box/plans/review` + trường `review` trong
> `GET /__box/plans`). Hợp đồng: `docs/plan/next-batch-contract.md` §2.

Module lõi: `deploy/docker/workspace_files.py` (stdlib thuần, không HTTP), được
`ide-proxy.py` import và route trực tiếp — cùng idiom với `plan_files.py` (chứa
đường dẫn an toàn qua `dir_fd` + `O_NOFOLLOW`, từ chối symlink) và `capture.py`
(hạ quyền về `agent` 1000:1000 qua `fchown`/`fchmod` và `gosu agent`).

## Endpoint

Quy ước: `path` là đường dẫn tương đối từ `WORKSPACE_ROOT` (chuỗi rỗng = thư mục
gốc). Lỗi có dạng `{"error": "<thông báo>"}`.

| Method | Endpoint | Auth | Mục đích |
|---|---|---|---|
| GET | `/__box/files?path=<rel>` | Origin | Liệt kê MỘT thư mục (dir trước file, ẩn `.generated_artifacts` + `.trash`) |
| GET | `/__box/file/content?path=<rel>` | Origin | Đọc text/code/md/json (413 quá lớn, 422 không UTF-8) |
| GET | `/__box/file/media?path=<rel>` | loopback + CORS phản chiếu | Raw bytes + `Content-Type` + `Range` (206) |
| GET | `/__box/file/thumbnail?path=<rel>` | loopback + CORS phản chiếu | JPEG thumbnail (ảnh/video, bỏ `.svg`) |
| GET | `/__box/file/download?path=<rel>` | loopback + CORS phản chiếu | Tải một file (`Content-Disposition: attachment`) + Range |
| POST | `/__box/files/zip` | Origin | Nén nhiều path thành zip |
| POST | `/__box/file/upload?path=<dir>&name=<file>` | secret | Ghi file raw (stream, fchown về agent) |
| POST | `/__box/file/unzip?path=<zipRel>` | secret | Giải nén vào thư mục cha (chống zip-slip, skip file trùng) |
| POST | `/__box/files/mkdir` | secret (401) | Tạo thư mục (tạo cả chuỗi cha còn thiếu) |
| POST | `/__box/files/touch` | secret (401) | Tạo file mới kèm nội dung tuỳ chọn (không ghi đè) |
| POST | `/__box/files/rename` | secret (401) | Đổi tên trong cùng thư mục |
| POST | `/__box/files/move` | secret (401) | Chuyển vào thư mục khác |
| POST | `/__box/files/delete` | secret (401) | Xoá MỀM: chuyển vào `.trash/` |
| POST | `/__box/plans/review` | secret (401, **không cần Origin**) | Lưu trạng thái duyệt plan (`.reviews/`) |

Năm route ghi của `/__box/files/*` chỉ nhận `POST` (method khác → `405`) và trả JSON
theo hợp đồng §2:

```jsonc
POST /__box/files/mkdir   {"path": "src/new", "exist_ok": false}  // → {"path","type":"directory"}
POST /__box/files/touch   {"path": "src/a.md", "content": "# A"}  // → {"path","type":"file","size"}
POST /__box/files/rename  {"path": "src/a.md", "name": "b.md"}    // → {"path","newPath"}
POST /__box/files/move    {"path": "src/a.md", "destination": "docs"} // → {"path","newPath"}
POST /__box/files/delete  {"path": "src/a.md"}                    // → {"path","trashPath":".trash/<epoch>-a.md"}
```

- Mọi `path` đi qua `validate_rel_path` (chuỗi rỗng = gốc, tối đa `MAX_DEPTH`); thoát
  khỏi `WORKSPACE_ROOT` → `400`.
- `mkdir`/`touch` tự tạo chuỗi thư mục cha còn thiếu (`src/` không có sẵn trong box) và
  dùng `dir_fd` + `O_NOFOLLOW`: đích đã tồn tại → `409` (trừ `mkdir` với `exist_ok: true`,
  khi đó đích phải thật là thư mục), `touch` **không bao giờ** ghi đè nội dung cũ.
- `rename`/`move` trả `409` khi đích đã tồn tại, khi đổi tên vào chính nó, hoặc khi
  chuyển thư mục vào chính nó; `404` khi nguồn/đích không tồn tại. `move` chỉ nhận
  thư mục đích đã tồn tại.
- File/thư mục mới thuộc `1000:1000` (`fchown`), mode `0o640` (file) / `0o750` (thư mục).

## Mô hình auth

- **Origin-gate** (JSON read: `files`, `file/content`, `files/zip`): kiểm tra
  `_origin_ok_for_box_api()` nghiêm ngặt như `/__box/plans`; 403 nếu Origin không
  hợp lệ. Đây là các lệnh gọi bằng `fetch` (luôn gửi `Origin`).
- **Secret-gate** (mutation: `upload`, `unzip`): chỉ nhận `X-BoxFox-Api-Key` qua
  `_secret_ok()` — giống `/__box/network`; Origin KHÔNG đủ. Tránh để process
  trong box tự ghi/deploy file chỉ bằng Origin giả.
- **Secret-gate 401** (`mkdir`, `touch`, `rename`, `move`, `delete`, `plans/review`):
  cùng `_secret_ok()` nhưng trả **401** thay vì 403, vì hợp đồng §2 quy định 401. Thiếu
  khoá thì không chạm đĩa (không tạo `.trash`). Riêng `plans/review` được xử lý TRƯỚC
  cổng Origin vì harness gọi server-to-server (không có header `Origin`).
- **Subresource** (`media`, `thumbnail`, `download`): trình duyệt không gửi
  `Origin` cho `<img>`/`<video>`/`<iframe>`/`<a download>`, nên ba endpoint này
  KHÔNG bắt buộc Origin; biên thật là bind loopback `127.0.0.1:8081` trong
  compose. Khi có Origin hợp lệ thì phản chiếu `Access-Control-Allow-Origin`.

## Range

`parse_range` hỗ trợ ba dạng trình duyệt/player thật gửi: `bytes=s-e` (đóng),
`bytes=s-` (mở, `end=size-1`), `bytes=-n` (n byte cuối). Hợp lệ → `206` +
`Content-Range: bytes s-e/size`; thiếu `Range` → `200` toàn bộ; `start>=size`
hoặc sai cú pháp → `416` + `Content-Range: bytes */size`. Stream theo chunk
64 KiB, không nạp cả file.

## Provenance (placeholder heuristic)

**Đây là luật tạm**, thống nhất với `frontend/src/lib/mock/workspace.ts`; backend
thật sẽ quyết định theo `source_kind` chứ không theo đường dẫn.

- `integrity`: `khong_tin_duoc` nếu bất kỳ segment nào nằm trong
  `{vendor, node_modules, .venv, dist, build, .cache}` HOẶC `basename == plan.md`
  (artifact do agent viết); ngược lại `duoc_nguoi_dung_cho_phep`.
- `confidentiality`: `bi_mat` nếu `basename` khớp `.env*` / `*.key` / `*.pem` /
  `id_rsa*` / `id_ed25519*`; ngược lại `cong_khai`.

Như vậy `.env` giữ integrity tin cậy nhưng confidentiality bí mật (khớp mock đánh
`.env` = SECRET); `vendor/**` không tin được.

## Xoá mềm (`.trash`)

`delete` **không bao giờ** xoá cứng: entry được `rename` vào `WORKSPACE_ROOT/.trash`
với tên `<epoch>-<name>` (trùng trong cùng giây → `<epoch>-<n>-<name>`, tối đa 1000 lần
thử). `trashPath` trả về là đường dẫn tương đối này để UI hiển thị "đã chuyển vào
thùng rác".

- Từ chối `409`: xoá gốc workspace, và ba tên bảo vệ ở cấp 1 là `.plans`, `.trash`,
  `.generated_artifacts` (file *bên trong* `.plans/` vẫn xoá được bình thường). Thiếu
  entry → `404`.
- **Luật bảo vệ dùng chung cho cả `rename` và `move`** (`_reject_protected_rel`): một
  mục cấp 1 trong `PROTECTED_PATHS` không đổi tên được, không di chuyển được, và
  cũng không nhận được mục khác (`move` từ chối cả `path` lẫn `destination` cấp 1
  bảo vệ — nếu không, `.plans` bị đổi tên thành `docs` sẽ làm rỗng tab Plan, `.trash`
  lộ ra listing, và một file có thể bị nhét vào `.trash` mà route `delete` chưa từng
  tạo). Mục con của chúng vẫn đi qua bình thường.
- `delete` là `rename` nên **cùng thiết bị** mới chạy: khác thiết bị (`EXDEV`) → `409`
  thay vì fallback sang copy.
- `.trash` nằm trong `HIDDEN_DIR_NAMES` nên bị ẩn khỏi `GET /__box/files` và khỏi zip
  (`_walk_dir_fd`), **nhưng chưa có chính sách hết hạn/dọn rác** — thư mục này lớn dần
  theo số lần xoá.

## Trạng thái duyệt plan (`.reviews`)

`POST /__box/plans/review` (secret-gate 401, không cần `Origin`) nhận
`{"identity": "<trần>", "decision": "approved" | "changes_requested", "note": ""}` và
trả `{"identity", "decision", "note", "updatedAt"}` (epoch giây, float).

- `identity` là **giá trị TRẦN** mà `GET /__box/plans` dùng để nhóm plan (slug ở gốc
  `.plans/`, `dir/slug` khi lồng nhau — `plan_files.py`), **không kèm tiền tố `vN-`**;
  version nằm ở tên file. Ánh xạ cố định, đảo ngược được:
  `.reviews/<identity>.json` với `/` thành thư mục con thật
  (`designs/login` → `.reviews/designs/login.json`). Vì là song ánh nên không cần thay
  `/` bằng `__` và hai identity khác nhau không bao giờ ghi đè nhau.
- Sai quy tắc tên (`validate_identity`), `decision` lạ, `note` không phải chuỗi, JSON
  sai, hoặc identity dài quá `MAX_IDENTITY_LENGTH` → `400`; `note` quá
  `MAX_NOTE_SIZE` → `413`. `updatedAt` không hợp lệ trong file bị đọc thành `null`.
- Ghi nguyên tử (file tạm + `rename`), file `0o640` thuộc `1000:1000`. Bản `GET /__box/plans` đọc
  lại đúng ánh xạ nghịch đó và thêm trường `review` cho **mọi** plan (`null` nếu chưa
  duyệt). Thư mục `.reviews` không bao giờ xuất hiện như một plan (bị bỏ qua im lặng,
  không tính vào `ignoredCount`).
- Manifest plan có cache theo "watermark" (root + mọi thư mục con + file plan + cả cây
  `.reviews`) nên thêm file trong thư mục con hoặc thêm review đều làm lần `GET` sau
  đọc lại từ đĩa — không cần thêm plan mới.

## Giới hạn

`MAX_DEPTH=16`, `MAX_ENTRIES=2000`, `MAX_FILE_SIZE=1 MiB` (text), `MAX_UPLOAD_SIZE`
= `MAX_ZIP_TOTAL_BYTES` = `MAX_UNZIP_TOTAL_BYTES` = 256 MiB, `MAX_ZIP_PATHS=200`.
Ghi file mới: `MAX_TOUCH_CONTENT_BYTES = MAX_FILE_SIZE` (1 MiB, để `touch` luôn đọc lại
được bằng `file/content`); `MAX_NOTE_SIZE = 16 KiB` (giữ dưới trần body JSON 64 KiB của
ide-proxy để nhánh `413` chạm tới được qua HTTP); `MAX_IDENTITY_LENGTH = 248`.
Thumbnail cache ở `WORKSPACE_ROOT/.generated_artifacts/thumbnails`, key
`sha256(rel|mtime|size)` để hết hiệu lực khi file đổi; thư mục `.generated_artifacts`
và `.trash` bị ẩn khỏi listing và zip.
