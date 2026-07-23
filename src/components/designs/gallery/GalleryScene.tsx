import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ScrollControls, useScroll, Text, Billboard, Stars } from '@react-three/drei';
import * as THREE from 'three';
import ProjectPanel from './ProjectPanel';

export interface GalleryProject {
  id: string;
  title: string;
  summary: string;
  tech: string[];
  featured: boolean;
  status: string;
}

const UP = new THREE.Vector3(0, 1, 0);

// Self-hosted font: drei's <Text font={FONT}> otherwise fetches its default font from a CDN
// at runtime and suspends the canvas until it resolves.
const FONT = '/fonts/LiberationSans-Regular.ttf';

function buildCurve(stops: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < stops; i++) {
    pts.push(
      new THREE.Vector3(Math.sin(i * 1.1) * 4.5, Math.cos(i * 0.75) * 1.4, -i * 9)
    );
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

function placeOnCurve(curve: THREE.CatmullRomCurve3, t: number, lateral: number, lift: number) {
  const pos = curve.getPointAt(t);
  const tan = curve.getTangentAt(t);
  const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
  const p = pos.clone().addScaledVector(side, lateral);
  p.y += lift;
  const approach = curve.getPointAt(Math.max(t - 0.06, 0));
  return {
    position: [p.x, p.y, p.z] as [number, number, number],
    approach: [approach.x, approach.y, approach.z] as [number, number, number],
  };
}

/* ---------- camera rig: scroll flies the camera along the path ---------- */

function Rig({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const scroll = useScroll();
  const keyLight = useRef<THREE.PointLight>(null);
  const accentLight = useRef<THREE.PointLight>(null);
  const v = useMemo(
    () => ({
      cam: new THREE.Vector3(),
      look: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      par: new THREE.Vector2(),
    }),
    []
  );

  useFrame((state, delta) => {
    const t = THREE.MathUtils.clamp(scroll.offset, 0, 1);
    curve.getPointAt(t, v.cam);
    if (t < 0.96) {
      curve.getPointAt(Math.min(t + 0.045, 1), v.look);
    } else {
      curve.getTangentAt(0.99, v.tan);
      curve.getPointAt(t, v.look).addScaledVector(v.tan, 4);
    }

    // Damped mouse parallax.
    v.par.lerp(state.pointer, 1 - Math.pow(0.001, delta));
    state.camera.position.set(
      v.cam.x + v.par.x * 0.55,
      v.cam.y + 0.15 + v.par.y * 0.35,
      v.cam.z
    );
    state.camera.lookAt(v.look);

    if (keyLight.current) keyLight.current.position.copy(state.camera.position);
    if (accentLight.current) {
      accentLight.current.position.set(v.look.x, v.look.y + 1.5, v.look.z);
    }
  });

  return (
    <>
      <pointLight ref={keyLight} intensity={50} distance={28} decay={2} color="#c4b5fd" />
      <pointLight ref={accentLight} intensity={35} distance={20} decay={2} color="#ec4899" />
    </>
  );
}

/* ---------- intro / outro cards ---------- */

function IntroCard({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const bob = useRef<THREE.Group>(null);
  const pos = useMemo(() => {
    const p = curve.getPointAt(0.05);
    const tan = curve.getTangentAt(0.05);
    const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
    return p.addScaledVector(side, -0.7).add(new THREE.Vector3(0, 0.25, 0));
  }, [curve]);

  useFrame((state) => {
    if (bob.current) {
      bob.current.position.y = Math.sin(state.clock.elapsedTime * 0.9) * 0.07;
    }
  });

  return (
    <Billboard position={[pos.x, pos.y, pos.z]}>
      <group ref={bob}>
        <Text font={FONT} fontSize={0.62} color="#f5f0ff" anchorX="center" anchorY="middle" position={[0, 0.35, 0]}>
          Ethan
        </Text>
        <Text font={FONT}
          fontSize={0.2}
          color="#67e8f9"
          letterSpacing={0.1}
          anchorX="center"
          anchorY="middle"
          position={[0, -0.22, 0]}
        >
          Software & Agentic Engineer
        </Text>
        <Text font={FONT} fontSize={0.15} color="#a78bfa" anchorX="center" anchorY="middle" position={[0, -0.85, 0]}>
          scroll to fly through the work ↓
        </Text>
      </group>
    </Billboard>
  );
}

function OutroCard({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const pos = useMemo(() => {
    const end = curve.getPointAt(1);
    const tan = curve.getTangentAt(1);
    return end.addScaledVector(tan, 4.5);
  }, [curve]);
  const [hovered, setHovered] = useState(false);

  return (
    <Billboard position={[pos.x, pos.y, pos.z]}>
      <Text font={FONT} fontSize={0.4} color="#f5f0ff" anchorX="center" anchorY="middle" position={[0, 0.3, 0]}>
        That's the tour.
      </Text>
      <Text font={FONT}
        fontSize={0.17}
        color={hovered ? '#f0abfc' : '#22d3ee'}
        anchorX="center"
        anchorY="middle"
        position={[0, -0.25, 0]}
        onClick={(e) => {
          e.stopPropagation();
          document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' });
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = '';
        }}
      >
        keep scrolling for the full list ↓
      </Text>
    </Billboard>
  );
}

/* ---------- floating wireframe decor ---------- */

function Decor({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const group = useRef<THREE.Group>(null);
  const items = useMemo(() => {
    const colors = ['#a855f7', '#22d3ee', '#ec4899'];
    return Array.from({ length: 14 }, (_, i) => {
      const t = 0.03 + Math.random() * 0.94;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      const p = pos
        .clone()
        .addScaledVector(side, (Math.random() > 0.5 ? 1 : -1) * (4.5 + Math.random() * 5))
        .add(new THREE.Vector3(0, (Math.random() - 0.5) * 6, 0));
      return {
        position: [p.x, p.y, p.z] as [number, number, number],
        scale: 0.4 + Math.random() * 0.9,
        speed: 0.1 + Math.random() * 0.3,
        color: colors[i % colors.length],
      };
    });
  }, [curve]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      c.rotation.x += delta * items[i].speed;
      c.rotation.y += delta * items[i].speed * 0.7;
    });
  });

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <mesh key={i} position={it.position} scale={it.scale}>
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={it.color} wireframe transparent opacity={0.22} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- scroll -> HUD bridge (must live inside ScrollControls) ---------- */

function ScrollReporter({
  onProgress,
  onEl,
}: {
  onProgress: (offset: number) => void;
  onEl: (el: HTMLDivElement) => void;
}) {
  const scroll = useScroll();
  useEffect(() => {
    if (scroll?.el) onEl(scroll.el);
  }, [scroll, onEl]);
  useFrame(() => onProgress(THREE.MathUtils.clamp(scroll.offset, 0, 1)));
  return null;
}

/* ---------- main export ---------- */

export default function GalleryScene({ projects }: { projects: GalleryProject[] }) {
  const [mode, setMode] = useState<'pending' | '3d' | 'flat'>('pending');
  const stops = projects.length + 2; // intro + projects + outro
  const curve = useMemo(() => buildCurve(stops), [stops]);

  const stopNames = useMemo(
    () => ['Intro', ...projects.map((p) => p.title), 'Full list'],
    [projects]
  );

  const placements = useMemo(
    () =>
      projects.map((_, j) => {
        const t = (j + 1) / (stops - 1);
        const lateral = (j % 2 === 0 ? 1 : -1) * 2.2;
        const lift = [0.2, -0.15, 0.3][j % 3];
        return placeOnCurve(curve, t, lateral, lift);
      }),
    [curve, projects, stops]
  );

  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastActive = useRef(-1);
  const scrollElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let webgl = false;
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      webgl = false;
    }
    setMode(reduced || !webgl ? 'flat' : '3d');
  }, []);

  const handleProgress = useCallback(
    (offset: number) => {
      if (barRef.current) barRef.current.style.transform = `scaleY(${offset})`;
      const idx = Math.min(stops - 1, Math.round(offset * (stops - 1)));
      if (idx === lastActive.current) return;
      lastActive.current = idx;
      if (labelRef.current) labelRef.current.textContent = stopNames[idx];
      dotRefs.current.forEach((d, i) => {
        if (!d) return;
        const active = i === idx;
        d.style.background = active ? '#e879f9' : 'rgba(167, 139, 250, 0.35)';
        d.style.transform = active ? 'scale(1.45)' : 'scale(1)';
        d.style.boxShadow = active ? '0 0 10px #e879f9' : 'none';
      });
    },
    [stops, stopNames]
  );

  const jumpTo = useCallback(
    (i: number) => {
      const el = scrollElRef.current;
      if (!el) return;
      el.scrollTo({
        top: (i / (stops - 1)) * (el.scrollHeight - el.clientHeight),
        behavior: 'smooth',
      });
    },
    [stops]
  );

  if (mode === 'pending') return null;

  if (mode === 'flat') {
    // No WebGL or reduced motion: simple static hero; the flat list below stays reachable.
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 7vw, 4rem)',
              background: 'linear-gradient(90deg, #a855f7, #ec4899, #22d3ee)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              marginBottom: '0.8rem',
            }}
          >
            Ethan
          </h1>
          <p style={{ color: '#beb3e6', fontSize: '1.15rem', marginBottom: '1.6rem' }}>
            Software &amp; Agentic Engineer
          </p>
          <a
            href="#projects"
            style={{
              color: '#22d3ee',
              border: '1px solid rgba(34, 211, 238, 0.4)',
              borderRadius: '999px',
              padding: '0.6rem 1.4rem',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            View projects ↓
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0.15, 2], fov: 60, near: 0.1, far: 220 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#0a0616']} />
        <fog attach="fog" args={['#0a0616', 6, 42]} />
        <ambientLight intensity={0.7} />
        <Stars radius={90} depth={60} count={2500} factor={4} saturation={0.6} fade speed={0.6} />
        <ScrollControls pages={stops} damping={0.22}>
          <ScrollReporter
            onProgress={handleProgress}
            onEl={(el) => (scrollElRef.current = el)}
          />
          <Rig curve={curve} />
          <Suspense fallback={null}>
            <IntroCard curve={curve} />
            {projects.map((p, j) => (
              <ProjectPanel
                key={p.id}
                project={p}
                index={j}
                position={placements[j].position}
                approach={placements[j].approach}
              />
            ))}
            <OutroCard curve={curve} />
          </Suspense>
          <Decor curve={curve} />
        </ScrollControls>
      </Canvas>

      {/* Progress HUD overlay */}
      <div
        style={{
          position: 'absolute',
          right: '1.1rem',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.7rem',
          zIndex: 10,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <div
          ref={labelRef}
          style={{
            color: '#beb3e6',
            fontSize: '0.72rem',
            letterSpacing: '0.06em',
            writingMode: 'vertical-rl',
            maxHeight: '11rem',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            opacity: 0.85,
          }}
        >
          Intro
        </div>
        <div
          style={{
            position: 'relative',
            width: '2px',
            height: '11rem',
            background: 'rgba(167, 139, 250, 0.18)',
            borderRadius: '2px',
          }}
        >
          <div
            ref={barRef}
            style={{
              position: 'absolute',
              inset: 0,
              transformOrigin: 'top',
              transform: 'scaleY(0)',
              background: 'linear-gradient(180deg, #a855f7, #ec4899, #22d3ee)',
              borderRadius: '2px',
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {stopNames.map((name, i) => (
            <button
              key={name + i}
              ref={(el) => {
                dotRefs.current[i] = el;
              }}
              onClick={() => jumpTo(i)}
              aria-label={`Fly to ${name}`}
              title={name}
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background: i === 0 ? '#e879f9' : 'rgba(167, 139, 250, 0.35)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                pointerEvents: 'auto',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
