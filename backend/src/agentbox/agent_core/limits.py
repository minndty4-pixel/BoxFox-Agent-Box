"""Trần số của runtime — một nguồn cho cả engine lẫn giao diện.

`INSTRUCTIONS_MAX_CHARS` trước đợt 18 nằm dưới dạng literal `[:12000]` trong
`runtime.py`, nên mọi chỗ muốn nói "engine giữ bao nhiêu ký tự" (bộ đếm ở tab
Instructions, câu giải thích phần bị bỏ) đều phải chép tay con số lần thứ hai rồi
lệch dần. Từ đây chỉ còn một con số: `runtime.py` cắt bằng nó, `api/owner_settings.py`
và `GET /api/agent/runtime-info` trả lời bằng nó.
"""

import os

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
# --- Vòng 22 đợt 2 (T5): fan-out theo CHA --------------------------------------------------
# Trần cũ là MỘT `Semaphore(3)` dùng chung cả tiến trình: hai phiên cha tranh nhau ba slot và
# một cha không thể có bốn con cùng lúc. Trần giờ đặt theo từng cha (mặc định 3, trần 6) và
# giữ một trần TOÀN CỤC 8 — đủ cho hai cha × ba con mà không tăng tải mặc định.
FANOUT_PER_PARENT_DEFAULT = 3
FANOUT_PER_PARENT_MAX = 6
FANOUT_GLOBAL_CEILING = 8
# Hết chỗ chờ quá ngần này thì trả lỗi tool cho model — một lượt không bao giờ treo vì hết slot.
FANOUT_QUEUE_WAIT_SECONDS = 30
# Chặn vòng lặp sinh con trong MỘT lượt (một lượt 40 bước có thể gọi `delegate_task` 40 lần).
CHILDREN_PER_TURN_MAX = 12
FANOUT_BUSY_CODE = 'FANOUT_BUSY'
CHILDREN_PER_TURN_CODE = 'CHILDREN_PER_TURN_EXHAUSTED'

# --- Vòng 22 đợt 2 (T9): chờ bạn GIAO kết quả -------------------------------------------
# Chủ nhà chốt (Q2): `await_children` chờ **tới lúc bạn giao xong kết quả**, không chờ một
# khoảng thời gian cố định — hàm tỉnh dậy bằng SỰ KIỆN (biên nhận giao hàng được ghi ⇒ đánh
# thức hàng chờ trong cùng một nhịp), nên không polling và không trễ nhịp. Ba con số 300 s
# dưới đây là LƯỚI AN TOÀN để một lượt không bao giờ treo vì đã chờ: một lần chờ, tổng thời
# gian hoãn hạn chót của cả lượt, và trần của `timeoutSeconds` mà người gọi tự đặt.
PEER_WAIT_SAFETY_SECONDS = 300
PEER_WAIT_MAX_SECONDS = 300
PEER_WAIT_TOTAL_MAX_SECONDS = 300
# Cửa sổ DÒ một địa chỉ vai chưa tồn tại (anh em có thể được sinh ngay sau bạn), dò mỗi 1 s.
PEER_TARGET_GRACE_SECONDS = 20
PEER_TARGET_POLL_SECONDS = 1.0
PEER_WAIT_CLAMPED_CODE = 'PEER_WAIT_CLAMPED'
# Phiên khai một khoá mesh mà vòng 22 KHÔNG đổi hành vi vì nó (`parallelReadTools` — Q3/T14), hoặc
# khai tắt mesh cho riêng mình: im lặng nhận một cờ rồi không làm gì là đúng lớp lỗi mà cả vòng này
# đang sửa, nên cờ nào cũng đi kèm một notice nói thẳng nó có hiệu lực hay không.
PEER_MESH_NOTICE_CODE = 'PEER_MESH_NOTICE'
# Tổng ngân sách chữ cho phần `summary` của MỘT kết quả `await_children`: mười hai mục tiêu ×
# 8 000 ký tự là 96 000 ký tự, vượt xa trần 20 000 của một tool result. Mục sau khi hết ngân
# sách vẫn có mặt trong `done` (kèm `truncated: True`), chỉ phần chữ là không còn.
PEER_WAIT_RESULT_CHARS = 16_000
# T11 — trần địa chỉ giao hàng trong MỘT lời gọi `delegate_task`. Bốn là đủ cho các
# đường ống thật (main + ba chuyên gia) và vẫn giữ kết quả tool nhỏ; hơn nữa là lỗi
# tool rõ ràng, không cắt im lặng.
PEER_DELIVER_MAX = 4

# --- Công tắc vận hành của mesh (T5/T10/T13) -----------------------------------------------
# Đọc env mỗi lần hỏi, không đọc một lần lúc nạp: một tiến trình harness sống lâu, nên đổi
# công tắc phải có tác dụng ngay mà không cần khởi động lại. `off` (hoặc rỗng) ⇒ hành vi y
# hệt bản trước đợt 2.
# T10 — Watchdog: ba lưới an toàn cuối của sổ con, và ba lý do chúng ghi vào sổ.
# `CHILD_WALL_MAX_SECONDS = 900` rộng hơn hẳn trần thời gian của MỘT con (`CHILD_DEADLINE_SECONDS`
# = 300): watchdog chỉ được huỷ con đã vượt xa mọi ngưỡng hợp lệ, nếu không nó thành kẻ giết việc
# đang chạy tốt. Nhịp quét thưa (10 s) vì mỗi nhịp là một giao dịch trên SQLite dùng chung.
WATCHDOG_TICK_SECONDS = 10
CHILD_WALL_MAX_SECONDS = 900
# Hàng `started` còn sót lại từ lần chạy TRƯỚC (tiến trình bị giết): thao tác tool không được chạy
# lại, nên không hồi sinh — đóng nó bằng `RESTART`, cùng luật với `UPDATE sessions SET
# status='interrupted'` lúc mở DB.
WATCHDOG_RESTART_REASON = 'RESTART'
WATCHDOG_TIMEOUT_REASON = 'WATCHDOG_TIMEOUT'
WATCHDOG_ORPHAN_REASON = 'ORPHAN'
# Chờ bạn quá `PEER_WAIT_SAFETY_SECONDS` cộng ngần này thì watchdog đánh thức cưỡng bức. Người chờ
# chạy tiếp bình thường với `peer_wait_end status='timeout'`, lượt KHÔNG bị đánh `failed`.
PEER_WAIT_FORCE_GRACE_SECONDS = 30
PEER_MESH_ENV = 'BOXFOX_PEER_MESH'
PEER_FANOUT_ENV = 'BOXFOX_PEER_FANOUT'
PARALLEL_READ_ENV = 'BOXFOX_PARALLEL_READ_TOOLS'
PEER_WAIT_MAX_ENV = 'BOXFOX_PEER_WAIT_MAX'
SWITCH_ON = {'1', 'on', 'true', 'yes'}


def switch_enabled(name, default=False):
    """`True`/`False` cho một công tắc môi trường, có giá trị mặc định khi env trống."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in SWITCH_ON


def peer_mesh_enabled():
    """Công tắc giết của cả mesh: `BOXFOX_PEER_MESH=off` ⇒ không tool peer, uỷ thác chặn như cũ."""
    return switch_enabled(PEER_MESH_ENV, True)


def peer_fanout_limit():
    """Trần con mỗi cha do `BOXFOX_PEER_FANOUT` đặt, hoặc `None` khi biến trống.

    Nhận hai cách viết, vì cả hai đều đã có trong tài liệu: một SỐ (kẹp `[1, FANOUT_PER_PARENT_MAX]`)
    và các chữ nới trần (`on`/`true`/`yes`). Một con số được ưu tiên đọc là con số, nên `=1` là MỘT
    con mỗi cha — cách viết mà kế hoạch T13 chốt cho công tắc giết — chứ không phải "bật".
    """
    raw = (os.environ.get(PEER_FANOUT_ENV) or '').strip().lower()
    if not raw:
        return None
    if raw.isdigit():
        return max(1, min(FANOUT_PER_PARENT_MAX, int(raw)))
    return FANOUT_PER_PARENT_MAX if raw in SWITCH_ON else None


def peer_wait_max():
    """Trần `timeoutSeconds` của MỘT lần chờ bạn (T13): `BOXFOX_PEER_WAIT_MAX=<giây>` hạ nó xuống.

    Chỉ HẠ được, không nâng: trần 300 s là lưới an toàn của lượt, còn biến môi trường là để vận
    hành chạy chặt hơn. Giá trị không phải số nguyên dương thì bị bỏ qua (giữ trần).
    """
    raw = (os.environ.get(PEER_WAIT_MAX_ENV) or '').strip()
    if not raw.isdigit():
        return PEER_WAIT_MAX_SECONDS
    return max(1, min(PEER_WAIT_MAX_SECONDS, int(raw)))


def parallel_read_tools_enabled():
    """`BOXFOX_PARALLEL_READ_TOOLS` (mặc định `off`). Vòng 22 CHỈ KHAI BÁO cờ này.

    Q3 chốt: chạy song song tool ĐỌC trong một bước không nằm trong vòng này (nó là T14, vòng sau).
    Hàm này tồn tại để `runtime_info` nói được trạng thái cờ, và để T14 chỉ việc dùng — mã vòng 22
    KHÔNG đổi hành vi tool trong bước vì nó.
    """
    return switch_enabled(PARALLEL_READ_ENV, False)

# --------------------------------------------------------------------------------------------
# Vòng 22 đợt 3 — cổng bằng chứng sống: công tắc, trần của vòng vá, trần của phép dò box
# --------------------------------------------------------------------------------------------
# Ba chế độ là ba mức CAN THIỆP, không phải ba mức "chặt": `off` không làm gì; `warn` ghim nhãn
# và đếm nhưng KHÔNG gọi model, KHÔNG sửa một chữ nào của câu trả lời; `enforce` cho phép ĐÚNG
# MỘT vòng vá. Giá trị lạ ⇒ rơi về mặc định KÈM notice (xem `evidence_mode` của runtime).
EVIDENCE_GATE_ENV = 'BOXFOX_EVIDENCE_GATE'
EVIDENCE_MODES = ('off', 'warn', 'enforce')
EVIDENCE_DEFAULT_MODE = 'warn'
# Trần của vòng vá. Ba con số này là điều kiện sống còn: vòng vá nằm TRONG `asyncio.timeout`
# của lượt, nên nếu nó tiêu hết thời gian còn lại thì lượt chết vì `DEADLINE` mà không có câu
# trả lời nào — ngược hẳn mục tiêu của cả đợt.
EVIDENCE_REPAIR_MAX_TOKENS = 2048
EVIDENCE_REPAIR_TIMEOUT_SECONDS = 60
EVIDENCE_REPAIR_MIN_REMAINING_SECONDS = 20
# Phép dò box (một lệnh `find`, xem `runtime.probe_workspace`): trần thời gian, trần số tệp, và
# trần số mảnh bằng chứng mang vào câu trả lời.
EVIDENCE_PROBE_TIMEOUT_SECONDS = 20
EVIDENCE_PROBE_MAX_FILES = 200
# P1.5 — dọn thư mục bằng chứng: không phải mỗi lượt (mỗi lượt là một `find`/`scandir` thừa trên
# đường trả lời), nhưng cũng không phải "để cuối phiên" (phiên dài là chỗ thư mục phình).
EVIDENCE_PRUNE_EVERY = 20
EVIDENCE_PRUNE_TIMEOUT_SECONDS = 30
EVIDENCE_PRUNE_CODE = 'EVIDENCE_PRUNE_DEGRADED'
EVIDENCE_MAX_ARTIFACTS = 20
EVIDENCE_EXCERPT_CHARS = 500
# Mã notice của cổng. `X:` chỉ dành cho cổng TỰ hỏng; thiếu bằng chứng là `EVIDENCE_INSUFFICIENT`
# và KHÔNG bao giờ làm lượt hỏng.
EVIDENCE_INSUFFICIENT_CODE = 'EVIDENCE_INSUFFICIENT'
EVIDENCE_GATE_FAILED_CODE = 'EVIDENCE_GATE_FAILED'
# Giá trị lạ của công tắc: rơi về mặc định **kèm notice** — đổi hành vi trong im lặng là
# thứ kế hoạch cấm (và là thứ đã làm vòng 21 tốn thời gian để tìm ra sự thật).
EVIDENCE_MODE_UNKNOWN_CODE = 'EVIDENCE_GATE_MODE_UNKNOWN'
# P1.1 — mã của dòng log nói bộ đếm lượt và transcript lệch nhau.
TURN_INDEX_DRIFT_CODE = 'TURN_INDEX_DRIFT'

ANSWER_WARN_CHARS = 60_000
ANSWER_MAX_CHARS = 150_000
ANSWER_LENGTH_WARN_CODE = 'ANSWER_LENGTH_WARN'
ANSWER_TOO_LONG_CODE = 'ANSWER_TOO_LONG'
# Tên gọi của hai mã trên trong kế hoạch đợt 3 (`ANSWER_LONG` / `ANSWER_TRUNCATED`). Đợt 1 đã
# ship chúng dưới tên `ANSWER_LENGTH_WARN`/`ANSWER_TOO_LONG` và giao diện đang đọc hai mã đó, nên
# ở đây chỉ có BÍ DANH — đổi tên mã đang chạy sẽ làm nhãn cũ mất nghĩa mà không thêm gì.
ANSWER_LONG_CODE = ANSWER_LENGTH_WARN_CODE
ANSWER_TRUNCATED_CODE = ANSWER_TOO_LONG_CODE
# Dòng chỉ dẫn này sống ở ĐÂY, không chép tay vào từng prompt vai: `runtime.start()` là nơi
# duy nhất dựng prompt hệ thống cho mọi vai, nên mọi prompt đều mang câu này.
ANSWER_LENGTH_HINT = (
    f'Keep the final answer under {ANSWER_WARN_CHARS:,} characters. If the content is longer, '
    'write it to a file in the workspace and quote the path instead of pasting it into the answer.'
)
