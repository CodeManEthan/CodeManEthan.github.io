/**
 * Pixel Hamlet — the hero scene.
 *
 * A hand-rolled isometric pixel-art village on a plain 2D canvas: no WebGL, no
 * sprite sheets, no dependencies. Everything is rasterised at a fraction of the
 * viewport's resolution and upscaled by a whole number with
 * `image-rendering: pixelated`, which is what gives the art its hard pixel grid.
 *
 * Interaction lives in a layer of transparent anchors positioned over each
 * building, so hover, focus rings, Enter to activate and screen-reader labels
 * are all handled by the platform rather than re-implemented against the
 * canvas. `prefers-reduced-motion` settles the villager simulation and paints
 * exactly one frame — no rAF loop at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PAL,
  TH,
  TW,
  buildCloud,
  diamond,
  drawBot,
  isoTile,
  mulberry32,
  poly,
  rect,
  shade,
  type Sprite,
} from './world';
import {
  isoX,
  isoY,
  layoutVillage,
  stepBots,
  type Item,
  type ProjectInput,
  type Village,
} from './village';

interface Props {
  projects: ProjectInput[];
  /** Vertical space, in CSS pixels, kept clear at the top for the hero copy. */
  headroom?: number;
}

interface HitBox {
  id: string;
  title: string;
  tech: string[];
  loc: number;
  accent: string;
  href: string;
  status: string;
  construction: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor for the tooltip, in container CSS coords. */
  tipX: number;
  tipY: number;
  /** Flip the tooltip under the building when there's no room above. */
  tipBelow: boolean;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) =>
    Math.round((((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  const v = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return `#${(v | 0x1000000).toString(16).slice(1)}`;
}

function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
/** Mirrors `sizeLabel` from src/data/islands.ts, in building terms. */
function buildingSize(n: number): string {
  if (n >= 25000) return 'large building';
  if (n >= 10000) return 'mid-size building';
  if (n >= 3000) return 'small building';
  return 'tiny building';
}

interface Smoke {
  x: number;
  y: number;
  age: number;
  drift: number;
}

export default function PixelHamlet({ projects, headroom = 300 }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const villageRef = useRef<Village | null>(null);
  const [boxes, setBoxes] = useState<HitBox[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [shopTag, setShopTag] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const setHoverBoth = useCallback((id: string | null) => {
    hoverRef.current = id;
    setHover(id);
  }, []);

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

  /* ------------------------- the world, built once ------------------- */
  const inputs = useMemo(() => projects, [projects]);

  /* --------------------------- scene lifecycle ----------------------- */
  useEffect(() => {
    if (!size || size.w < 2 || size.h < 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Art pixels are 2 device-independent pixels across: big enough to read as
    // pixel art, small enough that the whole hamlet fits on one screen. On
    // phones we drop to 1:1 so more than a couple of buildings stay in frame.
    const SCALE = size.w < 760 ? 1 : 2;
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

    if (!villageRef.current) villageRef.current = layoutVillage(inputs);
    const V = villageRef.current;

    /* ---- fit the village into the space under the hero copy ---------
       The copy block is shorter on short viewports (see the page's
       max-height media query), so the reserved headroom follows it. When the
       village still won't fit, the overflow is shared between a little
       encroachment on the sky and a little crop of the foreground. */
    const headCss = size.h < 780 ? Math.max(170, headroom - 70) : headroom;
    const head = Math.min(ih * 0.46, headCss / SCALE);
    const band = ih - 6 - head;
    const worldH = V.bounds.b - V.bounds.t;
    const overflow = Math.max(0, worldH - band);
    const cx = Math.round(iw / 2 - (V.bounds.l + V.bounds.r) / 2);
    const cy = Math.round(
      head -
        V.bounds.t +
        (overflow > 0 ? -Math.min(overflow * 0.5, 36 / SCALE) : (band - worldH) * 0.7)
    );

    const minBaseSy = Math.min(...V.buildings.map((b) => b.sy));
    const horizon = Math.round(Math.max(24, cy + minBaseSy - 32));

    /* ---------------------------- sky layer -------------------------- */
    const sky = document.createElement('canvas');
    sky.width = iw;
    sky.height = ih;
    const sctx = sky.getContext('2d')!;
    sctx.imageSmoothingEnabled = false;
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const y0 = Math.round((horizon * i) / bands);
      const y1 = Math.round((horizon * (i + 1)) / bands);
      rect(sctx, 0, y0, iw, y1 - y0 + 1, mix(PAL.skyTop, PAL.skyLow, Math.pow(t, 1.35)));
    }
    // sun: a stepped disc, plus a soft halo ring
    const sunX = Math.round(iw * 0.78);
    const sunY = Math.round(horizon * 0.32);
    const disc = (r: number, color: string) => {
      for (let y = -r; y <= r; y++) {
        const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)) * 2);
        if (w > 0) rect(sctx, sunX - w / 2, sunY + y, w, 1, color);
      }
    };
    disc(17, mix(PAL.skyTop, PAL.sun, 0.32));
    disc(13, PAL.sun);
    disc(9, PAL.sunCore);

    /* ---------------------------- land layer ------------------------- */
    const land = document.createElement('canvas');
    land.width = iw;
    land.height = ih;
    const lctx = land.getContext('2d')!;
    lctx.imageSmoothingEnabled = false;

    const ridge = (
      base: number,
      amp: number,
      f1: number,
      f2: number,
      ph: number,
      color: string
    ) => {
      lctx.fillStyle = color;
      for (let x = 0; x < iw; x++) {
        const n =
          Math.sin(x * f1 + ph) * 0.6 + Math.sin(x * f2 + ph * 2.3) * 0.4;
        const y = Math.round(base - amp * (0.55 + 0.45 * n));
        lctx.fillRect(x, y, 1, horizon - y + 2);
      }
    };
    ridge(horizon, 30, 0.017, 0.041, 0.7, PAL.hillFar);
    ridge(horizon, 19, 0.026, 0.062, 2.9, PAL.hillNear);
    // forest edge
    ridge(horizon, 10, 0.09, 0.21, 1.4, PAL.treeline);
    ridge(horizon, 6, 0.16, 0.33, 4.1, PAL.treelineDark);
    // a few conifer tips breaking the line
    const trng = mulberry32(4242);
    for (let i = 0; i < 46; i++) {
      const x = Math.round(trng() * iw);
      const h = 6 + Math.round(trng() * 7);
      lctx.fillStyle = trng() < 0.5 ? PAL.treeline : PAL.treelineDark;
      for (let k = 0; k < h; k++) {
        const w = Math.max(1, Math.round(((k + 1) / h) * 7));
        lctx.fillRect(x - Math.floor(w / 2), horizon - h + k, w, 1);
      }
    }

    // meadow base
    rect(lctx, 0, horizon, iw, ih - horizon, PAL.grass[1]);

    /* ---- ground tiles + dirt lanes ---------------------------------- */
    const laneDist = (gx: number, gy: number): number => {
      let best = Infinity;
      for (const [ax, ay, bx, by] of V.lanes) {
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy || 1;
        let t = ((gx - ax) * vx + (gy - ay) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(gx - (ax + vx * t), gy - (ay + vy * t));
        if (d < best) best = d;
      }
      return best;
    };

    const uMin = Math.floor((-TW - cx) / (TW / 2)) - 2;
    const uMax = Math.ceil((iw + TW - cx) / (TW / 2)) + 2;
    const vMin = Math.floor((horizon - cy) / (TH / 2)) - 2;
    const vMax = Math.ceil((ih + TH - cy) / (TH / 2)) + 2;
    const grng = mulberry32(1337);
    for (let v = vMin; v <= vMax; v++) {
      for (let u = uMin; u <= uMax; u++) {
        if ((u + v) & 1) continue;
        const gx = (u + v) / 2;
        const gy = (v - u) / 2;
        const sx = cx + isoX(gx, gy);
        const sy = cy + isoY(gx, gy);
        if (sy < horizon + 4 || sy > ih + 10) continue;
        const d = laneDist(gx, gy);
        const h = (Math.imul(gx | 0, 374761393) ^ Math.imul(gy | 0, 668265263)) >>> 0;
        if (d < 0.46) {
          isoTile(lctx, sx, sy, h % 3 === 0 ? PAL.dirtAlt : PAL.dirt);
          if (h % 7 === 0) rect(lctx, sx - 3, sy - 1, 3, 1, PAL.dirtEdge);
          if (h % 11 === 0) rect(lctx, sx + 4, sy + 2, 2, 1, PAL.dirtEdge);
        } else if (d < 0.7) {
          isoTile(lctx, sx, sy, mix(PAL.dirt, PAL.grass[0], 0.55));
        } else {
          const n =
            Math.sin(gx * 0.31 + gy * 0.17) +
            Math.sin(gx * 0.11 - gy * 0.28) +
            Math.sin((gx + gy) * 0.22 + 1.7);
          const pal = n > 0.55 ? PAL.grassAlt : PAL.grass;
          isoTile(lctx, sx, sy, pal[h % pal.length]);
          const r = grng();
          if (r < 0.09) {
            rect(lctx, sx - 4, sy + 1, 2, 1, PAL.grassEdge);
            rect(lctx, sx + 2, sy - 2, 2, 1, PAL.grassEdge);
          } else if (r < 0.13) {
            rect(lctx, sx, sy - 1, 1, 2, PAL.leafDark);
            rect(lctx, sx, sy - 3, 1, 1, PAL.flower[(h >>> 3) % PAL.flower.length]);
          }
        }
      }
    }

    /* ------------------------------ clouds ---------------------------
       Counts scale with the canvas so a wide monitor doesn't get an empty
       sky and a phone doesn't get a traffic jam of clouds. */
    const cloudN = Math.max(4, Math.round(iw / 105));
    const clouds = Array.from({ length: cloudN }, (_, i) => ({
      sp: buildCloud(i * 17 + 3),
      x: (i * iw) / cloudN + 20,
      y: 10 + ((i * 53) % Math.max(12, horizon - 56)),
      v: 1.5 + (i % 4) * 0.6,
    }));

    const birdN = Math.max(3, Math.round(iw / 220));
    const birds = Array.from({ length: birdN }, (_, i) => ({
      x: iw * ((i * 0.23 + 0.15) % 1),
      y: horizon * (0.3 + ((i * 0.17) % 0.45)),
      v: 4 + (i % 3),
      ph: i * 1.7,
    }));

    /* ------------------------- interaction boxes --------------------- */
    const hits: HitBox[] = V.buildings
      .concat([V.workshop])
      .slice()
      .sort((a, b) => a.sy - b.sy)
      .map((b) => {
        const bw = b.sprite.c.width;
        const bh = b.sprite.c.height;
        const x0 = cx + b.sx - b.sprite.ox;
        const y0 = cy + b.sy - b.sprite.oy;
        const insetX = Math.round(bw * 0.16);
        const insetTop = Math.round(bh * 0.08);
        const topCss = offY + (y0 + insetTop) * SCALE;
        const botCss = offY + (y0 + bh - 6) * SCALE;
        // Tall buildings poke up behind the hero copy; drop their tooltip
        // underneath rather than let it collide with the headline.
        const tipBelow = topCss - 96 < headroom + 8;
        return {
          id: b.id,
          title: b.title,
          tech: b.tech,
          loc: b.loc,
          accent: b.accent,
          href: b.href,
          status: b.status,
          construction: b.construction,
          x: offX + (x0 + insetX) * SCALE,
          y: offY + (y0 + insetTop) * SCALE,
          w: (bw - insetX * 2) * SCALE,
          h: (bh - insetTop - 6) * SCALE,
          tipX: offX + (cx + b.sx) * SCALE,
          tipY: tipBelow ? botCss : topCss,
          tipBelow,
        };
      });
    setBoxes(hits);
    setShopTag({
      x: offX + (cx + V.workshop.sx) * SCALE,
      y: offY + (cy + V.workshop.sy + 22) * SCALE,
    });

    /* --------------------------- render loop ------------------------- */
    const sorted: Item[] = V.items
      .slice()
      .sort((a, b) => a.sy - b.sy || a.sx - b.sx)
      .filter((it) => cy + it.sy > horizon + 8);

    const smoke: Smoke[] = [];
    let smokeClock = 0;

    const drawSprite = (sp: Sprite, x: number, y: number) => {
      ctx.drawImage(sp.c, Math.round(x - sp.ox), Math.round(y - sp.oy));
    };

    const puffs = (t: number) => {
      for (const p of smoke) {
        const a = p.age;
        const r = 2 + a * 2.2;
        const col = a < 1 ? '#ffffff' : a < 2.4 ? '#f1ece2' : '#e4e0da';
        ctx.globalAlpha = Math.max(0, 1 - a / 3.6) * 0.85;
        const px = Math.round(cx + p.x + Math.sin(a * 1.7 + p.drift) * 3 + a * 2.2);
        const py = Math.round(cy + p.y - a * 9);
        ctx.fillStyle = col;
        for (let k = -Math.round(r); k <= Math.round(r); k++) {
          const w = Math.round(Math.sqrt(Math.max(0, r * r - k * k)) * 2);
          if (w > 0) ctx.fillRect(px - Math.round(w / 2), py + k, w, 1);
        }
        ctx.globalAlpha = 1;
      }
    };

    const render = (t: number) => {
      ctx.drawImage(sky, 0, 0);

      for (const c of clouds) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(c.sp.c, Math.round(c.x), Math.round(c.y));
        ctx.globalAlpha = 1;
      }
      for (const b of birds) {
        const y = Math.round(b.y + Math.sin(t * 0.9 + b.ph) * 4);
        const flap = Math.sin(t * 6 + b.ph) > 0 ? 0 : 1;
        ctx.fillStyle = 'rgba(74,66,96,0.6)';
        ctx.fillRect(Math.round(b.x) - 2, y - flap, 2, 1);
        ctx.fillRect(Math.round(b.x) + 1, y - flap, 2, 1);
        ctx.fillRect(Math.round(b.x), y, 1, 1);
      }

      ctx.drawImage(land, 0, 0);

      // Merge the static scenery with the moving villagers, back to front.
      const bots = V.bots
        .slice()
        .sort((a, b) => isoY(a.gx, a.gy) - isoY(b.gx, b.gy));
      let bi = 0;
      const hoverId = hoverRef.current;

      const drawItem = (it: Item) => {
        const x = cx + it.sx;
        const y = cy + it.sy;
        if (it.kind === 'building' && it.id === hoverId) {
          // Selection ring on the ground, then a white halo and a small hop.
          const fw = it.footprint * TW;
          poly(ctx, diamond(x, y + 2, fw + 20), 'rgba(255, 255, 255, 0.5)');
          poly(ctx, diamond(x, y + 2, fw + 8), shade(it.accent, 0.28));
          drawSprite(it.outline, x, y - 3);
          drawSprite(it.sprite, x, y - 3);
          return;
        }
        drawSprite(it.sprite, x, y);
        if (it.kind === 'crane') {
          // hook + swinging load
          const jibX = x + 20;
          const topY = y - 54; // jib height, matching buildCrane()
          const sway = Math.sin(t * 0.8) * 5;
          const drop = 26 + Math.sin(t * 0.55) * 9;
          ctx.fillStyle = PAL.ink;
          ctx.fillRect(Math.round(jibX + sway * 0.4), Math.round(topY), 1, Math.round(drop));
          const lx = Math.round(jibX + sway * 0.4) - 4;
          const ly = Math.round(topY + drop);
          ctx.fillStyle = PAL.woodLight;
          ctx.fillRect(lx, ly, 9, 6);
          ctx.fillStyle = PAL.wood;
          ctx.fillRect(lx, ly + 4, 9, 2);
          ctx.fillStyle = PAL.woodDark;
          ctx.fillRect(lx, ly, 9, 1);
        }
      };

      for (const it of sorted) {
        const iy = it.sy;
        while (bi < bots.length && isoY(bots[bi].gx, bots[bi].gy) <= iy) {
          const bot = bots[bi++];
          drawBot(
            ctx,
            cx + isoX(bot.gx, bot.gy),
            cy + isoY(bot.gx, bot.gy),
            bot.color,
            bot.faceRight,
            bot.action,
            bot.phase
          );
          if (bot.action === 'work' && Math.sin(bot.phase * 11) > 0.85) {
            const sx = cx + isoX(bot.gx, bot.gy) + (bot.faceRight ? 6 : -7);
            const sy = cy + isoY(bot.gx, bot.gy) - 12;
            ctx.fillStyle = '#fff3c4';
            ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
            ctx.fillRect(Math.round(sx) + 2, Math.round(sy) - 2, 1, 1);
            ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 3, 1, 1);
          }
        }
        drawItem(it);
      }
      while (bi < bots.length) {
        const bot = bots[bi++];
        drawBot(
          ctx,
          cx + isoX(bot.gx, bot.gy),
          cy + isoY(bot.gx, bot.gy),
          bot.color,
          bot.faceRight,
          bot.action,
          bot.phase
        );
      }

      puffs(t);
    };

    let raf = 0;
    let last = performance.now();
    let clock = 0;

    const advance = (dt: number) => {
      clock += dt;
      stepBots(V, dt);
      smokeClock += dt;
      if (smokeClock > 0.55) {
        smokeClock = 0;
        for (const s of V.smokers) {
          smoke.push({ x: s.x, y: s.y, age: 0, drift: Math.random() * 6 });
        }
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        smoke[i].age += dt;
        if (smoke[i].age > 3.6) smoke.splice(i, 1);
      }
      for (const c of clouds) {
        c.x += c.v * dt;
        if (c.x > iw + 10) c.x = -c.sp.c.width - 10;
      }
      for (const b of birds) {
        b.x += b.v * dt;
        if (b.x > iw + 8) b.x = -8;
      }
    };

    if (reduced) {
      // Settle the simulation, then paint a single frame.
      for (let i = 0; i < 260; i++) advance(1 / 20);
      render(13);
    } else {
      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        advance(dt);
        render(clock);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [size, inputs, headroom]);

  const hovered = boxes.find((b) => b.id === hover) ?? null;

  return (
    <div className="ph-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="ph-canvas" aria-hidden="true" />

      {shopTag && (
        <span className="ph-shoptag" style={{ left: shopTag.x, top: shopTag.y }}>
          Ethan&rsquo;s workshop
        </span>
      )}

      <div className="ph-hits">
        {boxes.map((b) =>
          b.id === '__ethan' ? (
            <a
              key={b.id}
              className="ph-hit"
              href={b.href}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
              onMouseEnter={() => setHoverBoth(b.id)}
              onMouseLeave={() => setHoverBoth(null)}
              onFocus={() => setHoverBoth(b.id)}
              onBlur={() => setHoverBoth(null)}
            >
              <span className="ph-sr">Ethan&rsquo;s workshop — about Ethan</span>
            </a>
          ) : (
            <a
              key={b.id}
              className="ph-hit"
              href={b.href}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
              onMouseEnter={() => setHoverBoth(b.id)}
              onMouseLeave={() => setHoverBoth(null)}
              onFocus={() => setHoverBoth(b.id)}
              onBlur={() => setHoverBoth(null)}
            >
              <span className="ph-sr">
                {b.title} — {fmtLoc(b.loc)} lines, {buildingSize(b.loc)}
                {b.construction ? ', under construction' : ''}
              </span>
            </a>
          )
        )}
      </div>

      {hovered && (
        <div
          className={hovered.tipBelow ? 'ph-tip ph-tip-below' : 'ph-tip'}
          style={{
            left: hovered.tipX,
            top: hovered.tipY,
            borderColor: hovered.accent,
          }}
        >
          <strong style={{ color: shade(hovered.accent, -0.35) }}>{hovered.title}</strong>
          {hovered.id === '__ethan' ? (
            <span className="ph-tip-meta">the keeper&rsquo;s cottage · smoke&rsquo;s always on</span>
          ) : (
            <span className="ph-tip-meta">
              {fmtLoc(hovered.loc)} lines · {buildingSize(hovered.loc)}
              {hovered.construction ? ' · under construction' : ''}
            </span>
          )}
          <span className="ph-tip-tech">{hovered.tech.slice(0, 4).join(' · ')}</span>
        </div>
      )}
    </div>
  );
}
