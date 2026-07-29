// Advance the vale by one day (or several): the world's heartbeat.
//
// Each tick bumps `meta.day`, lets a couple of in-progress buildings gain
// some construction progress, and writes ledger lines when a build crosses a
// visible stage (frame up, walls to plate height, roof on, finished). The
// edit is a plain patch to src/data/world.json — commit the result and the
// site changes. Deterministic per (world seed, day), so rerunning a day that
// was already written produces the same world.
//
// Usage: node scripts/tick-world.mjs [days]   (default 1)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'src/data/world.json');
const world = JSON.parse(readFileSync(file, 'utf8'));

// Same generator worldstate.ts uses (not exported from there).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = new Map(world.villages.map((v) => [v.id, v.name]));

// The ledger line a build earns when it crosses into a new visible stage.
const STAGES = [
  [0.25, 'raise', (b, v) => `Frame standing on the ${b.label} at ${v}. Roof timbers still on the cart.`],
  [0.5, 'raise', (b, v) => `Walls to plate height on the ${b.label} at ${v}; scaffold stays another season.`],
  [0.75, 'raise', (b, v) => `Roof going on over the ${b.label} at ${v} — battens down, weather out by dusk.`],
  [1, 'finish', (b, v) => `The ${b.label} at ${v} is finished. Scaffold down, first fire in the hearth.`],
];

const days = Math.max(1, Number(process.argv[2]) || 1);

for (let d = 0; d < days; d++) {
  const day = world.meta.day + 1;
  const rng = mulberry32((world.seed ^ Math.imul(day, 2654435761)) >>> 0);

  const open = world.villages
    .flatMap((v) => v.buildings.map((b) => ({ v, b })))
    .filter(({ b }) => b.progress < 1);

  if (open.length === 0) {
    console.log(`day ${day}: nothing under construction — the vale rests`);
  } else {
    // One or two crews work per day; the rest of the vale goes about its business.
    const crews = Math.min(open.length, 1 + (rng() < 0.5 ? 1 : 0));
    for (let c = 0; c < crews; c++) {
      const pick = open.splice(Math.floor(rng() * open.length), 1)[0];
      const { v, b } = pick;
      const before = b.progress;
      b.progress = Math.min(1, Math.round((before + 0.06 + rng() * 0.08) * 100) / 100);
      const stage = STAGES.find(([at]) => before < at && b.progress >= at);
      if (stage) {
        const [, kind, text] = stage;
        world.buildLog.push({ day, village: v.id, kind, text: text(b, names.get(v.id) ?? v.id) });
      }
      console.log(
        `day ${day}: ${b.label} at ${names.get(v.id)} ${Math.round(before * 100)}% → ` +
          `${Math.round(b.progress * 100)}%${stage ? '  ✦ ledger: ' + world.buildLog.at(-1).text : ''}`
      );
    }
  }

  // A market-day line once a week keeps the ledger breathing between builds.
  if (day % 7 === 0) {
    world.buildLog.push({
      day,
      village: '__home',
      kind: 'trade',
      text: `Market day. ${world.travelers.length} carts and walkers on the roads between ${world.villages.length} settlements.`,
    });
  }

  world.meta.day = day;
}

writeFileSync(file, JSON.stringify(world, null, 2) + '\n');
console.log(`\nwrote ${file} at day ${world.meta.day}`);
