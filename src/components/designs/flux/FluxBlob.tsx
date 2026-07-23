import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Flux — organic brutalist hero blob.
 * One icosahedron with MeshDistortMaterial-driven organic motion.
 * - Leans toward the cursor (lerped), distortion grows with cursor proximity.
 * - Hover: springy pulse. Click: cycles through 4 curated palettes.
 * - Respects prefers-reduced-motion (static blob, no follow, no time).
 */

const PALETTES = [
  // base = blob color, sheen = sheen tint, rim/fill = light colors
  { base: '#ff3e00', sheen: '#ffc9a8', rim: '#ffb28a', fill: '#ffe3d6' }, // vermilion
  { base: '#2334ff', sheen: '#9fb1ff', rim: '#7e9bff', fill: '#dbe2ff' }, // ultramarine
  { base: '#8422ff', sheen: '#e3b8ff', rim: '#c08cff', fill: '#eee0ff' }, // violet
  { base: '#141414', sheen: '#9aa0ff', rim: '#7c86ff', fill: '#c9cdff' }, // oil-slick ink
];

type DistortMat = THREE.MeshPhysicalMaterial & { distort: number };

function usePrefersReducedMotion() {
  return useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
}

function Blob({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<DistortMat>(null);
  const rimLight = useRef<THREE.PointLight>(null);
  const fillLight = useRef<THREE.PointLight>(null);

  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  // Window-level pointer tracked in canvas NDC space, so the blob can
  // react to the cursor even before it is over the canvas itself.
  const ptr = useRef({ x: 0, y: 0 });
  const hovered = useRef(false);
  const palette = useRef(0);
  const spring = useRef({ s: 1, v: 0 });

  const targets = useMemo(
    () =>
      PALETTES.map((p) => ({
        base: new THREE.Color(p.base),
        sheen: new THREE.Color(p.sheen),
        rim: new THREE.Color(p.rim),
        fill: new THREE.Color(p.fill),
      })),
    []
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      ptr.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ptr.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [gl]);

  // Snap initial colors so the first frames don't lerp from white.
  useEffect(() => {
    const t = targets[0];
    if (mat.current) {
      mat.current.color.copy(t.base);
      mat.current.sheenColor.copy(t.sheen);
    }
    if (rimLight.current) rimLight.current.color.copy(t.rim);
    if (fillLight.current) fillLight.current.color.copy(t.fill);
  }, [targets]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const g = group.current;
    const m = mat.current;
    if (!g || !m) return;

    // --- springy scale (hover pulse + click kick) ---
    const sp = spring.current;
    const targetScale = hovered.current && !reduced ? 1.06 : 1;
    sp.v += (targetScale - sp.s) * 90 * dt;
    sp.v -= sp.v * 7 * dt;
    sp.s += sp.v * dt;
    sp.s = THREE.MathUtils.clamp(sp.s, 0.6, 1.5);
    g.scale.setScalar(sp.s);

    const t = state.clock.elapsedTime;

    if (reduced) {
      m.distort = 0.28;
    } else {
      // --- lean toward the cursor, plus a slow idle bob ---
      const px = THREE.MathUtils.clamp(ptr.current.x, -1.4, 1.4);
      const py = THREE.MathUtils.clamp(ptr.current.y, -1.4, 1.4);
      g.position.x = THREE.MathUtils.damp(g.position.x, px * 0.45, 3.5, dt);
      g.position.y = THREE.MathUtils.damp(
        g.position.y,
        py * 0.35 + Math.sin(t * 0.7) * 0.08,
        3.5,
        dt
      );
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, px * 0.4, 3, dt);
      g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -py * 0.3, 3, dt);
      g.rotation.z += dt * 0.05;

      // --- distortion intensity grows near the cursor ---
      tmp.copy(g.position).project(camera);
      const d = Math.hypot(ptr.current.x - tmp.x, ptr.current.y - tmp.y);
      const prox = 1 - Math.min(d / 1.1, 1);
      const targetDistort =
        0.26 + prox * 0.34 + (hovered.current ? 0.08 : 0);
      m.distort = THREE.MathUtils.damp(m.distort, targetDistort, 3, dt);
    }

    // --- smooth palette transition ---
    const pal = targets[palette.current];
    const k = Math.min(1, 4 * dt);
    m.color.lerp(pal.base, k);
    m.sheenColor.lerp(pal.sheen, k);
    if (rimLight.current) rimLight.current.color.lerp(pal.rim, k);
    if (fillLight.current) fillLight.current.color.lerp(pal.fill, k);
  });

  return (
    <group>
      <ambientLight intensity={0.65} />
      <directionalLight position={[-3, 4, 5]} intensity={1.9} color="#ffffff" />
      <pointLight ref={rimLight} position={[2.6, 1.4, -3.2]} intensity={55} />
      <pointLight ref={fillLight} position={[-4, -2.2, 3]} intensity={22} />
      <group ref={group}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            palette.current = (palette.current + 1) % PALETTES.length;
            if (!reduced) spring.current.v += 2.4; // springy kick
          }}
          onPointerOver={() => {
            hovered.current = true;
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            hovered.current = false;
            document.body.style.cursor = '';
          }}
        >
          <icosahedronGeometry args={[1.55, 5]} />
          <MeshDistortMaterial
            ref={mat}
            speed={reduced ? 0 : 1.7}
            roughness={0.16}
            metalness={0.3}
            clearcoat={1}
            clearcoatRoughness={0.18}
            iridescence={1}
            iridescenceIOR={1.35}
            sheen={1}
          />
        </mesh>
      </group>
    </group>
  );
}

export default function FluxBlob() {
  const reduced = usePrefersReducedMotion();
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 5.2], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Blob reduced={reduced} />
    </Canvas>
  );
}
