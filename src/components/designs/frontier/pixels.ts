/**
 * Hamlet Frontier — low-level pixel rasterisation.
 *
 * Every routine here paints into a low-resolution buffer that the component
 * upscales in whole-pixel steps with `image-rendering: pixelated`. That means
 * no `arc`, no gradients, no `stroke`: filled shapes go through `poly()`, a
 * scanline rasteriser that snaps both ends of every span to whole pixels, so
 * the 2:1 isometric edges come out as clean stair-steps instead of grey fringe.
 *
 * Descended from the Pixel Hamlet renderer, kept deliberately separate so the
 * two designs can diverge.
 */

export type Ctx = CanvasRenderingContext2D;

/** Isometric tile footprint, in art pixels. The 2:1 ratio gives clean slopes. */
export const TW = 32;
export const TH = 16;
/** Height of one building storey, in art pixels. */
export const STORY = 13;

export type Pt = [number, number];

export interface Sprite {
  c: HTMLCanvasElement;
  /** Anchor offset: the sprite's ground-centre sits at (ox, oy) inside it. */
  ox: number;
  oy: number;
}

/* ------------------------------------------------------------------ *
 * Authoring space
 *
 * The settlement is linear, so everything is authored in screen-aligned
 * (u, v): u runs along the road (screen east), v runs into the screen
 * (screen south). The isometric tile grid is derived, never authored.
 * ------------------------------------------------------------------ */

/** World screen-x, in art pixels, of an authored (u, v). */
export const wx = (u: number): number => u * (TW / 2);
/** World screen-y, in art pixels, of an authored (u, v). */
export const wy = (v: number): number => v * (TH / 2);
/** Distance in *tile* units between two authored points — used for road width. */
export const uvDist = (du: number, dv: number): number =>
  Math.hypot(du, dv) / Math.SQRT2;

/* ------------------------------- palette ------------------------------- */

export const PAL = {
  skyTop: '#8fcfe9',
  skyMid: '#bfe1ea',
  skyLow: '#fbe6c4',
  sun: '#fff4c8',
  sunCore: '#ffe89e',
  cloud: '#fffdf6',
  cloudShade: '#dde9f0',

  hillFar: '#b3d6cf',
  hillMid: '#9ccbb6',
  hillNear: '#82bd9d',
  treeline: '#5faa88',
  treelineDark: '#4a8c6f',

  // Tile-to-tile spread is kept under ~4%: at 32×16 art pixels a tile is a big
  // shape on screen, and anything louder reads as a checkerboard rather than
  // as meadow.
  grass: ['#80c89a', '#7dc596', '#84cb9d', '#7bc394'],
  grassAlt: ['#77c08e', '#74bd8b', '#7bc492', '#72ba88'],
  grassDry: ['#9cc189', '#98bd85', '#a0c58d', '#95ba82'],
  grassEdge: '#66ac80',
  /** Distance haze mixed into the tiles nearest the horizon. */
  haze: '#a8cfbd',
  flower: ['#ef7f93', '#f0c75e', '#fffdf6', '#9b8fe8'],

  dirt: '#d8ac7d',
  dirtAlt: '#cf9f6f',
  dirtEdge: '#b98a5e',
  churn: '#c49469',

  wall: '#fdf3e2',
  wallShade: '#e6d3b6',
  wallDark: '#ccb492',
  stone: '#cec7ba',
  stoneDark: '#a69f92',
  wood: '#b6875a',
  woodDark: '#8c6440',
  woodLight: '#dbb987',
  sawn: '#e8cfa4',

  glass: '#a5dcef',
  glassDark: '#7fc2da',
  glassLit: '#ffd071',
  glassDim: '#8aa2b0',

  ink: '#463d5c',
  shadow: 'rgba(70, 61, 92, 0.17)',

  leaf: ['#5cc09d', '#4cae8b', '#74d1ac'],
  leafDark: '#3d9274',
  moss: '#79ae6c',
  mossDark: '#5f9256',
  ivy: '#57a06e',
  blossom: '#f2a8c0',
  brass: '#e8b957',
  brassDark: '#b98d33',
} as const;

/* ------------------------------ utilities ------------------------------ */

/** Deterministic PRNG so the frontier looks identical on every load. */
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

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) =>
    Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0);
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

/**
 * Scanline polygon fill with whole-pixel spans — the workhorse. Rounding both
 * span ends is what keeps 2:1 isometric edges as clean 2-pixel stair-steps.
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

/** Stepped disc — the only circle in the codebase, rasterised row by row. */
export function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let y = -Math.round(r); y <= Math.round(r); y++) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)) * 2);
    if (w > 0) ctx.fillRect(Math.round(cx - w / 2), Math.round(cy + y), w, 1);
  }
}

/** Rounded pixel blob: `widths` are per-row widths, top row first. */
export function blob(
  ctx: Ctx,
  cx: number,
  cy: number,
  widths: number[],
  color: string
): void {
  ctx.fillStyle = color;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    if (w <= 0) continue;
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy + i), Math.round(w), 1);
  }
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

/* --------------------- isometric face parameterisation ------------------ *
 * `t` runs corner→corner across a face, `hh` is height above ground.       */

export function leftPt(W: number, t: number, hh: number): Pt {
  return [-W / 2 + (t * W) / 2, (t * W) / 4 - hh];
}
export function rightPt(W: number, t: number, hh: number): Pt {
  return [(t * W) / 2, W / 4 - (t * W) / 4 - hh];
}
export function faceQuadL(
  W: number,
  t0: number,
  t1: number,
  h0: number,
  h1: number
): Pt[] {
  return [leftPt(W, t0, h1), leftPt(W, t1, h1), leftPt(W, t1, h0), leftPt(W, t0, h0)];
}
export function faceQuadR(
  W: number,
  t0: number,
  t1: number,
  h0: number,
  h1: number
): Pt[] {
  return [
    rightPt(W, t0, h1),
    rightPt(W, t1, h1),
    rightPt(W, t1, h0),
    rightPt(W, t0, h0),
  ];
}

/** 6t⁵−15t⁴+10t³ — zero first *and* second derivative at both ends. */
export function smootherstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export const clamp = (x: number, a: number, b: number): number =>
  x < a ? a : x > b ? b : x;
