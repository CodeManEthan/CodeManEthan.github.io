---
title: PDF Merger & Converter
summary: Web app that merges PDFs and converts documents and images to PDF on the fly, with automatic page numbering and duplex-friendly page alignment.
tech: [Python, Flask, JavaScript, Plugin architecture]
status: soon
screenshot: /screenshots/pdf-merger.png
order: 4
---

## Overview

A web application that merges multiple files into a single PDF. Non-PDF inputs — Markdown, Word documents, HTML, plain text, and images — are automatically converted before merging. Files can be reordered by drag-and-drop, and the output gets automatic page numbering, blank-page insertion after odd-length documents, and front-page alignment for duplex printing.

## Plugin architecture

Converters are plugins auto-discovered from the `converters/` package. Adding support for a new format means dropping in one module that declares its extensions and a convert function — no changes to the core app. Supported today: Markdown (headings, tables, code blocks), `.docx`, HTML, plain text, and seven image formats including multi-frame TIFF/GIF.

## Details

- Drag rows or use arrow buttons to reorder files before merging; merge order always matches the list.
- Page numbers stamped on the bottom-right corner of every page.
- Blank pages inserted so each document starts on the front of a sheet — built for real-world duplex printing.
- Test suite covering the converters and merge pipeline.
