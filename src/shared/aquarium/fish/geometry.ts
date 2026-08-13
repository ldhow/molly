// Small polygon utilities for the anatomy invariants in
// `scripts/verify-aquarium.ts` — self-intersection, point-in-polygon, and
// distance-to-boundary. Used to verify the body outline and every fin
// polygon are simple (never self-crossing) and that every fin hub is
// genuinely buried inside the body (the "buried root" trick `bake-fish.ts`
// relies on, verified here instead of just hand-tuned).
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import type { XY } from "@/shared/aquarium/core/ir";

function segmentsIntersect(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d = (a: XY, b: XY, c: XY) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Pairwise segment test over a closed polygon, skipping adjacent (shared-vertex) segments. */
export function polygonSelfIntersects(points: readonly XY[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent via wraparound
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Standard ray-casting point-in-polygon test. */
export function pointInPolygon(p: XY, points: readonly XY[]): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = a.y > p.y !== b.y > p.y;
    if (crosses) {
      const xIntersect = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < xIntersect) inside = !inside;
    }
  }
  return inside;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Minimum distance from `p` to any edge of the (closed) polygon. */
export function distanceToPolygonBoundary(p: XY, points: readonly XY[]): number {
  let min = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, distToSegment(p, points[i], points[(i + 1) % n]));
  }
  return min;
}
