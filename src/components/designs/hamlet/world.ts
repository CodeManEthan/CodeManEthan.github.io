/**
 * Pixel Hamlet — drawing primitives and sprite factories.
 *
 * Everything here paints into a *low-resolution* buffer — half or quarter the
 * pixel count of the viewport — that the component upscales with
 * `image-rendering: pixelated`, so every routine below is written to produce
 * hard-edged, un-antialiased output:
 * no `arc`, no gradients, no `stroke`. Filled shapes go through `poly()`, a
 * scanline rasteriser that snaps every span to whole pixels.
 *
 * Static art (buildings, trees, props) is baked once into small offscreen
 * canvases — "sprites" — so the per-frame cost is a handful of `drawImage`
 * calls plus the villagers, which are cheap enough to draw procedurally.
 */

export type Ctx = CanvasRenderingContext2D;

/** Isometric tile footprint, in art pixels. The 2:1 ratio gives clean slopes. */
export const TW = 32;
export const TH = 16;
/** Height of one building storey, in art pixels. */
export const STORY = 13;

export interface Sprite {
  c: HTMLCanvasElement;
  /** Anchor offset: the sprite's ground-centre sits at (ox, oy) inside it. */
  ox: number;
  oy: number;
}

/* ------------------------------- palette ------------------------------- */

export const PAL = {
  skyTop: '#a8dbf0',
  skyLow: '#fbeacd',
  sun: '#fff6cf',
  sunCore: '#ffeaa6',
  cloud: '#ffffff',
  cloudShade: '#dfeaf2',
  hillFar: '#b6d9d0',
  hillNear: '#93c9ae',
  treeline: '#6cb492',
  treelineDark: '#54997a',

  grass: ['#84cc9e', '#7ec898', '#89d1a3', '#7bc494'],
  /** Slightly deeper meadow, selected by low-frequency noise to break up the
      regular tile checker into organic patches. */
  grassAlt: ['#77c08f', '#71ba89', '#7cc79a', '#6cb585'],
  grassEdge: '#63ab7e',
  flower: ['#ef7f93', '#f0c75e', '#ffffff', '#9b8fe8'],

  dirt: '#d9b184',
  dirtAlt: '#d0a577',
  dirtEdge: '#bd8f63',

  wall: '#fdf3e2',
  wallShade: '#e7d5ba',
  wallDark: '#cfb997',
  stone: '#cfc8bb',
  stoneDark: '#a9a294',
  wood: '#b98a5e',
  woodDark: '#8f6743',
  woodLight: '#dcbc8c',

  glass: '#a5dcef',
  glassDark: '#7fc2da',
  glassLit: '#ffd98a',

  ink: '#4a4260',
  shadow: 'rgba(74, 66, 96, 0.17)',

  leaf: ['#5fc4a1', '#4fb28f', '#78d5b0'],
  leafDark: '#3f9678',
  blossom: '#f2a8c0',
} as const;

/* ------------------------------ utilities ------------------------------ */

/** Deterministic PRNG so the village looks identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    const k = 1 + amt;
    r *= k;
    g *= k;
    b *= k;
  }
  const v = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  return `#${(v | 0x1000000).toString(16).slice(1)}`;
}

export function rect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export type Pt = [number, number];

/**
 * Scanline polygon fill with whole-pixel spans — the workhorse. Rounding both
 * span ends is what keeps 2:1 isometric edges as clean 2-pixel stair-steps
 * instead of the grey fringe a normal `fill()` would leave.
 */
export function poly(ctx: Ctx, pts: Pt[], color: string): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!isFinite(minY)) return;
  ctx.fillStyle = color;
  const xs: number[] = [];
  const y0 = Math.floor(minY);
  const y1 = Math.ceil(maxY);
  for (let y = y0; y < y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.round(xs[i]);
      const xb = Math.round(xs[i + 1]);
      if (xb > xa) ctx.fillRect(xa, y, xb - xa, 1);
    }
  }
}

/** An isometric ground tile centred on (cx, cy). Hand-unrolled for speed. */
export function isoTile(ctx: Ctx, cx: number, cy: number, color: string): void {
  ctx.fillStyle = color;
  const left = cx - 16;
  const top = cy - 8;
  for (let i = 0; i < 16; i++) {
    const w = i < 8 ? 4 * (i + 1) : 4 * (16 - i);
    ctx.fillRect(left + (32 - w) / 2, top + i, w, 1);
  }
}

/** Corner points of a diamond of on-screen width `w`, centred at (cx, cy). */
export function diamond(cx: number, cy: number, w: number): Pt[] {
  const h = w / 2;
  return [
    [cx, cy - h / 2],
    [cx + w / 2, cy],
    [cx, cy + h / 2],
    [cx - w / 2, cy],
  ];
}

export function makeSprite(
  w: number,
  h: number,
  ox: number,
  oy: number,
  draw: (ctx: Ctx) => void
): Sprite {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const rx = Math.round(ox);
  const ry = Math.round(oy);
  ctx.translate(rx, ry);
  draw(ctx);
  return { c, ox: rx, oy: ry };
}

/** 1px halo used to highlight the hovered/focused building. */
export function makeOutline(sp: Sprite, color: string): Sprite {
  const c = document.createElement('canvas');
  c.width = sp.c.width + 2;
  c.height = sp.c.height + 2;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  for (const [dx, dy] of [
    [1, 0],
    [1, 2],
    [0, 1],
    [2, 1],
  ]) {
    x.drawImage(sp.c, dx, dy);
  }
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(sp.c, 1, 1);
  return { c, ox: sp.ox + 1, oy: sp.oy + 1 };
}

/* ------------------------------ buildings ------------------------------ */

export type RoofStyle = 'hip' | 'gable' | 'flat';

export interface BuildingSpec {
  accent: string;
  /** Footprint width on screen, in art pixels. Always a multiple of 4. */
  W: number;
  floors: number;
  style: RoofStyle;
  chimney: boolean;
  /** Bolt-on silhouette features. */
  tower?: boolean;
  cupola?: boolean;
  antenna?: boolean;
  awning?: boolean;
  /** Half-finished: exposed frame, scaffolding, no roof. */
  construction?: boolean;
  /** Finished, but wrapped in scaffolding on one side. */
  scaffold?: boolean;
  /** Every window warmly lit — the workshop is never empty. */
  lit?: boolean;
  seed: number;
}

export interface BuildingSprite extends Sprite {
  /** Chimney mouth, relative to the ground-centre anchor. */
  smoke: Pt | null;
}

/** Face parameterisation: t runs corner→corner, hh is height above ground. */
function leftPt(W: number, t: number, hh: number): Pt {
  return [-W / 2 + (t * W) / 2, (t * W) / 4 - hh];
}
function rightPt(W: number, t: number, hh: number): Pt {
  return [(t * W) / 2, W / 4 - (t * W) / 4 - hh];
}
function faceQuadL(W: number, t0: number, t1: number, h0: number, h1: number): Pt[] {
  return [leftPt(W, t0, h1), leftPt(W, t1, h1), leftPt(W, t1, h0), leftPt(W, t0, h0)];
}
function faceQuadR(W: number, t0: number, t1: number, h0: number, h1: number): Pt[] {
  return [rightPt(W, t0, h1), rightPt(W, t1, h1), rightPt(W, t1, h0), rightPt(W, t0, h0)];
}

function drawWindow(
  ctx: Ctx,
  W: number,
  side: 'l' | 'r',
  tc: number,
  hc: number,
  lit: boolean
): void {
  const q = side === 'l' ? faceQuadL : faceQuadR;
  const dt = 7 / W;
  const frame = q(W, tc - dt, tc + dt, hc - 4, hc + 4);
  poly(ctx, frame, PAL.woodDark);
  const inner = q(W, tc - dt * 0.72, tc + dt * 0.72, hc - 3, hc + 3);
  poly(ctx, inner, lit ? PAL.glassLit : side === 'l' ? PAL.glass : PAL.glassDark);
  // A single bright pane corner reads as a reflection at this size.
  const glint = q(W, tc - dt * 0.72, tc - dt * 0.1, hc + 0.6, hc + 3);
  poly(ctx, glint, lit ? shade(PAL.glassLit, 0.35) : shade(PAL.glass, 0.4));
}

/** Small stacked-box scaffolding drawn against the front-left face. */
function drawScaffold(ctx: Ctx, W: number, h: number): void {
  const lifts = Math.max(2, Math.round(h / 11));
  for (let i = 1; i <= lifts; i++) {
    const hh = (h / lifts) * i;
    poly(ctx, faceQuadL(W, 0.05, 0.95, hh - 1.4, hh + 1.4), PAL.woodLight);
  }
  for (const t of [0.08, 0.5, 0.92]) {
    poly(ctx, faceQuadL(W, t - 1.2 / W, t + 1.2 / W, 0, h + 3), PAL.wood);
  }
  // diagonal brace
  const a = leftPt(W, 0.1, 1);
  const b = leftPt(W, 0.9, h);
  poly(ctx, [
    [a[0], a[1]],
    [a[0] + 1.5, a[1] + 1],
    [b[0] + 1.5, b[1] + 1],
    [b[0], b[1]],
  ], PAL.woodDark);
}

export function buildBuilding(spec: BuildingSpec): BuildingSprite {
  const { accent, W, floors, style, seed } = spec;
  const rng = mulberry32(seed);
  const H = W / 2;
  // A building site reads better with at least two storeys of frame, whatever
  // the finished footprint will be.
  const cFloors = Math.max(floors, 2);
  const wallH = spec.construction ? Math.round(cFloors * STORY * 0.55) : floors * STORY;
  const eave = 4;
  const RW = W + eave * 2;
  const roofH = spec.construction ? 0 : style === 'flat' ? 5 : Math.round(W * 0.30);
  const towerH = spec.tower ? Math.round(wallH * 0.35) + 14 : 0;
  const cupolaH = spec.cupola ? 16 : 0;

  const padX = eave + 12;
  const padTop = (spec.construction ? 40 : 26) + towerH + cupolaH;
  const padBottom = 6;
  const spriteW = W + padX * 2;
  const spriteH =
    padTop + roofH + (spec.construction ? cFloors * STORY + 14 : wallH) + H + padBottom;

  const dark = shade(accent, -0.3);
  const mid = shade(accent, -0.12);
  const light = shade(accent, 0.22);

  let smoke: Pt | null = null;

  const sp = makeSprite(
    spriteW,
    spriteH,
    padX + W / 2,
    spriteH - H / 2 - padBottom,
    (ctx) => {
    // ---- cast shadow -------------------------------------------------
    poly(ctx, diamond(3, 2, W + 6), PAL.shadow);

    // ---- optional back tower (drawn first so it sits behind) ----------
    if (spec.tower) {
      const tw = 16;
      const tx = -W / 2 + 10;
      const ty = -H / 4 + 2;
      const th = wallH + towerH - 14;
      ctx.save();
      ctx.translate(tx, ty);
      poly(ctx, [
        [-tw / 2, 0],
        [0, tw / 4],
        [0, tw / 4 - th],
        [-tw / 2, -th],
      ], PAL.wall);
      poly(ctx, [
        [0, tw / 4],
        [tw / 2, 0],
        [tw / 2, -th],
        [0, tw / 4 - th],
      ], PAL.wallShade);
      // clock face
      poly(ctx, [
        [-tw / 2 + 2, -th + 10],
        [-2, -th + 12],
        [-2, -th + 5],
        [-tw / 2 + 2, -th + 3],
      ], shade(PAL.glassLit, 0.12));
      rect(ctx, -tw / 2 + 4, -th + 6, 1, 3, PAL.ink);
      // spire
      poly(ctx, [
        [-tw / 2 - 2, -th],
        [0, -th + tw / 4 + 1],
        [0, -th - 15],
      ], mid);
      poly(ctx, [
        [0, -th + tw / 4 + 1],
        [tw / 2 + 2, -th],
        [0, -th - 15],
      ], dark);
      rect(ctx, 0, -th - 20, 1, 6, PAL.ink);
      poly(ctx, [
        [1, -th - 20],
        [7, -th - 18],
        [1, -th - 16],
      ], accent);
      ctx.restore();
    }

    // ---- stone footing + walls ---------------------------------------
    poly(ctx, faceQuadL(W, 0, 1, 0, 3), PAL.stone);
    poly(ctx, faceQuadR(W, 0, 1, 0, 3), PAL.stoneDark);

    const wallL = spec.construction ? shade(PAL.wall, -0.04) : PAL.wall;
    const wallR = spec.construction ? shade(PAL.wallShade, -0.04) : PAL.wallShade;
    poly(ctx, faceQuadL(W, 0, 1, 3, wallH), wallL);
    poly(ctx, faceQuadR(W, 0, 1, 3, wallH), wallR);

    // storey bands
    for (let f = 1; f < floors && !spec.construction; f++) {
      const hh = f * STORY;
      poly(ctx, faceQuadL(W, 0, 1, hh - 1, hh + 0.6), PAL.wallDark);
      poly(ctx, faceQuadR(W, 0, 1, hh - 1, hh + 0.6), shade(PAL.wallDark, -0.12));
    }

    // front vertical corner catches the light
    rect(ctx, 0, H / 2 - wallH, 1, wallH, shade(PAL.wall, 0.1));

    if (spec.construction) {
      // Exposed frame above the finished courses: posts, a ring beam, joists.
      const frameTop = cFloors * STORY + 14;
      for (const t of [0.02, 0.5, 0.98]) {
        poly(ctx, faceQuadL(W, t - 1.6 / W, t + 1.6 / W, wallH - 2, frameTop), PAL.wood);
        poly(ctx, faceQuadR(W, t - 1.6 / W, t + 1.6 / W, wallH - 2, frameTop), PAL.woodDark);
      }
      // mid-height joists and the ring beam that carries the roof
      poly(ctx, faceQuadL(W, 0, 1, wallH + 8, wallH + 10), PAL.wood);
      poly(ctx, faceQuadR(W, 0, 1, wallH + 8, wallH + 10), PAL.woodDark);
      poly(ctx, faceQuadL(W, 0, 1, frameTop - 3, frameTop), PAL.woodLight);
      poly(ctx, faceQuadR(W, 0, 1, frameTop - 3, frameTop), PAL.wood);

      // Half-tiled roof: the far slope is on, the near slope is bare rafters.
      const RW2 = W + 8;
      const ry2 = -frameTop;
      const rh2 = 13;
      const cN: Pt = [0, ry2 - RW2 / 4];
      const cE: Pt = [RW2 / 2, ry2];
      const cS: Pt = [0, ry2 + RW2 / 4];
      const cW: Pt = [-RW2 / 2, ry2];
      const cR1: Pt = [-RW2 / 4, ry2 - RW2 / 8 - rh2];
      const cR2: Pt = [RW2 / 4, ry2 + RW2 / 8 - rh2];
      poly(ctx, [cN, cE, cR2, cR1], shade(accent, -0.34));
      poly(ctx, [cE, cS, cR2], shade(accent, -0.16));
      poly(ctx, [
        [cR1[0], cR1[1]],
        [cR2[0], cR2[1]],
        [cR2[0], cR2[1] + 2],
        [cR1[0], cR1[1] + 2],
      ], PAL.woodLight);
      for (let k = 0; k <= 4; k++) {
        const p = k / 4;
        const ex = cW[0] + (cS[0] - cW[0]) * p;
        const ey = cW[1] + (cS[1] - cW[1]) * p;
        const rx = cR1[0] + (cR2[0] - cR1[0]) * p;
        const rya = cR1[1] + (cR2[1] - cR1[1]) * p;
        poly(ctx, [
          [ex, ey],
          [ex + 2, ey],
          [rx + 2, rya + 1],
          [rx, rya + 1],
        ], PAL.wood);
      }

      // ladder up the right-hand face
      const lx = W / 2 - 8;
      const ly = W / 4 - (W / 2 - 8) / 2;
      rect(ctx, lx, ly - frameTop, 1, frameTop, PAL.woodLight);
      rect(ctx, lx + 5, ly - frameTop - 2, 1, frameTop, PAL.woodLight);
      for (let k = 3; k < frameTop; k += 5) {
        rect(ctx, lx, ly - k, 6, 1, PAL.wood);
      }

      drawScaffold(ctx, W, frameTop - 4);
      // hazard banner in the project accent
      rect(ctx, -W / 2 + 2, -wallH - 8, 1, 10, PAL.wood);
      poly(ctx, [
        [-W / 2 + 3, -wallH - 8],
        [-W / 2 + 17, -wallH - 5],
        [-W / 2 + 17, -wallH + 1],
        [-W / 2 + 3, -wallH - 2],
      ], accent);
    } else {
      // ---- openings --------------------------------------------------
      const cols = Math.max(1, Math.floor(W / 26));
      for (let f = 0; f < floors; f++) {
        const hc = f * STORY + STORY * 0.58;
        for (let i = 0; i < cols; i++) {
          const t = cols === 1 ? 0.5 : 0.2 + (0.6 * i) / (cols - 1);
          // ground floor of the left face keeps its middle clear for the door
          const isDoorSlot = f === 0 && Math.abs(t - 0.5) < 0.14;
          if (!isDoorSlot) drawWindow(ctx, W, 'l', t, hc, spec.lit || rng() < 0.22);
          drawWindow(ctx, W, 'r', t, hc, spec.lit || rng() < 0.18);
        }
      }
      // door on the front-left face
      const dt = 5.5 / W;
      poly(ctx, faceQuadL(W, 0.5 - dt * 1.35, 0.5 + dt * 1.35, 0, 11.5), PAL.woodDark);
      poly(ctx, faceQuadL(W, 0.5 - dt, 0.5 + dt, 0, 10.5), PAL.wood);
      poly(ctx, faceQuadL(W, 0.5 - dt, 0.5 - dt * 0.35, 0, 10.5), PAL.woodLight);
      const knob = leftPt(W, 0.5 + dt * 0.55, 5.5);
      rect(ctx, knob[0], knob[1], 1, 1, PAL.glassLit);
      // step
      poly(ctx, faceQuadL(W, 0.5 - dt * 1.6, 0.5 + dt * 1.6, -1.5, 0.4), PAL.stone);

      if (spec.awning) {
        // The canopy juts out along +gy, which on screen is (-2, +1) per unit.
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
        canopy(0, 1, accent);
        canopy(0.3, 0.5, PAL.wall);
        canopy(0.7, 0.9, PAL.wall);
        const f0 = lerp(0);
        const f1 = lerp(1);
        poly(ctx, [
          [f0[0] + px, f0[1] + py],
          [f1[0] + px, f1[1] + py],
          [f1[0] + px, f1[1] + py + 3],
          [f0[0] + px, f0[1] + py + 3],
        ], shade(accent, -0.32));
      }
    }

    // ---- roof ---------------------------------------------------------
    if (!spec.construction) {
      const ry = -wallH;
      if (style === 'flat') {
        // parapet band, then a recessed deck
        poly(ctx, faceQuadL(W, 0, 1, wallH, wallH + 5), mid);
        poly(ctx, faceQuadR(W, 0, 1, wallH, wallH + 5), dark);
        poly(ctx, diamond(0, ry - 5, W), light);
        poly(ctx, diamond(0, ry - 3, W - 12), '#8e8aa0');
        // rooftop kit
        const tk = -W / 6;
        rect(ctx, tk - 3, ry - 16, 7, 8, PAL.stone);
        rect(ctx, tk - 3, ry - 17, 7, 2, PAL.stoneDark);
        rect(ctx, tk - 2, ry - 8, 1, 3, PAL.woodDark);
        rect(ctx, W / 6, ry - 12, 5, 5, shade(PAL.stone, -0.2));
      } else if (style === 'hip') {
        const N: Pt = [0, ry - RW / 4];
        const E: Pt = [RW / 2, ry];
        const S: Pt = [0, ry + RW / 4];
        const Wc: Pt = [-RW / 2, ry];
        const apex: Pt = [0, ry - roofH];
        poly(ctx, [N, Wc, apex], shade(accent, -0.42));
        poly(ctx, [N, E, apex], shade(accent, -0.36));
        poly(ctx, [Wc, S, apex], accent);
        poly(ctx, [S, E, apex], dark);
        // eave fascia
        poly(ctx, [Wc, S, [S[0], S[1] + 2.4], [Wc[0], Wc[1] + 2.4]], shade(accent, -0.5));
        poly(ctx, [S, E, [E[0], E[1] + 2.4], [S[0], S[1] + 2.4]], shade(accent, -0.55));
        // ridge glint
        poly(ctx, [
          [Wc[0] * 0.5, (Wc[1] + apex[1]) / 2],
          [apex[0], apex[1]],
          [apex[0], apex[1] + 2],
          [Wc[0] * 0.5 + 1, (Wc[1] + apex[1]) / 2 + 2],
        ], light);
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
        poly(ctx, [
          [R1[0], R1[1]],
          [R2[0], R2[1]],
          [R2[0], R2[1] + 2],
          [R1[0], R1[1] + 2],
        ], light);
        // gable-end plank detail
        poly(ctx, [E, S, R2], mid);
        rect(ctx, RW / 4 - 1, ry - roofH + 2, 2, 4, shade(accent, -0.55));
      }

      if (spec.cupola) {
        const cy = ry - roofH - 2;
        rect(ctx, -5, cy - 9, 10, 9, PAL.wall);
        rect(ctx, 0, cy - 9, 5, 9, PAL.wallShade);
        rect(ctx, -3, cy - 7, 6, 5, PAL.ink);
        // the bell
        poly(ctx, [
          [-2, cy - 3],
          [2, cy - 3],
          [1, cy - 7],
          [-1, cy - 7],
        ], PAL.glassLit);
        poly(ctx, [
          [-7, cy - 9],
          [7, cy - 9],
          [0, cy - 17],
        ], accent);
        rect(ctx, 0, cy - 21, 1, 4, PAL.ink);
      }

      if (spec.antenna) {
        rect(ctx, W / 5, ry - 22, 1, 14, PAL.ink);
        rect(ctx, W / 5 - 3, ry - 20, 7, 1, PAL.ink);
        rect(ctx, W / 5 - 2, ry - 17, 5, 1, PAL.ink);
        rect(ctx, W / 5, ry - 24, 1, 2, PAL.glassLit);
      }

      if (spec.chimney) {
        const cx = W / 4;
        const cy = ry - roofH * 0.42;
        rect(ctx, cx - 3, cy - 13, 6, 14, PAL.stone);
        rect(ctx, cx, cy - 13, 3, 14, PAL.stoneDark);
        rect(ctx, cx - 4, cy - 15, 8, 2, shade(PAL.stone, -0.25));
        smoke = [cx, cy - 16];
      }
    }

    if (spec.scaffold) drawScaffold(ctx, W, wallH + 4);

    // ---- pennant: the project's gem colour, readable from a distance ----
    if (!spec.construction && !spec.cupola) {
      const px = -W / 4;
      const py = -wallH - roofH - (style === 'flat' ? 5 : 0) - (style === 'gable' ? W / 8 : 0);
      rect(ctx, px, py - 20, 2, 21, PAL.ink);
      poly(ctx, [
        [px + 1, py - 21],
        [px + 15, py - 17],
        [px + 1, py - 12],
      ], PAL.ink);
      poly(ctx, [
        [px + 2, py - 20],
        [px + 13, py - 17],
        [px + 2, py - 13.5],
      ], accent);
    }
  });

  return { ...sp, smoke };
}

/* ------------------------------- scenery ------------------------------- */

/** Rounded pixel blob: `widths` are per-row widths, top row first. */
function blob(ctx: Ctx, cx: number, cy: number, widths: number[], color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    if (w <= 0) continue;
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy + i), Math.round(w), 1);
  }
}

export function buildTree(kind: 0 | 1 | 2, seed: number): Sprite {
  const rng = mulberry32(seed);
  const leaf = PAL.leaf[Math.floor(rng() * PAL.leaf.length)];
  if (kind === 0) {
    // round broadleaf
    return makeSprite(30, 36, 15, 32, (ctx) => {
      poly(ctx, diamond(1, 1, 18), PAL.shadow);
      rect(ctx, -2, -20, 4, 20, PAL.wood);
      rect(ctx, 0, -20, 2, 20, PAL.woodDark);
      blob(ctx, 0, -30, [6, 10, 14, 18, 20, 22, 22, 22, 20, 18, 14, 10, 7, 4], leaf);
      blob(ctx, -4, -29, [6, 10, 12, 12, 10, 8, 6], shade(leaf, 0.26));
      blob(ctx, 4, -22, [8, 10, 10, 8, 5], shade(leaf, -0.2));
    });
  }
  if (kind === 1) {
    // conifer
    const h = 40;
    return makeSprite(26, h + 6, 13, h + 2, (ctx) => {
      poly(ctx, diamond(1, 1, 16), PAL.shadow);
      rect(ctx, -1, -8, 3, 8, PAL.woodDark);
      for (let i = 0; i < 3; i++) {
        const y = -8 - i * 9;
        const w = 20 - i * 5;
        poly(ctx, [
          [-w / 2, y],
          [w / 2, y],
          [0, y - 15],
        ], i === 0 ? shade(leaf, -0.16) : leaf);
        poly(ctx, [
          [0, y],
          [w / 2, y],
          [0, y - 15],
        ], shade(leaf, -0.3));
      }
    });
  }
  // blossom tree
  return makeSprite(26, 36, 13, 32, (ctx) => {
    poly(ctx, diamond(1, 1, 16), PAL.shadow);
    rect(ctx, -2, -16, 3, 16, PAL.wood);
    blob(ctx, 0, -25, [6, 12, 16, 20, 20, 20, 18, 14, 10, 6], PAL.blossom);
    blob(ctx, -4, -24, [6, 10, 10, 8, 5], shade(PAL.blossom, 0.3));
    blob(ctx, 4, -18, [7, 8, 6], shade(PAL.blossom, -0.16));
  });
}

export function buildBush(seed: number): Sprite {
  const rng = mulberry32(seed);
  const leaf = PAL.leaf[Math.floor(rng() * PAL.leaf.length)];
  return makeSprite(20, 16, 10, 13, (ctx) => {
    poly(ctx, diamond(1, 1, 14), PAL.shadow);
    blob(ctx, 0, -8, [7, 11, 14, 15, 15, 14, 12, 9, 5], leaf);
    blob(ctx, -3, -7, [5, 7, 6], shade(leaf, 0.28));
    if (rng() < 0.5) rect(ctx, 3, -5, 1, 1, PAL.flower[0]);
  });
}

export function buildRock(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 9 + Math.floor(rng() * 5);
  return makeSprite(w + 6, 14, (w + 6) / 2, 11, (ctx) => {
    poly(ctx, diamond(1, 1, w + 3), PAL.shadow);
    blob(ctx, 0, -5, [w - 5, w - 2, w, w, w - 1, w - 3], PAL.stone);
    blob(ctx, -1, -5, [w - 7, w - 6], shade(PAL.stone, 0.22));
  });
}

/** A short run of picket fence along the screen-x axis. */
export function buildFence(dir: 'l' | 'r'): Sprite {
  const w = 34;
  return makeSprite(w + 4, 32, (w + 4) / 2, 21, (ctx) => {
    const s = dir === 'l' ? 1 : -1;
    for (let i = 0; i <= 4; i++) {
      const x = -w / 2 + (i * w) / 4;
      const y = (s * (x * 1)) / 2;
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

export function buildLumber(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(28, 27, 14, 22, (ctx) => {
    poly(ctx, diamond(1, 1, 24), PAL.shadow);
    for (let i = 0; i < 4; i++) {
      const y = -3 - i * 3;
      const x = -9 + i * 1.5;
      poly(ctx, [
        [x, y],
        [x + 17, y - 8],
        [x + 17, y - 5],
        [x, y + 3],
      ], i % 2 ? PAL.woodLight : PAL.wood);
      poly(ctx, [
        [x, y],
        [x, y + 3],
        [x + 2, y + 4],
        [x + 2, y + 1],
      ], PAL.woodDark);
    }
    if (rng() < 2) {
      rect(ctx, 8, -6, 5, 6, PAL.stoneDark);
      rect(ctx, 8, -7, 5, 1, PAL.stone);
    }
  });
}

export function buildCrates(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(26, 26, 13, 22, (ctx) => {
    poly(ctx, diamond(1, 1, 20), PAL.shadow);
    const box = (x: number, y: number, s: number) => {
      poly(ctx, [
        [x - s, y],
        [x, y + s / 2],
        [x, y + s / 2 - s],
        [x - s, y - s],
      ], PAL.woodLight);
      poly(ctx, [
        [x, y + s / 2],
        [x + s, y],
        [x + s, y - s],
        [x, y + s / 2 - s],
      ], PAL.wood);
      poly(ctx, diamond(x, y - s, s * 2), shade(PAL.woodLight, 0.16));
    };
    box(-4, 0, 7);
    box(6, -2, 6);
    if (rng() < 0.6) box(-3, -14, 5);
  });
}

/** Crane mast + jib. The hook and its load are animated by the caller. */
export function buildCrane(accent: string): Sprite {
  const mastH = 52;
  return makeSprite(72, mastH + 26, 26, mastH + 20, (ctx) => {
    // anchor: base centre; jib top sits at local y = -(mastH + 2)
    poly(ctx, diamond(1, 1, 22), PAL.shadow);
    // base
    poly(ctx, diamond(0, 0, 20), PAL.stoneDark);
    poly(ctx, diamond(0, -2, 18), PAL.stone);
    // lattice mast
    for (let y = 0; y < mastH; y += 6) {
      rect(ctx, -4, -2 - y, 1, 6, PAL.wood);
      rect(ctx, 3, -2 - y, 1, 6, PAL.woodDark);
      rect(ctx, -4, -2 - y, 8, 1, PAL.woodLight);
      poly(ctx, [
        [-3, -2 - y],
        [-2, -2 - y],
        [4, -8 - y],
        [3, -8 - y],
      ], shade(PAL.wood, 0.1));
    }
    const top = -mastH - 2;
    // jib
    rect(ctx, -18, top, 44, 2, PAL.wood);
    rect(ctx, -18, top + 2, 44, 1, PAL.woodDark);
    for (let x = -16; x < 24; x += 6) {
      poly(ctx, [
        [x, top + 2],
        [x + 1, top + 2],
        [x + 5, top - 4],
        [x + 4, top - 4],
      ], PAL.woodLight);
    }
    rect(ctx, -18, top - 5, 44, 1, PAL.woodLight);
    // cab + counterweight
    rect(ctx, -6, top + 3, 9, 7, accent);
    rect(ctx, -4, top + 5, 4, 3, PAL.glass);
    rect(ctx, -19, top - 2, 5, 8, PAL.stoneDark);
    // warning light
    rect(ctx, 25, top - 8, 2, 3, PAL.flower[0]);
  });
}

/** Outbuilding: a one-room shed with a gable roof. Fills a homestead out. */
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

/** Two-wheeled hand cart, parked. */
export function buildCart(): Sprite {
  return makeSprite(30, 26, 15, 21, (ctx) => {
    poly(ctx, diamond(1, 1, 22), PAL.shadow);
    poly(ctx, [
      [-11, -6],
      [0, -1],
      [11, -6],
      [11, -11],
      [0, -6],
      [-11, -11],
    ], PAL.woodLight);
    poly(ctx, [
      [-11, -11],
      [0, -6],
      [0, -1],
      [-11, -6],
    ], PAL.wood);
    rect(ctx, -8, -6, 2, 6, PAL.woodDark);
    rect(ctx, 5, -6, 2, 6, PAL.woodDark);
    rect(ctx, -10, -4, 5, 5, PAL.ink);
    rect(ctx, 6, -4, 5, 5, PAL.ink);
    rect(ctx, -3, -14, 8, 4, '#e9c073');
  });
}

export function buildWell(): Sprite {
  return makeSprite(30, 40, 15, 33, (ctx) => {
    poly(ctx, diamond(1, 1, 24), PAL.shadow);
    poly(ctx, diamond(0, 0, 22), PAL.stoneDark);
    poly(ctx, [
      [-11, 0],
      [0, 5.5],
      [0, -1.5],
      [-11, -7],
    ], PAL.stone);
    poly(ctx, [
      [0, 5.5],
      [11, 0],
      [11, -7],
      [0, -1.5],
    ], shade(PAL.stone, -0.14));
    poly(ctx, diamond(0, -7, 22), '#5f7f96');
    poly(ctx, diamond(0, -7, 14), '#7fb6cd');
    rect(ctx, -8, -22, 2, 15, PAL.wood);
    rect(ctx, 6, -22, 2, 15, PAL.wood);
    poly(ctx, [
      [-11, -22],
      [0, -30],
      [11, -22],
      [11, -20],
      [0, -28],
      [-11, -20],
    ], PAL.leafDark);
    rect(ctx, -1, -21, 1, 6, PAL.woodDark);
    rect(ctx, -3, -15, 5, 4, PAL.wood);
  });
}

export function buildSignpost(accent: string): Sprite {
  return makeSprite(24, 30, 12, 26, (ctx) => {
    poly(ctx, diamond(1, 1, 14), PAL.shadow);
    rect(ctx, -1, -22, 2, 22, PAL.wood);
    poly(ctx, [
      [-9, -20],
      [7, -17],
      [7, -11],
      [-9, -14],
    ], PAL.woodLight);
    poly(ctx, [
      [-9, -20],
      [7, -17],
      [7, -16],
      [-9, -19],
    ], accent);
    rect(ctx, -6, -17, 8, 1, PAL.woodDark);
    rect(ctx, -6, -15, 5, 1, PAL.woodDark);
  });
}

export function buildLamp(): Sprite {
  return makeSprite(16, 42, 8, 37, (ctx) => {
    poly(ctx, diamond(1, 1, 12), PAL.shadow);
    poly(ctx, diamond(0, 0, 10), PAL.stoneDark);
    rect(ctx, -1, -26, 2, 26, PAL.ink);
    rect(ctx, -3, -32, 6, 6, shade(PAL.glassLit, -0.05));
    rect(ctx, -4, -33, 8, 1, PAL.ink);
    rect(ctx, -4, -26, 8, 1, PAL.ink);
    rect(ctx, -1, -35, 1, 2, PAL.ink);
  });
}

/** A tilled 2×2-tile plot with four rows of seedlings. */
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

export function buildHaystack(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 20 + Math.floor(rng() * 6);
  return makeSprite(w + 8, 30, (w + 8) / 2, 25, (ctx) => {
    poly(ctx, diamond(1, 1, w + 4), PAL.shadow);
    blob(
      ctx,
      0,
      -17,
      [4, 8, 12, 15, 17, 19, w - 4, w - 2, w, w, w - 1, w - 3, w - 6, 4],
      '#e9c073'
    );
    blob(ctx, -3, -16, [3, 6, 8, 9, 8, 6], '#f4d492');
    for (let i = 0; i < 5; i++) {
      rect(ctx, -w / 2 + 3 + i * 4, -6 - (i % 2), 2, 1, '#c99b4e');
    }
    rect(ctx, 0, -21, 1, 4, PAL.woodDark);
  });
}

/** Village pond: a 3-tile water diamond with a sand rim and a couple of reeds. */
export function buildPond(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(116, 68, 58, 44, (ctx) => {
    poly(ctx, diamond(0, 2, 104), '#d8c39a');
    poly(ctx, diamond(0, 0, 94), '#cbb489');
    poly(ctx, diamond(0, -1, 84), '#79c0da');
    poly(ctx, diamond(0, -2, 70), '#96d4e6');
    poly(ctx, diamond(-6, -4, 34), '#b6e6f0');
    for (let i = 0; i < 5; i++) {
      const x = Math.round((rng() - 0.5) * 60);
      const y = Math.round((rng() - 0.5) * 18) - 2;
      rect(ctx, x, y, 6, 1, '#c3e9f3');
    }
    for (const [rx, ry] of [
      [-38, 4],
      [-33, 7],
      [34, 0],
      [30, 5],
    ]) {
      rect(ctx, rx, ry - 9, 1, 9, PAL.leafDark);
      rect(ctx, rx, ry - 12, 1, 3, '#a97e4f');
    }
    // lily pads
    poly(ctx, diamond(14, -6, 10), '#63c9a8');
    poly(ctx, diamond(-2, 4, 8), '#5bbd9d');
  });
}

export function buildFlowerPatch(seed: number): Sprite {
  const rng = mulberry32(seed);
  return makeSprite(26, 16, 13, 10, (ctx) => {
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng();
      const x = Math.cos(a) * r * 10;
      const y = (Math.sin(a) * r * 10) / 2;
      rect(ctx, x, y - 2, 1, 2, PAL.leafDark);
      rect(ctx, x, y - 3, 1, 1, PAL.flower[Math.floor(rng() * PAL.flower.length)]);
    }
  });
}

/**
 * Puffy cloud: the union of a few discs, rasterised row by row and clipped to
 * a flat base — the classic pixel-art silhouette.
 */
export function buildCloud(seed: number): Sprite {
  const rng = mulberry32(seed);
  const w = 44 + Math.floor(rng() * 38);
  const h = 24;
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

/* ------------------------------- villagers ------------------------------ */

export type BotAction = 'walk' | 'idle' | 'work' | 'carry';

/**
 * A villager: ~12px tall, drawn from flat rectangles straight into the main
 * buffer. Cheap enough that caching would cost more than it saves.
 */
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

  // shadow
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(px - 4, py - 1, 8, 2);
  ctx.fillRect(px - 5, py, 10, 1);

  const step = action === 'walk' ? Math.sin(phase * 9) : 0;
  const bob = action === 'walk' ? (Math.abs(Math.sin(phase * 9)) > 0.6 ? -1 : 0) : 0;
  const top = py + bob;

  // legs
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(px - 2, top - 3, 2, 3 + (step > 0 ? -1 : 0));
  ctx.fillRect(px + 1, top - 3, 2, 3 + (step < 0 ? -1 : 0));

  // body
  ctx.fillStyle = color;
  ctx.fillRect(px - 3, top - 9, 6, 6);
  ctx.fillStyle = dark;
  ctx.fillRect(px + (faceRight ? 2 : -3), top - 9, 1, 6);
  ctx.fillStyle = light;
  ctx.fillRect(px - 3 + (faceRight ? 0 : 5), top - 9, 1, 3);

  // arms
  ctx.fillStyle = shade(color, -0.14);
  if (action === 'work') {
    const swing = Math.sin(phase * 11) > 0 ? 0 : 3;
    ctx.fillRect(px + s * 3 - (faceRight ? 0 : 1), top - 9 + swing, 1, 3);
    ctx.fillRect(px - s * 3 - (faceRight ? 1 : 0), top - 8, 1, 3);
    // hammer head
    ctx.fillStyle = PAL.stoneDark;
    ctx.fillRect(px + s * 4 - (faceRight ? 0 : 2), top - 11 + swing * 2, 3, 2);
  } else if (action === 'carry') {
    ctx.fillRect(px - 4, top - 10, 1, 3);
    ctx.fillRect(px + 3, top - 10, 1, 3);
    ctx.fillStyle = PAL.woodLight;
    ctx.fillRect(px - 5, top - 13, 10, 3);
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(px - 5, top - 11, 10, 1);
  } else {
    ctx.fillRect(px - 4, top - 8 + (step > 0 ? 1 : 0), 1, 3);
    ctx.fillRect(px + 3, top - 8 + (step < 0 ? 1 : 0), 1, 3);
  }

  // head
  ctx.fillStyle = '#f7e2c8';
  ctx.fillRect(px - 2, top - 14, 5, 5);
  ctx.fillStyle = '#e8cba9';
  ctx.fillRect(px + (faceRight ? 2 : -2), top - 14, 1, 5);
  // hat
  ctx.fillStyle = dark;
  ctx.fillRect(px - 3, top - 16, 7, 2);
  ctx.fillRect(px - 2, top - 17, 5, 1);
  // eyes
  ctx.fillStyle = PAL.ink;
  if (action !== 'work') {
    ctx.fillRect(px + (faceRight ? 1 : -2), top - 12, 1, 1);
    ctx.fillRect(px + (faceRight ? -1 : 0), top - 12, 1, 1);
  }
}
