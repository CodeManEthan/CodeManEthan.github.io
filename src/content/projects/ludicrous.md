---
title: Ludicrous
summary: "Card games at absurd scale: War and Blackjack with 1,000 players, simulated in seconds and played back in the browser with a scrubber, live table and charts. Python engine with a Rust and WebAssembly core."
tech: [Python, Rust, WebAssembly, JavaScript, Canvas]
status: public
repo: https://github.com/CodeManEthan/ludicrous
demo: https://ludicrous-production-6bdb.up.railway.app
screenshot: /screenshots/ludicrous.png
order: 4
---

## Overview

Ludicrous (formerly a Tkinter War game) takes games meant for a kitchen table and expands them far beyond what could ever be played in real life: 1,000 players, 1,000 decks, a hundred million rounds, thousands of games in parallel. A Python engine with a Rust core simulates the entire game in seconds; the browser plays it back at any speed — scrub it like a video, step round by round, or jump to the eliminations.

## Highlights

- **Two games** — War (pure luck, up to 1,000 players) and Blackjack (multi-seat vs the dealer, S17, 3:2 blackjacks, doubling, pair splitting).
- **Pluggable strategies** — assign hit/stand policies per Blackjack seat and chart EV per hand by strategy over hundreds of thousands of hands; basic strategy validates at published EV.
- **Video-style playback** — play/pause, 1 to 5,000 rounds/sec, a scrubber, single-round stepping, and "pause on eliminations", with real card faces and a card-count chart you can click to seek.
- **Batch statistics** — thousands of games in parallel across CPU cores; histograms of game lengths, wins by seat, and outlier games you can replay card by card from their seed.
- **Reproducible** — seeded RNG makes every game shareable as a URL; recordings export as JSON from the CLI and import in the browser.
- **Rust core** — batch runs and in-browser War use a Rust core compiled to WebAssembly.
