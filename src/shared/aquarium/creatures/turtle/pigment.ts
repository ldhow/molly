// Turtle palette + scute (shell plate) pattern per variant. Each scute is
// its own small `blobPath` plate — unlike a whole-body silhouette (see
// `frog/anatomy.ts`'s header), a small decorative plate is exactly what
// `blobPath` was built for, so this is the ordinary case, not the exception.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { blobPath } from "@/shared/aquarium/core/pigment-toolkit";
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

export interface TurtlePalette {
  shellBase: string;
  scuteColor: string;
  skinColor: string;
  glintColor: string | null;
}

const PALETTE_BY_VARIANT: Record<string, TurtlePalette> = {
  river: { shellBase: "#5c7a4a", scuteColor: "#3f5934", skinColor: "#6f8a56", glintColor: null },
  painted: { shellBase: "#4a5c3a", scuteColor: "#c9722e", skinColor: "#5c7048", glintColor: null },
  star: {
    shellBase: "#2e2e38",
    scuteColor: "#e8c94a",
    skinColor: "#40404c",
    glintColor: "#fff3c4",
  },
  celestial: {
    shellBase: "#2a2f5c",
    scuteColor: "#6a5fd6",
    skinColor: "#38407a",
    glintColor: "#c9c2ff",
  },
};

export function turtlePaletteFor(variant: string): TurtlePalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.river;
}

export function turtleSkinPaint(palette: TurtlePalette) {
  return {
    top: lighten(palette.shellBase, 0.12),
    mid: palette.shellBase,
    bottom: darken(palette.shellBase, 0.26),
    outline: darken(palette.shellBase, 0.55),
  };
}

/** Five plates: one large center, two flanking front, two flanking rear — a simplified scute layout that reads as "shell plates" without a full honeycomb grid. */
const SCUTE_LAYOUT: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 0, cy: 0, rx: 8, ry: 7 },
  { cx: -10, cy: -7, rx: 6, ry: 5 },
  { cx: -10, cy: 7, rx: 6, ry: 5 },
  { cx: 10, cy: -7, rx: 6, ry: 5 },
  { cx: 10, cy: 7, rx: 6, ry: 5 },
];

export function turtleScutePrimitives(
  palette: TurtlePalette,
  seed: number,
  shellD: string,
): Node[] {
  const rng = makeRng(`turtle-scutes-${seed}`);
  const out: Node[] = [];
  for (const plate of SCUTE_LAYOUT) {
    const d = blobPath(plate.cx, plate.cy, plate.rx, plate.ry, 0.08, rng);
    out.push({
      kind: "path",
      d,
      paint: { type: "solid", color: palette.scuteColor, opacity: 0.85 },
      clip: shellD,
    });
    out.push({
      kind: "path",
      d,
      paint: { type: "solid", color: darken(palette.scuteColor, 0.35), opacity: 0.4 },
      stroke: { width: 1 },
      blend: "multiply",
      blur: 0.5,
      clip: shellD,
    });
  }
  if (palette.glintColor) {
    const glintAt = (p: XY, r: number) =>
      out.push({
        kind: "circle",
        cx: p.x - r * 0.3,
        cy: p.y - r * 0.3,
        r: r * 0.28,
        paint: { type: "solid", color: palette.glintColor!, opacity: 0.75 },
        blend: "plusLighter",
        blur: 0.4,
        clip: shellD,
      });
    for (const plate of SCUTE_LAYOUT) glintAt({ x: plate.cx, y: plate.cy }, plate.rx);
  }
  return out;
}
