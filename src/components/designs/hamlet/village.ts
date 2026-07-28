/**
 * Pixel Hamlet — village layout, lane network and villager simulation.
 *
 * Positions live in *tile space* (gx, gy). Screen space is derived with the
 * standard 2:1 isometric transform, so a circle in tile space projects to a
 * correct isometric ellipse and roads keep a constant width.
 */

import {
  TH,
  TW,
  buildBuilding,
  buildBush,
  buildCrane,
  buildCart,
  buildCrates,
  buildCropRow,
  buildFence,
  buildFlowerPatch,
  buildLamp,
  buildHaystack,
  buildLumber,
  buildPond,
  buildRock,
  buildShed,
  buildSignpost,
  buildTree,
  buildWell,
  makeOutline,
  mulberry32,
  type BotAction,
  type BuildingSprite,
  type RoofStyle,
  type Sprite,
} from './world';

export const isoX = (gx: number, gy: number): number => (gx - gy) * (TW / 2);
export const isoY = (gx: number, gy: number): number => (gx + gy) * (TH / 2);

export interface ProjectInput {
  id: string;
  title: string;
  tech: string[];
  status: 'public' | 'private' | 'soon';
  featured: boolean;
  loc: number;
  accent: string;
}

interface Slot {
  u: number;
  v: number;
  style: RoofStyle;
  tower?: boolean;
  cupola?: boolean;
  antenna?: boolean;
  awning?: boolean;
  scaffold?: boolean;
  construction?: boolean;
}

/**
 * Hand-placed plots. Composition beats a formula here: the tall silhouettes
 * sit at the back, the small cottages frame the foreground, and the building
 * site gets the front-left corner where it reads clearly.
 */
const SLOTS: Record<string, Slot> = {
  'project-hub': { u: -6, v: -9, style: 'hip', tower: true },
  'finance-tracker': { u: 12, v: -6, style: 'flat', antenna: true },
  kdoitall: { u: -13, v: -5, style: 'gable' },
  'pdf-merger': { u: 17, v: 1, style: 'gable', scaffold: true },
  'war-card-game': { u: -17, v: 2, style: 'hip', awning: true },
  'one-record-many-bells': { u: 8, v: 8, style: 'hip', cupola: true },
  'montage-it': { u: -8, v: 8, style: 'gable', construction: true },
};

const FALLBACK: Slot[] = [
  { u: 5, v: -13, style: 'hip' },
  { u: -23, v: -4, style: 'gable' },
  { u: 23, v: 7, style: 'hip' },
];

export interface BuildingItem {
  kind: 'building';
  id: string;
  title: string;
  tech: string[];
  status: string;
  loc: number;
  accent: string;
  gx: number;
  gy: number;
  sx: number;
  sy: number;
  sprite: BuildingSprite;
  outline: Sprite;
  construction: boolean;
  floors: number;
  /** Footprint width, in tiles — used for clearance when scattering scenery. */
  footprint: number;
  href: string;
}

export interface PropItem {
  kind: 'prop' | 'crane';
  gx: number;
  gy: number;
  sx: number;
  sy: number;
  sprite: Sprite;
  accent?: string;
}

export type Item = BuildingItem | PropItem;

export interface Node {
  gx: number;
  gy: number;
  work?: boolean;
  edges: number[];
}

export interface Bot {
  gx: number;
  gy: number;
  node: number;
  path: number[];
  action: BotAction;
  timer: number;
  phase: number;
  color: string;
  faceRight: boolean;
  role: 'builder' | 'villager';
  ox: number;
  oy: number;
}

export interface Village {
  items: Item[];
  buildings: BuildingItem[];
  workshop: BuildingItem;
  nodes: Node[];
  bots: Bot[];
  /** Dirt-lane centrelines, in tile space. */
  lanes: [number, number, number, number][];
  /** Chimney mouths, in world screen coords, that emit smoke. */
  smokers: { x: number; y: number }[];
  /** Bounding box of all art, in world screen coords, anchored at (0,0). */
  bounds: { l: number; r: number; t: number; b: number };
}

/** Cube-root compression: 40× the code becomes ~2× the footprint. */
function sizeOf(loc: number, minC: number, maxC: number): { W: number; floors: number; t: number } {
  const c = Math.cbrt(loc);
  const t = Math.max(0, Math.min(1, (c - minC) / (maxC - minC || 1)));
  const W = Math.round((32 * (1 + t * 1.2)) / 4) * 4;
  const floors = 1 + Math.round(t * 3);
  return { W, floors, t };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function layoutVillage(projects: ProjectInput[]): Village {
  const rng = mulberry32(20260728);
  const items: Item[] = [];
  const buildings: BuildingItem[] = [];
  const nodes: Node[] = [];
  const lanes: [number, number, number, number][] = [];
  const smokers: { x: number; y: number }[] = [];

  const link = (a: number, b: number) => {
    if (!nodes[a].edges.includes(b)) nodes[a].edges.push(b);
    if (!nodes[b].edges.includes(a)) nodes[b].edges.push(a);
  };
  const addNode = (gx: number, gy: number, work = false): number => {
    nodes.push({ gx, gy, work, edges: [] });
    return nodes.length - 1;
  };

  /* ---- plaza ring ------------------------------------------------- */
  const RING = 2.9;
  const ringIds: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ringIds.push(addNode(Math.cos(a) * RING, Math.sin(a) * RING));
  }
  for (let i = 0; i < 12; i++) {
    link(ringIds[i], ringIds[(i + 1) % 12]);
    const n = nodes[ringIds[i]];
    const m = nodes[ringIds[(i + 1) % 12]];
    lanes.push([n.gx, n.gy, m.gx, m.gy]);
  }
  const nearestRing = (gx: number, gy: number): number => {
    let best = ringIds[0];
    let bd = Infinity;
    for (const id of ringIds) {
      const d = dist(gx, gy, nodes[id].gx, nodes[id].gy);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };

  /* ---- Ethan's workshop, dead centre ------------------------------ */
  const shopSprite = buildBuilding({
    accent: '#63c9a8',
    W: 56,
    floors: 2,
    style: 'gable',
    chimney: true,
    awning: true,
    lit: true,
    seed: 7,
  });
  const workshop: BuildingItem = {
    kind: 'building',
    id: '__ethan',
    title: "Ethan's Workshop",
    tech: ['Astro', 'TypeScript', 'Canvas'],
    status: 'home',
    loc: 0,
    accent: '#63c9a8',
    gx: 0,
    gy: 0,
    sx: 0,
    sy: 0,
    sprite: shopSprite,
    outline: makeOutline(shopSprite, '#ffffff'),
    construction: false,
    floors: 2,
    footprint: 56 / TW,
    href: '#about',
  };
  items.push(workshop);
  if (shopSprite.smoke) smokers.push({ x: shopSprite.smoke[0], y: shopSprite.smoke[1] });

  const shopDoor = addNode(0.9, 0.9);
  link(shopDoor, nearestRing(0.9, 0.9));
  lanes.push([0.9, 0.9, nodes[nearestRing(0.9, 0.9)].gx, nodes[nearestRing(0.9, 0.9)].gy]);

  /* ---- project buildings ------------------------------------------ */
  const cs = projects.map((p) => Math.cbrt(p.loc));
  const minC = Math.min(...cs);
  const maxC = Math.max(...cs);

  let fb = 0;
  let siteDoor = -1;
  let siteGx = 0;
  let siteGy = 0;
  const workNodes: number[] = [];

  projects.forEach((p, i) => {
    const slot = SLOTS[p.id] ?? FALLBACK[fb++ % FALLBACK.length];
    const gx = (slot.u + slot.v) / 2;
    const gy = (slot.v - slot.u) / 2;
    const { W, floors } = sizeOf(p.loc, minC, maxC);
    const sprite = buildBuilding({
      accent: p.accent,
      W,
      floors,
      style: slot.style,
      chimney: !slot.construction && (slot.style !== 'flat') && i % 2 === 0,
      tower: slot.tower,
      cupola: slot.cupola,
      antenna: slot.antenna,
      awning: slot.awning,
      scaffold: slot.scaffold,
      construction: slot.construction,
      seed: 100 + i * 37,
    });
    const item: BuildingItem = {
      kind: 'building',
      id: p.id,
      title: p.title,
      tech: p.tech,
      status: p.status,
      loc: p.loc,
      accent: p.accent,
      gx,
      gy,
      sx: isoX(gx, gy),
      sy: isoY(gx, gy),
      sprite,
      outline: makeOutline(sprite, '#ffffff'),
      construction: !!slot.construction,
      floors,
      footprint: W / TW,
      href: `/projects/${p.id}/`,
    };
    items.push(item);
    buildings.push(item);
    if (sprite.smoke) {
      smokers.push({ x: item.sx + sprite.smoke[0], y: item.sy + sprite.smoke[1] });
    }

    // Door node: pulled off the footprint toward the plaza.
    const d = Math.hypot(gx, gy) || 1;
    const back = W / TW / 2 + 1.1;
    const dx = gx - (gx / d) * back;
    const dy = gy - (gy / d) * back;
    const door = addNode(dx, dy);
    const midG = { gx: dx * 0.55, gy: dy * 0.55 };
    const ring = nearestRing(dx, dy);
    const mid = addNode(
      (dx + nodes[ring].gx) / 2 + (midG.gx - dx) * 0.02,
      (dy + nodes[ring].gy) / 2
    );
    link(door, mid);
    link(mid, ring);
    lanes.push([dx, dy, nodes[mid].gx, nodes[mid].gy]);
    lanes.push([nodes[mid].gx, nodes[mid].gy, nodes[ring].gx, nodes[ring].gy]);

    if (slot.construction) {
      siteDoor = door;
      siteGx = gx;
      siteGy = gy;
      const w1 = addNode(gx - 1.5, gy + 0.5, true);
      const w2 = addNode(gx + 0.4, gy + 1.6, true);
      const w3 = addNode(gx + 1.8, gy - 0.4, true);
      link(door, w1);
      link(door, w2);
      link(w2, w3);
      workNodes.push(w1, w2, w3);
    }
  });

  /* ---- building site dressing ------------------------------------- */
  if (siteDoor >= 0) {
    const crane = buildCrane('#f0c75e');
    items.push({
      kind: 'crane',
      gx: siteGx + 2.6,
      gy: siteGy - 1.2,
      sx: isoX(siteGx + 2.6, siteGy - 1.2),
      sy: isoY(siteGx + 2.6, siteGy - 1.2),
      sprite: crane,
      accent: '#f0c75e',
    });
    const dressing: [number, number, Sprite][] = [
      [siteGx - 2.4, siteGy + 0.5, buildLumber(3)],
      [siteGx - 1.4, siteGy + 2.1, buildCrates(11)],
      [siteGx + 1.4, siteGy + 2.2, buildLumber(9)],
      [siteGx + 3.0, siteGy + 1.0, buildSignpost('#f0c75e')],
      [siteGx - 3.4, siteGy + 2.2, buildCart()],
      [siteGx + 0.2, siteGy + 3.0, buildCrates(23)],
      [siteGx - 3.2, siteGy - 1.4, buildShed(77)],
    ];
    for (const [gx, gy, sprite] of dressing) {
      items.push({ kind: 'prop', gx, gy, sx: isoX(gx, gy), sy: isoY(gx, gy), sprite });
    }
  }

  /* ---- plaza furniture -------------------------------------------- */
  const well = buildWell();
  items.push({ kind: 'prop', gx: -2.4, gy: 1.9, sx: isoX(-2.4, 1.9), sy: isoY(-2.4, 1.9), sprite: well });
  for (const [gx, gy] of [
    [2.6, -1.3],
    [-1.4, -2.6],
    [2.2, 2.4],
  ] as [number, number][]) {
    items.push({ kind: 'prop', gx, gy, sx: isoX(gx, gy), sy: isoY(gx, gy), sprite: buildLamp() });
  }
  items.push({
    kind: 'prop',
    gx: 2.3,
    gy: 2.7,
    sx: isoX(2.3, 2.7),
    sy: isoY(2.3, 2.7),
    sprite: buildSignpost('#9b8fe8'),
  });

  /* ---- smallholdings, pond, haystacks ------------------------------ */
  const occupied: [number, number, number][] = [[0, 0, 2.6]];
  for (const b of buildings) {
    occupied.push([b.gx, b.gy, b.footprint / 2 + 1.0]);
  }
  const laneDist = (gx: number, gy: number): number => {
    let best = Infinity;
    for (const [ax, ay, bx, by] of lanes) {
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      let t = ((gx - ax) * vx + (gy - ay) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, dist(gx, gy, ax + vx * t, ay + vy * t));
    }
    return best;
  };

  const free = (gx: number, gy: number, pad: number): boolean => {
    if (laneDist(gx, gy) < pad + 0.5) return false;
    for (const [ox, oy, r] of occupied) {
      if (dist(gx, gy, ox, oy) < r + pad) return false;
    }
    return true;
  };

  // Worked land between the buildings: this is a hamlet, not a park.
  const addProp = (gx: number, gy: number, sprite: Sprite, pad: number): boolean => {
    if (!free(gx, gy, pad)) return false;
    occupied.push([gx, gy, pad]);
    items.push({ kind: 'prop', gx, gy, sx: isoX(gx, gy), sy: isoY(gx, gy), sprite });
    return true;
  };
  const uv = (u: number, v: number): [number, number] => [(u + v) / 2, (v - u) / 2];

  // Pond: try a handful of spots and take the first that clears the lanes.
  for (const [u, v] of [
    [6, -6],
    [-6, -6],
    [10, 4],
    [-11, 5],
  ] as [number, number][]) {
    const [px, py] = uv(u, v);
    if (addProp(px, py, buildPond(5), 2.6)) break;
  }

  const fields: [number, number][] = [
    [7, -3],
    [-13, 5],
    [14, 6],
    [-6, -8],
    [16, -2],
    [-16, -2],
    [3, 10],
    [-3, 11],
    [20, 2],
    [-21, -5],
  ];
  fields.forEach(([u, v], i) => {
    const [px, py] = uv(u, v);
    if (addProp(px, py, buildCropRow(i * 5 + 1), 1.5) && i % 2 === 0) {
      const [hx, hy] = uv(u + 3, v + 1);
      addProp(hx, hy, buildHaystack(i * 9 + 2), 0.9);
    }
  });

  // Orchards: regular rows of fruit trees read as tended land, and they fill
  // the wedges of meadow the radial lanes leave behind.
  const orchards: [number, number][] = [
    [9, -8],
    [-10, -9],
    [22, -3],
    [-24, 2],
    [12, 11],
    [-13, 12],
  ];
  orchards.forEach(([u, v], oi) => {
    const [ox0, oy0] = uv(u, v);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        addProp(
          ox0 + a * 1.7,
          oy0 + b * 1.7,
          buildTree(oi % 2 === 0 ? 2 : 0, oi * 31 + a * 7 + b * 3 + 11),
          1.0
        );
      }
    }
  });

  const sheds: [number, number][] = [
    [8, -1],
    [-8, -2],
    [5, 5],
    [-5, 5],
    [18, -5],
    [-19, -4],
    [13, 8],
    [-14, 8],
    [1, -13],
    [24, 4],
  ];
  sheds.forEach(([u, v], i) => {
    const [px, py] = uv(u, v);
    if (addProp(px, py, buildShed(i * 13 + 5), 1.0) && i % 3 === 0) {
      const [hx, hy] = uv(u + 2, v + 2);
      addProp(hx, hy, buildCart(), 0.7);
    }
  });

  let placed = 0;
  for (let attempt = 0; attempt < 7000 && placed < 340; attempt++) {
    // Sample in screen-aligned (u, v) so density follows what's actually in
    // frame rather than spilling into the culled distance.
    const u = (rng() - 0.5) * 66;
    const v = -30 + rng() * 46;
    const gx = (u + v) / 2;
    const gy = (v - u) / 2;
    if (Math.hypot(gx, gy) < 3.2) continue;
    const roll = rng();
    let sprite: Sprite;
    let pad: number;
    if (roll < 0.3) {
      sprite = buildTree(0, attempt * 13 + 1);
      pad = 1.15;
    } else if (roll < 0.44) {
      sprite = buildTree(1, attempt * 13 + 5);
      pad = 1.15;
    } else if (roll < 0.49) {
      sprite = buildTree(2, attempt * 13 + 9);
      pad = 1.15;
    } else if (roll < 0.74) {
      sprite = buildBush(attempt * 7 + 3);
      pad = 0.6;
    } else if (roll < 0.83) {
      sprite = buildRock(attempt * 5 + 2);
      pad = 0.55;
    } else {
      sprite = buildFlowerPatch(attempt * 3 + 4);
      pad = 0.45;
    }
    if (addProp(gx, gy, sprite, pad)) placed++;
  }

  // Gap-fill pass: undergrowth with a small footprint, allowed nearer the
  // lanes, so the wedges of meadow between spokes never read as bare canvas.
  for (let attempt = 0; attempt < 4000 && placed < 470; attempt++) {
    const u = (rng() - 0.5) * 68;
    const v = -30 + rng() * 46;
    const gx = (u + v) / 2;
    const gy = (v - u) / 2;
    if (Math.hypot(gx, gy) < 3.4) continue;
    const roll = rng();
    const sprite =
      roll < 0.42
        ? buildBush(attempt * 11 + 17)
        : roll < 0.62
          ? buildRock(attempt * 3 + 8)
          : buildFlowerPatch(attempt * 7 + 5);
    if (addProp(gx, gy, sprite, roll < 0.42 ? 0.42 : 0.3)) placed++;
  }

  // A couple of fence runs to suggest smallholdings.
  for (const [gx, gy, dir] of [
    [-5.6, 6.4, 'l'],
    [-4.6, 7.4, 'l'],
    [6.4, -5.4, 'r'],
    [7.4, -4.4, 'r'],
    [-8.5, -7.5, 'r'],
    [9.5, 8.5, 'l'],
  ] as [number, number, 'l' | 'r'][]) {
    if (!free(gx, gy, 0.5)) continue;
    items.push({ kind: 'prop', gx, gy, sx: isoX(gx, gy), sy: isoY(gx, gy), sprite: buildFence(dir) });
  }

  /* ---- villagers --------------------------------------------------- */
  const BOT_COLORS = ['#ef7f93', '#63c9a8', '#9b8fe8', '#f0c75e', '#6cc4d9', '#e98fc3', '#f5a25d'];
  const bots: Bot[] = [];
  const startNodes = [shopDoor, ...ringIds];
  for (let i = 0; i < 14; i++) {
    const role: Bot['role'] = i < 3 && siteDoor >= 0 ? 'builder' : 'villager';
    const n = role === 'builder' ? workNodes[i % Math.max(1, workNodes.length)] : startNodes[(i * 3) % startNodes.length];
    bots.push({
      gx: nodes[n].gx,
      gy: nodes[n].gy,
      node: n,
      path: [],
      action: 'idle',
      timer: rng() * 2,
      phase: rng() * 10,
      color: BOT_COLORS[i % BOT_COLORS.length],
      faceRight: rng() < 0.5,
      role,
      ox: (rng() - 0.5) * 0.5,
      oy: (rng() - 0.5) * 0.5,
    });
  }

  /* ---- bounds ------------------------------------------------------
     Only the buildings and the crane frame the shot; the scattered flora is
     meant to bleed off every edge, so including it would zoom the camera out
     onto a sea of grass. */
  let l = Infinity;
  let r = -Infinity;
  let t = Infinity;
  let b = -Infinity;
  for (const it of items) {
    if (it.kind === 'prop') continue;
    l = Math.min(l, it.sx - it.sprite.ox);
    r = Math.max(r, it.sx - it.sprite.ox + it.sprite.c.width);
    t = Math.min(t, it.sy - it.sprite.oy);
    b = Math.max(b, it.sy - it.sprite.oy + it.sprite.c.height);
  }

  return {
    items,
    buildings,
    workshop,
    nodes,
    bots,
    lanes,
    smokers,
    bounds: { l, r, t, b },
  };
}

/* --------------------------- villager brains --------------------------- */

function bfs(nodes: Node[], from: number, to: number): number[] {
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

const rand = mulberry32(99);

function pickTarget(v: Village, bot: Bot): number {
  const nodes = v.nodes;
  if (bot.role === 'builder') {
    const work = nodes.map((n, i) => (n.work ? i : -1)).filter((i) => i >= 0);
    if (work.length && rand() < 0.7) return work[Math.floor(rand() * work.length)];
  }
  let n = Math.floor(rand() * nodes.length);
  let guard = 0;
  while (nodes[n].work && guard++ < 8) n = Math.floor(rand() * nodes.length);
  return n;
}

const SPEED = 1.35; // tiles per second

export function stepBots(v: Village, dt: number): void {
  for (const bot of v.bots) {
    bot.phase += dt;
    const moving = bot.action === 'walk' || bot.action === 'carry';

    if (moving) {
      const target = v.nodes[bot.path[0]];
      if (!target) {
        bot.action = 'idle';
        bot.timer = 0.5;
        continue;
      }
      const tx = target.gx + bot.ox;
      const ty = target.gy + bot.oy;
      const dx = tx - bot.gx;
      const dy = ty - bot.gy;
      const d = Math.hypot(dx, dy) || 1;
      const step = SPEED * (bot.action === 'carry' ? 0.82 : 1) * dt;
      if (d <= step) {
        bot.gx = tx;
        bot.gy = ty;
        bot.node = bot.path.shift()!;
        if (!bot.path.length) {
          if (v.nodes[bot.node].work && bot.role === 'builder') {
            bot.action = 'work';
            bot.timer = 3.5 + rand() * 5;
          } else {
            bot.action = 'idle';
            bot.timer = 0.8 + rand() * 3.2;
          }
        }
      } else {
        bot.gx += (dx / d) * step;
        bot.gy += (dy / d) * step;
        // Screen-space facing: screen x = (gx - gy) * 16.
        const sdx = dx - dy;
        if (Math.abs(sdx) > 0.01) bot.faceRight = sdx > 0;
      }
      continue;
    }

    bot.timer -= dt;
    if (bot.timer > 0) continue;
    const to = pickTarget(v, bot);
    const path = bfs(v.nodes, bot.node, to);
    if (!path.length) {
      bot.timer = 1 + rand() * 2;
      continue;
    }
    bot.path = path;
    bot.action =
      bot.role === 'builder' && v.nodes[to].work && rand() < 0.6 ? 'carry' : 'walk';
  }
}
