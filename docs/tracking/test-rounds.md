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

## Vòng 12 — đóng nốt hai lỗi của vòng 9, mở công cụ web ở host, chạy `/claude-code` thật — 2026-09-20, 07:1x–07:5x

Bối cảnh: chủ sở hữu chốt bốn quyết định (`#5811` công cụ web ở tầng host, `#5812` được phép build
lại image, `#5813` setup đánh giá nhưng chưa chạy, `#5814` nhật ký hệ thống v2 trong giao diện).
Vòng này làm đúng bốn việc đó, cộng hai lỗi mà vòng kiểm chứng độc lập đợt 9 để lại.

### Việc đã làm trong vòng này

| Việc | Nội dung | Bằng chứng |
|---|---|---|
| F6b | `deploy/docker/capture.py` gọi `.decode()` lên đầu ra `str` của `_run_as_agent()` ⇒ nhánh đặt lại màn hình thất bại ném `AttributeError`, `/__box/capture` trả HTTP 500 thay vì ảnh kèm `desktopWarning` | `_output_text()` nhận cả `str` lẫn `bytes`; `test_inspect_element.py` +3 ca (`DesktopFloorTest`) |
| F8 | `xdotool mousemove --sync` treo 15,16 s khi con trỏ đã ở đúng toạ độ ⇒ lần bấm thứ hai cùng chỗ báo hết giờ, đốt 20/20 bước của lượt CUA nặng đợt 7 | `_pointer_move()` bỏ `--sync` và tự thăm dò bằng `getmouselocation`; `test_sandbox_worker_pointer.py` (5 ca) |
| N-5 | Công cụ tra cứu mạng cho agent, chạy ở **host** (box không có Internet) | `agent_core/web.py` (`web_search`, `web_fetch`), 30 ca trong `test_web_tools.py`, ghi chú đo đạc `docs/research/host-web-tools.md` |
| Việc 5 v2 | Nhật ký hệ thống: API chỉ-đọc, vòng đời "ghi khi chạy, reset khi tắt", bảng trong giao diện | `test_system_log_v2.py` (16), `router/tests/system-log-lifecycle.test.mjs` (4), `deploy/docker/tests/test_ide_proxy_system_log.py` (6), `frontend/src/components/panels/SystemLogPanel.test.tsx` (12) + `App.tabs.test.tsx` (4) |
| Việc 3+4 | Bộ khung đánh giá chạy khô, có cổng chặn chi tiêu hai yếu tố | `scripts/eval/` (9 mô-đun) + `backend/tests/unit/test_eval_setup.py` (52 ca) |
| F9 | Con của lệnh nhận mặc định 180 giây ⇒ phiên 600 giây vẫn `DEADLINE` ở lượt `/claude-code` | `_command_task` truyền ngân sách của phiên; `test_skill_commands.py::test_command_child_inherits_the_session_time_budget` |
| F10 | CLI tự chọn `claude-opus-5[1m]` khi thiếu `ANTHROPIC_MODEL` ⇒ lượt chết ngay vì router không có model đó | `router_config()` lấy model sonnet/haiku đã cấu hình; 2 ca trong `test_claude_worker_router.py` |
| Ghi chú | Lỗi nhà cung cấp bị nuốt thành "Claude Code task failed" | executor đọc thêm khoá `text`; `test_claude_executor.py::test_the_provider_reason_survives_an_error_result` |

### Bằng chứng sống

- **Công cụ web**: `SEARCH web -> 3 kết quả` (firecrawl không cần khoá), `SEARCH wikipedia (vi) -> 3`,
  `SEARCH papers -> 2` (có DOI), `FETCH https://docs.python.org/3/library/asyncio-task.html` →
  `200`, tiêu đề thật, `chars 43995`, `truncated True`; SSRF chặn cả `http://127.0.0.1:3101/...` lẫn
  `http://169.254.169.254/latest/meta-data/` bằng `WEB_URL_FORBIDDEN`.
- **Box không có Internet** (đo lại): `iptables -S OUTPUT` = `DROP` rồi `REJECT`; chỉ loopback và
  bốn cổng dịch vụ 5900/6080/8080/8081 đi được — đây là lý do công cụ web phải chạy ở host.
- **Image đã build lại**: ba mô-đun trong `/usr/local/bin` của container trùng byte với repo
  (`76a64c41…` capture, `13da3416…` browser_capture, `127ec2b1…` inspect_element);
  `POST /__box/capture` → `200`, 1280×800.
- **`/claude-code`**: `probe` trả `status: ready`, `auth: router`, `baseUrl: http://172.18.0.1:3101`,
  `settingsFile: true`; lượt thật chạy CLI trong box, request đi qua cầu nối tới router và **tới
  nhà cung cấp**, nhưng nhà cung cấp trả **429** (`anthropic.failed RATE_LIMIT` trong
  `~/BoxFox/logs/router.jsonl`), nên lượt dừng ở `TURN_FAILED_VALUEERROR` với đúng câu lỗi của
  nhà cung cấp. Đây là hạn mức của tài khoản, không phải lỗi mã.
- **Nhật ký hệ thống**: `?lines=99999` → `lines=500` (trần cứng), `?level=trace` → 400, thiếu header
  admin → 403, `commit=58598c1`; tắt êm tạo `~/BoxFox/logs/harness.previous.jsonl` thật.
- **Đánh giá**: `run_eval.py` chạy khô exit 0 (108 lượt model, 6,44–23,60 USD); `--execute` luôn
  thoát mã 3/5 và không có đường nào tới model khi chưa bật cổng chi tiêu.

### Tổng số ca kiểm thử sau vòng này

| Bộ | Kết quả |
|---|---|
| Backend | **488 passed, 2 failed, 2 skipped** (trước khi sửa tám phát hiện của vòng soát mã: 479/2; ca `test_eval_setup.py` đỏ vì cây sạch nay đã xanh) — hai ca đỏ còn lại là hai ca cũ có điều kiện môi trường: `test_cua_element_selector.py` cần Internet, `test_terminal_tools.py::test_terminal_exec_echo` dùng builtin PowerShell trên box bash |
| `deploy/docker` | **359 OK** |
| Router | **89 pass / 0 fail** |
| Frontend | **682 passed / 4 failed** — bốn ca cũ (`Sidebar.test.tsx` ×3 dưới jsdom, `lib/workspace/index.test.ts` ×1 vì `frontend/.env.local` cục bộ); `tsc -b --noEmit` thoát 0 |

### Vòng 12 (tiếp) — sửa bảy phát hiện của vòng soát mã đợt 10 — 2026-09-20, 08:0x

Vòng soát mã độc lập đọc `58598c1..95076b5` và kết luận **APPROVE WITH COMMENTS**, rủi ro **3/10**,
với tám phát hiện (ba TB, ba Thấp, hai nit). Bảy phát hiện cần sửa đã sửa trong đợt này; một phát hiện
mức ghi chú được ghi nhận thành rủi ro có tên trong tài liệu thiết kế. Chi tiết từng phát hiện ở
`docs/tracking/bug-register.md` §6.6.

| Việc | Nội dung | Bằng chứng |
|---|---|---|
| R10-1 | Nhánh lỗi của công cụ web ghi nguyên câu có truy vấn và URL vào nhật ký DEV (`tool.error` lẫn `web.error`) | `WebError.log_message` + `failures.log_safe_failure()`; ca mới khẳng định truy vấn và chuỗi truy vấn trong URL đều KHÔNG có trong `harness.jsonl` |
| R10-2 | SOP của vai gốc nói "there is NO web-search tool" trong khi cùng request quảng cáo `web_search`/`web_fetch` | ca mới khoá hai vế lại (quyền trong `ORCHESTRATOR_TOOLS` ⊂ câu chữ SOP) |
| R10-3 | Ca kiểm `pins['repo']['dirty'] is True` đỏ trên cây sạch | ca cũ chỉ khẳng định kiểu/được đo; ca mới dựng repo tạm để kiểm cả cây sạch lẫn cây bẩn |
| R10-4 | `reset --file all` đổi tên luôn tệp previous thành `*.previous.previous.jsonl` | ca CLI mới: chỉ còn đúng một tệp previous, và nó là lần chạy vừa kết thúc |
| R10-5 | Nhà cung cấp trả 200 với thân không phải JSON làm đứt chuỗi tìm kiếm | ca mới: nhà cung cấp đầu trả trang chặn, nhà cung cấp sau vẫn được gọi và kết quả thật được trả về |
| R10-6 | `web_fetch` là kênh GET ra ngoài (chiều rò ra khi trang bị tiêm nhiễm) | ghi nhận thành dòng "Rủi ro còn lại: kênh ra" trong `docs/research/host-web-tools.md` §3, kèm cách siết |
| R10-7 | Phép so khớp con trỏ dùng tiền tố nên `X=64` khớp `X=640` | ca mới: đích (64, 3) gặp con trỏ (640, 300) không được coi là tới nơi |
| R10-8 | README của `scripts/eval` ghi "hai biến" nhưng liệt kê bốn | sửa câu chữ |

Tổng số ca sau khi sửa: backend **488 passed, 2 failed, 2 skipped** (+9 ca so với 479 của vòng 12, và ca đỏ vì cây sạch đã xanh);
`deploy/docker` **359 OK**; router **89 pass / 0 fail**; frontend **682 passed / 4 failed**; `tsc` thoát 0.

### Vòng 12 (tiếp) — gỡ nút chặn 1 MiB cho nhiệm vụ CUA nặng — 2026-09-20, 08:3x–09:5x

Ca T21 (nhiệm vụ nặng để mô hình tự chọn chụp màn hình) của vòng kiểm chứng độc lập đợt 10 chết với
`UPSTREAM_HTTP_413: Request is too large.`. Đây là **lỗi có sẵn**, không nằm trong diff của vòng 10,
nhưng nó chặn đúng hạng mục "CUA nhẹ → nặng" của chủ sở hữu, nên được sửa trong ba lớp — mỗi lớp đo
được trên các phiên thật trong `~/BoxFox/harness/sessions.sqlite`.

| Lớp | Việc | Đo trên phiên thật |
|---|---|---|
| 1 — `fa57325` | `runtime.bound_inline_media()`: giữ ảnh của 2 lần chụp mới nhất và tối đa 512 KB trong thân request; ảnh cũ rút về phần chữ kèm đường dẫn tệp. Transcript trong store không đổi | Phiên 1 119 229 B → **307 948 B** (bỏ 7 ảnh); 1 107 429 → **303 055** (6 ảnh); 1 090 982 → **259 986** (8 ảnh); 1 813 206 → **674 074** (8 ảnh) |
| 2 — `6991b17` | `runtime.dedupe_thought_signatures()`: cặp `thought_signature` + `thoughtSignature` của Gemini chỉ còn một khoá trong bản gửi đi | Cặp chữ ký chiếm **761 888 B** ở phiên nặng nhất, 380 944 B ở phiên 1,8 MB; sau lượt này thân đã nằm dưới trần |
| 3 — `344ce0f`, `1a2c…` | `runtime.shrink_request_to_budget(body, messages)`: lượt rút cuối, đo **cả thân request** (prompt vai + lược đồ công cụ) chứ không chỉ `messages`; khi vượt ngân sách **900 KB** thì hạ theo thứ tự ít mất mát nhất — chữ cũ → `thought` cũ → tham số `tool_calls` cũ (giữ `id` + tên công cụ) → 1 ảnh mới nhất → không ảnh nào — dừng ngay khi vừa, ghi `model.request_trimmed` kèm `phase` | Lượt đo lại trên phiên `584d61c8` (ca chết ở bước 25) chứng minh lớp 3 bản đầu **không đủ**: nó chỉ đo `messages` (1 043 364 B) trong khi thân thật là 1 060 902 B — vẫn quá trần 12 326 B. Sau bản sửa: **1 754 163 → 850 965 B**, phase `media-1`; cả năm phiên lớn còn lại đều dưới trần |

Cả năm phiên lớn nhất đo được đều nằm dưới trần 1 048 576 B sau ba lớp. Ca kiểm thử ở
`backend/tests/unit/test_inline_media_bound.py` — **19 ca** (6 ca lớp 1, 3 ca lớp 2, 10 ca lớp 3),
gồm ca khẳng định danh sách gốc không bao giờ bị sửa, ca khẳng định thân request dưới ngân sách
được trả nguyên, ca khẳng định phép đo tính **cả** prompt vai và lược đồ công cụ, ca tái hiện
hình dạng thật của phiên chết vì 413, và ca nhiệm vụ 30 bước liên tục chụp màn hình mà thân request
vẫn luôn dưới trần. Chi tiết ở `docs/tracking/bug-register.md` §6.7.

Một trần nữa lộ ra khi chạy lại ca T21 trên `a78246a`: lượt chết với `CONTEXT_LIMIT: summary failed`
chứ không còn 413. Nguyên nhân: `estimate_tokens` tính **toàn bộ ảnh base64 như chữ**, nên phiên
`08f2483c` bị ước lượng **1 051 631** token trong khi router chỉ báo **358 771** token đầu vào cho
cùng request; `before` vượt `context_window - output_reserve` nên khi lượt tóm tắt gặp 429/90 giây,
bộ nén đi vào nhánh duy nhất làm chết lượt. Nay mỗi ảnh inline được tính bằng
`IMAGE_TOKEN_ALLOWANCE = 1600` (đúng cách nhà cung cấp tính token ảnh), nên cùng phiên đó ước lượng
còn **952 417** — dưới ngưỡng chết, lượt tiếp tục với bản gốc thay vì dừng. Ca kiểm thử mới ở
`backend/tests/unit/test_context_estimate.py` (4 ca).

Lớp thứ tư (commit `14a5935`) mở nốt chỗ chết cuối cùng: nhiệm vụ CUA chỉ có một lời nhắc nên
`compact()` không có lượt cũ nào để nén (`cut = 1`), trong khi lượt tóm tắt bị đẩy cả lịch sử ~900 KB
vào nhà cung cấp. Nay `compact()` gộp chính phần giữa nhiệm vụ (giữ tiền tố hệ thống, lời nhắc và 10
tin nhắn mới nhất), đầu vào tóm tắt do `summarizer_material()` làm phẳng và chặn ở 120 000 ký tự, và
phép tỉa một ảnh chụp giữ phần chữ thay vì cắt nát chính ảnh mới nhất. **Diễn lại phiên thật
`9ec9bf1d`**: `beforeEstimate 1075446 → afterEstimate 314771`, đầu vào tóm tắt còn **15 397 ký tự**.

Hai phát hiện đo được nữa (commit `d0adf36`, ghi ở §6.7 mục F-1f/F-1g): ước lượng ngữ cảnh đếm **hai
lần** cùng một chữ ký suy luận — cùng hai phiên trên nay còn **576 592** và **509 005** token, tức
dưới ngưỡng nén 697 132 nên nhiệm vụ nặng không còn bị nén sớm; và `_drop_oldest_round()` không còn
kéo tin nhắn trong đuôi đang chạy vào tập bị bỏ.

Tổng số ca sau các lớp này: backend **519 passed, 2 failed, 2 skipped** — hai ca đỏ vẫn là hai ca cũ
có điều kiện môi trường. `deploy/docker` **359 OK**; router **89 pass / 0 fail**; frontend
**682 passed / 4 failed**; `tsc` thoát 0.

### Điều vòng này CHƯA làm được

- Chưa có câu trả lời thật từ `/claude-code` vì hạn mức nhà cung cấp (429); cầu nối và CLI đã đúng.
- Cổng mở cầu nối (luật `iptables` trong box + biến `BOXFOX_ANTHROPIC_*` của harness) vẫn làm bằng
  tay, `BOX_LLM_BRIDGE` trong `docker-compose.yml` còn `off` — người dùng phải mở/đặt lại sau mỗi
  lần tạo container.

### Vòng 13 — 2026-09-20 chiều (OpenRouter/DeepSeek Pro, mức thinking, chính sách thử lại)

Chủ sở hữu giao bốn việc lúc 14:28 UTC kèm hai ảnh chụp (`3066.png`, `3067.png`).

**Đã đo được**

- Nhập khoá API OpenRouter **bằng giao diện** (ô API key + `Refresh model`): kết nối
  `7b469e10-1d00-4358-a854-5c42ef5e93b3` ở `https://openrouter.ai/api/v1`, `discoveryState ready`,
  **446 model**, `lastModelSyncAt 2026-09-20T14:29:27Z`. Nút `Test` cho
  `~deepseek/deepseek-pro-latest`: **`Passed` 5 300 ms**, 17 token, `cost 2.28e-05`.
- Lượt chạy thật đầu tiên trên DeepSeek Pro (trước khi sửa frontend) đã **hoàn tất trong 4,0 s**
  (phiên `36b3fc5c…`, 19 sự kiện, `assistant {"text":"4"}`, `finish completed`) — tức nhà cung cấp
  và router đều tốt; lỗi nằm ở mức thinking do giao diện gửi lên.
- **Lỗi mức thinking tái hiện và đã sửa** (§6.8 T-1): `POST /api/agent/sessions` với
  `thinkingLevel: 'medium'` trả `THINKING_LEVEL_UNSUPPORTED: model publishes max/high/low`. Sau khi
  sửa, chạy lại **qua giao diện**: chip `DeepSeek Low`, phiên `c7cb1e8f…` lưu
  `route.thinkingLevel = "low"`, lượt trả `assistant {"text":"2+2 = 4.","thought":"…"}`,
  `finish {"status":"completed"}`, `step {"iteration":1,"contextEstimate":6220}`.
- **Lỗi `Not found` đã sửa** (§6.8 T-2): trên harness mới, `GET`, `POST …/turns`, `POST …/stop` với
  id `deadbeef…` đều trả **404 `SESSION_NOT_FOUND`** kèm chính id; bản cũ trả `{"error": "Not found"}`.
- **Chính sách thử lại** (§6.8 R-1): 13 ca mới trong `backend/tests/unit/test_retry_policy.py`,
  gồm ba ca chạy lượt thật (hai 429 rồi thành công; bỏ cuộc sau 3 lần; 400 hỏng ngay).
- Khoá API Google nhập lúc 14:50 UTC: kết nối `2b922915-4b9e-430d-a867-cb76e47e6965`
  (`https://generativelanguage.googleapis.com/v1beta`), `discoveryState ready`, **41 model**, trong đó
  **có `gemini-3.5-flash-lite`** — nút `Test` trả **`Passed` 600 ms** (12 token). Vậy model này
  **không thiếu**.

**Bộ kiểm sau khi sửa**

| Bộ | Kết quả |
|---|---|
| backend `pytest backend/tests -q` | **532 passed, 2 failed, 2 skipped** (77,30 s) — hai ca đỏ vẫn là hai ca cũ phụ thuộc môi trường: `test_browser_use_navigation_and_dom_inspection` (`ERR_CONNECTION_REFUSED`) và `test_terminal_exec_echo` (`Write-Output: command not found`) |
| `deploy/docker` unittest discover | **359 OK** |
| router `npm test` | **89 pass / 0 fail** (3 176 ms) |
| frontend (hai tệp mới) | `harnessThinking.test.ts` 9 ca + `harnessChatStore.retry.test.ts` 5 ca — **14 passed** |
| frontend `npx tsc -b --noEmit` | thoát **0** |
| frontend toàn bộ | 682 passed / 4 failed — bốn ca đỏ có sẵn từ trước (3 × `Sidebar.test.tsx`, 1 × `workspace/index.test.ts`) |

**Còn nợ của vòng này**: thang kiểm CUA (nhẹ → vừa → nặng có kịch bản → nặng tự do) chạy bằng
`~deepseek/deepseek-pro-latest` và bằng `gemini-3.5-flash-lite`; kết quả bổ sung vào đây khi có.

### Vòng 14 — 2026-09-20 chiều muộn (khoá Google, thang kiểm `gemini-3.5-flash-lite`, tám phát hiện của vòng soát)

**Việc chủ sở hữu giao**: nhập khoá Google, kiểm model `gemini-3.5-flash-lite` có trong danh mục
không, rồi chạy thang CUA hiện tại bằng model đó; mỗi lỗi phải phân loại **model hay mã** trước khi
kết luận, lỗi do model thì ghi vào sổ theo dõi, và nếu thang kiểm chết vì hạn mức nhà cung cấp thì
dừng và báo lại.

**Đo được**

- Khoá Google nhập lúc 14:50 UTC → kết nối `2b922915-4b9e-430d-a867-cb76e47e6965`, `discoveryState ready`,
  **41 model**, `gemini-3.5-flash-lite` **có mặt** (mức `low/medium/high`, cửa sổ 1 048 576), nút `Test`
  trả **`Passed` 600 ms**. Lượt gửi thật đầu tiên qua giao diện trên model này **hoàn tất** (`Chào bạn! BoxFox
  đã sẵn sàng…`, `finish completed`, tuyến `{"connectionId":"2b922915…","modelId":"gemini-3.5-flash-lite","thinkingLevel":"low"}`).
- Tám phát hiện của vòng soát mã đợt 13 (điểm rủi ro **5/10**) đã sửa hết — chi tiết ở §6.9 bảng R14-1…R14-8.
  Hai phát hiện đầu được **đo lại sống** trên giao diện đang chạy:
  - Xoá phiên của một chat rồi gửi ngay trong cùng một nhịp: `DELETE /api/agent/sessions/18358f20…` → 200,
    `POST /api/agent/sessions/18358f20…/turns` → **404**, `POST /api/agent/sessions` → phiên mới,
    `POST /api/agent/sessions/e197d82a…/turns` → câu trả lời. Sau khi phiên mới ra đời **không lời gọi nào**
    trỏ về id chết, khoá `boxfox-harness-session:session-mu9yhydm` mang id mới, màn hình **không còn băng đỏ**
    (`r14_stale_recovery_after.png`; ảnh trước khi sửa: `r14_stale_before.png`).
  - Nhánh còn lại (vòng poll nhận ra trước): chat được dọn im lặng rồi lần gửi kế tiếp mở phiên mới
    (`r14_stale_purge_after.png`).
- **Lỗi mới T-3 (§6.9)**: lượt gửi thật trên `Google Gemini · Gemini 2.5 Flash` chết với
  `UPSTREAM_HTTP_400 … Thinking level is not supported for this model.` Đo trực tiếp trên endpoint Google
  (12 model) để biết model nào nhận `thinkingLevel`: **nhận** — `gemini-flash-lite-latest`, `gemini-3.1-flash-lite`,
  `gemini-3.5-flash-lite`, `gemini-3.8-flash`; **từ chối** — `gemini-2.5-flash`, `gemini-2.5-flash-lite`,
  `gemma-4-31b-it`, `gemini-3.5-transcribe`, `antigravity-preview-09-2026`, `deep-research-preview-04-2026`.
  Sau khi sửa, đo lại trên harness dựng từ nhánh (cổng 3103, phiên `9c2571c3…`, tuyến
  `gemini-2.5-flash` + `thinkingLevel: "medium"`): `notice THINKING_LEVEL_REFUSED` (`level: "medium"`) rồi
  `assistant "2+2 bằng 4."`, `finish completed`, **không có sự kiện `error`**
  (`/code/.generated_artifacts/r14_thinking_level_refused_live.txt`).
- Đo lại **trên giao diện thật** (cổng 3102, sau khi dựng lại harness lúc 15:46 vì tiến trình cũ nạp mã đợt 13):
  cùng khung chat `gemini-2.5-flash` + mức `low`, lượt 15:45 chết `UPSTREAM_HTTP_400 … Thinking level is not supported`
  (không có thông báo bỏ mức), lượt 15:47 phát `notice THINKING_LEVEL_REFUSED {level:"low"}` rồi trả lời
  `2+2=4. 5+7=12.` với `finish completed` và **không** sự kiện `error`
  (`/code/.generated_artifacts/images/r14_thinking_refused_ui_after.png` — hai lượt nằm trong cùng một ảnh).
- Chính sách thử lại chạy thật trong thang kiểm: phiên `51bd6a0b…` gặp hạn mức nhà cung cấp và ghi đúng
  ba thông báo `UPSTREAM_RETRY` (`attempt 1..3`, `waitMs 2000`, `reason rate-limit`) rồi
  `UPSTREAM_RETRY_EXHAUSTED` (`attempts 3`, `waitMs 6000`), băng lỗi cuối có `[after 3 retries in 6.0s]`.

**Bộ kiểm sau khi sửa**

| Bộ | Kết quả |
|---|---|
| backend `pytest backend/tests -q` | **540 passed, 2 failed, 2 skipped** (77,41 s) — hai ca đỏ vẫn là hai ca cũ phụ thuộc môi trường |
| frontend trọng tâm (`harnessThinking`, `harnessChatStore.retry`, `routerChatOptions`, `ChatPanel`) | **35 passed** |
| frontend toàn bộ `npx vitest run` (91 tệp) | **704 passed, 4 failed** — đúng bốn ca cũ phụ thuộc môi trường (3 × `Sidebar.test.tsx`, 1 × `workspace/index.test.ts`); số ca qua tăng từ 682 lên 704 nhờ 22 ca mới |
| frontend `npx tsc -b --noEmit` | thoát **0** |
| ESLint trên các tệp đã sửa | không thêm phát hiện nào (một `no-explicit-any` còn lại trong tệp kiểm có từ trước) |

**Chặn của vòng này**: OpenRouter hết credit (`total_credits: 0`) nên thang DeepSeek Pro **không chạy
được** — lượt 2 chết ở `UPSTREAM_HTTP_402`; chủ sở hữu đã được báo. Các model `gemini-3.8-flash-*` qua
antigravity cũng đang bị hạn mức (`remainingFraction 0`, mở lại 2026-09-23T10:30:01Z).

**Thang kiểm đợt 14 trên `gemini-3.5-flash-lite`** (mức `medium`, `maxSteps 30`, hạn 600 s, do tác nhân
kiểm thử chạy trên harness đang chạy mã nhánh):

| Bậc | Phiên | Bước | Công cụ | Kết quả và phán loại |
|---|---|---|---|---|
| Rất nhẹ (một lần chụp) | `e37d4d79…` | 2 | `computer_screen_capture` ×1 | **hoàn tất**, trả lời đúng `1280x800` — không lỗi |
| Nhẹ (chữ, 3 lệnh terminal) | `8ceb062c…` | 2 | `terminal_exec` ×1 | **hoàn tất** |
| Vừa (kịch bản 4 bước, ảnh sau mỗi bước) | `f7e18f44…` | 5 | `computer_use` ×4 + `computer_screen_capture` ×4 | **hoàn tất**, 0 lỗi công cụ |
| Nặng (nhiều bước, ảnh sau mỗi hành động) | `51bd6a0b…` | 29/30 | `computer_use` ×13 + `computer_screen_capture` ×13 | **chết ở bước 27 vì hạn mức nhà cung cấp**: `UPSTREAM_HTTP_429` → `UPSTREAM_RETRY` 1/3, 2/3, 3/3 (`waitMs 2000`) → `UPSTREAM_RETRY_EXHAUSTED` (`attempts 3`, `waitMs 6000`) |
| Nặng không kịch bản | — | — | — | **không chạy**: luật dừng khi thang kiểm chết vì hạn mức nhà cung cấp |

**Phán loại model hay mã**: cả bậc chết đều **do nhà cung cấp**, không do model yếu và không do mã —
lượt nặng bám đúng kịch bản (`click(15,780)` Application, `click(60,778)` Accessories, ảnh sau mỗi hành
động, 0 lỗi công cụ) rồi mới bị hạn mức cắt ngang; trong cả lượt **0 lần** `UPSTREAM_HTTP_413`,
`CONTEXT_LIMIT`, `THINKING_LEVEL_UNSUPPORTED`, không có sự kiện lạc hay kết quả công cụ sai. Chính sách
thử lại mới hành xử đúng như thiết kế (3 lần rồi dừng, có ghi `attempt`/`waitMs`/`reason`).

**Thang DeepSeek Pro** (chạy trước đó cùng ngày, kết quả để đối chiếu): bậc chụp ảnh **thất bại ngay**
hai lần với `UPSTREAM_HTTP_404: No endpoints found that support image input` — model record của
`~deepseek/deepseek-pro-latest` không có endpoint thị giác, nên đây là **hạn chế của model**, đã ghi để
theo dõi; bậc chữ và bậc vừa **hoàn tất**; bậc nặng lượt 1 chạm `MAX_STEPS` (30 bước, 389,6 s), lượt 2–3
chết vì `UPSTREAM_HTTP_402` (số dư OpenRouter bằng 0).

**Đo lại bốn lỗi chạy sống của các vòng trước trên mã cuối** (tác nhân kiểm thử, hai bản ghi):
`/code/.generated_artifacts/recordings/r13_four_checks_live_walkthrough.mp4` (F6b nhánh khôi phục desktop
lỗi vẫn trả HTTP 200 kèm ảnh thật + `desktopWarning`, F8 hai lần bấm 0,109/0,108 s không `--sync`, F9 con
`/plan` mang `deadlineSeconds 600`, F10 `ANTHROPIC_MODEL` theo router và `grep -ric opus` = 0) và
`/code/.generated_artifacts/recordings/r13_f6b_record_route_output.mp4` (chính tuyến ghi hình trả nội dung
desktop thật trên nhánh lỗi).

### Vòng 15 — 2026-09-20 tối: khoá DeepSeek gốc (API chính chủ)

**Yêu cầu của chủ sở hữu (17:42):** lắp khoá API DeepSeek, **test các model**, **các mức độ response**,
**tra cứu tài liệu cho đúng**, **ping thử các model**, rồi **dùng model DeepSeek 4 Flash để hoàn thiện nốt
phần kiểm thử còn lại** (bậc nặng-không-kịch-bản của thang CUA, thứ mà các vòng trước không chạy được vì
hạn mức Google và vì DeepSeek Pro trên OpenRouter không có endpoint thị giác).

**Lắp đặt:** kết nối `deepseek` id `7ee21256-8675-4ee3-a802-fcedbed8b7ef`, endpoint
`https://api.deepseek.com/v1`, số dư **2,00 USD**, hai model `deepseek-flash` (DeepSeek-V4.1-Flash) và
`deepseek-v4-pro` (DeepSeek-V4-Pro-0813). Chi tiết đo, lỗi T-5 (router kế thừa bộ mức của OpenAI) và cách
sửa nằm ở `bug-register.md` §6.11.

**Số ca sau khi sửa**

| Bộ | Kết quả |
|---|---|
| Router | **98 pass / 0 fail** (91 cũ + 7 ca `tests/deepseek.test.mjs`) |
| Router, riêng tệp mới | 7/7 đạt |

**Phép dò sống (17:52–17:58), tất cả qua router thật**

| Phép đo | Kết quả |
|---|---|
| Nút `Test` cho `deepseek-flash` / `deepseek-v4-pro` | `passed` / `passed` |
| Quét mức qua `/api/router/chat` (đường harness) | `none` → 0 ký tự suy luận; `low`/`high`/`max` → có suy luận, `reasoning_tokens` 10–19; thiếu mức → mặc định nhà cung cấp |
| `/v1/models` bằng khoá box | hai model DeepSeek hiện diện |
| `/v1/chat/completions` | `low`, `none`, `max` đều 200; `none` không có `reasoning_content` |
| Ảnh 16×16 qua router | `deepseek-flash` → "Red" (đúng); `deepseek-v4-pro` → "Brown" (sai, đã ghi `vision: unsupported`) |
| Giao diện | `Single Models` hiện `DeepSeek · deepseek-flash` và `DeepSeek · deepseek-v4-pro` |
| Harness, phiên `5803c1a8…` | mức `high` → `reasoning_tokens: 8` và đáp đúng `3293`; mức `none` → không có token suy luận và đáp đúng `2993` |

Ảnh bằng chứng: `/code/.generated_artifacts/images/r15_deepseek_in_picker.png` (bộ chọn model trong giao
diện với hai model DeepSeek). Bằng chứng thô của phiên harness: `/var/tmp/r15/harness_probe_session.json`.

#### Bậc nặng-không-kịch-bản trên `deepseek-flash` — **PASSED** (18:0x)

Đây là bậc mà các vòng 12–14 không chạy nổi (hạn mức Google, DeepSeek Pro trên OpenRouter không có
endpoint thị giác). Phiên `63fa894d84af46cca41d7e77616800b4`, tuyến lưu trong config
`{7ee21256-…, deepseek-flash, high}`, `contextWindow 64000` (bảng tên), `maxSteps 40`,
`deadlineSeconds 600`.

| Phép kiểm | Kết quả |
|---|---|
| T1 cấu hình phiên | PASS — `thinkingLevels none/low/high/max`, `defaultThinking high`, `vision reported` |
| T2 đi đúng tuyến | PASS — **34/34** dòng usage trỏ đúng kết nối/model DeepSeek; nhật ký router 34 `chat.end`, 0 lỗi |
| T3 hoàn thành nhiệm vụ | PASS — `finish {"status":"completed"}`, **34 bước**, 5930 sự kiện, **78 s** |
| T4 ảnh vào được model | PASS — 2 thông điệp công cụ có phần `image_url` (~104,9 KB mỗi ảnh), 27 dòng `model.media_pruned`, **không** 413, không "No endpoints found that support image input" |
| T5 quét lỗi vận chuyển/ngữ cảnh | PASS — mọi cờ đều false (`UPSTREAM_HTTP_413`, `CONTEXT_LIMIT`, `Request is too large`, `UPSTREAM_HTTP_429`, `UPSTREAM_HTTP_402`, `balance`, `cooling down`, `MAX_STEPS`, `DEADLINE`, `No endpoints…`, `UPSTREAM_HTTP_404`), `errors`/`notices`/`toolErrors` rỗng, chuỗi sự kiện liền mạch 33212→39141 |
| T6 đọc lại bản ghi trong giao diện | PASS — đầu/cuối bản ghi có nhãn `deepseek-flash · 05:58 PM · done · ↑14,6k ↓1,2k` và dòng `Context compacted: 42276 → 21424 tokens` |
| T7 đối chứng thực địa | PASS — Thunar mở `/home/agent/workspace/` + Mousepad mở `cua_task_log.txt`, `ls -la` → **401 byte** |

Trộn công cụ: `computer_screen_capture` 15, `computer_use` 16 (click/gõ thật), `inspect_element` 2,
`terminal_exec` 1. Tổng usage: `prompt 352 591`, `completion 7 506`, `reasoning 3 578`,
cache hit 306 304 / cache miss 46 287.

Bằng chứng: `/code/.generated_artifacts/r15_ladder_deepseek_flash.json` (5930 sự kiện, 34 dòng usage,
khối cờ đều false, 15 ảnh chụp trong phiên),
`/code/.generated_artifacts/recordings/r15_deepseek_flash_cua_mission.mp4` (163,5 s hình desktop),
`/code/.generated_artifacts/recordings/r15_ui_deepseek_transcript.webm` (37,4 s, 374 khung hình),
`/code/.generated_artifacts/images/r15_deepseek_flash_transcript_top.png` và
`…_transcript_footer.png`. Tác nhân kiểm thử không tìm thấy lỗi sản phẩm nào và không sửa tệp nào trong
kho.

**Ghi chú của bậc này (không phải lỗi):** chỉ **2** ảnh chụp mới nhất còn nằm trong ngữ cảnh
(`bound_inline_media` keep=2); con số "768 byte" mà model đọc giữa luồng là tệp đang được ghi dở; thước
ngữ cảnh trong giao diện hiện `21,4k / 200k` trong khi metadata phiên ghi `contextWindow 64000` (lệch
do thước ước lượng phía giao diện, chỉ là hiển thị).

### Vòng 15b + 16 — 2026-09-20 18:2x: cơ chế nhập tay của DeepSeek, nhà cung cấp bên thứ ba (TokenHarbor), và sự thật về chi phí

**Yêu cầu của chủ sở hữu (18:2x):** (1) DeepSeek phải có **cả hai** cơ chế như các model khác — dò tự động
và **nhập tay** — và **`max` phải có cho riêng DeepSeek**; (2) sau khi verify email xong thì **dùng nhà cung
cấp API bên thứ ba (TokenHarbor)** trước, **lỗi nhiều mới quay lại DeepSeek gốc**, còn không thì chạy
DeepSeek **qua** nhà cung cấp đó; (3) đừng quên việc **đơn giản hoá giao diện khu API**.

**Phần 1 — cơ chế nhập tay (đã sửa, `87bc2d6`).** Hai lỗi độc lập, chi tiết ở `bug-register.md` §6.12:
router tự bịa danh sách mức chung cho model nhập tay (thiếu `none`/`max`), và biểu mẫu "Custom Model" của
giao diện **chưa từng tới router** (gửi bản sao mảng `models`, router trả
`INVALID_REQUEST: Select only models discovered for this connection.`). Sửa: hook `manualThinkingLevels()`
do adapter của nhà cung cấp công bố, hàm `manualThinkingLevels(provider)` ở `service.mjs`, và biểu mẫu gửi
`customModel` thay vì `models`. **Bộ router: 100 pass / 0 fail.**

Đo lại sống trên router đã dựng lại (pid 940356):

| Phép đo | Kết quả |
|---|---|
| Hàng nhập tay cũ `r15-manual-probe` (tạo trước khi sửa) | tự lành thành `['none','low','high','max']` |
| Hàng nhập tay mới trên kết nối DeepSeek | `['none','low','high','max']` — **có `max`** |
| Hàng nhập tay trên kết nối `custom` (TokenHarbor) | `['auto','low','medium','high']` — luật chung giữ nguyên |

**Phần 2 — nhà cung cấp bên thứ ba.** Kết nối `custom` id `6c498e9d-f581-455c-849c-e24c37f25ae5`, tên
`TokenHarbor`, endpoint `https://tokenharbor.ai/v1`. Trước khi verify email, cả `/v1/models` lẫn
`/v1/chat/completions` trả **403** `email_verification_required`, và router đã phơi đúng thông điệp của nhà
cung cấp (`Provider authentication failed: Verify your email address to use the API. …`). Sau khi chủ sở
hữu verify:

| Phép đo | Kết quả |
|---|---|
| `GET /v1/models` | **200, 52 model**; bản ghi có `label`, `blurb`, `tier`, `pricing`, `supports_prompt_cache`, `context_length` |
| Số dư gói trả tiền | **0 USD** — `deepseek-v4.1-flash` trả **402** `balance_zero` ("Top up at https://tokenharbor.ai/dashboard") |
| Model miễn phí `deepseek-v4.1-flash:free` | **200**, có `reasoning_content` |
| Bậc văn bản qua harness (3 lệnh `terminal_exec`) | **`completed` sau 75 s**, 2 lượt gọi model, usage `cached_tokens: 4096` |
| Mức `reasoning_effort` qua cổng | `absent`/`none`/`low`/`high`/`max` đều 200; **`none` KHÔNG tắt suy luận** qua cổng (khác API gốc); `bogus` cũng 200 (cổng bỏ qua, không 422) |
| Độ trễ mỗi lượt gọi | **18–64 s** cho một câu hỏi tầm thường (API gốc: ~1–3 s) |

Nghĩa là: TokenHarbor **dùng được** (đường ống đầy đủ đã chạy) nhưng chỉ với các id `:free`, và **điều
khiển suy luận không đáng tin qua cổng** — đúng loại khác biệt phải ghi vào bản ghi chứ không sửa vào mã.

**Phần 3 — chi phí (đo được, đầu vào cho kế hoạch vòng 16).** `router/src/engine.mjs` chỉ ghi `cost` khi
nhà cung cấp tự báo (`reportedCost(usage)`). Trên 200 dòng usage đang lưu: OpenRouter **45/50** dòng có
`cost`, DeepSeek **0/61**, Google **0/79**, nội bộ `router` **0/10**. Vì vậy phần lớn dòng hiện "No data"
dù request đã tiêu tiền thật. Đây là cơ sở cho kế hoạch ba tầng giá (nhà cung cấp báo > giá công bố trong
`/models` > bảng giá tài liệu của DeepSeek > bảng người dùng tự đặt).

**Bậc nặng-không-kịch-bản trên cổng bên thứ ba — THẤT BẠI (18:52, phiên `bb0c66e24f68446fb5152b3e7739dcc2`).**
Cùng nhiệm vụ tự do mà `deepseek-flash` gốc làm xong trong **78 s / 34 bước**, chạy qua
`deepseek-v4.1-flash:free` của TokenHarbor với `maxSteps 40`: 13–14 bước trong **10 phút**, **4 lần**
`model.error` `UPSTREAM_HTTP_502` (`Router HTTP 502 — Provider is unavailable or returned an invalid
response.`), rồi `turn.failed` với **`DEADLINE: the turn ran out of time before an answer was produced`**
(`durationMs 600011,9` — hạn của **lượt** là 600 s, không phải 1800 s khai lúc tạo phiên). Tổng usage của
lượt: `prompt 39 635`, `completion 1 577`, cache đọc 28 800 — **7/7 dòng không có `cost`** như dự đoán.
Theo luật của chủ sở hữu ("lỗi nhiều mới quay lại DeepSeek"), **việc nặng ở lại khoá DeepSeek gốc**; cổng
bên thứ ba giữ vai trò đường nhẹ/vừa và là ví dụ sống cho luồng "custom API" của kế hoạch vòng 17.

### Vòng 16–17 — 2026-09-20 tối muộn: kế hoạch khu API/Provider được duyệt và thi công

**Kế hoạch.** Ba tác nhân soạn thảo (một thiết kế + hai kế hoạch) rồi gộp thành **một** kế hoạch duy nhất
`/code/.plans/v1-api-provider-area.md` (867 dòng, kèm `v1-api-provider-area-summary.md`, 14 bản vẽ HTML và
`designs/design-plan.json` 10 mục — mỗi mục đúng một biến thể được chọn). Chủ sở hữu **đã duyệt**. Ba phần:
(1) tự nhập endpoint bên thứ ba có nút Test, (2) chi phí ba tầng có nguồn, (3) nén khu Provider.

**Đã thi công (năm nhánh song song/serial, mỗi nhánh tự chạy kiểm thử)**

| Commit | Nội dung | Đo được |
|---|---|---|
| `320f5c1` | Phân loại lỗi dò cho endpoint bên thứ ba (`NO_MODEL_LIST` / `NO_MODELS` / `AUTH` / `UNAVAILABLE`, giữ nguyên văn lời nhà cung cấp), `costMode` + `lastDiscoveryAttemptAt`, id gõ tay lưu nguyên văn, test được model chưa bật; module giá thuần `pricing.mjs` | Router **134 / 0** (13 ca `custom-provider`, 21 ca `pricing`) |
| `574a5aa` | Nối giá vào kết nối/model (ba tầng: manual > ping > documented), ghi `cost` + `costBasis` + `estimated` vào usage, sửa hai lỗi C/D ở §6.13, cập nhật `CONTRACT.md` + `README.md` | Router **152 / 0** (14 ca `cost.test.mjs`, 4 fixture dữ liệu thật) |
| `2b87163` | Giao diện: rail provider có tìm kiếm + nhóm, thẻ connection nén, hàng model 28 px, probe không chặn form | 28 ca nhóm lõi; frontend **717 / 4** (4 ca đỏ có sẵn) |
| `8fa0104` | `CustomModelForm` dùng chung có **Add & Test** và nút Test riêng; khối lỗi dò có cấu trúc với `Retry` / `Add model by hand` / `Edit endpoint & key`; sửa huy hiệu `health === 'error'` chết thành `'failed'` | 34 ca nhóm lõi; frontend **726 / 4** |
| `b998129` | Cột Cost hiện nguồn (`est.`, `No price`, `Included in plan`), KPI đếm nguồn, khối `Price` trong khung chi tiết model có `Edit price` / `Clear override`, rail dùng chung cho tab Router | 21 ca nhóm lõi; frontend **733 / 4**; `tsc` 0 |

**Bằng chứng sống của vòng này** (ảnh trong `/code/.generated_artifacts/images/`): `r17_api_tab_1440x900.png`,
`r17_api_tab_no_connection_1440x900.png` (tab API khi chưa có connection: **296 px**, trước ≈ 1 220 px),
`r17_api_tab_900px_mobile_rail.png`, `r17_custom_endpoint_failed_card.png` (đủ ba nút + câu của nhà cung cấp),
`r17_custom_endpoint_add_and_test.png`, `r17_custom_endpoint_add_and_test_running.png`,
`r17_usage_cost_column.png` (một dòng `<$0.0001 est.`, các dòng `No price`, hai dòng `Included in plan`),
`r17_usage_manual_estimate.png`, `r17_model_price_editor.png`, `r17_model_price_saved.png`,
`r17_public_preview_custom_endpoint.png`. Đo mật độ ở 1440×900: trang **không** dài thêm vì danh sách provider
(0 px), rail tự cuộn, 47 provider trong **2** cú bấm, thẻ connection 237 px (không kể khối model).

**Hai chỗ kế hoạch tự mâu thuẫn, đã chốt bằng số đo:** chỉ tiêu "12 hàng provider thấy được" không đạt vì tab
API chỉ có 2 nhóm (nhóm thứ ba thuộc tab Router) — thấy 8 hàng + 2 tiêu đề; và chỉ tiêu "hai thẻ × 8 model
≤ 716 px" mâu thuẫn với yêu cầu hàng model luôn hiện (điều kiện để có nút Test cạnh mỗi model) — chọn giữ hàng
luôn hiện, thẻ 237 px không kể khối model. Ngoài ra nhánh giao diện tự sửa hai lỗi đo được: rail cao hơn
khoảng trống 14 px (`lg:max-h-[calc(100vh-13rem)]` → `-15rem`) và hàng `Show N more` là disclosure một chiều.

### Vòng 17b — kiểm chứng độc lập khu API/Provider, ba lỗi nhập tay và lần sửa

**Lượt kiểm chứng thứ nhất** (tác nhân kiểm thử, `f63f82b`): bốn làn sống A–D trên router `:3101`, harness `:3102`,
Vite `:3100`, cùng một stub OpenAI-compatible trên `127.0.0.1:3199` (chế độ `ok/404/403/empty/html` cho `/models`,
`ok/404/403` cho chat) và bộ ghi request `/var/tmp/r17/stub-records.jsonl`.

| Làn | Đo được |
|---|---|
| A — vào cổng bên thứ ba | TokenHarbor refresh thật **200**, `ready`, 58 model (52 dò được + 6 dòng gõ tay sống sót); bốn lớp lỗi `NO_MODEL_LIST` / `AUTH` / `NO_MODELS` / `UNAVAILABLE` hiện **nguyên văn**; id gửi lên trùng từng ký tự (`matchesKnownExact: true`); probe chạy được trên dòng đã tắt; biên 400/404 |
| B — chi phí ba tầng | `reported` thắng và **không** ước lượng nào lọt khung `/v1/*`; giá tay sống qua refresh và thắng giá ping; `clear:true` trả giá documented; lượt sống DeepSeek `0,000683` (kỳ vọng `0,00068325`), lượt giá tay `0,00061` (kỳ vọng `0,0006102`) |
| C — giao diện Provider | 1440×900: trang **không** cuộn, hàng model **28 px**, rail 240 + pane 1 152; ba lối thoát đủ; lưu/`Clear override` đúng; `est.` / `No price` / `Included in plan` đúng; 1200/1024/900 px không tràn; bản ghi `r17_provider_walkthrough.webm` (317,6 s) |
| D — hồi quy | Router **152 / 0**; frontend **734 / 4** (bộ đỏ có sẵn); `tsc` 0; `deploy/docker` **359 OK** |

Lượt đó cũng so chín mockup của bản vẽ với ảnh chụp thật và ghi sáu sai lệch có chủ đích (hai tab dùng chung rail;
hộp tìm kiếm thay bộ lọc hình phễu; pill `ready` thay `custom / 1 endpoint`; `Base URL` chỉ có ở kết nối `custom`;
nút gửi `Add & Test` thay `Add & Enable`; không có dải kết quả sau refresh). Hạng mục **bị chặn** duy nhất: một dòng
usage `included` **mới** — Antigravity trả 429 và chỉ đặt lại lúc `2026-09-23T10:30:01Z`; bằng chứng thay thế là
module giá gọi trực tiếp (`included_returns: null`, `included_documented_returns: null`), tám dòng ledger Antigravity
có sẵn đều `cost: null`, và câu `Included in the plan — this provider does not bill per token.` trên giao diện.

**Ba lỗi tìm ra (F1/F2/F3) và lần sửa `91647e7`.** Chi tiết cơ chế ở `bug-register.md` §6.14. Tóm tắt số đo:
gõ lại một id đã có chỉ đổi được `name`; **một** lần `Refresh models` hỏng đưa id vừa Test đạt từ `200 BOXFOX_OK`
xuống `503 NO_ROUTE`; và một lần Test đạt làm mất khối `Models could not be listed` cùng ba lối thoát.
Năm ca hồi quy mới: `tests 3 / pass 0 / fail 3` (router) và `2 failed | 8 passed` (giao diện) trên mã **trước** khi
sửa; router **155 / 0**, frontend **736 / 4**, `tsc` 0 sau khi sửa.

**Lượt kiểm chứng thứ hai** (dựng lại router trên `91647e7`, cùng stub): F1 **ĐẠT** (cờ đảo đúng, một dòng, id mới
cùng cờ cho cùng bộ trường), F2 **ĐẠT** (`degraded` → `/v1/chat/completions` **200 `BOXFOX_OK`**, 40/5 token, có
dòng ledger; `GET /v1/models` **63** mục), F3 **ĐẠT** ở cả hai dạng (`failed` + lỗi, và `failed` + `error: null`).
Các làn đã đạt trước đó không đổi: bốn lớp lỗi vẫn nguyên văn, guardrail probe nguyên, ba tầng chi phí nguyên
(ping `0,000012`; reported `0,000123` `estimated:false`; manual `0,00005`; `clear` → ping trở lại; lượt sống
DeepSeek 32/8 → `0,00001`), dòng gõ tay sống qua refresh thành công, thẻ connection ở 1440×900 vẫn
`doc.scrollH 900 == clientH 900`. Dọn dẹp: năm kết nối tạm xoá, khoá router tạm thu hồi, stub tắt, không còn giá
tay; còn **7 dòng usage `r17/*` mồ côi** trong ledger (kết nối đã xoá, chỉ là số liệu phân tích).

### Vòng 17c — soát mã độc lập vòng 17 và năm lỗi nó tìm ra (`2a0075c`)

Vòng soát chỉ đọc trên `bff9f3d..91647e7` (bộ router 155/155, `src/components/settings` 38/38 xanh). Bảy phát hiện,
chi tiết cơ chế ở `bug-register.md` §6.15: token ghi cache bị tính hai lần (`0,01055` so với số thật `0,00785` — chỗ
**duy nhất** trong bộ thay đổi ghi ra một con số tiền sai), `capabilities` ghi một từ vựng thứ năm (`supported`) mà
không trình đọc nào biết nên ô Vision tự tích không hiện bằng chứng, khối `Models could not be listed` hiện cho cả
lỗi không phải lỗi dò danh sách, cảnh báo ngày lễ thiếu ở tooltip và tài liệu, bộ lọc Free đọc hình dạng giá cũ,
lần Test hỏng chỉ còn báo bằng màu. Câu hỏi sản phẩm còn lại — connection thuê bao có được ghi cost do chính nhà
cung cấp báo không — chốt theo hướng **ghi và hiển thị**: miễn trừ `included` chỉ áp cho phép ước lượng của ta.
Sáu ca kiểm thử được viết/thêm và **đều đỏ trên mã trước khi sửa**: dựng hàng Anthropic qua `normalizeUsage()` thật
(`not ok 107`, `pass 154 / fail 1`), cặp `included` + cost tự báo, từ vựng `capabilities`, hai ca thẻ không được nói
sai về danh sách model, bộ lọc Free hai chiều, và `title` của ô độ trễ.

**Đo lại trên `2a0075c` sau khi sửa** (tác nhân kiểm thử, tám hạng mục, tất cả ĐẠT): mô-đun trước/sau cho đúng cặp
`0,01055 → 0,00785`; một lượt chạy qua stub lưu `cost 0,001429` (miss 189) thay vì `0,001564`, và sau `clear:true`
dòng mới là `cost null / basis null` còn dòng cũ giữ `manual`; khai `{vision:true, reasoning:false}` cho
`vision 'reported'` và huy hiệu **Vision Supported** hiện được trong trình quản lý (trước đó không đường nào tới);
connection `ready` + `error` chỉ còn **một dòng đỏ** của router — `Models could not be listed`, `Last attempt:`,
`Retry`, `Add model by hand` đều vắng (đọc DOM), còn `degraded` (refresh 404, giữ 5 model) và `failed` vẫn đủ khối
ba lối thoát; tab Free liệt kê đúng dòng giá 0 và `Enable Free` chỉ bật `['r17/stub-free-1']`; bốn ô `est.` của
DeepSeek mang nguyên văn cảnh báo ngày lễ; `title` của ô độ trễ đọc `Failed · failed · HTTP 403 · 2 ms · …`.
Bộ kiểm thử: router **156 / 0**, frontend **739 / 4** (đúng bộ đỏ có sẵn), `tsc` mã 0. Dọn dẹp: hai kết nối tạm xoá,
khoá tạm thu hồi, stub tắt, không còn giá tay; ledger tăng đúng **2 dòng mồ côi** (`r17/cache-money`) → **16 dòng
`r17/*` mồ côi** tổng cộng (kết nối đã xoá, chỉ là số liệu phân tích).
