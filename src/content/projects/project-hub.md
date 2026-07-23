---
title: Project Hub
summary: Flutter application for hierarchical project management with a flexible metadata system and scope-based field organization.
tech: [Flutter, Dart, Google Drive sync]
status: soon
screenshot: /screenshots/project-hub.png
order: 6
---

## Overview

Project Hub is a Flutter application for hierarchical project management: Projects contain SubProjects, which contain Features, which contain Steps. Every item type supports flexible metadata fields that can be global or scoped to a specific level of the hierarchy.

## Highlights

- **Universal metadata system** — define custom fields once and attach them anywhere, with a three-tier Default / Starred / Available organization in the UI.
- **Responsive layout** — auto-managed 1–4 column layout that adapts to window size.
- **Cross-platform sync** — single-button Google Drive sync with smart conflict resolution, plus a fully functional local-only mode with no cloud dependency.
- **Undo/redo** — comprehensive action history with recovery, and context-aware deletion safeguards.

## Development approach

Built with an atomic-phase development process: every phase does exactly one thing and leaves the app working, capped at two hours — a workflow designed for sustainable multi-session development.
