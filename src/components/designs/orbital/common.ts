import * as THREE from 'three';

/**
 * Orbital Yard — shared world constants, geometries and materials.
 *
 * Everything here is created once at module scope. The scene is mounted
 * `client:only`, so this never runs during SSR and every island/drone can
 * share the same buffers.
 */

/* ------------------------------- world spec ------------------------------ */

/** One docked module per project. */
export interface ModuleSpec {
  id: string;
  title: string;
  tech: string[];
  loc: number;
  featured: boolean;
  index: number;
  /** Hull radius — cbrt(loc) scaled. */
  R: number;
  /** Cylindrical body length (caps extend past it). */
  len: number;
  /** Length of each end cap. */
  cap: number;
  /** Slot angle around the hub. */
  ang: number;
  /** Distance of the module centre from the station axis. */
  radius: number;
  /** Height above/below the ring plane. */
  dy: number;
  /** Radius at which the docking arm meets the module. */
  inner: number;
  accent: string;
}

/** Number of docking slots on the ring — projects plus the expansion bay. */
export const SLOTS = 8;

/** Radius of the central hub drum. */
export const HUB_R = 1.9;

/** Radius of the octagonal ring truss that ties the arms together. */
export const RING_R = 4.0;

/**
 * Angle of a slot in the ring plane. The base phase is tuned so that on first
 * load the largest module sits front-right and the expansion bay front-left.
 */
export function slotAngle(i: number): number {
  return (i / SLOTS) * Math.PI * 2 + 0.5236;
}

/** Shared hover bookkeeping so the scene can pause its idle auto-rotate. */
export interface HoverCtx {
  hover: number;
}

/**
 * Live state of the expansion bay. Mutated by the welder drone and read by
 * the half-built module, deliberately outside React state — otherwise the
 * whole station would re-render several times a second.
 */
export interface BuildCtx {
  /** True while the welder is actually laying a bead. */
  welding: boolean;
  /** 0..1 — how much of the new hull has been skinned. */
  progress: number;
}

export function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** Small deterministic PRNG so layouts are stable across renders. */
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

/* ------------------------------ procedural art ---------------------------- */

/** Soft round sprite — untextured points render as hard squares. */
function discTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/**
 * The deep-space backdrop, painted once into a canvas and mapped to the
 * inside of a big sphere: indigo base, a few soft nebula blooms and a dust of
 * far stars. Cheaper and calmer than a second particle field.
 */
function skyTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#070a1e');
  base.addColorStop(0.5, '#101540');
  base.addColorStop(1, '#080a24');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // A handful of very soft blooms. The sphere is 180 units across, so this
  // texture is magnified hard — anything with an edge reads as a smear.
  const rng = mulberry32(20260728);
  const blooms: Array<[string, number]> = [
    ['96, 74, 190', 0.13],
    ['42, 116, 158', 0.11],
    ['172, 88, 140', 0.07],
    ['64, 158, 156', 0.08],
    ['108, 86, 200', 0.1],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const [rgb, a] = blooms[i % blooms.length];
    const x = rng() * w;
    const y = 80 + rng() * (h - 160);
    const r = 130 + rng() * 190;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(0.55, `rgba(${rgb}, ${a * 0.35})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const DISC = discTexture();
export const SKY_TEX = skyTexture();

/* ----------------------------- shared geometry ---------------------------- */

/** Cylindrical hull, axis along +X, unit radius and unit length. */
function hull(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Hemispherical end cap, pole along +X. */
function cap(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Square truss frame (a 4-segment torus is a square ring), axis along +X. */
function frame(tube: number): THREE.TorusGeometry {
  const g = new THREE.TorusGeometry(1, tube, 4, 4);
  g.rotateZ(Math.PI / 4);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Rib hoop around a hull, axis along +X. */
function rib(): THREE.TorusGeometry {
  const g = new THREE.TorusGeometry(1, 0.055, 4, 12);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Curved hull plate covering 60° of a module, axis along +X. */
function shell(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true, 0, Math.PI / 3);
  g.rotateZ(Math.PI / 2);
  return g;
}



/** Parabolic-ish dish, opening along +Y. */
function dish(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI * 0.44);
  g.rotateX(Math.PI);
  return g;
}

export const GEO = {
  hull: hull(),
  cap: cap(),
  rib: rib(),
  shell: shell(),
  /** Tube thickness is relative — meant to be drawn at scale ~0.23. */
  frame: frame(0.24),
  dish: dish(),
  // hub
  drum: new THREE.CylinderGeometry(1, 1, 1, 12),
  drum8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 8),
  dome: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  ring: (() => {
    const g = new THREE.TorusGeometry(RING_R, 0.075, 4, SLOTS);
    g.rotateX(Math.PI / 2);
    return g;
  })(),
  // structure
  box: new THREE.BoxGeometry(1, 1, 1),
  rod: new THREE.CylinderGeometry(1, 1, 1, 6),
  panel: new THREE.BoxGeometry(1, 0.035, 1),
  // drones
  droneBody: new THREE.OctahedronGeometry(0.16, 0),
  nacelle: new THREE.SphereGeometry(0.055, 6, 5),
  lens: new THREE.SphereGeometry(0.045, 6, 5),
  pod: new THREE.BoxGeometry(0.26, 0.2, 0.26),
  podGlow: new THREE.BoxGeometry(0.32, 0.26, 0.32),
  plume: new THREE.ConeGeometry(0.07, 0.34, 6),
  spark: new THREE.SphereGeometry(0.075, 4, 3),
  beacon: new THREE.SphereGeometry(0.085, 6, 5),
  // interaction
  hit: new THREE.SphereGeometry(1, 12, 10),
} as const;

/* ----------------------------- shared materials --------------------------- */

function flat(
  color: string,
  roughness = 0.6,
  metalness = 0.15
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness,
    metalness,
  });
}

export const MAT = {
  hull: flat('#d3d8ea', 0.55, 0.18),
  hullWarm: flat('#e8e2d6', 0.55, 0.12),
  hullDark: flat('#79809f', 0.5, 0.3),
  hullTrim: flat('#5b6285', 0.45, 0.35),
  plate: new THREE.MeshStandardMaterial({
    color: '#cfd6ea',
    flatShading: true,
    roughness: 0.5,
    metalness: 0.2,
    side: THREE.DoubleSide,
  }),
  truss: flat('#98a0c2', 0.45, 0.4),
  trussDark: flat('#666e92', 0.5, 0.4),
  trussRaw: flat('#b2761f', 0.7, 0.2), // unpainted expansion framing
  solar: new THREE.MeshStandardMaterial({
    color: '#28377d',
    emissive: '#1a2660',
    emissiveIntensity: 0.55,
    flatShading: true,
    roughness: 0.3,
    metalness: 0.5,
    side: THREE.DoubleSide,
  }),
  solarFrame: flat('#aeb6d4', 0.5, 0.4),
  radiator: flat('#eef1fa', 0.35, 0.1),
  dish: new THREE.MeshStandardMaterial({
    color: '#e6eaf6',
    flatShading: true,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide,
  }),
  // Warm interior light — this is what makes the command module read as home.
  window: new THREE.MeshStandardMaterial({
    color: '#ffe6bd',
    emissive: '#ffbe6a',
    emissiveIntensity: 1.5,
    flatShading: true,
    roughness: 0.4,
  }),
  cupola: new THREE.MeshStandardMaterial({
    color: '#bfe6ff',
    emissive: '#ffcf8c',
    emissiveIntensity: 0.9,
    flatShading: true,
    transparent: true,
    opacity: 0.62,
    roughness: 0.2,
    metalness: 0.1,
  }),
  // drones
  droneShell: flat('#e4e8f6', 0.4, 0.3),
  droneDark: flat('#5f668a', 0.5, 0.4),
  droneGlow: new THREE.MeshBasicMaterial({ color: '#9df0ff' }),
  plume: new THREE.MeshBasicMaterial({
    color: '#8fe3ff',
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  }),
  spark: new THREE.MeshBasicMaterial({ color: '#ffeab0' }),
  weldFlash: new THREE.MeshBasicMaterial({
    color: '#fff3cf',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }),
  crate: flat('#c9a06a', 0.75, 0.05),
  crateAlt: flat('#8a93b6', 0.6, 0.3),
  // environment
  planet: new THREE.MeshStandardMaterial({
    color: '#3d3269',
    roughness: 1,
    metalness: 0,
  }),
  planetAir: new THREE.MeshBasicMaterial({
    color: '#7ea6ff',
    transparent: true,
    opacity: 0.1,
    side: THREE.BackSide,
    depthWrite: false,
  }),
  moon: new THREE.MeshStandardMaterial({
    color: '#9ea3bd',
    flatShading: true,
    roughness: 1,
  }),
  sky: new THREE.MeshBasicMaterial({
    map: SKY_TEX,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }),
  // Screen-space sizes: the field sits 120+ units out, so attenuated points
  // would round away to nothing.
  star: new THREE.PointsMaterial({
    color: '#ffffff',
    map: DISC,
    size: 2.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  }),
  starFaint: new THREE.PointsMaterial({
    color: '#b9c8ff',
    map: DISC,
    size: 1.5,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }),
  dust: new THREE.PointsMaterial({
    color: '#bcd0ff',
    map: DISC,
    size: 0.09,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  }),
} as const;

/** Per-module accent: hull light strips, nav lights, cargo pods. */
export function accentMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.9,
    flatShading: true,
    roughness: 0.35,
    metalness: 0.1,
  });
}

/**
 * Hull paint, faintly tinted toward the module's accent. Just enough that two
 * neighbouring modules never read as the same grey tube.
 */
export function hullMaterial(accent: string): THREE.MeshStandardMaterial {
  const c = new THREE.Color('#d3d8ea').lerp(new THREE.Color(accent), 0.2);
  return new THREE.MeshStandardMaterial({
    color: c,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.18,
  });
}
