// Palette/pattern/shimmer/scale painter for the 2D V2 fish — originally
// ported from `@/shared/fish/render-spec.ts`, now diverging from it: this
// renderer draws its own original patterns (see `pattern-defs.ts`) instead
// of the old renderer's 1,726 hand-drawn `custom` shapes, and every
// generator here places shapes purely in terms of `PigmentGeom`'s landmarks
// and body curves — never a literal legacy-frame coordinate — so a body
// re-sculpt (see `body-profile.ts`) doesn't strand any of them.
//
// Dependency-free: no React/RN/Skia. Runs under plain Node.

import type { Node, Paint, XY } from "@/shared/aquarium/core/ir";
import { blobPath, f, lerp, seededKey, toRad } from "@/shared/aquarium/core/pigment-toolkit";
import type { ColorDef, PatternTuning, RarityTier, ShimmerKind } from "@/shared/fish/types";
import { lighten, rgba } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import type { AquariumPattern } from "./pattern-defs";
import type { Curve1D } from "./profile";

export interface PigmentGeom {
  /** Full unified outline — used only as a clip, never for placement. */
  d: string;
  x0: number;
  length: number;
  /** Half-height curves, same convention as `anatomy.ts`'s `baseTop`/`baseBottom` — lets a generator trace the actual body contour instead of a straight top/bottom line. */
  topAt: Curve1D;
  bottomAt: Curve1D;
  nose: XY;
  backPeak: XY;
  bellyLow: XY;
  peduncleTop: XY;
  halfHeight: number;
}

// ---------------------------------------------------------------------------
// Rarity material — ported verbatim from render-spec.ts.
// ---------------------------------------------------------------------------

export interface Material {
  gloss: number;
  bloom: number;
  rim: number;
  finTrail: number;
  finJitter: number;
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

export function materialFor(tier: RarityTier): Material {
  return MATERIAL_BY_TIER[tier];
}

/** Local "which way does the skin curve here" angle, for curvature-aimed glints/scales. */
function curvatureTangentDeg(geom: PigmentGeom, cx: number, cy: number): number {
  const cx0 = (geom.nose.x + geom.peduncleTop.x) / 2;
  const cy0 = (geom.backPeak.y + geom.bellyLow.y) / 2;
  const a = Math.max(1, (geom.peduncleTop.x - geom.nose.x) / 2);
  const b = Math.max(1, geom.halfHeight);
  const theta = Math.atan2((cy - cy0) / b, (cx - cx0) / a);
  return (theta * 180) / Math.PI + 90;
}

function curvatureHighlights(
  geom: PigmentGeom,
  rng: () => number,
  count: number,
  opacityScale: number,
): Node[] {
  const bodyD = geom.d;
  const span = geom.peduncleTop.x - geom.nose.x;
  const archPeakT = (geom.backPeak.x - geom.nose.x) / span;
  const out: Node[] = [];
  for (let i = 0; i < count; i++) {
    const t = lerp(0.1, 0.9, (i + rng()) / count);
    const cx = lerp(geom.nose.x, geom.peduncleTop.x, t);
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

export function patternPrimitives(
  id: string,
  pattern: AquariumPattern,
  geom: PigmentGeom,
  material: Material,
  seed: number,
): Node[] {
  const rng = makeRng(seededKey(`pattern-${id}`, seed));
  const out: Node[] = [];
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
      const count = Math.max(1, Math.round(13 * density));
      for (let i = 0; i < count; i++) {
        const cx = lerp(geom.nose.x + 16, rear - 2, rng());
        const cy = lerp(top + 5, bot - 5, rng());
        if (cx < geom.nose.x + 24 && cy < 0) continue;
        const r = lerp(2.2, 5.6, rng() * rng() + 0.3) * scale;
        out.push({
          kind: "path",
          d: blobPath(cx, cy, r, r * lerp(0.75, 1.15, rng()), wobble, rng),
          paint: solid(pattern.color, 0.92),
          blur: 0.9,
          clip: bodyD,
        });
      }
      if (pattern.onFins) {
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
      const count = Math.max(1, Math.round((metallic ? 14 : wide ? 26 : 22) * density));
      // Narrow (not `wide`) speckle starts at u≈0.37 of the trunk, not the
      // nose — the same fraction the original hand-tuned absolute start
      // covered, now relative to `geom`. The taper target at the tail end
      // is the peduncle's own half-height (`bottomAt(1)`), not a legacy
      // constant — it's the same "how deep is the body here" quantity,
      // just read off the actual curve instead of guessed.
      const uniformPlace = () => {
        const t = wide ? rng() : Math.sqrt(rng());
        const cx = lerp(wide ? geom.nose.x + 18 : lerp(geom.nose.x, rear, 0.37), rear - 2, t);
        const span =
          lerp(bot - 2, geom.bottomAt(1), (cx - geom.nose.x) / (rear - geom.nose.x)) * randomness;
        return { cx, cy: lerp(-span, span, rng()), t };
      };
      // Clustered (electricBlue): a handful of Gaussian-ish blotches instead
      // of an even scatter — reads as scale-sheen patches catching the
      // light rather than dust settled everywhere.
      const clusterCenters = pattern.clustered ? Array.from({ length: 4 }, uniformPlace) : null;
      const place = () => {
        if (!clusterCenters) return uniformPlace();
        const center = clusterCenters[Math.floor(rng() * clusterCenters.length)];
        // Irwin-Hall(3) jitter approximates a clamped Gaussian without a
        // proper normal-sampler dependency.
        const jitter = () => ((rng() + rng() + rng()) / 3 - 0.5) * 2;
        const spread = geom.halfHeight * 0.4 * randomness;
        return { cx: center.cx + jitter() * spread, cy: center.cy + jitter() * spread, t: 0.7 };
      };
      for (let i = 0; i < count; i++) {
        const { cx, cy, t } = place();
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
        const glintCount = Math.max(1, Math.round(9 * density));
        for (let i = 0; i < glintCount; i++) {
          const { cx, cy } = place();
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
        const dotCount = Math.max(1, Math.round(10 * density));
        for (let i = 0; i < dotCount; i++) {
          const { cx, cy } = place();
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
      out.push(...drawStripe(id, pattern.color, pattern.style, pattern, geom, material, seed));
      return out;
    }

    case "bands": {
      // Ribbons traced ALONG the actual body contour (`topAt`/`bottomAt`),
      // not straight bars across a fixed vertical span — so a band still
      // reads as wrapping the trunk on any silhouette. Replaces zebra/
      // caramelZebra/tiger's old hand-placed `custom` shapes.
      const density = pattern.density ?? 1;
      const scale = pattern.scale ?? 1;
      const randomness = pattern.randomness ?? 1;
      const count = Math.max(2, Math.round(pattern.count * density));
      const xAt = (u: number) => geom.x0 + u * geom.length;
      const clampU = (u: number) => Math.max(-0.03, Math.min(1.03, u));
      const SAMPLES = 8;
      const leanU = pattern.lean / geom.length;

      const ribbonD = (uc: number, halfW: number, leanSign: number): string => {
        const pts: XY[] = [];
        for (let s = 0; s <= SAMPLES; s++) {
          const u = clampU(lerp(uc - halfW, uc + halfW, s / SAMPLES) + leanSign * leanU);
          pts.push({ x: xAt(u), y: -geom.topAt(u) * 0.96 });
        }
        for (let s = SAMPLES; s >= 0; s--) {
          const u = clampU(lerp(uc - halfW, uc + halfW, s / SAMPLES) - leanSign * leanU);
          pts.push({ x: xAt(u), y: geom.bottomAt(u) * 0.96 });
        }
        let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${f(pts[i].x)} ${f(pts[i].y)}`;
        return d + " Z";
      };
      // Same soft-under/sharp-over double pass `stripes` uses — "soft edges
      // over hard vector outlines" is the whole point of the storybook pass.
      const bar = (d: string, softAlpha: number, sharpAlpha: number) => {
        out.push({
          kind: "path",
          d,
          paint: solid(pattern.color, softAlpha),
          blur: 1.8 * pattern.softness,
          clip: bodyD,
        });
        out.push({
          kind: "path",
          d,
          paint: solid(pattern.color, sharpAlpha),
          blur: 0.35,
          clip: bodyD,
        });
      };

      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const jitter = (rng() - 0.5) * 0.03 * randomness;
        const uc = lerp(0.13, 0.95, t) + jitter;
        const widthEnv = Math.max(0.15, 1 - pattern.taper * uc);
        const halfW = Math.max(0.008, pattern.width * scale * widthEnv);

        bar(ribbonD(uc, halfW, 1), 0.5, 0.92);

        if (pattern.breakStyle === "fork" && uc > 0.35) {
          // A thinner, offset companion ribbon near each main band — the
          // "flame stripe" cluster read (tiger).
          const spurUc = uc + lerp(0.02, 0.05, rng()) * randomness;
          bar(ribbonD(spurUc, halfW * 0.55, -1.6), 0.4, 0.78);
        }
      }
      return out;
    }

    case "patches": {
      const [primary, secondary] = pattern.colors;
      const nx = geom.nose.x;
      const span = rear - nx;
      // Body-relative placement (u along the trunk, v as a fraction of the
      // local back/belly half-height) instead of literal legacy coordinates
      // — the original hand-tuned absolute positions, converted to the
      // fractions they actually landed at on the old body, so they still
      // read as the same composition on any silhouette. Blob sizes scale
      // with `halfHeight` too, so patches don't look undersized on a
      // deeper body (balloon).
      const X = (u: number) => nx + span * u;
      const Yb = (v: number) => top * v; // back side — `top` is already negative
      const Yv = (v: number) => bot * v; // belly side — `bot` is already positive
      const sizeScale = geom.halfHeight / 25;
      const scale = (pattern.scale ?? 1) * sizeScale;
      const randomness = pattern.randomness ?? 1;
      const blob = (cx: number, cy: number, rx: number, ry: number, wobble: number) =>
        blobPath(cx, cy, rx * scale, ry * scale, wobble * randomness, rng);
      const patchBlur = pattern.style === "soft" ? 2.2 : 1.1;
      const patch = (d: string, color: string, opacity: number) =>
        out.push({ kind: "path", d, paint: solid(color, opacity), blur: patchBlur, clip: bodyD });

      if (pattern.style === "koi") {
        const bodyLen = rear - nx;
        patch(blob(nx + bodyLen * 0.2, -3, bodyLen * 0.17, bodyLen * 0.2, 0.16), primary, 0.82);
        out.push(
          ...drawStripe(id, secondary ?? "#1c1e24", "clean", pattern, geom, material, seed, {
            minWidth: 1.5,
            maxWidth: 3.0,
            includedHead: false,
          }),
        );

        return out;
      }
      if (pattern.style === "calico") {
        patch(blob(X(0.3), Yb(0.44), 14, 13, 0.55), primary, 1);
        patch(blob(X(0.67), Yb(0.28), 12, 12, 0.55), primary, 1);
        patch(blob(X(0.5), Yv(0.56), 11, 10, 0.55), secondary ?? "#23262e", 0.96);
        patch(blob(X(0.18), Yv(0.32), 8, 8, 0.55), secondary ?? "#23262e", 0.96);
        patch(blob(X(0.78), Yb(0.52), 8, 7, 0.55), secondary ?? "#23262e", 0.9);
        return out;
      }
      patch(blob(X(0.37), Yb(0.36), 13, 11, 0.3), primary, 0.94);
      patch(blob(X(0.62), Yv(0.36), 12, 10, 0.3), secondary ?? primary, 0.9);
      patch(blob(X(0.75), Yb(0.36), 9, 8, 0.3), primary, 0.9);
      patch(blob(X(0.16), Yv(0.2), 8, 7, 0.3), secondary ?? primary, 0.8);
      return out;
    }

    case "blossom": {
      // Scattered soft-edged petal clusters, plus a few lone drifting
      // petals — sakura only. Placement is body-relative (u along the
      // trunk, back/belly picked per cluster) so it reads the same on any
      // silhouette.
      const density = pattern.density ?? 1;
      const scale = pattern.scale ?? 1;
      const randomness = pattern.randomness ?? 1;
      const petals = pattern.petals ?? 5;
      const r = pattern.radius * geom.halfHeight * scale;
      const nx = geom.nose.x;
      const span = rear - nx;

      const petal = (
        cx: number,
        cy: number,
        color: string,
        opacity: number,
        blur: number,
        rr: number,
      ) =>
        out.push({
          kind: "path",
          d: blobPath(cx, cy, rr * 0.62, rr * 0.44, 0.25 * randomness, rng),
          paint: solid(color, opacity),
          blur,
          clip: bodyD,
        });

      const cluster = (cx: number, cy: number, rr: number) => {
        const rot = rng() * 72;
        for (let k = 0; k < petals; k++) {
          const ang = toRad(rot + k * (360 / petals));
          const px = cx + Math.cos(ang) * rr * 1.05;
          const py = cy + Math.sin(ang) * rr * 1.05;
          petal(px, py, pattern.colors[k % pattern.colors.length], 0.92, 0.7, rr);
        }
        out.push({
          kind: "circle",
          cx,
          cy,
          r: rr * 0.34,
          paint: solid(pattern.colors[pattern.colors.length - 1], 0.9),
          blur: 0.5,
        });
      };

      // A cluster's own centre picks a side (back or belly) so clusters
      // spread across the flank rather than all landing on one line.
      const flankPoint = (uLo: number, uHi: number, vLo: number, vHi: number): XY => {
        const cx = nx + span * lerp(uLo, uHi, rng());
        const vFrac = lerp(vLo, vHi, rng());
        const cy = rng() < 0.5 ? top * vFrac : bot * vFrac;
        return { x: cx, y: cy };
      };

      const clusterCount = Math.max(1, Math.round(pattern.clusters * density));
      for (let i = 0; i < clusterCount; i++) {
        const { x, y } = flankPoint(0.2, 0.85, 0.1, 0.6);
        cluster(x, y, r);
      }

      const singleCount = Math.max(0, Math.round(pattern.singles * density));
      for (let i = 0; i < singleCount; i++) {
        const { x, y } = flankPoint(0.1, 0.92, 0.05, 0.7);
        const rr = r * lerp(0.5, 0.8, rng());
        petal(x, y, pattern.colors[Math.floor(rng() * pattern.colors.length)], 0.42, 2.0, rr);
      }
      return out;
    }
  }
}

export interface Shimmer {
  base: Node;
  accents: Node[];
}

export function shimmerPrimitive(
  kind: ShimmerKind,
  geom: PigmentGeom,
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
  const opacity = Math.min(1, 0.8 * (material.bloom / 0.62));
  // Band traced in body-relative fractions (u along the trunk, v as a
  // fraction of the back half-height) — the original hand-tuned absolute
  // path, converted to the fractions it actually landed at on the old body.
  const nx = geom.nose.x;
  const rear = geom.peduncleTop.x;
  const span = rear - nx;
  const top = geom.backPeak.y; // negative
  const X = (u: number) => nx + span * u;
  const Y = (v: number) => top * v;
  const start = { x: X(0.179), y: Y(0.574) };
  const end = { x: X(0.798), y: Y(0.246) };
  const base: Node = {
    kind: "path",
    d:
      `M ${f(start.x)} ${f(start.y)} C ${f(X(0.391))} ${f(Y(0.861))} ${f(X(0.621))} ${f(Y(0.738))} ${f(end.x)} ${f(end.y)} ` +
      `C ${f(X(0.621))} ${f(Y(0.369))} ${f(X(0.391))} ${f(Y(0.492))} ${f(start.x)} ${f(Y(0.451))} Z`,
    paint: { type: "linear", from: start, to: end, stops, opacity },
    clip: bodyD,
  };
  if (kind !== "iridescent") return { base, accents: [] };

  const rng = makeRng(seededKey("shimmer-iridescent", seed));
  const highlightBoost = material.bloom / 0.62;
  const accents = curvatureHighlights(geom, rng, 3 + Math.floor(rng() * 3), highlightBoost);
  return { base, accents };
}

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

export function sparklePrimitives(geom: PigmentGeom, tier: RarityTier, seed: number): Node[] {
  if (tier !== "legendary") return [];
  const rng = makeRng(seededKey(`sparkle-${tier}`, seed));
  const rear = geom.peduncleTop.x;
  const spots = [0.32, 0.5, 0.68].map((t) => ({
    x: lerp(geom.nose.x, rear, t),
    y: lerp(geom.backPeak.y * 0.75, -2, t * 0.6 + rng() * 0.2),
  }));
  const out: Node[] = [];
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

const SCALE_COLS = 18;
const SCALE_ROWS = 8;

/**
 * Overlapping scale plates (vảy cá) across the trunk — the fish's skin
 * texture.
 *
 * Placement is body-relative `(u, v)`, per this file's header contract: `u`
 * runs nose->peduncle along `geom.length`, `v` runs top->bottom between
 * `topAt(u)` and `bottomAt(u)`. An earlier version laid a uniform grid over
 * the trunk's BOUNDING BOX instead, which gave dead-straight rows of
 * identically-sized scales — a rectangular texture stretched over a
 * non-rectangular animal. Reading the contour curves makes the rows bow with
 * the belly and converge at the peduncle, and lets each scale shrink with
 * the local body depth, the way a real fish's do toward the head and tail.
 *
 * Each plate is drawn TWICE: a dark arc for the free margin, and a lighter
 * arc lifted just inside it for the lit upper surface of the plate below.
 * One arc alone reads as a row of dashes; the pair is what reads as
 * overlap, which is the whole point of drawing scales at all.
 */
export function scalePrimitives(
  def: ColorDef,
  geom: PigmentGeom,
  material: Material,
  bodyD: string,
  seed: number,
): Node[] {
  const rng = makeRng(seededKey(`scales-${def.id}`, seed));
  const colU = 1 / SCALE_COLS;
  // Depth at the deepest point, as the reference every local depth tapers
  // against — `halfHeight` is the body's own half-depth, so twice it is the
  // full depth the mid-trunk scales are sized for.
  const refDepth = geom.halfHeight * 2;
  const children: Node[] = [];

  for (let r = 0; r < SCALE_ROWS; r++) {
    const rowOffset = r % 2 === 0 ? 0 : colU / 2;
    for (let c = -1; c <= SCALE_COLS; c++) {
      const u = (c + 0.5) * colU + rowOffset;
      if (u < 0 || u > 1) continue;
      const top = -geom.topAt(u);
      const bot = geom.bottomAt(u);
      const localDepth = bot - top;
      if (localDepth <= 0) continue;

      const cx = geom.x0 + u * geom.length;
      const v = (r + 0.5) / SCALE_ROWS + lerp(-1, 1, rng()) * 0.02;
      const cy = lerp(top, bot, v);

      // Taper toward nose and peduncle, but not all the way to nothing —
      // scales get smaller at the ends, they don't vanish.
      const taper = lerp(0.5, 1, Math.min(1, localDepth / refDepth));
      const w = geom.length * colU * lerp(0.9, 1.12, rng()) * taper;
      const arc = (localDepth / SCALE_ROWS) * 0.55 * lerp(0.8, 1.2, rng());

      const angle = toRad(curvatureTangentDeg(geom, cx, cy));
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rot = (lx: number, ly: number): XY => ({
        x: cx + lx * cosA - ly * sinA,
        y: cy + lx * sinA + ly * cosA,
      });
      // Quadratic bow: the control point sits at 2x the apex offset, so the
      // curve's midpoint lands at `arc`.
      const bow = (lift: number) => {
        const p0 = rot(-w / 2, -lift);
        const ctl = rot(0, arc * 2 - lift);
        const p2 = rot(w / 2, -lift);
        return `M ${f(p0.x)} ${f(p0.y)} Q ${f(ctl.x)} ${f(ctl.y)} ${f(p2.x)} ${f(p2.y)}`;
      };

      const contrast = material.patternContrast;
      children.push({
        kind: "path",
        d: bow(0),
        paint: {
          type: "solid",
          color: "#000000",
          opacity: Math.min(1, lerp(0.09, 0.15, rng()) * contrast),
        },
        stroke: { width: w * 0.11 },
      });
      children.push({
        kind: "path",
        d: bow(arc * 0.75),
        paint: {
          type: "solid",
          color: "#ffffff",
          opacity: Math.min(1, lerp(0.05, 0.09, rng()) * contrast),
        },
        stroke: { width: w * 0.085 },
      });
    }
  }

  // ONE clipped group, not one clip per arc: `emit.ts` emits a
  // save/clipPath/restore for every node carrying `clip`, and there are
  // ~300 arcs here. Clipping the group instead costs a single clip for all
  // of them — fewer clip operations than the old single-arc version had.
  return [{ kind: "group", clip: bodyD, children }];
}

const drawStripe = (
  id: string,
  stripeColor: string,
  style: "clean" | "broken",
  tuning: PatternTuning,
  geom: PigmentGeom,
  material: Material,
  seed: number,
  options?: {
    minWidth?: number;
    maxWidth?: number;
    includedHead?: boolean;
  },
) => {
  const out: Node[] = [];
  const { includedHead = true, minWidth = 3.5, maxWidth = 7.0 } = options ?? {};
  const rng = makeRng(seededKey(`pattern-${id}`, seed));
  const bodyD = geom.d;
  const solid = (color: string, opacity = 1): Paint => ({
    type: "solid",
    color,
    opacity: Math.min(1, opacity * material.patternContrast),
  });
  const top = geom.backPeak.y;
  const bot = geom.bellyLow.y;
  const rear = geom.peduncleTop.x;

  const density = tuning.density ?? 1;
  const scale = tuning.scale ?? 1;
  const randomness = tuning.randomness ?? 1;
  const clean = style === "clean";
  const barCount = Math.max(3, Math.round(7 * density));

  const skelStart = lerp(geom.nose.x, rear, includedHead ? 0 : 0.25);
  const skelEnd = lerp(geom.nose.x, rear, 0.77);

  const skeleton: number[] = [];

  const baseSpacing = (skelEnd - skelStart) / Math.max(1, barCount - 1);

  let currentX = skelStart;

  for (let i = 0; i < barCount; i++) {
    skeleton.push(currentX);

    if (i < barCount - 1) {
      const spacingRandom = lerp(0.65, 1.35, rng());
      currentX += baseSpacing * spacingRandom;
    }
  }

  // Keep the last stripe inside the stripe area.
  if (skeleton.length > 1) {
    const last = skeleton[skeleton.length - 1];

    if (last > skelEnd) {
      const overflow = last - skelEnd;

      for (let i = 0; i < skeleton.length; i++) {
        skeleton[i] -= overflow * (i / (skeleton.length - 1));
      }
    }
  }

  const hi = top - 5;
  const lo = bot + 5;

  const bar = (d: string) => {
    out.push({
      kind: "path",
      d,
      paint: solid(stripeColor, 0.5),
      blur: 1.6,
      clip: bodyD,
    });

    out.push({
      kind: "path",
      d,
      paint: solid(stripeColor, 0.92),
      blur: 0.35,
      clip: bodyD,
    });
  };

  // Stripe always starts from the top of the back.
  // The end point is randomized: either around the middle of the body
  // or extends all the way to the bottom.
  const stripeBar = (
    x: number,
    topWidth: number,
    bottomWidth: number,
    lean: number,
    endY: number,
  ) => {
    const length = Math.abs(endY - hi);

    // Sharp tip at the bottom.
    const tipInset = Math.min(topWidth * 0.9, length * 0.18);

    const topBodyY = hi + tipInset;
    const bottomBodyY = endY - tipInset;

    return (
      `M ${f(x)} ${f(hi)} ` +
      // Top: wide
      `L ${f(x + topWidth)} ${f(topBodyY)} ` +
      // Taper down to a smaller width
      `L ${f(x + bottomWidth + lean)} ${f(bottomBodyY)} ` +
      // Bottom: sharp tip
      `L ${f(x)} ${f(endY)} ` +
      // Other side
      `L ${f(x - bottomWidth + lean)} ${f(bottomBodyY)} ` +
      `L ${f(x - topWidth)} ${f(topBodyY)} ` +
      `Z`
    );
  };

  for (const baseX of skeleton) {
    const jitterSpan = (clean ? 2 : 3) * randomness;

    const x = baseX + lerp(-jitterSpan, jitterSpan, rng());

    const w = (clean ? lerp(minWidth, maxWidth, rng()) : lerp(3.0, 6.5, rng())) * scale;
    const lean = lerp(-3.6, -0.6, rng()) * randomness;
    const bottomWidth = w * lerp(0.45, 0.18, rng());
    // Always start from the top of the back.
    // Randomly end anywhere from the middle of the body
    // to the bottom of the belly.
    const endY = lerp(top * 0.15, lo, Math.pow(rng(), 0.7));
    if (clean) {
      if (rng() < Math.min(0.9, 0.28 * randomness)) {
        bar(stripeBar(x, w, bottomWidth, lean, endY));
      } else {
        // Normal pointed stripe.
        bar(stripeBar(x, w, bottomWidth, lean, endY));
      }
    } else {
      bar(stripeBar(x, w, bottomWidth, lean, endY));
      bar(stripeBar(x, w, bottomWidth, lean, endY));
    }
  }

  return out;
};
