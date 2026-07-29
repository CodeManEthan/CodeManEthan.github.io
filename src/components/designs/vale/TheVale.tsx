/**
 * The Vale — the free-roam island.
 *
 * A pixel-art countryside on a plain 2D canvas: one village per project, roads
 * between them, carts on the roads, and an eighth site being staked out at the
 * frontier. Everything it draws comes from the plain `WorldState` object built
 * by `worldstate.ts`; this file only owns the camera, the input model and the
 * accessible overlay.
 *
 * Navigation is drag-to-pan plus a pixel minimap, with a zoom ladder that runs
 * from a fitted overview up to whole-number street-level magnifications so the
 * art never lands on a half pixel. The page must never lose vertical scroll: a
 * bare wheel scrolls the document, `touch-action: pan-y` keeps one-finger
 * vertical swipes on the page, and zooming is ctrl/⌘-wheel, the buttons, or the
 * keyboard.
 *
 * `prefers-reduced-motion` settles the simulation, drops the rAF loop entirely
 * and repaints only when the camera moves — which it then does in one jump.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TH, TW, shade } from './art';
import {
  buildScene,
  renderScene,
  settle,
  stepScene,
  stepSmoke,
  type Scene,
  type Smoke,
} from './scene';
import {
  fmtLoc,
  isoX,
  isoY,
  villageSize,
  type VillageState,
  type WorldState,
} from './worldstate';
import worldJson from '../../../data/world.json';

// The committed world.json is the single source of truth for everything the
// vale is; patching it (and only it) is how the world evolves between deploys.
const world = worldJson as unknown as WorldState;

interface Cam {
  cx: number;
  cy: number;
  zoom: number;
}

interface TipInfo {
  id: string;
  title: string;
  meta: string;
  tech: string;
  accent: string;
  href: string;
  cta: string;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Readout for the zoom pill. The fitted level is named, not numbered. */
const fmtZoom = (z: number, overview: number): string =>
  z <= overview + 1e-3 ? 'overview' : `${Math.round(z * 100) / 100}×`;

function metaFor(v: VillageState): string {
  if (v.kind === 'homestead') return 'the crossroads · smoke always on';
  if (v.kind === 'frontier') return 'surveyed · first frames up';
  return `${fmtLoc(v.loc)} lines · ${villageSize(v.loc)} · ${v.buildings.length} buildings`;
}

export default function TheVale() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [tip, setTip] = useState<TipInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [zoomLabel, setZoomLabel] = useState('overview');

  const sceneRef = useRef<Scene | null>(null);
  const camRef = useRef<Cam>({ cx: 0, cy: 0, zoom: 1 });
  const targetRef = useRef<Cam | null>(null);
  const ladderRef = useRef<number[]>([1]);
  const hoverRef = useRef<string | null>(null);
  const paintRef = useRef<() => void>(() => {});
  const reducedRef = useRef(false);
  const touchedRef = useRef<string | null>(null);

  const api = useRef<{
    vw: number;
    vh: number;
    overview: number;
    clampCam: (c: Cam) => Cam;
    paint: () => void;
    setZoomLabel: (s: string) => void;
  } | null>(null);


  /* ------------------------------ sizing ------------------------------ */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        prev && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: Math.max(1, r.width), h: Math.max(1, r.height) }
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------------------- scene + loop --------------------------- */
  useEffect(() => {
    if (!size || size.w < 2 || size.h < 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedRef.current = reduced;

    if (!sceneRef.current) {
      sceneRef.current = buildScene(world);
      if (reduced) settle(sceneRef.current);
      setReady(true);
    }
    const scene = sceneRef.current;

    const vw = Math.max(1, Math.round(size.w));
    const vh = Math.max(1, Math.round(size.h));
    canvas.width = vw;
    canvas.height = vh;
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
    ctx.imageSmoothingEnabled = false;

    /* ---- zoom ladder: fitted overview, then whole-pixel steps -------- */
    const c = world.content;
    const contentW = (c.u1 - c.u0) * (TW / 2);
    const contentH = (c.v1 - c.v0) * (TH / 2);
    const fit = Math.min(vw / contentW, vh / contentH);
    const overview = Math.min(1, fit);
    const ladder: number[] = [overview];
    let z = overview;
    while (z * 2 < 0.95) {
      z *= 2;
      ladder.push(z);
    }
    for (const step of [1, 2, 3]) {
      if (step > ladder[ladder.length - 1] * 1.12) ladder.push(step);
    }
    ladderRef.current = ladder;

    /* ---- camera helpers ---------------------------------------------- */
    const clampCam = (cam: Cam): Cam => {
      const wpx = vw / cam.zoom;
      const wpy = vh / cam.zoom;
      const lx = scene.x0;
      const rx = scene.x0 + scene.w;
      const ty = scene.y0;
      const by = scene.y0 + scene.h;
      cam.cx = wpx >= rx - lx ? (lx + rx) / 2 - wpx / 2 : clamp(cam.cx, lx, rx - wpx);
      cam.cy = wpy >= by - ty ? (ty + by) / 2 - wpy / 2 : clamp(cam.cy, ty, by - wpy);
      return cam;
    };

    // First run (or a resize that invalidates the fit): frame the whole vale.
    if (!camRef.current.cx && !camRef.current.cy) {
      const cx0 = c.u0 * (TW / 2);
      const cy0 = c.v0 * (TH / 2);
      camRef.current = {
        zoom: overview,
        cx: cx0 + contentW / 2 - vw / overview / 2,
        cy: cy0 + contentH / 2 - vh / overview / 2,
      };
      // Dev-only camera params, used by the screenshot harness.
      const q = new URLSearchParams(window.location.search);
      const qz = Number(q.get('zoom'));
      const qx = Number(q.get('cx'));
      const qy = Number(q.get('cy'));
      if (qz > 0) camRef.current.zoom = qz;
      if (q.has('cx') && isFinite(qx)) camRef.current.cx = qx - vw / camRef.current.zoom / 2;
      if (q.has('cy') && isFinite(qy)) camRef.current.cy = qy - vh / camRef.current.zoom / 2;
    }
    clampCam(camRef.current);

    setZoomLabel(fmtZoom(camRef.current.zoom, overview));

    /* ---- overlay positioning ------------------------------------------ */
    const placeOverlays = () => {
      const cam = camRef.current;
      const compact = cam.zoom < 0.62;
      for (const a of scene.anchors) {
        const el = labelRefs.current[a.id];
        if (!el) continue;
        const x = (a.bx - cam.cx) * cam.zoom;
        const y = (a.by - cam.cy) * cam.zoom;
        const w = a.bw * cam.zoom;
        const h = a.bh * cam.zoom;
        if (x + w < -60 || x > vw + 60 || y + h < -60 || y > vh + 60) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        el.style.width = `${Math.round(w)}px`;
        el.style.height = `${Math.round(h)}px`;
        el.dataset.compact = compact ? '1' : '0';
      }
      const t = tipRef.current;
      const hid = hoverRef.current;
      if (t && hid) {
        const a = scene.anchors.find((v) => v.id === hid);
        if (a) {
          const x = (isoX(a.village.gx, a.village.gy) - cam.cx) * cam.zoom;
          const y = (a.by - cam.cy) * cam.zoom;
          const below = y < 120;
          t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
          t.dataset.below = below ? '1' : '0';
        }
      }
    };

    /* ---- minimap ------------------------------------------------------- */
    const mini = miniRef.current;
    const mctx = mini ? mini.getContext('2d') : null;
    if (mini) {
      mini.width = scene.minimap.width;
      mini.height = scene.minimap.height;
      mini.style.width = `${scene.minimap.width}px`;
      mini.style.height = `${scene.minimap.height}px`;
    }
    const drawMini = () => {
      if (!mini || !mctx) return;
      const s = scene.minimap.width / scene.w;
      mctx.imageSmoothingEnabled = false;
      mctx.clearRect(0, 0, mini.width, mini.height);
      mctx.drawImage(scene.minimap, 0, 0);
      // travellers as moving specks, so the map is alive too
      for (const tr of scene.travelers) {
        const px = (isoX(tr.gx, tr.gy) - scene.x0) * s;
        const py = (isoY(tr.gx, tr.gy) - scene.y0) * s;
        mctx.fillStyle = '#ffffff';
        mctx.fillRect(Math.round(px), Math.round(py), 1, 1);
      }
      for (const a of scene.anchors) {
        const px = (isoX(a.village.gx, a.village.gy) - scene.x0) * s;
        const py = (isoY(a.village.gx, a.village.gy) - scene.y0) * s;
        const r = a.village.kind === 'homestead' ? 3 : 2;
        mctx.fillStyle = '#2c2740';
        mctx.fillRect(Math.round(px) - r - 1, Math.round(py) - r - 1, r * 2 + 3, r * 2 + 3);
        mctx.fillStyle = a.village.accent;
        mctx.fillRect(Math.round(px) - r, Math.round(py) - r, r * 2 + 1, r * 2 + 1);
        if (a.village.kind === 'frontier') {
          mctx.fillStyle = '#fffdf6';
          mctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
        }
      }
      // Viewport rectangle: dim what is off screen, then outline what is on.
      const cam = camRef.current;
      const vx = Math.max(0, Math.round((cam.cx - scene.x0) * s));
      const vy = Math.max(0, Math.round((cam.cy - scene.y0) * s));
      const vwm = Math.min(mini.width - vx, Math.round((vw / cam.zoom) * s));
      const vhm = Math.min(mini.height - vy, Math.round((vh / cam.zoom) * s));
      mctx.fillStyle = 'rgba(38, 34, 56, 0.42)';
      mctx.fillRect(0, 0, mini.width, vy);
      mctx.fillRect(0, vy + vhm, mini.width, mini.height - vy - vhm);
      mctx.fillRect(0, vy, vx, vhm);
      mctx.fillRect(vx + vwm, vy, mini.width - vx - vwm, vhm);
      mctx.fillStyle = '#fffdf6';
      mctx.fillRect(vx, vy, vwm, 1);
      mctx.fillRect(vx, vy + vhm - 1, vwm, 1);
      mctx.fillRect(vx, vy, 1, vhm);
      mctx.fillRect(vx + vwm - 1, vy, 1, vhm);
    };

    /* ---- painting ------------------------------------------------------ */
    const smoke: Smoke[] = [];
    const smokeClock = { t: 0 };
    let clock = 13;

    const paintOnce = () => {
      const cam = camRef.current;
      renderScene(
        ctx,
        scene,
        { cx: Math.round(cam.cx), cy: Math.round(cam.cy), zoom: cam.zoom, vw, vh },
        clock,
        smoke,
        hoverRef.current
      );
      placeOverlays();
      drawMini();
    };

    let pending = false;
    paintRef.current = () => {
      if (!reducedRef.current || pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        paintOnce();
      });
    };

    let raf = 0;
    let last = performance.now();

    const ease = (dt: number) => {
      const tgt = targetRef.current;
      if (!tgt) return;
      const cam = camRef.current;
      const k = 1 - Math.exp(-dt * 7.5);
      cam.zoom += (tgt.zoom - cam.zoom) * k;
      cam.cx += (tgt.cx - cam.cx) * k;
      cam.cy += (tgt.cy - cam.cy) * k;
      if (
        Math.abs(tgt.cx - cam.cx) < 0.6 &&
        Math.abs(tgt.cy - cam.cy) < 0.6 &&
        Math.abs(tgt.zoom - cam.zoom) < 0.004
      ) {
        camRef.current = { ...tgt };
        targetRef.current = null;
      }
      clampCam(camRef.current);
    };

    if (reduced) {
      // Give the chimneys a settled column of smoke, then paint one frame.
      for (let i = 0; i < 6; i++) stepSmoke(scene, smoke, 0.7, smokeClock);
      paintOnce();
    } else {
      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        clock += dt;
        stepScene(scene, dt);
        stepSmoke(scene, smoke, dt, smokeClock);
        ease(dt);
        paintOnce();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    /* ---- imperative camera API used by the handlers below -------------- */
    api.current = {
      vw,
      vh,
      overview,
      clampCam,
      paint: () => (reduced ? paintRef.current() : undefined),
      setZoomLabel,
    };

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [size, world]);

  // Both the village anchors and the tooltip mount on a render that happens
  // *after* the paint that should have placed them: `setReady` is called from
  // inside the scene effect, and `setTip` from a pointer handler that paints
  // before React commits. Neither would ever be positioned without a repaint on
  // the far side of the commit — visible only under `prefers-reduced-motion`,
  // where there is no loop to catch up a frame later.
  useEffect(() => {
    if (ready) paintRef.current();
  }, [ready, tip]);

  /* ------------------------------ camera ops --------------------------- */
  const goTo = useCallback((wx: number, wy: number, zoom?: number) => {
    const a = api.current;
    if (!a) return;
    const z = zoom ?? Math.max(camRef.current.zoom, 1);
    const next: Cam = { zoom: z, cx: wx - a.vw / z / 2, cy: wy - a.vh / z / 2 };
    a.clampCam(next);
    a.setZoomLabel(fmtZoom(z, a.overview));
    if (reducedRef.current) {
      camRef.current = next;
      targetRef.current = null;
      a.paint();
    } else {
      targetRef.current = next;
    }
  }, []);

  const goToVillage = useCallback(
    (id: string) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const a = scene.anchors.find((v) => v.id === id);
      if (!a) return;
      const cur = (targetRef.current ?? camRef.current).zoom;
      const ladder = ladderRef.current;
      // Land on a whole-pixel step, never on whatever float a glide was passing
      // through when the click arrived.
      const target = ladder.find((z) => z >= Math.max(1, cur) - 1e-4) ?? ladder[ladder.length - 1];
      goTo(isoX(a.village.gx, a.village.gy), isoY(a.village.gx, a.village.gy), target);
    },
    [goTo]
  );

  const stepZoom = useCallback(
    (dir: 1 | -1, anchorX?: number, anchorY?: number) => {
      const a = api.current;
      if (!a) return;
      const ladder = ladderRef.current;
      const cur = (targetRef.current ?? camRef.current).zoom;
      let i = 0;
      for (let k = 0; k < ladder.length; k++) if (ladder[k] <= cur + 1e-4) i = k;
      const next = ladder[clamp(i + dir, 0, ladder.length - 1)];
      if (Math.abs(next - cur) < 1e-4) return;
      const cam = targetRef.current ?? camRef.current;
      const ax = anchorX ?? a.vw / 2;
      const ay = anchorY ?? a.vh / 2;
      // Keep the world point under the cursor pinned across the zoom step.
      const wx = cam.cx + ax / cam.zoom;
      const wy = cam.cy + ay / cam.zoom;
      const nc: Cam = { zoom: next, cx: wx - ax / next, cy: wy - ay / next };
      a.clampCam(nc);
      a.setZoomLabel(fmtZoom(next, a.overview));
      if (reducedRef.current) {
        camRef.current = nc;
        targetRef.current = null;
        a.paint();
      } else {
        targetRef.current = nc;
      }
    },
    []
  );

  const fitAll = useCallback(() => {
    const a = api.current;
    const scene = sceneRef.current;
    if (!a || !scene) return;
    const c = world.content;
    const cw = (c.u1 - c.u0) * (TW / 2);
    const ch = (c.v1 - c.v0) * (TH / 2);
    const wx = c.u0 * (TW / 2) + cw / 2;
    const wy = c.v0 * (TH / 2) + ch / 2;
    goTo(wx, wy, a.overview);
  }, [goTo, world]);

  /* ------------------------------- input ------------------------------- */
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchBase = useRef(0);

  const pinchSpan = () => {
    const pts = [...pinch.current.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size > 1) {
      drag.current = null;
      pinchBase.current = pinchSpan();
      return;
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const a = api.current;
    if (!a) return;
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size > 1) {
      const span = pinchSpan();
      if (pinchBase.current > 8 && span > 8) {
        const ratio = span / pinchBase.current;
        if (ratio > 1.35) {
          stepZoom(1);
          pinchBase.current = span;
        } else if (ratio < 0.74) {
          stepZoom(-1);
          pinchBase.current = span;
        }
      }
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.moved > 4) {
      const cam = camRef.current;
      targetRef.current = null;
      cam.cx -= dx / cam.zoom;
      cam.cy -= dy / cam.zoom;
      a.clampCam(cam);
      a.paint();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  }, [stepZoom]);

  const endPointer = useCallback((e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId);
    if (drag.current && drag.current.id === e.pointerId) {
      window.setTimeout(() => {
        if (drag.current && drag.current.id === e.pointerId) drag.current = null;
      }, 0);
    }
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (drag.current && drag.current.moved > 6) {
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
    }
  }, []);

  // React registers `wheel` as passive, so the ctrl-wheel zoom needs its own
  // non-passive listener. A bare wheel is left alone: it belongs to the page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      stepZoom(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stepZoom]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const a = api.current;
      if (!a) return;
      const cam = camRef.current;
      const step = 90 / cam.zoom;
      let handled = true;
      if (e.key === 'ArrowLeft') cam.cx -= step;
      else if (e.key === 'ArrowRight') cam.cx += step;
      else if (e.key === 'ArrowUp') cam.cy -= step;
      else if (e.key === 'ArrowDown') cam.cy += step;
      else if (e.key === '+' || e.key === '=') stepZoom(1);
      else if (e.key === '-' || e.key === '_') stepZoom(-1);
      else if (e.key === '0') fitAll();
      else handled = false;
      if (!handled) return;
      e.preventDefault();
      targetRef.current = null;
      a.clampCam(cam);
      a.paint();
    },
    [stepZoom, fitAll]
  );

  const onMiniClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const s = scene.w / scene.minimap.width;
      const wx = scene.x0 + (e.clientX - rect.left) * s;
      const wy = scene.y0 + (e.clientY - rect.top) * s;
      // Snap to a village if the click landed near one.
      let best: string | null = null;
      let bd = 70;
      for (const a of scene.anchors) {
        const d = Math.hypot(isoX(a.village.gx, a.village.gy) - wx, (isoY(a.village.gx, a.village.gy) - wy) * 2);
        if (d < bd) {
          bd = d;
          best = a.id;
        }
      }
      if (best) goToVillage(best);
      else goTo(wx, wy, camRef.current.zoom);
    },
    [goTo, goToVillage]
  );

  /* ------------------------------- hovering ---------------------------- */
  const setHover = useCallback(
    (v: VillageState | null) => {
      hoverRef.current = v ? v.id : null;
      if (!v) touchedRef.current = null;
      setTip(
        v
          ? {
              id: v.id,
              title: v.name,
              meta: metaFor(v),
              tech: v.tech.slice(0, 4).join(' · '),
              accent: v.accent,
              href: v.href,
              cta: v.kind === 'project' ? 'Open project →' : v.kind === 'frontier' ? 'What lands here →' : 'About Ethan →',
            }
          : null
      );
      api.current?.paint();
    },
    []
  );

  const onVillageClick = useCallback(
    (e: React.MouseEvent, v: VillageState) => {
      if (drag.current && drag.current.moved > 6) return;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      if (coarse && touchedRef.current !== v.id) {
        e.preventDefault();
        touchedRef.current = v.id;
        setHover(v);
        goToVillage(v.id);
      }
    },
    [goToVillage, setHover]
  );

  const anchors = sceneRef.current?.anchors ?? [];

  return (
    <div
      className="vl-wrap"
      ref={wrapRef}
      data-zoom={zoomLabel === 'overview' ? 'fit' : 'in'}
      tabIndex={0}
      role="group"
      aria-label="Map of the vale. Arrow keys pan, plus and minus zoom, 0 fits the whole vale."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="vl-canvas" aria-hidden="true" />

      <div className="vl-hits">
        {ready &&
          anchors.map((a) => {
            const v = a.village;
            return (
              <a
                key={a.id}
                ref={(el) => {
                  labelRefs.current[a.id] = el;
                }}
                className={`vl-hit vl-${v.kind}`}
                href={v.href}
                draggable={false}
                style={{ '--gem': v.accent } as React.CSSProperties}
                onMouseEnter={() => setHover(v)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => {
                  setHover(v);
                  goToVillage(v.id);
                }}
                onBlur={() => setHover(null)}
                onClick={(e) => onVillageClick(e, v)}
              >
                <span className="vl-pill" aria-hidden="true">
                  <i style={{ background: v.accent }} />
                  <b>{v.name}</b>
                </span>
                <span className="vl-sr">
                  {v.name}
                  {v.kind === 'project'
                    ? ` — ${fmtLoc(v.loc)} lines, ${villageSize(v.loc)} of ${v.buildings.length} buildings`
                    : v.kind === 'frontier'
                      ? ' — the eighth site, being founded'
                      : ' — Ethan’s homestead at the crossroads'}
                </span>
              </a>
            );
          })}
      </div>

      {tip && (
        <div
          className="vl-tip"
          ref={tipRef}
          style={{ borderColor: tip.accent }}
          role="presentation"
        >
          <strong style={{ color: shade(tip.accent, -0.42) }}>{tip.title}</strong>
          <span className="vl-tip-meta">{tip.meta}</span>
          {tip.tech && <span className="vl-tip-tech">{tip.tech}</span>}
          <span className="vl-tip-cta">{tip.cta}</span>
        </div>
      )}

      {/* Controls and minimap share one corner stack so neither can ever sit on
          top of the other, whatever aspect ratio the minimap ends up with. */}
      <div className="vl-corner">
        <div className="vl-controls">
          <button type="button" onClick={() => stepZoom(1)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => stepZoom(-1)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="vl-fit" onClick={fitAll}>
            Fit
          </button>
          <span className="vl-zoomread">{zoomLabel}</span>
        </div>

        <div className="vl-mini">
          <canvas
            ref={miniRef}
            onClick={onMiniClick}
            aria-hidden="true"
            title="Click the map to travel"
          />
          <span className="vl-mini-cap">The Vale · click to travel</span>
        </div>
      </div>

      <p className="vl-hint" aria-hidden="true">
        drag to roam · ⌘/ctrl + scroll or ± to zoom · click a village to open it
      </p>
    </div>
  );
}
