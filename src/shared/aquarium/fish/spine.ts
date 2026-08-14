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
  /**
   * Static (non-oscillating) turn-bend term — a `u²`-weighted lateral
   * offset (zero at the nose, growing quadratically toward the tail,
   * tail-weighted in the same spirit as the base wave's envelope though not
   * the identical curve) added to `d(x)` so the body visibly arcs into a
   * wall-turn (see `sim/swim.ts`'s `roll` and `render/fish-layer.tsx`).
   * Optional; defaults to 0 (no bend) so every existing caller that doesn't
   * know about turning stays untouched.
   */
  bendAmp?: number;
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
 * the padded region — this is what prevents that. Originally 22 (not 18)
 * because the original-silhouette redesign's deeper `balloon` body pushes
 * max displacement to ~18.7px — measured via `verify-aquarium.ts`'s sweep,
 * not guessed.
 *
 * Raised to 28 once two more terms started composing with this same warp:
 * fin secondary motion (pectoral/caudal scull) adds ~2.7-3.2px, and the
 * turn-bend term (`bendAmp`, "update 2d fish v2" plan Part C —
 * `render/fish-layer.tsx`'s `TURN_BEND_GAIN_PX_PER_RAD`) adds another
 * ~4-6px depending on trait combo. Measured worst combined total: ~26.4px
 * (`balloon/round/sailfin`, base+bend=23.8px + fin=2.7px) — 28 leaves a
 * ~1.6px margin. Re-measure (don't assume it still fits) before Part D of
 * that plan grows fins further; raising `SPINE_PAD` again there is
 * expected, not a regression.
 */
export const SPINE_PAD = 28;

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
  const bendAmp = p.bendAmp ?? 0;

  const d = A * s + bendAmp * u * u;
  // d/du [A(u) sin(phase - k u)] = A'(u) sin - k A(u) cos
  const dgdu = Ad * s - p.k * A * c + bendAmp * 2 * u;
  // d2/du2 [...] = A''(u) sin - 2k A'(u) cos - k^2 A(u) sin
  const d2gdu2 = Add * s - 2 * p.k * Ad * c - p.k * p.k * A * s + bendAmp * 2;

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

// ---------------------------------------------------------------------------
// Fin secondary motion — independent-but-connected pectoral scull / caudal
// lag, composed AFTER the base spine warp above (see `render/fish-layer.tsx`:
// the shader resolves a destination pixel to local `(x, n)` via
// `inverseWarp`, THEN perturbs that already-warped point per targeted fin,
// THEN samples the baked texture). This is a perturbative approximation,
// not a jointly-solved warp — fine for a subtle secondary wiggle, wrong tool
// for the primary silhouette bend `spineAt` already owns.
// ---------------------------------------------------------------------------

export interface FinPivot {
  /** Hub position, in the SAME local space `inverseWarp` resolves to. */
  x: number;
  n: number;
  /** Falloff semi-axes — the rotation reaches full `amp` at the hub and eases to 0 at this ellipse. */
  radiusX: number;
  radiusN: number;
}

/**
 * Amplitude ceilings (radians) — conservative starting points, not measured
 * yet. `scripts/verify-aquarium.ts` sweeps `finSecondaryInjectivityBudget`
 * against these for every trait combination; raise them only after
 * confirming the budget stays safe, the same discipline `SPINE_AMP_MAX`
 * documents above.
 */
export const PEC_FIN_AMP_MAX = 0.28;
export const CAUDAL_FIN_AMP_MAX = 0.18;
/** Phase lead on the near pectoral (the far pectoral gets `+ Math.PI`) — makes the two scull out of phase instead of mirrored. */
export const PEC_PHASE_OFFSET = Math.PI / 6;
/** Fixed angular lag on the caudal's secondary term — approximates "trailing" since the shader only ever sees the current `beatPhase`, not true history. */
export const CAUDAL_LAG_RAD = Math.PI / 8;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Rotates `(x, n)` by `amp` radians around `pivot`'s hub, eased to identity
 * past the falloff ellipse (`radiusX`/`radiusN`) via `smoothstep`. `core/sksl/warp.ts`
 * re-derives this identical formula in SkSL — keep the two in numeric sync
 * the same deliberate way `spineAt` and its SkSL twin already are (written
 * twice, not templated).
 */
export function finSecondaryOffset(
  x: number,
  n: number,
  pivot: FinPivot,
  amp: number,
): { x: number; n: number } {
  const dx = x - pivot.x;
  const dn = n - pivot.n;
  const dist = Math.hypot(dx / pivot.radiusX, dn / pivot.radiusN);
  const theta = amp * smoothstep(1, 0, dist);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: pivot.x + dx * c - dn * s, n: pivot.n + dx * s + dn * c };
}

/**
 * Fold-safety budget for `finSecondaryOffset`: the WORST-CASE (minimum)
 * Jacobian determinant of the rotation field, via central finite
 * differences over a grid spanning a bit past the falloff ellipse. Unlike
 * `spineInjectivityBudget`'s "ratio against 1" convention, this returns the
 * determinant itself — the map folds where it crosses <= 0, so callers
 * should require a comfortable positive margin (measured per
 * `scripts/verify-aquarium.ts`, not derived from first principles: a
 * spatially-varying rotation field's fold point doesn't reduce to a single
 * closed-form curvature term the way the base warp's does).
 */
export function finSecondaryInjectivityBudget(pivot: FinPivot, amp: number, samples = 40): number {
  const h = Math.min(pivot.radiusX, pivot.radiusN) * 0.01;
  const span = 1.3; // sample a bit past the falloff radius, where the field re-approaches identity but the Jacobian could still misbehave near the edge
  let worst = Infinity;
  for (let i = 0; i <= samples; i++) {
    for (let j = 0; j <= samples; j++) {
      const x = pivot.x + (-span + (2 * span * i) / samples) * pivot.radiusX;
      const n = pivot.n + (-span + (2 * span * j) / samples) * pivot.radiusN;
      const p0 = finSecondaryOffset(x, n, pivot, amp);
      const px = finSecondaryOffset(x + h, n, pivot, amp);
      const pn = finSecondaryOffset(x, n + h, pivot, amp);
      const dXdx = (px.x - p0.x) / h;
      const dNdx = (px.n - p0.n) / h;
      const dXdn = (pn.x - p0.x) / h;
      const dNdn = (pn.n - p0.n) / h;
      const det = dXdx * dNdn - dXdn * dNdx;
      worst = Math.min(worst, det);
    }
  }
  return worst;
}

/**
 * How far `finSecondaryOffset` can move a point from its input position —
 * the additional padding it demands ON TOP of `spineMaxDisplacement`'s own
 * (the two compose: base warp first, then this), since the destination rect
 * must stay large enough that the FULL composed inverse map never samples
 * past the padded source bounds. Sweeps a grid out to the same margin
 * `finSecondaryInjectivityBudget` samples.
 */
export function finSecondaryMaxDisplacement(pivot: FinPivot, amp: number, samples = 60): number {
  const span = 1.3;
  let maxAbs = 0;
  for (let i = 0; i <= samples; i++) {
    for (let j = 0; j <= samples; j++) {
      const x = pivot.x + (-span + (2 * span * i) / samples) * pivot.radiusX;
      const n = pivot.n + (-span + (2 * span * j) / samples) * pivot.radiusN;
      const { x: wx, n: wn } = finSecondaryOffset(x, n, pivot, amp);
      maxAbs = Math.max(maxAbs, Math.abs(wx - x), Math.abs(wn - n));
    }
  }
  return maxAbs;
}

/**
 * How far the forward map can push a point beyond the source bounds, so the
 * caller can pad the draw rect enough that `tx="decal" ty="decal"` never
 * samples (and smears) the image edge. Sweeps `x` across the bounds and `n`
 * across `[-nMax, nMax]`, plus a full beat of `phase`.
 *
 * `bendAmp` (default 0) folds in the static turn-bend term — since it's
 * non-oscillating, the true worst case is wherever `ampScale`'s own sweep
 * lands, so sweeping `phase` with a fixed `bendAmp` (rather than also
 * sweeping `bendAmp`'s own sign) is sufficient: the term is monotonic in its
 * own sign, so the caller sweeping ±`TURN_BEND_GAIN_PX_PER_RAD` and taking
 * the max covers both directions.
 */
export function spineMaxDisplacement(
  boundsX: number,
  boundsWidth: number,
  ampScale: number,
  nMax: number,
  samples = 60,
  bendAmp = 0,
): number {
  let maxAbs = 0;
  for (let pi = 0; pi < 24; pi++) {
    const phase = (pi / 24) * Math.PI * 2;
    const p: SpineParams = { boundsX, boundsWidth, ampScale, k: SPINE_K, phase, bendAmp };
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
