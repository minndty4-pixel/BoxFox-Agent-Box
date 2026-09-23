---
name: final-report
description: "Final answer: a light menu of parts, a plain-prose opening, and the finished-state image evidence that closes the answer."
version: 2.0.0
author: BoxFox Agent (vòng 24, D-31)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [report, evidence, screenshots, delivery, communication]
    related_skills: [systematic-debugging, requesting-code-review]
---

# Final Report — the answer guide

## Overview

The final answer is a normal answer to the owner, not a form. Its shape is a **light menu**: pick the
parts that fit this turn, in the order that reads best. **The evidence part closes the answer, and it
is the most important part of the answer.** No mandatory order, no fixed number of parts.

## When to open it

- Main session, when the turn produced work or something to show: the prompt carries one hard evidence
  line for that turn, and the turn recap points here. Skip it when the turn is a plain question — a
  question gets a normal answer, not a report.
- Not for a child session: a child returns the parent's result contract.

## The menu, not a template

- **What you did** — the finished work, with the real commands you ran and the real files you changed;
  if you did not run a check, do not imply you did.
- **What is left** — only when something really is unfinished, skipped or not run.
- **What the owner must decide** — only when a decision is really needed.
- **What is unclear** — open questions and assumptions, only when there are any.
- **Evidence** — the finished-state captures that prove each item, one label per image, plus links to
  the evidence files. Not optional when the turn produced something observable.

Pick by content, not habit: a turn that changed one file and ran one test opens with the outcome,
shows `What you did`, and closes with the evidence. **Never print an empty part** — drop it instead.
Never invent a command or a file.

## The opening paragraph

Start with ONE short paragraph of plain prose (one or two sentences) that states the outcome, then the
parts you picked — no markdown heading and no bullet list in that first paragraph.

Why: the chat shows that first paragraph as the collapsed summary of the turn and holds the rest
behind **"View details"**. An answer that opens with a heading or a list breaks that split, and the
owner sees a raw cut of the text instead of a summary.

## The evidence part closes the answer

- The evidence goes at the END, after the other parts — never in the middle, never at the top. It is
  the part that proves the turn: the owner reads the words, then sees the finished state.

## Evidence by kind of work

| Work | What proves it |
| --- | --- |
| GUI / frontend / web | The tab that renders the change: `computer_screen_capture(target={'kind': 'tab', 'url': '<url>'}, caption='<feature>')`. |
| Backend / RAG / CLI | The real test run, then a capture of the returned result **and** the result file under `.generated_artifacts/captures/evidence/<sid8>/<sid8>_<step>_<slug>.txt`. |
| Desktop app in the sandbox | A window capture after the change: `target={'kind': 'window', 'windowId': '<id>'}`. |
| A change with nothing observable | No image; say so in the evidence part. |

## Embedding the evidence in the answer

- Image: `![<feature it proves>](.generated_artifacts/captures/<kind>/<sid8>/<sid8>_<step>_<slug>.<ext>)` —
  relative to the workspace root, the path the capture returned.
- Result file: a markdown link, one per check you ran. The owner should not have to open another panel.
- Quote the exact command and its real observed result in the text; the image supports the words, it
  does not replace them.

## How to capture

`computer_screen_capture(target={...}, caption='...')`

- Capture at the report step, when the work is done — never a work-in-progress shot.
- One capture = one finished item. Items with several faces get several shots; label each with the
  feature it proves, in the markdown alt text **and** in `caption`.
- `target.kind` is `tab`, `window` or `screen`; a target you do not pass means `screen`, and anything
  the box does not understand is dropped.
- Tab: `{'kind': 'tab', 'url': '127.0.0.1:5173'}` or `{'kind': 'tab', 'title': 'Runs'}` — name enough
  of the url so exactly one tab matches. On `ambiguous`, read the box's message and narrow the target
  instead of calling it "capture failed".
- Window: `{'kind': 'window', 'windowId': '<id>'}` (or `pid`/`class`/`title`); a window id you do not
  have can be read from a screen capture. Stop a running recording first
  (`computer_screen_record(action='stop')`).
- Never a bare desktop shot, never a window showing only wallpaper, never a picture of your editor.

## Worked example — the owner's own accepted turn (9481bf87)

He called this one right: "được model quyết định theo công việc chứ không theo 1 form gốc". Shape
only; the words are yours: one natural opening line ("Đã gắn xong gói bằng chứng sống vào lượt này…"),
then the ONE part that turn needed (**Đã làm.** — two bullets with real commands and real files), a
short prose paragraph recalling the system, then the evidence block **at the end** — each image
labelled with the feature it proves, then the result-file link, then the PR link and one question
waiting for his decision.

## Honesty

- A turn that produced nothing observable says so in the evidence part. Never fabricate an image,
  never reuse an older capture as if it were the finished state.
- If a check could not run, say which one and why. An honest gap beats a fabricated success.
