/**
 * The Road Down the Page — the ground, the road and the sea.
 *
 * The whole page below the valley is one world, and the one rule that makes it
 * hold together is this: **every mark is a pure function of its absolute world
 * coordinate.** Nothing is drawn relative to the tile it happens to land on.
 * The page is painted onto a stack of canvases for the sake of memory, but a
 * tile only ever asks "what is at world y = 1840?" and gets the same answer its
 * neighbour got, so the seam between two tiles is not a seam at all — it is
 * just the place where one canvas stops asking and the next one starts.
 *
 * Coordinates are Genesis's own: 1 unit = 1 art pixel, the page is upscaled by
 * a whole number at blit time, and no context is ever scaled (art.ts's `poly`
 * snaps spans to whole pixels and can only do that under an identity
 * transform).
 */

import { PAL, type Ctx, rect, isoTile, mulberry32, mix, shade } from '../vale/art';
import { hashSeed } from '../genesis/types';
import type { Season } from './meta';

/* ------------------------------- the world ------------------------------- */

/** CSS pixels per art pixel. The world is drawn small and blown up whole. */
export const SCALE = 2;

/** Height of one canvas tile, in art pixels. */
export const TILE_H = 360;

export interface World {
  /** Width of the page, in art pixels. */
  w: number;
  /** Height of the whole road, in art pixels. */
  h: number;
  /** Art-pixel y where the sand starts. */
  shoreY: number;
  season: Season;
}

/* ------------------------------ the road line ---------------------------- */

/**
 * A road running straight down the screen is not a departure from Genesis's
 * isometric world — it is the line `gx == gy` in it, which projects to a
 * constant screen x. So the road can wander in tile space and still read as the
 * same road the valley builds, and these are its own proportions: Genesis
 * strokes a highway at half-width 0.62 tiles, which is 0.62 * sqrt(2) * 16
 * screen pixels when it runs down the page. This is the trunk road out of the
 * valley, so it is stroked a little wider than that.
 */
const ROAD_HALF_TILES = 1.0;
/** Perpendicular tile units → screen pixels, for a road heading down-screen. */
const PERP = Math.SQRT2 * 16;

/** The four strips, in Genesis's own order and ratios (see scene.ts paintRoad). */
export const CARRIAGE = ROAD_HALF_TILES * PERP; // half-width, art px
export const VERGE = (ROAD_HALF_TILES + 0.55) * PERP;
const EDGE = (ROAD_HALF_TILES + 0.16) * PERP;
const CENTRE = ROAD_HALF_TILES * 0.42 * PERP;
/** Where a cart's wheels fall, either side of the crown. */
const RUT = CARRIAGE * 0.63;

const ROAD_VERGE_COL = mix(PAL.grassEdge, PAL.dirt, 0.55);

/** How far the road is allowed to stray from the middle of the page. */
const WANDER = 12;

const ROAD_SEED = hashSeed('roaddown:the-road');

/** Three phases, fixed for the life of the road, so the wander never repeats. */
const PH = (() => {
  const r = mulberry32(ROAD_SEED);
  return [r() * 6.283, r() * 6.283, r() * 6.283];
})();

/**
 * The centre of the carriageway at any point down the page. Smooth, seeded,
 * and — the part that matters — dependent on nothing but `y`.
 */
export function roadCx(world: World, y: number): number {
  const a = Math.sin(y / 190 + PH[0]) * 0.62;
  const b = Math.sin(y / 77 + PH[1]) * 0.26;
  const c = Math.sin(y / 41 + PH[2]) * 0.12;
  return world.w / 2 + (a + b + c) * WANDER;
}

/* --------------------------------- ground -------------------------------- */

/** Small integer hash, for per-tile jitter that never has to be stored. */
function ihash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Genesis's own four jitter steps (scene.ts, the ground bake). */
const JIT = [0, -0.035, 0.04, -0.015];

/** Genesis's own season wash (scene.ts `seasonGround`). */
function seasonGround(hex: string, season: Season): string {
  switch (season) {
    case 'winter':
      return mix(hex, '#c6d4d1', 0.46);
    case 'spring':
      return mix(hex, '#b8e28c', 0.24);
    case 'autumn':
      return mix(hex, '#d6ba74', 0.36);
    default:
      return hex;
  }
}

/**
 * How far the valley's own woodland reaches down into the page.
 *
 * The hero above ends on Genesis's off-map surround — dark conifer green,
 * `#3f7f66` under a forest pattern — so the road world starts in that same
 * wood and walks out of it. Without this the page began with a hard line where
 * one canvas stopped and a bright meadow started, which is the one join this
 * design cannot afford to get wrong.
 */
export const VALLEY_EDGE = 230;

/** Genesis's own off-map colour (scene.ts, `beyond`). */
const BEYOND = '#3f7f66';

/** A slow blend between meadow, farm and woodland down the length of the road. */
function groundTint(world: World, cx: number, cy: number): string {
  const n = Math.sin(cy / 260 + 1.1) * 0.5 + Math.sin(cx / 150) * 0.3;
  let base =
    n > 0.34
      ? mix(PAL.biome.meadow, PAL.biome.farm, Math.min(1, (n - 0.34) * 1.6))
      : n < -0.3
        ? mix(PAL.biome.meadow, PAL.biome.forest, Math.min(1, (-n - 0.3) * 1.5))
        : PAL.biome.meadow;

  if (cy < VALLEY_EDGE) {
    // Squared, so the wood holds its colour at the very top and then lets go
    // quickly — the eye reads that as distance, not as a fade.
    const t = 1 - cy / VALLEY_EDGE;
    base = mix(base, BEYOND, Math.min(0.94, t * t * 1.2));
  }

  return seasonGround(base, world.season);
}

/**
 * The meadow, as isometric tiles on Genesis's own 32×16 grid.
 *
 * Tile centres sit at (16a, 8b) for integers a, b of the same parity — that is
 * the whole of the iso lattice, and stating it that way means a tile can be
 * addressed straight from its screen position without ever building a map.
 */
export function paintGround(ctx: Ctx, world: World, y0: number, y1: number): void {
  const b0 = Math.floor(y0 / 8) - 2;
  const b1 = Math.ceil(y1 / 8) + 2;
  const a0 = -2;
  const a1 = Math.ceil(world.w / 16) + 2;

  for (let b = b0; b <= b1; b++) {
    const cy = b * 8;
    for (let a = a0; a <= a1; a++) {
      if (((a ^ b) & 1) !== 0) continue; // same parity only
      const cx = a * 16;
      const h = ihash(a, b);
      let col = shade(groundTint(world, cx, cy), JIT[h & 3]);
      // A scatter of bare, sun-dried patches, as the valley has.
      if ((h >>> 5) % 47 === 0) col = mix(col, PAL.dirtPale, 0.3);
      isoTile(ctx, cx, cy, col);
    }
  }
}

/* ---------------------------------- road --------------------------------- */

/**
 * The carriageway, drawn a scanline at a time.
 *
 * Genesis strokes its roads as quad strips along a polyline, which is right for
 * a road that bends across the map; this one only ever runs down the page, so a
 * row at a time gives the same four bands with a clean pixel edge and — the
 * reason it is done this way — an edge that is decided entirely by `y`.
 */
export function paintRoad(ctx: Ctx, world: World, y0: number, y1: number): void {
  const top = Math.max(0, Math.floor(y0));
  const bot = Math.min(world.shoreY + 10, Math.ceil(y1));

  for (let y = top; y <= bot; y++) {
    const cx = roadCx(world, y);
    // Below the tide line the road is wet sand, not dirt: it does not simply
    // stop at the water, it is taken by it.
    const drowned = y > world.shoreY - 8;
    if (drowned) continue;
    rect(ctx, cx - VERGE, y, VERGE * 2, 1, ROAD_VERGE_COL);
    rect(ctx, cx - EDGE, y, EDGE * 2, 1, PAL.dirtEdge);
    rect(ctx, cx - CARRIAGE, y, CARRIAGE * 2, 1, PAL.dirt);
    rect(ctx, cx - CENTRE, y, CENTRE * 2, 1, PAL.dirtPale);
    // Two wheel ruts worn either side of the crown. Genesis's roads are short
    // and bend, so they read as roads without them; this one runs straight down
    // the page for four thousand pixels and needs the grain.
    rect(ctx, cx - RUT - 1, y, 2, 1, PAL.dirtAlt);
    rect(ctx, cx + RUT - 1, y, 2, 1, PAL.dirtAlt);
  }
}

/** Loose stones, seeded per 64-pixel band so two tiles agree on the overlap. */
export function paintRoadStones(ctx: Ctx, world: World, y0: number, y1: number): void {
  const BAND = 64;
  const first = Math.floor(y0 / BAND) - 1;
  const last = Math.floor(y1 / BAND) + 1;

  for (let band = first; band <= last; band++) {
    const rr = mulberry32(ROAD_SEED ^ (band * 0x9e3779b1));
    for (let i = 0; i < 26; i++) {
      const y = band * BAND + rr() * BAND;
      if (y < 0 || y > world.shoreY - 10) {
        rr();
        rr();
        continue;
      }
      const off = (rr() - 0.5) * 2 * CARRIAGE * 1.15;
      rect(ctx, roadCx(world, y) + off, y, 2 + rr() * 3, 1, PAL.dirtEdge);
    }
  }
}

/* ---------------------------------- sea ---------------------------------- */

/** Where the sand meets the water, at a given x. Gentle, and a pure function. */
export function shoreAt(world: World, x: number): number {
  return (
    world.shoreY +
    Math.sin(x / 90 + 0.7) * 9 +
    Math.sin(x / 31 + 2.1) * 3.5 +
    Math.sin(x / 13) * 1.2
  );
}

/**
 * Beach, surf and open water, a column at a time.
 *
 * Genesis has no sea — it has a river and lakes — so this is its river banding
 * (sand, dark sand, deep, mid, light, foam) turned through ninety degrees and
 * given a tide line. The palette is the valley's own, down to the foam.
 */
export function paintSea(ctx: Ctx, world: World, y0: number, y1: number): void {
  if (y1 < world.shoreY - 40) return;

  const sandDark = shade(PAL.sand, -0.12);
  const deepFrom = 78;
  /** Depth of dry beach above the tide line, in art pixels. */
  const BEACH = 54;

  for (let x = 0; x < world.w; x++) {
    const s = shoreAt(world, x);

    // Dry sand runs a little way up the beach before the tide line.
    const dryTop = s - BEACH;
    if (dryTop < y1 && s > y0) rect(ctx, x, dryTop, 1, s - dryTop, PAL.sand);
    if (s - 5 < y1 && s > y0) rect(ctx, x, s - 5, 1, 5, sandDark);

    const end = Math.max(y1, world.h) + 8;
    if (s < y1) {
      rect(ctx, x, s, 1, end - s, PAL.water);
      rect(ctx, x, s, 1, 3, PAL.waterFoam);
      rect(ctx, x, s + 3, 1, 11, PAL.waterLight);
      if (s + deepFrom < end) rect(ctx, x, s + deepFrom, 1, end - s - deepFrom, PAL.waterDeep);
    }
  }

  // Foam streaks further out, seeded per band so tiles agree.
  const BAND = 48;
  for (let band = Math.floor(y0 / BAND) - 1; band <= Math.floor(y1 / BAND) + 1; band++) {
    const rr = mulberry32(0x5ea0 ^ (band * 0x9e3779b1));
    for (let i = 0; i < 14; i++) {
      const y = band * BAND + rr() * BAND;
      const x = rr() * world.w;
      const len = 3 + rr() * 9;
      if (y > shoreAt(world, x) + 16 && y < world.h + 8) {
        rect(ctx, x, y, len, 1, rr() > 0.45 ? PAL.waterFoam : PAL.waterLight);
      }
    }
  }
}

/* -------------------------------- scatter -------------------------------- */

/** A rectangle in world coordinates — a village's patch of ground. */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scatter {
  /** The pre-built sprite library, indexed by the scatter's `kind`. */
  lib: { c: HTMLCanvasElement; ox: number; oy: number }[];
}

/**
 * Roadside planting — the same seeded scatter Genesis puts along its own verges,
 * banded by absolute y so it is identical no matter which tile draws it.
 *
 * Anything inside a village's own ground is skipped: the village lays out its
 * own trees and would otherwise be growing them through its roofs.
 */
export function paintScatter(
  ctx: Ctx,
  world: World,
  y0: number,
  y1: number,
  lib: Scatter['lib'],
  conifers: Scatter['lib'],
  claimed: WorldRect[]
): void {
  const BAND = 56;
  for (let band = Math.floor(y0 / BAND) - 2; band <= Math.floor(y1 / BAND) + 2; band++) {
    const rr = mulberry32(0x5caf ^ (band * 0x85ebca6b));
    // Five ordinary plantings a band, plus up to twenty-five conifers that only
    // exist near the top — the valley's wood, thinning out as the road leaves
    // it. Dense enough at the very top to carry on from the hero's own tree
    // cover rather than merely gesturing at it.
    for (let i = 0; i < 30; i++) {
      const y = band * BAND + rr() * BAND;
      const x = rr() * world.w;
      const pick = rr();

      const wooded = i >= 5;
      if (wooded) {
        // Held near-solid for the first stretch, then let go quickly.
        const density = y < VALLEY_EDGE ? Math.pow(1 - y / VALLEY_EDGE, 0.75) : 0;
        if (i - 5 >= Math.round(25 * density)) continue;
      }
      const pool = wooded ? conifers : lib;
      const k = Math.floor(pick * pool.length);
      if (y < 6 || y > shoreAt(world, x) - 14) continue;

      // Never in the carriageway, and only rarely right on the verge.
      const d = Math.abs(x - roadCx(world, y));
      if (d < VERGE + 6) continue;

      let skip = false;
      for (const c of claimed) {
        if (x > c.x - 12 && x < c.x + c.w + 12 && y > c.y - 10 && y < c.y + c.h + 10) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      const sp = pool[k];
      ctx.drawImage(sp.c, Math.round(x - sp.ox), Math.round(y - sp.oy));
    }
  }
}
