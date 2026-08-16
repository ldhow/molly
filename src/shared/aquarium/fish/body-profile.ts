// The authored body silhouette — hand-tuned half-height control points, NOT
// derived from `@/shared/fish/render-spec.ts` (the legacy 2D renderer) or
// any other source. `profile.ts`'s `pchip()` (Fritsch-Carlson monotone
// cubic) guarantees a smooth, non-overshooting, non-self-intersecting
// profile from any sensibly-spaced table of positive `y`s, so these numbers
// are directly editable art, not a fit — see `anatomy.ts`'s header for why
// this replaced `legacy-fit.ts`.
//
// Art direction: `standard` was originally a plump storybook companion fish
// (aspect ~2.0:1) — "update 2d fish v2" plan Part D leaned it out toward a
// reference image's more elongated, flowing-fin look (aspect ~2.35:1, all
// `top`/`bottom` depths scaled by 0.86 from the original table, length/x0
// and every u-position unchanged so crest position, snout bluntness, and
// peduncle centering all carry over unaltered — see PROPORTION_SPEC in
// `scripts/verify-aquarium.ts` for the checked range). `balloon` is
// deliberately UNCHANGED: it's its own distinct puffy body type, not a
// second point on the same lean/plump axis, and the reference image treats
// "Balloon (Short)" as its own thing too. A back that crests forward of
// centre (a "shoulders up" read), a deep belly cresting just past centre,
// and a confident taper into an ON-AXIS peduncle waist are still the shared
// silhouette language between both bodies (legacy's peduncle rides high
// off-axis at `peduncleMidY ≈ -4.85`; here it's ≈ -0.65 on `standard`).
//
// Measurement convention (state it explicitly, the old comment didn't):
// aspect = length(nose -> peduncle) / max(top(u) + bottom(u)) over u in [0,1].
//
// `u = 0` is the nose PLANE (the true nose tip sits further out at
// `x0 - noseCap's bulge`, see anatomy.ts's `noseCapPoints`), `u = 1` is the
// peduncle. Each table carries one extra point at `u ≈ 1.10` purely to set
// the PCHIP end TANGENT at `u = 1` — `anatomy.ts` only ever samples
// `u in [0,1]`, so this point never appears in the outline itself, but
// without it the curve's derivative at u=1 flattens instead of continuing to
// narrow, and the peduncle reads as a cut-off rather than a waist.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node for
// `scripts/verify-aquarium.ts` and `scripts/aquarium-preview.ts`.

import type { BodyId } from "@/shared/fish/types";

import type { CurvePoint } from "./profile";

export interface BodyProfile {
  /** Nose plane in local coords. */
  x0: number;
  /** Nose plane -> peduncle. */
  length: number;
  top: CurvePoint[];
  bottom: CurvePoint[];
}

// All y-values are the original plump-storybook table x 0.86 (see the art-
// direction comment above) — a uniform depth scale, not a shape redesign,
// so the crest/belly u-positions and relative proportions are unchanged.
const STANDARD: BodyProfile = {
  x0: -56,
  length: 104,
  top: [
    {
      x: 0.005,
      y: 6.127,
    },
    {
      x: 0.109,
      y: 10.26,
    },
    {
      x: 0.188,
      y: 15.132,
    },
    {
      x: 0.288,
      y: 17.642,
    },
    {
      x: 0.371,
      y: 18.823,
    },
    {
      x: 0.441,
      y: 19.118,
    },
    {
      x: 0.536,
      y: 18.823,
    },
    {
      x: 0.65,
      y: 17.051,
    },
    {
      x: 0.732,
      y: 13.951,
    },
    {
      x: 0.816,
      y: 10.998,
    },
    {
      x: 0.883,
      y: 8.784,
    },
    {
      x: 0.942,
      y: 7.603,
    },
    {
      x: 1,
      y: 7.3,
    },
    {
      x: 1.1,
      y: 5.8,
    },
  ],
  bottom: [
    {
      x: 0.035,
      y: 5.684,
    },
    {
      x: 0.088,
      y: 9.965,
    },
    {
      x: 0.164,
      y: 15.575,
    },
    {
      x: 0.252,
      y: 20.299,
    },
    {
      x: 0.336,
      y: 24.285,
    },
    {
      x: 0.428,
      y: 25.319,
    },
    {
      x: 0.511,
      y: 25.023,
    },
    {
      x: 0.606,
      y: 22.661,
    },
    {
      x: 0.697,
      y: 19.266,
    },
    {
      x: 0.779,
      y: 15.575,
    },
    {
      x: 0.877,
      y: 11.884,
    },
    {
      x: 0.94,
      y: 8.8,
    },
    {
      x: 1,
      y: 6,
    },
    {
      x: 1.1,
      y: 4.8,
    },
  ],
};

const BALLOON: BodyProfile = {
  x0: -48,
  length: 92,
  top: [
    {
      x: -0.079,
      y: 8.341,
    },
    {
      x: 0.068,
      y: 10.408,
    },
    {
      x: 0.2,
      y: 14.394,
    },
    {
      x: 0.254,
      y: 19.118,
    },
    {
      x: 0.352,
      y: 21.923,
    },
    {
      x: 0.429,
      y: 22.661,
    },
    {
      x: 0.5,
      y: 22.956,
    },
    {
      x: 0.598,
      y: 21.185,
    },
    {
      x: 0.688,
      y: 18.38,
    },
    {
      x: 0.76,
      y: 16.166,
    },
    {
      x: 0.85,
      y: 13.065,
    },
    {
      x: 0.935,
      y: 11.441,
    },
    {
      x: 1.01,
      y: 11.294,
    },
    {
      x: 1.037,
      y: 9.817,
    },
  ],
  bottom: [
    {
      x: 0.018,
      y: 3.617,
    },
    {
      x: 0.134,
      y: 15.575,
    },
    {
      x: 0.187,
      y: 25.023,
    },
    {
      x: 0.269,
      y: 32.7,
    },
    {
      x: 0.365,
      y: 35.948,
    },
    {
      x: 0.45,
      y: 36.538,
    },
    {
      x: 0.554,
      y: 35.062,
    },
    {
      x: 0.646,
      y: 32.257,
    },
    {
      x: 0.731,
      y: 26.795,
    },
    {
      x: 0.785,
      y: 21.185,
    },
    {
      x: 0.846,
      y: 14.542,
    },
    {
      x: 0.923,
      y: 9.522,
    },
    {
      x: 1.034,
      y: 8.046,
    },
    {
      x: 1.047,
      y: 7.751,
    },
  ],
};

export const BODY_PROFILES: Record<BodyId, BodyProfile> = {
  standard: STANDARD,
  balloon: BALLOON,
};
