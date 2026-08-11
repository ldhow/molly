// Pure fish-drawing module: builds a declarative list of primitives (SVG path
// strings + paint descriptions) for a given trait combination. Consumed by BOTH
// the Skia renderer (fish-sprite.tsx, via Skia.Path.MakeFromSVGString) and the
// HTML preview generator (scripts/fish-preview.ts) — so previews match the app
// by construction.
//
// MUST stay free of React/React Native/Skia imports: it runs under plain Node.
//
// Every IR feature below must be expressible in BOTH backends, or the preview
// stops being evidence about the app. Current mapping:
//
//   feature                     Skia                      SVG preview
//   --------------------------- ------------------------- ----------------------
//   linear / radial gradient    <LinearGradient> etc.     <linearGradient> etc.
//   elliptical radial (`scale`) gradient `transform`      gradientTransform
//   primitive `blur` (mask)     MaskFilter.MakeBlur       feGaussianBlur on shape
//   group `blur` (image)        <Blur> in layer paint     feGaussianBlur on <g>
//   multiply/screen/overlay/    blendMode                 mix-blend-mode
//     softLight
//   plusLighter                 blendMode                 CSS plus-lighter
//   isolate                     <Group layer>             isolation:isolate
//   clip                        <Group clip>              <clipPath>
//
// Every row above is exact in both backends — there is currently NO feature
// that one can express and the other only approximates. Keep it that way.
//
// Deliberately NOT in the IR, each for a reason:
//   sweep gradients   — Skia has one, SVG has none. Iridescence uses a
//                       multi-stop linear ramp instead, which reads the same at
//                       fish scale and is exact on both sides.
//   Turbulence/noise  — Skia and SVG both implement the same Perlin spec, but
//                       not the same phase, so the preview would stop matching.
//   SkSL shaders      — Skia-only, compile on first frame, and the likeliest
//                       source of iOS/Android divergence.
// Add any of them only with a documented SVG story and a note in this table.
//
// Local space: origin at body center, nose pointing LEFT (-x), y down.
// Adult footprint ≈ x [-52..70], y [-67 (sailfin tip)..42 (anal fin tip)].
//
// Art direction follows assets/fish/README.md: a chunky molly with a blunt
// snout, a deep belly, a narrow peduncle, a broad scalloped caudal fan, ray
// lines on every fin, a dark outline, and a glossy band along the upper flank.

import { darken, lighten, rgba } from "../lib/color";
import { makeRng } from "../lib/rng";

import type { BodyId, ColorDef, FishTraits, RarityTier, ShimmerKind } from "./types";

export interface XY {
  x: number;
  y: number;
}

/** Axis-aligned box in local space. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Stop {
  offset: number;
  color: string;
}

export type Paint =
  | { type: "solid"; color: string; opacity?: number }
  | { type: "linear"; from: XY; to: XY; stops: Stop[]; opacity?: number }
  | {
      type: "radial";
      center: XY;
      radius: number;
      stops: Stop[];
      opacity?: number;
      /** Non-uniform scale about `center` — gives an elliptical falloff. */
      scale?: XY;
    };

/**
 * Deliberately a short allowlist. The separable modes are safe everywhere; the
 * non-separable ones (hue/color/luminosity) are where GPU backends diverge on
 * colour space, so they are omitted until something actually needs them.
 */
export type Blend = "srcOver" | "multiply" | "screen" | "overlay" | "softLight" | "plusLighter";

interface DrawCommon {
  paint: Paint;
  /**
   * SVG path `d` to clip to — pass `spec.bodyPathD` for the body silhouette, or
   * a fin's own `d` to keep a highlight inside that fin. Both emitters memoise
   * by string identity, so reusing one variable costs a single clip object.
   */
  clip?: string;
  blend?: Blend;
  /**
   * Gaussian sigma in local units, MASK-blur semantics: softens this shape's
   * own alpha in a single draw, no offscreen layer. Contrast `group.blur`.
   */
  blur?: number;
}

export type Primitive =
  | ({
      kind: "path";
      d: string;
      /** Render as a stroked line instead of a fill. */
      stroke?: { width: number };
    } & DrawCommon)
  | ({ kind: "circle"; cx: number; cy: number; r: number } & DrawCommon)
  | {
      kind: "group";
      children: Primitive[];
      clip?: string;
      blend?: Blend;
      opacity?: number;
      /** IMAGE-filter blur: blurs the composited result. Forces a layer. */
      blur?: number;
      /**
       * Composite `blend` against this group's own contents rather than
       * whatever is behind the fish. Required for correctness whenever a child
       * uses a non-`srcOver` blend, or `overlay` would pick up the tank water.
       */
      isolate?: boolean;
    };

export interface FishRenderSpec {
  /** Drawn first; animated as a group rotating around tailPivot. */
  tail: Primitive[];
  tailPivot: XY;
  /** Fins, body, shading, patterns, eye — in draw order. */
  body: Primitive[];
  /**
   * Drawn last: the pectoral fin, animated as a group rotating around
   * pectoralPivot. Separate from `body` because it's the one other fin worth
   * animating (a flutter that sculls harder at low speed) — see the pectoral
   * fin bake note in fish-picture.ts.
   */
  front: Primitive[];
  pectoralPivot: XY;
  /**
   * The skin's PIGMENT only — base gradient, pattern, shimmer and scale
   * detail, with no volume shading, gloss, outline or rim baked in. It is the
   * leading run of what `body` composites, so 2D gets it for free; 3D uses it
   * as an albedo texture and supplies real lighting instead of inheriting 2D's
   * painted-on highlights.
   */
  skinAlbedo: Primitive[];
  /** Body silhouette path (used for clipping and locked-silhouette mode). */
  bodyPathD: string;
  /** All outline paths (body + fins + tail) for silhouette rendering. */
  silhouetteDs: string[];
  bodyHalfHeight: number;
  /**
   * Local-space extent of everything drawn, already inflated for strokes and
   * blur. Both backends need it: the preview sizes its viewBox from it, and the
   * Skia picture bake uses it as the recording bounds. Under-report it and
   * blurred edges clip at the boundary.
   */
  bounds: Box;
  /** Tight local-space extent of just `tail`, inflated like `bounds`. */
  tailBounds: Box;
  /** Tight local-space extent of just `front`, inflated like `bounds`. */
  frontBounds: Box;
}

/** Vertical squish per life stage, shared by both renderers. */
export const STAGE_SQUISH = { egg: 1, fry: 0.72, juvenile: 0.88, adult: 1 } as const;

/**
 * Slack added around the raw geometry for stroke width and (from Phase 2) blur.
 * Kept generous — over-reporting bounds costs a few transparent pixels, while
 * under-reporting visibly clips soft edges.
 */
const BOUNDS_PAD = 22;

/** Desaturation applied to dead fish. Shared so app and preview cannot drift. */
export const DEAD_GRAYSCALE_MATRIX = [
  0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0, 0, 0, 1, 0,
];
export const DEAD_OPACITY = 0.6;

/** Flat fill for locked Fishdex entries. */
export const SILHOUETTE_COLOR = "#0a1b29";

// ---------------------------------------------------------------------------
// Box helpers.
// ---------------------------------------------------------------------------

function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function inflateBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

// ---------------------------------------------------------------------------
// Egg stage — shared so the app and the preview cannot draw different eggs.
// ---------------------------------------------------------------------------

const EGG_RADIUS = 12;

export function eggSpec(): Primitive[] {
  return [
    {
      kind: "circle",
      cx: 0,
      cy: 0,
      r: EGG_RADIUS,
      paint: { type: "solid", color: "#f6e3b0", opacity: 0.92 },
    },
    {
      kind: "circle",
      cx: -3.5,
      cy: -4,
      r: 3.5,
      paint: { type: "solid", color: "#fff7e0", opacity: 0.9 },
    },
    { kind: "circle", cx: 2, cy: 2, r: 4.4, paint: { type: "solid", color: "#e0a24e" } },
  ];
}

export function eggSilhouetteSpec(): Primitive[] {
  return [
    {
      kind: "circle",
      cx: 0,
      cy: 0,
      r: EGG_RADIUS,
      paint: { type: "solid", color: SILHOUETTE_COLOR },
    },
  ];
}

/** Body-silhouette half height (dead-fish placement) without building a spec. */
export function bodyHalfHeightFor(body: FishTraits["body"]): number {
  return body === "balloon" ? 34 : 28;
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (no Math.random — stable art per color).
// `makeRng` lives in shared/lib/rng.ts so the 3D generators use the identical
// stream; the sequence is unchanged from when it was defined here.
// ---------------------------------------------------------------------------

/**
 * Appends a per-fish pattern variant to an rng key, EXCEPT at seed 0 — so
 * bucket 0 (the default for `standardTraits()` previews/Fishdex and ~1/8 of
 * real fish) reproduces the exact same key, and therefore the exact same
 * art, this file already shipped before per-fish variation existed.
 */
function seededKey(base: string, seed: number): string {
  return seed === 0 ? base : `${base}-${seed}`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const f = (n: number) => n.toFixed(1);
const toRad = (deg: number) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Rarity material — how "premium" a fish's finish reads, independent of its
// pattern. Rare-tier values match what Phase 2 shipped and was reviewed
// against, so rare fish are visually unchanged; common/uncommon are toned
// down toward "matte, minimal highlights" and epic/legendary are pushed up
// toward "premium gloss, bright rim lighting" — the tiering the brief asks
// for, without moving the tier everything was already tuned around.
// ---------------------------------------------------------------------------

export interface Material {
  /** Screen-blend gloss band peak alpha — the wet highlight along the flank. */
  gloss: number;
  /** Soft-light radial core bloom peak alpha — roundness and sheen. */
  bloom: number;
  /** Plus-lighter rim light peak alpha along the top/rear edge. */
  rim: number;
  /** Fin trailing-edge alpha. LOWER is more translucent. */
  finTrail: number;
  /** Fan/dorsal notch wobble. LOWER is cleaner/more refined. */
  finJitter: number;
  /** Multiplier on pattern-primitive opacities — richer contrast at higher tiers. */
  patternContrast: number;
}

const MATERIAL_BY_TIER: Record<RarityTier, Material> = {
  common: { gloss: 0.16, bloom: 0.4, rim: 0.1, finTrail: 0.7, finJitter: 0.13, patternContrast: 1 },
  uncommon: {
    gloss: 0.24,
    bloom: 0.5,
    rim: 0.22,
    finTrail: 0.62,
    finJitter: 0.09,
    patternContrast: 1.03,
  },
  // Matches the fixed constants Phase 2 shipped with — the tier everything
  // else is calibrated relative to.
  rare: {
    gloss: 0.34,
    bloom: 0.62,
    rim: 0.5,
    finTrail: 0.56,
    finJitter: 0.06,
    patternContrast: 1.08,
  },
  epic: {
    gloss: 0.42,
    bloom: 0.7,
    rim: 0.62,
    finTrail: 0.42,
    finJitter: 0.035,
    patternContrast: 1.14,
  },
  legendary: {
    gloss: 0.5,
    bloom: 0.78,
    rim: 0.74,
    finTrail: 0.3,
    finJitter: 0.02,
    patternContrast: 1.2,
  },
};

function materialFor(tier: RarityTier): Material {
  return MATERIAL_BY_TIER[tier];
}

/** Rounded organic blob path around a center (for patches). */
function blobPath(
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
    points.push({
      x: cx + Math.cos(angle) * rx * jitter,
      y: cy + Math.sin(angle) * ry * jitter,
    });
  }
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i <= n; i++) {
    const p0 = points[(i - 1) % n];
    const p1 = points[i % n];
    d += ` Q ${f(p0.x)} ${f(p0.y)} ${f((p0.x + p1.x) / 2)} ${f((p0.y + p1.y) / 2)}`;
  }
  return d + " Z";
}

interface FinShape {
  d: string;
  rays: string[];
  /** Where the rays radiate from — used to aim the root→tip fin gradient. */
  pivot: XY;
  /** Mid-point of the outer edge, the far end of that gradient. */
  tip: XY;
  /** Untouched-by-stroke extent of `d`, for spec bounds. */
  bbox: Box;
}

// ---------------------------------------------------------------------------
// Silhouette geometry per trait.
// ---------------------------------------------------------------------------

interface BodyGeom {
  d: string;
  nose: XY;
  backPeak: XY;
  bellyLow: XY;
  peduncleTop: XY;
  peduncleBottom: XY;
  halfHeight: number;
  bbox: Box;
}

function bodyGeom(body: FishTraits["body"]): BodyGeom {
  if (body === "balloon") {
    // Short, tall, egg-round — the balloon molly of the reference sheet.
    return {
      d: "M -49.5 -15.5 C -50.5 -21.0 -34.5 -17.5 -25.0 -21.5 C -1.5 -41.0 22.0 -36.5 36.5 -29.5 C 47.0 -24.5 51.5 -18.5 55.0 -14.0 C 56.5 -12.5 56.5 -10.0 56.5 -7.5 L 56.0 2.5 C 53.0 3.5 47.0 7.0 43.5 9.5 C 39.0 18.0 28.6 30.7 6.5 29.0 C -1.0 28.5 -17.5 25.0 -29.0 12.0 C -34.0 7.0 -45.0 0.5 -49.5 -15.5 Z",
      nose: { x: -49.6, y: -15.5 },
      backPeak: { x: 9.8, y: -36.0 },
      bellyLow: { x: 7.0, y: 30.0 },
      peduncleTop: { x: 56.0, y: -12.5 },
      peduncleBottom: { x: 56.0, y: 3.0 },
      halfHeight: 29.3,
      bbox: { x: -49.5, y: -29.5, width: 106.0, height: 58.5 },
    };
  }
  // Standard: ~2.25:1 length-to-depth — elongated enough to read as a molly
  // rather than a goldfish/pufferfish silhouette. A blunt rounded snout, a
  // back that crests just ahead of centre, a belly carrying the volume, and a
  // full rear that steps in to a short caudal peduncle rather than tapering to
  // a point. (Same curve family as before, stretched ~15% longer and ~14%
  // shallower — every downstream primitive reads its position off the named
  // landmarks below, so this one change reshapes the whole fish.)
  return {
    d: "M -56.2 -13.2 C -50.2 -15.7 -40.5 -16.0 -28.5 -21.0 C -7.5 -32.0 33.5 -17.5 37.0 -15.5 C 46.5 -12.0 54.5 -10.0 55.8 -12.7 C 56.8 -9.7 56.8 -5.2 56.3 -1.2 L 55.8 2.8 C 50.8 4.3 44.8 6.3 39.8 8.8 C 30.8 13.3 18.0 17.0 3.0 20.0 C -12.0 21.0 -25.5 18.0 -36.5 11.0 C -46.5 5.5 -53.2 0.3 -56.2 -13.2 Z",
    nose: { x: -52.2, y: -6.1 },
    backPeak: { x: 4.8, y: -24.4 },
    bellyLow: { x: -2.7, y: 21.0 },
    peduncleTop: { x: 55.9, y: -12.6 },
    peduncleBottom: { x: 55.9, y: 2.9 },
    halfHeight: 22.8,
    bbox: { x: -56.2, y: -21.0, width: 112.5, height: 41.0 },
  };
}

/**
 * Shifts every absolute coordinate pair in an M/L/Q/C/Z path string by
 * (dx, dy). Every fin `d` below is authored with an explicit sign and a
 * space between numbers (via `f()`), so the numbers always appear in
 * x,y,x,y,... order regardless of which command they belong to — a running
 * parity counter is enough, no real path parser required.
 */
function translatePathD(d: string, dx: number, dy: number): string {
  let axis = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, (num) => {
    const shifted = parseFloat(num) + (axis % 2 === 0 ? dx : dy);
    axis++;
    return f(shifted);
  });
}

function translateFin(shape: FinShape, dx: number, dy: number): FinShape {
  if (dx === 0 && dy === 0) return shape;
  return {
    d: translatePathD(shape.d, dx, dy),
    rays: shape.rays.map((ray) => translatePathD(ray, dx, dy)),
    pivot: { x: shape.pivot.x + dx, y: shape.pivot.y + dy },
    tip: { x: shape.tip.x + dx, y: shape.tip.y + dy },
    bbox: { ...shape.bbox, x: shape.bbox.x + dx, y: shape.bbox.y + dy },
  };
}

/**
 * Re-anchors a hand-tuned fin so its own `pivot` — the hub point it was
 * authored around — lands exactly on `desiredRoot`, wherever the current
 * body's landmarks say that root should sit. This is the same rule the
 * previous fan()-generated fins encoded directly in their formulas (e.g.
 * dorsal's `base = backPeakY + 7`, pelvic's `belly - 8`): the root must sink
 * a fixed margin PAST the body's own edge landmark, so the opaque body fill
 * (drawn after these fins) fully buries the seam and only the free outer
 * lobe reads as a separate shape. Because the target is computed from the
 * CURRENT body's landmarks every time — not a frozen snapshot — this stays
 * correct through future body re-sculpts with no separate constants to keep
 * in sync.
 */
function anchorFinRoot(shape: FinShape, desiredRoot: XY): FinShape {
  return translateFin(shape, desiredRoot.x - shape.pivot.x, desiredRoot.y - shape.pivot.y);
}

function tailGeom(tail: FishTraits["tail"], _geom: BodyGeom): FinShape {
  if (tail === "lyretail") {
    // A lyre: a full fan whose top and bottom corners draw out into points,
    // leaving a shallow concave sweep between them. Sized down ~20% from the
    // original so it reads as a fin rather than a second body lobe.
    return {
      d: "M 55.8 -10.4 C 58.5 -24.5 91.0 -36.0 114.5 -33.0 C 75.0 -34.0 80.0 -12.0 78.5 -2.5 C 80.0 8.0 91.0 18.5 114.5 24.0 C 89.0 22.0 60.5 14.5 55.8 0.6 L 55.8 -10.4 Z",
      rays: [],
      pivot: { x: 55.8, y: -2.4 },
      tip: { x: 78.8, y: -2.4 },
      bbox: { x: 55.8, y: -33.0, width: 58.7, height: 57.0 },
    };
  }
  // Round: a smoothly rounded caudal fin, hand-tuned to a fixed profile
  // rather than generated by fan() — unlike the other fins it does not pick
  // up rarity jitter, and currently has no ray lines.
  return {
    d: "M 54.9 -10.9 C 58.9 -17.9 66.7 -23.4 74.7 -23.4 Q 83.5 -24.5 86.5 -14.0 Q 90.3 -3.5 85.7 4.6 Q 82.2 11.6 76.7 11.1 C 68.7 11.1 58.9 7.1 54.9 0.1 L 54.9 -10.9 Z",
    rays: [],
    pivot: { x: 53.0, y: -4.8 },
    tip: { x: 86.0, y: -4.8 },
    bbox: { x: 54.9, y: -23.4, width: 31.6, height: 34.5 },
  };
}

function dorsalGeom(dorsal: FishTraits["dorsal"], body: BodyId, geom: BodyGeom): FinShape {
  const shape: FinShape =
    dorsal === "sailfin"
      ? // The showpiece: a banner running most of the back, twice the standard
        // height, with a long wavy crest.
        {
          d: "M -18.6 -20.3 C -18.6 -38.3 -14.5 -64.0 -9.0 -53.0 Q -1.0 -69.5 3.4 -65.3 Q 8.5 -72.4 14.4 -68.3 Q 28.0 -72.5 27.0 -64.0 Q 40.0 -68.5 39.5 -55.5 Q 50.0 -58.5 46.0 -47.5 Q 57.5 -39.0 42.0 -29.0 L 36.4 -19.3 L -18.6 -20.3 Z",
          rays: [],
          pivot: { x: 12.4, y: -22.3 },
          tip: { x: 14.4, y: -68.3 },
          bbox: { x: -18.6, y: -68.3, width: 64.6, height: 49.0 },
        }
      : // Standard: a rounded back-leaning fan over the crest of the back,
        // scalloped down the trailing edge.
        {
          d: "M -4.2 -31.7 C -3.2 -44.7 5.0 -57.8 4.5 -47.8 Q 7.5 -53.6 13.8 -58.7 Q 21.0 -60.3 19.5 -53.3 Q 31.5 -53.8 25.5 -44.3 Q 37.5 -41.8 29.0 -36.8 L 24.8 -30.7 L -4.2 -31.7 Z",
          rays: [],
          pivot: { x: 12.8, y: -33.7 },
          tip: { x: 13.8, y: -58.7 },
          bbox: { x: -4.2, y: -58.7, width: 33.2, height: 28.0 },
        };
  // Root sinks 7 units past the back's crest — same margin the old
  // fan()-generated dorsal used (`base = backPeakY + 7`) — so it rides
  // up/forward with a taller, rounder body like balloon, and the body fill
  // drawn after it always buries the seam.
  const desiredRoot = {
    x: body === "balloon" ? geom.backPeak.x + 7 : geom.backPeak.x,
    y: dorsal === "sailfin" ? geom.backPeak.y + 7 : geom.backPeak.y,
  };
  return anchorFinRoot(shape, desiredRoot);
}

// Pelvics, anal, and pectoral are hand-tuned to a fixed profile rather than
// generated by fan() — like the round tail, they do not pick up rarity
// jitter and currently have no ray lines. Each is still anchored to the
// nearby body landmark so it moves with a non-standard silhouette.

function pelvicFarGeom(geom: BodyGeom): FinShape {
  const shape: FinShape = {
    d: "M -11.4 17.4 L -6.1 26.1 Q -6.1 30.5 -8.4 33.1 Q -9.9 37.2 -13.3 34.4 Q -16.1 37.7 -18.3 33.9 L -18.4 18.4 L -11.4 17.4 Z",
    rays: [],
    pivot: { x: -14.4, y: 20.4 },
    tip: { x: -10.7, y: 33.9 },
    bbox: { x: -18.4, y: 17.4, width: 12.3, height: 17.0 },
  };
  return anchorFinRoot(shape, { x: geom.bellyLow.x - 11.7, y: geom.bellyLow.y - 3 });
}

function pelvicGeom(geom: BodyGeom): FinShape {
  const shape: FinShape = {
    d: "M -1.6 18.3 L 7.9 29.7 Q 8.2 34.6 3.2 35.2 Q 1.8 40.0 -2.2 37.1 Q -5.2 41.0 -7.9 37.0 L -8.6 19.3 L -1.6 18.3 Z",
    rays: [],
    pivot: { x: -4.6, y: 21.3 },
    tip: { x: 0.6, y: 36.4 },
    bbox: { x: -8.6, y: 18.3, width: 16.5, height: 18.8 },
  };
  return anchorFinRoot(shape, { x: geom.bellyLow.x - 2, y: geom.bellyLow.y - 1 });
}

function analGeom(geom: BodyGeom): FinShape {
  const shape: FinShape = {
    d: "M 35.1 8.0 Q 31.0 10.0 39.0 11.0 Q 52.5 13.5 47.6 18.0 Q 53.1 21.0 48.6 22.5 Q 53.1 27.5 48.1 27.5 Q 51.1 35.0 42.1 28.5 L 25.6 15.0 L 35.1 8.0 Z",
    rays: [],
    pivot: { x: 27.6, y: 10.0 },
    tip: { x: 45.6, y: 30.0 },
    bbox: { x: 25.6, y: 8.0, width: 23.0, height: 20.5 },
  };
  return anchorFinRoot(shape, { x: geom.bellyLow.x + 30, y: geom.bellyLow.y - 16 });
}

function pectoralGeom(geom: BodyGeom): FinShape {
  const shape: FinShape = {
    d: "M -17.2 -4.3 L 1.3 0.7 Q 3.8 3.8 -1.5 5.9 Q 0.1 9.7 -3.9 8.8 Q -3.3 12.9 -6.9 11.0 Q -6.8 15.4 -9.8 12.7 L -12.2 5.7 L -17.2 -4.3 Z",
    rays: [],
    pivot: { x: -13.4, y: -1.4 },
    tip: { x: -3.9, y: 8.8 },
    bbox: { x: -17.2, y: -4.3, width: 18.5, height: 17.0 },
  };
  // Anchored to nose, same landmark the gill cover already scales off (`gx`).
  return anchorFinRoot(shape, { x: geom.nose.x + 32, y: -1.4 });
}

// ---------------------------------------------------------------------------
// Patterns.
// ---------------------------------------------------------------------------

/**
 * Local "which way does the skin curve here" angle (degrees), treating the
 * body as a squashed ellipse centered on its own bbox. Not literal geometry —
 * a cheap directional cue so glints/highlights placed anywhere on the flank
 * point the way real light would rake across curved scales, instead of every
 * glint on the fish sharing one fixed angle range.
 */
function curvatureTangentDeg(geom: BodyGeom, cx: number, cy: number): number {
  const cx0 = (geom.nose.x + geom.peduncleTop.x) / 2;
  const cy0 = (geom.backPeak.y + geom.bellyLow.y) / 2;
  const a = Math.max(1, (geom.peduncleTop.x - geom.nose.x) / 2);
  const b = Math.max(1, geom.halfHeight);
  const theta = Math.atan2((cy - cy0) / b, (cx - cx0) / a);
  return (theta * 180) / Math.PI + 90;
}

/**
 * Procedural metallic highlight streaks along the back, tangent to the local
 * curvature at each point (electric blue). Replaces a fixed pair of
 * hand-placed glow shapes with `count` rng-varied ones so the "iridescent"
 * read is a scattered set of reflections, like light catching curved scales,
 * rather than two fixed sparkle decals every electric blue fish shares.
 */
function curvatureHighlights(
  geom: BodyGeom,
  rng: () => number,
  count: number,
  opacityScale: number,
): Primitive[] {
  const bodyD = geom.d;
  const span = geom.peduncleTop.x - geom.nose.x;
  const archPeakT = (geom.backPeak.x - geom.nose.x) / span;
  const out: Primitive[] = [];
  for (let i = 0; i < count; i++) {
    const t = lerp(0.1, 0.9, (i + rng()) / count);
    const cx = lerp(geom.nose.x, geom.peduncleTop.x, t);
    // Highest (closest to the back's own y) near the arch's peak, sinking
    // toward mid-body at both the nose and peduncle ends.
    const nearPeak = 1 - Math.min(1, Math.abs(t - archPeakT) / 0.6);
    const cy = lerp(geom.backPeak.y * 0.35, geom.backPeak.y * 0.85, Math.max(0, nearPeak));
    const angleDeg = curvatureTangentDeg(geom, cx, cy);
    const len = lerp(6, 13, rng());
    const dx = (Math.cos(toRad(angleDeg)) * len) / 2;
    const dy = (Math.sin(toRad(angleDeg)) * len) / 2;
    out.push({
      kind: "path",
      d: `M ${f(cx - dx)} ${f(cy - dy)} L ${f(cx + dx)} ${f(cy + dy)}`,
      paint: { type: "solid", color: "#8ff7ff", opacity: lerp(0.32, 0.5, rng()) * opacityScale },
      stroke: { width: lerp(1.6, 2.6, rng()) },
      blend: "plusLighter",
      blur: lerp(1.4, 2.4, rng()),
      clip: bodyD,
    });
  }
  return out;
}

function patternPrimitives(
  def: ColorDef,
  geom: BodyGeom,
  material: Material,
  seed: number,
): Primitive[] {
  const pattern = def.pattern;
  const rng = makeRng(seededKey(`pattern-${def.id}`, seed));
  const out: Primitive[] = [];
  const bodyD = geom.d;
  const solid = (color: string, opacity = 1): Paint => ({
    type: "solid",
    color,
    opacity: Math.min(1, opacity * material.patternContrast),
  });
  const top = geom.backPeak.y;
  const bot = geom.bellyLow.y;
  const rear = geom.peduncleTop.x;

  switch (pattern.type) {
    case "solid":
      return out;

    case "spots": {
      const density = pattern.density ?? 1;
      const scale = pattern.scale ?? 1;
      const wobble = 0.45 * (pattern.randomness ?? 1);
      // Dalmatian: irregular blotches of mixed size, nothing over the face.
      const count = Math.max(1, Math.round(13 * density));
      for (let i = 0; i < count; i++) {
        const cx = lerp(geom.nose.x + 16, rear - 2, rng());
        const cy = lerp(top + 5, bot - 5, rng());
        if (cx < geom.nose.x + 24 && cy < 0) continue; // keep the face readable
        const r = lerp(2.2, 5.6, rng() * rng() + 0.3) * scale;
        out.push({
          kind: "path",
          d: blobPath(cx, cy, r, r * lerp(0.75, 1.15, rng()), wobble, rng),
          paint: solid(pattern.color, 0.92),
          // Just enough softness to kill the die-cut vector edge; a dalmatian
          // spot is still meant to read as crisp.
          blur: 0.9,
          clip: bodyD,
        });
      }
      if (pattern.onFins) {
        // Blotches spilling onto the caudal fan (unclipped — they sit on the fin).
        const finCount = Math.max(1, Math.round(5 * density));
        for (let i = 0; i < finCount; i++) {
          const cx = lerp(rear + 6, rear + 22, rng());
          const cy = lerp(-14, 14, rng());
          const r = lerp(1.6, 3.2, rng()) * scale;
          out.push({
            kind: "path",
            d: blobPath(cx, cy, r, r, wobble, rng),
            paint: solid(pattern.color, 0.72),
            blur: 0.8,
          });
        }
      }
      return out;
    }

    case "speckle": {
      // Gold Dust wears a dark head washing back into the metallic base. The
      // blur is what stops the wash reading as a visible gradient boundary.
      if (pattern.frontColor) {
        out.push({
          kind: "path",
          d: geom.d,
          paint: {
            type: "linear",
            from: { x: geom.nose.x, y: 0 },
            to: { x: 10, y: 0 },
            stops: [
              { offset: 0, color: rgba(pattern.frontColor, 0.97) },
              { offset: 0.45, color: rgba(pattern.frontColor, 0.85) },
              { offset: 1, color: rgba(pattern.frontColor, 0) },
            ],
          },
          blur: 2,
          clip: bodyD,
        });
      }
      const density = pattern.density ?? 1;
      const scale = pattern.scale ?? 1;
      const randomness = pattern.randomness ?? 1;
      const wide = pattern.spread === "body";
      const metallic = pattern.metallic === true;
      // Metallic varieties (Black Diamond) carry far fewer flecks than a
      // dusted pattern — the body needs to stay "primarily glossy black",
      // with icy fleck + reflected-light glints as an accent, not a coating.
      const count = Math.max(1, Math.round((metallic ? 14 : wide ? 26 : 22) * density));
      const place = (i: number) => {
        // Rear-weighted unless the variety is dusted all over (Black Diamond).
        const t = wide ? rng() : Math.sqrt(rng());
        const cx = lerp(wide ? geom.nose.x + 18 : -14, rear - 2, t);
        const span = lerp(bot - 2, 11, (cx - geom.nose.x) / (rear - geom.nose.x)) * randomness;
        return { cx, cy: lerp(-span, span, rng()), t };
      };
      for (let i = 0; i < count; i++) {
        const { cx, cy, t } = place(i);
        const r = lerp(1, 2.4, rng()) * scale;
        out.push({
          kind: "circle",
          cx,
          cy,
          r,
          paint: solid(
            pattern.color,
            (wide ? lerp(0.55, 0.95, rng()) : lerp(0.5, 0.95, t)) * (metallic ? 0.75 : 1),
          ),
          blur: r * 0.55,
        });
      }
      if (metallic) {
        // Reflected-light glints instead of painted dots: short tinted
        // streaks, plus-lighter blended, angled off the LOCAL body curvature
        // (not one fixed range for the whole fish) — reads as light catching
        // curved, reflective scales rather than dusted-on pigment.
        const glintCount = Math.max(1, Math.round(9 * density));
        for (let i = 0; i < glintCount; i++) {
          const { cx, cy } = place(i);
          const len = lerp(2.5, 5.5, rng()) * scale;
          const angleDeg = curvatureTangentDeg(geom, cx, cy) + lerp(-14, 14, rng()) * randomness;
          const dx = (Math.cos(toRad(angleDeg)) * len) / 2;
          const dy = (Math.sin(toRad(angleDeg)) * len) / 2;
          out.push({
            kind: "path",
            d: `M ${f(cx - dx)} ${f(cy - dy)} L ${f(cx + dx)} ${f(cy + dy)}`,
            paint: {
              type: "solid",
              color: lighten(pattern.color, 0.6),
              opacity: lerp(0.4, 0.75, rng()),
            },
            stroke: { width: lerp(0.6, 1.1, rng()) },
            blend: "plusLighter",
            blur: 0.4,
          });
        }
      } else {
        // A sparse pass of tiny hard dots, added light. This is what makes
        // the dusting read as metallic rather than as printed pigment.
        const dotCount = Math.max(1, Math.round(10 * density));
        for (let i = 0; i < dotCount; i++) {
          const { cx, cy } = place(i);
          out.push({
            kind: "circle",
            cx,
            cy,
            r: lerp(0.5, 1.1, rng()) * scale,
            paint: { type: "solid", color: "#ffffff", opacity: lerp(0.35, 0.75, rng()) },
            blend: "plusLighter",
          });
        }
      }
      return out;
    }

    case "stripes": {
      const density = pattern.density ?? 1;
      const scale = pattern.scale ?? 1;
      const randomness = pattern.randomness ?? 1;
      const clean = pattern.style === "clean";
      // An evenly-spaced bar skeleton (7 by default, `density` scales the
      // count) — then every bar's actual position, width, and lean are
      // rolled independently, so no two bars match.
      const barCount = Math.max(3, Math.round(7 * density));
      const skeleton = Array.from({ length: barCount }, (_, i) =>
        lerp(-28, 31, barCount === 1 ? 0.5 : i / (barCount - 1)),
      );
      const hi = top - 5;
      const lo = bot + 5;
      // Each bar is drawn twice: a wide soft halo under a tighter core. A real
      // bar on a fish has a shoulder where the pigment thins, not a cut edge.
      const bar = (d: string) => {
        out.push({ kind: "path", d, paint: solid(pattern.color, 0.5), blur: 1.6, clip: bodyD });
        out.push({ kind: "path", d, paint: solid(pattern.color, 0.92), blur: 0.35, clip: bodyD });
      };
      const fullBar = (x: number, w: number, lean: number) =>
        `M ${f(x - w)} ${f(hi)} Q ${f(x - w + lean)} 0 ${f(x - w - 1)} ${f(lo)} ` +
        `L ${f(x + w - 1)} ${f(lo)} Q ${f(x + w + lean)} 0 ${f(x + w)} ${f(hi)} Z`;
      const upperBar = (x: number, w: number, lean: number, jitter: number, gapTop: number) =>
        `M ${f(x - w + jitter)} ${f(hi)} Q ${f(x - w + lean)} ${f(top * 0.6)} ${f(x - w)} ${f(gapTop)} ` +
        `L ${f(x + w + jitter)} ${f(gapTop)} Q ${f(x + w + lean)} ${f(top * 0.6)} ${f(x + w)} ${f(hi)} Z`;
      const lowerBar = (x: number, w: number, lean: number, jitter: number, gapBottom: number) =>
        `M ${f(x - w)} ${f(gapBottom)} Q ${f(x - w + lean)} ${f(bot * 0.6)} ${f(x - w + jitter)} ${f(lo)} ` +
        `L ${f(x + w + jitter)} ${f(lo)} Q ${f(x + w + lean)} ${f(bot * 0.6)} ${f(x + w)} ${f(gapBottom)} Z`;

      for (const baseX of skeleton) {
        // Zebra: gentle position jitter so spacing reads as natural, not
        // ruled-off. Tiger: a touch more, since tiger stripes are already
        // meant to look irregular. `randomness` scales both.
        const jitterSpan = (clean ? 2 : 3) * randomness;
        const x = baseX + lerp(-jitterSpan, jitterSpan, rng());
        // Wider width range than before — "some stripes thinner, some
        // thicker" — and tiger's black stays a shade lighter on average so
        // the orange base stays dominant.
        const w = (clean ? lerp(1.7, 4.3, rng()) : lerp(1.5, 3.9, rng())) * scale;
        const lean = lerp(-3.6, -0.6, rng()) * randomness;

        if (clean) {
          // Zebra stays clean and even most of the time; occasionally a bar
          // breaks naturally near the belly or the dorsal edge — never both,
          // and never so wide it reads as "tiger". `randomness` also nudges
          // how often that happens.
          if (rng() < Math.min(0.9, 0.28 * randomness)) {
            const nearTop = rng() < 0.5;
            const gapSpan = lerp(3, 5.5, rng()) * randomness;
            const gapCenter = nearTop
              ? lerp(top * 0.7, top * 0.3, rng())
              : lerp(bot * 0.3, bot * 0.7, rng());
            const jitter = lerp(-1.2, 1.2, rng()) * randomness;
            bar(upperBar(x, w, lean, jitter, gapCenter - gapSpan / 2));
            bar(lowerBar(x, w, lean, jitter, gapCenter + gapSpan / 2));
          } else {
            bar(fullBar(x, w, lean));
          }
        } else {
          // Tiger: always broken, and irregularly so — width, gap size, and
          // gap position all vary per bar instead of following one template.
          const gapTop = lerp(-7.5, -1.5, rng()) * randomness;
          const gapBottom = gapTop + lerp(4, 10, rng()) * randomness;
          const jitter = lerp(-3, 3, rng()) * randomness;
          bar(upperBar(x, w, lean, jitter, gapTop));
          bar(lowerBar(x, w, lean, jitter, gapBottom));
        }
      }
      return out;
    }

    case "patches": {
      const [primary, secondary] = pattern.colors;
      const nx = geom.nose.x;
      const scale = pattern.scale ?? 1;
      const randomness = pattern.randomness ?? 1;
      // `density` has no effect here — each style's patches are a fixed,
      // hand-composed layout (koi head + 3 body patches, etc.), not a
      // loop-generated scatter, so "how many" isn't a meaningful knob.
      // `scale`/`randomness` still resize and reshape every patch below.
      const blob = (cx: number, cy: number, rx: number, ry: number, wobble: number) =>
        blobPath(cx, cy, rx * scale, ry * scale, wobble * randomness, rng);
      // Koi/calico patches are bold and near-hard-edged; "soft" (sakura) keeps
      // a soft transition but is toned down from a full blur wash so the
      // patches stay recognisable at small sizes instead of reading as a haze.
      const patchBlur = pattern.style === "soft" ? 2.2 : 1.1;
      const patch = (d: string, color: string, opacity: number) =>
        out.push({ kind: "path", d, paint: solid(color, opacity), blur: patchBlur, clip: bodyD });
      if (pattern.style === "koi") {
        // Sanke: a red hood over the front ~30-45% of the fish, and nothing
        // red further back, so the body still reads as pearl white with a
        // head accent rather than a Koi-style half-and-half split. The base
        // colour is true red (see catalog.ts) — "not bright saturated" comes
        // from opacity plus the volume-shading layers that sit on top of the
        // whole skin (softLight bloom, multiply shadow, screen gloss all
        // apply to this patch too), not from muting the hue itself.
        //
        // (rear = geom.peduncleTop.x, i.e. nose-to-peduncle body length is
        // `rear - nx`; the blob's rightmost point is cx + rx*jitter, jitter
        // in [0.91, 1.09] for wobble 0.18 — center + radius are picked so
        // that point lands around 35-39% even at the jitter extremes, safely
        // inside the 30-45% target with room for "approximately".)
        const bodyLen = rear - nx;
        patch(blob(nx + bodyLen * 0.2, -3, bodyLen * 0.17, bodyLen * 0.2, 0.16), primary, 0.82);
        // Several medium, well-spaced black patches — balanced, not busy.
        patch(blob(12, -16, 9, 7, 0.4), secondary ?? "#1c1e24", 0.9);
        patch(blob(-3, 4, 11, 9, 0.4), secondary ?? "#1c1e24", 0.9);
        patch(blob(27, 8, 9, 7, 0.4), secondary ?? "#1c1e24", 0.9);
        return out;
      }
      if (pattern.style === "calico") {
        // Trio: broad fields of orange and black over the white base, several
        // of them running off the edge of the body.
        patch(blob(-22, -11, 14, 13, 0.55), primary, 1);
        patch(blob(19, -7, 12, 12, 0.55), primary, 1);
        patch(blob(0, 14, 11, 10, 0.55), secondary ?? "#23262e", 0.96);
        patch(blob(nx + 20, 8, 8, 8, 0.55), secondary ?? "#23262e", 0.96);
        patch(blob(32, -13, 8, 7, 0.55), secondary ?? "#23262e", 0.9);
        return out;
      }
      // soft (sakura) — tighter wobble than koi/calico so the patch edges read
      // as an intentional shape rather than a blob, even under the blur.
      patch(blob(-15, -9, 13, 11, 0.3), primary, 0.94);
      patch(blob(14, 9, 12, 10, 0.3), secondary ?? primary, 0.9);
      patch(blob(28, -9, 9, 8, 0.3), primary, 0.9);
      patch(blob(nx + 18, 5, 8, 7, 0.3), secondary ?? primary, 0.8);
      return out;
    }

    case "custom": {
      // Hand-drawn shapes (yarn fish:colors) — literal, not procedural, so no
      // rng/tuning involved. `blob` reuses blobPath with wobble 0 for a clean
      // ellipse; `stroke` is a uniform-width line; `ribbon` is a pre-built
      // tapered outline (already a closed fill shape, no stroke width).
      for (const shape of pattern.shapes) {
        if (shape.kind === "blob") {
          out.push({
            kind: "path",
            d: blobPath(shape.cx, shape.cy, shape.rx, shape.ry, 0, () => 0),
            paint: solid(shape.color, shape.opacity ?? 0.9),
            clip: bodyD,
          });
        } else if (shape.kind === "stroke") {
          out.push({
            kind: "path",
            d: shape.d,
            paint: solid(shape.color, shape.opacity ?? 0.9),
            stroke: { width: shape.width },
            clip: bodyD,
          });
        } else {
          out.push({
            kind: "path",
            d: shape.d,
            paint: solid(shape.color, shape.opacity ?? 0.9),
            clip: bodyD,
          });
        }
      }
      return out;
    }
  }
}

interface Shimmer {
  /** Drawn inside the isolated skin group, under the volume shading. */
  base: Primitive;
  /**
   * Drawn AFTER the skin group, on top of gloss/bloom/shadow. The base
   * diagonal sweep is subtle enough to sit under the shading like the
   * original single-primitive shimmer did, but small targeted highlights
   * (Electric Blue's dorsal/tail glow) would be washed out there — the
   * softLight bloom and screen gloss band are large, high-opacity overlays
   * covering most of the upper flank.
   */
  accents: Primitive[];
}

function shimmerPrimitive(
  kind: ShimmerKind,
  geom: BodyGeom,
  material: Material,
  seed: number,
): Shimmer {
  const bodyD = geom.d;
  const stops =
    kind === "silver"
      ? [
          { offset: 0, color: "rgba(255,255,255,0)" },
          { offset: 0.5, color: "rgba(255,255,255,0.55)" },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ]
      : kind === "bluePurple"
        ? [
            { offset: 0, color: "rgba(148,116,255,0)" },
            { offset: 0.45, color: "rgba(148,116,255,0.85)" },
            { offset: 0.7, color: "rgba(90,148,255,0.7)" },
            { offset: 1, color: "rgba(148,116,255,0)" },
          ]
        : [
            { offset: 0, color: "rgba(126,224,255,0)" },
            { offset: 0.35, color: "rgba(126,224,255,0.6)" },
            { offset: 0.65, color: "rgba(255,255,255,0.5)" },
            { offset: 1, color: "rgba(126,224,255,0)" },
          ];
  // Higher-tier fish get a punchier shimmer, matching "strong metallic
  // reflections" (epic) / "premium gloss" (legendary) — ratioed off rare,
  // which is where this opacity was originally tuned.
  const opacity = Math.min(1, 0.8 * (material.bloom / 0.62));
  const base: Primitive = {
    kind: "path",
    d: "M -36 -14 C -12 -21 14 -18 34 -6 C 14 -9 -12 -12 -36 -11 Z",
    paint: { type: "linear", from: { x: -36, y: -14 }, to: { x: 34, y: -6 }, stops, opacity },
    clip: bodyD,
  };
  if (kind !== "iridescent") return { base, accents: [] };

  // Electric Blue: procedural cyan highlight streaks tangent to the body's
  // own curvature, scaled to this fish's rarity finish, on top of the base
  // diagonal sweep — so the "iridescent" read isn't two fixed decals every
  // electric blue fish shares, but a scattered set of reflections that
  // varies per fish while still tracking the back's curve.
  const rng = makeRng(seededKey("shimmer-iridescent", seed));
  const highlightBoost = material.bloom / 0.62;
  const accents = curvatureHighlights(geom, rng, 3 + Math.floor(rng() * 3), highlightBoost);
  return { base, accents };
}

/** 4-pointed sparkle/star outline, alternating outer/inner radius. */
function sparkleStarPath(cx: number, cy: number, r: number, rotDeg: number): string {
  const inner = r * 0.32;
  const pts: XY[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = toRad(rotDeg + i * 45);
    const rad = i % 2 === 0 ? r : inner;
    pts.push({ x: cx + Math.cos(angle) * rad, y: cy + Math.sin(angle) * rad });
  }
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${f(pts[i].x)} ${f(pts[i].y)}`;
  return d + " Z";
}

/**
 * Legendary-exclusive twinkle accent: a few small plus-lighter glints along
 * the upper flank. Every other tier's "premium" read comes from `Material`
 * scaling the same shading layers everyone has (gloss/bloom/rim/pattern
 * contrast) — legendary is the one tier that also gets a shape no other tier
 * draws at all, so the rarest fish reads as categorically special rather
 * than just the shiniest point on a continuous dial. Positions are derived
 * from body landmarks (not hardcoded), so this scales with balloon vs
 * standard body the same way the rest of the fin/gloss geometry does.
 */
function sparklePrimitives(geom: BodyGeom, tier: RarityTier, seed: number): Primitive[] {
  if (tier !== "legendary") return [];
  const rng = makeRng(seededKey(`sparkle-${tier}`, seed));
  const rear = geom.peduncleTop.x;
  const spots = [0.32, 0.5, 0.68].map((t) => ({
    x: lerp(geom.nose.x, rear, t),
    y: lerp(geom.backPeak.y * 0.75, -2, t * 0.6 + rng() * 0.2),
  }));
  const out: Primitive[] = [];
  for (const { x, y } of spots) {
    const r = lerp(2.6, 3.8, rng());
    const rot = lerp(0, 45, rng());
    out.push({
      kind: "path",
      d: sparkleStarPath(x, y, r, rot),
      paint: { type: "solid", color: "#ffffff", opacity: lerp(0.7, 0.92, rng()) },
      blend: "plusLighter",
      blur: 0.4,
      clip: geom.d,
    });
    out.push({
      kind: "circle",
      cx: x,
      cy: y,
      r: r * 0.3,
      paint: { type: "solid", color: "#fffdf2", opacity: 0.95 },
      blend: "plusLighter",
      blur: 0.3,
      clip: geom.d,
    });
  }
  return out;
}

/**
 * A grid of overlapping scallop arcs across the flank — real fish-scale rows,
 * not the placeholder it replaces (8 random near-invisible scribbles). Rows
 * run nose→tail offset like brick coursing (real scale rows overlap the same
 * way), and every scale is rotated to the body's local curvature via
 * `curvatureTangentDeg` — the same primitive the metallic speckle/shimmer
 * glints already use for the same reason — so rows sweep with the silhouette
 * instead of sitting flat against a curved body.
 *
 * Universal, not a `FishPattern` catalog trait: every fish has scales, so
 * this always runs, layered under whichever pattern/shimmer a colour defines
 * (matching how the scribble hack it replaces was always-on too).
 */
function scalePrimitives(def: ColorDef, geom: BodyGeom, bodyD: string, seed: number): Primitive[] {
  const rng = makeRng(seededKey(`scales-${def.id}`, seed));
  const { x: bx, y: by, width: bw, height: bh } = geom.bbox;

  // ~16 columns / ~7 rows across the body regardless of body variant, so
  // balloon (short, tall) and standard (long, shallow) both read as scaled
  // rather than one being sparse and the other dense.
  const cols = 16;
  const rows = 7;
  const colW = bw / cols;
  const rowH = bh / rows;
  // Depth of each scale's arc bulge — shallow, so it reads as a fine ripple
  // rather than a bold wave.
  const depth = rowH * 0.16;

  const out: Primitive[] = [];
  for (let r = 0; r < rows; r++) {
    const cy0 = by + rowH * (r + 0.5);
    // Half-column offset on odd rows: the brick-course overlap real scale
    // rows have, not a plain grid.
    const rowOffset = r % 2 === 0 ? 0 : colW / 2;
    for (let c = -1; c <= cols; c++) {
      const cx = bx + colW * (c + 0.5) + rowOffset;
      const cy = cy0 + lerp(-1, 1, rng()) * rowH * 0.08;
      const w = colW * lerp(0.85, 1.05, rng());
      const d = depth * lerp(0.75, 1.25, rng());

      // Rotate the canonical flat scallop — a shallow up-then-down double
      // arc spanning `w`, matching the shape (not just the intent) of the
      // scribble hack this replaces — to the body's local curvature so scale
      // rows sweep with the silhouette instead of sitting flat against it.
      const angle = toRad(curvatureTangentDeg(geom, cx, cy));
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rot = (lx: number, ly: number): XY => ({
        x: cx + lx * cosA - ly * sinA,
        y: cy + lx * sinA + ly * cosA,
      });
      const p0 = rot(-w / 2, 0);
      const c1 = rot(-w / 4, -d);
      const p1 = rot(0, 0);
      const c2 = rot(w / 4, d);
      const p2 = rot(w / 2, 0);

      out.push({
        kind: "path",
        d:
          `M ${f(p0.x)} ${f(p0.y)} Q ${f(c1.x)} ${f(c1.y)} ${f(p1.x)} ${f(p1.y)} ` +
          `Q ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`,
        paint: { type: "solid", color: "#000000", opacity: lerp(0.045, 0.07, rng()) },
        stroke: { width: w * 0.11 },
        clip: bodyD,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The spec builder.
// ---------------------------------------------------------------------------

export function buildFishSpec(traits: FishTraits, def: ColorDef): FishRenderSpec {
  const geom = bodyGeom(traits.body);
  const bodyD = geom.d;
  const px = geom.peduncleTop.x;
  // Which of this color's procedural pattern variants this individual fish
  // rolls — see the `patternSeed` doc comment on FishTraits.
  const seed = traits.patternSeed ?? 0;
  // Rarity-driven finish: how glossy/rim-lit/translucent-finned this fish
  // reads, and how "clean" its fin lobes are — see materialFor()'s header.
  const material = materialFor(def.rarity.tier);
  const tail = tailGeom(traits.tail, geom);
  const dorsal = dorsalGeom(traits.dorsal, traits.body, geom);
  const p = def.palette;
  const belly = geom.bellyLow.y;
  const bp = geom.backPeak.y;
  const outlineColor = darken(p.back, 0.45);

  // A fin is a translucent membrane stretched over rays, not a coloured shape
  // with lines drawn on top. So it is emitted as ONE group: the membrane fades
  // to genuinely transparent at the edge, the rays *multiply* through it, and a
  // sheen runs along the leading edge. The group's own opacity handles the
  // near/far dimming, which used to be pre-multiplied into three separate
  // paints.
  const finPaint = (shape: FinShape): Paint => ({
    type: "linear",
    from: shape.pivot,
    to: shape.tip,
    stops: [
      { offset: 0, color: rgba(darken(p.fin, 0.24), 0.98) },
      { offset: 0.55, color: rgba(p.fin, 0.93) },
      // Translucent at the trailing edge — the water shows through — but the
      // fin must still read as its own colour, so this stops well short of 0.
      // How far short is rarity-driven: common fins stay fairly opaque, epic
      // and legendary fins are noticeably more see-through.
      { offset: 1, color: rgba(lighten(p.fin, 0.18), material.finTrail) },
    ],
  });
  const pushFin = (out: Primitive[], shape: FinShape, alpha = 1, rayAlpha = 0.5) => {
    const children: Primitive[] = [
      { kind: "path", d: shape.d, paint: finPaint(shape) },
      // Rays darken the membrane rather than sitting on it. Clipped to the fin
      // so they cannot poke past the scalloped edge.
      ...shape.rays.map((d): Primitive => ({
        kind: "path",
        d,
        paint: { type: "solid", color: darken(p.finRay, 0.1), opacity: rayAlpha },
        stroke: { width: 1 },
        blend: "multiply",
        clip: shape.d,
      })),
      // A soft light catch along the root-to-tip axis.
      {
        kind: "path",
        d: shape.d,
        blend: "plusLighter",
        blur: 2,
        clip: shape.d,
        paint: {
          type: "linear",
          from: shape.pivot,
          to: shape.tip,
          stops: [
            { offset: 0, color: "rgba(255,255,255,0)" },
            { offset: 0.35, color: "rgba(255,255,255,0.13)" },
            { offset: 1, color: "rgba(255,255,255,0)" },
          ],
        },
      },
      {
        kind: "path",
        d: shape.d,
        paint: { type: "solid", color: outlineColor, opacity: 0.38 },
        stroke: { width: 1.2 },
      },
    ];
    out.push({ kind: "group", children, opacity: alpha, isolate: true });
  };

  const tailPrimitives: Primitive[] = [];
  pushFin(tailPrimitives, tail, 1, 0.46);

  const body: Primitive[] = [];

  // Fins that sit behind the body outline: dorsal above, pelvic + anal below.
  // Their roots are covered by the body fill drawn next.
  pushFin(body, dorsal);

  // Roots sit inside the silhouette, so only the fan below the belly shows.
  const pelvicFar = pelvicFarGeom(geom);
  const pelvic = pelvicGeom(geom);
  const anal = analGeom(geom);

  // The far-side pelvic reads as depth: same fin, pushed back and dimmed.
  pushFin(body, pelvicFar, 0.55, 0.22);
  pushFin(body, pelvic, 0.95);
  pushFin(body, anal, 0.95);

  // Everything painted onto the skin lives in ONE isolated group. Isolation is
  // a correctness requirement, not an optimisation: `overlay`/`softLight`/
  // `multiply` composite against their backdrop, and without a layer that
  // backdrop is the tank water, not the fish.
  //
  // The leading run of that group is also the fish's ALBEDO — its pigment,
  // with no lighting baked in. `skinAlbedo` captures exactly that run so the
  // 3D renderer can use it as a texture map and light it for real, instead of
  // inheriting 2D's painted-on highlights. Everything appended after the
  // `skin.push(...skinAlbedo)` below is volume/lighting and is 2D-only.
  const skinAlbedo: Primitive[] = [];

  // The base colour: back→belly gradient.
  skinAlbedo.push({
    kind: "path",
    d: geom.d,
    paint: {
      type: "linear",
      from: { x: 0, y: bp },
      to: { x: 0, y: belly },
      stops: [
        { offset: 0, color: p.back },
        { offset: 0.5, color: p.mid },
        { offset: 1, color: p.belly },
      ],
    },
  });

  // Pattern + shimmer sit directly on the base colour…
  skinAlbedo.push(...patternPrimitives(def, geom, material, seed));
  const shimmer = def.shimmer ? shimmerPrimitive(def.shimmer, geom, material, seed) : null;
  if (shimmer) skinAlbedo.push(shimmer.base);

  skinAlbedo.push(...scalePrimitives(def, geom, bodyD, seed));

  // Everything above is pigment. Hand it to the 2D skin stack unchanged, then
  // pile the volume/lighting on top — 2D output is identical to before the
  // albedo was split out, because this is the same sequence in the same order.
  const skin: Primitive[] = [...skinAlbedo];

  // …and the volume goes over the top of all of it.
  //
  // Light from above is a vertical ramp, so that stays linear — but it is now
  // carrying only the top-down component, at roughly half its old strength,
  // because the two radials below supply the actual roundness.
  skin.push({
    kind: "path",
    d: geom.d,
    paint: {
      type: "linear",
      from: { x: 0, y: bp },
      to: { x: 0, y: belly },
      stops: [
        { offset: 0, color: "rgba(0,0,0,0.30)" },
        { offset: 0.1, color: "rgba(0,0,0,0.05)" },
        { offset: 0.34, color: "rgba(255,255,255,0.0)" },
        { offset: 0.6, color: "rgba(0,0,0,0.04)" },
        { offset: 0.84, color: "rgba(255,255,255,0.13)" },
        { offset: 0.94, color: "rgba(255,255,255,0.02)" },
        { offset: 1, color: "rgba(0,0,0,0.24)" },
      ],
    },
  });

  // The airbrushed core: a wide elliptical bloom over the upper flank. Soft
  // light *lightens the colour that is already there* instead of washing it
  // toward grey the way a plain white overlay does — that difference is most of
  // what separates "illustrated" from "flat vector". Peak strength is
  // rarity-driven: near-matte at common, a strong sheen at legendary.
  skin.push({
    kind: "path",
    d: geom.d,
    blend: "softLight",
    paint: {
      type: "radial",
      center: { x: -8, y: bp * 0.45 },
      radius: geom.halfHeight * 1.7,
      scale: { x: 2.4, y: 1 },
      stops: [
        { offset: 0, color: `rgba(255,255,255,${material.bloom})` },
        { offset: 0.55, color: `rgba(255,255,255,${(material.bloom * 0.48).toFixed(2)})` },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });

  // Depth at the rear and under the belly. Warm-dark rather than black, so the
  // shadow keeps the body's own hue instead of going muddy.
  const shadowTone = darken(p.back, 0.6);
  skin.push({
    kind: "path",
    d: geom.d,
    blend: "multiply",
    paint: {
      type: "radial",
      center: { x: px * 0.6, y: belly * 0.7 },
      radius: geom.halfHeight * 1.9,
      scale: { x: 1.5, y: 1 },
      stops: [
        { offset: 0, color: rgba(shadowTone, 0.5) },
        { offset: 0.6, color: rgba(shadowTone, 0.16) },
        { offset: 1, color: rgba(shadowTone, 0) },
      ],
    },
  });

  // A soft gloss band along the upper flank — blurred, so it has no edge to
  // give itself away. This is the wet highlight the reference art leans on;
  // rarity scales its strength ("matte" at common, "premium gloss" at
  // legendary).
  skin.push({
    kind: "path",
    d: geom.d,
    blend: "screen",
    blur: 4,
    clip: bodyD,
    paint: {
      type: "linear",
      from: { x: 0, y: bp * 0.9 },
      to: { x: 0, y: bp * 0.1 },
      stops: [
        { offset: 0, color: "rgba(255,255,255,0)" },
        { offset: 0.45, color: `rgba(255,255,255,${material.gloss})` },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });

  body.push({ kind: "group", children: skin, isolate: true });

  // Gill cover: a lighter cheek plate with a hard trailing edge.
  const gx = geom.nose.x + 21; // operculum trailing edge, scaled off the snout
  body.push({
    kind: "path",
    d:
      `M ${f(gx)} ${f(bp + 7)} C ${f(gx + 7)} ${f(bp + 15)} ${f(gx + 7)} 6 ${f(gx)} 15 ` +
      `C ${f(gx - 10)} 13 ${f(gx - 17)} 4 ${f(gx - 18)} -4 ` +
      `C ${f(gx - 18)} -12 ${f(gx - 11)} ${f(bp + 8)} ${f(gx)} ${f(bp + 7)} Z`,
    paint: { type: "solid", color: "#ffffff", opacity: 0.16 },
    clip: bodyD,
  });
  body.push({
    kind: "path",
    d: `M ${f(gx)} ${f(bp + 7)} C ${f(gx + 7)} ${f(bp + 15)} ${f(gx + 7)} 6 ${f(gx)} 15`,
    paint: { type: "solid", color: outlineColor, opacity: 0.6 },
    stroke: { width: 1.7 },
    clip: bodyD,
  });

  // The contour that makes the whole thing read as illustration. `multiply`
  // rather than a flat dark stroke: it darkens while keeping the body's own
  // hue, so the outline sits *in* the fish instead of on top of it.
  body.push({
    kind: "path",
    d: geom.d,
    paint: { type: "solid", color: outlineColor, opacity: 0.6 },
    stroke: { width: 2.2 },
    blend: "multiply",
  });

  // Rim light: a bright edge along the top and rear, where the key light wraps
  // around the silhouette. Clipped to the body so only the inner half of the
  // stroke survives, and masked by a ramp so it fades out before the belly.
  // Peak strength is rarity-driven — minimal at common, "bright rim lighting"
  // at legendary.
  body.push({
    kind: "path",
    d: geom.d,
    stroke: { width: 2 },
    blend: "plusLighter",
    blur: 0.8,
    clip: bodyD,
    paint: {
      type: "linear",
      from: { x: geom.nose.x, y: belly },
      to: { x: px, y: bp },
      stops: [
        { offset: 0, color: "rgba(255,255,255,0)" },
        { offset: 0.55, color: `rgba(255,255,255,${(material.rim * 0.32).toFixed(2)})` },
        { offset: 1, color: `rgba(255,255,255,${material.rim})` },
      ],
    },
  });

  // Shimmer accents (Electric Blue's dorsal/tail glow) land here — on top of
  // every shading layer, so they read as bright highlights instead of being
  // absorbed into the gloss/bloom underneath.
  if (shimmer?.accents.length) body.push(...shimmer.accents);

  // Legendary-exclusive sparkle accent — see sparklePrimitives().
  body.push(...sparklePrimitives(geom, def.rarity.tier, seed));

  // Pectoral fin: a small translucent membrane just behind the gill cover,
  // angled down and back. Drawn separately from `body` (see `front` on
  // FishRenderSpec) so it can be baked and animated on its own.
  const pectoral = pectoralGeom(geom);
  const front: Primitive[] = [];
  pushFin(front, pectoral, 0.6, 0.26);

  // The little upturned molly mouth, right at the snout tip: a dark crease
  // with a lip highlight above it.
  const nx = geom.nose.x;
  const ny = geom.nose.y;
  body.push({
    kind: "path",
    d: `M ${f(nx + 0.5)} ${f(ny + 3)} C ${f(nx + 3)} ${f(ny + 4.5)} ${f(nx + 6)} ${f(ny + 5.5)} ${f(nx + 9)} ${f(ny + 5.5)}`,
    paint: { type: "solid", color: "#000000", opacity: 0.5 },
    stroke: { width: 1.6 },
    clip: bodyD,
  });
  body.push({
    kind: "path",
    d: `M ${f(nx + 1)} ${f(ny + 1)} C ${f(nx + 4)} ${f(ny + 2)} ${f(nx + 7)} ${f(ny + 2.5)} ${f(nx + 10)} ${f(ny + 2.5)}`,
    paint: { type: "solid", color: "#ffffff", opacity: 0.28 },
    stroke: { width: 1.3 },
    clip: bodyD,
  });

  // The eye: high and forward — still the most recognisable feature, but
  // sized down ~17% from the original so it reads as cute rather than
  // dominating the face. Cream ring, dark rim, wide pupil, one clean primary
  // catchlight and a much subtler secondary rather than two equally strong
  // ones — a single crisp highlight reads better at small sizes than two.
  const eye = { cx: nx + 19, cy: -9 };
  const r = 5.3;
  body.push({ kind: "circle", ...eye, r, paint: { type: "solid", color: "#f6f2e8" } });
  body.push({
    kind: "path",
    d: `M ${f(eye.cx - r)} ${f(eye.cy)} a ${r} ${r} 0 1 0 ${f(r * 2)} 0 a ${r} ${r} 0 1 0 ${f(-r * 2)} 0`,
    paint: { type: "solid", color: "#12161f", opacity: 0.9 },
    stroke: { width: 1.1 },
  });
  body.push({ kind: "circle", ...eye, r: 3.6, paint: { type: "solid", color: "#0b0e14" } });
  body.push({
    kind: "circle",
    cx: eye.cx - 1.6,
    cy: eye.cy - 1.7,
    r: 1.5,
    paint: { type: "solid", color: "#f9fcff", opacity: 0.98 },
  });
  body.push({
    kind: "circle",
    cx: eye.cx + 1.5,
    cy: eye.cy + 1.7,
    r: 0.75,
    paint: { type: "solid", color: "#f9fcff", opacity: 0.4 },
  });

  // Every drawn shape contributes; the pad covers strokes and soft edges.
  const bounds = inflateBox(
    [tail.bbox, dorsal.bbox, pelvicFar.bbox, pelvic.bbox, anal.bbox, pectoral.bbox].reduce(
      unionBox,
      geom.bbox,
    ),
    BOUNDS_PAD,
  );

  return {
    tail: tailPrimitives,
    tailPivot: { x: px, y: 1 },
    body,
    front,
    pectoralPivot: pectoral.pivot,
    skinAlbedo,
    bodyPathD: geom.d,
    silhouetteDs: [tail.d, dorsal.d, pelvicFar.d, pelvic.d, anal.d, geom.d, pectoral.d],
    bodyHalfHeight: geom.halfHeight,
    bounds,
    tailBounds: inflateBox(tail.bbox, BOUNDS_PAD),
    frontBounds: inflateBox(pectoral.bbox, BOUNDS_PAD),
  };
}

/**
 * Union of `bounds` across every trait combination, so a gallery can frame all
 * fish identically. Patterns never escape the body clip or the fin shapes, so
 * any `def` yields the same answer — pass whichever is handy.
 */
export function maxFishBounds(def: ColorDef): Box {
  const bodies: FishTraits["body"][] = ["standard", "balloon"];
  const tails: FishTraits["tail"][] = ["round", "lyretail"];
  const dorsals: FishTraits["dorsal"][] = ["standard", "sailfin"];
  let box: Box | null = null;
  for (const body of bodies) {
    for (const tail of tails) {
      for (const dorsal of dorsals) {
        const { bounds } = buildFishSpec({ color: def.id, body, tail, dorsal }, def);
        box = box ? unionBox(box, bounds) : bounds;
      }
    }
  }
  return box!;
}
