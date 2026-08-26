/**
 * The Long Road — rasteriser.
 *
 * Every pixel below comes out of the valley's own art: `vale/art.ts` for the
 * sprites and the palette, `genesis/scene.ts` for the road strips and the
 * seasonal sprite pools. Nothing new is drawn from scratch except three things
 * that are pure motion and were never sprites anywhere — chimney smoke, the
 * beacon fire (which is `drawBonfire`, lifted onto a ridge) and the hover
 * outline. That is the whole point of the design: the same world, closer up.
 *
 * The band is drawn at ART resolution and blitted to the screen at an integer
 * magnification with smoothing off, exactly as the hero world is, so a pixel
 * is a pixel.
 */

import {
  PAL,
  buildCrane,
  buildMarketStall,
  buildNameBoard,
  buildSignpost,
  buildStake,
  buildStructure,
  buildCattle,
  buildDog,
  buildDuck,
  buildDeer,
  buildGrazingSheep,
  buildHorse,
  buildBird,
  drawBonfire,
  drawBot,
  drawCart,
  drawCraneLoad,
  drawWheel,
  isoTile,
  mix,
  rect,
  roofPeak,
  shade,
  type Ctx,
  type Sprite,
  type StructureSprite,
} from '@codemanethan/genesis/art';
import { makePools, paintRoad } from '@codemanethan/genesis/scene';
import type { Season } from '@codemanethan/genesis/daytype';
import { mulberry32 } from '@codemanethan/genesis/types';
import { roadYAt, type VBot, type Village } from './village.ts';

const TWH = 16; // TW / 2 — art px per unit of u
const THH = 8; // TH / 2 — art px per unit of v

/** Band screen coords (art px) -> the vale's tile space. */
function tile(x: number, y: number): [number, number] {
  const u = x / TWH;
  const v = y / THH;
  return [(u + v) / 2, (v - u) / 2];
}

/** The ground, one season on — the same four mixes `scene.ts` bakes with. */
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

function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbHex(rgb: [number, number, number]): string {
  const f = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return `#${((f(rgb[0]) << 16) | (f(rgb[1]) << 8) | f(rgb[2])).toString(16).padStart(6, '0')}`;
}

/* --------------------------------- scene --------------------------------- */

interface StaticEnt {
  y: number;
  sp: Sprite;
  x: number;
}

export interface RoadScene {
  v: Village;
  bg: HTMLCanvasElement;
  statics: StaticEnt[];
  /** Chimneys, mill wheels and the beacon — everything that moves on a roof. */
  smokes: { x: number; y: number; seed: number }[];
  wheels: { x: number; y: number }[];
  beacons: { x: number; y: number }[];
  cranes: { x: number; y: number }[];
}

/**
 * The pooled scenery, built once for the whole strip and shared by all seven
 * bands — a hundred oaks share six canvases, as in the valley.
 */
export function buildPools(season: Season): Record<string, Sprite[]> {
  return makePools(season);
}

/** Everything for one band: the baked ground, and the sorted sprite list. */
export function buildScene(
  v: Village,
  pools: Record<string, Sprite[]>,
  season: Season
): RoadScene {
  const bg = document.createElement('canvas');
  bg.width = v.w;
  bg.height = v.h;
  const ctx = bg.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  bakeGround(ctx, v, season);
  bakeRoad(ctx, v);

  const statics: StaticEnt[] = [];
  const smokes: RoadScene['smokes'] = [];
  const wheels: RoadScene['wheels'] = [];
  const beacons: RoadScene['beacons'] = [];
  const cranes: RoadScene['cranes'] = [];

  const pick = (key: string, seed: number): Sprite | null => {
    const p = pools[key];
    return p ? p[Math.abs(seed) % p.length] : null;
  };

  for (const f of v.fields) {
    const sp = pick(f.kind, f.seed);
    if (sp) statics.push({ x: f.x, y: f.y, sp });
  }
  for (const wpanel of v.wall) {
    const sp = pick(wpanel.kind, wpanel.seed);
    if (sp) statics.push({ x: wpanel.x, y: wpanel.y, sp });
  }
  for (const t of v.trees) {
    const sp = pick(t.kind, t.seed);
    if (sp) statics.push({ x: t.x, y: t.y, sp });
  }
  for (const p of v.props) {
    let sp: Sprite | null;
    if (p.kind === 'signpost') sp = buildSignpost(v.accent);
    else if (p.kind === 'nameboard') sp = buildNameBoard(v.accent);
    else if (p.kind === 'stake') sp = buildStake(v.accent, p.seed);
    else if (p.kind === 'crane') {
      sp = buildCrane(v.accent);
      cranes.push({ x: p.x, y: p.y });
    } else sp = pick(p.kind, p.seed);
    if (sp) statics.push({ x: p.x, y: p.y, sp });
  }
  for (const s of v.stalls) {
    statics.push({ x: s.x, y: s.y, sp: buildMarketStall(s.seed, v.accent) });
  }
  for (const a of v.animals) {
    let sp: Sprite;
    switch (a.kind) {
      case 'horse':
        sp = buildHorse(a.grazing ? 1 : 0, a.faceRight, a.seed);
        break;
      case 'cattle':
        sp = buildCattle(a.seed, a.faceRight, a.grazing);
        break;
      case 'dog':
        sp = buildDog(a.grazing ? 1 : 0, a.faceRight);
        break;
      case 'duck':
        sp = buildDuck(0, a.faceRight);
        break;
      case 'deer':
        sp = buildDeer(a.grazing ? 1 : 0, a.faceRight, a.seed);
        break;
      default:
        sp = buildGrazingSheep(a.seed, a.faceRight, a.grazing);
    }
    statics.push({ x: a.x, y: a.y, sp });
  }

  for (const b of v.buildings) {
    const sp: StructureSprite = buildStructure({
      role: b.role,
      accent: b.accent,
      w: b.w,
      floors: b.floors,
      roof: b.roof,
      progress: b.progress,
      condition: 1,
      chimney: b.chimney,
      cupola: b.cupola,
      awning: b.awning,
      banner: b.banner,
      lit: b.lit,
      material: b.material,
      seed: b.seed,
    });
    statics.push({ x: b.x, y: b.y, sp });
    if (sp.smoke && b.progress >= 1) {
      smokes.push({ x: b.x + sp.smoke[0], y: b.y + sp.smoke[1], seed: b.seed });
    }
    if (sp.wheel) wheels.push({ x: b.x + sp.wheel[0], y: b.y + sp.wheel[1] });
    if (b.beacon) beacons.push({ x: b.x, y: b.y - roofPeak(b.w, b.floors, b.roof) - 3 });
  }

  statics.sort((a, b) => a.y - b.y || a.x - b.x);

  return { v, bg, statics, smokes, wheels, beacons, cranes };
}

/* ------------------------------- the ground ------------------------------ */

/**
 * The same diamond grid the valley lays, blended between three biome centres:
 * wood along the top of the band, meadow where the town stands, ploughed
 * ground on the open side the plaque is planted in.
 */
function bakeGround(ctx: Ctx, v: Village, season: Season): void {
  const cx = v.side === 'left' ? v.w * 0.28 : v.w * 0.72;
  const fx = v.side === 'left' ? v.w * 0.78 : v.w * 0.22;
  // Wooded ground at BOTH edges of the band and open ground along the road.
  // Symmetry is the whole trick: the tint a band ends on is the tint the next
  // one starts from, so the fold between two lengths of the same road is a
  // hairline and not a colour step.
  const centres = [
    { u: v.w * 0.3 / TWH, v: -10 / THH, rgb: hexRGB(PAL.biome.forest) },
    { u: v.w * 0.7 / TWH, v: -10 / THH, rgb: hexRGB(PAL.biome.forest) },
    { u: cx / TWH, v: v.roadY / THH, rgb: hexRGB(PAL.biome.meadow) },
    { u: fx / TWH, v: (v.roadY - 10) / THH, rgb: hexRGB(PAL.biome.farm) },
    { u: v.w * 0.3 / TWH, v: (v.h + 10) / THH, rgb: hexRGB(PAL.biome.forest) },
    { u: v.w * 0.7 / TWH, v: (v.h + 10) / THH, rgb: hexRGB(PAL.biome.forest) },
  ];
  const tintAt = (u: number, vv: number): [number, number, number] => {
    let wr = 0;
    let wg = 0;
    let wb = 0;
    let ws = 0;
    for (const c of centres) {
      const du = (u - c.u) * 0.5;
      const dv = vv - c.v;
      const d2 = du * du + dv * dv + 4;
      const wt = 1 / (d2 * d2);
      wr += c.rgb[0] * wt;
      wg += c.rgb[1] * wt;
      wb += c.rgb[2] * wt;
      ws += wt;
    }
    return [wr / ws, wg / ws, wb / ws];
  };

  // A trodden glade under the town, exactly as the valley pales the ground
  // under a site before anything is built on it.
  const hw = (v.hit.w - 44) / 2;
  const tx = v.hit.x + 22 + hw;
  const gladeAt = (x: number, y: number): number => {
    const dx = (x - tx) / (hw + 24);
    const dy = (y - v.roadY) / 52;
    const d = Math.hypot(dx, dy);
    return d < 1 ? Math.min(1, (1 - d) / 0.45) : 0;
  };

  const grng = mulberry32(v.seed ^ 0x9e37);
  const grassEdge = seasonGround(PAL.grassEdge, season);
  const tuft = seasonGround(PAL.leafDark, season);

  const U0 = -3;
  const U1 = Math.ceil(v.w / TWH) + 3;
  const V0 = -3;
  const V1 = Math.ceil(v.h / THH) + 3;
  for (let vv = V0; vv <= V1; vv++) {
    for (let u = U0; u <= U1; u++) {
      if ((u + vv) & 1) continue;
      const sx = u * TWH;
      const sy = vv * THH;
      const [gx, gy] = tile(sx, sy);
      const n =
        Math.sin(gx * 0.29 + gy * 0.17) * 0.5 +
        Math.sin(gx * 0.11 - gy * 0.31) * 0.3 +
        Math.sin((gx + gy) * 0.21 + 1.7) * 0.2;
      const h = (Math.imul(u | 0, 374761393) ^ Math.imul(vv | 0, 668265263)) >>> 0;
      const jitter = [0.0, -0.035, 0.04, -0.015][h % 4];
      let col = shade(seasonGround(rgbHex(tintAt(u, vv)), season), jitter + n * 0.05);
      const glade = gladeAt(sx, sy);
      if (glade > 0) col = mix(col, PAL.dirtPale, glade * 0.26);
      isoTile(ctx, sx, sy, col);

      const r = grng();
      if (glade < 0.4 && r < 0.09) {
        rect(ctx, sx - 4, sy + 1, 2, 1, grassEdge);
        rect(ctx, sx + 2, sy - 2, 2, 1, grassEdge);
      } else if (glade < 0.4 && r < 0.12) {
        rect(ctx, sx, sy - 1, 1, 2, tuft);
        rect(ctx, sx, sy - 3, 1, 1, PAL.flower[h % PAL.flower.length]);
      } else if (glade > 0.5 && r < 0.06) {
        rect(ctx, sx - 2, sy, 3, 1, PAL.dirtEdge);
      }
    }
  }
}

/** The road itself, and the track that turns off it into the town. */
function bakeRoad(ctx: Ctx, v: Village): void {
  // The lane up off the road into the back row. It leaves at a slant rather
  // than square, because a road running straight up the screen in a 2:1
  // isometric is twice as wide as the same road running across it, and reads
  // as a mud patch instead of a street.
  const spur: [number, number][] = [];
  const cx = v.hit.x + v.hit.w / 2;
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    spur.push(tile(cx - t * 62, roadYAt(v, cx) - t * 34));
  }
  paintRoad(ctx, spur, 'track', 0.3, v.seed & 0xffff);

  const pts: [number, number][] = [];
  for (let x = -40; x <= v.w + 40; x += 20) pts.push(tile(x, roadYAt(v, x)));
  paintRoad(ctx, pts, 'highway', 0.62, (v.seed >>> 3) & 0xffff);
}

/* ------------------------------- the frame ------------------------------- */

interface Dyn {
  y: number;
  draw: (ctx: Ctx) => void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ping-pong 0..1..0 over one full round trip. */
function shuttle(t: number, period: number, phase: number): number {
  const p = ((t / period + phase) % 2 + 2) % 2;
  return p < 1 ? p : 2 - p;
}

function botAt(v: Village, b: VBot, t: number): { x: number; y: number; right: boolean } {
  if (b.action !== 'walk' && b.action !== 'carry') return { x: b.x, y: b.y, right: true };
  const k = shuttle(t, b.period, b.phase);
  const raw = ((t / b.period + b.phase) % 2 + 2) % 2;
  return { x: lerp(b.x, b.x2, k), y: lerp(b.y, b.y2, k), right: raw < 1 === b.x2 > b.x };
}

/** Three puffs off a chimney, on their own clock. */
function drawSmoke(ctx: Ctx, x: number, y: number, t: number, seed: number): void {
  const off = (seed % 100) / 100;
  for (let i = 0; i < 4; i++) {
    const ph = ((t * 0.24 + off + i * 0.25) % 1 + 1) % 1;
    const px = x + Math.sin((ph * 3.4 + i) * 1.7) * 3.5 + 1;
    const py = y - 3 - ph * 26;
    const r = 1.2 + ph * 2.6;
    ctx.globalAlpha = 0.42 * (1 - ph);
    ctx.fillStyle = PAL.chalk;
    ctx.fillRect(Math.round(px - r), Math.round(py - r), Math.round(r * 2), Math.round(r * 2));
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw one band. `t` is seconds since the strip woke up; `hover` lights the
 * town the pointer is over.
 */
export function paintBand(ctx: Ctx, scene: RoadScene, t: number, hover: boolean): void {
  const v = scene.v;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, v.w, v.h);
  ctx.drawImage(scene.bg, 0, 0);

  /* ---- everything that moves, keyed to the depth it moves at ---------- */
  const dyn: Dyn[] = [];

  for (const b of v.bots) {
    const at = botAt(v, b, t);
    dyn.push({
      y: at.y,
      draw: (c) => drawBot(c, at.x, at.y, b.color, at.right, b.action, t + b.phase * 6),
    });
  }

  for (const cart of v.carts) {
    const span = v.w + 120;
    const k = ((t / cart.period + cart.phase) % 1 + 1) % 1;
    const x = cart.dir === 1 ? -60 + k * span : v.w + 60 - k * span;
    const y = roadYAt(v, x) + cart.lane;
    dyn.push({
      y,
      draw: (c) => drawCart(c, x, y, cart.color, cart.dir === 1, t * 1.4, cart.cargo),
    });
  }

  for (const s of scene.smokes) dyn.push({ y: 1e6, draw: (c) => drawSmoke(c, s.x, s.y, t, s.seed) });
  for (const wl of scene.wheels) dyn.push({ y: 1e6, draw: (c) => drawWheel(c, wl.x, wl.y, t) });
  for (const bc of scene.beacons) dyn.push({ y: 1e6, draw: (c) => drawBonfire(c, bc.x, bc.y, t) });
  for (const cr of scene.cranes) dyn.push({ y: 1e6, draw: (c) => drawCraneLoad(c, cr.x, cr.y, t) });

  for (const bd of v.birds) {
    const x = (((bd.x + bd.vx * t) % (v.w + 60)) + v.w + 60) % (v.w + 60) - 30;
    const y = bd.y + Math.sin(t / bd.period + bd.phase * 6.28) * bd.amp;
    const frame: 0 | 1 = Math.floor(t / bd.period / 0.18) % 2 === 0 ? 0 : 1;
    const sp = buildBird(frame);
    dyn.push({ y: 1e6, draw: (c) => c.drawImage(sp.c, Math.round(x) - sp.ox, Math.round(y) - sp.oy) });
  }

  dyn.sort((a, b) => a.y - b.y);

  /* ---- one merged painter's pass -------------------------------------- */
  let di = 0;
  for (const s of scene.statics) {
    while (di < dyn.length && dyn[di].y <= s.y) dyn[di++].draw(ctx);
    ctx.drawImage(s.sp.c, Math.round(s.x) - s.sp.ox, Math.round(s.y) - s.sp.oy);
  }
  while (di < dyn.length) dyn[di++].draw(ctx);

  if (hover) paintHover(ctx, v, t);
}

/** A pixel marquee round the town under the pointer, in its own colour. */
function paintHover(ctx: Ctx, v: Village, t: number): void {
  const { x, y, w, h } = v.hit;
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = v.accent;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = v.accent;
  const off = Math.floor(t * 8) % 8;
  for (let i = 0; i < w; i++) {
    if ((i + off) % 8 < 4) {
      ctx.fillRect(x + i, y, 1, 1);
      ctx.fillRect(x + i, y + h - 1, 1, 1);
    }
  }
  for (let i = 0; i < h; i++) {
    if ((i + off) % 8 < 4) {
      ctx.fillRect(x, y + i, 1, 1);
      ctx.fillRect(x + w - 1, y + i, 1, 1);
    }
  }
  ctx.restore();
}
