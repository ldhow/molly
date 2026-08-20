// Snail palette + shell/foot pigment. Everything on the shell is traced along
// the SAME spiral centerline `anatomy.ts` builds the outline from (the plan's
// "radial banded coloring... applied around the spiral, not along an
// x-sweep"), so a band always reads as wrapping the coil and a growth
// striation always reads as crossing it — neither can drift out of register
// with the shape, because there is only one shape function.
//
// Now that the shell is drawn SIDE-ON (see `anatomy.ts`'s header), the coil
// carries most of the creature's colour identity, so it gets three separate
// passes — whorl bands, fine growth striations, and the whorl seam — rather
// than the single band pass the old face-on bullseye used.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { ribbonAlongPath, scatterBlobPrimitives } from "@/shared/aquarium/core/pigment-toolkit";
import { darken, lighten, rgba } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { OUTER_TURN_U, shellAt, shellHalfWidthAt, soleAt } from "./anatomy";

export interface SnailPalette {
  /** Shell body colour. */
  base: string;
  /** Alternating whorl band. */
  bandColor: string;
  /** The soft body: foot, neck, head, tentacles. */
  footColor: string;
  /** Pale margin along the sole — every real snail has one, and it is what stops the foot reading as a flat silhouette. */
  fringeColor: string;
  /** Mottling on the foot/head. */
  speckleColor: string;
  /** Small scattered glints on the shell — only the rarer variants get any. */
  glintColor: string | null;
}

const PALETTE_BY_VARIANT: Record<string, SnailPalette> = {
  garden: {
    base: "#b08a55",
    bandColor: "#6f4c2a",
    footColor: "#98a578",
    fringeColor: "#d3dcb8",
    speckleColor: "#6d7a52",
    glintColor: null,
  },
  mystery: {
    base: "#6d79b6",
    bandColor: "#2f3868",
    footColor: "#5b6076",
    fringeColor: "#a7adc6",
    speckleColor: "#3c404f",
    glintColor: null,
  },
  golden: {
    base: "#e3b64f",
    bandColor: "#a3711f",
    footColor: "#d6bf82",
    fringeColor: "#f7e9bb",
    speckleColor: "#b39a5c",
    glintColor: "#fff3c4",
  },
  opal: {
    base: "#e6d1ec",
    bandColor: "#9a75b4",
    footColor: "#d5bee2",
    fringeColor: "#ffffff",
    speckleColor: "#b294c6",
    glintColor: "#ffffff",
  },
};

export function snailPaletteFor(variant: string): SnailPalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.garden;
}

/**
 * Bands run ALONG the coil (a stripe at a fixed depth across the tube), not
 * across it. A band drawn across the tube lands at the same polar angle on
 * every turn, so the coil reads as a pie chart; a band drawn along the tube
 * spirals inward with the whorls, which is what a real banded snail
 * (Cepaea, nerite, mystery) actually shows.
 */
const BANDS: readonly [number, number][] = [
  [-0.82, -0.42],
  [0.06, 0.44],
];
const STRIATION_COUNT = 30;

/** A slab ACROSS the tube between two `u` values — growth ribs. */
function tubeSlab(uStart: number, uEnd: number, samples: number, widthScale = 1): string {
  return ribbonAlongPath({
    uStart: Math.max(0, uStart),
    uEnd: Math.min(1, uEnd),
    at: shellAt,
    halfWidth: (u) => shellHalfWidthAt(u) * widthScale,
    samples,
  });
}

/**
 * A stripe ALONG the tube, between two normal offsets given as fractions of
 * the local half-width (so it stays proportional as the whorl widens).
 * Emitted one TURN at a time by the caller — a stripe traced across the
 * whole coil at once would self-overlap, and Skia's winding fill would
 * cancel the overlaps into holes (the same trap `anatomy.ts`'s
 * `buildShellD` documents).
 */
function tubeStripe(uStart: number, uEnd: number, offLo: number, offHi: number): string {
  const F = (n: number) => n.toFixed(1);
  const samples = 40;
  const edge = (off: number, reverse: boolean): XY[] => {
    const pts: XY[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = reverse ? 1 - i / samples : i / samples;
      const u = uStart + (uEnd - uStart) * t;
      const { point, normal } = shellAt(u);
      const d = shellHalfWidthAt(u) * off;
      pts.push({ x: point.x + normal.x * d, y: point.y + normal.y * d });
    }
    return pts;
  };
  const pts = [...edge(offHi, false), ...edge(offLo, true)];
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${F(p.x)} ${F(p.y)}`).join(" ") + " Z";
}

/** The coil's inner edge — the line where each whorl meets the one it grew out of. Stroked dark, this is the single mark that makes a flat spiral read as a stack of overlapping tubes. */
function whorlSeamD(): string {
  const pts: XY[] = [];
  for (let i = 0; i <= 96; i++) {
    const u = i / 96;
    const { point, normal } = shellAt(u);
    const hw = shellHalfWidthAt(u);
    pts.push({ x: point.x - normal.x * hw, y: point.y - normal.y * hw });
  }
  const F = (n: number) => n.toFixed(1);
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${F(p.x)} ${F(p.y)}`).join(" ");
}

/** Alternating whorl bands, fine growth striations, the whorl seam, and a handful of glints for the rarer coats. */
export function snailShellPatternPrimitives(
  palette: SnailPalette,
  seed: number,
  shellD: string,
  wraps: number,
): Node[] {
  const rng = makeRng(`snail-shell-${seed}`);
  const out: Node[] = [];

  // One stripe pass per turn, innermost turn FIRST so each whorl paints over
  // the one it grew out of — the same near-covers-far ordering the silhouette
  // itself relies on.
  const turns = Math.ceil(wraps);
  for (let t = turns - 1; t >= 0; t--) {
    const uStart = Math.max(0, 1 - (t + 1) / wraps);
    const uEnd = 1 - t / wraps;
    if (uEnd - uStart < 0.02) continue;
    // The apex whorls are ~1px wide; a full-strength band there just muddies
    // the coil's centre into a dark blot, so strength follows the turn.
    const strength = 0.62 * (t === 0 ? 1 : t === 1 ? 0.7 : 0.4);
    for (const [lo, hi] of BANDS) {
      out.push({
        kind: "path",
        d: tubeStripe(uStart, uEnd, lo, hi),
        paint: { type: "solid", color: palette.bandColor, opacity: strength },
        clip: shellD,
      });
    }
  }

  // Growth striations: hairline ribs crossing the tube, denser toward the
  // rim (a shell records its growth, so the newest whorl carries the most).
  const striation = darken(palette.bandColor, 0.25);
  for (let i = 1; i <= STRIATION_COUNT; i++) {
    // Outer turn only: that is the whole visible surface, and a rib drawn on
    // an inner turn would float on top of the whorl that covers it.
    const u = OUTER_TURN_U + (1 - OUTER_TURN_U) * (i / (STRIATION_COUNT + 1));
    out.push({
      kind: "path",
      d: tubeSlab(u - 0.0035, u + 0.0035, 4, 1.02),
      paint: { type: "solid", color: striation, opacity: 0.16 },
      blur: 0.35,
      clip: shellD,
    });
  }

  const seamD = whorlSeamD();
  out.push({
    kind: "path",
    d: seamD,
    paint: { type: "solid", color: darken(palette.bandColor, 0.5), opacity: 0.45 },
    stroke: { width: 1.6 },
    blur: 0.9,
    clip: shellD,
  });
  out.push({
    kind: "path",
    d: seamD,
    paint: { type: "solid", color: darken(palette.bandColor, 0.6), opacity: 0.5 },
    stroke: { width: 0.6 },
    clip: shellD,
  });

  if (palette.glintColor) {
    out.push(
      ...scatterBlobPrimitives({
        rng,
        count: 7,
        place: (r) => {
          const u = 0.35 + r() * 0.65;
          const { point, normal } = shellAt(u);
          const off = (r() - 0.5) * shellHalfWidthAt(u) * 1.2;
          return { x: point.x + normal.x * off, y: point.y + normal.y * off };
        },
        radius: (r) => 0.8 + r() * 1.0,
        wobble: 0.3,
        paint: () => ({ type: "solid", color: palette.glintColor!, opacity: 0.65 }),
        blur: 0.4,
        clip: shellD,
      }),
    );
  }

  return out;
}

/** Mottling + the pale foot fringe that runs the length of the sole. */
export function snailFootPatternPrimitives(
  palette: SnailPalette,
  seed: number,
  footD: string,
  soleFrontX: number,
  soleBackX: number,
): Node[] {
  const rng = makeRng(`snail-foot-${seed}`);
  const out: Node[] = [];

  // Fringe: a soft pale band riding the sole's own ripple wave, so the
  // highlight and the outline can never disagree about where the sole is.
  const F = (n: number) => n.toFixed(1);
  const steps = 40;
  let fringe = "";
  for (let i = 0; i <= steps; i++) {
    const x = soleBackX + ((soleFrontX - soleBackX) * i) / steps;
    fringe += `${i === 0 ? "M" : "L"} ${F(x)} ${F(soleAt(x) - 0.8)} `;
  }
  out.push({
    kind: "path",
    d: fringe,
    paint: { type: "solid", color: palette.fringeColor, opacity: 0.75 },
    stroke: { width: 2.2 },
    blur: 0.9,
    clip: footD,
  });

  out.push(
    ...scatterBlobPrimitives({
      rng,
      count: 22,
      place: (r) => ({
        x: soleBackX + r() * (soleFrontX - soleBackX + 4),
        y: -3 - r() * 11,
      }),
      radius: (r) => 0.9 + r() * 1.9,
      wobble: 0.5,
      paint: () => ({ type: "solid", color: palette.speckleColor, opacity: 0.2 + rng() * 0.18 }),
      blur: 0.9,
      clip: footD,
    }),
  );

  return out;
}

/** Body-skin gradient + a faint contour, the same shape every creature's shell/body fill follows. */
export function snailSkinPaint(palette: SnailPalette) {
  return {
    top: lighten(palette.base, 0.18),
    mid: palette.base,
    bottom: darken(palette.base, 0.3),
    outline: rgba(darken(palette.base, 0.58), 0.45),
  };
}

/** The soft body's own gradient — pale at the sole, deeper up the flank, which is how a real foot catches light. */
export function snailFootPaint(palette: SnailPalette) {
  return {
    top: darken(palette.footColor, 0.22),
    mid: palette.footColor,
    bottom: lighten(palette.footColor, 0.16),
    outline: rgba(darken(palette.footColor, 0.55), 0.5),
  };
}
