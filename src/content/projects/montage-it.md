---
title: Montage-It
summary: Automated collage and video-montage generation pipeline for large photo collections, driven by digiKam metadata and ffmpeg.
tech: [Python, ffmpeg, digiKam, SQLite]
status: soon
order: 7
---

## Overview

A media pipeline that turns a large, tagged photo library into finished collages and video montages automatically. It queries the digiKam photo-management database directly, groups media by date and aspect ratio, and composes layouts without manual curation.

## How it works

- **Metadata-driven** — reads the digiKam SQLite database to select and group photos, so the library's existing tags and albums drive the output.
- **Aspect-aware layout** — images are measured and categorized by aspect ratio so collage cells fit their contents.
- **Video support** — `ffprobe` extracts video metadata and `ffmpeg` renders montages that mix stills and clips.
- **Shared core** — collage and montage generation share one common module for database queries, dimension detection, and date extraction.
