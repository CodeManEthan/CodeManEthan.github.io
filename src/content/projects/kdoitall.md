---
title: kdoitall
summary: KDE Plasma workspace automation — define a workspace once, then open and arrange every application across screens and virtual desktops with one command.
tech: [Bash, SQLite, KDE Plasma, Wayland, X11]
status: public
repo: https://github.com/CodeManEthan/kdoitall
featured: true
order: 3
---

## Overview

kdoitall automates workspace management on KDE Plasma. Define a workspace as a collection of applications, assign each one a screen, virtual desktop, and window position, then open and close the entire workspace with a single command. Individual windows can also be manipulated on the fly without defining a workspace.

## Highlights

- **Multi-screen, multi-desktop** — place windows on specific screens and virtual desktops, on both Wayland and X11.
- **28 window position presets** — fullscreen, halves, thirds, quadrants, and finer splits via config.
- **Application registry** — auto-detects installed applications from `.desktop` files.
- **Custom launch functions** — per-application launch behavior through an app-definitions system.
- **Database-driven state** — SQLite-backed tracking of workspaces, applications, and window state.

## Engineering notes

Built as a disciplined Bash project: versioned releases with a changelog, a test suite, contribution guidelines, and a documented architecture — proof that shell projects can be maintainable software, not just scripts.
