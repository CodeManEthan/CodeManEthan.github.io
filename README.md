# Portfolio

Personal portfolio site — Astro with React islands, deployed to GitHub Pages on every push to `main`.

**Live:** https://codemanethan.github.io

The homepage is **Genesis**: a deterministic, seeded, Canvas-2D isometric pixel world that is born at midnight and dies at midnight. Each calendar day seeds a new valley — settlers arrive, roads route themselves, bridges get piled and decked, and the last roof lands around 21:00 local time no matter how big the world is. The world is weather, not a map of the work; the projects appear as a plain card grid below it.

## Pages

- `/` — Genesis world + project grid (`src/components/GenesisHome.astro`)
- `/days` — archive of the last 14 valleys. Stores nothing: each card re-generates that day's world client-side and paints one deterministic frame at evening
- `/projects/<slug>` — per-project detail page
- `/catalog` — **dev-only** visual inventory of every sprite the simulation can draw. Emits zero paths in production builds; exists so art changes can be eyeballed in one place. Any feature that adds or changes art/sprites/roles/props/day-types must update the catalog in the same change
- `src/pages/_designs/` — the Design Lab: 14 earlier homepage explorations (constellation, terminal, island, archipelago, vale, …). The underscore prefix removes them from routing entirely; they're kept as archive, not shipped

## Adding a project

1. Create `src/content/projects/<slug>.md`:

   ```markdown
   ---
   title: My Project
   summary: One-sentence description shown on the card.
   tech: [Python, Flask]
   status: public          # public | private | soon
   repo: https://github.com/CodeManEthan/my-project   # only if status: public
   demo: https://example.com                          # optional live demo link
   screenshot: /screenshots/my-project.png            # optional
   featured: false         # true adds a "Featured" badge to the card
   order: 8                # lower numbers sort first
   ---

   ## Overview

   The markdown body becomes the project's detail page.
   ```

2. (Optional) Drop a 16:9 screenshot at `public/screenshots/<slug>.png`. Cards without one get a styled placeholder.

3. (Optional) Add a line count to `LOC` in `src/data/islands.ts` — these are hand-maintained and shown on cards and detail pages.

Push to `main` and GitHub Actions rebuilds and deploys the site.

### Status values

- `public` — card links to the GitHub repo (`repo` field required)
- `private` — card shows "Source private · demo on request"
- `soon` — card shows "Repo coming soon" (for projects being cleaned up for release)

## Development

```sh
npm install
npm run dev        # localhost:4321
npm run build      # production build to ./dist/
npm run preview    # preview the production build
```

There is no separate test runner — the Genesis harnesses are the test suite:

```sh
npm run genesis:check   # map + timeline generation: reports, invariants, fixtures
npm run genesis:sweep   # invariants only, across 200 seeds
npm run genesis:perf    # render-perf matrix in real Chrome (needs dev server running;
                        # headless uses SwiftShader, so trust --headed numbers)
```

Also in `scripts/`: `genesis-ab.mjs` / `genesis-ab-png.mjs` (pixel-exact A/B capture and diff of the live canvas), `screenshot.mjs` / `screenshot-zoom.mjs` (puppeteer screenshots), and `build-world.mjs` / `tick-world.mjs` (the Vale's world builder and daily heartbeat — see below). The browser-driving scripts expect Chrome at `/usr/bin/google-chrome` and a dev server on `localhost:4321`.

## Genesis: the rules that matter

- **Determinism is the contract.** The seed is a hash of the UTC date; all randomness goes through `mulberry32`. `gen.ts`, `timeline.ts`, `daytype.ts`, `living.ts`, and `ghost.ts` must stay pure — no DOM, no `Date.now()`, no `Math.random()` — and importable by bare Node 22, so the same seed produces byte-identical worlds in the browser and in the harnesses.
- **Append-only history.** The day-type frequency table, event type ranks, and road trees are append-only, so archived days on `/days` can never change retroactively.
- **Subset stability.** A smaller `?pace=` builds a strict prefix of a larger one.
- **Useful URL params** on `/`: `?seed=`, `?day=`, `?t=` (world hour), `?pace=`, `?speed=`, `?autoplay=1`, `?zoom=`, `?perf=`.

## Structure

- `src/content/projects/` — one markdown file per project (the only thing you touch to add one)
- `src/content.config.ts` — the project frontmatter schema
- `src/pages/index.astro` — homepage (renders `GenesisHome.astro`)
- `src/pages/days.astro` + `designs/genesis/PastDays.tsx` — the archive
- `src/pages/projects/[slug].astro` — detail page template, generated per project
- `src/pages/catalog/[...slug].astro` + `designs/genesis/Catalog.tsx` — dev-only sprite catalog
- `src/components/designs/genesis/` — the world: `gen.ts` (map), `timeline.ts` (the day's arc), `scene.ts` (renderer), `daytype.ts`, `living.ts`, `ghost.ts`, `names.ts`, `TheGenesis.tsx`
- `src/components/designs/vale/art.ts` — the pixel-sprite factories Genesis draws with
- `src/data/islands.ts` — hand-maintained `LOC` counts and per-project accent colors
- `src/data/world.json` — the **Vale's** committed world state, advanced by `tick-world.mjs` (`Vale day NNN: …` commits). The Vale is no longer routed, so this is frozen history unless it's revived
- `.github/workflows/deploy.yml` — build + deploy to GitHub Pages

## Retired but kept

`Hero3D.tsx` (the old Three.js hero), `ValeHome.astro`, and `ArchipelagoHome.astro` are previous homepages, now unreferenced or reachable only from the unrouted Design Lab.
