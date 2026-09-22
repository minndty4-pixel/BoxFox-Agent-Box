"""Thang điểm P1–P8 cho một bản plan: chấm TRƯỚC khi sandbox ghi (vòng 20, §5).

Vì sao chấm ở harness, không ở box
----------------------------------
Bốn lý do, theo đúng §5 của plan vòng 20: (1) box phải giữ vai trò đọc thuần stdlib và là biên
đường dẫn, lại chạy root; (2) chỉ harness đọc được sổ duyệt và các bản anh em cùng nhóm; (3) quyết
định từ chối phải xảy ra **trước** khi sandbox ghi; (4) một bản cài đặt dùng chung cho event,
bảng `plan_evaluations` và route trạng thái.

Hợp đồng
--------
`evaluate_plan(markdown, …)` là **hàm thuần**: chấm 8 chiều, trả một `Evaluation` và **không raise**
(ngoại lệ duy nhất: ghi nhật ký hệ thống khi có cổng cứng không đạt, việc ghi log không bao giờ ném).
Người gọi dùng `evaluation.to_payload(written=…)` để phát event `plan_evaluated` cho **cả hai nhánh**,
rồi gọi `raise_if_rejected(evaluation)` để dừng lượt ghi. Tách hai bước như vậy vì bản bị từ chối vẫn
phải có payload trung thực (`written: false`, `verdict: 'fail'`).

Thang và dải (giống `scripts/eval/rubric.py`): mỗi chiều 0–2, tổng 0–16, `≥13` = `pass`,
`9–12` = `conditional`, `≤8` = `fail`.

Cổng cứng (mức 0 → không ghi gì): P1, P3, P4, P7, P8, cộng P2 **khi bản mới bắt buộc có parent**
(nhóm đã có bản cũ và chưa `approved`). Riêng `P3 = 0` giữ **nguyên** tiền tố và câu thông báo cũ của
`plan_quality.py` (`PLAN_QUALITY_REJECTED: …`) vì đó là luật đã có từ trước và người dùng đã quen;
mọi cổng khác dùng `PLAN_EVAL_REJECTED: (mã-lỗi) <câu khắc phục>`.

Trường `hardGate` trong payload (như `rubric.hard_gate_ok`): **true khi không cổng cứng nào ở mức 0**.
Bản bị chặn vì thế mang `hardGate: false` + `gatesFailed: ['P2','P4','P7']` + `rejected: 'plan-too-long'`,
và giao diện ghép câu từ ba trường đó (payload không chứa câu tiếng Việt nào).

Giám khảo P5
------------
Chỉ P5 được giám khảo chấm, và chỉ khi `BOXFOX_PLAN_JUDGE=1`. Hàm ở đây **không gọi mạng**: người gọi
hỏi model bằng `JUDGE_PROMPT`, đưa câu trả lời thô qua `parse_judge_response()` rồi truyền vào
`judged=`. JSON sai/thiếu/thừa khoá → `None` → P5 quay về proxy tất định và `layer.P5 = 'oracle'`.
Giám khảo không được chạm P1/P2/P3/P4/P6/P7/P8, không đổi cổng cứng, không đổi dải kết luận: tổng
luôn là tổng của 8 mức.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..observability.system_log import system_log
from . import plan_quality
from .plan_header import parse_plan_header
from .plan_registry import PLAN_EVAL_PREFIX, PlanRegistrationError, REMEDIES as _REGISTRY_REMEDIES

__all__ = [
    'RUBRIC', 'DIMENSIONS', 'HARD_GATES', 'VERDICT_PASS_MIN', 'VERDICT_CONDITIONAL_MIN',
    'PLAN_MAX_CHARS', 'PLAN_WARN_CHARS', 'PLAN_EVAL_PREFIX', 'JUDGE_ENV', 'JUDGE_DIMENSION',
    'JUDGE_PROMPT', 'JUDGE_REASON_MAX_CHARS', 'REPETITION_MAX', 'REPETITION_GOOD',
    'REMEDIES', 'Evaluation', 'verdict_for', 'repetition_ratio', 'judge_enabled',
    'parse_judge_response', 'scope_honesty_level', 'evaluate_plan', 'raise_if_rejected',
]

RUBRIC = 'P1-P8/1'
DIMENSIONS = ('P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8')
MAX_TOTAL = 8 * 2

# Cổng cứng: mức 0 của các chiều này thì bản kế hoạch không được ghi. P2 chỉ là cổng khi bản sửa
# bắt buộc phải có parent (xem `_parent_required`).
HARD_GATES = ('P1', 'P3', 'P4', 'P7', 'P8')
CONDITIONAL_HARD_GATES = ('P2',)

VERDICT_PASS_MIN = 13
VERDICT_CONDITIONAL_MIN = 9

# Luật độ dài (ca sống 306 KB): quá trần thì P7 = 0 và bị từ chối kèm số đo; từ 40 000 ký tự chỉ bị
# trừ điểm + một dòng cảnh báo. Hai mốc là hằng số có tên để test được cả hai phía ranh giới.
PLAN_MAX_CHARS = 150_000
PLAN_WARN_CHARS = 40_000

# P7 còn đo độ trùng lặp bằng `repetition_ratio` (bản sao có test chống lệch của hàm trong
# `scripts/eval/rubric.py`): tỉ lệ cửa sổ 60 ký tự bị lặp lại.
REPETITION_MAX = 0.3
REPETITION_GOOD = 0.15

JUDGE_ENV = 'BOXFOX_PLAN_JUDGE'
JUDGE_DIMENSION = 'P5'
JUDGE_REASON_MAX_CHARS = 200
JUDGE_PROMPT = (
    'Bạn chấm DUY NHẤT một chiều của bản kế hoạch: mức độ nói thật về phần CHƯA kiểm được.\n'
    'Trả về đúng một đối tượng JSON, không thêm chữ nào khác, đúng hình dạng:\n'
    '{"scopeHonesty": {"score": 0.0, "reason": "≤200 ký tự"}}\n'
    'score: 1.0 = nêu giới hạn cụ thể kèm cách kiểm; 0.5 = có mục Risks nhưng chung chung; '
    '0.0 = khẳng định đã kiểm mà không có lệnh nào chứng minh.\n'
    'Không chấm cấu trúc, độ dài, số bước hay nguồn — chỉ chiều này.\n'
)

# Mã lỗi của cổng §5. `plan_registry` giữ từ vựng chung (nó là chốt từ chối đầu tiên trên đường
# ghi); ở đây cộng thêm các mã chỉ cổng này mới biết.
REMEDIES = {
    **_REGISTRY_REMEDIES,
    'plan-too-long': (
        'kế hoạch dài {chars} ký tự, quá trần {max_chars} ký tự: tách thành bản tóm tắt + bản chi '
        'tiết rồi gọi lại write_plan.'
    ),
    'plan-repetitive': (
        'kế hoạch lặp khối văn bản ({repetition:.0%} cửa sổ bị lặp, trần {max_repetition:.0%}): bỏ '
        'phần dán lại (thường là bản cũ nằm lẫn trong bản mới) rồi gọi lại write_plan.'
    ),
    'plan-no-steps': (
        'kế hoạch không có bước nào: viết các bước thành danh sách, mỗi bước kèm lệnh cụ thể và kết '
        'quả mong đợi, rồi gọi lại write_plan.'
    ),
    'steps-unanchored': (
        'chỉ {steps_anchored}/{steps} bước có lệnh hoặc kết quả mong đợi (cần ít nhất một nửa): thêm '
        'lệnh/kết quả vào từng bước rồi gọi lại write_plan.'
    ),
    'revision-untraceable': (
        'bản sửa không nhắc gì tới v{parent_version}: thêm một mục "Thay đổi so với v{parent_version}" '
        'nói rõ sửa những gì so với bản trước, rồi gọi lại write_plan.'
    ),
    'identity-unhygienic': (
        'bản này không khớp nhóm hoặc trùng số version ({detail}): đọc lại chỉ mục plan và gọi lại '
        'write_plan cho đúng nhóm/bản kế tiếp.'
    ),
}

# ---------------------------------------------------------------- từ vựng đo lường

# Bước = mục danh sách trong thân bài. Ưu tiên mục nằm trong một mục có tiêu đề kiểu "bước/kế
# hoạch/milestone"; không có mục như vậy thì lấy mọi mục danh sách của thân bài.
# Từ khoá tiêu đề của mục chứa bước. Có cả tiếng Việt vì plan của người dùng viết tiếng Việt:
# "## Thực hiện" và "## Các bước" là hai tiêu đề gặp nhiều nhất trong repo này.
_STEP_SECTION_KEYS = ('step', 'milestone', 'plan', 'task', 'cách làm', 'bước', 'kế hoạch', 'việc',
                      'checklist', 'procedure', 'thực hiện', 'triển khai', 'phase', 'giai đoạn',
                      'hạng mục', 'tiến trình')
_LIST_ITEM_RE = re.compile(r'^\s{0,4}(?:\d{1,3}[.)]|[-*+]|-\s?\[[ xX]\])\s+\S')
_MAX_STEP_LINES = 400

# Câu khẳng định "đã kiểm" mà không kèm lệnh nào là dấu hiệu nói quá (P5 mức 0).
_VERIFIED_CLAIM_RE = re.compile(
    r'\b(?:verified|confirmed|checked|tested|ran\s+the|reproduced)\b|\bđã\s+(?:kiểm|chạy|xác minh|thử)\b',
    re.IGNORECASE)
_LIMIT_MARKERS = ('unverified', 'không kiểm', 'chưa kiểm', 'không xác minh', 'chưa xác minh',
                  'không thể', 'chưa chạy', 'chưa thử', 'cannot', 'not verified', 'not tested',
                  'chưa có bằng chứng', 'giới hạn', 'limitation', 'hạn chế', 'open question',
                  'câu hỏi mở')
_RISK_SPECIFIC_CHARS = 240

# Nguồn cho một external fact: URL, dấu UNVERIFIED, hay một dấu dẫn nguồn ngay cạnh (±2 dòng).
# Từ khoá phải khớp CẢ TỪ, nếu không "xem official docs" hay "theo cách này" tự nhận mình có nguồn.
_SOURCE_RE = re.compile(r'\b(?:nguồn|source[sd]?|references?|refs?|citations?|cited|quotes?|quoted|'
                        r'documentation|tài\s+liệu|trích\s+dẫn|spec(?:ification)?|changelog)\b',
                        re.IGNORECASE)
_SOURCE_WINDOW = 2

_EVIDENCE_MAX = 6
_EVIDENCE_CHARS = 160

# P3 mức 1 vs 2: mọi mục bắt buộc đang có phải có thân ≥ 120 ký tự và cả tài liệu ≥ 1 200 ký tự.
_THICK_SECTION_CHARS = 120
_THICK_DOC_CHARS = 1200


def verdict_for(total: int) -> str:
    """`≥13` = `pass`, `9–12` = `conditional`, `≤8` = `fail` — đúng dải của `scripts/eval/rubric.py`."""
    if total >= VERDICT_PASS_MIN:
        return 'pass'
    if total >= VERDICT_CONDITIONAL_MIN:
        return 'conditional'
    return 'fail'


def repetition_ratio(text: str, window: int = 60, stride: int = 1) -> float:
    """Bản sao NGUYÊN VĂN của `scripts/eval/rubric.py::repetition_ratio` (dòng 183–205).

    Tỉ lệ cửa sổ `window` ký tự đã từng xuất hiện trước đó. Đây là proxy có tài liệu cho "không lặp
    khối văn bản", không phải cách diễn đạt của plan; `backend/tests/unit/test_plan_eval.py` nạp
    file script bằng đường dẫn và so hai bản cài đặt trên cùng các đoạn văn, nên chúng không thể
    lệch nhau trong im lặng.
    """
    if not text or len(text) < window * 2:
        return 0.0
    seen: set[str] = set()
    duplicates = 0
    total = 0
    for offset in range(0, len(text) - window + 1, stride):
        chunk = text[offset:offset + window]
        total += 1
        if chunk in seen:
            duplicates += 1
        else:
            seen.add(chunk)
    return duplicates / total if total else 0.0


def judge_enabled(environ=None) -> bool:
    """`BOXFOX_PLAN_JUDGE=1` bật chấm P5 bằng giám khảo; mọi giá trị khác (kể cả vắng) là tắt."""
    source = environ if environ is not None else os.environ
    try:
        return str(source.get(JUDGE_ENV) or '').strip() == '1'
    except Exception:
        return False


def parse_judge_response(raw):
    """Câu trả lời thô của giám khảo → `{'score', 'reason'}` hoặc `None`.

    Hợp đồng nghiêm ngặt: đúng một khoá `scopeHonesty`, `score` là số 0.0–1.0 (không nhận `bool`),
    `reason` là chuỗi. Thừa khoá, sai kiểu, JSON hỏng, hết giờ → `None` — và `None` nghĩa là P5 quay
    về proxy tất định, không phải "P5 không được chấm".
    """
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith('```'):
            text = re.sub(r'^```[a-zA-Z]*\s*|\s*```$', '', text).strip()
        try:
            raw = json.loads(text)
        except ValueError:
            return None
    if not isinstance(raw, dict) or set(raw) != {'scopeHonesty'}:
        return None
    inner = raw['scopeHonesty']
    if not isinstance(inner, dict) or set(inner) != {'score', 'reason'}:
        return None
    score = inner['score']
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0.0 <= float(score) <= 1.0:
        return None
    reason = inner['reason']
    if not isinstance(reason, str):
        return None
    return {'score': float(score), 'reason': reason.strip()[:JUDGE_REASON_MAX_CHARS]}


def scope_honesty_level(score: float) -> int:
    """Điểm 0.0–1.0 của giám khảo → mức 0/1/2, chỉ dùng cho P5."""
    if score >= 2 / 3:
        return 2
    if score >= 1 / 3:
        return 1
    return 0


# ---------------------------------------------------------------- đo lường thuần


def _body(markdown: str) -> str:
    """Markdown sau khi bỏ khối header (khối đó là siêu dữ liệu, không phải nội dung plan)."""
    text = str(markdown or '')
    header = parse_plan_header(text)
    if header is None or header.status == 'missing' or header.body_offset <= 0:
        return text
    return '\n'.join(text.splitlines()[header.body_offset:])


def _list_items(text: str):
    """Mọi dòng là mục danh sách trong `text`, theo thứ tự."""
    steps = []
    for line in str(text or '').splitlines():
        if _LIST_ITEM_RE.match(line):
            steps.append(line.strip())
            if len(steps) >= _MAX_STEP_LINES:
                break
    return steps


def _is_required_heading(heading: str) -> bool:
    """Tiêu đề có phải một trong các mục bắt buộc của `plan_quality.py` (nghiệm thu / rủi ro / nguồn)."""
    return any(key in heading for spec in plan_quality.REQUIRED_SECTIONS
               for key in spec['heading_keys'])


def _step_lines(body: str):
    """Các dòng được coi là "bước": mục danh sách, ưu tiên trong mục có tiêu đề kiểu bước.

    Mục khớp từ khoá mà **rỗng** thì bỏ qua (tiêu đề tài liệu `# Workspace plan` cũng chứa chữ
    "plan"), và khi không mục nào có mục danh sách thì lấy mọi mục danh sách còn lại của thân bài —
    thà đo rộng còn hơn tuyên bố "không có bước nào" cho một kế hoạch có bước. Thân của các mục bắt
    buộc khác (nghiệm thu / rủi ro / nguồn) bị loại khỏi bản dự phòng: gạch đầu dòng trong "Rủi ro"
    là một rủi ro, không phải một bước, nên đừng vì nó mà báo `steps-unanchored`.
    """
    text = str(body or '')
    fallback = text
    for heading, section_body in plan_quality.sections(text):
        if any(key in heading for key in _STEP_SECTION_KEYS):
            steps = _list_items(section_body)
            if steps:
                return steps
            continue
        if section_body and _is_required_heading(heading):
            fallback = fallback.replace(section_body, '', 1)
    return _list_items(fallback)


def _anchored(step: str) -> bool:
    """Một bước "có neo" khi nó mang lệnh cụ thể hoặc kết quả mong đợi (dùng lại luật của P4/P3)."""
    return bool(plan_quality.has_concrete_check(step) or plan_quality.has_expected_result(step))


def _external_fact_lines(body: str):
    """`[(chỉ số dòng, dòng, có nguồn trong ±2 dòng)]` cho mọi dòng mang external fact."""
    lines = body.splitlines()
    result = []
    for index, line in enumerate(lines):
        if not line.strip() or not plan_quality.claims_external_facts(line):
            continue
        window = lines[max(0, index - _SOURCE_WINDOW):index + _SOURCE_WINDOW + 1]
        sourced = any(_line_has_source(item) for item in window)
        result.append((index, line.strip(), sourced))
    return result


def _line_has_source(line: str) -> bool:
    text = str(line or '')
    lowered = text.lower()
    if 'http://' in lowered or 'https://' in lowered or 'unverified' in lowered:
        return True
    return bool(_SOURCE_RE.search(text))


def _section_body(markdown: str, keys):
    """Thân của mục đầu tiên có tiêu đề chứa một trong `keys` (cùng luật với `plan_quality._find`)."""
    for heading, body in plan_quality.sections(markdown):
        if any(key in heading for key in keys):
            return body
    return None


def _parent_version_mention(body: str, parent: int) -> tuple[bool, bool]:
    """`(có nhắc v{parent}, có mục "thay đổi so với v{parent}")` — đo của P2."""
    token = re.compile(rf'\bv{parent}\b', re.IGNORECASE)
    mentioned = bool(token.search(body))
    change_keys = ('change', 'thay đổi', 'khác', 'diff', 'so với', 'delta', 'changelog', 'sửa gì')
    for heading, section_body in plan_quality.sections(body):
        if token.search(heading) and any(key in heading for key in change_keys):
            return mentioned, True
        if any(key in heading for key in change_keys) and token.search(
                '\n'.join(section_body.splitlines()[:20])):
            return mentioned, True
    return mentioned, False


def _note_keywords(note: str):
    """Từ khoá (≥ 4 ký tự) trong ghi chú người duyệt, để đo bản sửa có nhắc lại yêu cầu không."""
    tokens = []
    for token in re.split(r'[^0-9A-Za-zÀ-ỹ]+', str(note or '').lower()):
        if len(token) >= 4 and token not in tokens:
            tokens.append(token)
    return tokens


def _excerpt(line: str) -> str:
    text = ' '.join(str(line or '').split())
    return text[:_EVIDENCE_CHARS]


# ---------------------------------------------------------------- kết quả


@dataclass(frozen=True)
class Evaluation:
    """Kết quả chấm một bản plan. `levels` là 8 mức 0–2; tổng và kết luận suy ra từ đó."""

    identity: str = ''
    version: int | None = None
    parent_version: int | None = None
    levels: dict = field(default_factory=dict)
    layer: dict = field(default_factory=dict)
    measures: dict = field(default_factory=dict)
    evidence: tuple = ()
    judge: dict | None = None
    # Mã của cổng cứng đầu tiên không đạt (theo thứ tự P1→P8), kèm trường để dựng câu khắc phục.
    rejected: str | None = None
    rejected_dimension: str | None = None
    rejected_fields: dict = field(default_factory=dict)
    quality_issues: tuple = ()
    warnings: tuple = ()

    @property
    def total(self) -> int:
        return sum(self.levels.get(code, 0) for code in DIMENSIONS)

    @property
    def max_total(self) -> int:
        return MAX_TOTAL

    @property
    def gates_failed(self) -> tuple:
        """Các cổng cứng đang ở mức 0 — P2 chỉ tính khi bản sửa bắt buộc có parent."""
        active = HARD_GATES + tuple(gate for gate in CONDITIONAL_HARD_GATES
                                    if self.measures.get('parentRequired'))
        return tuple(code for code in active if self.levels.get(code, 0) == 0)

    @property
    def hard_gate(self) -> bool:
        return not self.gates_failed

    @property
    def verdict(self) -> str:
        return verdict_for(self.total)

    def message(self) -> str | None:
        """Câu từ chối (một dòng) khi một cổng cứng đã chặn, ngược lại `None`.

        `P3 = 0` giữ nguyên câu của `plan_quality.py`: đó là luật cũ, người dùng đã quen câu đó.
        """
        if self.rejected is None:
            return None
        if self.rejected == 'QUALITY':
            return plan_quality.plan_quality_message(list(self.quality_issues))
        remedy = REMEDIES.get(self.rejected, '')
        try:
            filled = remedy.format(**self.rejected_fields)
        except (KeyError, IndexError, ValueError, TypeError):
            filled = remedy
        return f'{PLAN_EVAL_PREFIX}: ({self.rejected}) {filled}'

    def to_payload(self, written: bool) -> dict:
        """Payload của event `plan_evaluated` (phát cả khi bị từ chối): không có chuỗi tiếng Việt.

        Bản bị cổng cứng chặn luôn mang `verdict: "fail"`: tổng điểm có thể vẫn ở dải "đạt có điều
        kiện", nhưng kết quả của lần ghi này là không ghi được gì, nên kết luận phải nói đúng điều đó.
        """
        return {
            'identity': self.identity,
            'version': self.version,
            'parentVersion': self.parent_version,
            'written': bool(written),
            'rubric': RUBRIC,
            'levels': {code: self.levels.get(code, 0) for code in DIMENSIONS},
            'layer': {code: self.layer[code] for code in sorted(self.layer)},
            'total': self.total,
            'maxTotal': self.max_total,
            'hardGate': self.hard_gate,
            'gatesFailed': list(self.gates_failed),
            'verdict': 'fail' if self.rejected else self.verdict,
            'rejected': self.rejected,
            'measures': dict(self.measures),
            'evidence': [{'code': code, 'excerpt': excerpt} for code, excerpt in self.evidence],
            'judge': None if self.judge is None else dict(self.judge),
            'warnings': list(self.warnings),
            'evaluatedAt': _now_iso(),
        }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _parent_required(parent_version, state) -> bool:
    """P2 là cổng cứng khi nhóm đã có bản cũ và nhóm **chưa** được duyệt (§5)."""
    return bool(parent_version) and state != 'approved'


# ---------------------------------------------------------------- chấm từng chiều


def _score_p1(header_source: str) -> int:
    """Lệch → 0; harness tự chèn → 1; model tự viết và khớp → 2 (§5)."""
    if header_source == 'mismatch':
        return 0
    return 2 if header_source == 'model' else 1


def evaluate_plan(markdown, *, identity='', version=None, parent_version=None, state='draft',
                  header=None, header_source=None, header_mismatch=None, matched_by='none',
                  forced_new=False, review_note='', ignored_change_request=False,
                  duplicate_version=False, judged=None) -> Evaluation:
    """Chấm P1–P8 cho `markdown`, theo đúng 8 chiều của §5. Thuần, không raise, không gọi mạng.

    Tham số quyết định mức của từng chiều:

    * `header` — `PlanHeader` của chính markdown model viết (`None` = không có khối); `header_source`
      ghi đè kết luận (`'model'`/`'synthesized'`/`'mismatch'`) khi người gọi đã tự so; `header_mismatch`
      là mô tả ngắn (đã khai gì / harness sẽ ghi gì) cho câu từ chối `(header-mismatch)`.
    * `state` — trạng thái nhóm trước lần ghi này (`plan_registry.group_state`), dùng cho cổng P2.
    * `matched_by`/`forced_new` — kết quả `plan_registry.resolve_identity` (P8).
    * `review_note` — ghi chú mới nhất khi nhóm bị `changes_requested`; chỉ dùng để đo
      `noteKeywords`/`noteKeywordsEchoed`, **không** đổi mức nào.
    * `judged` — câu trả lời đã qua `parse_judge_response` của giám khảo (P5).
    """
    text = str(markdown or '')
    body = _body(text)
    chars = len(text)
    levels: dict = {}
    layer: dict = {code: 'oracle' for code in DIMENSIONS}
    evidence = []
    warnings = []

    def note(code, excerpt):
        if len(evidence) < _EVIDENCE_MAX:
            evidence.append((code, _excerpt(excerpt)))

    # ---- P1 versionHeader: khối header khớp tên file / giá trị harness sẽ ghi.
    parsed = header if header is not None else parse_plan_header(text)
    declared = None
    if header_source is None:
        status = getattr(parsed, 'status', 'missing')
        if status == 'missing' or parsed is None:
            header_source = 'synthesized'
        else:
            same_version = getattr(parsed, 'version', None) == version
            same_identity = not identity or getattr(parsed, 'identity', '') == identity
            same_parent = getattr(parsed, 'parent', None) == parent_version
            if status == 'ok' and same_version and same_identity and same_parent:
                header_source = 'model'
            else:
                header_source = 'mismatch'
                if header_mismatch is None:
                    heard = []
                    if getattr(parsed, 'version', None) is not None:
                        heard.append(f'Version: v{getattr(parsed, "version")}')
                    if getattr(parsed, 'identity', ''):
                        heard.append(f'Identity: {getattr(parsed, "identity")}')
                    if getattr(parsed, 'parent', None) is not None or status == 'ok':
                        heard.append('Parent: ' + (f'v{getattr(parsed, "parent")}'
                                                   if getattr(parsed, 'parent', None) else 'none'))
                    declared = ', '.join(heard) or 'khối boxfox-plan sai cú pháp'
                    parent_hint = f' với Parent: v{parent_version}' if parent_version else ''
                    header_mismatch = f'{declared} (harness sẽ ghi v{version}{parent_hint})'
    if header_source == 'mismatch':
        levels['P1'] = 0
        note('P1', header_mismatch or 'khối boxfox-plan không khớp')
    else:
        levels['P1'] = _score_p1(header_source)

    # ---- P2 parentChain: bản sửa truy được về bản trước.
    parent_required = _parent_required(parent_version, state)
    if not parent_version:
        levels['P2'] = 2
    else:
        mentioned, has_change_section = _parent_version_mention(body, int(parent_version))
        levels['P2'] = 2 if has_change_section else (1 if mentioned else 0)
        if levels['P2'] < 2:
            note('P2', next((line for line in body.splitlines()
                             if re.search(rf'\bv{int(parent_version)}\b', line, re.IGNORECASE)),
                            f'không có dòng nào nhắc v{int(parent_version)}'))

    # ---- P3 structure: luật cũ của `plan_quality.py` + độ dày của các mục.
    issues = list(plan_quality.plan_quality_issues(text))
    if issues:
        levels['P3'] = 0
        note('P3', f'{", ".join(f"({issue})" for issue in issues)}')
    else:
        # "Dày" = mọi mục BẮT BUỘC đang có đều có thân ≥ `_THICK_SECTION_CHARS` và cả tài liệu đủ
        # dài (`chars`). Chỉ xét các mục đang tồn tại: mục "Sources" không bắt buộc khi plan không
        # viện dẫn dữ kiện bên ngoài, nên vắng nó không phải là mỏng.
        present = [len(body_text) for body_text in
                   (_section_body(text, spec['heading_keys']) for spec in plan_quality.REQUIRED_SECTIONS)
                   if body_text is not None]
        thick = bool(present) and min(present) >= _THICK_SECTION_CHARS and chars >= _THICK_DOC_CHARS
        levels['P3'] = 2 if thick else 1

    # ---- P4 executability: tỉ lệ bước có lệnh/kết quả mong đợi.
    steps = _step_lines(body)
    anchored = [step for step in steps if _anchored(step)]
    levels['P4'] = 2 if steps and len(anchored) >= 0.9 * len(steps) else (
        1 if steps and len(anchored) >= 0.5 * len(steps) else 0)
    if levels['P4'] < 2:
        step = next((item for item in steps if item not in anchored), None)
        note('P4', step or 'không có bước nào trong thân bài')

    # ---- P5 scopeHonesty: giám khảo khi có, proxy tất định khi không.
    if judged:
        levels['P5'] = scope_honesty_level(judged['score'])
        layer['P5'] = 'judge'
    else:
        levels['P5'] = _proxy_scope_honesty(text, body)
        layer['P5'] = 'oracle'

    # ---- P6 evidence: mỗi dòng mang external fact có nguồn trong ±2 dòng.
    facts = _external_fact_lines(body)
    sourced = [item for item in facts if item[2]]
    if not facts:
        levels['P6'] = 2
    elif len(sourced) == len(facts):
        levels['P6'] = 2
    elif len(sourced) >= len(facts) / 2:
        levels['P6'] = 1
    else:
        levels['P6'] = 0
    if levels['P6'] < 2:
        missing = next((item for item in facts if not item[2]), None)
        note('P6', None if missing is None else missing[1])

    # ---- P7 signal: độ dài + trùng lặp.
    ratio = repetition_ratio(body or text)
    if chars > PLAN_MAX_CHARS or ratio >= REPETITION_MAX:
        levels['P7'] = 0
    elif chars <= PLAN_WARN_CHARS and ratio < REPETITION_GOOD:
        levels['P7'] = 2
    else:
        levels['P7'] = 1
    if PLAN_WARN_CHARS < chars <= PLAN_MAX_CHARS:
        warnings.append(f'PLAN_EVAL_LONG: {chars} ký tự, quá mốc cảnh báo {PLAN_WARN_CHARS} ký tự.')

    # ---- P8 identityHygiene: identity khớp nhóm, chuỗi version liền mạch.
    if ignored_change_request or duplicate_version:
        levels['P8'] = 0
    elif matched_by == 'similarity' or forced_new:
        levels['P8'] = 1
    else:
        levels['P8'] = 2

    measures = {
        'chars': chars,
        'repetition': round(ratio, 4),
        'steps': len(steps),
        'stepsAnchored': len(anchored),
        'externalFacts': len(facts),
        'externalFactsSourced': len(sourced),
        'parentRequired': parent_required,
        'headerSource': header_source,
    }
    note_words = _note_keywords(review_note)
    lowered = text.lower()
    measures['noteKeywords'] = len(note_words)
    measures['noteKeywordsEchoed'] = sum(1 for word in note_words if word in lowered)

    evaluation = Evaluation(identity=identity, version=version, parent_version=parent_version,
                            levels=levels, layer=layer, measures=measures, evidence=tuple(evidence),
                            judge=judged, quality_issues=tuple(issues), warnings=tuple(warnings))

    # Cổng cứng: chiều nào ở mức 0 thì đây là lý do (theo thứ tự P1→P8, không đoán).
    for dimension in ('P1', 'P2', 'P3', 'P4', 'P7', 'P8'):
        if dimension == 'P2' and not parent_required:
            continue
        if levels[dimension] != 0:
            continue
        if dimension == 'P3':
            evaluation = _with_rejection(evaluation, 'QUALITY', dimension, {})
        elif dimension == 'P1':
            evaluation = _with_rejection(evaluation, 'header-mismatch', dimension,
                                        {'identity': identity, 'declared': declared or 'khối sai cú pháp',
                                         'version': version, 'parent_hint': ''})
        elif dimension == 'P2':
            evaluation = _with_rejection(evaluation, 'revision-untraceable', dimension,
                                        {'parent_version': parent_version})
        elif dimension == 'P4':
            if not steps:
                evaluation = _with_rejection(evaluation, 'plan-no-steps', dimension, {})
            else:
                evaluation = _with_rejection(evaluation, 'steps-unanchored', dimension,
                                            {'steps': len(steps), 'steps_anchored': len(anchored)})
        elif dimension == 'P7':
            if chars > PLAN_MAX_CHARS:
                evaluation = _with_rejection(evaluation, 'plan-too-long', dimension,
                                            {'chars': chars, 'max_chars': PLAN_MAX_CHARS})
            else:
                evaluation = _with_rejection(evaluation, 'plan-repetitive', dimension,
                                            {'repetition': ratio, 'max_repetition': REPETITION_MAX})
        elif dimension == 'P8':
            detail = ('trùng số version' if duplicate_version else 'lờ yêu cầu sửa')
            evaluation = _with_rejection(evaluation, 'identity-unhygienic', dimension, {'detail': detail})
        break
    if evaluation.rejected is None:
        return evaluation

    _log_rejection(evaluation)
    return evaluation


def _with_rejection(evaluation: Evaluation, code: str, dimension: str, fields: dict) -> Evaluation:
    return Evaluation(identity=evaluation.identity, version=evaluation.version,
                      parent_version=evaluation.parent_version, levels=evaluation.levels,
                      layer=evaluation.layer, measures=evaluation.measures,
                      evidence=evaluation.evidence, judge=evaluation.judge, rejected=code,
                      rejected_dimension=dimension, rejected_fields=fields,
                      quality_issues=evaluation.quality_issues, warnings=evaluation.warnings)


def _proxy_scope_honesty(text: str, body: str) -> int:
    """Proxy tất định cho P5 khi giám khảo tắt (§5: "khẳng định đã kiểm" → Risks chung chung → cụ thể)."""
    risk_body = _section_body(text, ('risk', 'limitation', 'caveat', 'open question', 'unknown',
                                     'assumption', 'trade-off', 'tradeoff', 'rủi ro', 'giới hạn',
                                     'hạn chế', 'câu hỏi mở'))
    claims = bool(_VERIFIED_CLAIM_RE.search(body))
    if claims and not plan_quality.has_concrete_check(body):
        return 0
    if risk_body is None or not risk_body.strip():
        return 0
    lowered = risk_body.lower()
    specific = (plan_quality.has_concrete_check(risk_body)
                or any(marker in lowered for marker in _LIMIT_MARKERS)
                or len(risk_body) >= _RISK_SPECIFIC_CHARS)
    return 2 if specific else 1


def _log_rejection(evaluation: Evaluation) -> None:
    """Một dòng nhật ký hệ thống cho mỗi lần cổng cứng từ chối — việc ghi log không bao giờ ném."""
    try:
        code = 'PLAN_QUALITY_REJECTED' if evaluation.rejected == 'QUALITY' else PLAN_EVAL_PREFIX
        system_log.write('plan.eval.rejected', level='warn', code=code,
                         message=evaluation.message() or code,
                         identity=evaluation.identity, version=evaluation.version,
                         dimension=evaluation.rejected_dimension, gate=evaluation.rejected,
                         total=evaluation.total, levels=evaluation.levels,
                         measures=evaluation.measures)
    except Exception:
        pass


def raise_if_rejected(evaluation: Evaluation) -> None:
    """Raise đúng câu của cổng đã chặn; không có gì thì không làm gì.

    `P3 = 0` ném `ValueError('PLAN_QUALITY_REJECTED: …')` — nguyên văn luật cũ. Mọi cổng khác ném
    `PlanRegistrationError` (một `ValueError`) với mã máy đọc được, để lượt ghi dừng **trước** khi
    sandbox chạm đĩa.
    """
    message = evaluation.message()
    if message is None:
        return
    if evaluation.rejected == 'QUALITY':
        raise ValueError(message)
    # `message=message`: câu khắc phục của P1–P8 nằm ở `REMEDIES` của module NÀY, không ở
    # `plan_registry`. Không truyền thì `PlanRegistrationError` dựng lại câu bằng bảng của nó và
    # thay câu cụ thể bằng câu chung — đúng lỗi bắt được ở lượt chạy sống 2026-09-21.
    raise PlanRegistrationError(evaluation.rejected, message=message, **evaluation.rejected_fields)
