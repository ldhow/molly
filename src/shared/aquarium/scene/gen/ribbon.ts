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

/** The spine itself as a stroke-friendly path (for a midrib line, etc). */
export function spinePath(spine: readonly XY[]): string {
  const smooth = catmullRomSample(spine);
  let d = `M ${F(smooth[0].x)} ${F(smooth[0].y)}`;
  for (let i = 1; i < smooth.length; i++) d += ` L ${F(smooth[i].x)} ${F(smooth[i].y)}`;
  return d;
}
