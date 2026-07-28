/**
 * Hamlet Frontier — the world state.
 *
 * This module produces ONE plain, serializable, deterministic object that
 * describes the whole settlement: terrain zones, the road, every building with
 * its `state` / `progress` / `condition`, the scattered props, the entities and
 * their routes, the notice-board build log, and the authored camera tour.
 *
 * Nothing in here touches the DOM, canvas or React. The renderer consumes this
 * object and nothing else — which is the point: this shape is designed to be
 * committed as a `world.json` that scheduled agents diff and patch. Changing a
 * building from `active` to `growing`, adding a build-log line, or staking a
 * new plot are all one-field edits to data, never edits to drawing code.
 *
 * Conventions
 * -----------
 * • Positions are authored in screen-aligned (u, v): +u runs along the road
 *   toward the frontier, +v runs toward the viewer. See pixels.ts.
 * • Every random choice comes from a seeded PRNG, so the object is a pure
 *   function of `seed` + the project inputs.
 */

import { mulberry32, uvDist } from './pixels';

/* ------------------------------ public types ---------------------------- */

export type BuildingState = 'active' | 'growing' | 'resting' | 'planned';

export type RoofStyle = 'hip' | 'gable' | 'flat';

/** Purely visual bolt-ons that give each project a distinct silhouette. */
export interface BuildingForm {
  /** Footprint width on screen, in art pixels. Always a multiple of 4. */
  width: number;
  floors: number;
  roof: RoofStyle;
  chimney?: boolean;
  /** A stair tower at the back. */
  tower?: boolean;
  /** An open belfry with a swinging bell — the one-record-many-bells joke. */
  belfry?: boolean;
  antenna?: boolean;
  awning?: boolean;
  /** Shopfront lantern by the door. */
  lantern?: boolean;
}

export interface WorldBuilding {
  id: string;
  /** 'project' buildings link to a project page; the rest are set dressing. */
  kind: 'project' | 'workshop' | 'sawmill' | 'plot' | 'cottage';
  title: string;
  /** One line of flavour shown under the title on hover. */
  blurb: string;
  href?: string;
  u: number;
  v: number;
  accent: string;
  form: BuildingForm;
  /** THE repo-reactive field. One edit here changes how the building reads. */
  state: BuildingState;
  /** 0–1. For `growing`: how far the new storey has gone up. */
  progress: number;
  /** 0–1. 1 = freshly painted; lower grows moss and ivy on `resting` houses. */
  condition: number;
  /** Present only on `kind: 'project'`. */
  project?: {
    loc: number;
    tech: string[];
    status: 'public' | 'private' | 'soon';
    featured: boolean;
  };
  seed: number;
}

export type PropKind =
  | 'oak'
  | 'conifer'
  | 'blossom'
  | 'bush'
  | 'rock'
  | 'flowers'
  | 'stump'
  | 'felled'
  | 'lumber'
  | 'crates'
  | 'sawdust'
  | 'shed'
  | 'haystack'
  | 'crop'
  | 'well'
  | 'lamp'
  | 'signpost'
  | 'fenceL'
  | 'fenceR'
  | 'noticeboard'
  | 'crane'
  | 'cartParked'
  | 'milestone';

export interface WorldProp {
  kind: PropKind;
  u: number;
  v: number;
  /** Selects one of a handful of cached sprite variants. */
  variant: number;
}

export interface WorldEntity {
  id: string;
  kind: 'villager' | 'builder' | 'sawyer' | 'cart';
  color: string;
  /** Villagers wander the lane graph; carts shuttle between two u positions. */
  route?: { fromU: number; toU: number; loadedOutbound: boolean };
  /** Where a villager starts and, for workers, where it prefers to be. */
  homeU?: number;
  homeV?: number;
  /** Phase offset so a spawn of villagers doesn't move in lockstep. */
  offset: number;
}

export interface LogEntry {
  /** Short day label rendered on the notice board. */
  day: string;
  text: string;
}

export interface Waypoint {
  id: string;
  /** Camera centre, in u. */
  u: number;
  /** Small vertical drift, in v, for a touch of cinematic variety. */
  v: number;
  label: string;
  caption: string;
  /** Buildings this beat is about — used for the screen-reader tour anchors. */
  focus: string[];
}

export interface TerrainZone {
  u0: number;
  u1: number;
  kind: 'settled' | 'meadow' | 'clearing' | 'wild';
}

export interface RoadPoint {
  u: number;
  v: number;
  /** Half-width, in tiles. The road narrows to a track at the frontier. */
  w: number;
}

export interface WorldState {
  version: 1;
  seed: number;
  meta: {
    name: string;
    keeper: string;
    tagline: string;
    /** Bell period bounds, in seconds. */
    bellEverySec: [number, number];
  };
  terrain: {
    /** Authoring bounds of the whole world, in (u, v). */
    u0: number;
    u1: number;
    v0: number;
    v1: number;
    zones: TerrainZone[];
  };
  road: RoadPoint[];
  /** Widened dirt areas: the plaza, the sawmill yard, the build site. */
  clearings: { u: number; v: number; r: number }[];
  buildings: WorldBuilding[];
  props: WorldProp[];
  entities: WorldEntity[];
  buildLog: LogEntry[];
  tour: Waypoint[];
}

export interface ProjectInput {
  id: string;
  title: string;
  tech: string[];
  status: 'public' | 'private' | 'soon';
  featured: boolean;
  loc: number;
  accent: string;
}

/* ------------------------- the authored settlement ---------------------- */

/**
 * Per-project placement and repo-reactive state. THIS is the table a future
 * agent edits: move a building by changing `u`/`v`, change how it reads by
 * changing `state`, `progress` or `condition`. Nothing else needs to know.
 */
const PLOTS: Record<
  string,
  {
    u: number;
    v: number;
    roof: RoofStyle;
    state: BuildingState;
    progress?: number;
    condition?: number;
    blurb: string;
    tower?: boolean;
    belfry?: boolean;
    antenna?: boolean;
    awning?: boolean;
    lantern?: boolean;
  }
> = {
  'one-record-many-bells': {
    u: 18,
    v: -6,
    roof: 'hip',
    belfry: true,
    state: 'active',
    blurb: 'the bell tower — one record, many bells, rung on the hour',
  },
  'finance-tracker': {
    u: 34,
    v: -7,
    roof: 'flat',
    tower: true,
    antenna: true,
    state: 'active',
    blurb: 'the counting house — the biggest ledger in the valley',
  },
  kdoitall: {
    u: 45,
    v: 7,
    roof: 'gable',
    awning: true,
    lantern: true,
    state: 'active',
    blurb: 'the workshop of many doors — opens the whole street at once',
  },
  'project-hub': {
    u: 60,
    v: -7,
    roof: 'hip',
    tower: true,
    state: 'growing',
    progress: 0.78,
    blurb: 'the guildhall — a fourth floor of scaffolding went up this week',
  },
  'pdf-merger': {
    u: 72,
    v: 7.5,
    roof: 'gable',
    state: 'growing',
    progress: 0.5,
    blurb: 'the bindery — new wing half-planked, plugins stacked in the yard',
  },
  'war-card-game': {
    u: 84,
    v: -6.5,
    roof: 'hip',
    awning: true,
    lantern: true,
    state: 'resting',
    condition: 0.4,
    blurb: 'the card house — shuttered and mossy, but the lamp is still lit',
  },
  'montage-it': {
    u: 114,
    v: -6.5,
    roof: 'gable',
    state: 'growing',
    progress: 0.38,
    blurb: 'the frontier frame — newest plot, walls going up as you watch',
  },
};

const FALLBACK_PLOTS = [
  { u: 52, v: 9, roof: 'gable' as RoofStyle },
  { u: 94, v: 9, roof: 'hip' as RoofStyle },
  { u: 26, v: 9, roof: 'gable' as RoofStyle },
];

/** Cube-root compression: 40× the code becomes ~2.3× the footprint. */
function sizeOf(loc: number, minC: number, maxC: number) {
  const c = Math.cbrt(loc);
  const t = Math.max(0, Math.min(1, (c - minC) / (maxC - minC || 1)));
  const width = Math.round((32 * (1 + t * 1.3)) / 4) * 4;
  const floors = 1 + Math.round(t * 3.1);
  return { width, floors, t };
}

/* ------------------------------- the road ------------------------------- */

const ROAD: RoadPoint[] = [
  { u: -22, v: 6.0, w: 1.15 },
  { u: -6, v: 3.2, w: 1.25 },
  { u: 8, v: 0.6, w: 1.4 },
  { u: 22, v: -0.4, w: 1.35 },
  { u: 36, v: 1.6, w: 1.25 },
  { u: 50, v: 3.4, w: 1.2 },
  { u: 62, v: 2.0, w: 1.15 },
  { u: 74, v: -0.6, w: 1.1 },
  { u: 88, v: 1.4, w: 1.0 },
  { u: 100, v: 3.6, w: 0.95 },
  { u: 112, v: 2.2, w: 0.85 },
  { u: 124, v: 0.4, w: 0.7 },
  { u: 136, v: 1.2, w: 0.5 },
  { u: 148, v: 3.0, w: 0.34 },
  { u: 160, v: 4.4, w: 0.2 },
];

/** Road centreline v at a given u. The road is monotonic in u by construction. */
export function roadV(state: WorldState, u: number): number {
  const pts = state.road;
  if (u <= pts[0].u) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i].u) {
      const t = (u - pts[i - 1].u) / (pts[i].u - pts[i - 1].u);
      const e = t * t * (3 - 2 * t);
      return pts[i - 1].v + (pts[i].v - pts[i - 1].v) * e;
    }
  }
  return pts[pts.length - 1].v;
}

export function roadW(state: WorldState, u: number): number {
  const pts = state.road;
  if (u <= pts[0].u) return pts[0].w;
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i].u) {
      const t = (u - pts[i - 1].u) / (pts[i].u - pts[i - 1].u);
      return pts[i - 1].w + (pts[i].w - pts[i - 1].w) * t;
    }
  }
  return pts[pts.length - 1].w;
}

/** Distance, in tiles, from (u, v) to the road surface. Negative-safe. */
export function roadDist(state: WorldState, u: number, v: number): number {
  let best = Infinity;
  const pts = state.road;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len2 = du * du + dv * dv || 1;
    let t = ((u - a.u) * du + (v - a.v) * dv) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = uvDist(u - (a.u + du * t), v - (a.v + dv * t));
    if (d < best) best = d;
  }
  return best;
}

export function zoneAt(state: WorldState, u: number): TerrainZone['kind'] {
  for (const z of state.terrain.zones) if (u >= z.u0 && u < z.u1) return z.kind;
  return 'meadow';
}

/* ------------------------------ the builder ----------------------------- */

const BOT_COLORS = [
  '#ef7f93',
  '#63c9a8',
  '#9b8fe8',
  '#f0c75e',
  '#6cc4d9',
  '#e98fc3',
  '#f5a25d',
];

const SAWMILL_U = 99;
const SITE_U = 114;
const PLOT_U = 132;
const WORKSHOP_U = 7;

export function buildWorldState(projects: ProjectInput[], seed = 20260728): WorldState {
  const rng = mulberry32(seed);
  const buildings: WorldBuilding[] = [];
  const props: WorldProp[] = [];
  const entities: WorldEntity[] = [];

  /* ---- Ethan's workshop, at the arrival end of the road ---------------- */
  buildings.push({
    id: '__workshop',
    kind: 'workshop',
    title: "Ethan's Workshop",
    blurb: 'the keeper lives here — smoke on the chimney, lamp always lit',
    href: '#about',
    u: WORKSHOP_U,
    v: -6.5,
    accent: '#63c9a8',
    form: {
      width: 60,
      floors: 2,
      roof: 'gable',
      chimney: true,
      awning: true,
      lantern: true,
    },
    state: 'active',
    progress: 1,
    condition: 1,
    seed: 7,
  });

  /* ---- one building per project ---------------------------------------- */
  const cs = projects.map((p) => Math.cbrt(p.loc));
  const minC = Math.min(...cs);
  const maxC = Math.max(...cs);
  let fb = 0;

  projects.forEach((p, i) => {
    const plot = PLOTS[p.id] ?? { ...FALLBACK_PLOTS[fb++ % 3], state: 'active' as const, blurb: 'a house on the lane' };
    const { width, floors } = sizeOf(p.loc, minC, maxC);
    buildings.push({
      id: p.id,
      kind: 'project',
      title: p.title,
      blurb: plot.blurb,
      href: `/projects/${p.id}/`,
      u: plot.u,
      v: plot.v,
      accent: p.accent,
      form: {
        width,
        floors,
        roof: plot.roof,
        chimney: plot.roof !== 'flat' && !plot.belfry && i % 2 === 0,
        tower: plot.tower,
        belfry: plot.belfry,
        antenna: plot.antenna,
        awning: plot.awning,
        lantern: plot.lantern,
      },
      state: plot.state,
      progress: plot.progress ?? 1,
      condition: plot.condition ?? 1,
      project: {
        loc: p.loc,
        tech: p.tech,
        status: p.status,
        featured: p.featured,
      },
      seed: 100 + i * 37,
    });
  });

  /* ---- the sawmill, feeding the frontier -------------------------------- */
  buildings.push({
    id: '__sawmill',
    kind: 'sawmill',
    title: 'The Sawmill',
    blurb: 'turns the cleared timber into the lumber the carts haul uphill',
    u: SAWMILL_U,
    v: 8,
    accent: '#c89457',
    form: { width: 44, floors: 1, roof: 'gable', chimney: false },
    state: 'active',
    progress: 1,
    condition: 1,
    seed: 512,
  });

  /* ---- the staked plot: whatever gets built next ------------------------ */
  buildings.push({
    id: '__nextplot',
    kind: 'plot',
    title: 'Plot 8 — unclaimed',
    blurb: 'surveyed, staked and string-lined. Nothing has been committed yet',
    u: PLOT_U,
    v: -4,
    accent: '#9b8fe8',
    form: { width: 40, floors: 2, roof: 'gable' },
    state: 'planned',
    progress: 0,
    condition: 1,
    seed: 900,
  });

  /* ---- a couple of anonymous cottages so the street isn't only projects -- */
  const cottages: [number, number, RoofStyle, BuildingState][] = [
    [26, 8, 'gable', 'active'],
    [53, -7, 'hip', 'resting'],
    [76, -7, 'gable', 'active'],
    [91, -7, 'hip', 'resting'],
  ];
  cottages.forEach(([u, v, roof, st], i) => {
    buildings.push({
      id: `__cottage${i}`,
      kind: 'cottage',
      title: 'A neighbour’s cottage',
      blurb: 'not mine — but somebody has to keep the bread ovens going',
      u,
      v,
      accent: ['#d8b78c', '#c9a4b6', '#a9b9d6', '#cdbf95'][i],
      form: {
        width: 28,
        floors: 1,
        roof,
        chimney: true,
      },
      state: st,
      progress: 1,
      condition: st === 'resting' ? 0.6 : 1,
      seed: 300 + i * 17,
    });
  });

  /* ---------------------------- terrain zones ---------------------------- */
  const terrain: WorldState['terrain'] = {
    u0: -24,
    u1: 164,
    // v0 sits just behind the far building line: anything further back would
    // land above the horizon, where the baked treeline takes over.
    v0: -24,
    v1: 28,
    zones: [
      { u0: -24, u1: 24, kind: 'settled' },
      { u0: 24, u1: 92, kind: 'meadow' },
      { u0: 92, u1: 128, kind: 'clearing' },
      { u0: 128, u1: 164, kind: 'wild' },
    ],
  };

  const clearings = [
    { u: WORKSHOP_U + 3, v: 0.4, r: 5.2 },
    { u: SAWMILL_U, v: 6.5, r: 4.2 },
    { u: SITE_U, v: -3.5, r: 4.6 },
  ];

  /* ------------------------- authored set dressing ----------------------- */
  const push = (kind: PropKind, u: number, v: number, variant = 0) =>
    props.push({ kind, u, v, variant });

  // plaza furniture
  push('well', 1.5, 4.5);
  push('noticeboard', 12.5, 4.2);
  push('signpost', -4, 4.6, 0);
  push('lamp', 4, -3.2);
  push('lamp', 14, 5.4);
  push('lamp', 24, -3.4);
  push('milestone', 30, 6.2, 0);
  push('milestone', 70, 6.4, 1);
  push('milestone', 110, 6.6, 2);

  // kitchen gardens + yards beside the lived-in houses
  const yards: [number, number, PropKind][] = [
    [12, -13, 'crop'],
    [30, 10.5, 'crop'],
    [41, -12, 'crop'],
    [50, 13, 'haystack'],
    [57, 12, 'crop'],
    [66, -13, 'crop'],
    [77, -12, 'haystack'],
    [84, 12.5, 'crop'],
    [22, 12, 'shed'],
    [39, 12.5, 'shed'],
    [64, 12.5, 'shed'],
    [90, 12, 'shed'],
    [47, -13.5, 'shed'],
    [28, -13, 'haystack'],
    [70, 13.5, 'haystack'],
  ];
  yards.forEach(([u, v, k], i) => push(k, u, v, i));

  // The quiet end: an overgrown cluster around the resting houses, so the
  // beat has something to look at besides one small building.
  for (const [k, u, v] of [
    ['blossom', 78.5, -10.5],
    ['bush', 80.5, -3.6],
    ['bush', 87.5, -3.4],
    ['bush', 86.8, -10.2],
    ['bush', 94, -4.2],
    ['haystack', 77, -12.5],
    ['oak', 95.5, -11],
    ['flowers', 82, -3.2],
    ['flowers', 89, -3.6],
  ] as [PropKind, number, number][]) {
    push(k, u, v, 40 + Math.round(u));
  }

  for (const [u, v, d] of [
    [17, 11.5, 0],
    [19.6, 12.8, 0],
    [43, -14.5, 1],
    [45.6, -13.2, 1],
    [82, 11.5, 0],
    [84.6, 12.8, 0],
  ] as [number, number, number][]) {
    push(d === 0 ? 'fenceL' : 'fenceR', u, v, 0);
  }

  // ---- the clearing: stumps left in the felling rows the fellers worked
  //      along, and a few trunks still waiting to go down to the mill.
  const crng = mulberry32(seed ^ 0x5f5f);
  for (let row = 0; row < 4; row++) {
    const side = row % 2 === 0 ? -1 : 1;
    const baseV = side * (8 + row * 3.5);
    for (let i = 0; i < 6; i++) {
      const u = 94 + i * 5.2 + crng() * 2.4 + row * 1.6;
      const v = baseV + (crng() - 0.5) * 2.4;
      if (Math.abs(v - roadV({ road: ROAD } as WorldState, u)) < 4) continue;
      push('stump', u, v, row * 6 + i);
    }
  }
  for (let i = 0; i < 5; i++) {
    push('felled', 96 + i * 6.5 + crng() * 3, (i % 2 ? 1 : -1) * (11 + crng() * 5), i);
  }
  // sawmill yard: log deck in, sawn lumber out
  push('felled', SAWMILL_U - 5.5, 12.5, 1);
  push('felled', SAWMILL_U - 4.2, 14.4, 2);
  push('lumber', SAWMILL_U + 4.5, 12.2, 0);
  push('lumber', SAWMILL_U + 6.4, 10.6, 1);
  push('sawdust', SAWMILL_U + 1.5, 13.2, 0);
  push('cartParked', SAWMILL_U + 8.5, 11.4, 0);
  push('crates', SAWMILL_U - 7, 9.5, 0);

  // build site dressing
  push('crane', SITE_U + 5.5, -6.5, 0);
  push('lumber', SITE_U - 5, -2.5, 2);
  push('lumber', SITE_U + 2.5, -1.2, 3);
  push('crates', SITE_U - 3, -0.4, 1);
  push('crates', SITE_U + 6.5, -1.6, 2);
  push('sawdust', SITE_U - 1, -4.5, 1);
  push('shed', SITE_U - 8.5, -6, 9);
  push('signpost', SITE_U - 7, -1.5, 1);

  // staked plot surroundings — surveyed, nothing built
  push('signpost', PLOT_U - 5, -1.5, 2);
  push('stump', PLOT_U + 4, -8.5, 90);
  push('stump', PLOT_U - 6, -9.5, 91);

  /* -------------------------- scattered flora ---------------------------- */
  const occupied: [number, number, number][] = [];
  for (const b of buildings) {
    occupied.push([b.u, b.v, b.form.width / 32 + 1.6]);
  }
  for (const p of props) {
    occupied.push([p.u, p.v, 1.1]);
  }
  for (const c of clearings) occupied.push([c.u, c.v, c.r * 0.75]);

  const stub = { road: ROAD, terrain } as WorldState;
  const free = (u: number, v: number, pad: number): boolean => {
    if (roadDist(stub, u, v) < roadW(stub, u) + pad + 0.5) return false;
    for (const [ou, ov, r] of occupied) {
      if (uvDist(u - ou, v - ov) < r + pad) return false;
    }
    return true;
  };

  let placed = 0;
  for (let attempt = 0; attempt < 14000 && placed < 980; attempt++) {
    const u = terrain.u0 + rng() * (terrain.u1 - terrain.u0);
    const v = terrain.v0 + rng() * (terrain.v1 - terrain.v0);
    const zone = zoneAt(stub, u);
    const roll = rng();

    // Density and mix follow the zone: tended near the plaza, thinned to
    // stumps in the clearing, thick woods beyond the last stake.
    let kind: PropKind;
    let pad: number;
    if (zone === 'clearing') {
      if (roll < 0.42) continue; // the clearing is, well, cleared
      if (roll < 0.52) {
        kind = 'stump';
        pad = 0.9;
      } else if (roll < 0.75) {
        kind = 'bush';
        pad = 0.55;
      } else if (roll < 0.88) {
        kind = 'rock';
        pad = 0.5;
      } else {
        kind = 'conifer';
        pad = 1.2;
      }
    } else if (zone === 'wild') {
      if (roll < 0.46) {
        kind = 'conifer';
        pad = 1.15;
      } else if (roll < 0.66) {
        kind = 'oak';
        pad = 1.2;
      } else if (roll < 0.84) {
        kind = 'bush';
        pad = 0.55;
      } else {
        kind = 'flowers';
        pad = 0.42;
      }
    } else {
      if (roll < 0.2) {
        kind = 'oak';
        pad = 1.2;
      } else if (roll < 0.3) {
        kind = 'blossom';
        pad = 1.15;
      } else if (roll < 0.36) {
        kind = 'conifer';
        pad = 1.15;
      } else if (roll < 0.62) {
        kind = 'bush';
        pad = 0.55;
      } else if (roll < 0.74) {
        kind = 'rock';
        pad = 0.5;
      } else {
        kind = 'flowers';
        pad = 0.42;
      }
    }

    // Keep the far bank behind the buildings dense so the street reads as a
    // corridor, and thin the near foreground so it doesn't block the view.
    // Thin the very near foreground a little so it never curtains the street.
    if (v > 17 && rng() < 0.22) continue;
    if (!free(u, v, pad)) continue;
    occupied.push([u, v, pad]);
    props.push({ kind, u, v, variant: attempt });
    placed++;
  }

  // Backdrop: a treed bank behind the far building line, so the settlement
  // reads as a street with something behind it rather than as houses adrift in
  // an open field. Thinned where the fellers have been working.
  // The v range runs well past `terrain.v0`: a tall viewport can see much
  // further back than a short one, and anything above the horizon is culled by
  // the renderer anyway.
  for (let i = 0; i < 900; i++) {
    const u = terrain.u0 + rng() * (terrain.u1 - terrain.u0);
    const v = -40 + rng() * 28;
    const zone = zoneAt(stub, u);
    if (zone === 'clearing' && rng() < 0.72) continue;
    const roll = rng();
    const kind: PropKind =
      roll < 0.44 ? 'conifer' : roll < 0.76 ? 'oak' : roll < 0.9 ? 'bush' : 'blossom';
    const pad = kind === 'bush' ? 0.5 : 0.95;
    if (!free(u, v, pad)) continue;
    occupied.push([u, v, pad]);
    props.push({ kind, u, v, variant: 3000 + i });
  }

  // A wall of conifers past the last stake: the world keeps going.
  for (let i = 0; i < 160; i++) {
    const u = 138 + rng() * 26;
    const v = -40 + rng() * 68;
    if (roadDist(stub, u, v) < 2.2) continue;
    props.push({ kind: 'conifer', u, v, variant: 5000 + i });
  }

  /* ------------------------------ entities ------------------------------- */
  // Villagers cluster around the houses that are alive; builders live at the
  // two `growing` sites; sawyers work the mill; carts shuttle lumber uphill.
  const alive = buildings.filter(
    (b) => b.state === 'active' && b.kind !== 'sawmill'
  );
  alive.forEach((b, i) => {
    entities.push({
      id: `v${i}`,
      kind: 'villager',
      color: BOT_COLORS[i % BOT_COLORS.length],
      homeU: b.u,
      homeV: b.v,
      offset: rng() * 10,
    });
  });
  for (let i = 0; i < 5; i++) {
    entities.push({
      id: `w${i}`,
      kind: 'villager',
      color: BOT_COLORS[(i + 3) % BOT_COLORS.length],
      homeU: 6 + i * 22,
      homeV: 2,
      offset: rng() * 10,
    });
  }
  const growing = buildings.filter((b) => b.state === 'growing');
  growing.forEach((b, i) => {
    const n = b.id === 'montage-it' ? 3 : 1;
    for (let k = 0; k < n; k++) {
      entities.push({
        id: `b${i}_${k}`,
        kind: 'builder',
        color: BOT_COLORS[(i * 2 + k) % BOT_COLORS.length],
        homeU: b.u,
        homeV: b.v,
        offset: rng() * 10,
      });
    }
  });
  entities.push({
    id: 'saw0',
    kind: 'sawyer',
    color: '#f5a25d',
    homeU: SAWMILL_U - 4,
    homeV: 11.5,
    offset: 0,
  });
  entities.push({
    id: 'saw1',
    kind: 'sawyer',
    color: '#6cc4d9',
    homeU: SAWMILL_U + 3.4,
    homeV: 11.2,
    offset: 1.6,
  });
  entities.push({
    id: 'cart0',
    kind: 'cart',
    color: '#f0c75e',
    route: { fromU: SAWMILL_U, toU: SITE_U, loadedOutbound: true },
    offset: 0,
  });
  entities.push({
    id: 'cart1',
    kind: 'cart',
    color: '#9b8fe8',
    route: { fromU: SAWMILL_U, toU: SITE_U, loadedOutbound: true },
    offset: 0.55,
  });
  // the mail cart runs the whole road — the attract-mode camera follows it
  entities.push({
    id: 'mail',
    kind: 'cart',
    color: '#ef7f93',
    route: { fromU: -14, toU: 128, loadedOutbound: false },
    offset: 0.25,
  });

  /* ------------------------------ build log ------------------------------ *
     Renders on the notice board. Newest first; a scheduled agent appends. */
  const buildLog: LogEntry[] = [
    { day: 'Tue', text: 'Juniper raised the north wall on the Montage-It frame' },
    { day: 'Tue', text: 'two loads of sawn lumber hauled up from the mill' },
    { day: 'Mon', text: 'surveyed and staked the east plot — plot 8, unclaimed' },
    { day: 'Mon', text: 'Guildhall scaffolding taken to the fourth lift' },
    { day: 'Sun', text: 'bindery wing half-planked; plugin crates stacked in the yard' },
    { day: 'Sat', text: 'bell rehung at the tower — rings on the hour again' },
    { day: 'Fri', text: 'card house shuttered for the season; lamp left burning' },
    { day: 'Fri', text: 'felled nine trees along the east ride for the clearing' },
  ];

  /* -------------------------------- tour --------------------------------- */
  const tour: Waypoint[] = [
    {
      id: 'plaza',
      u: 10,
      v: 0,
      label: 'Arrival',
      caption:
        'The road comes in from the west and widens into the plaza. Ethan’s workshop keeps the north side; the notice board opposite carries the week’s work.',
      focus: ['__workshop', 'one-record-many-bells'],
    },
    {
      id: 'high-street',
      u: 39,
      v: 0.6,
      label: 'High street',
      caption:
        'The two biggest codebases in the valley. Lit windows and smoke mean a repo that is still being worked in.',
      focus: ['finance-tracker', 'kdoitall'],
    },
    {
      id: 'the-lane',
      u: 66,
      v: 1.2,
      label: 'The lane',
      caption:
        'Both of these are growing: scaffolding up, a storey visibly going on. The lumber for it comes from the far end of the road.',
      focus: ['project-hub', 'pdf-merger'],
    },
    {
      id: 'quiet-end',
      u: 85,
      v: 0.4,
      label: 'The quiet end',
      caption:
        'Resting, not derelict. Moss on the tiles, ivy up the wall, one lamp still burning — a project that is finished rather than abandoned.',
      focus: ['war-card-game', '__cottage3'],
    },
    {
      id: 'frontier',
      u: 105,
      v: 1.6,
      label: 'The frontier',
      caption:
        'Where the village is still growing. The mill saws the cleared timber, carts haul it uphill, and the newest project is a frame with its walls half up.',
      focus: ['__sawmill', 'montage-it'],
    },
    {
      id: 'next-plot',
      u: 132,
      v: 0.6,
      label: 'Plot 8',
      caption:
        'Staked, string-lined and empty. Past it the road thins to a track and the woods take over again.',
      focus: ['__nextplot'],
    },
  ];

  return {
    version: 1,
    seed,
    meta: {
      name: 'Hamlet Frontier',
      keeper: 'CodeManEthan',
      tagline: 'Software engineer & agentic engineer',
      bellEverySec: [45, 60],
    },
    terrain,
    road: ROAD,
    clearings,
    buildings,
    props,
    entities,
    buildLog,
    tour,
  };
}
