import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Line, useCursor } from '@react-three/drei';
import * as THREE from 'three';

export type ProjectNode = {
  id: string;
  title: string;
  featured: boolean;
};

/** Hand-placed positions forming an asymmetric constellation shape. */
const NODE_POSITIONS: [number, number, number][] = [
  [-2.6, 1.2, 0.3],
  [-0.7, 2.0, -0.6],
  [1.3, 1.4, 0.4],
  [2.8, 0.1, -0.3],
  [1.5, -1.4, 0.6],
  [-0.5, -1.9, -0.4],
  [-2.3, -0.7, 0.5],
];

/** Index pairs of nodes joined by constellation lines (chain + two chords). */
const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 0],
  [1, 6],
  [2, 4],
];

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function Starfield({ count = 1100 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tintA = new THREE.Color('#5eead4');
    const tintB = new THREE.Color('#818cf8');
    const white = new THREE.Color('#ffffff');
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Spherical shell surrounding both the constellation and the camera.
      const r = 9 + Math.random() * 9;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      const roll = Math.random();
      c.copy(roll < 0.08 ? tintA : roll < 0.16 ? tintB : white);
      c.multiplyScalar(0.35 + Math.random() * 0.65);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return [pos, col];
  }, [count]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ref.current) {
      ref.current.rotation.y = t * 0.008;
      ref.current.rotation.x = Math.sin(t * 0.02) * 0.03;
    }
    if (matRef.current) {
      // Gentle global shimmer.
      matRef.current.opacity = 0.8 + Math.sin(t * 0.6) * 0.12;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.07}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function StarNode({
  node,
  position,
  index,
  hoveredId,
  onHover,
  glowMap,
}: {
  node: ProjectNode;
  position: [number, number, number];
  index: number;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  glowMap: THREE.CanvasTexture;
}) {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Sprite>(null);
  const isHovered = hoveredId === node.id;
  useCursor(isHovered);

  const color = node.featured ? '#6ef3dc' : '#98a3ff';
  const baseScale = node.featured ? 1 : 0.68;

  useFrame((state) => {
    if (!group.current) return;
    const target = baseScale * (isHovered ? 1.55 : 1);
    const s = THREE.MathUtils.lerp(group.current.scale.x, target, 0.12);
    group.current.scale.setScalar(s);
    if (halo.current) {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 1.5 + index * 1.9) * 0.09;
      halo.current.scale.setScalar(2.4 * pulse);
      const mat = halo.current.material as THREE.SpriteMaterial;
      const targetOpacity = isHovered ? 0.95 : node.featured ? 0.6 : 0.38;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, 0.1);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Ignore "clicks" that were actually orbit drags.
    if (e.delta > 6) return;
    window.location.href = `/projects/${node.id}/`;
  };

  return (
    <group position={position}>
      <group ref={group}>
        {/* Core star */}
        <mesh>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {/* Soft halo */}
        <sprite ref={halo}>
          <spriteMaterial
            map={glowMap}
            color={color}
            transparent
            opacity={0.4}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
        {/* Larger invisible hit target for comfortable hovering */}
        <mesh
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover(node.id);
          }}
          onPointerOut={() => onHover(null)}
          onClick={handleClick}
        >
          <sphereGeometry args={[0.42, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {isHovered && (
        <Html position={[0, 0.55, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              whiteSpace: 'nowrap',
              padding: '0.5rem 0.85rem',
              borderRadius: '0.6rem',
              background: 'rgba(8, 12, 26, 0.82)',
              border: `1px solid ${node.featured ? 'rgba(110,243,220,0.45)' : 'rgba(152,163,255,0.45)'}`,
              boxShadow: `0 0 24px ${node.featured ? 'rgba(110,243,220,0.25)' : 'rgba(152,163,255,0.25)'}`,
              backdropFilter: 'blur(6px)',
              color: '#eef1ff',
              fontFamily:
                "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
              textAlign: 'center',
              transform: 'translateY(-4px)',
            }}
          >
            <div style={{ fontSize: '0.92rem', fontWeight: 650, letterSpacing: '0.02em' }}>
              {node.title}
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                marginTop: '0.15rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: node.featured ? '#6ef3dc' : '#98a3ff',
              }}
            >
              {node.featured ? 'Featured · ' : ''}Click to view
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Constellation({ nodes }: { nodes: ProjectNode[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const tiltGroup = useRef<THREE.Group>(null);
  const glowMap = useMemo(() => makeGlowTexture(), []);

  const positions = useMemo(
    () => nodes.map((_, i) => NODE_POSITIONS[i % NODE_POSITIONS.length]),
    [nodes]
  );

  const linkSegments = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (const [a, b] of LINKS) {
      if (a < nodes.length && b < nodes.length) {
        pts.push(positions[a], positions[b]);
      }
    }
    return pts;
  }, [nodes.length, positions]);

  useFrame((state) => {
    // Subtle parallax tilt following the pointer, layered under orbit control.
    if (tiltGroup.current) {
      tiltGroup.current.rotation.x = THREE.MathUtils.lerp(
        tiltGroup.current.rotation.x,
        state.pointer.y * 0.06,
        0.04
      );
      tiltGroup.current.rotation.y = THREE.MathUtils.lerp(
        tiltGroup.current.rotation.y,
        state.pointer.x * 0.08,
        0.04
      );
    }
  });

  return (
    <>
      <group ref={tiltGroup}>
        {linkSegments.length > 0 && (
          <Line
            points={linkSegments}
            segments
            color="#8f9bff"
            lineWidth={1}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        )}
        {nodes.map((node, i) => (
          <StarNode
            key={node.id}
            node={node}
            position={positions[i]}
            index={i}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            glowMap={glowMap}
          />
        ))}
      </group>
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate={hoveredId === null}
        autoRotateSpeed={0.55}
        rotateSpeed={0.55}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.28}
        maxPolarAngle={Math.PI * 0.72}
      />
    </>
  );
}

export default function ConstellationScene({ projects }: { projects: ProjectNode[] }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 7.4], fov: 50 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
    >
      <ambientLight intensity={0.5} />
      <Starfield />
      <Constellation nodes={projects} />
    </Canvas>
  );
}
