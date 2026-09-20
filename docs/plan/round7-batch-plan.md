# Kế hoạch đợt 7 — sáu việc chủ sở hữu giao ngày 2026-09-20

> **Trạng thái:** đang thực thi. Tài liệu này ghi rõ từng việc, bằng chứng đã có, việc còn nợ và
> cách nghiệm thu. Ba việc cần bản kế hoạch riêng có tài liệu riêng:
> [chất lượng đầu ra](agent-output-quality-plan.md), [benchmark](cua-benchmark-plan.md),
> [nhật ký hệ thống cho dev](dev-system-log-plan.md).

## 0. Sáu việc và trạng thái

| # | Việc chủ sở hữu yêu cầu | Trạng thái | Bằng chứng / tài liệu |
|---|---|---|---|
| 1 | Hội thoại dài thi thoảng lỗi `Agent run failed` | Đã sửa gốc, chờ xác minh sống sau khi khởi động lại harness | mục §1 |
| 2 | Kiểm thử CUA mức nhẹ → nặng (thao tác, quay video, báo lại người dùng) | Đang chạy ma trận kiểm thử | mục §2 |
| 3 | Kiểm thử khả năng gọi sub-agent; sub-agent trả markdown lặp, plan không có cơ chế verify | Lỗi lặp đã sửa; hợp đồng kết quả + cổng chất lượng plan đang được vá | mục §3 |
| 4 | Đánh giá chất lượng đầu ra: "chất lượng" hay "cho qua cho nhanh" | Kế hoạch đã viết | [agent-output-quality-plan.md](agent-output-quality-plan.md) |
| 5 | `/claude-code` + nghiên cứu 9router và chuyển về BoxFox | Đang triển khai (hai luồng song song) | mục §4 |
| 6 | Benchmark cụ thể, ước lượng chi phí và thời gian | Kế hoạch đã viết | [cua-benchmark-plan.md](cua-benchmark-plan.md) |
| 7 | Nhật ký hệ thống cho dev, ngoài box, agent không thấy | Bản v1 đã chạy | [dev-system-log-plan.md](dev-system-log-plan.md) |

## 1. Việc 1 — lỗi khi hội thoại dài

### 1.1 Nguyên nhân gốc đã xác định

| Mã | Lỗi | Bằng chứng |
|---|---|---|
| BUG-26 | Harness phát lại **toàn bộ** văn bản tích luỹ ở mỗi delta (`assistant_delta`, `thought`), trong khi cả hai nơi đọc đều cộng dồn. Một token mỗi delta cho ra `AABABC…`. | `runtime.py` cũ: `content += delta['content']` rồi `on_content(content)`; `SubagentInspectorPanel.tsx` cũ: `output += text` |
| BUG-26b | Bảng sub-agent đọc `tool_end` theo khoá `tool_call_id`, harness phát khoá `id` ⇒ kết quả không gắn vào dòng, mọi dòng treo ở "running". | `deploy/docker` worker + `runtime.py` phát `{'id': call['id'], …}` |
| BUG-27 | Câu lỗi hiển thị đúng chữ `Agent run failed` khi `error` rỗng: `aiohttp.ServerDisconnectedError`, `ConnectionResetError`, `Exception()` đểu stringify rỗng. Không có retry cho lỗi tạm thời. | `harnessChatStore.ts` nhánh dự phòng; `runtime.py:712` cũ `str(exc)` |

### 1.2 Cách sửa (đã đẩy ở commit `0800349`)

1. Harness chỉ phát **phần đuôi mới** của mỗi delta (`_suffix`), nên cả event mới và event cũ
   trong DB đều đọc được.
2. Frontend dùng chung `appendStreamText()` (`frontend/src/lib/streamText.ts`): nhận cả dạng
   tích luỹ lẫn dạng mảnh rời. Áp dụng cho transcript chính và bảng sub-agent.
3. `failures.py` phân loại ngoại lệ, luôn cho ra `code` + `message` không rỗng:
   `DEADLINE`, `UPSTREAM_UNREACHABLE`, `UPSTREAM_HTTP_<mã>`, các mã đã có, `TURN_EMPTY_STREAM`,
   `TURN_EMPTY_RESPONSE`, `TURN_TOOL_BATCH`, `TURN_FAILED_<TÊN>`.
4. Một lần thử lại có giới hạn cho lỗi mạng tạm thời, có event `notice` mã `UPSTREAM_RETRY`.
5. Event `error` mang thêm `code`; UI hiện mã lỗi cạnh câu lỗi.

### 1.3 Việc còn nợ của việc 1

- Harness đang chạy code cũ; phải khởi động lại để xác minh sống (xem §5).
- `HarnessStepView` chưa vẽ event `notice`; hiện `notice` rơi vào nhánh mặc định nên bị bỏ qua.
  Theo luật "không đổi thiết kế", khi nối thì dùng đúng lớp CSS của event anh em.

## 2. Việc 2 — ma trận CUA nhẹ → nặng

| Mức | Nội dung | Tiêu chí đạt |
|---|---|---|
| Nhẹ | `computer_screen_capture` một lần, ảnh vào transcript | Ảnh thật trong workspace, event `tool_end` có kết quả, không treo "running" |
| Vừa | `computer_use` một chuỗi hành động (mở app, gõ, bấm) | Trạng thái màn hình đổi đúng, không lặp hành động, dừng đúng lúc |
| Nặng | Nhiều bước CUA + `computer_screen_record` + `terminal_exec` trong cùng lượt, rồi báo lại người dùng | Video đọc được (`ffprobe` có thời lượng), có câu trả lời cuối, không lỗi `Agent run failed` |

Bằng chứng đợt này: `/code/.generated_artifacts/images/r7_*.png`,
`/code/.generated_artifacts/recordings/r7_*.webm`, bài toán lỗi ở
`/code/.generated_artifacts/r7_delta_repro.json`.

## 3. Việc 3 — chất lượng gọi sub-agent

### 3.1 Đã có

- BUG-26 sửa xong ⇒ hết lặp khi copy markdown của sub-agent.
- Sự kiện sub-agent sống trong bảng "Execution Console" có tab riêng.

### 3.2 Đang vá (task build song song)

1. `delegate_task` có mô tả từng tham số và trường nêu rõ **hình dạng kết quả** cần nhận.
2. Prompt gửi sub-agent có hợp đồng kết quả: Findings / Evidence (đường dẫn, lệnh, đầu ra) /
   Verification performed / Limitations & open questions.
3. Câu trả lời của sub-agent bị chặn trần khi ghi vào event (`truncated`, `answerChars`).
4. `write_plan` có **cổng chất lượng**: thiếu mục nghiệm thu có lệnh cụ thể, thiếu mục rủi ro,
   hoặc thiếu nguồn khi khẳng định dữ kiện ngoài ⇒ từ chối với mã `PLAN_QUALITY_REJECTED`.
5. SOP của orchestrator buộc giao việc cần kiến thức ngoài cho chuyên gia `research`, và buộc
   mọi kết quả con phải kèm bằng chứng.

### 3.3 Giới hạn phải nói thật

- **Không có công cụ tìm kiếm web nào trong sản phẩm.** Năng lực web duy nhất là `browser_use`,
  và container mặc định `BOX_DEFAULT_NETWORK=off` nên phần lớn trường hợp không duyệt được web.
  Vì vậy prompt mới yêu cầu nói rõ "không kiểm chứng được" thay vì bịa nguồn.
- Cần chủ sở hữu quyết định có mở mạng cho box theo phiên hay không.

## 4. Việc 5 — `/claude-code` và 9router

### 4.1 Hiện trạng đã kiểm chứng

| Hạng mục | Hiện trạng |
|---|---|
| Router BoxFox | Có `POST /v1/messages` nhưng **chỉ văn bản**: bỏ `tools`, `tool_use`, `tool_result`, ảnh, `thinking`; trả SSE kiểu OpenAI có `[DONE]`; không có `/v1/messages/count_tokens` |
| Bộ dịch 9router | Đã vendor sẵn `router/src/vendor/9router/openai-to-claude.mjs` và `claude-to-openai.mjs`, nhưng chỉ dùng cho chiều ra (provider adapter) |
| Box | **Không có** `node`, `claude`, `bwrap`; không có `ANTHROPIC_*` |
| Harness | `docker exec` không truyền `env`; worker `Popen` không truyền `env`; readiness đòi `claude auth status` → `loggedIn` |
| Mạng | Box `172.18.0.2`, gateway `172.18.0.1`; `iptables OUTPUT` policy DROP, chỉ mở cổng công bố; router bind `127.0.0.1:3101` ⇒ curl từ box trả `000` |

### 4.2 Hai luồng sau khi chuyển

```
Người dùng chat thường:   UI → harness → router (/api/router/chat) → provider
Người dùng gõ /claude-code: UI → harness → box → claude CLI → ANTHROPIC_BASE_URL → router (/v1/messages) → provider
```

Luồng thứ hai chỉ xuất hiện khi lệnh `/claude-code` được gọi. Không có tài khoản Anthropic nào
được dùng: CLI trỏ vào router BoxFox bằng `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`.

### 4.3 Phần đang làm

1. **Router:** vào đúng chuẩn Anthropic (system dạng mảng, `tool_use`/`tool_result`, `input_schema`,
   `tool_choice`, SSE có tiền tố `event:`, không `[DONE]`, `message_start`/`content_block_*`/
   `message_delta`/`message_stop`, `stop_reason` đúng, khung `error`), thêm `count_tokens`, trả lời
   nội bộ các request "khởi động" của claude-cli.
2. **Box:** thêm Node + `@anthropic-ai/claude-code` + `bubblewrap` vào ảnh; truyền cấu hình qua
   `docker exec -e` và ghi `~/.claude/settings.json`; readiness thêm nhánh "chạy qua router";
   mở đường box → router theo cơ chế **mặc định tắt** (`BOX_LLM_BRIDGE=on` cho phép đúng một luật
   ra gateway:3101).

### 4.4 Việc còn nợ (cần chủ sở hữu quyết định)

- Có mở `BOX_LLM_BRIDGE` cho box hay không. Mặc định vẫn là đóng.
- Container `agentbox-box` đang chạy ảnh cũ; phải tạo lại để dùng ảnh mới (chủ sở hữu đang dùng
  Desktop nên lần này không tự tạo lại).

## 5. Việc còn nợ chung của đợt 7

1. Khởi động lại harness để nạp code mới rồi xác minh sống việc 1.
2. Nhận kết quả ma trận CUA (việc 2) và đưa bằng chứng vào báo cáo kiểm thử.
3. Chạy lại toàn bộ test sau khi ba task build xong; chỉ chấp nhận lỗi có sẵn từ trước.
4. Cập nhật PR, `docs/tracking/*` và báo cáo kiểm thử.

## 6. Nghiệm thu của đợt

Đợt chỉ được coi là xong khi: mỗi việc có bằng chứng chạy thật (ảnh, video, log JSONL, đầu ra lệnh);
mọi thứ không kiểm chứng được trong môi trường này được ghi rõ là **chưa xác minh** kèm lý do;
và không có thay đổi thiết kế giao diện nào ngoài style hệ thống đang có.
