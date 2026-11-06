// Contour lines for the "contour" background trial: marching squares over a
// smooth deterministic field, written to public/bg/contour.svg.
// Run: node scripts/make_contours.mjs
import { writeFileSync } from 'node:fs';

const W = 1600, H = 1000, CELL = 10, LEVELS = 9;
const field = (x, y) => {
  const u = x / W, v = y / H;
  return (
    Math.sin(u * 5.1 + 0.4) * Math.cos(v * 3.7 - 1.1) +
    0.6 * Math.sin(u * 9.3 - v * 6.2 + 2.0) +
    0.35 * Math.cos(u * 14.7 + v * 11.3 + 0.7) +
    0.25 * Math.sin((u + v) * 21.1 - 0.9)
  );
};
const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
const grid = Array.from({ length: rows }, (_, j) => Array.from({ length: cols }, (_, i) => field(i * CELL, j * CELL)));
let min = Infinity, max = -Infinity;
for (const r of grid) for (const v of r) { if (v < min) min = v; if (v > max) max = v; }

const lerp = (a, b, va, vb, t) => a + ((t - va) / (vb - va)) * (b - a);
const segs = [];
for (let l = 1; l <= LEVELS; l++) {
  const t = min + ((max - min) * l) / (LEVELS + 1);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
    const x0 = i * CELL, y0 = j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    const pts = [];
    if ((a >= t) !== (b >= t)) pts.push([lerp(x0, x1, a, b, t), y0]);
    if ((b >= t) !== (c >= t)) pts.push([x1, lerp(y0, y1, b, c, t)]);
    if ((c >= t) !== (d >= t)) pts.push([lerp(x1, x0, c, d, t), y1]);
    if ((d >= t) !== (a >= t)) pts.push([x0, lerp(y1, y0, d, a, t)]);
    if (pts.length === 2) segs.push(pts);
    else if (pts.length === 4) { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
  }
}
const d = segs.map(([[ax, ay], [bx, by]]) => `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><path d="${d}" fill="none" stroke="#f5f5f0" stroke-width="1" stroke-linecap="round"/></svg>`;
writeFileSync(new URL('../public/bg/contour.svg', import.meta.url), svg);
console.log(`contour.svg: ${segs.length} segments, ${(svg.length / 1024).toFixed(0)} KB`);
