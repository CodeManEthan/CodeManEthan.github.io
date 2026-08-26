/**
 * The Road Down the Page — project → world vocabulary.
 *
 * Pure data and naming. Deliberately free of any canvas import so the Astro
 * page can pull `villageSizeLabel` into its frontmatter without dragging the
 * whole of `@codemanethan/genesis/art` through the server build.
 */

import { hashSeed, mulberry32 } from '@codemanethan/genesis/types';

export type Status = 'public' | 'private' | 'soon';

/** What the page hands the renderer, one entry per project. */
export interface VillageData {
  slug: string;
  title: string;
  loc: number;
  gem: string;
  status: Status;
  featured: boolean;
  tech: string[];
}

/* --------------------------------- size ---------------------------------- */

/**
 * Lines of code become a place on the map. The scale is fixed rather than
 * relative so a village does not change rank when a repo grows: Genesis at 57k
 * is a market town, the 2.3k notification fan-out is a hamlet, and everything
 * else falls where its own line count puts it.
 */
export function villageSizeLabel(loc: number): string {
  if (loc >= 50000) return 'market town';
  if (loc >= 25000) return 'town';
  if (loc >= 10000) return 'village';
  if (loc >= 3000) return 'small village';
  return 'hamlet';
}

/** How many buildings that size of place is worth. */
export function villageBuildingCount(loc: number): number {
  if (loc >= 50000) return 11;
  if (loc >= 25000) return 8;
  if (loc >= 10000) return 6;
  if (loc >= 3000) return 4;
  return 3;
}

/** Ground radius of the settlement, in art pixels either side of the road. */
export function villageSpread(loc: number): number {
  if (loc >= 50000) return 1.0;
  if (loc >= 25000) return 0.86;
  if (loc >= 10000) return 0.74;
  if (loc >= 3000) return 0.62;
  return 0.52;
}

/* ------------------------------- the roster ------------------------------ */

export type Role =
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
  | 'bakery'
  | 'brewhouse'
  | 'homestead'
  | 'gildhall';

/**
 * A stack maps to a trade. The rule is only ever flavour, so it is allowed to
 * be a little poetic — a database is the granary, a shell is the forge — but it
 * is a pure function of the string, so the same stack always builds the same
 * shop.
 */
const TRADES: [test: RegExp, role: Role][] = [
  [/bash|kde|plasma|wayland|x11|desktop/i, 'smithy'],
  [/sqlite|sqlalchemy|docker|postgres|database/i, 'granary'],
  [/canvas|procedural|generation|pixel/i, 'mill'],
  [/agent|discord|notification|infrastructure/i, 'chapel'],
  [/flutter|dart|local-first/i, 'bakery'],
  [/ocr|tesseract|plugin/i, 'brewhouse'],
  [/astro|architecture/i, 'gildhall'],
  [/react|typescript|javascript/i, 'store'],
  [/python|flask|stdlib/i, 'workshop'],
];

const FILLER: Role[] = ['cottage', 'house', 'homestead', 'cottage', 'shed', 'barn'];

function roleForTech(tech: string): Role {
  for (const [test, role] of TRADES) if (test.test(tech)) return role;
  return FILLER[hashSeed(tech) % FILLER.length];
}

/**
 * The building roster for one village, in the order it should be laid out.
 *
 * A beacon tower leads if the project is featured, then one building per trade
 * in the stack, then plain houses until the place is the size its line count
 * says it is.
 */
export function villageRoster(v: VillageData): Role[] {
  const out: Role[] = [];
  if (v.featured) out.push('tower');

  for (const t of v.tech) {
    const role = roleForTech(t);
    if (!out.includes(role)) out.push(role);
  }

  const want = villageBuildingCount(v.loc);
  const rnd = mulberry32(hashSeed(`${v.slug}:roster`));
  while (out.length < want) out.push(FILLER[Math.floor(rnd() * FILLER.length)]);

  return out.slice(0, want);
}

/* -------------------------------- seasons -------------------------------- */

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** The visitor's own season — the valley above is on the visitor's clock too. */
export function seasonNow(d = new Date()): Season {
  const m = d.getMonth();
  if (m <= 1 || m === 11) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}
