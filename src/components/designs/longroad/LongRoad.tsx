/**
 * The Long Road — the strip itself.
 *
 * Seven bands down the page, one project to a band, and one road running the
 * full width of every one of them. The road leaves each band at exactly the
 * height the next one picks it up at, so the seven read as one road cut into
 * lengths — a strip map of a journey rather than seven separate pictures.
 *
 * The town stands in one half of its band and the plaque is planted in the
 * other; which half alternates down the page, so the eye zig-zags with the
 * road instead of running down a gutter.
 *
 * Nothing here is random and nothing here is dated: every town is seeded from
 * its project's slug. Only the SEASON comes off today's date, and only so the
 * strip's leaves match the valley's at the top of the page.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { hashSeed } from '../genesis/types.ts';
import { seasonOf, type Season } from '../genesis/daytype.ts';
import type { Sprite } from '../vale/art.ts';
import { buildScene, buildPools, paintBand, type RoadScene } from './paint.ts';
import {
  layoutVillage,
  tierOf,
  tradeFor,
  tradeName,
  type RoadProject,
  type Village,
} from './village.ts';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

const fmtLoc = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

const STATUS_TEXT: Record<RoadProject['status'], string> = {
  public: 'Open gates · source public',
  private: 'Walled · source private, demo on request',
  soon: 'Scaffolding · repo coming soon',
};

/** Today's season, so the strip's trees turn with the valley's above it. */
function todaySeason(): Season {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return seasonOf(hashSeed(key), d.getMonth() + 1);
}

interface Geom {
  /** Art pixels per CSS pixel is 1/scale; `scale` is the magnification. */
  scale: number;
  /** Band size in ART pixels. */
  w: number;
  h: number;
  /** Band size in CSS pixels. */
  cssW: number;
  cssH: number;
  narrow: boolean;
}

/**
 * The band's whole vertical budget in art pixels, and not a free number: the
 * road sits at 0.66 of it, a two-storey hall on the back row stands some 60px
 * over its own ground point, the beacon's sparks another 15 past that, and the
 * front row's footings need 20 under theirs. Anything shorter and the fold
 * cuts a roof in half, which is the one thing that stops the seven bands
 * reading as one road.
 */
const BAND_H = 164;

function geomFor(width: number): Geom {
  const narrow = width < 820;
  const scale = narrow ? 2 : 3;
  const w = Math.ceil(width / scale);
  return { scale, w, h: BAND_H, cssW: w * scale, cssH: BAND_H * scale, narrow };
}

export default function LongRoad({ projects }: { projects: RoadProject[] }): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(-1);
  const season = useMemo(todaySeason, []);

  /* ---- measure -------------------------------------------------------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setWidth(host.clientWidth));
    ro.observe(host);
    setWidth(host.clientWidth);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => (width > 0 ? geomFor(width) : null), [width]);

  const villages = useMemo<Village[] | null>(() => {
    if (!geom) return null;
    return projects.map((p, i) =>
      layoutVillage(p, geom.w, geom.h, geom.narrow || i % 2 === 0 ? 'left' : 'right')
    );
  }, [projects, geom]);

  /* ---- bake and animate ------------------------------------------------ */
  const hoverRef = useRef(-1);
  hoverRef.current = hover;

  useEffect(() => {
    if (!villages || !geom) return;
    let pools: Record<string, Sprite[]>;
    try {
      pools = buildPools(season);
    } catch {
      return;
    }
    const scenes: RoadScene[] = villages.map((v) => buildScene(v, pools, season));
    const ctxs = canvasRefs.current.map((c, i) => {
      if (!c) return null;
      const k = Math.max(1, Math.round(geom.scale * Math.min(2, window.devicePixelRatio || 1)));
      c.width = geom.w * k;
      c.height = geom.h * k;
      c.style.width = `${geom.cssW}px`;
      c.style.height = `${geom.cssH}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = false;
      return ctx;
    });

    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.band);
          if (e.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
      },
      { rootMargin: '160px 0px' }
    );
    for (const c of canvasRefs.current) if (c) io.observe(c);

    const still =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const paintAll = (t: number) => {
      for (let i = 0; i < scenes.length; i++) {
        const ctx = ctxs[i];
        if (ctx) paintBand(ctx, scenes[i], t, hoverRef.current === i);
      }
    };

    if (still) {
      paintAll(6);
      return () => io.disconnect();
    }

    paintAll(0);
    let raf = 0;
    const t0 = performance.now();
    let last = -1;
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      for (let i = 0; i < scenes.length; i++) {
        const ctx = ctxs[i];
        if (!ctx) continue;
        if (!visible.has(i) && hoverRef.current !== i) continue;
        paintBand(ctx, scenes[i], t, hoverRef.current === i);
      }
      // Repaint the band the pointer just left once, so its marquee clears.
      if (last !== hoverRef.current) last = hoverRef.current;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [villages, geom, season]);

  return (
    <div className="lr-road" ref={hostRef}>
      {projects.map((p, i) => {
        const v = villages?.[i];
        const tier = tierOf(p.loc);
        const side = geom?.narrow || i % 2 === 0 ? 'left' : 'right';
        return (
          <section
            key={p.slug}
            className={`lr-band lr-${side}${hover === i ? ' is-hot' : ''}`}
            style={
              { height: geom ? `${geom.cssH}px` : undefined, '--gem': p.gem } as CSSProperties
            }
          >
            <canvas
              className="lr-canvas"
              data-band={i}
              aria-hidden="true"
              ref={(el) => {
                canvasRefs.current[i] = el;
              }}
            />
            {v && geom && (
              <a
                className="lr-hit"
                href={p.href}
                aria-label={`${p.title} — ${tier.label}`}
                tabIndex={-1}
                style={{
                  left: `${v.hit.x * geom.scale}px`,
                  top: `${v.hit.y * geom.scale}px`,
                  width: `${v.hit.w * geom.scale}px`,
                  height: `${v.hit.h * geom.scale}px`,
                }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? -1 : h))}
              />
            )}

            <article
              className="lr-plaque"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? -1 : h))}
            >
              <div className="lr-board">
                <div className="lr-head">
                  <span className="lr-leg" aria-hidden="true">
                    {ROMAN[i]}
                  </span>
                  <h3>
                    <a href={p.href} onFocus={() => setHover(i)} onBlur={() => setHover(-1)}>
                      {p.title}
                    </a>
                  </h3>
                  {p.featured && (
                    <span className="lr-beacon" title="Beacon lit — a featured project">
                      beacon
                    </span>
                  )}
                </div>
                <p className="lr-place">
                  {tier.label} · {fmtLoc(p.loc)} lines
                </p>
                <p className="lr-summary">{p.summary}</p>
                <ul className="lr-tech">
                  {p.tech.map((t) => (
                    <li key={t} title={`${t} → ${tradeName(tradeFor(t))}`}>
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="lr-foot">
                  <a className="lr-more" href={p.href}>
                    Walk in →
                  </a>
                  {p.status === 'public' && p.repo && (
                    <a className="lr-link" href={p.repo} target="_blank" rel="noopener">
                      Source ↗
                    </a>
                  )}
                  {p.demo && (
                    <a className="lr-link" href={p.demo} target="_blank" rel="noopener">
                      Live demo ↗
                    </a>
                  )}
                </div>
                <p className="lr-status">{STATUS_TEXT[p.status]}</p>
              </div>
            </article>
          </section>
        );
      })}
    </div>
  );
}
