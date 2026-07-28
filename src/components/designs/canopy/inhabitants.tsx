import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  GEO,
  MAT,
  PULLEY_ANG,
  PULLEY_DIST,
  PULLEY_HIGH,
  PULLEY_LOW,
  PULLEY_Y,
  alignY,
  bridgePoint,
  mulberry32,
  radial,
  type BridgeSpec,
  type LadderSpec,
  type PerchSpec,
} from './common';

/* ============================== bot visual ============================= */

interface BotRefs {
  bodyRef: RefObject<THREE.Group | null>;
  headRef: RefObject<THREE.Group | null>;
  sparkRef?: RefObject<THREE.Mesh | null>;
}

/** Cone body, sphere head, stub arms, glowing antenna. ~0.5 units tall. */
export function BotMesh({
  bodyRef,
  headRef,
  sparkRef,
  accentMat,
}: BotRefs & { accentMat: THREE.Material }) {
  return (
    <group ref={bodyRef}>
      <mesh
        geometry={GEO.botBody}
        material={accentMat}
        position={[0, 0.2, 0]}
        castShadow
      />
      <mesh geometry={GEO.botArm} material={accentMat} position={[-0.165, 0.22, 0]} />
      <mesh geometry={GEO.botArm} material={accentMat} position={[0.165, 0.22, 0]} />
      <group ref={headRef} position={[0, 0.45, 0]}>
        <mesh geometry={GEO.botHead} material={MAT.botFace} castShadow />
        <mesh geometry={GEO.botEye} material={MAT.botEye} position={[-0.04, 0.017, 0.087]} />
        <mesh geometry={GEO.botEye} material={MAT.botEye} position={[0.04, 0.017, 0.087]} />
        <mesh geometry={GEO.antenna} material={MAT.metal} position={[0, 0.165, 0]} />
        <mesh geometry={GEO.antennaTip} material={MAT.lantern} position={[0, 0.25, 0]} />
      </group>
      {sparkRef && (
        <mesh
          ref={sparkRef}
          geometry={GEO.spark}
          material={MAT.spark}
          position={[0, 0.28, 0.28]}
          visible={false}
        />
      )}
    </group>
  );
}

/* ================================ walking ============================== */

interface Walker {
  px: number;
  pz: number;
  tx: number;
  tz: number;
  heading: number;
}

/** Turn toward the target and waddle forward. Returns true on arrival. */
function stepToward(
  w: Walker,
  delta: number,
  speed: number,
  clampR: number | null
): boolean {
  const dx = w.tx - w.px;
  const dz = w.tz - w.pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  const targetH = Math.atan2(dx, dz);
  let d = targetH - w.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  w.heading += d * Math.min(1, delta * 6);
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
  w.heading += d * Math.min(1, delta * 6);
}

/* ============================ deck residents =========================== */

/** Shared per-deck scratch: how many bots are hammering right now. */
export interface WorkCtx {
  workers: number;
}

type DeckState = 'wander' | 'idle' | 'work';

interface DeckBrain extends Walker {
  state: DeckState;
  timer: number;
  phase: number;
  atSite: boolean;
  hammering: boolean;
  rng: () => number;
}

/**
 * A bot that lives on one treehouse deck: wanders the boards, stops to look
 * around, and takes shifts at the deck's little workbench. Parented to the
 * deck group, so it rides the hover lift. All mutation is ref-based.
 */
export function DeckBot({
  perch,
  ctx,
  accentMat,
  seed,
  reduced,
}: {
  perch: PerchSpec;
  ctx: WorkCtx;
  accentMat: THREE.Material;
  seed: number;
  reduced: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const sparkRef = useRef<THREE.Mesh>(null);
  const brainRef = useRef<DeckBrain | null>(null);

  // Wander area is biased away from the hut, which sits on the trunk side.
  const walkR = perch.R * 0.4;
  const cx = perch.R * 0.24;
  const siteX = perch.R * 0.42;
  const siteZ = perch.R * 0.44;

  const enterWander = (b: DeckBrain) => {
    b.state = 'wander';
    const a = b.rng() * Math.PI * 2;
    const r = Math.sqrt(b.rng()) * walkR;
    b.tx = cx + Math.sin(a) * r;
    b.tz = Math.cos(a) * r;
  };

  useFrame((state, rawDelta) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    const spark = sparkRef.current;
    if (!root || !body || !head || !spark) return;

    let b = brainRef.current;
    if (!b) {
      const rng = mulberry32(seed * 7919 + 23);
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
      const r = Math.sqrt(rng()) * walkR;
      b.px = cx + Math.sin(a) * r;
      b.pz = Math.cos(a) * r;
    }

    const t = state.clock.elapsedTime;

    if (reduced) {
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
        if (stepToward(b, delta, 0.4, null)) {
          if (b.rng() < 0.5) {
            b.state = 'idle';
            b.timer = 2 + b.rng() * 4;
          } else {
            b.state = 'work';
            b.atSite = false;
            b.timer = 4 + b.rng() * 5;
            b.tx = siteX + (b.rng() - 0.5) * 0.2;
            b.tz = siteZ + (b.rng() - 0.5) * 0.2;
          }
        } else {
          body.rotation.z = Math.sin(t * 9 + b.phase) * 0.13;
          body.rotation.x = 0;
          head.rotation.y = 0;
          hopY = Math.abs(Math.sin(t * 9 + b.phase)) * 0.035;
        }
        break;
      }
      case 'idle': {
        b.timer -= delta;
        body.rotation.set(0, 0, 0);
        head.rotation.y = Math.sin(t * 0.9 + b.phase * 2) * 0.6;
        const j = Math.sin(t * 1.5 + b.phase * 5);
        hopY = j > 0 ? Math.pow(j, 14) * 0.1 : 0;
        if (b.timer <= 0) enterWander(b);
        break;
      }
      case 'work': {
        if (!b.atSite) {
          if (stepToward(b, delta, 0.42, null)) {
            b.atSite = true;
            b.hammering = true;
            ctx.workers += 1;
          } else {
            body.rotation.z = Math.sin(t * 9 + b.phase) * 0.13;
            hopY = Math.abs(Math.sin(t * 9 + b.phase)) * 0.035;
          }
        } else {
          turnToward(b, Math.atan2(siteX - b.px, siteZ - b.pz), delta);
          const swing = Math.sin(t * 7.5 + b.phase);
          body.rotation.x = Math.max(0, swing) * 0.5;
          body.rotation.z = 0;
          head.rotation.y = 0;
          sparkOn = swing > 0.93;
          b.timer -= delta;
          if (b.timer <= 0) {
            b.hammering = false;
            b.atSite = false;
            ctx.workers = Math.max(0, ctx.workers - 1);
            enterWander(b);
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
      <BotMesh
        bodyRef={bodyRef}
        headRef={headRef}
        sparkRef={sparkRef}
        accentMat={accentMat}
      />
    </group>
  );
}

/* ============================ bridge walkers =========================== */

interface Crossing {
  t: number;
  dir: 1 | -1;
  wait: number;
  phase: number;
  speed: number;
}

/** A bot pacing a rope bridge, pausing at each end to take in the view. */
export function BridgeWalker({
  bridge,
  accentMat,
  seed,
  reduced,
}: {
  bridge: BridgeSpec;
  accentMat: THREE.Material;
  seed: number;
  reduced: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stateRef = useRef<Crossing | null>(null);
  const here = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);

  useFrame((s, rawDelta) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    if (!root || !body || !head) return;

    let c = stateRef.current;
    if (!c) {
      const rng = mulberry32(seed * 613 + 7);
      c = stateRef.current = {
        t: rng(),
        dir: rng() < 0.5 ? 1 : -1,
        wait: 0,
        phase: rng() * Math.PI * 2,
        speed: (0.55 + rng() * 0.25) / bridge.len,
      };
    }

    const t = s.clock.elapsedTime;
    const delta = reduced ? 0 : Math.min(rawDelta, 0.1);

    if (delta > 0) {
      if (c.wait > 0) {
        c.wait -= delta;
      } else {
        c.t += c.dir * c.speed * delta;
        if (c.t >= 1) {
          c.t = 1;
          c.dir = -1;
          c.wait = 1.6 + ((seed * 37) % 5) * 0.4;
        } else if (c.t <= 0) {
          c.t = 0;
          c.dir = 1;
          c.wait = 1.6 + ((seed * 53) % 5) * 0.4;
        }
      }
    }

    bridgePoint(bridge, c.t, here);
    bridgePoint(bridge, THREE.MathUtils.clamp(c.t + 0.02 * c.dir, 0, 1), ahead);
    const walking = c.wait <= 0 && !reduced;
    const hop = walking ? Math.abs(Math.sin(t * 9 + c.phase)) * 0.04 : 0;
    root.position.set(here.x, here.y + 0.05 + hop, here.z);
    root.rotation.y = Math.atan2(ahead.x - here.x, ahead.z - here.z);
    body.rotation.z = walking ? Math.sin(t * 9 + c.phase) * 0.14 : 0;
    head.rotation.y = walking ? 0 : reduced ? 0 : Math.sin(t * 0.9 + c.phase) * 0.6;
  });

  return (
    <group ref={rootRef}>
      <BotMesh bodyRef={bodyRef} headRef={headRef} accentMat={accentMat} />
    </group>
  );
}

/* ============================ ladder climbers ========================== */

interface Climb {
  t: number;
  dir: 1 | -1;
  wait: number;
  phase: number;
  speed: number;
}

/** A bot working its way up and down a ladder. */
export function LadderClimber({
  ladder,
  accentMat,
  seed,
  reduced,
}: {
  ladder: LadderSpec;
  accentMat: THREE.Material;
  seed: number;
  reduced: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stateRef = useRef<Climb | null>(null);
  const pos = useMemo(() => new THREE.Vector3(), []);

  const faceY = useMemo(
    () => Math.atan2(-ladder.out.x, -ladder.out.z),
    [ladder]
  );

  useFrame((s, rawDelta) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    if (!root || !body || !head) return;

    let c = stateRef.current;
    if (!c) {
      const rng = mulberry32(seed * 911 + 3);
      c = stateRef.current = {
        t: rng(),
        dir: rng() < 0.5 ? 1 : -1,
        wait: rng() * 2,
        phase: rng() * Math.PI * 2,
        speed: 0.5 / ladder.len,
      };
    }

    const t = s.clock.elapsedTime;
    const delta = reduced ? 0 : Math.min(rawDelta, 0.1);

    if (delta > 0) {
      if (c.wait > 0) c.wait -= delta;
      else {
        c.t += c.dir * c.speed * delta;
        if (c.t >= 1) {
          c.t = 1;
          c.dir = -1;
          c.wait = 2.5;
        } else if (c.t <= 0) {
          c.t = 0;
          c.dir = 1;
          c.wait = 2.5;
        }
      }
    }

    pos.lerpVectors(ladder.bottom, ladder.top, c.t);
    const climbing = c.wait <= 0 && !reduced;
    root.position.set(
      pos.x + ladder.out.x * 0.19,
      pos.y - 0.02,
      pos.z + ladder.out.z * 0.19
    );
    root.rotation.y = faceY;
    body.rotation.z = climbing ? Math.sin(t * 6 + c.phase) * 0.18 : 0;
    body.rotation.x = climbing ? 0.12 : 0;
    head.rotation.y = climbing ? 0 : reduced ? 0 : Math.sin(t * 0.8 + c.phase) * 0.5;
  });

  return (
    <group ref={rootRef}>
      <BotMesh bodyRef={bodyRef} headRef={headRef} accentMat={accentMat} />
    </group>
  );
}

/* =============================== pulley rig ============================ */

interface Lift {
  y: number;
  target: number;
  wait: number;
}

/**
 * A rope-and-pulley hoist running from a high branch to the forest floor. The
 * basket ferries a bot (and a crate of planks) up to the half-built deck.
 */
export function PulleyRig({
  accentMat,
  reduced,
}: {
  accentMat: THREE.Material;
  reduced: boolean;
}) {
  const basketRef = useRef<THREE.Group>(null);
  const ropeRef = useRef<THREE.Mesh>(null);
  const wheelRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const liftRef = useRef<Lift | null>(null);

  const anchor = useMemo(() => radial(PULLEY_ANG, PULLEY_DIST, PULLEY_Y), []);
  const armFrom = useMemo(
    () => radial(PULLEY_ANG, 0.5, PULLEY_Y + 0.35),
    []
  );
  const armQ = useMemo(
    () => alignY(anchor.clone().sub(armFrom)),
    [anchor, armFrom]
  );
  const armLen = useMemo(() => anchor.distanceTo(armFrom), [anchor, armFrom]);

  useFrame((s, rawDelta) => {
    const basket = basketRef.current;
    const rope = ropeRef.current;
    const wheel = wheelRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    if (!basket || !rope || !body || !head) return;

    let l = liftRef.current;
    if (!l) l = liftRef.current = { y: PULLEY_LOW, target: PULLEY_HIGH, wait: 1 };

    const t = s.clock.elapsedTime;
    const delta = reduced ? 0 : Math.min(rawDelta, 0.1);

    if (delta > 0) {
      if (l.wait > 0) l.wait -= delta;
      else {
        const d = l.target - l.y;
        const step = Math.sign(d) * Math.min(Math.abs(d), 0.95 * delta);
        l.y += step;
        if (wheel) wheel.rotation.z -= step * 3;
        if (Math.abs(l.target - l.y) < 0.02) {
          l.y = l.target;
          l.target = l.target === PULLEY_HIGH ? PULLEY_LOW : PULLEY_HIGH;
          l.wait = 3;
        }
      }
    }

    const sway = reduced ? 0 : Math.sin(t * 1.3) * 0.035;
    basket.position.set(anchor.x, l.y, anchor.z);
    basket.rotation.z = sway;
    const len = Math.max(0.1, anchor.y - l.y - 0.22);
    rope.scale.y = len;
    rope.position.set(anchor.x, l.y + 0.22 + len / 2, anchor.z);
    body.rotation.z = 0;
    head.rotation.y = reduced ? 0 : Math.sin(t * 0.7) * 0.7;
  });

  return (
    <group>
      {/* arm out from the trunk + pulley wheel */}
      <mesh
        geometry={GEO.limb}
        material={MAT.barkDark}
        position={[armFrom.x, armFrom.y, armFrom.z]}
        quaternion={armQ}
        scale={[0.11, armLen, 0.11]}
        castShadow
      />
      <mesh
        ref={wheelRef}
        geometry={GEO.wheel}
        material={MAT.metal}
        position={[anchor.x, anchor.y - 0.06, anchor.z]}
        rotation={[0, PULLEY_ANG, 0]}
        castShadow
      />
      <mesh ref={ropeRef} geometry={GEO.rope} material={MAT.post} />

      <group ref={basketRef}>
        <mesh geometry={GEO.basket} material={MAT.plankDark} castShadow />
        <mesh
          geometry={GEO.basket}
          material={MAT.plank}
          position={[0, 0.06, 0]}
          scale={[0.86, 0.9, 0.86]}
        />
        <mesh
          geometry={GEO.crate}
          material={MAT.plank}
          position={[0.13, 0.28, -0.1]}
          rotation={[0, 0.4, 0]}
          castShadow
        />
        <group position={[-0.1, 0.14, 0.08]} scale={1.05}>
          <BotMesh bodyRef={bodyRef} headRef={headRef} accentMat={accentMat} />
        </group>
      </group>
    </group>
  );
}

/* ============================== build site ============================= */

interface BuilderBrain extends Walker {
  timer: number;
  phase: number;
  atSite: boolean;
  fetching: boolean;
  rng: () => number;
}

/**
 * A construction bot on the half-built deck: hammers at the frame, then walks
 * over to the plank stack and back. `ctx.workers` drives the growing structure.
 */
function Builder({
  ctx,
  accentMat,
  seed,
  reduced,
  R,
}: {
  ctx: WorkCtx;
  accentMat: THREE.Material;
  seed: number;
  reduced: boolean;
  R: number;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const sparkRef = useRef<THREE.Mesh>(null);
  const brainRef = useRef<BuilderBrain | null>(null);

  const stackX = -R * 0.5;
  const stackZ = R * 0.42;

  useFrame((s, rawDelta) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    const spark = sparkRef.current;
    if (!root || !body || !head || !spark) return;

    let b = brainRef.current;
    if (!b) {
      const rng = mulberry32(seed * 1237 + 11);
      b = brainRef.current = {
        px: 0,
        pz: 0,
        tx: 0,
        tz: 0,
        heading: rng() * Math.PI * 2,
        timer: 3 + rng() * 3,
        phase: rng() * Math.PI * 2,
        atSite: false,
        fetching: false,
        rng,
      };
    }

    const t = s.clock.elapsedTime;

    if (reduced) {
      // Frozen mid-job: the frame stops growing because workers drops to 0.
      root.position.set(b.px, 0, b.pz);
      root.rotation.y = b.heading;
      body.rotation.set(0, 0, 0);
      head.rotation.y = 0;
      spark.visible = false;
      ctx.workers = 0;
      return;
    }

    const delta = Math.min(rawDelta, 0.1);
    let hopY = 0;
    let sparkOn = false;

    if (!b.atSite) {
      if (stepToward(b, delta, 0.4, null)) {
        b.atSite = true;
        b.timer = b.fetching ? 1.2 + b.rng() * 1.2 : 5 + b.rng() * 4;
        if (!b.fetching) ctx.workers += 1;
      } else {
        body.rotation.z = Math.sin(t * 9 + b.phase) * 0.13;
        body.rotation.x = 0;
        hopY = Math.abs(Math.sin(t * 9 + b.phase)) * 0.035;
      }
    } else {
      b.timer -= delta;
      if (b.fetching) {
        // loading planks: gentle bob
        body.rotation.x = Math.sin(t * 3 + b.phase) * 0.2;
        head.rotation.y = 0;
      } else {
        turnToward(b, Math.atan2(0 - b.px, 0 - b.pz), delta);
        const swing = Math.sin(t * 8 + b.phase);
        body.rotation.x = Math.max(0, swing) * 0.55;
        sparkOn = swing > 0.92;
      }
      if (b.timer <= 0) {
        if (!b.fetching) ctx.workers = Math.max(0, ctx.workers - 1);
        b.fetching = !b.fetching;
        b.atSite = false;
        if (b.fetching) {
          b.tx = stackX + (b.rng() - 0.5) * 0.2;
          b.tz = stackZ + (b.rng() - 0.5) * 0.2;
        } else {
          const a = b.rng() * Math.PI * 2;
          b.tx = Math.sin(a) * R * 0.35;
          b.tz = Math.cos(a) * R * 0.35;
        }
      }
    }

    root.position.set(b.px, hopY, b.pz);
    root.rotation.y = b.heading;
    spark.visible = sparkOn;
  });

  return (
    <group ref={rootRef}>
      <BotMesh
        bodyRef={bodyRef}
        headRef={headRef}
        sparkRef={sparkRef}
        accentMat={accentMat}
      />
    </group>
  );
}

/**
 * The eighth platform: a frame of scaffolding, a half-laid deck and two bots
 * building it. The stack of boards grows while anyone is hammering, then the
 * next course starts — the tree is visibly still growing.
 */
export function BuildSite({
  R,
  reduced,
  accentMat,
}: {
  R: number;
  reduced: boolean;
  accentMat: THREE.Material;
}) {
  const ctx = useRef<WorkCtx>({ workers: 0 }).current;
  const growRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0.18);

  useFrame((_, delta) => {
    const m = growRef.current;
    if (!m) return;
    if (!reduced && ctx.workers > 0) {
      progress.current += Math.min(delta, 0.1) * 0.03;
      if (progress.current > 1) progress.current = 0.18;
    }
    m.scale.y = progress.current;
  });

  const planks = useMemo(() => {
    const out: { x: number; w: number }[] = [];
    // A half-laid deck: boards only on one side of the frame.
    for (let i = 0; i < 5; i++) {
      const x = -R * 0.85 + i * (R * 0.32);
      out.push({ x, w: 2 * Math.sqrt(Math.max(0.02, R * R - x * x)) });
    }
    return out;
  }, [R]);

  return (
    <group>
      {/* joists */}
      <mesh
        geometry={GEO.beam}
        material={MAT.plankDark}
        position={[0, -0.06, -R * 0.5]}
        scale={[(R * 1.6) / 1.5, 1, 1]}
        castShadow
      />
      <mesh
        geometry={GEO.beam}
        material={MAT.plankDark}
        position={[0, -0.06, R * 0.5]}
        scale={[(R * 1.6) / 1.5, 1, 1]}
        castShadow
      />
      {/* laid boards */}
      {planks.map((p, i) => (
        <mesh
          key={`bp${i}`}
          geometry={GEO.plank}
          material={MAT.plank}
          position={[p.x, 0, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[p.w / 0.54, 1, 1.35]}
          castShadow
          receiveShadow
        />
      ))}
      {/* scaffolding */}
      {[
        [-R * 0.8, -R * 0.6],
        [R * 0.8, -R * 0.6],
        [-R * 0.8, R * 0.6],
        [R * 0.8, R * 0.6],
      ].map(([x, z], i) => (
        <mesh
          key={`sp${i}`}
          geometry={GEO.post}
          material={MAT.post}
          position={[x, 0.45, z]}
          castShadow
        />
      ))}
      <mesh
        geometry={GEO.beam}
        material={MAT.post}
        position={[0, 0.88, -R * 0.6]}
        scale={[(R * 1.6) / 1.5, 1, 1]}
        castShadow
      />
      <mesh
        geometry={GEO.beam}
        material={MAT.post}
        position={[0, 0.88, R * 0.6]}
        scale={[(R * 1.6) / 1.5, 1, 1]}
        castShadow
      />
      <mesh
        geometry={GEO.beam}
        material={MAT.post}
        position={[R * 0.8, 0.88, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[(R * 1.2) / 1.5, 1, 1]}
        castShadow
      />
      {/* the course being built — grows while a bot is hammering */}
      <mesh
        ref={growRef}
        geometry={GEO.stack}
        material={MAT.plank}
        position={[0, 0.04, 0]}
        scale={[1, 0.18, 1]}
        castShadow
      />
      {/* diagonal braces — unmistakably a building site */}
      {[
        [-R * 0.8, -R * 0.6, 0.5],
        [R * 0.8, R * 0.6, -0.5],
      ].map(([x, z, tilt], i) => (
        <mesh
          key={`bx${i}`}
          geometry={GEO.post}
          material={MAT.plankDark}
          position={[x * 0.5, 0.5, z * 0.5]}
          rotation={[0, i * Math.PI, tilt]}
          scale={[1, 1.5, 1]}
          castShadow
        />
      ))}
      {/* boards leaning against the frame, waiting to be laid */}
      <mesh
        geometry={GEO.plank}
        material={MAT.plank}
        position={[R * 0.55, 0.42, -R * 0.35]}
        rotation={[0, 0.5, 1.15]}
        scale={[2.6, 1, 1.4]}
        castShadow
      />
      <mesh
        geometry={GEO.plank}
        material={MAT.plankDark}
        position={[R * 0.62, 0.42, -R * 0.15]}
        rotation={[0, 0.35, 1.2]}
        scale={[2.6, 1, 1.4]}
        castShadow
      />

      {/* plank stack + toolbox */}
      <group position={[-R * 0.5, 0, R * 0.42]}>
        <mesh geometry={GEO.crate} material={MAT.plankDark} position={[0, 0.13, 0]} castShadow />
        <mesh
          geometry={GEO.crate}
          material={MAT.plank}
          position={[0.04, 0.34, 0.02]}
          rotation={[0, 0.3, 0]}
          scale={0.9}
          castShadow
        />
      </group>

      <Builder ctx={ctx} accentMat={accentMat} seed={3} reduced={reduced} R={R} />
      <Builder ctx={ctx} accentMat={accentMat} seed={8} reduced={reduced} R={R} />
    </group>
  );
}
