// Procedural backdrop fill for the BLENDER-RENDERED set — the approach-"C"
// counterpart to `backdrop-sprites.ts`, which does the same job for the
// painted PNGs and `backdrop.ts` for the Skia generators.
//
// This exists because the first blender-scape composite placed 21 pieces
// against the painted scene's 131 and read as a thin strip of decor on an
// empty floor. Authored placements set the COMPOSITION; the fill is what
// makes a tank look planted rather than decorated. Skipping it was not a
// stylistic choice, it was an omission.
//
// Every rule `backdrop-sprites.ts` documents applies here unchanged, and for
// the same reasons — read that file's header first. The two load-bearing
// ones:
//
//   1. `far`/`back` layers ONLY, enforced by the type. `verify-aquarium.ts`
//      filters mid+front as an allowlist when it checks occupancy and the
//      swim corridor, so a fill confined to the back cannot move either.
//   2. The fill is NOT concatenated into the authored array in
//      `themes/blender-scape.ts`. `composeSpriteScene` keys `PlacedSprite`
//      by array index, so prepending the fill there would shift every
//      authored index.
//
// The band densities are copied deliberately, not re-tuned: the reference
// composition (`assets/images/scene/scene.png`) has an EMPTY CENTRE with
// dense flanks, and that shape is a property of the tank, not of which
// renderer drew the leaves.
//
// One real difference from the painted bands. There is no separate
// "pebble", "fern" or "leafy clump" render — the blender set is ten species,
// not twenty pieces. Small scales of `b3Rocksmall` and `b3Bush` stand in,
// which works because these renders have no fixed source resolution to
// degrade: a piece drawn at 0.16 scale is genuinely sharper here than the
// painted equivalent, not softer.
//
// Dependency-free: `./compose-sprites`, `./scatter`, `./sprites/sprite-manifest`.

import type { SpritePlacement } from "./compose-sprites";
import { round3, scatterBand, type ScatterBand } from "./scatter";
import { SCENE_SPRITES, type SpriteId } from "./sprites/sprite-manifest";
import type { SceneLayer } from "./types";

type BackdropLayer = Extract<SceneLayer, "far" | "back">;

interface Companion {
  spriteId: SpriteId;
  scale: number;
  /** Offset along x as a fraction of the HOST's drawn width. */
  dxFraction: number;
  /** Lift as a fraction of the host's drawn height. */
  liftFraction: number;
}

interface Variant {
  spriteId: SpriteId;
  scale: number;
  height: number;
  weight: number;
  mirror?: boolean;
  side?: "left" | "right";
  companion?: Companion;
}

interface Band extends ScatterBand<Variant> {
  layer: BackdropLayer;
  yLift?: readonly [number, number];
}

function scatter(band: Band): SpritePlacement[] {
  return scatterBand(band, (v, xFraction, rng) => {
    const bandLift = band.yLift
      ? round3(band.yLift[0] + rng() * (band.yLift[1] - band.yLift[0]))
      : 0;
    const host: SpritePlacement = {
      spriteId: v.spriteId,
      layer: band.layer,
      xFraction,
      scale: v.scale,
      ...(v.mirror ? { mirror: true } : {}),
      ...(bandLift ? { yLift: bandLift } : {}),
    };
    if (!v.companion) return host;
    // Offsets come off the host's NATIVE size times its placement scale, so
    // the pairing holds together at every canvas size — same arithmetic as
    // `backdrop-sprites.ts`.
    const sprite = SCENE_SPRITES[v.spriteId];
    const companion: SpritePlacement = {
      spriteId: v.companion.spriteId,
      layer: band.layer,
      xFraction: round3(xFraction + (sprite.width * v.scale * v.companion.dxFraction) / 390),
      scale: v.companion.scale,
      ...(bandLift
        ? { yLift: round3(bandLift + sprite.height * v.scale * v.companion.liftFraction) }
        : {}),
    };
    return [host, companion];
  });
}

/** Pebbles across the sand, including the open middle — the one band that does not thin out. */
const PEBBLE_BAND: Band = {
  key: "b3-pebbles",
  layer: "back",
  columns: 26,
  xFrom: -0.03,
  xTo: 1.03,
  skipCentre: 0.3,
  skipEdge: 0.2,
  envelopeFloor: 0.9,
  variants: [
    { spriteId: "b3Rocksmall", scale: 0.16, height: 0.0, weight: 1.4 },
    { spriteId: "b3RocksmallB", scale: 0.2, height: 0.1, weight: 1.3, mirror: true },
    { spriteId: "b3Rocksmall", scale: 0.25, height: 0.2, weight: 1.0 },
    { spriteId: "b3RockB", scale: 0.14, height: 0.15, weight: 0.9, mirror: true },
  ],
};

/** Pale distant silhouettes, lifted onto the receding bank. Nothing tall. */
const FAR_BAND: Band = {
  key: "b3-far",
  layer: "far",
  columns: 20,
  xFrom: -0.03,
  xTo: 1.03,
  yLift: [2, 18],
  skipCentre: 0.35,
  skipEdge: 0.12,
  envelopeFloor: 0.55,
  variants: [
    { spriteId: "b3Bush", scale: 0.45, height: 0.1, weight: 1.2 },
    { spriteId: "b3Mossball", scale: 0.4, height: 0.2, weight: 1.1 },
    { spriteId: "b3BushB", scale: 0.5, height: 0.4, weight: 1.2 },
    { spriteId: "b3Grass", scale: 0.4, height: 0.5, weight: 1.0, mirror: true },
    { spriteId: "b3Cabomba", scale: 0.42, height: 0.6, weight: 0.9 },
  ],
};

/** Flank-weighted planting and small hardscape, thinning through the centre. */
const BACK_GROUND_BAND: Band = {
  key: "b3-back-ground",
  layer: "back",
  columns: 22,
  xFrom: -0.03,
  xTo: 1.03,
  skipCentre: 0.55,
  skipEdge: 0.08,
  envelopeFloor: 0.3,
  variants: [
    {
      spriteId: "b3Rocksmall",
      scale: 0.38,
      height: 0.1,
      weight: 1.2,
      mirror: true,
      companion: { spriteId: "b3Mossball", scale: 0.24, dxFraction: 0.3, liftFraction: 0.04 },
    },
    { spriteId: "b3MossballB", scale: 0.55, height: 0.3, weight: 1.1 },
    {
      spriteId: "b3RocksmallB",
      scale: 0.55,
      height: 0.4,
      weight: 1.1,
      companion: { spriteId: "b3Mossball", scale: 0.3, dxFraction: -0.34, liftFraction: 0.03 },
    },
    {
      spriteId: "b3Rock",
      scale: 0.34,
      height: 0.35,
      weight: 0.9,
      companion: { spriteId: "b3MossballB", scale: 0.3, dxFraction: 0.3, liftFraction: 0.05 },
    },
    { spriteId: "b3Bush", scale: 0.9, height: 0.6, weight: 1.2 },
    { spriteId: "b3Anubias", scale: 0.8, height: 0.65, weight: 1.0 },
    { spriteId: "b3Driftwood", scale: 0.7, height: 0.8, weight: 0.7, side: "left" },
    {
      spriteId: "b3DriftwoodB",
      scale: 0.75,
      height: 0.9,
      weight: 0.7,
      side: "right",
      mirror: true,
    },
  ],
};

/** The band that closes a tank: tall planting on the flanks ONLY. */
const BACK_CANOPY_BAND: Band = {
  key: "b3-back-canopy",
  layer: "back",
  columns: 12,
  xFrom: -0.02,
  xTo: 1.02,
  skipCentre: 0.8,
  skipEdge: 0.05,
  envelopeFloor: 0.1,
  variants: [
    { spriteId: "b3SwordB", scale: 1.0, height: 0.3, weight: 1.0 },
    { spriteId: "b3Anubias", scale: 1.0, height: 0.45, weight: 0.9 },
    { spriteId: "b3AnubiasB", scale: 0.9, height: 0.5, weight: 0.9 },
    { spriteId: "b3Cabomba", scale: 1.1, height: 0.65, weight: 1.1 },
    { spriteId: "b3Kelp", scale: 1.15, height: 0.8, weight: 1.0 },
    { spriteId: "b3Grass", scale: 1.2, height: 0.85, weight: 1.1 },
    { spriteId: "b3KelpB", scale: 1.45, height: 0.95, weight: 1.0, mirror: true },
    { spriteId: "b3GrassB", scale: 1.6, height: 1.0, weight: 1.2 },
  ],
};

/** Built once at import: deterministic, so a resize costs nothing. */
export const BLENDER_BACKDROP_FILL: readonly SpritePlacement[] = [
  PEBBLE_BAND,
  FAR_BAND,
  BACK_GROUND_BAND,
  BACK_CANOPY_BAND,
].flatMap(scatter);
