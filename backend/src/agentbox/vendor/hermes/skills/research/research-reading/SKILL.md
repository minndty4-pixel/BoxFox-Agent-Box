---
name: research-reading
description: Read sources with context and extraction limits.
---
# Research Reading Skill

Read the source itself, with enough surrounding text to interpret an excerpt. Preserve version, locator and extraction limits.

## When to Use

Use after locating a source and before citing it in a conclusion or `source_add` row.

## Prerequisites

Have the original URL or supplied document and a question the passage is meant to answer. Use `web_fetch`, `read_source` or `file_read` as appropriate.

## How to Run

1. Open the original document. When `truncated` is true, follow `nextOffset` until the relevant part and limitations are read. For a PDF with `pdfNextPage`, fetch the URL again with `pdfStartPage=pdfNextPage` and an appropriate `pdfPageCount` (at most 40). Use `read_source` offsets to finish text within each extracted page window.
2. Inspect the paragraph around a quotation, tables, footnotes, supplement and methods. Record page, section, figure, table, code path or line in `source_add.payload`.
3. Record extraction status: full text, abstract only, scan/OCR, PDF table, reader text or blocked. A snippet never counts as reading the paper.
4. For papers, capture task, modality, dataset and split, baseline, metric, compute condition, limitations, code/checkpoint and publication state.
5. For repositories, open a GitHub search hit's `commitApiUrl`, record the returned SHA, and read relevant paths at that SHA; capture commit, path and code lines. Compare paper claims with code behavior without running experiments.
6. For current regulations, capture number, effective date and status if the source is itself a legal instrument. A workflow observation need not invent these fields.
7. Add the verbatim relevant passage with `source_add`. Preserve uncertainty about anything the visible portion cannot establish.

## Quick Reference

For public OpenReview submissions, use `web_search(source="openreview")`; fetch a hit's `forumApiUrl` and distinguish official review, rebuttal and decision by each note's invitation. The venue label alone is not proof of acceptance.

## Procedure

Compare numbers only under the source's exact conditions. If extraction lost tables or images, describe the missing portion and its effect. If a cited source changed, keep the observed version and time visible.

## Pitfalls

Do not call an abstract “full paper.” Do not infer a benchmark win across different data splits or metrics. Do not treat an unread appendix as if it supports the main claim.

## Verification

A second reader should be able to reopen the source and find the passage from its URL, version and locator.
