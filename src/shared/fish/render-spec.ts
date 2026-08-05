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

import { seedFromString } from "../lib/seed";

import type { ColorDef, FishTraits, RarityTier, ShimmerKind } from "./types";

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

function boxOfPoints(points: XY[], pad = 0): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

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
// ---------------------------------------------------------------------------

function makeRng(key: string): () => number {
  let state = Math.floor(seedFromString(key) * 4294967296) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const f = (n: number) => n.toFixed(1);
const toRad = (deg: number) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Color helpers — the reference art shades every fin off its own base hue.
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex: string, target: readonly [number, number, number], t: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const hx = rgb
    .map((v, i) =>
      Math.round(v + (target[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hx}`;
}

const darken = (hex: string, t: number) => mix(hex, [0, 0, 0], t);
const lighten = (hex: string, t: number) => mix(hex, [255, 255, 255], t);

function rgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex) ?? [255, 255, 255];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

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

// ---------------------------------------------------------------------------
// Fin construction: lobed (scalloped) edges and radial fans.
// ---------------------------------------------------------------------------

/**
 * Path segments running through `notches`, bowing each span outward (away from
 * `pivot`) by `bulge`. Reads as rounded fin lobes separated by sharp notches —
 * the scalloped trailing edge every fin in the reference art has.
 */
function lobedEdge(notches: XY[], pivot: XY, bulge: number): string {
  let d = "";
  for (let i = 1; i < notches.length; i++) {
    const a = notches[i - 1];
    const b = notches[i];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = mx - pivot.x;
    const dy = my - pivot.y;
    const len = Math.hypot(dx, dy) || 1;
    // A quadratic deviates half its control offset, so double the bulge.
    d += ` Q ${f(mx + (dx / len) * bulge * 2)} ${f(my + (dy / len) * bulge * 2)} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

interface FanOpts {
  pivot: XY;
  radius: number;
  /** Sweep in degrees, y-down (negative = up, 0 = straight back). */
  from: number;
  to: number;
  lobes: number;
  bulge: number;
  rootTop: XY;
  rootBottom: XY;
  /** Control point bending the root→first-notch leading edge. */
  lead?: XY;
  /**
   * 0..~0.15, from the rarity material. Perturbs each notch's angle and
   * radius so lobes stop being perfectly even — "organic" at common, nearly
   * imperceptible at legendary. Needs `rng` to have any effect.
   */
  jitter?: number;
  rng?: () => number;
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

/** A radial fin fan (tail, pectoral, pelvic, anal) with its ray lines. */
function fan(opts: FanOpts): FinShape {
  const { pivot, radius, from, to, lobes, bulge, rootTop, rootBottom, jitter, rng } = opts;
  const at = (deg: number, r: number): XY => ({
    x: pivot.x + Math.cos(toRad(deg)) * r,
    y: pivot.y + Math.sin(toRad(deg)) * r,
  });

  const notches: XY[] = [];
  for (let i = 0; i <= lobes; i++) {
    const baseDeg = from + ((to - from) * i) / lobes;
    // Independent per-notch angle + radius wobble — enough at `jitter` ~0.12
    // (common) to break the perfectly-even fan; nearly zero by ~0.02
    // (legendary), which is what "cleaner fin shapes" means here.
    const degJitter = jitter && rng ? (rng() - 0.5) * jitter * 14 : 0;
    const radiusFactor = jitter && rng ? 1 + (rng() - 0.5) * jitter * 0.6 : 1;
    notches.push(at(baseDeg + degJitter, radius * radiusFactor));
  }

  let d = `M ${f(rootTop.x)} ${f(rootTop.y)}`;
  d += opts.lead
    ? ` Q ${f(opts.lead.x)} ${f(opts.lead.y)} ${f(notches[0].x)} ${f(notches[0].y)}`
    : ` L ${f(notches[0].x)} ${f(notches[0].y)}`;
  d += lobedEdge(notches, pivot, bulge);
  d += ` L ${f(rootBottom.x)} ${f(rootBottom.y)} Z`;

  // Rays run most of the way out — the reference art shows them almost to the
  // scalloped edge, which is what makes a fin read as a fin and not a blob.
  const rays: string[] = [];
  for (let i = 0; i < lobes; i++) {
    const deg = from + ((to - from) * (i + 0.5)) / lobes;
    const a = at(deg, radius * 0.14);
    const b = at(deg, radius * 0.92);
    rays.push(`M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}`);
  }
  // `bulge` pushes each span outward past its notches, and jitter can push a
  // notch further still — pad for both.
  const bbox = boxOfPoints(
    [...notches, rootTop, rootBottom, pivot],
    bulge * 2 + (jitter ?? 0) * radius * 0.3,
  );
  return { d, rays, pivot, tip: at((from + to) / 2, radius), bbox };
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
      d:
        "M -40 -1 " +
        "C -40 -13 -33 -22 -22 -27 " +
        "C -10 -32 5 -31 16 -25 " +
        "C 24 -20 30 -13 33 -9 " +
        "C 35 -8 36 -8 36 -6 " +
        "L 36 9 " +
        "C 36 11 35 11 33 12 " +
        "C 30 17 24 24 14 29 " +
        "C 1 35 -16 31 -28 22 " +
        "C -36 16 -40 7 -40 -1 Z",
      nose: { x: -40, y: -1 },
      backPeak: { x: -4, y: -31 },
      bellyLow: { x: -5, y: 32 },
      peduncleTop: { x: 36, y: -6 },
      peduncleBottom: { x: 36, y: 9 },
      halfHeight: 33,
      bbox: { x: -40, y: -33, width: 76, height: 68 },
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
    d:
      "M -61 -4 " +
      "C -60 -12 -53 -16 -43 -18 " +
      "C -29 -22 -10 -23 6 -22 " +
      "C 20 -20 31 -15 39 -9 " +
      "C 41 -9 43 -8 43 -6 " +
      "L 43 7 " +
      "C 43 9 41 9 39 10 " +
      "C 31 16 20 20 6 22 " +
      "C -13 23 -32 20 -45 12 " +
      "C -54 9 -60 3 -61 -4 Z",
    nose: { x: -61, y: -4 },
    backPeak: { x: -3, y: -22 },
    bellyLow: { x: -5, y: 22 },
    peduncleTop: { x: 43, y: -6 },
    peduncleBottom: { x: 43, y: 7 },
    halfHeight: 23,
    bbox: { x: -61, y: -23, width: 104, height: 46 },
  };
}

function tailGeom(
  tail: FishTraits["tail"],
  geom: BodyGeom,
  jitter?: number,
  rng?: () => number,
): FinShape {
  const top = geom.peduncleTop;
  const bottom = geom.peduncleBottom;
  const px = top.x;
  if (tail === "lyretail") {
    // A lyre: a full fan whose top and bottom corners draw out into points,
    // leaving a shallow concave sweep between them. Sized down ~20% from the
    // original so it reads as a fin rather than a second body lobe.
    const q = (dx: number) => f(px + dx);
    return {
      d:
        `M ${f(px)} ${f(top.y + 1)} ` +
        `C ${q(8)} -11 ${q(15)} -19 ${q(24)} -29 ` +
        `C ${q(21)} -19 ${q(18)} -10 ${q(17)} -1 ` +
        `C ${q(18)} 8 ${q(21)} 18 ${q(24)} 27 ` +
        `C ${q(15)} 18 ${q(8)} 10 ` +
        `${f(px)} ${f(bottom.y - 1)} Z`,
      rays: [
        `M ${q(2)} ${f(top.y + 2)} C ${q(9)} -10 ${q(15)} -18 ${q(22)} -26`,
        `M ${q(2)} -3 C ${q(7)} -7 ${q(11)} -12 ${q(14)} -17`,
        `M ${q(2)} -1 C ${q(7)} -1 ${q(11)} -1 ${q(15)} -1`,
        `M ${q(2)} 2 C ${q(7)} 6 ${q(11)} 10 ${q(14)} 15`,
        `M ${q(2)} ${f(bottom.y - 2)} C ${q(9)} 9 ${q(15)} 16 ${q(22)} 24`,
      ],
      pivot: { x: px, y: 0 },
      tip: { x: px + 17, y: -1 },
      // The lyre's two drawn-out corners are the extreme points of the literal.
      bbox: boxOfPoints([
        { x: px, y: -29 },
        { x: px + 24, y: 27 },
      ]),
    };
  }
  // Round: the big scalloped paddle of the reference art. Sized down ~20% from
  // the original — still generous, but it no longer dominates the body.
  return fan({
    pivot: { x: px, y: 0 },
    radius: 25,
    from: -68,
    to: 68,
    lobes: 7,
    bulge: 2.8,
    rootTop: { x: px, y: top.y + 1 },
    rootBottom: { x: px, y: bottom.y - 1 },
    jitter,
    rng,
  });
}

/** Nudges a hand-placed notch point by a small rarity-scaled random offset. */
function jitterPt(p: XY, jitter?: number, rng?: () => number): XY {
  if (!jitter || !rng) return p;
  return { x: p.x + (rng() - 0.5) * jitter * 6, y: p.y + (rng() - 0.5) * jitter * 6 };
}

function dorsalGeom(
  dorsal: FishTraits["dorsal"],
  backPeakY: number,
  jitter?: number,
  rng?: () => number,
): FinShape {
  // Sits low enough that the body fill buries the root — no floating seam.
  const base = backPeakY + 7;
  if (dorsal === "sailfin") {
    // The showpiece: a banner running most of the back, twice the standard
    // height, with a long wavy crest.
    const pivot: XY = { x: 1, y: base };
    const notches: XY[] = [
      { x: -18, y: base - 34 },
      { x: -8, y: base - 43 },
      { x: 3, y: base - 46 },
      { x: 13, y: base - 44 },
      { x: 22, y: base - 37 },
      { x: 28, y: base - 24 },
      { x: 30, y: base - 9 },
    ].map((p) => jitterPt(p, jitter, rng));
    return {
      d:
        `M -30 ${f(base + 2)} ` +
        `C -30 ${f(base - 16)} -27 ${f(base - 28)} ${f(notches[0].x)} ${f(notches[0].y)} ` +
        lobedEdge(notches, pivot, 2.8) +
        ` L 25 ${f(base + 3)} Z`,
      bbox: boxOfPoints(
        [...notches, { x: -30, y: base + 3 }, { x: 25, y: base + 3 }],
        2.8 * 2 + (jitter ?? 0) * 8,
      ),
      rays: [
        `M -23 ${f(base)} C -23 ${f(base - 14)} -22 ${f(base - 25)} -18 ${f(base - 33)}`,
        `M -15 ${f(base)} C -14 ${f(base - 16)} -12 ${f(base - 29)} -9 ${f(base - 40)}`,
        `M -6 ${f(base)} C -5 ${f(base - 17)} -3 ${f(base - 31)} -1 ${f(base - 43)}`,
        `M 3 ${f(base)} C 5 ${f(base - 17)} 7 ${f(base - 30)} 9 ${f(base - 42)}`,
        `M 11 ${f(base)} C 13 ${f(base - 16)} 16 ${f(base - 27)} 18 ${f(base - 37)}`,
        `M 18 ${f(base + 1)} C 21 ${f(base - 11)} 24 ${f(base - 21)} 26 ${f(base - 30)}`,
      ],
      pivot,
      tip: { x: 3, y: base - 46 },
    };
  }
  // Standard: a rounded back-leaning fan over the crest of the back, scalloped
  // down the trailing edge.
  const pivot: XY = { x: -4, y: base };
  const notches: XY[] = [
    { x: -10, y: base - 23 },
    { x: -3, y: base - 25 },
    { x: 4, y: base - 22 },
    { x: 9, y: base - 15 },
    { x: 11, y: base - 6 },
  ].map((p) => jitterPt(p, jitter, rng));
  return {
    d:
      `M -21 ${f(base + 2)} ` +
      `C -20 ${f(base - 11)} -16 ${f(base - 19)} ${f(notches[0].x)} ${f(notches[0].y)} ` +
      lobedEdge(notches, pivot, 2.4) +
      ` L 8 ${f(base + 3)} Z`,
    bbox: boxOfPoints(
      [...notches, { x: -21, y: base + 3 }, { x: 8, y: base + 3 }],
      2.4 * 2 + (jitter ?? 0) * 8,
    ),
    rays: [
      `M -16 ${f(base)} C -15 ${f(base - 9)} -13 ${f(base - 16)} -11 ${f(base - 22)}`,
      `M -9 ${f(base)} C -8 ${f(base - 10)} -6 ${f(base - 18)} -4 ${f(base - 23)}`,
      `M -2 ${f(base)} C 0 ${f(base - 9)} 2 ${f(base - 16)} 4 ${f(base - 20)}`,
      `M 4 ${f(base + 1)} C 6 ${f(base - 6)} 8 ${f(base - 10)} 9 ${f(base - 14)}`,
    ],
    pivot,
    tip: { x: -3, y: base - 25 },
  };
}

// ---------------------------------------------------------------------------
// Patterns.
// ---------------------------------------------------------------------------

function patternPrimitives(def: ColorDef, geom: BodyGeom, material: Material): Primitive[] {
  const pattern = def.pattern;
  const rng = makeRng(`pattern-${def.id}`);
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
      // Dalmatian: irregular blotches of mixed size, nothing over the face.
      for (let i = 0; i < 13; i++) {
        const cx = lerp(geom.nose.x + 16, rear - 2, rng());
        const cy = lerp(top + 5, bot - 5, rng());
        if (cx < geom.nose.x + 24 && cy < 0) continue; // keep the face readable
        const r = lerp(2.2, 5.6, rng() * rng() + 0.3);
        out.push({
          kind: "path",
          d: blobPath(cx, cy, r, r * lerp(0.75, 1.15, rng()), 0.45, rng),
          paint: solid(pattern.color, 0.92),
          // Just enough softness to kill the die-cut vector edge; a dalmatian
          // spot is still meant to read as crisp.
          blur: 0.9,
          clip: bodyD,
        });
      }
      if (pattern.onFins) {
        // Blotches spilling onto the caudal fan (unclipped — they sit on the fin).
        for (let i = 0; i < 5; i++) {
          const cx = lerp(rear + 6, rear + 22, rng());
          const cy = lerp(-14, 14, rng());
          const r = lerp(1.6, 3.2, rng());
          out.push({
            kind: "path",
            d: blobPath(cx, cy, r, r, 0.45, rng),
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
      const wide = pattern.spread === "body";
      const metallic = pattern.metallic === true;
      // Metallic varieties (Black Diamond) carry far fewer flecks than a
      // dusted pattern — the body needs to stay "primarily glossy black",
      // with icy fleck + reflected-light glints as an accent, not a coating.
      const count = metallic ? 14 : wide ? 26 : 22;
      const place = (i: number) => {
        // Rear-weighted unless the variety is dusted all over (Black Diamond).
        const t = wide ? rng() : Math.sqrt(rng());
        const cx = lerp(wide ? geom.nose.x + 18 : -14, rear - 2, t);
        const span = lerp(bot - 2, 11, (cx - geom.nose.x) / (rear - geom.nose.x));
        return { cx, cy: lerp(-span, span, rng()), t };
      };
      for (let i = 0; i < count; i++) {
        const { cx, cy, t } = place(i);
        const r = lerp(1, 2.4, rng());
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
        // streaks, plus-lighter blended, angled as if catching one light
        // source — reads as glossy surface sheen rather than dusted pigment.
        for (let i = 0; i < 9; i++) {
          const { cx, cy } = place(i);
          const len = lerp(2.5, 5.5, rng());
          const ang = lerp(-32, 8, rng());
          const dx = (Math.cos(toRad(ang)) * len) / 2;
          const dy = (Math.sin(toRad(ang)) * len) / 2;
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
        for (let i = 0; i < 10; i++) {
          const { cx, cy } = place(i);
          out.push({
            kind: "circle",
            cx,
            cy,
            r: lerp(0.5, 1.1, rng()),
            paint: { type: "solid", color: "#ffffff", opacity: lerp(0.35, 0.75, rng()) },
            blend: "plusLighter",
          });
        }
      }
      return out;
    }

    case "stripes": {
      const clean = pattern.style === "clean";
      // A 7-bar skeleton, evenly spaced — then every bar's actual position,
      // width, and lean are rolled independently, so no two bars match.
      const skeleton = [-28, -18, -8, 2, 12, 22, 31];
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
        // meant to look irregular.
        const x = baseX + lerp(clean ? -2 : -3, clean ? 2 : 3, rng());
        // Wider width range than before — "some stripes thinner, some
        // thicker" — and tiger's black stays a shade lighter on average so
        // the orange base stays dominant.
        const w = clean ? lerp(1.7, 4.3, rng()) : lerp(1.5, 3.9, rng());
        const lean = lerp(-3.6, -0.6, rng());

        if (clean) {
          // Zebra stays clean and even most of the time; occasionally a bar
          // breaks naturally near the belly or the dorsal edge — never both,
          // and never so wide it reads as "tiger".
          if (rng() < 0.28) {
            const nearTop = rng() < 0.5;
            const gapSpan = lerp(3, 5.5, rng());
            const gapCenter = nearTop
              ? lerp(top * 0.7, top * 0.3, rng())
              : lerp(bot * 0.3, bot * 0.7, rng());
            const jitter = lerp(-1.2, 1.2, rng());
            bar(upperBar(x, w, lean, jitter, gapCenter - gapSpan / 2));
            bar(lowerBar(x, w, lean, jitter, gapCenter + gapSpan / 2));
          } else {
            bar(fullBar(x, w, lean));
          }
        } else {
          // Tiger: always broken, and irregularly so — width, gap size, and
          // gap position all vary per bar instead of following one template.
          const gapTop = lerp(-7.5, -1.5, rng());
          const gapBottom = gapTop + lerp(4, 10, rng());
          const jitter = lerp(-3, 3, rng());
          bar(upperBar(x, w, lean, jitter, gapTop));
          bar(lowerBar(x, w, lean, jitter, gapBottom));
        }
      }
      return out;
    }

    case "patches": {
      const [primary, secondary] = pattern.colors;
      const nx = geom.nose.x;
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
        patch(
          blobPath(nx + bodyLen * 0.2, -3, bodyLen * 0.17, bodyLen * 0.2, 0.16, rng),
          primary,
          0.82,
        );
        // Several medium, well-spaced black patches — balanced, not busy.
        patch(blobPath(12, -16, 9, 7, 0.4, rng), secondary ?? "#1c1e24", 0.9);
        patch(blobPath(-3, 4, 11, 9, 0.4, rng), secondary ?? "#1c1e24", 0.9);
        patch(blobPath(27, 8, 9, 7, 0.4, rng), secondary ?? "#1c1e24", 0.9);
        return out;
      }
      if (pattern.style === "calico") {
        // Trio: broad fields of orange and black over the white base, several
        // of them running off the edge of the body.
        patch(blobPath(-22, -11, 14, 13, 0.55, rng), primary, 1);
        patch(blobPath(19, -7, 12, 12, 0.55, rng), primary, 1);
        patch(blobPath(0, 14, 11, 10, 0.55, rng), secondary ?? "#23262e", 0.96);
        patch(blobPath(nx + 20, 8, 8, 8, 0.55, rng), secondary ?? "#23262e", 0.96);
        patch(blobPath(32, -13, 8, 7, 0.55, rng), secondary ?? "#23262e", 0.9);
        return out;
      }
      // soft (sakura) — tighter wobble than koi/calico so the patch edges read
      // as an intentional shape rather than a blob, even under the blur.
      patch(blobPath(-15, -9, 13, 11, 0.3, rng), primary, 0.94);
      patch(blobPath(14, 9, 12, 10, 0.3, rng), secondary ?? primary, 0.9);
      patch(blobPath(28, -9, 9, 8, 0.3, rng), primary, 0.9);
      patch(blobPath(nx + 18, 5, 8, 7, 0.3, rng), secondary ?? primary, 0.8);
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

function shimmerPrimitive(kind: ShimmerKind, geom: BodyGeom, material: Material): Shimmer {
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

  // Electric Blue: two extra targeted cyan highlights — along the dorsal
  // ridge and over the peduncle/tail root — on top of the base diagonal
  // sweep, so the "iridescent" read isn't just one sliver but a metallic
  // body with brighter accents where a real fish would catch the light.
  const dorsalGlow: Primitive = {
    kind: "path",
    d:
      `M ${f(geom.backPeak.x - 14)} ${f(geom.backPeak.y + 5)} ` +
      `Q ${f(geom.backPeak.x)} ${f(geom.backPeak.y - 5)} ${f(geom.backPeak.x + 17)} ${f(geom.backPeak.y + 3)}`,
    paint: { type: "solid", color: "#7ff2ff", opacity: 0.5 * (material.bloom / 0.62) },
    stroke: { width: 3 },
    blend: "plusLighter",
    blur: 2.2,
    clip: bodyD,
  };
  const tailGlow: Primitive = {
    kind: "path",
    d: `M ${f(geom.peduncleTop.x - 10)} ${f(geom.peduncleTop.y + 3)} L ${f(geom.peduncleTop.x + 3)} 0`,
    paint: { type: "solid", color: "#8ff7ff", opacity: 0.46 * (material.bloom / 0.62) },
    stroke: { width: 2.6 },
    blend: "plusLighter",
    blur: 1.8,
    clip: bodyD,
  };
  return { base, accents: [dorsalGlow, tailGlow] };
}

// ---------------------------------------------------------------------------
// The spec builder.
// ---------------------------------------------------------------------------

export function buildFishSpec(traits: FishTraits, def: ColorDef): FishRenderSpec {
  const geom = bodyGeom(traits.body);
  const bodyD = geom.d;
  const px = geom.peduncleTop.x;
  // Rarity-driven finish: how glossy/rim-lit/translucent-finned this fish
  // reads, and how "clean" its fin lobes are — see materialFor()'s header.
  const material = materialFor(def.rarity.tier);
  const finRng = makeRng(`fin-${def.id}`);
  const tail = tailGeom(traits.tail, geom, material.finJitter, finRng);
  const dorsal = dorsalGeom(traits.dorsal, geom.backPeak.y, material.finJitter, finRng);
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
  const pelvicFar = fan({
    pivot: { x: -22, y: belly - 8 },
    radius: 14,
    from: 44,
    to: 106,
    lobes: 3,
    bulge: 1.8,
    rootTop: { x: -19, y: belly - 11 },
    rootBottom: { x: -26, y: belly - 10 },
    jitter: material.finJitter,
    rng: finRng,
  });
  const pelvic = fan({
    pivot: { x: -17, y: belly - 5 },
    radius: 16,
    from: 40,
    to: 102,
    lobes: 3,
    bulge: 2,
    rootTop: { x: -14, y: belly - 8 },
    rootBottom: { x: -21, y: belly - 7 },
    jitter: material.finJitter,
    rng: finRng,
  });
  const anal = fan({
    pivot: { x: 9, y: belly - 5 },
    radius: 19,
    from: 22,
    to: 90,
    lobes: 4,
    bulge: 2.4,
    rootTop: { x: 15, y: belly - 10 },
    rootBottom: { x: 5, y: belly - 8 },
    jitter: material.finJitter,
    rng: finRng,
  });

  // The far-side pelvic reads as depth: same fin, pushed back and dimmed.
  pushFin(body, pelvicFar, 0.55, 0.22);
  pushFin(body, pelvic, 0.95);
  pushFin(body, anal, 0.95);

  // Everything painted onto the skin lives in ONE isolated group. Isolation is
  // a correctness requirement, not an optimisation: `overlay`/`softLight`/
  // `multiply` composite against their backdrop, and without a layer that
  // backdrop is the tank water, not the fish.
  const skin: Primitive[] = [];

  // The base colour: back→belly gradient.
  skin.push({
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
  skin.push(...patternPrimitives(def, geom, material));
  const shimmer = def.shimmer ? shimmerPrimitive(def.shimmer, geom, material) : null;
  if (shimmer) skin.push(shimmer.base);

  // Sparse scale scribbles across the flank.
  const scaleRng = makeRng(`scales-${def.id}`);
  for (let i = 0; i < 8; i++) {
    const x = lerp(-18, 30, scaleRng());
    const y = lerp(-14, 14, scaleRng());
    skin.push({
      kind: "path",
      d: `M ${f(x)} ${f(y)} q 1.8 -2.2 3.6 0 q 1.8 2.2 3.6 0`,
      paint: { type: "solid", color: "#000000", opacity: 0.055 },
      stroke: { width: 0.7 },
      clip: bodyD,
    });
  }

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

  // Pectoral fin: a small translucent membrane just behind the gill cover,
  // angled down and back.
  const pectoral = fan({
    pivot: { x: gx + 4, y: -1 },
    radius: 14,
    from: 16,
    to: 78,
    lobes: 4,
    bulge: 1.8,
    rootTop: { x: gx + 2, y: -5 },
    rootBottom: { x: gx + 8, y: 2 },
    jitter: material.finJitter,
    rng: finRng,
  });
  pushFin(body, pectoral, 0.6, 0.26);

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
    bodyPathD: geom.d,
    silhouetteDs: [tail.d, dorsal.d, pelvicFar.d, pelvic.d, anal.d, geom.d, pectoral.d],
    bodyHalfHeight: geom.halfHeight,
    bounds,
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
