import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  GEO,
  MAT,
  TRUNK_H,
  alignY,
  buildBuds,
  mulberry32,
  radial,
  trunkR,
  type GroundScatter,
  type LimbSpec,
  type Placement,
} from './common';

/* ======================= static instanced clusters ===================== */

/**
 * Draws N copies of one geometry in a single call. Everything here is laid out
 * once and never moves, so the matrices are written in a layout effect and the
 * component costs nothing per frame.
 */
export function InstancedStatic({
  geometry,
  material,
  items,
  castShadow = true,
  receiveShadow = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    let tinted = false;
    items.forEach((it, i) => {
      d.position.set(it.p[0], it.p[1], it.p[2]);
      const r = it.r ?? [0, 0, 0];
      d.rotation.set(r[0], r[1], r[2]);
      const s = it.s ?? [1, 1, 1];
      d.scale.set(s[0], s[1], s[2]);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      if (it.c) {
        col.set(it.c);
        mesh.setColorAt(i, col);
        tinted = true;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, Math.max(items.length, 1)]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    />
  );
}

/* ================================= limbs =============================== */

/** A tapered branch between two world-space points. */
export function Limb({
  from,
  to,
  r,
  material = MAT.barkDark,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  r: number;
  material?: THREE.Material;
}) {
  const { q, len } = useMemo(() => {
    const dir = to.clone().sub(from);
    return { q: alignY(dir), len: dir.length() };
  }, [from, to]);
  return (
    <mesh
      geometry={GEO.limb}
      material={material}
      position={[from.x, from.y, from.z]}
      quaternion={q}
      scale={[r, len, r]}
      castShadow
    />
  );
}

/* ================================= trunk =============================== */

/**
 * The lathe-turned trunk plus its root flare and the little door at the base —
 * the ground floor of the world.
 */
export function Trunk() {
  const roots = useMemo(() => {
    const rng = mulberry32(313);
    const out: Placement[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng() * 0.3;
      const d = 1.35 + rng() * 0.35;
      out.push({
        p: [Math.cos(a) * d, 0.32, Math.sin(a) * d],
        r: [Math.PI * 0.42, -a, 0],
        s: [0.85 + rng() * 0.4, 1.1 + rng() * 0.5, 0.85 + rng() * 0.4],
      });
    }
    return out;
  }, []);

  return (
    <group>
      <mesh geometry={GEO.trunk} material={MAT.bark} castShadow receiveShadow />
      <InstancedStatic
        geometry={GEO.root}
        material={MAT.bark}
        items={roots}
        castShadow
        receiveShadow
      />

      {/* Root-cellar door — a lit hollow at the foot of the tree. */}
      <group position={[1.55, 0, 0.35]} rotation={[0, 0.2, 0]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[0.62, 1, 0.16]} />
          <meshStandardMaterial color="#8a5f46" flatShading roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.44, 0.09]} material={MAT.window}>
          <boxGeometry args={[0.42, 0.72, 0.06]} />
        </mesh>
        <mesh
          geometry={GEO.lanternGlow}
          material={MAT.lanternGlow}
          position={[0, 0.55, 0.2]}
          scale={1.6}
        />
      </group>
    </group>
  );
}

/* ================================= buds ================================ */

/**
 * Sprouting buds on the bare trunk: the branches that have not grown into
 * platforms yet. They breathe so the tree reads as a work in progress.
 */
export function Buds({ reduced }: { reduced: boolean }) {
  const buds = useMemo(() => buildBuds(), []);
  const refs = useRef<(THREE.Group | null)[]>([]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < refs.current.length; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const b = buds[i];
      const k = b.scale * (1 + Math.sin(t * 1.1 + b.phase) * 0.11);
      g.scale.setScalar(k);
      g.rotation.z = Math.sin(t * 0.8 + b.phase) * 0.08;
    }
  });

  return (
    <group>
      {buds.map((b, i) => (
        <group
          key={b.key}
          position={b.p}
          rotation={[0, -b.ang, 0]}
          scale={b.scale}
        >
          <group
            ref={(el) => {
              refs.current[i] = el;
            }}
          >
            <mesh
              geometry={GEO.budStem}
              material={MAT.barkDark}
              position={[0.14, 0.02, 0]}
              rotation={[0, 0, -1.15]}
              castShadow
            />
            <mesh
              geometry={GEO.budLeaf}
              material={MAT.leafA}
              position={[0.34, 0.14, 0.04]}
              rotation={[0.2, 0, -0.9]}
              castShadow
            />
            <mesh
              geometry={GEO.budLeaf}
              material={MAT.leafB}
              position={[0.33, 0.05, -0.11]}
              rotation={[-0.5, 0, -1.4]}
              scale={0.8}
              castShadow
            />
            <mesh
              geometry={GEO.budLeaf}
              material={MAT.blossom}
              position={[0.38, 0.24, -0.02]}
              rotation={[0, 0, -0.3]}
              scale={0.6}
              castShadow
            />
          </group>
        </group>
      ))}
    </group>
  );
}

/* ================================ ground =============================== */

export function Ground({ scatter }: { scatter: GroundScatter }) {
  return (
    <group>
      <mesh geometry={GEO.ground} material={MAT.grass} receiveShadow />
      <InstancedStatic
        geometry={GEO.rock}
        material={MAT.rock}
        items={scatter.rocks}
        receiveShadow
      />
      <InstancedStatic
        geometry={GEO.tuft}
        material={MAT.leafB}
        items={scatter.tufts}
      />
      {scatter.saplings.map((s, i) => (
        <group key={`sap${i}`} position={s.p} scale={s.s}>
          <mesh
            geometry={GEO.sapTrunk}
            material={MAT.barkDark}
            position={[0, 0.4, 0]}
            castShadow
          />
          <mesh
            geometry={GEO.leaf}
            material={i % 2 ? MAT.leafA : MAT.leafB}
            position={[0, 0.95, 0]}
            scale={[0.44, 0.36, 0.44]}
            rotation={[0.4, i, 0.2]}
            castShadow
          />
          <mesh
            geometry={GEO.leaf}
            material={MAT.leafA}
            position={[0.22, 0.72, 0.1]}
            scale={0.26}
            rotation={[1, i * 2, 0.3]}
            castShadow
          />
        </group>
      ))}
    </group>
  );
}

/* ================================ clouds =============================== */

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
        position={[0.55, -0.06, 0.08]}
        scale={[0.72, 0.42, 0.6]}
      />
      <mesh
        geometry={GEO.cloudPuff}
        material={MAT.cloud}
        position={[-0.52, -0.08, -0.06]}
        scale={[0.62, 0.38, 0.56]}
      />
    </group>
  );
}

export function Clouds({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.y += delta * 0.012;
  });
  return (
    <group ref={ref}>
      <Cloud position={[10.5, 16.5, -5]} scale={1.4} />
      <Cloud position={[-11, 13.5, 4]} scale={1.2} />
      <Cloud position={[5.5, 19, 7]} scale={0.95} />
      <Cloud position={[-8, 18.4, -7]} scale={1.1} />
      <Cloud position={[12, 10.5, 5.5]} scale={0.9} />
      <Cloud position={[-12.5, 8.8, -2]} scale={0.85} />
    </group>
  );
}

/* ============================= falling leaves ========================== */

interface Faller {
  x: number;
  z: number;
  y: number;
  spin: number;
  drift: number;
  fall: number;
  phase: number;
}

/** A slow drift of leaves coming off the canopy — cheap ambient life. */
export function FallingLeaves({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 30;
  const state = useMemo<Faller[]>(() => {
    const rng = mulberry32(5151);
    return Array.from({ length: N }, () => {
      const a = rng() * Math.PI * 2;
      const d = 1.2 + rng() * 3.8;
      return {
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        y: rng() * 14,
        spin: 0.6 + rng() * 1.6,
        drift: 0.3 + rng() * 0.7,
        fall: 0.35 + rng() * 0.45,
        phase: rng() * Math.PI * 2,
      };
    });
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((s, rawDelta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const delta = reduced ? 0 : Math.min(rawDelta, 0.1);
    const t = s.clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      const f = state[i];
      f.y -= f.fall * delta;
      if (f.y < 0.05) f.y = 13.5 + Math.random() * 2;
      const sway = Math.sin(t * f.drift + f.phase) * 0.5;
      dummy.position.set(f.x + sway, f.y, f.z + Math.cos(t * f.drift * 0.8 + f.phase) * 0.4);
      dummy.rotation.set(t * f.spin, t * f.spin * 0.7 + f.phase, f.phase);
      dummy.scale.setScalar(0.75);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[GEO.fallingLeaf, MAT.fallingLeaf, N]}
      frustumCulled={false}
    />
  );
}

/* ========================== decorative branches ======================== */

export function DecoLimbs({ limbs }: { limbs: LimbSpec[] }) {
  return (
    <group>
      {limbs.map((l) => (
        <Limb key={l.key} from={l.from} to={l.to} r={l.r} />
      ))}
      {/* Short counter-stubs so the trunk doesn't look one-sided. */}
      {[
        [2.85, 5.0],
        [5.4, 6.6],
        [0.1, 4.2],
        [3.9, 8.0],
        [5.05, 3.4],
      ].map(([a, y], i) => (
        <Limb
          key={`stub${i}`}
          from={radial(a, trunkR(y) - 0.1, y)}
          to={radial(a, trunkR(y) + 0.9, y + 0.75)}
          r={0.11}
        />
      ))}
      {/* Short central leaders filling the middle of the canopy. */}
      {[0.85, 2.95, 4.2, 5.3].map((a, i) => (
        <Limb
          key={`lead${i}`}
          from={radial(a, trunkR(TRUNK_H - 0.9) * 0.6, TRUNK_H - 0.9)}
          to={radial(a, 1.35, TRUNK_H + 2.1)}
          r={0.17}
        />
      ))}
    </group>
  );
}
