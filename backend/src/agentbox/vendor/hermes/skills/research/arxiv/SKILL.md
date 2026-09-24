---
name: arxiv
description: "Search arXiv papers by keyword, author, category, or ID."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, Arxiv, Papers, Academic, Science, API]
    category: research
    related_skills: [grounded-citations, blocked-page-recovery, research-team]
---

# arXiv Research

Search and retrieve academic papers from arXiv via their free REST API. No API
key, no dependencies: `web_fetch` on an API URL, straight from the research
session.

## Quick Reference

| Action | Call |
|--------|------|
| Search papers | `web_fetch(url="https://export.arxiv.org/api/query?search_query=all:QUERY&max_results=5")` |
| Get specific paper | `web_fetch(url="https://export.arxiv.org/api/query?id_list=2402.03300")` |
| Read abstract page | `web_fetch(url="https://arxiv.org/abs/2402.03300")` |
| Read full text (HTML) | `web_fetch(url="https://arxiv.org/html/2402.03300v1")` |
| Walk the citation graph | `paper_citations(workId="W…" \| doi="10.…", direction="backward"\|"forward")` |

The API host is `export.arxiv.org`, not `arxiv.org` — the API answers there and
redirects elsewhere. `web_fetch` follows redirects for you.

## Searching Papers

The API returns **Atom XML** and `web_fetch` hands it to you as text. Read the
fields you need out of the XML directly; when the response is long the answer
says `truncated: true` and you continue from `nextOffset` with `web_fetch`
again or with `read_source(ref=…, offset=…, find=…)`.

```xml
<entry>
  <id>http://arxiv.org/abs/2402.03300v3</id>       <!-- paper URL + version -->
  <published>2024-02-05T18:59:07Z</published>       <!-- first submission -->
  <updated>2024-06-01T10:00:00Z</updated>           <!-- latest version -->
  <title>DeepSeekMath: Pushing the Limits …</title>
  <summary>…</summary>                              <!-- the abstract -->
  <author><name>Zhihong Shao</name></author>        <!-- one per author -->
  <category term="cs.CL"/>                          <!-- one per category -->
  <arxiv:primary_category term="cs.CL"/>
</entry>
```

An `entry` whose summary says withdrawn/retracted is not a citable paper (see
below). Version suffixes matter more than they look: `…v1` is immutable, the
bare id always resolves to the newest version.

### Basic search

```
web_fetch(url="https://export.arxiv.org/api/query?search_query=all:GRPO+reinforcement+learning&max_results=5")
```

### Newest first

```
web_fetch(url="https://export.arxiv.org/api/query?search_query=all:GRPO+reinforcement+learning&max_results=5&sortBy=submittedDate&sortOrder=descending")
```

## Search Query Syntax

| Prefix | Searches | Example |
|--------|----------|---------|
| `all:` | All fields | `all:transformer+attention` |
| `ti:` | Title | `ti:large+language+models` |
| `au:` | Author | `au:vaswani` |
| `abs:` | Abstract | `abs:reinforcement+learning` |
| `cat:` | Category | `cat:cs.AI` |
| `co:` | Comment | `co:accepted+NeurIPS` |

### Boolean operators

```
# AND (default when using +)
search_query=all:transformer+attention

# OR
search_query=all:GPT+OR+all:BERT

# AND NOT
search_query=all:language+model+ANDNOT+all:vision

# Exact phrase
search_query=ti:"chain+of+thought"

# Combined
search_query=au:hinton+AND+cat:cs.LG
```

Percent-encode `"` and spaces kept inside a phrase (`%22chain+of+thought%22`).
`+` is the space separator; `%20` also works.

## Sort and Pagination

| Parameter | Options |
|-----------|---------|
| `sortBy` | `relevance`, `lastUpdatedDate`, `submittedDate` |
| `sortOrder` | `ascending`, `descending` |
| `start` | Result offset (0-based) |
| `max_results` | Number of results (default 10, max 30000) |

```
# Latest 10 papers in cs.AI
web_fetch(url="https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=10")
```

## Fetching Specific Papers

```
# By arXiv ID
web_fetch(url="https://export.arxiv.org/api/query?id_list=2402.03300")

# Multiple papers in one call
web_fetch(url="https://export.arxiv.org/api/query?id_list=2402.03300,2401.12345,2403.00001")
```

## Reading Paper Content

Read the paper itself before you cite it — a search result and an abstract are
not the paper.

```
# Abstract page: title, authors, abstract, comments, journal ref, version links
web_fetch(url="https://arxiv.org/abs/2402.03300")

# Full text, when the paper has an HTML version (most 2024+ submissions do)
web_fetch(url="https://arxiv.org/html/2402.03300v1")
```

- Read the abstract page, then the HTML body for the sections the claim rests
  on, then register the claim with `source_add` using a verbatim excerpt from
  what you actually read (see the `grounded-citations` skill).
- `arxiv.org/pdf/<id>` is a PDF: `web_fetch` returns page text for HTML/JSON,
  not for PDFs, and this box has no local PDF reader (the `pdf` skill is
  disabled — no packages can be installed here). When only a PDF carries the
  passage you need, say exactly `chưa mở được bản gốc` instead of presenting the
  abstract as if you had read the body.
- Cite the version you actually read (`/abs/2402.03300v1`, not the bare id) so
  a later revision cannot silently change what you quoted.

## BibTeX Generation

Build the entry from the fields of the `entry` you fetched — no shell needed:

```bibtex
@article{shao2024_2402_03300,
  title         = {DeepSeekMath: Pushing the Limits of Mathematical Reasoning},
  author        = {Zhihong Shao and Peiyi Wang and Qihao Zhu},
  year          = {2024},
  eprint        = {2402.03300},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CL},
  url           = {https://arxiv.org/abs/2402.03300v3},
}
```

- `year` = the `<published>` year, `eprint` = the id without the version, key =
  first author's last name + year + id with dots replaced by underscores.
- `author` joins every `<author><name>` with ` and ` — never hand-pick two and
  call it the author list.
- `primaryClass` comes from `<arxiv:primary_category term=…>`, not from the
  first `<category>` you happen to see.

## Common Categories

| Category | Field |
|----------|-------|
| `cs.AI` | Artificial Intelligence |
| `cs.CL` | Computation and Language (NLP) |
| `cs.CV` | Computer Vision |
| `cs.LG` | Machine Learning |
| `cs.CR` | Cryptography and Security |
| `stat.ML` | Machine Learning (Statistics) |
| `math.OC` | Optimization and Control |
| `physics.comp-ph` | Computational Physics |

Full list: https://arxiv.org/category_taxonomy

## Citations and Related Papers

arXiv itself exposes no citation graph. Two routes, both free:

1. **`paper_citations`** (OpenAlex, the harness tool): pass the OpenAlex id
   (`W…`, which a `web_search(source="papers")` result returns) or a DOI, and
   walk `direction="backward"` (what the paper builds on) or
   `direction="forward"` (who cites it). This is the route that turns a claim
   into its primary source.
2. **Semantic Scholar JSON over `web_fetch`** (1 request/second, no key):

```
# Paper details + citation counts, by arXiv ID
web_fetch(url="https://api.semanticscholar.org/graph/v1/paper/arXiv:2402.03300?fields=title,authors,citationCount,referenceCount,influentialCitationCount,year,externalIds,openAccessPdf")

# Who cites it
web_fetch(url="https://api.semanticscholar.org/graph/v1/paper/arXiv:2402.03300/citations?fields=title,authors,year,citationCount&limit=10")

# What it cites
web_fetch(url="https://api.semanticscholar.org/graph/v1/paper/arXiv:2402.03300/references?fields=title,authors,year,citationCount&limit=10")

# Author profile
web_fetch(url="https://api.semanticscholar.org/graph/v1/author/search?query=Yann+LeCun&fields=name,hIndex,citationCount,paperCount")
```

Useful fields: `title`, `authors`, `year`, `abstract`, `citationCount`,
`referenceCount`, `influentialCitationCount`, `isOpenAccess`, `openAccessPdf`,
`fieldsOfStudy`, `publicationVenue`, `externalIds` (carries the DOI and arXiv
id). The recommendations POST endpoint needs a request body, which `web_fetch`
cannot send — use `paper_citations` forward direction instead.

## Complete Research Workflow

1. **Discover**: `web_search(source="papers", query="…")` and the arXiv API
   searches above (newest first when the field is moving fast).
2. **Read**: the abstract page, then the HTML body — for every claim you keep,
   note the version you read.
3. **Assess impact**: `paper_citations(direction="forward", limit=10)`.
4. **Primary source**: `paper_citations(direction="backward")` for the work the
   paper rests on, then fetch the ones that carry load.
5. **Register**: `source_add(claim=…, url=…, excerpt=…, type=…, tier=…)` as each
   source arrives, so the dossier can cite it by row id (`[r<N>]`).
6. **Write**: the dossier via `dossier_write`, with the `**Nguồn:**` block from
   the ledger — not from memory.

## Helper Script (fallback)

The package keeps `scripts/search_arxiv.py` (stdlib-only, parses the same Atom
XML) for sessions that have a script runner or a real terminal — the harness
does not run skill scripts on its own, and the `research` role has no
`terminal_exec`, so treat the tool calls above as the route that always works.

## Rate Limits

| API | Rate | Auth |
|-----|------|------|
| arXiv | ~1 req / 3 seconds | None needed |
| Semantic Scholar | 1 req / second | None (100/sec with API key) |

## Notes

- arXiv returns Atom XML; Semantic Scholar returns JSON — read either straight
  from the `web_fetch` answer (both are text), one call per URL.
- arXiv IDs: old format (`hep-th/0601001`) vs new (`2402.03300`).
- Abstract: `https://arxiv.org/abs/{id}` — HTML: `https://arxiv.org/html/{id}`
  — PDF: `https://arxiv.org/pdf/{id}` (not readable by `web_fetch`).
- Papers can be withdrawn: the `<summary>` carries the notice (look for
  "withdrawn"/"retracted"), the metadata may be incomplete, and the paper must
  not be cited as valid.

## ID Versioning

- `arxiv.org/abs/1706.03762` always resolves to the **latest** version
- `arxiv.org/abs/1706.03762v1` points to a **specific** immutable version
- When generating citations, preserve the version suffix you actually read to
  prevent citation drift (a later version may substantially change content)
- The API `<id>` field returns the versioned URL (e.g.
  `http://arxiv.org/abs/1706.03762v7`)
