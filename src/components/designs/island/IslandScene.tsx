import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';

export interface ProjectMarkerData {
  id: string;
  title: string;
  featured: boolean;
}

/** Pastel gem palette — index-matched to the card accents on the page. */
const GEM_COLORS = [
  '#ef7f93', // rose
  '#f5a25d', // apricot
  '#f0c75e', // honey
  '#6cc4d9', // sky
  '#9b8fe8', // lavender
  '#63c9a8', // mint
  '#e98fc3', // orchid
];

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

/* ---------------------------------- props --------------------------------- */

function Tree({
  position,
  scale = 1,
  rotation = 0,
  foliage = '#79c98c',
  layers = 2,
}: {
  position: [number, number, number];
  scale?: number;
  rotation?: number;
  foliage?: string;
  layers?: number;
}) {
  const cones = [];
  for (let i = 0; i < layers; i++) {
    const r = 0.46 - i * 0.12;
    const h = 0.62 - i * 0.1;
    const y = 0.62 + i * 0.4;
    cones.push(
      <mesh key={i} position={[0, y, 0]} castShadow>
        <coneGeometry args={[r, h, 7]} />
        <meshStandardMaterial color={foliage} flatShading roughness={0.85} />
      </mesh>
    );
  }
  return (
    <group position={position} scale={scale} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 0.45, 6]} />
        <meshStandardMaterial color="#9c6b4f" flatShading roughness={0.9} />
      </mesh>
      {cones}
    </group>
  );
}

function House({
  position,
  rotation = 0,
}: {
  position: [number, number, number];
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* body */}
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.68, 0.78]} />
        <meshStandardMaterial color="#fdf2de" flatShading roughness={0.9} />
      </mesh>
      {/* pyramid roof */}
      <mesh position={[0, 0.94, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.78, 0.52, 4]} />
        <meshStandardMaterial color="#ec8a6f" flatShading roughness={0.8} />
      </mesh>
      {/* chimney */}
      <mesh position={[0.28, 1.02, 0.16]} castShadow>
        <boxGeometry args={[0.14, 0.34, 0.14]} />
        <meshStandardMaterial color="#c98a72" flatShading />
      </mesh>
      {/* door */}
      <mesh position={[0, 0.22, 0.4]}>
        <boxGeometry args={[0.22, 0.36, 0.04]} />
        <meshStandardMaterial color="#a1745b" flatShading />
      </mesh>
      {/* window */}
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

function Rock({
  position,
  scale = 1,
  color = '#c9c2b4',
  seed = 0,
}: {
  position: [number, number, number];
  scale?: number;
  color?: string;
  seed?: number;
}) {
  return (
    <mesh
      position={position}
      scale={[scale, scale * 0.7, scale]}
      rotation={[seed * 0.7, seed * 1.3, seed * 0.4]}
      castShadow
      receiveShadow
    >
      <dodecahedronGeometry args={[0.22, 0]} />
      <meshStandardMaterial color={color} flatShading roughness={0.95} />
    </mesh>
  );
}

/* ------------------------------ project gems ------------------------------ */

function GemGeometry({ index }: { index: number }) {
  switch (index % 7) {
    case 0:
      return <octahedronGeometry args={[0.32, 0]} />;
    case 1:
      return <icosahedronGeometry args={[0.29, 0]} />;
    case 2:
      return <dodecahedronGeometry args={[0.28, 0]} />;
    case 3:
      return <coneGeometry args={[0.27, 0.52, 4]} />;
    case 4:
      return <tetrahedronGeometry args={[0.36, 0]} />;
    case 5:
      return <boxGeometry args={[0.36, 0.36, 0.36]} />;
    default:
      return <torusGeometry args={[0.22, 0.1, 6, 12]} />;
  }
}

const labelStyle: CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  fontSize: '14px',
  fontWeight: 650,
  color: '#43405a',
  background: 'rgba(255, 255, 255, 0.94)',
  border: '1px solid rgba(67, 64, 90, 0.12)',
  borderRadius: '999px',
  padding: '5px 13px',
  boxShadow: '0 6px 18px rgba(67, 64, 90, 0.18)',
};

function ProjectMarker({
  data,
  index,
  position,
  reduced,
}: {
  data: ProjectMarkerData;
  index: number;
  position: [number, number, number];
  reduced: boolean;
}) {
  const gemRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const color = GEM_COLORS[index % GEM_COLORS.length];
  const baseScale = data.featured ? 1.4 : 1;
  const pedestalH = data.featured ? 0.52 : 0.34;
  const restY = pedestalH + 0.55;

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = 'pointer';
      return () => {
        document.body.style.cursor = 'auto';
      };
    }
  }, [hovered]);

  useFrame((state, delta) => {
    const g = gemRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    if (reduced) {
      g.position.y = restY;
    } else {
      const speed = hovered ? 5.2 : 1.4;
      const amp = hovered ? 0.13 : 0.06;
      g.position.y = restY + Math.sin(t * speed + index * 1.7) * amp;
      g.rotation.y += delta * (hovered ? 2.4 : 0.5);
    }
    const target = hovered ? baseScale * 1.22 : baseScale;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, target, 0.14));
    if (matRef.current) {
      matRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        matRef.current.emissiveIntensity,
        hovered ? 0.85 : 0.16,
        0.14
      );
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Ignore "clicks" that were actually orbit drags.
    if (e.delta <= 6) window.location.assign(`/projects/${data.id}/`);
  };

  return (
    <group position={position}>
      {/* stone pedestal */}
      <mesh position={[0, pedestalH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.25, pedestalH, 6]} />
        <meshStandardMaterial color="#cfc8bb" flatShading roughness={0.9} />
      </mesh>
      {/* floating gem */}
      <group
        ref={gemRef}
        position={[0, restY, 0]}
        scale={baseScale}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      >
        <mesh castShadow>
          <GemGeometry index={index} />
          <meshStandardMaterial
            ref={matRef}
            color={color}
            emissive={color}
            emissiveIntensity={0.16}
            flatShading
            roughness={0.35}
            metalness={0.05}
          />
        </mesh>
        {hovered && (
          <Html
            center
            position={[0, 0.7, 0]}
            distanceFactor={8}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div style={labelStyle}>
              {data.featured ? '★ ' : ''}
              {data.title}
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

/* --------------------------------- island --------------------------------- */

function Island({
  projects,
  reduced,
}: {
  projects: ProjectMarkerData[];
  reduced: boolean;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ref.current) return;
    if (reduced) {
      ref.current.position.y = 0;
      ref.current.rotation.z = 0;
      return;
    }
    const t = state.clock.elapsedTime;
    ref.current.position.y = Math.sin(t * 0.6) * 0.12;
    ref.current.rotation.z = Math.sin(t * 0.4) * 0.018;
  });

  const n = projects.length;

  return (
    <group ref={ref}>
      {/* grass cap — top face sits at y = 0 */}
      <mesh position={[0, -0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[3, 2.6, 0.6, 9]} />
        <meshStandardMaterial color="#8fd08c" flatShading roughness={0.95} />
      </mesh>
      {/* dirt underside (inverted cone) */}
      <mesh position={[0, -1.6, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[2.6, 2, 9]} />
        <meshStandardMaterial color="#a97e5f" flatShading roughness={0.95} />
      </mesh>

      {/* floating rock shards below the island */}
      <mesh position={[1.5, -2.9, 0.7]} rotation={[0.4, 0.5, 0.2]} castShadow>
        <dodecahedronGeometry args={[0.3, 0]} />
        <meshStandardMaterial color="#b08a6b" flatShading roughness={0.95} />
      </mesh>
      <mesh position={[-1.2, -3.2, -0.5]} rotation={[0.8, 0.2, 0.5]} castShadow>
        <dodecahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color="#a97e5f" flatShading roughness={0.95} />
      </mesh>
      <mesh position={[-0.2, -3.7, 0.9]} rotation={[0.2, 1.1, 0.7]} castShadow>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#b08a6b" flatShading roughness={0.95} />
      </mesh>

      {/* tiny house */}
      <House position={[-0.85, 0, 0.55]} rotation={0.5} />

      {/* trees */}
      <Tree position={[1.25, 0, -0.95]} layers={3} scale={1.05} rotation={0.4} />
      <Tree position={[1.8, 0, -0.1]} layers={2} scale={0.8} foliage="#6bbd85" rotation={1.6} />
      <Tree position={[0.55, 0, -1.7]} layers={2} scale={0.9} foliage="#8fd49b" rotation={2.4} />
      <Tree position={[-1.8, 0, -0.85]} layers={2} scale={0.75} foliage="#eeaec6" rotation={3.1} />

      {/* rocks + grass tufts */}
      <Rock position={[0.2, 0.06, 1.6]} scale={0.9} seed={1} />
      <Rock position={[-1.5, 0.05, 1.5]} scale={0.6} seed={2} color="#d6cfc0" />
      <Rock position={[2.1, 0.05, 1.0]} scale={0.55} seed={3} />
      <mesh position={[0.9, 0.09, 0.9]} castShadow>
        <coneGeometry args={[0.09, 0.22, 5]} />
        <meshStandardMaterial color="#79c98c" flatShading />
      </mesh>
      <mesh position={[-0.1, 0.09, -1.1]} castShadow>
        <coneGeometry args={[0.08, 0.18, 5]} />
        <meshStandardMaterial color="#6bbd85" flatShading />
      </mesh>

      {/* one pedestal + gem per project, ringed around the island rim */}
      {projects.map((p, i) => {
        const angle = (i / n) * Math.PI * 2 + 0.55;
        const radius = 2.35;
        const pos: [number, number, number] = [
          Math.cos(angle) * radius,
          0,
          Math.sin(angle) * radius,
        ];
        return (
          <ProjectMarker
            key={p.id}
            data={p}
            index={i}
            position={pos}
            reduced={reduced}
          />
        );
      })}
    </group>
  );
}

/* --------------------------------- clouds --------------------------------- */

function Cloud({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh scale={[1, 0.55, 0.8]}>
        <sphereGeometry args={[0.55, 7, 5]} />
        <meshStandardMaterial color="#ffffff" flatShading transparent opacity={0.92} />
      </mesh>
      <mesh position={[0.52, -0.06, 0.08]} scale={[0.7, 0.4, 0.6]}>
        <sphereGeometry args={[0.55, 7, 5]} />
        <meshStandardMaterial color="#ffffff" flatShading transparent opacity={0.92} />
      </mesh>
      <mesh position={[-0.5, -0.08, -0.06]} scale={[0.6, 0.36, 0.55]}>
        <sphereGeometry args={[0.55, 7, 5]} />
        <meshStandardMaterial color="#fdfaf4" flatShading transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function Clouds({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.y += delta * 0.02;
  });
  return (
    <group ref={ref}>
      <Cloud position={[4.3, 2.1, -2]} />
      <Cloud position={[-4.6, 1.3, 1.6]} scale={0.85} />
      <Cloud position={[2.9, 3, 3.3]} scale={0.65} />
      <Cloud position={[-2.6, 2.7, -4.2]} scale={0.95} />
      <Cloud position={[0.5, -2.2, 4.8]} scale={0.7} />
    </group>
  );
}

/* --------------------------------- scene ---------------------------------- */

function Scene({ projects }: { projects: ProjectMarkerData[] }) {
  const reduced = usePrefersReducedMotion();
  return (
    <>
      <ambientLight intensity={0.55} color="#fff6ea" />
      <hemisphereLight args={['#cfe8f5', '#ffe6c9', 0.6]} />
      <directionalLight
        position={[6, 9, 4]}
        intensity={1.9}
        color="#ffe9cf"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={25}
        shadow-bias={-0.0004}
      />
      <Island projects={projects} reduced={reduced} />
      <Clouds reduced={reduced} />
      <OrbitControls
        makeDefault
        target={[0, 0.1, 0]}
        enablePan={false}
        enableZoom
        minDistance={6.5}
        maxDistance={13}
        minPolarAngle={0.9}
        maxPolarAngle={1.5}
        enableDamping
        dampingFactor={0.08}
        autoRotate={!reduced}
        autoRotateSpeed={0.6}
      />
    </>
  );
}

export default function IslandScene({
  projects,
}: {
  projects: ProjectMarkerData[];
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.5, 2.6, 9.5], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
    >
      <Scene projects={projects} />
    </Canvas>
  );
}
