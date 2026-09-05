// Composes `anatomy.ts` (curved spine, limbs, antennae) and `pigment.ts`
// (palette, plates, bands, speckle) into one drawable shrimp, and bakes it to
// a texture — the shrimp's own version of `fish/bake-fish.ts`'s role.
//
// Bakes in TWO PIECES, exactly like `snail/bake-creature.ts`: `"body"`
// (carapace, abdomen, legs, eye, tail fan) and `"antennae"` (baked separately
// so `render/creature-layer.tsx` can rotate them about `ANTENNA_PIVOT` for an
// independent sway while the shrimp is stationary or crawling — a shrimp's
// antennae never stop sweeping, and that motion is what sells "alive" the
// same way the snail's eye-stalk sway does). `"full"` (both pieces baked
// together, antennae at rest) is what every static surface uses
// (Creaturedex/holding-tank previews, the dead shrimp).

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import { circleChainNodes } from "@/shared/aquarium/core/limb-chain";
import { SPECULAR_TINT, tinted } from "@/shared/aquarium/core/shading";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { rgba } from "@/shared/lib/color";

import { buildShrimpAnatomy, type ShrimpAnatomy } from "./anatomy";
import {
  shrimpBandPrimitives,
  shrimpGutLinePrimitive,
  shrimpPaletteFor,
  shrimpSegmentPrimitives,
  shrimpSkinPaint,
  shrimpSpecklePrimitives,
  type ShrimpPalette,
} from "./pigment";

/** Which piece of the shrimp to bake — see this module's header. */
export type ShrimpPart = "full" | "body" | "antennae";

const BOUNDS_PAD = 4;

export function shrimpBakeKey(variant: string, part: ShrimpPart = "full"): string {
  return `shrimp|${variant}|${part}`;
}

/** Antennae only, drawn UNDER the body so their roots stay buried in the carapace. */
function antennaeNodes(anatomy: ShrimpAnatomy, palette: ShrimpPalette): Node[] {
  const skin = shrimpSkinPaint(palette);
  return anatomy.antennae.map((a, i) => ({
    kind: "path",
    d: a.d,
    // Index 0 of each pair is the far one — drawn dimmer so an overlapping
    // pair still reads as two, the trick `snail/anatomy.ts`'s eye stalks use.
    paint: {
      type: "solid",
      color: rgba(skin.outline, a.long ? (i === 0 ? 0.5 : 0.78) : 0.62),
    },
  }));
}

/** Carapace, abdomen, limbs, eye, tail fan — everything except the animated antennae. */
function bodyNodes(anatomy: ShrimpAnatomy, palette: ShrimpPalette, seed: number): Node[] {
  const skin = shrimpSkinPaint(palette);
  const nodes: Node[] = [];

  // Rostrum first, buried behind the carapace fill.
  nodes.push({
    kind: "path",
    d: anatomy.rostrumD,
    paint: { type: "solid", color: rgba(skin.mid, Math.max(0.75, palette.fillOpacity)) },
  });
  nodes.push({
    kind: "path",
    d: anatomy.rostrumD,
    paint: { type: "solid", color: skin.outline, opacity: 0.45 },
    stroke: { width: 0.7 },
    blend: "multiply",
  });

  // Tail fan next — also behind the body, so the abdomen's own fill hides
  // where the blades root.
  for (const bladeD of anatomy.tailFanD) {
    nodes.push({
      kind: "path",
      d: bladeD,
      paint: { type: "solid", color: rgba(skin.mid, Math.max(0.7, palette.fillOpacity)) },
    });
    nodes.push({
      kind: "path",
      d: bladeD,
      paint: { type: "solid", color: skin.outline, opacity: 0.5 },
      stroke: { width: 0.7 },
      blend: "multiply",
    });
  }

  // Limbs, also under the body. Swimmerets are drawn thinner and dimmer than
  // the walking legs — they are a soft fringe, not structure.
  for (const leg of anatomy.legs) {
    nodes.push({
      kind: "group",
      isolate: true,
      children: circleChainNodes(leg, { type: "solid", color: rgba(skin.outline, 0.85) }),
    });
  }
  for (const swimmeret of anatomy.swimmerets) {
    nodes.push({
      kind: "group",
      isolate: true,
      children: circleChainNodes(swimmeret, { type: "solid", color: rgba(skin.outline, 0.5) }),
    });
  }

  // --- Shell ---------------------------------------------------------------
  const shellSkin: Node[] = [
    {
      kind: "path",
      d: anatomy.bodyD,
      paint: {
        type: "linear",
        from: { x: 0, y: -22 },
        to: { x: 0, y: -2 },
        stops: [
          { offset: 0, color: rgba(skin.top, palette.fillOpacity) },
          { offset: 0.55, color: rgba(skin.mid, palette.fillOpacity) },
          { offset: 1, color: rgba(skin.bottom, palette.fillOpacity) },
        ],
      },
    },
    ...shrimpSegmentPrimitives(palette, anatomy.bodyD),
    ...shrimpBandPrimitives(palette, anatomy.bodyD),
    ...shrimpSpecklePrimitives(palette, seed, anatomy.bodyD),
  ];
  const gutLine = shrimpGutLinePrimitive(palette, anatomy.bodyD);
  if (gutLine) shellSkin.push(gutLine);
  nodes.push({ kind: "group", children: shellSkin, isolate: true });

  // Gloss over the carapace's shoulder, then the contour — the same
  // multiply/screen finish every other creature's body fill uses.
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    blend: "screen",
    blur: 4,
    clip: anatomy.bodyD,
    paint: {
      type: "radial",
      center: { x: 14, y: -22 },
      radius: 20,
      stops: [
        { offset: 0, color: tinted(SPECULAR_TINT, 0.4) },
        { offset: 0.6, color: tinted(SPECULAR_TINT, 0.1) },
        { offset: 1, color: tinted(SPECULAR_TINT, 0) },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    paint: { type: "solid", color: skin.outline, opacity: 0.45 },
    stroke: { width: 1 },
    blend: "multiply",
    blur: 0.5,
  });

  // Eye — a shrimp's is a dark bead on a very short stalk, right at the
  // carapace's leading edge.
  nodes.push({
    kind: "circle",
    cx: anatomy.eye.x,
    cy: anatomy.eye.y,
    r: anatomy.eyeRadius,
    paint: { type: "solid", color: "#12161f" },
  });
  nodes.push({
    kind: "circle",
    cx: anatomy.eye.x - anatomy.eyeRadius * 0.25,
    cy: anatomy.eye.y - anatomy.eyeRadius * 0.3,
    r: anatomy.eyeRadius * 0.33,
    paint: { type: "solid", color: "#ffffff", opacity: 0.85 },
  });

  return nodes;
}

export function buildShrimpAquariumSpec(
  variant: string,
  part: ShrimpPart = "full",
): { nodes: Node[]; bounds: Box } {
  const anatomy = buildShrimpAnatomy();
  const palette = shrimpPaletteFor(variant);
  const seed = hashVariant(variant);

  if (part === "antennae") {
    return {
      nodes: antennaeNodes(anatomy, palette),
      bounds: inflateBox(anatomy.antennaeBounds, BOUNDS_PAD),
    };
  }
  if (part === "body") {
    return {
      nodes: bodyNodes(anatomy, palette, seed),
      bounds: inflateBox(anatomy.bodyBounds, BOUNDS_PAD),
    };
  }
  return {
    nodes: [...antennaeNodes(anatomy, palette), ...bodyNodes(anatomy, palette, seed)],
    bounds: inflateBox(anatomy.bounds, BOUNDS_PAD),
  };
}

function hashVariant(variant: string): number {
  let h = 0;
  for (let i = 0; i < variant.length; i++) h = (h * 31 + variant.charCodeAt(i)) >>> 0;
  return h % 1000;
}

export function bakeShrimp(
  Skia: SkiaApi,
  variant: string,
  dpr: number,
  part: ShrimpPart = "full",
): BakedArt | null {
  const { nodes, bounds } = buildShrimpAquariumSpec(variant, part);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
