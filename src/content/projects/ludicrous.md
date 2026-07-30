---
title: Ludicrous
summary: Games at impossible scale — War and Blackjack with up to 100 players and 100 decks, simulated in seconds, then played back in the browser like a video with a scrubber, live table, and batch statistics.
tech: [Python, stdlib-only, JavaScript, Canvas]
status: public
repo: https://github.com/CodeManEthan/ludicrous
screenshot: /screenshots/ludicrous.png
order: 5
---

## Overview

Ludicrous (formerly a Tkinter War game) takes games meant for a kitchen table and expands them far beyond what could ever be played in real life: 100 players, 100 decks, a million rounds, thousands of games in parallel. A dependency-free Python engine simulates the entire game in seconds; the browser plays it back at any speed — scrub it like a video, step round by round, or jump to the eliminations.

## Highlights

- **Two games** — War (pure luck, up to 100 players) and Blackjack (multi-seat vs the dealer, S17, 3:2 blackjacks, doubling, pair splitting).
- **Pluggable strategies** — assign hit/stand policies per Blackjack seat and chart EV per hand by strategy over hundreds of thousands of hands; basic strategy validates at published EV.
- **Video-style playback** — play/pause, 1 to 5,000 rounds/sec, a scrubber, single-round stepping, and "pause on eliminations", with real card faces and a card-count chart you can click to seek.
- **Batch statistics** — thousands of games in parallel across CPU cores; histograms of game lengths, wins by seat, and outlier games you can replay card by card from their seed.
- **Reproducible** — seeded RNG makes every game shareable as a URL; recordings export as JSON from the CLI and import in the browser.
- **Stdlib only** — the engine, server, and batch runner use nothing outside the Python standard library.
