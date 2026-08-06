---
title: Genesis
summary: The valley above. A pixel-art world this site rebuilds from scratch every day — seeded terrain and rivers, A*-routed roads, a self-pacing 24-hour construction timeline, and a hand-rolled canvas renderer holding a 4 ms frame budget.
tech: [TypeScript, React, Astro, Canvas 2D, Procedural generation]
status: public
repo: https://github.com/CodeManEthan/CodeManEthan.github.io
screenshot: /screenshots/genesis.png
featured: true
order: 7
---

## Overview

Genesis is this website's homepage: a procedurally generated valley that lives
exactly one day. Today's date is hashed into a seed; the seed generates the
terrain, the river and lakes, the forests, the roads, and every building the
day will contain; and a deterministic timeline paces that construction across
twenty-four hours of the visitor's own clock. One house at midnight, towns and
a highway by evening, dark again at midnight so the next date's valley can
rise. Nothing is stored and nothing is downloaded — give the same date to any
browser on earth and you get the same valley at the same hour, down to the
cart on the bridge.

## Highlights

- **The world is a pure function** — `world = f(seed, t)`. Every consequence
  (a bridge, a gold strike, a festival) is decided from the seed by the
  generator and timeline; the ambient layer only performs it. Replays are
  identical; paused renders are pixel-deterministic.
- **Self-pacing timeline** — a bisection search tunes the day's tempo so the
  last roof lands in the final hours of the evening on any map size, from a
  quarter-scale hamlet pair to sixteen towns.
- **Subset stability** — raising the world's pace generates the full large
  roster and trims it, so the same seed at a higher pace keeps identical
  terrain and founding towns and simply builds more.
- **A living world on a frame budget** — day/night, weather and rare day
  types (storms, eclipses, floods), wildlife, boats, prospectors and
  festivals, all inside a hard render budget of ~4 ms per frame, enforced by
  a performance harness.
- **Harness-verified determinism** — invariant sweeps across hundreds of
  seeds and a timeline suite of 60+ cases gate every change; paused-state
  screenshot diffing catches unintended pixel drift.

## Status

Live — it's the front page of this site. The full source, including the
generator, timeline, renderer, and test harnesses, is in the site's public
repository.
