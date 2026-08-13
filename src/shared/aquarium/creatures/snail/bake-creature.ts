// Composes `anatomy.ts` (shell + foot geometry) and `pigment.ts` (palette +
// whorl banding) into one drawable snail, and bakes it to a single texture —
// the snail's own version of `fish/bake-fish.ts`'s role.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { darken, rgba } from "@/shared/lib/color";

import { buildSnailAnatomy } from "./anatomy";
import { snailPaletteFor, snailShellPatternPrimitives, snailSkinPaint } from "./pigment";

const BOUNDS_PAD = 6;
const F = (n: number) => n.toFixed(1);

export function snailBakeKey(variant: string): string {
  return `snail|${variant}`;
}

export function buildSnailAquariumSpec(variant: string): { nodes: Node[]; bounds: Box } {
  const anatomy = buildSnailAnatomy();
  const palette = snailPaletteFor(variant);
  const skin = snailSkinPaint(palette);
  const seed = hashVariant(variant);

  const nodes: Node[] = [];

  // Foot first — it sits partly behind the shell's near edge.
  nodes.push({
    kind: "path",
    d: anatomy.footD,
    paint: {
      type: "linear",
      from: { x: 0, y: anatomy.opening.y - 10 },
      to: { x: 0, y: anatomy.opening.y + 14 },
      stops: [
        { offset: 0, color: darken(palette.footColor, 0.1) },
        { offset: 0.5, color: palette.footColor },
        { offset: 1, color: darken(palette.footColor, 0.3) },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.footD,
    paint: { type: "solid", color: skin.outline, opacity: 0.5 },
    stroke: { width: 1 },
    blend: "multiply",
    blur: 0.6,
  });

  // Eye stalks — two thin curved lines with a small dark tip, the one
  // unmistakably "snail" character beat.
  const base = anatomy.eyeStalkBase;
  for (const dir of [-1, 1]) {
    const tipX = base.x + dir * 3 + 5;
    const tipY = base.y - 9;
    nodes.push({
      kind: "path",
      d: `M ${F(base.x)} ${F(base.y)} Q ${F(base.x + dir * 2)} ${F(base.y - 6)} ${F(tipX)} ${F(tipY)}`,
      paint: { type: "solid", color: palette.footColor, opacity: 0.95 },
      stroke: { width: 1.6 },
    });
    nodes.push({
      kind: "circle",
      cx: tipX,
      cy: tipY,
      r: 1.5,
      paint: { type: "solid", color: "#12161f", opacity: 0.9 },
    });
  }

  // The shell — opaque skin fill, then whorl banding, then a soft gloss.
  const shellSkin: Node[] = [
    {
      kind: "path",
      d: anatomy.shellD,
      paint: {
        type: "linear",
        from: { x: -20, y: -20 },
        to: { x: 20, y: 20 },
        stops: [
          { offset: 0, color: skin.top },
          { offset: 0.5, color: skin.mid },
          { offset: 1, color: skin.bottom },
        ],
      },
    },
    ...snailShellPatternPrimitives(palette, seed, anatomy.shellD),
  ];
  nodes.push({ kind: "group", children: shellSkin, isolate: true });

  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    blend: "screen",
    blur: 3,
    clip: anatomy.shellD,
    paint: {
      type: "radial",
      center: { x: -4, y: -6 },
      radius: 20,
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.28)" },
        { offset: 0.6, color: "rgba(255,255,255,0.08)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    paint: { type: "solid", color: skin.outline, opacity: 0.4 },
    stroke: { width: 1.1 },
    blend: "multiply",
    blur: 0.7,
  });
  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    stroke: { width: 1.4 },
    blend: "plusLighter",
    blur: 0.6,
    clip: anatomy.shellD,
    paint: { type: "solid", color: rgba("#ffffff", 0.18) },
  });

  const bounds = inflateBox(anatomy.bounds, BOUNDS_PAD);
  return { nodes, bounds };
}

function hashVariant(variant: string): number {
  let h = 0;
  for (let i = 0; i < variant.length; i++) h = (h * 31 + variant.charCodeAt(i)) >>> 0;
  return h % 1000;
}

export function bakeSnail(Skia: SkiaApi, variant: string, dpr: number): BakedArt | null {
  const { nodes, bounds } = buildSnailAquariumSpec(variant);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
