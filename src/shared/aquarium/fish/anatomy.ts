// Builds the BODY outline (nose -> back -> peduncle -> belly -> nose, one
// closed path) from traits, using the "additive C¹ profile" model: a base
// half-height curve (top and bottom, independently), authored directly in
// `body-profile.ts` — an ORIGINAL silhouette, not derived from the legacy 2D
// renderer's shape. (An earlier version of this file fit the curve to the
// legacy renderer's exact body path via a now-deleted `legacy-fit.ts`,
// specifically so the old catalog's 1,726 hand-drawn pattern shapes kept
// landing correctly; this renderer no longer draws those shapes at all — see
// `pattern-defs.ts` — so that constraint no longer applies.)
//
// Fins are NOT part of this outline. They used to be additive bumps on the
// same profile, which is what made the fish read as a lumpy potato rather
// than an animal — a dorsal fin drawn as a symmetric hump on the back
// silhouette has none of a real fin's translucency, ray structure, or swept
// shape, and a lyretail's concave notch was never really expressible as a
// bump anyway (see `fins.ts`'s header for why). Fins are now distinct
// translucent membrane shapes built by `fins.ts`'s generic fan builder and
// composited into the same bake by `bake-fish.ts` — the "one organism bends
// together" property survives this split intact, because it comes from the
// spine warp acting on ONE baked texture, not from the outline topology.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node for
// `scripts/verify-aquarium.ts` and `scripts/aquarium-preview.ts`.

import type { Box, XY } from "@/shared/aquarium/core/ir";
import { unionBox } from "@/shared/aquarium/core/ir";
import type { BodyId, FishTraits } from "@/shared/fish/types";

import { BODY_PROFILES } from "./body-profile";
import {
  ANAL_FIN,
  buildFin,
  CAUDAL_FIN,
  DORSAL_FIN,
  PECTORAL_FAR_FIN,
  PECTORAL_NEAR_FIN,
  PELVIC_FAR_FIN,
  PELVIC_NEAR_FIN,
  type FinBuildContext,
  type FinShape,
} from "./fins";
import { linspace, pchip, polygonToPathD, type Curve1D } from "./profile";

/**
 * Fixed reference half-height for `FinSpec.ref: "H"` sizing — an AUTHORED
 * constant (not any body's own measured half-height), used for every body
 * type, so fin size doesn't scale off body roundness.
 *
 * Without this, fin size scales off `halfHeight`, and `balloon`'s is ~33%
 * larger than `standard`'s purely because it's a rounder/deeper shape — not
 * because a balloon molly's fins should be proportionally bigger. Left
 * unfixed, a balloon sailfin's dorsal reaches far enough from the spine to
 * blow the spine-warp injectivity budget past the fold point (see
 * `verify-aquarium.ts`'s `INJECTIVITY_BUDGET_MAX`). Fin size stays constant
 * in absolute local units across body types; only the BODY curve (via
 * `baseTop`/`baseBottom`, still per-body) varies. `FIN_SCALE_BY_BODY` is an
 * escape hatch if a body still blows the budget after fin re-tuning — only
 * populate it with a measured number, never guess.
 */
const FIN_REF_HALF_HEIGHT = 26;
const FIN_SCALE_BY_BODY: Record<BodyId, number> = { standard: 1, balloon: 1 };

function buildBaseCurves(body: BodyId): {
  top: Curve1D;
  bottom: Curve1D;
  x0: number;
  length: number;
} {
  const p = BODY_PROFILES[body];
  return { top: pchip(p.top), bottom: pchip(p.bottom), x0: p.x0, length: p.length };
}

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------

export interface Landmarks {
  x0: number;
  length: number;
  /** Deepest point of the back / belly — gradient anchors. */
  backPeak: XY;
  bellyLow: XY;
  nose: XY;
  peduncleTop: XY;
  peduncleBottom: XY;
  /** Vertical centre of the peduncle — the caudal fin's hub sits here. */
  peduncleMidY: number;
  halfHeight: number;
  bbox: Box;
}

export interface FishFins {
  dorsal: FinShape;
  anal: FinShape;
  pelvicNear: FinShape;
  pelvicFar: FinShape;
  pectoralNear: FinShape;
  pectoralFar: FinShape;
  caudal: FinShape;
}

export interface FishAnatomy {
  /** Body only — nose to peduncle to belly, one closed path. */
  outlineD: string;
  landmarks: Landmarks;
  baseTop: Curve1D;
  baseBottom: Curve1D;
  fins: FishFins;
}

function argmax(fn: Curve1D, lo: number, hi: number, steps = 200): { u: number; value: number } {
  let bestU = lo;
  let bestV = -Infinity;
  for (const u of linspace(lo, hi, steps)) {
    const v = fn(u);
    if (v > bestV) {
      bestV = v;
      bestU = u;
    }
  }
  return { u: bestU, value: bestV };
}

/**
 * Rounded snout cap. Called between `bottomPass`'s last point (nose-bottom)
 * and `topPass`'s first point (nose-top, closed via the outline's own `Z`),
 * so the sweep must go bottom -> top, not top -> bottom, or the two arcs
 * cross right at the seam. `bulge` is a large fraction of the nose-plane
 * half-depth on purpose — a soft rounded "puppy nose" muzzle, not the
 * flatter cap a smaller fraction produces.
 */
function noseCapPoints(x0: number, topY: number, bottomY: number, steps = 14): XY[] {
  const midY = (topY + bottomY) / 2;
  const radiusY = (bottomY - topY) / 2;
  const bulge = Math.min(10, radiusY * 0.72);
  const out: XY[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const angle = Math.PI / 2 - t * Math.PI; // +90deg (bottom) -> -90deg (top)
    out.push({
      x: x0 - Math.sin(angle + Math.PI / 2) * bulge,
      y: midY + Math.sin(angle) * radiusY,
    });
  }
  return out;
}

export function buildFishAnatomy(traits: FishTraits): FishAnatomy {
  const { top: baseTop, bottom: baseBottom, x0, length } = buildBaseCurves(traits.body);

  const xAt = (u: number) => x0 + u * length;
  const SAMPLES = 260;
  const topPass: XY[] = linspace(0, 1, SAMPLES).map((u) => ({ x: xAt(u), y: -baseTop(u) }));
  const bottomPass: XY[] = linspace(1, 0, SAMPLES).map((u) => ({ x: xAt(u), y: baseBottom(u) }));
  const cap = noseCapPoints(x0, topPass[0].y, bottomPass[bottomPass.length - 1].y);

  const outlinePoints = [...topPass, ...bottomPass, ...cap];
  const outlineD = polygonToPathD(outlinePoints);

  const back = argmax(baseTop, 0.15, 0.85);
  const belly = argmax(baseBottom, 0.15, 0.85);
  const halfHeight = Math.max(back.value, belly.value);
  const peduncleMidY = (baseBottom(1) - baseTop(1)) / 2;

  const bbox = outlinePoints.reduce<Box>(
    (b, p) => unionBox(b, { x: p.x, y: p.y, width: 0, height: 0 }),
    { x: outlinePoints[0].x, y: outlinePoints[0].y, width: 0, height: 0 },
  );

  const landmarks: Landmarks = {
    x0,
    length,
    backPeak: { x: xAt(back.u), y: -back.value },
    bellyLow: { x: xAt(belly.u), y: belly.value },
    nose: { x: x0, y: -(baseTop(0) - baseBottom(0)) / 2 },
    peduncleTop: { x: xAt(1), y: -baseTop(1) },
    peduncleBottom: { x: xAt(1), y: baseBottom(1) },
    peduncleMidY,
    halfHeight,
    bbox,
  };

  const finCtx: FinBuildContext = {
    x0,
    length,
    halfHeight: FIN_REF_HALF_HEIGHT * FIN_SCALE_BY_BODY[traits.body],
    baseTop,
    baseBottom,
    peduncleMidY,
  };
  const fins: FishFins = {
    dorsal: buildFin(DORSAL_FIN[traits.dorsal], finCtx),
    anal: buildFin(ANAL_FIN, finCtx),
    pelvicNear: buildFin(PELVIC_NEAR_FIN, finCtx),
    pelvicFar: buildFin(PELVIC_FAR_FIN, finCtx),
    pectoralNear: buildFin(PECTORAL_NEAR_FIN, finCtx),
    pectoralFar: buildFin(PECTORAL_FAR_FIN, finCtx),
    caudal: buildFin(CAUDAL_FIN[traits.tail], finCtx),
  };

  return { outlineD, landmarks, baseTop, baseBottom, fins };
}

/** Sum of base half-heights at `u` — must stay positive everywhere for the body outline to be simple. */
export function bodyDepthAt(baseTop: Curve1D, baseBottom: Curve1D, u: number): number {
  return baseTop(u) + baseBottom(u);
}
