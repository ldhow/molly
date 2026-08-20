// Composes `anatomy.ts` (shell + foot + tentacle geometry) and `pigment.ts`
// (palette, whorl banding, foot mottling) into a drawable snail — the
// snail's own version of `fish/bake-fish.ts`'s role.
//
// Unlike every other creature this bakes in TWO PIECES, because a snail's
// one unmistakable character beat is its eye stalks waving, and a snail's
// locomotion (`sim/crawl.ts`) is a slow glide with no body-bend to carry any
// motion of its own — a single rigid texture sliding along a wall reads as a
// sticker, not an animal. So `render/creature-layer.tsx` draws
// `part: "tentacles"` under `part: "body"` with an independent sway rotation
// about `TENTACLE_PIVOT`, which sits inside the head dome so the roots stay
// buried under the body fill at every sway angle (the same "buried root"
// rule `fish/bake-fish.ts` uses for fin roots).
//
// `part: "full"` is the whole snail in one texture, tentacles at rest — what
// every STATIC surface uses (Creaturedex/holding-tank previews, the dead
// snail), since those have no animation to justify a second draw call.

import { bakeNodes, type BakedArt } from "@/shared/aquarium/core/bake";
import { inflateBox, type Box, type Node } from "@/shared/aquarium/core/ir";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";
import { darken, rgba } from "@/shared/lib/color";

import { buildSnailAnatomy, type SnailAnatomy } from "./anatomy";
import {
  snailFootPaint,
  snailFootPatternPrimitives,
  snailPaletteFor,
  snailShellPatternPrimitives,
  snailSkinPaint,
  type SnailPalette,
} from "./pigment";

/** Which piece of the snail to bake — see this module's header. */
export type SnailPart = "full" | "body" | "tentacles";

const BOUNDS_PAD = 4;

export function snailBakeKey(variant: string, part: SnailPart = "full"): string {
  return `snail|${variant}|${part}`;
}

/** Eye stalks + lower feelers. Drawn UNDER the body, so their roots can start inside the head dome. */
function tentacleNodes(anatomy: SnailAnatomy, palette: SnailPalette): Node[] {
  const shaft = darken(palette.footColor, 0.12);
  const nodes: Node[] = [];

  // Far pair first (index 0), near pair second — the far one is drawn darker
  // so an overlapping pair still reads as two stalks, not one wide one.
  for (const [i, t] of anatomy.feelers.entries()) {
    nodes.push({
      kind: "path",
      d: t.d,
      paint: { type: "solid", color: i === 0 ? darken(shaft, 0.3) : shaft },
    });
  }
  for (const [i, t] of anatomy.eyeStalks.entries()) {
    const far = i === 0;
    nodes.push({
      kind: "path",
      d: t.d,
      paint: { type: "solid", color: far ? darken(shaft, 0.3) : shaft },
    });
    nodes.push({
      kind: "circle",
      cx: t.tip.x,
      cy: t.tip.y,
      r: t.tipR,
      paint: { type: "solid", color: far ? "#0d1017" : "#171c26" },
    });
    // Specular pinprick — an eye without one reads as a hole.
    nodes.push({
      kind: "circle",
      cx: t.tip.x - t.tipR * 0.3,
      cy: t.tip.y - t.tipR * 0.35,
      r: t.tipR * 0.32,
      paint: { type: "solid", color: rgba("#ffffff", far ? 0.4 : 0.7) },
    });
  }
  return nodes;
}

/** Foot + shell, everything except the tentacles. */
function bodyNodes(anatomy: SnailAnatomy, palette: SnailPalette, seed: number): Node[] {
  const skin = snailSkinPaint(palette);
  const foot = snailFootPaint(palette);
  const nodes: Node[] = [];

  // --- Soft body ---------------------------------------------------------
  // Gradient runs UP the flank (pale at the sole, deeper toward the back),
  // which is the light direction the rest of the tank is lit from.
  nodes.push({
    kind: "group",
    isolate: true,
    children: [
      {
        kind: "path",
        d: anatomy.footD,
        paint: {
          type: "linear",
          from: { x: 0, y: -19 },
          to: { x: 0, y: 0 },
          stops: [
            { offset: 0, color: foot.top },
            { offset: 0.55, color: foot.mid },
            { offset: 1, color: foot.bottom },
          ],
        },
      },
      ...snailFootPatternPrimitives(
        palette,
        seed,
        anatomy.footD,
        anatomy.soleFrontX,
        anatomy.soleBackX,
      ),
      // Mantle shadow: the foot darkens where the shell overhangs it. Without
      // this the shell reads as pasted on top rather than carried.
      {
        kind: "path",
        d: anatomy.footD,
        paint: {
          type: "radial",
          center: { x: 2, y: -16 },
          radius: 20,
          scale: { x: 1.5, y: 0.7 },
          stops: [
            { offset: 0, color: rgba(darken(palette.footColor, 0.65), 0.55) },
            { offset: 1, color: rgba(darken(palette.footColor, 0.65), 0) },
          ],
        },
        blend: "multiply",
        clip: anatomy.footD,
      },
    ],
  });
  nodes.push({
    kind: "path",
    d: anatomy.mouthD,
    paint: { type: "solid", color: rgba(darken(palette.footColor, 0.6), 0.55) },
    stroke: { width: 0.9 },
  });
  nodes.push({
    kind: "path",
    d: anatomy.footD,
    paint: { type: "solid", color: foot.outline },
    stroke: { width: 1 },
    blend: "multiply",
    blur: 0.5,
  });

  // --- Shell -------------------------------------------------------------
  nodes.push({
    kind: "group",
    isolate: true,
    children: [
      {
        kind: "path",
        d: anatomy.shellD,
        paint: {
          type: "linear",
          from: { x: -6, y: -30 },
          to: { x: 14, y: -4 },
          stops: [
            { offset: 0, color: skin.top },
            { offset: 0.5, color: skin.mid },
            { offset: 1, color: skin.bottom },
          ],
        },
      },
      ...snailShellPatternPrimitives(palette, seed, anatomy.shellD, anatomy.wraps),
    ],
  });

  // Aperture: a soft dark pocket just inside the rim, NOT a hard oval — the
  // mouth of a side-on shell is mostly self-shadow.
  nodes.push({
    kind: "path",
    d: anatomy.apertureD,
    paint: {
      type: "radial",
      center: { x: 12, y: -14 },
      radius: 7,
      stops: [
        { offset: 0, color: rgba(darken(palette.bandColor, 0.7), 0.85) },
        { offset: 1, color: rgba(darken(palette.bandColor, 0.7), 0.2) },
      ],
    },
    blur: 1.2,
    clip: anatomy.shellD,
  });

  // Gloss on the upper-left of the outer whorl, then the contour, then a
  // thin rim light — the same three-pass finish the fish bake uses.
  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    blend: "screen",
    blur: 3,
    clip: anatomy.shellD,
    paint: {
      type: "radial",
      center: { x: -3, y: -24 },
      radius: 15,
      stops: [
        { offset: 0, color: "rgba(255,255,255,0.34)" },
        { offset: 0.6, color: "rgba(255,255,255,0.1)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    },
  });
  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    paint: { type: "solid", color: skin.outline },
    stroke: { width: 1.1 },
    blend: "multiply",
    blur: 0.7,
  });
  nodes.push({
    kind: "path",
    d: anatomy.shellD,
    stroke: { width: 1.2 },
    blend: "plusLighter",
    blur: 0.6,
    clip: anatomy.shellD,
    paint: { type: "solid", color: rgba("#ffffff", 0.16) },
  });

  return nodes;
}

export function buildSnailAquariumSpec(
  variant: string,
  part: SnailPart = "full",
): { nodes: Node[]; bounds: Box } {
  const anatomy = buildSnailAnatomy();
  const palette = snailPaletteFor(variant);
  const seed = hashVariant(variant);

  if (part === "tentacles") {
    return {
      nodes: tentacleNodes(anatomy, palette),
      bounds: inflateBox(anatomy.tentacleBounds, BOUNDS_PAD),
    };
  }
  if (part === "body") {
    return {
      nodes: bodyNodes(anatomy, palette, seed),
      bounds: inflateBox(anatomy.bodyBounds, BOUNDS_PAD),
    };
  }
  return {
    nodes: [...tentacleNodes(anatomy, palette), ...bodyNodes(anatomy, palette, seed)],
    bounds: inflateBox(anatomy.bounds, BOUNDS_PAD),
  };
}

function hashVariant(variant: string): number {
  let h = 0;
  for (let i = 0; i < variant.length; i++) h = (h * 31 + variant.charCodeAt(i)) >>> 0;
  return h % 1000;
}

export function bakeSnail(
  Skia: SkiaApi,
  variant: string,
  dpr: number,
  part: SnailPart = "full",
): BakedArt | null {
  const { nodes, bounds } = buildSnailAquariumSpec(variant, part);
  return bakeNodes(Skia, nodes, bounds, dpr);
}
