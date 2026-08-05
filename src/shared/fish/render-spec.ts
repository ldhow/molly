// Pure fish-drawing module: builds a declarative list of primitives (SVG path
// strings + paint descriptions) for a given trait combination. Consumed by BOTH
// the Skia renderer (fish-sprite.tsx, via Skia.Path.MakeFromSVGString) and the
// HTML preview generator (scripts/fish-preview.ts) — so previews match the app
// by construction.
//
// MUST stay free of React/React Native/Skia imports: it runs under plain Node.
//
// This is a FLAT VECTOR style — bold uniform outlines, flat colour, no
// gradients/blur/blend modes — so the IR is deliberately narrow: a `Paint` is
// just a colour + opacity, and a primitive is a filled-or-stroked path/circle,
// or a group (for opacity only). Every feature below must be expressible in
// BOTH backends, or the preview stops being evidence about the app:
//
//   feature          Skia                       SVG preview
//   ---------------- -------------------------- ----------------------------
//   fill             Path/Circle color          fill
//   stroke           style="stroke" strokeWidth stroke / fill="none"
//   clip             <Group clip>               <clipPath>
//   group opacity    <Group opacity>            <g opacity>
//
// Deliberately NOT in the IR (this was tried and reverted — see git history
// for the airbrushed/gradient version if reviving any of this):
//   gradients, blur (mask or image), blend modes, isolate — none of them read
//   as "flat vector clip art"; they were the whole airbrushed style this file
//   moved away from. Add any of them back only with a documented SVG story.
//
// Local space: origin at body center, nose pointing LEFT (-x), y down.
// Adult footprint ≈ x [-52..70], y [-67 (sailfin tip)..42 (anal fin tip)].
//
// Art direction: flat vector clip-art / coloring-book style. A chunky molly
// with a blunt snout and a deep belly; a bold uniform-weight outline around
// the body AND separately around every fin lobe, so fins read as distinct
// attached pieces rather than blending into the body; short dash-mark rays
// on every fin instead of full gradient membranes; one flat shadow shape and
// one flat "sticker shine" shape for roundness, no gradients/blur/blend.
// Rolled traits carry the drama: `tail:"lyretail"` + `dorsal:"sailfin"` are
// the showy veiltail-betta silhouette; the common `standard`/`round` roll
// stays calmer. Rarity shows via fin tint, shadow/shine strength, and — rare
// tier and up — a coloured ring around the eye in the variety's accent hue.

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

/**
 * A flat fill/stroke colour. Not a union — this style has no gradients,
 * blur, or blend modes, so there is nothing else a paint could be.
 */
export interface Paint {
  color: string;
  opacity?: number;
}

interface DrawCommon {
  paint: Paint;
  /**
   * SVG path `d` to clip to — pass `spec.bodyPathD` for the body silhouette, or
   * a fin's own `d` to keep a highlight inside that fin. Both emitters memoise
   * by string identity, so reusing one variable costs a single clip object.
   */
  clip?: string;
  /**
   * Render as a stroked outline instead of a fill. Works on both `path` and
   * `circle` — the flat-vector style outlines fin lobes, the body, and the
   * eye ring all the same way.
   */
  stroke?: { width: number };
}

export type Primitive =
  | ({ kind: "path"; d: string } & DrawCommon)
  | ({ kind: "circle"; cx: number; cy: number; r: number } & DrawCommon)
  | { kind: "group"; children: Primitive[]; clip?: string; opacity?: number };

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
 * Slack added around the raw geometry for stroke width and the shadow/shine
 * blobs. Kept generous — over-reporting bounds costs a few transparent
 * pixels, while under-reporting visibly clips a shape at the edge.
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
    { kind: "circle", cx: 0, cy: 0, r: EGG_RADIUS, paint: { color: "#f6e3b0", opacity: 0.92 } },
    { kind: "circle", cx: -3.5, cy: -4, r: 3.5, paint: { color: "#fff7e0", opacity: 0.9 } },
    { kind: "circle", cx: 2, cy: 2, r: 4.4, paint: { color: "#e0a24e" } },
  ];
}

export function eggSilhouetteSpec(): Primitive[] {
  return [{ kind: "circle", cx: 0, cy: 0, r: EGG_RADIUS, paint: { color: SILHOUETTE_COLOR } }];
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

// ---------------------------------------------------------------------------
// Rarity material — how "premium" a fish's finish reads, independent of its
// pattern. Every field here is a flat-vector-compatible knob (opacity or
// count, never a gradient/blur/blend strength) — common is plain and
// matte-reading, legendary gets a coloured eye-ring accent and the most
// pronounced shine/shadow/fin-tint.
// ---------------------------------------------------------------------------

export interface Material {
  /** Fan/dorsal notch wobble. LOWER is cleaner/more refined. */
  finJitter: number;
  /** Multiplier on pattern-primitive opacities — richer contrast at higher tiers. */
  patternContrast: number;
  /** How far the fin's flat fill lightens from its base tone. Higher reads as more delicate. */
  finTint: number;
  /** Sticker-shine shape opacity — the flat "premium gloss" cue. */
  shine: number;
  /** Shadow-blob opacity — a little more contrast/dimension at higher tiers. */
  shadow: number;
  /** Eye-ring accent stroke opacity, in the variety's `accentColor`. 0 = no ring. */
  eyeRing: number;
}

const MATERIAL_BY_TIER: Record<RarityTier, Material> = {
  common: {
    finJitter: 0.13,
    patternContrast: 1,
    finTint: 0.06,
    shine: 0.35,
    shadow: 0.16,
    eyeRing: 0,
  },
  uncommon: {
    finJitter: 0.09,
    patternContrast: 1.03,
    finTint: 0.1,
    shine: 0.45,
    shadow: 0.19,
    eyeRing: 0,
  },
  rare: {
    finJitter: 0.06,
    patternContrast: 1.08,
    finTint: 0.16,
    shine: 0.55,
    shadow: 0.22,
    eyeRing: 0.5,
  },
  epic: {
    finJitter: 0.035,
    patternContrast: 1.14,
    finTint: 0.22,
    shine: 0.65,
    shadow: 0.25,
    eyeRing: 0.8,
  },
  legendary: {
    finJitter: 0.02,
    patternContrast: 1.2,
    finTint: 0.3,
    shine: 0.75,
    shadow: 0.28,
    eyeRing: 1,
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
    // Short and deep-bellied — the balloon molly of the reference sheet — but
    // a stretched oval, not a circle: ~1.5:1 length-to-depth, with a longer,
    // more gradual approach into both the head and the caudal peduncle (extra
    // control points throughout, no single sharp transition) and a peduncle
    // wide enough that the tail has real material to grow out of.
    return {
      d:
        "M -48 -1 " +
        "C -49 -9 -46 -17 -38 -22 " +
        "C -28 -28 -14 -30 0 -29 " +
        "C 14 -28 26 -24 34 -18 " +
        "C 39 -15 42 -11 46 -6 " +
        "C 47 -2 47 3 46 7 " +
        "C 45 12 42 16 35 21 " +
        "C 27 26 14 30 0 31 " +
        "C -14 32 -28 30 -38 24 " +
        "C -46 19 -49 11 -48 -1 Z",
      nose: { x: -48, y: -1 },
      backPeak: { x: 0, y: -29 },
      bellyLow: { x: 0, y: 31 },
      peduncleTop: { x: 47, y: -8 },
      peduncleBottom: { x: 47, y: 9 },
      halfHeight: 32,
      bbox: { x: -49, y: -32, width: 96, height: 64 },
    };
  }
  // Standard: ~2.25:1 length-to-depth — elongated enough to read as a molly
  // rather than a goldfish/pufferfish silhouette. A blunt rounded snout, a
  // back that crests just ahead of centre, a belly carrying the volume, and a
  // full, gently-tapering rear that bulges into a wide, ROUNDED caudal
  // peduncle — no straight wall and no corner where the taper meets it (the
  // previous version had both, and they poked out as a visible notch once
  // the tail's own hub-based root sat inside it). The peduncle reads as one
  // smooth continuation of the belly curve, wide enough that the tail has
  // real material to grow out of.
  return {
    d:
      "M -61 -4 " +
      "C -60 -12 -53 -16 -43 -18 " +
      "C -29 -22 -10 -23 6 -22 " +
      "C 20 -20 32 -16 40 -11 " +
      "C 44 -11 46 -8 46 -1 " +
      "C 46 6 44 11 39 13 " +
      "C 32 18 20 20 6 22 " +
      "C -13 23 -32 20 -45 12 " +
      "C -54 9 -60 3 -61 -4 Z",
    nose: { x: -61, y: -4 },
    backPeak: { x: -3, y: -22 },
    bellyLow: { x: -5, y: 22 },
    peduncleTop: { x: 46, y: -8 },
    peduncleBottom: { x: 46, y: 9 },
    halfHeight: 23,
    bbox: { x: -61, y: -23, width: 107, height: 46 },
  };
}

function tailGeom(
  tail: FishTraits["tail"],
  geom: BodyGeom,
  jitter?: number,
  rng?: () => number,
): FinShape {
  const px = geom.peduncleTop.x;
  // The tail's hub sits well inside the body silhouette rather than right at
  // its edge — the body is drawn on top and its opaque fill buries everything
  // from the hub out to the peduncle edge, so the tail reads as growing out
  // of the body instead of butting against a hard vertical seam. Animation
  // stays safe: rotation happens about this same hub point (see `tailPivot`
  // in buildFishSpec), so the hidden portion never swings out from cover.
  const hx = px - 11;
  if (tail === "lyretail") {
    // Two long flowing points with a deep, soft V between them — sized down
    // ~16% from the previous pass (it was reading as oversized) and rebuilt
    // with extra control points throughout so every vertex is a gentle curve
    // rather than a hard corner: both tips round off instead of coming to a
    // sharp triangle, and the waist gets its own short easing curve instead
    // of being a single cusp where the two lobes meet.
    const q = (dx: number) => f(px + dx);
    const h = (dx: number) => f(hx + dx);
    return {
      d:
        `M ${h(0)} 0 ` +
        `C ${q(1)} -14 ${q(13)} -27 ${q(21)} -34 ` +
        `C ${q(27)} -39 ${q(31)} -41 ${q(32)} -38 ` +
        `C ${q(31)} -35 ${q(27)} -30 ${q(20)} -22 ` +
        `C ${q(14)} -15 ${q(9)} -8 ${q(7)} -1 ` +
        `C ${q(6.5)} 0 ${q(6.5)} 1 ${q(7)} 2 ` +
        `C ${q(9)} 9 ${q(14)} 16 ${q(20)} 23 ` +
        `C ${q(27)} 31 ${q(31)} 36 ${q(32)} 39 ` +
        `C ${q(31)} 42 ${q(27)} 40 ${q(21)} 35 ` +
        `C ${q(13)} 28 ${q(1)} 15 ${h(0)} 0 Z`,
      rays: [
        `M ${h(0)} 0 C ${q(2)} -15 ${q(13)} -27 ${q(25)} -35`,
        `M ${h(0)} 0 C ${q(2)} -7 ${q(8)} -12 ${q(13)} -18`,
        `M ${h(0)} 0 C ${q(2)} -1 ${q(7)} -1 ${q(12)} -1`,
        `M ${h(0)} 0 C ${q(2)} 7 ${q(8)} 12 ${q(13)} 18`,
        `M ${h(0)} 0 C ${q(2)} 15 ${q(13)} 27 ${q(25)} 35`,
      ],
      pivot: { x: hx, y: 0 },
      tip: { x: px + 32, y: -1 },
      // The lyre's two rounded points are the extreme reach of the literal.
      bbox: boxOfPoints([
        { x: hx, y: -42 },
        { x: px + 32, y: 42 },
      ]),
    };
  }
  // Round: the big scalloped paddle of the reference art, hubbed the same way
  // as the lyretail. Sized down to match (radius trimmed so the visible reach
  // from the body edge drops ~16%, same as the lyretail).
  return fan({
    pivot: { x: hx, y: 0 },
    radius: 32,
    from: -68,
    to: 68,
    lobes: 7,
    bulge: 2.8,
    rootTop: { x: hx, y: -3 },
    rootBottom: { x: hx, y: 4 },
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
        lobedEdge(notches, pivot, 3.6) +
        ` L 25 ${f(base + 3)} Z`,
      bbox: boxOfPoints(
        [...notches, { x: -30, y: base + 3 }, { x: 25, y: base + 3 }],
        3.6 * 2 + (jitter ?? 0) * 8,
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
  // Standard: taller and wavier than the old "small fan" — still calmer than
  // sailfin, but reads as a deliberately flat-vector dorsal on its own, not
  // just a stub. One more notch than before for a wavier crest.
  const pivot: XY = { x: -4, y: base };
  const notches: XY[] = [
    { x: -12, y: base - 31 },
    { x: -6, y: base - 36 },
    { x: 1, y: base - 33 },
    { x: 7, y: base - 27 },
    { x: 11, y: base - 17 },
    { x: 13, y: base - 8 },
  ].map((p) => jitterPt(p, jitter, rng));
  return {
    d:
      `M -23 ${f(base + 2)} ` +
      `C -22 ${f(base - 14)} -18 ${f(base - 24)} ${f(notches[0].x)} ${f(notches[0].y)} ` +
      lobedEdge(notches, pivot, 3) +
      ` L 10 ${f(base + 3)} Z`,
    bbox: boxOfPoints(
      [...notches, { x: -23, y: base + 3 }, { x: 10, y: base + 3 }],
      3 * 2 + (jitter ?? 0) * 8,
    ),
    rays: [
      `M -18 ${f(base)} C -17 ${f(base - 12)} -15 ${f(base - 22)} -13 ${f(base - 30)}`,
      `M -10 ${f(base)} C -9 ${f(base - 14)} -7 ${f(base - 24)} -5 ${f(base - 31)}`,
      `M -2 ${f(base)} C 0 ${f(base - 12)} 2 ${f(base - 22)} 4 ${f(base - 27)}`,
      `M 5 ${f(base + 1)} C 7 ${f(base - 8)} 9 ${f(base - 14)} 10 ${f(base - 19)}`,
    ],
    pivot,
    tip: { x: -6, y: base - 36 },
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
      // Flat fill, hard edge — a die-cut sticker patch, not an airbrushed one.
      for (let i = 0; i < 13; i++) {
        const cx = lerp(geom.nose.x + 16, rear - 2, rng());
        const cy = lerp(top + 5, bot - 5, rng());
        if (cx < geom.nose.x + 24 && cy < 0) continue; // keep the face readable
        const r = lerp(2.2, 5.6, rng() * rng() + 0.3);
        out.push({
          kind: "path",
          d: blobPath(cx, cy, r, r * lerp(0.75, 1.15, rng()), 0.45, rng),
          paint: solid(pattern.color, 0.92),
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
          });
        }
      }
      return out;
    }

    case "speckle": {
      // Gold Dust wears a dark head cap washing back into the metallic base.
      // Flat style has no gradient wash, so this is now a hard-edged patch —
      // the same "cap" device the koi/calico patterns already use below.
      if (pattern.frontColor) {
        out.push({
          kind: "path",
          d: blobPath(geom.nose.x + 12, 0, 16, geom.halfHeight * 0.9, 0.22, rng),
          paint: solid(pattern.frontColor, 0.95),
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
        });
      }
      if (metallic) {
        // Reflected-light glints instead of painted dots: short tinted flat
        // streaks angled as if catching one light source — reads as glossy
        // surface sheen rather than dusted pigment.
        for (let i = 0; i < 9; i++) {
          const { cx, cy } = place(i);
          const len = lerp(2.5, 5.5, rng());
          const ang = lerp(-32, 8, rng());
          const dx = (Math.cos(toRad(ang)) * len) / 2;
          const dy = (Math.sin(toRad(ang)) * len) / 2;
          out.push({
            kind: "path",
            d: `M ${f(cx - dx)} ${f(cy - dy)} L ${f(cx + dx)} ${f(cy + dy)}`,
            paint: { color: lighten(pattern.color, 0.6), opacity: lerp(0.55, 0.9, rng()) },
            stroke: { width: lerp(0.7, 1.2, rng()) },
          });
        }
      } else {
        // A sparse pass of tiny flat highlight dots, lighter than the base
        // colour. This is what makes the dusting read as metallic rather
        // than as printed pigment.
        for (let i = 0; i < 10; i++) {
          const { cx, cy } = place(i);
          out.push({
            kind: "circle",
            cx,
            cy,
            r: lerp(0.5, 1.1, rng()),
            paint: { color: lighten(pattern.color, 0.7), opacity: lerp(0.5, 0.85, rng()) },
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
      // One flat fill per bar — no soft halo, this is ink on a fish, not an
      // airbrushed pigment gradient.
      const bar = (d: string) =>
        out.push({ kind: "path", d, paint: solid(pattern.color, 0.94), clip: bodyD });
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
      // Koi/calico patches are bold and hard-edged. "Soft" (sakura) has no
      // blur to fall back on in a flat style, so it stays distinct through
      // fewer, smaller patches at a lower fixed opacity instead — a lighter
      // touch rather than a softer edge.
      const patch = (d: string, color: string, opacity: number) =>
        out.push({ kind: "path", d, paint: solid(color, opacity), clip: bodyD });
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
      // soft (sakura) — smaller, fewer, and lower-opacity than koi/calico so
      // the pastel read survives without blur to fall back on.
      patch(blobPath(-15, -9, 9, 8, 0.3, rng), primary, 0.72);
      patch(blobPath(16, 8, 8, 7, 0.3, rng), secondary ?? primary, 0.68);
      patch(blobPath(29, -8, 6, 5, 0.3, rng), primary, 0.68);
      return out;
    }
  }
}

interface Shimmer {
  /** Tint the sticker-shine shape (built in buildFishSpec) uses. */
  tint: string;
  /**
   * Iridescent (Electric Blue) only: flat accent dashes along the dorsal
   * ridge and tail root, on top of everything else, so the metallic read
   * comes from more than one highlight the way a real reflective fish would.
   */
  accents: Primitive[];
}

function shimmerPrimitive(kind: ShimmerKind, geom: BodyGeom): Shimmer {
  const bodyD = geom.d;
  const tint = kind === "silver" ? "#ffffff" : kind === "bluePurple" ? "#9474ff" : "#7ee9ff";
  if (kind !== "iridescent") return { tint, accents: [] };

  const dorsalGlow: Primitive = {
    kind: "path",
    d: `M ${f(geom.backPeak.x - 12)} ${f(geom.backPeak.y + 5)} L ${f(geom.backPeak.x + 12)} ${f(geom.backPeak.y + 2)}`,
    paint: { color: "#7ff2ff", opacity: 0.85 },
    stroke: { width: 2.4 },
    clip: bodyD,
  };
  const tailGlow: Primitive = {
    kind: "path",
    d: `M ${f(geom.peduncleTop.x - 9)} ${f(geom.peduncleTop.y + 3)} L ${f(geom.peduncleTop.x + 2)} 0`,
    paint: { color: "#8ff7ff", opacity: 0.8 },
    stroke: { width: 2 },
    clip: bodyD,
  };
  return { tint, accents: [dorsalGlow, tailGlow] };
}

// ---------------------------------------------------------------------------
// The spec builder.
// ---------------------------------------------------------------------------

// A fixed ink colour across every palette — the reference art's outline is
// bold and uniform-weight across the whole roster, which reads as one fixed
// ink, not a per-fish tint.
const OUTLINE_COLOR = "#181818";

export function buildFishSpec(traits: FishTraits, def: ColorDef): FishRenderSpec {
  const geom = bodyGeom(traits.body);
  const bodyD = geom.d;
  const px = geom.peduncleTop.x;
  // Rarity-driven finish: how "clean" fin lobes are, and (Section D) how
  // premium the sticker-shine/pattern read — see materialFor()'s header.
  const material = materialFor(def.rarity.tier);
  const finRng = makeRng(`fin-${def.id}`);
  const tail = tailGeom(traits.tail, geom, material.finJitter, finRng);
  const dorsal = dorsalGeom(traits.dorsal, geom.backPeak.y, material.finJitter, finRng);
  const p = def.palette;
  const belly = geom.bellyLow.y;
  const bp = geom.backPeak.y;

  // A fin is a flat coloured membrane with a bold outline and a handful of
  // ray-line strokes — no gradient, no translucency. Rarity still shows: the
  // flatter/lighter the fill (`finTint`, replacing what used to be a
  // trailing-edge alpha fade), the more "delicate" the fin reads.
  const finTint = lighten(p.fin, material.finTint);
  const pushFin = (out: Primitive[], shape: FinShape) => {
    out.push({
      kind: "group",
      children: [
        { kind: "path", d: shape.d, paint: { color: finTint } },
        // Ray lines, clipped to the fin so they can't poke past the scalloped
        // edge — decorative line detail, not a gradient membrane.
        ...shape.rays.map((d): Primitive => ({
          kind: "path",
          d,
          paint: { color: darken(p.finRay, 0.15), opacity: 0.55 },
          stroke: { width: 0.9 },
          clip: shape.d,
        })),
        { kind: "path", d: shape.d, paint: { color: OUTLINE_COLOR }, stroke: { width: 1.6 } },
      ],
    });
  };

  const tailPrimitives: Primitive[] = [];
  pushFin(tailPrimitives, tail);

  const body: Primitive[] = [];

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

  // Fins that grow FROM the body — dorsal, pelvics, anal — are pushed BEFORE
  // the body fill/outline, not after. Every one of their roots sits well
  // inside the silhouette (see each fin's own root coordinates above and in
  // dorsalGeom), so the opaque body fill + contour drawn on top buries the
  // root entirely: no competing outline, no hard seam, and the body's own
  // shadow/shine naturally "continues" onto the fin base because that patch
  // of the fin base literally IS body surface. Only the free outer part of
  // each fin — the part beyond the body's edge — ends up visible, with its
  // own outline, reading as one continuous creature rather than parts glued
  // together. (The tail gets the same treatment via z-order in fish-sprite.tsx
  // — its group renders before the body already — plus a hub root deep
  // inside the peduncle, built in tailGeom.)
  pushFin(body, dorsal);
  pushFin(body, pelvicFar);
  pushFin(body, pelvic);
  pushFin(body, anal);

  // The body: one flat fill.
  body.push({ kind: "path", d: geom.d, paint: { color: p.mid } });

  // Pattern + shimmer sit directly on the flat base…
  body.push(...patternPrimitives(def, geom, material));
  const shimmer = def.shimmer ? shimmerPrimitive(def.shimmer, geom) : null;

  // …then ONE flat shadow shape gives it roundness and ONE flat sticker-shine
  // shape gives it a premium read — both hard-edged, no blur/gradient. This
  // replaces what used to be a four-primitive gradient shading stack, and
  // because it's drawn AFTER the fin roots above, it visibly "continues" onto
  // the buried fin bases rather than stopping short at the body edge.
  const shadowRng = makeRng(`shadow-${def.id}`);
  body.push({
    kind: "path",
    d: blobPath(
      px * 0.55,
      belly * 0.55,
      geom.halfHeight * 1.1,
      geom.halfHeight * 0.75,
      0.35,
      shadowRng,
    ),
    paint: { color: p.back, opacity: material.shadow },
    clip: bodyD,
  });
  const shineRng = makeRng(`shine-${def.id}`);
  body.push({
    kind: "path",
    d: blobPath(bp * 0.3, bp * 0.55, geom.halfHeight * 0.7, geom.halfHeight * 0.4, 0.3, shineRng),
    paint: { color: shimmer?.tint ?? p.belly, opacity: material.shine },
    clip: bodyD,
  });

  // The contour that makes the whole thing read as illustration — ONE
  // continuous stroke around the body silhouette. Fin outlines never cross
  // it because their roots are buried underneath; only the outer, free part
  // of each fin carries its own outline, so this line is the fish's one
  // uninterrupted boundary.
  body.push({ kind: "path", d: geom.d, paint: { color: OUTLINE_COLOR }, stroke: { width: 2.4 } });

  // Gill cover: a lighter cheek plate with a hard trailing edge.
  const gx = geom.nose.x + 21; // operculum trailing edge, scaled off the snout
  body.push({
    kind: "path",
    d:
      `M ${f(gx)} ${f(bp + 7)} C ${f(gx + 7)} ${f(bp + 15)} ${f(gx + 7)} 6 ${f(gx)} 15 ` +
      `C ${f(gx - 10)} 13 ${f(gx - 17)} 4 ${f(gx - 18)} -4 ` +
      `C ${f(gx - 18)} -12 ${f(gx - 11)} ${f(bp + 8)} ${f(gx)} ${f(bp + 7)} Z`,
    paint: { color: p.belly, opacity: 0.5 },
    clip: bodyD,
  });
  body.push({
    kind: "path",
    d: `M ${f(gx)} ${f(bp + 7)} C ${f(gx + 7)} ${f(bp + 15)} ${f(gx + 7)} 6 ${f(gx)} 15`,
    paint: { color: OUTLINE_COLOR, opacity: 0.75 },
    stroke: { width: 1.4 },
    clip: bodyD,
  });

  // Shimmer accents (Electric Blue's dorsal/tail glow) land here — on top of
  // every shading layer, so they read as bright highlights.
  if (shimmer?.accents.length) body.push(...shimmer.accents);

  // Pectoral fin: drawn on top of the body (it's the one fin a real fish's
  // silhouette doesn't hide), so instead of burying its root it's positioned
  // to overlap INTO the gill cover — root pulled back and up so it visibly
  // rests against the body/gill curve rather than floating just beside it.
  const pectoral = fan({
    pivot: { x: gx + 1, y: 2 },
    radius: 15,
    from: 20,
    to: 88,
    lobes: 4,
    bulge: 1.8,
    rootTop: { x: gx - 3, y: -2 },
    rootBottom: { x: gx + 2, y: 6 },
    jitter: material.finJitter,
    rng: finRng,
  });
  pushFin(body, pectoral);

  // The little upturned molly mouth, right at the snout tip: a dark crease
  // with a lip highlight above it.
  const nx = geom.nose.x;
  const ny = geom.nose.y;
  body.push({
    kind: "path",
    d: `M ${f(nx + 0.5)} ${f(ny + 3)} C ${f(nx + 3)} ${f(ny + 4.5)} ${f(nx + 6)} ${f(ny + 5.5)} ${f(nx + 9)} ${f(ny + 5.5)}`,
    paint: { color: "#000000", opacity: 0.5 },
    stroke: { width: 1.6 },
    clip: bodyD,
  });
  body.push({
    kind: "path",
    d: `M ${f(nx + 1)} ${f(ny + 1)} C ${f(nx + 4)} ${f(ny + 2)} ${f(nx + 7)} ${f(ny + 2.5)} ${f(nx + 10)} ${f(ny + 2.5)}`,
    paint: { color: "#ffffff", opacity: 0.28 },
    stroke: { width: 1.3 },
    clip: bodyD,
  });

  // The eye: high and forward — still the most recognisable feature. Cream
  // fill, a real stroked-circle rim (no more SVG-arc-path workaround now that
  // circles can stroke), a dark pupil, and one clean catchlight — a single
  // crisp highlight reads better at small sizes than two competing ones.
  const eye = { cx: nx + 19, cy: -9 };
  const r = 5.3;
  body.push({ kind: "circle", ...eye, r, paint: { color: "#f6f2e8" } });
  // Rare+ only: a coloured accent ring just outside the dark rim, in the
  // variety's own accent hue — the single most legible "this one is special"
  // cue a flat-vector fish has, worn right on its face.
  if (material.eyeRing > 0) {
    body.push({
      kind: "circle",
      ...eye,
      r: r + 1,
      paint: { color: def.accentColor, opacity: material.eyeRing },
      stroke: { width: 1.8 },
    });
  }
  body.push({ kind: "circle", ...eye, r, paint: { color: OUTLINE_COLOR }, stroke: { width: 1.3 } });
  body.push({ kind: "circle", ...eye, r: 3.6, paint: { color: "#0b0e14" } });
  body.push({
    kind: "circle",
    cx: eye.cx - 1.6,
    cy: eye.cy - 1.7,
    r: 1.5,
    paint: { color: "#ffffff", opacity: 0.95 },
  });

  // Every drawn shape contributes; the pad covers stroke width.
  const bounds = inflateBox(
    [tail.bbox, dorsal.bbox, pelvicFar.bbox, pelvic.bbox, anal.bbox, pectoral.bbox].reduce(
      unionBox,
      geom.bbox,
    ),
    BOUNDS_PAD,
  );

  return {
    tail: tailPrimitives,
    tailPivot: { x: tail.pivot.x, y: 1 },
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
