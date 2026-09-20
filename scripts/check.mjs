// Build checks, run after `astro build`: no island on the first page, the copy
// sweep, the contrast floors and token equality, and the preview tags on every
// emitted page with their images present under dist/.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sweep } from './check-copy.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const SITE = 'https://codemanethan.github.io';
let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

if (!existsSync(join(DIST, 'index.html'))) {
  console.log('dist/index.html missing: run astro build first');
  process.exit(1);
}

console.log('1. first page has no client island');
const home = readFileSync(join(DIST, 'index.html'), 'utf8');
if (home.includes('<astro-island')) fail('dist/index.html contains <astro-island');
if (home.includes('component-url=')) fail('dist/index.html contains component-url=');

console.log('2. copy sweep');
for (const h of sweep()) fail(`${h.file}: "${h.phrase}" in …${h.context}…`);

console.log('3. contrast floors and tokens (scripts/contrast.py)');
try {
  const out = execFileSync('python3', [join(ROOT, 'scripts', 'contrast.py')], { encoding: 'utf8' });
  console.log(out.replace(/^/gm, '   '));
} catch (e) {
  console.log((e.stdout ?? '').replace(/^/gm, '   '));
  fail('contrast.py exited non-zero');
}

console.log('4. preview tags on every page');
function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}
const OG = ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:image', 'og:url'];
const TW = ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];
let pages = 0;
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(DIST, file);
  if (/http-equiv="refresh"/i.test(html)) continue; // Astro's redirect page
  pages++;
  const tag = (attr, name) => {
    const m = html.match(new RegExp(`<meta\\s+${attr}="${name.replace(':', '\\:')}"\\s+content="([^"]*)"`));
    return m?.[1];
  };
  for (const name of OG) {
    const v = tag('property', name);
    if (v === undefined || v === '') fail(`${rel}: missing ${name}`);
    else if ((name === 'og:image' || name === 'og:url') && !v.startsWith(SITE + '/')) fail(`${rel}: ${name} not absolute under ${SITE}: ${v}`);
  }
  for (const name of TW) {
    const v = tag('name', name);
    if (v === undefined || v === '') fail(`${rel}: missing ${name}`);
    else if (name === 'twitter:image' && !v.startsWith(SITE + '/')) fail(`${rel}: ${name} not absolute: ${v}`);
  }
  for (const v of [tag('property', 'og:image'), tag('name', 'twitter:image')]) {
    if (!v) continue;
    const local = join(DIST, v.slice(SITE.length));
    if (!existsSync(local)) fail(`${rel}: image not in dist: ${v}`);
  }
}
console.log(`   ${pages} page(s) checked`);

console.log(failures ? `\ncheck: ${failures} failure(s)` : '\ncheck: all green');
process.exit(failures ? 1 : 0);
