import * as THREE from 'three';

/** Pastel gem palette — index-matched to the card accents on the page. */
export const GEM_COLORS = [
  '#ef7f93', // rose
  '#f5a25d', // apricot
  '#f0c75e', // honey
  '#6cc4d9', // sky
  '#9b8fe8', // lavender
  '#63c9a8', // mint
  '#e98fc3', // orchid
];

/** One island per project, laid out by the scene. All positions are world-space. */
export interface IslandSpec {
  id: string;
  title: string;
  loc: number;
  featured: boolean;
  index: number;
  /** Island scale — also the top-face radius in world units. */
  S: number;
  x: number;
  y: number;
  z: number;
  accent: string;
  /** Bot population. */
  bots: number;
  /** Radius bots wander within (local island coords). */
  walkR: number;
  /** Build-site position + scale (local island coords). */
  siteX: number;
  siteZ: number;
  siteScale: number;
}

/** Shared bob so world-space actors (the traveler) can ride an island's motion. */
export function islandBob(t: number, index: number): number {
  return Math.sin(t * 0.5 + index * 1.13) * 0.1;
}

export function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** Small deterministic PRNG so decoration layouts are stable across renders. */
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

/* ------------------------- shared geometries ------------------------- */
/* Created once at module scope (client:only, never SSR'd) and reused by
   every island/bot so the scene stays cheap. */

const progressGeo = new THREE.BoxGeometry(0.44, 0.5, 0.44);
progressGeo.translate(0, 0.25, 0); // grow upward when scale.y animates

export const GEO = {
  // unit island: top face at y = 0 when placed per Island component
  islandTop: new THREE.CylinderGeometry(1, 0.84, 0.34, 9),
  islandBottom: new THREE.ConeGeometry(0.84, 0.95, 9),
  shard: new THREE.DodecahedronGeometry(0.24, 0),
  // flora
  trunk: new THREE.CylinderGeometry(0.08, 0.12, 0.45, 6),
  cone0: new THREE.ConeGeometry(0.46, 0.62, 7),
  cone1: new THREE.ConeGeometry(0.34, 0.52, 7),
  cone2: new THREE.ConeGeometry(0.22, 0.42, 7),
  tuft: new THREE.ConeGeometry(0.09, 0.22, 5),
  rock: new THREE.DodecahedronGeometry(0.22, 0),
  // crystal marker
  pedestal: new THREE.CylinderGeometry(0.16, 0.25, 0.36, 6),
  gem: new THREE.OctahedronGeometry(0.32, 0),
  // banner
  pole: new THREE.CylinderGeometry(0.025, 0.035, 0.95, 5),
  flag: new THREE.BoxGeometry(0.32, 0.2, 0.03),
  // bots
  botBody: new THREE.ConeGeometry(0.11, 0.27, 8),
  botHead: new THREE.SphereGeometry(0.075, 8, 6),
  botEye: new THREE.SphereGeometry(0.013, 5, 4),
  botArm: new THREE.SphereGeometry(0.038, 6, 5),
  spark: new THREE.SphereGeometry(0.032, 5, 4),
  // build site
  post: new THREE.BoxGeometry(0.06, 0.55, 0.06),
  beam: new THREE.BoxGeometry(0.72, 0.06, 0.06),
  progress: progressGeo,
  // paper skiff
  hull: new THREE.BoxGeometry(0.3, 0.12, 0.6),
  sail: new THREE.ConeGeometry(0.16, 0.3, 4),
  // misc
  cloudPuff: new THREE.SphereGeometry(0.55, 7, 5),
  hit: new THREE.SphereGeometry(1, 12, 10),
} as const;

/* -------------------------- shared materials ------------------------- */

function flat(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness });
}

export const MAT = {
  dirt: flat('#a97e5f', 0.95),
  trunk: flat('#9c6b4f'),
  foliage: [flat('#79c98c', 0.85), flat('#6bbd85', 0.85), flat('#8fd49b', 0.85)],
  foliagePink: flat('#eeaec6', 0.85),
  rock: flat('#c9c2b4', 0.95),
  rock2: flat('#d6cfc0', 0.95),
  stone: flat('#cfc8bb'),
  post: flat('#b98a5e'),
  plank: flat('#d8b98a'),
  paper: flat('#ffffff', 0.6),
  paperShade: flat('#f3ede0', 0.6),
  botFace: flat('#fdf2de', 0.7),
  botEye: new THREE.MeshBasicMaterial({ color: '#43405a' }),
  spark: new THREE.MeshBasicMaterial({ color: '#fff8d9' }),
  traveler: flat('#6cc4d9', 0.6),
  cloud: new THREE.MeshStandardMaterial({
    color: '#ffffff',
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  }),
} as const;
