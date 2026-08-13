// Composes `anatomy.ts` (shell + head + paddle geometry) and `pigment.ts`
// (palette + scute pattern) into one drawable turtle, and bakes it to a
// single texture — the turtle's own version of `fish/bake-fish.ts`'s role.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { darken } from "@/shared/lib/color";

import { buildTurtleAnatomy } from "./anatomy";
import { turtlePaletteFor, turtleScutePrimitives, turtleSkinPaint } from "./pigment";

const BOUNDS_PAD = 6;

export function turtleBakeKey(variant: string): string {
  return `turtle|${variant}`;
}

export function buildTurtleAquariumSpec(variant: string): { nodes: Node[]; bounds: Box } {
  const anatomy = buildTurtleAnatomy();
  const palette = turtlePaletteFor(variant);
  const skin = turtleSkinPaint(palette);
  const seed = hashVariant(variant);

  const nodes: Node[] = [];

  // Paddles behind the shell rim first (buried root, same trick every
  // other creature module uses for limbs), head next (it sits partly under
  // the shell's front edge), then the shell itself on top of both.
  for (const paddle of anatomy.paddles) {
    if (!paddle.behindShell) continue;
    nodes.push({ kind: "path", d: paddle.d, paint: { type: "solid", color: palette.skinColor } });
  }

  nodes.push({
    kind: "path",
    d: anatomy.headD,
    paint: {
      type: "linear",
      from: { x: 0, y: -7 },
      to: { x: 0, y: 7 },
      stops: [
        { offset: 0, color: skin.top },
        { offset: 1, color: darken(palette.skinColor, 0.2) },
      ],
    },
  });

  const shellSkin: Node[] = [
    {
      kind: "path",
      d: anatomy.shellD,
      paint: {
        type: "linear",
        from: { x: 0, y: -20 },
        to: { x: 0, y: 20 },
        stops: [
          { offset: 0, color: skin.top },
          { offset: 0.5, color: skin.mid },
          { offset: 1, color: skin.bottom },
        ],
      },
    },
    ...turtleScutePrimitives(palette, seed, anatomy.shellD),
  ];
  nodes.push({ kind: "group", children: shellSkin, isolate: true });

  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    blend: "screen",
    blur: 4,
    clip: anatomy.shellD,
    paint: {
      type: "radial",
      center: { x: -6, y: -9 },
      radius: 22,
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.22)" },
        { offset: 0.6, color: "rgba(255,255,255,0.06)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    paint: { type: "solid", color: skin.outline, opacity: 0.45 },
    stroke: { width: 1.3 },
    blend: "multiply",
    blur: 0.6,
  });

  for (const paddle of anatomy.paddles) {
    if (paddle.behindShell) continue;
    nodes.push({ kind: "path", d: paddle.d, paint: { type: "solid", color: palette.skinColor } });
  }

  // Eyes.
  for (const eye of [anatomy.eyeL, anatomy.eyeR]) {
    nodes.push({
      kind: "circle",
      cx: eye.x,
      cy: eye.y,
      r: 1.5,
      paint: { type: "solid", color: "#12161f", opacity: 0.9 },
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

export function bakeTurtle(Skia: SkiaApi, variant: string, dpr: number): BakedArt | null {
  const { nodes, bounds } = buildTurtleAquariumSpec(variant);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
