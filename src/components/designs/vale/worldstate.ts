/**
 * The Vale — world state as data.
 *
 * This module owns *everything the vale is* and nothing about how it looks on
 * screen: terrain chunks, the river, the road network, every village and every
 * building in it (with per-building `progress` and `condition`), the waypoint
 * graph the bots walk, the traveller routes between villages, and a build log.
 *
 * The output of `buildWorld()` is a plain, JSON-serialisable object built from
 * a seeded PRNG only — no `Date.now`, no `Math.random`, no DOM. It is meant to
 * be dumped to a committed `world.json` that a scheduled agent can diff and
 * patch: bump a building's `progress`, append a `buildLog` entry, add a
 * `VillageState`, and the renderer picks it up with no code change.
 *
 * Coordinates. Positions are isometric tile coordinates `(gx, gy)`. Authoring
 * happens in the screen-aligned pair `(u, v) = (gx - gy, gx + gy)`, because
 * screen space is simply `x = u * 16, y = v * 8`. `uv()` converts.
 */

export const WORLD_VERSION = 1;

/* ------------------------------ coordinates ----------------------------- */

export const TILE_W = 32;
export const TILE_H = 16;

export const isoX = (gx: number, gy: number): number => (gx - gy) * (TILE_W / 2);
export const isoY = (gx: number, gy: number): number => (gx + gy) * (TILE_H / 2);

/** Screen-aligned authoring coordinates → tile coordinates. */
export const uv = (u: number, v: number): [number, number] => [(u + v) / 2, (v - u) / 2];
export const toU = (gx: number, gy: number): number => gx - gy;
export const toV = (gx: number, gy: number): number => gx + gy;

/* --------------------------------- types -------------------------------- */

export type Biome = 'meadow' | 'forest' | 'farm' | 'wetland' | 'moor';

export type StructureRole =
  | 'cottage'
  | 'house'
  | 'hall'
  | 'barn'
  | 'workshop'
  | 'store'
  | 'chapel'
  | 'tower'
  | 'mill'
  | 'granary'
  | 'smithy'
  | 'shed'
  | 'homestead';

export type RoofStyle = 'hip' | 'gable' | 'flat' | 'thatch';

export type PropKind =
  | 'oak'
  | 'pine'
  | 'blossom'
  | 'hedgerow'
  | 'bush'
  | 'rock'
  | 'flowers'
  | 'reeds'
  | 'stump'
  | 'crop'
  | 'haystack'
  | 'fenceL'
  | 'fenceR'
  | 'shed'
  | 'cart'
  | 'crates'
  | 'lumber'
  | 'barrels'
  | 'well'
  | 'lamp'
  | 'signpost'
  | 'nameboard'
  | 'stake'
  | 'campfire'
  | 'sheep'
  | 'crane';

export interface Chunk {
  id: string;
  /** Chunk extent in screen-aligned authoring units. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  biome: Biome;
  /** Props per square authoring unit. */
  density: number;
  seed: number;
}

export interface Road {
  id: string;
  kind: 'highway' | 'lane' | 'track';
  /** Centreline, in tile coordinates. */
  pts: [number, number][];
  /** Half-width, in tiles, used for the dirt surface and prop clearance. */
  width: number;
  /** Villages this road joins, for the ledger and traveller routing. */
  ends: [string, string];
}

export interface Water {
  /** River centreline, in tile coordinates, north to south. */
  river: [number, number][];
  width: number;
  bridges: { gx: number; gy: number; span: number }[];
}

export interface WaypointNode {
  id: number;
  gx: number;
  gy: number;
  kind: 'road' | 'gate' | 'plaza' | 'door' | 'work';
  village: string | null;
  edges: number[];
}

export interface BuildingState {
  id: string;
  role: StructureRole;
  label: string;
  gx: number;
  gy: number;
  /** Footprint width in art pixels; multiples of 4 rasterise cleanly. */
  w: number;
  floors: number;
  roof: RoofStyle;
  accent: string;
  /** 0 = surveyed plot, 1 = finished. Agents nudge this over time. */
  progress: number;
  /** 1 = freshly painted, 0 = derelict. Weathers walls and roof. */
  condition: number;
  chimney: boolean;
  cupola: boolean;
  antenna: boolean;
  awning: boolean;
  banner: boolean;
  lit: boolean;
  seed: number;
}

export interface PropState {
  kind: PropKind;
  gx: number;
  gy: number;
  seed: number;
  /** Owning chunk or village, so a patch can target a region. */
  owner: string;
}

export interface VillageState {
  id: string;
  name: string;
  kind: 'project' | 'homestead' | 'frontier';
  gx: number;
  gy: number;
  /** Rim radius in authoring units (= tiles). */
  radius: number;
  accent: string;
  loc: number;
  tech: string[];
  status: string;
  summary: string;
  href: string;
  /** Day of the vale calendar the village was founded on. */
  founded: number;
  population: number;
  buildings: BuildingState[];
  props: PropState[];
  /** Node ids: the ring the residents patrol, and the gates onto the roads. */
  plaza: number[];
  gates: number[];
  work: number[];
  sign: { gx: number; gy: number };
}

export interface TravelerState {
  id: string;
  kind: 'walker' | 'cart';
  from: string;
  to: string;
  /** Waypoint ids, gate to gate. */
  route: number[];
  /** Tiles per second. */
  speed: number;
  color: string;
  cargo: string;
  /** Starting position along the route, 0..1, so they do not set off together. */
  offset: number;
  errand: string;
}

export interface LogEntry {
  day: number;
  village: string;
  kind: 'found' | 'raise' | 'finish' | 'road' | 'trade';
  text: string;
}

export interface WorldState {
  version: number;
  seed: number;
  meta: {
    title: string;
    owner: string;
    tagline: string;
    /** Vale calendar day the snapshot was taken on. */
    day: number;
  };
  /** Full canvas extent, authoring units. */
  bounds: { u0: number; v0: number; u1: number; v1: number };
  /** The part worth framing — used for the fitted overview. */
  content: { u0: number; v0: number; u1: number; v1: number };
  chunks: Chunk[];
  water: Water;
  roads: Road[];
  nodes: WaypointNode[];
  villages: VillageState[];
  /** Structures that belong to the countryside rather than to a village. */
  landmarks: BuildingState[];
  /** Countryside scenery, outside village rims. */
  scatter: PropState[];
  travelers: TravelerState[];
  buildLog: LogEntry[];
}

export interface ProjectInput {
  id: string;
  title: string;
  summary: string;
  tech: string[];
  status: string;
  featured: boolean;
  loc: number;
  accent: string;
}

/* -------------------------------- helpers ------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/**
 * Distance in authoring units between two tile-space points. Village radii are
 * authored in `(u, v)`, so proximity tests against them must be too.
 */
export function uvDist(ax: number, ay: number, bx: number, by: number): number {
  const du = ax - ay - (bx - by);
  const dv = ax + ay - (bx + by);
  return Math.hypot(du, dv);
}

/** Nearest distance from a point to a polyline, in the polyline's own units. */
export function polylineDist(px: number, py: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** Breadth-first path between two waypoints. Exported: the sim uses it too. */
export function pathBetween(nodes: WaypointNode[], from: number, to: number): number[] {
  if (from === to) return [];
  const prev = new Int32Array(nodes.length).fill(-1);
  const seen = new Uint8Array(nodes.length);
  const q = [from];
  seen[from] = 1;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (const nx of nodes[cur].edges) {
      if (seen[nx]) continue;
      seen[nx] = 1;
      prev[nx] = cur;
      if (nx === to) {
        const path: number[] = [];
        let c = to;
        while (c !== from) {
          path.push(c);
          c = prev[c];
        }
        return path.reverse();
      }
      q.push(nx);
    }
  }
  return [];
}

/* ------------------------------- authoring ------------------------------ */

/**
 * Hand-placed village sites, in screen-aligned units. Composition beats a
 * formula: the big town sits north-west with room to sprawl, the frontier gets
 * the empty south-west corner, and the homestead holds the crossroads.
 */
const SITES: Record<string, { u: number; v: number; founded: number }> = {
  'finance-tracker': { u: 22, v: -22, founded: 96 },
  kdoitall: { u: 2, v: -40, founded: 210 },
  'project-hub': { u: 28, v: 12, founded: 305 },
  'pdf-merger': { u: -28, v: 8, founded: 388 },
  'war-card-game': { u: -14, v: -26, founded: 451 },
  'one-record-many-bells': { u: 2, v: 36, founded: 502 },
  'montage-it': { u: 24, v: 38, founded: 560 },
};

const SITE_FALLBACK = [
  { u: -16, v: 20, founded: 600 },
  { u: 14, v: 4, founded: 610 },
];

/**
 * Buildings that carry a project's personality, chosen from its stack. Order is
 * priority: the first match becomes the village's landmark, so the most
 * characteristic technology gets the biggest silhouette.
 */
const TECH_ROLES: [RegExp, StructureRole, string][] = [
  [/kde|wayland|x11|plasma|window/i, 'tower', 'Watch Tower'],
  [/discord|agent|bell|notification/i, 'chapel', 'Bell House'],
  [/pyinstaller|installer|\bbash\b|shell/i, 'smithy', 'The Smithy'],
  [/flask|django|\bapi\b/i, 'hall', 'Assembly Hall'],
  [/ffmpeg|digikam|media|plugin|converter/i, 'workshop', 'Cutting Room'],
  [/react|typescript|javascript|flutter|dart|tkinter/i, 'store', 'The Frontage'],
  [/sqlalchemy|sqlite|\bsql\b|docker|drive|database/i, 'granary', 'Record Granary'],
  [/python|stdlib|canvas/i, 'workshop', 'The Workshop'],
];

const FILLER: { role: StructureRole; label: string; roof: RoofStyle }[] = [
  { role: 'cottage', label: 'Cottage', roof: 'thatch' },
  { role: 'house', label: 'Row House', roof: 'gable' },
  { role: 'barn', label: 'Barn', roof: 'gable' },
  { role: 'cottage', label: 'Cottage', roof: 'hip' },
  { role: 'shed', label: 'Store Shed', roof: 'gable' },
  { role: 'house', label: 'Row House', roof: 'hip' },
  { role: 'cottage', label: 'Cottage', roof: 'thatch' },
  { role: 'barn', label: 'Long Barn', roof: 'gable' },
  { role: 'house', label: 'Row House', roof: 'gable' },
];

const ROOF_FOR: Partial<Record<StructureRole, RoofStyle>> = {
  hall: 'hip',
  store: 'gable',
  granary: 'hip',
  smithy: 'gable',
  tower: 'hip',
  chapel: 'gable',
  workshop: 'gable',
  mill: 'gable',
  homestead: 'gable',
};

/** Roads, authored in screen-aligned units and converted below. */
const ROAD_PLAN: {
  id: string;
  kind: Road['kind'];
  ends: [string, string];
  pts: [number, number][];
}[] = [
  {
    id: 'home-ft',
    kind: 'highway',
    ends: ['__home', 'finance-tracker'],
    pts: [[3.9, -3.9], [8, -6], [12, -10], [14.2, -14.2]],
  },
  {
    id: 'home-kd',
    kind: 'highway',
    ends: ['__home', 'kdoitall'],
    pts: [[0.3, -5.5], [0, -14], [1, -23], [1.6, -31.5]],
  },
  {
    id: 'home-ph',
    kind: 'highway',
    ends: ['__home', 'project-hub'],
    pts: [[5.05, 2.2], [11, 4], [16, 6.5], [20.7, 8.9]],
  },
  {
    id: 'home-pm',
    kind: 'highway',
    ends: ['__home', 'pdf-merger'],
    pts: [[-5.3, 1.5], [-9.35, 2.6], [-14, 4], [-21, 6]],
  },
  {
    id: 'home-orb',
    kind: 'highway',
    ends: ['__home', 'one-record-many-bells'],
    pts: [[0.3, 5.5], [-1, 14], [1, 23], [1.7, 31]],
  },
  {
    id: 'ft-kd',
    kind: 'lane',
    ends: ['finance-tracker', 'kdoitall'],
    pts: [[13.8, -29.4], [12, -32], [10, -33.5], [8.3, -34.3]],
  },
  {
    id: 'ft-ph',
    kind: 'lane',
    ends: ['finance-tracker', 'project-hub'],
    pts: [[23.9, -11.5], [26, -6], [27, 0], [26.6, 4.1]],
  },
  {
    id: 'wc-kd',
    kind: 'lane',
    ends: ['war-card-game', 'kdoitall'],
    pts: [[-9.9, -29.6], [-8.46, -30.9], [-6, -33], [-4.4, -34.6]],
  },
  {
    id: 'wc-pm',
    kind: 'lane',
    ends: ['war-card-game', 'pdf-merger'],
    pts: [[-16.1, -20.9], [-20, -13], [-23, -6], [-25.2, 1.3]],
  },
  {
    id: 'pm-frontier',
    kind: 'track',
    ends: ['pdf-merger', '__frontier'],
    pts: [[-26.9, 15.2], [-29, 20], [-28, 25], [-24.9, 28.2]],
  },
  {
    id: 'frontier-orb',
    kind: 'track',
    ends: ['__frontier', 'one-record-many-bells'],
    pts: [[-18.1, 34.5], [-13, 36.4], [-9, 36.6], [-5.4, 36], [-3, 35.6]],
  },
  {
    id: 'orb-mo',
    kind: 'lane',
    ends: ['one-record-many-bells', 'montage-it'],
    pts: [[7, 36.4], [11, 37.4], [15, 38], [19.2, 37.7]],
  },
  {
    id: 'ph-mo',
    kind: 'lane',
    ends: ['project-hub', 'montage-it'],
    pts: [[26.8, 19.9], [28.5, 24], [27, 29], [24.7, 33.2]],
  },
];

/** River, north to south, in screen-aligned units. */
const RIVER_PLAN: [number, number][] = [
  [-6, -58],
  [-9, -46],
  [-11, -36],
  [-5, -24],
  [-3, -12],
  [-8, -2],
  [-11, 8],
  [-9, 18],
  [-4, 28],
  [-6, 38],
  [-4, 48],
  [-2, 58],
];

/** Where the roads cross the water. Each one is a plank-and-pier crossing. */
const BRIDGE_PLAN: [number, number][] = [
  [-8.46, -30.9],
  [-9.35, 2.6],
  [-5.4, 36],
];

const BOUNDS = { u0: -45, v0: -58, u1: 45, v1: 54 };
const CONTENT = { u0: -36, v0: -54, u1: 34, v1: 45 };

const BOT_COLORS = ['#ef7f93', '#63c9a8', '#9b8fe8', '#f0c75e', '#6cc4d9', '#e98fc3', '#f5a25d'];

/* ------------------------------ construction ---------------------------- */

/**
 * A project's village is sized by the cube root of its line count, so 40× the
 * code is roughly 2× the town rather than 40×.
 */
function sizeOf(loc: number, minC: number, maxC: number): number {
  const c = Math.cbrt(loc);
  return Math.max(0, Math.min(1, (c - minC) / (maxC - minC || 1)));
}

function rolesFor(tech: string[], count: number): { role: StructureRole; label: string; roof: RoofStyle }[] {
  const out: { role: StructureRole; label: string; roof: RoofStyle }[] = [];
  const used = new Set<StructureRole>();
  for (const [re, role, label] of TECH_ROLES) {
    if (out.length >= count) break;
    if (used.has(role)) continue;
    if (tech.some((t) => re.test(t))) {
      used.add(role);
      out.push({ role, label, roof: ROOF_FOR[role] ?? 'gable' });
    }
  }
  let f = 0;
  while (out.length < count) {
    out.push(FILLER[f % FILLER.length]);
    f++;
  }
  return out;
}

export function buildWorld(projects: ProjectInput[]): WorldState {
  const rng = mulberry32(20260728);
  const nodes: WaypointNode[] = [];
  const villages: VillageState[] = [];
  const landmarks: BuildingState[] = [];
  const scatter: PropState[] = [];
  const buildLog: LogEntry[] = [];

  const addNode = (
    gx: number,
    gy: number,
    kind: WaypointNode['kind'],
    village: string | null
  ): number => {
    nodes.push({ id: nodes.length, gx, gy, kind, village, edges: [] });
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!nodes[a].edges.includes(b)) nodes[a].edges.push(b);
    if (!nodes[b].edges.includes(a)) nodes[b].edges.push(a);
  };

  /* ---- water ------------------------------------------------------- */
  const river: [number, number][] = RIVER_PLAN.map(([u, v]) => uv(u, v));
  const water: Water = {
    river,
    width: 0.95,
    bridges: BRIDGE_PLAN.map(([u, v]) => {
      const [gx, gy] = uv(u, v);
      return { gx, gy, span: 4.2 };
    }),
  };

  /* ---- roads ------------------------------------------------------- */
  const roads: Road[] = ROAD_PLAN.map((r) => ({
    id: r.id,
    kind: r.kind,
    ends: r.ends,
    width: r.kind === 'highway' ? 0.62 : r.kind === 'lane' ? 0.5 : 0.4,
    pts: r.pts.map(([u, v]) => uv(u, v)),
  }));

  // Sample waypoints along every road and chain them together.
  const roadTerminals: Record<string, [number, number]> = {};
  for (const road of roads) {
    const ids: number[] = [];
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const [ax, ay] = road.pts[i];
      const [bx, by] = road.pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.round(len / 2.6));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        ids.push(addNode(ax + (bx - ax) * t, ay + (by - ay) * t, 'road', null));
      }
    }
    const last = road.pts[road.pts.length - 1];
    ids.push(addNode(last[0], last[1], 'road', null));
    for (let i = 0; i + 1 < ids.length; i++) link(ids[i], ids[i + 1]);
    roadTerminals[road.id] = [ids[0], ids[ids.length - 1]];
  }

  // Weld road ends that meet at the same crossroads.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].kind !== 'road' || nodes[j].kind !== 'road') continue;
      const d = Math.hypot(nodes[i].gx - nodes[j].gx, nodes[i].gy - nodes[j].gy);
      if (d < 2.6) link(i, j);
    }
  }

  /* ---- villages ---------------------------------------------------- */
  const cs = projects.map((p) => Math.cbrt(p.loc));
  const minC = Math.min(...cs);
  const maxC = Math.max(...cs);

  interface Plan {
    id: string;
    name: string;
    kind: VillageState['kind'];
    u: number;
    v: number;
    radius: number;
    accent: string;
    loc: number;
    tech: string[];
    status: string;
    summary: string;
    href: string;
    founded: number;
    count: number;
    t: number;
  }

  const plans: Plan[] = [];

  plans.push({
    id: '__home',
    name: "Ethan's Homestead",
    kind: 'homestead',
    u: 0,
    v: 0,
    radius: 6.0,
    accent: '#63c9a8',
    loc: 0,
    tech: ['Astro', 'TypeScript', 'Canvas'],
    status: 'home',
    summary: 'Where the roads meet. Workshop, garden, and the smoke that never goes out.',
    href: '#about',
    founded: 1,
    count: 5,
    t: 0.6,
  });

  let fb = 0;
  projects.forEach((p) => {
    const site = SITES[p.id] ?? SITE_FALLBACK[fb++ % SITE_FALLBACK.length];
    const t = sizeOf(p.loc, minC, maxC);
    plans.push({
      id: p.id,
      name: p.title,
      kind: 'project',
      u: site.u,
      v: site.v,
      radius: 4.2 + t * 6.2,
      accent: p.accent,
      loc: p.loc,
      tech: p.tech,
      status: p.status,
      summary: p.summary,
      href: `/projects/${p.id}/`,
      founded: site.founded,
      count: Math.max(2, Math.min(11, Math.round(2 + t * 9))),
      t,
    });
  });

  plans.push({
    id: '__frontier',
    name: 'Site Eight',
    kind: 'frontier',
    u: -24,
    v: 34,
    radius: 6.4,
    accent: '#f0c75e',
    loc: 0,
    tech: ['surveyed', 'timber on order'],
    status: 'soon',
    summary: 'The eighth holding. Stakes in, plot pegged out, first frames going up.',
    href: '#projects',
    founded: 612,
    count: 5,
    t: 0.2,
  });

  /** Buildings that are deliberately mid-build, so the vale is visibly growing. */
  const PROGRESS_OVERRIDE: Record<string, Record<number, number>> = {
    'finance-tracker': { 8: 0.5 },
    'pdf-merger': { 3: 0.72 },
    'montage-it': { 1: 0.5 },
    __frontier: { 0: 0.56, 1: 0.34, 2: 0.2, 3: 0.08, 4: 0.05 },
  };

  for (const plan of plans) {
    const vrng = mulberry32(1000 + plan.u * 131 + plan.v * 977);
    const [cgx, cgy] = uv(plan.u, plan.v);
    const roles = rolesFor(plan.tech, plan.count);
    const buildings: BuildingState[] = [];
    const props: PropState[] = [];

    const baseW = 24 + plan.t * 18;
    const golden = 2.399963;
    for (let i = 0; i < plan.count; i++) {
      const spec = roles[i];
      const landmark = i === 0 && plan.kind !== 'frontier';
      // Ring the plaza. Small places get one loose ring; bigger ones get an
      // inner ring around the green and an outer ring of smallholdings.
      const inner = plan.count <= 4 ? plan.count : Math.max(3, Math.round(plan.count * 0.45));
      const ring = i < inner ? 0 : 1;
      const rr = ring === 0 ? (plan.count <= 4 ? 0.62 : 0.44) : 0.86;
      const r = plan.radius * rr * (0.9 + vrng() * 0.2);
      const a = i * golden + plan.u * 0.11;
      const du = Math.cos(a) * r;
      const dv = Math.sin(a) * r;
      const [dgx, dgy] = uv(du, dv);
      const w = Math.round((baseW * (landmark ? 1.5 : 0.86 + vrng() * 0.36)) / 4) * 4;
      const floors = landmark
        ? plan.t > 0.55
          ? 3
          : 2
        : plan.kind === 'frontier' || vrng() < 0.28 + plan.t * 0.3
          ? 2
          : 1;
      const progress = PROGRESS_OVERRIDE[plan.id]?.[i] ?? 1;
      buildings.push({
        id: `${plan.id}#${i}`,
        role: plan.kind === 'homestead' && i === 0 ? 'homestead' : spec.role,
        label: plan.kind === 'homestead' && i === 0 ? "Ethan's Workshop" : spec.label,
        gx: cgx + dgx,
        gy: cgy + dgy,
        w,
        floors,
        roof: spec.roof,
        accent: plan.accent,
        progress,
        condition: plan.kind === 'frontier' ? 1 : 0.72 + vrng() * 0.28,
        chimney: landmark || vrng() < 0.45,
        cupola: spec.role === 'chapel',
        antenna: spec.role === 'tower' && plan.t > 0.7,
        awning: spec.role === 'store',
        banner: landmark,
        lit: plan.kind === 'homestead' && i === 0,
        seed: 3000 + Math.round(plan.u * 17 + plan.v * 7 + i * 53),
      });
    }

    /* plaza ring + doors -------------------------------------------- */
    const ringN = plan.radius > 9 ? 10 : 8;
    const plaza: number[] = [];
    const ringR = plan.radius * 0.3;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      const [dgx, dgy] = uv(Math.cos(a) * ringR, Math.sin(a) * ringR);
      plaza.push(addNode(cgx + dgx, cgy + dgy, 'plaza', plan.id));
    }
    for (let i = 0; i < ringN; i++) link(plaza[i], plaza[(i + 1) % ringN]);

    const nearestPlaza = (gx: number, gy: number): number => {
      let best = plaza[0];
      let bd = Infinity;
      for (const id of plaza) {
        const d = Math.hypot(gx - nodes[id].gx, gy - nodes[id].gy);
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      return best;
    };

    const work: number[] = [];
    buildings.forEach((b) => {
      // Door node, pulled off the footprint back toward the plaza.
      const dx = b.gx - cgx;
      const dy = b.gy - cgy;
      const d = Math.hypot(dx, dy) || 1;
      const back = b.w / TILE_W / 2 + 1.1;
      const nx = b.gx - (dx / d) * back;
      const ny = b.gy - (dy / d) * back;
      const door = addNode(nx, ny, b.progress < 1 ? 'work' : 'door', plan.id);
      link(door, nearestPlaza(nx, ny));
      if (b.progress < 1) {
        work.push(door);
        const w2 = addNode(b.gx + 1.4, b.gy + 0.4, 'work', plan.id);
        const w3 = addNode(b.gx - 0.5, b.gy + 1.5, 'work', plan.id);
        link(door, w2);
        link(door, w3);
        work.push(w2, w3);
      }
    });

    /* gates: every road that terminates in this village -------------- */
    const gates: number[] = [];
    for (const road of roads) {
      for (const side of [0, 1] as const) {
        if (road.ends[side] !== plan.id) continue;
        const term = roadTerminals[road.id][side];
        const gate = addNode(nodes[term].gx, nodes[term].gy, 'gate', plan.id);
        link(gate, term);
        link(gate, nearestPlaza(nodes[term].gx, nodes[term].gy));
        gates.push(gate);
      }
    }

    /* village dressing ------------------------------------------------ */
    const addProp = (kind: PropKind, gx: number, gy: number, seed: number) => {
      props.push({ kind, gx, gy, seed, owner: plan.id });
    };
    const [wgx, wgy] = uv(plan.radius * 0.05, -plan.radius * 0.26);
    addProp('well', cgx + wgx, cgy + wgy, 5);
    for (let i = 0; i < (plan.radius > 8 ? 4 : 2); i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const [lx, ly] = uv(Math.cos(a) * ringR * 1.5, Math.sin(a) * ringR * 1.5);
      addProp('lamp', cgx + lx, cgy + ly, 11 + i);
    }
    // Name board out by the first gate, facing the road.
    let signGx = cgx;
    let signGy = cgy;
    if (gates.length) {
      const g = nodes[gates[0]];
      const dx = g.gx - cgx;
      const dy = g.gy - cgy;
      const d = Math.hypot(dx, dy) || 1;
      signGx = cgx + (dx / d) * (plan.radius * 0.72);
      signGy = cgy + (dy / d) * (plan.radius * 0.72);
      addProp('nameboard', signGx, signGy, 21);
    }
    // Smallholding kit scaled by how big the place is. A site being founded has
    // no crops or haystacks yet — it gets the builders' camp below instead.
    const dressN = plan.kind === 'frontier' ? 0 : Math.round(2 + plan.t * 7);
    for (let i = 0; i < dressN; i++) {
      const a = vrng() * Math.PI * 2;
      const r = plan.radius * (0.6 + vrng() * 0.5);
      const [px, py] = uv(Math.cos(a) * r, Math.sin(a) * r);
      const roll = vrng();
      const kind: PropKind =
        roll < 0.24 ? 'crop' : roll < 0.42 ? 'haystack' : roll < 0.58 ? 'shed' : roll < 0.72 ? 'crates' : roll < 0.86 ? 'barrels' : 'cart';
      addProp(kind, cgx + px, cgy + py, 200 + i * 31);
    }

    if (plan.kind === 'frontier') {
      // Surveyor's camp: stakes, cleared stumps, lumber and a crane.
      const at = (u: number, v: number, kind: PropKind, seed: number) => {
        const [px, py] = uv(u, v);
        addProp(kind, cgx + px, cgy + py, seed);
      };
      at(3.4, -2.2, 'crane', 3);
      at(-2.0, 4.4, 'campfire', 4);
      at(-5.2, 1.6, 'lumber', 6);
      at(1.6, 5.2, 'lumber', 7);
      at(6.0, 1.4, 'crates', 8);
      at(-6.2, -1.0, 'cart', 9);
      at(4.6, 4.6, 'barrels', 10);
      at(-3.0, -4.6, 'shed', 11);
      // cleared stumps and a ring of surveyor stakes marking the next plots
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        const rr = plan.radius * (0.78 + (i % 3) * 0.11);
        at(Math.cos(a) * rr, Math.sin(a) * rr, i % 3 === 0 ? 'stump' : 'stake', 40 + i);
      }
    }

    if (plan.kind === 'homestead') {
      addProp('signpost', cgx + 2.2, cgy + 2.4, 12);
      addProp('crop', cgx - 3.4, cgy + 2.6, 13);
      addProp('crop', cgx - 4.6, cgy + 1.2, 14);
      addProp('fenceL', cgx - 2.2, cgy + 4.2, 15);
      addProp('fenceR', cgx + 3.6, cgy - 2.4, 16);
      addProp('sheep', cgx - 3.0, cgy + 4.0, 17);
      addProp('sheep', cgx - 4.2, cgy + 3.4, 18);
    }

    villages.push({
      id: plan.id,
      name: plan.name,
      kind: plan.kind,
      gx: cgx,
      gy: cgy,
      radius: plan.radius,
      accent: plan.accent,
      loc: plan.loc,
      tech: plan.tech,
      status: plan.status,
      summary: plan.summary,
      href: plan.href,
      founded: plan.founded,
      population: Math.max(2, Math.round(2 + plan.t * 6)),
      buildings,
      props,
      plaza,
      gates,
      work,
      sign: { gx: signGx, gy: signGy },
    });
  }

  /* ---- the mill at the river bridge -------------------------------- */
  {
    const [mgx, mgy] = uv(-13.6, 9);
    landmarks.push({
      id: '__mill',
      role: 'mill',
      label: 'Vale Mill',
      gx: mgx,
      gy: mgy,
      w: 28,
      floors: 2,
      roof: 'gable',
      accent: '#b78a5e',
      progress: 1,
      condition: 0.8,
      chimney: false,
      cupola: false,
      antenna: false,
      awning: false,
      banner: false,
      lit: false,
      seed: 909,
    });
  }

  /* ---- terrain chunks ---------------------------------------------- */
  const chunks: Chunk[] = [];
  const CU = 9;
  const CV = 12;
  const cw = (BOUNDS.u1 - BOUNDS.u0) / CU;
  const chh = (BOUNDS.v1 - BOUNDS.v0) / CV;
  for (let j = 0; j < CV; j++) {
    for (let i = 0; i < CU; i++) {
      const u0 = BOUNDS.u0 + i * cw;
      const v0 = BOUNDS.v0 + j * chh;
      const cu = u0 + cw / 2;
      const cv = v0 + chh / 2;
      const [ccx, ccy] = uv(cu, cv);

      let biome: Biome = 'meadow';
      const edge = Math.max(
        Math.abs(cu) / (BOUNDS.u1 - 2),
        Math.abs(cv) / (BOUNDS.v1 - 2)
      );
      let nearVillage = Infinity;
      for (const v of villages) {
        nearVillage = Math.min(nearVillage, uvDist(ccx, ccy, v.gx, v.gy) - v.radius);
      }
      const nearRiver = polylineDist(ccx, ccy, river);
      if (edge > 0.78) biome = 'forest';
      else if (nearRiver < 6) biome = 'wetland';
      else if (nearVillage < 8) biome = 'farm';
      else if (cv > 24 && cu < -12) biome = 'moor';
      else if ((i * 7 + j * 13) % 5 === 0) biome = 'forest';

      const density =
        biome === 'forest' ? 0.34 : biome === 'wetland' ? 0.17 : biome === 'farm' ? 0.07 : biome === 'moor' ? 0.08 : 0.11;
      chunks.push({
        id: `c${i}_${j}`,
        u0,
        v0,
        u1: u0 + cw,
        v1: v0 + chh,
        biome,
        density,
        seed: 7000 + i * 101 + j * 313,
      });
    }
  }

  /* ---- countryside scatter ----------------------------------------- */
  const KINDS: Record<Biome, [PropKind, number][]> = {
    forest: [['oak', 0.34], ['pine', 0.3], ['hedgerow', 0.12], ['bush', 0.14], ['stump', 0.05], ['rock', 0.05]],
    meadow: [['bush', 0.3], ['flowers', 0.24], ['rock', 0.14], ['oak', 0.14], ['blossom', 0.06], ['sheep', 0.12]],
    farm: [['bush', 0.22], ['crop', 0.2], ['haystack', 0.12], ['fenceL', 0.1], ['fenceR', 0.1], ['sheep', 0.14], ['oak', 0.12]],
    wetland: [['reeds', 0.42], ['bush', 0.24], ['rock', 0.14], ['blossom', 0.1], ['pine', 0.1]],
    moor: [['rock', 0.36], ['bush', 0.24], ['stump', 0.18], ['hedgerow', 0.12], ['flowers', 0.1]],
  };

  const roadLines = roads.map((r) => r.pts);
  const clearOf = (gx: number, gy: number, pad: number): boolean => {
    for (const v of villages) {
      if (uvDist(gx, gy, v.gx, v.gy) < v.radius + 2.4) return false;
    }
    for (const line of roadLines) {
      if (polylineDist(gx, gy, line) < 1.5 + pad) return false;
    }
    if (polylineDist(gx, gy, river) < 2.0 + pad) return false;
    return true;
  };

  for (const chunk of chunks) {
    const crng = mulberry32(chunk.seed);
    const area = (chunk.u1 - chunk.u0) * (chunk.v1 - chunk.v0);
    const target = Math.round(area * chunk.density);
    const table = KINDS[chunk.biome];
    let placed = 0;
    for (let i = 0; i < target * 4 && placed < target; i++) {
      const u = chunk.u0 + crng() * (chunk.u1 - chunk.u0);
      const v = chunk.v0 + crng() * (chunk.v1 - chunk.v0);
      const [gx, gy] = uv(u, v);
      const roll = crng();
      let acc = 0;
      let kind: PropKind = table[0][0];
      for (const [k, w] of table) {
        acc += w;
        if (roll <= acc) {
          kind = k;
          break;
        }
      }
      const pad = kind === 'crop' ? 1.4 : kind === 'oak' || kind === 'pine' ? 0.4 : 0;
      if (!clearOf(gx, gy, pad)) continue;
      scatter.push({ kind, gx, gy, seed: chunk.seed + i * 37, owner: chunk.id });
      placed++;
    }
  }

  /* ---- travellers --------------------------------------------------- */
  const travelers: TravelerState[] = [];
  const byId = new Map(villages.map((v) => [v.id, v]));
  const ERRANDS: [string, string, string, TravelerState['kind']][] = [
    ['__home', 'finance-tracker', 'ledgers for the counting house', 'cart'],
    ['finance-tracker', '__home', 'a sack of receipts', 'walker'],
    ['__home', 'kdoitall', 'window fittings', 'cart'],
    ['kdoitall', 'project-hub', 'a crate of presets', 'walker'],
    ['project-hub', 'montage-it', 'metadata, boxed', 'cart'],
    ['one-record-many-bells', '__home', 'the mail', 'walker'],
    ['__home', 'one-record-many-bells', 'the mail, answered', 'walker'],
    ['pdf-merger', '__home', 'a bundle of pages', 'cart'],
    ['__home', '__frontier', 'timber for the eighth holding', 'cart'],
    ['one-record-many-bells', '__frontier', 'nails and rope', 'cart'],
    ['war-card-game', 'finance-tracker', 'a hundred decks', 'walker'],
    ['finance-tracker', 'pdf-merger', 'quarterly statements', 'cart'],
    ['montage-it', 'one-record-many-bells', 'a reel of finished film', 'walker'],
    ['pdf-merger', '__frontier', 'a survey plan', 'walker'],
  ];

  ERRANDS.forEach(([from, to, cargo, kind], i) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b || !a.gates.length || !b.gates.length) return;
    let best: number[] = [];
    for (const ga of a.gates) {
      for (const gb of b.gates) {
        const p = pathBetween(nodes, ga, gb);
        if (p.length && (!best.length || p.length < best.length)) best = [ga, ...p];
      }
    }
    if (best.length < 3) return;
    travelers.push({
      id: `t${i}`,
      kind,
      from,
      to,
      route: best,
      speed: kind === 'cart' ? 1.5 : 2.0,
      color: BOT_COLORS[i % BOT_COLORS.length],
      cargo: b.accent,
      offset: (i * 0.137) % 1,
      errand: cargo,
    });
  });

  /* ---- ledger -------------------------------------------------------
     The narrative entries are authored; the construction entries are derived
     from the buildings themselves, so the log can never drift from the map. */
  const day = 640;
  buildLog.push(
    { day: 96, village: 'finance-tracker', kind: 'found', text: 'The counting town pegged out on the north-east rise. Eleven plots surveyed.' },
    { day: 305, village: 'project-hub', kind: 'road', text: 'West highway metalled as far as the ford; the mill wheel turns again.' },
    { day: 502, village: 'one-record-many-bells', kind: 'finish', text: 'Bell House finished. One record in the box, many bells on the roof.' },
    { day: 612, village: '__frontier', kind: 'found', text: 'Site Eight staked out at the south-west frontier. Stumps cleared, crane raised.' }
  );

  const wip = villages
    .flatMap((v) => v.buildings.filter((b) => b.progress < 1).map((b) => ({ v, b })))
    .sort((a, z) => z.b.progress - a.b.progress);
  wip.forEach(({ v, b }, i) => {
    const where = `${b.label} at ${v.name}`;
    const text =
      b.progress < 0.15
        ? `Plot pegged out for the ${where}: stakes in, chalk lines down.`
        : b.progress < 0.5
          ? `Frame standing on the ${where}. Roof timbers still on the cart.`
          : b.progress < 0.85
            ? `Walls to plate height on the ${where}; scaffold stays another season.`
            : `The ${where} is all but done — trim, glazing and paint left.`;
    buildLog.push({ day: 614 + i * 3, village: v.id, kind: 'raise', text });
  });

  buildLog.push(
    {
      day: 634,
      village: '__home',
      kind: 'trade',
      text: `${travelers.length} carts and walkers on the roads between ${villages.length} settlements. Nobody is idle.`,
    },
    { day, village: '__home', kind: 'trade', text: 'Snapshot taken. The vale is up to date.' }
  );
  buildLog.sort((a, b) => a.day - b.day);

  return {
    version: WORLD_VERSION,
    seed: 20260728,
    meta: {
      title: 'The Vale',
      owner: 'CodeManEthan',
      tagline: 'Software engineer & agentic engineer',
      day,
    },
    bounds: BOUNDS,
    content: CONTENT,
    chunks,
    water,
    roads,
    nodes,
    villages,
    landmarks,
    scatter,
    travelers,
    buildLog,
  };
}

/* ------------------------------ presentation ---------------------------- */

export function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

export function villageSize(n: number): string {
  if (n >= 25000) return 'town';
  if (n >= 10000) return 'large village';
  if (n >= 3000) return 'village';
  return 'hamlet';
}
