// Snail palette + whorl-banded shell pattern. Bands are traced with
// `ribbonAlongPath` along the SAME spiral centerline `anatomy.ts` builds the
// shell outline from — the plan's "radial banded coloring... applied around
// the spiral, not along an x-sweep" — so a band always reads as wrapping the
// coil, not as a straight stripe crossing it.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node } from "@/shared/aquarium/core/ir";
import { ribbonAlongPath, scatterBlobPrimitives } from "@/shared/aquarium/core/pigment-toolkit";
import { darken, lighten, rgba } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { shellAt, shellHalfWidthAt } from "./anatomy";

export interface SnailPalette {
  base: string;
  bandColor: string;
  footColor: string;
  /** Small scattered glints on the shell — only the rarer variants get any. */
  glintColor: string | null;
}

const PALETTE_BY_VARIANT: Record<string, SnailPalette> = {
  garden: { base: "#a9895f", bandColor: "#6b4d2e", footColor: "#8a9b6e", glintColor: null },
  mystery: { base: "#5f6fae", bandColor: "#2f3868", footColor: "#4a5a8f", glintColor: null },
  golden: { base: "#e0b24a", bandColor: "#a3711f", footColor: "#c99a3d", glintColor: "#fff3c4" },
  opal: { base: "#e3c9e8", bandColor: "#8f6aa8", footColor: "#c9a8d6", glintColor: "#ffffff" },
};

export function snailPaletteFor(variant: string): SnailPalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.garden;
}

const BAND_COUNT = 5;

/** Alternating whorl bands + thin seam lines tracing the shell's own spiral centerline, plus a handful of glints for the rarer coats. */
export function snailShellPatternPrimitives(
  palette: SnailPalette,
  seed: number,
  shellD: string,
): Node[] {
  const rng = makeRng(`snail-shell-${seed}`);
  const out: Node[] = [];

  for (let i = 0; i < BAND_COUNT; i++) {
    if (i % 2 === 0) continue; // even bands show the base skin fill underneath
    const uStart = i / BAND_COUNT;
    const uEnd = (i + 1) / BAND_COUNT;
    const bandD = ribbonAlongPath({
      uStart,
      uEnd,
      at: shellAt,
      halfWidth: shellHalfWidthAt,
      samples: 14,
    });
    out.push({
      kind: "path",
      d: bandD,
      paint: { type: "solid", color: palette.bandColor, opacity: 0.82 },
      clip: shellD,
    });
  }

  // Whorl seams: a thin darker line at every band boundary, the same trick
  // `fish/pigment.ts`'s `bands` case uses (soft-under, sharp-over double
  // pass) to read as a real groove rather than a flat color edge.
  const seamColor = darken(palette.bandColor, 0.35);
  for (let i = 1; i < BAND_COUNT; i++) {
    const u = i / BAND_COUNT;
    const seamD = ribbonAlongPath({
      uStart: u - 0.01,
      uEnd: u + 0.01,
      at: shellAt,
      halfWidth: shellHalfWidthAt,
      samples: 6,
    });
    out.push({
      kind: "path",
      d: seamD,
      paint: { type: "solid", color: seamColor, opacity: 0.4 },
      blur: 0.6,
      clip: shellD,
    });
  }

  if (palette.glintColor) {
    out.push(
      ...scatterBlobPrimitives({
        rng,
        count: 6,
        place: (r) => {
          const u = r();
          const { point, normal } = shellAt(u);
          const off = (r() - 0.5) * shellHalfWidthAt(u) * 1.2;
          return { x: point.x + normal.x * off, y: point.y + normal.y * off };
        },
        radius: (r) => 0.9 + r() * 1.1,
        wobble: 0.3,
        paint: () => ({ type: "solid", color: palette.glintColor!, opacity: 0.7 }),
        blur: 0.4,
        clip: shellD,
      }),
    );
  }

  return out;
}

/** Body-skin gradient + a faint contour, the same shape every creature's shell/body fill follows. */
export function snailSkinPaint(palette: SnailPalette) {
  return {
    top: lighten(palette.base, 0.14),
    mid: palette.base,
    bottom: darken(palette.base, 0.28),
    outline: rgba(darken(palette.base, 0.55), 0.4),
  };
}
