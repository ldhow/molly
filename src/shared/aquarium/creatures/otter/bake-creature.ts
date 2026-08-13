// Composes `anatomy.ts` (body + head + leg geometry) and `pigment.ts`
// (fur palette) into one drawable otter, and bakes it to a single texture —
// the otter's own version of `fish/bake-fish.ts`'s role.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import { circleChainNodes } from "@/shared/aquarium/core/limb-chain";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { darken, rgba } from "@/shared/lib/color";

import { buildOtterAnatomy } from "./anatomy";
import { otterPaletteFor, otterSkinPaint } from "./pigment";

const BOUNDS_PAD = 6;

export function otterBakeKey(variant: string): string {
  return `otter|${variant}`;
}

export function buildOtterAquariumSpec(variant: string): { nodes: Node[]; bounds: Box } {
  const anatomy = buildOtterAnatomy();
  const palette = otterPaletteFor(variant);
  const skin = otterSkinPaint(palette);
  const legColor = darken(skin.mid, 0.12);

  const nodes: Node[] = [];

  // Far legs behind the body, then head (partly overlapped by the body's
  // front edge), then the body itself — the same buried-root ordering every
  // other creature module uses.
  nodes.push({
    kind: "group",
    children: [anatomy.legs[1], anatomy.legs[3]].flatMap((leg) =>
      circleChainNodes(leg, { type: "solid", color: legColor }),
    ),
    isolate: true,
  });

  nodes.push({
    kind: "path",
    d: anatomy.headD,
    paint: {
      type: "linear",
      from: { x: 0, y: -9 },
      to: { x: 0, y: 9 },
      stops: [
        { offset: 0, color: skin.top },
        { offset: 1, color: skin.bottom },
      ],
    },
  });
  for (const ear of [anatomy.earL, anatomy.earR]) {
    nodes.push({
      kind: "circle",
      cx: ear.x,
      cy: ear.y,
      r: 2.6,
      paint: { type: "solid", color: skin.mid },
    });
  }

  const bodySkin: Node[] = [
    {
      kind: "path",
      d: anatomy.bodyD,
      paint: {
        type: "linear",
        from: { x: 0, y: -11 },
        to: { x: 0, y: 12 },
        stops: [
          { offset: 0, color: skin.top },
          { offset: 0.4, color: skin.mid },
          { offset: 1, color: skin.bottom },
        ],
      },
    },
    // Pale belly patch — the fur-colour cue real otters read most strongly.
    {
      kind: "path",
      d: anatomy.bodyD,
      blur: 2.5,
      clip: anatomy.bodyD,
      paint: {
        type: "radial",
        center: { x: -12, y: 5 },
        radius: 24,
        stops: [
          { offset: 0, color: rgba(palette.bellyColor, 0.7) },
          { offset: 0.6, color: rgba(palette.bellyColor, 0.25) },
          { offset: 1, color: rgba(palette.bellyColor, 0) },
        ],
      },
    },
  ];
  nodes.push({ kind: "group", children: bodySkin, isolate: true });

  // Gloss + shadow — the exact multiply/screen layering fish/turtle/frog
  // already use, just this creature's own palette (fur, not scales).
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    blend: "screen",
    blur: 4,
    clip: anatomy.bodyD,
    paint: {
      type: "radial",
      center: { x: -6, y: -8 },
      radius: 20,
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.22)" },
        { offset: 0.6, color: "rgba(255,255,255,0.06)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    blend: "multiply",
    blur: 3,
    clip: anatomy.bodyD,
    paint: {
      type: "radial",
      center: { x: 20, y: 6 },
      radius: 22,
      stops: [
        { offset: 0, color: rgba(skin.outline, 0.35) },
        { offset: 0.7, color: rgba(skin.outline, 0.1) },
        { offset: 1, color: rgba(skin.outline, 0) },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.bodyD,
    paint: { type: "solid", color: skin.outline, opacity: 0.4 },
    stroke: { width: 1.1 },
    blend: "multiply",
    blur: 0.6,
  });

  nodes.push({
    kind: "group",
    children: [anatomy.legs[0], anatomy.legs[2]].flatMap((leg) =>
      circleChainNodes(leg, { type: "solid", color: legColor }),
    ),
    isolate: true,
  });

  // Whiskers.
  for (const d of anatomy.whiskersD) {
    nodes.push({
      kind: "path",
      d,
      paint: { type: "solid", color: "#f4f0e8", opacity: 0.6 },
      stroke: { width: 0.6 },
    });
  }

  // Nose + eyes.
  const noseCx = anatomy.eyeL.x + (anatomy.eyeR.x - anatomy.eyeL.x) / 2;
  nodes.push({
    kind: "circle",
    cx: noseCx,
    cy: anatomy.eyeL.y + 6,
    r: 1.6,
    paint: { type: "solid", color: palette.noseColor },
  });
  for (const eye of [anatomy.eyeL, anatomy.eyeR]) {
    nodes.push({
      kind: "circle",
      cx: eye.x,
      cy: eye.y,
      r: 1.6,
      paint: { type: "solid", color: "#12161f", opacity: 0.9 },
    });
    nodes.push({
      kind: "circle",
      cx: eye.x - 0.5,
      cy: eye.y - 0.5,
      r: 0.5,
      paint: { type: "solid", color: "#f9fcff", opacity: 0.9 },
    });
  }

  const bounds = inflateBox(anatomy.bounds, BOUNDS_PAD);
  return { nodes, bounds };
}

export function bakeOtter(Skia: SkiaApi, variant: string, dpr: number): BakedArt | null {
  const { nodes, bounds } = buildOtterAquariumSpec(variant);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
