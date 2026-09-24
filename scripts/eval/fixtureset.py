"""Load and validate the static fixtures of both tracks.

Two families live in `fixtures/`, told apart by the first letter of the id:

* **Q** — the 12 quality fixtures of the quality plan §4 (`Q1` … `Q12`), scored by
  `rubric` C1–C8 and (later) the layer-2 judge;
* **R** — the research fixtures of `docs/plan/v27/subplans/flow.md` §7.1 and
  `docs/plan/v27/research-rework.md` §5 (`R1` … `R12`), scored by the machine oracles in
  `research_checks.py` with no model and no money at all.

The fixtures are JSON on purpose: `json` is stdlib, so a fresh checkout can load
them without installing anything, and a diff stays readable. One file per case,
named after the plan's id.

`load_fixtures()` (no arguments) stays **Q-only**: that set is what the quality plan
counts, and `test_twelve_fixtures_load_and_match_the_plan_ids` pins it. The R family has
its own loader (`load_research_fixtures`) and its own network rule, because flow §7.1 puts
`R2` online while §4 of the quality plan allows only `Q6`.
"""
from __future__ import annotations

import json
from pathlib import Path

import rubric

FIXTURE_DIR = Path(__file__).resolve().parent / 'fixtures'
NETWORK_VALUES = ('off', 'on')
#: Hai họ fixture, phân biệt bằng chữ đầu của id. Thứ tự này là thứ tự in/nạp.
FIXTURE_FAMILIES = ('Q', 'R')
QUALITY_FAMILY = 'Q'
RESEARCH_FAMILY = 'R'
# §4: "Fixture không dùng mạng ngoài trừ Q6" — the one fixture allowed to be online.
ONLINE_ALLOWED = ('Q6',)
# flow §7.1: R2 ("khảo sát một chủ đề, 3 nhánh") là ca duy nhất của họ R cần mạng.
RESEARCH_ONLINE_ALLOWED = ('R2',)


def family_of(code: str) -> str:
    """Họ của một fixture theo chữ đầu của id (`Q`/`R`); id lạ ⇒ `''` (không đoán hộ)."""
    return str(code or '')[:1].upper() if str(code or '')[:1].upper() in FIXTURE_FAMILIES else ''


def online_allowed(family: str) -> tuple:
    """Ca được bật mạng của một họ — luật mạng khác nhau nên không dùng chung một danh sách."""
    return RESEARCH_ONLINE_ALLOWED if family == RESEARCH_FAMILY else ONLINE_ALLOWED


def _order_key(path: Path) -> tuple:
    """Thứ tự nạp: theo họ (`Q` trước `R`), rồi theo số trong id.

    Bản cũ đọc `int(path.stem[1:])` trên mọi tệp khớp `Q*.json`; nay phải chịu được cả hai họ,
    nên tên tệp không phải `<chữ><số>` bị đẩy xuống cuối thay vì làm cả bộ fixture ném `ValueError`.
    """
    stem = path.stem
    number = stem[1:]
    return (stem[:1].upper(), int(number) if number.isdigit() else 0, stem)


def fixture_paths(directory: Path | None = None, *, family: str | None = QUALITY_FAMILY) -> list[Path]:
    """Tệp fixture trong một thư mục, xếp theo (họ, số).

    `family=None` ⇒ **cả hai** họ; mặc định `'Q'` để mọi người gọi cũ giữ nguyên hành vi.
    """
    directory = Path(directory or FIXTURE_DIR)
    families = FIXTURE_FAMILIES if family is None else (family,)
    paths: list[Path] = []
    for prefix in families:
        paths.extend(directory.glob(f'{prefix}*.json'))
    return sorted(paths, key=_order_key)


def issues_for(fixture: dict, *, stem: str | None = None) -> list[str]:
    """Everything wrong with one fixture, as a list of actionable strings."""
    issues: list[str] = []
    for key in ('id', 'case', 'request', 'request_source', 'oracle_pass', 'bad_answer',
                'rubric_dimensions', 'environment', 'budget'):
        if not fixture.get(key):
            issues.append(f'thiếu trường {key}')
    if stem and fixture.get('id') != stem:
        issues.append(f"id trong tệp ({fixture.get('id')}) khác tên tệp ({stem})")
    if not str(fixture.get('request', '')).strip():
        issues.append('request rỗng — fixture không có gì để chạy')
    for key in ('oracle_pass', 'bad_answer'):
        value = fixture.get(key)
        if not isinstance(value, list) or not all(str(item).strip() for item in value or []):
            issues.append(f'{key} phải là danh sách câu không rỗng')
    dims = fixture.get('rubric_dimensions') or []
    unknown = [code for code in dims if code not in rubric.DIMENSION_BY_CODE]
    if unknown:
        issues.append('chiều rubric không có trong C1-C8: ' + ', '.join(sorted(unknown)))
    environment = fixture.get('environment') or {}
    if environment.get('network') not in NETWORK_VALUES:
        issues.append(f"environment.network phải là {NETWORK_VALUES}")
    budget = fixture.get('budget') or {}
    for key in ('max_steps', 'deadline_seconds'):
        if not isinstance(budget.get(key), int) or budget.get(key, 0) <= 0:
            issues.append(f'budget.{key} phải là số nguyên > 0')
    return issues


def load_fixture(path: str | Path) -> dict:
    path = Path(path)
    fixture = json.loads(path.read_text(encoding='utf-8'))
    issues = issues_for(fixture, stem=path.stem)
    if issues:
        raise ValueError(f'{path.name}: ' + '; '.join(issues))
    return fixture


def load_fixtures(directory: str | Path | None = None, *, family: str | None = QUALITY_FAMILY) -> dict[str, dict]:
    """id -> fixture, in plan order. Raises when a file is malformed.

    Default is the **Q** family only (the 12 quality fixtures the plan counts); pass
    `family='R'` or `family=None` to load the research fixtures or both families.
    """
    fixtures: dict[str, dict] = {}
    paths = fixture_paths(Path(directory) if directory else None, family=family)
    if not paths:
        raise FileNotFoundError(f'không thấy fixture nào trong {directory or FIXTURE_DIR}')
    for path in paths:
        fixture = load_fixture(path)
        if fixture['id'] in fixtures:
            raise ValueError(f"fixture trùng id: {fixture['id']}")
        fixtures[fixture['id']] = fixture
    return fixtures


def load_research_fixtures(directory: str | Path | None = None) -> dict[str, dict]:
    """id -> fixture của họ R (bộ ca research R1–R12), cùng luật hợp lệ như họ Q."""
    return load_fixtures(directory, family=RESEARCH_FAMILY)


def set_issues(fixtures: dict[str, dict]) -> list[str]:
    """Issues that only make sense for the whole set (the network rule, per family).

    Two rules, not one: §4 of the quality plan lets **only Q6** go online, while flow §7.1
    puts **R2** online. The check therefore runs per family and only over the families that
    are actually in the given set — checking a single R fixture against the Q rule would
    report a failure that no rule asks for.
    """
    issues: list[str] = []
    for family in FIXTURE_FAMILIES:
        members = {code: item for code, item in fixtures.items() if family_of(code) == family}
        if not members:
            continue
        allowed = online_allowed(family)
        online = sorted(code for code, item in members.items()
                        if (item.get('environment') or {}).get('network') == 'on')
        unexpected = [code for code in online if code not in allowed]
        if unexpected:
            issues.append(f'chỉ {", ".join(allowed)} được bật mạng, nhưng còn: ' + ', '.join(unexpected))
        if not online:
            issues.append(f'không có fixture nào bật mạng trong họ {family} — {allowed[0]} (mạng bật) '
                          'bị thiếu')
    return issues


def select(fixtures: dict[str, dict], ids: list[str] | None) -> dict[str, dict]:
    """Pick a subset by id, refusing an unknown id instead of silently skipping."""
    if not ids:
        return fixtures
    wanted: dict[str, dict] = {}
    unknown = [code for code in ids if code not in fixtures]
    if unknown:
        raise KeyError('fixture không tồn tại: ' + ', '.join(unknown))
    for code in ids:
        wanted[code] = fixtures[code]
    return wanted
