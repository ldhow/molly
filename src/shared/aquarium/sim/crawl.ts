// Surface-bound locomotion: the snail's answer to `sim/swim.ts`.
//
// A snail is not a slow fish. It has no swim bladder and no fins — it is a
// gastropod that GLIDES on its foot, and the only places it can be are the
// substrate, the glass, and whatever decor is rooted in the tank. Steering it
// with `swim.ts`'s free (x, z, y) particle produced a snail hanging in open
// water, which is the one thing a snail never does.
//
// So this module models a completely different thing: a TRACK (an open
// polyline of surfaces the snail is stuck to) and a 1-D position along it.
// The snail cannot leave the track — not "is steered away from open water",
// but has no degree of freedom that points there — which is what makes the
// behaviour correct by construction rather than by tuning.
//
// The track is built with a LEFT-HAND NORMAL convention: walking the polyline
// in increasing `s`, the tank's interior is always to the left of the
// direction of travel. `render/creature-layer.tsx` then only has to place the
// art's sole (local y = 0, see `creatures/snail/anatomy.ts`) at the sampled
// point and rotate by the sampled tangent — down the left glass, across the
// substrate, up a plant stem, over its top and back down the far side all
// fall out of the same two lines of transform, with no per-surface special
// case. Reversing direction flips the sprite (`dir`), never the normal: the
// snail is still on the same side of the same surface.
//
// Every helper carries its own `"worklet"` directive — `react-native-worklets`
// does not auto-workletize same-file helpers (same warning `swim.ts` carries).
//
// Dependency-free beyond `swim-model`'s angle helper: no React/RN/Skia, so
// `scripts/verify-aquarium.ts` can trace it under plain Node.

import { wrapToPi } from "@/shared/lib/swim-model";

/** One straight stretch of crawlable surface, in track order. */
export interface CrawlSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CrawlTrack {
  segs: CrawlSegment[];
  /** Arc length at the START of each segment. */
  cum: number[];
  total: number;
}

/** A decor piece a snail can climb: a stem approximated by its base and its usable top. */
export interface ClimbProp {
  x: number;
  baseY: number;
  topY: number;
}

export interface CrawlBox {
  minX: number;
  maxX: number;
  /** The surface the snail rides along the bottom — the top of the sand, not the canvas bottom. */
  floorY: number;
  /** Highest point the snail may reach on the glass. */
  ceilY: number;
}

/** Chamfer length at the floor/glass corner — a rigid shell pivoting through a hard 90° corner clips into it; two 45° steps read as the snail rounding the join. */
const CORNER = 12;
/** How far to either side of a prop's centre the up and down legs sit, so the climb reads as "on the stem" rather than "inside it". */
const STEM_HALF = 3;

/** Cruise speed in px/s at `speedFactor` 1 — a real snail is glacial, and reading as glacial next to a swimming molly is the whole point. */
export const CRAWL_SPEED = 7.5;
/** Pedal-wave frequency, Hz-ish. Each wave is one muscular surge down the sole. */
const WAVE_FREQ = 1.9;
/** How much of the glide speed the pedal wave modulates — a snail advances in visible pulses, not at a constant rate. */
const SURGE = 0.34;
const SPEED_TAU = 0.7;
/** How fast the rendered heading catches up with the track's tangent. Slow enough that a 90° corner reads as the snail bending around it. */
const ANGLE_TAU = 0.22;

function segLength(s: CrawlSegment): number {
  "worklet";
  return Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
}

function finishTrack(segs: CrawlSegment[]): CrawlTrack {
  "worklet";
  const cum: number[] = [];
  let total = 0;
  for (const s of segs) {
    cum.push(total);
    total += segLength(s);
  }
  return { segs, cum, total };
}

/**
 * The tank-mode track: down the left glass, across the substrate (detouring
 * up and over any prop this snail has picked), and up the right glass.
 *
 * One prop at most, chosen by seed: a snail that visits every plant in the
 * tank on one lap reads as a patrol route, not an animal. Which prop it is
 * stays stable for the life of the individual because it is a pure function
 * of its seed.
 */
export function buildCrawlTrack(box: CrawlBox, seed: number, props: ClimbProp[]): CrawlTrack {
  "worklet";
  const floorY = box.floorY;
  const column = Math.max(0, floorY - box.ceilY);
  // How far up the glass this individual is willing to go.
  const climb = column * (0.3 + ((seed * 7.13) % 1) * 0.45);
  const wallTop = floorY - Math.max(CORNER + 4, climb);
  const left = box.minX;
  const right = box.maxX;

  const segs: CrawlSegment[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number) => {
    if (Math.hypot(x1 - x0, y1 - y0) > 0.5) segs.push({ x0, y0, x1, y1 });
  };

  push(left, wallTop, left, floorY - CORNER);
  push(left, floorY - CORNER, left + CORNER, floorY);

  const usable = props.filter(
    (p) =>
      p.x > left + CORNER * 2 + STEM_HALF &&
      p.x < right - CORNER * 2 - STEM_HALF &&
      p.baseY - p.topY > 24,
  );
  let cursorX = left + CORNER;
  if (usable.length > 0) {
    const prop = usable[Math.floor(((seed * 41.7) % 1) * usable.length) % usable.length];
    // Stop short of the very tip: the top of a plant is a leaf, not a perch.
    const topY = Math.max(box.ceilY, prop.topY + (prop.baseY - prop.topY) * 0.18);
    push(cursorX, floorY, prop.x - STEM_HALF, floorY);
    push(prop.x - STEM_HALF, floorY, prop.x - STEM_HALF, topY); // up the near face
    push(prop.x - STEM_HALF, topY, prop.x + STEM_HALF, topY); // over the top
    push(prop.x + STEM_HALF, topY, prop.x + STEM_HALF, floorY); // down the far face
    cursorX = prop.x + STEM_HALF;
  }

  push(cursorX, floorY, right - CORNER, floorY);
  push(right - CORNER, floorY, right, floorY - CORNER);
  push(right, floorY - CORNER, right, wallTop);

  return finishTrack(segs);
}

/** The `mode="center"` track: one plain ledge across the lower third of the view, since that screen has no tank furniture to crawl on. */
export function buildCenterCrawlTrack(box: CrawlBox): CrawlTrack {
  "worklet";
  return finishTrack([{ x0: box.minX, y0: box.floorY, x1: box.maxX, y1: box.floorY }]);
}

export interface CrawlSample {
  x: number;
  y: number;
  /** Tangent angle of the surface, radians. */
  angle: number;
}

/** Point + tangent angle at arc position `s` (clamped to the track). */
export function sampleTrack(track: CrawlTrack, s: number): CrawlSample {
  "worklet";
  const segs = track.segs;
  if (segs.length === 0) return { x: 0, y: 0, angle: 0 };
  const clamped = Math.min(Math.max(s, 0), track.total);
  let i = segs.length - 1;
  for (let k = 0; k < segs.length; k++) {
    const end = track.cum[k] + segLength(segs[k]);
    if (clamped <= end) {
      i = k;
      break;
    }
  }
  const seg = segs[i];
  const len = segLength(seg) || 1;
  const t = Math.min(1, Math.max(0, (clamped - track.cum[i]) / len));
  return {
    x: seg.x0 + (seg.x1 - seg.x0) * t,
    y: seg.y0 + (seg.y1 - seg.y0) * t,
    angle: Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0),
  };
}

export type CrawlMode = "glide" | "graze";

export interface CrawlState {
  /** Arc position along the track. */
  s: number;
  /** Which way along the track it is heading. Also mirrors the sprite. */
  dir: 1 | -1;
  speed: number;
  mode: CrawlMode;
  modeLeft: number;
  /** Pedal wave — drives both the forward surge and the render-side body pulse. */
  wavePhase: number;
  /** Smoothed heading actually rendered; lags `sampleTrack().angle` through corners. */
  angle: number;
  x: number;
  y: number;
  /** [0,1] fraction of cruise speed, for the render layer's motion cues. */
  speedNorm: number;
  /** Seconds simulated, so the tentacle sway can run off a phase that survives pauses. */
  elapsed: number;
  /** Length of the track this `s` was measured against. A layout change rebuilds the track at a different length, and `stepCrawl` re-seats `s` proportionally when it notices — done HERE rather than from the JS side because mutating the state object off the UI thread would only touch that thread's copy of it. */
  trackTotal: number;
}

export function initCrawlState(track: CrawlTrack, seed: number): CrawlState {
  "worklet";
  const s = ((seed * 13.31) % 1) * track.total;
  const sample = sampleTrack(track, s);
  return {
    s,
    dir: (seed * 5.77) % 1 < 0.5 ? -1 : 1,
    speed: 0,
    mode: "glide",
    modeLeft: 3 + ((seed * 3.19) % 1) * 8,
    wavePhase: ((seed * 11.7) % 1) * Math.PI * 2,
    angle: sample.angle,
    x: sample.x,
    y: sample.y,
    speedNorm: 0,
    elapsed: 0,
    trackTotal: track.total,
  };
}

/**
 * One frame. Pure in `(state, track, dt, speedFactor, rng)` — `rng` is passed
 * in rather than called globally so the headless trace in
 * `scripts/verify-aquarium.ts` can drive it deterministically.
 */
export function stepCrawl(
  state: CrawlState,
  track: CrawlTrack,
  dt: number,
  speedFactor: number,
  rng: () => number,
): void {
  "worklet";
  if (dt <= 0 || track.total <= 0) return;
  if (state.trackTotal !== track.total) {
    const fraction = state.trackTotal > 0 ? state.s / state.trackTotal : 0;
    state.s = fraction * track.total;
    state.trackTotal = track.total;
  }
  const step = Math.min(dt, 0.05); // a backgrounded tab's catch-up frame must not teleport it
  state.elapsed += step;

  state.modeLeft -= step;
  if (state.modeLeft <= 0) {
    if (state.mode === "glide") {
      // Grazing: a snail stops to rasp algae far more often than it moves.
      state.mode = "graze";
      state.modeLeft = 2.5 + rng() * 6;
    } else {
      state.mode = "glide";
      state.modeLeft = 7 + rng() * 14;
      // Turning round mid-surface, not only at the track's ends.
      if (rng() < 0.28) state.dir = state.dir === 1 ? -1 : 1;
    }
  }

  const cruise = CRAWL_SPEED * speedFactor;
  const target = state.mode === "glide" ? cruise : 0;
  state.speed += (target - state.speed) * (1 - Math.exp(-step / SPEED_TAU));
  state.speedNorm = cruise > 0 ? Math.min(1, state.speed / cruise) : 0;

  state.wavePhase += step * WAVE_FREQ * Math.PI * 2 * (0.45 + 0.55 * state.speedNorm);
  if (state.wavePhase > Math.PI * 2) state.wavePhase -= Math.PI * 2;

  const surge = 1 + SURGE * Math.sin(state.wavePhase);
  state.s += state.dir * state.speed * surge * step;

  // The track is open, so its ends are real ends: turn round and take a
  // moment, the way a snail that has run out of glass does.
  if (state.s > track.total) {
    state.s = track.total - (state.s - track.total);
    state.dir = -1;
    state.mode = "graze";
    state.modeLeft = 2 + rng() * 4;
  } else if (state.s < 0) {
    state.s = -state.s;
    state.dir = 1;
    state.mode = "graze";
    state.modeLeft = 2 + rng() * 4;
  }
  state.s = Math.min(Math.max(state.s, 0), track.total);

  const sample = sampleTrack(track, state.s);
  state.x = sample.x;
  state.y = sample.y;
  state.angle += wrapToPi(sample.angle - state.angle) * (1 - Math.exp(-step / ANGLE_TAU));
  state.angle = wrapToPi(state.angle);
}
