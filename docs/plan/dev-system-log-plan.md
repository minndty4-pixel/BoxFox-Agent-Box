# Nhật ký hệ thống cho dev (ngoài box, agent không thấy)

> **Trạng thái:** bản v1 **đã có trong mã** (commit `0800349`); bản v2 **đã có trong mã**
> (nhánh `vorflux/fix-e2e-defects`, xem §3.7); bản v3 (§4) là kế hoạch, trừ việc `prune`
> đã làm sớm ở §4.2.
> Đây là việc 7 của chủ sở hữu: cần một nhật ký kiểu bảng Terminal nhưng **ngoài box** và
> **agent trong box không đọc được**, ghi lỗi, thời gian chạy, v.v. để dev dễ tìm lỗi.

## 1. Vì sao đặt ngoài box

| Sự thật đã kiểm chứng | Hệ quả |
|---|---|
| Harness chạy trên HOST (`~/BoxFox/harness/sessions.sqlite`) | Nhật ký ghi được ở host, không cần quyền trong box |
| Container chỉ mount `agentbox-workspace` vào `/home/agent/workspace` và mount chỉ-đọc thư viện skill | Thư mục `~/BoxFox/logs` của host **không** xuất hiện trong box |
| Không có route nào của box đọc được file host | Agent trong box không thể đọc, không thể sửa, không thể xoá nhật ký |

Đây là khác biệt cốt lõi so với bảng Terminal hiện có: bảng Terminal nằm trong box nên agent nhìn
thấy; nhật ký này thì không.

## 2. Bản v1 — đã có

### 2.1 Đường dẫn và định dạng

| Hạng mục | Giá trị |
|---|---|
| Thư mục | `~/BoxFox/logs` (đổi bằng biến môi trường `BOXFOX_SYSTEM_LOG_DIR`) |
| Tệp | `harness.jsonl` (harness Python), `router.jsonl` (router Node) |
| Định dạng | JSON Lines, mỗi dòng một sự kiện |
| Khoá dòng | `ts`, `level`, `source`, `event`, `runId`, `sessionId?`, `turnId?`, `code?`, `message?`, `durationMs?`, `data?` |
| Vòng đời (bản v2) | Tắt êm: `harness.jsonl` → `harness.previous.jsonl` (đúng một file trước); kill cứng: giữ nguyên file, không mất dòng nào |
| Xoay vòng | 8 MiB/tệp, giữ 4 bản cũ (`*.jsonl.0` … `.3`) |
| Che bí mật | Bỏ giá trị của các khoá `apikey`, `api_key`, `apiKey`, `authorization`, `password`, `secret`, `token` |
| An toàn | Mọi lỗi khi ghi đều bị nuốt; nhật ký không bao giờ làm hỏng lượt chạy |

### 2.2 Sự kiện đang ghi

| Nguồn | Sự kiện | Nội dung chính |
|---|---|---|
| Harness | `harness.start`, `harness.stop` | thư mục dữ liệu, cổng, pid, phiên bản python |
| Harness | `turn.start` | vai trò, model, connection, cửa sổ ngữ cảnh, trần bước, hạn, ước lượng token, số message |
| Harness | `model.error` (warn) | mã lỗi phân loại, thông điệp, số lần thử |
| Harness | `tool.end` | tên tool, bước, thời gian chạy, `isError` |
| Harness | `tool.error` | mã lỗi, thông điệp |
| Harness | `turn.end` | trạng thái (`completed`/`cancelled`), số bước, số ký tự trả lời, thời gian |
| Harness | `turn.failed` (error) | mã lỗi, thông điệp, vết lỗi rút gọn (≤ 4000 ký tự) |
| Harness | `compact.failed`, `command.failed`, `executor.failed` | lệnh, mã lỗi, thông điệp |
| Router | `router.start`, `router.stop`, `router.startup_failed` | cổng, pid, phiên bản node, đường dẫn log |
| Router | `chat.end`, `chat.aborted`, `chat.failed` | model, connection, số token vào/ra, số ký tự, số tool call, mã lỗi, mã HTTP |

### 2.3 Cách dev dùng

```bash
python scripts/system-log.py tail --lines 50                 # 50 dòng cuối
python scripts/system-log.py tail --level error --file all   # chỉ lỗi, cả hai nguồn
python scripts/system-log.py follow                          # theo dõi trực tiếp
python scripts/system-log.py errors --since-minutes 60       # lỗi trong 60 phút, kèm vết
python scripts/system-log.py summary --since-minutes 1440    # đếm sự kiện, mã lỗi, p50/max thời gian
python scripts/system-log.py sessions --lines 200            # nhóm theo phiên
python scripts/system-log.py reset [--file harness|all]       # reset thủ công (bản v2)
python scripts/system-log.py prune --days 7 --max-mib 200     # chính sách lưu (thêm --dry-run)
```

Lệnh trả mã thoát `2` khi chưa có tệp log (chưa chạy harness lần nào), để script khác phân biệt
"chưa có log" với "log rỗng".

### 2.4 Việc nhỏ đã sửa kèm

- Test không còn ghi vào nhật ký thật: `backend/tests/conftest.py` trỏ
  `BOXFOX_SYSTEM_LOG_DIR` sang thư mục tạm **trước khi** import `agentbox`.
- `summary` đọc thêm `data.errorCode` khi dòng không có `code` ở cấp ngoài, và gắn nhãn
  `UNCLASSIFIED` thay vì in `None`.

## 3. Bản v2 — bảng xem trong ứng dụng (việc kế tiếp)

Mục tiêu: dev xem được ngay trong app, không phải mở SSH; **không** đổi thiết kế giao diện.

1. **API chỉ đọc trên harness:** `GET /api/agent/system-log` với tham số `level`, `source`,
   `sessionId`, `event`, `lines` (trần 500), `since`. Yêu cầu header admin như mọi route hiện có.
   Trả về đúng các dòng đã lọc, **đã che bí mật lần hai** ở tầng API.
2. **Không có đường nào từ box tới API này:** route nằm trên harness (host); box không gọi được;
   các route điều khiển box cũng không được proxy nó. Ghi rõ điều này thành test.
3. **Bảng UI:** dùng lại đúng khung và lớp CSS của bảng hiện có (ví dụ bảng Terminal/Sandbox),
   thêm một mục trong sổ đăng ký panel. Nội dung: bộ lọc mức, nguồn, phiên; danh sách dòng;
   nút "Sao chép chẩn đoán" (sao chép các dòng đang xem kèm commit và phiên bản).
4. **Theo dõi trực tiếp:** làm mới theo nhịp 2 giây khi bảng đang mở, hoặc SSE nếu khung sẵn có;
   không thêm thư viện mới.
5. **Nhóm lỗi:** gom theo `code` và theo phiên, hiện số lần, để nhìn ra lỗi lặp.
6. **Test:** API trả đúng khi log rỗng/chưa có; lọc đúng; che bí mật; box không gọi được; bảng chỉ
   hiện khi bật chế độ dev.

### 3.7 Đã có trong mã (bản v2)

| Việc (§3) | Ở đâu | Test |
|---|---|---|
| 1. API chỉ đọc `GET /api/agent/system-log` (`level`, `source`, `sessionId`, `event`, `lines` trần 500, `since`), che bí mật lần hai ở tầng API | `backend/src/agentbox/api/server.py`, `backend/src/agentbox/observability/system_log.py` (`read_entries`, `redact_entry`, `clamp_lines`, `since_cutoff`) | `backend/tests/unit/test_system_log_v2.py` |
| 2. Không có đường nào từ box tới API này | `deploy/docker/ide-proxy.py` (bảng route hữu hạn, không nhánh nào chở log), `docker-compose.yml` (không publish cổng harness), `server.py` bind `127.0.0.1` | `deploy/docker/tests/test_ide_proxy_system_log.py` |
| 3. Bảng UI trong sổ đăng ký panel, dùng lại `PanelShell`/`StatusChip`, nút "Sao chép chẩn đoán" | `frontend/src/components/panels/SystemLogPanel.tsx`, `frontend/src/App.tsx`, `frontend/src/store/uiStore.ts`, `frontend/src/i18n/{vi,en}.ts` | `frontend/src/components/panels/SystemLogPanel.test.tsx`, `frontend/src/App.tabs.test.tsx` |
| 4. Làm mới 2 giây khi bảng đang mở (không thêm thư viện) | `frontend/src/hooks/useSystemLog.ts` (`SYSTEM_LOG_REFRESH_MS = 2000`, `setInterval`) | `SystemLogPanel.test.tsx` (nhịp + nút "Đọc lại") |
| 5. Nhóm lỗi theo `code` kèm số lần | `groupErrorCodes` trong `SystemLogPanel.tsx` (đọc thêm `data.errorCode`, gắn `UNCLASSIFIED`) | `SystemLogPanel.test.tsx` |
| 6. Test: log rỗng/chưa có, lọc, che bí mật, box không gọi được, bảng chỉ hiện khi dev | — | 4 tệp ở trên |
| Vòng đời "chỉ ghi khi chạy, đóng thì reset" (luật của chủ sở hữu) | `SystemLog.__init__`/`run_id`/`rotate_on_shutdown()`, `resetOnShutdown()` trong `router/src/system-log.mjs` + `router/src/main.mjs`, gọi từ `close()`/`main()` của harness | `test_system_log_v2.py`, `router/tests/system-log-lifecycle.test.mjs` |

Ghi chú vận hành:

- Tắt êm thì file đang ghi đổi tên thành `<nguồn>.previous.jsonl` (**đúng một** file trước, ghi đè
  file cũ hơn) rồi lượt sau mở file mới rỗng. Kill cứng không chạy được dòng đó nên **không mất
  gì** — file cứ nằm nguyên, và `runId` trên mỗi dòng là thứ phân biệt hai lượt trong cùng một file.
- Mọi dòng mang `runId` (`YYYYMMDDTHHMMSS-<pid>-<4 hex>`), API trả `runId` của lượt đang chạy cùng
  `version`/`commit` để bản sao chẩn đoán nói rõ nó đến từ bản dựng nào (`commit` đọc thẳng `.git`,
  không gọi `git`; không có `.git` thì trả `unknown`).
- Tab này là tab DEV: `isPanelTabAvailable()` trong `App.tsx` lọc nó khỏi menu khi
  `import.meta.env.DEV` là false.

## 4. Bản v3 — vận hành

1. **Tương quan:** thêm `requestId` xuyên suốt UI → harness → router để một lượt hỏng tra được cả
   ba tầng. Hiện đã có `sessionId` + `turnId`; router có `requestId` riêng, chưa nối.
2. **Chính sách lưu:** mặc định giữ 7 ngày hoặc 200 MiB, cấu hình được; có lệnh `prune`.
   → **đã làm sớm** trong bản v2: `python scripts/system-log.py prune [--days 7] [--max-mib 200]
   [--dry-run]` chỉ xoá bản xoay vòng (`*.jsonl.0`…`.3`) và file lượt trước, **không bao giờ** đụng
   file đang ghi; `reset` là bản thủ công của cùng thao tác mà harness/router làm khi tắt êm.
3. **Số liệu từ log:** đếm lượt hỏng theo mã, p95 thời gian lượt, tỷ lệ retry, tỷ lệ lỗi tool —
   đây chính là đầu vào cho chỉ số "cho qua cho nhanh" ở
   [kế hoạch chất lượng đầu ra](agent-output-quality-plan.md) §3.
4. **Cảnh báo trong app:** khi tỷ lệ lượt hỏng vượt ngưỡng trong 1 giờ, hiện một dòng ở bảng
   nhật ký (không gửi email, không thêm dịch vụ ngoài).
5. **Không bao giờ ghi:** nội dung tin nhắn người dùng, giá trị bí mật, nội dung tệp. Chỉ ghi độ
   dài, mã, đường dẫn tương đối và thời gian.

## 5. Nghiệm thu của việc 7

1. `scripts/system-log.py summary` chạy được và ra số liệu thật sau khi harness khởi động lại.
2. Một lượt hỏng tra được từ mã lỗi trên UI → dòng `turn.failed` trong nhật ký → phiên trong DB.
3. Chứng minh được agent trong box không đọc được: lệnh trong box không thấy `~/BoxFox/logs`, và
   không route nào trả nội dung log cho box. → có test ở bản v2:
   `deploy/docker/tests/test_ide_proxy_system_log.py` (404 cho mọi đường dẫn hình dạng log, API file
   từ chối đường dẫn ngoài workspace, cổng harness không được publish, harness chỉ bind loopback).
4. Không có bí mật nào xuất hiện trong log: kiểm bằng cách grep token đã cấu hình (không in ra).
