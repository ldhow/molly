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
    { x: 0.0, y: 6.5 },
    { x: 0.06, y: 10.1 },
    { x: 0.14, y: 14.8 },
    { x: 0.25, y: 19.3 },
    { x: 0.34, y: 21.3 },
    { x: 0.4, y: 21.9 }, // crest, forward of centre
    { x: 0.5, y: 21.6 },
    { x: 0.6, y: 20.3 },
    { x: 0.7, y: 18.1 },
    { x: 0.8, y: 14.8 },
    { x: 0.88, y: 11.5 },
    { x: 0.94, y: 9.1 },
    { x: 1.0, y: 7.3 }, // peduncle top
    { x: 1.1, y: 5.8 }, // end-tangent only, never sampled directly
  ],
  bottom: [
    { x: 0.0, y: 7.2 },
    { x: 0.06, y: 10.3 },
    { x: 0.14, y: 14.3 },
    { x: 0.25, y: 18.4 },
    { x: 0.36, y: 21.7 },
    { x: 0.46, y: 23.6 },
    { x: 0.55, y: 24.5 }, // belly low, just past centre
    { x: 0.62, y: 24.3 },
    { x: 0.7, y: 22.7 },
    { x: 0.8, y: 18.2 },
    { x: 0.88, y: 12.9 },
    { x: 0.94, y: 8.8 },
    { x: 1.0, y: 6.0 }, // peduncle bottom
    { x: 1.1, y: 4.8 },
  ],
};

const BALLOON: BodyProfile = {
  x0: -48,
  length: 92,
  top: [
    { x: 0.0, y: 9.0 },
    { x: 0.06, y: 15.0 },
    { x: 0.14, y: 22.5 },
    { x: 0.24, y: 29.0 },
    { x: 0.32, y: 32.4 },
    { x: 0.4, y: 34.0 }, // crest
    { x: 0.5, y: 33.4 },
    { x: 0.6, y: 31.0 },
    { x: 0.7, y: 27.2 },
    { x: 0.8, y: 21.6 },
    { x: 0.88, y: 16.4 },
    { x: 0.94, y: 12.6 },
    { x: 1.0, y: 9.6 },
    { x: 1.1, y: 7.7 },
  ],
  bottom: [
    { x: 0.0, y: 9.6 },
    { x: 0.06, y: 16.0 },
    { x: 0.14, y: 23.6 },
    { x: 0.24, y: 30.6 },
    { x: 0.34, y: 35.0 },
    { x: 0.44, y: 37.4 },
    { x: 0.54, y: 38.0 }, // belly low
    { x: 0.62, y: 37.0 },
    { x: 0.7, y: 34.0 },
    { x: 0.8, y: 26.6 },
    { x: 0.88, y: 18.6 },
    { x: 0.94, y: 12.2 },
    { x: 1.0, y: 8.4 },
    { x: 1.1, y: 6.7 },
  ],
};

export const BODY_PROFILES: Record<BodyId, BodyProfile> = {
  standard: STANDARD,
  balloon: BALLOON,
};
