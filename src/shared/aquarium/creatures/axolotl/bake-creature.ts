// Composes `anatomy.ts` (body + gill + leg geometry) and `pigment.ts`
// (palette + speckling) into one drawable axolotl, and bakes it to a single
// texture — the axolotl's own version of `fish/bake-fish.ts`'s role.
//
// This is the one non-molly species that spine-warps in the tank
// (`locomotion: "undulating"` — see `render/creature-layer.tsx`); nothing
// about the BAKE itself differs for that, the warp shader operates on the
// baked texture generically via its bounds, not anything species-specific.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import { circleChainNodes, type ChainCircle } from "@/shared/aquarium/core/limb-chain";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { darken } from "@/shared/lib/color";

import { buildAxolotlAnatomy } from "./anatomy";
import { axolotlPaletteFor, axolotlSkinPaint, axolotlSpecklePrimitives } from "./pigment";

const BOUNDS_PAD = 6;

export function axolotlBakeKey(variant: string): string {
  return `axolotl|${variant}`;
}

function gillNodes(fronds: ChainCircle[][], color: string): Node {
  const children: Node[] = fronds.flatMap((frond) =>
    circleChainNodes(frond, { type: "solid", color }),
  );
  return { kind: "group", children, isolate: true };
}

export function buildAxolotlAquariumSpec(variant: string): { nodes: Node[]; bounds: Box } {
  const anatomy = buildAxolotlAnatomy();
  const palette = axolotlPaletteFor(variant);
  const skin = axolotlSkinPaint(palette);
  const legColor = darken(skin.mid, 0.18);
  const seed = hashVariant(variant);

  const nodes: Node[] = [];

  // Far gills, far legs behind the body first — buried root, same ordering
  // every other creature module uses for limbs.
  nodes.push(gillNodes(anatomy.gillsFar, palette.gillColor));
  nodes.push({
    kind: "group",
    children: [anatomy.legs[1], anatomy.legs[3]].flatMap((leg) =>
      circleChainNodes(leg, { type: "solid", color: legColor }),
    ),
    isolate: true,
  });

  const bodySkin: Node[] = [
    {
      kind: "path",
      d: anatomy.bodyD,
      paint: {
        type: "linear",
        from: { x: 0, y: -11 },
        to: { x: 0, y: 11 },
        stops: [
          { offset: 0, color: skin.top },
          { offset: 0.5, color: skin.mid },
          { offset: 1, color: skin.bottom },
        ],
      },
    },
    ...axolotlSpecklePrimitives(palette, seed, anatomy.bodyD, anatomy.x0, anatomy.length),
  ];
  nodes.push({ kind: "group", children: bodySkin, isolate: true });

  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    blend: "screen",
    blur: 3,
    clip: anatomy.bodyD,
    paint: {
      type: "linear",
      from: { x: 0, y: -9 },
      to: { x: 0, y: -1 },
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.2)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    paint: { type: "solid", color: skin.outline, opacity: 0.35 },
    stroke: { width: 1 },
    blend: "multiply",
    blur: 0.6,
  });

  // Near gills, near legs on top — the visible feathery frill and the pair
  // of legs closest to camera.
  nodes.push(gillNodes(anatomy.gillsNear, palette.gillColor));
  nodes.push({
    kind: "group",
    children: [anatomy.legs[0], anatomy.legs[2]].flatMap((leg) =>
      circleChainNodes(leg, { type: "solid", color: legColor }),
    ),
    isolate: true,
  });

  // Eyes.
  for (const eye of [anatomy.eyeL, anatomy.eyeR]) {
    nodes.push({
      kind: "circle",
      cx: eye.x,
      cy: eye.y,
      r: 1.4,
      paint: { type: "solid", color: "#12161f", opacity: 0.85 },
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

export function bakeAxolotl(Skia: SkiaApi, variant: string, dpr: number): BakedArt | null {
  const { nodes, bounds } = buildAxolotlAquariumSpec(variant);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
