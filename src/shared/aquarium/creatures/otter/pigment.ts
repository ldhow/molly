// Otter palette per variant. Fur is read through the existing gradient +
// multiply-shadow + screen-gloss layering `bake-creature.ts` already applies
// to every creature's skin fill — a palette/contrast difference from a
// fish's scales, not a new primitive (per the plan's explicit direction).
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import { darken, lighten } from "@/shared/lib/color";

export interface OtterPalette {
  base: string;
  bellyColor: string;
  noseColor: string;
}

const PALETTE_BY_VARIANT: Record<string, OtterPalette> = {
  river: { base: "#6b5236", bellyColor: "#c9ad82", noseColor: "#2a2320" },
  sea: { base: "#4a4a52", bellyColor: "#a8a8b0", noseColor: "#1c1c22" },
  silver: { base: "#8a8a92", bellyColor: "#e2e2e6", noseColor: "#2a2a30" },
  arctic: { base: "#e8e4de", bellyColor: "#ffffff", noseColor: "#3a3430" },
};

export function otterPaletteFor(variant: string): OtterPalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.river;
}

export function otterSkinPaint(palette: OtterPalette) {
  return {
    top: lighten(palette.base, 0.12),
    mid: palette.base,
    bottom: darken(palette.base, 0.22),
    outline: darken(palette.base, 0.55),
  };
}
