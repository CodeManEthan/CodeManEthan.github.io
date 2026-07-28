/**
 * Hamlet Frontier — scene compilation and simulation.
 *
 * `compileScene` turns the plain `WorldState` object into draw-ready items:
 * baked sprites, world screen coordinates, a lane graph for the villagers and
 * runtime entities. `stepScene` advances the living parts — villagers walking
 * the graph, carts shuttling lumber from the mill to the frame, the hourly
 * bell, chimney smoke, sawdust.
 *
 * The world state is never mutated. Everything mutable lives in `Scene`.
 */

import {
  makeOutline,
  mulberry32,
  wx,
  wy,
  type Sprite,
} from './pixels';
import {
  buildCart,
  buildNoticeBoard,
  buildSawmill,
  buildStructure,
  makeProp,
  type BotAction,
  type SawmillSprite,
  type StructureSprite,
} from './sprites';
import {
  roadV,
  roadW,
  type LogEntry,
  type WorldBuilding,
  type WorldState,
} from './worldstate';

/* -------------------------------- types --------------------------------- */

export interface SceneItem {
  kind: 'building' | 'prop' | 'crane' | 'sawmill' | 'notice';
  id: string;
  u: number;
  v: number;
  /** World screen coordinates, in art pixels. */
  x: number;
  y: number;
  sprite: Sprite;
  /** Present on buildings and the notice board — the interactive things. */
  hit?: HitMeta;
  outline?: Sprite;
  smoke?: [number, number] | null;
  bell?: [number, number] | null;
  hoist?: [number, number] | null;
  blade?: [number, number];
  peak?: number;
}

export interface HitMeta {
  id: string;
  title: string;
  blurb: string;
  href?: string;
  accent: string;
  state: WorldBuilding['state'];
  loc?: number;
  tech?: string[];
  status?: string;
  /** Half-width of the interactive box, in art pixels. */
  hw: number;
  /** Height of the interactive box, in art pixels. */
  hh: number;
  /** Which tour waypoint shows this thing off. */
  stop: number;
  kind: 'project' | 'workshop' | 'sawmill' | 'plot' | 'cottage' | 'notice';
}

interface LaneNode {
  u: number;
  v: number;
  edges: number[];
  /** Set on nodes that are a work position at a `growing` site or the mill. */
  work?: string;
}

export interface Bot {
  id: string;
  kind: 'villager' | 'builder' | 'sawyer';
  u: number;
  v: number;
  node: number;
  path: number[];
  action: BotAction;
  timer: number;
  phase: number;
  color: string;
  faceRight: boolean;
  homeU: number;
  jx: number;
  jy: number;
}

export interface CartRun {
  id: string;
  color: string;
  u: number;
  dir: 1 | -1;
  fromU: number;
  toU: number;
  loadedOutbound: boolean;
  wait: number;
  spriteLoaded: Sprite;
  spriteEmpty: Sprite;
  phase: number;
}

export interface Smoke {
  x: number;
  y: number;
  age: number;
  drift: number;
}

export interface Scene {
  state: WorldState;
  items: SceneItem[];
  /** Interactive things, in tour order. */
  hits: SceneItem[];
  nodes: LaneNode[];
  bots: Bot[];
  carts: CartRun[];
  smokers: { x: number; y: number }[];
  smoke: Smoke[];
  bell: {
    /** World screen position of the belfry bell. */
    x: number;
    y: number;
    /** Seconds until the next ring. */
    next: number;
    /** Seconds left in the current ring; 0 when quiet. */
    ringing: number;
    notes: { x: number; y: number; age: number; color: string }[];
    u: number;
  } | null;
  bladeAngle: number;
  clock: number;
  buildLog: LogEntry[];
}

/* ---------------------------- sprite caching ---------------------------- */

function propCache() {
  const cache = new Map<string, Sprite>();
  return (kind: string, variant: number): Sprite => {
    // Only a handful of visual variants per kind — keeps the canvas count in
    // the dozens rather than the hundreds.
    const v = variant % 8;
    const key = `${kind}:${v}`;
    let sp = cache.get(key);
    if (!sp) {
      sp = makeProp(kind as never, v);
      cache.set(key, sp);
    }
    return sp;
  };
}

/* ------------------------------- compile -------------------------------- */

export function compileScene(state: WorldState): Scene {
  const rng = mulberry32(state.seed ^ 0x1234);
  const items: SceneItem[] = [];
  const hits: SceneItem[] = [];
  const smokers: { x: number; y: number }[] = [];
  const prop = propCache();

  const stopOf = (id: string): number => {
    const i = state.tour.findIndex((w) => w.focus.includes(id));
    return i < 0 ? 0 : i;
  };

  let bell: Scene['bell'] = null;

  for (const b of state.buildings) {
    const x = wx(b.u);
    const y = wy(b.v);
    let sprite: Sprite;
    let sm: [number, number] | null = null;
    let bl: [number, number] | null = null;
    let ho: [number, number] | null = null;
    let blade: [number, number] | undefined;
    let peak = 30;

    if (b.kind === 'sawmill') {
      const s: SawmillSprite = buildSawmill(b.accent);
      sprite = s;
      blade = s.blade;
      peak = s.peak;
    } else {
      const s: StructureSprite = buildStructure(
        b.form,
        b.state,
        b.progress,
        b.condition,
        b.accent,
        b.seed
      );
      sprite = s;
      sm = s.smoke;
      bl = s.bell;
      ho = s.hoist;
      peak = s.peak;
    }

    const item: SceneItem = {
      kind: b.kind === 'sawmill' ? 'sawmill' : 'building',
      id: b.id,
      u: b.u,
      v: b.v,
      x,
      y,
      sprite,
      outline: makeOutline(sprite, '#ffffff'),
      smoke: sm,
      bell: bl,
      hoist: ho,
      blade,
      peak,
      hit: {
        id: b.id,
        title: b.title,
        blurb: b.blurb,
        href: b.href,
        accent: b.accent,
        state: b.state,
        loc: b.project?.loc,
        tech: b.project?.tech,
        status: b.project?.status,
        hw: Math.max(20, b.form.width * 0.52),
        hh: peak + 10,
        stop: stopOf(b.id),
        kind: b.kind,
      },
    };
    items.push(item);
    if (b.kind !== 'cottage') hits.push(item);
    if (sm) smokers.push({ x: x + sm[0], y: y + sm[1] });
    if (bl) {
      bell = {
        x: x + bl[0],
        y: y + bl[1],
        u: b.u,
        next: 6,
        ringing: 0,
        notes: [],
      };
    }
  }

  for (const p of state.props) {
    const sprite =
      p.kind === 'noticeboard' ? buildNoticeBoard(state.buildLog.length) : prop(p.kind, p.variant);
    const item: SceneItem = {
      kind: p.kind === 'crane' ? 'crane' : p.kind === 'noticeboard' ? 'notice' : 'prop',
      id: p.kind === 'noticeboard' ? '__notice' : `p${items.length}`,
      u: p.u,
      v: p.v,
      x: wx(p.u),
      y: wy(p.v),
      sprite,
    };
    if (p.kind === 'noticeboard') {
      item.outline = makeOutline(sprite, '#ffffff');
      item.hit = {
        id: '__notice',
        title: 'The notice board',
        blurb: 'this week’s work, pinned up as it happens',
        accent: '#f0c75e',
        state: 'active',
        hw: 18,
        hh: 46,
        stop: 0,
        kind: 'notice',
      };
      hits.push(item);
    }
    items.push(item);
  }

  items.sort((a, b) => a.y - b.y || a.x - b.x);
  hits.sort((a, b) => a.hit!.stop - b.hit!.stop || a.u - b.u);

  /* ---------------------------- lane graph ----------------------------- */
  const nodes: LaneNode[] = [];
  const addNode = (u: number, v: number, work?: string) => {
    nodes.push({ u, v, edges: [], work });
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (!nodes[a].edges.includes(b)) nodes[a].edges.push(b);
    if (!nodes[b].edges.includes(a)) nodes[b].edges.push(a);
  };

  // spine: nodes marching along the road, two abreast so villagers pass
  const spine: number[] = [];
  for (let u = -12; u <= 138; u += 3.5) {
    const v = roadV(state, u);
    const w = roadW(state, u);
    const n = addNode(u, v + (spine.length % 2 ? w * 0.5 : -w * 0.5));
    if (spine.length) link(n, spine[spine.length - 1]);
    spine.push(n);
  }
  const nearestSpine = (u: number): number => {
    let best = spine[0];
    let bd = Infinity;
    for (const id of spine) {
      const d = Math.abs(nodes[id].u - u);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };

  const workNodesFor = new Map<string, number[]>();
  for (const b of state.buildings) {
    if (b.kind === 'plot') continue;
    // Door node pulled off the footprint toward the road.
    const toward = b.v < 0 ? 1 : -1;
    const doorV = b.v + toward * (b.form.width / 32 + 1.4);
    const door = addNode(b.u - 1.2, doorV);
    const road = nearestSpine(b.u);
    const mid = addNode((b.u - 1.2 + nodes[road].u) / 2, (doorV + nodes[road].v) / 2);
    link(door, mid);
    link(mid, road);

    if (b.state === 'growing' || b.kind === 'sawmill') {
      const w: number[] = [];
      const spots: [number, number][] =
        b.kind === 'sawmill'
          ? [
              [b.u - 4, b.v + 2],
              [b.u + 3.4, b.v + 1.8],
            ]
          : [
              [b.u - 4.5, b.v + toward * 2.2],
              [b.u + 1.5, b.v + toward * 3.4],
              [b.u + 4.5, b.v + toward * 1.6],
            ];
      for (const [su, sv] of spots) {
        const n = addNode(su, sv, b.id);
        link(n, door);
        w.push(n);
      }
      for (let i = 1; i < w.length; i++) link(w[i - 1], w[i]);
      workNodesFor.set(b.id, w);
    }
  }

  /* ----------------------------- entities ------------------------------ */
  const bots: Bot[] = [];
  const carts: CartRun[] = [];

  for (const e of state.entities) {
    if (e.kind === 'cart') {
      const from = e.route!.fromU;
      carts.push({
        id: e.id,
        color: e.color,
        u: from + (e.route!.toU - from) * e.offset,
        dir: 1,
        fromU: from,
        toU: e.route!.toU,
        loadedOutbound: e.route!.loadedOutbound,
        wait: 0,
        spriteLoaded: makeProp('cartParked', 0),
        spriteEmpty: makeProp('cartParked', 0),
        phase: e.offset * 4,
      });
      continue;
    }
    const homeU = e.homeU ?? 0;
    let start: number;
    if (e.kind === 'builder' || e.kind === 'sawyer') {
      const owner = state.buildings.find(
        (b) => Math.abs(b.u - homeU) < 6 && (b.state === 'growing' || b.kind === 'sawmill')
      );
      const w = owner ? workNodesFor.get(owner.id) : undefined;
      start = w && w.length ? w[Math.floor(rng() * w.length)] : nearestSpine(homeU);
    } else {
      start = nearestSpine(homeU + (rng() - 0.5) * 6);
    }
    bots.push({
      id: e.id,
      kind: e.kind,
      u: nodes[start].u,
      v: nodes[start].v,
      node: start,
      path: [],
      action: 'idle',
      timer: rng() * 3,
      phase: e.offset,
      color: e.color,
      faceRight: rng() < 0.5,
      homeU,
      jx: (rng() - 0.5) * 0.7,
      jy: (rng() - 0.5) * 0.5,
    });
  }

  // Loaded/empty cart art is accent-tinted, so it can't go through the shared
  // prop cache; there are only three carts, so bake both states for each.
  for (const c of carts) {
    c.spriteLoaded = buildCart(true, c.color);
    c.spriteEmpty = buildCart(false, c.color);
  }

  return {
    state,
    items,
    hits,
    nodes,
    bots,
    carts,
    smokers,
    smoke: [],
    bell,
    bladeAngle: 0,
    clock: 0,
    buildLog: state.buildLog,
  };
}

/* ------------------------------ simulation ------------------------------ */

function bfs(nodes: LaneNode[], from: number, to: number): number[] {
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
const SPEED = 3.6; // u per second
const CART_SPEED = 4.2;

function pickTarget(sc: Scene, bot: Bot): number {
  const nodes = sc.nodes;
  if (bot.kind === 'builder' || bot.kind === 'sawyer') {
    const work: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].work && Math.abs(nodes[i].u - bot.homeU) < 8) work.push(i);
    }
    if (work.length && rand() < 0.82) return work[Math.floor(rand() * work.length)];
  }
  // Villagers stay in their part of the village: pick from the nodes near home.
  const near: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].work) continue;
    if (Math.abs(nodes[i].u - bot.homeU) < 22) near.push(i);
  }
  if (!near.length) return bot.node;
  return near[Math.floor(rand() * near.length)];
}

export function stepScene(sc: Scene, dt: number): void {
  sc.clock += dt;
  sc.bladeAngle += dt * 9;

  /* ---- the bell ------------------------------------------------------- */
  const bell = sc.bell;
  let bellStruck = false;
  if (bell) {
    if (bell.ringing > 0) {
      bell.ringing -= dt;
      if (bell.ringing <= 0) bell.ringing = 0;
    } else {
      bell.next -= dt;
      if (bell.next <= 0) {
        const [lo, hi] = sc.state.meta.bellEverySec;
        bell.next = lo + rand() * (hi - lo);
        bell.ringing = 4.5;
        bellStruck = true;
        const colors = ['#f0c75e', '#fdf3e2', '#f5a25d'];
        for (let i = 0; i < 2; i++) {
          bell.notes.push({
            x: bell.x + (rand() - 0.5) * 6,
            y: bell.y - 6,
            age: -i * 0.7,
            color: colors[i % colors.length],
          });
        }
      }
    }
    for (let i = bell.notes.length - 1; i >= 0; i--) {
      bell.notes[i].age += dt;
      if (bell.notes[i].age > 3.4) bell.notes.splice(i, 1);
    }
  }

  /* ---- villagers ------------------------------------------------------ */
  for (const bot of sc.bots) {
    bot.phase += dt;

    // Everyone within earshot stops and looks up when the bell goes.
    if (bellStruck && bell && Math.abs(bot.u - bell.u) < 26) {
      bot.action = 'look';
      bot.timer = 2.2 + rand() * 1.4;
      bot.path.length = 0;
      bot.faceRight = bell.u > bot.u;
      continue;
    }

    const moving = bot.action === 'walk' || bot.action === 'carry';
    if (moving) {
      const target = sc.nodes[bot.path[0]];
      if (!target) {
        bot.action = 'idle';
        bot.timer = 0.5;
        continue;
      }
      const tu = target.u + bot.jx;
      const tv = target.v + bot.jy;
      const du = tu - bot.u;
      const dv = tv - bot.v;
      const d = Math.hypot(du, dv) || 1;
      const step = SPEED * (bot.action === 'carry' ? 0.82 : 1) * dt;
      if (d <= step) {
        bot.u = tu;
        bot.v = tv;
        bot.node = bot.path.shift()!;
        if (!bot.path.length) {
          const w = sc.nodes[bot.node].work;
          if (w && (bot.kind === 'builder' || bot.kind === 'sawyer')) {
            bot.action = bot.kind === 'sawyer' ? 'saw' : 'work';
            bot.timer = 3.5 + rand() * 5;
          } else {
            bot.action = 'idle';
            bot.timer = 0.8 + rand() * 3.4;
          }
        }
      } else {
        bot.u += (du / d) * step;
        bot.v += (dv / d) * step;
        if (Math.abs(du) > 0.01) bot.faceRight = du > 0;
      }
      continue;
    }

    bot.timer -= dt;
    if (bot.timer > 0) continue;
    const to = pickTarget(sc, bot);
    const path = bfs(sc.nodes, bot.node, to);
    if (!path.length) {
      bot.timer = 1 + rand() * 2;
      continue;
    }
    bot.path = path;
    bot.action =
      (bot.kind === 'builder' || bot.kind === 'sawyer') &&
      sc.nodes[to].work &&
      rand() < 0.55
        ? 'carry'
        : 'walk';
  }

  /* ---- carts ---------------------------------------------------------- */
  for (const c of sc.carts) {
    c.phase += dt;
    if (c.wait > 0) {
      c.wait -= dt;
      continue;
    }
    c.u += CART_SPEED * c.dir * dt;
    if (c.dir > 0 && c.u >= c.toU) {
      c.u = c.toU;
      c.dir = -1;
      c.wait = 3 + rand() * 3;
    } else if (c.dir < 0 && c.u <= c.fromU) {
      c.u = c.fromU;
      c.dir = 1;
      c.wait = 3 + rand() * 3;
    }
  }

  /* ---- chimney smoke + sawdust ---------------------------------------- */
  for (let i = sc.smoke.length - 1; i >= 0; i--) {
    sc.smoke[i].age += dt;
    if (sc.smoke[i].age > 3.6) sc.smoke.splice(i, 1);
  }
}

export function puffSmoke(sc: Scene): void {
  for (const s of sc.smokers) {
    sc.smoke.push({ x: s.x, y: s.y, age: 0, drift: rand() * 6 });
  }
}

/** Cart world position, following the road centreline. */
export function cartPos(sc: Scene, c: CartRun): { x: number; y: number } {
  return { x: wx(c.u), y: wy(roadV(sc.state, c.u) + 0.2) };
}

export function cartLoaded(c: CartRun): boolean {
  return c.loadedOutbound ? c.dir > 0 : c.dir < 0;
}
