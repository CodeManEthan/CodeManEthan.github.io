/**
 * The Vale — renderer.
 *
 * Takes the plain `WorldState` object and turns it into pixels. Nothing here
 * invents world content: every village, road and building it draws came out of
 * `worldstate.ts`.
 *
 * The whole vale is rasterised *once* into a single offscreen canvas at world
 * resolution (one world unit = one art pixel). Panning and zooming is then a
 * single `drawImage` of the visible sub-rectangle, which is why the camera
 * stays smooth at any zoom on any device.
 *
 * Moving things — villagers, carts between villages, the mill wheel, crane
 * hooks, chimney smoke — are drawn on top each frame. To keep them correctly
 * occluded by the baked scenery, every dynamic entity queries a spatial grid
 * for the static sprites that stand *in front* of it and those few sprites are
 * redrawn into the same depth-sorted pass.
 */

import {
  PAL,
  TH,
  TW,
  buildBarrels,
  buildBush,
  buildCampfire,
  buildForestPattern,
  buildCart,
  buildCrates,
  buildCrane,
  buildCropRow,
  buildFence,
  buildFlowerPatch,
  buildHaystack,
  buildLamp,
  buildLumber,
  buildNameBoard,
  buildReeds,
  buildRock,
  buildSheep,
  buildShed,
  buildSignpost,
  buildStake,
  buildStructure,
  buildStump,
  buildTree,
  buildWell,
  diamond,
  drawBot,
  drawCart,
  drawWheel,
  isoTile,
  mix,
  mulberry32,
  poly,
  rect,
  shade,
  type BotAction,
  type Ctx,
  type Pt,
  type Sprite,
} from './art';
import {
  isoX,
  isoY,
  pathBetween,
  polylineDist,
  type PropKind,
  type TravelerState,
  type VillageState,
  type WorldState,
} from './worldstate';

/* --------------------------------- types -------------------------------- */

export interface StaticItem {
  sprite: Sprite;
  /** Anchor position in world pixels. */
  x: number;
  y: number;
  depth: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

export interface Resident {
  village: string;
  nodes: number[];
  gx: number;
  gy: number;
  node: number;
  path: number[];
  action: BotAction;
  timer: number;
  phase: number;
  color: string;
  faceRight: boolean;
  ox: number;
  oy: number;
}

export interface Traveler {
  def: TravelerState;
  pts: [number, number][];
  cum: number[];
  len: number;
  s: number;
  dir: 1 | -1;
  phase: number;
  gx: number;
  gy: number;
  faceRight: boolean;
  wait: number;
}

export interface VillageAnchor {
  id: string;
  village: VillageState;
  /** Name-sign anchor in world pixels. */
  x: number;
  y: number;
  /** Rough on-screen footprint of the village, world pixels. */
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

export interface Scene {
  world: WorldState;
  /** Baked static layer and the offset from world pixels into it. */
  layer: HTMLCanvasElement;
  ox: number;
  oy: number;
  /** Visible world-pixel rectangle covered by the layer. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  statics: StaticItem[];
  grid: Map<number, number[]>;
  anchors: VillageAnchor[];
  smokers: { x: number; y: number }[];
  wheels: { x: number; y: number }[];
  cranes: { x: number; y: number }[];
  residents: Resident[];
  travelers: Traveler[];
  minimap: HTMLCanvasElement;
  /** Tileable woodland used everywhere outside the vale itself. */
  surround: HTMLCanvasElement;
}

export interface Smoke {
  x: number;
  y: number;
  age: number;
  drift: number;
}

/* ------------------------------ sprite pools ---------------------------- */

function pool<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function makePools() {
  return {
    oak: pool(6, (i) => buildTree(0, 11 + i * 37)),
    pine: pool(6, (i) => buildTree(1, 23 + i * 41)),
    blossom: pool(4, (i) => buildTree(2, 31 + i * 43)),
    hedgerow: pool(4, (i) => buildTree(3, 47 + i * 29)),
    bush: pool(6, (i) => buildBush(53 + i * 17)),
    rock: pool(6, (i) => buildRock(59 + i * 19)),
    flowers: pool(6, (i) => buildFlowerPatch(61 + i * 23)),
    reeds: pool(4, (i) => buildReeds(67 + i * 13)),
    stump: pool(4, (i) => buildStump(71 + i * 11)),
    crop: pool(4, (i) => buildCropRow(73 + i * 7)),
    haystack: pool(4, (i) => buildHaystack(79 + i * 5)),
    fenceL: pool(1, () => buildFence('l')),
    fenceR: pool(1, () => buildFence('r')),
    shed: pool(4, (i) => buildShed(83 + i * 31)),
    cart: pool(2, (i) => buildCart(i === 0)),
    crates: pool(3, (i) => buildCrates(89 + i * 13)),
    lumber: pool(3, (i) => buildLumber(97 + i * 17)),
    barrels: pool(3, (i) => buildBarrels(101 + i * 19)),
    well: pool(1, () => buildWell()),
    lamp: pool(1, () => buildLamp()),
    signpost: pool(1, () => buildSignpost('#63c9a8')),
    sheep: pool(3, (i) => buildSheep(103 + i * 23)),
    campfire: pool(1, () => buildCampfire()),
  };
}

/* ------------------------------- terrain -------------------------------- */

const BIOME_TINT = PAL.biome;

/* ---------------------------------- bake -------------------------------- */

export function buildScene(world: WorldState): Scene {
  const B = world.bounds;
  const x0 = B.u0 * (TW / 2);
  const x1 = B.u1 * (TW / 2);
  const y0 = B.v0 * (TH / 2);
  const y1 = B.v1 * (TH / 2);
  const PAD_X = 40;
  const PAD_TOP = 130;
  const PAD_BOT = 48;

  const W = Math.ceil(x1 - x0) + PAD_X * 2;
  const H = Math.ceil(y1 - y0) + PAD_TOP + PAD_BOT;
  const ox = Math.round(-x0 + PAD_X);
  const oy = Math.round(-y0 + PAD_TOP);

  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const ctx = layer.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(ox, oy);

  /* ---- beyond the vale: deep woods --------------------------------- */
  ctx.fillStyle = '#3f7f66';
  ctx.fillRect(-ox, -oy, W, H);
  const erng = mulberry32(5150);
  for (let i = 0; i < 900; i++) {
    const px = -ox + erng() * W;
    const py = -oy + erng() * H;
    if (px > x0 - 14 && px < x1 + 14 && py > y0 - 14 && py < y1 + 14) continue;
    rect(ctx, px, py, 2 + erng() * 3, 1 + erng() * 2, erng() < 0.5 ? '#377059' : '#4a8d72');
  }

  /* ---- ground tiles ------------------------------------------------- */
  const river = world.water.river;

  /**
   * Biome tint, bilinearly blended across the chunk grid. Sampling the chunk a
   * tile happens to sit in leaves visible rectangles; blending the four nearest
   * chunk centres turns the same data into soft meadow/forest/farm gradients.
   */
  const CU = new Set(world.chunks.map((c) => c.u0)).size;
  const CV = new Set(world.chunks.map((c) => c.v0)).size;
  const cw = (B.u1 - B.u0) / CU;
  const chh = (B.v1 - B.v0) / CV;
  const tintAt: string[] = new Array(CU * CV);
  for (const c of world.chunks) {
    const i = Math.round((c.u0 - B.u0) / cw);
    const j = Math.round((c.v0 - B.v0) / chh);
    tintAt[j * CU + i] = BIOME_TINT[c.biome];
  }
  const tintRGB = tintAt.map((hex) => {
    const n = parseInt((hex ?? '#8ed09f').slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
  });
  const sampleTint = (u: number, v: number): [number, number, number] => {
    const fi = (u - B.u0) / cw - 0.5;
    const fj = (v - B.v0) / chh - 0.5;
    const i0 = Math.max(0, Math.min(CU - 1, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(CV - 1, Math.floor(fj)));
    const i1 = Math.min(CU - 1, i0 + 1);
    const j1 = Math.min(CV - 1, j0 + 1);
    const tu = Math.max(0, Math.min(1, fi - i0));
    const tv = Math.max(0, Math.min(1, fj - j0));
    const a = tintRGB[j0 * CU + i0];
    const b = tintRGB[j0 * CU + i1];
    const c2 = tintRGB[j1 * CU + i0];
    const d = tintRGB[j1 * CU + i1];
    const out: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out[k] =
        (a[k] * (1 - tu) + b[k] * tu) * (1 - tv) + (c2[k] * (1 - tu) + d[k] * tu) * tv;
    }
    return out;
  };

  /** Trodden earth inside a village rim, so a settlement reads as a clearing. */
  const clearingAt = (gx: number, gy: number): number => {
    let best = 0;
    for (const vv of world.villages) {
      const du = gx - gy - (vv.gx - vv.gy);
      const dv = gx + gy - (vv.gx + vv.gy);
      const d = Math.hypot(du, dv) / vv.radius;
      if (d < 1.05) best = Math.max(best, Math.min(1, (1.05 - d) / 0.45));
    }
    return best;
  };

  const hex = (rgb: [number, number, number]) => {
    const v =
      (Math.max(0, Math.min(255, Math.round(rgb[0]))) << 16) |
      (Math.max(0, Math.min(255, Math.round(rgb[1]))) << 8) |
      Math.max(0, Math.min(255, Math.round(rgb[2])));
    return `#${(v | 0x1000000).toString(16).slice(1)}`;
  };

  const grng = mulberry32(1337);
  for (let v = Math.floor(B.v0); v <= Math.ceil(B.v1); v++) {
    for (let u = Math.floor(B.u0); u <= Math.ceil(B.u1); u++) {
      if ((u + v) & 1) continue;
      const gx = (u + v) / 2;
      const gy = (v - u) / 2;
      const sx = u * (TW / 2);
      const sy = v * (TH / 2);

      const n =
        Math.sin(gx * 0.29 + gy * 0.17) * 0.5 +
        Math.sin(gx * 0.11 - gy * 0.31) * 0.3 +
        Math.sin((gx + gy) * 0.21 + 1.7) * 0.2;
      const h = (Math.imul(u | 0, 374761393) ^ Math.imul(v | 0, 668265263)) >>> 0;
      const jitter = [0.0, -0.035, 0.04, -0.015][h % 4];
      let col = shade(hex(sampleTint(u, v)), jitter + n * 0.05);

      const clear = clearingAt(gx, gy);
      if (clear > 0) col = mix(col, PAL.dirtPale, clear * 0.42);

      isoTile(ctx, sx, sy, col);

      const r = grng();
      if (clear < 0.4 && r < 0.08) {
        rect(ctx, sx - 4, sy + 1, 2, 1, PAL.grassEdge);
        rect(ctx, sx + 2, sy - 2, 2, 1, PAL.grassEdge);
      } else if (clear < 0.4 && r < 0.11) {
        rect(ctx, sx, sy - 1, 1, 2, PAL.leafDark);
        rect(ctx, sx, sy - 3, 1, 1, PAL.flower[h % PAL.flower.length]);
      } else if (clear > 0.5 && r < 0.05) {
        rect(ctx, sx - 2, sy, 3, 1, PAL.dirtEdge);
      }
    }
  }

  /* ---- strips: roads and the river ----------------------------------- */
  const strip = (pts: [number, number][], halfW: number, color: string) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const tx = bx - ax;
      const ty = by - ay;
      const len = Math.hypot(tx, ty) || 1;
      const nx = (-ty / len) * halfW;
      const ny = (tx / len) * halfW;
      // Overshoot each end by a hair so consecutive quads never leave a notch.
      const ex = (tx / len) * 0.12;
      const ey = (ty / len) * 0.12;
      const quad: Pt[] = [
        [isoX(ax + nx - ex, ay + ny - ey), isoY(ax + nx - ex, ay + ny - ey)],
        [isoX(bx + nx + ex, by + ny + ey), isoY(bx + nx + ex, by + ny + ey)],
        [isoX(bx - nx + ex, by - ny + ey), isoY(bx - nx + ex, by - ny + ey)],
        [isoX(ax - nx - ex, ay - ny - ey), isoY(ax - nx - ex, ay - ny - ey)],
      ];
      poly(ctx, quad, color);
    }
  };

  /**
   * Roads are drawn as strips rather than painted tile by tile: a lane barely
   * wider than one tile only catches a scatter of tile centres, which reads as
   * blotches instead of a road.
   */
  const rrng0 = mulberry32(2024);
  for (const road of world.roads) {
    strip(road.pts, road.width + 0.55, mix(PAL.grassEdge, PAL.dirt, 0.55));
  }
  for (const road of world.roads) {
    strip(road.pts, road.width + 0.16, PAL.dirtEdge);
    strip(road.pts, road.width, PAL.dirt);
    strip(road.pts, road.width * 0.42, road.kind === 'highway' ? PAL.dirtPale : PAL.dirtAlt);
    // wheel ruts and loose stones
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const steps = Math.max(3, Math.round(Math.hypot(
        road.pts[i + 1][0] - road.pts[i][0],
        road.pts[i + 1][1] - road.pts[i][1]
      ) * 1.4));
      for (let k = 0; k < steps; k++) {
        const t = (k + rrng0()) / steps;
        const gx = road.pts[i][0] + (road.pts[i + 1][0] - road.pts[i][0]) * t;
        const gy = road.pts[i][1] + (road.pts[i + 1][1] - road.pts[i][1]) * t;
        const off = (rrng0() - 0.5) * road.width * 1.6;
        rect(ctx, isoX(gx, gy) + off * 16, isoY(gx, gy) + off * 6, 2 + rrng0() * 3, 1, PAL.dirtEdge);
      }
    }
  }

  /**
   * Village lanes, straight out of the waypoint graph: every edge between two
   * nodes of the same village becomes a narrow packed-earth track, so the road
   * network visibly continues past the gate and into the plaza.
   */
  for (const n of world.nodes) {
    if (!n.village) continue;
    for (const e of n.edges) {
      if (e <= n.id) continue;
      const m = world.nodes[e];
      if (m.village !== n.village) continue;
      strip([[n.gx, n.gy], [m.gx, m.gy]], 0.46, mix(PAL.dirt, PAL.grassEdge, 0.3));
      strip([[n.gx, n.gy], [m.gx, m.gy]], 0.3, PAL.dirtPale);
    }
  }

  strip(river, world.water.width + 0.75, PAL.sand);
  strip(river, world.water.width + 0.34, shade(PAL.sand, -0.12));
  strip(river, world.water.width, PAL.waterDeep);
  strip(river, world.water.width * 0.76, PAL.water);
  strip(river, world.water.width * 0.34, PAL.waterLight);
  // glints along the current
  const wrng = mulberry32(808);
  for (let i = 0; i + 1 < river.length; i++) {
    for (let k = 0; k < 9; k++) {
      const t = (k + wrng()) / 9;
      const gx = river[i][0] + (river[i + 1][0] - river[i][0]) * t;
      const gy = river[i][1] + (river[i + 1][1] - river[i][1]) * t;
      const off = (wrng() - 0.5) * world.water.width * 1.1;
      rect(ctx, isoX(gx, gy) + off * 16, isoY(gx, gy) + off * 6, 3 + wrng() * 4, 1, PAL.waterFoam);
    }
  }

  /* ---- bridges ------------------------------------------------------- */
  for (const br of world.water.bridges) {
    // Local river direction, so the deck lies across the current.
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i + 1 < river.length; i++) {
      const d = polylineDist(br.gx, br.gy, [river[i], river[i + 1]]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const tx = river[bi + 1][0] - river[bi][0];
    const ty = river[bi + 1][1] - river[bi][1];
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    const half = br.span / 2;
    const depth = 1.15;
    const corner = (a: number, b: number): Pt => {
      const gx = br.gx + nx * a + (tx / tl) * b;
      const gy = br.gy + ny * a + (ty / tl) * b;
      return [isoX(gx, gy), isoY(gx, gy)];
    };
    poly(ctx, [corner(-half, -depth), corner(half, -depth), corner(half, depth), corner(-half, depth)], PAL.woodDark);
    poly(ctx, [corner(-half, -depth + 0.25), corner(half, -depth + 0.25), corner(half, depth - 0.25), corner(-half, depth - 0.25)], PAL.wood);
    for (let k = -half; k < half; k += 0.9) {
      poly(ctx, [corner(k, -depth + 0.3), corner(k + 0.28, -depth + 0.3), corner(k + 0.28, depth - 0.3), corner(k, depth - 0.3)], PAL.woodLight);
    }
    // rails
    for (const side of [-1, 1]) {
      const a = corner(-half, side * depth);
      const b = corner(half, side * depth);
      poly(ctx, [[a[0], a[1] - 5], [b[0], b[1] - 5], [b[0], b[1] - 3.5], [a[0], a[1] - 3.5]], PAL.woodLight);
      for (let k = -half; k <= half; k += 1.6) {
        const p = corner(k, side * depth);
        rect(ctx, p[0], p[1] - 5, 1, 5, PAL.woodDark);
      }
    }
  }

  /* ---- static sprites ------------------------------------------------ */
  const pools = makePools();
  const statics: StaticItem[] = [];
  const smokers: { x: number; y: number }[] = [];
  const wheels: { x: number; y: number }[] = [];
  const cranes: { x: number; y: number }[] = [];

  const push = (sprite: Sprite, gx: number, gy: number) => {
    const x = isoX(gx, gy);
    const y = isoY(gx, gy);
    statics.push({
      sprite,
      x,
      y,
      depth: y,
      bx: x - sprite.ox,
      by: y - sprite.oy,
      bw: sprite.c.width,
      bh: sprite.c.height,
    });
  };

  const propSprite = (kind: PropKind, seed: number, accent: string): Sprite | null => {
    switch (kind) {
      case 'nameboard':
        return buildNameBoard(accent);
      case 'stake':
        return buildStake(accent, seed);
      case 'crane':
        return buildCrane(accent);
      default: {
        const p = (pools as Record<string, Sprite[]>)[kind];
        if (!p) return null;
        return p[Math.abs(seed) % p.length];
      }
    }
  };

  for (const v of world.villages) {
    for (const b of v.buildings) {
      const sp = buildStructure({
        role: b.role,
        accent: b.accent,
        w: b.w,
        floors: b.floors,
        roof: b.roof,
        progress: b.progress,
        condition: b.condition,
        chimney: b.chimney,
        cupola: b.cupola,
        antenna: b.antenna,
        awning: b.awning,
        banner: b.banner,
        lit: b.lit,
        seed: b.seed,
      });
      push(sp, b.gx, b.gy);
      if (sp.smoke) smokers.push({ x: isoX(b.gx, b.gy) + sp.smoke[0], y: isoY(b.gx, b.gy) + sp.smoke[1] });
    }
    for (const p of v.props) {
      const sp = propSprite(p.kind, p.seed, v.accent);
      if (!sp) continue;
      push(sp, p.gx, p.gy);
      if (p.kind === 'crane') cranes.push({ x: isoX(p.gx, p.gy), y: isoY(p.gx, p.gy) });
    }
  }

  for (const b of world.landmarks) {
    const sp = buildStructure({
      role: b.role,
      accent: b.accent,
      w: b.w,
      floors: b.floors,
      roof: b.roof,
      progress: b.progress,
      condition: b.condition,
      chimney: b.chimney,
      cupola: b.cupola,
      antenna: b.antenna,
      awning: b.awning,
      banner: b.banner,
      lit: b.lit,
      seed: b.seed,
    });
    push(sp, b.gx, b.gy);
    if (sp.smoke) smokers.push({ x: isoX(b.gx, b.gy) + sp.smoke[0], y: isoY(b.gx, b.gy) + sp.smoke[1] });
    if (sp.wheel) wheels.push({ x: isoX(b.gx, b.gy) + sp.wheel[0], y: isoY(b.gx, b.gy) + sp.wheel[1] });
  }

  for (const p of world.scatter) {
    const sp = propSprite(p.kind, p.seed, '#63c9a8');
    if (!sp) continue;
    push(sp, p.gx, p.gy);
  }

  statics.sort((a, b) => a.depth - b.depth || a.x - b.x);
  for (const it of statics) {
    ctx.drawImage(it.sprite.c, Math.round(it.bx), Math.round(it.by));
  }

  /* ---- spatial index for occlusion repair ---------------------------- */
  const CELL = 96;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 4096 + cy;
  statics.forEach((it, i) => {
    const cx0 = Math.floor(it.bx / CELL);
    const cx1 = Math.floor((it.bx + it.bw) / CELL);
    const cy0 = Math.floor(it.by / CELL);
    const cy1 = Math.floor((it.by + it.bh) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = key(cx, cy);
        const arr = grid.get(k);
        if (arr) arr.push(i);
        else grid.set(k, [i]);
      }
    }
  });

  /* ---- village anchors ----------------------------------------------- */
  const anchors: VillageAnchor[] = world.villages.map((v) => {
    const r = v.radius;
    return {
      id: v.id,
      village: v,
      x: isoX(v.sign.gx, v.sign.gy),
      y: isoY(v.sign.gx, v.sign.gy),
      bx: isoX(v.gx, v.gy) - r * (TW / 2),
      by: isoY(v.gx, v.gy) - r * (TH / 2) - 34,
      bw: r * TW,
      bh: r * TH + 44,
    };
  });

  /* ---- residents ------------------------------------------------------ */
  const BOT_COLORS = ['#ef7f93', '#63c9a8', '#9b8fe8', '#f0c75e', '#6cc4d9', '#e98fc3', '#f5a25d'];
  const rrng = mulberry32(4242);
  const residents: Resident[] = [];
  for (const v of world.villages) {
    const ids = world.nodes.filter((n) => n.village === v.id).map((n) => n.id);
    if (!ids.length) continue;
    for (let i = 0; i < v.population; i++) {
      const n = ids[Math.floor(rrng() * ids.length)];
      residents.push({
        village: v.id,
        nodes: ids,
        gx: world.nodes[n].gx,
        gy: world.nodes[n].gy,
        node: n,
        path: [],
        action: 'idle',
        timer: rrng() * 3,
        phase: rrng() * 10,
        color: BOT_COLORS[Math.floor(rrng() * BOT_COLORS.length)],
        faceRight: rrng() < 0.5,
        ox: (rrng() - 0.5) * 0.6,
        oy: (rrng() - 0.5) * 0.6,
      });
    }
  }

  /* ---- travellers ------------------------------------------------------ */
  const travelers: Traveler[] = world.travelers.map((t) => {
    const pts: [number, number][] = t.route.map((id) => [world.nodes[id].gx, world.nodes[id].gy]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const len = cum[cum.length - 1] || 1;
    return {
      def: t,
      pts,
      cum,
      len,
      s: t.offset * len,
      dir: 1,
      phase: t.offset * 7,
      gx: pts[0][0],
      gy: pts[0][1],
      faceRight: true,
      wait: 0,
    };
  });

  /* ---- minimap --------------------------------------------------------- */
  const MM_W = 214;
  const scaleMM = MM_W / W;
  const minimap = document.createElement('canvas');
  minimap.width = MM_W;
  minimap.height = Math.max(1, Math.round(H * scaleMM));
  const mctx = minimap.getContext('2d')!;
  mctx.imageSmoothingEnabled = false;
  mctx.drawImage(layer, 0, 0, W, H, 0, 0, minimap.width, minimap.height);

  return {
    world,
    layer,
    ox,
    oy,
    x0: x0 - PAD_X,
    y0: y0 - PAD_TOP,
    w: W,
    h: H,
    statics,
    grid,
    anchors,
    smokers,
    wheels,
    cranes,
    residents,
    travelers,
    minimap,
    surround: buildForestPattern(),
  };
}

/* ------------------------------ simulation ------------------------------ */

const sim = mulberry32(99);
const RESIDENT_SPEED = 1.15;

export function stepScene(scene: Scene, dt: number): void {
  const nodes = scene.world.nodes;

  for (const bot of scene.residents) {
    bot.phase += dt;
    if (bot.action === 'walk' || bot.action === 'carry') {
      const target = nodes[bot.path[0]];
      if (!target) {
        bot.action = 'idle';
        bot.timer = 0.5;
        continue;
      }
      const tx = target.gx + bot.ox;
      const ty = target.gy + bot.oy;
      const dx = tx - bot.gx;
      const dy = ty - bot.gy;
      const d = Math.hypot(dx, dy) || 1;
      const step = RESIDENT_SPEED * dt;
      if (d <= step) {
        bot.gx = tx;
        bot.gy = ty;
        bot.node = bot.path.shift()!;
        if (!bot.path.length) {
          if (nodes[bot.node].kind === 'work') {
            bot.action = 'work';
            bot.timer = 3 + sim() * 5;
          } else {
            bot.action = 'idle';
            bot.timer = 0.8 + sim() * 3.4;
          }
        }
      } else {
        bot.gx += (dx / d) * step;
        bot.gy += (dy / d) * step;
        const sdx = dx - dy;
        if (Math.abs(sdx) > 0.01) bot.faceRight = sdx > 0;
      }
      continue;
    }

    bot.timer -= dt;
    if (bot.timer > 0) continue;
    const to = bot.nodes[Math.floor(sim() * bot.nodes.length)];
    const path = pathBetween(nodes, bot.node, to);
    if (!path.length) {
      bot.timer = 1 + sim() * 2;
      continue;
    }
    bot.path = path;
    bot.action = nodes[to].kind === 'work' && sim() < 0.6 ? 'carry' : 'walk';
  }

  for (const tr of scene.travelers) {
    tr.phase += dt;
    if (tr.wait > 0) {
      tr.wait -= dt;
      continue;
    }
    tr.s += tr.def.speed * dt * tr.dir;
    if (tr.s >= tr.len) {
      tr.s = tr.len;
      tr.dir = -1;
      tr.wait = 2 + sim() * 4;
    } else if (tr.s <= 0) {
      tr.s = 0;
      tr.dir = 1;
      tr.wait = 2 + sim() * 4;
    }
    // Locate along the route.
    let i = 1;
    while (i < tr.cum.length - 1 && tr.cum[i] < tr.s) i++;
    const seg = tr.cum[i] - tr.cum[i - 1] || 1;
    const f = (tr.s - tr.cum[i - 1]) / seg;
    const ax = tr.pts[i - 1][0];
    const ay = tr.pts[i - 1][1];
    const bx = tr.pts[i][0];
    const by = tr.pts[i][1];
    const ngx = ax + (bx - ax) * f;
    const ngy = ay + (by - ay) * f;
    const sdx = (ngx - tr.gx) - (ngy - tr.gy);
    if (Math.abs(sdx) > 0.001) tr.faceRight = sdx > 0;
    tr.gx = ngx;
    tr.gy = ngy;
  }
}

/** Settle the sim so a reduced-motion visitor still gets a populated vale. */
export function settle(scene: Scene): void {
  for (let i = 0; i < 240; i++) stepScene(scene, 1 / 20);
}

/* -------------------------------- drawing ------------------------------- */

export interface View {
  /** World pixel at the top-left of the viewport. */
  cx: number;
  cy: number;
  /** CSS pixels per world pixel. */
  zoom: number;
  /** Art-buffer size. */
  vw: number;
  vh: number;
}

interface DynEntity {
  depth: number;
  draw: (ctx: Ctx) => void;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

export function makeSmoke(): Smoke[] {
  return [];
}

export function stepSmoke(scene: Scene, smoke: Smoke[], dt: number, clock: { t: number }): void {
  clock.t += dt;
  if (clock.t > 0.6) {
    clock.t = 0;
    const r = mulberry32(Math.round(smoke.length * 31 + 7))();
    for (const s of scene.smokers) smoke.push({ x: s.x, y: s.y, age: 0, drift: r * 6 });
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    smoke[i].age += dt;
    if (smoke[i].age > 3.6) smoke.splice(i, 1);
  }
}

/**
 * Paint one frame: blit the visible slice of the baked vale, then the moving
 * population on top, with the few static sprites that should occlude them
 * folded into the same depth-sorted pass.
 */
export function renderScene(
  ctx: Ctx,
  scene: Scene,
  view: View,
  t: number,
  smoke: Smoke[],
  highlight: string | null
): void {
  const { zoom, cx, cy, vw, vh } = view;
  const sxw = vw / zoom;
  const syw = vh / zoom;

  // Everything outside the vale is deep woodland, scrolling with the camera.
  ctx.fillStyle = '#3f7f66';
  ctx.fillRect(0, 0, vw, vh);
  const pat = ctx.createPattern(scene.surround, 'repeat');
  if (pat) {
    try {
      pat.setTransform(new DOMMatrix([zoom, 0, 0, zoom, -cx * zoom, -cy * zoom]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, vw, vh);
    } catch {
      /* setTransform is unsupported: the flat fill above already covers it. */
    }
  }

  // The baked layer, scaled to the viewport.
  const srcX = cx - scene.x0;
  const srcY = cy - scene.y0;
  ctx.drawImage(scene.layer, srcX, srcY, sxw, syw, 0, 0, vw, vh);

  const toX = (wx: number) => (wx - cx) * zoom;
  const toY = (wy: number) => (wy - cy) * zoom;

  /* ---- village highlight ring ---------------------------------------- */
  if (highlight) {
    const a = scene.anchors.find((v) => v.id === highlight);
    if (a) {
      const v = a.village;
      const px = toX(isoX(v.gx, v.gy));
      const py = toY(isoY(v.gx, v.gy));
      const rw = v.radius * TW * zoom;
      ctx.globalAlpha = 0.16;
      poly(ctx, diamond(px, py, rw + 22), '#ffffff');
      ctx.globalAlpha = 1;
      const ring = diamond(px, py, rw + 22);
      const dash = Math.max(2, Math.round(2 * zoom));
      for (let i = 0; i < 4; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % 4];
        const steps = Math.max(8, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / (dash * 3)));
        for (let k = 0; k < steps; k++) {
          if (k % 2) continue;
          const f = k / steps;
          rect(ctx, p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, dash * 2, dash, v.accent);
        }
      }
    }
  }

  /* ---- collect dynamic entities in view ------------------------------ */
  const ents: DynEntity[] = [];
  const margin = 40;
  const inView = (wx: number, wy: number) =>
    wx > cx - margin && wx < cx + sxw + margin && wy > cy - margin && wy < cy + syw + margin;

  for (const bot of scene.residents) {
    const wx = isoX(bot.gx, bot.gy);
    const wy = isoY(bot.gx, bot.gy);
    if (!inView(wx, wy)) continue;
    const px = Math.round(toX(wx));
    const py = Math.round(toY(wy));
    const action = bot.action;
    const phase = bot.phase;
    const color = bot.color;
    const face = bot.faceRight;
    ents.push({
      depth: wy,
      bx: wx - 6,
      by: wy - 18,
      bw: 12,
      bh: 20,
      draw: (c) => {
        c.save();
        c.translate(px, py);
        c.scale(zoom, zoom);
        drawBot(c, 0, 0, color, face, action, phase);
        if (action === 'work' && Math.sin(phase * 11) > 0.85) {
          c.fillStyle = '#fff3c4';
          const s = face ? 6 : -7;
          c.fillRect(s, -12, 1, 1);
          c.fillRect(s + 2, -14, 1, 1);
          c.fillRect(s - 1, -15, 1, 1);
        }
        c.restore();
      },
    });
  }

  for (const tr of scene.travelers) {
    const wx = isoX(tr.gx, tr.gy);
    const wy = isoY(tr.gx, tr.gy);
    if (!inView(wx, wy)) continue;
    const px = Math.round(toX(wx));
    const py = Math.round(toY(wy));
    const kind = tr.def.kind;
    const color = tr.def.color;
    const cargo = tr.def.cargo;
    const face = tr.faceRight;
    const phase = tr.phase;
    ents.push({
      depth: wy,
      bx: wx - (kind === 'cart' ? 22 : 7),
      by: wy - 20,
      bw: kind === 'cart' ? 44 : 14,
      bh: 22,
      draw: (c) => {
        c.save();
        c.translate(px, py);
        c.scale(zoom, zoom);
        if (kind === 'cart') drawCart(c, 0, 0, color, face, phase, cargo);
        else drawBot(c, 0, 0, color, face, 'walk', phase);
        c.restore();
      },
    });
  }

  for (const w of scene.wheels) {
    if (!inView(w.x, w.y)) continue;
    const px = Math.round(toX(w.x));
    const py = Math.round(toY(w.y));
    ents.push({
      depth: w.y + 6,
      bx: w.x - 11,
      by: w.y - 11,
      bw: 22,
      bh: 22,
      draw: (c) => {
        c.save();
        c.translate(px, py);
        c.scale(zoom, zoom);
        drawWheel(c, 0, 0, t);
        c.restore();
      },
    });
  }

  for (const cr of scene.cranes) {
    if (!inView(cr.x, cr.y)) continue;
    const px = Math.round(toX(cr.x));
    const py = Math.round(toY(cr.y));
    ents.push({
      depth: cr.y - 1,
      bx: cr.x - 6,
      by: cr.y - 74,
      bw: 40,
      bh: 74,
      draw: (c) => {
        c.save();
        c.translate(px, py);
        c.scale(zoom, zoom);
        const jibX = 20;
        const topY = -50;
        const sway = Math.sin(t * 0.8) * 5;
        const drop = 24 + Math.sin(t * 0.55) * 9;
        c.fillStyle = PAL.ink;
        c.fillRect(Math.round(jibX + sway * 0.4), topY, 1, Math.round(drop));
        const lx = Math.round(jibX + sway * 0.4) - 4;
        const ly = Math.round(topY + drop);
        c.fillStyle = PAL.woodLight;
        c.fillRect(lx, ly, 9, 6);
        c.fillStyle = PAL.wood;
        c.fillRect(lx, ly + 4, 9, 2);
        c.fillStyle = PAL.woodDark;
        c.fillRect(lx, ly, 9, 1);
        c.restore();
      },
    });
  }

  if (!ents.length) {
    drawSmoke(ctx, smoke, toX, toY, zoom, vw, vh);
    return;
  }

  /* ---- gather the static sprites that stand in front ------------------ */
  const CELL = 96;
  const need = new Set<number>();
  if (zoom >= 1) {
    for (const e of ents) {
      const cx0 = Math.floor(e.bx / CELL);
      const cx1 = Math.floor((e.bx + e.bw) / CELL);
      const cy0 = Math.floor(e.by / CELL);
      const cy1 = Math.floor((e.by + e.bh) / CELL);
      for (let gy = cy0; gy <= cy1 + 1; gy++) {
        for (let gx = cx0; gx <= cx1; gx++) {
          const arr = scene.grid.get(gx * 4096 + gy);
          if (!arr) continue;
          for (const idx of arr) {
            const it = scene.statics[idx];
            if (it.depth <= e.depth) continue;
            if (it.bx > e.bx + e.bw || it.bx + it.bw < e.bx) continue;
            if (it.by > e.by + e.bh || it.by + it.bh < e.by) continue;
            need.add(idx);
          }
        }
      }
    }
  }

  const merged: DynEntity[] = ents.slice();
  need.forEach((idx) => {
    const it = scene.statics[idx];
    merged.push({
      depth: it.depth,
      bx: it.bx,
      by: it.by,
      bw: it.bw,
      bh: it.bh,
      // Aligned to exactly where the bake put it, so the patch is seamless.
      draw: (c) => {
        c.drawImage(
          it.sprite.c,
          0,
          0,
          it.bw,
          it.bh,
          toX(Math.round(it.bx)),
          toY(Math.round(it.by)),
          it.bw * zoom,
          it.bh * zoom
        );
      },
    });
  });

  merged.sort((a, b) => a.depth - b.depth);
  for (const e of merged) e.draw(ctx);

  drawSmoke(ctx, smoke, toX, toY, zoom, vw, vh);
}

/**
 * Every chimney in the vale puffs whether or not it is on screen, so the puff
 * list is long; each one is a hand-rasterised disc, so the off-screen ones are
 * culled before they cost anything.
 */
function drawSmoke(
  ctx: Ctx,
  smoke: Smoke[],
  toX: (n: number) => number,
  toY: (n: number) => number,
  zoom: number,
  vw: number,
  vh: number
): void {
  for (const p of smoke) {
    const a = p.age;
    const r = (2 + a * 2.2) * zoom;
    const px = Math.round(toX(p.x + Math.sin(a * 1.7 + p.drift) * 3 + a * 2.2));
    const py = Math.round(toY(p.y - a * 9));
    if (px + r < 0 || px - r > vw || py + r < 0 || py - r > vh) continue;
    ctx.globalAlpha = Math.max(0, 1 - a / 3.6) * 0.8;
    ctx.fillStyle = a < 1 ? '#ffffff' : a < 2.4 ? '#f1ece2' : '#e4e0da';
    const ri = Math.round(r);
    for (let k = -ri; k <= ri; k++) {
      const w = Math.round(Math.sqrt(Math.max(0, r * r - k * k)) * 2);
      if (w > 0) ctx.fillRect(px - Math.round(w / 2), py + k, w, 1);
    }
    ctx.globalAlpha = 1;
  }
}
