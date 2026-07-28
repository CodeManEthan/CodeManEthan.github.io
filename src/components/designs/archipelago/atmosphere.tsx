import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GEO, MAT, mulberry32, type EnvCtx } from './common';
import {
  currentHour,
  evaluateSky,
  makeSkyState,
  type SkyOverrides,
  type Weather,
} from './sky';

/* ------------------------------- page theme ------------------------------- */

/* The canvas is transparent, so the hero's CSS gradient is the actual sky.
   These two presets are lerped by `night` and pushed to custom properties —
   only ones the hero uses, so the cards further down the page stay light. */

type Rgba = [number, number, number, number];

const DAY_THEME = {
  cardBg: [255, 255, 255, 0.72] as Rgba,
  cardBorder: [255, 255, 255, 0.8] as Rgba,
  hintBg: [255, 255, 255, 0.6] as Rgba,
  ink: [67, 64, 90, 1] as Rgba,
  inkSoft: [122, 118, 144, 1] as Rgba,
  shadow: [67, 64, 90, 0.12] as Rgba,
};

const NIGHT_THEME = {
  cardBg: [26, 28, 56, 0.66] as Rgba,
  cardBorder: [150, 160, 220, 0.26] as Rgba,
  hintBg: [26, 28, 56, 0.5] as Rgba,
  ink: [240, 238, 251, 1] as Rgba,
  inkSoft: [186, 184, 214, 1] as Rgba,
  shadow: [5, 6, 20, 0.45] as Rgba,
};

const WHITE = new THREE.Color('#ffffff');

function rgba(a: Rgba, b: Rgba, t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const al = (a[3] + (b[3] - a[3]) * t).toFixed(3);
  return `rgba(${r}, ${g}, ${bl}, ${al})`;
}

/* --------------------------------- sky rig -------------------------------- */

/**
 * Owns the scene lighting and drives everything that changes with the clock:
 * light colour and angle, the page gradient behind the canvas, and the shared
 * materials for windows, lanterns, stars and clouds.
 */
export function SkyRig({
  env,
  weather,
  overrides,
  reduced,
}: {
  env: EnvCtx;
  weather: Weather;
  overrides: SkyOverrides;
  reduced: boolean;
}) {
  const ambRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const sky = useMemo(makeSkyState, []);
  // Where the time-lapse clock starts, so it picks up from the real hour.
  const startHour = useMemo(
    () => currentHour({ ...overrides, dayLength: null }, 12, 0),
    [overrides]
  );
  const cssCooldown = useRef(0);

  useFrame((state, delta) => {
    const amb = ambRef.current;
    const hemi = hemiRef.current;
    const sun = sunRef.current;
    if (!amb || !hemi || !sun) return;

    const hour = currentHour(overrides, startHour, state.clock.elapsedTime);
    evaluateSky(sky, hour, weather);
    env.hour = hour;
    env.night = sky.night;

    amb.color.copy(sky.amb);
    amb.intensity = sky.ambI;
    hemi.color.copy(sky.hemiSky);
    hemi.groundColor.copy(sky.hemiGround);
    hemi.intensity = sky.hemiI;
    sun.color.copy(sky.sun);
    sun.intensity = sky.sunI;
    sun.position.copy(sky.sunPos);

    // Lights come on as it gets dark.
    const lit = THREE.MathUtils.smoothstep(sky.night, 0.25, 0.7);
    MAT.window.emissiveIntensity = 0.35 + lit * 2.1;
    MAT.lantern.opacity = lit;
    MAT.lanternGlow.opacity = lit * 0.32;
    MAT.firefly.opacity = lit * 0.85;
    MAT.star.opacity =
      lit * (reduced ? 0.9 : 0.75 + Math.sin(state.clock.elapsedTime * 0.7) * 0.15);

    // Clouds catch the sky's colour, but always stay lighter than it —
    // tinting them to the sky's own value makes them read as holes.
    MAT.cloud.color.copy(sky.mid).lerp(WHITE, 0.56 - sky.night * 0.16);
    MAT.cloud.opacity = 0.55 + weather.cloudiness * 0.4;

    cssCooldown.current -= delta;
    if (cssCooldown.current <= 0) {
      cssCooldown.current = 0.15;
      const s = document.documentElement.style;
      s.setProperty('--sky-top', `#${sky.top.getHexString()}`);
      s.setProperty('--sky-mid', `#${sky.mid.getHexString()}`);
      s.setProperty('--sky-bottom', `#${sky.bottom.getHexString()}`);
      const n = sky.night;
      s.setProperty('--hero-card-bg', rgba(DAY_THEME.cardBg, NIGHT_THEME.cardBg, n));
      s.setProperty(
        '--hero-card-border',
        rgba(DAY_THEME.cardBorder, NIGHT_THEME.cardBorder, n)
      );
      s.setProperty('--hero-hint-bg', rgba(DAY_THEME.hintBg, NIGHT_THEME.hintBg, n));
      s.setProperty('--hero-ink', rgba(DAY_THEME.ink, NIGHT_THEME.ink, n));
      s.setProperty('--hero-ink-soft', rgba(DAY_THEME.inkSoft, NIGHT_THEME.inkSoft, n));
      s.setProperty('--hero-shadow', rgba(DAY_THEME.shadow, NIGHT_THEME.shadow, n));
    }
  });

  return (
    <>
      <ambientLight ref={ambRef} intensity={0.55} color="#fff6ea" />
      <hemisphereLight ref={hemiRef} args={['#cfe8f5', '#ffe6c9', 0.6]} />
      <directionalLight
        ref={sunRef}
        position={[8, 13, 6]}
        intensity={1.7}
        color="#ffe9cf"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
      />
    </>
  );
}

/* ---------------------------------- stars --------------------------------- */

/** Fixed field on a far shell; fades in with `night` via the shared material. */
export function Stars() {
  const geo = useMemo(() => {
    const rng = mulberry32(20260724);
    const n = 320;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Bias toward the upper hemisphere — nothing below the archipelago.
      const y = Math.pow(rng(), 0.6);
      const r = Math.sqrt(1 - y * y);
      const a = rng() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r * 78;
      pos[i * 3 + 1] = (y - 0.18) * 78;
      pos[i * 3 + 2] = Math.sin(a) * r * 78;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  return <points geometry={geo} material={MAT.star} frustumCulled={false} />;
}

/* -------------------------------- fireflies ------------------------------- */

/** Slow warm drifters over the island ring; only visible after dark. */
export function Fireflies({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const { geo, seeds } = useMemo(() => {
    const rng = mulberry32(6060842);
    const n = 80;
    const pos = new Float32Array(n * 3);
    const s = new Float32Array(n * 4); // angle, radius, height, phase
    for (let i = 0; i < n; i++) {
      s[i * 4] = rng() * Math.PI * 2;
      s[i * 4 + 1] = 4.2 + rng() * 5.4;
      s[i * 4 + 2] = -1.4 + rng() * 3.4;
      s[i * 4 + 3] = rng() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo: g, seeds: s };
  }, []);

  useFrame((state) => {
    const p = ref.current;
    if (!p || MAT.firefly.opacity <= 0.01) return;
    const t = reduced ? 0 : state.clock.elapsedTime;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < seeds.length / 4; i++) {
      const a = seeds[i * 4] + t * 0.045;
      const r = seeds[i * 4 + 1] + Math.sin(t * 0.5 + seeds[i * 4 + 3]) * 0.5;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] =
        seeds[i * 4 + 2] + Math.sin(t * 0.8 + seeds[i * 4 + 3] * 2) * 0.35;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    geo.attributes.position.needsUpdate = true;
  });

  return <points ref={ref} geometry={geo} material={MAT.firefly} frustumCulled={false} />;
}

/* ------------------------------ precipitation ----------------------------- */

const FIELD_R = 15;
const FIELD_TOP = 9;
const FIELD_H = 17;

/**
 * Rain as short falling line segments, snow as drifting points. One shared
 * buffer updated in place; nothing is allocated per frame.
 */
export function Precipitation({
  weather,
  reduced,
}: {
  weather: Weather;
  reduced: boolean;
}) {
  const snowing = weather.kind === 'snow';
  const count = snowing ? 340 : 420;

  const { geo, seeds } = useMemo(() => {
    const rng = mulberry32(snowing ? 77111 : 31337);
    // Rain needs two verts per drop (streak); snow needs one.
    const verts = snowing ? count : count * 2;
    const pos = new Float32Array(verts * 3);
    const s = new Float32Array(count * 4); // x, y, z, speed
    for (let i = 0; i < count; i++) {
      s[i * 4] = (rng() - 0.5) * FIELD_R * 2;
      s[i * 4 + 1] = rng() * FIELD_H - (FIELD_H - FIELD_TOP);
      s[i * 4 + 2] = (rng() - 0.5) * FIELD_R * 2;
      s[i * 4 + 3] = snowing ? 0.5 + rng() * 0.45 : 7 + rng() * 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo: g, seeds: s };
  }, [snowing, count]);

  useFrame((state, rawDelta) => {
    if (reduced || weather.fall <= 0) return;
    const delta = Math.min(rawDelta, 0.1);
    const t = state.clock.elapsedTime;
    const arr = geo.attributes.position.array as Float32Array;

    for (let i = 0; i < count; i++) {
      let y = seeds[i * 4 + 1] - seeds[i * 4 + 3] * delta;
      if (y < FIELD_TOP - FIELD_H) {
        y += FIELD_H;
        // Re-scatter horizontally so the field never shows a repeating pattern.
        const h = Math.sin(i * 12.9898 + t) * 43758.5453;
        seeds[i * 4] = (h - Math.floor(h) - 0.5) * FIELD_R * 2;
      }
      seeds[i * 4 + 1] = y;

      const x = seeds[i * 4];
      const z = seeds[i * 4 + 2];
      if (snowing) {
        // Flakes wander as they fall.
        arr[i * 3] = x + Math.sin(t * 0.7 + i) * 0.5;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z + Math.cos(t * 0.55 + i * 1.7) * 0.5;
      } else {
        const j = i * 6;
        arr[j] = x;
        arr[j + 1] = y + 0.34;
        arr[j + 2] = z;
        arr[j + 3] = x + 0.06; // slight slant, as if driven by wind
        arr[j + 4] = y;
        arr[j + 5] = z;
      }
    }
    geo.attributes.position.needsUpdate = true;
  });

  // Reduced motion: falling streaks are exactly the kind of thing to drop.
  if (reduced || weather.fall <= 0) return null;

  return snowing ? (
    <points geometry={geo} material={MAT.snow} frustumCulled={false} />
  ) : (
    <lineSegments geometry={geo} material={MAT.rain} frustumCulled={false} />
  );
}
