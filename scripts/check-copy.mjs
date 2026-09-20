// Copy sweep: every sentence that places the valley must point at /genesis/.
// Reads the sources under src/content and src/pages (not _designs, designs, catalog),
// collapses whitespace, decodes HTML entities, and fails on any banned phrase.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ROOTS = ['src/content', 'src/pages'];
const SKIP = new Set(['_designs', 'designs', 'catalog']);
export const BANNED = [
  'front page',
  'homepage',
  'home page',
  'valley above',
  'grid above',
  "today's valley",
  'back to today',
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(md|mdx|astro|ts|tsx)$/.test(name)) yield p;
  }
}

export function sweep() {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const text = decode(readFileSync(file, 'utf8')).replace(/\s+/g, ' ');
      const lower = text.toLowerCase();
      for (const phrase of BANNED) {
        const norm = phrase.replace(/'/g, "’");
        for (const needle of new Set([phrase, norm])) {
          let i = lower.indexOf(needle);
          while (i !== -1) {
            hits.push({ file: relative(ROOT, file), phrase, context: text.slice(Math.max(0, i - 40), i + needle.length + 40) });
            i = lower.indexOf(needle, i + 1);
          }
        }
      }
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = sweep();
  for (const h of hits) console.log(`  ${h.file}: "${h.phrase}" in …${h.context}…`);
  console.log(hits.length ? `copy sweep: ${hits.length} hit(s) FAIL` : 'copy sweep: clean');
  process.exit(hits.length ? 1 : 0);
}
