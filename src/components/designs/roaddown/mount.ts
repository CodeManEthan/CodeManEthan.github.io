/**
 * The Road Down the Page — putting the world behind the page.
 *
 * The page is laid out first, in ordinary HTML, and only then measured. Every
 * village is painted into the box its own hit area actually occupies, so the
 * art and the words beside it are pinned together by construction — a long
 * summary that wraps to another line moves the village with it.
 *
 * The world is cut into canvas tiles purely for memory's sake. A tile is a
 * window onto one continuous coordinate space, never a scene of its own, so the
 * road, the meadow, the scatter and the tide line all cross a tile boundary
 * without knowing there was one.
 *
 * Rendering follows the homepage's own pattern (see PastDays.tsx): nothing is
 * drawn until somebody is looking at it, and the work is cut into slices that
 * fit inside a frame.
 */

import {
  type Ctx,
  buildTree,
  buildBush,
  buildRock,
  buildFlowerPatch,
  buildReeds,
  buildJetty,
  buildRowboat,
  buildCampfire,
  drawCart,
  drawRipple,
  type Sprite,
} from '../vale/art';
import { hashSeed, mulberry32 } from '../genesis/types';
import { seasonNow, type VillageData } from './meta';
import {
  SCALE,
  TILE_H,
  VERGE,
  paintGround,
  paintRoad,
  paintRoadStones,
  paintScatter,
  paintSea,
  roadCx,
  shoreAt,
  type World,
  type WorldRect,
} from './world';
import { buildVillage, paintVillage, villageGroundTone, type BuiltVillage } from './village';

const FRAME_BUDGET = 6; // ms

/** How far above the footer the water starts, in CSS pixels. */
const WATER_ABOVE_FOOTER = 34;

/* ------------------------------ the clock -------------------------------- */

/**
 * The visitor's own wall clock, exactly as the valley above reads it. This is
 * the one place the design is allowed to look at the time: the villages are
 * seeded by name and never change, and only the traveller on the road moves.
 */
function wallClockHours(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/* ------------------------------- measuring ------------------------------- */

interface Slot {
  el: HTMLElement;
  data: VillageData;
  box: WorldRect;
  side: 'left' | 'right';
}

function measure(road: HTMLElement, data: VillageData[]): { world: World; slots: Slot[] } | null {
  const w = road.offsetWidth;
  const h = road.offsetHeight;
  if (w < 200 || h < 400) return null;

  const roadTop = road.getBoundingClientRect().top + window.scrollY;

  const footer = road.querySelector('footer') as HTMLElement | null;
  const footerTop = footer
    ? footer.getBoundingClientRect().top + window.scrollY - roadTop
    : h - 160;

  const world: World = {
    w: Math.ceil(w / SCALE),
    h: Math.ceil(h / SCALE),
    shoreY: Math.round((footerTop - WATER_ABOVE_FOOTER) / SCALE),
    season: seasonNow(),
  };

  const slots: Slot[] = [];
  road.querySelectorAll<HTMLElement>('.village').forEach((li) => {
    const i = Number(li.dataset.index);
    const d = data[i];
    const hit = li.querySelector<HTMLElement>('.village-slot');
    if (!d || !hit) return;
    const r = hit.getBoundingClientRect();
    slots.push({
      el: li,
      data: d,
      side: li.classList.contains('art-left') ? 'left' : 'right',
      box: {
        x: (r.left + window.scrollX) / SCALE,
        y: (r.top + window.scrollY - roadTop) / SCALE,
        w: r.width / SCALE,
        h: r.height / SCALE,
      },
    });
  });

  return slots.length ? { world, slots } : null;
}

/* ------------------------------ the scatter ------------------------------ */

function scatterLibrary(): { all: Sprite[]; conifers: Sprite[] } {
  const all: Sprite[] = [];
  for (let k = 0; k < 7; k++) {
    for (let s = 0; s < 3; s++) all.push(buildTree(k as 0 | 1 | 2 | 3 | 4 | 5 | 6, 700 + k * 31 + s));
  }
  for (let s = 0; s < 4; s++) all.push(buildBush(200 + s));
  for (let s = 0; s < 4; s++) all.push(buildRock(300 + s));
  for (let s = 0; s < 3; s++) all.push(buildFlowerPatch(400 + s));

  // Pine (1) and fir (6) only — the valley's own edge is conifer.
  const conifers: Sprite[] = [];
  for (const k of [1, 6] as const) {
    for (let s = 0; s < 4; s++) conifers.push(buildTree(k, 900 + k * 17 + s));
  }
  return { all, conifers };
}

/* ------------------------------- the shore ------------------------------- */

/**
 * Where the road runs out. The jetty carries the last of the carriageway over
 * the water, two boats are drawn up on the sand, and the reeds mark the wet
 * edge — all of them sprites the valley already owns.
 */
function shoreProps(world: World): { sp: Sprite; x: number; y: number }[] {
  const out: { sp: Sprite; x: number; y: number }[] = [];
  const rnd = mulberry32(hashSeed('roaddown:shore'));
  const DOWN = Math.PI / 4; // heading straight down-screen in ground radians

  const cx = roadCx(world, world.shoreY);
  out.push({ sp: buildJetty(DOWN, 3.0, 12), x: cx, y: shoreAt(world, cx) - 12 });
  out.push({ sp: buildRowboat(DOWN, 4), x: cx - 62, y: shoreAt(world, cx - 62) + 12 });
  out.push({ sp: buildRowboat(DOWN + 0.5, 9), x: cx + 74, y: shoreAt(world, cx + 74) + 18 });

  for (let i = 0; i < 14; i++) {
    const x = rnd() * world.w;
    if (Math.abs(x - cx) < VERGE + 14) continue;
    out.push({ sp: buildReeds(500 + i), x, y: shoreAt(world, x) - 4 - rnd() * 8 });
  }
  return out;
}

/* ------------------------------ the traveller ---------------------------- */

interface Caravan {
  x: number;
  y: number;
  camped: boolean;
  near: string;
}

/**
 * The surveyor's caravan walks the length of the road once a day, on the
 * visitor's own clock: a little after dawn it is leaving the first village, and
 * by late evening it has the sea in sight. Position is read straight off the
 * hour, so it is the same for everyone in the same time zone and needs no
 * animation to be true.
 */
function caravanAt(world: World, slots: Slot[]): Caravan {
  const t = Math.min(1, Math.max(0, wallClockHours() / 24));
  const first = slots[0];
  const last = slots[slots.length - 1];
  const from = first.box.y + first.box.h * 0.5;
  const to = Math.min(world.shoreY - 74, last.box.y + last.box.h + 120);
  const y = from + (to - from) * t;

  let near = 'the open road';
  let best = Infinity;
  for (const s of slots) {
    const d = Math.abs(y - (s.box.y + s.box.h * 0.5));
    if (d < best) {
      best = d;
      near = s.data.title;
    }
  }

  const hour = wallClockHours();
  return { x: roadCx(world, y), y, camped: hour < 6.5 || hour >= 20.5, near };
}

/* ------------------------------- the render ------------------------------ */

interface Ctx2 {
  world: World;
  villages: BuiltVillage[];
  lib: Sprite[];
  conifers: Sprite[];
  claimed: WorldRect[];
  props: { sp: Sprite; x: number; y: number }[];
  caravan: Caravan;
}

/**
 * One tile, as a generator: each `yield` is a place the renderer may stop and
 * hand the frame back. The context is translated by a whole number of pixels
 * and never scaled — art.ts snaps spans to whole pixels and can only do that
 * under an identity transform.
 */
function* tileJob(canvas: HTMLCanvasElement, y0: number, y1: number, c: Ctx2): Generator<void> {
  const ctx = canvas.getContext('2d') as Ctx;
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, -y0);

  paintGround(ctx, c.world, y0, y1);
  yield;

  paintSea(ctx, c.world, y0, y1);
  yield;

  paintRoad(ctx, c.world, y0, y1);
  paintRoadStones(ctx, c.world, y0, y1);
  yield;

  paintScatter(ctx, c.world, y0, y1, c.lib, c.conifers, c.claimed);
  yield;

  for (const v of c.villages) {
    if (v.rect.y > y1 + 90 || v.rect.y + v.rect.h < y0 - 120) continue;
    villageGroundTone(ctx, v);
    paintVillage(ctx, v, c.world);
    yield;
  }

  // The shore furniture, then the traveller on top of the road he is on.
  const props = c.props.filter((p) => p.y > y0 - 90 && p.y < y1 + 90);
  if (props.length) {
    for (const p of props.sort((a, b) => a.y - b.y)) {
      ctx.drawImage(p.sp.c, Math.round(p.x - p.sp.ox), Math.round(p.y - p.sp.oy));
    }
    for (let i = 0; i < 5; i++) {
      const x = (c.world.w * (i + 0.5)) / 5;
      drawRipple(ctx, x, shoreAt(c.world, x) + 30 + i * 9, 10 + i * 3, 0.35);
    }
    yield;
  }

  const cv = c.caravan;
  if (cv.y > y0 - 70 && cv.y < y1 + 70) {
    if (cv.camped) {
      const fire = buildCampfire();
      ctx.drawImage(fire.c, Math.round(cv.x + 20 - fire.ox), Math.round(cv.y + 4 - fire.oy));
    }
    drawCart(ctx, Math.round(cv.x - 6), Math.round(cv.y), '#f0c75e', true, 0.9, '#b3855b');
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* -------------------------------- mounting ------------------------------- */

export function mountRoad(): void {
  const road = document.getElementById('road');
  const layer = document.getElementById('road-world');
  const raw = document.getElementById('roaddown-data');
  if (!road || !layer || !raw?.textContent) return;

  const data: VillageData[] = JSON.parse(raw.textContent);
  let teardown: (() => void) | null = null;

  const build = () => {
    teardown?.();
    layer.textContent = '';

    const m = measure(road, data);
    if (!m) return;
    const { world, slots } = m;

    const villages = slots.map((s) => buildVillage(s.data, s.box, s.side, world));
    const scatter = scatterLibrary();
    const c: Ctx2 = {
      world,
      villages,
      lib: scatter.all,
      conifers: scatter.conifers,
      claimed: villages.map((v) => v.rect),
      props: shoreProps(world),
      caravan: caravanAt(world, slots),
    };

    // Tell the page where the traveller got to.
    const note = document.getElementById('caravan-note');
    if (note) {
      note.textContent = c.caravan.camped
        ? `The surveyor's caravan is camped for the night outside ${c.caravan.near}.`
        : `The surveyor's caravan is on the road outside ${c.caravan.near}.`;
    }

    /* ---- tiles ---- */
    // Tiles are placed absolutely and given one art pixel of overlap. The
    // overlap costs nothing — a tile's content is a pure function of absolute
    // y, so the shared row is painted identically by both — and it means no
    // amount of sub-pixel rounding on a fractional-width page can ever open a
    // hairline of background between two stretches of road.
    const count = Math.ceil(world.h / TILE_H);
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
      const y0 = i * TILE_H;
      const h = Math.min(TILE_H, world.h - y0) + 1;
      const cv = document.createElement('canvas');
      cv.width = world.w;
      cv.height = h;
      cv.style.position = 'absolute';
      cv.style.left = '0';
      cv.style.top = `${y0 * SCALE}px`;
      cv.style.width = '100%';
      cv.style.height = `${h * SCALE}px`;
      layer.appendChild(cv);
      canvases.push(cv);
    }

    /* ---- lazy, frame-budgeted painting ---- */
    const wanted: number[] = [];
    const queued = new Set<number>();
    let raf = 0;
    let job: Generator<void> | null = null;
    let live = true;

    const pump = () => {
      if (!live) return;
      const start = performance.now();
      do {
        if (!job) {
          const next = wanted.shift();
          if (next === undefined) {
            raf = 0;
            return;
          }
          const y0 = next * TILE_H;
          job = tileJob(canvases[next], y0, y0 + canvases[next].height, c);
        }
        try {
          if (job.next().done) {
            job = null;
            // The frame a tile finishes in is also the frame it is handed to
            // the compositor; starting the next one on top of that is the one
            // pile-up worth refusing.
            break;
          }
        } catch {
          job = null;
          break;
        }
      } while (performance.now() - start < FRAME_BUDGET);
      raf = requestAnimationFrame(pump);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(pump);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = canvases.indexOf(e.target as HTMLCanvasElement);
          if (i < 0 || queued.has(i)) continue;
          queued.add(i);
          wanted.push(i);
          io.unobserve(e.target);
        }
        kick();
      },
      { rootMargin: '600px 0px' }
    );
    for (const cv of canvases) io.observe(cv);

    teardown = () => {
      live = false;
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      for (const cv of canvases) cv.width = 0;
    };
  };

  build();

  /* A width change re-lays the page out, so the world has to be measured and
     painted again; a height-only change (the address bar on a phone) does not. */
  let lastW = road.offsetWidth;
  let timer = 0;
  window.addEventListener('resize', () => {
    if (road.offsetWidth === lastW) return;
    lastW = road.offsetWidth;
    window.clearTimeout(timer);
    timer = window.setTimeout(build, 180);
  });

  // Fonts landing after first paint reflow the cards and move the villages.
  if ('fonts' in document) {
    (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
      if (road.offsetWidth === lastW) build();
    });
  }
}
