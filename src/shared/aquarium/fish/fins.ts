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
      {
        dAngleDeg: -5.335,
        lenFrac: 0.614,
      },
      {
        dAngleDeg: 15.413,
        lenFrac: 1.159,
      },
      {
        dAngleDeg: 39.297,
        lenFrac: 1.654,
      },
      {
        dAngleDeg: 53.243,
        lenFrac: 1.948,
      },
      {
        dAngleDeg: 72.491,
        lenFrac: 1.717,
      },
      {
        dAngleDeg: 83.322,
        lenFrac: 0.965,
      },
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
      {
        dAngleDeg: 26.707,
        lenFrac: 0.838,
      },
      {
        dAngleDeg: 40.972,
        lenFrac: 1.68,
      },
      {
        dAngleDeg: 65.574,
        lenFrac: 2.829,
      },
      {
        dAngleDeg: 76.156,
        lenFrac: 2.626,
      },
      {
        dAngleDeg: 82.502,
        lenFrac: 2.622,
      },
      {
        dAngleDeg: 91.377,
        lenFrac: 2.166,
      },
      {
        dAngleDeg: 98.547,
        lenFrac: 1.659,
      },
      {
        dAngleDeg: 88.467,
        lenFrac: 0.739,
      },
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
    {
      dAngleDeg: 123.695,
      lenFrac: 0.461,
    },
    {
      dAngleDeg: 3.514,
      lenFrac: 1.059,
    },
    {
      dAngleDeg: 0.51,
      lenFrac: 0.459,
    },
    {
      dAngleDeg: 84.55,
      lenFrac: 0.215,
    },
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
    {
      dAngleDeg: -34.344,
      lenFrac: 0.485,
    },
    {
      dAngleDeg: -27.382,
      lenFrac: 0.849,
    },
    {
      dAngleDeg: 15.122,
      lenFrac: 0.582,
    },
    {
      dAngleDeg: 52.732,
      lenFrac: 0.197,
    },
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
  rays: [
    {
      dAngleDeg: 18.055,
      lenFrac: 0.433,
    },
    {
      dAngleDeg: 62.589,
      lenFrac: 0.529,
    },
    {
      dAngleDeg: 94.092,
      lenFrac: 0.371,
    },
    {
      dAngleDeg: 110.604,
      lenFrac: 0.139,
    },
  ],
  bulge: 0.2,
  scallop: 0.02,
  alpha: 0.45,
  rayAlpha: 0.2,
  layer: "behind",
};

export const PECTORAL_NEAR_FIN: FinSpec = {
  uRoot: 0.3,
  side: "flank",
  flankY: 0.6,
  sink: 0,
  axisDeg: 66,
  ref: "H",
  rays: [
    {
      dAngleDeg: -84.128,
      lenFrac: 0.343,
    },
    {
      dAngleDeg: -89.485,
      lenFrac: 0.885,
    },
    {
      dAngleDeg: -65.577,
      lenFrac: 0.9,
    },
    {
      dAngleDeg: -46.817,
      lenFrac: 0.826,
    },
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
  rays: [
    {
      dAngleDeg: 32.32,
      lenFrac: 0.274,
    },
    {
      dAngleDeg: 52.853,
      lenFrac: 0.199,
    },
    {
      dAngleDeg: 57.553,
      lenFrac: 0.164,
    },
    {
      dAngleDeg: 48.664,
      lenFrac: 0.115,
    },
  ],
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
    rays: [
      {
        dAngleDeg: -59.225,
        lenFrac: 0.165,
      },
      {
        dAngleDeg: -36.261,
        lenFrac: 0.33,
      },
      {
        dAngleDeg: -14.533,
        lenFrac: 0.422,
      },
      {
        dAngleDeg: 17.413,
        lenFrac: 0.43,
      },
      {
        dAngleDeg: 37.978,
        lenFrac: 0.34,
      },
      {
        dAngleDeg: 61.249,
        lenFrac: 0.192,
      },
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
    sink: 1,
    axisDeg: 0,
    ref: "L",
    rays: [
      {
        dAngleDeg: -63.946,
        lenFrac: 0.107,
      },
      {
        dAngleDeg: -51.919,
        lenFrac: 0.238,
      },
      {
        dAngleDeg: -23.721,
        lenFrac: 0.837,
      },
      {
        dAngleDeg: -28.761,
        lenFrac: 0.484,
      },
      {
        dAngleDeg: -12.949,
        lenFrac: 0.333,
      },
      {
        dAngleDeg: 18.66,
        lenFrac: 0.349,
      },
      {
        dAngleDeg: 30.611,
        lenFrac: 0.5,
      },
      {
        dAngleDeg: 25.162,
        lenFrac: 0.854,
      },
      {
        dAngleDeg: 53.209,
        lenFrac: 0.267,
      },
      {
        dAngleDeg: 64.262,
        lenFrac: 0.143,
      },
    ],
    bulge: [0.12, 0.12, 0.22, -0.12, -0.14, -0.08, 0.12, 0.14, 0.1],
    scallop: 0.03,
    alpha: 1.1,
    rayAlpha: 0.32,
    layer: "behind",
  },
};
