import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import {
  slotAngle,
  type HoverCtx,
  type ModuleSpec,
} from './common';
import { GEM_COLORS } from '../../../data/islands';
import { Arm, BAY, CommandModule, ExpansionBay, ProjectModule } from './station';
import { Ferry, Keeper } from './drones';
import { Lighting, SpaceEnvironment } from './space';

export interface OrbitalProject {
  id: string;
  title: string;
  tech: string[];
  loc: number;
  featured: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* -------------------------------- layout ---------------------------------- */

/**
 * The expansion bay owns a slot a quarter-turn from slot 0, which always holds
 * the largest module: far enough that the big hull never hides the build site,
 * close enough that both are in frame at once.
 */
const BAY_SLOT = 2;
const slotFor = (i: number) => (i < BAY_SLOT ? i : i + 1);

/**
 * One docked module per project, hull radius ∝ cbrt(loc) so the largest repo
 * reads about 3.4× the smallest without swamping the frame. Modules take the
 * ring's slots in project order, skipping the bay's.
 */
function buildSpecs(projects: OrbitalProject[]): ModuleSpec[] {
  const maxLoc = Math.max(...projects.map((p) => p.loc), 1);
  return projects.map((p, i) => {
    const R = Math.max(0.5, 1.9 * (Math.cbrt(p.loc) / Math.cbrt(maxLoc)));
    const len = 2.4 * R;
    const cap = 0.55 * R;
    const radius = 5.9 + R * 1.5;
    return {
      id: p.id,
      title: p.title,
      tech: p.tech,
      loc: p.loc,
      featured: p.featured,
      index: i,
      R,
      len,
      cap,
      ang: slotAngle(slotFor(i)),
      radius,
      dy: [1.15, -1.35, 1.4, -1.0, 1.25, -1.45, 0.9][i % 7],
      inner: radius - len / 2 - cap,
      accent: GEM_COLORS[i % GEM_COLORS.length],
    };
  });
}

/* --------------------------------- scene ---------------------------------- */

/**
 * Framing. On wide screens the frustum slides left so the station sits in the
 * right two-thirds, clear of the hero copy; on portrait screens it slides up
 * instead, above the hero card. Either way the orbit target stays on the
 * station itself, so auto-rotate spins in place rather than swinging.
 */
function FrameOffset() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    const wide = size.width >= 900;
    cam.setViewOffset(
      size.width,
      size.height,
      wide ? -size.width * 0.09 : 0,
      wide ? 0 : size.height * 0.22,
      size.width,
      size.height
    );
    return () => cam.clearViewOffset();
  }, [camera, size]);
  return null;
}

/**
 * A tall viewport sees a much narrower slice of the world at a given distance,
 * so the whole rig backs off until the station still fits edge to edge.
 */
function viewport() {
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const h = typeof window === 'undefined' ? 900 : Math.max(1, window.innerHeight);
  const aspect = w / h;
  const k = Math.min(2.2, Math.max(1, Math.pow(1.6 / aspect, 0.75)));
  const dist = 33.6 * k;
  return {
    position: [9 * k, 16 * k, 28 * k] as [number, number, number],
    min: Math.max(11, dist * 0.36),
    max: Math.max(48, dist * 1.35),
  };
}

function Station({
  projects,
  view,
}: {
  projects: OrbitalProject[];
  view: ReturnType<typeof viewport>;
}) {
  const reduced = usePrefersReducedMotion();
  const specs = useMemo(() => buildSpecs(projects), [projects]);
  const hoverCtx = useRef<HoverCtx>({ hover: 0 }).current;
  const controlsRef = useRef<any>(null);
  const draggingRef = useRef(false);
  const coolRef = useRef(0);

  const bayAng = slotAngle(BAY_SLOT);
  const bayDest = useMemo(
    () => ({ ang: bayAng, radius: BAY.radius, dy: BAY.dy, R: BAY.R, accent: BAY.accent }),
    [bayAng]
  );

  // Idle auto-rotate, paused while the visitor is dragging or reading a label
  // and resumed a few seconds after the last interaction.
  useFrame((_, delta) => {
    const c = controlsRef.current;
    if (!c) return;
    const busy = draggingRef.current || hoverCtx.hover > 0;
    coolRef.current = busy ? 4 : Math.max(0, coolRef.current - delta);
    c.autoRotate = !reduced && !busy && coolRef.current <= 0;
  });

  return (
    <>
      <FrameOffset />
      <Lighting />
      <SpaceEnvironment reduced={reduced} />

      <CommandModule hoverCtx={hoverCtx} reduced={reduced} />
      {specs.map((s) => (
        <Arm key={`arm-${s.id}`} ang={s.ang} inner={s.inner} dy={s.dy} />
      ))}
      {specs.map((s) => (
        <ProjectModule key={s.id} spec={s} hoverCtx={hoverCtx} reduced={reduced} />
      ))}
      <ExpansionBay ang={bayAng} reduced={reduced} />

      {/* traffic: three ferries working the ring, one dedicated hauling hull
          plate out to the expansion bay, plus a pair of station-keepers */}
      <Ferry modules={specs} seed={1} reduced={reduced} />
      <Ferry modules={specs} seed={2} reduced={reduced} />
      <Ferry modules={specs} seed={3} reduced={reduced} />
      <Ferry modules={specs} seed={4} reduced={reduced} fixedDest={bayDest} />
      <Keeper modules={specs} seed={5} reduced={reduced} />
      <Keeper modules={specs} seed={6} reduced={reduced} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[0, 0.7, 0]}
        enablePan={false}
        enableZoom
        minDistance={view.min}
        maxDistance={view.max}
        minPolarAngle={0.32}
        maxPolarAngle={1.62}
        enableDamping
        dampingFactor={0.07}
        autoRotateSpeed={0.32}
        onStart={() => {
          draggingRef.current = true;
        }}
        onEnd={() => {
          draggingRef.current = false;
        }}
      />
    </>
  );
}

export default function OrbitalScene({ projects }: { projects: OrbitalProject[] }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const view = useMemo(viewport, []);

  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      setOk(!!(c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      setOk(false);
    }
  }, []);

  // No WebGL: the hero copy and the project list below carry the page on their
  // own, so render nothing rather than an error.
  if (!ok) return null;

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: view.position, fov: 42, near: 0.5, far: 400 }}
      gl={{ antialias: true }}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
    >
      <Station projects={projects} view={view} />
    </Canvas>
  );
}
