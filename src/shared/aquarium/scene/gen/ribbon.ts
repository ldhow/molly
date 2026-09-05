// Shared shape helper for the scene generators: turns a spine (centerline)
// plus a per-point width into one filled, closed path — a tapered branch,
// leaf, or blade. Same idea as `catalog.ts`'s hand-drawn "ribbon" custom
// shapes, but computed from a spine instead of authored by hand, so it works
// for any seeded/procedural curve.
//
// Dependency-free: no React/RN/Skia.

import type { XY } from "@/shared/aquarium/core/ir";

const F = (n: number) => n.toFixed(2);

/** Catmull-Rom through `points`, sampled at `samplesPerSegment` per span — smooth without hand Béziers. */
export function catmullRomSample(points: readonly XY[], samplesPerSegment = 8): XY[] {
  if (points.length < 2) return [...points];
  const pts = [points[0], ...points, points[points.length - 1]];
  const out: XY[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Builds a closed ribbon path from a smoothed spine and a width profile.
 * `widthAt(t)` receives `t` in [0,1] along the spine and returns full width
 * (not half-width) at that point — the caller decides the taper shape.
 */
export function ribbonPath(spine: readonly XY[], widthAt: (t: number) => number): string {
  const smooth = catmullRomSample(spine);
  const n = smooth.length;
  const left: XY[] = [];
  const right: XY[] = [];
  for (let i = 0; i < n; i++) {
    const p = smooth[i];
    const prev = smooth[Math.max(0, i - 1)];
    const next = smooth[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = widthAt(i / (n - 1)) / 2;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  let d = `M ${F(left[0].x)} ${F(left[0].y)}`;
  for (let i = 1; i < left.length; i++) d += ` L ${F(left[i].x)} ${F(left[i].y)}`;
  for (let i = right.length - 1; i >= 0; i--) d += ` L ${F(right[i].x)} ${F(right[i].y)}`;
  return d + " Z";
}

/**
 * The ribbon's cross-axis at its widest point: the two edge points of the
 * span perpendicular to the spine, ordered so `from` is the edge facing AWAY
 * from `light` and `to` is the edge facing into it.
 *
 * This is what `ribbonPath` alone can't give you. A blade filled with one
 * flat colour — or with a gradient running base-to-tip ALONG the spine, which
 * is what most of the generators did — reads as a paper cutout, because a
 * real leaf's most obvious shading is ACROSS its width: the edge turned away
 * from the key light falls off, the edge turned into it catches a highlight.
 * Feed these two points into a `linear` paint with dark -> base -> light
 * stops and a flat ribbon gains form for one gradient's cost.
 *
 * `light` is a direction the light travels FROM, in local space (+y down, so
 * a light from above is negative y). Callers should pass the scene-wide value
 * rather than picking their own — decor lit from inconsistent directions is
 * worse than decor that is uniformly flat.
 */
export function ribbonCrossAxis(
  spine: readonly XY[],
  widthAt: (t: number) => number,
  light: XY,
): { from: XY; to: XY } {
  const smooth = catmullRomSample(spine);
  const n = smooth.length;

  // Widest sample, not the midpoint — taper profiles are rarely symmetric
  // (kelp is broadest at the base, a lance leaf a third of the way up), and
  // shading the widest span is what keeps the gradient spanning the shape
  // instead of running off its narrow end.
  let bestI = 0;
  let bestW = -1;
  for (let i = 0; i < n; i++) {
    const w = widthAt(i / (n - 1));
    if (w > bestW) {
      bestW = w;
      bestI = i;
    }
  }

  const p = smooth[bestI];
  const prev = smooth[Math.max(0, bestI - 1)];
  const next = smooth[Math.min(n - 1, bestI + 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const half = bestW / 2;

  const a = { x: p.x + nx * half, y: p.y + ny * half };
  const b = { x: p.x - nx * half, y: p.y - ny * half };
  // Whichever edge the normal points toward the light is the lit one. Without
  // this test a mirrored or steeply-leaning piece gets lit from the wrong
  // side, which reads worse than no form shading at all.
  return nx * light.x + ny * light.y > 0 ? { from: b, to: a } : { from: a, to: b };
}

/**
 * The scene light re-expressed in the local space of a child drawn inside a
 * group rotated by `rotateDeg`.
 *
 * Generators that author a leaf pointing "up" and then rotate it into place
 * (anubias, stemBush) must pass this to `ribbonCrossAxis` rather than the raw
 * scene light — otherwise every leaf is lit from the same side of ITS OWN
 * geometry, which after rotation means a rosette lit from all directions at
 * once. That looks like no lighting model at all.
 */
export function lightInLocalSpace(light: XY, rotateDeg: number): XY {
  const r = (-rotateDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: light.x * cos - light.y * sin, y: light.x * sin + light.y * cos };
}

/**
 * The blade split into its two halves either side of the midrib, plus each
 * half's own shading axis (midrib -> that half's own edge).
 *
 * `ribbonCrossAxis` gives ONE gradient spanning edge-to-edge, and that is
 * exactly why a flat-shaded leaf reads as a smooth cylinder instead of a
 * folded blade: a real strap leaf is two near-flat surfaces meeting at an
 * angle along its midrib, and the visible tell of that is a VALUE BREAK
 * right at the crease — not a continuous gradient, which has no seam to
 * break at. Filling each half from its own `{from: midrib, to: edge}` axis
 * reproduces that for free: both halves agree at the crease (same colour at
 * `offset 0`, so the fold line itself stays continuous, which is physically
 * right — the two faces touch there) and diverge outward at whatever rate
 * each half's own stops describe.
 *
 * `leftIsLit` reuses the exact same widest-point light test
 * `ribbonCrossAxis` uses, so the two functions never disagree about which
 * side of a piece is lit.
 */
export function ribbonFold(
  spine: readonly XY[],
  widthAt: (t: number) => number,
  light: XY,
): {
  litPath: string;
  shadowPath: string;
  litAxis: { from: XY; to: XY };
  shadowAxis: { from: XY; to: XY };
} {
  const smooth = catmullRomSample(spine);
  const n = smooth.length;
  const left: XY[] = [];
  const right: XY[] = [];
  for (let i = 0; i < n; i++) {
    const p = smooth[i];
    const prev = smooth[Math.max(0, i - 1)];
    const next = smooth[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = widthAt(i / (n - 1)) / 2;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const closeHalf = (edge: readonly XY[]) => {
    let d = `M ${F(smooth[0].x)} ${F(smooth[0].y)}`;
    for (let i = 1; i < n; i++) d += ` L ${F(smooth[i].x)} ${F(smooth[i].y)}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${F(edge[i].x)} ${F(edge[i].y)}`;
    return d + " Z";
  };
  const leftPath = closeHalf(left);
  const rightPath = closeHalf(right);

  let bestI = 0;
  let bestW = -1;
  for (let i = 0; i < n; i++) {
    const w = widthAt(i / (n - 1));
    if (w > bestW) {
      bestW = w;
      bestI = i;
    }
  }
  const p = smooth[bestI];
  const prev = smooth[Math.max(0, bestI - 1)];
  const next = smooth[Math.min(n - 1, bestI + 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const leftIsLit = nx * light.x + ny * light.y > 0;

  return leftIsLit
    ? {
        litPath: leftPath,
        shadowPath: rightPath,
        litAxis: { from: p, to: left[bestI] },
        shadowAxis: { from: p, to: right[bestI] },
      }
    : {
        litPath: rightPath,
        shadowPath: leftPath,
        litAxis: { from: p, to: right[bestI] },
        shadowAxis: { from: p, to: left[bestI] },
      };
}

/** The spine itself as a stroke-friendly path (for a midrib line, etc). */
export function spinePath(spine: readonly XY[]): string {
  const smooth = catmullRomSample(spine);
  let d = `M ${F(smooth[0].x)} ${F(smooth[0].y)}`;
  for (let i = 1; i < smooth.length; i++) d += ` L ${F(smooth[i].x)} ${F(smooth[i].y)}`;
  return d;
}
