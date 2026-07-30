---
title: Docist
summary: Self-hosted document toolkit — merge PDFs with automatic conversion of ~19 input formats, convert files between ~150 format pairs, page tools, OCR, watermarking and AES-256 password protection, in six browser tools plus a REST API.
tech: [Python, Flask, JavaScript, Tesseract OCR, Plugin architecture]
status: public
repo: https://github.com/CodeManEthan/docist
screenshot: /screenshots/docist.png
featured: true
order: 4
---

## Overview

Docist (formerly "PDF Merger") is a self-hosted document toolkit that grew from one merge page into six browser tools and a versioned REST API: Merge & Convert, Convert Files, Page Tools, Print Prep, Export, and Watermark & Security. Non-PDF inputs — Markdown, Word documents, spreadsheets, HTML, SVG, and a dozen image formats — are converted automatically on the way in.

## Plugin architecture

Converters (`anything → PDF`) and transforms (`anything → anything`) are auto-discovered modules — adding a format means dropping in one file, no registry to edit. When no direct transform exists, the registry pivots through PDF automatically, so `DOCX → PNG` works without anyone writing it.

## Highlights

- **Page thumbnails throughout** — every PDF in the merge list shows its first page, and Page Tools renders a clickable grid of the whole document that fills the page-range box for you.
- **Duplex-friendly merging** — automatic page numbering, bookmarks per source file, and blank-page insertion so every document starts on the front of a sheet.
- **OCR** — make scanned PDFs searchable via OCRmyPDF/Tesseract, or extract text straight from images.
- **Hardened for deployment** — optional login gate, per-IP rate limiting, magic-byte content sniffing on uploads, traversal-proof downloads, and per-request temp directories.
- **767 tests** — 559 backend (pytest) and 208 frontend (`node:test`), covering every converter, transform, route and hardening rule.
