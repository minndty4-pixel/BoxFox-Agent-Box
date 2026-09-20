"""Pure content gate for `write_plan`: a plan must carry evidence, limits and sources.

Why this module exists
----------------------
The owner asked for "a plan for an agent that looks up patient records" and got a document with
no verification mechanism at all: no command, no expected result, no risks. Nothing in the product
objected, because the only checks were the slug, the 1 MiB size and the target path
(``agent_core/runtime.py`` write_plan) and the sandbox writer (``sandbox/worker.py``) just picks the
next free ``.plans/vN-<slug>.md``.

Contract
--------
``plan_quality_issues(markdown)`` returns the ids of the missing requirements (``[]`` = accepted).
``check_plan_quality(markdown)`` returns ``None`` or raises
``ValueError('PLAN_QUALITY_REJECTED: …')`` — a single-line, actionable message that names exactly
what is missing. Both are pure: no I/O, no session state, no model call.

A plan that satisfies the gate is written exactly as before; the gate only refuses *before* the
sandbox writer runs, so a rejected plan leaves no file behind.
"""

from __future__ import annotations

import re

__all__ = ['REQUIRED_SECTIONS', 'PLAN_QUALITY_PREFIX', 'plan_quality_issues', 'plan_quality_message',
           'check_plan_quality']

PLAN_QUALITY_PREFIX = 'PLAN_QUALITY_REJECTED'

# The plan document must contain each of these sections. `heading_keys` are matched against a
# normalized heading, `missing` lists the issue ids the section can raise, and `trigger` names the
# condition that makes the section mandatory (`None` = always). Vietnamese keys are included on
# purpose: this product's users write Vietnamese plans and the repository's own plans are Vietnamese,
# and the gate is about structure, not language.
REQUIRED_SECTIONS = (
    {
        'id': 'verification',
        'label': 'Verification / Acceptance criteria',
        'heading_keys': ('verification', 'acceptance criteri', 'acceptance test', 'acceptance check',
                         'how to verify', 'verify', 'validation', 'test plan', 'checklist', 'checks',
                         'nghiệm thu', 'kiểm thử', 'xác minh', 'kiểm chứng', 'cách kiểm'),
        'missing': ('verification-section', 'verification-command', 'verification-expected'),
        'trigger': None,
        'requirement': 'names at least one exact command or check plus its expected result',
    },
    {
        'id': 'risks',
        'label': 'Risks / Limitations',
        'heading_keys': ('risk', 'limitation', 'caveat', 'open question', 'unknown', 'assumption',
                         'trade-off', 'tradeoff', 'rủi ro', 'giới hạn', 'hạn chế', 'câu hỏi mở'),
        'missing': ('risks-section',),
        'trigger': None,
        'requirement': 'states the risks, failure modes or limitations (or "none known" and why)',
    },
    {
        'id': 'sources',
        'label': 'Sources / Citations',
        'heading_keys': ('source', 'citation', 'reference', 'bibliography', 'nguồn', 'trích dẫn',
                         'tham chiếu'),
        'missing': ('sources-section',),
        'trigger': 'external_facts',
        'requirement': 'lists where each external fact came from (URL, doc path or quoted source)',
    },
)

# One actionable sentence per issue id. Joined with '; ' into the single-line rejection message.
REMEDIES = {
    'verification-section': ('add a section titled "Verification / Acceptance criteria" (or '
                             '"Acceptance criteria" / "How to verify" / "Nghiệm thu")'),
    'verification-command': ('name at least one exact command or check, e.g. '
                             '"`.venv/bin/python -m pytest backend/tests -q`"'),
    'verification-expected': ('state the expected result of that check, e.g. "expect 3 known '
                              'environment failures and everything else passing"'),
    'risks-section': 'add a "Risks / Limitations" section (write "none known" plus why, if truly none)',
    'sources-section': ('this plan relies on external facts: add a "Sources / Citations" section with '
                        'the URL, doc path or quoted source for each one, and mark anything you could '
                        'not verify as UNVERIFIED'),
}

# A line that opens a section: ATX heading (`## Verification`), a bold label (`**Risks**`) or a short
# plain label (`Verification:`). Nothing else is treated as a heading, so prose never fakes a section.
_ATX_RE = re.compile(r'^\s{0,3}#{1,6}\s+(?P<text>.+?)\s*#*\s*$')
_BOLD_RE = re.compile(r'^\s{0,3}(?:\*\*|__)(?P<text>[^*_\n]+?)(?:\*\*|__)\s*:?\s*$')
_LABEL_RE = re.compile(r'^\s{0,3}(?P<text>[A-Z][^.!?:\n]{1,60}):\s*$')
_FENCE_RE = re.compile(r'^\s*(?:```|~~~)')

# A "concrete command or check" in the verification section: an inline code span, a fenced block, a
# real tool followed by an argument, an explicit `command:`/`verify:` marker, an HTTP call, or an
# assertion naming a concrete artifact/status ("returns 201", "exit code 0", "the file exists").
_INLINE_CODE_RE = re.compile(r'`[^`\n]*[^\s`][^`\n]*`')
_TOOL_NAMES = (r'python3?|pytest|py\.test|npm|npx|pnpm|yarn|node|deno|bash|sh|zsh|curl|wget|docker|'
               r'podman|git|make|cmake|cargo|go|rustc|java|mvn|gradle|dotnet|sqlite3|psql|mysql|'
               r'redis-cli|jq|rg|grep|find|ls|cat|sha256sum|md5sum|tsc|vitest|eslint|ruff|flake8|'
               r'mypy|alembic|systemctl|journalctl')
_COMMAND_TOKEN_RE = re.compile(
    rf'(?:^|[\s(`$>])(?:sudo\s+)?(?:[\w.~-]+/)*(?:{_TOOL_NAMES})\s+[-\w./~"\'`]', re.IGNORECASE | re.MULTILINE)
_MARKER_LINE_RE = re.compile(r'^\s*(?:[-*]\s*)?(?:\*\*)?(?:command|commands|check|checks|test|tests|run|'
                             r'verify|verification|expected|evidence)(?:\*\*)?\s*[:=]', re.IGNORECASE | re.MULTILINE)
_HTTP_CALL_RE = re.compile(r'\b(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+[/\w]', re.IGNORECASE)
_CONCRETE_ASSERTION_RE = re.compile(
    r'\b(?:returns?|responds?)\s+(?:with\s+)?(?:\d{3}|[2-5]xx|OK\b|HTTP)'
    r'|\bexit(?:s)?\s+(?:code|status)?\s*\d'
    r'|\b\d+\s+(?:tests?\s+)?(?:passed|failed|failures?|skipped)\b'
    r'|\b\S+\.(?:md|py|ts|tsx|js|json|sql|sh|yaml|yml|txt|log)\b'
    r'|\bno\s+(?:errors?|diff|diffs|changes|regressions?)\b'
    r'|\b(?:exists?|present|absent|unchanged)\b'
    r'|\bcontains?\s+[\'"`]', re.IGNORECASE)

# An "expected result" is any statement of what the check must produce. Deliberately flat: the point
# is that SOME expectation is written down, not the phrasing. Vietnamese markers are included because
# Vietnamese is a first-class language of this product.
_EXPECTED_MARKERS = ('expect', 'expected', 'should', 'must ', 'exit code', 'exit status', 'passes',
                     'passing', 'fails', 'failure', 'output', 'returns', 'return ', 'verified',
                     'confirms', 'succeeds', 'success', 'no error', 'equals',
                     'mong đợi', 'kỳ vọng', 'phải ', 'kết quả')
_EXPECTED_RE = re.compile(r'(?:=>|->|==|\bexit\s+code\s*\d|\bstatus\s+\d{3}\b|\b\d{3}\s+(?:OK|created|no content)\b)',
                          re.IGNORECASE)

# Phrases that mean the plan leans on knowledge from OUTSIDE this repository, which therefore needs a
# citable source. In-repo references (`docs/plan/x.md`, `backend/src/...`) deliberately do NOT match.
_EXTERNAL_FACT_RES = (
    re.compile(r'https?://', re.IGNORECASE),
    re.compile(r'\bwww\.', re.IGNORECASE),
    re.compile(r'\b(?:search|searched|looked up|consulted)\s+(?:the\s+)?web\b', re.IGNORECASE),
    re.compile(r'\bweb\s+search\b', re.IGNORECASE),
    re.compile(r'\bofficial\s+(?:docs|documentation)\b', re.IGNORECASE),
    re.compile(r'\bupstream\s+(?:docs|documentation)\b', re.IGNORECASE),
    re.compile(r'\bvendor\s+(?:docs|documentation)\b', re.IGNORECASE),
    re.compile(r'\brelease\s+notes\b', re.IGNORECASE),
    re.compile(r'\bRFC\s?\d+\b'),
    re.compile(r'\bCVE-\d{4}-\d+\b', re.IGNORECASE),
    re.compile(r'\bwikipedia\b', re.IGNORECASE),
    re.compile(r'\bper\s+the\s+documentation\b', re.IGNORECASE),
    re.compile(r'\baccording\s+to\s+the\s+(?:docs|documentation|specification|spec)\b', re.IGNORECASE),
    re.compile(r'\bexternal\s+(?:sources|references|citations)\b', re.IGNORECASE),
    re.compile(r'\b(?:HL7|FHIR|HIPAA|GDPR|ISO\s?\d+)\b'),
)


def _normalized_heading(text: str) -> str:
    """`## 3. Acceptance Criteria ###` -> `acceptance criteria`, for key matching."""
    stripped = re.sub(r'^[\s#*>_`]*(?:\d+[.)]\s*)?', '', str(text or '').strip())
    stripped = re.sub(r'[*_`:#]+$', '', stripped)
    return ' '.join(stripped.split()).lower()


def _section_heading(line: str):
    """The heading text of a section-opening line, else None."""
    if _FENCE_RE.match(line):
        return None
    for pattern in (_ATX_RE, _BOLD_RE, _LABEL_RE):
        match = pattern.match(line)
        if match:
            heading = _normalized_heading(match.group('text'))
            return heading or None
    return None


def _sections(markdown: str):
    """[(heading, body)] for every section-opening line, in document order."""
    sections = []
    body = None
    for line in str(markdown or '').splitlines():
        heading = _section_heading(line)
        if heading:
            body = []
            sections.append((heading, body))
        elif body is not None:
            body.append(line)
    return [(heading, '\n'.join(lines).strip()) for heading, lines in sections]


def _find(sections, keys):
    """The first section whose heading contains one of `keys`, as `(heading, body)`, else None."""
    for heading, body in sections:
        if any(key in heading for key in keys):
            return heading, body
    return None


def _has_concrete_check(body: str) -> bool:
    """True when the section names a real command or check rather than a description of one."""
    return bool(_INLINE_CODE_RE.search(body) or _COMMAND_TOKEN_RE.search(body)
                or _MARKER_LINE_RE.search(body) or _HTTP_CALL_RE.search(body)
                or _CONCRETE_ASSERTION_RE.search(body)
                or any(_FENCE_RE.match(line) for line in body.splitlines()))


def _has_expected_result(body: str) -> bool:
    """True when the section states what the check must produce."""
    lowered = body.lower()
    return any(marker in lowered for marker in _EXPECTED_MARKERS) or bool(_EXPECTED_RE.search(body))


def _claims_external_facts(markdown: str) -> bool:
    return any(pattern.search(markdown or '') for pattern in _EXTERNAL_FACT_RES)


def plan_quality_issues(markdown: str) -> list:
    """Ids of the requirements `markdown` fails, in the order of REQUIRED_SECTIONS; `[]` = accepted."""
    text = str(markdown or '')
    sections = _sections(text)
    issues = []
    for spec in REQUIRED_SECTIONS:
        if spec['trigger'] == 'external_facts' and not _claims_external_facts(text):
            continue
        found = _find(sections, spec['heading_keys'])
        if not found:
            issues.append(spec['missing'][0])
            continue
        body = found[1]
        if not body.strip():
            issues.append(spec['missing'][0])
            continue
        if spec['id'] == 'verification':
            if not _has_concrete_check(body):
                issues.append('verification-command')
            if not _has_expected_result(body):
                issues.append('verification-expected')
    return issues


def plan_quality_message(issues) -> str:
    """One line naming exactly what is missing and what to write instead."""
    listed = '; '.join(f'({issue}) {REMEDIES[issue]}' for issue in issues)
    return (f'{PLAN_QUALITY_PREFIX}: the plan was not written: missing {listed}. '
            'Rewrite the markdown with those sections and call write_plan again; nothing was written.')


def check_plan_quality(markdown: str) -> None:
    """Raise `ValueError('PLAN_QUALITY_REJECTED: …')` when the plan is structurally empty."""
    issues = plan_quality_issues(markdown)
    if issues:
        raise ValueError(plan_quality_message(issues))
