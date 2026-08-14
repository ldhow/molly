// Fins as distinct, translucent membrane shapes — the thing `anatomy.ts` no
// longer draws as additive bumps on the body outline. This is what actually
// makes a fish read as a fish: a dorsal that sweeps back into a point, a
// caudal fan with real rays, a pectoral that sits on the flank. The "one
// organism, bends together" property survives this split intact — it comes
// from the spine warp acting on ONE baked texture (see `spine.ts` /
// `core/sksl/warp.ts`), not from the outline being a single path. Splitting
// fins out is in fact a step TOWARD legacy pigment parity: the old renderer
// (`render-spec.ts`) clips patterns to the body only, and `pigment.ts`
// clipping to the full silhouette was the deviation, not the norm.
//
// ONE generic fan builder instead of six hand-authored shapes. A fin is a
// hub (anchored to the CURRENT body curve, so it tracks any future
// re-sculpt with no separate constants — the same rule the legacy renderer's
// `anchorFinRoot` encoded by hand) plus a ring of rays, each ending at a tip;
// the margin between consecutive tips is a quadratic curve bulging outward
// (convex webbing) or inward (a forked/concave margin — this is how a
// lyretail's notch is built, and it is the one shape a "function of u"
// profile bump genuinely cannot express, since a real lyre's lobes curve
// backward past the notch).
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import type { DorsalId, TailId } from "@/shared/fish/types";

import type { Curve1D } from "./profile";

const F = (n: number) => n.toFixed(2);

export interface FinRay {
  dAngleDeg: number;
  lenFrac: number;
}

export interface FinSpec {
  /** 0 = nose, 1 = peduncle. */
  uRoot: number;
  side: "top" | "bottom" | "rear" | "flank";
  /** Local units the hub sits INSIDE the body edge — buried by the opaque skin fill. Unused for "rear"/"flank". */
  sink: number;
  /** Degrees from +x (tailward); -90 = up, +90 = down. */
  axisDeg: number;
  rays: FinRay[];
  /** `lenFrac` multiplies body half-height ("H") or full length ("L"). */
  ref: "H" | "L";
  /** + convex webbing between rays, − a forked/concave margin. Per-segment if an array (length = rays.length - 1). */
  bulge: number | number[];
  /** Margin ripple amplitude, as a fraction of each segment's length. */
  scallop: number;
  alpha: number;
  rayAlpha: number;
  /** Draw order relative to the opaque body fill — "behind" gets buried at the root, "front" overlays the flank. */
  layer: "behind" | "front";
  /** Only for side:"flank" — fraction of half-height, signed (+down). */
  flankY?: number;
}

export interface FinShape {
  d: string;
  /** Open path: just the tip-to-tip margin (no hub-radiating edges) — the fin's own outer rim, for callers that want to stroke the margin without the hub seam (see `anatomy.ts`'s unified body+tail silhouette). */
  rimD: string;
  /** Ray tip points in fan order, first-to-last — `rimD`'s endpoints (`tips[0]`, `tips[tips.length-1]`) as raw coordinates, for callers bridging into the rim without parsing the path string. */
  tips: XY[];
  rays: string[];
  pivot: XY;
  tip: XY;
  bbox: Box;
  alpha: number;
  rayAlpha: number;
  layer: "behind" | "front";
}

export interface FinBuildContext {
  x0: number;
  length: number;
  halfHeight: number;
  baseTop: Curve1D;
  baseBottom: Curve1D;
  /** `(baseBottom(1) - baseTop(1)) / 2` — the peduncle's own vertical centre. */
  peduncleMidY: number;
}

function hubFor(spec: FinSpec, ctx: FinBuildContext): XY {
  const x = ctx.x0 + spec.uRoot * ctx.length;
  switch (spec.side) {
    case "top":
      return { x, y: -(ctx.baseTop(spec.uRoot) - spec.sink) };
    case "bottom":
      return { x, y: ctx.baseBottom(spec.uRoot) - spec.sink };
    case "rear":
      return { x, y: ctx.peduncleMidY };
    case "flank": {
      // A fraction of the LOCAL body cross-section at this u, not the fixed
      // fin-size reference height — the flank surface itself still has to
      // track each body's own actual width, or the hub ends up buried near
      // the spine (a fixed-height fraction is roughly zero relative to a
      // body that's ±20+ units deep there) instead of near the belly edge
      // where a pectoral actually attaches. Negative = toward the back,
      // positive = toward the belly.
      const frac = spec.flankY ?? 0;
      return frac < 0
        ? { x, y: -ctx.baseTop(spec.uRoot) * -frac }
        : { x, y: ctx.baseBottom(spec.uRoot) * frac };
    }
  }
}

export function buildFin(spec: FinSpec, ctx: FinBuildContext): FinShape {
  const ref = spec.ref === "H" ? ctx.halfHeight : ctx.length;
  const hub = hubFor(spec, ctx);

  const tips: XY[] = spec.rays.map((r) => {
    const rad = ((spec.axisDeg + r.dAngleDeg) * Math.PI) / 180;
    const len = r.lenFrac * ref;
    return { x: hub.x + Math.cos(rad) * len, y: hub.y + Math.sin(rad) * len };
  });

  const bulgeAt = (i: number) => (Array.isArray(spec.bulge) ? spec.bulge[i] : spec.bulge);

  let margin = "";
  for (let i = 0; i < tips.length - 1; i++) {
    const a = tips[i];
    const b = tips[i + 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / segLen;
    let ny = (b.x - a.x) / segLen;
    // Orient the normal outward (away from the hub), so positive bulge always
    // reads as convex webbing regardless of which side of the fin this
    // segment is on.
    const towardHubX = hub.x - mid.x;
    const towardHubY = hub.y - mid.y;
    if (nx * towardHubX + ny * towardHubY > 0) {
      nx = -nx;
      ny = -ny;
    }
    const bulge = bulgeAt(i);
    const ripple = spec.scallop * Math.sin(i * 2.4) * segLen;
    const push = bulge * segLen + ripple;
    const cx = mid.x + nx * push;
    const cy = mid.y + ny * push;
    margin += ` Q ${F(cx)} ${F(cy)} ${F(b.x)} ${F(b.y)}`;
  }

  const d = `M ${F(hub.x)} ${F(hub.y)} L ${F(tips[0].x)} ${F(tips[0].y)}${margin} L ${F(hub.x)} ${F(hub.y)} Z`;
  const rimD = `M ${F(tips[0].x)} ${F(tips[0].y)}${margin}`;

  const rays = tips.map(
    (t) =>
      `M ${F(hub.x)} ${F(hub.y)} L ${F(hub.x + (t.x - hub.x) * 0.86)} ${F(hub.y + (t.y - hub.y) * 0.86)}`,
  );

  const xs = [hub.x, ...tips.map((t) => t.x)];
  const ys = [hub.y, ...tips.map((t) => t.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bbox: Box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  const tip = tips[Math.floor(tips.length / 2)];

  return {
    d,
    rimD,
    tips,
    rays,
    pivot: hub,
    tip,
    bbox,
    alpha: spec.alpha,
    rayAlpha: spec.rayAlpha,
    layer: spec.layer,
  };
}

// ---------------------------------------------------------------------------
// Trait tables — the extensibility seam. Local frame: x0 = -56, L = 104,
// FIN_REF_HALF_HEIGHT (H) = 26 (standard); peduncle midline y ≈ -0.75.
// Authored against `body-profile.ts`'s original silhouette and cross-checked
// by `verify-aquarium.ts`'s hub/tip/simplicity assertions — no legacy art
// reference. Softer dial than a realistic fish on purpose: `bulge` up /
// `scallop` down for rounder, less spiky-comb margins (the storybook read).
// ---------------------------------------------------------------------------

export const DORSAL_FIN: Record<DorsalId, FinSpec> = {
  standard: {
    uRoot: 0.46,
    side: "top",
    sink: 7,
    axisDeg: -80,
    ref: "H",
    rays: [
      { dAngleDeg: -46, lenFrac: 0.72 },
      { dAngleDeg: -26, lenFrac: 1.02 },
      { dAngleDeg: -6, lenFrac: 1.18 },
      { dAngleDeg: 14, lenFrac: 1.12 },
      { dAngleDeg: 34, lenFrac: 0.92 },
      { dAngleDeg: 52, lenFrac: 0.62 },
    ],
    bulge: 0.18,
    scallop: 0.03,
    alpha: 1,
    rayAlpha: 0.3,
    layer: "behind",
  },
  // HARD CAP: past ~1.6·H (against the fixed FIN_REF_HALF_HEIGHT reference —
  // see anatomy.ts) the spine-warp injectivity budget (spine.ts) crosses the
  // fold-safety threshold. Don't raise this without re-running
  // `verify-aquarium.ts`'s spine sweep across ALL body types — `balloon`'s
  // own larger silhouette adds to the same bake bounds a tall dorsal pushes
  // on, so it fails first.
  sailfin: {
    uRoot: 0.38,
    side: "top",
    sink: 8,
    axisDeg: -84,
    ref: "H",
    rays: [
      { dAngleDeg: -58, lenFrac: 0.78 },
      { dAngleDeg: -42, lenFrac: 1.28 },
      { dAngleDeg: -27, lenFrac: 1.52 },
      { dAngleDeg: -11, lenFrac: 1.62 },
      { dAngleDeg: 6, lenFrac: 1.6 },
      { dAngleDeg: 22, lenFrac: 1.44 },
      { dAngleDeg: 38, lenFrac: 1.14 },
      { dAngleDeg: 54, lenFrac: 0.76 },
    ],
    bulge: 0.14,
    scallop: 0.05,
    alpha: 1,
    rayAlpha: 0.3,
    layer: "behind",
  },
};

export const ANAL_FIN: FinSpec = {
  uRoot: 0.74,
  side: "bottom",
  sink: 6,
  axisDeg: 32,
  ref: "H",
  rays: [
    { dAngleDeg: -30, lenFrac: 0.8 },
    { dAngleDeg: -8, lenFrac: 0.9 },
    { dAngleDeg: 14, lenFrac: 0.82 },
    { dAngleDeg: 34, lenFrac: 0.62 },
  ],
  bulge: 0.16,
  scallop: 0.02,
  alpha: 0.95,
  rayAlpha: 0.28,
  layer: "behind",
};

export const PELVIC_NEAR_FIN: FinSpec = {
  uRoot: 0.44,
  side: "bottom",
  sink: 4,
  axisDeg: 80,
  ref: "H",
  rays: [
    { dAngleDeg: -26, lenFrac: 0.52 },
    { dAngleDeg: -4, lenFrac: 0.66 },
    { dAngleDeg: 18, lenFrac: 0.6 },
    { dAngleDeg: 38, lenFrac: 0.46 },
  ],
  bulge: 0.2,
  scallop: 0.02,
  alpha: 0.95,
  rayAlpha: 0.26,
  layer: "behind",
};

export const PELVIC_FAR_FIN: FinSpec = {
  uRoot: 0.42,
  side: "bottom",
  sink: 4,
  axisDeg: 80,
  ref: "H",
  // 0.88x, not 0.8x — the deeper new belly leaves less clearance margin
  // between a shrunk far-pelvic's tip and the body than the old body did.
  rays: PELVIC_NEAR_FIN.rays.map((r) => ({ ...r, lenFrac: r.lenFrac * 0.88 })),
  bulge: 0.2,
  scallop: 0.02,
  alpha: 0.45,
  rayAlpha: 0.2,
  layer: "behind",
};

export const PECTORAL_NEAR_FIN: FinSpec = {
  uRoot: 0.3,
  side: "flank",
  // 0.60 of the way from the spine to the belly edge at u=0.3 — close
  // enough to the surface that a modest ray length clears it, unlike a
  // fraction of the fixed fin-size reference (which put the old hub only
  // ~1.5 units from the spine on a body that's ±20+ units deep there).
  flankY: 0.6,
  sink: 0,
  axisDeg: 66,
  ref: "H",
  // Sized so `balloon`'s much deeper belly (halfHeight 38 vs standard's
  // 28.5, against the fixed FIN_REF_HALF_HEIGHT reference) still clears —
  // the flank hub sits proportionally deeper there, so a fixed-length ray
  // that clears standard's flank falls short on balloon.
  rays: [
    { dAngleDeg: -26, lenFrac: 0.92 },
    { dAngleDeg: -4, lenFrac: 1.1 },
    { dAngleDeg: 18, lenFrac: 1.02 },
    { dAngleDeg: 38, lenFrac: 0.8 },
  ],
  bulge: 0.14,
  scallop: 0.02,
  alpha: 0.62,
  rayAlpha: 0.24,
  layer: "front",
};

export const PECTORAL_FAR_FIN: FinSpec = {
  uRoot: 0.3,
  side: "flank",
  flankY: 0.72,
  sink: 0,
  axisDeg: 58,
  ref: "H",
  // 0.88x, not 0.8x — flankY 0.72 sits deeper than near's 0.6, so a smaller
  // fraction of near's (already balloon-clearing) length falls short again.
  rays: PECTORAL_NEAR_FIN.rays.map((r) => ({ ...r, lenFrac: r.lenFrac * 0.88 })),
  bulge: 0.14,
  scallop: 0.02,
  alpha: 0.3,
  rayAlpha: 0.18,
  layer: "behind",
};

export const CAUDAL_FIN: Record<TailId, FinSpec> = {
  round: {
    uRoot: 0.965,
    side: "rear",
    sink: 0,
    axisDeg: 0,
    ref: "L",
    // Fuller and wider than the legacy proportions on purpose — a stubbier
    // body needs a bigger caudal fan to keep the bake bounds width from
    // collapsing (which is what pushes the spine-warp injectivity budget up
    // — see spine.ts), and it's the right storybook look besides.
    rays: [
      { dAngleDeg: -58, lenFrac: 0.255 },
      { dAngleDeg: -34, lenFrac: 0.295 },
      { dAngleDeg: -11, lenFrac: 0.325 },
      { dAngleDeg: 12, lenFrac: 0.318 },
      { dAngleDeg: 35, lenFrac: 0.278 },
      { dAngleDeg: 57, lenFrac: 0.225 },
    ],
    bulge: 0.2,
    scallop: 0.02,
    alpha: 1,
    rayAlpha: 0.32,
    layer: "behind",
  },
  // A real fork: strongly concave (negative bulge) on the middle segments,
  // gently convex at the shoulders — the shape a "function of u" body
  // profile cannot express (see this file's header).
  //
  // Rays are the original table x1.5 ("update 2d fish v2" plan Part D —
  // dramatic flowing lobes toward the reference image), angles unchanged.
  // A larger multiplier measurably pushed `scripts/verify-aquarium.ts`'s
  // combined injectivity/padding budget (spine.ts, shared with Parts B/C's
  // fin-secondary and turn-bend terms) past its margin; re-run that sweep
  // before raising this further, don't just eyeball the preview.
  lyretail: {
    uRoot: 0.965,
    side: "rear",
    sink: 0,
    axisDeg: 0,
    ref: "L",
    rays: [
      { dAngleDeg: -34, lenFrac: 0.84 },
      { dAngleDeg: -21, lenFrac: 0.6 },
      { dAngleDeg: -7, lenFrac: 0.38 },
      { dAngleDeg: 7, lenFrac: 0.37 },
      { dAngleDeg: 21, lenFrac: 0.6 },
      { dAngleDeg: 35, lenFrac: 0.87 },
    ],
    bulge: [0.06, -0.26, -0.26, -0.26, 0.06],
    scallop: 0.02,
    alpha: 1,
    rayAlpha: 0.32,
    layer: "behind",
  },
};
