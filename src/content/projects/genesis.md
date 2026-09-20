---
title: Genesis
summary: "A pixel-art world that rebuilds itself from scratch every day: seeded terrain and rivers, A*-routed roads, a self-pacing 24-hour construction timeline, and a hand-rolled canvas renderer holding a 4 ms frame budget."
tech: [TypeScript, React, Astro, Canvas 2D, Procedural generation]
status: public
repo: https://github.com/CodeManEthan/genesis
screenshot: /screenshots/genesis.png
featured: true
order: 8
---

## Overview

Genesis is a procedurally generated valley that lives exactly one day. It has
its own page on this site. Today's date is hashed into a seed; the seed generates the
terrain, the river and lakes, the forests, the roads, and every building the
day will contain; and a deterministic timeline paces that construction across
twenty-four hours of the visitor's own clock. One house at midnight, towns and
a highway by evening, dark again at midnight so the next date's valley can
rise. Nothing is stored and nothing is downloaded — give the same date to any
browser on earth and you get the same valley at the same hour, down to the
cart on the bridge.

## How it works

The valley is not stored anywhere. Today's date is hashed into a seed, the seed
generates the terrain, the river, the roads and every building the day will
contain, and a timeline paces that build across twenty-four hours. Nothing is
downloaded and nothing is remembered: give the same date to any browser on
earth and you get the same valley, at the same hour, down to the cart on the
bridge.

Because the clock is your clock, the world you land on is the world your day
has got to. Scrub it to watch the whole day in a few seconds, raise the `pace`
to see how much more the same twenty-four hours could have held, or stay until
midnight: the light goes, and the next date's valley comes up in its place on
one house.

The towns are the world's own. Their names come out of the same seed as their
streets, and they are deliberately *not* project markers. I would rather the
front door be a place than a diagram. The projects have
[a list of their own](/#projects), where a link is a link.

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

Live on its own page. The generator, timeline,
renderer, and test harnesses live in their own public repository, which this
site installs as a package.
