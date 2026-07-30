---
title: Project Hub
summary: Local-first Flutter app for hierarchical project management — Project → SubProject → Feature → Step, with a schemaless, scope-aware metadata system and a three-tier field UI.
tech: [Flutter, Dart, SQLite, Local-first]
status: public
repo: https://github.com/CodeManEthan/project-hub
demo: https://codemanethan.github.io/project-hub/
screenshot: /screenshots/project-hub.png
order: 6
---

## Overview

Project Hub organizes work as a four-level tree — Projects contain SubProjects, which contain Features, which contain Steps — and describes each item with exactly the fields it needs. Everything lives in a local SQLite database: no backend, no account, no network dependency. It runs as a desktop app and in the browser (sqlite compiled to wasm, persisted in IndexedDB).

## The metadata system

The heart of the app: each item carries a free-form metadata map serialized to a single JSON column, so adding a new kind of field never changes the database schema.

- **A curated field catalog** — fourteen typed, validated fields ship out of the box (deadline, priority, difficulty, progress, dependencies, and more).
- **Scope-based organization** — a field can be global or scoped to specific hierarchy levels: deadlines surface at the planning levels, hour estimates at the execution levels.
- **Three-tier field UI** — every field is Default (always visible), Starred (one tap away), or Available (collapsed until requested), so forms stay short without hiding anything.
- **Context-aware validation** — type checks plus cross-field warnings like "progress is 100% but status isn't Completed".

## Engineering notes

Strict adjacent-only hierarchy nesting enforced everywhere, comprehensive undo/redo with recovery, an 89-test suite, and an atomic-phase development process: every phase does exactly one thing and leaves the app working.
