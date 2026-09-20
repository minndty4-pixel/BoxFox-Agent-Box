# Nhật ký các vòng kiểm thử — BoxFox Agent Box

Mỗi vòng ghi: phạm vi, cách chạy, kết quả, bằng chứng và lỗi tìm được. Số liệu lấy từ lần chạy cuối của vòng đó.

## Vòng 1 — E2E toàn hệ thống (2026-09-19, sáng)

- Phạm vi: 21 case trên UI 3100, harness 3102, router 3101, box 8081; bám theo kế hoạch 6 nhóm (chat, CUA, browser, router, slash command, giao diện hẹp).
- Kết quả: **15 PASS / 8 FAIL / 0 bị chặn**; tổng hợp được **25 lỗi** (BUG-1 … BUG-25).
- Báo cáo đầy đủ: `/code/.generated_artifacts/boxfox-ket-qua-kiem-thu.md` (bản tiếng Việt, 409 dòng).
- Ảnh/ghi hình: `images/06_capture_inline.png`, `images/07_thinking_block_expanded.png`, `images/12_capture_session_order.png`, `images/13_narrow_900.png`, `images/14_narrow_390.png`, `images/16_plan_panel.png`, `images/19_compaction_notice.png`, `recordings/boxfox_e2e_walkthrough_1920.webm`.

## Vòng 2 — xác minh độc lập đợt sửa (2026-09-19, tối)

- Phạm vi: 33 case trên hệ thống thật sau khi router và harness được khởi động lại; kiểm cả tính trung thực của chuỗi suy luận, thứ tự DOM so với SSE, ma trận slash command, nén context hai chiều, ưu tiên `contextWindow`, `/claude-code` thiếu CLI.
- Kết quả: **30 PASS / 1 FAIL / 1 thông tin**; trạng thái chung: PARTIAL.
- Lỗi tìm được: NEW-1 (nút Compact bị cắt ở khung hẹp 900–1100 px), N-1 (`/skill` thiếu mã lỗi), N-2 (`thinkingLevel` sai được lưu nguyên).
- Bằng chứng: `recordings/r2_walkthrough_v3.webm` (78 giây), `images/r2_19_900_compact_clipped.png`, `images/r2_20_1100_compact_clipped.png`, `images/r2_21_390x844.png`, `images/r2_23_rec_sessionF.png`, `images/r2_30_public_preview.png`.
- Ghi chú: không xác minh được "một tác vụ `/claude-code` thật chạy xong" vì box không có CLI và không có thông tin đăng nhập — chỉ xác minh được đường `SETUP_REQUIRED` trung thực cùng một CLI giả để chứng minh phần truyền tham số.

## Vòng 3 — rà soát tích hợp (2026-09-19, tối)

- Phạm vi: đọc mã hai commit đầu của nhánh, tập trung vào khớp hợp đồng giữa bốn luồng viết song song.
- Kết quả: 9 phát hiện — 1 Cao (R-1), 3 Trung bình (R-2, R-3, R-4), 5 Thấp (R-5 … R-9); kèm 4 điểm đã xác nhận đúng.
- Chi tiết: `docs/tracking/findings-round3.md`.

## Vòng 4 — xác minh đợt 4 trên hệ thống thật (2026-09-19, 21:40)

- Phạm vi: luồng quyết định (duyệt / từ chối / hết hạn / dừng khi đang chờ / trả lời hai lần), plan tự mở và duyệt thật, thao tác file qua giao diện so với `ls` trong box, chip transcript, cuộn chat, nút Compact; kèm săn lỗi mới trên toàn hệ thống.
- Kết quả: **PARTIAL PASS** — mọi luồng chạy đúng khi được kiểm, nhưng luật tự mở tab không tất định ở cấu hình mặc định.
- Lỗi mới: B12 (không tất định, Trung bình–Cao), B13, B2c, B4, B6; B7 rút lại (hai quyết định cùng lúc là bất khả vì lượt thứ hai bị chặn 409).
- Chi tiết: `docs/tracking/findings-round4.md`. Ảnh: `images/r4_*.png`.

## Con số kiểm thử đơn vị (sau khi sửa xong cả vòng 3 và vòng 4)

| Bộ | Lệnh | Kết quả |
|---|---|---|
| Router | `cd router && /opt/node24/bin/node --test tests/*.test.mjs` | 63 pass / 0 fail |
| Backend | `.venv/bin/python -m pytest backend/tests -q` | 287 passed, 3 failed, 2 skipped — 3 lỗi là lỗi môi trường có sẵn |
| Container | `.venv/bin/python -m unittest discover -s deploy/docker/tests -p "test_*.py"` | 324 tests OK, exit 0 |
| Frontend | `cd frontend && npx vitest run` | 644 passed, 4 failed — 4 lỗi có sẵn từ trước |
| Kiểu | `cd frontend && npx tsc -b --noEmit` | exit 0 |

Ba lỗi backend có sẵn: hai test CUA/Playwright cần Internet trong khi box tắt mạng theo thiết kế, và `test_terminal_exec_echo` dùng lệnh PowerShell `Write-Output` trên box chỉ có bash.

Bốn lỗi frontend có sẵn: ba test trong `src/components/shell/Sidebar.test.tsx` (jsdom/`dispatchEvent`) và một test trong `src/lib/workspace/index.test.ts` (do tệp `.env.local` cục bộ đặt `VITE_BOX_API_URL=/`).

## Vòng 5 — chứng minh luật tự mở tab ở cấu hình mặc định (2026-09-19, 22:30)

- Phạm vi: sau khi sửa B12, chạy lại đúng kịch bản đã thất bại ở vòng 4, ở cấu hình mặc định (`boxfox_auto_open_tabs` và `boxfox_auto_open_only_when_idle` đều bật).
- Kết quả: **PASS cả hai nhánh**.
  - Nhánh "tự cuộn của agent không gia hạn cửa sổ": 8 đợt cuộn lập trình (đợt cuối cách `ui_intent` 68 ms), người dùng hoàn toàn không thao tác; tab Decisions tự mở **103 ms** sau intent.
  - Nhánh "intent xếp hàng được xả khi hết cửa sổ": intent đến lúc người dùng đang kéo thanh chia panel ⇒ xếp hàng; tab tự mở **14,17 giây** sau thao tác thật cuối cùng.
- Ảnh: `images/r5_B12_scrollproof_end.png`, `images/r5_B12_queueflush3_end.png`.
- Ghi chú: một lần chạy đầu không kết luận được vì phiên đó tạo trước khi khởi động lại harness (chỉ có 15 tool, thiếu `request_approval`) — không phải lỗi sản phẩm.

## Vòng 6 — kiểm chứng độc lập năm lỗi của vòng 4 (2026-09-19, 23:25)

- Phạm vi: kiểm chứng độc lập trên hệ thống thật năm bản sửa của `51f1452` (B12, B13, B2c, B4, B6) cộng sáu phép thử hồi quy đã từng kiểm ở vòng 2. Không sửa mã nguồn (`git status --porcelain` sạch).
- Kết quả: **PASSED toàn bộ**, không ca nào bị chặn.
  - B12a (tự cuộn của agent không gia hạn cửa sổ): `lastUserActivityAt` giữ nguyên 0 qua 6 đợt cuộn; khoảng thời gian `ui_intent` → tab hoạt động = **1 ms** ở ranh giới store (tốt hơn mức 103 ms của vòng 5).
  - B12b (intent trong cửa sổ 15 giây được xếp hàng rồi tự xả): intent ở Δt 6914 ms ⇒ xếp hàng; xả **15002 ms** sau lần gõ thật cuối cùng.
  - B12c (tab ghim không bị cướp): xếp hàng 24 giây trong khi `activeTab` vẫn là `decisions`, huy hiệu `1`; mở tay thì hàng đợi được tiêu thụ.
  - B12d (tắt điều kiện "chỉ mở khi rảnh"): tab mở 7594 ms sau lần gõ cuối, tức trong cửa sổ.
  - B13: đổi route `gemini-3.8-flash` → `claude-sonnet-4-6` kèm `ultrapower` ⇒ **400 `THINKING_LEVEL_UNSUPPORTED`** (thông báo nêu đúng `low/medium/high`), route không đổi, phiên vẫn `completed`, không có sự kiện `error`; model không có mức ⇒ bỏ im lặng, trả 202.
  - B2c: lưới hiện đúng chấm hổ phách "Integrity: Out of scope — unverified" và chấm đỏ "Confidentiality: Secret", dùng chung khoá i18n với thanh công cụ.
  - B4: mỗi lần di chuyển con trỏ trong lúc kéo đều tính là hoạt động; intent đến giữa lúc kéo được xếp hàng và xả **15001 ms** sau lần kéo cuối.
  - B6: tab mở **và** chọn đúng tệp — breadcrumb `workspace > fixtures > vendor` cùng khung xem trước.
  - Hồi quy: thinking stream hiện thông báo đúng; `/compact` ⇒ `compression {8580→3641}` + "Context compaction complete.", phiên `completed`; transcript **0 thẻ lượt ma** (14 sự kiện `user` = 14 tiêu đề lượt, thứ tự DOM tăng dần theo `seq`); Stop khi `awaiting_decision` ⇒ `cancelled`; các route cần quyền trả 403/403/403/404/400 và box control 403; gõ phím thật khi phiên đang bận ⇒ 409 với băng lỗi trong chat và bản nháp được giữ.
- Kiểm tra bộ test đơn vị: mỗi bản sửa đều có test khẳng định đúng hành vi đã sửa (`uiStore.autoopen.test.ts` 18 ca, `ChatPanel.scroll.test.tsx` 13 ca, `Resizer.activity.test.tsx` 6 ca, `useWorkspaceFiles.test.tsx` 15 ca, `ExplorerGrid.labels.test.tsx` 4 ca, `test_turn_route_thinking_level.py` 8 ca) — không có lỗ hổng.
- Ảnh: `images/r6_b12a_plan_tab_after_burst.png`, `images/r6_b12c_pinned_plan_queue_badge.png`, `images/r6_b6_files_intent_opened.png`, `images/r6_b2c_grid_card_zoom.png`, `images/r6_r5_inline_error_busy.png`, `images/r6_public_preview_files_panel.png`, `images/r6_public_preview_transcript_compact.png`, `images/r6_final_clean_state.png`. Video: `recordings/r6_walkthrough.webm` (283,7 giây).
- Ghi chú nhỏ (không chặn): dạng cây và huy hiệu vẫn in chuỗi tiếng Việt cứng từ `lib/labels.ts` trong khi tiêu đề chấm đã theo i18n — đây là chia tách có từ trước, bản sửa B2c làm lưới khớp với thanh công cụ. Lệnh `agent-browser record stop` lại treo (lần thứ hai), phải diệt daemon rồi ghép lại bằng `ffmpeg -c copy`.

## Vòng 7 — dựng lại ảnh container (2026-09-19, 23:30)

- Việc còn nợ "Nợ-1" đã xong: `cd deploy/docker && docker compose build` → `agentbox-sandbox:latest`, manifest `sha256:cf06992844d6d335e76333a8bba02e6d29643347c910662b592383818bdac2de`.
- Kiểm chứng: `docker run --rm --entrypoint sha256sum agentbox-sandbox:latest /usr/local/bin/{ide-proxy,plan_files,workspace_files}.py` cho hash trùng khớp với tệp trong repo (`a7a83b02…`, `de901085…`, `fc391ce1…`). Bản triển khai mới vì thế mang sẵn các endpoint ghi mà không cần chép tay như trên container đang chạy.

## Vòng 8 — đo lại lỗi lặp văn bản và câu lỗi vô nghĩa (2026-09-20, 04:5x)

Bối cảnh: chủ sở hữu báo (a) hội thoại dài thi thoảng hiện `Agent run failed`, (b) file markdown
sub-agent trả về lặp khối văn bản, (c) plan không có cơ chế verify.

**Trước khi sửa** (harness sống `:3102`, tiến trình khởi động 2026-09-19 22:28:32, mã cũ):
đo theo cùng một cách — đếm delta, tổng độ dài delta, độ dài văn bản cuối:

| Lượt | Số delta | Tổng độ dài delta | Văn bản cuối | Tỷ lệ |
|---|---|---|---|---|
| Lượt chính (đọc README, tóm tắt 60 dòng) | 75 | 353 457 | 9 297 | **38,0** |
| Lượt con (giao việc research) | 28 | 44 165 | 3 198 | **13,8** |

Chuỗi tiền tố đúng (`prefix_chain: true`) ⇒ mỗi delta là toàn bộ văn bản tới lúc đó. Đây chính là
nguyên nhân file `.md` chủ sở hữu dán tay bị lặp. Bằng chứng: `r7_delta_repro.json`,
`r7_delta_repro_events.json`.

**Sau khi sửa** (bản sao cô lập trên `:3112`, cây mã tại `51ecba6`; đúng cách đo):

| Lượt | Số delta | Tổng độ dài delta | Văn bản cuối | Tỷ lệ | Ghép delta == văn bản cuối |
|---|---|---|---|---|---|
| Lượt chính (cùng dạng lệnh) | 42 | 4 689 | 4 689 | **1,0** | Có |
| Lượt giao việc research | 42 | 3 829 | 3 829 | **1,0** | Có |

Kết quả phụ lấy từ cùng lượt giao việc: sự kiện `child` của chuyên gia `research` **completed**,
câu trả lời bị chặn trần còn 8 075 ký tự kèm `truncated: true` (trước đây không có trần).
Bằng chứng: `r7_delta_after_fix.json`.

**Câu lỗi**: session trỏ vào connection không tồn tại trả về
`code='UPSTREAM_HTTP_503'`, `message='UPSTREAM_HTTP_503: the model router answered Router HTTP 503
(No enabled, authorized model is available for this route.)'` — không còn chuỗi trần
`Agent run failed`.

**Nhật ký hệ thống**: bản sao cô lập ghi 48 dòng trong `/var/tmp/r7-verify/logs/harness.jsonl`;
`summary` cho thấy 8 `turn.start`, 5 `turn.end`, 4 `model.error`, 3 `turn.failed`, 25 `tool.end`
(p50 73 ms, max 27 046 ms), mã lỗi `UPSTREAM_HTTP_503 ×2`, `MAX_STEPS ×1`.

**Bộ test**: backend `3 failed / 349 passed / 2 skipped` — ba lỗi có sẵn từ trước (hai ca CUA cần
Internet, một ca dùng `Write-Output` của PowerShell trên box bash). Router `node --test` 83 pass.
Frontend 653 pass / 4 lỗi có sẵn (3 × `Sidebar.test.tsx`, 1 × `workspace/index.test.ts` do
`.env.local` cục bộ).

## Vòng 9 — kiểm chứng sống sau khi khởi động lại dịch vụ (2026-09-20, 04:5x)

Khác vòng 8: lần này **chính hai tiến trình dùng chung** (`:3102` harness, `:3101` router) đã được khởi động lại trên cây mã hiện tại, nên mọi kết quả dưới đây là hành vi thật của bản đang chạy.

| Việc | Cách đo | Kết quả |
|---|---|---|
| Văn bản phát lại (BUG-26) | `measure_deltas.py 3102 turn` | 66 delta, tổng 7 892 ký tự, văn bản cuối 7 892 ký tự → **tỷ lệ 1,0**, `joined_equals_final: true`; các delta liền nhau đều là **hậu tố**, không delta nào gửi lại phần đã có |
| Câu lỗi vô nghĩa (BUG-27) | `check_live.py 3102` | `code='UPSTREAM_HTTP_503'`, `message='UPSTREAM_HTTP_503: the model router answered Router HTTP 503 (No enabled, authorized model is available for this route.)'` — không còn chuỗi trần |
| Anthropic ingress (BUG-30, phần router) | `curl -N POST :3101/v1/messages` | 33 event SSE đúng chuỗi `message_start → content_block_delta → message_delta → message_stop`, **không có `[DONE]`**; `count_tokens` → `{"input_tokens": 7}`; thiếu khoá → `{"type":"error","error":{"type":"authentication_error",…}}` |
| Máy chủ bridge (BUG-30, phần box) | cấu hình | vẫn **tắt mặc định**; cần `BOX_LLM_BRIDGE=on` + `BOXFOX_ROUTER_BRIDGE_HOST` và một lần tạo lại container — chưa xác minh sống trên container thật |

Tệp bằng chứng: `/code/.generated_artifacts/r8_delta_live_3102.json`, `/code/.generated_artifacts/r8_anthropic_stream_live.sse`, `/code/.generated_artifacts/r8_anthropic_count_tokens.json`. Mọi phiên tạo ra để đo đã được xoá.

## Vòng 10 — trả lời soát mã đợt 8 (2026-09-20, 05:0x–05:2x)

Bảy lỗi của vòng soát mã được sửa trong `16eedda`; hai phát hiện còn lại xử lý bằng ghi chú (xem
`bug-register.md` §6.3).

**Bộ test sau khi sửa** (đều chạy trên cây `16eedda`):

| Bộ | Lệnh | Kết quả |
|---|---|---|
| Backend | `.venv/bin/python -m pytest backend/tests -q` | **361 passed, 2 failed, 2 skipped** — hai lỗi có sẵn: một ca CUA cần Internet, một ca dùng `Write-Output` của PowerShell trên box bash. Lỗi thứ ba của vòng 9 (`test_cua_inspect_element_and_double_click`) nay **đã qua** |
| Router | `npm test` (từ `router/`) | **84 / 84 pass** — bộ test nay tự trỏ log vào thư mục tạm (`tests/isolate-logs.mjs`), nhật ký thật của người vận hành không bị ghi thêm |
| Frontend | `npx vitest run` | **666 passed, 4 failed** — bốn lỗi có sẵn từ trước (3 × `Sidebar.test.tsx` dưới jsdom, 1 × `workspace/index.test.ts` do `frontend/.env.local` cục bộ) |
| Kiểu | `npx tsc -b --noEmit` | exit 0 |
| Docker | `python3 -m unittest discover -s deploy/docker/tests -p "test_*.py"` | **336 OK** |

**Ca mới của vòng này**: `test_stream_delta_events.py` (+1, lượt gọi thứ hai sau khi stream dở),
`HarnessStepView.notice.test.tsx` (2), `SubagentInspectorPanel.stream.test.tsx` (+2),
`test_harness_port_override.py` (4), `test_failure_classification.py` (+1),
`anthropic-ingress.test.mjs` (thay ca khoá hành vi mất mát bằng 2 khẳng định mới).

**Kiểm ngược** (đã chạy, tắt bản sửa thì ca tương ứng đỏ): bỏ nhánh `reset` trong
`HarnessStepView.tsx`; bỏ cổng `BRIDGE_PATHS` ở cầu nối.


## Vòng 11 — đóng hai lỗi CUA còn nợ của đợt 7 (F5, F6) — 2026-09-20, 06:2x–06:5x

Hai lỗi này từng bị hoãn vì "cần chủ dự án quyết"; đợt này chốt phương án **không bỏ**
tính năng tự khớp cỡ của noVNC (`Xvnc -AcceptSetDesktopSize` là thứ giữ cho noVNC dùng
được trong cửa sổ nhỏ), thay vào đó đặt **sàn** kích thước và thêm bước chọn tab theo
trạng thái hiển thị. Cam kết: `65039ae`.

**Bộ test sau khi sửa:**

| Bộ | Lệnh | Kết quả |
|---|---|---|
| Backend | `.venv/bin/python -m pytest backend/tests -q` | **373 passed, 2 failed, 2 skipped** — hai lỗi có sẵn như vòng 10 |
| Docker | `python3 -m unittest discover -s deploy/docker/tests -p "test_*.py"` | **350 OK** |

**Ca mới của vòng này**: `test_sandbox_worker_desktop_floor.py` (7),
`test_sandbox_executor_desktop_note.py` (5, gồm cả nhánh chuyển tiếp ghi chú trong
`computer_screen_capture`), `DesktopFloorTest` (6), `VisibleTargetTest` (6),
`SafeTabListTest` (2) trong `deploy/docker/tests/test_inspect_element.py`.

**Kiểm ngược** (đã chạy, tắt bản sửa thì ca tương ứng đỏ): bỏ bước chọn theo
`visibilityState` trong `_select_target` (3 ca đỏ); cho `worker.ensure_desktop_size()`
trả `None` ngay (2 ca đỏ); bỏ vòng chuyển tiếp `desktopRestored`/`desktopWarning`
trong `executor._execute` (1 ca đỏ).

**Đo sống trong box**: trước khi sửa, `POST /__box/inspect-element` tại `(640,300)`
trả `reason: ambiguous_target` với **34 tab** cùng tiêu đề `vi.wikipedia.org`; sau khi
sửa, cùng toạ độ đó trả `{"type":"dom","selector":"#main-content","tag":"div"}`.
Kéo desktop xuống `286x311` rồi lần lượt gọi ba cửa vào (`/__box/capture`,
`computer_use click`, `/__box/inspect-element`): cả ba trả `1280x800` và
`desktopRestored {'from': '286x311', 'to': '1280x800'}`; nhật ký DEV ghi
`box.desktop_restored` kèm `sessionId` và `tool`.

Ghi chú vận hành: ba tệp `deploy/docker/{browser_capture,inspect_element,capture}.py`
đã được chép tay vào container đang chạy để kiểm chứng (rồi khởi động lại `ide-proxy`);
lần tạo lại container kế tiếp sẽ lấy đúng các tệp trong kho.
