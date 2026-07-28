/**
 * Hamlet Frontier — sprite factories.
 *
 * Static art is baked once into small offscreen canvases so a frame costs a
 * handful of `drawImage` calls. Anything that has to move (the bell, the saw
 * blade, the crane hook, the villagers) is left out of the bake and drawn
 * procedurally by the renderer, which is why several factories hand back
 * attachment points alongside the canvas.
 *
 * The four repo-reactive building states all come out of `buildStructure`:
 *   active   — warm lit windows, chimney smoke, the door open
 *   growing  — roof off the back half, a new storey framed to `progress`,
 *              scaffolding, ladder, hoist beam
 *   resting  — moss on the tiles, ivy up the wall, shutters closed, one lamp
 *   planned  — no building at all: corner stakes, string lines, a survey sign
 */

import {
  PAL,
  STORY,
  blob,
  diamond,
  disc,
  faceQuadL,
  faceQuadR,
  leftPt,
  makeSprite,
  mulberry32,
  poly,
  rect,
  rightPt,
  shade,
  type Ctx,
  type Pt,
  type Sprite,
} from './pixels';
import type { BuildingForm, BuildingState, PropKind } from './worldstate';

export interface StructureSprite extends Sprite {
  /** Chimney mouth, relative to the ground-centre anchor. */
  smoke: Pt | null;
  /** Belfry bell pivot — the renderer swings the bell from here. */
  bell: Pt | null;
  /** Hoist beam tip on a `growing` building — rope and load hang from it. */
  hoist: Pt | null;
  /** Top of the silhouette, for the floating label / focus ring. */
  peak: number;
}

/* ------------------------------ shared bits ----------------------------- */

function drawWindow(
  ctx: Ctx,
  W: number,
  side: 'l' | 'r',
  tc: number,
  hc: number,
  mode: 'lit' | 'cold' | 'shut'
): void {
  const q = side === 'l' ? faceQuadL : faceQuadR;
  const dt = 7 / W;
  poly(ctx, q(W, tc - dt, tc + dt, hc - 4, hc + 4), PAL.woodDark);
  if (mode === 'shut') {
    // closed shutters: two boards with a gap
    poly(ctx, q(W, tc - dt * 0.74, tc - dt * 0.06, hc - 3, hc + 3), PAL.wood);
    poly(ctx, q(W, tc + dt * 0.06, tc + dt * 0.74, hc - 3, hc + 3), PAL.woodLight);
    return;
  }
  const glass =
    mode === 'lit' ? PAL.glassLit : side === 'l' ? PAL.glass : PAL.glassDark;
  poly(ctx, q(W, tc - dt * 0.72, tc + dt * 0.72, hc - 3, hc + 3), glass);
  poly(
    ctx,
    q(W, tc - dt * 0.72, tc - dt * 0.1, hc + 0.6, hc + 3),
    shade(glass, mode === 'lit' ? 0.35 : 0.4)
  );
  // glazing bar
  poly(ctx, q(W, tc - dt * 0.08, tc + dt * 0.08, hc - 3, hc + 3), PAL.woodDark);
}

/** Stacked-lift scaffolding against the front-left face. */
function drawScaffold(ctx: Ctx, W: number, h: number): void {
  const lifts = Math.max(2, Math.round(h / 12));
  for (let i = 1; i <= lifts; i++) {
    const hh = (h / lifts) * i;
    poly(ctx, faceQuadL(W, 0.02, 0.98, hh - 1.4, hh + 1.4), PAL.sawn);
    poly(ctx, faceQuadL(W, 0.02, 0.98, hh - 2, hh - 1.4), PAL.wood);
  }
  for (const t of [0.05, 0.5, 0.95]) {
    poly(ctx, faceQuadL(W, t - 1.3 / W, t + 1.3 / W, 0, h + 4), PAL.wood);
  }
  const a = leftPt(W, 0.08, 1);
  const b = leftPt(W, 0.92, h);
  poly(
    ctx,
    [
      [a[0], a[1]],
      [a[0] + 1.6, a[1] + 1],
      [b[0] + 1.6, b[1] + 1],
      [b[0], b[1]],
    ],
    PAL.woodDark
  );
}

function drawLadder(ctx: Ctx, W: number, h: number): void {
  const lx = W / 2 - 9;
  const ly = W / 4 - (W / 2 - 9) / 2;
  rect(ctx, lx, ly - h, 1, h, PAL.sawn);
  rect(ctx, lx + 5, ly - h - 2, 1, h, PAL.sawn);
  for (let k = 3; k < h; k += 5) rect(ctx, lx, ly - k, 6, 1, PAL.wood);
}

/**
 * Moss stippled across the *front* roof faces of a resting house.
 *
 * Points are sampled as convex combinations of each face's vertices, which
 * keeps every speck on the roof no matter which roof style was drawn, and
 * biased toward the eave where moss actually collects.
 */
function drawMoss(ctx: Ctx, faces: Pt[][], amount: number, seed: number) {
  const rng = mulberry32(seed);
  for (const face of faces) {
    // fan-triangulate: (v0, vi, vi+1)
    const tris: Pt[][] = [];
    for (let i = 1; i + 1 < face.length; i++) tris.push([face[0], face[i], face[i + 1]]);
    const n = Math.round(amount * 34 * tris.length);
    for (let i = 0; i < n; i++) {
      const tri = tris[Math.floor(rng() * tris.length)];
      let r1 = rng();
      let r2 = rng();
      if (r1 + r2 > 1) {
        r1 = 1 - r1;
        r2 = 1 - r2;
      }
      // bias downhill: moss gathers along the eave, not on the ridge
      const bias = 0.35 + 0.65 * rng();
      const px =
        tri[0][0] + (tri[1][0] - tri[0][0]) * r1 * bias + (tri[2][0] - tri[0][0]) * r2 * bias;
      const py =
        tri[0][1] + (tri[1][1] - tri[0][1]) * r1 * bias + (tri[2][1] - tri[0][1]) * r2 * bias;
      rect(ctx, px, py, 1 + Math.round(rng() * 2), 1, rng() < 0.5 ? PAL.moss : PAL.mossDark);
    }
  }
}

/** Ivy climbing the front-left face. */
function drawIvy(ctx: Ctx, W: number, wallH: number, amount: number, seed: number) {
  const rng = mulberry32(seed);
  const strands = 2 + Math.round(amount * 3);
  for (let s = 0; s < strands; s++) {
    const t0 = 0.08 + rng() * 0.8;
    const top = wallH * (0.35 + rng() * 0.5 * amount + 0.2);
    for (let h = 0; h < top; h += 2) {
      const wob = Math.sin(h * 0.5 + s * 2) * 0.012;
      poly(
        ctx,
        faceQuadL(W, t0 + wob - 0.9 / W, t0 + wob + 0.9 / W, h, h + 2),
        PAL.ivy
      );
      if ((h + s) % 6 === 0) {
        const p = leftPt(W, t0 + wob + (rng() < 0.5 ? -2.4 / W : 2.4 / W), h + 1);
        rect(ctx, p[0], p[1], 2, 1, rng() < 0.5 ? PAL.leafDark : PAL.moss);
      }
    }
  }
}

function drawLantern(ctx: Ctx, W: number, lit: boolean) {
  const p = leftPt(W, 0.62, 12);
  rect(ctx, p[0], p[1] - 1, 3, 1, PAL.ink);
  rect(ctx, p[0] + 1, p[1], 1, 2, PAL.ink);
  rect(ctx, p[0], p[1] + 2, 3, 3, lit ? PAL.glassLit : PAL.glassDim);
  rect(ctx, p[0], p[1] + 5, 3, 1, PAL.ink);
}

/* ------------------------------- buildings ------------------------------ */

export function buildStructure(
  form: BuildingForm,
  state: BuildingState,
  progress: number,
  condition: number,
  accent: string,
  seed: number
): StructureSprite {
  if (state === 'planned') return buildStakedPlot(form, accent, seed);

  const rng = mulberry32(seed);
  const W = form.width;
  const floors = form.floors;
  const H = W / 2;
  const growing = state === 'growing';
  const resting = state === 'resting';
  const wallH = floors * STORY;
  const eave = 4;
  const RW = W + eave * 2;
  const roofH = form.roof === 'flat' ? 5 : Math.round(W * 0.3);
  const towerH = form.tower ? Math.round(wallH * 0.32) + 16 : 0;
  const belfryH = form.belfry ? Math.round(wallH * 1.5) + 34 : 0;
  const newH = growing ? STORY + 6 : 0;

  const padX = eave + 16;
  const padTop = 34 + towerH + belfryH + newH;
  const padBottom = 8;
  const spriteW = W + padX * 2;
  const spriteH = padTop + roofH + wallH + H + padBottom;

  const dark = shade(accent, -0.3);
  const mid = shade(accent, -0.12);
  const light = shade(accent, 0.22);

  let smoke: Pt | null = null;
  let bell: Pt | null = null;
  let hoist: Pt | null = null;
  let peak = 0;

  const sp = makeSprite(spriteW, spriteH, padX + W / 2, spriteH - H / 2 - padBottom, (ctx) => {
    /* ---- cast shadow ------------------------------------------------- */
    poly(ctx, diamond(3, 2, W + 8), PAL.shadow);

    /* ---- back tower / belfry (drawn first so it sits behind) ---------- */
    if (form.tower || form.belfry) {
      const tw = form.belfry ? 18 : 16;
      const tx = -W / 2 + (form.belfry ? W / 2 : 10);
      const ty = form.belfry ? 0 : -H / 4 + 2;
      const th = form.belfry ? belfryH : wallH + towerH - 14;
      ctx.save();
      ctx.translate(tx, ty);
      poly(ctx, [[-tw / 2, 0], [0, tw / 4], [0, tw / 4 - th], [-tw / 2, -th]], PAL.wall);
      poly(ctx, [[0, tw / 4], [tw / 2, 0], [tw / 2, -th], [0, tw / 4 - th]], PAL.wallShade);
      // stone quoins up the corner
      for (let k = 4; k < th; k += 7) {
        rect(ctx, -1, -k, 2, 3, PAL.stone);
      }
      if (form.belfry) {
        // open belfry: four posts, a floor, a pitched cap. The bell is drawn
        // live by the renderer through the opening.
        const by = -th;
        poly(ctx, diamond(0, by + 4, tw + 8), PAL.stoneDark);
        poly(ctx, diamond(0, by + 2, tw + 4), PAL.stone);
        rect(ctx, -tw / 2 - 2, by - 16, 2, 18, PAL.wood);
        rect(ctx, tw / 2, by - 16, 2, 18, PAL.wood);
        rect(ctx, -1, by - 18, 2, 18, PAL.woodDark);
        // shaded interior so the bell reads against something
        poly(ctx, [[-tw / 2, by - 15], [tw / 2 + 2, by - 15], [tw / 2 + 2, by + 1], [-tw / 2, by + 1]], '#3b3450');
        // the yoke the bell hangs from — baked, because it doesn't swing
        rect(ctx, -tw / 2, by - 15, tw + 2, 2, PAL.woodLight);
        rect(ctx, -tw / 2, by - 13, tw + 2, 1, PAL.woodDark);
        // hang point, chosen so the whole bell sits inside the opening
        bell = [tx, ty + by - 5];
        // cap
        const cw = tw + 12;
        poly(ctx, [[-cw / 2, by - 16], [0, by - 16 + cw / 4], [cw / 2, by - 16], [0, by - 16 - cw / 4]], shade(accent, -0.2));
        poly(ctx, [[-cw / 2, by - 16], [0, by - 16 + cw / 4], [0, by - 34]], accent);
        poly(ctx, [[0, by - 16 + cw / 4], [cw / 2, by - 16], [0, by - 34]], dark);
        rect(ctx, 0, by - 42, 1, 9, PAL.ink);
        // weather-vane bell
        poly(ctx, [[1, by - 42], [6, by - 40], [1, by - 37]], PAL.brass);
        peak = Math.max(peak, th + 44);
      } else {
        // clock face + spire
        poly(ctx, [[-tw / 2 + 2, -th + 11], [-2, -th + 13], [-2, -th + 5], [-tw / 2 + 2, -th + 3]], shade(PAL.glassLit, 0.14));
        rect(ctx, -tw / 2 + 4, -th + 6, 1, 4, PAL.ink);
        poly(ctx, [[-tw / 2 - 2, -th], [0, -th + tw / 4 + 1], [0, -th - 16]], mid);
        poly(ctx, [[0, -th + tw / 4 + 1], [tw / 2 + 2, -th], [0, -th - 16]], dark);
        rect(ctx, 0, -th - 21, 1, 6, PAL.ink);
        poly(ctx, [[1, -th - 21], [7, -th - 19], [1, -th - 17]], accent);
        peak = Math.max(peak, th + 24);
      }
      ctx.restore();
    }

    /* ---- stone footing + walls --------------------------------------- */
    poly(ctx, faceQuadL(W, 0, 1, 0, 3), PAL.stone);
    poly(ctx, faceQuadR(W, 0, 1, 0, 3), PAL.stoneDark);
    poly(ctx, faceQuadL(W, 0, 1, 3, wallH), PAL.wall);
    poly(ctx, faceQuadR(W, 0, 1, 3, wallH), PAL.wallShade);

    // storey bands
    for (let f = 1; f < floors; f++) {
      const hh = f * STORY;
      poly(ctx, faceQuadL(W, 0, 1, hh - 1, hh + 0.6), PAL.wallDark);
      poly(ctx, faceQuadR(W, 0, 1, hh - 1, hh + 0.6), shade(PAL.wallDark, -0.12));
    }
    // front vertical corner catches the light
    rect(ctx, 0, H / 2 - wallH, 1, wallH, shade(PAL.wall, 0.1));

    /* ---- openings ------------------------------------------------------ */
    const cols = Math.max(1, Math.floor(W / 26));
    const winMode = (r: number): 'lit' | 'cold' | 'shut' => {
      if (resting) return r < 0.22 ? 'cold' : 'shut';
      if (state === 'active') return r < 0.72 ? 'lit' : 'cold';
      return r < 0.5 ? 'lit' : 'cold'; // growing: half the crew is inside
    };
    for (let f = 0; f < floors; f++) {
      const hc = f * STORY + STORY * 0.58;
      for (let i = 0; i < cols; i++) {
        const t = cols === 1 ? 0.5 : 0.2 + (0.6 * i) / (cols - 1);
        const isDoorSlot = f === 0 && Math.abs(t - 0.5) < 0.14;
        if (!isDoorSlot) drawWindow(ctx, W, 'l', t, hc, winMode(rng()));
        drawWindow(ctx, W, 'r', t, hc, winMode(rng()));
      }
    }

    // door on the front-left face
    const dt = 5.5 / W;
    poly(ctx, faceQuadL(W, 0.5 - dt * 1.35, 0.5 + dt * 1.35, 0, 11.5), PAL.woodDark);
    if (state === 'active') {
      // stood open onto a warm interior
      poly(ctx, faceQuadL(W, 0.5 - dt, 0.5 + dt * 0.2, 0, 10.5), '#5c4a3a');
      poly(ctx, faceQuadL(W, 0.5 + dt * 0.2, 0.5 + dt, 0, 10.5), PAL.wood);
      poly(ctx, faceQuadL(W, 0.5 - dt * 0.9, 0.5 - dt * 0.3, 0, 6), shade(PAL.glassLit, -0.1));
    } else {
      poly(ctx, faceQuadL(W, 0.5 - dt, 0.5 + dt, 0, 10.5), PAL.wood);
      poly(ctx, faceQuadL(W, 0.5 - dt, 0.5 - dt * 0.35, 0, 10.5), PAL.woodLight);
      const knob = leftPt(W, 0.5 + dt * 0.55, 5.5);
      rect(ctx, knob[0], knob[1], 1, 1, PAL.brass);
    }
    poly(ctx, faceQuadL(W, 0.5 - dt * 1.6, 0.5 + dt * 1.6, -1.5, 0.4), PAL.stone);

    if (form.awning) {
      const a0 = leftPt(W, 0.5 - dt * 2.6, 13);
      const a1 = leftPt(W, 0.5 + dt * 2.6, 13);
      const px = -9;
      const py = 4.5;
      const lerp = (t: number): Pt => [
        a0[0] + (a1[0] - a0[0]) * t,
        a0[1] + (a1[1] - a0[1]) * t,
      ];
      const canopy = (t0: number, t1: number, color: string) => {
        const p0 = lerp(t0);
        const p1 = lerp(t1);
        poly(ctx, [p0, p1, [p1[0] + px, p1[1] + py], [p0[0] + px, p0[1] + py]], color);
      };
      canopy(0, 1, resting ? shade(accent, -0.24) : accent);
      canopy(0.3, 0.5, PAL.wall);
      canopy(0.7, 0.9, PAL.wall);
      const f0 = lerp(0);
      const f1 = lerp(1);
      poly(
        ctx,
        [
          [f0[0] + px, f0[1] + py],
          [f1[0] + px, f1[1] + py],
          [f1[0] + px, f1[1] + py + 3],
          [f0[0] + px, f0[1] + py + 3],
        ],
        shade(accent, -0.34)
      );
    }
    // The lamp stays lit even on a resting house — dormant, but still loved.
    if (form.lantern) drawLantern(ctx, W, true);

    /* ---- roof, or the storey going on top ------------------------------ */
    const ry = -wallH;
    /** Front-facing roof polygons, kept so moss can be stippled onto them. */
    const roofFaces: Pt[][] = [];
    if (growing) {
      // Joist deck where the old roof came off.
      poly(ctx, diamond(0, ry, W + 4), PAL.sawn);
      poly(ctx, diamond(0, ry - 1, W - 6), shade(PAL.sawn, -0.14));
      for (let k = -3; k <= 3; k++) {
        const p0 = leftPt(W, 0.5 + k * 0.14, wallH);
        poly(ctx, [
          [p0[0] - W / 4, p0[1] + W / 8],
          [p0[0] + W / 4, p0[1] - W / 8],
          [p0[0] + W / 4, p0[1] - W / 8 + 1],
          [p0[0] - W / 4, p0[1] + W / 8 + 1],
        ], shade(PAL.sawn, -0.3));
      }
      // Corner posts for the new storey.
      const grown = Math.max(1.5, newH * progress);
      for (const t of [0.02, 0.5, 0.98]) {
        poly(ctx, faceQuadL(W, t - 1.5 / W, t + 1.5 / W, wallH, wallH + newH), PAL.wood);
        poly(ctx, faceQuadR(W, t - 1.5 / W, t + 1.5 / W, wallH, wallH + newH), PAL.woodDark);
      }
      // Planking, filled to `progress` — the visible part of "growing".
      poly(ctx, faceQuadL(W, 0.02, 0.98, wallH, wallH + grown), shade(PAL.sawn, 0.06));
      poly(ctx, faceQuadR(W, 0.02, 0.98, wallH, wallH + grown), PAL.sawn);
      for (let h = 3; h < grown; h += 4) {
        poly(ctx, faceQuadL(W, 0.02, 0.98, wallH + h, wallH + h + 0.7), shade(PAL.sawn, -0.16));
        poly(ctx, faceQuadR(W, 0.02, 0.98, wallH + h, wallH + h + 0.7), shade(PAL.sawn, -0.26));
      }
      // ring beam once the storey is nearly up
      if (progress > 0.7) {
        poly(ctx, faceQuadL(W, 0, 1, wallH + newH - 3, wallH + newH), PAL.woodLight);
        poly(ctx, faceQuadR(W, 0, 1, wallH + newH - 3, wallH + newH), PAL.wood);
      }
      // hoist beam poking out over the street
      const hy = wallH + newH + 3;
      rect(ctx, -W / 2 - 12, -hy, W / 2 + 14, 2, PAL.wood);
      rect(ctx, -W / 2 - 12, -hy + 2, 6, 1, PAL.woodDark);
      hoist = [-W / 2 - 10, -hy + 1];
      drawScaffold(ctx, W, wallH + newH);
      drawLadder(ctx, W, wallH + newH - 4);
      // hazard pennant in the project accent
      rect(ctx, W / 2 - 4, -hy - 10, 1, 11, PAL.wood);
      poly(ctx, [[W / 2 - 3, -hy - 10], [W / 2 + 10, -hy - 7], [W / 2 - 3, -hy - 3]], accent);
      peak = Math.max(peak, hy + 12);
    } else if (form.roof === 'flat') {
      poly(ctx, faceQuadL(W, 0, 1, wallH, wallH + 5), mid);
      poly(ctx, faceQuadR(W, 0, 1, wallH, wallH + 5), dark);
      poly(ctx, diamond(0, ry - 5, W), light);
      poly(ctx, diamond(0, ry - 3, W - 12), '#8e8aa0');
      roofFaces.push(diamond(0, ry - 5, W - 4));
      const tk = -W / 6;
      rect(ctx, tk - 3, ry - 16, 7, 8, PAL.stone);
      rect(ctx, tk - 3, ry - 17, 7, 2, PAL.stoneDark);
      rect(ctx, tk - 2, ry - 8, 1, 3, PAL.woodDark);
      rect(ctx, W / 6, ry - 12, 5, 5, shade(PAL.stone, -0.2));
      peak = Math.max(peak, wallH + 18);
    } else if (form.roof === 'hip') {
      const N: Pt = [0, ry - RW / 4];
      const E: Pt = [RW / 2, ry];
      const S: Pt = [0, ry + RW / 4];
      const Wc: Pt = [-RW / 2, ry];
      const apex: Pt = [0, ry - roofH];
      poly(ctx, [N, Wc, apex], shade(accent, -0.42));
      poly(ctx, [N, E, apex], shade(accent, -0.36));
      poly(ctx, [Wc, S, apex], accent);
      poly(ctx, [S, E, apex], dark);
      poly(ctx, [Wc, S, [S[0], S[1] + 2.4], [Wc[0], Wc[1] + 2.4]], shade(accent, -0.5));
      poly(ctx, [S, E, [E[0], E[1] + 2.4], [S[0], S[1] + 2.4]], shade(accent, -0.55));
      poly(ctx, [
        [Wc[0] * 0.5, (Wc[1] + apex[1]) / 2],
        [apex[0], apex[1]],
        [apex[0], apex[1] + 2],
        [Wc[0] * 0.5 + 1, (Wc[1] + apex[1]) / 2 + 2],
      ], light);
      roofFaces.push([Wc, S, apex], [S, E, apex]);
      peak = Math.max(peak, wallH + roofH + 4);
    } else {
      const N: Pt = [0, ry - RW / 4];
      const E: Pt = [RW / 2, ry];
      const S: Pt = [0, ry + RW / 4];
      const Wc: Pt = [-RW / 2, ry];
      const R1: Pt = [-RW / 4, ry - RW / 8 - roofH];
      const R2: Pt = [RW / 4, ry + RW / 8 - roofH];
      poly(ctx, [N, Wc, R1], shade(accent, -0.45));
      poly(ctx, [N, E, R2, R1], shade(accent, -0.38));
      poly(ctx, [E, S, R2], mid);
      poly(ctx, [Wc, S, R2, R1], accent);
      poly(ctx, [Wc, S, [S[0], S[1] + 2.4], [Wc[0], Wc[1] + 2.4]], shade(accent, -0.5));
      poly(ctx, [[R1[0], R1[1]], [R2[0], R2[1]], [R2[0], R2[1] + 2], [R1[0], R1[1] + 2]], light);
      rect(ctx, RW / 4 - 1, ry - roofH + 2, 2, 4, shade(accent, -0.55));
      roofFaces.push([Wc, S, R2, R1], [E, S, R2]);
      peak = Math.max(peak, wallH + roofH + 6);
    }

    if (resting) {
      drawMoss(ctx, roofFaces, 1 - condition, seed * 3 + 11);
      drawIvy(ctx, W, wallH, 1 - condition, seed * 5 + 3);
      // a bird on the ridge — dormant, not dead
      rect(ctx, -W / 6, ry - roofH - 3, 2, 2, PAL.ink);
      rect(ctx, -W / 6 + 2, ry - roofH - 3, 1, 1, PAL.ink);
    }

    if (form.antenna && !growing) {
      rect(ctx, W / 5, ry - 22, 1, 14, PAL.ink);
      rect(ctx, W / 5 - 3, ry - 20, 7, 1, PAL.ink);
      rect(ctx, W / 5 - 2, ry - 17, 5, 1, PAL.ink);
      rect(ctx, W / 5, ry - 24, 1, 2, PAL.flower[0]);
      peak = Math.max(peak, wallH + 30);
    }

    if (form.chimney && !growing) {
      const cx = W / 4;
      const cy = ry - roofH * 0.42;
      rect(ctx, cx - 3, cy - 13, 6, 14, PAL.stone);
      rect(ctx, cx, cy - 13, 3, 14, PAL.stoneDark);
      rect(ctx, cx - 4, cy - 15, 8, 2, shade(PAL.stone, -0.25));
      if (state !== 'resting') smoke = [cx, cy - 16];
      else {
        // resting chimneys wear a little moss too
        rect(ctx, cx - 4, cy - 15, 3, 1, PAL.moss);
      }
    }

    /* ---- pennant: the project's gem colour, readable from a distance --- */
    if (!growing && !form.belfry) {
      const px = -W / 4;
      const py =
        -wallH - roofH - (form.roof === 'flat' ? 5 : 0) - (form.roof === 'gable' ? W / 8 : 0);
      rect(ctx, px, py - 20, 2, 21, PAL.ink);
      poly(ctx, [[px + 1, py - 21], [px + 15, py - 17], [px + 1, py - 12]], PAL.ink);
      poly(
        ctx,
        [[px + 2, py - 20], [px + 13, py - 17], [px + 2, py - 13.5]],
        resting ? shade(accent, -0.22) : accent
      );
      peak = Math.max(peak, wallH + roofH + 24);
    }
  });

  return { ...sp, smoke, bell, hoist, peak: Math.max(peak, wallH + roofH + 8) };
}

/** `planned`: corner stakes, string lines, a dashed chalk footprint, a sign. */
function buildStakedPlot(form: BuildingForm, accent: string, seed: number): StructureSprite {
  const rng = mulberry32(seed);
  const W = form.width;
  return {
    ...makeSprite(W + 60, 74, (W + 60) / 2, 56, (ctx) => {
      // churned survey ground
      poly(ctx, diamond(0, 2, W + 22), shade(PAL.grassDry[0], -0.06));
      poly(ctx, diamond(0, 1, W + 12), PAL.churn);
      poly(ctx, diamond(0, 0, W + 2), shade(PAL.churn, 0.08));

      // dashed footprint outline
      const corners: Pt[] = [
        [0, -W / 4],
        [W / 2, 0],
        [0, W / 4],
        [-W / 2, 0],
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const steps = 18;
        for (let k = 0; k < steps; k++) {
          if (k % 3 === 2) continue;
          const t = k / steps;
          rect(ctx, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 2, 1, '#fdf3e2');
        }
      }
      // corner stakes + string line
      for (const [cx, cy] of corners) {
        rect(ctx, cx, cy - 12, 2, 13, PAL.wood);
        rect(ctx, cx, cy - 14, 2, 2, accent);
      }
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const steps = 26;
        for (let k = 0; k < steps; k++) {
          const t = k / steps;
          rect(ctx, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 10, 1, 1, '#f6ead2');
        }
      }
      // survey sign
      const sx = -W / 2 - 12;
      rect(ctx, sx, -20, 2, 21, PAL.wood);
      poly(ctx, [[sx - 9, -32], [sx + 11, -29], [sx + 11, -18], [sx - 9, -21]], PAL.woodLight);
      poly(ctx, [[sx - 9, -32], [sx + 11, -29], [sx + 11, -27], [sx - 9, -30]], accent);
      for (let k = 0; k < 3; k++) {
        rect(ctx, sx - 6, -26 + k * 3, 12 - k * 3, 1, PAL.woodDark);
      }
      // a surveyor's tripod stake and a coil of line
      rect(ctx, W / 2 + 8, -14, 1, 15, PAL.woodDark);
      rect(ctx, W / 2 + 6, -3, 5, 1, PAL.woodDark);
      if (rng() < 2) {
        blob(ctx, W / 2 + 14, -4, [5, 7, 7, 5], PAL.sawn);
      }
    }),
    smoke: null,
    bell: null,
    hoist: null,
    peak: 34,
  };
}

/* -------------------------------- sawmill ------------------------------- */

export interface SawmillSprite extends Sprite {
  /** Saw-blade centre — the renderer spins the blade here. */
  blade: Pt;
  /** Water-wheel centre. */
  wheel: Pt;
  peak: number;
}

export function buildSawmill(accent: string): SawmillSprite {
  const W = 46;
  const wallH = 20;
  const roofH = 14;
  const sp = makeSprite(W + 60, 90, (W + 60) / 2, 74, (ctx) => {
    poly(ctx, diamond(3, 2, W + 12), PAL.shadow);
    // stone base + open-sided timber shed
    poly(ctx, faceQuadL(W, 0, 1, 0, 4), PAL.stone);
    poly(ctx, faceQuadR(W, 0, 1, 0, 4), PAL.stoneDark);
    poly(ctx, faceQuadR(W, 0, 1, 4, wallH), PAL.wood);
    for (let k = 1; k < 6; k++) {
      poly(ctx, faceQuadR(W, k / 6 - 0.01, k / 6 + 0.01, 4, wallH), PAL.woodDark);
    }
    // open front: posts only, dark interior behind
    poly(ctx, faceQuadL(W, 0, 1, 4, wallH), '#4a3c33');
    for (const t of [0.02, 0.34, 0.66, 0.98]) {
      poly(ctx, faceQuadL(W, t - 1.6 / W, t + 1.6 / W, 0, wallH + 1), PAL.woodLight);
    }
    // saw bench + the log going through it
    const b0 = leftPt(W, 0.2, 7);
    const b1 = leftPt(W, 0.86, 7);
    poly(ctx, [b0, b1, [b1[0], b1[1] + 3], [b0[0], b0[1] + 3]], PAL.woodDark);
    poly(ctx, [[b0[0] + 2, b0[1] - 4], [b1[0] - 8, b1[1] - 8], [b1[0] - 8, b1[1] - 4], [b0[0] + 2, b0[1]]], PAL.wood);

    // gable roof
    const RW = W + 10;
    const ry = -wallH;
    const N: Pt = [0, ry - RW / 4];
    const E: Pt = [RW / 2, ry];
    const S: Pt = [0, ry + RW / 4];
    const Wc: Pt = [-RW / 2, ry];
    const R1: Pt = [-RW / 4, ry - RW / 8 - roofH];
    const R2: Pt = [RW / 4, ry + RW / 8 - roofH];
    poly(ctx, [N, Wc, R1], shade(accent, -0.44));
    poly(ctx, [N, E, R2, R1], shade(accent, -0.36));
    poly(ctx, [E, S, R2], shade(accent, -0.1));
    poly(ctx, [Wc, S, R2, R1], accent);
    poly(ctx, [Wc, S, [S[0], S[1] + 2.4], [Wc[0], Wc[1] + 2.4]], shade(accent, -0.52));
    poly(ctx, [[R1[0], R1[1]], [R2[0], R2[1]], [R2[0], R2[1] + 2], [R1[0], R1[1] + 2]], shade(accent, 0.24));
    // sign board on the gable
    poly(ctx, [[R2[0] - 12, ry - 6], [R2[0] + 2, ry - 3], [R2[0] + 2, ry + 3], [R2[0] - 12, ry]], PAL.woodLight);
    rect(ctx, R2[0] - 9, ry - 3, 8, 1, PAL.woodDark);
    rect(ctx, R2[0] - 9, ry - 1, 5, 1, PAL.woodDark);

    // mill race + water wheel on the left
    const wxp = -W / 2 - 16;
    const wyp = 2;
    poly(ctx, [[wxp - 12, wyp + 4], [wxp + 10, wyp - 7], [wxp + 10, wyp - 3], [wxp - 12, wyp + 8]], '#79bcd4');
    poly(ctx, [[wxp - 12, wyp + 8], [wxp + 10, wyp - 3], [wxp + 10, wyp - 1], [wxp - 12, wyp + 10]], '#5f9db5');
    rect(ctx, wxp - 2, wyp - 20, 2, 20, PAL.woodDark);
  });
  return { ...sp, blade: [4, -12], wheel: [-W / 2 - 16 - 1, -8], peak: wallH + roofH + 12 };
}

/* ------------------------------ notice board ---------------------------- */

/** Posts, a shingled hood, and pinned notices — the build log lives here. */
export function buildNoticeBoard(lines: number): Sprite {
  return makeSprite(48, 52, 24, 44, (ctx) => {
    poly(ctx, diamond(1, 1, 26), PAL.shadow);
    rect(ctx, -13, -26, 3, 27, PAL.wood);
    rect(ctx, 10, -26, 3, 27, PAL.wood);
    rect(ctx, -13, -1, 26, 2, PAL.woodDark);
    // board
    poly(ctx, [[-15, -34], [15, -34], [15, -6], [-15, -6]], PAL.woodDark);
    poly(ctx, [[-13, -32], [13, -32], [13, -8], [-13, -8]], '#e8d9bd');
    // pinned notices: the newest is the brightest
    const n = Math.max(3, Math.min(5, lines));
    for (let i = 0; i < n; i++) {
      const y = -30 + i * 5;
      rect(ctx, -11, y, 22, 4, i === 0 ? '#fffdf6' : '#f4ecdc');
      rect(ctx, -10, y + 1, 14 - i * 2, 1, i === 0 ? '#8d7f66' : '#b3a68e');
      rect(ctx, -10, y + 3, 9 + ((i * 5) % 8), 1, '#c3b79f');
      rect(ctx, -11, y, 1, 1, PAL.flower[i % PAL.flower.length]);
    }
    // hood
    poly(ctx, [[-18, -34], [18, -34], [14, -41], [-14, -41]], '#8a6f52');
    poly(ctx, [[-18, -34], [18, -34], [18, -32], [-18, -32]], '#6f573f');
    for (let x = -16; x < 16; x += 5) rect(ctx, x, -40, 4, 1, '#9d8163');
    // a hanging lantern so it can be read after dark
    rect(ctx, 15, -38, 1, 6, PAL.ink);
    rect(ctx, 14, -32, 4, 4, PAL.glassLit);
    rect(ctx, 14, -28, 4, 1, PAL.ink);
  });
}

/* --------------------------------- props -------------------------------- */

export function buildTree(kind: 0 | 1 | 2, seed: number): Sprite {
  const rng = mulberry32(seed);
  const leaf = PAL.leaf[Math.floor(rng() * PAL.leaf.length)];
  if (kind === 0) {
    return makeSprite(32, 40, 16, 35, (ctx) => {
      poly(ctx, diamond(1, 1, 18), PAL.shadow);
      rect(ctx, -2, -21, 4, 21, PAL.wood);
      rect(ctx, 0, -21, 2, 21, PAL.woodDark);
      blob(ctx, 0, -33, [6, 10, 14, 18, 20, 22, 22, 22, 20, 18, 14, 10, 7, 4], leaf);
      blob(ctx, -4, -32, [6, 10, 12, 12, 10, 8, 6], shade(leaf, 0.26));
      blob(ctx, 4, -24, [8, 10, 10, 8, 5], shade(leaf, -0.2));
    });
  }
  if (kind === 1) {
    const h = 42 + Math.floor(rng() * 10);
    return makeSprite(28, h + 8, 14, h + 4, (ctx) => {
      poly(ctx, diamond(1, 1, 16), PAL.shadow);
      rect(ctx, -1, -8, 3, 8, PAL.woodDark);
      for (let i = 0; i < 3; i++) {
        const y = -8 - i * (h / 4.6);
        const w = 21 - i * 5;
        poly(ctx, [[-w / 2, y], [w / 2, y], [0, y - h / 2.6]], i === 0 ? shade(leaf, -0.18) : leaf);
        poly(ctx, [[0, y], [w / 2, y], [0, y - h / 2.6]], shade(leaf, -0.32));
      }
    });
  }
  return makeSprite(28, 38, 14, 34, (ctx) => {
    poly(ctx, diamond(1, 1, 16), PAL.shadow);
    rect(ctx, -2, -17, 3, 17, PAL.wood);
    blob(ctx, 0, -27, [6, 12, 16, 20, 20, 20, 18, 14, 10, 6], PAL.blossom);
    blob(ctx, -4, -26, [6, 10, 10, 8, 5], shade(PAL.blossom, 0.3));
    blob(ctx, 4, -20, [7, 8, 6], shade(PAL.blossom, -0.16));
  });
}

export function buildStump(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 11 + Math.floor(rng() * 4);
  return makeSprite(w + 12, 20, (w + 12) / 2, 14, (ctx) => {
    poly(ctx, diamond(1, 1, w + 5), PAL.shadow);
    poly(ctx, [[-w / 2, -4], [0, -4 + w / 4], [w / 2, -4], [w / 2, 0], [0, w / 4], [-w / 2, 0]], PAL.woodDark);
    poly(ctx, diamond(0, -4, w), PAL.woodLight);
    poly(ctx, diamond(0, -4, w * 0.6), shade(PAL.woodLight, -0.12));
    poly(ctx, diamond(0, -4, w * 0.24), shade(PAL.woodLight, -0.24));
    if (rng() < 0.4) {
      rect(ctx, -w / 2 - 3, -1, 4, 2, PAL.woodDark);
      blob(ctx, -w / 2 - 3, -4, [3, 5, 4], PAL.moss);
    }
  });
}

/**
 * A trunk lying on the ground, aligned to the isometric grid (slope 1:2) so it
 * reads as a log in the world rather than a plank pasted on top of it.
 */
export function buildFelledLog(seed: number): Sprite {
  const rng = mulberry32(seed);
  const len = 14 + Math.floor(rng() * 8);
  const flip = rng() < 0.5 ? 1 : -1;
  const dy = (-len / 2) * flip;
  return makeSprite(len + 16, len / 2 + 22, (len + 16) / 2, len / 4 + 12, (ctx) => {
    const x0 = -len / 2;
    const y0 = (len / 4) * flip;
    // ground shadow, lying flat along the same axis
    poly(ctx, [
      [x0 - 1, y0 + 1],
      [x0 + len + 1, y0 + dy + 1],
      [x0 + len + 1, y0 + dy + 3],
      [x0 - 1, y0 + 3],
    ], PAL.shadow);
    // Column-by-column cylinder: a light crown, a mid band and a dark
    // underside give the trunk actual roundness at this size.
    for (let t = 0; t <= len; t++) {
      const x = x0 + t;
      const y = y0 + (dy * t) / len;
      rect(ctx, x, y - 5, 1, 2, PAL.woodLight);
      rect(ctx, x, y - 3, 1, 3, PAL.wood);
      rect(ctx, x, y, 1, 2, PAL.woodDark);
      if (t % 5 === 2) rect(ctx, x, y - 3, 1, 2, shade(PAL.wood, -0.18));
    }
    // sawn butt end nearest the viewer
    blob(ctx, x0, y0 - 3, [3, 5, 6, 6, 5, 3, 2], PAL.sawn);
    blob(ctx, x0, y0 - 2, [2, 3, 3], shade(PAL.sawn, -0.2));
    if (rng() < 0.45) blob(ctx, x0 + len - 3, y0 + dy - 4, [3, 5, 4], PAL.moss);
  });
}

export function buildLumber(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(30, 30, 15, 24, (ctx) => {
    poly(ctx, diamond(1, 1, 24), PAL.shadow);
    for (let i = 0; i < 5; i++) {
      const y = -3 - i * 3;
      const x = -9 + i * 1.4;
      poly(ctx, [[x, y], [x + 17, y - 8], [x + 17, y - 5], [x, y + 3]], i % 2 ? PAL.sawn : PAL.woodLight);
      poly(ctx, [[x, y], [x, y + 3], [x + 2, y + 4], [x + 2, y + 1]], PAL.woodDark);
    }
    if (rng() < 0.5) {
      rect(ctx, 8, -8, 5, 6, PAL.stoneDark);
      rect(ctx, 8, -9, 5, 1, PAL.stone);
    }
  });
}

export function buildSawdust(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(38, 22, 19, 16, (ctx) => {
    poly(ctx, diamond(0, 1, 34), shade(PAL.sawn, -0.22));
    blob(ctx, 0, -8, [8, 14, 20, 25, 28, 30, 30, 26, 14], PAL.sawn);
    blob(ctx, -4, -7, [5, 9, 10, 7], shade(PAL.sawn, 0.2));
    for (let i = 0; i < 6; i++) {
      rect(ctx, (rng() - 0.5) * 26, -2 - rng() * 5, 2, 1, shade(PAL.sawn, -0.18));
    }
  });
}

export function buildCrates(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(28, 28, 14, 23, (ctx) => {
    poly(ctx, diamond(1, 1, 20), PAL.shadow);
    const box = (x: number, y: number, s: number) => {
      poly(ctx, [[x - s, y], [x, y + s / 2], [x, y + s / 2 - s], [x - s, y - s]], PAL.woodLight);
      poly(ctx, [[x, y + s / 2], [x + s, y], [x + s, y - s], [x, y + s / 2 - s]], PAL.wood);
      poly(ctx, diamond(x, y - s, s * 2), shade(PAL.woodLight, 0.16));
    };
    box(-4, 0, 7);
    box(6, -2, 6);
    if (rng() < 0.6) box(-3, -14, 5);
  });
}

export function buildBush(seed: number): Sprite {
  const rng = mulberry32(seed);
  const leaf = PAL.leaf[Math.floor(rng() * PAL.leaf.length)];
  return makeSprite(22, 18, 11, 14, (ctx) => {
    poly(ctx, diamond(1, 1, 14), PAL.shadow);
    blob(ctx, 0, -9, [7, 11, 14, 16, 16, 15, 12, 9, 5], leaf);
    blob(ctx, -3, -8, [5, 7, 6], shade(leaf, 0.28));
    if (rng() < 0.5) rect(ctx, 3, -5, 1, 1, PAL.flower[0]);
  });
}

export function buildRock(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 9 + Math.floor(rng() * 6);
  return makeSprite(w + 8, 16, (w + 8) / 2, 12, (ctx) => {
    poly(ctx, diamond(1, 1, w + 3), PAL.shadow);
    blob(ctx, 0, -6, [w - 5, w - 2, w, w, w - 1, w - 3], PAL.stone);
    blob(ctx, -1, -6, [w - 7, w - 6], shade(PAL.stone, 0.22));
  });
}

export function buildFlowerPatch(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(28, 18, 14, 11, (ctx) => {
    for (let i = 0; i < 11; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng();
      const x = Math.cos(a) * r * 11;
      const y = (Math.sin(a) * r * 11) / 2;
      rect(ctx, x, y - 2, 1, 2, PAL.leafDark);
      rect(ctx, x, y - 3, 1, 1, PAL.flower[Math.floor(rng() * PAL.flower.length)]);
    }
  });
}

export function buildFence(dir: 'l' | 'r'): Sprite {
  const w = 34;
  return makeSprite(w + 6, 34, (w + 6) / 2, 22, (ctx) => {
    const s = dir === 'l' ? 1 : -1;
    for (let i = 0; i <= 4; i++) {
      const x = -w / 2 + (i * w) / 4;
      const y = (s * x) / 2;
      rect(ctx, x, y - 9, 2, 10, PAL.woodLight);
      rect(ctx, x, y - 10, 2, 1, PAL.wall);
    }
    poly(ctx, [
      [-w / 2, (s * -w) / 4 - 6],
      [w / 2, (s * w) / 4 - 6],
      [w / 2, (s * w) / 4 - 4.4],
      [-w / 2, (s * -w) / 4 - 4.4],
    ], PAL.wood);
  });
}

export function buildShed(seed: number): Sprite {
  const rng = mulberry32(seed);
  const W = 22;
  const wallH = 11;
  const roofH = 8;
  const accent = rng() < 0.5 ? '#c98f6a' : '#a8a2b8';
  return makeSprite(W + 16, 44, (W + 16) / 2, 34, (ctx) => {
    poly(ctx, diamond(2, 2, W + 6), PAL.shadow);
    poly(ctx, faceQuadL(W, 0, 1, 0, wallH), PAL.woodLight);
    poly(ctx, faceQuadR(W, 0, 1, 0, wallH), PAL.wood);
    poly(ctx, faceQuadL(W, 0.36, 0.64, 0, 8), PAL.woodDark);
    const RW = W + 6;
    const ry = -wallH;
    const N: Pt = [0, ry - RW / 4];
    const E: Pt = [RW / 2, ry];
    const S: Pt = [0, ry + RW / 4];
    const Wc: Pt = [-RW / 2, ry];
    const R1: Pt = [-RW / 4, ry - RW / 8 - roofH];
    const R2: Pt = [RW / 4, ry + RW / 8 - roofH];
    poly(ctx, [N, E, R2, R1], shade(accent, -0.32));
    poly(ctx, [E, S, R2], shade(accent, -0.14));
    poly(ctx, [Wc, S, R2, R1], accent);
    poly(ctx, [Wc, S, [S[0], S[1] + 2], [Wc[0], Wc[1] + 2]], shade(accent, -0.45));
  });
}

export function buildHaystack(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 20 + Math.floor(rng() * 6);
  return makeSprite(w + 10, 32, (w + 10) / 2, 26, (ctx) => {
    poly(ctx, diamond(1, 1, w + 4), PAL.shadow);
    blob(ctx, 0, -18, [4, 8, 12, 15, 17, 19, w - 4, w - 2, w, w, w - 1, w - 3, w - 6, 4], '#e9c073');
    blob(ctx, -3, -17, [3, 6, 8, 9, 8, 6], '#f4d492');
    for (let i = 0; i < 5; i++) rect(ctx, -w / 2 + 3 + i * 4, -6 - (i % 2), 2, 1, '#c99b4e');
    rect(ctx, 0, -22, 1, 4, PAL.woodDark);
  });
}

export function buildCropRow(seed: number): Sprite {
  const rng = mulberry32(seed);
  const crop = rng() < 0.5 ? '#5fc4a1' : '#8fcf6a';
  return makeSprite(76, 48, 38, 36, (ctx) => {
    poly(ctx, diamond(0, 1, 66), '#b8875c');
    poly(ctx, diamond(0, 0, 60), '#cfa172');
    poly(ctx, diamond(0, -1, 52), '#dcb083');
    for (let r = 0; r < 4; r++) {
      const gy = -0.62 + r * 0.41;
      for (let i = 0; i < 7; i++) {
        const gx = -0.78 + i * 0.26;
        const x = Math.round((gx - gy) * 16);
        const y = Math.round((gx + gy) * 8);
        rect(ctx, x, y - 4, 1, 4, crop);
        rect(ctx, x - 1, y - 5, 3, 1, crop);
        rect(ctx, x - 1, y - 3, 1, 1, shade(crop, -0.2));
      }
    }
  });
}

export function buildWell(): Sprite {
  return makeSprite(32, 42, 16, 34, (ctx) => {
    poly(ctx, diamond(1, 1, 24), PAL.shadow);
    poly(ctx, diamond(0, 0, 22), PAL.stoneDark);
    poly(ctx, [[-11, 0], [0, 5.5], [0, -1.5], [-11, -7]], PAL.stone);
    poly(ctx, [[0, 5.5], [11, 0], [11, -7], [0, -1.5]], shade(PAL.stone, -0.14));
    poly(ctx, diamond(0, -7, 22), '#5f7f96');
    poly(ctx, diamond(0, -7, 14), '#7fb6cd');
    rect(ctx, -8, -22, 2, 15, PAL.wood);
    rect(ctx, 6, -22, 2, 15, PAL.wood);
    poly(ctx, [[-11, -22], [0, -30], [11, -22], [11, -20], [0, -28], [-11, -20]], PAL.leafDark);
    rect(ctx, -1, -21, 1, 6, PAL.woodDark);
    rect(ctx, -3, -15, 5, 4, PAL.wood);
  });
}

export function buildLamp(): Sprite {
  return makeSprite(18, 44, 9, 39, (ctx) => {
    poly(ctx, diamond(1, 1, 12), PAL.shadow);
    poly(ctx, diamond(0, 0, 10), PAL.stoneDark);
    rect(ctx, -1, -26, 2, 26, PAL.ink);
    rect(ctx, -3, -32, 6, 6, PAL.glassLit);
    rect(ctx, -4, -33, 8, 1, PAL.ink);
    rect(ctx, -4, -26, 8, 1, PAL.ink);
    rect(ctx, -1, -35, 1, 2, PAL.ink);
  });
}

export function buildSignpost(variant: number): Sprite {
  const accent = ['#63c9a8', '#f0c75e', '#9b8fe8'][variant % 3];
  const arms = variant === 0 ? 2 : 1;
  return makeSprite(28, 34, 14, 29, (ctx) => {
    poly(ctx, diamond(1, 1, 14), PAL.shadow);
    rect(ctx, -1, -24, 2, 24, PAL.wood);
    for (let i = 0; i < arms; i++) {
      const y = -22 + i * 7;
      const flip = i % 2 === 1;
      const x0 = flip ? -11 : -9;
      poly(ctx, [[x0, y], [x0 + 18, y + 3], [x0 + 18, y + 8], [x0, y + 5]], PAL.woodLight);
      poly(ctx, [[x0, y], [x0 + 18, y + 3], [x0 + 18, y + 4], [x0, y + 1]], accent);
      rect(ctx, x0 + 3, y + 3, 9, 1, PAL.woodDark);
      rect(ctx, x0 + 3, y + 5, 6, 1, PAL.woodDark);
    }
  });
}

/** Painted milestone: the frontier is that way. */
export function buildMilestone(variant: number): Sprite {
  return makeSprite(18, 22, 9, 17, (ctx) => {
    poly(ctx, diamond(1, 1, 12), PAL.shadow);
    blob(ctx, 0, -10, [6, 8, 9, 9, 9, 9, 9, 8, 6], PAL.stone);
    blob(ctx, -2, -9, [4, 4, 3], shade(PAL.stone, 0.24));
    rect(ctx, -3, -7, 6, 1, PAL.ink);
    rect(ctx, -3, -5, 4 - (variant % 2), 1, PAL.ink);
    blob(ctx, 3, -3, [3, 4, 3], PAL.moss);
  });
}

export function buildCrane(accent: string): Sprite {
  const mastH = 56;
  return makeSprite(76, mastH + 28, 28, mastH + 22, (ctx) => {
    poly(ctx, diamond(1, 1, 22), PAL.shadow);
    poly(ctx, diamond(0, 0, 20), PAL.stoneDark);
    poly(ctx, diamond(0, -2, 18), PAL.stone);
    for (let y = 0; y < mastH; y += 6) {
      rect(ctx, -4, -2 - y, 1, 6, PAL.wood);
      rect(ctx, 3, -2 - y, 1, 6, PAL.woodDark);
      rect(ctx, -4, -2 - y, 8, 1, PAL.woodLight);
      poly(ctx, [[-3, -2 - y], [-2, -2 - y], [4, -8 - y], [3, -8 - y]], shade(PAL.wood, 0.1));
    }
    const top = -mastH - 2;
    rect(ctx, -18, top, 46, 2, PAL.wood);
    rect(ctx, -18, top + 2, 46, 1, PAL.woodDark);
    for (let x = -16; x < 26; x += 6) {
      poly(ctx, [[x, top + 2], [x + 1, top + 2], [x + 5, top - 4], [x + 4, top - 4]], PAL.woodLight);
    }
    rect(ctx, -18, top - 5, 46, 1, PAL.woodLight);
    rect(ctx, -6, top + 3, 9, 7, accent);
    rect(ctx, -4, top + 5, 4, 3, PAL.glass);
    rect(ctx, -19, top - 2, 5, 8, PAL.stoneDark);
    rect(ctx, 27, top - 8, 2, 3, PAL.flower[0]);
  });
}

/** Hand cart. `loaded` stacks sawn boards on the bed. */
export function buildCart(loaded: boolean, accent: string): Sprite {
  return makeSprite(46, 38, 23, 28, (ctx) => {
    poly(ctx, diamond(1, 2, 30), PAL.shadow);
    // spoked wheels — a rim and a hub read better than a solid dark block
    for (const wxp of [-11, 8]) {
      poly(ctx, [[wxp, -2], [wxp + 5, -4.5], [wxp + 5, 1], [wxp, 3.5]], PAL.woodDark);
      poly(ctx, [[wxp + 1, -1.5], [wxp + 4, -3], [wxp + 4, 0], [wxp + 1, 1.5]], PAL.woodLight);
      rect(ctx, wxp + 2, -1, 2, 1, PAL.ink);
    }
    // bed
    poly(ctx, [[-13, -7], [0, -0.5], [13, -7], [13, -13], [0, -6.5], [-13, -13]], PAL.woodLight);
    poly(ctx, [[-13, -13], [0, -6.5], [0, -0.5], [-13, -7]], PAL.wood);
    poly(ctx, [[0, -6.5], [13, -13], [13, -7], [0, -0.5]], shade(PAL.wood, -0.14));
    // side boards
    poly(ctx, [[-13, -13], [0, -6.5], [0, -9.5], [-13, -16]], shade(PAL.woodLight, 0.1));
    poly(ctx, [[0, -6.5], [13, -13], [13, -16], [0, -9.5]], PAL.woodLight);
    if (loaded) {
      for (let i = 0; i < 5; i++) {
        const y = -13 - i * 2.6;
        poly(
          ctx,
          [[-10, y], [0, y + 5], [10, y], [10, y - 2.2], [0, y + 2.8], [-10, y - 2.2]],
          i % 2 ? PAL.sawn : PAL.woodLight
        );
      }
      // lashing strap in the cart's colour
      poly(ctx, [[-3, -26], [0, -24.5], [3, -26], [3, -24.6], [0, -23.1], [-3, -24.6]], accent);
    }
    // shaft toward the puller (screen-left)
    poly(ctx, [[-13, -10], [-22, -6], [-22, -4.6], [-13, -8.6]], PAL.wood);
    rect(ctx, -22, -7, 2, 4, PAL.woodDark);
  });
}

/** Puffy cloud: the union of a few discs, clipped to a flat base. */
export function buildCloud(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 46 + Math.floor(rng() * 40);
  const h = 26;
  const lobes: [number, number, number][] = [
    [w * 0.2, 15, 7 + rng() * 3],
    [w * 0.4, 11, 9 + rng() * 3],
    [w * 0.62, 13, 8 + rng() * 3],
    [w * 0.84, 16, 6 + rng() * 3],
  ];
  const base = 19;
  return makeSprite(w + 6, h + 4, 0, 0, (ctx) => {
    for (let y = 0; y <= base; y++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const [lx, ly, lr] of lobes) {
        const dy = y - ly;
        if (Math.abs(dy) > lr) continue;
        const half = Math.sqrt(lr * lr - dy * dy);
        lo = Math.min(lo, lx - half);
        hi = Math.max(hi, lx + half);
      }
      if (!isFinite(lo)) continue;
      const x0 = Math.round(lo) + 3;
      const wid = Math.round(hi) - Math.round(lo);
      rect(ctx, x0, y, wid, 1, y >= base - 2 ? PAL.cloudShade : PAL.cloud);
      if (y >= 4 && y <= 8) rect(ctx, x0 + 2, y, Math.max(2, wid * 0.3), 1, PAL.cloud);
    }
  });
}

/* -------------------------- prop sprite dispatch ------------------------ */

export function makeProp(kind: PropKind, variant: number): Sprite {
  const s = variant * 37 + 11;
  switch (kind) {
    case 'oak':
      return buildTree(0, s);
    case 'conifer':
      return buildTree(1, s);
    case 'blossom':
      return buildTree(2, s);
    case 'bush':
      return buildBush(s);
    case 'rock':
      return buildRock(s);
    case 'flowers':
      return buildFlowerPatch(s);
    case 'stump':
      return buildStump(s);
    case 'felled':
      return buildFelledLog(s);
    case 'lumber':
      return buildLumber(s);
    case 'crates':
      return buildCrates(s);
    case 'sawdust':
      return buildSawdust(s);
    case 'shed':
      return buildShed(s);
    case 'haystack':
      return buildHaystack(s);
    case 'crop':
      return buildCropRow(s);
    case 'well':
      return buildWell();
    case 'lamp':
      return buildLamp();
    case 'signpost':
      return buildSignpost(variant);
    case 'milestone':
      return buildMilestone(variant);
    case 'fenceL':
      return buildFence('l');
    case 'fenceR':
      return buildFence('r');
    case 'crane':
      return buildCrane('#f0c75e');
    case 'cartParked':
      return buildCart(false, '#f0c75e');
    case 'noticeboard':
      return buildNoticeBoard(5);
    default:
      return buildBush(s);
  }
}

/* ------------------------------- villagers ------------------------------ */

export type BotAction = 'walk' | 'idle' | 'work' | 'carry' | 'look' | 'saw' | 'pull';

/** A villager: ~14px tall, drawn from flat rects straight into the buffer. */
export function drawBot(
  ctx: Ctx,
  x: number,
  y: number,
  color: string,
  faceRight: boolean,
  action: BotAction,
  phase: number
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const s = faceRight ? 1 : -1;
  const dark = shade(color, -0.28);
  const light = shade(color, 0.24);

  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(px - 4, py - 1, 8, 2);
  ctx.fillRect(px - 5, py, 10, 1);

  const walking = action === 'walk' || action === 'carry' || action === 'pull';
  const step = walking ? Math.sin(phase * 9) : 0;
  const bob = walking ? (Math.abs(Math.sin(phase * 9)) > 0.6 ? -1 : 0) : 0;
  const lean = action === 'pull' ? s * 1 : 0;
  const top = py + bob;

  ctx.fillStyle = PAL.ink;
  ctx.fillRect(px - 2, top - 3, 2, 3 + (step > 0 ? -1 : 0));
  ctx.fillRect(px + 1, top - 3, 2, 3 + (step < 0 ? -1 : 0));

  ctx.fillStyle = color;
  ctx.fillRect(px - 3 + lean, top - 9, 6, 6);
  ctx.fillStyle = dark;
  ctx.fillRect(px + lean + (faceRight ? 2 : -3), top - 9, 1, 6);
  ctx.fillStyle = light;
  ctx.fillRect(px - 3 + lean + (faceRight ? 0 : 5), top - 9, 1, 3);

  ctx.fillStyle = shade(color, -0.14);
  if (action === 'work') {
    const swing = Math.sin(phase * 11) > 0 ? 0 : 3;
    ctx.fillRect(px + s * 3 - (faceRight ? 0 : 1), top - 9 + swing, 1, 3);
    ctx.fillRect(px - s * 3 - (faceRight ? 1 : 0), top - 8, 1, 3);
    ctx.fillStyle = PAL.stoneDark;
    ctx.fillRect(px + s * 4 - (faceRight ? 0 : 2), top - 11 + swing * 2, 3, 2);
  } else if (action === 'saw') {
    const push = Math.round(Math.sin(phase * 7) * 2);
    ctx.fillRect(px + s * 3 + push, top - 8, 2, 2);
    ctx.fillRect(px - s * 2 + push, top - 8, 2, 2);
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(px + s * 4 + push, top - 8, 6 * s > 0 ? 6 : -6, 1);
  } else if (action === 'carry') {
    ctx.fillRect(px - 4, top - 10, 1, 3);
    ctx.fillRect(px + 3, top - 10, 1, 3);
    ctx.fillStyle = PAL.sawn;
    ctx.fillRect(px - 5, top - 13, 10, 3);
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(px - 5, top - 11, 10, 1);
  } else if (action === 'pull') {
    ctx.fillRect(px + lean - s * 4, top - 7, 3, 1);
  } else if (action === 'look') {
    // stopped, hand shading the eyes, chin up toward the bell
    ctx.fillRect(px - 4, top - 8, 1, 3);
    ctx.fillRect(px + 2, top - 12, 3, 1);
  } else {
    ctx.fillRect(px - 4, top - 8 + (step > 0 ? 1 : 0), 1, 3);
    ctx.fillRect(px + 3, top - 8 + (step < 0 ? 1 : 0), 1, 3);
  }

  const headUp = action === 'look' ? 1 : 0;
  ctx.fillStyle = '#f7e2c8';
  ctx.fillRect(px - 2 + lean, top - 14 - headUp, 5, 5);
  ctx.fillStyle = '#e8cba9';
  ctx.fillRect(px + lean + (faceRight ? 2 : -2), top - 14 - headUp, 1, 5);
  ctx.fillStyle = dark;
  ctx.fillRect(px - 3 + lean, top - 16 - headUp, 7, 2);
  ctx.fillRect(px - 2 + lean, top - 17 - headUp, 5, 1);
  ctx.fillStyle = PAL.ink;
  if (action !== 'work' && action !== 'saw') {
    ctx.fillRect(px + lean + (faceRight ? 1 : -2), top - 12 - headUp, 1, 1);
    ctx.fillRect(px + lean + (faceRight ? -1 : 0), top - 12 - headUp, 1, 1);
  }
}

/**
 * The bell itself, drawn live so it can actually swing. Built row by row: at
 * eleven pixels tall a proper bell silhouette (crown, shoulder, waist, flared
 * lip) is the only thing that reads, and each row leans a little further than
 * the one above it so the swing pivots at the yoke.
 */
export function drawBell(ctx: Ctx, x: number, y: number, angle: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  const sw = Math.sin(angle) * 3;
  const widths = [3, 4, 5, 6, 7, 8];
  // crown loop hanging from the (baked) yoke
  rect(ctx, px - 1, py - 9, 2, 2, PAL.brassDark);
  for (let i = 0; i < widths.length; i++) {
    const off = Math.round((sw * (i + 1)) / widths.length);
    const w = widths[i];
    rect(ctx, px - w / 2 + off, py - 7 + i, w, 1, i < 2 ? shade(PAL.brass, 0.2) : PAL.brass);
    rect(ctx, px + w / 2 - 1 + off, py - 7 + i, 1, 1, PAL.brassDark);
  }
  const lip = Math.round(sw);
  rect(ctx, px - 5 + lip, py - 1, 10, 1, shade(PAL.brass, 0.12));
  rect(ctx, px - 5 + lip, py, 10, 1, PAL.brassDark);
  // the clapper swings harder than the bell does
  rect(ctx, px + Math.round(sw * 1.7), py, 1, 2, '#6b5a3a');
}

/** A pixel quaver floating up from the belfry. */
export function drawNote(ctx: Ctx, x: number, y: number, alpha: number, color: string): void {
  ctx.globalAlpha = alpha;
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.fillStyle = color;
  ctx.fillRect(px - 2, py, 3, 2);
  ctx.fillRect(px + 1, py - 6, 1, 6);
  ctx.fillRect(px + 2, py - 6, 2, 1);
  ctx.fillRect(px + 3, py - 5, 1, 2);
  ctx.globalAlpha = 1;
}

export { disc };
