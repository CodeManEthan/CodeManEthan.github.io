import * as THREE from 'three';

/* ============================ project data ============================ */

/** Serializable prop shape handed to the scene by canopy.astro. */
export interface CanopyProject {
  id: string;
  title: string;
  tech: string[];
  loc: number;
  featured: boolean;
  /** Gem colour from src/data/islands.ts — the treehouse's accent. */
  accent: string;
}

export function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** Small deterministic PRNG so every layout is stable across renders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================== the tree ============================== */

/**
 * The trunk stops just above the roost and forks into leaders that carry the
 * canopy — so Ethan's deck sits in the fork, silhouetted against the leaves
 * instead of buried behind a column of bark.
 */
export const TRUNK_H = 12.2;
/** Centre of the leaf crown (squashed dome). */
export const CROWN_Y = 14.2;
export const CROWN_R = 4.0;
/** Nothing leafy hangs below this — the platforms stay readable. */
export const CROWN_FLOOR = 13.2;
/** Ethan's roost — the wrap-around deck in the fork. */
export const ROOST_Y = 11.2;
export const ROOST_R = 2.25;
/** The half-built eighth platform: out front, on a free azimuth. */
export const BUILD_ANG = 1.72;
export const BUILD_Y = 5.9;
export const BUILD_R = 1.0;
export const BUILD_DIST_GAP = 1.7;
/** Pulley rig — shares the build site's azimuth; the basket ferries planks. */
export const PULLEY_ANG = BUILD_ANG;
export const PULLEY_DIST = 4.9;
export const PULLEY_Y = 8.7;
export const PULLEY_LOW = 0.5;
export const PULLEY_HIGH = BUILD_Y + 0.3;

/** Trunk radius at height y — a taper with a root flare at the bottom. */
export function trunkR(y: number): number {
  const t = THREE.MathUtils.clamp(y / TRUNK_H, 0, 1);
  const taper = 0.4 + 0.8 * Math.pow(1 - t, 1.15);
  const flare = y < 1.7 ? 0.34 * Math.pow(1 - y / 1.7, 2) : 0;
  return taper + flare;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Quaternion (as an array prop) that points a +Y-aligned geometry along `dir`. */
export function alignY(dir: THREE.Vector3): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromUnitVectors(
    UP,
    dir.clone().normalize()
  );
  return [q.x, q.y, q.z, q.w];
}

export function radial(ang: number, dist: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(ang) * dist, y, Math.sin(ang) * dist);
}

/* ============================== perches =============================== */

export interface PerchSpec {
  id: string;
  title: string;
  tech: string[];
  loc: number;
  featured: boolean;
  accent: string;
  /** Original (order-sorted) project index. */
  index: number;
  /** Height rank — 0 is the lowest, biggest platform. */
  rank: number;
  /** Deck radius, ∝ cbrt(loc). */
  R: number;
  /** Deck top surface height. */
  y: number;
  ang: number;
  dist: number;
  x: number;
  z: number;
  /** Resident bot count. */
  bots: number;
}

const HEIGHTS = [2.9, 4.15, 5.35, 6.5, 7.6, 8.65, 9.65];
const ANG0 = 0.95;
const ANG_STEP = 1.55;

/**
 * One treehouse per project. Deck radius scales with cbrt(loc); the biggest
 * codebase gets the lowest, widest branch and they spiral up from there so no
 * two decks sit on the same side of the trunk at the same height.
 */
export function buildPerches(projects: CanopyProject[]): PerchSpec[] {
  const maxLoc = Math.max(...projects.map((p) => p.loc), 1);
  const cbrtMax = Math.cbrt(maxLoc);
  const ranked = projects
    .map((p, index) => ({ p, index }))
    .sort((a, b) => b.p.loc - a.p.loc);

  return ranked.map(({ p, index }, rank) => {
    const R = 0.42 + 1.25 * (Math.cbrt(p.loc) / cbrtMax);
    const y = HEIGHTS[rank] ?? 3 + rank * 1.1;
    const ang = ANG0 + rank * ANG_STEP;
    const dist = trunkR(y) + (1.5 - rank * 0.08) + R;
    return {
      id: p.id,
      title: p.title,
      tech: p.tech,
      loc: p.loc,
      featured: p.featured,
      accent: p.accent,
      index,
      rank,
      R,
      y,
      ang,
      dist,
      x: Math.cos(ang) * dist,
      z: Math.sin(ang) * dist,
      bots: p.loc >= 13000 ? 2 : 1,
    };
  });
}

/* ============================== bridges =============================== */

export interface BridgeSpec {
  key: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  sag: number;
  planks: number;
  len: number;
}

/** Point along a bridge's sagging span. Writes into `out`, returns it. */
export function bridgePoint(
  b: BridgeSpec,
  t: number,
  out: THREE.Vector3
): THREE.Vector3 {
  out.lerpVectors(b.a, b.b, t);
  out.y -= Math.sin(Math.PI * t) * b.sag;
  return out;
}

/** Rope bridges linking each treehouse to the next one up the spiral. */
export function buildBridges(perches: PerchSpec[]): BridgeSpec[] {
  const byRank = [...perches].sort((p, q) => p.rank - q.rank);
  const out: BridgeSpec[] = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < byRank.length - 1; i++) {
    const p = byRank[i];
    const q = byRank[i + 1];
    dir.set(q.x - p.x, 0, q.z - p.z).normalize();
    const a = new THREE.Vector3(
      p.x + dir.x * (p.R + 0.04),
      p.y + 0.07,
      p.z + dir.z * (p.R + 0.04)
    );
    const b = new THREE.Vector3(
      q.x - dir.x * (q.R + 0.04),
      q.y + 0.07,
      q.z - dir.z * (q.R + 0.04)
    );
    const len = a.distanceTo(b);
    out.push({
      key: `${p.id}-${q.id}`,
      a,
      b,
      sag: 0.13 * len + 0.18,
      planks: Math.max(6, Math.round(len / 0.4)),
      len,
    });
  }
  return out;
}

/* ============================== ladders =============================== */

export interface LadderSpec {
  key: string;
  bottom: THREE.Vector3;
  top: THREE.Vector3;
  /** Horizontal outward direction — climbers hang off this face. */
  out: THREE.Vector3;
  /** Horizontal direction across the rails. */
  side: THREE.Vector3;
  width: number;
  rungs: number;
  len: number;
}

function makeLadder(
  key: string,
  bottom: THREE.Vector3,
  top: THREE.Vector3,
  width: number
): LadderSpec {
  const mid = bottom.clone().add(top).multiplyScalar(0.5);
  const out = new THREE.Vector3(mid.x, 0, mid.z);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  out.normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(out).normalize();
  const len = bottom.distanceTo(top);
  return {
    key,
    bottom,
    top,
    out,
    side,
    width,
    rungs: Math.max(3, Math.round(len / 0.34)),
    len,
  };
}

/** A long ground ladder onto the lowest deck, and a short one up to the roost. */
export function buildLadders(perches: PerchSpec[]): LadderSpec[] {
  const byRank = [...perches].sort((p, q) => p.rank - q.rank);
  const low = byRank[0];
  const high = byRank[byRank.length - 1];
  const ladders: LadderSpec[] = [];

  const lowOuter = low.dist + low.R - 0.12;
  ladders.push(
    makeLadder(
      'ground',
      radial(low.ang, lowOuter + 1.15, 0),
      radial(low.ang, lowOuter, low.y + 0.12),
      0.42
    )
  );

  const inner = Math.max(0.5, high.dist - high.R + 0.16);
  ladders.push(
    makeLadder(
      'roost',
      radial(high.ang, inner, high.y + 0.09),
      radial(high.ang, ROOST_R - 0.14, ROOST_Y + 0.12),
      0.4
    )
  );
  return ladders;
}

/* ========================= decorative branches ========================= */

export interface LimbSpec {
  key: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  r: number;
}

/**
 * Bare limbs that carry leaf clusters. They only grow on the azimuths no
 * treehouse occupies, and the leafy ones are all up near the crown so the
 * platforms below stay unobstructed.
 */
export interface DecoLimb extends LimbSpec {
  /** Leaf blobs at the tip, and how big they are. */
  tuft: number;
  tuftScale: number;
}

export function buildDecoLimbs(): DecoLimb[] {
  const table: [number, number, number, number, number, number][] = [
    // angle, base height, reach, rise, tuft count, tuft scale
    // leaders springing from the fork above the roost — these carry the canopy
    [1.30, 11.75, 3.3, 2.5, 4, 0.72],
    [2.55, 12.05, 3.0, 2.7, 4, 0.7],
    [3.60, 11.7, 3.4, 2.5, 4, 0.74],
    [4.75, 12.05, 3.1, 2.7, 4, 0.7],
    [5.85, 11.75, 3.3, 2.5, 4, 0.72],
    [0.30, 12.0, 2.9, 2.8, 4, 0.68],
    // mid-tree limbs: bare framework, tiny leaf tips only
    [3.18, 4.5, 2.0, 1.1, 2, 0.34],
    [4.78, 7.3, 1.8, 1.0, 2, 0.32],
    [0.35, 5.4, 1.9, 1.1, 2, 0.34],
    [2.30, 6.8, 1.9, 1.0, 2, 0.32],
  ];
  return table.map(([ang, y, reach, rise, tuft, tuftScale], i) => ({
    key: `d${i}`,
    from: radial(ang, trunkR(y) - 0.12, y),
    to: radial(ang, trunkR(y) + reach, y + rise),
    r: y > 10 ? 0.24 : 0.11,
    tuft,
    tuftScale,
  }));
}

/* ================================ buds ================================ */

export interface BudSpec {
  key: string;
  p: [number, number, number];
  ang: number;
  scale: number;
  phase: number;
}

/**
 * Sprouting buds on bare stretches of trunk — the sites the tree has not grown
 * into yet. They breathe gently so the tree reads as still growing.
 */
export function buildBuds(): BudSpec[] {
  const table: [number, number][] = [
    [1.72, 3.6],
    [3.18, 7.4],
    [4.78, 4.1],
    [0.35, 5.3],
    [6.15, 3.2],
    [2.45, 10.3],
    [4.05, 9.1],
    [0.95, 7.0],
    [5.6, 7.9],
  ];
  const rng = mulberry32(9091);
  return table.map(([ang, y], i) => {
    const p = radial(ang, trunkR(y) - 0.05, y);
    return {
      key: `b${i}`,
      p: [p.x, p.y, p.z] as [number, number, number],
      ang,
      scale: 0.75 + rng() * 0.55,
      phase: rng() * Math.PI * 2,
    };
  });
}

/* ============================== foliage =============================== */

export interface Placement {
  p: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
  c?: string;
}

const LEAF_GREENS = ['#8ed48f', '#79c884', '#a6de9b', '#6fbd7c'];
const BLOSSOM = '#f4b6cd';

/**
 * Every leaf blob in the tree, as instance placements: the crown dome, a
 * parasol above each treehouse, and clusters on the decorative limbs.
 */
export function buildFoliage(
  perches: PerchSpec[],
  limbs: DecoLimb[]
): Placement[] {
  const rng = mulberry32(4242);
  const out: Placement[] = [];

  const push = (
    x: number,
    y: number,
    z: number,
    s: number,
    pinkChance: number
  ) => {
    out.push({
      p: [x, y, z],
      r: [rng() * Math.PI, rng() * Math.PI, rng() * Math.PI],
      s: [s, s * (0.72 + rng() * 0.2), s],
      c: rng() < pinkChance ? BLOSSOM : LEAF_GREENS[Math.floor(rng() * 4)],
    });
  };

  // Crown: a squashed dome sitting entirely above the roost, so nothing leafy
  // ever hangs in front of a treehouse.
  const N = 62;
  for (let i = 0; i < N; i++) {
    const k = i + 0.5;
    const phi = Math.acos(1 - (2 * k) / N);
    const theta = Math.PI * (1 + Math.sqrt(5)) * k;
    const r = CROWN_R * (0.8 + rng() * 0.3);
    const x = Math.sin(phi) * Math.cos(theta) * r;
    const z = Math.sin(phi) * Math.sin(theta) * r;
    const y = CROWN_Y + Math.cos(phi) * r * 0.74;
    if (y < CROWN_FLOOR) continue;

    push(x, y, z, 0.55 + rng() * 0.4, 0.15);
  }
  // A ring along the canopy's lower edge so it has a defined underside.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.3;
    const r = CROWN_R * (0.82 + rng() * 0.18);
    push(
      Math.cos(a) * r,
      CROWN_FLOOR + 0.1 + rng() * 0.45,
      Math.sin(a) * r,
      0.56 + rng() * 0.3,
      0.2
    );
  }

  // A leafy fringe hanging just outside and below each deck — frames the
  // treehouse without covering it.
  for (const p of perches) {
    for (let i = 0; i < 2; i++) {
      const a = p.ang + (i === 0 ? 0.34 : -0.34) + (rng() - 0.5) * 0.12;
      const d = p.dist + p.R * (0.55 + rng() * 0.3);
      push(
        Math.cos(a) * d,
        p.y - 0.35 - rng() * 0.35,
        Math.sin(a) * d,
        0.3 + p.R * 0.16,
        0.18
      );
    }
  }

  // Clusters on the bare limbs.
  for (const l of limbs) {
    const dir = l.to.clone().sub(l.from);
    for (let i = 0; i < l.tuft; i++) {
      const t = 0.76 + i * 0.13;
      const px = l.from.x + dir.x * t + (rng() - 0.5) * 0.45;
      const py = l.from.y + dir.y * t + 0.2 + (rng() - 0.5) * 0.35;
      const pz = l.from.z + dir.z * t + (rng() - 0.5) * 0.45;
      push(px, py, pz, l.tuftScale * (0.85 + rng() * 0.35), 0.14);
    }
  }

  // Keep an open column straight above the roost so its sign stays legible
  // from every orbit angle.
  return out.filter(
    (b) =>
      !(
        Math.hypot(b.p[0], b.p[2]) < 2.1 &&
        b.p[1] > ROOST_Y + 1.1 &&
        b.p[1] < CROWN_Y + 1.3
      )
  );
}

/* ============================ ground cover ============================ */

export interface GroundScatter {
  rocks: Placement[];
  tufts: Placement[];
  saplings: { p: [number, number, number]; s: number }[];
}

export function buildGround(): GroundScatter {
  const rng = mulberry32(777);
  const rocks: Placement[] = [];
  const tufts: Placement[] = [];
  const saplings: { p: [number, number, number]; s: number }[] = [];

  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const d = 3.2 + rng() * 7.5;
    const s = 0.35 + rng() * 0.6;
    rocks.push({
      p: [Math.cos(a) * d, 0.04, Math.sin(a) * d],
      r: [rng() * 3, rng() * 3, rng() * 3],
      s: [s, s * 0.65, s],
    });
  }
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const d = 2.4 + rng() * 8.5;
    const s = 0.6 + rng() * 0.75;
    tufts.push({
      p: [Math.cos(a) * d, 0.09, Math.sin(a) * d],
      r: [0, rng() * 3, 0],
      s: [s, s, s],
    });
  }
  // Saplings: the next generation of great trees.
  const sap: [number, number][] = [
    [1.1, 6.4],
    [2.9, 7.6],
    [4.6, 6.1],
    [5.9, 8.0],
  ];
  for (const [a, d] of sap) {
    saplings.push({
      p: [Math.cos(a) * d, 0, Math.sin(a) * d],
      s: 0.75 + rng() * 0.45,
    });
  }
  return { rocks, tufts, saplings };
}

/* =========================== shared geometry ========================== */
/* Built once at module scope (client:only, never SSR'd) and reused across
   the whole tree so the scene stays a handful of unique buffers. */

const trunkProfile: THREE.Vector2[] = [];
for (let i = 0; i <= 16; i++) {
  const y = (i / 16) * TRUNK_H;
  trunkProfile.push(new THREE.Vector2(trunkR(y), y));
}
trunkProfile.push(new THREE.Vector2(0.09, TRUNK_H + 0.35));

const groundGeo = new THREE.CircleGeometry(17, 30);
groundGeo.rotateX(-Math.PI / 2);

/** Unit limb: +Y aligned, base at y = 0, length 1, radius 1 tapering to 0.55. */
const limbGeo = new THREE.CylinderGeometry(0.55, 1, 1, 6, 1);
limbGeo.translate(0, 0.5, 0);

const stackGeo = new THREE.BoxGeometry(0.52, 0.5, 0.34);
stackGeo.translate(0, 0.25, 0);

export const GEO = {
  trunk: new THREE.LatheGeometry(trunkProfile, 9),
  limb: limbGeo,
  root: new THREE.ConeGeometry(0.34, 1.1, 5),
  ground: groundGeo,

  // decks
  deck: new THREE.CylinderGeometry(1, 0.9, 0.16, 11),
  deckTop: new THREE.CylinderGeometry(0.9, 0.9, 0.04, 11),
  rail: new THREE.TorusGeometry(1, 0.032, 4, 16),
  railPost: new THREE.BoxGeometry(0.06, 0.32, 0.06),
  brace: new THREE.BoxGeometry(0.09, 1, 0.09),

  // huts
  hutBody: new THREE.BoxGeometry(1, 0.8, 0.9),
  hutRoof: new THREE.ConeGeometry(0.88, 0.52, 4),
  chimney: new THREE.BoxGeometry(0.15, 0.36, 0.15),
  door: new THREE.BoxGeometry(0.24, 0.42, 0.03),
  window: new THREE.BoxGeometry(0.22, 0.2, 0.03),

  // markers
  gem: new THREE.OctahedronGeometry(0.24, 0),
  pole: new THREE.CylinderGeometry(0.026, 0.034, 1, 5),
  flag: new THREE.BoxGeometry(0.4, 0.24, 0.025),
  lantern: new THREE.SphereGeometry(0.09, 7, 6),
  lanternGlow: new THREE.SphereGeometry(0.22, 7, 6),

  // rope bridge + ladders
  plank: new THREE.BoxGeometry(0.54, 0.05, 0.2),
  rung: new THREE.BoxGeometry(0.05, 1, 0.05),
  ladderRail: new THREE.BoxGeometry(0.055, 1, 0.055),

  // pulley
  wheel: new THREE.TorusGeometry(0.17, 0.05, 4, 12),
  rope: new THREE.CylinderGeometry(0.017, 0.017, 1, 4),
  basket: new THREE.BoxGeometry(0.62, 0.34, 0.62),
  crate: new THREE.BoxGeometry(0.34, 0.26, 0.3),

  // build site
  post: new THREE.BoxGeometry(0.07, 0.9, 0.07),
  beam: new THREE.BoxGeometry(1.5, 0.07, 0.07),
  stack: stackGeo,

  // flora
  leaf: new THREE.IcosahedronGeometry(1, 0),
  tuft: new THREE.ConeGeometry(0.1, 0.28, 5),
  rock: new THREE.DodecahedronGeometry(0.26, 0),
  budStem: new THREE.CylinderGeometry(0.028, 0.05, 0.3, 5),
  budLeaf: new THREE.ConeGeometry(0.1, 0.26, 5),
  sapTrunk: new THREE.CylinderGeometry(0.05, 0.09, 0.8, 5),
  fallingLeaf: new THREE.TetrahedronGeometry(0.11, 0),

  // bots
  botBody: new THREE.ConeGeometry(0.155, 0.36, 8),
  botHead: new THREE.SphereGeometry(0.1, 8, 6),
  botEye: new THREE.SphereGeometry(0.019, 5, 4),
  botArm: new THREE.SphereGeometry(0.05, 6, 5),
  antenna: new THREE.CylinderGeometry(0.011, 0.011, 0.16, 4),
  antennaTip: new THREE.SphereGeometry(0.038, 6, 5),
  spark: new THREE.SphereGeometry(0.042, 5, 4),

  // misc
  cloudPuff: new THREE.SphereGeometry(0.62, 7, 5),
  scope: new THREE.CylinderGeometry(0.075, 0.105, 0.62, 8),
  hit: new THREE.SphereGeometry(1, 12, 10),
} as const;

/* =========================== shared materials ========================= */

function flat(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness });
}

export const MAT = {
  bark: flat('#b08063', 0.95),
  barkDark: flat('#9a6c52', 0.95),
  plank: flat('#e8c79a', 0.9),
  plankDark: flat('#cfa373', 0.9),
  post: flat('#b98a5e', 0.9),
  cream: flat('#fdf5e4', 0.85),
  roof: flat('#ec8a6f', 0.85),
  stone: flat('#cfc8bb', 0.95),
  rock: flat('#c9c2b4', 0.95),
  grass: flat('#a4d795', 0.98),
  leafInstanced: flat('#ffffff', 0.88),
  leafA: flat('#8ed48f', 0.88),
  leafB: flat('#79c884', 0.88),
  blossom: flat('#f4b6cd', 0.88),
  botFace: flat('#fdf2de', 0.7),
  botEye: new THREE.MeshBasicMaterial({ color: '#43405a' }),
  metal: flat('#b9b3c9', 0.5),
  rope: new THREE.LineBasicMaterial({ color: '#c2a074' }),
  spark: new THREE.MeshBasicMaterial({ color: '#fff6cf' }),
  window: new THREE.MeshStandardMaterial({
    color: '#ffe6ae',
    emissive: '#ffcf72',
    emissiveIntensity: 0.65,
    flatShading: true,
  }),
  lantern: new THREE.MeshBasicMaterial({ color: '#ffd98a' }),
  lanternGlow: new THREE.MeshBasicMaterial({
    color: '#ffc46a',
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  }),
  cloud: new THREE.MeshStandardMaterial({
    color: '#ffffff',
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  }),
  fallingLeaf: flat('#a8dd9f', 0.9),
} as const;
