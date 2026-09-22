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

## Vòng 18 — chín yêu cầu của chủ sở hữu, ba nhánh C/D/E (2026-09-21)

Kế hoạch được duyệt: *"Một lượt trợ lý gọn theo nhóm, màn Máy tự nối lại, công tắc bảng Workspace, và hai tab
Settings có thật"* (`plan_id` 1223, 15 bản vẽ thiết kế). Ba nhánh: **C** — cửa sổ ngữ cảnh có nguồn và bản ghi màn
hình xem được (yêu cầu 1, 9); **D** — một lượt trợ lý đọc gọn hơn (yêu cầu 4, 5, 6); **E** — màn Máy tự nối lại,
công tắc bảng Workspace, hai tab Settings, số đo điểm ảnh (yêu cầu 2, 3, 7, 8). Việc chốt mã: `fc51864`.

### Số ca kiểm thử trước và sau

| Bộ | Trước vòng 18 | Sau vòng 18 | Đỏ còn lại |
| --- | --- | --- | --- |
| Router (`/opt/node24/bin/npm test`) | 156 ca (155 đạt, **1 đỏ** do ca phụ thuộc ngày) | **176 ca / 176 đạt / 0 đỏ** | không |
| Harness (`backend/tests/unit`) | 544 ca (540 đạt, 2 đỏ, 2 bỏ qua — đo cả cây) | **561 ca / 560 đạt / 1 đỏ** | `test_terminal_tools.py::test_terminal_exec_echo` (có sẵn; cần PowerShell/TTY) |
| Giao diện (`npx vitest run`) | 743 ca / 94 tệp (739 đạt, 4 đỏ) | **885 ca / 111 tệp / 881 đạt / 4 đỏ** | 3 ca `components/shell/Sidebar.test.tsx` + 1 ca `lib/workspace/index.test.ts` (có sẵn) |
| Kiểu (`tsc -b --noEmit`) | 0 lỗi | **0 lỗi** | — |

### Vì sao "cửa sổ ngữ cảnh" là lỗi thật (chi tiết ở `bug-register.md` §6.16)

Ba tầng cùng đoán theo tên nên cùng một câu hỏi có ba câu trả lời khác nhau; số 64 000 mà giao diện in còn mang nhãn
`est.` nên trông như đã có nguồn. Sau khi sửa, một bảng duy nhất ở router và một nhãn nguồn đi cùng mọi con số. Số đo
sống và phép lành phiên cũ ở §6.16 và ở mục nghiệm thu dưới đây.

### Việc chốt và ca cũ phải sửa (kèm lý do)

- `router/tests/cost.test.mjs`: ca `a manual price shows through the snapshot…` so ngày hôm nay với ngày trong bảng
  giá. Sửa để so với `DEEPSEEK_PRICE_AS_OF` — ca đỏ **có sẵn** từ trước vòng này, không do đợt này.
- `router/tests/deepseek.test.mjs`: câu "payload không mang độ dài nên không bịa số nào" (`contextWindow === null`)
  nay sai có chủ đích — dòng `deepseek-flash` **có** số từ bảng kèm nhãn `documented`, còn `deepseek-r1` (ngoài
  bảng) vẫn `null` như cũ, nên ca cũ được viết lại thành hai nửa và thêm một ca mới.
- `router/tests/model-metadata.test.mjs`: `SHARED_FIELDS` thêm `contextWindowSource`/`contextWindowReported` (hợp
  đồng dòng model mở rộng), hai phép so thêm nhãn nguồn, thêm ca "dòng đã lưu nhận bảng và dòng ngoài bảng giữ số của
  nó".
- `backend/tests/unit/test_fix_batch.py`: ca `…prefers_explicit_then_router_metadata` so **số trần**; hàm nay trả
  **cặp** `(số, nguồn)` nên sáu phép so được viết lại, và thêm ca nhãn `fallback` cho model không nguồn nào biết.
- `frontend/src/components/panels/ContextUsageBar.test.tsx`: hai ca viết lại (đường "số đang hiệu lực trong phiên →
  dòng router → bảng tĩnh", và ca heuristic-theo-tên nay phải trả `unknown`), một ca dựng lại trên `claude-3.7-sonnet`
  vì `unknown` không còn in `est.`; thêm bốn ca mới.
- Nhánh D — `components/chat/HarnessStepView.test.tsx`: **8 ca cũ** phải sửa vì hành vi mới (mở khối hoạt động trước
  khi đọc một hàng, một khối `data-activity` duy nhất, bản ghi nằm sau chevron, nhãn `View details`).
- Nhánh E — `lib/vnc/state.test.ts` mở rộng theo thang mới (bỏ trần 4 lượt, nấc cuối giữ ở 20 s), và các ca
  `SandboxScreenPanel` viết lại theo lớp phủ thay cho hai nút thử lại.

### Số ca mới theo nhóm

Cửa sổ ngữ cảnh **16** (router `context-window.test.mjs`) + **1** (router `model-metadata`) + **1** (router
`deepseek`) + **4** (harness `test_context_window_heal.py`) + **4** (giao diện `ContextUsageBar.test.tsx`); lượt trợ
lý của nhánh D **17** ca mới trong `HarnessStepView*` cộng **8** ca đầu tiên cho khung xem
(`MediaLightboxModal.test.tsx`) và **2** ca chuỗi mở khung xem (`MediaLightboxFlow.test.tsx`); màn Máy và bố cục
**66** ca (vnc state 14, hook 5, `ui.test.tsx` 6, `uiStore.workspace` 11, `SandboxScreenPanel` 18, `App.workspace` 8,
`ChatPanel.workspace` 4); hai tab Settings **39** ca (instructions, sổ phiên, đường gửi, sổ harness) cộng **21** ca
editor/danh sách/visualizer của nhánh còn lại.

### Nghiệm thu sống

Router và harness được khởi động lại để chạy mã mới. `/api/router/state` → `deepseek-flash` **1000000 /
documented**; TokenHarbor `deepseek-v4.1-flash` **1000000 / documented / reported 1048576**; OpenRouter
`deepseek/deepseek-v3.2` **163840 / reported** (dòng cũ, không có bảng). `GET /v1/models` (61 dòng) đọc cùng bộ số.
Phiên mới tạo với `deepseek-flash`: `1000000 / documented` (trước đợt này: `64000`, không nhãn); phiên khai tay
`32768`: `32768 / manual`. Phép lành một lần: 4 phiên còn `64000` và 22 phiên `1048576` trong 50 phiên lưu sẵn đều
thành cặp `(số, nhãn)`; lần khởi động thứ hai **đổi 0 dòng**. `GET /api/agent/runtime-info` trả 7 nhóm / 20 công cụ /
9 vai trò, retry `{3, [1,4,12], 30, 60, 0.2}` và `limits.instructionsChars 12000`. Lỗi định tuyến được đo lại trên
router đang chạy: `deepseek-v4-pro` và `Claude 3.7 Sonnet` → `404 MODEL_NOT_FOUND`, còn
`7ee21256-…/deepseek-flash` → `200`.

Ghi chú trung thực: phép lành đưa hai phiên rất cũ (khai `30000` và `250000` **trước** vòng này, không có trường
nhãn) về số của định tuyến — từ vòng này mọi lời khai đều mang nhãn `manual` và không bị chạm. Hàng `info` "context
window healed for N stored sessions" không xuất hiện trong nhật ký harness vì harness không cấu hình handler logging
nào; phép lành được đo bằng chính các bản ghi phiên.

### Vòng soát mã độc lập đợt 18 — bảy phát hiện, đã sửa hết (`074a8ae`)

Vòng soát đọc diff `a061f03..fc51864`, kết luận `RISK SCORE 4` / `Medium` / ngưỡng 7 / `Ship with mitigations`. Nó
không chạy bộ kiểm thử (đúng phạm vi), nhưng tự dựng script trong `/var/tmp` để tái hiện hai phát hiện và mở bản ghi
phiên thật ở chế độ chỉ-đọc để chứng minh phát hiện còn lại. Bảy phát hiện và bản sửa ở `bug-register.md` §6.18; đây là
số ca kèm theo.

| Bộ | Trước lượt sửa (`fc51864`) | Sau lượt sửa (`074a8ae`) | Đỏ còn lại |
| --- | --- | --- | --- |
| Router | 176 / 176 đạt | **178 / 178 đạt** | không |
| Harness (`backend/tests/unit`) | 560 đạt, 1 đỏ | **561 đạt, 1 đỏ** | `test_terminal_tools.py::test_terminal_exec_echo` (có sẵn) |
| Giao diện (`npx vitest run`) | 885 ca / 111 tệp, 4 đỏ | **894 ca / 111 tệp, 890 đạt, 4 đỏ** | đúng bốn ca có sẵn (3 × `Sidebar`, 1 × `workspace/index`) |
| Kiểu (`tsc -b --noEmit`) | 0 lỗi | **0 lỗi** | — |

**Chín ca mới, mỗi ca khoá đúng một phát hiện:** `HarnessStepView.media.test.tsx` (+2 — hàng `start` chưa từng `stop`
được mở, và một bản ghi đã đóng vẫn đúng một player); `uiStore.workspace.test.ts` (+3 — `selectFile` hiện bảng đang ẩn,
đường cũ khi bảng đang hiện, hàng đợi đóng băng được xả đúng luật); `harnessStore.workspace.test.ts` (+3 — `null` xoá
hẳn khoá, `undefined` không đụng tới, bật lại đủ bộ công cụ thì danh sách thu hẹp biến mất);
`ContextUsageBar.test.tsx` (+1 — bản ghi không nhãn nguồn không được đọc là `reported`, kèm nhãn lạ và đối chứng
`reported` thật); `router/tests/context-window.test.mjs` (+2 — `contextWindowReported` không được bằng số đang dùng, và
cận trên `2 000 000` mà vòng soát ghi là "chưa đo"); `backend/tests/unit/test_owner_settings.py` (+1 — phiên tạo không
qua giao diện thừa hưởng tài liệu đang lưu, chỉ dẫn client gửi kèm vẫn thắng, tài liệu rỗng thì không có khối nào).

Hai câu chữ đổi theo bản sửa (không phải ca mới): `contextUsage.fallbackHint` ở **cả hai** danh mục và ca
`nguồn sàn của phiên` trong `ContextUsageBar.test.tsx` — câu cũ ("sàn an toàn {{tokens}} token") chỉ đúng cho sàn thật,
không đúng cho một bản ghi cũ mang số khác mà không có nhãn nguồn, nên câu mới nói thẳng "harness đang giữ {{tokens}}
token, không phải số nhà cung cấp báo".

**Đo lại sống sau lượt sửa:** router khởi động lại (pid 1189311) và harness khởi động lại (pid 1189363): `/api/router/state`
trả **556** dòng có cửa sổ, `deepseek-flash` vẫn `1000000 / documented / reported null`; phép lành lúc khởi động **đổi
0 dòng**; và trong 131 bản ghi phiên thì 13 dòng **không có nhãn nguồn** (9 × `1000000`, 4 × `128000`) — đúng nhóm mà
phát hiện R4 nói tới, nay hiện kèm `est.` và tooltip.

## Vòng 19 — nén ngữ cảnh theo HERMES/PI, OpenCode Free dùng được, và đồng bộ 9Router v0.5.81 (2026-09-21 chiều)

Chủ sở hữu giao bốn việc: (1) clone `hermes-agent`, đọc **cả** `hermes-agent` **và** `pi` rồi port logic nén ngữ cảnh về
BoxFox (bản v1 port thẳng, đối chiếu xem bản BoxFox hiện tại có đúng gốc không) và đề xuất cơ chế nén tự động vì ngưỡng
70 % không bao giờ chạm tới; (2) thử OpenCode Free với **Muse Spark 1.2** xem có dùng được không; (3) nếu 1.2 chạy được
thì chạy nốt các phép kiểm từng bị cắt vì giới hạn, không còn thì dùng DeepSeek API Flash (không phải Pro); (4) nếu 1.2
chạy được mà không bị giới hạn nặng thì chạy các benchmark chuẩn dùng 1.2 — chỉ 1.2, còn không thì báo lại. Tin thứ hai:
clone 9Router bản mới (v0.5.81) và đồng bộ có lọc sang BoxFox, **giữ nguyên UI/UX**, chỉ chỉnh logic.

### Số ca kiểm thử trước và sau

| Bộ | Trước vòng 19 | Sau vòng 19 | Đỏ còn lại |
| --- | --- | --- | --- |
| Router (`/opt/node24/bin/npm test`) | 178 ca / 178 đạt | **207 ca / 207 đạt / 0 đỏ** | không |
| Harness (`backend/tests/unit`) | 561 đạt, 1 đỏ | **583 đạt, 1 đỏ** | `test_terminal_tools.py::test_terminal_exec_echo` (có sẵn; cần PowerShell) |
| Giao diện (`npx vitest run`) | 894 ca / 111 tệp, 890 đạt, 4 đỏ | **894 ca / 111 tệp, 890 đạt, 4 đỏ** | y hệt bốn ca có sẵn — vòng này **không đụng** tệp giao diện nào |
| Kiểu (`tsc -b --noEmit`) | 0 lỗi | **0 lỗi** | — |

**Ca mới:** router **27** (OpenCode 15, hết hạn/cooldown tài khoản 5, lỗi giữa luồng 4, chữ ký suy luận theo họ model 3);
harness **19** (`test_compression_port.py` — 16 ca đơn vị + 3 ca chạy một lượt thật qua `HarnessRuntime` với client giả để
khoá đường ghi usage, đường thay danh sách + huỷ hoá đơn cũ, và trạng thái chống-thrash theo phiên).

### Chủ đề 1 — Nén ngữ cảnh: ngưỡng nay chạm được (chi tiết ở `bug-register.md` §6.20)

Ngưỡng cũ là 70 % cứng của cửa sổ: trên cửa sổ 1 000 000 token ⇒ **697 132 token** (`int((1 000 000 − 4 096) × 0,7)`), trong khi trần thật của một request
là 900 KiB thân bài ≈ 307 000 token. Nghĩa là router cắt bớt trước khi ngưỡng chạm, không checkpoint, rồi các lượt sau
`UPSTREAM_HTTP_413`. Sau khi port: `threshold = min(threshold_tokens hoặc phần trăm, trần byte 301 200)`, đo bằng hoá đơn
thật của router, tỉa nhiều lượt + khử trùng lặp trước khi tóm tắt, đuôi theo ngân sách token, trần tóm tắt co theo độ lớn
transcript, chống-thrash 300 s, và cờ `ineffective` khi nén xong vẫn sát ngưỡng.

**Ngưỡng theo cửa sổ:** 1 000 000 → **301 200** (trước 697 132); 128 000 → 86 732 (không đổi); 32 768 → 20 070 (không
đổi — trần byte không chạm tới ở cửa sổ này).

**Bằng chứng sống:** harness chạy mã mới; phiên `b2cfba9a245b4e84bb06f0ae468f6192` (`deepseek-flash`, cửa sổ khai tay
32 768 để ngưỡng chạm được trong ngân sách) sinh **hai** lần nén tự động:
`{"kind":"summary","beforeEstimate":20408,"afterEstimate":16267}` và `{"kind":"summary","beforeEstimate":21127,
"afterEstimate":13869}`; hai checkpoint `reason=summary` (id 13, 14) ghi **trước** khi thay danh sách; lượt kế tiếp mở
bằng 15 message thay vì 24. Cửa sổ khai tay đã xoá lại: `deepseek-flash` về `1000000 / documented`,
`muse-spark-1.2-contributor-free` về `null`.

**Hai lần từ chối thật khi cửa sổ quá nhỏ (giữ nguyên nhánh fail-closed):** khai 8 192 ⇒ `CONTEXT_LIMIT: current turn/tools
exceed the context budget` (prompt hệ thống + schema công cụ không lọt ngân sách 6 144); khai 32 768 rồi đổ một kết quả
công cụ ~33 000 token trong một lượt ⇒ `CONTEXT_LIMIT: summary did not reduce context enough`. Bản gốc còn nguyên trong cả
hai trường hợp.

### Chủ đề 2 — OpenCode Free với Muse Spark 1.2: **dùng được** (chi tiết ở `bug-register.md` §6.19)

Bậc miễn phí từ chối `403 FreeTierError`/`429` trước đây vì bốn cổng: User-Agent không số, thiếu tool mồi, `stream:false`
của người gọi, và phiên `ses_<32 hex>` mint mới mỗi request. Đo từng biến một (bảng ở §6.19), sửa hết, và hợp đồng dây
ghi ở `router/CONTRACT.md`. Sau khi sửa: khám phá **74 dòng / 8 id bật**; lượt gọi tool thật **1,1 s**; lượt có ảnh trong
kết quả tool trả lời đúng **5,4 s**; người gọi `stream:false` nhận câu trả lời thật **7,6 s**.

Hai giới hạn của nhà cung cấp, đo được và **không** phải lỗi của BoxFox: tên công cụ **quá một dấu chấm** bị từ chối
(`invalid_request_error: name may contain at most one dot`), và bậc miễn phí có **trần theo cửa sổ** (xem chủ đề 4).

### Chủ đề 3 — Hai bậc CUA từng chết vì giới hạn: **PASSED** trên Muse Spark 1.2

Vòng 14 bậc "nặng-có-kịch-bản" chết ở bước 27/30 với `UPSTREAM_HTTP_429` → `UPSTREAM_RETRY_EXHAUSTED`, còn bậc
"nặng-không-kịch-bản" chưa từng chạy. Vòng này chạy cả hai qua OpenCode Free + `muse-spark-1.2-contributor-free`
(`maxSteps 30`, `deadlineSeconds 600`):

| Bậc | Kết quả | Số bước | Công cụ | Lỗi | Giới hạn |
| --- | --- | --- | --- | --- | --- |
| Nặng có kịch bản (14 bước: menu Application → Terminal → 3 lệnh → đóng cửa sổ, chụp sau mỗi bước) | **PASSED** | 25 | 24 (`computer_use` 14, `computer_screen_capture` 9, `inspect_element` 1) | 0 | không có `429`, `413`, `CONTEXT_LIMIT` |
| Nặng không kịch bản (tự mở trình quản lý tệp, tạo thư mục + tệp, chụp bằng chứng) | **PASSED** | 8 | 7 (`terminal_exec` 5, `computer_screen_capture` 2) | 0 | như trên |

Đối chiếu khách quan cho bậc hai: trong hộp, `ls -la /home/agent/boxfox-r19/` có `ladder.txt` **25 byte**, nội dung đúng
`muse-spark-1.2 heavy rung`. Tổng hoá đơn của bậc một: 25 lượt gọi, 229 122 token vào / 13 990 token ra.

### Chủ đề 4 — Benchmark tier-0 `bfcl-simple-subset` với Muse Spark 1.2: **92,1 %**, rồi bậc miễn phí chặn

Bộ dữ liệu BFCL v3 `simple` (400 câu) tải từ HF, chạy qua chính router; lỗi hạ tầng không bao giờ tính là câu sai. Hai
lỗi của **chính bộ chạy** lộ ra và được sửa trước khi lấy số: BFCL phát schema kiểu Python (`type: dict`, `float`) nên
OpenCode từ chối `Invalid JSON schema` (50 câu "rỗng" giả), và một thân bài lỗi **không phải SSE** đã bị bỏ qua.

| Executor | Câu đã gọi | Chấm được | Đúng | Sai | Hạ tầng | Điểm trên phần chấm được |
| --- | --- | --- | --- | --- | --- | --- |
| Muse Spark 1.2 (OpenCode Free), câu `simple_0`–`simple_233` | 234 | 228 | 210 | 18 | 6 (5 lần trần token đầu ra + 1 câu bị luật tên công cụ) | **92,1 %** |
| DeepSeek Flash (API), câu `simple_234`–`simple_399` | 166 | 79 | 74 | 5 | 87 (85 câu bị nhà cung cấp từ chối vì tên công cụ có dấu chấm, 2 câu trả lời rỗng) | 93,7 % |

Hai nửa này **không chồng lên nhau** (166 câu sau chỉ chạy sau khi bậc miễn phí đã chặn hẳn), nên gộp lại là 307 câu chấm
được / 284 câu đúng = 92,5 % — con số gộp chỉ để tham khảo, không phải điểm của một model nào.

Ghi chú trung thực về điểm của Muse Spark 1.2: trong 18 câu sai, **5 câu chỉ sai cách viết** và không phải kiến thức
(2 câu `[12, 15, …]` so với `[12.0, 15.0, …]`, 3 câu viết `x^2` thay vì `x**2`); nếu tính cả năm câu đó thì 94,3 % — con số
này **không** phải thang chấm của BFCL nên chỉ ghi kèm. 13 câu còn lại sai thật (thiếu tham số, chọn giá trị khác nghĩa).

Trần của bậc miễn phí: sau câu `simple_233`, nhà cung cấp trả `[rate_limit_exceeded] Output token rate limit exceeded`, rồi mọi
lượt sau — kể cả một bậc CUA chạy song song — bị chính router trả `429` (`This target is cooling down after a provider
limit.`) trong hơn 35 phút. Đây là **giới hạn của bậc miễn phí**, không phải lỗi mã; phần còn lại chạy bằng DeepSeek API
Flash đúng như quy tắc dự phòng của chủ sở hữu.

### Chủ đề 5 — Đồng bộ 9Router v0.5.81 (lọc sáu ứng viên, không đụng giao diện)

Bản clone `/var/tmp/9router` ở commit `a8c9d38` (*"docs: update changelog header to v0.5.81"*, 2026-09-18);
`git fetch --all` xác nhận **không có commit mới hơn**. Sáu ứng viên được lọc theo đúng mã nguồn 9Router rồi mới port:

| # | Ứng viên | Kết quả | Nơi sửa | Ca khoá |
| --- | --- | --- | --- | --- |
| 1 | Chữ ký suy luận của Gemini chỉ dùng lại cho đúng họ model | **ĐÃ PORT** | `router/src/anthropic.mjs:56,66,70,83` (ghi `:506`, đọc `:286`) | 3 |
| 2 | Lỗi 4xx theo phạm vi request không được đánh hỏng tài khoản/không vào cooldown | **ĐÃ PORT** | `router/src/errors.mjs:44`, `router/src/engine.mjs:148` | 5 |
| 3 | Lỗi giữa luồng sau `200` phải thành khung lỗi + `[DONE]` | **ĐÃ PORT** (hẹp hơn bản gốc) | `router/src/server.mjs:145-153` | 4 |
| 4 | DeepSeek V4/V4.1: mức suy luận `low`/`max` và luật vision theo bản có dấu chấm | **ĐÃ PORT** (không đụng `none/low/high/max` đang ghim) | `router/src/providers/deepseek.mjs:104,112,121` | 2 |
| 5 | Kiro: giữ dấu gạch dưới, tên công cụ của client, ảnh trong kết quả tool | **BỎ QUA** | BoxFox **không có** adapter Kiro (`adapterFor('kiro')` trả `null`, catalog ghi `planned`) | — |
| 6 | Ollama Cloud thêm `deepseek-v4.1-flash:cloud` | **BỎ QUA** | không có danh sách model Ollama để sửa; inventory dò sống từ `GET https://ollama.com/v1/models` | — |

Ngoài phạm vi, đã ghi rõ: OAuth Xiaomi MiMo, công tắc 1M của Claude Code + `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, Command
Code, Zed, màn Usage/credit, phạm vi hiển thị Model Catalog, i18n tiếng Ba Tư. Vòng này **không** sửa tệp nào trong
`frontend/`.

### Vòng soát mã độc lập đợt 19 — bốn phát hiện, ba sửa (2026-09-21 tối)

Vòng soát mã độc lập (`r19-review`, dải `00b7a8a..374a70a`) chốt **"Ship with mitigations"**, rủi ro **4/10 (Trung bình)**,
và đề nghị sửa F1 + F3 trước lượt kiểm chứng cuối. Cả ba phát hiện có mã đã sửa ở commit `f827dd5`, mỗi bản sửa có bài
khoá; F4 ghi nhận có chủ đích. Chi tiết đầy đủ nằm ở `docs/tracking/bug-register.md` §6.21.

| Phát hiện | Mức | Bản sửa | Ca khoá |
| --- | --- | --- | --- |
| F1 — đuôi nguyên văn co về 0 khi transcript kết thúc giữa một loạt công cụ song song to hơn `tail_budget` | Cao | `keep_tail()` (`compression.py:180-199`, gọi ở `:479` và `:486`) | `test_the_fold_never_takes_the_whole_tail_of_a_parallel_batch` |
| F2 — `compact()` trả bản sao y nguyên kèm event `prune` khi hoá đơn vượt ngưỡng mà chưa tỉa được gì | Trung bình | hợp đồng no-op ở hai nhánh thoát sớm của vòng tỉa (`compression.py:498`, `:528`) | `test_a_usage_trigger_with_nothing_to_prune_is_a_no_op` |
| F3 — nhánh chat với `tools: []` không được nguỵ trang, cú từ chối hình dạng bị xếp là lỗi khoá | Trung bình | nhánh chat luôn gửi công cụ mồi (`opencode.mjs:668-672`) | 2 ca trong `router/tests/opencode.test.mjs` |
| F4 — `threshold_tokens` không có điểm gọi; dòng `tool_choice` vô hại | Thấp | ghi nhận, giữ nguyên (bề mặt có test / bản đối chiếu 9Router) | — |

**Khe hở bàn giao do làn kiểm thử nêu** (điểm gọi `/compact` chưa có bài nào chạm) đã đóng bằng
`test_the_manual_compact_command_anchors_on_the_recorded_usage` ở `342d31e`. **Đo sống sau khi sửa** (harness chạy mã mới,
`deepseek-flash`, cửa sổ khai 32 768, phiên `985672004f4b44ab85efc6db7c37e421`): lượt tỉa
`{"kind":"prune","beforeEstimate":20353,"afterEstimate":19517,"pruned":4}` và lượt gộp
`{"kind":"summary","beforeEstimate":21467,"afterEstimate":16325}`, hai checkpoint ghi trước khi thay danh sách, danh sách
gộp còn 13 message (3 hàng `tool`, 2 hàng `user` nguyên văn). **`/compact` đầu-cuối trên OpenCode Free** (phiên
`cfd20946b37947069c0cadedf700d8c3`, `nemotron-3-ultra-free`, qua router sống sau khi khởi động lại):
`{"kind":"summary","beforeEstimate":13626,"afterEstimate":3907}`, không lỗi — trên cửa sổ 128k thì lệnh nói thật
`{"kind":"unchanged"}`. Hình dạng `tools: []` trước/sau khi khởi động lại router, cùng khoá: trước `403 AUTH`, sau
`200` trong 1,0 s.

## Vòng 20 — nhật ký tác vụ dài và thư mục riêng cho mỗi phiên, kế hoạch có phiên bản thật kèm thang điểm, và hai lỗi trần bước/agent con (2026-09-21 tối)

Vòng này bắt đầu từ **phép đo byte**, không phải từ cảm nhận: chủ sở hữu thấy các phiên dài thường "đuối" mà không rõ vì
sao. Đo `~/BoxFox/harness/sessions.sqlite` trong box cho ra bốn con số buộc phải sửa:

| Chỗ chứa | Kích thước | Số hàng | Ghi chú |
| --- | --- | --- | --- |
| `sessions.messages` | **36 435 050 B** | 150 phiên | hàng to nhất **6 424 279 B** |
| `checkpoints.messages` | **17 967 616 B** | 22 hàng / **12** phiên | chỉ 8 % số phiên có bản lưu; hàng to nhất **3 170 519 B** |
| `events` | 6 324 257 B | **74 994** | **0** hàng `turn_start` / `turn_end` |
| tệp `sessions.sqlite` + WAL | 76 111 872 B + 4 441 392 B | — | bản sao người đọc được: **không có** |

Độ dài phiên (150 phiên sống của box): trung vị **7** message, p90 **42**, cao nhất **123**; **87/150 phiên dưới 10
message**; trạng thái `completed` 77 / `failed` **51** / `idle` 18 / `cancelled` 4. **10 phiên vượt trần thân bài của router
(`ROUTER_BODY_BUDGET` 921 600 B) — cả 10 đều to hơn 1 MiB và cả 10 mang trạng thái `failed`.**

**Bốn nguyên nhân gốc của "phiên cụt"** (mỗi cái đều có bằng chứng sống, không phải suy đoán):

1. `heal_context_windows()` bỏ qua nguồn `manual` ⇒ 12 phiên đứng nguyên ở 32 768 / 16 384 / 8 192, kéo ngưỡng nén xuống
   20 070 / 8 602 / 2 867.
2. `FALLBACK_CONTEXT_WINDOW` áp cho hai model `nemotron-*-free` mà router trả `null` ⇒ nén ở 86 732 dù cửa sổ thật lớn.
3. Ngưỡng byte `921600 // 3 − 6000 = 301 200` là ngưỡng **duy nhất** còn chạm được trên cửa sổ lớn.
4. `MAX_STEPS 20` cộng nhánh cắt hạn chót im lặng ⇒ 51/150 phiên `failed`, kể cả phiên đã làm xong việc.

Nén đo được trên các phiên thật: `920946a7` 58 → 8 message (86,2 %), `98567200` 33 → 13 (60,6 %), `43a92d61` 9 → 8 với
bốn lần `"ineffective": true` liên tiếp. Phiên to nhất `72a6a428` gỡ được **0 %**. Thư mục ảnh ghi hình: **374 tệp / 113 MB**
(79 mp4 = **94 505 331 B**), **không** có chỗ nào dọn. Đánh số plan: hai slug mới tinh nhận **v5** và **v6** cách nhau sáu
phút, vì `used` lấy từ **mọi** tệp trong `.plans/`.

### Số ca kiểm thử trước và sau

| Bộ | Trước vòng 20 | Sau vòng 20 | Đỏ còn lại |
| --- | --- | --- | --- |
| Harness (`backend/tests/unit`) | 583 đạt, 1 đỏ | **821 đạt, 1 đỏ** | `test_terminal_tools.py::test_terminal_exec_echo` (có sẵn; cần PowerShell) |
| Box (`deploy/docker`, `unittest discover -s tests -t tests`) | 437 OK | **447 OK** | không |
| Router (`/opt/node24/bin/npm test`) | 207 / 207 | **209 / 209** | không |
| Giao diện (`npx vitest run`) | 894 ca / 111 tệp, 890 đạt, 4 đỏ | **918 ca / 113 tệp, 914 đạt, 4 đỏ** | y hệt bốn ca có sẵn — vòng này chỉ đụng khối checklist ở tab Plan |
| Kiểu (`tsc -b --noEmit`) | 0 lỗi | **0 lỗi** | — |

### Phần A — thư mục theo phiên, nhật ký, dọn ảnh (A1–A9)

`deploy/docker/session_files.py` (997 dòng) + `session_ops.py` (283 dòng) là tầng file trong box; `worker.py` gọi qua bốn op
`session_ensure`, `journal_append`, `checkpoint_write`, `captures_prune` (tên op khai trong `SESSION_OP_NAMES` độc lập với
việc nạp được mô-đun, để thiếu tệp thì báo `SESSION_OPS_UNAVAILABLE` chứ không im lặng). Hình dạng mỗi phiên:
`.session-history/<sid8>/{session.json, journal.jsonl, journal.md, checkpoints/*.json + *.md}`; `session.json` không bao giờ
là bản nửa vời (ghi tệp tạm rồi `os.replace`); ghi lỗi thì lượt vẫn xong, có `notice` và bản ghi `status: degraded`.

Bảng `journal` (SQLite, `seq` tự tăng) là **chỉ mục**, file JSONL là **bản người đọc được**; bản ghi có `id` theo tiền tố
(`T:` việc, `P:` kế hoạch, `S:` bước, `D:` quyết định, `E:` bằng chứng, `C:` lần nén, `F:` sự kiện, `X:` việc giao cho con).
`session_search` v2 tra **ba nguồn** (message hiện tại, checkpoint, nhật ký) và nói thật khi bị cắt (`truncated`, `dropped`).
Hai công cụ mới cho agent (`journal_write`, `journal_brief`) đưa số công cụ **20 → 22**; `status`/`refs`/`evidence` đi thẳng
vào bộ kiểm của `journal.record` nên một lời gọi sai bị **từ chối**, không được lặng lẽ bỏ qua.

Dọn ảnh: bốn hằng số có tên — 200 tệp/loại/phiên, 512 MiB/phiên, 4 GiB/toàn box, 40 mp4/phiên (`retention()` trong
`session_files.py`). Không tệp nào bị xoá trong vòng này: `backfill_history.py` chỉ chạy dry-run.

### Phần B — kế hoạch có phiên bản thật, thang điểm, và khối checklist ở tab Plan (B1–B6)

`plan_eval.py` chấm P1–P8 theo thang 0/1/2 (hai mức là **cổng cứng**: bằng chứng đo được và tiêu chí nghiệm thu), trả
`verdict` `pass` / `pass_with_conditions` / `fail` cùng `hardGate` (`true` = **mọi** cổng cứng đạt, cùng chiều với
`scripts/eval/rubric.py`). `plan_registry.py` dựng chỉ mục theo **thư mục**, nên `v4` nằm cạnh `v3` trong cùng nhóm là một
nhóm hai bản. `plan_header.py` + header `<!-- boxfox-plan` cho mỗi bản (giờ cả tệp mồi
`deploy/docker/bootstrap-plans/v1-agent-box-plan.md` cũng có). Hai route mới: `GET /api/agent/plans/status` và
`POST /api/agent/plans/review` (ghi sổ ở harness trước, chuyển tiếp vào box sau; chuyển tiếp lỗi thì trả
`forwarded: false` chứ không báo thành công).

`deploy/docker/migrate_plans.py` (**mặc định dry-run**) nạp header cho sáu tệp `.plans` đang sống, có `--merge a=b` (từ chối
khi **tên đích** đã tồn tại, bỏ qua kèm cảnh báo khi nhóm nguồn đã gộp trước đó) và `--renumber-lone` (mặc định tắt).
Chạy thật trên **bản sao**: `wrote=6`, `renamed=1`, lần hai báo `nothingToDo=true`; chạy dry-run trên tệp sống: `wrote=0`,
md5 sáu tệp không đổi.

### Phần C — hai lỗi đo được trong lúc kiểm thử sống (C1, C2)

- **C1:** `limits.py` cắt `deadlineSeconds` 900 → 600 **im lặng**, và `MAX_STEPS` đánh dấu `failed` một phiên đã xong việc.
  Đo sống: 20 bước / 140,1 s ⇒ `failed`; chạy lại với `maxSteps: 40` trên `pallets/click` ⇒ `completed` trong **27 bước**.
  Nay việc cắt hạn chót có mã `notice` riêng, và đầu ra bị cắt vì `length` được nhận diện bằng `TRUNCATED_OUTPUT_NOTICE_CODE`.
- **C2:** agent con `6bd868ad…` trả `finishReason: length, outputTokens: 4096, toolCalls: 0` ⇒ `TURN_EMPTY_RESPONSE` **không
  thử lại**, cha nhận `failed`. Nay có `TRUNCATED_OUTPUT_MAX_TOKENS = 2048` và một lượt thử lại trước khi bỏ.

### Phần D — chính sách độ dài, đánh số, và ngưỡng nén (N1–N10, P1–P5)

`docs/naming.md` gom 29 quy luật (9 **BẮT BUỘC**, 20 **THÓI QUEN**) cùng bảng tiền tố nhật ký. Luật đánh số nay **không**
lấy `max` của mọi tệp: số chỉ tăng trong **cùng nhóm identity**, nên việc mới tinh bắt đầu ở `v1`. Ngưỡng nén theo cửa sổ
(công thức: `min(0,7 × (cửa sổ − dự trữ đầu ra), 200 000, 301 200)`, sàn 32 000 khi còn đủ chỗ):

| Cửa sổ | Ngưỡng mới | Trước |
| --- | --- | --- |
| 8 192 | 2 867 | 2 867 |
| 32 768 | 20 070 | 20 070 |
| 128 000 | 86 732 | 86 732 |
| 256 000 | **176 332** | 172 532 |
| 1 000 000 | **200 000** | 301 200 |

`FALLBACK_CONTEXT_WINDOW` 128 000 → **256 000**, và hai dòng `nemotron-3-ultra-free` / `nemotron-3.5-lightning-free` được
khai **1 000 000** trong bảng cửa sổ của router (OpenRouter công bố đúng 1 000 000 cho hai bản `:free` này).

### Nghiệm thu sống

- Bản dry-run nạp lịch sử cũ (`/code/.generated_artifacts/r20/backfill_dry_run.md`): 22 hàng checkpoint trên 12 phiên,
  **12 ghim `P:`**, **258 đường dẫn artefact trên 39 phiên**, **123 tệp ảnh không payload nào nhắc tới** (96 953 338 B) —
  chỉ đếm, không xoá.
- Bản dry-run migration (`/code/.generated_artifacts/r20/migrate_plans_dry_run.md`): sáu tệp, sáu header, một ca gộp, `wrote=0`.
- Di trú schema trên **bản sao** `sessions.sqlite`: `checkpoints` thêm bốn cột (`before_estimate`, `after_estimate`,
  `context_window`, `model_id`), bảng `journal` xuất hiện, 22 hàng còn nguyên.
- Lượt thật của làn C trên repo (`/code/.generated_artifacts/r20/cua_repo_report.md`): **300 bài đạt**, và cặp bằng chứng
  `20 bước → failed` so với `40 bước → completed trong 27 bước`.
- Hình dạng giao diện khối checklist: `/code/.generated_artifacts/images/r20_design_plan_eval_checklist.png`.

### Cần chủ nhà chốt sau vòng này

1. `maxSteps` mặc định 16 → **40** (khuyến nghị; đo được: trần bước, không phải hạn chót, là thứ đánh `failed` một việc đã xong).
2. Có `--apply` migration trên box sống không, và có `--renumber-lone` / xoá hai plan thử hay không; `v4` có đổi tên theo nhóm không.
3. Dải identity mơ hồ `0,5 ≤ j < 0,75`: từ chối một lần (khuyến nghị) hay gộp luôn.
4. Ngưỡng cứng độ dài plan: từ chối khi > 150 000 ký tự (khuyến nghị) hay chỉ cảnh báo.
5. Gốc thư mục theo phiên: `.session-history` (khuyến nghị) hay `.sessions/`.

## Vòng 21 — năm việc chủ nhà giao: upload trong dấu `+`, trần bước, sub-agent nhìn nhau, bằng chứng sống, bảng theo turn (2026-09-22, sáng)

- Phạm vi: (1) gửi nguyên nội dung một tệp Markdown dưới dạng text để kiểm chứng khả năng chạy, chất lượng
  output plan và hành vi gọi sub-agent; (2) trần `maxSteps` 16 cùng hai lỗi quanh trần bước/hạn chót;
  (3) kiến trúc để sub-agent nhìn thấy nhau và bàn giao có định tuyến; (4) bằng chứng sống gắn vào câu trả lời cuối;
  (5) bảng Sub-agents phải theo từng turn. Model chính: OpenCode Free `muse-spark-1.2/1.3-contributor-free`.
- Cách chạy: router 3101 + harness 3102 + Vite 3100 do phiên này khởi động; box `agentbox-box` đang chạy;
  ba lượt qua API (`/tmp/run_turn.py`, log `/tmp/runA.txt`, `/tmp/runB.txt`, `/tmp/runD.txt`) và ba lượt qua giao diện
  (agent-browser 0.21.2). Xem trước công khai: `https://wc91p7pgg7ed.preview.us1.vorflux.com` (chỉ để xem;
  lớt chạy bị chặn vì `Origin` của harness chỉ nhận loopback — `backend/src/agentbox/api/server.py:119-139`).
- Kết quả: **5/5 việc có kết luận đo được**; **4 lỗi mới** (BUG-39 … BUG-42) và **1 lỗi giao diện** (BUG-43);
  kế hoạch sáu phần A–F ở `docs/plan/v21-boxfox-plan.md` (+ bản tóm tắt cùng chỗ).

### Phần A — gửi tệp qua dấu `+`

- Menu có đủ bốn mục trong DOM nhưng **bị cắt**: với menu đang mở, `document.elementFromPoint` tại tâm mục
  `Tải lên hình ảnh` (`itemRect [290,642,226,45]`) trả về khung chat ⇒ mục không phải phần tử trên cùng.
  Tổ tiên cắt là `flex min-w-0 items-center gap-1.5 overflow-hidden` (`ChatInputBar.tsx:268`) trong khi popover
  đặt `absolute bottom-full` (`AttachmentPicker.tsx:159`). Lặp lại được ở **cả** địa chỉ công khai lẫn `localhost:3100`.
- Gửi thật một tệp `probe-upload.txt` (đã dán nhãn vào input ẩn, vì menu không bấm được): chip hiện tên,
  lượt chạy tạo phiên `0ef73471c38d4c63a593755345213dcf`, và event `user` **đúng bằng** phần text cộng
  `\n\n[Attached Files: probe-upload.txt]` — **không nội dung, không đường dẫn**.
- Sau lượt: `docker exec agentbox-box ls .uploaded_artifacts` **rỗng**, `find /home/agent/workspace -name '*probe-upload*'`
  **không có**. Agent tự đi tìm, kết luận "tệp không tồn tại", rồi lượt chết bằng `TURN_EMPTY_RESPONSE`.
- Đường ống đã có sẵn nhưng chưa ai gọi: `POST /__box/file/upload` (`deploy/docker/ide-proxy.py:540-568`),
  `workspace_files.write_upload` (`deploy/docker/workspace_files.py:743-754`), client
  `frontend/src/lib/workspace/http.ts:70-87`, thư mục `.uploaded_artifacts` tạo lúc boot
  (`deploy/docker/box-entrypoint.sh:15-24`), luật tên RULE-5 **chưa có code nào cấp số** (`docs/naming.md:24`).

### Phần B — gửi nguyên nội dung Markdown và chất lượng plan

- Lượt 1 (dán 2 770 byte, `muse-spark-1.3-contributor-free`, phiên `67bdfd4bd6fa4398bd0273e62dd2acc0`):
  `write_plan` bị từ chối **bốn lần** (`PLAN_QUALITY_REJECTED: missing (verification-section)`;
  `missing (verification-command)`; `PLAN_EVAL_REJECTED: (steps-unanchored) chỉ 4/11 bước có lệnh…`;
  `(plan-no-steps)`) rồi mới nhận ở lần thứ năm: `.plans/v1-boxfox-5-upgrades.md` 4 643 byte,
  `levels {P1:1, P2..P8:2}`, kèm `ui_intent` mở tab Plan. Lượt xong ở **bước 6**, `completed`,
  `contextEstimate 24001`, **không gọi sub-agent nào**.
- Plan sinh ra vẫn sai sự thật ở ba chỗ: bịa tên hằng `DEFAULT_MAX_STEPS` (thật là `MAX_STEPS_DEFAULT`),
  bịa `turnId`/`deadlineMs`, và tự nhận trong mục *Sources / Citations* rằng các số 40 bước / 10 MB / 120 s
  là "giá trị tự chọn", không có nguồn.
- Lượt 2 (delegation, `muse-spark-1.2-contributor-free`, phiên `b66559fa8e2743a79e7b1d079fecc881`):
  cha gọi `delegate_task role=explore` (con `391cbed2…`, 8 bước, 7 tool) rồi `role=review`
  (con `d79a2112…`, 8 bước, 7 tool), xong ở bước 3. Con `explore` tìm `ChatInputBar.tsx` khi mã nguồn chưa
  được chép vào box nên kết luận "tệp không tồn tại"; con `review` **sửa lại** khi mã đã có. Đây là bằng chứng
  sống cho thấy hôm nay chỉ có cha làm trung gian: con không đọc được việc của con khác, chỉ đọc lại sau khi cha
  giao việc mới.

### Phần C — trần bước và hạn chót

- Việc vừa phải (đọc 2 tệp + grep + viết báo cáo + đọc lại, phiên `dddebffb887a4f6ca814c1514367d38d`),
  chạy với **đúng mặc định** `{"maxSteps":16,"deadlineSeconds":180}`: xong ở **bước 8**, `completed`,
  `contextEstimate 28235`. Không chạm trần.
- Việc của con (`delegate_task role=explore`, phiên `ea9486495da646d7aac4ccd4214ea8ed`): chạy **10/10 bước**,
  33 tool call, hết **120 s** ⇒ `DEADLINE: the turn ran out of time before an answer was produced`,
  `answerChars = 0`, cha nhận `status=failed`. **Toàn bộ chín bước đã làm bị vứt**, không có đường trả về phần dở.
  Cùng mã lỗi `DEADLINE` như ảnh chủ nhà gửi (`Error code: DEADLINE`, `Worked for 180s`). Chủ nhà báo ở lượt gốc;
  vòng này **không tái hiện được băng đỏ ở lượt gốc** (phiên gốc cũ đã bị dọn khỏi store) — tái hiện được **cùng mã lỗi**
  ở agent con (120 s) và thấy cha vẫn báo lỗi đó cho người dùng trong dòng `last_error`.
- Lỗi thứ ba, đo được trong chính lượt gửi tệp: `TURN_EMPTY_RESPONSE: the model finished without a usable answer
  (no text, no tool call)` tại bước 5 — model đã có `thought` nhưng không có text/tool call, lượt bị đánh `failed`,
  **không thử lại**, người dùng mất cả lượt.

### Phần D — kiến trúc sub-agent (đọc mã, không sửa)

- Mỗi cha chỉ có một đường sinh con và chạy tuần tự (`runtime.py:2531-2534`); `child_slots` là `Semaphore(3)`
  **toàn tiến trình** (`runtime.py:967`) nên hai cha tranh nhau ba slot; tool trong một bước cũng tuần tự
  (`runtime.py:1730-1741`).
- Con không có tool để đọc/đợi/nhắn bạn: tập tool là frozenset theo vai (`roles.py:7-11`, gán `:148-158`,
  giao với cha `:163-165`), `session_search` chỉ orchestrator và **khoá theo sid của chính nó**
  (`roles.py:159-160`, `runtime.py:1944-1945`, `:1966-1967`), con không hỏi được người dùng (`runtime.py:1991-1995`).
- `store.events()` trả tối đa 500 hàng (`memory/session_store.py:136-139`); `child` event không mang `turn`/`step`
  (`runtime.py:2523-2530`, `:2564`) nên giao diện không thể phân turn dù muốn.

### Phần E — bằng chứng sống và bảng Sub-agents theo turn

- Không có cổng nào cho câu trả lời cuối: chỉ kiểm "có text và `finish_reason` hợp lệ" (`runtime.py:1696`) rồi
  phát thẳng (`:1712-1713`); cổng duy nhất đang chạy là cho **plan** (`runtime.py:2195`, `:2213`).
  Giao diện ghim badge `done` **vô điều kiện** (`HarnessStepView.tsx:1534-1537`) và store bỏ luôn
  `session.journal` mà backend đã trả (`harnessChatStore.ts:285-338`; `api/server.py:285-293`).
- Bảng Sub-agents sai theo turn, đo sống: lượt 2 sinh con `ea948649…`; **lượt 3** hỏi `2+2` (xong trong 3 s,
  không gọi tool nào) mà bảng vẫn ghi `SPECIALISTS PIPELINE · 1 TOTAL · Explore Specialist FAILED · 33 tools executed`.
  Gốc: `childrenMap` dựng từ mọi event `child` của phiên (`SubagentInspectorPanel.tsx:162-196`, render `:347`/`:361`)
  và store không cắt theo turn (`harnessChatStore.ts:294`).

### Kiểm chứng model (chủ nhà hỏi)

- `muse-spark-1.2-contributor-free` và `muse-spark-1.3-contributor-free`: **cả hai chạy được** — test qua router
  đều `status: passed` (usage trả về), giao diện hiện đủ chín model `-free` trong tab "Single Models".
  Không có báo cáo thiếu model.

### Bằng chứng của vòng

- Ảnh: `images/r21_preview_01_public_url.png`, `images/r21_upload_05_clipped.png`,
  `images/r21_local_02_menu_clipped.png`, `images/r21_local_03_chip.png`, `images/r21_local_04_sent.png`
  (bong bóng chat chứa `[Attached Files: probe-upload.txt]`), `images/r21_model_01_muse13_selected.png`,
  `images/r21_perTurn_02_subagents_after_turn2.png`, `images/r21_perTurn_03_turn3_with_stale_child.png`.
- Log: `/tmp/runA.txt`, `/tmp/runB.txt`, `/tmp/runD.txt`; phiên `67bdfd4b…`, `b66559fa…`, `dddebffb…`,
  `0ef73471…`, con `ea948649…`.
- Kế hoạch: `docs/plan/v21-boxfox-plan.md` (sáu phần A–F), tóm tắt `docs/plan/v21-boxfox-plan-summary.md`.
## Vòng 22 — đợt foundation: tệp đính kèm tới box, trần bước có chẩn đoán, plan sạch theo tên, trần độ dài câu trả lời (2026-09-22, chiều)

- Phạm vi (đợt 1 của kế hoạch `docs/plan/v22-boxfox-plan.md`, việc A1–A11 / B1–B10 / C1–C5 / D1–D2 / E1–E5):
  (A) gửi tệp và hình từ dấu `+` tới box, đưa **đường dẫn thật** vào lượt; (B) ngân sách bước và hạn chót theo D-1/D-15 —
  tách mã, **chẩn đoán bốn phần**, trả `partial` thay `failed`, ghi `stepsUsed`/`deadlineUsedMs`; (C) kế hoạch: `--apply`
  sao lưu trước, vé mơ hồ dùng một lần; (D) trần độ dài câu trả lời; (E) ba bộ test và một lượt thử sống đầu-cuối.
- Cách chạy: router 3101 + harness 3102 (khởi động lại trên mã mới) + Vite 3100 + box `agentbox-box` đang chạy;
  ảnh box **không** dựng lại — `worker.py` được gửi nội tuyến trong mỗi lần gọi. Lượt sống qua API (`curl`) và một lượt qua
  giao diện (agent-browser, phiên `foundation`). Xem trước: `localhost:3100`; lượt chạy bắt buộc đi qua loopback vì
  `Origin` của harness chỉ nhận loopback (`backend/src/agentbox/api/server.py:119-143`).
- Kết quả: **A, B, C, D xong**; ba bộ test xanh (backend **902 passed / 1 bài đỏ sẵn có**, frontend **958 passed**,
  `deploy/docker` **493 passed**); ba phép kiểm bắt buộc của E3 xanh; **một lỗi mới** (BUG-44) lộ ra trong chính lượt đo.
  Đợt **kiểm thử độc lập** chạy sau đó (cùng PR, HEAD `f57619d`) tìm thêm **ba** lỗi trong chính mã mới của đợt này
  (BUG-45…BUG-47, đã sửa) và đo lại cả ba bộ test — backend **1 failed / 916 passed**, `deploy/docker` **496 passed**,
  frontend **118 tệp / 958 bài**, `tsc -b --noEmit` sạch: xem mục cuối bài.

### Phần A — tệp đính kèm đi tới box (D-6, BUG-39, BUG-40)

- Menu `+` bấm được sau khi popover render qua portal: hit-test tại tâm **cả bốn** mục đều trả `true`
  (`Tải lên hình ảnh`, `Tải lên tệp tin`, `Tải lên thư mục`, `Google Drive`); mục Drive `disabled: true` và đọc đúng
  "Chưa kết nối — không đính kèm được tài liệu Drive" (A9). Cùng phép đo ở vòng 21 trả về khung chat (`itemRect [290,642,226,45]`).
- `.uploaded_artifacts` trước đợt E3: **5 tệp** (`1.md` … `5.md`). Trong đợt: **+2 tệp** — `6.md` (31 B, lượt qua API) và
  `7.md` (34 B, lượt qua giao diện); cả hai **khớp byte** (`cat <n>.md | diff - /var/tmp/foundation-e2e.md`,
  `... /var/tmp/foundation-e2e-ui.md` ⇒ không khác byte nào). Tổng sau đợt: **7 tệp / 32 KB**.
- Số RULE-5 do box cấp (BOX-6): `POST /__box/file/upload?assign=1` trả `{"path": ".uploaded_artifacts/1.md", "name": "1.md", "sizeBytes": 28}`;
  bốn lượt tải **song song** cùng lúc ⇒ `2.md 3.md 4.md 5.md`, `uniq -d` **rỗng** (không trùng số).
- Đường dẫn vào lượt: event `user` cuối của phiên `c4cf5256d3174303b363cd3896ba0246` mang
  `{name: 7.md, path: .uploaded_artifacts/7.md, absolutePath: /home/agent/workspace/.uploaded_artifacts/7.md, sizeBytes: 34, kind: file}`
  — `absolutePath` do **harness suy ra**, không lấy từ client (bài `test_turn_attachments.py` khoá điều này bằng một hàng gửi kèm
  `absolutePath: /etc/passwd` và khẳng định giá trị dùng thật không phải `/etc/passwd`).
- Ngữ cảnh gửi model (đọc từ `~/BoxFox/harness/sessions.sqlite`, hàng `messages` của phiên): phần text của tin `user` cuối bằng
  `Đọc tệp vừa đính kèm và in ra đúng dòng đầu tiên.` cộng khối `[Tệp đính kèm đã lưu trong box]` với dòng
  `- /home/agent/workspace/.uploaded_artifacts/6.md (6.md, 31 B)` — đường dẫn tuyệt đối nằm **trong ngữ cảnh**; chuỗi
  `[Attached Files: …]` của BUG-40 không còn xuất hiện ở đâu.
- Lượt sống đầu-cuối qua phiên **mới** (không ngữ cảnh cũ) `92f76c90467d4dfaaa3bbb3d40278069`: gửi **chỉ** đường dẫn tương đối
  `.uploaded_artifacts/6.md`; model gọi `file_read {"path": "/home/agent/workspace/.uploaded_artifacts/6.md"}` rồi trả về đúng dòng
  `FOUNDATION-E2E-20260922T111913` — `turn_end {status: completed, stepsUsed: 2, toolsRun: 1, deadlineUsedMs: 4514}`.
- Lượt qua giao diện (phiên `c4cf5256…`): chip `foundation-e2e-ui.md` + `1 KB` trong ô soạn tin; bong bóng người dùng mang chip
  `7.md 1 KB .uploaded_artifacts/7.md` (A10); model gọi `file_read` đúng đường dẫn tuyệt đối và trả về
  `Dòng đầu tiên của tệp /home/agent/workspace/.uploaded_artifacts/7.md: FOUNDATION-E2E-UI-20260922T113232`
  — `turn_end {status: completed, stepsUsed: 2, toolsRun: 1, deadlineUsedMs: 2569}`.

### Phần B — trần bước và hạn chót có chẩn đoán (D-1, D-15, BUG-41, BUG-42)

- Số mặc định sống: `GET /api/agent/runtime-info` ⇒
  `{maxStepsDefault: 40, maxStepsMax: 60, deadlineDefaultSeconds: 180, deadlineMaxSeconds: 600, childMaxSteps: 40, childDeadlineSeconds: 300}`.
- Kẹp trần nói ra đúng một lần: `POST /api/agent/sessions {"maxSteps": 999}` ⇒ phiên `2e92c8242d184ce3ad5d69f2192e7522`,
  **đúng một** notice `STEPS_CLAMPED {requested: 999, applied: 60}`, `config.maxSteps = 60`, `config.stepsClamped = true`,
  `sessionMetrics.stepsClamped = true`.
- Lượt trong ngân sách (phiên `43b363cc79f04e84a86af7c1f02db757`, `maxSteps: 40`, `deadlineSeconds: 300`):
  `turn_end {status: completed, stepsUsed: 1, toolsRun: 0, deadlineUsedMs: 1934}`, **không có notice nào**.
- Lượt chạm trần bước (phiên `1cbb482079de430091e2de76f18144ae`, `maxSteps: 4`) đóng bằng **`partial` có nội dung**:
  `turn_end {status: partial, stepsUsed: 2, toolsRun: 1, deadlineUsedMs: 4953, partial: true, diagnosis: true}`; **đúng một** notice
  `STEP_BUDGET_EXHAUSTED {partial: true, diagnosis: true, diagnosisChars: 465, stepsUsed: 2, toolsRun: 1, maxSteps: 4, reservedSteps: 3, deadlineSeconds: 300, deadlineUsedMs: 4959}`;
  hàng `sessions` vẫn `completed` (không thêm giá trị `status` mới — ràng buộc § 4 của sổ chủ nhà); câu trả lời cuối 465 ký tự,
  đủ bốn phần `Đã làm / Đang kẹt ở / Còn lại / Thử tiếp theo`.
- Lượt con chạm ngân sách (cha `79049fc16a2349e6866d892583ab64da`, `maxSteps 5`, `deadlineSeconds 300`): con `explore`
  `122a9a866b1342249b9affc749d9030d` **nhận** `maxSteps 5` / `deadlineSeconds 300` — bị kẹp theo **cha**, không phải số trần 40/300;
  notice của con `STEP_BUDGET_EXHAUSTED {diagnosisChars: 948, stepsUsed: 3, toolsRun: 2, maxSteps: 5, reservedSteps: 3, deadlineUsedMs: 14563}`;
  event `child` thứ hai mang về cha `{status: partial, answerChars: 948, is_error: false, reason: STEP_BUDGET_EXHAUSTED, diagnosis: true, stuckReason: STEP_BUDGET_EXHAUSTED}`;
  cha xong `turn_end {status: completed, stepsUsed: 2, toolsRun: 1, deadlineUsedMs: 24602}`.
- Hàng `X:` mới trong các lượt đo: **0** — cả hai ca chạm trần đều đóng bằng chẩn đoán, nên nhánh ghim blocker vào nhật ký
  không chạy (nhánh đó vẫn có bài khoá ở `test_limits_notice.py`, và nhãn máy `note: 'max-steps'` giữ nguyên).
- Mã cũ vẫn đọc được: `KNOWN_PREFIXES` giữ `MAX_STEPS` / `DEADLINE` cho bản ghi cũ; mã mới là `STEP_BUDGET_EXHAUSTED`,
  `DEADLINE_EXCEEDED`, `ANSWER_TOO_LONG`.
- `TURN_EMPTY_RESPONSE` (BUG-41) nay **thử lại một lần** trước khi chịu thua: lần thử lại ghim notice
  `TURN_EMPTY_RESPONSE_RETRY` kèm `attempt`/`how` và một hàng `system_log.write('turn.retry', reason='empty_response', …)`;
  nếu vẫn rỗng thì lỗi cũ được ném như trước. Trong các lượt đo của đợt này không lượt nào rỗng.

### Phần C — kế hoạch sạch theo tên (D-2, D-3, D-5)

- `migrate_plans.py --apply` nay **luôn** sao lưu từng byte vào `.plans-backups/<UTC>/` (kèm `manifest.json` có `sha256`) trước khi ghi;
  `--delete-orphan` từ chối (exit 2) khi còn bản ghi `P:` trỏ tới tệp; `--backup-dir DIR` chỉ đổi **chỗ** đặt bản sao, không tắt luật.
  Script và `upload_files.py` đã staged vào ảnh (lớp 5) cùng khối kiểm `10b-bis` của `smoke-test.sh`; quy trình ở
  `docs/plan/v22-plans-migration-runbook.md`, luật ở `docs/naming.md` § 7.
- Vé mơ hồ dùng một lần (D-3): lượt `write_plan` rơi vào dải jaccard 0,5–0,75 bị từ chối **một lần** kèm hàng `fact`
  `PLAN_IDENTITY_AMBIGUOUS: …`; gửi lại **nguyên văn** thì được nhận đúng một lần (`identityMatchedBy: 'ambiguity-ticket'`,
  `identityForcedNew: false`, `identityAmbiguity` ghim vào cả payload `plan_written` lẫn hàng `P:`), và vé **không rò** sang slug
  hay phiên khác. Ba bài trong `backend/tests/unit/test_write_plan.py` khoá cả ba chiều.
- `.session-history` giữ nguyên tên (D-5, `docs/naming.md` § 8): đo lúc ghi sổ **16 thư mục phiên / 23 tệp / 224 KB**
  (lần đo trước trong `naming.md`: 9/16/140 KB) — con số tự tăng theo phiên sống, đúng lý do không đổi tên.

### Phần D — trần độ dài câu trả lời (D-4)

- Hằng số trong `limits.py`: `ANSWER_WARN_CHARS = 60_000`, `ANSWER_MAX_CHARS = 150_000`; trần của plan không đổi
  (`PLAN_WARN_CHARS = 40_000`, `PLAN_MAX_CHARS = 150_000`).
- Cổng nằm ở ranh giới câu trả lời cuối: ≤ 60 000 ký tự không đổi gì; trong khoảng 60 000–150 000 ghim một notice
  `ANSWER_LENGTH_WARN` cùng hàng `system_log.write('answer.length', …)`; trên 150 000 cắt còn 150 000 ký tự, ghim **một** hàng `X:`
  nói rõ `chars`/`keptChars`/`limit` và lượt trả `partial`.
- Giao diện đi qua đúng bộ render notice sẵn có: `HarnessStepView.notice.test.tsx` khoá `data-notice-code="ANSWER_TOO_LONG"`,
  số `150000` trong chuỗi hiển thị và việc câu trả lời vẫn hiển thị đầy đủ.

### Phần E — ba bộ test, lượt sống, và ba phép kiểm bắt buộc

- `cd backend && .venv/bin/python -m pytest tests/unit -q` ⇒ **1 failed, 902 passed**. Bài đỏ duy nhất là
  `test_terminal_tools.py::test_terminal_exec_echo` — **có sẵn từ trước**, do `bash` của sandbox không có lệnh `Write-Output`
  (`Exited with code 127`), không liên quan đợt này.
- `-k "partial_budget or child_diagnosis"` ⇒ **15 passed**; ca bắt buộc của chủ nhà
  `test_child_diagnosis.py::test_budget_exhausted_child_returns_diagnosis` ⇒ **passed**.
- `-k "answer_length or plan_eval"` ⇒ **53 passed**; `-k "turn_attachments or partial_budget"` ⇒ **20 passed**;
  `-k "plan_registry or write_plan or plan_eval or file_tools or file_read"` ⇒ **152 passed**.
- `cd frontend && VITE_BOX_API_URL=http://localhost:8081 npx vitest run` ⇒ **118 tệp / 958 bài passed**;
  `npx tsc -b --noEmit` ⇒ **sạch**. Biến môi trường là cần thiết vì `frontend/.env.local` (tệp không được theo dõi, dùng cho
  đường xem trước) trỏ API về `"."`; với biến này, bài `src/lib/workspace/index.test.ts` cũng xanh.
- `cd deploy/docker && .venv/bin/python -m pytest tests -q` ⇒ **493 passed**.
- Ba phép kiểm **bắt buộc** của E3: (1) menu `+` bấm được — hit-test `true` ở **cả bốn** mục; (2) tệp vào box **đúng byte** —
  `6.md`/`7.md` khớp `diff`, đường dẫn thật có trong event `user` **và** trong ngữ cảnh gửi model; (3) chẩn đoán khi chạm trần —
  notice `STEP_BUDGET_EXHAUSTED` có `diagnosis: true` và câu trả lời cuối đủ bốn phần.

### Khẳng định cố ý đổi (E1)

Danh sách đầy đủ nằm trong PR của đợt này; các điểm chính: `test_failure_classification.py` (hết hạn ⇒ `DEADLINE_EXCEEDED`),
`test_limits_notice.py` (tiền tố hàng nhật ký `STEP_BUDGET_EXHAUSTED:` và ca kẹp trần mới), `test_child_truncation.py`
(`partial_turn`), `test_compaction_events.py` (`turn_end` thêm `stepsUsed`/`toolsRun`/`deadlineUsedMs`),
`test_session_length_payload.py` (`stepsClamped` trong `sessionMetrics`), `test_harness_runtime.py`, `test_delegation_contract.py`
(ca kẹp ngân sách con), `test_worker_session_ops.py` (bốn → **năm** op vì A7 thêm `uploads_prune`), và
`frontend/src/components/chat/ChatInputBar.controlSend.test.tsx:142` (`toHaveBeenCalledWith('/skill', undefined, undefined)`).

### Bằng chứng của vòng

- Ảnh: `images/foundation_e2e_01_chip.png` (chip `foundation-e2e-ui.md 1 KB` trong ô soạn tin),
  `images/foundation_e2e_02_sent.png` (sau khi gửi), `images/foundation_e2e_03_menu.png` (menu `+` đủ bốn mục, Drive nói thật
  "chưa kết nối"), `images/foundation_e2e_04_answer.png` (bong bóng người dùng có chip `7.md`, câu trả lời `done`).
- Phiên: `c4cf5256…` (lượt qua giao diện, hai lượt có tệp), `92f76c90467d4dfaaa3bbb3d40278069` (lượt API không ngữ cảnh cũ),
  `43b363cc79f04e84a86af7c1f02db757` (40/300), `1cbb482079de430091e2de76f18144ae` (chạm trần bước), `2e92c824…` (kẹp 999),
  `79049fc16a2349e6866d892583ab64da` (cha gọi con) + con `122a9a866b1342249b9affc749d9030d`.
- Tệp đo: `/var/tmp/foundation-e2e.md`, `/var/tmp/foundation-e2e-ui.md`; bản chụp `X:` = 0 hàng nên không có tệp nhật ký kèm theo.
- Ảnh chụp bằng agent-browser 0.21.2 (phiên `foundation`); lượt API bằng `curl` tới `http://127.0.0.1:3102` với
  `X-BoxFox-Admin: 1` và `Origin: http://localhost:3100`.
### Đợt kiểm thử độc lập (cùng PR) — ba lỗi nữa trong mã mới, đã sửa và đo lại

Diff `main...vorflux/v22-foundation` (HEAD `f57619d`) được kiểm thử lại độc lập theo hợp đồng tám mục: phân loại thay đổi
(BROAD / FULL-FEATURE), 15 ca bám đúng phạm vi đợt này, mỗi ca chạy trên hệ thống thật (harness `:3102`, router `:3101`,
Vite `:3100`, box `agentbox-box`), không ca nào chạy lại tính năng cũ không bị sửa. Kết quả và số đo:

- **Menu `+` (T1)** — hit-test tại tâm **cả bốn** mục trả `true`; `menuRect [283,598,240,245]`; `overflowClipAncestor: null`
  (vòng 21: `itemRect [290,642,226,45]` rơi vào khung chat); mục Drive `disabled: true` + `aria-disabled: true`, chữ
  "Chưa kết nối — không đính kèm được tài liệu Drive", bấm **không** có tác dụng (không `onAttach`); ba input ẩn đúng
  (`accept=image/*` nhiều tệp, tệp, `webkitdirectory`).
- **Tải tệp (T2)** — 75 B ⇒ `.uploaded_artifacts/8.md`, md5 khớp hai phía; **13** phép thử biên đúng thiết kế (202 cho
  `absolutePath: /etc/passwd` và tên 500 ký tự; 400 cho `/etc/passwd`, `../../etc/passwd`, `.uploaded_artifacts/../8.md`,
  NUL, hàng không phải dict, `sizeBytes` −1/`true`/`"75"`, dict thay vì mảng, **26 tệp** trong một lượt); ngữ cảnh gửi model
  kết bằng khối `[Tệp đính kèm đã lưu trong box]` với đường dẫn tuyệt đối, chuỗi `[Attached Files: …]` của BUG-40 **không còn**;
  26 MiB kèm `Content-Length` thật ⇒ **413**, đúng 25 MiB ⇒ **200**, `mkdirs=1` ⇒ `.uploaded_artifacts/deep/tree/deep.md`.
- **Lượt qua giao diện (T3)** — phiên `83bfa5a5d7044cdcaa05448ca62675e4`: chip `attach-ui3.md 1 KB`, bong bóng người dùng
  mang chip `16.md · .uploaded_artifacts/16.md` (tiêu đề chip có đường dẫn tuyệt đầy đủ), tệp trong box **khớp md5**
  (`764fb74e475daa1fd69f2f04fe87cf39`), ngữ cảnh model mang `- /home/agent/workspace/.uploaded_artifacts/16.md (16.md, 64 B)`.
  Lượt model sống (`muse-spark-1.3-contributor-free`, phiên `74630e53…`) gọi `file_read` rồi in **đúng dòng 2** của tệp —
  chứng minh trực tiếp BUG-40 đã hết; lượt này `turn_end {step 2, stepsUsed 2, deadlineUsedMs 4097}`.
- **Bốn lượt tải song song (T4)** — số `12, 13, 14, 15`, `uniq -d` rỗng, mọi md5 khớp nguồn, chủ `agent`.
- **Ngân sách (T5, T5b, T6, T7)** — `runtime-info` ⇒ `{40, 60, 180, 600, 40, 300}`; `maxSteps: 999, deadlineSeconds: 9999`
  ⇒ áp 60/600 với **đúng một** `STEPS_CLAMPED {requested: 999, applied: 60}` và một `DEADLINE_CLAMPED`; `maxSteps: 4`
  ⇒ một notice `STEP_BUDGET_EXHAUSTED {diagnosis: true, diagnosisChars: 320, stepsUsed: 2, toolsRun: 1, reservedSteps: 3}`,
  câu trả lời cuối đủ bốn phần; bốn bước xong rồi mới hết ⇒ hàng `X:94b9a926-2` (`status: blocked`, `maxSteps: 4`);
  con nhận **`min(con, cha)`** đo ở ba cha (`60/600` ⇒ con `40/300`; `5/120` ⇒ con `5/120`, cha thấy
  `{status: partial, answerChars: 320, diagnosis: true, is_error: false}`; cha `8/60` gặp lỗi nhà cung cấp ⇒ con
  `{status: failed, answerChars: 0, last_error: UPSTREAM_HTTP_500 … [after 3 retries in 15.3s]}`).
- **Trần độ dài câu trả lời (T10)** — 200 000 ký tự ⇒ câu trả lời cuối **150 097** ký tự, **đúng một** hàng
  `X:845246c5-3`, `turn_end {status: partial}`; 70 002 ký tự ⇒ chỉ `ANSWER_LENGTH_WARN`, `completed`; 12 000 ⇒ không notice.
- **`TURN_EMPTY_RESPONSE` (T12)** — thử lại **đúng một lần** với `toolChoice: 'required'` (tools 22, `maxTokens 4096`),
  biến thể `how: 'plain-text'` khi model mức `low` (tools 0), và ca cả hai lần rỗng ⇒ `error {code: TURN_EMPTY_RESPONSE}`;
  mỗi lượt thử lại một hàng `system_log` `turn.retry {reason: 'empty_response'}`.
- **Tệp nhị phân, dọn tệp, đường bảo vệ (T11)** — `file_read` trên PNG 154 578 B ⇒ `encoding: 'base64'`,
  `bytesRead: 22500`, `truncated: true`, tiền tố khớp byte trên đĩa (trước đây `UnicodeDecodeError` giết cả lượt);
  `uploads_prune` trên fixture 203 tệp ⇒ bỏ 3 tệp / 21 B, giữ đúng mốc `203.md`, **một** hàng `X:` `kind: blocker,
  status: done, actor: box-retention`; `POST /__box/files/delete` trên `.uploaded_artifacts` và `.plans` ⇒ **409** "mục được
  bảo vệ", thư mục con thì cho phép (`200`, `.trash/1790085372-deep`).
- **Kế hoạch (T8, T9)** — trên bản sao: `--apply` sao lưu **từng byte** (`sha256` ba tệp khớp), chạy lại ⇒ `nothingToDo`,
  `--backup-dir` không ghi được ⇒ **rc 2** và `.plans` không đổi byte nào, `--delete-orphan` từ chối (rc 2) khi còn hàng `P:`,
  liên kết tượng trưng bị bỏ qua và không bị đi theo. Sống (phiên `629dfc6eced347f995b0da3c603aecb5`): vé mơ hồ dùng
  **một lần** — lượt 1 từ chối + hàng `F:` với `score 0.6667` (jaccard `{boxfox, upgrades}/{boxfox, 5, upgrades}` = 2/3),
  lượt 2 **nguyên văn** được nhận và ghim vé vào hàng `P:`, lượt 4 với slug khác sinh vé mới (không rò), lượt 5 ghi `v2`.
- **Ba bộ test (T14)** — `backend/tests/unit`: **1 failed, 920 passed** (bài đỏ sẵn có `test_terminal_tools.py::test_terminal_exec_echo`,
  `Exited with code 127`); `-k "partial_budget or child_diagnosis"`: **16 passed**; `-k "plan_eval or plan_registry or write_plan"`:
  **142 passed**; `deploy/docker`: **496 passed** (493 + ba bài mới của BUG-45/BUG-46); frontend `VITE_BOX_API_URL=http://localhost:8081
  npx vitest run`: **118 tệp / 958 bài passed**; `npx tsc -b --noEmit`: **sạch**.
- **Ba lỗi trong chính mã mới** (BUG-45…BUG-47, bảng ở `bug-register.md` § 6.23, đều đã sửa kèm test): `prune` nuốt `OSError`
  ⇒ nay trả `failedFiles: 3` + `deletionFailures` + hàng `X:f2f01657-1` (đo lại **trên box**); hai lượt `--apply` cùng giây
  ⇒ nay `2026-09-22T14-04-42Z` và `2026-09-22T14-04-42Z-2`, `manifest.json` của lượt đầu còn nguyên; câu từ chối
  `header-mismatch` in "khai vv2" ⇒ nay `khai v2; harness sẽ ghi v3`, và khối **sai cú pháp** được gọi đúng tên
  (`không đúng cú pháp (đọc được: Version: v2, Identity: kettle-lantern)`), đo lại **sống** sau khi khởi động lại harness
  trên cây đã vá (phiên `a588b1c460944116b8cde73e03319071`, bốn lượt gửi).
- **Bằng chứng của đợt kiểm thử**: ảnh `images/v22_01_menu.png` (menu `+` sau portal, mục Drive mờ), `images/v22_02_chip.png`
  (chip trong ô soạn tin), `images/v22_02b_typed.png` (đã gõ, nút gửi bật), `images/v22_03_sent.png` (bong bóng người dùng
  mang chip + câu trả lời) và **một clip liên tục** `recordings/v22_composer.webm` (50,7 s) phủ cả sáu bước.
- **Bàn giao, không sửa** (ngoài phạm vi đợt này): (1) tải lên kiểu `Transfer-Encoding: chunked` **không** có `Content-Length`
  trả **200** với tệp 0 byte — đo được **trên `main` y hệt** (nhánh upload chỉ đọc `size_hint = Content-Length`), nên là lỗi
  có sẵn chứ không phải hồi quy; (2) `sizeBytes` do client khai được in nguyên vào nhãn kích thước cho model (khai 999 999
  cho tệp 75 B ⇒ "977 KB") — chỉ là nhãn; (3) `formatAttachmentSize(84)` trả `1 KB` (sàn 1 KB) trong khi khối cho model ghi
  `84 B`; (4) `maxSteps: 0` bị kẹp im lặng về 1 vì `max(1, …)` chạy trước phép so sánh; (5) hàng `command_invocations`
  giữ `result.status = 'running'` sau lượt lệnh thành công (`main` y hệt, không nơi nào đọc ngoài phép kiểm idempotency);
  (6) router chưa chuyển được một luồng nhà cung cấp **rỗng hoàn toàn** (`engine.mjs` đòi `finishReason`) nên nhánh B8 chỉ
  tới được bằng nội dung chỉ có khoảng trắng.
- **Soát engine và vá trước khi gộp** (bản soát độc lập thứ ba, `v22-review-engine3`: **5/10 — Medium**,
  "ship with mitigations"): bốn phát hiện đã vá trên chính nhánh này, mỗi phát hiện một bài kiểm mới —
  (1) cổng chẩn đoán của hạn chót hỏi `partial_turn(sid)`, hàm này quét **mọi** notice bền của **phiên**, nên một phiên
  từng có lượt dở nào đó thì mọi hạn chót sau đó bỏ luôn đường chẩn đoán và đóng lượt bằng `failed` trắng — đúng thứ
  B4/BUG-42 dựng lên để xoá; nay là cờ theo **lượt** (`turn_partial`, bài `test_a_later_turn_still_gets_the_deadline_diagnosis`);
  (2) con của đường lệnh/kỹ năng (`skills/runtime_commands._command_task`) không truyền `maxSteps` nên rơi về mặc định
  40 bước — **rộng hơn cha** khi phiên đặt ít bước; nay mọi con đi qua `clamp_child_budget()` ngay trong `create()`, nên
  đường CLI của `/claude-code` cũng bị phủ (`test_command_child_never_gets_more_steps_than_the_session`, và bài
  "con lấy đúng ngân sách thời gian của phiên" cũ vẫn xanh vì trần engine của phiên là 600 s);
  (3) câu chốt trong cửa sổ giữ chỗ vào thẳng transcript mà **không** qua cổng độ dài D2 ⇒ một câu 200 000 ký tự lọt
  trần 150 000; nay `finish_partial` gọi `enforce_answer_length` trước khi lưu
  (`test_a_diagnosis_is_never_stored_past_the_length_ceiling`); (4) `partial_turn` không quét `ANSWER_TOO_LONG` nên cha đọc
  một con bị cắt là `completed` trọn vẹn trong khi `turn_end` của chính con nói `partial` — nay cùng nhóm
  (`test_a_cut_answer_is_partial_for_the_parent_too`). Ba phát hiện còn lại của bản soát (cửa sổ giữ chỗ chỉ cần **độ dài**
  ≥ 80 ký tự là mở, không đòi dấu hiệu chẩn đoán; lượt dở khi chưa có bước nào đang mở thì thiếu hàng `turn_end` nên
  `stepsUsed`/`toolsRun` không tới bàn điều khiển; vé mơ hồ của plan ghim theo `(slug, thư mục)` chứ **không** theo nội dung
  plan) **không** vá trong đợt này — ghi ở mục "phản hồi ngoài phạm vi" của PR #3.
  Bốn điểm vá được đo lại **sống** trên hai tiến trình thật (harness PID 119915 giữ cây `3865d9c` cho phép đo "trước", rồi
  PID 137585 trên cây `7a7befd`): phiên `maxSteps: 3 / deadlineSeconds: 5` — lượt 2 *trước* là `turn_end {status: "error"}` +
  `error {DEADLINE_EXCEEDED}`, hàng `sessions` `failed`, không câu trả lời; *sau* là `turn_end {status: partial,
  diagnosis: true, deadlineUsedMs: 5254}` + notice `DEADLINE_EXCEEDED {diagnosisChars: 320, readToolCalls: 2}`, hàng
  `sessions` `completed`, không event `error`. Lượt `/explore` trên phiên 12 bước: *trước* con `40` bước — **rộng hơn cha**;
  *sau* con `12` bước kèm dòng `session.child_budget_clamped {requestedSteps: 40, steps: 12, deadlineSeconds: 600}`, còn
  phiên `60/600` vẫn cho con `40/600` (luật D-15 và luật thừa hưởng hạn chót của đường lệnh không đổi). Bộ `deploy/docker`
  (**496 passed**) và frontend (**118 tệp / 958 bài**) chạy lại trên `7a7befd`: không hồi quy.
- **Dấu vết đo để lại** (đợt kiểm thử, không phải bản ghi sản phẩm): `.plans` **thêm** `v1/v2-boxfox-upgrades-two.md`,
  `v1/v2-kettle-lantern.md`, `v1-fix4-real-version.md`; hai tệp gốc `v1-agent-box-plan.md` / `v1-boxfox-5-upgrades.md`
  **không đổi một byte** (sha256 `30e05800…` / `4831506b…`); `.uploaded_artifacts` thêm `8.md`…`16.md`, `11.png`,
  `big26c.bin` (0 B, phép thử chunked), `exact25.bin` (đúng 25 MiB); `deep/` đã bị đưa vào `.trash/1790085372-deep` bởi
  chính phép kiểm đường bảo vệ.
