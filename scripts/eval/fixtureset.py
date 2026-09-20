"""Load and validate the 12 static quality fixtures (quality plan §4).

The fixtures are JSON on purpose: `json` is stdlib, so a fresh checkout can load
them without installing anything, and a diff stays readable. One file per case,
named after the plan's id (`Q1` … `Q12`).
"""
from __future__ import annotations

import json
from pathlib import Path

import rubric

FIXTURE_DIR = Path(__file__).resolve().parent / 'fixtures'
NETWORK_VALUES = ('off', 'on')
# §4: "Fixture không dùng mạng ngoài trừ Q6" — the one fixture allowed to be online.
ONLINE_ALLOWED = ('Q6',)


def fixture_paths(directory: Path | None = None) -> list[Path]:
    directory = Path(directory or FIXTURE_DIR)
    return sorted(directory.glob('Q*.json'), key=lambda path: int(path.stem[1:]))


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


def load_fixtures(directory: str | Path | None = None) -> dict[str, dict]:
    """id -> fixture, in plan order. Raises when a file is malformed."""
    fixtures: dict[str, dict] = {}
    paths = fixture_paths(Path(directory) if directory else None)
    if not paths:
        raise FileNotFoundError(f'không thấy fixture nào trong {directory or FIXTURE_DIR}')
    for path in paths:
        fixture = load_fixture(path)
        if fixture['id'] in fixtures:
            raise ValueError(f"fixture trùng id: {fixture['id']}")
        fixtures[fixture['id']] = fixture
    return fixtures


def set_issues(fixtures: dict[str, dict]) -> list[str]:
    """Issues that only make sense for the whole set (§4 network rule)."""
    issues: list[str] = []
    online = sorted(code for code, item in fixtures.items()
                    if (item.get('environment') or {}).get('network') == 'on')
    unexpected = [code for code in online if code not in ONLINE_ALLOWED]
    if unexpected:
        issues.append('chỉ Q6 được bật mạng (§4), nhưng còn: ' + ', '.join(unexpected))
    if not online:
        issues.append('không có fixture nào bật mạng — Q6 (mạng bật) bị thiếu')
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
