// Frog palette + skin texture per variant. Leaf/toad are naturalistic;
// poison (dart-frog) and crystal (the legendary "chase" coat) get a bolder,
// more decorative treatment — same rarity-scales-with-flamboyance rule the
// molly color system already follows.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node } from "@/shared/aquarium/core/ir";
import { scatterBlobPrimitives } from "@/shared/aquarium/core/pigment-toolkit";
import { darken, lighten } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

export interface FrogPalette {
  base: string;
  bellyColor: string;
  spotColor: string | null;
  spotCount: number;
}

const PALETTE_BY_VARIANT: Record<string, FrogPalette> = {
  leaf: { base: "#5fa35a", bellyColor: "#d9e6b8", spotColor: "#3f7a44", spotCount: 3 },
  toad: { base: "#8a7048", bellyColor: "#d6c49a", spotColor: "#5c4a2c", spotCount: 6 },
  poison: { base: "#2b6ee0", bellyColor: "#0e2a63", spotColor: "#12161f", spotCount: 7 },
  crystal: { base: "#a8e6e0", bellyColor: "#eafffb", spotColor: "#ffffff", spotCount: 4 },
};

export function frogPaletteFor(variant: string): FrogPalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.leaf;
}

export function frogSkinPaint(palette: FrogPalette) {
  return {
    top: lighten(palette.base, 0.1),
    mid: palette.base,
    bottom: darken(palette.base, 0.18),
    outline: darken(palette.base, 0.5),
  };
}

/** Scattered back spots — every variant but "leaf" gets some, the plain naturalistic one stays unmarked. */
export function frogSpotPrimitives(palette: FrogPalette, seed: number, bodyD: string): Node[] {
  if (!palette.spotColor) return [];
  const rng = makeRng(`frog-spots-${seed}`);
  return scatterBlobPrimitives({
    rng,
    count: palette.spotCount,
    place: (r) => ({ x: (r() - 0.5) * 34, y: -8 + (r() - 0.5) * 22 }),
    radius: (r) => 2.2 + r() * 2.4,
    wobble: 0.35,
    paint: () => ({ type: "solid", color: palette.spotColor!, opacity: 0.85 }),
    blur: 0.5,
    clip: bodyD,
  });
}
