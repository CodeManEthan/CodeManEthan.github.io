/**
 * The Seven Charters — DESIGN LAB.
 *
 * The homepage grid, with the material of every card swapped out. A project
 * card is normally a rectangle of CSS; here it is a real evening render of that
 * project's own village, generated in the visitor's browser from nothing but
 * the project's slug.
 *
 * It is the same trick `PastDays.tsx` plays on the /days archive, and most of
 * the machinery below is that file's, deliberately: build the world, hold it at
 * evening, paint ONE deterministic frame, tear the scene down. What changes is
 * what the seed is and how much of the valley the camera is allowed to see.
 *
 *   seed   hashSeed(slug). A day's valley is its date; a charter's valley is
 *          its name, so it is the same village every day forever.
 *   scale  read off the project's real line count. `generateMap`'s pace scale
 *          says how much gets BUILT in a day, which is exactly "how big is
 *          this village" — 2 towns at 0.25x, eleven at 4x.
 *   camera the reason the scale is legible at all. Eleven towns and eight
 *          towns fill the same valley rect, so a card framed on the whole
 *          valley would make a 68k-line project and an 18k-line one look
 *          alike. The camera's width is a function of the scale instead: the
 *          smallest charter is framed on nineteen tiles of ground and reads as
 *          a couple of roofs, the largest on the whole sixty-four.
 *
 * Nothing here touches gen/timeline logic — `scale` and `pace` are the knobs
 * those two already publish, and every draw is seeded off the slug. No
 * Math.random, no Date.now in any generation path; the one clock reading is
 * today's date, and it only picks the weather all seven charters share.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { generateMap } from '@codemanethan/genesis/gen';
import { buildTimeline, snapshotAt } from '@codemanethan/genesis/timeline';
import { dayInfo, type DayInfo } from '@codemanethan/genesis/daytype';
import {
  buildGenesisSceneSteps,
  makeAmbient,
  renderGenesis,
  settleAmbient,
  type GenesisScene,
} from '@codemanethan/genesis/scene';
import { TW, TH, hashSeed, type GenesisMap, type SiteSpec } from '@codemanethan/genesis/types';

/* --------------------------------- shape --------------------------------- */

export interface Charter {
  slug: string;
  title: string;
  summary: string;
  tech: string[];
  status: 'public' | 'private' | 'soon';
  featured: boolean;
  repo?: string;
  demo?: string;
  /** Real measured lines of code — the only thing that sets the world's size. */
  loc: number;
  /** GEM_COLORS[i], index-matched to the project order. */
  accent: string;
  /** "I" … "VII". */
  numeral: string;
  /** fmtLoc(loc), computed page-side so the island does not need islands.ts. */
  locLabel: string;
  /** sizeLabel(loc) — for the picture's description, which has no words of its own. */
  sizeLabel: string;
}

/**
 * The hour every charter is seen at. The /days archive's hour, for the same
 * reason: late enough that the village is a village, early enough that there is
 * still light on it, and lamp-lit enough that a lit window means something.
 */
const T_EVENING = 20.5;

/**
 * How hard a `soon` project's settlers work. Below 1 the day runs off the end
 * of midnight, so at half eight the valley is still half raised — stakes in the
 * ground, walls up on sticks, roofs that have not landed. A project that is not
 * shipped yet gets a village that is not finished yet.
 */
const SOON_PACE = 0.5;

/** Fixed animation phase: a card must not depend on when it was painted. */
const CARD_CLOCK = 8;

/** Matches the homepage's cap; the blit wants device pixels, not CSS ones. */
const MAX_DPR = 3;

/** Milliseconds of generation work per frame — see PastDays. A stop line, not
 * a quota: a generator step is indivisible and some of them are longer. */
const FRAME_BUDGET = 7;

/** Vignette aspect. Also the shape the camera rect is cut to. */
const CARD_ASPECT = 16 / 10;

/* ------------------------- lines of code -> a valley ---------------------- */

/** The two ends of the real range, so the mapping is anchored to the projects
 * that exist rather than to a round number. */
const LOC_MIN = 2330;
const LOC_MAX = 67732;

/** `generateMap`'s own limits. */
const SCALE_MIN = 0.25;
const SCALE_MAX = 4;

/**
 * Lines of code -> world scale, log-linear between the smallest project and the
 * largest, across the generator's whole range.
 *
 * Log and not linear because the projects are: 2.3k, 4.2k, 18k, 20k, 26k, 57k,
 * 68k. Spread linearly, five of the seven would sit in the bottom third of the
 * scale and be indistinguishable. In log space they come out evenly.
 *
 * Rounded to two places so the value is a short, stable cache key in
 * `generateMap`'s LRU rather than a float that never repeats.
 */
export function scaleForLoc(loc: number): number {
  const lo = Math.log(LOC_MIN);
  const hi = Math.log(LOC_MAX);
  const t = (Math.log(Math.max(1, loc)) - lo) / (hi - lo);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const s = SCALE_MIN * Math.pow(SCALE_MAX / SCALE_MIN, k);
  return Math.round(s * 100) / 100;
}

/**
 * How wide a bite of the valley the camera takes, in u tiles.
 *
 * This is the half of the size mapping that can actually be seen. The generator
 * spends a bigger scale on more towns and more plots, but it spends them inside
 * the same fixed valley rect, so an eleven-town world and an eight-town world
 * are the same picture with different crowding. Pulling the camera in for the
 * small charters is what turns "fewer buildings" into "a hamlet you are
 * standing next to".
 *
 * 19 tiles at 0.25x, 64 — the whole framed valley — at 4x, with the curve
 * bent so the crowded middle of the range still separates.
 */
function viewTilesFor(scale: number): number {
  const t = (scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return 19 + 45 * Math.pow(t < 0 ? 0 : t > 1 ? 1 : t, 0.62);
}

/**
 * How far up to shove the camera, in v tiles.
 *
 * A building stands ON its tile and is drawn UP from it — three floors and a
 * cupola reach the better part of sixty world pixels above the ground the plot
 * occupies. Centring on the plots therefore centres on the plots' feet and
 * slices the roofs off the top of the frame, which is only really visible when
 * the camera is close. So the closer the camera, the further up it looks: about
 * four tiles at a hamlet, barely one across a whole valley.
 */
const liftFor = (du: number) => 4.2 * Math.max(0, Math.min(1, (46 - du) / 27));

/** A camera rect in u/v tiles, cut to the card's aspect and kept inside the
 * valley's own framing rect. */
function frameFor(map: GenesisMap, scale: number): { u0: number; v0: number; u1: number; v1: number } {
  const C = map.content;
  // world px: x = u * TW/2, y = v * TH/2, so an aspect of A wants
  // du * (TW/2) = A * dv * (TH/2)  ->  dv = du * (TW/TH) / A.
  let du = Math.min(viewTilesFor(scale), C.u1 - C.u0);
  let dv = (du * (TW / TH)) / CARD_ASPECT;
  if (dv > C.v1 - C.v0) {
    dv = C.v1 - C.v0;
    du = (dv * CARD_ASPECT * TH) / TW;
  }

  /**
   * What the camera looks at.
   *
   * A wide charter can point at the average of every plot in the valley and be
   * sure of hitting settlement, because at that width there is settlement
   * everywhere. A close one cannot: three towns at 0.41x are three specks with
   * a great deal of empty moor between them, and their average is the moor. So
   * once the camera is close enough to miss, it stops averaging and looks at
   * the biggest town — the one place a small charter is certainly a place.
   */
  let target: SiteSpec | null = null;
  for (const s of map.sites) {
    if (!target || s.buildings.length > target.buildings.length) target = s;
  }
  const from = du < 36 && target ? target.buildings : map.sites.flatMap((s) => s.buildings);
  let su = 0;
  let sv = 0;
  for (const b of from) {
    su += b.gx - b.gy;
    sv += b.gx + b.gy;
  }
  const cu = from.length ? su / from.length : 0;
  const cv = from.length ? sv / from.length : 0;

  const clamp = (c: number, d: number, lo: number, hi: number) => {
    const half = d / 2;
    if (hi - lo <= d) return (lo + hi) / 2 - half;
    return Math.max(lo, Math.min(hi - d, c - half));
  };
  const u0 = clamp(cu, du, C.u0, C.u1);
  const v0 = clamp(cv - liftFor(du), dv, C.v0, C.v1);
  return { u0, v0, u1: u0 + du, v1: v0 + dv };
}

/* -------------------------------- the day -------------------------------- */

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * Tonight's weather, shared by all seven.
 *
 * The villages themselves never move — a charter is its slug — but the light
 * over them is the light over the valley at the top of this page, because that
 * is the one thing on the page that is allowed to be about today. Season comes
 * off the month, day type off the same date seed the hero uses, so the grid and
 * the world above it are having the same evening.
 */
function tonight(): DayInfo {
  const d = new Date();
  const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return dayInfo(hashSeed(key), d.getMonth() + 1);
}

/* ------------------------------- the picture ------------------------------ */

/** Give the browser its memory back. Verbatim from PastDays, and for the same
 * reason: a baked scene is tens of megabytes of canvas and seven of them held
 * at once would be a quarter of a gigabyte of postage stamps. */
function release(scene: GenesisScene): void {
  const drop = (c: HTMLCanvasElement | null | undefined) => {
    if (!c) return;
    c.width = 0;
    c.height = 0;
  };
  drop(scene.layer);
  drop(scene.veg?.c);
  drop(scene.roads?.c);
  drop(scene.surround);
  drop(scene.frame);
  drop(scene.glow);
}

/**
 * Shrink `src` onto `dst`, halving as far as it can first. PastDays' box
 * filter: the renderer's nearest-neighbour blit is what keeps the art hard
 * edged going up, and it is exactly what turns a forest into speckle coming
 * down, so a card is drawn at whole magnification and filtered here.
 */
function shrink(src: HTMLCanvasElement, spare: HTMLCanvasElement, dst: HTMLCanvasElement): void {
  let cur = src;
  let cw = src.width;
  let ch = src.height;
  const dw = dst.width;
  const dh = dst.height;

  while (cw >= dw * 2 && ch >= dh * 2 && cw > 2 && ch > 2) {
    const nw = Math.max(1, cw >> 1);
    const nh = Math.max(1, ch >> 1);
    const to = cur === src ? spare : src;
    to.width = nw;
    to.height = nh;
    const c = to.getContext('2d');
    if (!c) break;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = to;
    cw = nw;
    ch = nh;
  }

  const d = dst.getContext('2d');
  if (!d) return;
  d.imageSmoothingEnabled = true;
  d.imageSmoothingQuality = 'high';
  d.clearRect(0, 0, dw, dh);
  const s = Math.max(dw / cw, dh / ch);
  const w = cw * s;
  const h = ch * s;
  d.drawImage(cur, 0, 0, cw, ch, (dw - w) / 2, (dh - h) / 2, w, h);
}

/**
 * The gem, laid over the evening.
 *
 * Every other design in the lab spends `GEM_COLORS[i]` on a border. A card here
 * is mostly picture, so the accent goes into the picture too — but only just.
 *
 * The number below is the whole argument. All seven villages are the same
 * evening, and the point of the grid is that they look it; a wash heavy enough
 * to name the gem is also heavy enough to turn a teal charter into noon and a
 * pink one into a different sunset. At a sixth of the way it reads as a
 * coloured cast over dusk rather than as a filter, and the row still holds
 * together. `private` gets a touch more because its frame is asking to be
 * noticed.
 */
function dress(canvas: HTMLCanvasElement, accent: string, status: Charter['status']): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  c.save();
  c.globalCompositeOperation = 'soft-light';
  c.globalAlpha = status === 'private' ? 0.24 : 0.17;
  c.fillStyle = accent;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.restore();
}

/** Scratch canvases, shared by every card: only one is ever in flight. */
interface Scratch {
  full: HTMLCanvasElement;
  spare: HTMLCanvasElement;
}

/** What a finished picture also learned about the place it drew. */
interface Place {
  valley: string;
  towns: number;
  founder: string;
}

/**
 * One charter's village, as a generator so the work can be paid for a frame at
 * a time. Yields sit where PastDays puts them — at the same safe points the
 * homepage's own pre-midnight build uses.
 */
function* cardJob(
  ch: Charter,
  day: DayInfo,
  canvas: HTMLCanvasElement,
  scratch: Scratch,
  out: { place: Place | null }
) {
  const scale = scaleForLoc(ch.loc);
  const map: GenesisMap = generateMap(hashSeed(ch.slug), scale);
  yield;
  const tl = buildTimeline(map, ch.status === 'soon' ? SOON_PACE : 1);
  yield;
  const snap = snapshotAt(map, tl, T_EVENING);
  out.place = {
    valley: map.valleyName,
    towns: map.sites.length,
    founder: map.sites[0]?.founder ?? '',
  };
  yield;

  const steps = buildGenesisSceneSteps(map, day, null);
  let scene: GenesisScene;
  for (;;) {
    const r = steps.next();
    if (r.done) {
      scene = r.value;
      break;
    }
    yield;
  }

  try {
    /**
     * The beacon. A featured project's village has its fire lit: `scene.fest`
     * is the hour the bonfire goes up, and the renderer needs no more than that
     * — the fire, its halo and the ring of people standing round it are already
     * in the scene, waiting for an hour that a normal evening never reaches.
     * Set to just before the card's own hour, so a featured charter is the one
     * with a light in the middle of it. No new art, no badge required.
     */
    scene.fest = ch.featured ? T_EVENING - 0.4 : 0;
    const amb = makeAmbient(1);
    settleAmbient(scene, amb, snap);
    yield;

    const f = frameFor(map, scale);
    const worldW = Math.max(1, Math.round((f.u1 - f.u0) * (TW / 2)));
    const worldH = Math.max(1, Math.round((f.v1 - f.v0) * (TH / 2)));
    // Whole magnifications only — that is the whole reason the art stays hard
    // edged — and never more than the card can use. A big valley is drawn at
    // 1:1 and filtered down; a hamlet is drawn at 2x or 3x and filtered down,
    // which is a great deal kinder than drawing it small and blowing it up.
    const Z = Math.max(1, Math.min(3, Math.ceil(canvas.width / worldW)));
    const vw = worldW * Z;
    const vh = worldH * Z;

    const full = scratch.full;
    full.width = vw;
    full.height = vh;
    const fctx = full.getContext('2d');
    if (!fctx) return;
    renderGenesis(
      fctx,
      scene,
      amb,
      snap,
      { cx: f.u0 * (TW / 2), cy: f.v0 * (TH / 2), zoom: Z, vw, vh, dpr: 1 },
      CARD_CLOCK
    );
    yield;
    shrink(full, scratch.spare, canvas);
    dress(canvas, ch.accent, ch.status);
    scratch.full.width = 0;
    scratch.full.height = 0;
    scratch.spare.width = 0;
    scratch.spare.height = 0;
  } finally {
    release(scene);
  }
}

/* ------------------------------- the island ------------------------------- */

type Phase = 'idle' | 'working' | 'done' | 'gone';

const STATUS_NOTE: Record<Charter['status'], string> = {
  public: '',
  private: 'Source private · demo on request',
  soon: 'Repo coming soon',
};

export default function CharterGrid({ charters }: { charters: Charter[] }) {
  const [phase, setPhase] = useState<Phase[]>(() => charters.map(() => 'idle'));
  const [places, setPlaces] = useState<(Place | null)[]>(() => charters.map(() => null));

  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const wanted = useRef<number[]>([]);
  const queued = useRef<Set<number>>(new Set());
  const chartersRef = useRef(charters);
  chartersRef.current = charters;

  const setPhaseAt = useCallback((i: number, p: Phase) => {
    setPhase((prev) => {
      const next = prev.slice();
      next[i] = p;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!charters.length) return;
    let live = true;
    let raf = 0;
    const day = tonight();
    const scratch: Scratch = {
      full: document.createElement('canvas'),
      spare: document.createElement('canvas'),
    };
    let job: Generator<void, void, void> | null = null;
    let jobIndex = -1;
    let jobOut: { place: Place | null } = { place: null };

    const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), MAX_DPR);

    const fit = (canvas: HTMLCanvasElement): boolean => {
      const r = canvas.getBoundingClientRect();
      const w = Math.round((r.width || 340) * dpr);
      const h = Math.round((r.height || 212) * dpr);
      if (w < 8 || h < 8) return false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return true;
    };

    const pump = () => {
      if (!live) return;
      const start = performance.now();
      do {
        if (!job) {
          const next = wanted.current.shift();
          if (next === undefined) {
            raf = 0;
            return;
          }
          const canvas = canvases.current[next];
          if (!canvas || !fit(canvas)) {
            setPhaseAt(next, 'gone');
            continue;
          }
          jobIndex = next;
          jobOut = { place: null };
          job = cardJob(chartersRef.current[next], day, canvas, scratch, jobOut);
          setPhaseAt(next, 'working');
        }
        try {
          const done = job.next().done;
          // The place is known three steps in, well before the picture is; the
          // words under a card are worth having as soon as they exist.
          if (jobOut.place) {
            const p = jobOut.place;
            const at = jobIndex;
            jobOut = { place: null };
            setPlaces((prev) => {
              if (prev[at]) return prev;
              const nx = prev.slice();
              nx[at] = p;
              return nx;
            });
          }
          if (done) {
            setPhaseAt(jobIndex, 'done');
            job = null;
            // The frame a scene finishes in is the frame it is torn down in.
            // Starting the next valley on top of that is the one pile-up worth
            // refusing.
            break;
          }
        } catch {
          setPhaseAt(jobIndex, 'gone');
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
          const i = cards.current.indexOf(e.target as HTMLElement);
          if (i < 0 || queued.current.has(i)) continue;
          queued.current.add(i);
          wanted.current.push(i);
          io.unobserve(e.target);
        }
        kick();
      },
      { rootMargin: '400px 0px' }
    );
    for (const el of cards.current) if (el) io.observe(el);

    return () => {
      live = false;
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      scratch.full.width = 0;
      scratch.spare.width = 0;
    };
  }, [charters.length, setPhaseAt]);

  return (
    <>
      <style>{CSS}</style>
      <ol className="ch-grid">
        {charters.map((c, i) => {
          const place = places[i];
          const ph = phase[i];
          return (
            <li
              key={c.slug}
              className={`ch-card ch-${c.status}${c.featured ? ' ch-featured' : ''}`}
              style={{ ['--gem' as string]: c.accent }}
              ref={(el) => {
                cards.current[i] = el;
              }}
            >
              <a className="ch-plate" href={`/projects/${c.slug}/`}>
                <span className={`ch-vign${ph === 'done' ? ' ch-painted' : ''}`}>
                  <canvas
                    ref={(el) => {
                      canvases.current[i] = el;
                    }}
                    role="img"
                    aria-label={`${c.title} as a village at dusk — ${c.sizeLabel}, ${c.locLabel} lines`}
                  />
                  {ph !== 'done' && (
                    <span className="ch-raising" aria-hidden="true">
                      {ph === 'gone' ? 'no picture' : 'raising the village…'}
                    </span>
                  )}
                </span>

                <span className="ch-charter" aria-hidden="true">
                  <span className="ch-seal" />
                  {c.numeral}
                  {c.status === 'private' && <em>sealed</em>}
                  {c.status === 'soon' && <em>unbuilt</em>}
                </span>

                {c.featured && <span className="ch-lit">Featured</span>}

                <span className="ch-caption">
                  <span className="ch-title">{c.title}</span>
                  <span className="ch-place">
                    {place ? `${place.valley} · ${place.towns} town${place.towns === 1 ? '' : 's'}` : ' '}
                  </span>
                </span>
              </a>

              <div className="ch-body">
                <p className="ch-summary">{c.summary}</p>
                <p className="ch-size">{c.locLabel} lines</p>
                <ul className="ch-tech">
                  {c.tech.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <div className="ch-links">
                  <a className="ch-more" href={`/projects/${c.slug}/`}>
                    View project →
                  </a>
                  {c.status === 'public' && c.repo && (
                    <a className="ch-repo" href={c.repo} target="_blank" rel="noopener">
                      Source ↗
                    </a>
                  )}
                  {c.status !== 'public' && <span className="ch-status">{STATUS_NOTE[c.status]}</span>}
                  {c.demo && (
                    <a className="ch-repo" href={c.demo} target="_blank" rel="noopener">
                      Live demo ↗
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ---------------------------------- css ---------------------------------- */

const CSS = `
.ch-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.4rem;
}

.ch-card {
  display: flex;
  flex-direction: column;
  background: var(--card, #fff);
  border: 2px solid var(--border, #ece3d2);
  border-radius: 16px;
  overflow: hidden;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.ch-card:hover,
.ch-card:focus-within {
  transform: translateY(-3px);
  border-color: var(--gem);
  box-shadow: 0 12px 28px rgba(65, 58, 85, 0.14);
}

.ch-card.ch-featured {
  border-color: color-mix(in srgb, var(--gem) 45%, var(--border, #ece3d2));
}

/* A charter that has not been granted yet: the frame is still provisional. */
.ch-card.ch-soon {
  border-style: dashed;
}

/* ------------------------------ the vignette ------------------------------ */

.ch-plate {
  position: relative;
  display: block;
  color: inherit;
  text-decoration: none;
}

.ch-vign {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  /* Dusk, so the card has the right colour before its world has been built. */
  background: linear-gradient(180deg, #6b6a9c 0%, #7d7fa6 38%, #56705f 39%, #46614f 100%);
}

.ch-vign canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 0.5s ease;
}

.ch-vign.ch-painted canvas { opacity: 1; }

.ch-raising {
  position: absolute;
  inset: auto 0 42% 0;
  text-align: center;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 252, 240, 0.62);
}

/* The scrim the caption sits on. Deep enough that white text clears AA
   contrast over the brightest thing a dusk render can put here (a lit
   window, a bonfire), and tall enough that it reads as evening haze rather
   than as a bar. */
.ch-plate::after {
  content: '';
  position: absolute;
  inset: 42% 0 0 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(18, 16, 30, 0) 0%,
    rgba(18, 16, 30, 0.4) 44%,
    rgba(14, 12, 24, 0.88) 100%
  );
}

/* The wall.
   A private charter is the one status you are meant to feel before you read it: the
   valley is drawn the same as any other and then fenced, with a pale rule set
   inside the frame and a stone-coloured margin outside it. Card chrome, not
   sprite art — the generator has no notion of a gate and is not being taught
   one for a design lab. */
.ch-private .ch-vign::after {
  content: '';
  position: absolute;
  inset: 8px;
  pointer-events: none;
  border: 2px solid color-mix(in srgb, var(--gem) 55%, rgba(255, 250, 238, 0.85));
  border-radius: 3px;
  box-shadow:
    inset 0 0 0 1px rgba(12, 10, 22, 0.45),
    0 0 0 1px rgba(12, 10, 22, 0.45),
    inset 0 0 26px rgba(12, 10, 22, 0.5);
}

.ch-charter,
.ch-lit,
.ch-caption {
  position: absolute;
  z-index: 2;
}

.ch-charter {
  top: 0.6rem;
  left: 0.7rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: rgba(255, 252, 240, 0.9);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.65);
}

.ch-seal {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: var(--gem);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gem) 30%, transparent),
    0 1px 3px rgba(0, 0, 0, 0.5);
}

/* "sealed" / "unbuilt" — the word next to the numeral, for the status the
   picture is already saying. */
.ch-charter em {
  font-style: normal;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.05rem 0.42rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 252, 240, 0.42);
  background: rgba(16, 14, 28, 0.42);
  color: rgba(255, 252, 240, 0.86);
  text-shadow: none;
}

/* Not a badge so much as a lit window: the fire in the middle of the village
   is what actually marks a featured charter, and this only names it. */
.ch-lit {
  top: 0.6rem;
  right: 0.7rem;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.08rem 0.5rem;
  border-radius: 999px;
  color: #fff3d8;
  background: rgba(90, 52, 14, 0.5);
  border: 1px solid rgba(255, 205, 130, 0.7);
  box-shadow: 0 0 12px rgba(255, 190, 105, 0.35);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.ch-caption {
  inset: auto 0.85rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.ch-title {
  font-size: 1.16rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: #fffdf6;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
}

.ch-place {
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.35;
  color: rgba(255, 252, 240, 0.78);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
  min-height: 1.35em;
}

.ch-plate:hover .ch-title,
.ch-plate:focus-visible .ch-title {
  color: color-mix(in srgb, var(--gem) 50%, #fffdf6);
}

/* -------------------------------- the body -------------------------------- */

.ch-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.95rem 1.15rem 1.1rem;
  border-top: 2px solid color-mix(in srgb, var(--gem) 38%, var(--border, #ece3d2));
}

.ch-summary {
  margin: 0;
  flex: 1;
  font-size: 0.9rem;
  color: var(--ink-soft, #7a7690);
}

.ch-size {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--gem) 62%, var(--ink, #413a55));
}

.ch-tech {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ch-tech li {
  font-size: 0.71rem;
  padding: 0.1rem 0.55rem;
  border: 1px solid var(--border, #ece3d2);
  border-radius: 999px;
  color: var(--ink-soft, #7a7690);
}

.ch-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
  margin-top: 0.15rem;
  font-size: 0.85rem;
}

.ch-more {
  font-weight: 700;
  color: color-mix(in srgb, var(--gem) 70%, var(--ink, #413a55));
  text-decoration: none;
}

.ch-repo {
  font-weight: 600;
  color: var(--ink-soft, #7a7690);
  text-decoration: none;
}

.ch-status {
  font-size: 0.72rem;
  color: var(--ink-soft, #7a7690);
  border: 1px dashed var(--border, #ece3d2);
  border-radius: 999px;
  padding: 0.05rem 0.55rem;
}

@media (prefers-reduced-motion: reduce) {
  .ch-card { transition: none; }
  .ch-card:hover, .ch-card:focus-within { transform: none; }
  .ch-vign canvas { transition: none; }
}
`;
