/**
 * The Burrow — digger-bot brains.
 *
 * A small state machine per bot, adapted to 2D from the archipelago's
 * wander / idle / work bots. Bots walk the tunnel graph between chambers,
 * stop inside rooms to work, and one crew keeps extending the deep stub:
 * a digger swinging at the face and a hauler shuttling spoil back up.
 *
 * Pure logic — the scene mutates SVG transforms from the values here, so
 * nothing in this file allocates per frame or touches React state.
 */

import {
  DIG_FACE,
  findPath,
  groundY,
  mulberry32,
  type Chamber,
  type Network,
} from './world';

export type BotRole = 'resident' | 'digger' | 'hauler';
type BotState = 'move' | 'work' | 'idle' | 'dig' | 'load';

export interface Waypoint {
  x: number;
  y: number;
  surface?: boolean;
}

export interface Bot {
  id: number;
  role: BotRole;
  color: string;
  scale: number;
  /* live pose, read by the renderer */
  x: number;
  y: number;
  face: 1 | -1;
  bob: number;
  tool: number;
  spark: boolean;
  climbing: boolean;
  carrying: boolean;
  /* internals */
  state: BotState;
  node: string;
  room: string | null;
  timer: number;
  phase: number;
  speed: number;
  queue: Waypoint[];
  rng: () => number;
  /** Restricts where this bot will wander, when it has a beat to walk. */
  beat?: string[];
}

const BOT_COLORS = [
  '#f6d27a',
  '#7fd3c3',
  '#f2a0a8',
  '#a8b6f0',
  '#f6b06a',
  '#9fdca0',
  '#e8a6d8',
  '#8fd0ea',
];

/** How full the spoil heap at the dig face is, 0..1. Grows while bots dig. */
export interface DigState {
  progress: number;
  puffs: number[];
}

export function createDigState(): DigState {
  return { progress: 0.18, puffs: [0, 0, 0, 0, 0] };
}

function nodeXY(net: Network, id: string): Waypoint {
  const n = net.nodes[id];
  return { x: n.x, y: n.y, surface: n.surface };
}

function pushPath(bot: Bot, net: Network, to: string): void {
  const ids = findPath(net, bot.node, to);
  for (let i = 1; i < ids.length; i++) bot.queue.push(nodeXY(net, ids[i]));
  bot.node = to;
  bot.room = net.nodes[to].room ?? null;
  bot.state = 'move';
}

export function createBots(net: Network, chambers: Chamber[]): Bot[] {
  const rng = mulberry32(777);
  const bots: Bot[] = [];
  const rooms = net.roomNodes;

  // Residents: one per chamber-ish, spread through the colony.
  for (let i = 0; i < 7; i++) {
    const start = rooms[i % rooms.length];
    const n = net.nodes[start];
    bots.push({
      id: i,
      role: 'resident',
      color: BOT_COLORS[i % BOT_COLORS.length],
      scale: 0.92 + rng() * 0.22,
      x: n.x,
      y: n.y,
      face: rng() < 0.5 ? 1 : -1,
      bob: 0,
      tool: 0,
      spark: false,
      climbing: false,
      carrying: false,
      state: 'idle',
      node: start,
      room: n.room ?? null,
      timer: 0.5 + rng() * 4,
      phase: rng() * Math.PI * 2,
      speed: 62 + rng() * 26,
      queue: [],
      rng: mulberry32(4001 + i * 313),
    });
  }

  // A surface walker: comes up for air, potters between house and mouth.
  bots.push({
    id: 100,
    role: 'resident',
    color: '#ffe6a8',
    scale: 1,
    x: net.nodes.trail.x,
    y: groundY(net.nodes.trail.x),
    face: -1,
    bob: 0,
    tool: 0,
    spark: false,
    climbing: false,
    carrying: false,
    state: 'idle',
    node: 'trail',
    room: null,
    timer: 1.5,
    phase: 1.1,
    speed: 54,
    queue: [],
    rng: mulberry32(9091),
    beat: ['yard', 'porch', 'trail', 'mouth', 'j0'],
  });

  // The dig crew at the bottom of the shaft.
  bots.push({
    id: 200,
    role: 'digger',
    color: '#ffbf6b',
    scale: 1.08,
    x: DIG_FACE.x,
    y: DIG_FACE.y,
    face: 1,
    bob: 0,
    tool: 0,
    spark: false,
    climbing: false,
    carrying: false,
    state: 'dig',
    node: 'dig',
    room: null,
    timer: 9,
    phase: 0,
    speed: 60,
    queue: [],
    rng: mulberry32(5150),
  });

  bots.push({
    id: 201,
    role: 'hauler',
    color: '#8fd0ea',
    scale: 1,
    x: DIG_FACE.x - 90,
    y: DIG_FACE.y,
    face: 1,
    bob: 0,
    tool: 0,
    spark: false,
    climbing: false,
    carrying: false,
    state: 'load',
    node: 'dig',
    room: null,
    timer: 2.5,
    phase: 2.4,
    speed: 58,
    queue: [],
    rng: mulberry32(6160),
  });

  void chambers;
  return bots;
}

/** Pick the next thing a resident feels like doing. */
function decide(bot: Bot, net: Network, chambers: Chamber[]): void {
  const r = bot.rng();
  if (bot.beat) {
    // A caretaker who stays up top: potter along the trail, look at the view.
    if (r < 0.4) {
      bot.state = 'idle';
      bot.timer = 2 + bot.rng() * 4;
      return;
    }
    let to = bot.beat[Math.floor(bot.rng() * bot.beat.length)];
    if (to === bot.node) to = bot.beat[(bot.beat.indexOf(to) + 1) % bot.beat.length];
    pushPath(bot, net, to);
    return;
  }
  if (bot.room && r < 0.5) {
    // Potter about this room, then get to work on something.
    const room = chambers.find((c) => c.id === bot.room);
    if (room) {
      const tx = room.wander[0] + bot.rng() * (room.wander[1] - room.wander[0]);
      bot.queue.push({ x: tx, y: room.floorY });
      bot.state = 'move';
      bot.timer = 4 + bot.rng() * 6;
      return;
    }
  }
  if (r < 0.62) {
    bot.state = 'idle';
    bot.timer = 1.6 + bot.rng() * 3.4;
    return;
  }
  // Head somewhere else in the colony — occasionally all the way outside.
  const targets = [...net.roomNodes];
  if (bot.rng() < 0.16) targets.push('yard', 'trail');
  let to = targets[Math.floor(bot.rng() * targets.length)];
  if (to === bot.node) to = targets[(targets.indexOf(to) + 1) % targets.length];
  pushPath(bot, net, to);
}

function stepMove(bot: Bot, dt: number, t: number): boolean {
  const wp = bot.queue[0];
  if (!wp) return true;
  const dx = wp.x - bot.x;
  const dy = wp.y - bot.y;
  const dist = Math.hypot(dx, dy);
  const step = bot.speed * dt;
  if (dist <= step) {
    bot.x = wp.x;
    bot.y = wp.y;
    bot.queue.shift();
    return bot.queue.length === 0;
  }
  bot.x += (dx / dist) * step;
  bot.y += (dy / dist) * step;
  if (wp.surface) bot.y = groundY(bot.x);
  const vertical = Math.abs(dy) > Math.abs(dx) * 1.6;
  bot.climbing = vertical;
  if (!vertical) {
    bot.face = dx >= 0 ? 1 : -1;
    bot.bob = Math.abs(Math.sin(t * 11 + bot.phase)) * 2.6;
    bot.tool = Math.sin(t * 11 + bot.phase) * 8;
  } else {
    bot.bob = 0;
    bot.tool = Math.sin(t * 7 + bot.phase) * 16;
  }
  return false;
}

export function stepBots(
  bots: Bot[],
  net: Network,
  chambers: Chamber[],
  dig: DigState,
  dt: number,
  t: number
): void {
  let digging = false;

  for (const bot of bots) {
    bot.spark = false;

    switch (bot.state) {
      case 'move': {
        if (stepMove(bot, dt, t)) {
          bot.climbing = false;
          bot.bob = 0;
          bot.tool = 0;
          if (bot.role === 'resident') {
            bot.state = bot.room ? 'work' : 'idle';
            bot.timer = bot.room ? 3.5 + bot.rng() * 6 : 1.5 + bot.rng() * 3;
          } else if (bot.role === 'hauler') {
            if (bot.node === 'dig') {
              bot.state = 'load';
              bot.timer = 2 + bot.rng() * 2;
            } else {
              // Dumped the spoil at the top of the stub; go back for more.
              bot.carrying = false;
              bot.state = 'idle';
              bot.timer = 1 + bot.rng();
            }
          } else {
            bot.state = 'dig';
            bot.timer = 8 + bot.rng() * 5;
          }
        }
        break;
      }

      case 'idle': {
        bot.timer -= dt;
        bot.bob = 0;
        bot.tool = Math.sin(t * 1.4 + bot.phase) * 6;
        if (bot.rng() < dt * 0.5) bot.face = bot.face === 1 ? -1 : 1;
        if (bot.timer <= 0) {
          if (bot.role === 'hauler') {
            pushPath(bot, net, 'dig');
          } else if (bot.role === 'digger') {
            bot.state = 'dig';
            bot.timer = 8 + bot.rng() * 5;
          } else {
            decide(bot, net, chambers);
          }
        }
        break;
      }

      case 'work': {
        bot.timer -= dt;
        const swing = Math.sin(t * 6.5 + bot.phase);
        bot.tool = Math.max(0, swing) * -62;
        bot.bob = Math.max(0, swing) * 1.1;
        bot.spark = swing > 0.93;
        if (bot.timer <= 0) decide(bot, net, chambers);
        break;
      }

      case 'dig': {
        bot.timer -= dt;
        const swing = Math.sin(t * 5.2 + bot.phase);
        bot.tool = -20 + Math.max(0, swing) * -78;
        bot.bob = Math.max(0, swing) * 1.6;
        bot.spark = swing > 0.9;
        bot.face = 1;
        digging = true;
        if (bot.timer <= 0) {
          // A breather, leaning on the pick, then back at it.
          bot.state = 'idle';
          bot.timer = 1.5 + bot.rng() * 2;
        }
        break;
      }

      case 'load': {
        // Hauler scoops spoil from the heap, then carts it back up the stub.
        bot.timer -= dt;
        const swing = Math.sin(t * 4 + bot.phase);
        bot.tool = Math.max(0, swing) * -40;
        bot.face = 1;
        if (bot.timer <= 0) {
          bot.carrying = true;
          dig.progress = Math.max(0.14, dig.progress - 0.28);
          bot.face = -1;
          pushPath(bot, net, 'dig0');
        }
        break;
      }
    }
  }

  if (digging) {
    dig.progress = Math.min(1, dig.progress + dt * 0.035);
    for (let i = 0; i < dig.puffs.length; i++) {
      dig.puffs[i] = (dig.puffs[i] + dt * (0.55 + i * 0.13)) % 1;
    }
  }
}

/** Freeze-frame pose used when the visitor prefers reduced motion. */
export function poseStatic(bots: Bot[]): void {
  for (const bot of bots) {
    bot.bob = 0;
    bot.spark = false;
    bot.climbing = false;
    bot.tool = bot.role === 'digger' ? -58 : bot.role === 'resident' ? -22 : 0;
  }
}
