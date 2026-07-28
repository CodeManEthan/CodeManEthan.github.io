/**
 * Hamlet Frontier — the scroll-driven hero.
 *
 * A hand-rolled isometric pixel-art settlement on a plain 2D canvas: no WebGL,
 * no sprite sheets, no dependencies. The art is rasterised at half the
 * viewport's resolution and upscaled in whole-pixel steps with
 * `image-rendering: pixelated`.
 *
 * Navigation is a guided tour rather than a free-roam map: the stage is sticky
 * and page scroll drives the camera along an authored path through the
 * village, easing to a near-stop at each waypoint. Everything the renderer
 * knows comes from the plain `WorldState` object in worldstate.ts.
 *
 * Interaction lives in a layer of transparent anchors positioned over each
 * building, so hover, focus rings, Enter-to-activate and screen-reader labels
 * are handled by the platform. Focusing an anchor scrolls its beat of the tour
 * into view, which is what makes the whole thing keyboard-navigable.
 *
 * `prefers-reduced-motion` kills the simulation loop entirely: the village is
 * settled once and then repainted only when the scroll position changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PAL,
  TH,
  TW,
  clamp,
  isoTile,
  mix,
  mulberry32,
  poly,
  diamond,
  rect,
  shade,
  smootherstep,
  wx as worldX,
  wy as worldY,
  type Sprite,
} from './pixels';
import {
  buildCloud,
  drawBell,
  drawBot,
  drawNote,
} from './sprites';
import {
  cartLoaded,
  cartPos,
  compileScene,
  puffSmoke,
  stepScene,
  type HitMeta,
  type Scene,
} from './scene';
import {
  buildWorldState,
  roadDist,
  roadV,
  roadW,
  zoneAt,
  type ProjectInput,
  type WorldState,
} from './worldstate';

interface Props {
  projects: ProjectInput[];
}

/** Floating labels for the landmarks whose joke needs to land. Every other
 *  building borrows its own title while its beat of the tour is on screen. */
const TAGS: Record<string, string> = {
  __workshop: 'Ethan’s workshop',
  __notice: 'Notice board',
  'one-record-many-bells': 'The bell tower',
  __sawmill: 'The sawmill',
  'montage-it': 'Building site',
  __nextplot: 'Plot 8 — staked',
};

function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
function buildingSize(n: number): string {
  if (n >= 25000) return 'large building';
  if (n >= 10000) return 'mid-size building';
  if (n >= 3000) return 'small building';
  return 'tiny building';
}
const STATE_WORD: Record<string, string> = {
  active: 'lived in',
  growing: 'growing — a storey going on',
  resting: 'resting',
  planned: 'staked, unbuilt',
};

export default function FrontierWorld({ projects }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const anchorRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const tagRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const hoverRef = useRef<number | null>(null);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hits, setHits] = useState<HitMeta[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [stop, setStop] = useState(0);
  const [ready, setReady] = useState(false);

  const world = useMemo<WorldState>(() => buildWorldState(projects), [projects]);
  const stops = world.tour;

  const setHoverBoth = useCallback((i: number | null) => {
    hoverRef.current = i;
    setHover(i);
  }, []);

  /** Page scroll offset that parks the camera on waypoint `i`. */
  const scrollForStop = useCallback((i: number) => {
    const tour = wrapRef.current?.closest('.fr-tour') as HTMLElement | null;
    if (!tour) return 0;
    const span = tour.offsetHeight - window.innerHeight;
    return tour.offsetTop + (span * i) / Math.max(1, stops.length - 1);
  }, [stops.length]);

  const goToStop = useCallback(
    (i: number) => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: scrollForStop(i), behavior: reduced ? 'auto' : 'smooth' });
    },
    [scrollForStop]
  );

  /* ------------------------------ sizing ------------------------------ */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        prev && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --------------------- the tour's own scroll length ------------------- */
  useEffect(() => {
    const tour = wrapRef.current?.closest('.fr-tour') as HTMLElement | null;
    if (tour) tour.style.height = `calc(100svh + ${(stops.length - 1) * 105}svh)`;
  }, [stops.length]);

  /* -------------------------- scene lifecycle -------------------------- */
  useEffect(() => {
    if (!size || size.w < 2 || size.h < 2) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Art pixels are two device-independent pixels across on a desktop, where
    // that still leaves three or four buildings in frame. On a phone the same
    // choice would show one building and a lot of road, so drop to 1:1 and let
    // the street read instead.
    const SCALE = size.w < 620 ? 1 : 2;
    const iw = Math.ceil(size.w / SCALE);
    const ih = Math.ceil(size.h / SCALE);
    canvas.width = iw;
    canvas.height = ih;
    canvas.style.width = `${iw * SCALE}px`;
    canvas.style.height = `${ih * SCALE}px`;
    const offX = Math.round((size.w - iw * SCALE) / 2);
    const offY = Math.round((size.h - ih * SCALE) / 2);
    canvas.style.left = `${offX}px`;
    canvas.style.top = `${offY}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    if (!sceneRef.current) {
      sceneRef.current = compileScene(world);
      setHits(sceneRef.current.hits.map((h) => h.hit!));
      setReady(true);
    }
    const S = sceneRef.current;

    /* ---- camera frame ------------------------------------------------ */
    const HZ = Math.round(ih * 0.3);
    const GY = Math.round(ih * 0.63);

    /* ------------------------------ sky ------------------------------- */
    const sky = document.createElement('canvas');
    sky.width = iw;
    sky.height = Math.max(1, HZ + 4);
    const sctx = sky.getContext('2d')!;
    sctx.imageSmoothingEnabled = false;
    const bands = 16;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const y0 = Math.round((HZ * i) / bands);
      const y1 = Math.round((HZ * (i + 1)) / bands);
      const c =
        t < 0.6
          ? mix(PAL.skyTop, PAL.skyMid, Math.pow(t / 0.6, 1.2))
          : mix(PAL.skyMid, PAL.skyLow, (t - 0.6) / 0.4);
      rect(sctx, 0, y0, iw, y1 - y0 + 1, c);
    }
    const sunX = Math.round(iw * 0.2);
    const sunY = Math.round(HZ * 0.3);
    const disc = (r: number, color: string) => {
      for (let y = -r; y <= r; y++) {
        const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)) * 2);
        if (w > 0) rect(sctx, sunX - w / 2, sunY + y, w, 1, color);
      }
    };
    disc(18, mix(PAL.skyTop, PAL.sun, 0.3));
    disc(13, PAL.sun);
    disc(9, PAL.sunCore);

    /* ----------------------------- hills ------------------------------ *
       One baked strip, scrolled at 0.16× the camera. Baking (rather than
       redrawing a few thousand columns each frame) keeps the loop cheap, and
       the forest can thicken toward the frontier because every strip column
       maps back to a known world x. */
    const PX = 0.16;
    const camXMin = worldX(-4);
    const camXMax = worldX(146);
    const hxStart = Math.round(camXMin * PX - iw / 2 - 64);
    const hillsW = Math.ceil(iw + (camXMax - camXMin) * PX + 160);
    const hills = document.createElement('canvas');
    hills.width = hillsW;
    hills.height = Math.max(1, HZ + 48);
    const hctx = hills.getContext('2d')!;
    hctx.imageSmoothingEnabled = false;
    const stripWorldU = (i: number) => (hxStart + i) / PX / (TW / 2);

    const ridge = (amp: number, f1: number, f2: number, ph: number, color: string) => {
      hctx.fillStyle = color;
      for (let x = 0; x < hillsW; x++) {
        const n = Math.sin(x * f1 + ph) * 0.6 + Math.sin(x * f2 + ph * 2.3) * 0.4;
        const y = Math.round(HZ - amp * (0.55 + 0.45 * n));
        hctx.fillRect(x, y, 1, HZ - y + 4);
      }
    };
    ridge(34, 0.013, 0.033, 0.7, PAL.hillFar);
    ridge(24, 0.021, 0.05, 2.9, PAL.hillMid);
    ridge(15, 0.034, 0.078, 5.1, PAL.hillNear);
    // Forest edge: denser and taller past the frontier, thin over the village.
    for (let pass = 0; pass < 2; pass++) {
      hctx.fillStyle = pass === 0 ? PAL.treeline : PAL.treelineDark;
      for (let x = 0; x < hillsW; x++) {
        const u = stripWorldU(x);
        const thick = clamp((u - 70) / 60, 0, 1);
        const amp = (5 + thick * 9) * (pass === 0 ? 1 : 0.62);
        const n =
          Math.sin(x * 0.11 + pass * 2.2) * 0.6 + Math.sin(x * 0.27 + pass * 5.1) * 0.4;
        const y = Math.round(HZ - amp * (0.5 + 0.5 * n)) + pass * 2;
        hctx.fillRect(x, y, 1, HZ - y + 4);
      }
    }
    const trng = mulberry32(4242);
    for (let i = 0; i < Math.round(hillsW / 12); i++) {
      const x = Math.round(trng() * hillsW);
      const u = stripWorldU(x);
      const thick = clamp((u - 70) / 60, 0, 1);
      if (trng() > 0.35 + thick * 0.6) continue;
      const h = 6 + Math.round(trng() * (7 + thick * 12));
      hctx.fillStyle = trng() < 0.5 ? PAL.treeline : PAL.treelineDark;
      for (let k = 0; k < h; k++) {
        const w = Math.max(1, Math.round(((k + 1) / h) * 7));
        hctx.fillRect(x - Math.floor(w / 2), HZ - h + k, w, 1);
      }
    }

    /* ----------------------------- ground ----------------------------- *
       One bake of the whole settlement's floor: tiles, terrain zones, the
       winding road with its ruts, and the widened plaza / mill yard / build
       site. Blitted with a single drawImage per frame. */
    const gU0 = world.terrain.u0 - 2;
    const gU1 = world.terrain.u1 + 2;
    const gx0 = worldX(gU0);
    // The floor starts exactly at the horizon and runs off the bottom of the
    // frame. Anything further back than this is the baked treeline, not tiles.
    const bandTop = HZ - GY - 6;
    const bandBot = ih - GY + 48;
    const ground = document.createElement('canvas');
    ground.width = Math.ceil(worldX(gU1) - gx0) + TW;
    ground.height = Math.ceil(bandBot - bandTop) + TH;
    const gctx = ground.getContext('2d')!;
    gctx.imageSmoothingEnabled = false;
    gctx.translate(-gx0 + TW / 2, -bandTop + TH / 2);

    const grng = mulberry32(1337);
    const vMin = Math.floor(bandTop / (TH / 2)) - 2;
    const vMax = Math.ceil(bandBot / (TH / 2)) + 2;
    for (let v = vMin; v <= vMax; v++) {
      for (let u = Math.floor(gU0); u <= Math.ceil(gU1); u++) {
        if ((u + v) & 1) continue;
        const sx = worldX(u);
        const sy = worldY(v);
        const zone = zoneAt(world, u);
        const d = roadDist(world, u, v);
        const rw = roadW(world, u);
        let clear = Infinity;
        for (const c of world.clearings) {
          const dd = Math.hypot(u - c.u, v - c.v) / Math.SQRT2 - c.r;
          if (dd < clear) clear = dd;
        }
        // A real avalanche mix, not just two multiplies XORed: the low bits of
        // `u * odd ^ v * odd` stay correlated, which paints the meadow in
        // obvious diagonal stripes at this tile size.
        let h = (Math.imul(u | 0, 374761393) ^ Math.imul(v | 0, 668265263)) >>> 0;
        h = Math.imul(h ^ (h >>> 15), 2246822519);
        h = Math.imul(h ^ (h >>> 13), 3266489917);
        h = (h ^ (h >>> 16)) >>> 0;
        // Jitter every edge by up to a third of a tile so the road and the
        // plaza read as worn ground rather than stamped geometry.
        const jit = ((h % 64) / 64 - 0.5) * 0.42;
        const onRoad = d < rw + jit || clear < jit;
        const nearRoad = !onRoad && (d < rw + 0.6 + jit || clear < 0.7 + jit);

        // Distance haze: tiles near the horizon wash toward the treeline's
        // colour, which gives the meadow depth and softens the tile grid
        // exactly where it would otherwise be most obvious.
        const haze = clamp(1 - (sy - bandTop) / 120, 0, 1) * 0.6;
        const air = (c: string) => (haze > 0.01 ? mix(c, PAL.haze, haze) : c);

        if (onRoad && rw > 0.34) {
          isoTile(gctx, sx, sy, air(h % 3 === 0 ? PAL.dirtAlt : PAL.dirt));
          // wheel ruts either side of the centreline
          const cv = roadV(world, u);
          if (Math.abs(v - cv) > rw * 0.35 && Math.abs(v - cv) < rw * 0.8 && h % 3 !== 1) {
            rect(gctx, sx - 6, sy, 12, 1, PAL.dirtEdge);
          }
          if (h % 11 === 0) rect(gctx, sx + 4, sy + 2, 2, 1, PAL.dirtEdge);
        } else if (onRoad) {
          // the frontier track: a worn line rather than a made road
          isoTile(gctx, sx, sy, air(mix(PAL.dirt, PAL.grass[0], 0.45)));
        } else if (nearRoad) {
          isoTile(gctx, sx, sy, air(mix(PAL.dirt, PAL.grass[0], 0.6)));
        } else {
          // Low-frequency meadow patches, deliberately not axis-aligned, plus
          // a per-tile hash so the patch boundaries never read as stripes.
          const n =
            Math.sin(u * 0.077 + v * 0.163) +
            Math.sin(u * 0.043 - v * 0.211) * 0.9 +
            Math.sin(u * 0.19 + v * 0.031 + 1.7) * 0.5 +
            ((h % 97) / 97 - 0.5) * 0.9;
          let pal: readonly string[] = n > 0.75 ? PAL.grassAlt : PAL.grass;
          if (zone === 'clearing') pal = PAL.grassDry;
          else if (zone === 'wild' && n > 0.3) pal = PAL.grassAlt;
          isoTile(gctx, sx, sy, air(pal[h % pal.length]));
          if (zone === 'clearing' && h % 6 === 0) {
            // dragged-timber scars: a scuff, not a paving slab
            poly(gctx, diamond(sx + ((h >>> 7) % 7) - 3, sy, 11), air(mix(pal[0], PAL.churn, 0.5)));
          }
          // Tufts and flowers: dense enough to break the diamond edges up.
          const r = grng();
          if (r < 0.34) {
            const tuft = air(PAL.grassEdge);
            rect(gctx, sx - 5 + ((h >>> 5) % 5), sy + 1, 2, 1, tuft);
            rect(gctx, sx + 1 + ((h >>> 9) % 4), sy - 2, 2, 1, tuft);
            if (r < 0.16) rect(gctx, sx - 1, sy + 3, 2, 1, tuft);
          }
          if (r > 0.86) {
            rect(gctx, sx, sy - 1, 1, 2, air(PAL.leafDark));
            rect(gctx, sx, sy - 3, 1, 1, PAL.flower[(h >>> 3) % PAL.flower.length]);
          }
        }
      }
    }

    /* ----------------------------- clouds ----------------------------- */
    const span = iw + 260;
    const cloudN = Math.max(4, Math.round(iw / 120));
    const clouds = Array.from({ length: cloudN }, (_, i) => ({
      sp: buildCloud(i * 17 + 3),
      x: (i * span) / cloudN,
      y: 8 + ((i * 47) % Math.max(12, HZ - 60)),
      v: 1.4 + (i % 4) * 0.5,
    }));
    const birdN = Math.max(3, Math.round(iw / 240));
    const birds = Array.from({ length: birdN }, (_, i) => ({
      x: (i * span) / birdN,
      y: HZ * (0.28 + ((i * 0.19) % 0.42)),
      v: 5 + (i % 3),
      ph: i * 1.7,
    }));

    /* ------------------------- camera + scroll ------------------------ */
    const tourEl = wrap.closest('.fr-tour') as HTMLElement | null;
    let tourTop = 0;
    let tourSpan = 1;
    const measure = () => {
      if (!tourEl) return;
      tourTop = tourEl.offsetTop;
      tourSpan = Math.max(1, tourEl.offsetHeight - window.innerHeight);
    };
    measure();

    let drift = 0;
    let lastInput = performance.now();
    const noteInput = () => {
      lastInput = performance.now();
    };
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener('scroll', noteInput, opts);
    window.addEventListener('wheel', noteInput, opts);
    window.addEventListener('pointerdown', noteInput, opts);
    window.addEventListener('pointermove', noteInput, opts);
    window.addEventListener('touchstart', noteInput, opts);
    window.addEventListener('keydown', noteInput);
    window.addEventListener('resize', measure);

    let activeStop = -1;
    let lastHeroVar = -1;

    const cameraAt = (): { u: number; v: number; f: number } => {
      const p = clamp((window.scrollY - tourTop) / tourSpan, 0, 1);
      const f = p * (stops.length - 1);
      const i = clamp(Math.floor(f), 0, stops.length - 2);
      const e = smootherstep(f - i);
      return {
        u: stops[i].u + (stops[i + 1].u - stops[i].u) * e,
        v: stops[i].v + (stops[i + 1].v - stops[i].v) * e,
        f,
      };
    };

    /* --------------------------- drawing ------------------------------ */
    const drawSprite = (sp: Sprite, x: number, y: number) => {
      ctx.drawImage(sp.c, Math.round(x - sp.ox), Math.round(y - sp.oy));
    };

    let smokeClock = 0;

    const render = (camU: number, camV: number, t: number) => {
      const camX = worldX(camU);
      const camY = worldY(camV);
      const sX = (wxp: number) => wxp - camX + iw / 2;
      const sY = (wyp: number) => wyp - camY + GY;

      ctx.drawImage(sky, 0, 0);

      for (const c of clouds) {
        const x = (((c.x - camX * 0.05) % span) + span) % span - 130;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(c.sp.c, Math.round(x), Math.round(c.y));
        ctx.globalAlpha = 1;
      }
      for (const b of birds) {
        const x = (((b.x - camX * 0.09) % span) + span) % span - 130;
        const y = Math.round(b.y + Math.sin(t * 0.9 + b.ph) * 4);
        const flap = Math.sin(t * 6 + b.ph) > 0 ? 0 : 1;
        ctx.fillStyle = 'rgba(70,61,92,0.55)';
        ctx.fillRect(Math.round(x) - 2, y - flap, 2, 1);
        ctx.fillRect(Math.round(x) + 1, y - flap, 2, 1);
        ctx.fillRect(Math.round(x), y, 1, 1);
      }

      ctx.drawImage(hills, Math.round(hxStart - camX * PX + iw / 2), 0);
      ctx.drawImage(ground, Math.round(sX(gx0) - TW / 2), Math.round(sY(bandTop) - TH / 2));

      /* ---- movers merged into the painter order --------------------- */
      const movers: { y: number; draw: () => void }[] = [];
      for (const bot of S.bots) {
        const bx = sX(worldX(bot.u));
        const by = sY(worldY(bot.v));
        if (bx < -40 || bx > iw + 40 || by < HZ + 4) continue;
        movers.push({
          y: worldY(bot.v),
          draw: () => {
            drawBot(ctx, bx, by, bot.color, bot.faceRight, bot.action, bot.phase);
            if (bot.action === 'work' && Math.sin(bot.phase * 11) > 0.85) {
              const px = bx + (bot.faceRight ? 6 : -7);
              const py = by - 12;
              ctx.fillStyle = '#fff3c4';
              ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
              ctx.fillRect(Math.round(px) + 2, Math.round(py) - 2, 1, 1);
              ctx.fillRect(Math.round(px) - 1, Math.round(py) - 3, 1, 1);
            }
            if (bot.action === 'saw') {
              ctx.fillStyle = PAL.sawn;
              for (let k = 0; k < 3; k++) {
                ctx.fillRect(
                  Math.round(bx + 4 + k * 2 + Math.sin(t * 5 + k) * 2),
                  Math.round(by - 4 + ((t * 20 + k * 7) % 6)),
                  1,
                  1
                );
              }
            }
          },
        });
      }
      for (const c of S.carts) {
        const p = cartPos(S, c);
        const cx = sX(p.x);
        const cy = sY(p.y);
        if (cx < -60 || cx > iw + 60) continue;
        const loaded = cartLoaded(c);
        movers.push({
          y: p.y,
          draw: () => {
            drawSprite(loaded ? c.spriteLoaded : c.spriteEmpty, cx, cy);
            // the villager between the shafts
            if (c.wait <= 0) {
              drawBot(ctx, cx + (c.dir > 0 ? -25 : 25), cy - 1, c.color, c.dir > 0, 'pull', c.phase);
            }
          },
        });
      }
      movers.sort((a, b) => a.y - b.y);

      let mi = 0;
      const hoverId = hoverRef.current == null ? null : S.hits[hoverRef.current]?.id;

      for (const it of S.items) {
        while (mi < movers.length && movers[mi].y <= it.y) movers[mi++].draw();

        const x = sX(it.x);
        const y = sY(it.y);
        const halfW = it.sprite.c.width;
        // Anything whose footprint lands above the horizon belongs to the
        // baked treeline, not the tile floor.
        if (y < HZ + 4) continue;
        if (x + halfW < -40 || x - halfW > iw + 40) continue;

        if (it.hit && it.id === hoverId) {
          const fw = Math.max(28, it.hit.hw * 2);
          poly(ctx, diamond(x, y + 2, fw + 22), 'rgba(255,255,255,0.5)');
          poly(ctx, diamond(x, y + 2, fw + 10), shade(it.hit.accent, 0.3));
          drawSprite(it.outline!, x, y - 3);
          drawSprite(it.sprite, x, y - 3);
        } else {
          drawSprite(it.sprite, x, y);
        }

        if (it.kind === 'crane') {
          const jibX = x + 22;
          const topY = y - 58;
          const sway = Math.sin(t * 0.8) * 5;
          const drop = 26 + Math.sin(t * 0.55) * 9;
          ctx.fillStyle = PAL.ink;
          ctx.fillRect(Math.round(jibX + sway * 0.4), Math.round(topY), 1, Math.round(drop));
          const lx = Math.round(jibX + sway * 0.4) - 4;
          const ly = Math.round(topY + drop);
          ctx.fillStyle = PAL.sawn;
          ctx.fillRect(lx, ly, 9, 6);
          ctx.fillStyle = PAL.wood;
          ctx.fillRect(lx, ly + 4, 9, 2);
          ctx.fillStyle = PAL.woodDark;
          ctx.fillRect(lx, ly, 9, 1);
        }

        if (it.blade) {
          // the mill blade, spinning behind the open front
          const bx = x + it.blade[0];
          const by = y + it.blade[1];
          for (let k = 0; k < 8; k++) {
            const a = S.bladeAngle + (k / 8) * Math.PI * 2;
            ctx.fillStyle = k % 2 ? PAL.stone : PAL.stoneDark;
            ctx.fillRect(Math.round(bx + Math.cos(a) * 7), Math.round(by + Math.sin(a) * 3.5), 2, 1);
          }
          ctx.fillStyle = PAL.stone;
          ctx.fillRect(Math.round(bx) - 1, Math.round(by) - 1, 3, 2);
        }

        if (it.hoist) {
          // rope and a swinging bundle of boards on the growing frames
          const hx = x + it.hoist[0];
          const hy = y + it.hoist[1];
          const sway = Math.sin(t * 0.7 + it.u) * 3;
          const drop = 18 + Math.sin(t * 0.45 + it.u) * 7;
          ctx.fillStyle = PAL.ink;
          ctx.fillRect(Math.round(hx + sway * 0.4), Math.round(hy), 1, Math.round(drop));
          ctx.fillStyle = PAL.sawn;
          ctx.fillRect(Math.round(hx + sway) - 5, Math.round(hy + drop), 10, 4);
          ctx.fillStyle = PAL.wood;
          ctx.fillRect(Math.round(hx + sway) - 5, Math.round(hy + drop + 2), 10, 1);
        }
      }
      while (mi < movers.length) movers[mi++].draw();

      /* ---- chimney smoke -------------------------------------------- */
      for (const p of S.smoke) {
        const a = p.age;
        const r = 2 + a * 2.2;
        const px = sX(p.x) + Math.sin(a * 1.7 + p.drift) * 3 + a * 2.2;
        if (px < -20 || px > iw + 20) continue;
        const py = sY(p.y) - a * 9;
        ctx.globalAlpha = Math.max(0, 1 - a / 3.6) * 0.8;
        ctx.fillStyle = a < 1 ? '#ffffff' : a < 2.4 ? '#f1ece2' : '#e4e0da';
        for (let k = -Math.round(r); k <= Math.round(r); k++) {
          const w = Math.round(Math.sqrt(Math.max(0, r * r - k * k)) * 2);
          if (w > 0) ctx.fillRect(Math.round(px - w / 2), Math.round(py) + k, w, 1);
        }
        ctx.globalAlpha = 1;
      }

      /* ---- the bell -------------------------------------------------- */
      if (S.bell) {
        const bx = sX(S.bell.x);
        const by = sY(S.bell.y);
        if (bx > -30 && bx < iw + 30) {
          const swing =
            S.bell.ringing > 0
              ? Math.sin(t * 7.5) * Math.min(1, S.bell.ringing / 1.6)
              : 0;
          drawBell(ctx, bx, by, swing * 1.4);
          for (const n of S.bell.notes) {
            if (n.age < 0) continue;
            drawNote(
              ctx,
              sX(n.x) + Math.sin(n.age * 2.2) * 5,
              sY(n.y) - n.age * 9,
              Math.max(0, 1 - n.age / 3.4),
              n.color
            );
          }
        }
      }

      /* ---- HTML overlays follow the camera --------------------------- */
      for (let i = 0; i < S.hits.length; i++) {
        const it = S.hits[i];
        const meta = it.hit!;
        const el = anchorRefs.current[i];
        const x = sX(it.x);
        const y = sY(it.y);
        const visible = x > -80 && x < iw + 80;
        if (el) {
          if (!visible) {
            // Parked, not hidden: `display: none` would drop the building out
            // of the tab order, and tabbing through every building — each one
            // scrolling its own beat into view — is how this design is meant
            // to be navigated without a mouse.
            el.classList.add('is-parked');
            el.style.left = '0px';
            el.style.top = '0px';
            el.style.width = '1px';
            el.style.height = '1px';
          } else {
            el.classList.remove('is-parked');
            el.style.left = `${offX + (x - meta.hw) * SCALE}px`;
            el.style.top = `${offY + (y - meta.hh) * SCALE}px`;
            el.style.width = `${meta.hw * 2 * SCALE}px`;
            el.style.height = `${(meta.hh + 4) * SCALE}px`;
          }
        }
        const tag = tagRefs.current[i];
        if (tag) {
          // Landmarks are always labelled; everything else is labelled only
          // while its own beat of the tour is the one you're standing in.
          if (!visible || !(TAGS[meta.id] || meta.stop === activeStop)) {
            tag.style.opacity = '0';
          } else {
            // fade the label out as the landmark leaves the middle of frame
            const near = 1 - clamp(Math.abs(x - iw / 2) / (iw * 0.42), 0, 1);
            tag.style.opacity = `${near * near}`;
            // keep the label on screen on narrow viewports
            tag.style.left = `${clamp(offX + x * SCALE, 60, size.w - 60)}px`;
            // Labels sit on the ground in front of their landmark rather than
            // over its roof — tall silhouettes would otherwise punch the tag
            // straight into the hero headline.
            tag.style.top = `${offY + (y + 7) * SCALE}px`;
          }
        }
      }

      const tip = tipRef.current;
      const hi = hoverRef.current;
      if (tip && hi != null && S.hits[hi]) {
        const it = S.hits[hi];
        const meta = it.hit!;
        const x = offX + sX(it.x) * SCALE;
        const topCss = offY + (sY(it.y) - meta.hh) * SCALE;
        const below = topCss < 150;
        tip.style.left = `${x}px`;
        tip.style.top = `${below ? offY + (sY(it.y) + 10) * SCALE : topCss}px`;
        tip.dataset.below = below ? '1' : '0';
      }
    };

    /* ---------------------------- the loop ---------------------------- */
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let lastCam = NaN;

    const syncChrome = (f: number) => {
      const idx = Math.round(f);
      if (idx !== activeStop) {
        activeStop = idx;
        setStop(idx);
      }
      const heroT = clamp(1 - f * 1.8, 0, 1);
      if (Math.abs(heroT - lastHeroVar) > 0.01) {
        lastHeroVar = heroT;
        document.documentElement.style.setProperty('--fr-hero', `${heroT}`);
        // Faded-out copy must stop being focusable, not just invisible.
        document.documentElement.dataset.frHero = heroT > 0.06 ? 'on' : 'off';
      }
      const capT = 1 - clamp(Math.abs(f - Math.round(f)) * 2.6, 0, 1);
      document.documentElement.style.setProperty('--fr-cap', `${capT}`);
      const m = markerRef.current;
      if (m) m.style.left = `${(f / Math.max(1, stops.length - 1)) * 100}%`;
    };

    if (reduced) {
      // Settle the village once, then repaint only when the scroll moves.
      for (let i = 0; i < 200; i++) stepScene(S, 1 / 20);
      puffSmoke(S);
      for (let i = 0; i < 8; i++) stepScene(S, 0.2);
      const paint = () => {
        const cam = cameraAt();
        if (cam.u !== lastCam) {
          lastCam = cam.u;
          syncChrome(cam.f);
          render(cam.u, cam.v, 12);
        }
        raf = requestAnimationFrame(paint);
      };
      raf = requestAnimationFrame(paint);
    } else {
      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        clock += dt;

        stepScene(S, dt);
        smokeClock += dt;
        if (smokeClock > 0.55) {
          smokeClock = 0;
          puffSmoke(S);
        }
        for (const c of clouds) {
          c.x += c.v * dt;
          if (c.x > span) c.x -= span;
        }
        for (const b of birds) {
          b.x += b.v * dt;
          if (b.x > span) b.x -= span;
        }

        const cam = cameraAt();
        // Attract mode: after ten idle seconds the camera eases off toward the
        // mail cart, and any input eases it straight back.
        const idle = now - lastInput > 10000;
        const mail = S.carts.find((c) => c.id === 'mail');
        const want = idle && mail ? clamp(mail.u - cam.u, -16, 16) : 0;
        drift += (want - drift) * Math.min(1, dt * (idle ? 0.35 : 3));

        syncChrome(cam.f);
        render(cam.u + drift, cam.v, clock);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', noteInput);
      window.removeEventListener('wheel', noteInput);
      window.removeEventListener('pointerdown', noteInput);
      window.removeEventListener('pointermove', noteInput);
      window.removeEventListener('touchstart', noteInput);
      window.removeEventListener('keydown', noteInput);
      window.removeEventListener('resize', measure);
    };
  }, [size, world, stops.length]);

  const hovered = hover != null ? hits[hover] : null;
  const showLog = hovered?.kind === 'notice';

  return (
    <div className="fr-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="fr-canvas" aria-hidden="true" />

      <div className="fr-hits">
        {hits.map((h, i) => (
          <a
            key={h.id}
            ref={(el) => {
              anchorRefs.current[i] = el;
            }}
            className="fr-hit is-parked"
            href={h.href ?? `#projects`}
            onMouseEnter={() => setHoverBoth(i)}
            onMouseLeave={() => setHoverBoth(null)}
            onFocus={() => {
              setHoverBoth(i);
              goToStop(h.stop);
            }}
            onBlur={() => setHoverBoth(null)}
          >
            <span className="fr-sr">
              {h.title}
              {h.loc ? ` — ${fmtLoc(h.loc)} lines, ${buildingSize(h.loc)}` : ''}
              {` — ${STATE_WORD[h.state]}. ${h.blurb}`}
            </span>
          </a>
        ))}
      </div>

      <div className="fr-tags" aria-hidden="true">
        {hits.map((h, i) => (
          <span
            key={h.id}
            ref={(el) => {
              tagRefs.current[i] = el;
            }}
            className="fr-tag"
            style={{ opacity: 0 }}
          >
            {TAGS[h.id] ?? h.title}
          </span>
        ))}
      </div>

      {hovered && !showLog && (
        <div className="fr-tip" ref={tipRef} style={{ borderColor: hovered.accent }}>
          <strong style={{ color: shade(hovered.accent, -0.4) }}>{hovered.title}</strong>
          <span className="fr-tip-meta">
            {hovered.loc
              ? `${fmtLoc(hovered.loc)} lines · ${buildingSize(hovered.loc)} · ${STATE_WORD[hovered.state]}`
              : STATE_WORD[hovered.state]}
          </span>
          <span className="fr-tip-blurb">{hovered.blurb}</span>
          {hovered.tech && (
            <span className="fr-tip-tech">{hovered.tech.slice(0, 4).join(' · ')}</span>
          )}
        </div>
      )}

      {showLog && (
        <div className="fr-tip fr-log" ref={tipRef}>
          <strong>Notice board</strong>
          <span className="fr-tip-meta">this week in the hamlet</span>
          <ul>
            {world.buildLog.slice(0, 6).map((l, i) => (
              <li key={i}>
                <b>{l.day}</b> {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready && (
        <>
          <div className="fr-caption">
            <p className="fr-cap-label">
              {stop + 1} / {stops.length} · {stops[stop]?.label}
            </p>
            <p className="fr-cap-text">{stops[stop]?.caption}</p>
          </div>

          <nav className="fr-strip" aria-label="Village tour waypoints">
            <span className="fr-strip-road" aria-hidden="true" />
            <span className="fr-strip-marker" ref={markerRef} aria-hidden="true" />
            {stops.map((w, i) => (
              <button
                key={w.id}
                type="button"
                className={i === stop ? 'fr-dot is-on' : 'fr-dot'}
                style={{ left: `${(i / Math.max(1, stops.length - 1)) * 100}%` }}
                onClick={() => goToStop(i)}
                aria-current={i === stop ? 'step' : undefined}
              >
                <span className="fr-dot-label">{w.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
