// A chain of overlapping circles, shrinking (or growing) from one end to the
// other — the generic "tapered limb" primitive shared by any creature module
// with jointed or stalk-like appendages (a frog's bent leg, an axolotl's
// gill frond or stub leg, ...). Trivially correct — two overlapping filled
// circles can't self-intersect or produce a stray spike the way a
// hand-rolled bitangent capsule outline can — and reads identically as a
// smooth tapered limb once filled solid with `Node[]` circles.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node, Paint, XY } from "./ir";

export interface ChainCircle {
  cx: number;
  cy: number;
  r: number;
}

/** Overlapping circles from `p0` (radius `r0`) to `p1` (radius `r1`), dense enough that consecutive circles overlap by at least ~10%. */
export function circleChain(p0: XY, r0: number, p1: XY, r1: number): ChainCircle[] {
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const steps = Math.max(2, Math.ceil(len / (Math.min(r0, r1) * 0.9)));
  const out: ChainCircle[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({
      cx: p0.x + (p1.x - p0.x) * t,
      cy: p0.y + (p1.y - p0.y) * t,
      r: r0 + (r1 - r0) * t,
    });
  }
  return out;
}

/** `circleChain`'s circles as solid-fill IR nodes, one flat color — the common case for a limb segment. */
export function circleChainNodes(circles: readonly ChainCircle[], paint: Paint): Node[] {
  return circles.map((c) => ({ kind: "circle", cx: c.cx, cy: c.cy, r: c.r, paint }));
}
