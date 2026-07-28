import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Html, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  BUILD_ANG,
  BUILD_DIST_GAP,
  BUILD_R,
  BUILD_Y,
  GEO,
  MAT,
  ROOST_R,
  ROOST_Y,
  alignY,
  bridgePoint,
  buildBridges,
  buildDecoLimbs,
  buildFoliage,
  buildGround,
  buildLadders,
  buildPerches,
  fmtLoc,
  radial,
  trunkR,
  type BridgeSpec,
  type CanopyProject,
  type LadderSpec,
  type PerchSpec,
  type Placement,
} from './common';
import {
  Buds,
  Clouds,
  DecoLimbs,
  FallingLeaves,
  Ground,
  InstancedStatic,
  Limb,
  Trunk,
} from './tree';
import {
  BotMesh,
  BridgeWalker,
  BuildSite,
  DeckBot,
  LadderClimber,
  PulleyRig,
  type WorkCtx,
} from './inhabitants';

const FONT = '/fonts/LiberationSans-Regular.ttf';

/**
 * Base material for the world signs. troika derives its own shader from this,
 * so depthTest has to live on the base material — setting it on the derived
 * one gets clobbered on the next text sync.
 */
const SIGN_MAT = new THREE.MeshBasicMaterial({
  color: '#4a3527',
  depthTest: false,
  transparent: true,
  toneMapped: false,
});

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

/** Shared hover bookkeeping so the scene can pause its idle auto-rotate. */
interface HoverCtx {
  hover: number;
}

const UP = new THREE.Vector3(0, 1, 0);

function eulerAlignY(dir: THREE.Vector3): [number, number, number] {
  const q = new THREE.Quaternion().setFromUnitVectors(
    UP,
    dir.clone().normalize()
  );
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
}

/* ================================ labels =============================== */

const labelStyle: CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '2px',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  color: '#43405a',
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid rgba(67, 64, 90, 0.12)',
  borderRadius: '14px',
  padding: '8px 16px',
  boxShadow: '0 8px 22px rgba(67, 64, 90, 0.2)',
  textAlign: 'center',
};

const labelTitleStyle: CSSProperties = {
  fontSize: '15px',
  fontWeight: 750,
  lineHeight: 1.25,
};

const labelTechStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#8b8699',
  lineHeight: 1.3,
  letterSpacing: '0.02em',
};

const labelSubStyle: CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 700,
  lineHeight: 1.3,
};

/* ============================== world signs ============================ */

/**
 * Carved lettering that floats with the thing it names. Outlined and drawn
 * without depth testing so it stays readable against leaves or sky, whichever
 * way the tree happens to be turned.
 */
function WorldSign({
  position,
  text,
  scale = 1,
  color = '#4a3527',
}: {
  position: [number, number, number];
  text: string;
  scale?: number;
  color?: string;
}) {
  return (
    <Suspense fallback={null}>
      <Billboard position={position}>
        <Text
          font={FONT}
          material={SIGN_MAT}
          fontSize={0.28 * scale}
          color={color}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.07}
          outlineWidth={0.055 * scale}
          outlineColor="#fdf6e6"
          outlineOpacity={0.96}
          renderOrder={21}
        >
          {text}
        </Text>
      </Billboard>
    </Suspense>
  );
}

/* =============================== treehouse ============================= */

function Treehouse({
  perch,
  reduced,
  hoverCtx,
}: {
  perch: PerchSpec;
  reduced: boolean;
  hoverCtx: HoverCtx;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const gemRef = useRef<THREE.Group>(null);
  const flagRef = useRef<THREE.Mesh>(null);
  const liftRef = useRef(0);
  const [hovered, setHovered] = useState(false);
  const workCtx = useRef<WorkCtx>({ workers: 0 }).current;

  const R = perch.R;
  const hs = R * 0.7;

  const accentMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: perch.accent,
        flatShading: true,
        roughness: 0.6,
        emissive: perch.accent,
        emissiveIntensity: 0,
      }),
    [perch.accent]
  );
  const gemMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: perch.accent,
        emissive: perch.accent,
        emissiveIntensity: 0.3,
        flatShading: true,
        roughness: 0.3,
      }),
    [perch.accent]
  );
  const deckMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e8c79a',
        flatShading: true,
        roughness: 0.9,
        emissive: '#fff3d6',
        emissiveIntensity: 0,
      }),
    []
  );

  const posts = useMemo<Placement[]>(() => {
    const out: Placement[] = [];
    const n = R > 1.2 ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({
        p: [Math.cos(a) * R * 0.95, 0.16, Math.sin(a) * R * 0.95],
        r: [0, -a, 0],
      });
    }
    return out;
  }, [R]);

  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = 'pointer';
    hoverCtx.hover += 1;
    return () => {
      document.body.style.cursor = 'auto';
      hoverCtx.hover -= 1;
    };
  }, [hovered, hoverCtx]);

  useFrame((state, delta) => {
    const g = rootRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    liftRef.current = THREE.MathUtils.lerp(
      liftRef.current,
      hovered ? 0.26 : 0,
      Math.min(1, delta * 6)
    );
    const sway = reduced ? 0 : Math.sin(t * 0.55 + perch.rank * 1.3) * 0.035;
    g.position.y = perch.y + liftRef.current + sway;
    g.rotation.z = reduced ? 0 : Math.sin(t * 0.42 + perch.rank) * 0.008;

    const gem = gemRef.current;
    if (gem && !reduced) {
      gem.rotation.y += delta * 0.8;
      gem.position.y = 0.92 + Math.sin(t * 1.5 + perch.rank * 2) * 0.05;
    }
    const flag = flagRef.current;
    if (flag && !reduced) flag.rotation.y = Math.sin(t * 2.2 + perch.rank) * 0.22;

    gemMat.emissiveIntensity = THREE.MathUtils.lerp(
      gemMat.emissiveIntensity,
      hovered ? 1.15 : 0.3,
      0.12
    );
    accentMat.emissiveIntensity = THREE.MathUtils.lerp(
      accentMat.emissiveIntensity,
      hovered ? 0.42 : 0,
      0.12
    );
    deckMat.emissiveIntensity = THREE.MathUtils.lerp(
      deckMat.emissiveIntensity,
      hovered ? 0.28 : 0,
      0.12
    );
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta <= 6) window.location.assign(`/projects/${perch.id}/`);
  };

  return (
    <group
      ref={rootRef}
      position={[perch.x, perch.y, perch.z]}
      rotation={[0, -perch.ang, 0]}
    >
      {/* deck */}
      <mesh
        geometry={GEO.deck}
        material={MAT.plankDark}
        position={[0, -0.08, 0]}
        scale={[R, 1, R]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={GEO.deckTop}
        material={deckMat}
        position={[0, 0.01, 0]}
        scale={[R * 1.02, 1, R * 1.02]}
        receiveShadow
      />
      {/* railing */}
      <mesh
        geometry={GEO.rail}
        material={MAT.post}
        position={[0, 0.32, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[R * 0.95, R * 0.95, 1]}
        castShadow
      />
      <InstancedStatic geometry={GEO.railPost} material={MAT.post} items={posts} />

      {/* hut */}
      <group position={[-R * 0.4, 0, 0]} scale={hs}>
        <mesh geometry={GEO.hutBody} material={MAT.cream} position={[0, 0.4, 0]} castShadow />
        <mesh
          geometry={GEO.hutRoof}
          material={accentMat}
          position={[0, 1.04, 0]}
          rotation={[0, Math.PI / 4, 0]}
          castShadow
        />
        <mesh geometry={GEO.door} material={MAT.plankDark} position={[0.51, 0.21, 0]} rotation={[0, Math.PI / 2, 0]} />
        <mesh geometry={GEO.window} material={MAT.window} position={[0.51, 0.55, 0.26]} rotation={[0, Math.PI / 2, 0]} />
        <mesh geometry={GEO.window} material={MAT.window} position={[0, 0.5, 0.46]} scale={0.8} />
        <mesh geometry={GEO.chimney} material={MAT.stone} position={[-0.24, 1.24, 0.16]} castShadow />
      </group>

      {/* accent gem on a post — this project's colour, read from anywhere */}
      <group position={[R * 0.4, 0, -R * 0.44]}>
        <mesh
          geometry={GEO.pole}
          material={MAT.post}
          position={[0, 0.36, 0]}
          scale={[1, 0.72, 1]}
          castShadow
        />
        <group ref={gemRef} position={[0, 0.92, 0]} scale={0.55 + R * 0.24}>
          <mesh geometry={GEO.gem} material={gemMat} castShadow />
        </group>
      </group>

      {/* workbench the residents take shifts at */}
      <group position={[R * 0.42, 0, R * 0.44]}>
        <mesh geometry={GEO.crate} material={MAT.plankDark} position={[0, 0.13, 0]} castShadow />
        <mesh
          geometry={GEO.crate}
          material={MAT.plank}
          position={[0.03, 0.32, 0.02]}
          rotation={[0, 0.4, 0]}
          scale={0.75}
          castShadow
        />
      </group>

      {/* featured projects fly a pennant */}
      {perch.featured && (
        <group position={[-R * 0.05, 0, R * 0.72]}>
          <mesh
            geometry={GEO.pole}
            material={MAT.post}
            position={[0, 0.55, 0]}
            scale={[1, 1.1, 1]}
            castShadow
          />
          <mesh
            ref={flagRef}
            geometry={GEO.flag}
            material={accentMat}
            position={[0.2, 0.96, 0]}
            castShadow
          />
        </group>
      )}

      {/* hanging lantern */}
      <group position={[R * 0.05, 0.5, -R * 0.78]}>
        <mesh geometry={GEO.lantern} material={MAT.lantern} />
        <mesh geometry={GEO.lanternGlow} material={MAT.lanternGlow} />
      </group>

      {/* residents */}
      {Array.from({ length: perch.bots }, (_, k) => (
        <DeckBot
          key={k}
          perch={perch}
          ctx={workCtx}
          accentMat={accentMat}
          seed={perch.rank * 41 + k * 13 + 5}
          reduced={reduced}
        />
      ))}

      {/* generous invisible hit target */}
      <mesh
        geometry={GEO.hit}
        scale={[R * 1.45, R * 1.1 + 0.7, R * 1.45]}
        position={[0, 0.55, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={onClick}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {hovered && (
        <Html
          center
          position={[0, R * 0.5 + 2.05, 0]}
          distanceFactor={19}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={labelStyle}>
            <span style={labelTitleStyle}>
              {perch.featured ? '★ ' : ''}
              {perch.title}
            </span>
            <span style={labelTechStyle}>
              {perch.tech.slice(0, 3).join(' · ')}
            </span>
            <span style={{ ...labelSubStyle, color: perch.accent }}>
              {fmtLoc(perch.loc)} lines · click to visit
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ============================== rope bridge ============================ */

function Bridge({ bridge }: { bridge: BridgeSpec }) {
  const ropes = useMemo(() => {
    const N = 20;
    const pts: THREE.Vector3[] = [];
    const scratch = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      pts.push(bridgePoint(bridge, i / N, scratch).clone());
    }
    const dir = bridge.b.clone().sub(bridge.a).setY(0).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize().multiplyScalar(0.3);

    const verts: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3) => {
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    for (const sgn of [1, -1]) {
      for (let i = 0; i < N; i++) {
        // handrail
        tmpA.copy(pts[i]).addScaledVector(side, sgn).setY(pts[i].y + 0.52);
        tmpB.copy(pts[i + 1]).addScaledVector(side, sgn).setY(pts[i + 1].y + 0.52);
        push(tmpA, tmpB);
        // deck rope
        tmpA.copy(pts[i]).addScaledVector(side, sgn);
        tmpB.copy(pts[i + 1]).addScaledVector(side, sgn);
        push(tmpA, tmpB);
      }
      // vertical hangers
      for (let i = 0; i <= N; i += 3) {
        tmpA.copy(pts[i]).addScaledVector(side, sgn);
        tmpB.copy(tmpA).setY(tmpA.y + 0.52);
        push(tmpA, tmpB);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return new THREE.LineSegments(geo, MAT.rope);
  }, [bridge]);

  useEffect(() => () => ropes.geometry.dispose(), [ropes]);

  return <primitive object={ropes} />;
}

/** Every bridge's deck boards, batched into one instanced draw. */
function BridgePlanks({ bridges }: { bridges: BridgeSpec[] }) {
  const items = useMemo<Placement[]>(() => {
    const out: Placement[] = [];
    const here = new THREE.Vector3();
    const next = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    for (const b of bridges) {
      for (let i = 0; i <= b.planks; i++) {
        const t = i / b.planks;
        bridgePoint(b, t, here);
        bridgePoint(b, Math.min(1, t + 0.02), next);
        if (i === b.planks) {
          bridgePoint(b, t - 0.02, next);
          next.sub(here).multiplyScalar(-1).add(here);
        }
        m.lookAt(here, next, UP);
        e.setFromRotationMatrix(m);
        out.push({
          p: [here.x, here.y, here.z],
          r: [e.x, e.y, e.z],
          s: [1.08, 1, 1],
        });
      }
    }
    return out;
  }, [bridges]);

  return (
    <InstancedStatic
      geometry={GEO.plank}
      material={MAT.plank}
      items={items}
      castShadow
      receiveShadow
    />
  );
}

/* ================================ ladder =============================== */

function Ladder({ ladder }: { ladder: LadderSpec }) {
  const { q, mid, len, rungs } = useMemo(() => {
    const dir = ladder.top.clone().sub(ladder.bottom);
    const len = dir.length();
    const mid = ladder.bottom.clone().add(ladder.top).multiplyScalar(0.5);
    const rungRot = eulerAlignY(ladder.side);
    const items: Placement[] = [];
    for (let i = 0; i <= ladder.rungs; i++) {
      const t = (i + 0.35) / (ladder.rungs + 1);
      items.push({
        p: [
          ladder.bottom.x + dir.x * t,
          ladder.bottom.y + dir.y * t,
          ladder.bottom.z + dir.z * t,
        ],
        r: rungRot,
        s: [1, ladder.width, 1],
      });
    }
    return { q: alignY(dir), mid, len, rungs: items };
  }, [ladder]);

  const half = ladder.width / 2;

  return (
    <group>
      {[1, -1].map((sgn) => (
        <mesh
          key={sgn}
          geometry={GEO.ladderRail}
          material={MAT.post}
          position={[
            mid.x + ladder.side.x * half * sgn,
            mid.y,
            mid.z + ladder.side.z * half * sgn,
          ]}
          quaternion={q}
          scale={[1, len, 1]}
          castShadow
        />
      ))}
      <InstancedStatic geometry={GEO.rung} material={MAT.post} items={rungs} />
    </group>
  );
}

/* ============================= Ethan's roost =========================== */

function Roost({
  reduced,
  hoverCtx,
}: {
  reduced: boolean;
  hoverCtx: HoverCtx;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const flagRef = useRef<THREE.Mesh>(null);
  const scopeRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const liftRef = useRef(0);

  const keeperMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f0c75e',
        flatShading: true,
        roughness: 0.6,
      }),
    []
  );
  const roofMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ec8a6f',
        flatShading: true,
        roughness: 0.85,
        emissive: '#ec8a6f',
        emissiveIntensity: 0,
      }),
    []
  );

  const posts = useMemo<Placement[]>(() => {
    const out: Placement[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      out.push({
        p: [Math.cos(a) * ROOST_R * 0.95, 0.18, Math.sin(a) * ROOST_R * 0.95],
        r: [0, -a, 0],
        s: [1, 1.15, 1],
      });
    }
    return out;
  }, []);

  const braces = useMemo(
    () =>
      [0.4, 1.9, 3.4, 4.9].map((a, i) => ({
        key: `br${i}`,
        from: radial(a, trunkR(ROOST_Y - 1.5) - 0.05, ROOST_Y - 1.5),
        to: radial(a, ROOST_R - 0.3, ROOST_Y - 0.14),
      })),
    []
  );

  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = 'pointer';
    hoverCtx.hover += 1;
    return () => {
      document.body.style.cursor = 'auto';
      hoverCtx.hover -= 1;
    };
  }, [hovered, hoverCtx]);

  useFrame((state, delta) => {
    const g = rootRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    liftRef.current = THREE.MathUtils.lerp(
      liftRef.current,
      hovered ? 0.2 : 0,
      Math.min(1, delta * 6)
    );
    g.position.y = ROOST_Y + liftRef.current;
    if (!reduced) {
      if (flagRef.current) flagRef.current.rotation.y = Math.sin(t * 2) * 0.25;
      if (scopeRef.current) {
        scopeRef.current.rotation.y = Math.sin(t * 0.22) * 0.7;
        scopeRef.current.rotation.x = -0.75 + Math.sin(t * 0.3) * 0.12;
      }
      if (bodyRef.current) bodyRef.current.rotation.z = Math.sin(t * 1.1) * 0.05;
      if (headRef.current) headRef.current.rotation.y = Math.sin(t * 0.6) * 0.7;
    }
    roofMat.emissiveIntensity = THREE.MathUtils.lerp(
      roofMat.emissiveIntensity,
      hovered ? 0.35 : 0,
      0.12
    );
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta <= 6) window.location.assign('#about');
  };

  return (
    <>
      {braces.map((b) => (
        <Limb key={b.key} from={b.from} to={b.to} r={0.1} />
      ))}
      <group ref={rootRef} position={[0, ROOST_Y, 0]}>
        <mesh
          geometry={GEO.deck}
          material={MAT.plankDark}
          position={[0, -0.09, 0]}
          scale={[ROOST_R, 1.15, ROOST_R]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={GEO.deckTop}
          material={MAT.plank}
          position={[0, 0.02, 0]}
          scale={[ROOST_R * 1.02, 1, ROOST_R * 1.02]}
          receiveShadow
        />
        <mesh
          geometry={GEO.rail}
          material={MAT.post}
          position={[0, 0.36, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[ROOST_R * 0.95, ROOST_R * 0.95, 1]}
          castShadow
        />
        <InstancedStatic geometry={GEO.railPost} material={MAT.post} items={posts} />

        {/* the keeper's cabin */}
        <group position={[-1.05, 0, 0.35]} rotation={[0, 0.5, 0]} scale={1.35}>
          <mesh geometry={GEO.hutBody} material={MAT.cream} position={[0, 0.42, 0]} castShadow />
          <mesh
            geometry={GEO.hutRoof}
            material={roofMat}
            position={[0, 1.08, 0]}
            rotation={[0, Math.PI / 4, 0]}
            scale={1.06}
            castShadow
          />
          <mesh geometry={GEO.chimney} material={MAT.stone} position={[-0.28, 1.3, 0.2]} scale={[1, 1.3, 1]} castShadow />
          <mesh geometry={GEO.door} material={MAT.plankDark} position={[0.51, 0.22, 0.05]} rotation={[0, Math.PI / 2, 0]} />
          <mesh geometry={GEO.window} material={MAT.window} position={[0.51, 0.56, -0.28]} rotation={[0, Math.PI / 2, 0]} />
          <mesh geometry={GEO.window} material={MAT.window} position={[0, 0.52, 0.46]} />
        </group>

        {/* telescope on a tripod, sweeping the sky */}
        <group position={[1.2, 0, 0.9]} scale={1.3}>
          <mesh geometry={GEO.pole} material={MAT.post} position={[0, 0.3, 0]} scale={[1, 0.6, 1]} rotation={[0.2, 0, 0.16]} castShadow />
          <mesh geometry={GEO.pole} material={MAT.post} position={[0, 0.3, 0]} scale={[1, 0.6, 1]} rotation={[-0.2, 0, -0.16]} castShadow />
          <group ref={scopeRef} position={[0, 0.62, 0]} rotation={[-0.75, 0, 0]}>
            <mesh geometry={GEO.scope} material={MAT.metal} castShadow />
            <mesh geometry={GEO.lantern} material={MAT.cream} position={[0, 0.34, 0]} scale={0.8} />
          </group>
        </group>

        {/* flag */}
        <group position={[0.35, 0, -1.45]}>
          <mesh geometry={GEO.pole} material={MAT.post} position={[0, 0.9, 0]} scale={[1.3, 1.8, 1.3]} castShadow />
          <mesh
            ref={flagRef}
            geometry={GEO.flag}
            material={keeperMat}
            position={[0.28, 1.6, 0]}
            scale={1.5}
            castShadow
          />
        </group>

        {/* lanterns */}
        {[0.9, 2.6, 4.3, 5.7].map((a, i) => (
          <group
            key={`ln${i}`}
            position={[Math.cos(a) * ROOST_R * 0.88, 0.52, Math.sin(a) * ROOST_R * 0.88]}
          >
            <mesh geometry={GEO.lantern} material={MAT.lantern} scale={1.1} />
            <mesh geometry={GEO.lanternGlow} material={MAT.lanternGlow} scale={1.2} />
          </group>
        ))}
        <pointLight position={[0, 0.9, 0]} color="#ffce7d" intensity={6} distance={5.5} decay={2} />

        {/* the keeper */}
        <group position={[0.7, 0, -0.35]} rotation={[0, -1.1, 0]} scale={1.15}>
          <BotMesh bodyRef={bodyRef} headRef={headRef} accentMat={keeperMat} />
        </group>

        {/* sign */}
        <WorldSign position={[0, 2.1, 0]} text="ETHAN'S ROOST" scale={1.25} />

        <mesh
          geometry={GEO.hit}
          scale={[ROOST_R * 1.15, 1.6, ROOST_R * 1.15]}
          position={[0, 0.8, 0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
          onClick={onClick}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {hovered && (
          <Html
            center
            position={[0, 2.9, 0]}
            distanceFactor={19}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div style={labelStyle}>
              <span style={labelTitleStyle}>Ethan's Roost</span>
              <span style={labelTechStyle}>
                Software engineer &amp; agentic engineer
              </span>
              <span style={{ ...labelSubStyle, color: '#c99a2e' }}>
                click to read about me
              </span>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

/* ============================== framing rig ============================ */

/** Roughly the box the whole tree occupies, used to fit it in frame. */
const TREE_H = 20.5;
const TREE_W = 11.8;

/**
 * Re-frames the tree whenever the canvas changes shape. A tall narrow phone
 * viewport sees far less width at the same distance, so the camera pulls back
 * and the orbit centre rides up above the hero card.
 */
function FrameRig({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const portrait = aspect < 1.05;
    // On a phone the hero card owns the bottom half, so the tree is fitted
    // into the top of the frame instead of the middle.
    const heightShare = portrait ? 0.52 : 1;
    const centreAt = portrait ? 0.27 : 0.46;

    const visible = Math.max(
      TREE_H / heightShare,
      TREE_W / Math.max(0.3, aspect)
    );
    const dist = visible / (2 * Math.tan(THREE.MathUtils.degToRad(45) / 2));
    const targetY = TREE_H / 2 - visible * (0.5 - centreAt);
    const polar = 1.465;

    const c = controlsRef.current;
    const off = new THREE.Vector3().subVectors(
      camera.position,
      c ? c.target : new THREE.Vector3(0, targetY, 0)
    );
    const az = off.lengthSq() > 1e-4 ? Math.atan2(off.x, off.z) : 0.25;
    camera.position.set(
      Math.sin(az) * Math.sin(polar) * dist,
      targetY + Math.cos(polar) * dist,
      Math.cos(az) * Math.sin(polar) * dist
    );
    if (c) {
      c.target.set(0, targetY, 0);
      c.update();
    }
    // Keep the haze proportional to how far back we had to stand.
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = dist * 0.95;
      fog.far = dist * 2.6;
    }
  }, [size.width, size.height, camera, scene, controlsRef]);

  return null;
}

/* ============================ the growing site ========================= */

function GrowingSite({ reduced }: { reduced: boolean }) {
  const site = useMemo(
    () => radial(BUILD_ANG, trunkR(BUILD_Y) + BUILD_DIST_GAP + BUILD_R, BUILD_Y),
    []
  );
  const limbFrom = useMemo(
    () => radial(BUILD_ANG, trunkR(BUILD_Y - 0.85) - 0.12, BUILD_Y - 0.85),
    []
  );
  const limbTo = useMemo(
    () => new THREE.Vector3(site.x, site.y - 0.14, site.z),
    [site]
  );
  const builderMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f5a25d',
        flatShading: true,
        roughness: 0.6,
      }),
    []
  );

  return (
    <group>
      <Limb from={limbFrom} to={limbTo} r={0.21} />
      <group position={[site.x, site.y, site.z]} rotation={[0, -BUILD_ANG, 0]}>
        <BuildSite R={BUILD_R} reduced={reduced} accentMat={builderMat} />
        <WorldSign
          position={[0, 1.9, 0]}
          text="PLATFORM 08 · GROWING"
          scale={0.95}
        />
      </group>
    </group>
  );
}

/* ================================= scene =============================== */

function Scene({ projects }: { projects: CanopyProject[] }) {
  const reduced = usePrefersReducedMotion();
  const perches = useMemo(() => buildPerches(projects), [projects]);
  const bridges = useMemo(() => buildBridges(perches), [perches]);
  const ladders = useMemo(() => buildLadders(perches), [perches]);
  const limbs = useMemo(() => buildDecoLimbs(), []);
  const foliage = useMemo(() => buildFoliage(perches, limbs), [perches, limbs]);
  const scatter = useMemo(() => buildGround(), []);

  const branches = useMemo(
    () =>
      perches.map((p) => ({
        key: p.id,
        from: radial(p.ang, trunkR(p.y - 1.0) - 0.14, p.y - 1.0),
        to: new THREE.Vector3(p.x, p.y - 0.13, p.z),
        r: 0.13 + p.R * 0.08,
      })),
    [perches]
  );

  const walkerMats = useMemo(
    () =>
      perches.map(
        (p) =>
          new THREE.MeshStandardMaterial({
            color: p.accent,
            flatShading: true,
            roughness: 0.6,
          })
      ),
    [perches]
  );
  const riderMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#6cc4d9',
        flatShading: true,
        roughness: 0.6,
      }),
    []
  );

  const hoverCtx = useRef<HoverCtx>({ hover: 0 }).current;
  const controlsRef = useRef<any>(null);
  const draggingRef = useRef(false);
  const coolRef = useRef(0);

  useFrame((_, delta) => {
    const c = controlsRef.current;
    if (!c) return;
    const busy = draggingRef.current || hoverCtx.hover > 0;
    coolRef.current = busy ? 4 : Math.max(0, coolRef.current - delta);
    c.autoRotate = !reduced && !busy && coolRef.current <= 0;
  });

  return (
    <>
      <fog attach="fog" args={['#e9f2ea', 26, 62]} />
      <hemisphereLight args={['#d9eefb', '#e9d9b6', 1.0]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        castShadow
        position={[10, 21, 12]}
        intensity={1.15}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={22}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0009}
      />
      <directionalLight position={[-9, 7, -11]} intensity={0.32} color="#dbeaff" />

      <Ground scatter={scatter} />
      <Trunk />
      <DecoLimbs limbs={limbs} />
      {branches.map((b) => (
        <Limb key={b.key} from={b.from} to={b.to} r={b.r} />
      ))}
      <InstancedStatic
        geometry={GEO.leaf}
        material={MAT.leafInstanced}
        items={foliage}
        castShadow
      />
      <Buds reduced={reduced} />

      {perches.map((p) => (
        <Treehouse key={p.id} perch={p} reduced={reduced} hoverCtx={hoverCtx} />
      ))}
      <Roost reduced={reduced} hoverCtx={hoverCtx} />
      <GrowingSite reduced={reduced} />

      {bridges.map((b) => (
        <Bridge key={b.key} bridge={b} />
      ))}
      <BridgePlanks bridges={bridges} />
      {bridges.map((b, i) =>
        i % 3 === 2 ? null : (
          <BridgeWalker
            key={`w${b.key}`}
            bridge={b}
            accentMat={walkerMats[i % walkerMats.length]}
            seed={i * 17 + 4}
            reduced={reduced}
          />
        )
      )}

      {ladders.map((l) => (
        <Ladder key={l.key} ladder={l} />
      ))}
      {ladders.map((l, i) => (
        <LadderClimber
          key={`c${l.key}`}
          ladder={l}
          accentMat={walkerMats[(i * 3 + 1) % walkerMats.length]}
          seed={i * 29 + 6}
          reduced={reduced}
        />
      ))}

      <PulleyRig accentMat={riderMat} reduced={reduced} />

      <Clouds reduced={reduced} />
      <FallingLeaves reduced={reduced} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[0, 9.2, 0]}
        enablePan={false}
        enableZoom
        minDistance={10}
        maxDistance={62}
        minPolarAngle={0.42}
        maxPolarAngle={1.6}
        enableDamping
        dampingFactor={0.08}
        autoRotateSpeed={0.4}
        onStart={() => {
          draggingRef.current = true;
        }}
        onEnd={() => {
          draggingRef.current = false;
        }}
      />
      {/* after OrbitControls, so it can re-target them on mount */}
      <FrameRig controlsRef={controlsRef} />
    </>
  );
}

export default function CanopyScene({
  projects,
}: {
  projects: CanopyProject[];
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [6.5, 12, 25.5], fov: 45, near: 0.5, far: 140 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
    >
      <Scene projects={projects} />
    </Canvas>
  );
}
