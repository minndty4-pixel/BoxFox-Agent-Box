---
name: grounded-citations
description: "Ground answers and documents in cited, verifiable sources."
version: 1.3.0
author: Hermes Agent + Teknium
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, Citations, Grounding, Sources, Web, Reports]
    category: research
    related_skills: [arxiv, blocked-page-recovery, research-team, final-report]
---

# Grounded Citations

Every claim taken from an outside source gets an inline citation and a
`**Nguồn:**` list. The ledger is a harness tool, not a script: `source_add`
registers a claim + URL + verbatim excerpt and hands back the row id you cite
(`[r7]`), so the numbers and URLs come from retrieval, never from memory — you
only ever emit small ids the harness gave you.

For high-stakes work the same ledger doubles as a fact-checking chain:
`source_verify` re-opens the URL and compares the excerpt, `dossier_write`
writes the dossier (`.research/<slug>/v<N>-<slug>.md` plus the source files) and
returns the gate verdict, and claims you could not source are marked
`[chưa kiểm chứng]` instead of being dressed up as cited.

This skill covers answers in chat, written documents, and research dossiers. It
does not cover academic BibTeX pipelines — for conference papers use the
`arxiv` skill (see `references/citation-formats.md`).

## When to Use

Use whenever an answer or artifact rests on information you fetched rather than
knew:

- Research, comparisons, news summaries, "what is the current state of X"
- Any deliverable you write to disk that quotes, paraphrases, or reports
  outside facts — reports, briefs, docs, decks, wiki pages
- Fact-finding where the owner will want to check your work
- Multi-source synthesis where conflicting sources must be attributed

Skip citations when the retrieval is incidental to another task — a quick
syntax/version lookup mid-coding, casual conversation, creative writing.
Mention a URL only if the owner would plausibly want the link.

## Prerequisites

The ledger tools and a fetch path. Retrieval is: `web_search` (the HOST sees
the real Internet), then `web_fetch` on the URLs it returns, `read_source` to
walk a page you already fetched (slices + `find`), `paper_citations` for the
citation graph of a paper, `browser_use` only for pages served inside the box.
The ledger is a harness tool — no script, no install, no shell required.

## The ledger in this harness

| Step | Call | Answer |
|---|---|---|
| Register a source + claim | `source_add(claim=…, url=…, excerpt=…)` | `{rowId, tier, type, host, fetchedAt, counts}` |
| Read the ledger back | `source_list(turn=…, childId=…, tier=…)` | `{rows, counts, window}` |
| Re-open one row and compare | `source_verify(rowId=…)` | `{rowId, status: ok\|stale\|unverified, matched, unreachable, fakeSuccess, viaReader}` |
| Write the dossier | `dossier_write(researchId=…, level=…, profile=…, markdown=…)` | `{researchId, version, files[], header, gate}` |

- `source_add` returns the **row id** — `r7` in a ledger whose rows start at
  `r1` (`SOURCE_ROW_PREFIX`). Cite that id, never a number you counted yourself.
- `excerpt` must be text you actually read on that page, copied verbatim. The
  harness floor is 80 characters (`RESEARCH_MIN_EXCERPT_CHARS`) and saves
  truncate past 2 000 — aim for 200–600, no summarizing. `web_fetch` gives you
  the page text; `read_source` gives you the slice that carries the sentence.
  Do not retype — paste.
- Opt `origin` when the page is a re-post of another outlet (e.g.
  `origin="nguồn: TTXVN"`), and `type` when the row is a `host-doc` (a document
  the owner handed you) or an `official-social` post. Those flags are what keeps
  two hosts carrying one press release from counting as two sources.
- `source_verify` is the check that the excerpt is still on the page:
  `status: ok` means re-opened and matched, `stale` means the page changed under
  you, `unverified` means it could not be re-opened, `fakeSuccess` means the
  fetch looked fine but returned no prose, `viaReader` tells you the text came
  from this session's read store instead of the live host.

## Procedure

① **Open before you claim.** Take the URL you intend to cite and read it for
real: `web_fetch(url=…)`, then `read_source(ref=…, find=…)` to land on the
passage. A search-result description is not a page; a snippet supports only what
it literally says.

② **Register at retrieval time, before writing prose.** Call `source_add` as
each source arrives, with the claim it supports and the verbatim excerpt. Doing
it later, from memory, is the failure mode this skill exists to prevent.

③ **Write cite-while-drafting.** Put the row id in brackets immediately after
each sentence the source supports:

```
Ice floats because it is less dense than liquid water.[r1][r2]
```

- No space before the bracket; one id per bracket, at most 3 per sentence.
- Cite per sentence, not one dump at the end.
- Only ids the ledger returned. Never invent an id or a URL.
- Knowledge of your own that no source carries: mark it `[chưa kiểm chứng]`,
  and say so in the summary if it carries weight.
- Conflicting sources: present both readings, each with its own id.
- Quote exact figures, dates, and names as the source states them; write
  "chưa mở được bản gốc" when a pointer could not be opened, instead of
  presenting a secondary mention as the original.

④ **Close with the `**Nguồn:**` block**, one entry per cited row: the id, the
host, the URL, and the verbatim excerpt under it, so a reader can check the
chain without opening anything.

```
**Nguồn:**
- [r1] vi.wikipedia.org — https://vi.wikipedia.org/wiki/Nước
  "Nước đá có khối lượng riêng nhỏ hơn nước lỏng khoảng 9%."
```

⑤ **Verify the rows you lean on.** Call `source_verify` for each load-bearing
row before delivering. `ok` means leave it; `stale`/`unverified`/`fakeSuccess`
mean fix the claim, replace the source, or soften the sentence — do not ship a
citation whose page you cannot re-open without saying so.

⑥ **Write the dossier when the job has a dossier dir.** `dossier_write` stores
the markdown and returns `{version, files[], header, gate}`; the gate names what
is still missing (missing sections, rows without excerpts, rows whose origin is
undeclared, unverified claims). Fix and write the next version — never edit a
written version in place.

## Fact-Checking Mode

For work where the reader must be able to check the chain — medical, legal,
financial, safety, disputed claims — upgrade from citations to evidence:

① **Attach the verbatim quote at `source_add` time.** The excerpt is not
decoration: rows without one are reported by the gate as unproven, and
`research-excerpt-missing` names the row that needs one.

② **Mark what you could not source** with `[chưa kiểm chứng]`. The goal is
declared provenance for every claim, not a citation on every sentence. A
fact-check deliverable dominated by `[chưa kiểm chứng]` should say so in its
summary rather than pad the ledger.

③ **Cross-check disputed facts against a second independent source** (a
different origin, not a re-post). When two sources disagree, cite both readings
with their own ids and say which you weight and why. One source is reporting;
two independent sources are corroboration.

④ **Re-open and verify** the rows a reader would most want to check, then write
the dossier and read the gate verdict as the last step before delivery.

## Multi-Platform Sweeps

"What are people saying about X" / "research X across the web" is not one
`web_search`. Fan out across source types, collect in parallel, then synthesise
with every claim attributed to the platform it came from:

| Source type | Route | What it adds |
|---|---|---|
| Open web | `web_search` → `web_fetch` | official docs, articles, announcements |
| Primary documents | `web_fetch` on the publisher's own page → `read_source` | the text the claim rests on |
| Papers | `web_search(source="papers")` → `paper_citations` | the primary paper and who cites it |
| Community discussion | `web_fetch` on the thread, `source_add(type="official-social")` | real user experience, complaints |
| Dated posts / releases | `web_fetch` on the dated permalink | version history, chronology |
| Repos / issues | `web_fetch` on the repository page | implementations, open bugs |

The six package-needing research skills (`rss-feeds`, `blogwatcher`, `pdf`,
`scrapling`, `duckduckgo-search`, `searxng-search`) are **disabled by default**
in this box because they need packages that cannot be installed here; use the
routes above instead of promising a feed reader or an OCR pass you do not have.

Sibling skills sometimes name routes this box does not have: `gh search`, `xurl`,
`rss-feeds`, `reddit-reading` and `blogwatcher` are **not** in this repo's tool
table (`backend/src/agentbox/agent_core/tool_contracts.py`). Use the routes in the
table above; do not promise a CLI or a skill the session cannot call.

Register every URL from every route as it arrives (step ②). Keep opinion and
measurement apart: a forum thread is evidence that users *report* something,
not that it is true — pair it with a primary source or label it as sentiment.
Report per-platform coverage gaps ("that search returned nothing newer than
March") rather than silently narrowing to what worked.

## Fallback: scripts/sources.py

`scripts/sources.py` (and `scripts/_hermes_home.py`) is the old standalone
ledger and stays in the package as a **fallback**. It only runs when the box has
a script runner or terminal and `HERMES_HOME` is set to a writable directory
(the box exports `HERMES_HOME=/home/agent/.hermes` in `deploy/docker/box-services.sh`;
nothing under `backend/src/agentbox` sets it, so a session without a terminal has no
usable path for this script); the ledger file it writes is
`$HERMES_HOME/cache/citations/ledger.json` (`--ledger <path>` or
`HERMES_CITATION_LEDGER` override it). It is stdlib-only Python 3 and renumbers
its own ids, so never mix it with `source_add` rows in one deliverable — pick
one ledger for a job and stay in it. Prefer the tools in this skill; reach for
the script only when the tools are unavailable in the session.

## Pitfalls

- **Registering after writing.** The ledger must be populated from what you
  fetched, not reconstructed from the draft — that reintroduces exactly the
  hallucinated-URL risk the row ids remove.
- **Citing a search snippet as if you read the page.** A `web_search`
  description supports only what it literally says. Open the page with
  `web_fetch` when the claim needs the body.
- **Quoting from a snippet instead of the page.** Excerpts must come from the
  page text you read (`web_fetch`, `read_source`), not a result description.
- **Renumbering or hand-editing ids.** Ids are ledger identities; if a draft
  cites `[r4]`, `r4` must stay that source. Never retype a URL into the
  `**Nguồn:**` block from memory — read it back with `source_list`.
- **A re-post counted as a second source.** Two hosts running the same wire
  story are one origin; declare `origin` (or drop one).
- **Treating `[chưa kiểm chứng]` as an escape hatch.** It marks the rare claim
  that genuinely cannot be sourced; if most sentences carry it, the job needed
  more retrieval, not more markers.
- **Shipping a stale row silently.** When `source_verify` says `stale` or
  `unverified`, say so in the deliverable instead of quoting the old text.
- **Over-citing.** Three ids on a sentence is the ceiling; a citation on every
  clause makes text unreadable and hides which source carries the load.
- **Parallel subagents.** Children write into the same ledger — give each child
  the claim it owns and read `source_list(childId=…)` back before merging, so
  two children cannot register the same page twice.

## Verification

- Every cited `[r<N>]` exists in the ledger (`source_list`), carries an excerpt
  from the page, and the `**Nguồn:**` block matches the ledger's hosts/URLs.
- Every load-bearing row was re-opened with `source_verify`; anything not `ok`
  is either fixed or named in the deliverable.
- `dossier_write` returns a gate verdict and you read it: the missing-section,
  unproven-row and unverified-claim lists are the same checks a reviewer runs.
