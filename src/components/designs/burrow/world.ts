/**
 * The Burrow — world layout.
 *
 * A side-view cutaway of an underground colony. Everything is expressed in one
 * SVG user-space coordinate system (VIEW), so the whole scene scales with the
 * page width and vertical page scroll travels deeper into the colony.
 *
 * Nothing here touches the DOM or React: it is pure geometry, generated once
 * from a seeded RNG so the world is identical on every load.
 */

export const VIEW = { w: 1440, h: 2520 };

/** Nominal surface height; the real ground line wobbles around it. */
export const SURFACE_Y = 424;

/** Height of the ground at a given x — house, tree, bots and path all use it. */
export function groundY(x: number): number {
  return (
    SURFACE_Y + 11 * Math.sin(x * 0.0042 + 0.6) - 7 * Math.cos(x * 0.0026 + 1.9)
  );
}

/* ------------------------------- utilities ------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');
}

/** Mix two #rrggbb colors. t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => hex(v + (pb[i] - v) * t)).join('')}`;
}

/** Smooth open spline through points, as an SVG path (Catmull-Rom → cubic). */
function spline(pts: Array<[number, number]>): string {
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/* -------------------------------- chambers ------------------------------- */

export interface ProjectInput {
  id: string;
  title: string;
  summary: string;
  tech: string[];
  loc: number;
  locLabel: string;
  size: string;
  color: string;
}

export interface Chamber extends ProjectInput {
  /** Slot index, 0 = shallowest. */
  depth: number;
  cx: number;
  /** Floor level — bots walk on this line, tunnels meet the chamber here. */
  floorY: number;
  rx: number;
  domeH: number;
  path: string;
  /** Where a bot may wander inside the room. */
  wander: [number, number];
  labelSide: 1 | -1;
}

/**
 * Hand-placed slots. Depth order is lines-of-code descending: the biggest
 * codebases are the big halls near the surface, the smallest are the deep
 * newer digs at the bottom of the shaft.
 */
const SLOTS: Array<{ cx: number; floorY: number; labelSide: 1 | -1 }> = [
  { cx: 340, floorY: 776, labelSide: 1 },
  { cx: 1090, floorY: 943, labelSide: -1 },
  { cx: 330, floorY: 1280, labelSide: 1 },
  { cx: 1090, floorY: 1337, labelSide: -1 },
  { cx: 620, floorY: 1787, labelSide: 1 },
  { cx: 1010, floorY: 1987, labelSide: -1 },
  { cx: 380, floorY: 2147, labelSide: 1 },
];

/** Chamber half-width from lines of code — cube-root compressed. */
function radiusFor(loc: number): number {
  return 26 + 3.5 * Math.cbrt(loc);
}

/** Dome ceiling + slightly uneven floor. */
function chamberPath(
  cx: number,
  floorY: number,
  rx: number,
  domeH: number,
  rng: () => number
): string {
  const pts: Array<[number, number]> = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const a = Math.PI * (1 - i / (N - 1));
    const j = 0.9 + rng() * 0.2;
    pts.push([cx + rx * Math.cos(a) * j, floorY - domeH * Math.sin(a) * j]);
  }
  pts[0] = [cx - rx, floorY];
  pts[N - 1] = [cx + rx, floorY];
  let d = spline(pts);
  // Floor back to the start, with a couple of small bumps.
  for (let i = 2; i >= 1; i--) {
    const x = cx - rx + ((2 * rx) / 3) * i;
    d += ` L ${x.toFixed(1)} ${(floorY + (rng() - 0.5) * 5).toFixed(1)}`;
  }
  return `${d} Z`;
}

export function buildChambers(projects: ProjectInput[]): Chamber[] {
  const byLoc = [...projects].sort((a, b) => b.loc - a.loc);
  return byLoc.map((p, i) => {
    const slot = SLOTS[i] ?? SLOTS[SLOTS.length - 1];
    const rng = mulberry32(1000 + i * 137);
    const rx = radiusFor(p.loc);
    const domeH = rx * 0.86;
    return {
      ...p,
      depth: i,
      cx: slot.cx,
      floorY: slot.floorY,
      rx,
      domeH,
      path: chamberPath(slot.cx, slot.floorY, rx, domeH, rng),
      wander: [slot.cx - rx * 0.55, slot.cx + rx * 0.55],
      labelSide: slot.labelSide,
    };
  });
}

/* --------------------------- the tunnel network -------------------------- */

export interface WNode {
  id: string;
  x: number;
  y: number;
  /** Chamber id when this node is a room floor. */
  room?: string;
  /** Surface nodes follow the ground line rather than a straight edge. */
  surface?: boolean;
}

export interface WEdge {
  a: string;
  b: string;
  kind: 'shaft' | 'drift' | 'surface' | 'dig';
}

export interface Network {
  nodes: Record<string, WNode>;
  edges: WEdge[];
  adj: Record<string, string[]>;
  roomNodes: string[];
}

export const DIG_FACE = { x: 880, y: 2340 };

export function buildNetwork(chambers: Chamber[]): Network {
  const at = (i: number) => chambers.find((c) => c.depth === i)!;

  const c0 = at(0);
  const c1 = at(1);
  const c2 = at(2);
  const c3 = at(3);
  const c4 = at(4);
  const c5 = at(5);
  const c6 = at(6);

  const nodes: WNode[] = [
    { id: 'yard', x: 1005, y: groundY(1005), surface: true },
    { id: 'porch', x: 855, y: groundY(855), surface: true },
    { id: 'trail', x: 700, y: groundY(700), surface: true },
    { id: 'mouth', x: 620, y: 470 },

    { id: 'j0', x: 620, y: c0.floorY },
    { id: 'r0', x: c0.cx, y: c0.floorY, room: c0.id },

    { id: 'j1', x: 620, y: c1.floorY },
    { id: 'r1', x: c1.cx - 60, y: c1.floorY, room: c1.id },

    { id: 'j2', x: 620, y: c2.floorY },
    { id: 'r2', x: c2.cx, y: c2.floorY, room: c2.id },

    { id: 'r3', x: c3.cx - 60, y: c3.floorY, room: c3.id },
    { id: 'r3e', x: c3.cx + 70, y: c3.floorY },

    { id: 'j3', x: 620, y: 1560 },
    { id: 'b3', x: c3.cx + 70, y: 1560 },

    { id: 'r4', x: c4.cx, y: c4.floorY, room: c4.id },

    { id: 'j4', x: 620, y: c5.floorY },
    { id: 'r5', x: c5.cx, y: c5.floorY, room: c5.id },

    { id: 'j5', x: 620, y: c6.floorY },
    { id: 'r6', x: c6.cx, y: c6.floorY, room: c6.id },

    { id: 'dig0', x: 620, y: DIG_FACE.y },
    { id: 'dig', x: DIG_FACE.x - 62, y: DIG_FACE.y },
  ];

  const edges: WEdge[] = [
    { a: 'yard', b: 'porch', kind: 'surface' },
    { a: 'porch', b: 'trail', kind: 'surface' },
    { a: 'trail', b: 'mouth', kind: 'surface' },
    { a: 'mouth', b: 'j0', kind: 'shaft' },
    { a: 'j0', b: 'r0', kind: 'drift' },
    { a: 'j0', b: 'j1', kind: 'shaft' },
    { a: 'j1', b: 'r1', kind: 'drift' },
    { a: 'r1', b: 'r3', kind: 'shaft' },
    { a: 'j1', b: 'j2', kind: 'shaft' },
    { a: 'j2', b: 'r2', kind: 'drift' },
    { a: 'r3', b: 'r3e', kind: 'drift' },
    { a: 'r3e', b: 'b3', kind: 'shaft' },
    { a: 'b3', b: 'j3', kind: 'drift' },
    { a: 'j2', b: 'j3', kind: 'shaft' },
    { a: 'j3', b: 'r4', kind: 'shaft' },
    { a: 'r4', b: 'j4', kind: 'shaft' },
    { a: 'j4', b: 'r5', kind: 'drift' },
    { a: 'j4', b: 'j5', kind: 'shaft' },
    { a: 'j5', b: 'r6', kind: 'drift' },
    { a: 'j5', b: 'dig0', kind: 'shaft' },
    { a: 'dig0', b: 'dig', kind: 'dig' },
  ];

  // r4 sits directly on the main shaft, so j3→r4→j4 is one continuous drop.
  const map: Record<string, WNode> = {};
  for (const n of nodes) map[n.id] = n;

  const adj: Record<string, string[]> = {};
  for (const n of nodes) adj[n.id] = [];
  for (const e of edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }

  return {
    nodes: map,
    edges,
    adj,
    roomNodes: nodes.filter((n) => n.room).map((n) => n.id),
  };
}

/** Breadth-first path between two nodes, inclusive of both ends. */
export function findPath(net: Network, from: string, to: string): string[] {
  if (from === to) return [to];
  const prev: Record<string, string | null> = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nx of net.adj[cur]) {
      if (nx in prev) continue;
      prev[nx] = cur;
      if (nx === to) {
        const out: string[] = [];
        let p: string | null = nx;
        while (p) {
          out.unshift(p);
          p = prev[p];
        }
        return out;
      }
      queue.push(nx);
    }
  }
  return [to];
}

/* ------------------------------ dirt & strata ---------------------------- */

export interface Stratum {
  d: string;
  fill: string;
}

export interface Speck {
  x: number;
  y: number;
  r: number;
  rot: number;
  fill: string;
}

const DIRT_TOP = '#c99361';
const DIRT_DEEP = '#4a2b18';

export function buildStrata(): { bands: Stratum[]; specks: Speck[] } {
  const rng = mulberry32(90210);
  const bands: Stratum[] = [];
  const top = SURFACE_Y + 46;
  const rows = 11;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const y = top + t * (VIEW.h - top - 20);
    const amp = 8 + rng() * 16;
    const freq = 0.0016 + rng() * 0.0022;
    const ph = rng() * 6.28;
    const pts: Array<[number, number]> = [];
    for (let x = -40; x <= VIEW.w + 160; x += 120) {
      pts.push([x, y + Math.sin(x * freq + ph) * amp + (rng() - 0.5) * 7]);
    }
    const d = `${spline(pts)} L ${VIEW.w + 40} ${VIEW.h + 40} L -40 ${VIEW.h + 40} Z`;
    const base = mix(DIRT_TOP, DIRT_DEEP, Math.pow(t, 0.85));
    bands.push({ d, fill: base });
  }

  const specks: Speck[] = [];
  for (let i = 0; i < 260; i++) {
    const y = top + rng() * (VIEW.h - top - 30);
    const t = (y - top) / (VIEW.h - top);
    const shade = rng() < 0.5 ? -1 : 1;
    specks.push({
      x: rng() * VIEW.w,
      y,
      r: 2 + rng() * 7,
      rot: rng() * 180,
      fill: mix(
        mix(DIRT_TOP, DIRT_DEEP, Math.pow(t, 0.85)),
        shade > 0 ? '#ffd9a8' : '#2a1509',
        0.22 + rng() * 0.18
      ),
    });
  }
  return { bands, specks };
}

/* -------------------------------- surface -------------------------------- */

function groundPoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let x = -40; x <= VIEW.w + 40; x += 80) pts.push([x, groundY(x)]);
  return pts;
}

/** The green strip of turf sitting on top of the soil. */
export function groundPath(): string {
  return `${spline(groundPoints())} L ${VIEW.w + 40} ${SURFACE_Y + 34} L -40 ${SURFACE_Y + 34} Z`;
}

/** Everything below the turf: the body of earth the colony is dug into. */
export function earthPath(): string {
  return `${spline(groundPoints())} L ${VIEW.w + 40} ${VIEW.h} L -40 ${VIEW.h} Z`;
}

/** The winding trail from the house down to the burrow mouth. */
export function trailPath(): string {
  const pts: Array<[number, number]> = [];
  for (let x = 1010; x >= 626; x -= 48) pts.push([x, groundY(x) + 5]);
  return spline(pts);
}

/**
 * A small store room off the main shaft. Not a project — colony infrastructure,
 * there to break up the long descent and show the burrow is lived in.
 */
export const NOOK = { cx: 468, floorY: 1884, rx: 64, domeH: 55 };

export function nookPath(): string {
  return chamberPath(
    NOOK.cx,
    NOOK.floorY,
    NOOK.rx,
    NOOK.domeH,
    mulberry32(5309)
  );
}

/* --------------------------- things in the dirt -------------------------- */

export interface Prop {
  kind: 'root' | 'boulder' | 'glow' | 'vein';
  x: number;
  y: number;
  s: number;
  rot: number;
  seed: number;
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Roots, boulders and glow-moss scattered through the untouched earth.
 * Rejection-sampled so nothing lands on a tunnel, a chamber or a sign board.
 */
export function buildProps(chambers: Chamber[], net: Network): Prop[] {
  const rng = mulberry32(31337);
  const out: Prop[] = [];
  const segs = net.edges
    .filter((e) => e.kind !== 'surface')
    .map((e) => [net.nodes[e.a], net.nodes[e.b]] as const);

  let guard = 0;
  while (out.length < 46 && guard++ < 4000) {
    const x = 30 + rng() * (VIEW.w - 60);
    const y = SURFACE_Y + 80 + rng() * (VIEW.h - SURFACE_Y - 140);

    let ok = true;
    for (const c of chambers) {
      if (
        x > c.cx - c.rx - 60 &&
        x < c.cx + c.rx + 60 &&
        y > c.floorY - c.domeH - 130 &&
        y < c.floorY + 46
      ) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const [a, b] of segs) {
        if (distToSegment(x, y, a.x, a.y, b.x, b.y) < 74) {
          ok = false;
          break;
        }
      }
    }
    // Leave the dig face, its survey outline and the store room clear.
    if (x > 780 && y > 2230) ok = false;
    if (
      x > NOOK.cx - NOOK.rx - 70 &&
      x < 660 &&
      y > NOOK.floorY - NOOK.domeH - 70 &&
      y < NOOK.floorY + 50
    ) {
      ok = false;
    }
    if (!ok) continue;

    const r = rng();
    const kind: Prop['kind'] =
      y < 660 && r < 0.55
        ? 'root'
        : r < 0.44
          ? 'boulder'
          : r < 0.7
            ? 'glow'
            : y > 1000
              ? 'vein'
              : 'boulder';
    out.push({
      kind,
      x,
      y,
      s: 0.7 + rng() * 0.7,
      rot: (rng() - 0.5) * 40,
      seed: Math.floor(rng() * 1e6),
    });
  }
  return out;
}

export interface Tuft {
  x: number;
  y: number;
  s: number;
}

export function buildTufts(): Tuft[] {
  const rng = mulberry32(4242);
  const out: Tuft[] = [];
  for (let i = 0; i < 90; i++) {
    const x = rng() * VIEW.w;
    if (x > 560 && x < 690) continue; // keep the burrow mouth clear
    out.push({ x, y: groundY(x) + 1, s: 0.7 + rng() * 0.8 });
  }
  return out;
}
