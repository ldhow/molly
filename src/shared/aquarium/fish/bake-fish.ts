// Composes `anatomy.ts` (body geometry) + `fins.ts` (fin membranes) +
// `pigment.ts` (ported palette/pattern/shimmer/scales) into one drawable
// fish, and bakes it to a single texture.
//
// Draw order is the "buried root" trick real fish-art pipelines use (see
// `render-spec.ts`'s `pushFin`, the reference this ports): fins that attach
// BEHIND the body draw first, at low alpha where they're a depth cue (the
// far pectoral, far pelvic) or full alpha where they're not (dorsal, anal,
// near pelvic, caudal) — then the OPAQUE body skin fill draws over all of
// them, burying every root, so the seam between "fin" and "body" never
// shows. Only the near pectoral draws AFTER the skin, since a real pectoral
// sits on top of the flank, not behind it.
//
// Still ONE image per (traits, stage): the spine warp in `spine.ts` /
// `core/sksl/warp.ts` animates the whole baked texture — fins included — as
// one piece, which is what makes "fins are separate shapes" and "the fish
// bends as one organism" compatible instead of contradictory.

import { bakeBytes, bakeNodes, densityAwareDpr, type BakedArt } from "@/shared/aquarium/core/bake";
import {
  inflateBox,
  unionBox,
  type Box,
  type Node,
  type Paint,
  type XY,
} from "@/shared/aquarium/core/ir";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { getColorDef } from "@/shared/fish/catalog";
import type { ColorDef, FishTraits, LifeStage } from "@/shared/fish/types";
import { darken, rgba } from "@/shared/lib/color";

import { buildFishAnatomy, type FishAnatomy, type FishFins } from "./anatomy";
import type { FinShape } from "./fins";
import { aquariumColorDef } from "./pattern-defs";
import {
  materialFor,
  patternPrimitives,
  scalePrimitives,
  shimmerPrimitive,
  sparklePrimitives,
  type PigmentGeom,
} from "./pigment";

/** Vertical squish per life stage — same values the old renderer uses. */
export const STAGE_SQUISH: Record<LifeStage, number> = {
  egg: 1,
  fry: 0.72,
  juvenile: 0.88,
  adult: 1,
};

const BOUNDS_PAD = 22;
const F = (n: number) => n.toFixed(1);

export interface FishAquariumSpec {
  nodes: Node[];
  bounds: Box;
  anatomy: FishAnatomy;
}

/**
 * One fin as a translucent membrane: root-opaque gradient fill, multiply ray
 * lines, a plusLighter light-catch along the pivot->tip axis, and a soft
 * outline — the "dark near the body, lighter toward the edges" look real fin
 * illustration references describe. `isolate: true` is mandatory: the
 * multiply rays and plusLighter catch must composite against the fin's own
 * fill, not whatever the water or body behind it happens to be.
 */
function finMembraneNodes(
  fin: FinShape,
  membranePaint: Paint,
  rayColor: string,
  outlineColor: string,
): Node {
  const children: Node[] = [
    { kind: "path", d: fin.d, paint: membranePaint },
    ...fin.rays.map((d): Node => ({
      kind: "path",
      d,
      paint: { type: "solid", color: rayColor, opacity: fin.rayAlpha },
      stroke: { width: 1 },
      blend: "multiply",
      clip: fin.d,
    })),
    {
      kind: "path",
      d: fin.d,
      blend: "plusLighter",
      blur: 2,
      clip: fin.d,
      paint: {
        type: "linear",
        from: fin.pivot,
        to: fin.tip,
        stops: [
          { offset: 0, color: "rgba(255,255,255,0)" },
          { offset: 0.35, color: "rgba(255,255,255,0.13)" },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ],
      },
    },
    // Fin keyline — bolder than the old 0.34/1.1/0.9 soft edge so fins read
    // as drawn shapes matching the body's contour weight, but deliberately
    // lighter than the body's own line (0.62 vs 0.88, 1.5 vs 2.1): a fin is
    // a translucent membrane, and an equally heavy outline makes it look
    // like a solid paddle glued on.
    {
      kind: "path",
      d: fin.d,
      paint: { type: "solid", color: outlineColor, opacity: 0.62 },
      stroke: { width: 1.5 },
      blur: 0.25,
    },
  ];
  return { kind: "group", children, opacity: fin.alpha, isolate: true };
}

function finsBbox(fins: FishFins): Box {
  return Object.values(fins).reduce<Box | null>(
    (b, fin) => (b ? unionBox(b, fin.bbox) : fin.bbox),
    null,
  )!;
}

export function buildFishAquariumSpec(traits: FishTraits, def: ColorDef): FishAquariumSpec {
  const anatomy = buildFishAnatomy(traits);
  const { landmarks, outlineD, fins } = anatomy;
  const aquaDef = aquariumColorDef(def);
  const material = materialFor(def.rarity.tier);
  const seed = traits.patternSeed ?? 0;
  const p = aquaDef.palette;
  const outlineColor = darken(p.back, 0.45);

  const pigmentGeom: PigmentGeom = {
    d: outlineD,
    x0: landmarks.x0,
    length: landmarks.length,
    topAt: anatomy.baseTop,
    bottomAt: anatomy.baseBottom,
    nose: landmarks.nose,
    backPeak: landmarks.backPeak,
    bellyLow: landmarks.bellyLow,
    peduncleTop: landmarks.peduncleTop,
    halfHeight: landmarks.halfHeight,
  };
  const trunkBbox: Box = {
    x: landmarks.nose.x,
    y: landmarks.backPeak.y,
    width: landmarks.peduncleTop.x - landmarks.nose.x,
    height: landmarks.bellyLow.y - landmarks.backPeak.y,
  };

  const bp = landmarks.backPeak.y;
  const belly = landmarks.bellyLow.y;
  const px = landmarks.peduncleTop.x;

  // Face anchors, as fractions of the head (u-position + a fraction of the
  // local top/bottom half-height) rather than absolute pixel offsets from
  // the nose plane — a re-sculpted snout moves them automatically, which the
  // previous hand-tuned "nose.x + 21 / + 19 / + 20" constants could not do.
  const U_EYE = 0.155;
  const U_GILL = 0.26;
  const U_BLUSH = 0.2;
  const xAt = (u: number) => landmarks.x0 + u * landmarks.length;
  const topAt = (u: number) => -anatomy.baseTop(u);
  const botAt = (u: number) => anatomy.baseBottom(u);
  // How much deeper this body is than the standard body's own head — the
  // gill patch's hand-authored shape (proven to look right) scales with it
  // instead of a fixed-size patch looking undersized on balloon's head.
  const gillScale = landmarks.halfHeight / 28.5;

  const finPaint = (pivot: XY, tip: XY): Paint => ({
    type: "linear",
    from: pivot,
    to: tip,
    stops: [
      { offset: 0, color: rgba(darken(p.fin, 0.24), 0.9) },
      { offset: 0.55, color: rgba(p.fin, 0.8) },
      // Lighter toward the tip than the old pipeline's 0.9x — now that fins
      // are large enough to actually read, the translucency is more visible
      // and more of the point ("dark near the body, lighter at the edges").
      { offset: 1, color: rgba(p.fin, material.finTrail * 0.75) },
    ],
  });
  const rayColor = darken(p.finRay, 0.1);
  const fin = (f: FinShape) =>
    finMembraneNodes(f, finPaint(f.pivot, f.tip), rayColor, outlineColor);

  const nodes: Node[] = [];

  // Behind the body, buried at the root by the opaque skin fill drawn next.
  nodes.push(fin(fins.pectoralFar));
  nodes.push(fin(fins.pelvicFar));
  nodes.push(fin(fins.caudal));
  nodes.push(fin(fins.dorsal));
  nodes.push(fin(fins.anal));
  nodes.push(fin(fins.pelvicNear));

  // The opaque body skin — everything above this line has its root buried.
  const skinAlbedo: Node[] = [
    {
      kind: "path",
      d: outlineD,
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
    },
    ...patternPrimitives(def.id, aquaDef.pattern, pigmentGeom, material, seed),
  ];
  const shimmer = def.shimmer ? shimmerPrimitive(def.shimmer, pigmentGeom, material, seed) : null;
  if (shimmer) skinAlbedo.push(shimmer.base);
  skinAlbedo.push(...scalePrimitives(def, pigmentGeom, trunkBbox, outlineD, seed));

  const skin: Node[] = [...skinAlbedo];
  // Counter-shading: dark at the back, light at the belly. Deliberately a
  // SHORT stop list (was 7 soft stops fading in and out) — the mascot pass
  // wants one readable light-to-dark sweep, not a wash of overlapping soft
  // gradients that average out to flat mid-tone at normal viewing size.
  skin.push({
    kind: "path",
    d: outlineD,
    paint: {
      type: "linear",
      from: { x: 0, y: bp },
      to: { x: 0, y: belly },
      stops: [
        { offset: 0, color: "rgba(0,0,0,0.34)" },
        { offset: 0.42, color: "rgba(0,0,0,0.0)" },
        { offset: 0.86, color: "rgba(255,255,255,0.16)" },
        { offset: 1, color: "rgba(0,0,0,0.14)" },
      ],
    },
  });
  // Rear/belly ambient occlusion — kept (it's what stops the body reading as
  // a flat decal) but tightened and pushed rearward so it shades the peduncle
  // rather than washing the whole lower half.
  const shadowTone = darken(p.back, 0.6);
  skin.push({
    kind: "path",
    d: outlineD,
    blend: "multiply",
    paint: {
      type: "radial",
      center: { x: px * 0.78, y: belly * 0.6 },
      radius: landmarks.halfHeight * 1.5,
      scale: { x: 1.5, y: 1 },
      stops: [
        { offset: 0, color: rgba(shadowTone, 0.42) },
        { offset: 0.65, color: rgba(shadowTone, 0.1) },
        { offset: 1, color: rgba(shadowTone, 0) },
      ],
    },
  });
  // ONE clean specular highlight on the upper flank, replacing the previous
  // softLight bloom + wide blurred gloss STRIPE pair. The mascot reference
  // reads its shine as a single compact bright shape, not a broad sheen —
  // hence a tight ellipse (scale x2.2) at low blur instead of a full-width
  // gradient band at blur 6. `material.gloss`/`bloom` still scale it, so
  // rarer tiers stay shinier (see MATERIAL_BY_TIER in pigment.ts).
  const glossCx = xAt(0.34);
  const glossCy = bp * 0.62;
  const glossPeak = Math.min(0.95, material.gloss * 1.5 + material.bloom * 0.35);
  skin.push({
    kind: "path",
    d: outlineD,
    blend: "screen",
    blur: 2.2,
    clip: outlineD,
    paint: {
      type: "radial",
      center: { x: glossCx, y: glossCy },
      radius: landmarks.halfHeight * 0.5,
      scale: { x: 2.2, y: 1 },
      stops: [
        { offset: 0, color: `rgba(255,255,255,${glossPeak.toFixed(2)})` },
        { offset: 0.55, color: `rgba(255,255,255,${(glossPeak * 0.35).toFixed(2)})` },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });

  nodes.push({ kind: "group", children: skin, isolate: true });

  // Gill cover — position tracks the new body via `xAt(U_GILL)`, and the
  // whole hand-authored leaf shape scales with `gillScale` so it doesn't
  // look undersized on a deeper head (balloon).
  const gx = xAt(U_GILL);
  const gs = gillScale;
  nodes.push({
    kind: "path",
    d:
      `M ${F(gx)} ${F(bp + 7 * gs)} C ${F(gx + 7 * gs)} ${F(bp + 15 * gs)} ${F(gx + 7 * gs)} ${F(6 * gs)} ${F(gx)} ${F(15 * gs)} ` +
      `C ${F(gx - 10 * gs)} ${F(13 * gs)} ${F(gx - 17 * gs)} ${F(4 * gs)} ${F(gx - 18 * gs)} ${F(-4 * gs)} ` +
      `C ${F(gx - 18 * gs)} ${F(-12 * gs)} ${F(gx - 11 * gs)} ${F(bp + 8 * gs)} ${F(gx)} ${F(bp + 7 * gs)} Z`,
    paint: { type: "solid", color: "#ffffff", opacity: 0.16 },
    clip: outlineD,
  });
  nodes.push({
    kind: "path",
    d: `M ${F(gx)} ${F(bp + 7 * gs)} C ${F(gx + 7 * gs)} ${F(bp + 15 * gs)} ${F(gx + 7 * gs)} ${F(6 * gs)} ${F(gx)} ${F(15 * gs)}`,
    paint: { type: "solid", color: outlineColor, opacity: 0.55 },
    stroke: { width: 1.6 },
    blur: 0.3,
    clip: outlineD,
  });

  // Contour — a BOLD drawn keyline (mascot pass). This deliberately reverses
  // the earlier "soft, storybook" treatment (0.34 alpha / 1.1 width / 0.9
  // blur / multiply), which read as a soft shadow rather than a line: a
  // near-opaque solid stroke at ~2x the width and almost no blur is the
  // single biggest thing separating the reference's clean illustrated look
  // from a soft-shaded vector blob. `multiply` is dropped too — it made the
  // line's darkness depend on whatever it happened to sit over.
  nodes.push({
    kind: "path",
    d: outlineD,
    paint: { type: "solid", color: outlineColor, opacity: 0.88 },
    stroke: { width: 2.1 },
    blur: 0.15,
  });
  // Rim light.
  nodes.push({
    kind: "path",
    d: outlineD,
    stroke: { width: 2 },
    blend: "plusLighter",
    blur: 0.8,
    clip: outlineD,
    paint: {
      type: "linear",
      from: { x: landmarks.nose.x, y: belly },
      to: { x: px, y: bp },
      stops: [
        { offset: 0, color: "rgba(255,255,255,0)" },
        { offset: 0.55, color: `rgba(255,255,255,${(material.rim * 0.32).toFixed(2)})` },
        { offset: 1, color: `rgba(255,255,255,${material.rim})` },
      ],
    },
  });
  if (shimmer?.accents.length) nodes.push(...shimmer.accents);
  nodes.push(...sparklePrimitives(pigmentGeom, def.rarity.tier, seed));

  // Only the near pectoral overlays the flank AFTER the skin — a real
  // pectoral sits on top, not buried behind it.
  nodes.push(fin(fins.pectoralNear));

  // Mouth.
  const nx = landmarks.nose.x;
  const ny = landmarks.nose.y;
  nodes.push({
    kind: "path",
    d: `M ${F(nx + 0.5)} ${F(ny + 3)} C ${F(nx + 3)} ${F(ny + 4.5)} ${F(nx + 6)} ${F(ny + 5.5)} ${F(nx + 9)} ${F(ny + 5.5)}`,
    paint: { type: "solid", color: "#000000", opacity: 0.5 },
    stroke: { width: 1.6 },
    clip: outlineD,
  });
  nodes.push({
    kind: "path",
    d: `M ${F(nx + 1)} ${F(ny + 1)} C ${F(nx + 4)} ${F(ny + 2)} ${F(nx + 7)} ${F(ny + 2.5)} ${F(nx + 10)} ${F(ny + 2.5)}`,
    paint: { type: "solid", color: "#ffffff", opacity: 0.28 },
    stroke: { width: 1.3 },
    clip: outlineD,
  });

  // Blush — dialled down (Pondlife pass: cute comes from proportion, not a decal).
  const blushCx = xAt(U_BLUSH);
  const blushCy = botAt(U_BLUSH) * 0.1;
  const blushR = 6.5;
  nodes.push({
    kind: "circle",
    cx: blushCx,
    cy: blushCy,
    r: blushR,
    blur: 1.8,
    clip: outlineD,
    paint: {
      type: "radial",
      center: { x: blushCx, y: blushCy },
      radius: blushR,
      stops: [
        { offset: 0, color: "rgba(255,120,140,0.16)" },
        { offset: 0.55, color: "rgba(255,120,140,0.09)" },
        { offset: 1, color: "rgba(255,120,140,0)" },
      ],
    },
  });

  // Eye — the structure (sclera / ring / pupil / catchlight) was already
  // right; the mascot pass just scales it up and thickens the ring so it
  // reads as a drawn cartoon eye rather than a modest naturalistic dot.
  const eye = { cx: xAt(U_EYE), cy: topAt(U_EYE) * 0.42 };
  const r = 6.3;
  nodes.push({ kind: "circle", ...eye, r, paint: { type: "solid", color: "#f8f5ee" } });
  nodes.push({
    kind: "path",
    d: `M ${F(eye.cx - r)} ${F(eye.cy)} a ${r} ${r} 0 1 0 ${F(r * 2)} 0 a ${r} ${r} 0 1 0 ${F(-r * 2)} 0`,
    paint: { type: "solid", color: "#12161f", opacity: 0.95 },
    stroke: { width: 1.7 },
  });
  nodes.push({ kind: "circle", ...eye, r: 3.7, paint: { type: "solid", color: "#0b0e14" } });
  nodes.push({
    kind: "circle",
    cx: eye.cx - 1.7,
    cy: eye.cy - 1.9,
    r: 1.7,
    paint: { type: "solid", color: "#f9fcff", opacity: 0.97 },
  });

  const bounds = inflateBox(unionBox(landmarks.bbox, finsBbox(fins)), BOUNDS_PAD);

  return { nodes, bounds, anatomy };
}

/** `(traits, stage)` -> a cache key stable across renders, per the React Compiler note in the plan. */
export function fishBakeKey(traits: FishTraits, stage: LifeStage): string {
  return `${traits.color}|${traits.body}|${traits.tail}|${traits.dorsal}|${traits.patternSeed ?? 0}|${stage}`;
}

export function bakeFish(
  Skia: SkiaApi,
  traits: FishTraits,
  stage: LifeStage,
  dpr: number,
): BakedArt | null {
  const def = getColorDef(traits.color);
  const { nodes, bounds } = buildFishAquariumSpec(traits, def);
  return bakeNodes(Skia, nodes, bounds, dpr, STAGE_SQUISH[stage]);
}

export { densityAwareDpr, bakeBytes };
