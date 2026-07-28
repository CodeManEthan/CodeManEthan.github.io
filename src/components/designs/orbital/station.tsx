import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  GEO,
  HUB_R,
  MAT,
  accentMaterial,
  fmtLoc,
  hullMaterial,
  mulberry32,
  type BuildCtx,
  type HoverCtx,
  type ModuleSpec,
} from './common';
import { Welder } from './drones';

/**
 * The yard itself: a hub with Ethan's command module on top, one pressurised
 * module per project docked around the ring, and an expansion bay where the
 * next module is still being skinned.
 */

// Self-hosted: drei's default <Text> font is fetched from a CDN and suspends
// the whole canvas until it lands.
export const FONT = '/fonts/LiberationSans-Regular.ttf';

/* -------------------------------- truss arm ------------------------------- */

/** Half-diagonal of the square truss frame, per unit of scale. */
const DIAG = Math.SQRT1_2;
const ARM_K = 0.23;

function Arm({
  ang,
  inner,
  dy,
  mat = MAT.truss,
  frameMat = MAT.trussDark,
}: {
  ang: number;
  inner: number;
  dy: number;
  mat?: THREE.Material;
  frameMat?: THREE.Material;
}) {
  const railEnd = inner - 0.45;
  const railLen = Math.max(0.4, railEnd - HUB_R);
  const o = ARM_K * DIAG;
  const bays = Math.max(2, Math.round(railLen / 0.8));
  const rails: Array<[number, number]> = [
    [o, o],
    [o, -o],
    [-o, o],
    [-o, -o],
  ];

  return (
    <group rotation={[0, -ang, 0]}>
      {rails.map(([y, z], i) => (
        <mesh
          key={i}
          geometry={GEO.box}
          material={mat}
          position={[HUB_R + railLen / 2, y, z]}
          scale={[railLen, 0.055, 0.055]}
        />
      ))}
      {Array.from({ length: bays + 1 }, (_, i) => (
        <mesh
          key={`f${i}`}
          geometry={GEO.frame}
          material={frameMat}
          position={[HUB_R + (i / bays) * railLen, 0, 0]}
          scale={[1, ARM_K, ARM_K]}
        />
      ))}
      {/* pylon lifting the module off the ring plane, plus its docking collar */}
      {Math.abs(dy) > 0.12 && (
        <mesh
          geometry={GEO.box}
          material={mat}
          position={[railEnd, dy / 2, 0]}
          scale={[0.16, Math.abs(dy), 0.16]}
        />
      )}
      <mesh
        geometry={GEO.box}
        material={mat}
        position={[railEnd + 0.22, dy, 0]}
        scale={[0.45, 0.18, 0.18]}
      />
      <mesh
        geometry={GEO.rib}
        material={frameMat}
        position={[railEnd + 0.42, dy, 0]}
        scale={[1, 0.24, 0.24]}
      />
    </group>
  );
}

/* --------------------------------- labels --------------------------------- */

const labelStyle: CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '2px',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  color: '#eef1ff',
  background: 'rgba(15, 19, 51, 0.92)',
  border: '1px solid rgba(150, 170, 255, 0.3)',
  borderLeftWidth: '3px',
  borderRadius: '10px',
  padding: '8px 14px',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(4px)',
};

const labelTitle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 750,
  lineHeight: 1.25,
  letterSpacing: '0.01em',
};

const labelMeta: CSSProperties = {
  fontSize: '11px',
  fontWeight: 650,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
};

const labelTech: CSSProperties = {
  fontSize: '11.5px',
  color: '#a9b3e0',
  lineHeight: 1.3,
};

/* ------------------------------ solar wings ------------------------------- */

function SolarWing({ R, len }: { R: number; len: number }) {
  const w = Math.max(0.7, len * 0.5);
  const h = Math.max(0.6, R * 1.15);
  return (
    <group position={[0, R + 0.42, 0]}>
      <mesh
        geometry={GEO.rod}
        material={MAT.solarFrame}
        position={[0, -0.21, 0]}
        scale={[0.05, 0.42, 0.05]}
      />
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * (h / 2 + 0.16)]} rotation={[s * 0.42, 0, 0]}>
          <mesh geometry={GEO.panel} material={MAT.solar} scale={[w, 1, h]} />
          <mesh
            geometry={GEO.box}
            material={MAT.solarFrame}
            scale={[w * 1.02, 0.05, 0.05]}
            position={[0, 0.01, -h / 2]}
          />
          <mesh
            geometry={GEO.box}
            material={MAT.solarFrame}
            scale={[w * 1.02, 0.05, 0.05]}
            position={[0, 0.01, h / 2]}
          />
          <mesh
            geometry={GEO.box}
            material={MAT.solarFrame}
            scale={[0.05, 0.05, h]}
            position={[0, 0.01, 0]}
          />
        </group>
      ))}
    </group>
  );
}

/* ------------------------------ project module ---------------------------- */

export function ProjectModule({
  spec,
  hoverCtx,
  reduced,
}: {
  spec: ModuleSpec;
  hoverCtx: HoverCtx;
  reduced: boolean;
}) {
  const bodyRef = useRef<THREE.Group>(null);
  const liftRef = useRef(0);
  const [hovered, setHovered] = useState(false);
  const { R, len, cap } = spec;

  const accent = useMemo(() => accentMaterial(spec.accent), [spec.accent]);
  const hullMat = useMemo(() => hullMaterial(spec.accent), [spec.accent]);
  const accentSoft = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: spec.accent,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    [spec.accent]
  );

  // Deterministic hull detail so nothing pops between renders.
  const detail = useMemo(() => {
    const rng = mulberry32(811 + spec.index * 97);
    const n = R > 1 ? 4 : R > 0.7 ? 3 : 2;
    const windows = Array.from({ length: n }, (_, i) => ({
      x: (i / (n - 1) - 0.5) * len * 0.62,
      z: (rng() - 0.5) * R * 0.5,
    }));
    return { windows };
  }, [spec.index, R, len]);

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
    const g = bodyRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    liftRef.current = THREE.MathUtils.lerp(
      liftRef.current,
      hovered ? 0.3 : 0,
      Math.min(1, delta * 6)
    );
    g.position.y = liftRef.current + (reduced ? 0 : Math.sin(t * 0.6 + spec.index) * 0.025);
    accent.emissiveIntensity = THREE.MathUtils.lerp(
      accent.emissiveIntensity,
      hovered ? 2.4 : 0.95 + (reduced ? 0 : Math.sin(t * 1.6 + spec.index * 2) * 0.12),
      0.15
    );
    accentSoft.opacity = THREE.MathUtils.lerp(accentSoft.opacity, hovered ? 0.4 : 0.16, 0.15);
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Ignore "clicks" that were really orbit drags.
    if (e.delta <= 6) window.location.assign(`/projects/${spec.id}/`);
  };

  const half = len / 2;

  return (
    <group
      position={[Math.cos(spec.ang) * spec.radius, spec.dy, Math.sin(spec.ang) * spec.radius]}
      rotation={[0, -spec.ang, 0]}
    >
      <group ref={bodyRef}>
        {/* pressure hull */}
        <mesh geometry={GEO.hull} material={hullMat} scale={[len, R, R]} />
        <mesh geometry={GEO.cap} material={hullMat} position={[half, 0, 0]} scale={[cap, R, R]} />
        <mesh
          geometry={GEO.cap}
          material={hullMat}
          position={[-half, 0, 0]}
          rotation={[0, Math.PI, 0]}
          scale={[cap, R, R]}
        />
        {/* structural ribs */}
        {[-0.3, 0.05, 0.34].map((f, i) => (
          <mesh
            key={i}
            geometry={GEO.rib}
            material={MAT.hullTrim}
            position={[f * len, 0, 0]}
            scale={[1, R * 1.02, R * 1.02]}
          />
        ))}
        {/* dark equipment band */}
        <mesh
          geometry={GEO.hull}
          material={MAT.hullDark}
          position={[-len * 0.16, 0, 0]}
          scale={[len * 0.15, R * 1.03, R * 1.03]}
        />
        {/* running lights down both flanks — the module's identity colour */}
        {[-1, 1].map((s) => (
          <group key={s}>
            {[-0.28, -0.09, 0.1, 0.29].map((f, i) => (
              <group key={i} position={[f * len, R * 0.42, s * R * 0.9]}>
                <mesh geometry={GEO.box} material={accent} scale={[len * 0.11, R * 0.1, 0.06]} />
                <mesh
                  geometry={GEO.box}
                  material={accentSoft}
                  position={[0, 0, s * 0.05]}
                  scale={[len * 0.15, R * 0.3, 0.06]}
                />
              </group>
            ))}
            {/* thin identity stripe painted along the spine of the hull */}
            <mesh
              geometry={GEO.box}
              material={accent}
              position={[len * 0.02, R * 0.9, s * R * 0.42]}
              scale={[len * 0.78, 0.05, R * 0.12]}
            />
          </group>
        ))}
        {/* nav lights */}
        <mesh geometry={GEO.beacon} material={accent} position={[half + cap * 0.75, 0, 0]} scale={R * 0.8} />
        {/* portholes */}
        {detail.windows.map((w, i) => (
          <mesh
            key={i}
            geometry={GEO.box}
            material={MAT.window}
            position={[w.x, R * 0.97, w.z]}
            scale={[R * 0.24, 0.045, R * 0.24]}
          />
        ))}
        {/* docking collar back toward the hub */}
        <mesh
          geometry={GEO.drum}
          material={MAT.hullDark}
          position={[-half - cap * 0.5, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[R * 0.42, 0.3, R * 0.42]}
        />
        <SolarWing R={R} len={len} />
        {/* radiator fin underneath */}
        <group position={[0, -R - 0.32, 0]} rotation={[0, 0, 0.18]}>
          <mesh geometry={GEO.panel} material={MAT.radiator} scale={[len * 0.58, 1, R * 0.85]} />
          <mesh
            geometry={GEO.box}
            material={MAT.hullTrim}
            scale={[len * 0.6, 0.035, 0.04]}
          />
        </group>
      </group>

      {/* generous invisible hit volume so hovering works when zoomed out */}
      <mesh
        geometry={GEO.hit}
        scale={[half + cap + 0.35, R + 0.85, R + 0.85]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={onClick}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Always-on nameplate so every module is identifiable at a glance —
          pushed outboard along the arm so neighbouring plates fan apart
          instead of stacking near the hub, and stepping aside for the richer
          hover card. */}
      <Suspense fallback={null}>
        <Billboard position={[half + cap + 0.2, R + 1.05, 0]} visible={!hovered}>
          <Text
            font={FONT}
            fontSize={0.33}
            color={spec.accent}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.014}
            outlineColor="#0b0f2c"
            letterSpacing={0.02}
          >
            {spec.title}
          </Text>
          <Text
            font={FONT}
            fontSize={0.2}
            color="#9fabdc"
            anchorX="center"
            anchorY="middle"
            position={[0, -0.3, 0]}
            outlineWidth={0.012}
            outlineColor="#0b0f2c"
            letterSpacing={0.06}
          >
            {`${fmtLoc(spec.loc)} LINES`}
          </Text>
        </Billboard>
      </Suspense>

      {hovered && (
        <Html
          center
          position={[half + cap + 0.2, R + 1.5, 0]}
          distanceFactor={23}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{ ...labelStyle, borderLeftColor: spec.accent }}>
            <span style={{ ...labelMeta, color: spec.accent }}>
              {`Module ${String(spec.index + 1).padStart(2, '0')}${spec.featured ? ' · Featured' : ''}`}
            </span>
            <span style={labelTitle}>{spec.title}</span>
            <span style={labelTech}>{spec.tech.slice(0, 4).join(' · ')}</span>
            <span style={{ ...labelTech, color: '#7ee0e6' }}>
              {`${fmtLoc(spec.loc)} lines · click to visit →`}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------ command module ---------------------------- */

/** Ethan's module: cupola, antenna array, and the only warm interior in orbit. */
export function CommandModule({
  hoverCtx,
  reduced,
}: {
  hoverCtx: HoverCtx;
  reduced: boolean;
}) {
  const dishRef = useRef<THREE.Group>(null);
  const lampRef = useRef<THREE.PointLight>(null);
  const [hovered, setHovered] = useState(false);

  const beaconMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff9f6b', transparent: true, opacity: 1 }),
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
    const t = state.clock.elapsedTime;
    if (!reduced && dishRef.current) {
      // Slowly tracking something far away.
      dishRef.current.rotation.y = Math.sin(t * 0.12) * 0.9;
      dishRef.current.rotation.x = -0.5 + Math.sin(t * 0.09) * 0.16;
    }
    beaconMat.opacity = reduced ? 0.9 : 0.25 + Math.pow(Math.abs(Math.sin(t * 1.5)), 6) * 0.75;
    if (lampRef.current) {
      lampRef.current.intensity = THREE.MathUtils.lerp(
        lampRef.current.intensity,
        hovered ? 34 : 22,
        Math.min(1, delta * 4)
      );
    }
    MAT.window.emissiveIntensity = THREE.MathUtils.lerp(
      MAT.window.emissiveIntensity,
      hovered ? 2.4 : 1.5,
      0.12
    );
  });

  const windows = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);

  return (
    <group>
      {/* service drum + docking ring */}
      <mesh geometry={GEO.drum} material={MAT.hullDark} scale={[HUB_R, 1.5, HUB_R]} />
      <mesh geometry={GEO.rib} material={MAT.hullTrim} rotation={[0, 0, Math.PI / 2]} scale={[1, HUB_R * 1.03, HUB_R * 1.03]} />
      <mesh geometry={GEO.ring} material={MAT.truss} />
      {/* octagonal ring struts back to the hub */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + 0.22;
        return (
          <mesh
            key={i}
            geometry={GEO.box}
            material={MAT.trussDark}
            position={[Math.cos(a) * (HUB_R + 0.6), -0.55, Math.sin(a) * (HUB_R + 0.6)]}
            rotation={[0, -a, -0.5]}
            scale={[1.6, 0.05, 0.05]}
          />
        );
      })}

      {/* radiator wings off the service level */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (HUB_R + 1.1), -1.5, 0]} rotation={[0, 0, s * 0.35]}>
          <mesh geometry={GEO.panel} material={MAT.radiator} scale={[1.7, 1, 2.5]} />
          <mesh geometry={GEO.box} material={MAT.trussDark} scale={[1.75, 0.06, 0.06]} />
          {[-0.8, -0.27, 0.27, 0.8].map((f) => (
            <mesh
              key={f}
              geometry={GEO.box}
              material={MAT.trussDark}
              position={[0, 0.03, f * 1.25]}
              scale={[1.72, 0.03, 0.04]}
            />
          ))}
        </group>
      ))}

      {/* neck */}
      <mesh geometry={GEO.drum8} material={MAT.hullTrim} position={[0, 1.05, 0]} scale={[0.95, 0.7, 0.95]} />

      {/* command drum — warm hull, banded windows */}
      <mesh geometry={GEO.drum} material={MAT.hullWarm} position={[0, 2.35, 0]} scale={[1.45, 1.9, 1.45]} />
      <mesh geometry={GEO.rib} material={MAT.hullTrim} position={[0, 1.55, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1.48, 1.48]} />
      <mesh geometry={GEO.rib} material={MAT.hullTrim} position={[0, 3.15, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1.48, 1.48]} />
      {windows.map((a, i) => (
        <mesh
          key={i}
          geometry={GEO.box}
          material={MAT.window}
          position={[Math.cos(a) * 1.44, 2.4, Math.sin(a) * 1.44]}
          rotation={[0, -a, 0]}
          scale={[0.05, 0.42, 0.42]}
        />
      ))}

      {/* cupola */}
      <mesh geometry={GEO.drum} material={MAT.hullTrim} position={[0, 3.34, 0]} scale={[1.02, 0.28, 1.02]} />
      <mesh geometry={GEO.dome} material={MAT.cupola} position={[0, 3.46, 0]} scale={[0.92, 0.78, 0.92]} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh
            key={i}
            geometry={GEO.box}
            material={MAT.hullTrim}
            position={[Math.cos(a) * 0.62, 3.72, Math.sin(a) * 0.62]}
            rotation={[0, -a, 0.7]}
            scale={[0.9, 0.05, 0.05]}
          />
        );
      })}
      <mesh geometry={GEO.beacon} material={MAT.window} position={[0, 4.24, 0]} scale={1.5} />

      {/* the warm interior everything else in this scene lacks */}
      <pointLight ref={lampRef} position={[0, 2.7, 0]} color="#ffc887" distance={16} decay={2} intensity={22} />

      {/* antenna array */}
      <group position={[0, 3.0, 0]}>
        <mesh
          geometry={GEO.rod}
          material={MAT.truss}
          position={[1.25, 0.5, 0]}
          rotation={[0, 0, -0.85]}
          scale={[0.055, 1.6, 0.055]}
        />
        <group ref={dishRef} position={[2.2, 1.35, 0]}>
          <mesh geometry={GEO.dish} material={MAT.dish} scale={1.15} />
          <mesh geometry={GEO.rod} material={MAT.hullTrim} position={[0, 0.42, 0]} scale={[0.03, 0.85, 0.03]} />
          <mesh geometry={GEO.lens} material={MAT.window} position={[0, 0.85, 0]} scale={1.2} />
        </group>
        {/* smaller fixed dish + comms panels on the other side */}
        <group position={[-1.55, 0.35, 0.2]} rotation={[0.4, 0, 0.9]}>
          <mesh geometry={GEO.rod} material={MAT.truss} position={[0, -0.45, 0]} scale={[0.05, 0.9, 0.05]} />
          <mesh geometry={GEO.dish} material={MAT.dish} scale={0.62} />
        </group>
      </group>

      {/* comms mast + beacon */}
      <mesh geometry={GEO.rod} material={MAT.trussDark} position={[0, 5.1, 0]} scale={[0.045, 1.7, 0.045]} />
      {[4.6, 5.3].map((y, i) => (
        <mesh key={i} geometry={GEO.box} material={MAT.truss} position={[0, y, 0]} scale={[0.7, 0.04, 0.04]} />
      ))}
      <mesh geometry={GEO.beacon} material={beaconMat} position={[0, 5.98, 0]} scale={1.3} />

      <mesh
        geometry={GEO.hit}
        position={[0, 2.4, 0]}
        scale={[2.4, 2.9, 2.4]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta <= 6) document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <Suspense fallback={null}>
        <Billboard position={[0, 6.85, 0]} visible={!hovered}>
          <Text
            font={FONT}
            fontSize={0.44}
            color="#ffd7a1"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.016}
            outlineColor="#0b0f2c"
            letterSpacing={0.05}
          >
            COMMAND · ETHAN
          </Text>
          <Text
            font={FONT}
            fontSize={0.22}
            color="#9fabdc"
            anchorX="center"
            anchorY="middle"
            position={[0, -0.4, 0]}
            outlineWidth={0.012}
            outlineColor="#0b0f2c"
            letterSpacing={0.06}
          >
            SOFTWARE &amp; AGENTIC ENGINEER
          </Text>
        </Billboard>
      </Suspense>

      {hovered && (
        <Html center position={[0, 7.2, 0]} distanceFactor={23} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ ...labelStyle, borderLeftColor: '#ffc887' }}>
            <span style={{ ...labelMeta, color: '#ffc887' }}>Command module</span>
            <span style={labelTitle}>Ethan</span>
            <span style={labelTech}>Cupola · antenna array · the lights are on</span>
            <span style={{ ...labelTech, color: '#7ee0e6' }}>click to read about me →</span>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------ expansion bay ----------------------------- */

const BAY_ACCENT = '#f5c26b';

/** Where the half-built module sits — shared with the ferry that supplies it. */
export const BAY = { R: 1.3, len: 3.4, radius: 8.4, dy: -2.0, accent: BAY_ACCENT };

/**
 * Slot 08: the next module, still a skeleton. Bare ribs and stringers, a
 * pallet of hull plate floating alongside, and a welder drone skinning it one
 * panel at a time. Every completed bead adds a plate; when the shell closes,
 * the bay resets and starts the module after it. The station grows.
 */
export function ExpansionBay({
  ang,
  reduced,
}: {
  ang: number;
  reduced: boolean;
}) {
  const { R, len, radius, dy } = BAY;
  const inner = radius - len / 2 - 0.2;

  const ctx = useRef<BuildCtx>({ welding: false, progress: 0.42 }).current;
  const panelRefs = useRef<Array<THREE.Mesh | null>>([]);
  const barRef = useRef<THREE.Mesh>(null);
  const cratesRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const accent = useMemo(() => accentMaterial(BAY_ACCENT), []);

  const PANELS = 6;

  // Seams the welder works, in bay-local space.
  const stops = useMemo<Array<[number, number, number]>>(() => {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.5;
      out.push([
        (i / 4 - 0.5) * len * 0.7,
        Math.sin(a) * (R + 0.42),
        Math.cos(a) * (R + 0.42),
      ]);
    }
    return out;
  }, []);

  const crates = useMemo(() => {
    const rng = mulberry32(6060);
    return Array.from({ length: 6 }, (_, i) => ({
      p: [
        -len * 0.75 + rng() * 0.6,
        -R - 0.5 + rng() * 2.4,
        (rng() < 0.5 ? -1 : 1) * (R + 0.9 + rng() * 0.7),
      ] as [number, number, number],
      s: 0.22 + rng() * 0.24,
      rot: [rng() * 3, rng() * 3, rng() * 3] as [number, number, number],
      spin: (rng() - 0.5) * 0.25,
      mat: i % 3 === 0 ? MAT.crateAlt : MAT.crate,
    }));
  }, []);

  useFrame((state, delta) => {
    const shown = Math.floor(ctx.progress * PANELS);
    for (let i = 0; i < PANELS; i++) {
      const m = panelRefs.current[i];
      if (m) m.visible = i < shown;
    }
    if (barRef.current) {
      // Grow from the left edge rather than the centre.
      const p = Math.max(0.004, ctx.progress);
      barRef.current.scale.x = p * 2.0;
      barRef.current.position.x = -1.0 + p * 1.0;
    }
    accent.emissiveIntensity = ctx.welding ? 1.6 : 0.8;
    if (cratesRef.current && !reduced) {
      const t = state.clock.elapsedTime;
      cratesRef.current.children.forEach((c, i) => {
        c.rotation.y += delta * crates[i % crates.length].spin;
        c.position.y += Math.sin(t * 0.5 + i) * delta * 0.06;
      });
    }
  });

  return (
    <>
      <Arm ang={ang} inner={inner} dy={dy} mat={MAT.truss} frameMat={MAT.trussRaw} />
      <group
        position={[Math.cos(ang) * radius, dy, Math.sin(ang) * radius]}
        rotation={[0, -ang, 0]}
      >
        {/* exposed skeleton: ribs + stringers */}
        {[-0.45, -0.15, 0.15, 0.45].map((f, i) => (
          <mesh
            key={i}
            geometry={GEO.rib}
            material={MAT.trussRaw}
            position={[f * len, 0, 0]}
            scale={[1, R, R]}
          />
        ))}
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh
              key={`s${i}`}
              geometry={GEO.box}
              material={MAT.trussRaw}
              position={[0, Math.sin(a) * R, Math.cos(a) * R]}
              scale={[len, 0.06, 0.06]}
            />
          );
        })}
        {/* hull plate, welded on one panel at a time */}
        {Array.from({ length: PANELS }, (_, i) => (
          <mesh
            key={`p${i}`}
            ref={(el) => {
              panelRefs.current[i] = el;
            }}
            geometry={GEO.shell}
            material={MAT.plate}
            rotation={[(i / PANELS) * Math.PI * 2 + 1.9, 0, 0]}
            scale={[len * 0.98, R, R]}
            visible={false}
          />
        ))}
        {/* bulkhead at the docking end */}
        <mesh
          geometry={GEO.drum}
          material={MAT.hullDark}
          position={[-len / 2 - 0.14, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[R * 0.55, 0.28, R * 0.55]}
        />

        {/* pallet of materials on a stub truss */}
        <group position={[-len * 0.42, -R - 1.15, R + 2.05]}>
          <mesh geometry={GEO.panel} material={MAT.trussDark} scale={[1.5, 1, 1.1]} />
          <mesh geometry={GEO.box} material={MAT.hull} position={[0, 0.12, 0]} scale={[1.25, 0.18, 0.85]} />
          <mesh geometry={GEO.box} material={MAT.hull} position={[0.05, 0.3, -0.05]} scale={[1.1, 0.16, 0.7]} />
          <mesh geometry={GEO.box} material={MAT.crate} position={[-0.4, 0.5, 0.1]} scale={[0.35, 0.35, 0.35]} />
        </group>

        {/* loose stock drifting around the site */}
        <group ref={cratesRef}>
          {crates.map((c, i) => (
            <mesh
              key={i}
              geometry={GEO.box}
              material={c.mat}
              position={c.p}
              rotation={c.rot}
              scale={[c.s * 1.6, c.s, c.s * 1.2]}
            />
          ))}
        </group>

        {/* the welder itself */}
        <Welder ctx={ctx} stops={stops} reduced={reduced} />

        {/* build progress readout */}
        <group position={[0, R + 1.55, 0]}>
          <mesh geometry={GEO.box} material={MAT.hullTrim} scale={[2.06, 0.1, 0.05]} />
          <mesh
            ref={barRef}
            geometry={GEO.box}
            material={accent}
            position={[-1.0, 0, 0.02]}
            scale={[0.001, 0.14, 0.06]}
          />
        </group>

        <mesh
          geometry={GEO.hit}
          scale={[len / 2 + 0.8, R + 1.0, R + 1.0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        <Suspense fallback={null}>
          <Billboard position={[0, R + 2.35, 0]} visible={!hovered}>
            <Text
              font={FONT}
              fontSize={0.32}
              color={BAY_ACCENT}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.014}
              outlineColor="#0b0f2c"
              letterSpacing={0.04}
            >
              BAY 08 · BUILDING
            </Text>
          </Billboard>
        </Suspense>

        {hovered && (
          <Html center position={[0, R + 2.9, 0]} distanceFactor={16} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div style={{ ...labelStyle, borderLeftColor: BAY_ACCENT }}>
              <span style={{ ...labelMeta, color: BAY_ACCENT }}>Expansion bay</span>
              <span style={labelTitle}>The next project</span>
              <span style={labelTech}>Frame up · hull plate going on</span>
              <span style={{ ...labelTech, color: '#7ee0e6' }}>the yard keeps building</span>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

export { Arm };
