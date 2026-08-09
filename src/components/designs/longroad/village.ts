/**
 * The Long Road — village layout.
 *
 * Pure, DOM-free, and deterministic: a village is a function of its project's
 * SLUG (never the date), so the same project lays out the same town every day
 * of the year. Everything random goes through `mulberry32(hashSeed(slug))`,
 * exactly as gen.ts does — no `Math.random`, no `Date.now`.
 *
 * The metadata mapping this file implements, in one place so it can be argued
 * with:
 *
 *   LOC        -> how many plots the town has, and what it is called.
 *                 57k Genesis is a market town; 2.3k is a hamlet.
 *   GEM_COLORS -> `accent`, which `buildStructure` spends on the ROOFS, the
 *                 banner, the gable ribbon and the name board. One glance
 *                 down the page and every town is a different colour.
 *   status     -> the approach. `public` opens its gates and signs the road,
 *                 `private` walls itself in stone behind a gatehouse, `soon`
 *                 is still scaffolding and half-built plots under a crane.
 *   featured   -> a beacon tower at the back of the town, lit.
 *   tech       -> the building roster. Each entry names a trade, the trades
 *                 become plots, and the plaque's chips say which is which.
 *
 * Coordinates are ART PIXELS in the band's own screen space, origin top-left.
 * The renderer converts to the vale's tile space where it needs to (the road
 * strips, the ground diamonds) so the projection is the valley's own.
 */

import { hashSeed, mulberry32 } from '../genesis/types.ts';
import type { BuildMaterial, RoofStyle, StructureRole } from '../vale/art.ts';

/* ------------------------------ the input -------------------------------- */

export type ProjectStatus = 'public' | 'private' | 'soon';

/** Everything the strip knows about one project. Serialised into the page. */
export interface RoadProject {
  slug: string;
  title: string;
  summary: string;
  tech: string[];
  status: ProjectStatus;
  featured: boolean;
  loc: number;
  /** GEM_COLORS[i], index-matched to `order`. */
  gem: string;
  href: string;
  repo?: string;
  demo?: string;
}

/* ------------------------------ the output ------------------------------- */

export interface VBuilding {
  x: number;
  y: number;
  role: StructureRole;
  w: number;
  floors: 1 | 2 | 3;
  roof: RoofStyle;
  accent: string;
  material?: BuildMaterial;
  progress: number;
  chimney: boolean;
  banner: boolean;
  cupola: boolean;
  awning: boolean;
  lit: boolean;
  seed: number;
  /** The featured town's lit beacon: the renderer burns a fire on the ridge. */
  beacon?: boolean;
}

/** Anything the art draws from a pooled sprite, addressed by pool key. */
export interface VProp {
  x: number;
  y: number;
  kind: string;
  seed: number;
}

/** Trees are their own list only so the renderer can pick the seasonal pool. */
export interface VTree {
  x: number;
  y: number;
  kind: 'oak' | 'pine' | 'blossom' | 'hedgerow' | 'birch' | 'willow' | 'fir';
  seed: number;
}

export interface VStall {
  x: number;
  y: number;
  seed: number;
}

export type VAnimalKind = 'sheep' | 'horse' | 'cattle' | 'dog' | 'duck' | 'deer';

export interface VAnimal {
  x: number;
  y: number;
  kind: VAnimalKind;
  faceRight: boolean;
  grazing: boolean;
  seed: number;
}

export type VBotAction = 'walk' | 'idle' | 'work' | 'carry';

/** A villager. `walk`/`carry` shuttle between (x,y) and (x2,y2). */
export interface VBot {
  x: number;
  y: number;
  x2: number;
  y2: number;
  action: VBotAction;
  color: string;
  /** Seconds for one leg of the round trip. */
  period: number;
  /** 0..1 offset into the cycle so a crew is not in lockstep. */
  phase: number;
}

/** A cart on the long road itself, crossing the band end to end. */
export interface VCart {
  color: string;
  cargo: string;
  dir: 1 | -1;
  /** Seconds to cross the whole band. */
  period: number;
  phase: number;
  /** Signed offset from the road centreline. */
  lane: number;
}

export interface VBird {
  x: number;
  y: number;
  /** Horizontal drift per second, art px. */
  vx: number;
  amp: number;
  period: number;
  phase: number;
}

export interface Village {
  slug: string;
  /** Which half of the band the town stands in. */
  side: 'left' | 'right';
  /** Band size in art pixels. */
  w: number;
  h: number;
  /** Road centreline height at x = 0, before the wave. */
  roadY: number;
  roadWave: number;
  accent: string;
  seed: number;
  tier: Tier;
  /** Hit rectangle for the village, art px — the renderer's hover glow and
   * the page's transparent link both use it. */
  hit: { x: number; y: number; w: number; h: number };
  buildings: VBuilding[];
  props: VProp[];
  trees: VTree[];
  stalls: VStall[];
  animals: VAnimal[];
  bots: VBot[];
  carts: VCart[];
  birds: VBird[];
  /** Fence/wall panels: pooled `fenceL|fenceR|drystoneL|drystoneR`. */
  wall: VProp[];
  /** Crop rows and hay, painted before the town so the fields sit behind. */
  fields: VProp[];
}

/* ------------------------------- the tiers ------------------------------- */

export interface Tier {
  /** How many plots the town has, beacon excluded. 3..8. */
  plots: number;
  /** "market town", "town", "village", "hamlet". */
  label: string;
  /** Does it hold a market? Only the biggest do. */
  market: boolean;
}

const LOC_MIN = 2000;
const LOC_MAX = 70000;

/**
 * Lines of code -> the size of the place, on a log scale so that the gap
 * between a 2.3k hamlet and a 4.2k one is worth as much as the gap between
 * 26k and 57k. Three plots at the bottom, eight at the top.
 */
export function tierOf(loc: number): Tier {
  const span = Math.log(LOC_MAX) - Math.log(LOC_MIN);
  const t = Math.max(0, Math.min(1, (Math.log(Math.max(loc, 1)) - Math.log(LOC_MIN)) / span));
  return {
    plots: 3 + Math.round(t * 5),
    label:
      loc >= 50000 ? 'market town' : loc >= 25000 ? 'town' : loc >= 10000 ? 'village' : 'hamlet',
    market: loc >= 50000,
  };
}

/* ---------------------------- the trade roster --------------------------- */

/**
 * What a line of `tech` builds. A stack is a list of trades, so the town's
 * roster is read straight off it: the language is the forge, the database is
 * the granary, the notification transport is the chapel and its bell.
 *
 * Deterministic twice over — a keyword match first, and for anything the table
 * has never heard of, the string's own hash indexes the same bag. Nothing here
 * looks at the clock, the project order, or anything but the string.
 */
const TRADE_TABLE: [RegExp, StructureRole][] = [
  [/discord|notif|bell|agent/i, 'chapel'],
  [/sql|sqlite|database|local-first|record/i, 'granary'],
  [/docker|astro|railway|deploy|plugin/i, 'store'],
  [/python|dart|bash|c\+\+|rust|go\b/i, 'smithy'],
  [/flask|django|kde|plasma|wayland|x11|api/i, 'mill'],
  [/react|typescript|javascript|flutter|canvas|ui/i, 'workshop'],
  [/ocr|tesseract|procedural|generation|vision|ml|llm/i, 'brewhouse'],
  [/stdlib|architecture|infrastructure/i, 'bakery'],
];

const TRADE_BAG: StructureRole[] = [
  'smithy',
  'mill',
  'chapel',
  'granary',
  'workshop',
  'store',
  'bakery',
  'brewhouse',
];

/** The trade one tech line stands for. Pure function of the string. */
export function tradeFor(tech: string): StructureRole {
  for (const [re, role] of TRADE_TABLE) if (re.test(tech)) return role;
  return TRADE_BAG[hashSeed(tech.toLowerCase()) % TRADE_BAG.length];
}

/** Plain-English name for a trade, for the plaque's chip tooltips. */
export function tradeName(role: StructureRole): string {
  const names: Partial<Record<StructureRole, string>> = {
    smithy: 'the smithy',
    mill: 'the mill',
    chapel: 'the chapel',
    granary: 'the granary',
    workshop: 'the workshop',
    store: 'the storehouse',
    bakery: 'the bakehouse',
    brewhouse: 'the brewhouse',
    hall: 'the moot hall',
    tower: 'the beacon',
  };
  return names[role] ?? role;
}

/**
 * When a town has more trades than plots, THIS is the order they are dropped
 * in — least distinctive silhouette first. A hamlet with three plots would
 * otherwise lose its chapel to a storehouse purely because of where the word
 * fell in the frontmatter, and the bell is the whole point of that project.
 */
const KEEP_ORDER: StructureRole[] = [
  'chapel',
  'mill',
  'granary',
  'smithy',
  'brewhouse',
  'bakery',
  'workshop',
  'store',
];

/** The town's roster of trades, in tech order, deduped. */
export function rosterOf(tech: string[]): StructureRole[] {
  const out: StructureRole[] = [];
  for (const t of tech) {
    const r = tradeFor(t);
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** The `n` trades a town of this size keeps, back in tech order. */
function trimRoster(trades: StructureRole[], n: number): StructureRole[] {
  if (trades.length <= n) return trades;
  const kept = [...trades]
    .sort((a, b) => KEEP_ORDER.indexOf(a) - KEEP_ORDER.indexOf(b))
    .slice(0, n);
  return trades.filter((t) => kept.includes(t));
}

/* ----------------------------- role furniture ---------------------------- */

const ROLE_W: Partial<Record<StructureRole, number>> = {
  hall: 48,
  mill: 44,
  chapel: 40,
  smithy: 40,
  workshop: 40,
  store: 40,
  brewhouse: 40,
  granary: 36,
  bakery: 36,
  barn: 44,
  homestead: 40,
  house: 36,
  cottage: 32,
  tower: 32,
};

const THATCHABLE = new Set<StructureRole>(['cottage', 'homestead', 'barn', 'house']);

/* -------------------------------- geometry ------------------------------- */

/** The road's centreline at x. One full wave to a band, so a band's road
 * leaves at exactly the height the next one picks it up at. */
export function roadYAt(v: Village, x: number): number {
  return v.roadY + Math.sin((x / v.w) * Math.PI * 2) * v.roadWave;
}

/* ------------------------------- the layout ------------------------------ */

const BOT_COLORS = ['#ef7f93', '#63c9a8', '#9b8fe8', '#f0c75e', '#6cc4d9', '#e98fc3', '#f5a25d'];
const CARGO_COLORS = ['#c8a86a', '#a9743e', '#d8c06a', '#9aa3ad'];

/**
 * Lay out one village in a band `w` x `h` art pixels.
 *
 * `side` is which half the town stands in; the other half is open country the
 * plaque is planted in. It alternates down the page so the eye zig-zags with
 * the road instead of running straight down a gutter.
 */
export function layoutVillage(
  p: RoadProject,
  w: number,
  h: number,
  side: 'left' | 'right'
): Village {
  const seed = hashSeed(`longroad:${p.slug}`);
  const rng = mulberry32(seed);
  const tier = tierOf(p.loc);
  const accent = p.gem;
  // A walled town is walled in stone, but its HOUSES stay timber: `accent` is
  // the project's colour on every other page of this site, and a slate roof
  // mixes two thirds of it away. The wall carries the status; the roofs carry
  // the identity.
  const stone = p.status === 'private';

  const roadY = Math.round(h * 0.66);
  const roadWave = Math.max(2, Math.round(h * 0.03));

  const v: Village = {
    slug: p.slug,
    side,
    w,
    h,
    roadY,
    roadWave,
    accent,
    seed,
    tier,
    hit: { x: 0, y: 0, w: 0, h: 0 },
    buildings: [],
    props: [],
    trees: [],
    stalls: [],
    animals: [],
    bots: [],
    carts: [],
    birds: [],
    wall: [],
    fields: [],
  };

  /* ---- where the town stands ---------------------------------------- */
  const hw = Math.min(w * 0.24, 30 + tier.plots * 13);
  const cx = side === 'left' ? Math.round(w * 0.1 + hw) : Math.round(w * 0.9 - hw);
  const x0 = cx - hw;
  const x1 = cx + hw;

  /* ---- the roster ---------------------------------------------------- */
  const trades = trimRoster(rosterOf(p.tech), tier.plots - 1);
  const roles: StructureRole[] = [];
  if (tier.plots >= 6) roles.push('hall');
  else roles.push(tier.plots >= 4 ? 'homestead' : 'cottage');
  for (const t of trades) roles.push(t);
  while (roles.length < tier.plots) roles.push(rng() < 0.42 ? 'house' : 'cottage');

  /* ---- two rows either side of the road ------------------------------ */
  // The road runs THROUGH the town: a back row up the slope behind it and a
  // front row below it, so the carriageway is street rather than bypass.
  const nBack = Math.ceil(roles.length * 0.58);
  const back = roles.slice(0, nBack);
  const front = roles.slice(nBack);

  const place = (list: StructureRole[], rowY: number, jitter: number) => {
    const m = list.length;
    const span = (x1 - x0) * (m === 1 ? 0 : 1);
    for (let j = 0; j < m; j++) {
      const t = m === 1 ? 0.5 : (j + 0.5) / m;
      const x = Math.round(x0 + span * t + (m === 1 ? hw : 0) + (rng() - 0.5) * 10);
      const y = Math.round(rowY + (rng() - 0.5) * jitter);
      const role = list[j];
      const wBase = ROLE_W[role] ?? 36;
      const floors: 1 | 2 | 3 =
        role === 'hall' || role === 'mill' ? 2 : role === 'cottage' ? 1 : rng() < 0.4 ? 2 : 1;
      const roof: RoofStyle = THATCHABLE.has(role) && rng() < 0.6 ? 'thatch' : 'gable';
      v.buildings.push({
        x,
        y,
        role,
        w: wBase,
        floors,
        roof,
        accent,
        progress: p.status === 'soon' ? 0.34 + rng() * 0.5 : 1,
        chimney: role !== 'chapel' && role !== 'granary' && rng() < 0.8,
        banner: role === 'hall' || role === 'store' || rng() < 0.22,
        cupola: role === 'hall' && rng() < 0.6,
        awning: role === 'store' || role === 'bakery',
        lit: false,
        seed: Math.floor(rng() * 1e9),
      });
    }
  };

  place(back, roadY - 28, 11);
  place(front, roadY + 24, 10);

  /* ---- the beacon ---------------------------------------------------- */
  if (p.featured) {
    v.buildings.push({
      // Deliberately no further back than this. A `tower` carries a turret,
      // a spire and a pennant that together stand 75px over its ground point
      // — half as much again as the hall beside it — so the beacon is the one
      // plot whose position is set by how tall it is rather than by the row.
      // …and it stands at whichever end of the town the gatehouse is not, so
      // a walled, featured town does not put two towers on the same corner.
      x: Math.round((side === 'left') === stone ? x1 + 6 : x0 - 6),
      y: roadY - 24,
      role: 'tower',
      w: 32,
      floors: 2,
      roof: 'hip',
      accent,
      progress: 1,
      chimney: false,
      banner: true,
      cupola: false,
      awning: false,
      lit: true,
      seed: Math.floor(rng() * 1e9),
      beacon: true,
    });
  }

  /* ---- the approach: what `status` builds on the road ----------------- */
  // The gate is always at the town's uphill end, so the road arrives at it.
  const gateX = Math.round(x0 - 16);
  const exitX = Math.round(x1 + 16);

  if (p.status === 'private') {
    // Walled, with a gatehouse. Drystone right round the back row, closed
    // panels either side of the road, and a small stone tower at the gate.
    // Panels are laid at their own width so the wall is a wall and not a row
    // of standing stones with daylight between them.
    const nPanel = Math.max(4, Math.round((x1 - x0 + 20) / 30));
    for (let i = 0; i <= nPanel; i++) {
      v.wall.push({
        x: Math.round(x0 - 10 + i * 30),
        y: roadY - 48,
        kind: 'drystoneR',
        seed: Math.floor(rng() * 1e9),
      });
    }
    for (let i = 0; i < 3; i++) {
      v.wall.push({
        x: Math.round(x0 - 10 + i * 8),
        y: roadY - 40 + i * 16,
        kind: 'drystoneL',
        seed: Math.floor(rng() * 1e9),
      });
    }
    v.wall.push({ x: gateX + 2, y: roadY + 22, kind: 'drystoneL', seed: Math.floor(rng() * 1e9) });
    v.buildings.push({
      x: gateX - 12,
      y: roadY - 20,
      role: 'tower',
      w: 24,
      floors: 2,
      roof: 'hip',
      accent,
      material: 'stone',
      progress: 1,
      chimney: false,
      banner: false,
      cupola: false,
      awning: false,
      lit: true,
      seed: Math.floor(rng() * 1e9),
    });
    v.props.push({ x: gateX + 2, y: roadY + 16, kind: 'lamp-stone', seed: 0 });
    v.props.push({ x: exitX, y: roadY - 16, kind: 'lamp-stone', seed: 0 });
  } else if (p.status === 'soon') {
    // A town mid-construction: a crane over the plots, timber stacked and the
    // plot stakes still in.
    v.props.push({ x: cx - 10, y: roadY - 20, kind: 'crane', seed: 0 });
    v.props.push({ x: cx + 26, y: roadY + 22, kind: 'lumber', seed: Math.floor(rng() * 1e9) });
    v.props.push({ x: cx - 34, y: roadY + 24, kind: 'lumber', seed: Math.floor(rng() * 1e9) });
    v.props.push({ x: gateX, y: roadY - 18, kind: 'stake', seed: Math.floor(rng() * 1e9) });
    v.props.push({ x: exitX, y: roadY + 18, kind: 'stake', seed: Math.floor(rng() * 1e9) });
  } else {
    // Open gates: two posts with the leaves swung back off the road, a name
    // board on the way in and a signpost on the way out.
    v.props.push({ x: gateX - 6, y: roadY - 22, kind: 'fenceR', seed: 0 });
    v.props.push({ x: gateX - 6, y: roadY + 20, kind: 'fenceR', seed: 0 });
    v.props.push({ x: gateX + 4, y: roadY - 15, kind: 'stake', seed: Math.floor(rng() * 1e9) });
    v.props.push({ x: gateX + 4, y: roadY + 15, kind: 'stake', seed: Math.floor(rng() * 1e9) });
    v.props.push({ x: exitX, y: roadY + 17, kind: 'signpost', seed: 0 });
  }
  v.props.push({ x: gateX - 2, y: roadY - 17, kind: 'nameboard', seed: 0 });

  /* ---- town dressing -------------------------------------------------- */
  v.props.push({ x: Math.round(cx + (rng() - 0.5) * 30), y: roadY + 17, kind: 'well', seed: 0 });
  v.props.push({ x: Math.round(x0 + hw * 0.5), y: roadY - 16, kind: stone ? 'lamp-stone' : 'lamp', seed: 0 });
  v.props.push({ x: Math.round(x1 - hw * 0.4), y: roadY + 16, kind: stone ? 'lamp-stone' : 'lamp', seed: 0 });

  const dressing = ['crates', 'barrels', 'cart', 'haystack', 'shed', 'lumber'];
  const nDress = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nDress; i++) {
    v.props.push({
      x: Math.round(x0 + rng() * (x1 - x0)),
      y: Math.round(rng() < 0.5 ? roadY - 50 + rng() * 12 : roadY + 40 + rng() * 14),
      kind: dressing[Math.floor(rng() * dressing.length)],
      seed: Math.floor(rng() * 1e9),
    });
  }

  /* ---- the market ----------------------------------------------------- */
  if (tier.market) {
    for (let i = 0; i < 3; i++) {
      v.stalls.push({
        x: Math.round(cx - 34 + i * 30),
        y: roadY + 20 + Math.round(rng() * 4),
        seed: Math.floor(rng() * 1e9),
      });
    }
  }

  /* ---- the wood behind the town --------------------------------------- */
  // Two species to a band, drawn from the slug, so the seven bands are seven
  // different bits of country rather than one hedge repeated.
  const SPECIES: VTree['kind'][][] = [
    ['oak', 'birch'],
    ['fir', 'pine'],
    ['oak', 'willow'],
    ['birch', 'blossom'],
    ['pine', 'fir'],
    ['oak', 'pine'],
  ];
  const wood = SPECIES[seed % SPECIES.length];
  // The band is wooded top AND bottom, which is what makes the seven folds
  // read as one country: the treeline a band ends on is the treeline the next
  // one starts from.
  const clearOf = (x: number, y: number) =>
    !(x > x0 - 30 && x < x1 + 30 && y > roadY - 74) && Math.abs(y - roadY) > 22;
  const nTrees = 30 + Math.floor(rng() * 10);
  for (let i = 0; i < nTrees; i++) {
    const x = Math.round(rng() * (w + 60) - 30);
    const top = rng() < 0.58;
    // A crown stands about 56px over its own trunk, so the treeline behind the
    // town starts at 58 and not at 0: a tree sliced off by the fold is the one
    // thing that reads as a broken image rather than as country going on.
    const y = top
      ? Math.round(58 + rng() * rng() * Math.max(8, roadY - 84))
      : Math.round(h - 3 - rng() * rng() * Math.max(8, h - roadY - 47));
    if (!clearOf(x, y)) continue;
    v.trees.push({
      x,
      y,
      kind: wood[rng() < 0.7 ? 0 : 1],
      seed: Math.floor(rng() * 1e9),
    });
  }

  /* ---- the country in between ----------------------------------------- */
  // Wild scatter, so the half of the band the town is not in is countryside
  // rather than lawn. Same bags the valley dresses its own wild ground with.
  const WILD = ['bush', 'rock', 'flowers', 'stump', 'sapling', 'bush', 'flowers'];
  const nWild = 30 + Math.floor(rng() * 12);
  for (let i = 0; i < nWild; i++) {
    const x = Math.round(rng() * w);
    const y = Math.round(6 + rng() * (h - 12));
    if (!clearOf(x, y)) continue;
    v.props.push({
      x,
      y,
      kind: WILD[Math.floor(rng() * WILD.length)],
      seed: Math.floor(rng() * 1e9),
    });
  }
  if (rng() < 0.55) {
    v.animals.push({
      x: Math.round(rng() * w),
      y: Math.round(26 + rng() * Math.max(6, roadY - 96)),
      kind: 'deer',
      faceRight: rng() < 0.5,
      grazing: rng() < 0.5,
      seed: Math.floor(rng() * 1e9),
    });
  }

  /* ---- the open side: fields, a paddock, and stock --------------------- */
  const fx = side === 'left' ? w * 0.62 : w * 0.08;
  const fieldW = w * 0.3;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      if (rng() < 0.14) continue;
      v.fields.push({
        x: Math.round(fx + (fieldW * (c + 0.5)) / 5 + r * 6 + (rng() - 0.5) * 5),
        y: Math.round(roadY - 44 + r * 12),
        kind: rng() < 0.24 ? 'crop-tall' : 'crop',
        seed: Math.floor(rng() * 1e9),
      });
    }
  }
  const nField = Math.max(3, Math.round(fieldW / 30));
  for (let i = 0; i <= nField; i++) {
    v.wall.push({
      x: Math.round(fx - 10 + i * 30),
      y: roadY - 50,
      kind: stone ? 'drystoneR' : 'fenceR',
      seed: Math.floor(rng() * 1e9),
    });
  }
  v.props.push({
    x: Math.round(fx + fieldW * (0.2 + rng() * 0.6)),
    y: Math.round(roadY + 30 + rng() * 10),
    kind: rng() < 0.5 ? 'haystack' : 'hay-cock',
    seed: Math.floor(rng() * 1e9),
  });

  const paddockX = fx + fieldW * 0.5;
  const stock: VAnimalKind[] = ['sheep', 'sheep', 'cattle', 'horse'];
  const kind = stock[seed % stock.length];
  const nStock = kind === 'sheep' ? 4 : 2;
  for (let i = 0; i < nStock; i++) {
    v.animals.push({
      x: Math.round(paddockX - 26 + rng() * 52),
      y: Math.round(roadY + 20 + rng() * 22),
      kind,
      faceRight: rng() < 0.5,
      grazing: rng() < 0.55,
      seed: Math.floor(rng() * 1e9),
    });
  }
  v.animals.push({
    x: Math.round(cx + (rng() - 0.5) * 40),
    y: roadY + 24,
    kind: 'dog',
    faceRight: rng() < 0.5,
    grazing: false,
    seed: Math.floor(rng() * 1e9),
  });

  /* ---- who is out ------------------------------------------------------ */
  const crew = Math.max(2, Math.min(5, Math.round(tier.plots * 0.7)));
  for (let i = 0; i < crew; i++) {
    const kindR = rng();
    const bx = Math.round(x0 + rng() * (x1 - x0));
    if (kindR < 0.45) {
      // Walking the street.
      const y = roadY + (rng() < 0.5 ? -4 : 6);
      v.bots.push({
        x: Math.round(x0 - 20 + rng() * 20),
        y,
        x2: Math.round(x1 + rng() * 20),
        y2: y + Math.round((rng() - 0.5) * 6),
        action: rng() < 0.35 ? 'carry' : 'walk',
        color: BOT_COLORS[Math.floor(rng() * BOT_COLORS.length)],
        period: 9 + rng() * 8,
        phase: rng(),
      });
    } else {
      // Standing at a job.
      const y = Math.round(rng() < 0.5 ? roadY - 20 - rng() * 8 : roadY + 22 + rng() * 12);
      v.bots.push({
        x: bx,
        y,
        x2: bx,
        y2: y,
        action: rng() < 0.68 ? 'work' : 'idle',
        color: BOT_COLORS[Math.floor(rng() * BOT_COLORS.length)],
        period: 6 + rng() * 4,
        phase: rng(),
      });
    }
  }

  /* ---- traffic on the long road ---------------------------------------- */
  if (rng() < 0.62) {
    v.carts.push({
      color: BOT_COLORS[Math.floor(rng() * BOT_COLORS.length)],
      cargo: CARGO_COLORS[Math.floor(rng() * CARGO_COLORS.length)],
      dir: rng() < 0.5 ? 1 : -1,
      period: 26 + rng() * 14,
      phase: rng(),
      lane: rng() < 0.5 ? -3 : 3,
    });
  }

  for (let i = 0; i < 3; i++) {
    v.birds.push({
      x: rng() * w,
      y: 8 + rng() * (roadY - 70),
      vx: (rng() < 0.5 ? -1 : 1) * (5 + rng() * 8),
      amp: 2 + rng() * 3,
      period: 1.6 + rng() * 1.4,
      phase: rng(),
    });
  }

  /* ---- the hit rectangle ----------------------------------------------- */
  const hitPad = 22;
  v.hit = {
    x: Math.round(x0 - hitPad),
    y: Math.round(roadY - 74),
    w: Math.round(x1 - x0 + hitPad * 2),
    h: Math.round(h - (roadY - 74) - 6),
  };

  return v;
}
