import * as THREE from 'three';
import { mulberry32 } from './common';

/**
 * Time-of-day and weather for the archipelago.
 *
 * Everything here is a pure function of the wall clock, so the world looks
 * different at 9am than at 11pm with no stored state at all — a refresh can't
 * reset it, because time doesn't reset. The scene reads this each frame.
 */

/* --------------------------------- clock --------------------------------- */

export interface SkyOverrides {
  /** Force a fixed hour (0..24) instead of the real clock. */
  hour: number | null;
  /** Seconds of real time per simulated day. null = real time (86400). */
  dayLength: number | null;
  /** Force a weather kind instead of the day's roll. */
  weather: WeatherKind | null;
}

const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'snow'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/**
 * Dev/demo overrides from the query string:
 *   ?hour=21.5     freeze at a given hour
 *   ?daylen=120    run a full day every 120s (time-lapse)
 *   ?weather=snow  force weather
 */
export function readSkyOverrides(search: string): SkyOverrides {
  const q = new URLSearchParams(search);
  const num = (key: string) => {
    const raw = q.get(key);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const hour = num('hour');
  const dayLength = num('daylen');
  const w = q.get('weather');
  return {
    hour: hour === null ? null : ((hour % 24) + 24) % 24,
    dayLength: dayLength !== null && dayLength > 1 ? dayLength : null,
    weather: (WEATHER_KINDS as readonly string[]).includes(w ?? '')
      ? (w as WeatherKind)
      : null,
  };
}

/** Local-time hour as a float, e.g. 13.5 for 1:30pm. */
export function hourOfDay(now: Date): number {
  return (
    now.getHours() +
    now.getMinutes() / 60 +
    now.getSeconds() / 3600 +
    now.getMilliseconds() / 3600000
  );
}

/**
 * The hour to render. Honors the overrides; `elapsed` is the scene clock, used
 * only for the time-lapse mode so the sweep is smooth and frame-rate free.
 */
export function currentHour(
  o: SkyOverrides,
  startHour: number,
  elapsed: number
): number {
  if (o.hour !== null) return o.hour;
  if (o.dayLength !== null) {
    return (startHour + (elapsed / o.dayLength) * 24) % 24;
  }
  return hourOfDay(new Date());
}

/* -------------------------------- weather -------------------------------- */

export interface Weather {
  kind: WeatherKind;
  /** 0 = clear sky, 1 = fully overcast. Dims the sun and thickens the clouds. */
  cloudiness: number;
  /** Precipitation strength, 0 when it isn't raining or snowing. */
  fall: number;
}

const CLEAR: Weather = { kind: 'clear', cloudiness: 0.12, fall: 0 };

/**
 * One roll per calendar day, seeded by the day number — so the weather is
 * stable for everyone all day and changes overnight. Snow only in winter.
 */
export function weatherForDay(now: Date, override: WeatherKind | null): Weather {
  const kind = override ?? rollKind(now);
  switch (kind) {
    case 'clear':
      return CLEAR;
    case 'cloudy':
      return { kind, cloudiness: 0.62, fall: 0 };
    case 'rain':
      return { kind, cloudiness: 0.88, fall: 1 };
    case 'snow':
      return { kind, cloudiness: 0.78, fall: 0.75 };
  }
}

function rollKind(now: Date): WeatherKind {
  const day = Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000
  );
  const r = mulberry32(day * 2654435761 + 1013904223)();
  if (r < 0.52) return 'clear';
  if (r < 0.8) return 'cloudy';
  const m = now.getMonth();
  return m === 11 || m === 0 || m === 1 ? 'snow' : 'rain';
}

/* ------------------------------- sky colors ------------------------------- */

interface Keyframe {
  h: number;
  sun: string;
  sunI: number;
  amb: string;
  ambI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  top: string;
  mid: string;
  bottom: string;
  /** 0 = broad daylight, 1 = full dark. Drives lanterns, stars, windows. */
  night: number;
}

/**
 * Colour stops around the clock. Interpolated with wraparound, so 23:00 blends
 * into 01:00. Daylight values match the page's original CSS palette, which is
 * what noon still looks like.
 */
const KEYS: Keyframe[] = [
  {
    h: 0,
    sun: '#b9c6ff', sunI: 0.34,
    amb: '#8b93c4', ambI: 0.3,
    hemiSky: '#2a3465', hemiGround: '#1b2138', hemiI: 0.4,
    top: '#141a3d', mid: '#242c58', bottom: '#3d3763',
    night: 1,
  },
  {
    h: 5,
    sun: '#c3c9f2', sunI: 0.4,
    amb: '#9a97cb', ambI: 0.34,
    hemiSky: '#3a3f72', hemiGround: '#2a2846', hemiI: 0.42,
    top: '#2b3160', mid: '#584b79', bottom: '#b07c8c',
    night: 0.82,
  },
  {
    h: 6.7,
    sun: '#ffb26b', sunI: 1.1,
    amb: '#ffd7bd', ambI: 0.5,
    hemiSky: '#ffc7a6', hemiGround: '#ffdcc0', hemiI: 0.55,
    top: '#7ea6d8', mid: '#f0b28e', bottom: '#ffd9a8',
    night: 0.24,
  },
  {
    h: 8.5,
    sun: '#ffe0b8', sunI: 1.55,
    amb: '#fff1e0', ambI: 0.56,
    hemiSky: '#d2e8f6', hemiGround: '#ffe6cd', hemiI: 0.58,
    top: '#a8d5ef', mid: '#dcecec', bottom: '#fdf0dc',
    night: 0.04,
  },
  {
    h: 12.5,
    sun: '#ffe9cf', sunI: 1.7,
    amb: '#fff6ea', ambI: 0.55,
    hemiSky: '#cfe8f5', hemiGround: '#ffe6c9', hemiI: 0.6,
    top: '#c8e6f5', mid: '#e8f2ee', bottom: '#fdf3e2',
    night: 0,
  },
  {
    h: 16.5,
    sun: '#ffe2bc', sunI: 1.6,
    amb: '#fff0dd', ambI: 0.55,
    hemiSky: '#c6e3f3', hemiGround: '#ffe3c2', hemiI: 0.58,
    top: '#bcdff2', mid: '#eaf0e6', bottom: '#ffeed6',
    night: 0,
  },
  {
    h: 18.9,
    sun: '#ff9d63', sunI: 1.15,
    amb: '#ffcdb0', ambI: 0.5,
    hemiSky: '#f5b393', hemiGround: '#ffd2ae', hemiI: 0.52,
    top: '#6f96cf', mid: '#f0a075', bottom: '#ffcf92',
    night: 0.22,
  },
  {
    h: 20.4,
    sun: '#a98ad8', sunI: 0.6,
    amb: '#9d95cc', ambI: 0.38,
    hemiSky: '#5c5691', hemiGround: '#3a3355', hemiI: 0.45,
    top: '#3a3f74', mid: '#6a5385', bottom: '#bc7d8e',
    night: 0.68,
  },
  {
    h: 22,
    sun: '#b9c6ff', sunI: 0.34,
    amb: '#8b93c4', ambI: 0.3,
    hemiSky: '#2a3465', hemiGround: '#1b2138', hemiI: 0.4,
    top: '#141a3d', mid: '#242c58', bottom: '#3d3763',
    night: 1,
  },
];

/** Live sky values. Mutated in place each frame — never reallocated. */
export interface SkyState {
  hour: number;
  night: number;
  sunI: number;
  ambI: number;
  hemiI: number;
  sun: THREE.Color;
  amb: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  top: THREE.Color;
  mid: THREE.Color;
  bottom: THREE.Color;
  /** Where the key light sits, already scaled to world distance. */
  sunPos: THREE.Vector3;
}

export function makeSkyState(): SkyState {
  return {
    hour: 12,
    night: 0,
    sunI: 1.7,
    ambI: 0.55,
    hemiI: 0.6,
    sun: new THREE.Color(),
    amb: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    top: new THREE.Color(),
    mid: new THREE.Color(),
    bottom: new THREE.Color(),
    sunPos: new THREE.Vector3(8, 13, 6),
  };
}

// Scratch colors so evaluation never allocates.
const cA = new THREE.Color();
const cB = new THREE.Color();
const OVERCAST = new THREE.Color('#9aa3b4');

function lerpInto(
  out: THREE.Color,
  a: string,
  b: string,
  t: number,
  grey: number
): void {
  cA.set(a);
  cB.set(b);
  out.copy(cA).lerp(cB, t);
  if (grey > 0) out.lerp(OVERCAST, grey);
}

/**
 * Fill `out` for the given hour. Cloud cover desaturates the palette toward
 * overcast grey and takes the edge off the key light.
 */
export function evaluateSky(
  out: SkyState,
  hour: number,
  weather: Weather
): SkyState {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].h <= hour) i++;

  const a = KEYS[i];
  // Past the last stop we wrap to the first, treating it as hour 24.
  const wrap = i === KEYS.length - 1;
  const b = wrap ? KEYS[0] : KEYS[i + 1];
  const span = (wrap ? 24 : b.h) - a.h;
  const t = span <= 0 ? 0 : THREE.MathUtils.clamp((hour - a.h) / span, 0, 1);
  const s = t * t * (3 - 2 * t); // smoothstep — no kinks at the stops

  out.hour = hour;
  out.night = THREE.MathUtils.lerp(a.night, b.night, s);

  // Overcast greys the daytime sky but barely touches the night sky, which is
  // already desaturated — otherwise a rainy night turns muddy.
  const grey = weather.cloudiness * 0.55 * (1 - out.night * 0.7);

  lerpInto(out.sun, a.sun, b.sun, s, grey * 0.4);
  lerpInto(out.amb, a.amb, b.amb, s, grey * 0.5);
  lerpInto(out.hemiSky, a.hemiSky, b.hemiSky, s, grey);
  lerpInto(out.hemiGround, a.hemiGround, b.hemiGround, s, grey * 0.6);
  lerpInto(out.top, a.top, b.top, s, grey);
  lerpInto(out.mid, a.mid, b.mid, s, grey * 0.85);
  lerpInto(out.bottom, a.bottom, b.bottom, s, grey * 0.7);

  const dim = 1 - weather.cloudiness * 0.42;
  out.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, s) * dim;
  out.ambI = THREE.MathUtils.lerp(a.ambI, b.ambI, s) * (1 - weather.cloudiness * 0.12);
  out.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, s);

  sunPosition(out.sunPos, hour);
  return out;
}

/**
 * Key light on a continuous 24h circle: due east at 06:00, overhead at noon,
 * due west at 18:00. Elevation is floored so it never rakes flat across the
 * islands — after dusk that floor is what reads as low, cold moonlight, and
 * because only the clamp engages there's no pop as the sun sets.
 */
function sunPosition(out: THREE.Vector3, hour: number): THREE.Vector3 {
  const th = ((hour - 6) / 24) * Math.PI * 2;
  const y = Math.max(Math.sin(th), 0.17);
  return out.set(Math.cos(th), y, 0.5).normalize().multiplyScalar(17);
}
