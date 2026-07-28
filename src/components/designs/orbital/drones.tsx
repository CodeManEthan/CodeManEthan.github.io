import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  GEO,
  HUB_R,
  MAT,
  accentMaterial,
  mulberry32,
  type BuildCtx,
  type ModuleSpec,
} from './common';

/**
 * The crew. Every drone here has a job you can name by watching it for ten
 * seconds: ferries haul cargo pods out to the modules, keepers hold station
 * beside a hull, and the welder skins the new module in the expansion bay.
 *
 * All of it is ref-based mutation inside useFrame — no React state, no
 * per-frame allocation, no re-renders.
 */

/* ------------------------------- drone body ------------------------------- */

interface DroneMeshRefs {
  plumeRef?: RefObject<THREE.Mesh | null>;
}

/** ~0.45 across. Nose (sensor lens) points down -Z so `lookAt` works. */
function DroneMesh({
  plumeRef,
  tint,
  scale = 1,
}: DroneMeshRefs & { tint: THREE.Material; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh geometry={GEO.droneBody} material={MAT.droneShell} scale={[1, 0.72, 1.25]} />
      <mesh
        geometry={GEO.box}
        material={MAT.droneDark}
        position={[0, 0.02, 0.04]}
        scale={[0.3, 0.09, 0.36]}
      />
      {/* rotor pods */}
      {(
        [
          [-0.19, 0.02, -0.15],
          [0.19, 0.02, -0.15],
          [-0.19, 0.02, 0.16],
          [0.19, 0.02, 0.16],
        ] as Array<[number, number, number]>
      ).map((p, i) => (
        <group key={i} position={p}>
          <mesh geometry={GEO.nacelle} material={MAT.droneShell} scale={[1, 0.7, 1]} />
          <mesh geometry={GEO.lens} material={tint} position={[0, -0.045, 0]} scale={0.7} />
        </group>
      ))}
      {/* sensor */}
      <mesh geometry={GEO.lens} material={MAT.droneGlow} position={[0, 0.01, -0.2]} />
      {/* thruster plume, scaled by throttle */}
      <mesh
        ref={plumeRef}
        geometry={GEO.plume}
        material={MAT.plume}
        position={[0, 0, 0.28]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={0}
      />
    </group>
  );
}

/* --------------------------------- maths ---------------------------------- */

function bezier(
  out: THREE.Vector3,
  a: THREE.Vector3,
  c: THREE.Vector3,
  b: THREE.Vector3,
  t: number
): THREE.Vector3 {
  const it = 1 - t;
  const w0 = it * it;
  const w1 = 2 * it * t;
  const w2 = t * t;
  out.set(
    w0 * a.x + w1 * c.x + w2 * b.x,
    w0 * a.y + w1 * c.y + w2 * b.y,
    w0 * a.z + w1 * c.z + w2 * b.z
  );
  return out;
}

/** Where a ferry parks alongside a module. */
function dockPoint(out: THREE.Vector3, m: ModuleSpec): THREE.Vector3 {
  return out.set(
    Math.cos(m.ang) * m.radius,
    m.dy + m.R + 0.62,
    Math.sin(m.ang) * m.radius
  );
}

/** Where a ferry collects a pod from the hub, facing the given slot. */
function hubPoint(out: THREE.Vector3, ang: number): THREE.Vector3 {
  return out.set(Math.cos(ang) * (HUB_R + 0.75), 0.55, Math.sin(ang) * (HUB_R + 0.75));
}

/* --------------------------------- ferry ---------------------------------- */

type FerryMode = 'load' | 'out' | 'unload' | 'back';

interface FerryState {
  mode: FerryMode;
  dest: number;
  t: number;
  dur: number;
  timer: number;
  phase: number;
  rng: () => number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  p: THREE.Vector3;
  q: THREE.Vector3;
}

/**
 * A cargo ferry. Loads a glowing pod at the hub, flies a lifted arc out to a
 * module, holds station while it unloads, then coasts back empty. The pod
 * takes the destination module's accent colour, so you can watch a delivery
 * find its home.
 */
export function Ferry({
  modules,
  seed,
  reduced,
  /** When set, this ferry only ever serves the expansion bay. */
  fixedDest,
}: {
  modules: ModuleSpec[];
  seed: number;
  reduced: boolean;
  fixedDest?: { ang: number; radius: number; dy: number; R: number; accent: string };
}) {
  const root = useRef<THREE.Group>(null);
  const podRef = useRef<THREE.Group>(null);
  const plumeRef = useRef<THREE.Mesh>(null);
  const stRef = useRef<FerryState | null>(null);

  const podMat = useMemo(() => accentMaterial('#9df0ff'), []);
  const podGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#9df0ff',
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    []
  );
  const tint = useMemo(() => new THREE.MeshBasicMaterial({ color: '#9df0ff' }), []);

  const target = (i: number) =>
    fixedDest ?? {
      ang: modules[i].ang,
      radius: modules[i].radius,
      dy: modules[i].dy,
      R: modules[i].R,
      accent: modules[i].accent,
    };

  const plan = (s: FerryState) => {
    const d = target(s.dest);
    const dockA = s.a;
    const dockB = s.b;
    hubPoint(dockA, d.ang);
    dockB.set(Math.cos(d.ang) * d.radius, d.dy + d.R + 0.62, Math.sin(d.ang) * d.radius);
    if (s.mode === 'back') {
      // Same corridor, flown the other way.
      const tmp = s.p.copy(dockA);
      dockA.copy(dockB);
      dockB.copy(tmp);
    }
    s.c
      .copy(dockA)
      .add(dockB)
      .multiplyScalar(0.5);
    s.c.y += 2.1 + s.rng() * 1.4;
    // Bow the corridor sideways so outbound and inbound don't overlap.
    const side = s.mode === 'back' ? -1 : 1;
    s.c.x += -Math.sin(d.ang) * 1.7 * side;
    s.c.z += Math.cos(d.ang) * 1.7 * side;
    s.t = 0;
    s.dur = Math.max(2.6, dockA.distanceTo(dockB) / 2.3);
  };

  useFrame((state, rawDelta) => {
    const g = root.current;
    const pod = podRef.current;
    const plume = plumeRef.current;
    if (!g || !pod || !plume || modules.length === 0) return;

    let s = stRef.current;
    if (!s) {
      const rng = mulberry32(seed * 7717 + 13);
      s = stRef.current = {
        mode: 'load',
        dest: fixedDest ? 0 : Math.floor(rng() * modules.length),
        t: 0,
        dur: 3,
        timer: 0.6 + rng() * 2.4,
        phase: rng() * Math.PI * 2,
        rng,
        a: new THREE.Vector3(),
        b: new THREE.Vector3(),
        c: new THREE.Vector3(),
        p: new THREE.Vector3(),
        q: new THREE.Vector3(),
      };
      const d = target(s.dest);
      podMat.color.set(d.accent);
      podMat.emissive.set(d.accent);
      podGlowMat.color.set(d.accent);
      hubPoint(s.p, d.ang);
      g.position.copy(s.p);
    }

    const t = state.clock.elapsedTime;

    if (reduced) {
      // Parked at the hub with its pod loaded.
      hubPoint(s.p, target(s.dest).ang);
      g.position.copy(s.p);
      pod.visible = true;
      plume.scale.setScalar(0);
      return;
    }

    const delta = Math.min(rawDelta, 0.1);
    let throttle = 0;

    switch (s.mode) {
      case 'load':
      case 'unload': {
        s.timer -= delta;
        const d = target(s.dest);
        if (s.mode === 'load') hubPoint(s.p, d.ang);
        else dockPoint(s.p, d);
        // Station-keeping wobble while docked.
        g.position.set(
          s.p.x + Math.sin(t * 1.3 + s.phase) * 0.07,
          s.p.y + Math.sin(t * 1.9 + s.phase * 2) * 0.06,
          s.p.z + Math.cos(t * 1.1 + s.phase) * 0.07
        );
        g.rotation.y += delta * 0.35;
        g.rotation.x = Math.sin(t * 1.5 + s.phase) * 0.05;
        g.rotation.z = Math.cos(t * 1.2 + s.phase) * 0.05;
        pod.visible = s.mode === 'load' ? s.timer < 1.2 : s.timer > 0.9;
        pod.scale.setScalar(
          s.mode === 'load'
            ? THREE.MathUtils.clamp(1.2 - s.timer, 0, 1)
            : THREE.MathUtils.clamp(s.timer - 0.9, 0, 1)
        );
        throttle = 0.18;
        if (s.timer <= 0) {
          if (s.mode === 'load') {
            s.mode = 'out';
            plan(s);
          } else {
            s.mode = 'back';
            plan(s);
          }
        }
        break;
      }
      case 'out':
      case 'back': {
        s.t += delta / s.dur;
        const raw = Math.min(s.t, 1);
        const e = raw * raw * (3 - 2 * raw); // ease in/out
        bezier(s.p, s.a, s.c, s.b, e);
        bezier(s.q, s.a, s.c, s.b, Math.min(e + 0.02, 1));
        g.position.copy(s.p);
        if (s.q.distanceToSquared(s.p) > 1e-8) g.lookAt(s.q);
        g.rotation.z += Math.sin(t * 0.9 + s.phase) * 0.06;
        pod.visible = s.mode === 'out';
        pod.scale.setScalar(1);
        throttle = 0.4 + Math.sin(raw * Math.PI) * 0.75;
        if (s.t >= 1) {
          if (s.mode === 'out') {
            s.mode = 'unload';
            s.timer = 2.2 + s.rng() * 2.2;
          } else {
            s.mode = 'load';
            s.timer = 1.6 + s.rng() * 2.6;
            if (!fixedDest && modules.length > 1) {
              let next = Math.floor(s.rng() * modules.length);
              if (next === s.dest) next = (next + 1) % modules.length;
              s.dest = next;
            }
            const d = target(s.dest);
            podMat.color.set(d.accent);
            podMat.emissive.set(d.accent);
            podGlowMat.color.set(d.accent);
          }
        }
        break;
      }
    }

    plume.scale.set(0.8, throttle, 0.8);
  });

  return (
    <group ref={root}>
      <DroneMesh plumeRef={plumeRef} tint={tint} scale={1.7} />
      <group ref={podRef} position={[0, -0.5, 0.03]}>
        <group scale={1.7}>
          <mesh geometry={GEO.pod} material={podMat} />
          <mesh geometry={GEO.podGlow} material={podGlowMat} />
          {/* sling */}
          <mesh
            geometry={GEO.rod}
            material={MAT.droneDark}
            position={[0, 0.18, 0]}
            scale={[0.016, 0.22, 0.016]}
          />
        </group>
      </group>
    </group>
  );
}

/* -------------------------------- keeper ---------------------------------- */

interface KeeperState {
  home: number;
  ang: number;
  timer: number;
  phase: number;
  rng: () => number;
  p: THREE.Vector3;
  q: THREE.Vector3;
}

/**
 * A station-keeper: creeps around one module's hull inspecting it, holds a
 * wobbling hover, then transfers to another module every half minute or so.
 */
export function Keeper({
  modules,
  seed,
  reduced,
}: {
  modules: ModuleSpec[];
  seed: number;
  reduced: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const plumeRef = useRef<THREE.Mesh>(null);
  const stRef = useRef<KeeperState | null>(null);
  const tint = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd08a' }), []);

  useFrame((state, rawDelta) => {
    const g = root.current;
    const plume = plumeRef.current;
    if (!g || !plume || modules.length === 0) return;

    let s = stRef.current;
    if (!s) {
      const rng = mulberry32(seed * 3313 + 71);
      s = stRef.current = {
        home: Math.floor(rng() * modules.length),
        ang: rng() * Math.PI * 2,
        timer: 12 + rng() * 18,
        phase: rng() * Math.PI * 2,
        rng,
        p: new THREE.Vector3(),
        q: new THREE.Vector3(),
      };
    }

    const m = modules[s.home];
    const t = state.clock.elapsedTime;
    const delta = Math.min(rawDelta, 0.1);
    if (!reduced) {
      s.ang += delta * 0.32;
      s.timer -= delta;
    }

    // Orbit the module's own axis, offset along its length.
    const off = Math.sin(t * 0.25 + s.phase) * (m.len * 0.45);
    const rr = m.R + 0.55;
    const lx = off;
    const ly = Math.sin(s.ang) * rr;
    const lz = Math.cos(s.ang) * rr;
    // Module local +X points radially outward; rotate local -> world.
    const ca = Math.cos(-m.ang);
    const sa = Math.sin(-m.ang);
    s.p.set(
      Math.cos(m.ang) * m.radius + lx * ca + lz * sa,
      m.dy + ly + (reduced ? 0 : Math.sin(t * 1.7 + s.phase) * 0.05),
      Math.sin(m.ang) * m.radius - lx * sa + lz * ca
    );
    g.position.copy(s.p);
    // Face the hull it is inspecting.
    s.q.set(
      Math.cos(m.ang) * m.radius + lx * ca,
      m.dy,
      Math.sin(m.ang) * m.radius - lx * sa
    );
    g.lookAt(s.q);
    plume.scale.set(0.7, reduced ? 0 : 0.22 + Math.abs(Math.sin(t * 2 + s.phase)) * 0.2, 0.7);

    if (!reduced && s.timer <= 0 && modules.length > 1) {
      let next = Math.floor(s.rng() * modules.length);
      if (next === s.home) next = (next + 1) % modules.length;
      s.home = next;
      s.timer = 14 + s.rng() * 20;
    }
  });

  return (
    <group ref={root}>
      <DroneMesh plumeRef={plumeRef} tint={tint} scale={1.3} />
    </group>
  );
}

/* -------------------------------- welder ---------------------------------- */

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

interface WelderState {
  stop: number;
  travel: number;
  weld: number;
  phase: number;
  rng: () => number;
  sparks: Spark[];
  p: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  q: THREE.Vector3;
}

/**
 * The welder. Works its way around the ribs of the half-built module, holds
 * a bead for a few seconds — sparks, flash, `ctx.welding` — then jets to the
 * next seam. Every completed bead nudges `ctx.progress`, and the expansion
 * bay skins another hull panel. This is the growth loop.
 *
 * Positions are in the expansion bay's local space; the bay parents it.
 */
export function Welder({
  ctx,
  stops,
  reduced,
}: {
  ctx: BuildCtx;
  stops: Array<[number, number, number]>;
  reduced: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const plumeRef = useRef<THREE.Mesh>(null);
  const flashRef = useRef<THREE.PointLight>(null);
  const sparkGroup = useRef<THREE.Group>(null);
  const stRef = useRef<WelderState | null>(null);
  const tint = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffb877' }), []);
  const SPARKS = 14;

  useFrame((state, rawDelta) => {
    const g = root.current;
    const sg = sparkGroup.current;
    const plume = plumeRef.current;
    const flash = flashRef.current;
    if (!g || !sg || !plume || !flash) return;

    let s = stRef.current;
    if (!s) {
      const rng = mulberry32(31337);
      s = stRef.current = {
        stop: 0,
        travel: 1,
        weld: 2.5,
        phase: rng() * Math.PI * 2,
        rng,
        sparks: Array.from({ length: SPARKS }, () => ({
          x: 0,
          y: 0,
          z: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          life: 0,
        })),
        p: new THREE.Vector3(...stops[0]),
        from: new THREE.Vector3(...stops[0]),
        to: new THREE.Vector3(...stops[0]),
        q: new THREE.Vector3(),
      };
    }

    const t = state.clock.elapsedTime;

    if (reduced) {
      s.p.set(...stops[s.stop]);
      g.position.copy(s.p);
      ctx.welding = false;
      plume.scale.setScalar(0);
      flash.intensity = 0;
      MAT.weldFlash.opacity = 0;
      sg.children.forEach((c) => (c.visible = false));
      return;
    }

    const delta = Math.min(rawDelta, 0.1);

    if (s.travel < 1) {
      // In transit between seams.
      s.travel = Math.min(1, s.travel + delta / 1.6);
      const e = s.travel * s.travel * (3 - 2 * s.travel);
      s.p.lerpVectors(s.from, s.to, e);
      s.p.y += Math.sin(e * Math.PI) * 0.35;
      ctx.welding = false;
      plume.scale.set(0.8, 0.5 + Math.sin(e * Math.PI) * 0.5, 0.8);
      if (s.travel >= 1) s.weld = 2.4 + s.rng() * 2.6;
    } else {
      // Holding a bead.
      s.weld -= delta;
      ctx.welding = true;
      ctx.progress += delta * 0.028;
      if (ctx.progress > 1) ctx.progress = 0.1; // the next frame goes up
      s.p.set(...stops[s.stop]);
      s.p.x += Math.sin(t * 1.6 + s.phase) * 0.05;
      s.p.y += Math.sin(t * 2.1 + s.phase) * 0.04;
      plume.scale.set(0.7, 0.2, 0.7);
      if (s.weld <= 0) {
        s.from.copy(s.p);
        s.stop = (s.stop + 1) % stops.length;
        s.to.set(...stops[s.stop]);
        s.travel = 0;
        ctx.welding = false;
      }
    }

    g.position.copy(s.p);
    // Nose points inward at the seam it is working.
    s.q.set(s.p.x * 0.2, s.p.y - 0.5, s.p.z * 0.2);
    g.lookAt(s.q);

    // --- sparks -----------------------------------------------------------
    const flicker = ctx.welding ? 0.55 + Math.abs(Math.sin(t * 34)) * 0.45 : 0;
    MAT.weldFlash.opacity = flicker * 0.75;
    flash.intensity = flicker * 46;

    for (let i = 0; i < SPARKS; i++) {
      const sp = s.sparks[i];
      const mesh = sg.children[i];
      if (!mesh) continue;
      sp.life -= delta;
      if (sp.life <= 0) {
        if (!ctx.welding || s.rng() > 0.45) {
          mesh.visible = false;
          continue;
        }
        sp.x = 0;
        sp.y = 0;
        sp.z = 0;
        const a = s.rng() * Math.PI * 2;
        const el = 0.2 + s.rng() * 1.1;
        const sp0 = 0.9 + s.rng() * 1.9;
        sp.vx = Math.cos(a) * sp0 * 0.7;
        sp.vy = Math.sin(el) * sp0;
        sp.vz = Math.sin(a) * sp0 * 0.7;
        sp.life = 0.28 + s.rng() * 0.45;
      }
      sp.x += sp.vx * delta;
      sp.y += sp.vy * delta;
      sp.z += sp.vz * delta;
      sp.vy -= delta * 1.1; // gentle drift, not gravity — we're in orbit
      sp.vx *= 0.985;
      sp.vz *= 0.985;
      mesh.visible = true;
      mesh.position.set(sp.x, sp.y, sp.z);
      const k = THREE.MathUtils.clamp(sp.life * 2.2, 0.08, 1);
      mesh.scale.setScalar(k);
    }
    sg.position.copy(s.p);
  });

  return (
    <>
      <group ref={root}>
        <DroneMesh plumeRef={plumeRef} tint={tint} scale={1.4} />
        {/* welding head */}
        <mesh
          geometry={GEO.rod}
          material={MAT.droneDark}
          position={[0, -0.1, -0.2]}
          rotation={[Math.PI / 2.4, 0, 0]}
          scale={[0.03, 0.26, 0.03]}
        />
        <mesh geometry={GEO.lens} material={MAT.weldFlash} position={[0, -0.24, -0.36]} scale={6} />
        <pointLight
          ref={flashRef}
          position={[0, -0.2, -0.32]}
          color="#ffdca0"
          distance={7}
          decay={2}
          intensity={0}
        />
      </group>
      <group ref={sparkGroup}>
        {Array.from({ length: SPARKS }, (_, i) => (
          <mesh key={i} geometry={GEO.spark} material={MAT.spark} visible={false} />
        ))}
      </group>
    </>
  );
}
