// A fish that turns by moving through depth, not by flipping. The shared
// `@/shared/lib/swim-model.ts` (also used by the 3D renderer — never
// modified here) steers a particle in a screen-space (x, y) plane and
// signals "which way to face" with a single `facingRight` boolean, which
// `use-fish-swim.ts` renders as either a mirror or a timed 420ms flip
// through a `rotateY` sweep. That's what reads as "lật lại" (flipping over).
//
// This module steers the SAME kind of continuously-turn-rate-limited
// particle, but in a horizontal (x, z) plane — x is screen-horizontal, z is
// depth (toward/away from the glass) — plus a separately-damped vertical y.
// `yaw = atan2(dz, dx)` is a real heading, not a binary: a U-turn is a
// turn-rate-limited arc through yaw values near ±π/2 (edge-on to the
// viewer), the same way it would be for a fish actually swimming in three
// dimensions. `render/fish-layer.tsx` turns `yaw` into a screen transform
// via a hand-built matrix — see that file for why a plain `rotateY` isn't
// enough (the edge-on width floor has to live IN the matrix).
//
// `z` is a STEERING variable only, never a rendering one: the existing
// static per-fish `depth` (in `aquarium-canvas.tsx`) still owns which
// scenery band a fish draws in, since re-banding per frame would mean
// re-rendering the React tree. `z` only weakly feeds scale/opacity in
// fish-layer.tsx. Without `z`, `yawDesired` degenerates to a binary
// (`targetX > x ? 0 : π`) and every turn looks identical — `z` is what
// gives yaw something real to steer toward, and it's boxed at ±Z_MAX so a
// fish never drifts to infinite depth.
//
// Every helper needs its own `"worklet"` directive — `react-native-worklets`
// does not auto-workletize same-file helpers (the same warning
// `swim-model.ts` itself carries).

import { SWIM_SPEED } from "@/shared/constants/tank";
import { wrapToPi, type SwimMode } from "@/shared/lib/swim-model";

export interface V2WanderBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface V2SwimState {
  x: number;
  y: number;
  z: number;
  /** Heading in the (x,z) plane, radians. 0 = +x (screen-right), ±π/2 = edge-on, π = -x (screen-left). */
  yaw: number;
  /** Speed in the (x,z) plane, px/s. */
  speed: number;
  pitch: number;
  /** Smoothed longitudinal roll — a genuine bank into the turn, not a pitch (see fish-layer.tsx). */
  roll: number;
  turnRate: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  mode: SwimMode;
  modeLeft: number;
  beatPhase: number;
  speedNorm: number;
  /**
   * Seconds this individual has been simulated. Every fish steps on the same
   * frame callback with the same `dt`, so this converges to the same value
   * across the whole tank without threading an external clock through the
   * worklet — which is what lets the shared current below be genuinely
   * SHARED (all fish feel the same swell at the same moment) while
   * `stepV2Swim` stays a pure function of its own state.
   */
  elapsed: number;
}

const Z_MAX = 70; // px, symmetric depth range a fish steers within
const TURN_RATE_MIN = 1.5; // rad/s — slower than the shared model's 1.6: a leisurely arc, not a snap turn
const TURN_RATE_MAX_WALL = 2.6; // ramped up near a wall so the escape doesn't take 4s
const TURN_RATE_BURST = 3.0;
// Raised from 0.5: a faster accel tau read as a sudden jolt whenever a mode
// change (esp. into "burst") kicked `target` up — requested directly ("no
// bơi nhanh đột ngột" / don't swim suddenly fast). 0.9 makes every speed
// change, not just burst's own lowered multiplier below, ramp in gradually.
const ACCEL_TAU = 0.9;
const DECEL_TAU = 1.4;
const PITCH_TAU = 0.35;
const ROLL_TAU = 0.3;
const TURN_RATE_TAU = 0.25;
const Y_TAU = 1.1;
const WALL_MARGIN_X = 60;
const WALL_MARGIN_Z = 30;
const ARRIVE_RADIUS = 26;
const HOVER_JITTER = 20;
/**
 * Max vertical offset (px) a fresh non-hover target picks from the fish's
 * CURRENT y, replacing a full `lerp(minY, maxY, rand())` across the whole
 * wander box — requested directly ("hạn chế cá bơi lên xuống" / limit fish
 * swimming up and down). Horizontal wandering (`targetX`) is intentionally
 * untouched — this only narrows how far one retarget can move the fish
 * vertically, not how much of the tank it can explore over time.
 */
const VERTICAL_WANDER = 50;
export const MAX_DT = 0.064;

/**
 * Banking gain/ceiling ("update 2d fish v2" plan, Part C). The previous
 * `turnRate * 0.16` clamped at 0.3 rad topped out at `cos(0.3) ≈ 0.955` — a
 * 4.5% squash under `render/fish-layer.tsx`'s `Math.cos(roll)` scale term,
 * effectively invisible. `roll` only ever feeds that scale (never a
 * rotation), so widening it carries no flip risk. `ROLL_GAIN` is tuned so a
 * sustained wall-turn (`turnRate` approaching `TURN_RATE_MAX_WALL`) reaches
 * `ROLL_MAX`, giving `cos(0.65) ≈ 0.796` — a ~20% squash, in the project's
 * own `skia-aquarium` skill's ~20-30% guidance for banking into a turn.
 */
const ROLL_GAIN = 0.25;
const ROLL_MAX = 0.65;

/**
 * How much a sustained hard turn cuts speed, as a fraction of the current
 * target ("update 2d fish v2" plan, Part C — the project's own
 * `skia-aquarium` skill: "Turns cost speed... reduce speed when turning
 * hard"). 0.35 (the skill suggests up to ~0.55), ramped from `TURN_RATE_MIN`
 * rather than from 0 (see the ramp below) — confirmed via
 * `scripts/verify-aquarium.ts`'s swim trace that `meanAbsVx` clears the
 * cruise floor at this value (~26px/s vs a ~25px/s floor, current on or
 * off). The FIRST version of this ramp started at turnRate=0 instead and
 * measured a ~38% mean-speed drop — `omega` is already `TURN_RATE_MIN` even
 * during ordinary no-wall retargeting, so that version penalized nearly
 * every heading correction, not just hard wall-turns. Raise cautiously and
 * re-check that trace, not just the turn's visual weight.
 */
const TURN_SPEED_PENALTY_MAX = 0.35;

/**
 * Pulls the fish's heading toward whichever of "facing screen-right" (yaw 0)
 * or "facing screen-left" (yaw π) is nearer, so it mostly presents its
 * flank — the art is the point, in a cozy tank. Dropped to 0 while wall-
 * avoiding, where facing the glass IS the good behaviour.
 */
const BROADSIDE_BIAS = 0.6;

/**
 * Shared tank current: a slow horizontal drift that CARRIES every fish,
 * reversing on a ~42s cycle (freq 0.15 rad/s).
 *
 * This deliberately advects position and does NOT bias heading. An earlier
 * draft blended `yawDesired` toward the flow direction instead, and it
 * measurably made the tank LESS coherent, not more (heading coherence
 * 0.281 -> 0.260 over a 90s 12-fish probe): re-aiming every fish the same
 * way marches them all into the same wall, where wall-avoidance — which
 * necessarily overrides the current — then scatters them. Advection has
 * none of that failure mode, because it leaves each fish's own steering
 * completely untouched and simply moves the water they're swimming in,
 * which is also what a current physically is.
 */
const CURRENT_FREQ = 0.15;
/** Peak drift in px/s at `currentStrength = 1`. Half a cycle at this speed sways the tank ~80px and back — a visible breath, not a conveyor belt. */
const CURRENT_DRIFT_MAX = 12;

function lerp(a: number, b: number, t: number): number {
  "worklet";
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.max(lo, Math.min(hi, v));
}

function approach(current: number, target: number, dt: number, tau: number): number {
  "worklet";
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Blends two angles as unit vectors (never averages raw radians — they wrap at ±π). */
function blendAngles(a: number, b: number, t: number): number {
  "worklet";
  const sinB = Math.sin(a) * (1 - t) + Math.sin(b) * t;
  const cosB = Math.cos(a) * (1 - t) + Math.cos(b) * t;
  return Math.atan2(sinB, cosB);
}

function pickModeDuration(mode: SwimMode, rand: () => number): number {
  "worklet";
  switch (mode) {
    case "cruise":
      return lerp(10, 18, rand());
    // Longer glides and hovers than the shared model — "slow, rewarding",
    // watching a fish drift rather than dart from spot to spot.
    case "glide":
      return lerp(8, 14, rand());
    case "hover":
      return lerp(3, 6, rand());
    case "burst":
      return lerp(0.5, 0.9, rand());
    default:
      return 2;
  }
}

/** Same shape as the shared model's transition table, with burst halved both ways — a rarer dart, not a rarer swim. */
function nextMode(mode: SwimMode, rand: () => number): SwimMode {
  "worklet";
  const r = rand();
  switch (mode) {
    case "cruise":
      if (r < 0.35) return "cruise";
      if (r < 0.75) return "glide";
      if (r < 0.95) return "hover";
      return "burst";
    case "glide":
      return r < 0.5 ? "hover" : "cruise";
    case "hover":
      return r < 0.875 ? "cruise" : "burst";
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
    // Lowered from 2.2x: paired with the raised ACCEL_TAU above, a burst
    // now reads as "a bit quicker" rather than a sudden dash.
    case "burst":
      return base * 2.2;
    default:
      return base;
  }
}

function retarget(
  s: V2SwimState,
  box: V2WanderBox,
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
    s.targetZ = clamp(s.z + (rand() - 0.5) * HOVER_JITTER * 2, -Z_MAX, Z_MAX);
  } else {
    s.targetX = lerp(box.minX, box.maxX, rand());
    // Jittered around the CURRENT y (like hover, just a wider band), not a
    // fresh `lerp(minY, maxY, rand())` — see VERTICAL_WANDER's doc comment.
    // X keeps roaming the full box; only vertical excursions are capped.
    s.targetY = clamp(s.y + (rand() - 0.5) * VERTICAL_WANDER * 2, box.minY, box.maxY);
    s.targetZ = lerp(-Z_MAX, Z_MAX, rand());
  }
}

/**
 * The shared current's signed strength at `tSeconds`, in [-1, 1]. Exported
 * so decor sway (`render/scene-layers.tsx`) can lean on the EXACT signal the
 * fish are advected by — one definition of the flow, so the plants and the
 * fish can never drift out of phase with each other, which is the whole
 * point of the tank reading as one body of water.
 */
export function currentAt(tSeconds: number): number {
  "worklet";
  return Math.sin(tSeconds * CURRENT_FREQ);
}

export function initV2SwimState(box: V2WanderBox, seed: number): V2SwimState {
  const x = lerp(box.minX, box.maxX, seed);
  const y = lerp(box.minY, box.maxY, (seed * 7.13) % 1);
  const z = lerp(-Z_MAX, Z_MAX, (seed * 3.71) % 1);
  const yaw = seed <= 0.5 ? 0 : Math.PI;
  return {
    x,
    y,
    z,
    yaw,
    speed: 0,
    pitch: 0,
    roll: 0,
    turnRate: 0,
    targetX: x,
    targetY: y,
    targetZ: z,
    mode: "cruise",
    modeLeft: 0,
    beatPhase: seed * Math.PI * 2,
    speedNorm: 0,
    // Deliberately NOT seed-offset: the whole point of the shared current is
    // that every fish is at the same point in the swell at the same instant.
    elapsed: 0,
  };
}

/**
 * Advance `s` in place by `dt` seconds. `rand` is injectable (see the
 * headless swim trace in `verify-aquarium.ts`); production callers pass
 * `Math.random`.
 *
 * `currentStrength` (0 = off, the default) is how strongly the shared tank
 * current nudges this individual's heading — see `CURRENT_FREQ`. Defaulted
 * off so `render/creature-layer.tsx`'s five species keep their existing
 * motion byte-for-byte; only `render/fish-layer.tsx` (molly) opts in.
 */
export function stepV2Swim(
  s: V2SwimState,
  box: V2WanderBox,
  dt: number,
  speedFactor: number,
  seedPhase: number,
  rand: () => number,
  currentStrength: number = 0,
): void {
  "worklet";
  dt = Math.min(dt, MAX_DT);
  if (box.maxX <= box.minX || box.maxY <= box.minY) return;
  s.elapsed += dt;

  // Desired heading toward the target, in the (x,z) plane.
  let yawToTarget = Math.atan2(s.targetZ - s.z, s.targetX - s.x);

  // Wall proximity in x (screen bounds) and z (the ±Z_MAX depth box) — same
  // "worse of the two axes" blend the shared model uses for x/y, applied to
  // x/z here.
  const qx = Math.max(
    1 - (s.x - box.minX) / WALL_MARGIN_X,
    1 - (box.maxX - s.x) / WALL_MARGIN_X,
    0,
  );
  const qz = Math.max(1 - (s.z + Z_MAX) / WALL_MARGIN_Z, 1 - (Z_MAX - s.z) / WALL_MARGIN_Z, 0);
  const q = Math.max(qx, qz);

  // Hover-jitter freeze: a near-zero target vector makes atan2 noisy and
  // spins the fish in place. Hold the last steered heading instead of
  // chasing it.
  const nearTarget = Math.hypot(s.targetX - s.x, s.targetZ - s.z) < 30;
  let yawDesired = nearTarget ? s.yaw : yawToTarget;

  if (q > 0) {
    const cx = (box.minX + box.maxX) / 2;
    const inward = Math.atan2(0 - s.z, cx - s.x);
    const w = q * q * 0.85;
    yawDesired = blendAngles(yawDesired, inward, w);
  } else if (!nearTarget) {
    // Broadside bias — only while clear of the walls; at a wall, facing the
    // glass to turn around IS the good behaviour, so the bias would fight it.
    const broadsideTarget = Math.abs(wrapToPi(yawToTarget)) < Math.PI / 2 ? 0 : Math.PI;
    yawDesired = blendAngles(yawDesired, broadsideTarget, BROADSIDE_BIAS);
  }

  const omega = s.mode === "burst" ? TURN_RATE_BURST : lerp(TURN_RATE_MIN, TURN_RATE_MAX_WALL, q);
  const e = wrapToPi(yawDesired - s.yaw);
  const dYaw = clamp(e, -omega * dt, omega * dt);
  s.yaw = wrapToPi(s.yaw + dYaw);
  s.turnRate = approach(s.turnRate, dYaw / dt, dt, TURN_RATE_TAU);

  const base = SWIM_SPEED * speedFactor;
  const target = targetSpeed(s.mode, base, s.beatPhase, seedPhase);
  const tau = target > s.speed ? ACCEL_TAU : DECEL_TAU;
  s.speed = approach(s.speed, target, dt, tau);
  // Applied AFTER the approach (not folded into `target` before it):
  // `turnRate` is smoothed at `TURN_RATE_TAU` (0.25s), much faster than
  // `DECEL_TAU` (1.4s) — folding the penalty into the pre-approach target
  // would desync the speed dip from the visible turn by over a second.
  //
  // Ramped from TURN_RATE_MIN, not from 0: `omega` itself is already
  // TURN_RATE_MIN even during ordinary, no-wall retargeting (`lerp` at
  // q=0), so a ratio against TURN_RATE_MAX_WALL starting at turnRate=0 fired
  // on nearly every heading correction, not just hard wall-turns — measured
  // via `scripts/verify-aquarium.ts`'s swim trace as an ~38% mean-speed
  // drop against the existing cruise-floor check. Ramping from the baseline
  // cruise-turn rate instead means routine steering pays nothing and only
  // turning HARDER than that costs speed, matching the intent ("turns cost
  // speed... when turning hard").
  const turnPenalty =
    clamp((Math.abs(s.turnRate) - TURN_RATE_MIN) / (TURN_RATE_MAX_WALL - TURN_RATE_MIN), 0, 1) *
    TURN_SPEED_PENALTY_MAX;
  s.speed *= 1 - turnPenalty;

  const vx = Math.cos(s.yaw) * s.speed;
  const vz = Math.sin(s.yaw) * s.speed;
  // Shared current advects the whole tank together (see CURRENT_FREQ). Faded
  // by `(1 - q)` near a wall so the flow can't hold a fish pinned against
  // the glass while its own steering is trying to escape.
  //
  // `targetX` is carried by the same drift, and that is load-bearing, not
  // tidiness: the steering loop is a position controller that re-aims at
  // `targetX` every frame, so advecting the fish WITHOUT its goal makes the
  // fish swim against the flow and cancel it — measured at -20% collective
  // motion vs. no current at all. Moving the goal with the water means the
  // fish is carried rather than displaced, which is the actual physics and
  // the only version that reads.
  const drift =
    currentStrength > 0
      ? currentStrength * CURRENT_DRIFT_MAX * Math.sin(s.elapsed * CURRENT_FREQ) * (1 - q)
      : 0;
  const dx = drift * dt;
  s.x = clamp(s.x + vx * dt + dx, box.minX, box.maxX);
  if (dx !== 0) s.targetX = clamp(s.targetX + dx, box.minX, box.maxX);
  s.z = clamp(s.z + vz * dt, -Z_MAX, Z_MAX);

  // Vertical motion is a separate damped approach, not part of the (x,z)
  // heading — there's no reason a fish's up/down drift should be coupled to
  // which way it's facing.
  s.y = clamp(approach(s.y, s.targetY, dt, Y_TAU), box.minY, box.maxY);

  // Pitch from vertical speed relative to horizontal-plane speed — `s.speed`
  // legitimately reaches ~0 at times now (a fish paused mid-turn), so this
  // reads off the speed magnitude, not `vx` alone the way the shared model's
  // screen-space version does.
  const dy = clamp(s.targetY - s.y, -40, 40);
  const pitchTarget = s.mode === "hover" ? 0 : clamp((dy / (s.speed + 20)) * 0.6, -0.5, 0.5);
  s.pitch = approach(s.pitch, pitchTarget, dt, PITCH_TAU);

  // Roll — a genuine bank into the turn (see fish-layer.tsx's matrix, where
  // this collapses to a vertical squash under the perspective projection),
  // not a screen-space Z rotation. Also drives the turn's on-screen arc and
  // body-bend in fish-layer.tsx/spine.ts — see ROLL_GAIN's doc comment.
  const rollTarget = clamp(s.turnRate * ROLL_GAIN, -ROLL_MAX, ROLL_MAX);
  s.roll = approach(s.roll, rollTarget, dt, ROLL_TAU);

  s.modeLeft -= dt;
  const dist = Math.hypot(s.targetX - s.x, s.targetZ - s.z);
  if (dist < ARRIVE_RADIUS || s.modeLeft <= 0) {
    retarget(s, box, rand);
  }

  // Never fully still: floored so the spine warp keeps a faint breathing
  // motion even at rest, instead of a hover reading as "paused".
  s.speedNorm = Math.max(0.12, clamp(s.speed / (base * 1.3), 0, 1.3));
  const beatHz = 0.8 + 2.0 * s.speedNorm;
  s.beatPhase += Math.PI * 2 * beatHz * dt;
}

export { Z_MAX };
