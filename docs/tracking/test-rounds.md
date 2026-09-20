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

Tổng số ca sau ba lớp này: backend **511 passed, 2 failed, 2 skipped** — hai ca đỏ vẫn là hai ca cũ
có điều kiện môi trường. `deploy/docker` **359 OK**; router **89 pass / 0 fail**; frontend
**682 passed / 4 failed**; `tsc` thoát 0.

### Điều vòng này CHƯA làm được

- Chưa có câu trả lời thật từ `/claude-code` vì hạn mức nhà cung cấp (429); cầu nối và CLI đã đúng.
- Cổng mở cầu nối (luật `iptables` trong box + biến `BOXFOX_ANTHROPIC_*` của harness) vẫn làm bằng
  tay, `BOX_LLM_BRIDGE` trong `docker-compose.yml` còn `off` — người dùng phải mở/đặt lại sau mỗi
  lần tạo container.
