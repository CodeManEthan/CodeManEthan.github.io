import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GEO, MAT, islandBob, mulberry32, type IslandSpec } from './common';

/** Shared per-island scratch state: how many bots are hammering right now. */
export interface WorkCtx {
  workers: number;
}

/* ------------------------------ movement ------------------------------ */

interface Walker {
  px: number;
  pz: number;
  tx: number;
  tz: number;
  heading: number;
}

/**
 * Turn smoothly toward the target and waddle forward. Returns true on arrival.
 * When `clampR` is given the walker is kept inside that radius.
 */
function stepToward(
  w: Walker,
  delta: number,
  speed: number,
  clampR: number | null
): boolean {
  const dx = w.tx - w.px;
  const dz = w.tz - w.pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.06) return true;
  const targetH = Math.atan2(dx, dz);
  let d = targetH - w.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  w.heading += d * Math.min(1, delta * 5);
  const step = Math.min(dist, speed * delta);
  w.px += Math.sin(w.heading) * step;
  w.pz += Math.cos(w.heading) * step;
  if (clampR !== null) {
    const r = Math.hypot(w.px, w.pz);
    if (r > clampR) {
      const k = clampR / r;
      w.px *= k;
      w.pz *= k;
    }
  }
  return false;
}

function turnToward(w: Walker, targetH: number, delta: number): void {
  let d = targetH - w.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  w.heading += d * Math.min(1, delta * 5);
}

/* ------------------------------ bot visual ----------------------------- */

interface BotRefs {
  bodyRef: RefObject<THREE.Group | null>;
  headRef: RefObject<THREE.Group | null>;
  sparkRef: RefObject<THREE.Mesh | null>;
}

/** Rounded-cone body + sphere head + stub arms, flat-shaded. ~0.4 tall. */
export function BotMesh({
  bodyRef,
  headRef,
  sparkRef,
  accentMat,
}: BotRefs & { accentMat: THREE.Material }) {
  return (
    <group ref={bodyRef}>
      <mesh geometry={GEO.botBody} material={accentMat} position={[0, 0.15, 0]} castShadow />
      <group ref={headRef} position={[0, 0.33, 0]}>
        <mesh geometry={GEO.botHead} material={MAT.botFace} castShadow />
        <mesh geometry={GEO.botEye} material={MAT.botEye} position={[-0.03, 0.012, 0.065]} />
        <mesh geometry={GEO.botEye} material={MAT.botEye} position={[0.03, 0.012, 0.065]} />
      </group>
      <mesh geometry={GEO.botArm} material={accentMat} position={[-0.125, 0.17, 0]} />
      <mesh geometry={GEO.botArm} material={accentMat} position={[0.125, 0.17, 0]} />
      <mesh
        ref={sparkRef}
        geometry={GEO.spark}
        material={MAT.spark}
        position={[0, 0.2, 0.2]}
        visible={false}
      />
    </group>
  );
}

/* ------------------------------- bot brain ----------------------------- */

type BotState = 'wander' | 'idle' | 'work';

interface Brain extends Walker {
  state: BotState;
  timer: number;
  phase: number;
  atSite: boolean;
  hammering: boolean;
  rng: () => number;
}

function enterWander(b: Brain, walkR: number): void {
  b.state = 'wander';
  const a = b.rng() * Math.PI * 2;
  const r = Math.sqrt(b.rng()) * walkR;
  b.tx = Math.sin(a) * r;
  b.tz = Math.cos(a) * r;
}

function enterIdle(b: Brain): void {
  b.state = 'idle';
  b.timer = 2.5 + b.rng() * 3.5;
}

function enterWork(b: Brain, spec: IslandSpec): void {
  b.state = 'work';
  b.atSite = false;
  b.timer = 4 + b.rng() * 4;
  // Stand somewhere around the build site, clamped onto the island top.
  const a = b.rng() * Math.PI * 2;
  let sx = spec.siteX + Math.sin(a) * 0.6 * spec.siteScale;
  let sz = spec.siteZ + Math.cos(a) * 0.6 * spec.siteScale;
  const r = Math.hypot(sx, sz);
  const maxR = spec.S * 0.82;
  if (r > maxR) {
    sx *= maxR / r;
    sz *= maxR / r;
  }
  b.tx = sx;
  b.tz = sz;
}

/**
 * One resident bot, parented to its island group (so it bobs with it).
 * Wander / idle / work state machine, all mutation ref-based — no per-frame
 * allocations, no React state churn.
 */
export function Bot({
  spec,
  ctx,
  accentMat,
  seed,
  reduced,
}: {
  spec: IslandSpec;
  ctx: WorkCtx;
  accentMat: THREE.Material;
  seed: number;
  reduced: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const sparkRef = useRef<THREE.Mesh>(null);
  const brainRef = useRef<Brain | null>(null);

  useFrame((state, rawDelta) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    const spark = sparkRef.current;
    if (!root || !body || !head || !spark) return;

    let b = brainRef.current;
    if (!b) {
      const rng = mulberry32(seed * 7919 + 17);
      b = brainRef.current = {
        state: 'idle',
        px: 0,
        pz: 0,
        tx: 0,
        tz: 0,
        heading: rng() * Math.PI * 2,
        timer: 1 + rng() * 3,
        phase: rng() * Math.PI * 2,
        atSite: false,
        hammering: false,
        rng,
      };
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * spec.walkR;
      b.px = Math.sin(a) * r;
      b.pz = Math.cos(a) * r;
    }

    const t = state.clock.elapsedTime;

    if (reduced) {
      // Freeze in an idle pose.
      if (b.hammering) {
        b.hammering = false;
        ctx.workers = Math.max(0, ctx.workers - 1);
      }
      root.position.set(b.px, 0, b.pz);
      root.rotation.y = b.heading;
      body.rotation.set(0, 0, 0);
      head.rotation.y = 0;
      spark.visible = false;
      return;
    }

    const delta = Math.min(rawDelta, 0.1);
    let hopY = 0;
    let sparkOn = false;

    switch (b.state) {
      case 'wander': {
        if (stepToward(b, delta, 0.45, spec.walkR)) {
          const r = b.rng();
          if (r < 0.45) enterIdle(b);
          else if (r < 0.75) enterWork(b, spec);
          else enterWander(b, spec.walkR);
        } else {
          body.rotation.z = Math.sin(t * 9 + b.phase) * 0.12;
          body.rotation.x = 0;
          head.rotation.y = 0;
          hopY = Math.abs(Math.sin(t * 9 + b.phase)) * 0.035;
        }
        break;
      }
      case 'idle': {
        b.timer -= delta;
        body.rotation.z = 0;
        body.rotation.x = 0;
        head.rotation.y = Math.sin(t * 0.9 + b.phase * 2) * 0.55;
        const j = Math.sin(t * 1.6 + b.phase * 5);
        hopY = j > 0 ? Math.pow(j, 14) * 0.09 : 0; // occasional little jump
        if (b.timer <= 0) {
          if (b.rng() < 0.65) enterWander(b, spec.walkR);
          else enterWork(b, spec);
        }
        break;
      }
      case 'work': {
        if (!b.atSite) {
          if (stepToward(b, delta, 0.45, null)) {
            b.atSite = true;
            b.hammering = true;
            ctx.workers += 1;
          } else {
            body.rotation.z = Math.sin(t * 9 + b.phase) * 0.12;
            body.rotation.x = 0;
            head.rotation.y = 0;
            hopY = Math.abs(Math.sin(t * 9 + b.phase)) * 0.035;
          }
        } else {
          // Face the structure and hammer-bob.
          turnToward(b, Math.atan2(spec.siteX - b.px, spec.siteZ - b.pz), delta);
          const swing = Math.sin(t * 7.5 + b.phase);
          body.rotation.x = Math.max(0, swing) * 0.5;
          body.rotation.z = 0;
          head.rotation.y = 0;
          sparkOn = swing > 0.92; // flash on each hit
          b.timer -= delta;
          if (b.timer <= 0) {
            b.hammering = false;
            b.atSite = false;
            ctx.workers = Math.max(0, ctx.workers - 1);
            enterWander(b, spec.walkR);
          }
        }
        break;
      }
    }

    root.position.set(b.px, hopY, b.pz);
    root.rotation.y = b.heading;
    spark.visible = sparkOn;
  });

  return (
    <group ref={rootRef}>
      <BotMesh bodyRef={bodyRef} headRef={headRef} sparkRef={sparkRef} accentMat={accentMat} />
    </group>
  );
}

/* ------------------------------ build site ----------------------------- */

/**
 * A small in-progress frame of posts and beams. The block inside slowly grows
 * while any bot is hammering, then loops — purely cosmetic.
 */
export function BuildSite({
  spec,
  ctx,
  reduced,
}: {
  spec: IslandSpec;
  ctx: WorkCtx;
  reduced: boolean;
}) {
  const progRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0.12);

  useFrame((_, delta) => {
    const m = progRef.current;
    if (!m) return;
    if (!reduced && ctx.workers > 0) {
      progress.current += Math.min(delta, 0.1) * 0.025;
      if (progress.current > 1) progress.current = 0.12;
    }
    m.scale.y = progress.current;
  });

  return (
    <group position={[spec.siteX, 0, spec.siteZ]} scale={spec.siteScale}>
      <mesh geometry={GEO.post} material={MAT.post} position={[-0.3, 0.27, -0.3]} castShadow />
      <mesh geometry={GEO.post} material={MAT.post} position={[0.3, 0.27, -0.3]} castShadow />
      <mesh geometry={GEO.post} material={MAT.post} position={[-0.3, 0.27, 0.3]} castShadow />
      <mesh geometry={GEO.post} material={MAT.post} position={[0.3, 0.27, 0.3]} castShadow />
      <mesh geometry={GEO.beam} material={MAT.plank} position={[0, 0.56, -0.3]} castShadow />
      <mesh geometry={GEO.beam} material={MAT.plank} position={[0, 0.56, 0.3]} castShadow />
      <mesh
        geometry={GEO.beam}
        material={MAT.plank}
        position={[-0.3, 0.56, 0]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
      />
      <mesh
        geometry={GEO.beam}
        material={MAT.plank}
        position={[0.3, 0.56, 0]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
      />
      <mesh ref={progRef} geometry={GEO.progress} material={MAT.plank} scale={[1, 0.12, 1]} />
    </group>
  );
}

/* ------------------------------- traveler ------------------------------ */

type VoyageMode = 'ashore' | 'board' | 'sail';

interface Voyage extends Walker {
  mode: VoyageMode;
  cur: number;
  dest: number;
  timer: number;
  phase: number;
  dockA: number; // dock angle on current island
  dockA2: number; // dock angle waiting at the destination
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ez: number;
  tt: number;
  dur: number;
  rng: () => number;
}

/**
 * One bot occasionally rides a paper skiff between islands: wanders ashore,
 * walks to the rim, sails a gentle sagging arc to another island's edge,
 * hops off and wanders there. Lives in world space and adds each island's
 * bob offset manually (via islandBob) so it stays glued to the surface.
 */
export function Traveler({
  islands,
  reduced,
}: {
  islands: IslandSpec[];
  reduced: boolean;
}) {
  const botRef = useRef<THREE.Group>(null);
  const boatRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const sparkRef = useRef<THREE.Mesh>(null);
  const vRef = useRef<Voyage | null>(null);

  useFrame((state, rawDelta) => {
    const bot = botRef.current;
    const boat = boatRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    if (!bot || !boat || !body || !head || islands.length < 2) return;

    let v = vRef.current;
    if (!v) {
      const rng = mulberry32(424243);
      v = vRef.current = {
        mode: 'ashore',
        cur: 0,
        dest: 1,
        timer: 6 + rng() * 5,
        px: 0,
        pz: 0,
        tx: 0,
        tz: 0,
        heading: rng() * Math.PI * 2,
        phase: rng() * Math.PI * 2,
        dockA: rng() * Math.PI * 2,
        dockA2: 0,
        sx: 0,
        sy: 0,
        sz: 0,
        ex: 0,
        ez: 0,
        tt: 0,
        dur: 1,
        rng,
      };
      const isle0 = islands[0];
      v.px = Math.sin(v.dockA) * isle0.walkR * 0.6;
      v.pz = Math.cos(v.dockA) * isle0.walkR * 0.6;
      v.tx = 0;
      v.tz = 0;
    }

    const t = state.clock.elapsedTime;
    const isle = islands[v.cur];

    if (reduced) {
      // Static pose: bot idle on its island, boat docked, no sailing.
      const y0 = isle.y;
      bot.position.set(isle.x + v.px, y0, isle.z + v.pz);
      bot.rotation.y = v.heading;
      body.rotation.set(0, 0, 0);
      head.rotation.y = 0;
      boat.position.set(
        isle.x + Math.sin(v.dockA) * (isle.S + 0.42),
        y0 + 0.03,
        isle.z + Math.cos(v.dockA) * (isle.S + 0.42)
      );
      boat.rotation.set(0, v.dockA, 0);
      return;
    }

    const delta = Math.min(rawDelta, 0.1);

    if (v.mode === 'sail') {
      v.tt += delta / v.dur;
      const raw = Math.min(v.tt, 1);
      const e = raw * raw * (3 - 2 * raw); // smoothstep
      const to = islands[v.dest];
      const eyDyn = to.y + islandBob(t, to.index) + 0.05;
      const x = v.sx + (v.ex - v.sx) * e;
      const z = v.sz + (v.ez - v.sz) * e;
      const y = v.sy + (eyDyn - v.sy) * e - Math.sin(e * Math.PI) * 0.9;
      const headingY = Math.atan2(v.ex - v.sx, v.ez - v.sz);
      boat.position.set(x, y + Math.sin(t * 2.2) * 0.03, z);
      boat.rotation.set(0, headingY, Math.sin(t * 4.5) * 0.06);
      bot.position.set(x, y + 0.11, z);
      bot.rotation.y = headingY;
      body.rotation.set(0, 0, 0);
      head.rotation.y = Math.sin(t * 0.8) * 0.4; // look around while riding
      if (v.tt >= 1) {
        v.cur = v.dest;
        v.dockA = v.dockA2;
        v.mode = 'ashore';
        v.timer = 7 + v.rng() * 8;
        const ni = islands[v.cur];
        v.px = Math.sin(v.dockA) * Math.min(ni.walkR, ni.S * 0.8);
        v.pz = Math.cos(v.dockA) * Math.min(ni.walkR, ni.S * 0.8);
        const a = v.rng() * Math.PI * 2;
        const r = Math.sqrt(v.rng()) * ni.walkR;
        v.tx = Math.sin(a) * r;
        v.tz = Math.cos(a) * r;
      }
      return;
    }

    // Ashore or boarding: bot walks on the current island (world space, with bob).
    const bobY = islandBob(t, isle.index);
    const baseY = isle.y + bobY;
    let hopY = 0;
    let walking = false;

    if (v.mode === 'ashore') {
      v.timer -= delta;
      const arrived = stepToward(v, delta, 0.45, isle.walkR);
      walking = !arrived;
      if (arrived) {
        head.rotation.y = Math.sin(t * 0.9 + v.phase) * 0.5;
        if (v.timer > 0 && v.rng() < delta * 0.4) {
          const a = v.rng() * Math.PI * 2;
          const r = Math.sqrt(v.rng()) * isle.walkR;
          v.tx = Math.sin(a) * r;
          v.tz = Math.cos(a) * r;
        }
      }
      if (v.timer <= 0) {
        // Head for the rim where the skiff is docked.
        v.mode = 'board';
        v.tx = Math.sin(v.dockA) * isle.S * 0.92;
        v.tz = Math.cos(v.dockA) * isle.S * 0.92;
      }
    } else {
      // board
      const arrived = stepToward(v, delta, 0.5, null);
      walking = !arrived;
      if (arrived) {
        // Hop in and chart a course to a random other island.
        let dest = Math.floor(v.rng() * islands.length);
        if (dest === v.cur) dest = (dest + 1) % islands.length;
        v.dest = dest;
        const to = islands[dest];
        v.sx = isle.x + Math.sin(v.dockA) * (isle.S + 0.42);
        v.sz = isle.z + Math.cos(v.dockA) * (isle.S + 0.42);
        v.sy = baseY + 0.05;
        const eA = Math.atan2(isle.x - to.x, isle.z - to.z);
        v.dockA2 = eA;
        v.ex = to.x + Math.sin(eA) * (to.S + 0.42);
        v.ez = to.z + Math.cos(eA) * (to.S + 0.42);
        v.dur = Math.max(3.5, Math.hypot(v.ex - v.sx, v.ez - v.sz) / 1.8);
        v.tt = 0;
        v.mode = 'sail';
      }
    }

    if (walking) {
      body.rotation.z = Math.sin(t * 9 + v.phase) * 0.12;
      body.rotation.x = 0;
      head.rotation.y = 0;
      hopY = Math.abs(Math.sin(t * 9 + v.phase)) * 0.035;
    } else {
      body.rotation.set(0, 0, 0);
    }

    bot.position.set(isle.x + v.px, baseY + hopY, isle.z + v.pz);
    bot.rotation.y = v.heading;

    // Skiff bobs at the dock while its passenger is ashore.
    boat.position.set(
      isle.x + Math.sin(v.dockA) * (isle.S + 0.42),
      baseY + 0.03 + Math.sin(t * 1.5) * 0.04,
      isle.z + Math.cos(v.dockA) * (isle.S + 0.42)
    );
    boat.rotation.set(0, v.dockA, Math.sin(t * 1.1) * 0.04);
  });

  return (
    <group>
      <group ref={botRef}>
        <BotMesh
          bodyRef={bodyRef}
          headRef={headRef}
          sparkRef={sparkRef}
          accentMat={MAT.traveler}
        />
      </group>
      <group ref={boatRef}>
        <mesh geometry={GEO.hull} material={MAT.paper} castShadow />
        <mesh
          geometry={GEO.sail}
          material={MAT.paperShade}
          position={[0, 0.22, -0.05]}
          rotation={[0, Math.PI / 4, 0]}
          castShadow
        />
      </group>
    </group>
  );
}
