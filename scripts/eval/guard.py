"""The spend gate: nothing in `scripts/eval/` may call a model without it.

Every entry point that could spend money asks this module first. The rule is
two-factor on purpose:

* `BOXFOX_EVAL_ALLOW_SPEND=1` — an explicit opt-in in the environment;
* a stated budget — `--budget-usd N` or `BOXFOX_EVAL_BUDGET_USD=N`, in USD.

This module has no side effect of any kind: no network, no subprocess, no file
write. It only reads `os.environ` and returns a verdict.
"""
from __future__ import annotations

import os

SPEND_ENV = 'BOXFOX_EVAL_ALLOW_SPEND'
BUDGET_ENV = 'BOXFOX_EVAL_BUDGET_USD'
SPEND_VALUE = '1'

# Where the credentials for a real run would come from. Printed in the refusal
# message; the values themselves are never read here.
KEY_HINTS = (
    ('BOXFOX_ROUTER_BASE_URL', 'base URL của router BoxFox (mặc định http://127.0.0.1:3101)'),
    ('BOXFOX_ROUTER_KEY', 'khoá router dạng bf_… để gọi /v1/chat/completions'),
    ('BOXFOX_HARNESS_BASE_URL', 'base URL của harness (mặc định http://127.0.0.1:3102)'),
    ('BOXFOX_HARNESS_ADMIN_TOKEN', 'token admin của harness nếu bản chạy có bật'),
)


def budget_usd(args_budget: float | None, env: dict | None = None) -> float | None:
    """The stated budget, from the flag first and the environment second."""
    if args_budget is not None:
        return float(args_budget)
    raw = (env or os.environ).get(BUDGET_ENV)
    if raw is None or str(raw).strip() == '':
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def check(args_budget: float | None, env: dict | None = None) -> dict:
    """Returns `{'allowed': bool, 'reason': str, 'budgetUsd': float|None, ...}`.

    `reason` is written for the operator: it says exactly which of the two
    factors is missing and how to provide it.
    """
    env = env if env is not None else os.environ
    opt_in = str(env.get(SPEND_ENV, '')).strip() == SPEND_VALUE
    stated = budget_usd(args_budget, env)
    problems: list[str] = []
    if not opt_in:
        problems.append(f'thiếu opt-in rõ ràng: đặt {SPEND_ENV}=1 (hiện là '
                        f'{env.get(SPEND_ENV)!r})')
    if stated is None:
        problems.append(f'chưa nêu ngân sách: dùng --budget-usd N hoặc đặt {BUDGET_ENV}=N (USD)')
    elif stated <= 0:
        problems.append(f'ngân sách phải > 0 USD (nhận được {stated})')
    return {
        'allowed': not problems,
        'reason': '; '.join(problems),
        'budgetUsd': stated,
        'optIn': opt_in,
        'envVar': SPEND_ENV,
        'budgetEnvVar': BUDGET_ENV,
        'keyHints': KEY_HINTS,
    }


def missing_connection(env: dict | None = None) -> list[dict]:
    """Which connection settings a real run would still need (names only).

    Kept separate from `check` so a dry run can report it without ever reading a
    secret value.
    """
    env = env if env is not None else os.environ
    missing = []
    for name, why in KEY_HINTS:
        if name.endswith('BASE_URL'):
            continue  # có mặc định loopback, không bắt buộc
        if not str(env.get(name, '')).strip():
            missing.append({'name': name, 'why': why})
    return missing


def rendered_refusal(check_result: dict, missing: list[dict]) -> str:
    """The refusal text, action-first, in Vietnamese like the rest of the repo."""
    lines = ['', '=' * 72,
             'DỪNG: đường --execute có thể TIÊU TIỀN (gọi model thật).',
             '=' * 72]
    lines.append('Lý do chưa cho chạy: ' + (check_result['reason'] or 'không rõ'))
    lines.append('')
    lines.append('Cách mở đúng (cả hai điều kiện, cố ý tách đôi):')
    lines.append(f'  1. {check_result["envVar"]}=1        # xác nhận bạn đồng ý chi tiền')
    lines.append(f'  2. --budget-usd 10  hoặc  {check_result["budgetEnvVar"]}=10   # ngân sách USD')
    lines.append('Ví dụ không chạy gì cả (an toàn, xem trước):')
    lines.append('  python scripts/eval/run_eval.py --dry-run --plan-tier 0')
    lines.append('')
    lines.append('Nếu đã qua cổng chi tiền, lệnh thật còn cần các kết nối sau — ')
    lines.append('đặt biến môi trường, KHÔNG dán giá trị bí mật vào chat:')
    if missing:
        for item in missing:
            lines.append(f'  - {item["name"]}: {item["why"]}')
    else:
        lines.append('  - (đã có đủ theo danh sách kiểm của script này)')
    lines.append('')
    lines.append('Trước khi tiêu tiền lần đầu, chạy lại --dry-run để đọc số lượt gọi model và')
    lines.append('khoảng chi phí ước lượng lấy từ kế hoạch.')
    return '\n'.join(lines)
