---
name: final-report
description: "Final answer ideas (suggestions only): a light menu of parts you may borrow, and finished-state image evidence you may close with. Answer naturally and briefly."
version: 3.0.0
author: BoxFox Agent (vòng 24, D-31 - hạ xuống gợi ý ở vòng 28, D-44)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [report, evidence, screenshots, delivery, communication]
    related_skills: [systematic-debugging, requesting-code-review]
---

# Final Report — ideas, not a form

## Overview

The final answer is a normal message to the owner — the kind a good colleague sends in chat. This
skill is a **menu of ideas**: borrow the parts that fit this turn, skip the rest, and say it in your
own words. Nothing here is compulsory, no order is fixed, and a short answer is a good answer. The
owner asked for exactly this: answer naturally, the way ChatGPT or Claude would, not in a form.

The only things that do not bend are the **honesty** rules at the end of this page.

## When it may help

- The turn produced something to show — work, files, a result: the ideas below often read well.
- The turn was a plain question: skip this page and answer the question.

## Ideas you can borrow

- **What you did** — the finished work, with the real commands you ran and the real files you
  changed; if you did not run a check, do not imply you did.
- **What is left** — only when something really is unfinished, skipped or not run.
- **What the owner must decide** — only when a decision is really needed.
- **What is unclear** — open questions and assumptions, only when there are any.
- **Evidence** — the finished-state captures that prove what you claim, one label per image, plus
  links to the evidence files. Use it when the turn produced something observable.

Pick by content, not habit: a turn that changed one file and ran one test may open with the outcome,
say what you did, and stop there. An empty part adds nothing, so never print an empty part — drop it
instead. If none of the ideas fits, write the answer without them.

## Reading well in the chat panel

The chat panel uses your first paragraph as the collapsed summary of the turn and holds the rest
behind **"View details"**. So a short opening paragraph of plain prose usually reads best: a heading
or a list in the very first lines can make that split land badly. This is a reading tip, not a rule —
if a heading genuinely reads better for this turn, use one.

## Evidence, if you show any

- Evidence near the end of the answer is easier to scan than evidence at the top — that is a
  preference, not a requirement.
- One capture per finished item; label each in the markdown alt text **and** in `caption`.
- What is worth showing depends on the work, and some turns want nothing at all: a GUI change
  reads best as a picture of the screen; a backend, CLI or RAG change usually reads best as text -
  the command and what it printed; a turn that changed nothing observable needs no evidence.
- A check that wrote a result file is worth a markdown link to
  `.generated_artifacts/captures/evidence/<sid8>/<sid8>_<check>.<ext>` (the path the check returned).

## How to capture, when you do

`computer_screen_capture(target={...}, caption='...')`

- Capture the finished state; a work-in-progress shot proves nothing.
- `target.kind` is `tab`, `window` or `screen`; a target you do not pass means `screen`, and anything
  the box does not understand is dropped.
- Tab: `{'kind': 'tab', 'url': '127.0.0.1:5173'}` or `{'kind': 'tab', 'title': 'Runs'}` — name enough
  of the url so exactly one tab matches. On `ambiguous`, read the box's message and narrow the target
  instead of calling it "capture failed".
- Window: `{'kind': 'window', 'windowId': '<id>'}` (or `pid`/`class`/`title`); a window id you do not
  have can be read from a screen capture. Stop a running recording first
  (`computer_screen_record(action='stop')`).
- Never a bare desktop shot, never a window showing only wallpaper, never a picture of your editor.
- Image markdown, when you do show one:
  `![<feature it proves>](.generated_artifacts/captures/<kind>/<sid8>/<sid8>_<step>_<slug>.<ext>)` —
  relative to the workspace root, the path the capture returned.
- Result file: a markdown link, one per check you ran. Quote the exact command and its real observed
  result in the text; an image supports the words, it does not replace them.

## Worked example — the owner's own accepted turn (9481bf87)

He called this one right: "được model quyết định theo công việc chứ không theo 1 form gốc". Shape
only; the words are yours: one natural opening line ("Đã gắn xong gói bằng chứng sống vào lượt này…"),
then the ONE part that turn needed (**Đã làm.** — two bullets with real commands and real files), a
short prose paragraph recalling the system, then the evidence block near the end — each image
labelled with the feature it proves, then the result-file link, then the PR link and one question
waiting for his decision.

## Honesty

- A turn that produced nothing observable says so; it does not need an image.
- Never fabricate an image, never present an older capture as the finished state of this turn.
- If a check could not run, say which one and why. An honest gap beats a fabricated success.
