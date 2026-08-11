// Pure worklet math for fish locomotion — no React/Skia imports so it stays
// callable from the UI-thread frame callback in `use-fish-swim.ts` and, if a
// test runner ever lands, from plain Jest too.
//
// A fish is a continuously-steered particle, not a sequence of stop-and-glide
// hops: it always has a heading and a speed, both eased toward a per-mode
// target, and it only ever slows to a hover-creep — never a dead stop.

import { SWIM_SPEED } from "@/shared/constants/tank";

export interface WanderBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type SwimMode = "cruise" | "glide" | "hover" | "burst";

export interface SwimState {
  x: number;
  y: number;
  /** Travel heading, radians, screen convention (y down). */
  theta: number;
  /** Current speed, px/s. */
  speed: number;
  targetX: number;
  targetY: number;
  mode: SwimMode;
  /** Seconds remaining before the current mode is reconsidered. */
  modeLeft: number;
  facingRight: boolean;
  /** Smoothed pitch, radians. */
  tilt: number;
  /** Smoothed dθ/dt, used for banking into turns. */
  turnRate: number;
  /** Monotonically increasing phase driving tail/body beat. */
  beatPhase: number;
  /** `speed` relative to the cruise baseline, roughly [0, 1.3]. */
  speedNorm: number;
}

const TURN_RATE_CRUISE = 1.6; // rad/s max yaw rate
const TURN_RATE_BURST = 3.2;
const ACCEL_TAU = 0.5; // s, speed low-pass when accelerating
const DECEL_TAU = 1.4; // s, when decelerating
const TILT_TAU = 0.35;
const TURN_RATE_TAU = 0.25;
const WALL_MARGIN_X = 60; // px, soft-wall steering band
const WALL_MARGIN_Y = 40;
const ARRIVE_RADIUS = 26; // px
export const MAX_DT = 0.064; // s — clamps background/frame-drop hitches
const FACING_HYSTERESIS = 0.25; // cos(theta) must cross this to flip facing
const HOVER_JITTER = 20; // px

// Every helper below is called (directly or transitively) from `stepSwim`,
// which runs on the UI-thread worklet runtime. `react-native-worklets` does
// NOT auto-workletize same-file helpers the way older Reanimated did — a
// plain function referenced from a worklet becomes an async "remote function"
// and a synchronous call throws. So each one needs its own `"worklet"`
// directive, not just the entry points.

function lerp(a: number, b: number, t: number): number {
  "worklet";
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.max(lo, Math.min(hi, v));
}

export function wrapToPi(angle: number): number {
  "worklet";
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Exponential low-pass toward `target`, framerate-independent. */
function approach(current: number, target: number, dt: number, tau: number): number {
  "worklet";
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function pickModeDuration(mode: SwimMode, rand: () => number): number {
  "worklet";
  switch (mode) {
    case "cruise":
      return lerp(2.5, 6, rand());
    case "glide":
      return lerp(0.9, 1.8, rand());
    case "hover":
      return lerp(1.2, 3.5, rand());
    case "burst":
      return lerp(0.5, 0.9, rand());
    default:
      return 2;
  }
}

/** Mode transition table — a startle out of a hover, a coast out of a burst. */
function nextMode(mode: SwimMode, rand: () => number): SwimMode {
  "worklet";
  const r = rand();
  switch (mode) {
    case "cruise":
      if (r < 0.3) return "cruise";
      if (r < 0.65) return "glide";
      if (r < 0.9) return "hover";
      return "burst";
    case "glide":
      return r < 0.5 ? "hover" : "cruise";
    case "hover":
      return r < 0.75 ? "cruise" : "burst";
    case "burst":
      return "glide";
    default:
      return "cruise";
  }
}

function targetSpeed(mode: SwimMode, base: number, beatPhase: number, seedPhase: number): number {
  "worklet";
  switch (mode) {
    case "cruise":
      return base * (0.75 + 0.35 * Math.sin(beatPhase * 0.11 + seedPhase));
    case "glide":
      return base * 0.35;
    case "hover":
      return base * 0.12;
    case "burst":
      return base * 2.2;
    default:
      return base;
  }
}

function retarget(
  s: SwimState,
  box: WanderBox,
  rand: () => number,
  nextModeOverride?: SwimMode,
): void {
  "worklet";
  const mode = nextModeOverride ?? nextMode(s.mode, rand);
  s.mode = mode;
  s.modeLeft = pickModeDuration(mode, rand);
  if (mode === "hover") {
    s.targetX = clamp(s.x + (rand() - 0.5) * HOVER_JITTER * 2, box.minX, box.maxX);
    s.targetY = clamp(s.y + (rand() - 0.5) * HOVER_JITTER * 2, box.minY, box.maxY);
  } else {
    s.targetX = lerp(box.minX, box.maxX, rand());
    s.targetY = lerp(box.minY, box.maxY, rand());
  }
}

export function initSwimState(box: WanderBox, seed: number): SwimState {
  const x = lerp(box.minX, box.maxX, seed);
  const y = lerp(box.minY, box.maxY, (seed * 7.13) % 1);
  const facingRight = seed <= 0.5;
  return {
    x,
    y,
    theta: facingRight ? 0 : Math.PI,
    speed: 0,
    targetX: x,
    targetY: y,
    mode: "cruise",
    modeLeft: 0,
    facingRight,
    tilt: 0,
    turnRate: 0,
    beatPhase: seed * Math.PI * 2,
    speedNorm: 0,
  };
}

/**
 * Advance `s` in place by `dt` seconds. `rand` is injectable for future tests;
 * production callers pass `Math.random`, which is available on the UI thread.
 */
export function stepSwim(
  s: SwimState,
  box: WanderBox,
  dt: number,
  speedFactor: number,
  seedPhase: number,
  rand: () => number,
): void {
  "worklet";
  dt = Math.min(dt, MAX_DT);
  if (box.maxX <= box.minX || box.maxY <= box.minY) return;

  // Desired heading toward the target, biased away from the tank edges.
  let thetaD = Math.atan2(s.targetY - s.y, s.targetX - s.x);
  const qx = Math.max(
    1 - (s.x - box.minX) / WALL_MARGIN_X,
    1 - (box.maxX - s.x) / WALL_MARGIN_X,
    0,
  );
  const qy = Math.max(
    1 - (s.y - box.minY) / WALL_MARGIN_Y,
    1 - (box.maxY - s.y) / WALL_MARGIN_Y,
    0,
  );
  const q = Math.max(qx, qy);
  if (q > 0) {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const inward = Math.atan2(cy - s.y, cx - s.x);
    const w = q * q * 0.85;
    const sinB = Math.sin(thetaD) * (1 - w) + Math.sin(inward) * w;
    const cosB = Math.cos(thetaD) * (1 - w) + Math.cos(inward) * w;
    thetaD = Math.atan2(sinB, cosB);
  }

  // Turn-rate-limited yaw toward the desired heading.
  const omega = s.mode === "burst" ? TURN_RATE_BURST : TURN_RATE_CRUISE;
  const e = wrapToPi(thetaD - s.theta);
  const dTheta = clamp(e, -omega * dt, omega * dt);
  s.theta = wrapToPi(s.theta + dTheta);
  s.turnRate = approach(s.turnRate, dTheta / dt, dt, TURN_RATE_TAU);

  // Speed eases toward a per-mode target.
  const base = SWIM_SPEED * speedFactor;
  const target = targetSpeed(s.mode, base, s.beatPhase, seedPhase);
  const tau = target > s.speed ? ACCEL_TAU : DECEL_TAU;
  s.speed = approach(s.speed, target, dt, tau);

  // Integrate position, then hard-clamp as a backstop against the soft walls.
  const vx = Math.cos(s.theta) * s.speed;
  const vy = Math.sin(s.theta) * s.speed;
  s.x = clamp(s.x + vx * dt, box.minX, box.maxX);
  s.y = clamp(s.y + vy * dt, box.minY, box.maxY);

  // Pitch toward the direction of travel; decays to level in a hover.
  const f = s.facingRight ? 1 : -1;
  const tiltTarget =
    s.mode === "hover" ? 0 : clamp(f * Math.atan2(vy, Math.abs(vx) + 4) * 0.85, -0.5, 0.5);
  s.tilt = approach(s.tilt, tiltTarget, dt, TILT_TAU);

  // Facing flips only once travel is clearly committed to the new side, so a
  // near-vertical heading doesn't thrash the mirror back and forth.
  const c = Math.cos(s.theta);
  if (s.facingRight && c < -FACING_HYSTERESIS) s.facingRight = false;
  else if (!s.facingRight && c > FACING_HYSTERESIS) s.facingRight = true;

  // Retarget on arrival or mode expiry.
  s.modeLeft -= dt;
  const dist = Math.hypot(s.targetX - s.x, s.targetY - s.y);
  if (dist < ARRIVE_RADIUS || s.modeLeft <= 0) {
    retarget(s, box, rand);
  }

  // Beat frequency scales with how hard the fish is swimming relative to its
  // own cruise baseline, so a burst beats fast and a hover barely stirs — and
  // because this only ever changes the *rate* of a running phase, frequency
  // changes never pop the phase that drives tail/body animation.
  s.speedNorm = clamp(s.speed / (base * 1.3), 0, 1.3);
  const beatHz = 0.8 + 2.0 * s.speedNorm;
  s.beatPhase += Math.PI * 2 * beatHz * dt;
}

/**
 * Vertical displacement of the traveling body wave at normalized position `u`
 * (0 = nose, 1 = tail tip) — the single source of truth shared by the body
 * mesh and the tail rotation so the seam between them can never drift apart.
 * `speedNorm` is `speed / (base * 1.3)`, i.e. roughly [0, 1.3].
 */
export function waveDy(u: number, beatPhase: number, speedNorm: number, phase: number): number {
  "worklet";
  const amp = 1.1 + 2.6 * Math.min(1, speedNorm);
  const envelope = 0.08 + 0.92 * u * u;
  return amp * envelope * Math.sin(beatPhase - 4.8 * u + phase);
}
