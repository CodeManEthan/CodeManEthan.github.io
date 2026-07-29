// Regenerate src/data/world.json from scratch.
//
// The committed world.json is the vale's source of truth: the renderer and the
// /designs/vale page read it as data and never call buildWorld() themselves.
// Running this script REPLACES the whole world — every hand-applied or
// agent-applied patch (building progress, build-log entries, new structures)
// is lost. Day-to-day evolution should edit world.json directly; rerun this
// only to reseed after changing the generator in worldstate.ts.
//
// Usage: node scripts/build-world.mjs

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { buildWorld } = await import(
  join(root, 'src/components/designs/vale/worldstate.ts')
);
const { LOC, GEM_COLORS } = await import(join(root, 'src/data/islands.ts'));

const projectsDir = join(root, 'src/content/projects');
const projects = readdirSync(projectsDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const raw = readFileSync(join(projectsDir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) throw new Error(`no frontmatter in ${f}`);
    return { id: f.replace(/\.md$/, ''), data: yaml.load(m[1]) };
  })
  .sort((a, b) => a.data.order - b.data.order);

// Mirrors the input shape the old vale.astro built inline.
const inputs = projects.map((p, i) => ({
  id: p.id,
  title: p.data.title,
  summary: p.data.summary,
  tech: p.data.tech,
  status: p.data.status,
  featured: p.data.featured ?? false,
  loc: LOC[p.id] ?? 2000,
  accent: GEM_COLORS[i % GEM_COLORS.length],
}));

const world = buildWorld(inputs);
const out = join(root, 'src/data/world.json');
writeFileSync(out, JSON.stringify(world, null, 2) + '\n');

const buildings = world.villages.reduce((n, v) => n + v.buildings.length, 0);
console.log(
  `wrote ${out}: ${world.villages.length} villages, ${buildings} buildings, ` +
    `${world.scatter.length + world.villages.reduce((n, v) => n + v.props.length, 0)} props, ` +
    `${world.nodes.length} waypoints, day ${world.meta.day}`
);
