// Generic math for the "additive C¹ profile" fish model: a monotone cubic
// (PCHIP) through control points for the base body, and raised-cosine
// windows that add fin bumps on top without breaking continuity — a window
// is C¹ (zero-valued, zero-derivative) at both ends by construction, and the
// body profile is C¹ by construction (PCHIP), so their sum is C¹. That is
// the entire trick that replaces fillet/intersection geometry: no curve is
// ever cut or joined, everything is added.
//
// Dependency-free: no React/RN/Skia. Consumed by `anatomy.ts` (device + Node)
// and `scripts/verify-aquarium.ts` (Node only).

export interface CurvePoint {
  x: number;
  y: number;
}

export type Curve1D = (x: number) => number;

/**
 * Monotone cubic Hermite interpolation (Fritsch-Carlson), per the standard
 * algorithm: never overshoots, never introduces a wiggle between control
 * points, so a half-height profile built from positive `y`s stays positive.
 * A superellipse or Catmull-Rom does not have this guarantee and can
 * self-intersect the outline on extreme trait combinations.
 * `points` must be sorted by ascending `x`. Outside the domain the curve
 * extrapolates linearly along the boundary tangent, so a caller-composed
 * additive profile stays smooth right up to (and past, briefly) its edge.
 */
export function pchip(points: readonly CurvePoint[]): Curve1D {
  const n = points.length;
  if (n === 0) return () => 0;
  if (n === 1) {
    const y0 = points[0].y;
    return () => y0;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }

  const m = new Array<number>(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] === 0 || delta[i] === 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  // Fritsch-Carlson limiter: clamp each tangent pair so the Hermite piece
  // between them can't overshoot past a flat (delta == 0) or sign-changing
  // segment.
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i] / delta[i];
    const beta = m[i + 1] / delta[i];
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * alpha * delta[i];
      m[i + 1] = tau * beta * delta[i];
    }
  }

  return (x: number): number => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    // Binary search for the bracketing interval.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const hi_ = h[lo];
    const t = (x - xs[lo]) / hi_;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[lo] + h10 * hi_ * m[lo] + h01 * ys[lo + 1] + h11 * hi_ * m[lo + 1];
  };
}

/**
 * A raised-cosine bump window over `[u0, u1]`: 0 outside, peaking at 1 at the
 * midpoint, with zero value AND zero derivative at both ends — so adding
 * `amplitude * window(u) * shape(u)` to a C¹ profile keeps it C¹, with no
 * special-casing at the window's edges.
 */
export function raisedCosineWindow(u: number, u0: number, u1: number): number {
  if (u <= u0 || u >= u1) return 0;
  const t = (u - u0) / (u1 - u0);
  return 0.5 * (1 - Math.cos(2 * Math.PI * t));
}

/**
 * A hump peaking at `uPeak` rather than the window midpoint: each half is
 * independently a raised-cosine ramp, and a raised cosine has zero slope at
 * BOTH its own ends — including the shared peak — so the two halves join C¹
 * even though they can have different widths. That asymmetry (steep leading
 * edge, long trailing sweep) is what makes a fin bump read as swept back
 * instead of a symmetric tooth.
 */
export function asymmetricHump(u: number, u0: number, uPeak: number, u1: number): number {
  if (u <= u0 || u >= u1) return 0;
  if (u < uPeak) return 0.5 * (1 - Math.cos((Math.PI * (u - u0)) / (uPeak - u0)));
  return 0.5 * (1 + Math.cos((Math.PI * (u - uPeak)) / (u1 - uPeak)));
}

/** Evenly-spaced samples over `[a, b]` inclusive, `n >= 2`. */
export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
  return out;
}

const F = (n: number) => n.toFixed(2);

/** `M x y L x y L x y ... Z` from a closed polygon (no re-fitting to Béziers). */
export function polygonToPathD(points: readonly CurvePoint[]): string {
  if (points.length === 0) return "";
  let d = `M ${F(points[0].x)} ${F(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${F(points[i].x)} ${F(points[i].y)}`;
  return d + " Z";
}

function cubicAt(
  p0: CurvePoint,
  c1: CurvePoint,
  c2: CurvePoint,
  p1: CurvePoint,
  t: number,
): CurvePoint {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t * t * t * p1.x,
    y: s * s * s * p0.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t * t * t * p1.y,
  };
}

/** Flattens a single cubic Bézier into `steps` line segments (steps+1 points, endpoints included). */
export function flattenCubic(
  p0: CurvePoint,
  c1: CurvePoint,
  c2: CurvePoint,
  p1: CurvePoint,
  steps: number,
): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) out.push(cubicAt(p0, c1, c2, p1, i / steps));
  return out;
}
