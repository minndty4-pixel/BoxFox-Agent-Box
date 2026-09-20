# Plan sửa lỗi — Kết quả kiểm thử E2E 2026-09-19

Nguồn lỗi: `boxfox-ket-qua-kiem-thu.md` (25 lỗi, 21 case E2E: 15 PASS / 8 FAIL).

Nguyên tắc chung:

1. Không đoán khi có dữ liệu thật. Mọi thông tin model (context window, mức thinking) lấy từ API provider.
2. Không hiển thị dữ liệu giả cho người dùng. Nếu không có dữ liệu thật thì nói rõ là không có.
3. Một nguồn sự thật cho mỗi khái niệm. Giao diện, harness và router dùng cùng một trường dữ liệu.
4. Mỗi lỗi phải có test tái hiện. Test nằm cùng commit với bản sửa.

## A. Router — luồng thinking và metadata model

### R1. Delta chỉ có `reasoning_content` bị lọc bỏ (BUG-2)

- Nguyên nhân: `router/src/engine.mjs:92` chỉ chấp nhận delta có `content` hoặc `tool_calls`.
- Cách sửa: xét thêm `event.delta?.reasoning_content` và `event.delta?.reasoning` khi quyết định delta có ích. Cộng `outputBytes` cho mọi delta được gửi đi. Giữ nguyên giới hạn 8 MiB.
- Kiểm tra: SSE có event `delta` với `reasoning_content` không rỗng khi provider trả về; `server.mjs:42` cộng dồn `reasoningContent` (đường không stream cũng phải có).
- Test: `router/tests/reasoning-stream.test.mjs` — provider giả phát 3 delta chỉ có `reasoning_content`, kỳ vọng 3 event ra client và `finish` có `reasoning_content` trong kết quả không stream.

### R2. Không có context window, không có kiểu thinking (BUG-4)

Trường mới trong model record (hợp đồng dùng chung cho cả 3 tầng):

```js
{
  contextWindow: number | null,     // cửa sổ context tối đa, đơn vị token
  thinkingType: 'effort' | 'budget' | 'fixed' | 'none',
  defaultThinking: string | null,   // mức mặc định provider báo
  thinkingLevels: string[]          // giữ nguyên
}
```

- Cách lấy dữ liệu:
  - OpenRouter: `GET /models` đã được gọi ở `providers/openrouter.mjs:70`. Đọc thêm `context_length` (dùng giá trị top-level khi có), `reasoning.supported_efforts` → `thinkingLevels`, `reasoning.default_effort` → `defaultThinking`, `reasoning.mandatory`/`default_enabled` → `thinkingType='effort'` hoặc `'none'`. `supported_parameters` chứa `reasoning` hoặc `include_reasoning` cũng là dấu hiệu có thinking.
  - Anthropic: `thinkingType='budget'`, cửa sổ 200000 cho Claude 4.x, 1000000 khi id có hậu tố `[1m]`. Adapter đã có bảng budget `2048/8192/16384` ở `providers/anthropic.mjs:28-34`.
  - Antigravity/Cloud Code: `thinkingType='effort'`, cửa sổ 1000000, `thinkingLevels` từ hậu tố id (`-low/-medium/-high`).
  - Gemini trực tiếp: `thinkingType='effort'`, cửa sổ từ `models.list` (`inputTokenLimit`) khi có; nếu không có thì để `null`.
  - OpenAI/Codex: `thinkingType='effort'` với `reasoning_effort` (`minimal|low|medium|high`).
  - Provider không hỗ trợ thinking: `thinkingType='none'`, `thinkingLevels=[]`.
- Bỏ hẳn việc gán cứng `['low','medium','high']` cho mọi model ở `providers/common.mjs:104-123` và `service.mjs:56-66,159`. Chỉ gán theo dữ liệu provider. Nếu không rõ thì `thinkingLevels=[]` + `thinkingType='none'`.
- Sửa nhãn sai: các catalog tĩnh trong `providers/{claude,codex,cline,opencode}.mjs` đang khai `source:'live'` → đổi thành `source:'static'` (hoặc giá trị tương ứng đang dùng trong repo).
- API: `GET /api/router/state` và mọi nơi trả model record phải có 3 trường mới.

### R3. Dịch mức thinking theo adapter

- `effort` → OpenAI/OpenRouter: `reasoning_effort`; Gemini/antigravity: `thinkingLevel` (low/medium/high).
- `budget` → Anthropic: `thinking.budget_tokens`; ánh xạ low/medium/high → 2048/8192/16384 (giữ như hiện tại), và bỏ `thinking` khi model là `fixed`.
- `none` → không gửi trường thinking nào.
- Ghi rõ trong code: Gemini 3 nhận mức `low|medium|high`, không nhận `thinkingBudget`; `reasoning_effort` được Google ánh xạ sang `thinking_level`.
- Test: bảng ánh xạ cho 4 adapter + trường hợp `none`.

## B. Harness / backend

### B1. `/compact` báo lỗi trên hội thoại ngắn (BUG-1)

- Nguyên nhân: `agent_core/compression.py` raise khi `after >= before`, tức khi bản tóm tắt dài hơn bản gốc. Hội thoại ngắn luôn rơi vào trường hợp này.
- Cách sửa: khi `after >= before` và context chưa vượt ngưỡng an toàn → trả bản gốc kèm `{'kind':'unchanged','beforeEstimate':before,'afterEstimate':after,'reason':'summary_not_smaller'}`. Chỉ raise `CONTEXT_LIMIT` khi context thật sự vượt `context_window - output_reserve` (không thể tiếp tục).
- Không đánh session `failed` khi nén không cần thiết: `runtime_commands.py` chỉ `save(..., 'failed')` khi lỗi thật.
- Test: `backend/tests/unit/test_compression.py` — hội thoại 3 lượt ngắn, `force=True` → `kind='unchanged'`, không exception, session giữ `completed`.

### B2. `contextWindow` lấy từ router (BUG-4, phần backend)

- `agent_core/runtime.py:241-256` (`resolve_context_window`) hiện đoán theo tên model. Sửa thứ tự ưu tiên: giá trị người dùng truyền → `contextWindow` của model từ router → bảng tĩnh theo provider → mặc định 128000.
- Bảng tĩnh chỉ là phương án cuối; ghi chú rõ trong code.
- Test: `resolve_context_window` nhận model record có `contextWindow` → trả đúng giá trị đó.

### B3. `thinkingLevel` bị mất khi tạo session (BUG-5)

- `runtime.py:286` chỉ giữ `connectionId/modelId/aliasId`. Thêm `thinkingLevel` (và `thinking` nếu có) vào danh sách giữ lại, có kiểm tra kiểu chuỗi.
- Test: tạo session với `thinkingLevel='high'` → `config.route.thinkingLevel === 'high'`.

### B4. `/claude-code` trả `CHILD_FAILED` thay vì `setup_required` (BUG-11)

- Nguyên nhân: `skills/commands.py:172-175` gán cứng `role='build'` và executor `claude-code`; probe có sẵn (`sandbox/claude_worker.py:19-39`, `api/server.py:124`) nhưng đường dispatch không gọi.
- Cách sửa:
  1. Gọi probe trước khi tạo tiến trình con ở `skills/runtime_commands.py`.
  2. Nếu thiếu CLI hoặc thiếu auth → trả lỗi có mã `SETUP_REQUIRED` kèm hướng dẫn, không tạo tiến trình con, không đánh dấu con `failed`.
  3. Tách executor khỏi role: `/claude-code` giữ executor `claude-code` nhưng lấy role từ tham số (mặc định `orchestrator` khi không có chuyên gia phù hợp), không hardcode `build`.
- Test: `backend/tests/unit/test_claude_dispatch.py` — probe thiếu binary → `SETUP_REQUIRED`, không có session con; role do người dùng chọn được tôn trọng.

### B5. Lỗi 400 hiện im lặng trên UI (BUG-17)

- Backend giữ mã lỗi rõ ràng trong JSON (`{'error': {'code': ..., 'message': ...}}` hoặc tương đương đang dùng) để UI phân loại: `SETUP_REQUIRED`, `SKILL_DISABLED`, `SESSION_BUSY`, `UNKNOWN_COMMAND`, `MISSING_TASK`.
- UI: `store/harnessChatStore.ts` đã lưu `error`; cần render (xem F1).

## C. Khung chat — hiển thị

### F1. Hiện lỗi inline thay vì im lặng (BUG-17)

- `components/panels/ChatPanel.tsx`: đọc `session.error` (đã có trong store) và render một khối lỗi màu cảnh báo phía trên ô nhập, kèm mã lỗi nếu có. Giữ nguyên nội dung người dùng vừa gõ (không xoá ô nhập khi lỗi).
- Test: `ChatPanel.test.tsx` — store trả `error` → khối lỗi xuất hiện, ô nhập vẫn giữ nội dung.

### F2. Render theo thứ tự thời gian (BUG-8, vấn đề chính của ảnh 2)

- `components/chat/HarnessStepView.tsx`: thay 4 khối cố định bằng **một danh sách phẳng theo `seq`**:
  `command_resolved` (ẩn) → `assistant_delta`/`assistant` (kể cả `final:false`) → `tool_start`/`tool_end` → ảnh của tool → `compression` → ... → câu trả lời cuối.
- Mỗi `tool_start` + `tool_end` vẽ thành một hàng duy nhất tại đúng vị trí của nó. Không gom vào accordion.
- Ảnh/video của `tool_end` vẽ ngay dưới hàng tool đó, không dựng gallery riêng.
- Bỏ accordion "Worked for Xs" bao quanh tất cả; giữ một dòng tổng kết thời gian ở đầu lượt.
- Test: `HarnessStepView.test.tsx` — event xen kẽ `text → tool → text → tool` phải cho DOM theo đúng thứ tự đó (so sánh `textContent` với mảng mong đợi).

### F3. Bỏ text suy luận giả (BUG-3)

- Xoá 2 chuỗi bịa ở `HarnessStepView.tsx:506,512`.
- Khi có `thought` thật → hiện. Khi không có → hiện dòng trung thực: "Model trả về N reasoning token nhưng không stream nội dung suy luận" (đa ngôn ngữ).
- Test: `thought` rỗng + `reasoning_tokens=469` → chuỗi hiển thị chứa "469" và không chứa "Cryptographically".

### F4. Nhãn ảnh chụp lấy từ dữ liệu thật (BUG-9)

- `HarnessStepView.tsx:586`: bỏ chuỗi cứng `1280 × 720 · PNG`; dùng `dimensions` + `mime` của `tool_end`.
- Test: dimensions `[1280,800]` → nhãn `1280 × 800`.

### F5. Lượt "ma" và thời lượng sai (BUG-18, BUG-19)

- Không tạo lượt từ event trước `user` đầu tiên; gắn `command_resolved` vào lượt kế tiếp.
- `endTime` chỉ cập nhật khi lượt chưa `isCompleted`.
- Test: session có `command_resolved` trước `user` → không có thẻ lượt rỗng; lượt đã xong không bị cộng thời gian từ lượt sau.

### F6. Tóm tắt cuối + nút mở rộng (yêu cầu ảnh 3)

- Câu trả lời cuối hiện **tóm tắt** (đoạn đầu tới ~6 dòng hoặc 600 ký tự) + nút "Xem chi tiết" mở toàn bộ markdown.
- Ảnh/video sinh ra trong lượt hiện **gắn kèm** phần tóm tắt cuối (băng chuyền nhỏ), không chỉ ở giữa lượt.
- Accordion suy nghĩ tự đóng khi lượt xong (đã đúng, giữ nguyên).
- Test: lượt có ảnh + câu trả lời dài → có nút mở rộng, tóm tắt ngắn hơn nội dung đầy đủ, ảnh nằm trong khối cuối.

### F7. Thông báo nén context (BUG-7, ảnh 1)

- Hiện ở cấp cao nhất của lượt (không nằm trong cây Thinking), dạng: `Đã nén context — 192K → 394 tokens` + nút bấm để xem chi tiết (`beforeEstimate`/`afterEstimate`/`kind`).
- Với `kind='unchanged'` → câu trung thực: "Không cần nén; context hiện tại vẫn trong ngân sách."
- Test: event `compression` có `beforeEstimate`/`afterEstimate` → thông báo hiện đúng số và bấm mở được chi tiết.

## D. UX và vỏ ứng dụng

### U1. Auto-scroll và mũi tên xuống cuối

- Khi người dùng gửi tin nhắn mới → cuộn xuống cuối, bám theo nội dung agent sinh ra.
- Người dùng kéo lên → **dừng** bám ngay, không giật.
- Khi không ở cuối → hiện nút mũi tên ở giữa dưới khung chat; bấm → cuộn xuống cuối và bám lại.
- Test: `ChatPanel.test.tsx` — mô phỏng `scroll` lên → không còn auto-scroll; bấm nút → `scrollIntoView` được gọi và bám lại.

### U2. Gỡ rò rỉ transport mock (BUG-20)

- `lib/transport/index.ts` mặc định `mock`. Trong chế độ chat thật, lệnh `interrupt` phải đi qua harness (`harnessStop`), không qua `sendCommand` của transport mock.
- Test: bấm Stop trong phiên harness → chỉ gọi API harness, không có chuỗi "Received interrupt command".

### U3. Thanh Context Window

- Đọc `contextWindow` thật của model (từ router) thay cho suy đoán theo tên ở `ContextUsageBar.tsx:46-64`.
- Bỏ toggle "Auto-compact" nếu backend không có cờ; nếu giữ thì phải nối tới API thật.
- Sửa tràn nhãn ở 900 px (BUG-22).

### U4. Responsive (BUG-23)

- Dưới ~1024 px: sidebar thu gọn thành thanh biểu tượng hoặc ẩn được; cột chat giữ tối thiểu 400 px như HANDOFF §2C.
- Trạng thái rỗng khi chuyển session: hiện chỉ báo đang tải (BUG-24).
- Ngôn ngữ: thống nhất tiếng Việt hoặc tiếng Anh theo i18n, hết trộn (BUG-25); sửa nhãn `undefined user`.

### U5. `/stop` bấm được khi đang chạy (BUG-21)

- Khi ô nhập khớp lệnh điều khiển (`/stop`, `/status`, ...), nút gửi vẫn bật dù agent đang chạy.

## E. Dọn code chết và nhãn sai (mức thấp)

- Xoá hoặc đánh dấu rõ `agent_core/engine.py`, `agent_loop.py`, `tools/` (chỉ test dùng).
- `RouterView.tsx` không có nơi dùng → xoá hoặc nối vào Settings.
- `ShortcutsPopover` 6/8 phím tắt `mock: true` → nối thật hoặc bỏ khỏi danh sách.

## F. Kiểm thử sau khi sửa

Bổ sung vào bộ test tự động và E2E:

1. `/claude-code <task>` không có CLI → thông báo `setup_required` rõ ràng trên UI (không im lặng, không `CHILD_FAILED`).
2. `/skill <id>` thiếu task → lỗi hiện inline.
3. Ma trận slash command: `/help`, `/status`, `/skills`, `/agents`, `/context`, `/stop`, `/compact`, `/skill`, `/claude-code`, lệnh không tồn tại, lệnh bị tắt.
4. Nghịch lý nén context: hội thoại ngắn → `unchanged`; hội thoại dài → `summary` (dùng `contextWindow` nhỏ để tái hiện).
5. Thinking stream: provider giả trả `reasoning_content` → UI hiện chữ thật; provider không trả → thông báo trung thực.
6. Thứ tự thời gian: SSE và DOM phải khớp thứ tự.
7. Đo token: context window hiển thị khớp metadata router.
8. Auto-scroll: bám khi ở cuối, dừng khi người dùng kéo lên, nút mũi tên hoạt động.
9. Biên: harness 403 thiếu header, box control 403 thiếu key.
