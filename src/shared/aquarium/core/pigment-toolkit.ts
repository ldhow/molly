// Low-level pigment-painting building blocks shared by every creature's OWN
// pattern generator — fish's `fish/pigment.ts` (built on `PigmentGeom`'s
// nose/backPeak/topAt/bottomAt contour) and every `creatures/<species>/
// pigment.ts` module alike. Nothing here assumes a single-valued top/bottom
// body contour: a shell spiral or a scute grid build on these same
// primitives without being forced through `PigmentGeom`'s fish-specific
// shape — see the plan's "Corrected: pigment/pattern reuse" note.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import type { Node, Paint, XY } from "./ir";

export const f = (n: number) => n.toFixed(1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Namespaces an rng seed key per pattern instance — seed 0 keeps the bare base key so existing bakes stay byte-identical. */
export function seededKey(base: string, seed: number): string {
  return seed === 0 ? base : `${base}-${seed}`;
}

/** Rounded organic blob path around a center (patches/spots/petals/scutes) — on any body plan. */
export function blobPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  wobble: number,
  rng: () => number,
): string {
  const points: XY[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const jitter = 1 - wobble / 2 + rng() * wobble;
    points.push({ x: cx + Math.cos(angle) * rx * jitter, y: cy + Math.sin(angle) * ry * jitter });
  }
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i <= n; i++) {
    const p0 = points[(i - 1) % n];
    const p1 = points[i % n];
    d += ` Q ${f(p0.x)} ${f(p0.y)} ${f((p0.x + p1.x) / 2)} ${f((p0.y + p1.y) / 2)}`;
  }
  return d + " Z";
}

/**
 * Scatter `count` organic blobs across an arbitrary placement function — the
 * shared skeleton behind fish's `spots`/`speckle` patterns, generalized so a
 * shell's scute pattern or a coat's speckle can drive it with their own
 * placement/paint logic instead of a fish's nose-to-peduncle span.
 */
export function scatterBlobPrimitives(opts: {
  rng: () => number;
  count: number;
  place: (rng: () => number) => XY;
  radius: (rng: () => number) => number;
  wobble?: number;
  paint: (rng: () => number) => Paint;
  blur?: number | ((rng: () => number) => number);
  clip?: string;
}): Node[] {
  const { rng, count, place, radius, paint, clip } = opts;
  const wobble = opts.wobble ?? 0.4;
  const out: Node[] = [];
  for (let i = 0; i < count; i++) {
    const { x, y } = place(rng);
    const r = radius(rng);
    out.push({
      kind: "path",
      d: blobPath(x, y, r, r, wobble, rng),
      paint: paint(rng),
      blur: typeof opts.blur === "function" ? opts.blur(rng) : (opts.blur ?? 0.9),
      clip,
    });
  }
  return out;
}

/**
 * A ribbon traced along an arbitrary parametric centerline — the non-fish
 * equivalent of `fish/pigment.ts`'s `bands` case (which walks `PigmentGeom`'s
 * `topAt`/`bottomAt` contour). Any body plan that can express "point + local
 * outward normal at u" — a shell's logarithmic spiral, a shell rim, a limb's
 * long axis — can drive the same ribbon-fill logic fish's stripes/bands use,
 * without going through a fish-shaped geometry contract.
 */
export function ribbonAlongPath(opts: {
  uStart: number;
  uEnd: number;
  at: (u: number) => { point: XY; normal: XY };
  halfWidth: (u: number) => number;
  samples?: number;
}): string {
  const samples = opts.samples ?? 8;
  const side = (sign: 1 | -1): XY[] => {
    const pts: XY[] = [];
    for (let s = 0; s <= samples; s++) {
      const u = lerp(opts.uStart, opts.uEnd, s / samples);
      const { point, normal } = opts.at(u);
      const hw = opts.halfWidth(u) * sign;
      pts.push({ x: point.x + normal.x * hw, y: point.y + normal.y * hw });
    }
    return pts;
  };
  const pts = [...side(1), ...side(-1).reverse()];
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${f(pts[i].x)} ${f(pts[i].y)}`;
  return d + " Z";
}
