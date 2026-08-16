// The molly screen transform: turns a `sim/swim.ts` state (position, yaw,
// roll, pitch, beat phase) into the numbers `fish-layer.tsx` feeds Skia's
// `Transforms3d`/`Matrix4`. Pulled out of that file as its own pure,
// dependency-free function (no React/RN/Skia) for two reasons: it's exactly
// the kind of math `scripts/aquarium-preview.ts`'s yaw strip needs to
// reproduce off-device (which used to hand-duplicate `EDGE_ON_MIN_WIDTH`/
// `PERSPECTIVE_RATIO` with a "must match fish-layer.tsx" comment — a real
// drift risk, now closed by importing this instead), and it's what
// `scripts/aquarium-design-editor.ts`'s Motion tab bundles for the browser
// so a live swim-tuning preview shows the SAME transform the app draws with,
// not a hand-approximated one.
//
// `"worklet"` — called from inside `fish-layer.tsx`'s `useDerivedValue`
// (UI-thread worklet context), so this needs its own directive the same way
// `sim/swim.ts`'s helpers do; harmless everywhere else (Node, a browser
// bundle) where it's just an inert string.

import { Z_MAX } from "../sim/swim";

/**
 * Minimum on-screen width fraction at edge-on (`yaw = ±π/2`) — a hard floor
 * baked into the perspective matrix, not a yaw clamp. Clamping yaw plateaus
 * visibly; floored width keeps the turn's rotation honest while the
 * silhouette (full dorsal, full caudal fan, the eye) stays readable through
 * the thinnest part of a turn.
 */
export const EDGE_ON_MIN_WIDTH = 0.3;

/**
 * Foreshortening as a ratio of on-screen fish length rather than a bare
 * pixel constant — a fixed `perspective(550)` shrinks with the fish (13%
 * foreshortening pre-2D-V2-scale, 8% at `AQUARIUM_FISH_SCALE`) and stops
 * reading exactly when scale drops. `q = sin(yaw) / (PERSPECTIVE_RATIO *
 * onScreenWidth)` gives ±23% at 90° regardless of render scale, and
 * `|q·x| ≤ 1/(2·RATIO) = 0.227 < 1` keeps `w` from ever crossing zero.
 */
export const PERSPECTIVE_RATIO = 2.2;

/**
 * Render-only screen-space arc during a wall-turn ("update 2d fish v2"
 * plan, Part C): `roll` is already a smoothed, signed, turn-rate-derived
 * commitment to the turn (see `sim/swim.ts`), reused here as an on-screen
 * `translateY` term that turns the old decelerate-pause-reverse cusp at a
 * wall into a rounded hook, without adding parallel state. 30 px/rad:
 * confirmed via `scripts/verify-aquarium.ts`'s swim trace that ~90%+ of
 * actively-turning steps (both current on and off) produce an on-screen arc
 * past the 8px visibility floor. Re-check that trace if this changes, and
 * eyeball `yarn aquarium:preview`'s wall-turn strip for how it actually
 * reads.
 */
export const ARC_GAIN_PX_PER_RAD = 30;

function lerp(a: number, b: number, t: number): number {
  "worklet";
  return a + (b - a) * t;
}

export interface ScreenTransformInput {
  x: number;
  y: number;
  z: number;
  /** Heading in the (x,z) plane, radians — see `sim/swim.ts`. */
  yaw: number;
  /** Smoothed longitudinal roll — a bank into the turn, not a screen-space rotation. */
  roll: number;
  pitch: number;
  beatPhase: number;
  speedNorm: number;
  /** Life-stage/depth-adjusted scale, BEFORE this function's own z-based term. */
  depthScale: number;
  /** The baked texture's local-space width — the `renderScale` this produces feeds back into `q` below, so it must be the SAME width the caller draws the image at. */
  bakedWidth: number;
}

/**
 * The four `Transforms3d` entries `fish-layer.tsx` needs beyond plain
 * `translate`/`scale`: `matrixW`/`matrixCosRoll`/`matrixQ` are the three
 * non-trivial entries of the mirror/foreshorten `Matrix4`
 * `[w,0,0,0, 0,cosRoll,0,0, 0,0,1,0, q,0,0,1]` — kept as separate scalars
 * (not a `Matrix4` type) so this file never has to import Skia's types.
 */
export interface ScreenTransformResult {
  translateX: number;
  translateY: number;
  rotate: number;
  matrixW: number;
  matrixCosRoll: number;
  matrixQ: number;
  scaleX: number;
  scaleY: number;
}

export function screenTransformFor(input: ScreenTransformInput): ScreenTransformResult {
  "worklet";
  const { x, y, z, yaw, roll, pitch, beatPhase, speedNorm, depthScale, bakedWidth } = input;

  const bob = Math.sin(beatPhase) * 1.5 * Math.max(0.3, speedNorm);
  // Small volume cue as the fish steers through depth (z) — kept weak so a
  // back-band fish coming forward never reads as if it should occlude
  // mid-layer decor.
  const zNorm01 = Math.max(0, Math.min(1, z / Z_MAX / 2 + 0.5));
  const renderScale = depthScale * lerp(0.92, 1.08, zNorm01);
  // Pays back the motion the edge-on spine-warp damping removes: broadside
  // the body bends, edge-on it shimmies horizontally instead, and the two
  // cross-fade with |sin yaw|.
  const wobble = 2.5 * Math.abs(Math.sin(yaw)) * Math.sin(beatPhase);
  const arcOffset = roll * ARC_GAIN_PX_PER_RAD;

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Art is nose-left: yaw=0 is heading +x (rightward), which must draw
  // mirrored (nose right), so w<0 there.
  const w = -(c >= 0 ? 1 : -1) * Math.max(Math.abs(c), EDGE_ON_MIN_WIDTH);
  const q = s / (PERSPECTIVE_RATIO * bakedWidth * renderScale);

  return {
    translateX: x + wobble,
    translateY: y + bob + arcOffset,
    rotate: pitch * Math.cos(yaw),
    matrixW: w,
    matrixCosRoll: Math.cos(roll),
    matrixQ: q,
    scaleX: renderScale,
    scaleY: renderScale,
  };
}
