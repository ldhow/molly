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
  /** Body only — nose to peduncle to belly, one closed path. Still used for the fill/pattern clip — unchanged. */
  outlineD: string;
  /**
   * The INK KEYLINE path: body top/bottom passes with the straight
   * peduncle end-cap replaced by a walk around the caudal fin's own outer
   * rim (`fins.caudal.rimD`), bridged in with two smooth curves instead of
   * straight lines. Stroking this instead of `outlineD` + the caudal's own
   * closed-shape stroke is what stops the body and tail from reading as two
   * separately-outlined pieces glued together — see `bake-fish.ts`.
   */
  silhouetteStrokeD: string;
  landmarks: Landmarks;
  baseTop: Curve1D;
  baseBottom: Curve1D;
  fins: FishFins;
}

const F2 = (n: number) => n.toFixed(2);

/**
 * Bow fraction (of chord length) used to bulge each bridge's control point
 * away from the body's vertical centre, so a straight peduncle->rim line
 * reads as a swept leading edge instead of a corner.
 *
 * An earlier version placed the control point along the BODY curve's own
 * exit tangent, scaled by the full chord length. That reads well for
 * `round` (a short ~15-17%-of-body-length gap, where the tip sits close
 * enough to the peduncle that the tangent direction and the chord direction
 * roughly agree) but folds the path on `lyretail`: its first/last rays sweep
 * ~50 units out at an angle that diverges ~75-90 degrees from the body's own
 * exit tangent, so a tangent-scaled handle massively overshoots and loops
 * back across the fin's own concave margin — caught by
 * `scripts/verify-aquarium.ts`'s `polygonSelfIntersects` check on
 * `standard/lyretail/*` and `balloon/lyretail/*`, not eyeballed.
 *
 * A perpendicular bow from the chord's own midpoint can't produce that kind
 * of unbounded loop regardless of how divergent the endpoint tangents are —
 * it trades tangent continuity at the peduncle corner for a hard geometric
 * guarantee, which is the right trade given this runs across every
 * body/tail combination, not just the one it was eyeballed against. 0.15 is
 * the largest fraction that still passes `polygonSelfIntersects` for both
 * `round` and `lyretail`, both body types — re-run
 * `npm run verify:aquarium` before raising it.
 */
const BRIDGE_BOW_FRACTION = 0.15;

/**
 * Quadratic bridge from `from` to `to`, control point bowed away from the
 * body's vertical centre (`awayFromCenter`, `-1` = toward more negative y /
 * up, `+1` = toward more positive y / down) by `BRIDGE_BOW_FRACTION` of the
 * chord length.
 */
function bowBridge(from: XY, to: XY, awayFromCenter: -1 | 1): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const cy = midY + awayFromCenter * len * BRIDGE_BOW_FRACTION;
  return ` Q ${F2(midX)} ${F2(cy)} ${F2(to.x)} ${F2(to.y)}`;
}

function lineThrough(points: readonly XY[]): string {
  return points.map((p) => ` L ${F2(p.x)} ${F2(p.y)}`).join("");
}

/**
 * The peduncle->rim->peduncle sequence (no leading `M`, so it splices into
 * an already-started path): bridge out to the caudal's upper lobe, walk its
 * outer rim, bridge back in at the lower lobe. Shared verbatim by
 * `silhouetteStrokeD` (the ink line, spliced into the body's own top/bottom
 * passes) and `caudalFillD` (the fin's own FILL, closed straight back to
 * `peduncleTop`) — they MUST use identical coordinates, not just visually
 * similar ones, or the ink line bulges away from the fill it's meant to
 * trace and leaves a gap of bare background showing through at the corners
 * (measured via `yarn aquarium:preview` — this happened during development
 * when the stroke path used this curve but the fill didn't).
 */
function tailBridgeSequence(peduncleTop: XY, peduncleBottom: XY, caudal: FinShape): string {
  const tipFirst = caudal.tips[0];
  const tipLast = caudal.tips[caudal.tips.length - 1];
  // `rimD` is `M <tipFirst> <Q-chain to tipLast>` — strip the leading M so
  // the Q-chain can be spliced into this path instead of starting a new one.
  const rimMargin = caudal.rimD.replace(/^M\s+-?[\d.]+\s+-?[\d.]+/, "");
  return bowBridge(peduncleTop, tipFirst, -1) + rimMargin + bowBridge(tipLast, peduncleBottom, 1);
}

/**
 * The unified body+tail ink keyline (see `FishAnatomy.silhouetteStrokeD`).
 * `topPass`/`bottomPass` are the SAME sampled arrays `buildFishAnatomy`
 * already built for the fill outline — this only changes how the peduncle
 * end is bridged, not the body curve itself.
 */
function buildSilhouetteStrokeD(
  topPass: readonly XY[],
  bottomPass: readonly XY[],
  cap: readonly XY[],
  bridgeSequence: string,
): string {
  let d = `M ${F2(topPass[0].x)} ${F2(topPass[0].y)}`;
  d += lineThrough(topPass.slice(1));
  d += bridgeSequence;
  d += lineThrough(bottomPass.slice(1));
  d += lineThrough(cap);
  return d + " Z";
}

/**
 * The caudal fin's own FILL, replacing the generic `buildFin()` output's
 * hub-radiating edges with the SAME bridge curve the ink line uses, closed
 * with a straight `peduncleTop -> peduncleBottom` edge — exactly where the
 * body's own fill already ends, so there is no gap between the two fills
 * for the ink line (or anything else) to reveal. The fin's hub itself is
 * unchanged and still used for ray angles / gradient anchors — only the
 * FILL boundary near the root moves out to the peduncle plane.
 */
function buildCaudalFillD(peduncleTop: XY, peduncleBottom: XY, bridgeSequence: string): string {
  return (
    `M ${F2(peduncleTop.x)} ${F2(peduncleTop.y)}` +
    bridgeSequence +
    ` L ${F2(peduncleTop.x)} ${F2(peduncleTop.y)} Z`
  );
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

  const bridgeSequence = tailBridgeSequence(
    landmarks.peduncleTop,
    landmarks.peduncleBottom,
    fins.caudal,
  );
  const silhouetteStrokeD = buildSilhouetteStrokeD(topPass, bottomPass, cap, bridgeSequence);
  // Replace the generic hub-anchored fill with one that reaches the SAME
  // peduncle corners the ink line now bridges to — see `buildCaudalFillD`'s
  // doc comment for why this must share `bridgeSequence` exactly rather
  // than being independently shaped.
  fins.caudal = {
    ...fins.caudal,
    d: buildCaudalFillD(landmarks.peduncleTop, landmarks.peduncleBottom, bridgeSequence),
    bbox: unionBox(
      unionBox(fins.caudal.bbox, {
        x: landmarks.peduncleTop.x,
        y: landmarks.peduncleTop.y,
        width: 0,
        height: 0,
      }),
      { x: landmarks.peduncleBottom.x, y: landmarks.peduncleBottom.y, width: 0, height: 0 },
    ),
  };

  return { outlineD, silhouetteStrokeD, landmarks, baseTop, baseBottom, fins };
}

/** Sum of base half-heights at `u` — must stay positive everywhere for the body outline to be simple. */
export function bodyDepthAt(baseTop: Curve1D, baseBottom: Curve1D, u: number): number {
  return baseTop(u) + baseBottom(u);
}
