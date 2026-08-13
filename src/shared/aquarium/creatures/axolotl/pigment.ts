// Axolotl palette per variant — body skin tone plus a separate, usually
// contrasting, gill color (real axolotls read gill color as their most
// distinctive feature regardless of body morph), and light speckling for
// the more naturalistic coats.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node } from "@/shared/aquarium/core/ir";
import { scatterBlobPrimitives } from "@/shared/aquarium/core/pigment-toolkit";
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

export interface AxolotlPalette {
  base: string;
  gillColor: string;
  speckleColor: string | null;
  speckleCount: number;
}

const PALETTE_BY_VARIANT: Record<string, AxolotlPalette> = {
  leucistic: {
    base: "#f4d9e2",
    gillColor: "#e8607f",
    speckleColor: null,
    speckleCount: 0,
  },
  wildtype: {
    base: "#6e7a52",
    gillColor: "#7a4a52",
    speckleColor: "#3f4530",
    speckleCount: 8,
  },
  golden: {
    base: "#f0c65a",
    gillColor: "#e88a7a",
    speckleColor: "#c99a2e",
    speckleCount: 4,
  },
  melanoid: {
    base: "#2a2a30",
    gillColor: "#7a2430",
    speckleColor: null,
    speckleCount: 0,
  },
};

export function axolotlPaletteFor(variant: string): AxolotlPalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.leucistic;
}

export function axolotlSkinPaint(palette: AxolotlPalette) {
  return {
    top: lighten(palette.base, 0.12),
    mid: palette.base,
    bottom: darken(palette.base, 0.2),
    outline: darken(palette.base, 0.5),
  };
}

export function axolotlSpecklePrimitives(
  palette: AxolotlPalette,
  seed: number,
  bodyD: string,
  x0: number,
  length: number,
): Node[] {
  if (!palette.speckleColor) return [];
  const rng = makeRng(`axolotl-speckle-${seed}`);
  return scatterBlobPrimitives({
    rng,
    count: palette.speckleCount,
    place: (r) => ({ x: x0 + length * (0.15 + r() * 0.7), y: (r() - 0.5) * 14 }),
    radius: (r) => 0.9 + r() * 1.3,
    wobble: 0.35,
    paint: () => ({ type: "solid", color: palette.speckleColor!, opacity: 0.7 }),
    blur: 0.4,
    clip: bodyD,
  });
}
