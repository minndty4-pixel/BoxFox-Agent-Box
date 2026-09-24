"""Ghim tên công cụ trong cây kỹ năng: kỹ năng không được dạy gọi thứ harness không ship.

Vòng 27 (A7/B-6). Bệnh cũ: `grounded-citations` (5 chỗ) và `arxiv` (6 chỗ) gọi
`web_extract` — tên tool của bản Hermes gốc; harness BoxFox chỉ ship `web_fetch`
(`agent_core/tool_contracts.py`), nên câu lệnh trong kỹ năng gọi một tool không
tồn tại. Cùng họ đó còn `read_file`/`write_file`/`search_files`/`patch`/
`execute_code`/`browser_*` trong các kỹ năng mà vai đang phục vụ.

Bốn nhóm ghim ở đây:

1. `test_no_skill_mentions_a_tool_the_harness_does_not_ship` — quét **mọi** tệp
   `.md` dưới cây vendor: không còn tên đã nghỉ (`web_extract`), và trong các kỹ
   năng *được phục vụ* (DEFAULT_SKILLS ∪ ROLE_SKILLS) mọi tên trông-như-tool phải
   là tool thật.
2. `grounded-citations` dạy đường sổ harness-native (`source_add`/`source_verify`/
   `dossier_write`, mã dòng `[r<N>]`, khối `**Nguồn:**`) và giữ `scripts/sources.py`
   làm **đường dự phòng**.
3. `arxiv` gọi `web_fetch` trên `export.arxiv.org` và **không** dùng `curl` (vai
   `research` không có `terminal_exec`, `roles.py:18`).
4. Sáu kỹ năng research cần gói vẫn **tắt có lý do viết ra** (không phải bỏ quên).
5. Box ghim `HERMES_HOME` dưới `/home/agent` — nếu không, đường dự phòng của script
   vendor rơi vào `/root/.hermes` (agent không đọc/ghi được).

Ca 1 phải đỏ nếu ai đó dán lại `web_extract` vào bất kỳ tệp `.md` nào của vendor.
"""
import re
from pathlib import Path

from agentbox.skills.catalog import (
    DEFAULT_SKILLS, DISABLED_RESEARCH_REASON, DISABLED_RESEARCH_SKILLS, SkillCatalog)
from agentbox.skills.commands import ROLE_SKILLS

VENDOR = Path(__file__).resolve().parents[2] / 'src' / 'agentbox' / 'vendor' / 'hermes'
CATALOG_SRC = VENDOR.parents[1] / 'skills' / 'catalog.py'

#: Tên tool đã nghỉ: harness không ship nữa/không bao giờ ship. Kèm tên thay thế để
#: người đọc sửa đúng chỗ. Cấm xuất hiện ở **mọi** tệp `.md` của cây vendor.
RETIRED_TOOLS = {'web_extract': 'web_fetch'}

#: Tool hợp đồng vòng 27 đã chốt trong `/var/tmp/v27/iface.md` §1 nhưng (tại thời điểm
#: viết) các đợt 3–7 còn đang thi công nên chưa nằm trong `tool_contracts.SCHEMAS`.
#: Giữ danh sách này **bằng** bảng hợp đồng: tên nào không bao giờ được ship thì phải
#: gỡ khỏi kỹ năng, không phải nới danh sách.
V27_CONTRACT_TOOLS = {
    'source_add', 'source_list', 'source_verify', 'dossier_write', 'research_brief',
    'research_verify', 'research_status', 'cancel_child',
}

#: Họ tên "trông như tool": dùng cho phép quét tên **trần** trong backtick (tên trong
#: ngoặc `name(...)` được kiểm riêng, không cần tiền tố). Cố ý hẹp — `get_`/`set_`/
#: `open_` không nằm ở đây vì chúng khớp vô số hàm Python trong ví dụ mã.
TOOLISH_PREFIXES = (
    'file_', 'codebase_', 'terminal_', 'skill_', 'session_', 'journal_', 'plan_',
    'delegate_', 'await_', 'peer_', 'cancel_', 'research_', 'source_', 'dossier_',
    'paper_', 'web_', 'browser_', 'computer_', 'inspect_', 'read_', 'write_',
    'search_', 'execute_', 'patch', 'image_', 'vision_', 'send_', 'cron', 'desktop_',
    'call_', 'list_', 'ask_', 'request_',
)

#: Ngoại lệ **theo tệp** cho tên trông-như-tool (kèm lý do). Không có ngoại lệ theo
#: tên: dạy `browser_click` trong một kỹ năng research vẫn phải đỏ.
SERVED_EXCEPTIONS = {
    # Nợ đã ghi: `dogfood` (vai testing, không phải research) còn dạy bộ 9 tool browser của
    # bản Hermes gốc, trong khi BoxFox ship **một** `browser_use(action=…)` với
    # navigate/snapshot/click/fill/key/screenshot. Viết lại quy trình QA này cần bàn giao
    # của vai testing — ngoài đợt 8; tên browser_* mới **không** có trong bảng này sẽ đỏ.
    'skills/software-development/dogfood/SKILL.md': {
        'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
        'browser_press', 'browser_scroll', 'browser_back', 'browser_vision',
        'browser_console',
    },
}

#: Tên trông như tool nhưng **không phải** tool — dùng trong kỹ năng theo nghĩa khác.
NON_TOOL_NAMES = {
    'research-review': 'tên VAI (iface §1), gọi bằng `delegate_task` chứ không phải tool',
}

#: Tên trong backtick, dạng trần (`` `web_fetch` ``) hoặc dạng gọi (`` `web_fetch(url=…)` ``).
_BACKTICK = re.compile(r'`([A-Za-z_][A-Za-z0-9_]*)(?:\([^`]*)?`')


def shipped_tool_names():
    """Tên tool thật: schema trong `tool_contracts.SCHEMAS` + op box + hợp đồng vòng 27."""
    from agentbox.agent_core import tool_contracts

    names = set(V27_CONTRACT_TOOLS)
    for schema in tool_contracts.SCHEMAS:
        function = schema.get('function') if isinstance(schema, dict) else None
        name = (function or {}).get('name') or (schema.get('name') if isinstance(schema, dict) else None)
        if name:
            names.add(str(name))
    try:  # op box (session ops) là "tool" theo nghĩa kỹ năng gọi được
        from agentbox.sandbox.worker import SESSION_OP_NAMES

        names.update(str(item) for item in SESSION_OP_NAMES)
    except Exception:  # pragma: no cover - box không import được thì vẫn kiểm phần còn lại
        pass
    return names


def served_skill_paths():
    catalog = SkillCatalog()
    ids = set(DEFAULT_SKILLS)
    for names in ROLE_SKILLS.values():
        ids |= set(names)
    return sorted({catalog.items[sid]['_path'] for sid in ids if sid in catalog.items})


def test_no_skill_mentions_a_tool_the_harness_does_not_ship():
    """Không tệp `.md` nào của vendor còn tên tool đã nghỉ; kỹ năng được phục vụ chỉ gọi tool thật."""
    stale = []
    for path in VENDOR.rglob('*.md'):
        text = path.read_text(encoding='utf-8')
        for retired, replacement in RETIRED_TOOLS.items():
            for number, line in enumerate(text.splitlines(), 1):
                if retired in line:
                    stale.append(f"{path.relative_to(VENDOR)}:{number}: `{retired}` → `{replacement}`")
    assert not stale, 'Kỹ năng còn gọi tên tool harness không ship:\n' + '\n'.join(stale)

    shipped = shipped_tool_names()
    offenders = []
    for path in served_skill_paths():
        relative = path.relative_to(VENDOR).as_posix()
        allowed = SERVED_EXCEPTIONS.get(relative, set())
        text = path.read_text(encoding='utf-8')
        for number, line in enumerate(text.splitlines(), 1):
            for name in sorted({n for n in _BACKTICK.findall(line) if n.startswith(TOOLISH_PREFIXES)}):
                if name in shipped or name in allowed or name in NON_TOOL_NAMES:
                    continue
                offenders.append(f'{relative}:{number}: `{name}`')
    assert not offenders, ('Kỹ năng đang phục vụ nhắc tên không phải tool của harness '
                           '(sửa tên, hoặc ghi nợ vào SERVED_EXCEPTIONS kèm lý do):\n'
                           + '\n'.join(offenders))


def test_grounded_citations_teaches_the_ledger_tools_and_keeps_the_script_as_fallback():
    """Sổ nguồn là tool của harness; `scripts/sources.py` chỉ còn là đường dự phòng có điều kiện."""
    text = (VENDOR / 'skills/research/grounded-citations/SKILL.md').read_text(encoding='utf-8')

    for tool in ('source_add', 'source_verify', 'dossier_write'):
        assert f'`{tool}`' in text or f'{tool}(' in text, f'thiếu tool sổ nguồn `{tool}`'
    assert '[r<N>]' in text and '**Nguồn:**' in text
    # Mã dòng do harness cấp là `r<N>` (`SOURCE_ROW_PREFIX = 'r'`,
    # `session_store.next_source_row_id`), và cổng chất lượng chỉ nhận đúng khuôn đó
    # (`research_quality.pinned_row_ids` quét `\b(r\d{1,4})\b`). Kỹ năng dạy `[s<N>]`
    # sẽ khiến mọi hồ sơ bị cổng từ chối vì "trỏ sai" ⇒ ghim khuôn thật ở đây.
    assert '[s<N>]' not in text, 'mã dòng là `r<N>`, không phải `s<N>`'
    assert 'excerpt' in text, 'luật sổ nguồn phải nói tới đoạn trích nguyên văn'
    assert 'chưa mở được bản gốc' in text, 'thiếu chữ bắt buộc khi không mở được bản gốc'

    assert '`scripts/sources.py`' in text, 'đường dự phòng phải được nêu tên'
    assert 'fallback' in text and 'HERMES_HOME' in text
    fallback = text[text.index('## Fallback'):] if '## Fallback' in text else text
    assert 'runner' in fallback or 'terminal' in fallback, 'điều kiện chạy script phải nói rõ'

    assert '`web_extract`' not in text
    assert '`web_fetch`' in text and 'read_source' in text


def test_arxiv_skill_uses_the_fetch_tool_instead_of_curl():
    """`arxiv` chạy bằng `web_fetch` trên API export.arxiv.org — không `curl` (research không có shell)."""
    text = (VENDOR / 'skills/research/arxiv/SKILL.md').read_text(encoding='utf-8')

    assert 'curl' not in text, 'vai research không có `terminal_exec` nên `curl` là lệnh chết'
    assert 'https://export.arxiv.org/api/query' in text
    assert '`web_fetch`' in text and 'web_fetch(url="https://export.arxiv.org/api/query' in text
    assert 'web_fetch(url="https://arxiv.org/abs/' in text, 'phải mở được trang abstract thật'
    assert 'paper_citations' in text, 'đuổi trích dẫn phải dùng tool của harness'
    assert 'chưa mở được bản gốc' in text, 'PDF không đọc được thì phải nói đúng chữ đó'


def test_the_disabled_research_skills_are_disabled_for_a_written_reason():
    """Sáu kỹ năng cần gói vẫn tắt **có lý do viết ra** — trạng thái cố ý, không phải bỏ quên."""
    catalog = SkillCatalog()
    assert set(DISABLED_RESEARCH_SKILLS) == {
        'rss-feeds', 'blogwatcher', 'pdf', 'scrapling', 'duckduckgo-search', 'searxng-search'}

    source = CATALOG_SRC.read_text(encoding='utf-8')
    assert '#5977' in source and 'cấm cài gói' in source
    for skill_id in sorted(DISABLED_RESEARCH_SKILLS):
        assert skill_id in source, f'{skill_id}: thiếu tên trong khối lý do của catalog.py'
        assert not catalog.items[skill_id]['enabled'], f'{skill_id} phải vẫn TẮT'
    assert 'không cài được trong box' in DISABLED_RESEARCH_REASON
    assert 'không cài được trong box' in source


def test_research_team_and_blocked_page_recovery_are_enabled_for_research():
    """Hai kỹ năng mới/được mở phải nằm trong DEFAULT_SKILLS **và** vai `research`."""
    catalog = SkillCatalog()

    for skill_id in ('research-team', 'blocked-page-recovery', 'arxiv'):
        assert skill_id in DEFAULT_SKILLS, f'{skill_id} phải được bật mặc định'
        assert skill_id in catalog.items and catalog.items[skill_id]['enabled']
        assert skill_id in ROLE_SKILLS['research'], f'{skill_id} phải có trong ROLE_SKILLS[research]'

    team = (VENDOR / 'skills/research/research-team/SKILL.md').read_text(encoding='utf-8')
    assert len(team.splitlines()) <= 220, 'skill phải đủ ngắn để model đọc hết'
    assert '[s<N>]' not in team and '[r<N>]' in team, 'mã dòng là `r<N>` trong sổ của harness'
    for needle in ('Mức: <n>', 'research_brief', 'cancel_child', 'research_verify', 'research-review',
                   'Đang ở:', 'Ngân sách:', 'ủng hộ', 'phản bác', 'chưa chắc',
                   'chưa mở được bản gốc', 'dossierDir', '3 vòng'):
        assert needle in team, f'research-team thiếu `{needle}`'

    recovery = (VENDOR / 'skills/web/blocked-page-recovery/SKILL.md').read_text(encoding='utf-8')
    assert 'Fake successes' in recovery
    assert 'Wayback Machine' in recovery


def test_the_box_pins_hermes_home_for_the_vendor_scripts():
    """Box phải ghim `HERMES_HOME` dưới `/home/agent`: script vendor tự suy thư mục riêng.

    `skills/research/grounded-citations/scripts/_hermes_home.py` đọc
    `os.environ.get('HERMES_HOME')` rồi mới tới `Path.home()/'.hermes'`; `gosu agent` KHÔNG
    đổi `HOME` (entrypoint chạy bằng root) nên thiếu dòng export này thì sổ dự phòng rơi vào
    `/root/.hermes` — agent không ghi được.
    """
    box_services = Path(__file__).resolve().parents[3] / 'deploy' / 'docker' / 'box-services.sh'
    text = box_services.read_text(encoding='utf-8')

    exported = re.findall(r'^export\s+HERMES_HOME=(\S+)\s*$', text, re.M)
    assert exported == ['/home/agent/.hermes'], (
        f'box-services.sh phải export đúng HERMES_HOME=/home/agent/.hermes, đang có: {exported}')
    assert 'HERMES_HOME=/root' not in text, 'không được trỏ sổ vào /root'

    fallback = (VENDOR / 'skills/research/grounded-citations/scripts/_hermes_home.py')
    assert 'HERMES_HOME' in fallback.read_text(encoding='utf-8'), \
        'script dự phòng phải là bên đọc biến này'
