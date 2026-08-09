/**
 * The Road Down the Page — one project, built as a village.
 *
 * Nothing here is new art. Every building, wall, boat and villager is a factory
 * already in `vale/art.ts`; this file only decides *which* and *where*, from a
 * hash of the project's slug. That is deliberate on two counts: the villages are
 * the same village every day (they are seeded by name, never by the date), and
 * the design adds no sprite that the catalog would have to grow to cover.
 *
 * The mapping, in one place:
 *
 *   lines of code   → how big the place is, and how many buildings it gets
 *   GEM_COLORS[i]   → the accent: roofs, pennants, the name board, the stakes
 *   tech            → which trades have a shop here (see meta.ts)
 *   status public   → open gates, a signpost, a picket line
 *          private  → a drystone wall and a manned gatehouse
 *          soon     → half-timbered frames, a crane and a stack of lumber
 *   featured        → a lit beacon tower with a brazier burning at its foot
 */

import {
  PAL,
  type Ctx,
  type Sprite,
  rect,
  mix,
  shade,
  mulberry32,
  buildStructure,
  buildTree,
  buildWell,
  buildMarketStall,
  buildSignpost,
  buildNameBoard,
  buildStake,
  buildFence,
  buildDrystone,
  buildLamp,
  buildCampfire,
  buildCrane,
  buildLumber,
  buildBarrels,
  buildCart,
  buildBush,
  buildRock,
  buildFlowerPatch,
  drawBot,
  type StructureSpec,
  type RoofStyle,
  type StructureRole,
} from '../vale/art';
import { hashSeed } from '../genesis/types';
import { villageBuildingCount, villageRoster, type Role, type VillageData } from './meta';
import { CARRIAGE, VERGE, roadCx, type World, type WorldRect } from './world';

/* ------------------------------ the roster ------------------------------- */

interface Plan {
  w: number;
  floors: number;
  roof: RoofStyle;
  stone?: boolean;
}

/** House style per trade. Sizes are footprints in art pixels. */
const PLANS: Record<Role, Plan> = {
  tower: { w: 20, floors: 2, roof: 'hip', stone: true },
  chapel: { w: 28, floors: 1, roof: 'gable', stone: true },
  mill: { w: 30, floors: 2, roof: 'gable' },
  granary: { w: 26, floors: 1, roof: 'hip' },
  smithy: { w: 26, floors: 1, roof: 'gable', stone: true },
  hall: { w: 38, floors: 2, roof: 'hip' },
  gildhall: { w: 36, floors: 2, roof: 'hip', stone: true },
  barn: { w: 34, floors: 1, roof: 'gable' },
  store: { w: 28, floors: 2, roof: 'gable' },
  workshop: { w: 28, floors: 1, roof: 'gable' },
  bakery: { w: 26, floors: 1, roof: 'hip' },
  brewhouse: { w: 28, floors: 2, roof: 'gable' },
  homestead: { w: 30, floors: 1, roof: 'thatch' },
  cottage: { w: 22, floors: 1, roof: 'thatch' },
  house: { w: 24, floors: 2, roof: 'gable' },
  shed: { w: 18, floors: 1, roof: 'flat' },
};

/* -------------------------------- output --------------------------------- */

interface Placed {
  sp: Sprite;
  /** Ground point, in absolute world pixels. */
  x: number;
  y: number;
}

interface Person {
  x: number;
  y: number;
  color: string;
  faceRight: boolean;
  action: 'walk' | 'idle' | 'work' | 'carry';
  phase: number;
}

export interface BuiltVillage {
  data: VillageData;
  rect: WorldRect;
  /** Which side of the road the buildings stand on. */
  side: 'left' | 'right';
  /** Where the lane leaves the carriageway. */
  spurY: number;
  items: Placed[];
  people: Person[];
}

/* ------------------------------- building -------------------------------- */

function spec(
  role: Role,
  accent: string,
  seed: number,
  progress: number,
  condition: number,
  extra: Partial<StructureSpec> = {}
): StructureSpec {
  const p = PLANS[role];
  return {
    role: role as StructureRole,
    accent,
    w: p.w,
    floors: p.floors,
    roof: p.roof,
    progress,
    condition,
    seed,
    material: p.stone ? 'stone' : 'timber',
    ...extra,
  };
}

/**
 * Lay out one village inside the patch of ground the page has measured for it.
 *
 * The rect comes from the real DOM box of the village's hit area, so the art
 * cannot drift away from the words next to it however the text reflows.
 */
export function buildVillage(
  v: VillageData,
  box: WorldRect,
  side: 'left' | 'right',
  world: World
): BuiltVillage {
  const seed = hashSeed(`roaddown:${v.slug}`);
  const rnd = mulberry32(seed);
  const items: Placed[] = [];
  const people: Person[] = [];
  const accent = v.gem;

  const roster = villageRoster(v);
  const soon = v.status === 'soon';

  /* The lane leaves the road level with the middle of the village. */
  const spurY = box.y + box.h * 0.62;
  /* The mouth of the lane: the corner of the ground nearest the carriageway. */
  const mouthX = side === 'left' ? box.x + box.w - 6 : box.x + 6;

  /* ---- the buildings ---------------------------------------------------- */

  // Three or four ranks receding up the page, which is how an isometric town
  // stacks: the back rank is drawn first and the front rank overlaps it.
  const ranks = roster.length >= 9 ? 4 : roster.length >= 6 ? 3 : 2;
  const perRank = Math.ceil(roster.length / ranks);
  const rankH = (box.h - 46) / ranks;

  roster.forEach((role, i) => {
    const r = Math.floor(i / perRank);
    const c = i % perRank;
    const p = PLANS[role];

    // Rows are offset half a cell so the ranks interlock rather than grid up.
    const usable = box.w - 30;
    const step = usable / Math.max(1, perRank);
    let x = box.x + 16 + step * (c + 0.5) + (r % 2 ? step * 0.28 : -step * 0.18);
    let y = box.y + 24 + rankH * r + rnd() * (rankH * 0.35);

    x += (rnd() - 0.5) * 9;

    // Keep the near edge of every roof clear of the carriageway.
    const limit = roadCx(world, y);
    if (side === 'left') x = Math.min(x, limit - VERGE - p.w * 0.5 - 4);
    else x = Math.max(x, limit + VERGE + p.w * 0.5 + 4);

    // A place still under scaffolding has its outer ranks unfinished.
    const progress = soon ? (r === 0 ? 1 : r === 1 ? 0.55 : 0.3) : 1;
    const condition = 0.62 + rnd() * 0.38;

    const isLead = i === 0;
    const sp = buildStructure(
      spec(role, accent, seed + i * 977, progress, condition, {
        chimney: role !== 'tower' && rnd() > 0.35,
        lit: v.featured && role === 'tower',
        banner: isLead && !soon,
        awning: role === 'store',
        cupola: role === 'hall' || role === 'gildhall',
      })
    );
    items.push({ sp, x, y });

    // The beacon burns at the tower's foot.
    if (v.featured && role === 'tower' && progress === 1) {
      items.push({ sp: buildCampfire(), x: x + 14, y: y + 7 });
    }
  });

  /* ---- what the status does to the edge of town -------------------------- */

  const inward = side === 'left' ? -1 : 1; // away from the road
  const armStep = 32;

  if (v.status === 'private') {
    // A drystone chevron closing the village off, with a gatehouse either side
    // of the lane. The wall recedes along both isometric axes from the mouth.
    for (let k = 1; k <= 3; k++) {
      const dx = inward * armStep * k;
      items.push({
        sp: buildDrystone(inward < 0 ? 'r' : 'l', seed + k * 31),
        x: mouthX + dx,
        y: spurY - 16 * k - 20,
      });
      items.push({
        sp: buildDrystone(inward < 0 ? 'l' : 'r', seed + k * 57),
        x: mouthX + dx,
        y: spurY + 16 * k + 20,
      });
    }
    for (const dy of [-22, 22]) {
      items.push({
        sp: buildStructure(spec('tower', accent, seed + (dy > 0 ? 5 : 9), 1, 0.9, { lit: dy > 0 })),
        x: mouthX + inward * 8,
        y: spurY + dy,
      });
    }
  } else if (v.status === 'public') {
    // Open gates: a picket line either side, standing well back, and the road
    // simply runs in.
    for (let k = 1; k <= 3; k++) {
      const dx = inward * armStep * k;
      items.push({
        sp: buildFence(inward < 0 ? 'r' : 'l'),
        x: mouthX + dx,
        y: spurY - 16 * k - 26,
      });
      items.push({
        sp: buildFence(inward < 0 ? 'l' : 'r'),
        x: mouthX + dx,
        y: spurY + 16 * k + 26,
      });
    }
  } else {
    // Still going up: the crane over the half-built ranks, and the timber for
    // the rest of it stacked by the lane.
    items.push({ sp: buildCrane(accent), x: box.x + box.w * 0.5, y: box.y + box.h * 0.34 });
    items.push({ sp: buildLumber(seed + 3), x: mouthX + inward * 40, y: spurY - 26 });
    items.push({ sp: buildStake(accent, seed + 11), x: mouthX + inward * 22, y: spurY + 20 });
    items.push({ sp: buildStake(accent, seed + 12), x: mouthX + inward * 62, y: spurY + 30 });
  }

  /* ---- the road furniture ----------------------------------------------- */

  // The name board stands where the lane meets the verge, painted in the
  // project's own colour. The lettering is the HTML card beside it.
  const boardX = side === 'left' ? roadCx(world, spurY) - VERGE - 12 : roadCx(world, spurY) + VERGE + 12;
  items.push({ sp: buildNameBoard(accent), x: boardX, y: spurY - 6 });

  if (v.status === 'public') {
    items.push({ sp: buildSignpost(accent), x: boardX + inward * -18, y: spurY + 22 });
  }

  items.push({ sp: buildLamp(), x: mouthX + inward * 14, y: spurY - 30 });

  /* ---- the trimmings a bigger place earns -------------------------------- */

  const size = villageBuildingCount(v.loc);
  if (size >= 6) items.push({ sp: buildWell(), x: box.x + box.w * 0.42, y: box.y + box.h * 0.78 });
  if (size >= 8) {
    items.push({
      sp: buildMarketStall(seed + 71, accent),
      x: box.x + box.w * 0.62,
      y: box.y + box.h * 0.86,
    });
    items.push({ sp: buildBarrels(seed + 91), x: box.x + box.w * 0.3, y: box.y + box.h * 0.9 });
  }
  if (size >= 11) {
    items.push({
      sp: buildMarketStall(seed + 73, accent),
      x: box.x + box.w * 0.36,
      y: box.y + box.h * 0.94,
    });
    items.push({ sp: buildCart(true), x: box.x + box.w * 0.74, y: box.y + box.h * 0.94 });
  }

  /* ---- planting ---------------------------------------------------------- */

  const trees = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < trees; i++) {
    const kind = Math.floor(rnd() * 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const x = box.x + 8 + rnd() * (box.w - 16);
    const y = box.y + 6 + rnd() * (box.h - 10);
    const limit = roadCx(world, y);
    if (side === 'left' && x > limit - VERGE - 10) continue;
    if (side === 'right' && x < limit + VERGE + 10) continue;
    items.push({ sp: buildTree(kind, seed + i * 13), x, y });
  }
  for (let i = 0; i < 4; i++) {
    const x = box.x + 6 + rnd() * (box.w - 12);
    const y = box.y + 8 + rnd() * (box.h - 12);
    const pick = rnd();
    const sp = pick < 0.4 ? buildBush(seed + i) : pick < 0.75 ? buildRock(seed + i) : buildFlowerPatch(seed + i);
    items.push({ sp, x, y });
  }

  /* ---- the people -------------------------------------------------------- */

  const folk = Math.max(2, Math.round(size / 2.4));
  const shirts = [accent, mix(accent, PAL.wall, 0.55), '#6cc4d9', '#9b8fe8', '#f0c75e'];
  for (let i = 0; i < folk; i++) {
    const onLane = i === 0;
    const y = onLane ? spurY + 2 : box.y + box.h * (0.5 + rnd() * 0.45);
    let x = onLane ? mouthX + inward * (10 + rnd() * 40) : box.x + 14 + rnd() * (box.w - 28);
    const limit = roadCx(world, y);
    if (side === 'left') x = Math.min(x, limit - VERGE - 6);
    else x = Math.max(x, limit + VERGE + 6);
    people.push({
      x,
      y,
      color: shirts[Math.floor(rnd() * shirts.length)],
      faceRight: side === 'left' ? rnd() > 0.35 : rnd() > 0.65,
      action: onLane ? 'walk' : rnd() > 0.5 ? 'work' : 'idle',
      phase: rnd() * 6.283,
    });
  }

  return { data: v, rect: box, side, spurY, items, people };
}

/* -------------------------------- painting ------------------------------- */

/**
 * The lane joining the village to the carriageway.
 *
 * Same four bands as the road itself, so the junction reads as one surface
 * rather than two roads meeting — it starts *inside* the verge and widens as it
 * leaves, the way a real turning wears in.
 */
function paintSpur(ctx: Ctx, b: BuiltVillage, world: World): void {
  const verge = mix(PAL.grassEdge, PAL.dirt, 0.55);
  const from = roadCx(world, b.spurY);
  const to = b.side === 'left' ? b.rect.x + b.rect.w * 0.34 : b.rect.x + b.rect.w * 0.66;
  const x0 = Math.min(from, to);
  const x1 = Math.max(from, to);

  for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    const t = (x - x0) / Math.max(1, x1 - x0);
    // Distance from the carriageway, 0 at the junction and 1 at the far end.
    // The lane is widest where it meets the road, exactly as a real turning
    // wears, and peters out to a footpath by the time it is inside the village.
    const away = b.side === 'left' ? 1 - t : t;
    const half = 10 - away * 7.5;
    const cy = b.spurY + Math.sin(x / 21 + b.spurY) * 2.2 - away * 6;
    rect(ctx, x, cy - half - 3, 1, (half + 3) * 2, verge);
    rect(ctx, x, cy - half - 1, 1, (half + 1) * 2, PAL.dirtEdge);
    rect(ctx, x, cy - half, 1, half * 2, PAL.dirt);
  }
}

/** Draw a built village. `items` are depth-sorted so near roofs cover far ones. */
export function paintVillage(ctx: Ctx, b: BuiltVillage, world: World): void {
  paintSpur(ctx, b, world);

  const sorted = b.items.slice().sort((p, q) => p.y - q.y);
  for (const it of sorted) {
    ctx.drawImage(it.sp.c, Math.round(it.x - it.sp.ox), Math.round(it.y - it.sp.oy));
  }
  for (const p of b.people) {
    drawBot(ctx, Math.round(p.x), Math.round(p.y), p.color, p.faceRight, p.action, p.phase);
  }
}

/** A soft ground shadow under the whole settlement, to seat it on the meadow. */
export function villageGroundTone(ctx: Ctx, b: BuiltVillage): void {
  const r = b.rect;
  ctx.save();
  ctx.globalAlpha = 0.1;
  rect(ctx, r.x + 10, r.y + r.h * 0.55, r.w - 20, r.h * 0.4, shade(PAL.biome.meadow, -0.25));
  ctx.restore();
}
