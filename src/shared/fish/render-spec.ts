// Pure fish-drawing module: builds a declarative list of primitives (SVG path
// strings + paint descriptions) for a given trait combination. Consumed by BOTH
// the Skia renderer (fish-sprite.tsx, via Skia.Path.MakeFromSVGString) and the
// HTML preview generator (scripts/fish-preview.ts) — so previews match the app
// by construction.
//
// MUST stay free of React/React Native/Skia imports: it runs under plain Node.
//
// Local space: origin at body center, nose pointing LEFT (-x), y down.
// Adult footprint ≈ x [-50..67], y [-58 (sailfin tip)..33 (anal fin tip)].

import { seedFromString } from "../lib/seed";

import type { ColorDef, FishTraits, ShimmerKind } from "./types";

export interface XY {
  x: number;
  y: number;
}

export type Paint =
  | { type: "solid"; color: string; opacity?: number }
  | {
      type: "linear";
      from: XY;
      to: XY;
      stops: { offset: number; color: string }[];
      opacity?: number;
    };

export type Primitive =
  | {
      kind: "path";
      d: string;
      paint: Paint;
      /** Clip to the body silhouette (shading, patterns). */
      clip?: "body";
      /** Render as a stroked line instead of a fill. */
      stroke?: { width: number };
    }
  | { kind: "circle"; cx: number; cy: number; r: number; paint: Paint };

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
}

/** Vertical squish per life stage, shared by both renderers. */
export const STAGE_SQUISH = { egg: 1, fry: 0.72, juvenile: 0.88, adult: 1 } as const;

/** Body-silhouette half height (dead-fish placement) without building a spec. */
export function bodyHalfHeightFor(body: FishTraits["body"]): number {
  return body === "balloon" ? 32 : 28;
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
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const p0 = points[(i - 1) % n];
    const p1 = points[i % n];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d + " Z";
}

// ---------------------------------------------------------------------------
// Fin construction: lobed (scalloped) edges and radial fans.
// ---------------------------------------------------------------------------

const f = (n: number) => n.toFixed(1);
const toRad = (deg: number) => (deg * Math.PI) / 180;

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
}

/** A radial fin fan (tail, pectoral, pelvic, anal) with its ray lines. */
function fan(opts: FanOpts): { d: string; rays: string[] } {
  const { pivot, radius, from, to, lobes, bulge, rootTop, rootBottom } = opts;
  const at = (deg: number, r: number): XY => ({
    x: pivot.x + Math.cos(toRad(deg)) * r,
    y: pivot.y + Math.sin(toRad(deg)) * r,
  });

  const notches: XY[] = [];
  for (let i = 0; i <= lobes; i++) notches.push(at(from + ((to - from) * i) / lobes, radius));

  let d = `M ${f(rootTop.x)} ${f(rootTop.y)}`;
  d += opts.lead
    ? ` Q ${f(opts.lead.x)} ${f(opts.lead.y)} ${f(notches[0].x)} ${f(notches[0].y)}`
    : ` L ${f(notches[0].x)} ${f(notches[0].y)}`;
  d += lobedEdge(notches, pivot, bulge);
  d += ` L ${f(rootBottom.x)} ${f(rootBottom.y)} Z`;

  const rays: string[] = [];
  for (let i = 0; i < lobes; i++) {
    const deg = from + ((to - from) * (i + 0.5)) / lobes;
    const a = at(deg, radius * 0.18);
    const b = at(deg, radius * 0.85);
    rays.push(`M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}`);
  }
  return { d, rays };
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
}

function bodyGeom(body: FishTraits["body"]): BodyGeom {
  if (body === "balloon") {
    return {
      d:
        "M -38 -2 " +
        "C -36 -14 -29 -23 -18 -28 " +
        "C -7 -32 7 -31 17 -25 " +
        "C 26 -20 31 -14 33 -7 " +
        "L 33 9 " +
        "C 30 18 24 25 14 29 " +
        "C 2 33 -14 30 -26 21 " +
        "C -34 15 -38 6 -38 -2 Z",
      nose: { x: -38, y: -2 },
      backPeak: { x: -4, y: -31 },
      bellyLow: { x: -4, y: 31 },
      peduncleTop: { x: 33, y: -7 },
      peduncleBottom: { x: 33, y: 9 },
      halfHeight: 32,
    };
  }
  // Roughly 2:1 length-to-depth, with a wedge snout: the forehead and the jaw
  // both leave the nose heading right, so the tip reads as a point.
  return {
    d:
      "M -52 -4 " +
      "C -48 -13 -41 -18 -31 -21 " +
      "C -20 -25 -8 -26 3 -24 " +
      "C 16 -21 28 -16 36 -8 " +
      "L 36 8 " +
      "C 28 16 17 21 5 22 " +
      "C -9 24 -25 20 -36 12 " +
      "C -43 8 -48 3 -52 -4 Z",
    nose: { x: -52, y: -4 },
    backPeak: { x: -4, y: -25 },
    bellyLow: { x: -8, y: 23 },
    peduncleTop: { x: 36, y: -8 },
    peduncleBottom: { x: 36, y: 8 },
    halfHeight: 26,
  };
}

function tailGeom(tail: FishTraits["tail"], geom: BodyGeom): { d: string; rays: string[] } {
  const top = geom.peduncleTop;
  const bottom = geom.peduncleBottom;
  const px = top.x;
  if (tail === "lyretail") {
    // A lyre: a full fan whose top and bottom lobes draw out into filaments,
    // leaving a shallow concave sweep between them.
    return {
      d:
        `M ${px} ${top.y + 1} ` +
        "C 48 -14 58 -24 68 -36 " +
        "C 62 -24 57 -12 55 1 " +
        "C 57 14 62 26 68 38 " +
        "C 58 26 48 16 " +
        `${px} ${bottom.y - 1} Z`,
      rays: [
        `M ${px + 3} -5 C 48 -14 57 -23 65 -32`,
        `M ${px + 3} -2 C 44 -6 50 -12 53 -18`,
        `M ${px + 3} 1 C 42 1 47 1 51 1`,
        `M ${px + 3} 4 C 44 8 50 14 53 20`,
        `M ${px + 3} 6 C 48 15 57 24 65 34`,
      ],
    };
  }
  // Round: the big scalloped fan of the reference art.
  return fan({
    pivot: { x: px, y: 0 },
    radius: 28,
    from: -62,
    to: 62,
    lobes: 6,
    bulge: 5,
    rootTop: { x: px, y: top.y + 1 },
    rootBottom: { x: px, y: bottom.y - 1 },
  });
}

function dorsalGeom(
  dorsal: FishTraits["dorsal"],
  backPeakY: number,
): { d: string; rays: string[] } {
  const base = backPeakY + 3;
  const pivot: XY = { x: 2, y: base };
  if (dorsal === "sailfin") {
    const notches: XY[] = [
      { x: -10, y: base - 28 },
      { x: -2, y: base - 34 },
      { x: 7, y: base - 35 },
      { x: 15, y: base - 31 },
      { x: 21, y: base - 23 },
      { x: 24, y: base - 12 },
      { x: 24, y: base - 2 },
    ];
    return {
      d:
        `M -20 ${base + 1} ` +
        `C -20 ${base - 13} -17 ${base - 24} ${f(notches[0].x)} ${f(notches[0].y)} ` +
        lobedEdge(notches, pivot, 2.6) +
        ` L 20 ${base + 2} Z`,
      rays: [
        `M -14 ${base - 1} C -14 ${base - 11} -12 ${base - 20} -9 ${base - 26}`,
        `M -6 ${base - 1} C -5 ${base - 13} -3 ${base - 23} -1 ${base - 31}`,
        `M 2 ${base - 1} C 4 ${base - 12} 6 ${base - 22} 7 ${base - 31}`,
        `M 10 ${base - 1} C 12 ${base - 11} 14 ${base - 20} 16 ${base - 27}`,
        `M 16 ${base} C 18 ${base - 8} 20 ${base - 14} 21 ${base - 19}`,
      ],
    };
  }
  // Standard: tall back-leaning triangle, scalloped down the trailing edge.
  const notches: XY[] = [
    { x: -3, y: base - 21 },
    { x: 4, y: base - 18 },
    { x: 9, y: base - 12 },
    { x: 12, y: base - 5 },
  ];
  return {
    d:
      `M -16 ${base + 1} ` +
      `C -14 ${base - 10} -9 ${base - 18} ${f(notches[0].x)} ${f(notches[0].y)} ` +
      lobedEdge(notches, pivot, 2.2) +
      ` L 10 ${base + 2} Z`,
    rays: [
      `M -11 ${base - 1} C -9 ${base - 8} -7 ${base - 14} -5 ${base - 18}`,
      `M -4 ${base - 1} C -2 ${base - 7} 1 ${base - 12} 3 ${base - 16}`,
      `M 3 ${base - 1} C 5 ${base - 5} 7 ${base - 9} 9 ${base - 12}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Patterns.
// ---------------------------------------------------------------------------

function patternPrimitives(def: ColorDef, geom: BodyGeom): Primitive[] {
  const pattern = def.pattern;
  const rng = makeRng(`pattern-${def.id}`);
  const out: Primitive[] = [];
  const solid = (color: string, opacity = 1): Paint => ({ type: "solid", color, opacity });

  switch (pattern.type) {
    case "solid":
      return out;

    case "spots": {
      for (let i = 0; i < 10; i++) {
        const cx = lerp(-40, 30, rng());
        const cy = lerp(-16, 17, rng());
        if (cx < -28 && cy < -2) continue; // keep the face readable
        const r = lerp(1.8, 3.4, rng());
        out.push({
          kind: "path",
          d: blobPath(cx, cy, r, r * lerp(0.8, 1.1, rng()), 0.4, rng),
          paint: solid(pattern.color, 0.88),
          clip: "body",
        });
      }
      if (pattern.onFins) {
        // A few spots spilling onto the tail fan (unclipped, sits on the fin).
        for (let i = 0; i < 3; i++) {
          const cx = lerp(44, 56, rng());
          const cy = lerp(-6, 8, rng());
          const r = lerp(1.2, 2, rng());
          out.push({
            kind: "path",
            d: blobPath(cx, cy, r, r, 0.4, rng),
            paint: solid(pattern.color, 0.7),
          });
        }
      }
      return out;
    }

    case "speckle": {
      for (let i = 0; i < 30; i++) {
        const t = Math.sqrt(rng()); // concentrate toward the rear
        const cx = lerp(-6, 32, t);
        const yMax = lerp(19, 7, (cx + 6) / 38);
        const cy = lerp(-yMax, yMax, rng());
        const r = lerp(0.9, 2.1, rng());
        out.push({
          kind: "circle",
          cx,
          cy,
          r,
          paint: solid(pattern.color, lerp(0.5, 0.95, t)),
        });
      }
      return out;
    }

    case "stripes": {
      const xs = [-29, -16, -3, 10, 23];
      for (const x of xs) {
        const w = lerp(2.2, 3, rng());
        const lean = lerp(-2.5, -0.5, rng());
        if (pattern.style === "clean") {
          out.push({
            kind: "path",
            d:
              `M ${x - w} -28 Q ${x - w + lean} 0 ${x - w} 22 ` +
              `L ${x + w} 22 Q ${x + w + lean} 0 ${x + w} -28 Z`,
            paint: solid(pattern.color, 0.9),
            clip: "body",
          });
        } else {
          // Tiger: two offset segments with a gap, edges wobblier.
          const gapTop = lerp(-6, -2, rng());
          const gapBottom = gapTop + lerp(4, 7, rng());
          const jitter = lerp(-2, 2, rng());
          out.push({
            kind: "path",
            d:
              `M ${x - w + jitter} -28 Q ${x - w + lean} -16 ${x - w} ${gapTop} ` +
              `L ${x + w + jitter} ${gapTop} Q ${x + w + lean} -16 ${x + w} -28 Z`,
            paint: solid(pattern.color, 0.9),
            clip: "body",
          });
          out.push({
            kind: "path",
            d:
              `M ${x - w} ${gapBottom} Q ${x - w + lean} 13 ${x - w + jitter} 22 ` +
              `L ${x + w + jitter} 22 Q ${x + w + lean} 13 ${x + w} ${gapBottom} Z`,
            paint: solid(pattern.color, 0.9),
            clip: "body",
          });
        }
      }
      return out;
    }

    case "patches": {
      const [primary, secondary] = pattern.colors;
      if (pattern.style === "koi") {
        // Signature red head patch…
        out.push({
          kind: "path",
          d:
            `M ${geom.nose.x} ${geom.nose.y} ` +
            "C -47 -13 -40 -20 -29 -24 " +
            "C -24 -16 -23 -4 -26 5 " +
            "C -34 9 -45 7 " +
            `${geom.nose.x} ${geom.nose.y} Z`,
          paint: solid(primary, 0.95),
          clip: "body",
        });
        // …plus bold black blotches mid and rear.
        out.push({
          kind: "path",
          d: blobPath(2, -7, 10, 7, 0.35, rng),
          paint: solid(secondary ?? "#1c1e24", 0.92),
          clip: "body",
        });
        out.push({
          kind: "path",
          d: blobPath(24, 4, 7, 5, 0.35, rng),
          paint: solid(secondary ?? "#1c1e24", 0.92),
          clip: "body",
        });
        return out;
      }
      if (pattern.style === "calico") {
        out.push({
          kind: "path",
          d: blobPath(-16, -7, 9, 7, 0.4, rng),
          paint: solid(primary, 1),
          clip: "body",
        });
        out.push({
          kind: "path",
          d: blobPath(16, -3, 7, 6, 0.4, rng),
          paint: solid(primary, 1),
          clip: "body",
        });
        out.push({
          kind: "path",
          d: blobPath(1, 9, 6, 5, 0.4, rng),
          paint: solid(secondary ?? "#23262e", 0.96),
          clip: "body",
        });
        out.push({
          kind: "path",
          d: blobPath(-30, 5, 5, 4, 0.4, rng),
          paint: solid(secondary ?? "#23262e", 0.96),
          clip: "body",
        });
        return out;
      }
      // soft (sakura)
      out.push({
        kind: "path",
        d: blobPath(-11, -5, 8, 6, 0.5, rng),
        paint: solid(primary, 0.85),
        clip: "body",
      });
      out.push({
        kind: "path",
        d: blobPath(12, 6, 7, 5, 0.5, rng),
        paint: solid(secondary ?? primary, 0.8),
        clip: "body",
      });
      out.push({
        kind: "path",
        d: blobPath(24, -6, 5, 4, 0.5, rng),
        paint: solid(primary, 0.8),
        clip: "body",
      });
      return out;
    }
  }
}

function shimmerPrimitive(kind: ShimmerKind): Primitive {
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
  return {
    kind: "path",
    d: "M -34 -16 " + "C -12 -22 12 -19 32 -8 " + "C 12 -11 -12 -14 -34 -13 Z",
    paint: { type: "linear", from: { x: -34, y: -16 }, to: { x: 32, y: -8 }, stops, opacity: 0.8 },
    clip: "body",
  };
}

// ---------------------------------------------------------------------------
// The spec builder.
// ---------------------------------------------------------------------------

export function buildFishSpec(traits: FishTraits, def: ColorDef): FishRenderSpec {
  const geom = bodyGeom(traits.body);
  const px = geom.peduncleTop.x;
  const tail = tailGeom(traits.tail, geom);
  const dorsal = dorsalGeom(traits.dorsal, geom.backPeak.y);
  const p = def.palette;
  const belly = geom.bellyLow.y;

  const finPaint: Paint = { type: "solid", color: p.fin, opacity: 0.94 };
  const rayStroke = (d: string): Primitive => ({
    kind: "path",
    d,
    paint: { type: "solid", color: p.finRay, opacity: 0.45 },
    stroke: { width: 1 },
  });

  const tailPrimitives: Primitive[] = [
    { kind: "path", d: tail.d, paint: finPaint },
    ...tail.rays.map(rayStroke),
  ];

  const body: Primitive[] = [];

  // Fins that sit behind the body outline: dorsal above, pelvic + anal below.
  // Their roots are covered by the body fill drawn next.
  body.push({ kind: "path", d: dorsal.d, paint: finPaint });
  body.push(...dorsal.rays.map(rayStroke));

  // Roots sit inside the silhouette, so only the fan below the belly shows.
  const pelvicFar = fan({
    pivot: { x: -21, y: belly - 10 },
    radius: 12,
    from: 42,
    to: 104,
    lobes: 3,
    bulge: 1.8,
    rootTop: { x: -18, y: belly - 12 },
    rootBottom: { x: -25, y: belly - 11 },
  });
  const pelvic = fan({
    pivot: { x: -17, y: belly - 7 },
    radius: 13,
    from: 38,
    to: 100,
    lobes: 3,
    bulge: 2,
    rootTop: { x: -14, y: belly - 9 },
    rootBottom: { x: -21, y: belly - 8 },
  });
  const anal = fan({
    pivot: { x: 9, y: belly - 6 },
    radius: 14,
    from: 28,
    to: 92,
    lobes: 4,
    bulge: 2,
    rootTop: { x: 13, y: belly - 9 },
    rootBottom: { x: 5, y: belly - 8 },
  });

  // The far-side pelvic reads as depth: same fin, pushed back and dimmed.
  body.push({
    kind: "path",
    d: pelvicFar.d,
    paint: { type: "solid", color: p.fin, opacity: 0.55 },
  });
  for (const d of pelvicFar.rays) {
    body.push({
      kind: "path",
      d,
      paint: { type: "solid", color: p.finRay, opacity: 0.25 },
      stroke: { width: 1 },
    });
  }
  for (const lower of [pelvic, anal]) {
    body.push({ kind: "path", d: lower.d, paint: { type: "solid", color: p.fin, opacity: 0.92 } });
    body.push(...lower.rays.map(rayStroke));
  }

  // The body itself: back→belly gradient.
  body.push({
    kind: "path",
    d: geom.d,
    paint: {
      type: "linear",
      from: { x: 0, y: geom.backPeak.y },
      to: { x: 0, y: geom.bellyLow.y },
      stops: [
        { offset: 0, color: p.back },
        { offset: 0.55, color: p.mid },
        { offset: 1, color: p.belly },
      ],
    },
  });

  // Dorsal-ridge shadow + belly highlight (clip body).
  body.push({
    kind: "path",
    d:
      `M -28 ${geom.backPeak.y + 3} ` +
      `C -8 ${geom.backPeak.y - 2} 14 ${geom.backPeak.y + 2} ${px - 2} ${geom.peduncleTop.y} ` +
      `C 14 ${geom.backPeak.y + 8} -8 ${geom.backPeak.y + 5} -28 ${geom.backPeak.y + 3} Z`,
    paint: { type: "solid", color: "#000000", opacity: 0.16 },
    clip: "body",
  });
  body.push({
    kind: "path",
    d: blobPath(-16, belly - 11, 16, 6, 0.15, makeRng(`belly-${def.id}`)),
    paint: { type: "solid", color: "#ffffff", opacity: 0.14 },
    clip: "body",
  });
  // Broad specular sheen along the upper flank.
  body.push({
    kind: "path",
    d: blobPath(-6, geom.backPeak.y * 0.45, 23, 7, 0.12, makeRng(`sheen-${def.id}`)),
    paint: { type: "solid", color: "#ffffff", opacity: 0.1 },
    clip: "body",
  });

  // Pattern + shimmer.
  body.push(...patternPrimitives(def, geom));
  if (def.shimmer) body.push(shimmerPrimitive(def.shimmer));

  // Gill cover: a lighter cheek plate with a hard trailing edge.
  const gx = geom.nose.x + 20; // operculum trailing edge, scaled off the snout
  body.push({
    kind: "path",
    d:
      `M ${gx} -18 C ${gx + 7} -10 ${gx + 7} 4 ${gx} 14 ` +
      `C ${gx - 9} 12 ${gx - 16} 4 ${gx - 17} -4 ` +
      `C ${gx - 17} -12 ${gx - 10} -17 ${gx} -18 Z`,
    paint: { type: "solid", color: "#ffffff", opacity: 0.18 },
    clip: "body",
  });
  body.push({
    kind: "path",
    d: `M ${gx} -18 C ${gx + 7} -10 ${gx + 7} 4 ${gx} 14`,
    paint: { type: "solid", color: "#000000", opacity: 0.24 },
    stroke: { width: 1.4 },
    clip: "body",
  });

  // Sparse scale scribbles across the flank.
  const scaleRng = makeRng(`scales-${def.id}`);
  for (let i = 0; i < 7; i++) {
    const x = lerp(-22, 26, scaleRng());
    const y = lerp(-17, 13, scaleRng());
    body.push({
      kind: "path",
      d: `M ${f(x)} ${f(y)} q 2 -2.4 4 0 q 2 2.4 4 0`,
      paint: { type: "solid", color: "#000000", opacity: 0.11 },
      stroke: { width: 0.9 },
      clip: "body",
    });
  }

  // Pectoral fin, fanned back over the flank just behind the gill cover.
  const pectoral = fan({
    pivot: { x: gx + 5, y: -1 },
    radius: 16,
    from: 22,
    to: 86,
    lobes: 4,
    bulge: 2,
    rootTop: { x: gx + 4, y: -5 },
    rootBottom: { x: gx + 9, y: 2 },
  });
  body.push({ kind: "path", d: pectoral.d, paint: { type: "solid", color: p.fin, opacity: 0.7 } });
  body.push(...pectoral.rays.map(rayStroke));

  // Upturned mouth at the snout tip + eye.
  const nx = geom.nose.x;
  const ny = geom.nose.y;
  body.push({
    kind: "path",
    d: `M ${nx + 1} ${ny + 0.5} C ${nx + 3} ${ny + 2} ${nx + 4.5} ${ny + 3} ${nx + 6} ${ny + 4}`,
    paint: { type: "solid", color: "#000000", opacity: 0.4 },
    stroke: { width: 1.3 },
    clip: "body",
  });
  body.push({
    kind: "path",
    d: `M ${nx + 1.5} ${ny - 1} C ${nx + 4} ${ny - 0.5} ${nx + 6} ${ny + 0.5} ${nx + 7} ${ny + 1.5}`,
    paint: { type: "solid", color: "#ffffff", opacity: 0.16 },
    stroke: { width: 1.1 },
    clip: "body",
  });

  const eye = { cx: nx + 12, cy: -9 };
  body.push({ kind: "circle", ...eye, r: 5.4, paint: { type: "solid", color: "#f2ece0" } });
  body.push({
    kind: "path",
    d: `M ${f(eye.cx - 5.4)} ${eye.cy} a 5.4 5.4 0 1 0 10.8 0 a 5.4 5.4 0 1 0 -10.8 0`,
    paint: { type: "solid", color: "#141821", opacity: 0.85 },
    stroke: { width: 0.9 },
  });
  body.push({ kind: "circle", ...eye, r: 3.5, paint: { type: "solid", color: "#0d1015" } });
  body.push({
    kind: "circle",
    cx: eye.cx - 1.5,
    cy: eye.cy - 1.7,
    r: 1.5,
    paint: { type: "solid", color: "#f7fbfe", opacity: 0.95 },
  });
  body.push({
    kind: "circle",
    cx: eye.cx + 1.4,
    cy: eye.cy + 1.6,
    r: 0.7,
    paint: { type: "solid", color: "#f7fbfe", opacity: 0.6 },
  });

  return {
    tail: tailPrimitives,
    tailPivot: { x: px, y: 1 },
    body,
    bodyPathD: geom.d,
    silhouetteDs: [tail.d, dorsal.d, pelvicFar.d, pelvic.d, anal.d, geom.d, pectoral.d],
    bodyHalfHeight: geom.halfHeight,
  };
}
