// Composes `anatomy.ts` (body + bent-leg geometry) and `pigment.ts` (palette
// + spot texture) into one drawable frog, and bakes it to a single texture —
// the frog's own version of `fish/bake-fish.ts`'s role.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import { circleChainNodes } from "@/shared/aquarium/core/limb-chain";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { rgba } from "@/shared/lib/color";

import { buildFrogAnatomy, type FrogAnatomy } from "./anatomy";
import type { BentLeg } from "./limbs";
import { frogPaletteFor, frogSkinPaint, frogSpotPrimitives } from "./pigment";

const BOUNDS_PAD = 6;

export function frogBakeKey(variant: string): string {
  return `frog|${variant}`;
}

function legNodes(leg: BentLeg, skinColor: string): Node {
  return {
    kind: "group",
    children: circleChainNodes(leg.circles, { type: "solid", color: skinColor }),
    isolate: true,
  };
}

export function buildFrogAquariumSpec(variant: string): { nodes: Node[]; bounds: Box } {
  const anatomy: FrogAnatomy = buildFrogAnatomy();
  const palette = frogPaletteFor(variant);
  const skin = frogSkinPaint(palette);
  const seed = hashVariant(variant);

  const nodes: Node[] = [];

  // Far leg buried behind the body first, near leg drawn after — the same
  // "buried root" ordering `fish/bake-fish.ts` uses for its far fins.
  nodes.push(legNodes(anatomy.legFar, skin.mid));

  const bodySkin: Node[] = [
    {
      kind: "path",
      d: anatomy.bodyD,
      paint: {
        type: "linear",
        from: { x: 0, y: -19 },
        to: { x: 0, y: 19 },
        stops: [
          { offset: 0, color: skin.top },
          { offset: 0.55, color: skin.mid },
          { offset: 1, color: skin.bottom },
        ],
      },
    },
    // Pale belly patch — every frog reads as lighter-underneath.
    {
      kind: "path",
      d: anatomy.bodyD,
      blend: "srcOver",
      blur: 3,
      clip: anatomy.bodyD,
      paint: {
        type: "radial",
        center: { x: 0, y: 12 },
        radius: 22,
        stops: [
          { offset: 0, color: rgba(palette.bellyColor, 0.85) },
          { offset: 0.6, color: rgba(palette.bellyColor, 0.35) },
          { offset: 1, color: rgba(palette.bellyColor, 0) },
        ],
      },
    },
    ...frogSpotPrimitives(palette, seed, anatomy.bodyD),
  ];
  nodes.push({ kind: "group", children: bodySkin, isolate: true });

  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    blend: "screen",
    blur: 4,
    clip: anatomy.bodyD,
    paint: {
      type: "radial",
      center: { x: -6, y: -12 },
      radius: 20,
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.24)" },
        { offset: 0.6, color: "rgba(255,255,255,0.06)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    paint: { type: "solid", color: skin.outline, opacity: 0.4 },
    stroke: { width: 1.1 },
    blend: "multiply",
    blur: 0.7,
  });

  nodes.push(legNodes(anatomy.legNear, skin.mid));

  // Mouth.
  nodes.push({
    kind: "path",
    d: anatomy.mouthD,
    paint: { type: "solid", color: "#12161f", opacity: 0.55 },
    stroke: { width: 1.4 },
    clip: anatomy.bodyD,
  });

  // Eyes on top — the frog's defining feature.
  for (const eye of [anatomy.eyeL, anatomy.eyeR]) {
    nodes.push({
      kind: "circle",
      cx: eye.x,
      cy: eye.y,
      r: anatomy.eyeRadius,
      paint: { type: "solid", color: skin.mid },
    });
    nodes.push({
      kind: "circle",
      cx: eye.x,
      cy: eye.y,
      r: anatomy.eyeRadius * 0.72,
      paint: { type: "solid", color: "#f6f2e8" },
    });
    nodes.push({
      kind: "circle",
      cx: eye.x,
      cy: eye.y,
      r: anatomy.eyeRadius * 0.4,
      paint: { type: "solid", color: "#12161f" },
    });
    nodes.push({
      kind: "circle",
      cx: eye.x - anatomy.eyeRadius * 0.18,
      cy: eye.y - anatomy.eyeRadius * 0.22,
      r: anatomy.eyeRadius * 0.15,
      paint: { type: "solid", color: "#ffffff", opacity: 0.9 },
    });
  }

  const bounds = inflateBox(anatomy.bounds, BOUNDS_PAD);
  return { nodes, bounds };
}

function hashVariant(variant: string): number {
  let h = 0;
  for (let i = 0; i < variant.length; i++) h = (h * 31 + variant.charCodeAt(i)) >>> 0;
  return h % 1000;
}

export function bakeFrog(Skia: SkiaApi, variant: string, dpr: number): BakedArt | null {
  const { nodes, bounds } = buildFrogAquariumSpec(variant);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
