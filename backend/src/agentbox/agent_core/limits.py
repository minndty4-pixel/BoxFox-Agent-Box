"""Trần số của runtime — một nguồn cho cả engine lẫn giao diện.

`INSTRUCTIONS_MAX_CHARS` trước đợt 18 nằm dưới dạng literal `[:12000]` trong
`runtime.py`, nên mọi chỗ muốn nói "engine giữ bao nhiêu ký tự" (bộ đếm ở tab
Instructions, câu giải thích phần bị bỏ) đều phải chép tay con số lần thứ hai rồi
lệch dần. Từ đây chỉ còn một con số: `runtime.py` cắt bằng nó, `api/owner_settings.py`
và `GET /api/agent/runtime-info` trả lời bằng nó.
"""

INSTRUCTIONS_MAX_CHARS = 12000

# Trần của một phiên. `runtime.create()` kẹp giá trị người dùng gửi lên bằng đúng bốn
# con số này (mặc định khi thiếu trường, trần khi gửi quá), vai trò con bị chặn chặt
# hơn ở `runtime.delegate()`. Để ở đây vì `GET /api/agent/runtime-info` phải báo lại
# đúng những con số engine đang áp — giao diện không chép tay lần thứ hai.
# Vòng 22 (D-1, D-15): chủ nhà chốt phiên chính 16 → **40** bước và phiên con **40 bước / 300 s**
# (trước là 10 / 120). Số đo vòng 21: việc vừa phải xong ở 8 bước, việc dài 27 bước; con chạm
# 10 bước / 120 s thì trả `answerChars = 0` (BUG-42), nên ngân sách con là chỗ chữa chính.
# `300 s` của con là **trần**, không phải bảo đảm — `runtime.delegate()` vẫn `min()` theo cha.
MAX_STEPS_DEFAULT = 40
MAX_STEPS_MAX = 60
DEADLINE_DEFAULT_SECONDS = 180
DEADLINE_MAX_SECONDS = 600
CHILD_MAX_STEPS = 40
CHILD_DEADLINE_SECONDS = 300

# Trần BYTE của một request mà router chấp nhận, và phần byte của request không nằm trong
# `messages` (prompt vai + schema công cụ). Bộ nén phải biết cả hai: trên cửa sổ 1M, ngưỡng
# 70 % (≈697k token, ≈2 MiB JSON) không bao giờ chạm tới trước khi router trả
# `UPSTREAM_HTTP_413`, nên trần thật của một phiên là byte chứ không phải token. Đo sống
# 2026-09-20: body 1 060 902 B trong khi `messages` là 1 043 364 B — hiệu 17 538 B ≈ 5 846 token
# (ước lượng 3 byte/token), làm tròn lên 6 000 cho phần prompt + schema đầy đủ.
ROUTER_BODY_BUDGET = 900 * 1024
ROUTER_BODY_OVERHEAD_TOKENS = 6000

# Cửa sổ chống-thrash của bộ nén: hỏng một lượt tóm tắt (hoặc nén xong mà vẫn sát ngưỡng) thì
# không thử lại cho tới khi hết cửa sổ này. HERMES `_ANTI_THRASH_RECOVERY_SECONDS = 300.0`
# (agent/context_compressor.py:2501) — hết cửa sổ thì cho phép đúng một lần thử lại.
COMPRESSION_THRASH_SECONDS = 300.0

# Dải mục tiêu của ngưỡng nén (đợt 20, Phần D). Ngưỡng theo tỉ lệ 0,7 một mình cho ra hai đầu
# cực: cửa sổ khai tay 32 768 nén ở 20 070 token (phiên "cụt ngủn"), còn cửa sổ 1M chỉ bị trần
# byte 301 200 chặn nên phiên dài vô hạn — đo trên máy Vorflux 2026-09-21: mỗi lần gộp ở đó là
# 65–185k token. Trần dưới đây giữ box không dài hơn mức đó.
#
# `COMPRESSION_MIN_TOKENS` là SÀN bảo vệ: chỉ áp khi cửa sổ còn đủ chỗ (`budget >= MIN_ROOM`),
# nên nó KHÔNG đổi hành vi của mọi cửa sổ ≤ 32 768 — nói thật là với các cửa sổ đang dùng nó
# không chạm tới; cái chữa "quá ngắn" thật là cảnh báo cửa sổ khai nhỏ ở `runtime.heal_context_windows`.
COMPRESSION_MIN_TOKENS = 32_000
COMPRESSION_MAX_TOKENS = 200_000
COMPRESSION_MIN_ROOM = 40_000

# Sàn theo TOKEN cho phần đuôi giữ nguyên văn. Sàn hiện có (`MAX_TAIL_MESSAGE_FLOOR = 8`) đếm
# bằng SỐ message, nên trên cửa sổ 32 768 (`tail_budget` = 5 734 token) tám message có thể không
# lọt vào ngân sách. Trần của sàn này là 1/4 ngân sách một lượt, để sàn không ăn hết chỗ của bản
# tóm tắt.
MAX_TAIL_TOKEN_FLOOR = 8_000

# --- Phần C: hai lỗi đo được từ lượt chạy sống 2026-09-21 -------------------------------
# Lượt "clone repo, đọc dự án, viết plan, sửa code nhẹ" đã xong việc trên đĩa (plan `v5-…`
# 9 155 B, 4 tệp sửa, `300 passed`) mà lượt chạy vẫn kết thúc `failed`. Hai con số dưới đây
# thuộc về hai nguyên nhân của lượt đó, không phải chính sách mới.

# C1 — "kẹp âm thầm" hạn chót. Người dùng đặt `deadlineSeconds: 900`, `runtime.create()` kẹp
# về `DEADLINE_MAX_SECONDS` (600) mà không có event, không có dòng log, không có trường nào
# trong payload phiên: con số 900 trên giao diện là con số engine CHƯA BAO GIỜ dùng. Mã notice
# dưới đây là tên duy nhất của sự việc đó trong transcript.
DEADLINE_CLAMP_NOTICE_CODE = 'DEADLINE_CLAMPED'
DEADLINE_MIN_SECONDS = 5

# C2 — trần output của nhà cung cấp. Đo sống: con `6bd868ad…` trả `finishReason: length`,
# `outputTokens: 4096`, `toolCalls: 0` → `TURN_EMPTY_RESPONSE`, không thử lại, cha thấy con
# `failed` dù đó là lỗi TẠM THỜI của nhà cung cấp chứ không phải lỗi của việc uỷ thác. Lần thử
# lại hạ trần output và bỏ công cụ để model buộc phải trả lời bằng chữ.
TRUNCATED_OUTPUT_MAX_TOKENS = 2048
TRUNCATED_OUTPUT_NOTICE_CODE = 'PROVIDER_OUTPUT_TRUNCATED'

# --- Vòng 22: ngân sách không còn "mất trắng", và trần độ dài câu trả lời -----------------
# Ba số dưới đây là hợp đồng của đường chẩn đoán chỗ tắc (yêu cầu mới của chủ nhà, D-15):
# chạm trần bước hoặc hạn chót thì lượt (cha **hoặc** con) phải tự đọc lại trạng thái, sửa
# một lần nếu đường cũ sai, rồi trả `partial` kèm bốn phần: đã làm / tắc ở đâu / còn lại /
# thử gì tiếp. `WRAP_UP_STEPS_RESERVED` là số bước giữ chỗ cho việc đó (trần của phần
# "sửa lại một lần"), nên lượt hữu ích ngắn đi đúng ba bước.
STEP_BUDGET_NOTICE_CODE = 'STEP_BUDGET_EXHAUSTED'
DEADLINE_NOTICE_CODE = 'DEADLINE_EXCEEDED'
STEPS_CLAMP_NOTICE_CODE = 'STEPS_CLAMPED'
WRAP_UP_STEPS_RESERVED = 3
WRAP_UP_MAX_TOKENS = 1024
WRAP_UP_TIMEOUT_SECONDS = 30
WRAP_UP_READ_TOOL_CALLS = 2
DIAGNOSIS_MIN_CHARS = 80

# Trần độ dài câu trả lời cuối (D-4): 60 000 ký tự thì cảnh báo, 150 000 thì từ chối và trả
# `partial` kèm tệp toàn văn. Ngưỡng của **kế hoạch** (40 000 / 150 000) là bộ số khác, không đụng.
ANSWER_WARN_CHARS = 60_000
ANSWER_MAX_CHARS = 150_000
ANSWER_LENGTH_WARN_CODE = 'ANSWER_LENGTH_WARN'
ANSWER_TOO_LONG_CODE = 'ANSWER_TOO_LONG'
# Dòng chỉ dẫn này sống ở ĐÂY, không chép tay vào từng prompt vai: `runtime.start()` là nơi
# duy nhất dựng prompt hệ thống cho mọi vai, nên mọi prompt đều mang câu này.
ANSWER_LENGTH_HINT = (
    f'Keep the final answer under {ANSWER_WARN_CHARS:,} characters. If the content is longer, '
    'write it to a file in the workspace and quote the path instead of pasting it into the answer.'
)
