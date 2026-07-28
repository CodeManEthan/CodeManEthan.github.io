/**
 * The Burrow — a side-view cutaway of an underground colony.
 *
 * Above ground: Ethan's house, a tree, and the trail down to the burrow mouth.
 * Below: one excavated chamber per project, its floor area scaled from the
 * project's real line count, lit by that project's gem crystal, joined by a
 * network of shafts and drifts. Digger bots walk the network, work in the
 * rooms, and keep extending the deep stub at the bottom of the shaft.
 *
 * Everything is one SVG in a single user-space coordinate system, so the scene
 * scales with the page width and ordinary page scroll travels deeper down.
 * The world is drawn once by React; the bots are animated by writing
 * transforms straight onto refs in a rAF loop — no per-frame React state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIG_FACE,
  NOOK,
  VIEW,
  buildChambers,
  buildNetwork,
  buildProps,
  buildStrata,
  buildTufts,
  earthPath,
  groundPath,
  groundY,
  mix,
  mulberry32,
  nookPath,
  trailPath,
  type Chamber,
  type ProjectInput,
  type Prop,
} from './world';
import { createBots, createDigState, poseStatic, stepBots } from './bots';

/* ------------------------------- palette -------------------------------- */

const VOID = '#2b170c';
const VOID_LIP = '#8a5a33';
const FLOOR = '#6d4626';
const WOOD = '#a97a4a';
const WOOD_DARK = '#7d5430';
const CREAM = '#fdf3e2';

/** How far a horizontal tunnel's centre sits above its walking surface. */
const HEADROOM = 17;

const TUNNEL_W: Record<string, number> = {
  shaft: 48,
  drift: 48,
  surface: 0,
  dig: 44,
};

/* ------------------------------ small parts ------------------------------ */

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#fffaf0" opacity="0.9">
      <ellipse cx="0" cy="0" rx="46" ry="20" />
      <ellipse cx="-32" cy="6" rx="30" ry="14" />
      <ellipse cx="30" cy="7" rx="26" ry="13" />
      <ellipse cx="8" cy="-14" rx="24" ry="15" />
    </g>
  );
}

/** Roots, boulders, glow-moss and mineral seams in the untouched earth. */
function DirtProp({ p }: { p: Prop }) {
  const t = `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.rot.toFixed(1)}) scale(${p.s.toFixed(2)})`;
  if (p.kind === 'root') {
    return (
      <g transform={t} fill="none" stroke="#6d4a2c" strokeLinecap="round" opacity="0.5">
        <path d="M 0 -30 q 14 26 2 52 q -12 22 6 44" strokeWidth="5" />
        <path d="M 4 6 q 18 6 24 26" strokeWidth="3" />
        <path d="M 1 -6 q -20 8 -26 30" strokeWidth="3" />
        <path d="M 7 44 q 12 8 14 20" strokeWidth="2.5" />
      </g>
    );
  }
  if (p.kind === 'boulder') {
    return (
      <g transform={t} opacity="0.75">
        <path d="M -26 12 L -20 -12 L -2 -20 L 20 -10 L 24 10 L 6 18 Z" fill="#7d5c3e" />
        <path d="M -20 -12 L -2 -20 L 20 -10 L 2 -6 Z" fill="#95714e" />
        <path d="M -26 12 L 6 18 L 24 10 L 22 14 L 4 22 Z" fill="#5b3f28" />
        <ellipse cx="-30" cy="16" rx="8" ry="5" fill="#6b4d33" />
      </g>
    );
  }
  if (p.kind === 'vein') {
    return (
      <g transform={t} opacity="0.55">
        <path d="M -18 6 L -9 -5 L 2 2 L 13 -8" fill="none" stroke="#e6c48d" strokeWidth="2.5" opacity="0.5" />
        <path d="M -9 -5 l 3 -6 l 4 6 l -4 5 Z" fill="#f0d7a6" />
        <path d="M 13 -8 l 3 -5 l 3 5 l -3 4 Z" fill="#f0d7a6" />
        <path d="M 2 2 l 2 -4 l 3 4 l -3 4 Z" fill="#fbeccc" />
      </g>
    );
  }
  return (
    <g transform={t}>
      <circle cx="0" cy="0" r="26" fill="url(#lampGlow)" opacity="0.45" />
      <g fill="#c9f0c0" opacity="0.8">
        <circle cx="-10" cy="4" r="2.6" />
        <circle cx="-2" cy="-4" r="2" />
        <circle cx="6" cy="3" r="2.8" />
        <circle cx="13" cy="-3" r="1.8" />
        <circle cx="1" cy="8" r="1.6" />
      </g>
    </g>
  );
}

/** Ethan's house: the visual anchor at the surface. */
function Homestead() {
  const baseY = groundY(960) + 4;
  return (
    <g>
      {/* tree */}
      <g transform={`translate(1215 ${groundY(1215) + 4})`}>
        <path d="M -6 0 L -4 -46 L 4 -46 L 6 0 Z" fill="#8a6240" />
        <path d="M -4 -30 L -20 -42" stroke="#8a6240" strokeWidth="5" strokeLinecap="round" />
        <path d="M 4 -34 L 20 -46" stroke="#8a6240" strokeWidth="5" strokeLinecap="round" />
        <circle cx="-22" cy="-58" r="26" fill="#7cc79b" />
        <circle cx="22" cy="-62" r="24" fill="#8ed3a8" />
        <circle cx="0" cy="-80" r="30" fill="#96dcb0" />
        <circle cx="-4" cy="-62" r="24" fill="#82cda1" />
      </g>

      {/* mailbox by the trail */}
      <g transform={`translate(1105 ${groundY(1105) + 4})`}>
        <rect x="-2.5" y="-30" width="5" height="30" fill={WOOD_DARK} />
        <rect x="-13" y="-44" width="26" height="15" rx="6" fill="#e08e7a" />
        <rect x="-13" y="-44" width="26" height="4" rx="2" fill="#c9705c" />
      </g>

      {/* house */}
      <g transform={`translate(960 ${baseY})`}>
        <ellipse cx="0" cy="2" rx="104" ry="9" fill="#5fae86" opacity="0.35" />
        <rect x="-78" y="-92" width="156" height="94" rx="6" fill="#f6e3c8" />
        <rect x="-78" y="-92" width="156" height="94" rx="6" fill="none" stroke="#d8bd99" strokeWidth="2" />
        <path d="M -94 -88 L 0 -150 L 94 -88 Z" fill="#e08e7a" />
        <path d="M -94 -88 L 0 -150 L 94 -88 Z" fill="none" stroke="#c9705c" strokeWidth="3" strokeLinejoin="round" />
        {/* chimney + a curl of smoke */}
        <rect x="42" y="-136" width="20" height="34" rx="3" fill="#c9705c" />
        <g fill="#fffaf0" opacity="0.75">
          <circle cx="52" cy="-152" r="9" />
          <circle cx="62" cy="-172" r="11" />
          <circle cx="52" cy="-194" r="13" opacity="0.6" />
        </g>
        {/* windows + door */}
        <rect x="-58" y="-72" width="34" height="30" rx="4" fill="#ffd88a" stroke="#d8bd99" strokeWidth="2" />
        <path d="M -41 -72 L -41 -42 M -58 -57 L -24 -57" stroke="#d8bd99" strokeWidth="2" />
        <rect x="26" y="-72" width="34" height="30" rx="4" fill="#ffd88a" stroke="#d8bd99" strokeWidth="2" />
        <path d="M 43 -72 L 43 -42 M 26 -57 L 60 -57" stroke="#d8bd99" strokeWidth="2" />
        <rect x="-17" y="-52" width="34" height="52" rx="4" fill="#a97a4a" stroke="#7d5430" strokeWidth="2" />
        <circle cx="8" cy="-26" r="3" fill="#ffd88a" />
        {/* name board */}
        <g transform="translate(-104 -46)">
          <rect x="-3" y="0" width="6" height="46" fill={WOOD_DARK} />
          <rect x="-34" y="-22" width="68" height="26" rx="5" fill={WOOD} stroke={WOOD_DARK} strokeWidth="2" />
          <text x="0" y="-4" textAnchor="middle" fontSize="15" fontWeight="700" fill={CREAM}>
            Ethan
          </text>
        </g>
      </g>
    </g>
  );
}

/** The way in: a timbered arch set into the hillside. */
function BurrowMouth() {
  const gy = groundY(620);
  return (
    <g>
      {/* mound of spoil heaped around the entrance */}
      <path
        d={`M 486 ${gy + 24} Q 560 ${gy - 6} 620 ${gy - 40} Q 680 ${gy - 6} 754 ${gy + 24} Z`}
        fill="#a9743f"
      />
      <path
        d={`M 486 ${gy + 24} Q 560 ${gy - 6} 620 ${gy - 40} Q 680 ${gy - 6} 754 ${gy + 24}`}
        fill="none"
        stroke="#8ed3a8"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* the opening */}
      <path
        d={`M 592 ${gy + 70} L 592 ${gy - 12} Q 620 ${gy - 40} 648 ${gy - 12} L 648 ${gy + 70} Z`}
        fill={VOID}
      />
      <path
        d={`M 586 ${gy + 70} L 586 ${gy - 12} Q 620 ${gy - 44} 654 ${gy - 12} L 654 ${gy + 70}`}
        fill="none"
        stroke={WOOD}
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <path
        d={`M 586 ${gy + 70} L 586 ${gy - 12} Q 620 ${gy - 44} 654 ${gy - 12} L 654 ${gy + 70}`}
        fill="none"
        stroke={WOOD_DARK}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* lamp on a hooked post beside the door */}
      <g transform={`translate(686 ${gy - 4})`}>
        <path d="M 0 0 L 0 -62 q 0 -14 -14 -14" fill="none" stroke={WOOD_DARK} strokeWidth="4" strokeLinecap="round" />
        <circle cx="-14" cy="-62" r="26" fill="url(#lampGlow)" />
        <path d="M -22 -76 L -6 -76 L -9 -58 L -19 -58 Z" fill="#ffcf7a" stroke={WOOD_DARK} strokeWidth="2" strokeLinejoin="round" />
      </g>
      {/* sign post */}
      <g transform={`translate(506 ${gy + 6})`}>
        <rect x="-3" y="-4" width="6" height="30" fill={WOOD_DARK} />
        <rect x="-54" y="-42" width="108" height="32" rx="6" fill={WOOD} stroke={WOOD_DARK} strokeWidth="2.5" />
        <text x="0" y="-21" textAnchor="middle" fontSize="14" fontWeight="700" fill={CREAM} letterSpacing="1">
          THE BURROW
        </text>
      </g>
    </g>
  );
}

/** Rungs down a vertical shaft. */
function Ladder({ x, y0, y1 }: { x: number; y0: number; y1: number }) {
  const rungs: number[] = [];
  for (let y = y0 + 20; y < y1 - 8; y += 26) rungs.push(y);
  return (
    <g stroke="#9a7048" strokeWidth="3" strokeLinecap="round" opacity="0.85">
      <line x1={x - 11} y1={y0 + 6} x2={x - 11} y2={y1 - 4} />
      <line x1={x + 11} y1={y0 + 6} x2={x + 11} y2={y1 - 4} />
      {rungs.map((y) => (
        <line key={y} x1={x - 11} y1={y} x2={x + 11} y2={y} />
      ))}
    </g>
  );
}

/** A timbered frame across a horizontal drift. */
function Timber({ x, y, w = 46, h = 44 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g stroke={WOOD_DARK} strokeWidth="1.5" fill={WOOD}>
      <rect x={x - w / 2 - 5} y={y - h / 2} width="7" height={h} rx="2" />
      <rect x={x + w / 2 - 2} y={y - h / 2} width="7" height={h} rx="2" />
      <rect x={x - w / 2 - 8} y={y - h / 2 - 6} width={w + 16} height="8" rx="2" />
    </g>
  );
}

/* ------------------------------- chambers -------------------------------- */

function ChamberDecor({ c }: { c: Chamber }) {
  const k = Math.max(0.6, Math.min(1.1, c.rx / 130));
  const f = c.floorY;
  const rng = mulberry32(c.depth * 991 + 7);
  const shelfBooks = Array.from({ length: 5 }, () => ({
    w: 5 + rng() * 4,
    h: 12 + rng() * 8,
    fill: mix(c.color, CREAM, 0.15 + rng() * 0.6),
  }));

  return (
    <g>
      {/* ambient crystal light */}
      <ellipse
        cx={c.cx}
        cy={f - c.domeH * 0.42}
        rx={c.rx * 1.02}
        ry={c.domeH * 0.98}
        fill={`url(#glow-${c.id})`}
      />
      {/* lit floor */}
      <rect x={c.cx - c.rx} y={f - 7} width={c.rx * 2} height="14" fill={FLOOR} />
      <rect x={c.cx - c.rx} y={f - 7} width={c.rx * 2} height="3.5" fill={mix(FLOOR, c.color, 0.45)} opacity="0.75" />

      {/* gem crystal cluster on a plinth */}
      <g transform={`translate(${c.cx - c.rx * 0.66} ${f}) scale(${k})`}>
        <circle cx="0" cy="-26" r={46} fill={`url(#glow-${c.id})`} />
        <rect x="-17" y="-9" width="34" height="10" rx="3" fill={WOOD_DARK} />
        <path d="M 0 -54 L 11 -18 L -11 -18 Z" fill={c.color} />
        <path d="M 0 -54 L 11 -18 L 0 -18 Z" fill={mix(c.color, '#ffffff', 0.42)} />
        <path d="M -15 -36 L -8 -14 L -21 -14 Z" fill={mix(c.color, '#ffffff', 0.18)} />
        <path d="M 15 -32 L 21 -14 L 9 -14 Z" fill={mix(c.color, '#ffffff', 0.3)} />
      </g>

      {/* hanging lantern */}
      <g transform={`translate(${c.cx + c.rx * 0.06} ${f - c.domeH * 0.94})`}>
        <line x1="0" y1="0" x2="0" y2="16" stroke={WOOD_DARK} strokeWidth="2" />
        <path d="M -8 16 L 8 16 L 6 30 L -6 30 Z" fill="#ffcf7a" stroke={WOOD_DARK} strokeWidth="1.6" />
        <circle cx="0" cy="23" r="26" fill="url(#lampGlow)" />
      </g>

      {/* shelving */}
      <g transform={`translate(${c.cx + c.rx * 0.5} ${f}) scale(${k})`}>
        <rect x="-42" y="-58" width="84" height="5" rx="2" fill={WOOD} />
        <rect x="-42" y="-28" width="84" height="5" rx="2" fill={WOOD} />
        <rect x="-42" y="-58" width="5" height="58" fill={WOOD_DARK} />
        <rect x="37" y="-58" width="5" height="58" fill={WOOD_DARK} />
        {shelfBooks.map((b, i) => (
          <rect
            key={`a${i}`}
            x={-34 + i * 13}
            y={-58 - b.h + 5}
            width={b.w}
            height={b.h}
            rx="1.5"
            fill={b.fill}
          />
        ))}
        {shelfBooks.map((b, i) => (
          <rect
            key={`b${i}`}
            x={-32 + i * 14}
            y={-28 - b.h * 0.8 + 5}
            width={b.w * 0.9}
            height={b.h * 0.8}
            rx="1.5"
            fill={mix(b.fill, VOID, 0.25)}
          />
        ))}
      </g>

      {/* a machine, in the rooms with space for one */}
      {c.rx > 100 && (
        <g transform={`translate(${c.cx - c.rx * 0.12} ${f}) scale(${k})`}>
          <rect x="-30" y="-46" width="60" height="46" rx="6" fill="#7a5a3f" stroke={WOOD_DARK} strokeWidth="2" />
          <rect x="-20" y="-38" width="40" height="18" rx="3" fill={mix(c.color, VOID, 0.35)} />
          <circle cx="-12" cy="-11" r="6" fill="#d8bd99" />
          <circle cx="-12" cy="-11" r="2" fill={WOOD_DARK} />
          <circle cx="4" cy="-11" r="3.5" fill={c.color} />
          <circle cx="16" cy="-11" r="3.5" fill="#ffcf7a" />
          <path d="M 22 -46 L 22 -70 L 40 -70" stroke="#7a5a3f" strokeWidth="7" fill="none" strokeLinecap="round" />
        </g>
      )}

      {/* crates, where the room is big enough for them */}
      {c.rx > 90 && (
        <g transform={`translate(${c.cx + c.rx * 0.02} ${f}) scale(${k})`}>
          <rect x="46" y="-24" width="26" height="24" rx="3" fill={WOOD} stroke={WOOD_DARK} strokeWidth="1.6" />
          <path d="M 46 -12 L 72 -12" stroke={WOOD_DARK} strokeWidth="1.4" />
          <rect x="56" y="-42" width="20" height="18" rx="3" fill={WOOD_DARK} />
        </g>
      )}
      <g fill={mix(c.color, CREAM, 0.35)} opacity="0.85">
        <circle cx={c.cx - c.rx * 0.86} cy={f - 4} r={3.5 * k} />
        <circle cx={c.cx - c.rx * 0.8} cy={f - 2} r={2.4 * k} />
        <circle cx={c.cx + c.rx * 0.86} cy={f - 3} r={3 * k} />
      </g>
    </g>
  );
}

function signBox(c: Chamber) {
  const fs = 17;
  const sub = `${c.locLabel} lines · ${c.size}`;
  const w = Math.max(c.title.length * fs * 0.56, sub.length * 6.6) + 30;
  const h = 46;
  const y = c.floorY - c.domeH - 26 - h;
  return { x: c.cx - w / 2, y, w, h, sub, fs };
}

/* -------------------------------- the bot -------------------------------- */

interface BotRefs {
  root: (SVGGElement | null)[];
  inner: (SVGGElement | null)[];
  tool: (SVGGElement | null)[];
  spark: (SVGGElement | null)[];
  carry: (SVGGElement | null)[];
}

function BotSprite({
  color,
  role,
  idx,
  refs,
}: {
  color: string;
  role: string;
  idx: number;
  refs: BotRefs;
}) {
  const dark = mix(color, VOID, 0.45);
  return (
    <g ref={(el) => void (refs.root[idx] = el)}>
      <circle cx="0" cy="-16" r="46" fill="url(#botGlow)" />
      <ellipse cx="0" cy="0" rx="13" ry="4" fill="#160b04" opacity="0.45" />
      <g ref={(el) => void (refs.inner[idx] = el)}>
        {/* legs */}
        <rect x="-7" y="-9" width="5" height="9" rx="2.5" fill={dark} />
        <rect x="2" y="-9" width="5" height="9" rx="2.5" fill={dark} />
        {/* body */}
        <rect x="-11" y="-27" width="22" height="20" rx="7" fill={color} />
        <rect x="-6" y="-22" width="12" height="10" rx="3" fill={dark} opacity="0.7" />
        {/* head */}
        <rect x="-10" y="-42" width="20" height="16" rx="7" fill={mix(color, CREAM, 0.45)} />
        <rect x="-7" y="-39" width="14" height="9" rx="4" fill="#2f1c0e" />
        <circle cx="-3" cy="-34.5" r="1.9" fill="#9ff3e0" />
        <circle cx="3" cy="-34.5" r="1.9" fill="#9ff3e0" />
        <line x1="0" y1="-42" x2="0" y2="-50" stroke={dark} strokeWidth="2" />
        <circle cx="0" cy="-51" r="2.6" fill="#ffcf7a" />
        {/* carried spoil (haulers only) */}
        <g ref={(el) => void (refs.carry[idx] = el)} style={{ display: 'none' }}>
          <ellipse cx="-14" cy="-24" rx="9" ry="7" fill="#6d4626" />
          <circle cx="-17" cy="-28" r="3" fill="#8a5a33" />
          <circle cx="-11" cy="-29" r="2.4" fill="#8a5a33" />
        </g>
        {/* arm + tool */}
        <g transform="translate(8 -22)">
          <g ref={(el) => void (refs.tool[idx] = el)}>
            <rect x="-2" y="-2" width="5" height="16" rx="2.5" fill={dark} />
            {role === 'digger' || role === 'hauler' ? (
              <g transform="translate(0.5 14)">
                <rect x="-1.6" y="-2" width="3.2" height="16" rx="1.6" fill={WOOD} />
                <path d="M -9 14 Q 0 8 9 14 L 7 17 Q 0 12 -7 17 Z" fill="#cfd6dd" />
              </g>
            ) : (
              <g transform="translate(0.5 14)">
                <rect x="-1.4" y="0" width="2.8" height="10" rx="1.4" fill={WOOD} />
                <rect x="-5" y="9" width="10" height="5" rx="2" fill="#cfd6dd" />
              </g>
            )}
          </g>
        </g>
        {/* work spark */}
        <g ref={(el) => void (refs.spark[idx] = el)} style={{ display: 'none' }}>
          <path
            d="M 0 -7 L 2.4 -2.4 L 7 0 L 2.4 2.4 L 0 7 L -2.4 2.4 L -7 0 L -2.4 -2.4 Z"
            fill="#ffe8a3"
            transform="translate(20 -8)"
          />
        </g>
      </g>
    </g>
  );
}

/* --------------------------------- scene --------------------------------- */

export default function BurrowScene({ projects }: { projects: ProjectInput[] }) {
  const [reduced, setReduced] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const chambers = useMemo(() => buildChambers(projects), [projects]);
  const net = useMemo(() => buildNetwork(chambers), [chambers]);
  const strata = useMemo(() => buildStrata(), []);
  const tufts = useMemo(() => buildTufts(), []);
  const ground = useMemo(() => groundPath(), []);
  const earth = useMemo(() => earthPath(), []);
  const trail = useMemo(() => trailPath(), []);
  const bots = useMemo(() => createBots(net, chambers), [net, chambers]);
  const props = useMemo(() => buildProps(chambers, net), [chambers, net]);
  const nook = useMemo(() => nookPath(), []);

  const digRef = useRef(createDigState());
  const wrapRef = useRef<HTMLDivElement>(null);
  const pileRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const puffRefs = useRef<(SVGCircleElement | null)[]>([]);
  const refs = useRef<BotRefs>({ root: [], inner: [], tool: [], spark: [], carry: [] });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const paint = () => {
      const r = refs.current;
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        const root = r.root[i];
        const inner = r.inner[i];
        if (!root || !inner) continue;
        root.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) scale(${b.scale.toFixed(2)})`);
        inner.setAttribute('transform', `translate(0 ${(-b.bob).toFixed(1)}) scale(${b.face} 1)`);
        const tool = r.tool[i];
        if (tool) tool.setAttribute('transform', `rotate(${b.tool.toFixed(1)})`);
        const spark = r.spark[i];
        if (spark) spark.style.display = b.spark ? '' : 'none';
        const carry = r.carry[i];
        if (carry) carry.style.display = b.carrying ? '' : 'none';
      }
      const dig = digRef.current;
      if (pileRef.current) {
        const p = 0.75 + dig.progress * 0.75;
        pileRef.current.setAttribute('transform', `translate(${DIG_FACE.x - 26} ${DIG_FACE.y}) scale(${p.toFixed(3)} ${p.toFixed(3)})`);
      }
      if (faceRef.current) {
        faceRef.current.setAttribute('transform', `translate(${(dig.progress * 26).toFixed(1)} 0)`);
      }
      for (let i = 0; i < puffRefs.current.length; i++) {
        const el = puffRefs.current[i];
        if (!el) continue;
        const u = dig.puffs[i];
        el.setAttribute('cx', String(DIG_FACE.x + 14 - u * 46));
        el.setAttribute('cy', String(DIG_FACE.y - 8 - u * 26 + u * u * 22));
        el.setAttribute('r', String(2 + u * 5));
        el.setAttribute('opacity', String(Math.max(0, 0.55 - u * 0.55)));
      }
    };

    if (reduced) {
      poseStatic(bots);
      paint();
      return;
    }

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let visible = true;
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        last = performance.now();
      },
      { rootMargin: '120px' }
    );
    if (wrapRef.current) io.observe(wrapRef.current);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible) {
        t += dt;
        stepBots(bots, net, chambers, digRef.current, dt, t);
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [bots, net, chambers, reduced]);

  const hovered = chambers.find((c) => c.id === hover) ?? null;

  return (
    <div className="burrow-wrap" ref={wrapRef}>
      <svg
        className="burrow-svg"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label="Cutaway of an underground bot colony: Ethan's house on the surface, one excavated chamber per project below."
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bfe3ef" />
            <stop offset="0.55" stopColor="#e6f0e4" />
            <stop offset="1" stopColor="#fdf3e2" />
          </linearGradient>
          <linearGradient id="dirt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c99361" />
            <stop offset="1" stopColor="#4a2b18" />
          </linearGradient>
          <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22150b" stopOpacity="0" />
            <stop offset="1" stopColor="#22150b" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="lampGlow">
            <stop offset="0" stopColor="#ffd27a" stopOpacity="0.75" />
            <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="botGlow">
            <stop offset="0" stopColor="#ffcf7a" stopOpacity="0.4" />
            <stop offset="1" stopColor="#ffcf7a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sunGlow">
            <stop offset="0" stopColor="#fff3c4" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff3c4" stopOpacity="0" />
          </radialGradient>
          {chambers.map((c) => (
            <radialGradient key={c.id} id={`glow-${c.id}`}>
              <stop offset="0" stopColor={c.color} stopOpacity="0.55" />
              <stop offset="0.55" stopColor={c.color} stopOpacity="0.16" />
              <stop offset="1" stopColor={c.color} stopOpacity="0" />
            </radialGradient>
          ))}
          {chambers.map((c) => (
            <clipPath key={c.id} id={`clip-${c.id}`}>
              <path d={c.path} />
            </clipPath>
          ))}
          <clipPath id="clip-nook">
            <path d={nook} />
          </clipPath>
          <clipPath id="digClip">
            <rect x="884" y={DIG_FACE.y - 56} width="250" height="74" />
          </clipPath>
        </defs>

        {/* ---------------- sky ---------------- */}
        <rect x="0" y="0" width={VIEW.w} height={VIEW.h * 0.2} fill="url(#sky)" />
        <circle cx="1330" cy="86" r="120" fill="url(#sunGlow)" />
        <circle cx="1330" cy="86" r="38" fill="#fff0b8" />
        <Cloud x={230} y={120} s={1.15} />
        <Cloud x={640} y={78} s={0.85} />
        <Cloud x={1030} y={150} s={1} />
        {/* far hills */}
        <path
          d={`M -20 ${SVGHillY(0)} Q 200 300 420 348 T 900 340 T 1460 356 L 1460 470 L -20 470 Z`}
          fill="#bfe0c8"
          opacity="0.65"
        />

        {/* ---------------- earth ---------------- */}
        <path d={earth} fill="url(#dirt)" />
        {strata.bands.map((b, i) => (
          <path key={i} d={b.d} fill={b.fill} />
        ))}
        {strata.specks.map((s, i) => (
          <ellipse
            key={i}
            cx={s.x}
            cy={s.y}
            rx={s.r}
            ry={s.r * 0.62}
            fill={s.fill}
            opacity="0.55"
            transform={`rotate(${s.rot} ${s.x} ${s.y})`}
          />
        ))}

        {props.map((p, i) => (
          <DirtProp key={i} p={p} />
        ))}
        {/* grass surface */}
        <path d={ground} fill="#8ed3a8" />
        <path d={ground} fill="none" stroke="#6fbf8f" strokeWidth="4" />
        <g stroke="#5aa87a" strokeWidth="2.5" strokeLinecap="round">
          {tufts.map((t, i) => (
            <path key={i} d={`M ${t.x} ${t.y} l ${-3 * t.s} ${-9 * t.s} M ${t.x} ${t.y} l ${3 * t.s} ${-7 * t.s}`} />
          ))}
        </g>
        <path d={trail} fill="none" stroke="#e4c9a0" strokeWidth="15" strokeLinecap="round" opacity="0.95" />
        <path d={trail} fill="none" stroke="#d3b489" strokeWidth="15" strokeLinecap="round" strokeDasharray="3 26" />

        <Homestead />
        <BurrowMouth />

        {/* ---------------- tunnels ---------------- */}
        <g>
          {net.edges
            .filter((e) => e.kind !== 'surface')
            .map((e, i) => {
              const a = net.nodes[e.a];
              const b = net.nodes[e.b];
              const w = TUNNEL_W[e.kind];
              // The stub at the bottom runs past its node, out to the dig face.
              const bx = e.kind === 'dig' ? DIG_FACE.x + 100 : b.x;
              // Horizontal runs are hoisted so their floor lands on the node
              // line — that line is where the bots' feet are.
              const flat = Math.abs(a.y - b.y) < 4;
              const off = flat ? -HEADROOM : 0;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y + off} x2={bx} y2={b.y + off} stroke={VOID_LIP} strokeWidth={w + 12} strokeLinecap="round" opacity="0.5" />
                  <line x1={a.x} y1={a.y + off} x2={bx} y2={b.y + off} stroke={VOID} strokeWidth={w} strokeLinecap="round" />
                  {flat && (
                    <line x1={a.x} y1={a.y + 4} x2={bx} y2={b.y + 4} stroke={FLOOR} strokeWidth="8" strokeLinecap="round" />
                  )}
                </g>
              );
            })}
        </g>

        {/* ladders down the shafts, timbers across the drifts */}
        {net.edges
          .filter((e) => e.kind === 'shaft')
          .map((e, i) => {
            const a = net.nodes[e.a];
            const b = net.nodes[e.b];
            if (Math.abs(a.x - b.x) > 4) return null;
            return <Ladder key={i} x={a.x} y0={Math.min(a.y, b.y)} y1={Math.max(a.y, b.y)} />;
          })}
        {net.edges
          .filter((e) => e.kind === 'drift')
          .map((e, i) => {
            const a = net.nodes[e.a];
            const b = net.nodes[e.b];
            const mid = (a.x + b.x) / 2;
            return <Timber key={i} x={mid} y={a.y - HEADROOM} w={46} h={50} />;
          })}

        {/* store room: colony infrastructure, not a project */}
        <g>
          <line
            x1={NOOK.cx}
            y1={NOOK.floorY - HEADROOM}
            x2="592"
            y2={NOOK.floorY - HEADROOM}
            stroke={VOID_LIP}
            strokeWidth="46"
            strokeLinecap="round"
            opacity="0.5"
          />
          <line
            x1={NOOK.cx}
            y1={NOOK.floorY - HEADROOM}
            x2="592"
            y2={NOOK.floorY - HEADROOM}
            stroke={VOID}
            strokeWidth="34"
            strokeLinecap="round"
          />
          <line x1={NOOK.cx} y1={NOOK.floorY + 3} x2="592" y2={NOOK.floorY + 3} stroke={FLOOR} strokeWidth="7" strokeLinecap="round" />
          <path d={nook} fill={VOID} stroke={VOID_LIP} strokeWidth="8" strokeOpacity="0.5" />
          <g clipPath="url(#clip-nook)">
            <ellipse cx={NOOK.cx} cy={NOOK.floorY - 24} rx={NOOK.rx} ry={NOOK.domeH} fill="url(#lampGlow)" opacity="0.8" />
            <rect x={NOOK.cx - NOOK.rx} y={NOOK.floorY - 7} width={NOOK.rx * 2} height="14" fill={FLOOR} />
            {/* sacks, barrels and a mushroom bed */}
            <g transform={`translate(${NOOK.cx - 32} ${NOOK.floorY})`}>
              <ellipse cx="0" cy="-9" rx="12" ry="11" fill="#8a6a45" />
              <ellipse cx="16" cy="-7" rx="10" ry="9" fill="#7a5a3f" />
              <path d="M -4 -19 l 4 -5 l 5 5 Z" fill="#6d4626" />
            </g>
            <g transform={`translate(${NOOK.cx + 30} ${NOOK.floorY})`}>
              <rect x="-14" y="-26" width="28" height="26" rx="4" fill={WOOD} stroke={WOOD_DARK} strokeWidth="1.6" />
              <path d="M -14 -13 L 14 -13" stroke={WOOD_DARK} strokeWidth="1.4" />
            </g>
            <g fill="#f0c98a">
              <path d={`M ${NOOK.cx - 4} ${NOOK.floorY} l 0 -8 q -8 0 -8 -5 q 8 -6 16 0 q 0 5 -8 5 Z`} />
              <path d={`M ${NOOK.cx + 8} ${NOOK.floorY} l 0 -6 q -6 0 -6 -4 q 6 -5 12 0 q 0 4 -6 4 Z`} />
            </g>
            <g transform={`translate(${NOOK.cx} ${NOOK.floorY - NOOK.domeH * 0.92})`}>
              <line x1="0" y1="0" x2="0" y2="12" stroke={WOOD_DARK} strokeWidth="2" />
              <path d="M -7 12 L 7 12 L 5 24 L -5 24 Z" fill="#ffcf7a" stroke={WOOD_DARK} strokeWidth="1.5" />
              <circle cx="0" cy="18" r="22" fill="url(#lampGlow)" />
            </g>
          </g>
          <text
            x={NOOK.cx}
            y={NOOK.floorY - NOOK.domeH - 16}
            textAnchor="middle"
            fontSize="14"
            fill={CREAM}
            opacity="0.5"
            letterSpacing="1.5"
          >
            STORES
          </text>
        </g>

        {/* ---------------- chambers ---------------- */}
        {chambers.map((c) => {
          const sign = signBox(c);
          const on = hover === c.id;
          return (
            <a
              key={c.id}
              href={`/projects/${c.id}/`}
              className={`chamber${on ? ' is-on' : ''}`}
              aria-label={`${c.title} — ${c.locLabel} lines, ${c.size}`}
              onMouseEnter={() => setHover(c.id)}
              onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
              onFocus={() => setHover(c.id)}
              onBlur={() => setHover((h) => (h === c.id ? null : h))}
            >
              <path d={c.path} fill={VOID} stroke={VOID_LIP} strokeWidth="9" strokeOpacity="0.55" />
              <g clipPath={`url(#clip-${c.id})`}>
                <ChamberDecor c={c} />
              </g>
              {/* sign board staked in the dirt above the room */}
              <g>
                <rect x={c.cx - 3} y={sign.y + sign.h} width="6" height="22" fill={WOOD_DARK} />
                <rect
                  x={sign.x}
                  y={sign.y}
                  width={sign.w}
                  height={sign.h}
                  rx="7"
                  fill={WOOD}
                  stroke={WOOD_DARK}
                  strokeWidth="2.5"
                />
                <circle cx={sign.x + 15} cy={sign.y + 15} r="5" fill={c.color} />
                <text
                  x={sign.x + sign.w / 2 + 6}
                  y={sign.y + 20}
                  textAnchor="middle"
                  fontSize={sign.fs}
                  fontWeight="700"
                  fill={CREAM}
                >
                  {c.title}
                </text>
                <text
                  x={sign.x + sign.w / 2}
                  y={sign.y + 37}
                  textAnchor="middle"
                  fontSize="12.5"
                  fill="#f2dcbd"
                >
                  {sign.sub}
                </text>
              </g>
              <path className="chamber-ring" d={c.path} fill="none" stroke={c.color} strokeWidth="6" />
            </a>
          );
        })}

        {/* ---------------- the active dig ---------------- */}
        <g>
          {/* Unbroken rock at the face. It slides right as the crew advances,
              so the stub visibly gets longer. */}
          <g clipPath="url(#digClip)">
            <g ref={faceRef}>
              <path
                d="M 902 2270 L 912 2292 L 898 2308 L 914 2324 L 900 2340 L 916 2356 L 904 2372 L 914 2410 L 1140 2410 L 1140 2270 Z"
                fill="#553422"
              />
              <path
                d="M 902 2270 L 912 2292 L 898 2308 L 914 2324 L 900 2340 L 916 2356 L 904 2372 L 914 2410"
                fill="none"
                stroke="#9c6b41"
                strokeWidth="3.5"
                opacity="0.9"
              />
              <g stroke="#a9743f" strokeWidth="2" opacity="0.65">
                <path d="M 918 2300 l 16 -7" />
                <path d="M 916 2330 l 20 5" />
                <path d="M 922 2358 l 15 -9" />
              </g>
            </g>
          </g>
          {/* rails and a spoil cart: the stub is a working dig, not a hole */}
          <g>
            <g stroke="#8a6a45" strokeWidth="2.5" opacity="0.8">
              {Array.from({ length: 13 }, (_, i) => 600 + i * 26).map((x) => (
                <line key={x} x1={x} y1={DIG_FACE.y - 1} x2={x} y2={DIG_FACE.y + 7} />
              ))}
            </g>
            <line x1="596" y1={DIG_FACE.y} x2="912" y2={DIG_FACE.y} stroke="#b09070" strokeWidth="2.5" opacity="0.9" />
            <line x1="596" y1={DIG_FACE.y + 6} x2="912" y2={DIG_FACE.y + 6} stroke="#b09070" strokeWidth="2.5" opacity="0.9" />
            <g transform={`translate(690 ${DIG_FACE.y + 2})`}>
              <path d="M -25 -30 L 25 -30 L 19 -7 L -19 -7 Z" fill="#8a8172" stroke="#4a3d2e" strokeWidth="2" />
              <path d="M -23 -30 q 11 -14 23 -3 q 11 -8 18 3 Z" fill="#6d4626" />
              <circle cx="-12" cy="-3" r="6" fill="#4a3d2e" stroke="#c3b49c" strokeWidth="1.8" />
              <circle cx="12" cy="-3" r="6" fill="#4a3d2e" stroke="#c3b49c" strokeWidth="1.8" />
            </g>
          </g>
          <Timber x={DIG_FACE.x - 145} y={DIG_FACE.y - HEADROOM} w={40} h={50} />
          <Timber x={DIG_FACE.x - 85} y={DIG_FACE.y - HEADROOM} w={40} h={50} />
          {/* spoil heap, grows while the crew digs and drops when it's carted off */}
          <g ref={pileRef}>
            <path d="M -48 2 Q -24 -44 4 0 Z" fill="#7a4c28" />
            <path d="M -30 2 Q -6 -32 22 0 Z" fill="#9c6b41" />
            <circle cx="-22" cy="-20" r="3.4" fill="#b5824f" />
            <circle cx="0" cy="-14" r="2.8" fill="#b5824f" />
            <circle cx="10" cy="-4" r="2.2" fill="#b5824f" />
          </g>
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} ref={(el) => void (puffRefs.current[i] = el)} cx="0" cy="0" r="3" fill="#d3ac7d" opacity="0" />
          ))}
          {/* surveyed outline of the room that comes next */}
          <g>
            <path
              d="M 1096 2262 L 1246 2262 L 1246 2402 L 1096 2402"
              fill="none"
              stroke={CREAM}
              strokeWidth="2.5"
              strokeDasharray="10 10"
              opacity="0.42"
            />
            <text x={1171} y={2330} textAnchor="middle" fontSize="17" fill={CREAM} opacity="0.7">
              next chamber
            </text>
            <text x={1171} y={2354} textAnchor="middle" fontSize="13.5" fill={CREAM} opacity="0.45">
              survey pending
            </text>
          </g>
        </g>

        {/* ---------------- bots ---------------- */}
        <g>
          {bots.map((b, i) => (
            <BotSprite key={b.id} idx={i} color={b.color} role={b.role} refs={refs.current} />
          ))}
        </g>

        {/* the deep dark, blending the cutaway into the page below */}
        <rect x="0" y={VIEW.h - 150} width={VIEW.w} height="150" fill="url(#deep)" />
      </svg>

      {hovered && (
        <div
          className="burrow-tip"
          style={{
            left: `${((hovered.cx + (hovered.labelSide === 1 ? hovered.rx + 18 : -hovered.rx - 18)) / VIEW.w) * 100}%`,
            top: `${((hovered.floorY - hovered.domeH * 0.5) / VIEW.h) * 100}%`,
            transform: hovered.labelSide === 1 ? 'translateY(-50%)' : 'translate(-100%, -50%)',
          }}
        >
          <strong>{hovered.title}</strong>
          <span className="tip-meta">
            {hovered.locLabel} lines · {hovered.size}
          </span>
          <span className="tip-sum">{hovered.summary}</span>
          <span className="tip-tech">
            {hovered.tech.map((t) => (
              <em key={t}>{t}</em>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/** Far hill start height — kept as a function so the path reads cleanly. */
function SVGHillY(x: number): number {
  return groundY(x) - 60;
}
