# Thiết kế chính sách thử lại (retry) cho lượt gọi model

> **Trạng thái:** đã có trong mã (đợt 13). Việc 4 của chủ sở hữu: *"thiết kế retry, hiện tại
> hình như nếu lỗi, quẳng lỗi luôn mà không có retry hợp lý"*.
>
> **Phán đoán của chủ sở hữu là đúng.** Bản cũ chỉ có **một** lần thử lại, chờ cứng **1.5 s**,
> và điều kiện `is_transient` trả `False` cho **HTTP 429** — nên đúng ca đang gặp hôm nay
> (Gemini hết quota) chết lượt ngay lập tức, không thử lại lần nào.

## 1. Hiện trạng trước bản sửa

| Tầng | Đã có gì | Vấn đề |
|---|---|---|
| Router (`router/src/engine.mjs`) | Vòng lặp qua các target, và **trong mỗi target một vòng khoá** (vòng 29); `retryable = 429 hoặc ≥ 500`; một 429 park **đúng khoá vừa gọi** rồi thử khoá kế tiếp ngay trong request đó — 30 s khi provider không gửi `Retry-After`, chỉ nâng theo header, trần **120 s** | Chạy đúng, nhưng khi hết lượt thì **ném lỗi thô** ra harness. Nay lỗi thô ấy là lỗi **thật** của provider: cả ring đang nghỉ thì chính lỗi 429 đó đi ra (giữ nguyên `code`/`message`/`status`/`retryAfterMs`), và lượt rơi vào lúc cả ring nghỉ **không tốn một lần gọi provider nào** vì phép kiểm nghỉ nằm trước lời gọi adapter |
| Harness `RouterClient.complete()` | Khi nhánh stream lỗi, **thử lại ngay bằng một POST không stream** (`except Exception:`) | Một lần 429 thành **hai** lần gọi provider, cách nhau 0 s — làm nhà cung cấp đang giới hạn bị gọi dồn thêm |
| Harness, vòng lặp bước (`runtime.py`) | Đúng **một** lần thử lại, `asyncio.sleep(1.5)`, `is_transient` quyết định | Không backoff, không jitter, không tôn trọng `Retry-After`, **429 không được thử lại**, không nói cho người dùng biết đã thử mấy lần |
| Mã lỗi tới tay harness | Chỉ còn chuỗi `Router HTTP 429: <message>` | `code` của router (`RATE_LIMIT`), cờ `retryable` và `retryAfterMs` **bị mất**, nên harness không thể quyết định đúng |

Hệ quả đo được trong đợt này: `UPSTREAM_HTTP_429` là lỗi chết lượt cứng (`turn.failed`), còn
nhật ký chỉ có `model.error` một dòng — người dùng thấy "Agent request failed" như thể app
không hề thử lại.

## 2. Nguyên tắc thiết kế

1. **Một nơi quyết định.** `failures.retry_advice()` là nguồn duy nhất cho câu hỏi "có thử lại
   không, chờ bao lâu, khi nào dừng". `is_transient()` chỉ là góc nhìn một tham số của nó, nên
   hai chỗ không thể lệch nhau.
2. **Thử lại theo loại lỗi, không theo mọi lỗi.** Lỗi nhà cung cấp *yêu cầu chậm lại* (429) và
   *hạ tầng hỏng* (5xx, socket đứt, stream rỗng) thì đáng thử lại. Lỗi *đề nghị sai* (400/401/
   403/404, quyền công cụ) thì gọi lại y hệt cũng hỏng y hệt. Lỗi *quá chậm* (hết hạn, timeout)
   thì đã tiêu hết cửa sổ của lượt — thử lại bắt đầu từ số 0, chỉ tốn thời gian.
3. **Chờ có trần hai lần.** Mỗi lần chờ bị chặn bởi `RATE_LIMIT_MAX_SECONDS = 30` (dù router
   báo cooldown tới 120 s — trần của router, xem vòng 29) và cả lượt bị chặn bởi
   `RETRY_BUDGET_SECONDS = 60`. Một lần chờ nữa chỉ
   được phép nếu còn ít nhất `MIN_RETRY_WINDOW_SECONDS = 5` giây của hạn lượt — thà báo lỗi còn
   hơn ngủ qua hạn rồi chết bằng `DEADLINE` mà không có câu trả lời nào.
4. **Tôn trọng `Retry-After`.** Router đã đọc `retryAfterMs` từ provider; harness nay giữ lại
   giá trị đó trên chính đối tượng lỗi và dùng nó làm thời gian chờ.
5. **Không nhân đôi công việc.** Khi router đã trả lời dứt khoát (429/4xx), harness không gọi
   lại bằng đường không stream nữa: một lần 429 phải là **một** lần gọi provider.
6. **Nói cho người dùng biết.** Mỗi lần thử lại phát một `notice` (`UPSTREAM_RETRY`) kèm số lần,
   tổng số lần, thời gian chờ và lý do; khi bỏ cuộc phát `UPSTREAM_RETRY_EXHAUSTED`; và banner
   lỗi cuối cùng ghi kèm "sau N lần thử lại".

## 3. Bảng quyết định

| Loại lỗi | Ví dụ | Thử lại | Chờ | Lý do |
|---|---|---|---|---|
| Nhà cung cấp giới hạn | `UPSTREAM_HTTP_429`, code `RATE_LIMIT`/`CAPACITY` | Có | `Retry-After` (mặc định 2 s), chặn ở 30 s | `rate-limit` |
| Nhà cung cấp quá tải / hạ tầng | `UPSTREAM_HTTP_500/502/503/504`, `408`, `409`, `425` | Có | 1 s → 4 s → 12 s, ±20 % jitter | `upstream` |
| Đứt kết nối / stream rỗng | `ServerDisconnectedError`, `ConnectionResetError`, `TURN_EMPTY_STREAM` | Có | như trên | `stream` |
| Hết hạn | `DEADLINE`, `UPSTREAM_TIMEOUT` | Không | — | cửa sổ đã tiêu hết |
| Đề nghị bị từ chối | `UPSTREAM_HTTP_400/401/403/404`, `TOOL_NOT_PERMITTED` | Không | — | gọi lại y hệt cũng hỏng |
| Ngữ cảnh / hợp đồng | `CONTEXT_LIMIT`, `MAX_STEPS`, `DECISION_*` | Không | — | không phải lỗi tạm thời |

Số lần: **3 lần thử lại** (`DEFAULT_MAX_RETRIES`), tức tối đa **4 lần gọi** cho một bước.

## 4. Thay đổi trong mã

| Tệp | Thay đổi |
|---|---|
| `backend/src/agentbox/agent_core/failures.py` | Thêm `RETRYABLE_STATUS`, `DEFAULT_MAX_RETRIES`, `BACKOFF_SECONDS`, `RATE_LIMIT_MIN/MAX_SECONDS`, `RETRY_BUDGET_SECONDS`, `MIN_RETRY_WINDOW_SECONDS`; `router_status()`, `retry_after_seconds()`, `_retry_reason()`, `_retry_delay()`, `retry_advice()`. `is_transient()` nay gọi `retry_advice()` |
| `backend/src/agentbox/agent_core/runtime.py` | `router_refusal(status, content)` dựng `RuntimeError` mang `router_status`/`router_code`/`retryable`/`retry_after_ms`; nhánh stream dùng nó; nhánh không stream **không chạy** khi router đã trả lời < 500; vòng lặp bước dùng `retry_advice()` với hạn lượt thật (`seconds_left(budget)`), phát `UPSTREAM_RETRY` / `UPSTREAM_RETRY_EXHAUSTED`, ghi `model.error` kèm `retries`/`retryWaitedMs`/`retryBudgetSeconds`; banner lỗi cuối thêm "[after N retries in Xs]" |
| `frontend` | Không đổi: `notice` đã có kiểu hiển thị sẵn (`HarnessStepView`), chỉ thêm trường trong `data` |

## 5. Kiểm chứng

`backend/tests/unit/test_retry_policy.py` — **13 ca**: 429 tôn trọng `Retry-After`; 429 không có
`Retry-After` vẫn chờ sàn 2 s; chờ bị chặn ở 30 s dù provider báo 10 phút; 5xx backoff tăng dần
có jitter; 4xx không thử lại; timeout không thử lại; socket đứt và stream rỗng thử lại; hết số
lần / hết ngân sách / hết hạn lượt đều dừng; `is_transient` khớp chính sách (429 nay là `True`);
và ba ca chạy lượt thật: hai lần 429 rồi thành công (3 lần gọi, 2 notice), bỏ cuộc sau đúng 3
lần thử lại (4 lần gọi, 1 notice `UPSTREAM_RETRY_EXHAUSTED`, banner có "after 3 retries"), 4xx
chết ngay lần gọi đầu và không có notice nào.
