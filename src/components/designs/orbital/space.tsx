import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MAT, mulberry32 } from './common';

/**
 * The world outside the station: a painted backdrop sphere, two layers of
 * points (bright near stars + slow drifting dust), a pastel planet low in
 * frame and its little moon. Nothing here is interactive.
 */

function Backdrop() {
  return (
    <mesh material={MAT.sky} scale={180} renderOrder={-1}>
      <sphereGeometry args={[1, 32, 20]} />
    </mesh>
  );
}

function shell(seed: number, n: number) {
  const rng = mulberry32(seed);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 118 + rng() * 28;
    pos[i * 3] = Math.cos(a) * s * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = Math.sin(a) * s * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/** Two layers of screen-space points — a few bright, many faint. */
function Starfield() {
  const bright = useMemo(() => shell(5150, 420), []);
  const faint = useMemo(() => shell(9931, 1500), []);
  return (
    <>
      <points geometry={bright} material={MAT.star} frustumCulled={false} />
      <points geometry={faint} material={MAT.starFaint} frustumCulled={false} />
    </>
  );
}

/** Slow motes of debris drifting near the yard — parallax you can feel. */
function Dust({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const rng = mulberry32(90210);
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = 6 + rng() * 22;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (rng() - 0.5) * 16;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame((_, delta) => {
    if (!reduced && ref.current) ref.current.rotation.y += delta * 0.012;
  });

  return (
    <points ref={ref} geometry={geo} material={MAT.dust} frustumCulled={false} />
  );
}

function Planet({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!reduced && ref.current) ref.current.rotation.y += delta * 0.006;
  });
  return (
    <group position={[52, -56, -108]}>
      <mesh ref={ref} material={MAT.planet}>
        <sphereGeometry args={[24, 40, 26]} />
      </mesh>
      <mesh material={MAT.planetAir} scale={1.05}>
        <sphereGeometry args={[24, 28, 18]} />
      </mesh>
    </group>
  );
}

function Moon() {
  return (
    <mesh material={MAT.moon} position={[46, 20, -58]}>
      <icosahedronGeometry args={[3.4, 1]} />
    </mesh>
  );
}

/**
 * Lighting rig. One hard key (the local star, up-left-front), a cool bounce
 * off the planet from below, and just enough ambient that the shadow sides
 * stay indigo instead of black.
 */
export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.55} color="#8f9ad6" />
      <directionalLight position={[16, 20, 12]} intensity={2.5} color="#fff4e2" />
      <directionalLight position={[-14, -10, -8]} intensity={0.8} color="#6f7fd8" />
      <hemisphereLight args={['#c9d6ff', '#2b2554', 0.5]} />
      {/* A faint rim from the far side keeps hull edges readable against space. */}
      <pointLight position={[-18, 6, -18]} intensity={220} distance={70} decay={2} color="#7fc9ff" />
    </>
  );
}

export function SpaceEnvironment({ reduced }: { reduced: boolean }) {
  return (
    <>
      <Backdrop />
      <Starfield />
      <Dust reduced={reduced} />
      <Planet reduced={reduced} />
      <Moon />
    </>
  );
}
