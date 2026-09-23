---
name: final-report
description: "Final report: five fixed parts, finished-state image evidence, honest gaps."
version: 1.0.0
author: BoxFox Agent (vòng 23, P1.3)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [report, evidence, screenshots, delivery, communication]
    related_skills: [systematic-debugging, requesting-code-review]
---

# Final Report

## Overview

The final answer to the owner **is** a short report, not a diary of the work. Five parts, in the
same order every time, so the owner can skim: what was done, what is left, what they must decide,
what is unclear, and the evidence.

**Core principle:** prove the finished work with your own words, the real commands you ran, and
finished-state images. Never with adjectives, never with invented output, never with a desktop
screenshot that proves nothing.

## When to Use

- Every turn of the main session that answers the owner. The runtime also carries this shape in its
  prompt (see `FINAL REPORT` there) - this skill is the long form.
- **Not** for a child session: a child returns the parent's result contract, not this report.

## The five parts

1. **What was done** - the finished work. Name the commands you really ran and the files you really
   changed; if you did not run a check, do not imply you did.
2. **What is left** - what is unfinished, skipped, or not run.
3. **What the owner must decide** - only when a decision is really needed; otherwise say there is none.
4. **What is unclear** - open points, assumptions you made, questions to ask back.
5. **Evidence** - the finished-state images, each labelled with the feature it proves, plus links to
   the test-result files.

Write it in the language you are answering in. Keep it short: a few lines per part. Markdown only -
headings, lists, images and links.

A short example of the shape (the words are yours, the order is not):

```markdown
**What was done.** Added the capture target contract: `computer_screen_capture` now takes
`target={kind, url|title|windowId|tabId}` and `caption`. Ran `pytest backend/tests/unit -q` ->
1080 passed, 1 pre-existing failure.

**What is left.** Live acceptance of the label suffix in the image file names.

**What you must decide.** Whether window captures should also be allowed while a recording is on.

**What is unclear.** Whether the box's tab enumerator sees tabs in other windows.

**Evidence.**
![Tab capture of the runs page, with the label in the file name](.generated_artifacts/captures/tab/2e4f1a20/2e4f1a20_007_tab-3f9a2b1c-runs-page.png)
- Test log: `.generated_artifacts/captures/evidence/2e4f1a20/2e4f1a20_009_pytest-result.txt`
```

## Images: capture the FINISHED state

- Capture at the report step, when the work is done - not while you are still editing. A
  work-in-progress shot is not evidence.
- One capture = one finished item of the owner's request. If an item has several faces (list + detail
  panel), take several shots; if you finished three items, take three shots.
- Label each image with the feature it proves. The label goes in the markdown alt text **and** in the
  `caption` you pass to the capture, so the file name on disk says the same thing.
- Never a bare desktop shot, never a window that shows only the wallpaper, never a picture of your
  editor. If the picture does not prove a finished item, do not put it in the answer.

## Evidence by kind of work

| Work | What proves it |
| --- | --- |
| GUI / frontend / web | The tab that renders the change after the change: `computer_screen_capture(target={'kind': 'tab', 'url': '<url>'}, caption='<feature>')`. |
| Backend / RAG / CLI | The real test run, then a capture of the returned result (its text output) **and** the result file saved under `.generated_artifacts/captures/evidence/<sid8>/<sid8>_<step>_<slug>.txt`. |
| Desktop app in the sandbox | A window capture of the app after the change: `target={'kind': 'window', 'windowId': '<id>'}`. |
| A change with nothing observable | No image. Say so in "what is unclear" / "what is left". |

## Embedding the evidence in the answer

The answer carries the evidence itself - the owner should not have to open another panel:

- Image: `![<feature it proves>](.generated_artifacts/captures/<kind>/<sid8>/<sid8>_<step>_<slug>.<ext>)` -
  relative to the workspace root, the same path the capture returned.
- Result file: a markdown link with the path, one per check you ran.
- Quote the exact command and its real observed result in the text; the image supports the words, it
  does not replace them.

## How to capture

`computer_screen_capture(target={...}, caption='...')`

- `target.kind` is `tab`, `window` or `screen`. A target you do not pass means `screen`; anything the
  box does not understand is dropped and you get a screen capture.
- Tab: `{'kind': 'tab', 'url': '127.0.0.1:5173'}` or `{'kind': 'tab', 'title': 'Runs'}`. Several tabs
  often match a short url: name more of it (a path, a hash) so exactly one matches.
- If the box answers `ambiguous` or names a conflict, it is telling you the truth - never swallow it
  into "capture failed". Read its message, then narrow the target (`url`, `title`, `class`) or take
  `{'kind': 'screen'}` first, look at what is on the display, and capture the right tab by its url.
- Window: `{'kind': 'window', 'windowId': '<id>'}` (or `pid` / `class` / `title`); a window id you do
  not have can be read from a screen capture.
- A recording in progress conflicts with a window capture: stop the recording
  (`computer_screen_record(action='stop')`) before you take the report images.
- `caption` is the label of that one shot (keep it short). It becomes the file name suffix and the
  alt text.

## Honesty

- A turn that produced nothing observable must say so under "what is unclear" / "what is left".
  Never fabricate an image, never reuse an older capture as if it were the finished state.
- If a check could not run, say which one and why. A report with an honest gap is worth more than a
  report with a fabricated success.
