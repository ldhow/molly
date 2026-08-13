// Placeholder rigid silhouette for every non-molly species — a simple
// proportioned blob (no real anatomy) baked through the exact same
// bake/cache/layer pipeline real per-species anatomy will use once it ships
// (Phase C, `creatures/<species>/`). Lets the economy, UI, preview, and
// swim/size composition be exercised and shipped end-to-end before
// committing to any per-species art build — see the plan's "de-risking
// sequence".
//
// Body drawn nose-LEFT (negative x), matching `fish/bake-fish.ts`'s own
// convention — `render/creature-layer.tsx`'s perspective transform mirrors
// it the same way `fish-layer.tsx` does, so a placeholder swims in the same
// visual language as a molly from day one.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, unionBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import { blobPath } from "@/shared/aquarium/core/pigment-toolkit";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { getSpeciesDef } from "@/shared/creature/catalog";
import type { SpeciesId } from "@/shared/creature/types";
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

export type CreatureSpeciesId = Exclude<SpeciesId, "molly">;

const BODY_RX = 30;
const BODY_RY = 17;
const HEAD_R = 11;
const BOUNDS_PAD = 10;

export function placeholderCreatureBakeKey(speciesId: CreatureSpeciesId, variant: string): string {
  return `creature-placeholder|${speciesId}|${variant}`;
}

function buildPlaceholderNodes(
  speciesId: CreatureSpeciesId,
  variant: string,
): { nodes: Node[]; bounds: Box } {
  const def = getSpeciesDef(speciesId);
  const rng = makeRng(placeholderCreatureBakeKey(speciesId, variant));
  const base = def.accentColor;
  // A stable per-variant tint so a species' own coat list reads as visually
  // distinct even before real per-variant art exists.
  const tintAmt = rng();
  const skin = tintAmt < 0.5 ? darken(base, tintAmt * 0.3) : lighten(base, (tintAmt - 0.5) * 0.4);
  const outline = darken(skin, 0.5);

  const headCx = -BODY_RX * 0.62;
  const bodyD = blobPath(0, 0, BODY_RX, BODY_RY, 0.05, rng);
  const headD = blobPath(headCx, -1, HEAD_R, HEAD_R * 0.9, 0.08, rng);

  const nodes: Node[] = [
    {
      kind: "path",
      d: bodyD,
      paint: {
        type: "linear",
        from: { x: 0, y: -BODY_RY },
        to: { x: 0, y: BODY_RY },
        stops: [
          { offset: 0, color: lighten(skin, 0.18) },
          { offset: 0.55, color: skin },
          { offset: 1, color: darken(skin, 0.22) },
        ],
      },
    },
    { kind: "path", d: headD, paint: { type: "solid", color: skin } },
    {
      kind: "group",
      children: [
        {
          kind: "path",
          d: bodyD,
          paint: { type: "solid", color: outline, opacity: 0.4 },
          stroke: { width: 1.1 },
          blend: "multiply",
          blur: 0.7,
        },
        {
          kind: "path",
          d: headD,
          paint: { type: "solid", color: outline, opacity: 0.4 },
          stroke: { width: 1.1 },
          blend: "multiply",
          blur: 0.7,
        },
      ],
      isolate: true,
    },
    {
      kind: "path",
      d: bodyD,
      blend: "screen",
      blur: 5,
      clip: bodyD,
      paint: {
        type: "linear",
        from: { x: 0, y: -BODY_RY * 0.85 },
        to: { x: 0, y: -BODY_RY * 0.1 },
        stops: [
          { offset: 0, color: "rgba(255,255,255,0)" },
          { offset: 0.5, color: "rgba(255,255,255,0.22)" },
          { offset: 1, color: "rgba(255,255,255,0)" },
        ],
      },
    },
    {
      kind: "circle",
      cx: headCx - 3,
      cy: -2.5,
      r: 2.6,
      paint: { type: "solid", color: "#12161f", opacity: 0.85 },
    },
    {
      kind: "circle",
      cx: headCx - 3.7,
      cy: -3.3,
      r: 0.9,
      paint: { type: "solid", color: "#f9fcff", opacity: 0.9 },
    },
  ];

  const bodyBox: Box = { x: -BODY_RX, y: -BODY_RY, width: BODY_RX * 2, height: BODY_RY * 2 };
  const headBox: Box = {
    x: headCx - HEAD_R,
    y: -1 - HEAD_R * 0.9,
    width: HEAD_R * 2,
    height: HEAD_R * 1.8,
  };
  const bounds = inflateBox(unionBox(bodyBox, headBox), BOUNDS_PAD);

  return { nodes, bounds };
}

export function bakePlaceholderCreature(
  Skia: SkiaApi,
  speciesId: CreatureSpeciesId,
  variant: string,
  dpr: number,
): BakedArt | null {
  const { nodes, bounds } = buildPlaceholderNodes(speciesId, variant);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
