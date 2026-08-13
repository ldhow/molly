// The swim bend: a RIGID normal-offset warp of the baked fish texture, so the
// whole body/fin/tail silhouette bends as one piece instead of the old
// pipeline's y-only shear (which keeps cross-sections vertical and reads as
// jelly, not a swimming fish).
//
// Model, in the fish's own baked-image local space (x = along the body,
// y = across it, spine at y=0): a lateral spine displacement
//   d(x) = A(u) * sin(phase - K*u),  u = (x - boundsX) / boundsWidth
// with a tail-weighted amplitude envelope A(u) — reusing the exact envelope
// shape `swim-model.ts`'s `waveDy` already uses (`0.08 + 0.92*u*u`), so this
// keeps the same "barely moves at the head, swings at the tail" character an
// already-tuned system has. `s = d'(x)` is the local slope; the forward map
// offsets each point along the curve's normal instead of straight down, so
// cross-sections stay rigid and the SILHOUETTE bends with the fill (warping
// the texture, alpha included, not just translating a quad).
//
// `forwardWarp`/`inverseWarp` here are the reference implementation —
// `core/sksl/warp.ts` re-derives the identical formulas in SkSL from the same
// constants, and `scripts/verify-aquarium.ts` checks the two agree.
//
// Dependency-free: no React/RN/Skia.

export interface SpineParams {
  boundsX: number;
  boundsWidth: number;
  ampScale: number;
  k: number;
  phase: number;
}

/**
 * Amplitude range, idle -> full speed (`ampScale = lerp(MIN, MAX, speedNorm)`).
 *
 * `scripts/verify-aquarium.ts` sweeps a full beat (24 phases) against the
 * REAL bake bounds for every trait combination and asserts the injectivity
 * budget stays under `INJECTIVITY_BUDGET_MAX` (0.65 as of the original-
 * silhouette redesign; fold happens at 1.0 — see that constant's own doc
 * comment for the measured worst case per body). An earlier version of that
 * check used a guessed `nMax` and a single phase, which under-reported the
 * true worst case by roughly 2x — don't trust a number that isn't measured
 * against real bake bounds. Don't raise MAX without re-running that check.
 */
export const SPINE_AMP_MIN = 2.5;
export const SPINE_AMP_MAX = 7;

/**
 * Draw-rect padding: the largest extra displacement the wave can add beyond
 * a point's unwarped position, at `SPINE_AMP_MAX`, plus a small margin.
 * `<ImageShader tx="decal" ty="decal">` needs the destination rect to fully
 * contain the forward image of the bake bounds or the edge row smears across
 * the padded region — this is what prevents that. 22 (not 18) because the
 * original-silhouette redesign's deeper `balloon` body pushes max
 * displacement to ~18.7px — measured via `verify-aquarium.ts`'s sweep, not
 * guessed; re-measure before changing body/fin proportions again.
 */
export const SPINE_PAD = 22;

/** Wave number — matches `swim-model.ts`'s `waveDy` for a familiar swim feel. */
export const SPINE_K = 4.8;

/** `A(u)` at its peak (u=1, the tail) is exactly `ampScale`; `envelope(0) = 0.08`. */
function envelope(u: number): number {
  return 0.08 + 0.92 * u * u;
}
function envelopeD(u: number): number {
  return 1.84 * u;
}
const ENVELOPE_DD = 1.84;

function uOf(x: number, p: SpineParams): number {
  return (x - p.boundsX) / p.boundsWidth;
}

/** `d(x)`, `d'(x)`, `d''(x)` at once — every caller needs at least the first two. */
function spineAt(x: number, p: SpineParams): { d: number; dx: number; dxx: number } {
  const u = uOf(x, p);
  const invBw = 1 / p.boundsWidth;
  const A = p.ampScale * envelope(u);
  const Ad = p.ampScale * envelopeD(u);
  const Add = p.ampScale * ENVELOPE_DD;
  const angle = p.phase - p.k * u;
  const s = Math.sin(angle);
  const c = Math.cos(angle);

  const d = A * s;
  // d/du [A(u) sin(phase - k u)] = A'(u) sin - k A(u) cos
  const dgdu = Ad * s - p.k * A * c;
  // d2/du2 [...] = A''(u) sin - 2k A'(u) cos - k^2 A(u) sin
  const d2gdu2 = Add * s - 2 * p.k * Ad * c - p.k * p.k * A * s;

  return { d, dx: dgdu * invBw, dxx: d2gdu2 * invBw * invBw };
}

/** Rigid normal-offset forward map: local point `(x, n)` -> warped `(x', y')`. */
export function forwardWarp(x: number, n: number, p: SpineParams): { x: number; y: number } {
  const { d, dx: s } = spineAt(x, p);
  const norm = 1 / Math.sqrt(1 + s * s);
  return { x: x - n * s * norm, y: d + n * norm };
}

/**
 * Closest-point inverse: warped `(qx, qy)` -> source local point `(x, n)`.
 * Two fixed Newton iterations from `x0 = qx` — the plan's exact recipe;
 * converges tightly at the slopes this amplitude range produces (see
 * `spineInjectivityBudget`). No convergence check, so this is exactly what
 * the shader (no dynamic loop bounds) can also do.
 */
export function inverseWarp(qx: number, qy: number, p: SpineParams): { x: number; n: number } {
  let x = qx;
  for (let i = 0; i < 2; i++) {
    const { d, dx: s, dxx: sPrime } = spineAt(x, p);
    const dy = qy - d;
    const g = qx - x + s * dy;
    const gp = -1 - s * s + sPrime * dy;
    x = x - g / gp;
  }
  const { d, dx: s } = spineAt(x, p);
  const dy = qy - d;
  const norm = 1 / Math.sqrt(1 + s * s);
  const n = (dy - s * (qx - x)) * norm;
  return { x, n };
}

/**
 * Pointwise injectivity budget: the normal-offset map folds where
 * `|n| >= 1/curvature`. Returns the worst-case `curvature(u) * nMax` ratio
 * across the sampled domain — keep it well under 1 (the plan's 4x-safety
 * target is 0.25) or the warp will visibly pinch.
 */
export function spineInjectivityBudget(p: SpineParams, nMax: number, samples = 200): number {
  let worst = 0;
  for (let i = 0; i <= samples; i++) {
    const x = p.boundsX + (p.boundsWidth * i) / samples;
    const { dx: s, dxx: sPrime } = spineAt(x, p);
    const curvature = Math.abs(sPrime) / Math.pow(1 + s * s, 1.5);
    worst = Math.max(worst, curvature * nMax);
  }
  return worst;
}

/**
 * How far the forward map can push a point beyond the source bounds, so the
 * caller can pad the draw rect enough that `tx="decal" ty="decal"` never
 * samples (and smears) the image edge. Sweeps `x` across the bounds and `n`
 * across `[-nMax, nMax]`, plus a full beat of `phase`.
 */
export function spineMaxDisplacement(
  boundsX: number,
  boundsWidth: number,
  ampScale: number,
  nMax: number,
  samples = 60,
): number {
  let maxAbs = 0;
  for (let pi = 0; pi < 24; pi++) {
    const phase = (pi / 24) * Math.PI * 2;
    const p: SpineParams = { boundsX, boundsWidth, ampScale, k: SPINE_K, phase };
    for (let i = 0; i <= samples; i++) {
      const x = boundsX + (boundsWidth * i) / samples;
      for (const n of [-nMax, -nMax / 2, 0, nMax / 2, nMax]) {
        const { x: wx, y: wy } = forwardWarp(x, n, p);
        // Compare against the IDENTITY map (ampScale=0 forwardWarp(x,n,.) === (x,n)
        // exactly), not against forwardWarp(x,0,.) — the earlier version of this
        // function conflated "how far the wave moves a point" with "how far n
        // itself already sits from the spine", which overstated the pad by ~7x.
        maxAbs = Math.max(maxAbs, Math.abs(wx - x), Math.abs(wy - n));
      }
    }
  }
  return maxAbs;
}
