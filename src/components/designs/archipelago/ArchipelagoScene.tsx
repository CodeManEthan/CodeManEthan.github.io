import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  GEO,
  MAT,
  GEM_COLORS,
  fmtLoc,
  islandBob,
  mulberry32,
  type IslandSpec,
} from './common';
import { Bot, BuildSite, Traveler, type WorkCtx } from './inhabitants';

export interface ArchipelagoProject {
  id: string;
  title: string;
  loc: number;
  featured: boolean;
}

function usePrefersReducedMotion() {
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

/* -------------------------------- layout -------------------------------- */

/**
 * One island per project, scale ∝ cbrt(loc) so the largest repo reads about
 * 3.4× the smallest. Loose ring, radius nudged by size, staggered heights.
 */
function buildSpecs(projects: ArchipelagoProject[]): IslandSpec[] {
  const maxLoc = Math.max(...projects.map((p) => p.loc), 1);
  const n = projects.length;
  return projects.map((p, i) => {
    const S = Math.max(0.62, 2.2 * (Math.cbrt(p.loc) / Math.cbrt(maxLoc)));
    const ang = (i / n) * Math.PI * 2 + 0.4;
    const radius = 5.6 + S * 0.9 + (i % 2) * 0.7;
    const bots = p.loc >= 40000 ? 4 : p.loc >= 18000 ? 3 : p.loc >= 8000 ? 2 : 1;
    return {
      id: p.id,
      title: p.title,
      loc: p.loc,
      featured: p.featured,
      index: i,
      S,
      x: Math.cos(ang) * radius,
      y: Math.sin(i * 2.7) * 0.7,
      z: Math.sin(ang) * radius,
      accent: GEM_COLORS[i % GEM_COLORS.length],
      bots,
      walkR: S * 0.66,
      siteX: S * 0.45,
      siteZ: S * 0.28,
      siteScale: Math.min(1.1, Math.max(0.55, 0.45 + S * 0.28)),
    };
  });
}

/* --------------------------------- props --------------------------------- */

function Tree({
  x,
  z,
  scale,
  rot,
  mat,
  layers,
}: {
  x: number;
  z: number;
  scale: number;
  rot: number;
  mat: THREE.Material;
  layers: number;
}) {
  return (
    <group position={[x, 0, z]} scale={scale} rotation={[0, rot, 0]}>
      <mesh geometry={GEO.trunk} material={MAT.trunk} position={[0, 0.22, 0]} castShadow />
      <mesh geometry={GEO.cone0} material={mat} position={[0, 0.62, 0]} castShadow />
      {layers > 1 && (
        <mesh geometry={GEO.cone1} material={mat} position={[0, 1.02, 0]} castShadow />
      )}
      {layers > 2 && (
        <mesh geometry={GEO.cone2} material={mat} position={[0, 1.42, 0]} castShadow />
      )}
    </group>
  );
}

function House({
  position,
  rotation = 0,
  scale = 1,
}: {
  position: [number, number, number];
  rotation?: number;
  scale?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.68, 0.78]} />
        <meshStandardMaterial color="#fdf2de" flatShading roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.94, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.78, 0.52, 4]} />
        <meshStandardMaterial color="#ec8a6f" flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0.28, 1.02, 0.16]} castShadow>
        <boxGeometry args={[0.14, 0.34, 0.14]} />
        <meshStandardMaterial color="#c98a72" flatShading />
      </mesh>
      <mesh position={[0, 0.22, 0.4]}>
        <boxGeometry args={[0.22, 0.36, 0.04]} />
        <meshStandardMaterial color="#a1745b" flatShading />
      </mesh>
      <mesh position={[0.26, 0.42, 0.4]}>
        <boxGeometry args={[0.16, 0.16, 0.04]} />
        <meshStandardMaterial
          color="#bfe3f2"
          emissive="#ffdf9e"
          emissiveIntensity={0.35}
          flatShading
        />
      </mesh>
    </group>
  );
}

/* --------------------------------- island -------------------------------- */

interface DecoTree {
  x: number;
  z: number;
  s: number;
  rot: number;
  mat: THREE.Material;
  layers: number;
}
interface DecoRock {
  x: number;
  z: number;
  s: number;
  seed: number;
  mat: THREE.Material;
}
interface DecoTuft {
  x: number;
  z: number;
  s: number;
}

const labelStyle: CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '1px',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  color: '#43405a',
  background: 'rgba(255, 255, 255, 0.94)',
  border: '1px solid rgba(67, 64, 90, 0.12)',
  borderRadius: '14px',
  padding: '7px 15px',
  boxShadow: '0 6px 18px rgba(67, 64, 90, 0.18)',
  textAlign: 'center',
};

const labelTitleStyle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 750,
  lineHeight: 1.25,
};

const labelSubStyle: CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 600,
  color: '#7a7690',
  lineHeight: 1.3,
};

/** Shared hover bookkeeping so the scene can pause auto-rotate. */
interface HoverCtx {
  hover: number;
}

function Island({
  spec,
  reduced,
  hoverCtx,
}: {
  spec: IslandSpec;
  reduced: boolean;
  hoverCtx: HoverCtx;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const crystalRef = useRef<THREE.Group>(null);
  const liftRef = useRef(0);
  const [hovered, setHovered] = useState(false);
  const workCtx = useRef<WorkCtx>({ workers: 0 }).current;

  const { S } = spec;
  const gemScale = 0.5 + S * 0.28;
  const crystalX = -0.3 * S;
  const crystalZ = -0.25 * S;
  const crystalY = 0.36 + 0.38 * gemScale;

  // Per-island materials so hover can brighten this island only.
  const grassMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#8fd08c',
        flatShading: true,
        roughness: 0.95,
        emissive: '#fff3d6',
        emissiveIntensity: 0,
      }),
    []
  );
  const accentMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.accent,
        flatShading: true,
        roughness: 0.6,
      }),
    [spec.accent]
  );
  const crystalMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.accent,
        emissive: spec.accent,
        emissiveIntensity: 0.16,
        flatShading: true,
        roughness: 0.35,
        metalness: 0.05,
      }),
    [spec.accent]
  );

  // Deterministic decoration layout; density scales with island size.
  const deco = useMemo(() => {
    const rng = mulberry32(97 + spec.index * 131);
    const trees: DecoTree[] = [];
    const rocks: DecoRock[] = [];
    const tufts: DecoTuft[] = [];
    const nTrees = S >= 2 ? 4 : S >= 1.4 ? 3 : S >= 0.95 ? 2 : 1;
    for (let i = 0; i < nTrees; i++) {
      // Keep to the back arc, away from the build site (front-right).
      const a = 1.7 + ((i + 0.5) / nTrees) * 3.6 + (rng() - 0.5) * 0.5;
      const r = (0.5 + rng() * 0.28) * S;
      const pink = S >= 1.4 && i === nTrees - 1 && rng() < 0.6;
      trees.push({
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        s: (0.52 + S * 0.18) * (0.85 + rng() * 0.3),
        rot: rng() * Math.PI * 2,
        mat: pink ? MAT.foliagePink : MAT.foliage[Math.floor(rng() * 3)],
        layers: S >= 1.4 && i === 0 ? 3 : 2,
      });
    }
    const nRocks = Math.max(1, Math.round(S));
    for (let i = 0; i < nRocks; i++) {
      const a = rng() * Math.PI * 2;
      const r = (0.72 + rng() * 0.18) * S;
      rocks.push({
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        s: (0.45 + rng() * 0.45) * (0.6 + S * 0.2),
        seed: 1 + rng() * 4,
        mat: rng() < 0.5 ? MAT.rock : MAT.rock2,
      });
    }
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2;
      const r = (0.2 + rng() * 0.55) * S;
      tufts.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, s: 0.7 + rng() * 0.5 });
    }
    return { trees, rocks, tufts };
  }, [spec.index, S]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = 'pointer';
      hoverCtx.hover += 1;
      return () => {
        document.body.style.cursor = 'auto';
        hoverCtx.hover -= 1;
      };
    }
  }, [hovered, hoverCtx]);

  useFrame((state, delta) => {
    const g = rootRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    liftRef.current = THREE.MathUtils.lerp(
      liftRef.current,
      hovered ? 0.28 : 0,
      Math.min(1, delta * 6)
    );
    const bob = reduced ? 0 : islandBob(t, spec.index);
    g.position.y = spec.y + bob + liftRef.current;
    g.rotation.z = reduced ? 0 : Math.sin(t * 0.4 + spec.index) * 0.012;
    const c = crystalRef.current;
    if (c && !reduced) {
      c.rotation.y += delta * 0.7;
      c.position.y = crystalY + Math.sin(t * 1.4 + spec.index * 2) * 0.05;
    }
    crystalMat.emissiveIntensity = THREE.MathUtils.lerp(
      crystalMat.emissiveIntensity,
      hovered ? 0.85 : 0.16,
      0.12
    );
    grassMat.emissiveIntensity = THREE.MathUtils.lerp(
      grassMat.emissiveIntensity,
      hovered ? 0.22 : 0,
      0.12
    );
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Ignore "clicks" that were actually orbit drags.
    if (e.delta <= 6) window.location.assign(`/projects/${spec.id}/`);
  };

  return (
    <group ref={rootRef} position={[spec.x, spec.y, spec.z]}>
      {/* terrain (unit geometry scaled — top face stays at local y = 0) */}
      <group scale={S}>
        <mesh
          geometry={GEO.islandTop}
          material={grassMat}
          position={[0, -0.17, 0]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={GEO.islandBottom}
          material={MAT.dirt}
          position={[0, -0.79, 0]}
          rotation={[Math.PI, 0, 0]}
          castShadow
        />
        {S >= 1.3 && (
          <>
            <mesh
              geometry={GEO.shard}
              material={MAT.dirt}
              position={[0.55, -1.55, 0.25]}
              rotation={[0.4, 0.5, 0.2]}
              scale={0.7}
            />
            <mesh
              geometry={GEO.shard}
              material={MAT.dirt}
              position={[-0.4, -1.8, -0.2]}
              rotation={[0.8, 0.2, 0.5]}
              scale={0.5}
            />
          </>
        )}
      </group>

      {/* decoration */}
      {deco.trees.map((tr, i) => (
        <Tree key={`t${i}`} x={tr.x} z={tr.z} scale={tr.s} rot={tr.rot} mat={tr.mat} layers={tr.layers} />
      ))}
      {deco.rocks.map((r, i) => (
        <mesh
          key={`r${i}`}
          geometry={GEO.rock}
          material={r.mat}
          position={[r.x, 0.05, r.z]}
          scale={[r.s, r.s * 0.7, r.s]}
          rotation={[r.seed * 0.7, r.seed * 1.3, r.seed * 0.4]}
          castShadow
          receiveShadow
        />
      ))}
      {deco.tufts.map((tf, i) => (
        <mesh
          key={`g${i}`}
          geometry={GEO.tuft}
          material={MAT.foliage[i % 3]}
          position={[tf.x, 0.09, tf.z]}
          scale={tf.s}
          castShadow
        />
      ))}
      {S >= 2 && (
        <House position={[-0.32 * S, 0, 0.5 * S]} rotation={0.55} scale={0.85} />
      )}

      {/* accent crystal — this island's identity */}
      <group position={[crystalX, 0, crystalZ]}>
        <mesh
          geometry={GEO.pedestal}
          material={MAT.stone}
          position={[0, 0.18, 0]}
          castShadow
          receiveShadow
        />
        <group ref={crystalRef} position={[0, crystalY, 0]} scale={gemScale}>
          <mesh geometry={GEO.gem} material={crystalMat} castShadow />
        </group>
      </group>

      {/* accent banner on the larger islands */}
      {S >= 1.3 && (
        <group position={[0.15 * S, 0, -0.55 * S]}>
          <mesh geometry={GEO.pole} material={MAT.trunk} position={[0, 0.47, 0]} castShadow />
          <mesh geometry={GEO.flag} material={accentMat} position={[0.17, 0.8, 0]} castShadow />
        </group>
      )}

      {/* build site + resident bots */}
      <BuildSite spec={spec} ctx={workCtx} reduced={reduced} />
      {Array.from({ length: spec.bots }, (_, k) => (
        <Bot
          key={k}
          spec={spec}
          ctx={workCtx}
          accentMat={accentMat}
          seed={spec.index * 31 + k * 7 + 1}
          reduced={reduced}
        />
      ))}

      {/* invisible hit-sphere: easy hover/click even when zoomed far out */}
      <mesh
        geometry={GEO.hit}
        scale={S * 1.35}
        position={[0, S * 0.35, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {hovered && (
        <Html
          center
          position={[0, S * 0.85 + 1.05, 0]}
          distanceFactor={12}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={labelStyle}>
            <span style={labelTitleStyle}>
              {spec.featured ? '★ ' : ''}
              {spec.title}
            </span>
            <span style={labelSubStyle}>
              {fmtLoc(spec.loc)} lines · click to visit
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

/* --------------------------------- clouds -------------------------------- */

function Cloud({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh geometry={GEO.cloudPuff} material={MAT.cloud} scale={[1, 0.55, 0.8]} />
      <mesh
        geometry={GEO.cloudPuff}
        material={MAT.cloud}
        position={[0.52, -0.06, 0.08]}
        scale={[0.7, 0.4, 0.6]}
      />
      <mesh
        geometry={GEO.cloudPuff}
        material={MAT.cloud}
        position={[-0.5, -0.08, -0.06]}
        scale={[0.6, 0.36, 0.55]}
      />
    </group>
  );
}

function Clouds({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.y += delta * 0.015;
  });
  return (
    <group ref={ref}>
      <Cloud position={[6.5, 3.2, -3]} />
      <Cloud position={[-7, 2.6, 2.5]} scale={0.85} />
      <Cloud position={[3.5, 4.1, 6]} scale={0.7} />
      <Cloud position={[-4, 3.6, -6.5]} scale={0.95} />
      <Cloud position={[0.5, 2.9, -8.5]} scale={0.6} />
      <Cloud position={[8.2, 1.9, 4]} scale={0.75} />
      <Cloud position={[-8.5, 4.2, -1]} scale={0.7} />
      <Cloud position={[1.5, -2.6, 3.5]} scale={0.65} />
    </group>
  );
}

/* --------------------------------- scene ---------------------------------- */

function Scene({ projects }: { projects: ArchipelagoProject[] }) {
  const reduced = usePrefersReducedMotion();
  const specs = useMemo(() => buildSpecs(projects), [projects]);
  const hoverCtx = useRef<HoverCtx>({ hover: 0 }).current;
  const controlsRef = useRef<any>(null);
  const draggingRef = useRef(false);
  const coolRef = useRef(0);

  // Slow auto-rotate when idle; pause while dragging/zooming or hovering an
  // island, resume a few seconds after the last interaction.
  useFrame((_, delta) => {
    const c = controlsRef.current;
    if (!c) return;
    const busy = draggingRef.current || hoverCtx.hover > 0;
    coolRef.current = busy ? 5 : Math.max(0, coolRef.current - delta);
    c.autoRotate = !reduced && !busy && coolRef.current <= 0;
  });

  return (
    <>
      <ambientLight intensity={0.55} color="#fff6ea" />
      <hemisphereLight args={['#cfe8f5', '#ffe6c9', 0.6]} />
      <directionalLight
        position={[8, 13, 6]}
        intensity={1.7}
        color="#ffe9cf"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={35}
        shadow-bias={-0.0004}
      />

      {specs.map((s) => (
        <Island key={s.id} spec={s} reduced={reduced} hoverCtx={hoverCtx} />
      ))}
      <Traveler islands={specs} reduced={reduced} />
      <Clouds reduced={reduced} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[0, 0.2, 0]}
        enablePan={false}
        enableZoom
        minDistance={5}
        maxDistance={28}
        minPolarAngle={0.55}
        maxPolarAngle={1.45}
        enableDamping
        dampingFactor={0.08}
        autoRotateSpeed={0.45}
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

export default function ArchipelagoScene({
  projects,
}: {
  projects: ArchipelagoProject[];
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 7, 19], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
    >
      <Scene projects={projects} />
    </Canvas>
  );
}
