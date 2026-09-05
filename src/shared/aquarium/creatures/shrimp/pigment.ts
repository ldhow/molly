// Shrimp palette + shell texture per variant. Two of the four lean directly
// on real aquarium-shrimp varieties for their colour identity: "ghost"
// (translucent, lightly speckled — an Amano/glass shrimp) and "crystal"
// (bold red-on-white banding — a Crystal Red Shrimp, which is why it's the
// legendary tier: that coat really is the prized/expensive one). "cherry"
// and "tiger" fill the uncommon/rare slots with the other two well-known
// aquarium-shrimp looks (solid cherry red; dark banded blue).
//
// Everything here is traced along the SAME spine `anatomy.ts` builds the
// outline from (`spineAt`/`bodyHalfHeightAt`), exactly as `snail/pigment.ts`
// traces the same spiral its outline comes from. That is what stops a band
// or a segment line drifting out of register with a curved body — the first
// build drew plain vertical bars, which floated visibly wrong across the
// arch.
//
// Dependency-free: no React/RN/Skia imports. Runs under plain Node.

import type { Node, XY } from "@/shared/aquarium/core/ir";
import { ribbonAlongPath, scatterBlobPrimitives } from "@/shared/aquarium/core/pigment-toolkit";
import { coolShadow, warmLight } from "@/shared/aquarium/core/shading";
import { rgba } from "@/shared/lib/color";
import { makeRng } from "@/shared/lib/rng";

import { ABDOMEN_START, bodyHalfHeightAt, spineAt } from "./anatomy";

export interface ShrimpPalette {
  base: string;
  /** Segment band colour, or null for a plain coat ("ghost" carries speckle instead). */
  bandColor: string | null;
  bandCount: number;
  /** Brown/olive mottling — only the translucent "ghost" coat gets any. */
  speckleColor: string | null;
  /** Overall shell fill opacity — the translucent varieties are meaningfully see-through, not just a paler solid colour. */
  fillOpacity: number;
}

const PALETTE_BY_VARIANT: Record<string, ShrimpPalette> = {
  ghost: {
    base: "#cdd6bd",
    bandColor: null,
    bandCount: 0,
    speckleColor: "#786a48",
    fillOpacity: 0.5,
  },
  cherry: {
    base: "#cf4a3d",
    bandColor: "#8f2c25",
    bandCount: 3,
    speckleColor: null,
    fillOpacity: 0.9,
  },
  tiger: {
    base: "#4d7db0",
    bandColor: "#161c26",
    bandCount: 5,
    speckleColor: null,
    fillOpacity: 0.92,
  },
  crystal: {
    base: "#f5eee1",
    bandColor: "#c2372f",
    bandCount: 4,
    speckleColor: null,
    fillOpacity: 0.95,
  },
};

export function shrimpPaletteFor(variant: string): ShrimpPalette {
  return PALETTE_BY_VARIANT[variant] ?? PALETTE_BY_VARIANT.ghost;
}

/** Hue-aware tones — see `core/shading.ts` and the note on `otterSkinPaint`. */
export function shrimpSkinPaint(palette: ShrimpPalette) {
  return {
    top: warmLight(palette.base, 0.16),
    mid: palette.base,
    bottom: coolShadow(palette.base, 0.22),
    outline: coolShadow(palette.base, 0.55),
  };
}

const F = (n: number) => n.toFixed(1);

/** The cross-body line at `u` — from the back edge to the belly edge, along the spine's own normal. */
function crossLineD(u: number, widthScale = 1.05): string {
  const s = spineAt(u);
  const hw = bodyHalfHeightAt(u) * widthScale;
  return (
    `M ${F(s.point.x + s.normal.x * hw)} ${F(s.point.y + s.normal.y * hw)} ` +
    `L ${F(s.point.x - s.normal.x * hw)} ${F(s.point.y - s.normal.y * hw)}`
  );
}

/** A slab ACROSS the body between two `u` values, following the spine. */
function slabD(uStart: number, uEnd: number, widthScale = 1.02): string {
  return ribbonAlongPath({
    uStart: Math.max(0, uStart),
    uEnd: Math.min(1, uEnd),
    at: spineAt,
    halfWidth: (u) => bodyHalfHeightAt(u) * widthScale,
    samples: 12,
  });
}

/** How many articulated abdominal plates to draw — every variant gets these (unlike the coloured bands), since the segmented exoskeleton is a shrimp trait, not a coat pattern. */
const SEGMENTS = 6;

/**
 * The abdomen's overlapping plates. Each plate is a slab along the spine that
 * slightly OVERFILLS backward, and they are emitted tail-first so each
 * anterior plate draws over the one behind it — which is the direction real
 * abdominal tergites overlap, and what turns a smooth tube into a row of
 * articulated tiles. Each plate's leading edge then gets a dark cross-line.
 *
 * The carapace (everything forward of `ABDOMEN_START`) is deliberately left
 * unplated: on a real shrimp that is one solid shield, and drawing segment
 * lines across it is the single most common way this silhouette goes wrong.
 */
export function shrimpSegmentPrimitives(palette: ShrimpPalette, bodyD: string): Node[] {
  const out: Node[] = [];
  const span = 1 - ABDOMEN_START;
  const edge = coolShadow(palette.base, 0.55);
  const lift = warmLight(palette.base, 0.14);

  for (let i = SEGMENTS - 1; i >= 0; i--) {
    const u0 = ABDOMEN_START + (span * i) / SEGMENTS;
    const u1 = ABDOMEN_START + (span * (i + 1)) / SEGMENTS;
    // Overfill past `u1` so consecutive plates genuinely overlap rather than
    // merely abut — abutting slabs leave hairline seams at some scales.
    out.push({
      kind: "path",
      d: slabD(u0, u1 + span / SEGMENTS / 2.2),
      paint: { type: "solid", color: rgba(lift, 0.4) },
      clip: bodyD,
    });
    out.push({
      kind: "path",
      d: crossLineD(u0),
      paint: { type: "solid", color: edge, opacity: 0.45 },
      stroke: { width: 1.1 },
      blur: 0.35,
      clip: bodyD,
    });
  }

  // The carapace's own trailing edge — the one hard line on the front half,
  // where the shield ends and the abdomen begins.
  out.push({
    kind: "path",
    d: crossLineD(ABDOMEN_START),
    paint: { type: "solid", color: edge, opacity: 0.55 },
    stroke: { width: 1.4 },
    blur: 0.3,
    clip: bodyD,
  });

  return out;
}

/**
 * Coloured segment bands — slabs along the spine, in register with the
 * plates above because both come from the same `spineAt`. Confined to the
 * abdomen for the same reason the plates are.
 */
export function shrimpBandPrimitives(palette: ShrimpPalette, bodyD: string): Node[] {
  if (!palette.bandColor || palette.bandCount <= 0) return [];
  const out: Node[] = [];
  // Start a little forward of the abdomen so the rearmost carapace edge
  // carries a band too, the way a Crystal Red's front saddle does.
  const first = ABDOMEN_START - 0.06;
  const last = 0.94;
  const half = ((last - first) / palette.bandCount) * 0.4;
  for (let i = 0; i < palette.bandCount; i++) {
    const centre =
      palette.bandCount === 1
        ? (first + last) / 2
        : first + ((last - first) * i) / (palette.bandCount - 1);
    out.push({
      kind: "path",
      d: slabD(centre - half, centre + half, 1.05),
      paint: { type: "solid", color: palette.bandColor, opacity: 0.82 },
      clip: bodyD,
    });
  }
  return out;
}

/** Fine brown mottling over the translucent "ghost" coat — the only variant that gets any. Placed along the spine so it lands on the body wherever the arch puts it. */
export function shrimpSpecklePrimitives(
  palette: ShrimpPalette,
  seed: number,
  bodyD: string,
): Node[] {
  if (!palette.speckleColor) return [];
  const rng = makeRng(`shrimp-speckle-${seed}`);
  return scatterBlobPrimitives({
    rng,
    count: 26,
    place: (r) => {
      const u = r();
      const s = spineAt(u);
      const off = (r() - 0.5) * 1.7 * bodyHalfHeightAt(u);
      return { x: s.point.x + s.normal.x * off, y: s.point.y + s.normal.y * off };
    },
    radius: (r) => 0.6 + r() * 1.1,
    wobble: 0.5,
    paint: () => ({ type: "solid", color: palette.speckleColor!, opacity: 0.3 + rng() * 0.25 }),
    blur: 0.5,
    clip: bodyD,
  });
}

/** A soft dark line along the back where the digestive tract shows through a translucent shell — cheap, real, and unique to the see-through coats. Follows the spine, so it curves with the arch. */
export function shrimpGutLinePrimitive(palette: ShrimpPalette, bodyD: string): Node | null {
  if (!palette.speckleColor) return null;
  const pts: XY[] = [];
  for (let i = 0; i <= 28; i++) {
    const u = 0.1 + (0.85 * i) / 28;
    const s = spineAt(u);
    const off = bodyHalfHeightAt(u) * 0.42;
    pts.push({ x: s.point.x + s.normal.x * off, y: s.point.y + s.normal.y * off });
  }
  return {
    kind: "path",
    d: pts.map((p, i) => `${i === 0 ? "M" : "L"} ${F(p.x)} ${F(p.y)}`).join(" "),
    paint: { type: "solid", color: rgba(coolShadow(palette.base, 0.7), 0.4) },
    stroke: { width: 1.5 },
    blur: 0.7,
    clip: bodyD,
  };
}
