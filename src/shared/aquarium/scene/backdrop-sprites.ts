// Procedural backdrop fill for SPRITE mode — the painted-PNG counterpart to
// `backdrop.ts`. Same idea, same scatter (`scatter.ts`), different pieces:
// this one places entries from `sprites/sprite-manifest.ts` rather than
// running generators.
//
// COMPOSED AGAINST `assets/images/scene/scene.png`, the reference art. Read
// that image before touching the bands below, because the thing it gets
// right is the thing this file got wrong on its first pass:
//
//   THE CENTRE OF THE REFERENCE IS EMPTY. Two dense clusters sit on the
//   flanks — a driftwood tangle on the left, a boulder pile on the right —
//   and between them is open water with nothing in it but pale distant
//   silhouettes and a scatter of small pebbles on the sand. An earlier
//   version of this file filled the whole frame evenly at every height,
//   which buried the hardscape, erased the swim lane, and read as clutter
//   rather than as a tank.
//
// That is why each band carries its OWN `envelopeFloor` instead of sharing
// one. Bands do different jobs and want opposite density profiles:
//
//   pebbles   0.90  even across the sand, including the open middle
//   far       0.55  fairly even, but nothing taller than ~20% of frame
//   ground    0.30  flank-weighted, thinning through the centre
//   canopy    0.10  flanks ONLY — this is the band that closes a tank
//
// TWO RULES, both inherited and both load-bearing:
//
//   1. `far`/`back` ONLY (`BackdropLayer` makes it a compile error).
//      `verify-aquarium.ts`'s sprite composition checks filter mid+front as
//      an allowlist, exactly like the procedural ones, so a fill confined to
//      the back cannot move occupancy or the corridor fraction.
//
//   2. The fill is NOT part of `SPRITE_SCAPE.placements`. It's concatenated
//      into a separate `SPRITE_SCAPE_FILLED` — see that theme's comment.
//      `scripts/lib/sprite-placement-patch.ts` keys placements by ARRAY
//      INDEX (a sprite piece has no seed to key on), and
//      `composeSpriteScene` builds `PlacedSprite.key` from that same index,
//      so injecting the fill into the authored array would shift every index
//      and silently misapply every drag in the Sprites tab.
//
// UNLIKE `backdrop.ts`, scales here do NOT need to come from a bounded pool:
// sprite mode has no bake step and no LRU (`render/sprite-layers.tsx` draws
// the PNG directly), so a distinct scale costs nothing. The cost that does
// exist is image DECODES, which is bounded by the manifest — 21 sprites —
// and shared across every piece by `SpriteLayerGroup`'s hoisted loader. The
// variant pool here is therefore about art direction, not about bytes.
//
// Dependency-free: `./compose-sprites`, `./scatter`, `./sprites/sprite-manifest`.

import type { SpritePlacement } from "./compose-sprites";
import { round3, scatterBand, type ScatterBand, type ScatterVariant } from "./scatter";
import { SCENE_SPRITES, type SpriteId } from "./sprites/sprite-manifest";
import type { SceneLayer } from "./types";

/** Rule 1, as a type. */
type BackdropLayer = Extract<SceneLayer, "far" | "back">;

/**
 * A second piece placed with the first — the way a MOSSY ROCK gets built,
 * since there is no mossy-rock PNG.
 *
 * The moss sits at the rock's FOOT, not on its crown. That's how
 * `scene.png` does it (small bright clumps hugging the base of every boulder
 * and log) and it's how moss actually grows in a scape — perched on top, it
 * read as a green hat balanced on a stone.
 *
 * Keep the moss under `render/aquarium-canvas.tsx`'s `CLIMBABLE_MIN_HEIGHT`
 * (34px on screen). At or above it, the clump becomes a `sim/crawl.ts` climb
 * prop of its own, which at best gives a snail a redundant second prop
 * inches from the rock it is already climbing.
 */
interface Companion {
  spriteId: SpriteId;
  scale: number;
  /** Sideways offset as a fraction of the HOST's drawn width — where on the rock the moss sits. */
  dxFraction: number;
  /** How far up the host's drawn height the moss sits, 0 = at its foot. */
  liftFraction: number;
  mirror?: boolean;
}

interface Variant extends ScatterVariant {
  spriteId: SpriteId;
  scale: number;
  mirror?: boolean;
  companion?: Companion;
}

interface Band extends ScatterBand<Variant> {
  layer: BackdropLayer;
  /** px above the substrate line, PRE-`sizeFactor`. `far` only — see `SpritePlacement.yLift`. */
  yLift?: readonly [number, number];
}

function scatter(band: Band, canvasRef = 390): SpritePlacement[] {
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

    // Offsets are computed off the host's NATIVE sprite size times its
    // placement scale — i.e. in the same pre-`sizeFactor` units `yLift` and
    // `xFraction` use, so the pairing holds together at every canvas size.
    const sprite = SCENE_SPRITES[v.spriteId];
    const c = v.companion;
    const moss: SpritePlacement = {
      spriteId: c.spriteId,
      layer: band.layer,
      // `xFraction` is a fraction of canvas WIDTH, so a pixel offset has to
      // be divided by a reference width to get there. Using a fixed
      // reference (not the live canvas) keeps the fill a pure constant —
      // it's built once at import, before any canvas exists.
      xFraction: round3(xFraction + (sprite.width * v.scale * c.dxFraction) / canvasRef),
      scale: c.scale,
      ...(c.mirror ? { mirror: true } : {}),
      yLift: round3(bandLift + sprite.height * v.scale * c.liftFraction),
    };
    return [host, moss];
  });
}

/**
 * PEBBLE band: the small stones scattered across the open sand.
 *
 * The one band that is deliberately EVEN (`envelopeFloor` 0.9) — in the
 * reference the pebbles are the only thing crossing the empty middle, and
 * they are what stops that emptiness reading as a blank sheet rather than as
 * a sand bed. Tiny on purpose: ~18-28px on screen, well under
 * `CLIMBABLE_MIN_HEIGHT`, so they never become snail props or register as
 * obstacles.
 *
 * `rockSmall` at very low scale stands in for the deleted `pebble.png` /
 * `pebble-brown.png`.
 */
const PEBBLE_BAND: Band = {
  key: "sprite-pebbles",
  layer: "back",
  columns: 26,
  // Bleed past both edges so the parallax drift never exposes a seam.
  xFrom: -0.03,
  xTo: 1.03,
  skipCentre: 0.3,
  skipEdge: 0.2,
  envelopeFloor: 0.9,
  variants: [
    { spriteId: "rockSmall", scale: 0.16, height: 0.0, weight: 1.4 },
    { spriteId: "rockSmall", scale: 0.2, height: 0.1, weight: 1.3, mirror: true },
    { spriteId: "rockSmall", scale: 0.25, height: 0.2, weight: 1.0 },
    { spriteId: "rockA", scale: 0.16, height: 0.15, weight: 0.9, mirror: true },
  ],
};

/**
 * FAR band: the pale, distant silhouettes standing behind everything at 0.45
 * opacity — the blue-grey plant shapes filling the reference's midground.
 *
 * Fairly even across the width (`envelopeFloor` 0.55) but capped LOW: the
 * tallest variant reaches ~20% of a portrait water column. That combination
 * is what makes the open centre read as depth rather than as a hole — there
 * is something back there, it is just far away and short. Raising these
 * heights is the fastest way to lose the reference's airiness.
 *
 * Scales are picked against the SHORT canvas. `sizeFactorFor` returns exactly
 * 0.6 at 390x844 and at 844x390 alike, so every piece is the same absolute
 * size in a 330px landscape water column as in a 784px portrait one — sized
 * against portrait, this band becomes a wall in landscape. Only the 844x390
 * composite in `yarn aquarium:preview` can catch that; the composition checks
 * can't, since rule 1 exempts this band from them.
 */
const FAR_BAND: Band = {
  key: "sprite-far",
  layer: "far",
  columns: 20,
  xFrom: -0.03,
  xTo: 1.03,
  yLift: [2, 18],
  skipCentre: 0.35,
  skipEdge: 0.12,
  envelopeFloor: 0.55,
  variants: [
    { spriteId: "grassTuft", scale: 0.45, height: 0.1, weight: 1.2 },
    { spriteId: "leafyClump", scale: 0.4, height: 0.2, weight: 1.1 },
    { spriteId: "grassSpiky", scale: 0.5, height: 0.4, weight: 1.2 },
    { spriteId: "fern", scale: 0.5, height: 0.55, weight: 1.2 },
    { spriteId: "anubiasB", scale: 0.45, height: 0.6, weight: 0.9 },
    { spriteId: "cabomba", scale: 0.4, height: 0.7, weight: 1.1 },
    { spriteId: "tallGrass", scale: 0.42, height: 0.85, weight: 1.0 },
    { spriteId: "cabomba", scale: 0.52, height: 1.0, weight: 1.0, mirror: true },
  ],
};

/**
 * GROUND pass: what dresses the substrate at the FLANKS — mossy rocks, moss
 * clumps, low grass, low driftwood.
 *
 * `envelopeFloor` 0.30, so this thins out markedly through the middle third
 * and leaves the open sand to `PEBBLE_BAND` alone. Every bare rock carries
 * moss at its foot, matching the reference, where no boulder sits on clean
 * sand.
 *
 * The driftwood here stays modest — the BIG wood is hand-placed in
 * `themes/nature-scape-sprites.ts` as the composition's two focal clusters,
 * and a fill that also scattered large logs would compete with it.
 *
 * No leafy foliage variant (`leafyClump`/`leafyBush`/`anubiasA`) shares this
 * pool with the driftwood variants anymore — removed directly on request
 * ("bỏ phần lá khỏi lũa"). `pickVariant` (scatter.ts) favours whichever
 * variant's `height` is closest to a column's flank-ness `u`; `anubiasA`'s
 * 0.7 sat right next to the driftwood pieces' 0.8-0.9, so at the exact flank
 * columns where the hand-placed driftwood clusters already sit, this band
 * kept rolling a leaf into the neighbouring column — reading as foliage
 * sprouting off the wood even though the two were never literally paired.
 * `grassTuft` stays: a blade tuft, not a broad-leaf clump, so it doesn't read
 * the same way.
 */
const BACK_GROUND_BAND: Band = {
  key: "sprite-back-ground",
  layer: "back",
  columns: 22,
  xFrom: -0.03,
  xTo: 1.03,
  skipCentre: 0.55,
  skipEdge: 0.08,
  envelopeFloor: 0.3,
  variants: [
    {
      spriteId: "rockSmall",
      scale: 0.38,
      height: 0.1,
      weight: 1.2,
      mirror: true,
      companion: { spriteId: "mossBall", scale: 0.24, dxFraction: 0.3, liftFraction: 0.04 },
    },
    { spriteId: "mossBall", scale: 0.55, height: 0.3, weight: 1.1 },
    {
      spriteId: "rockSmall",
      scale: 0.55,
      height: 0.4,
      weight: 1.1,
      companion: { spriteId: "mossBall", scale: 0.3, dxFraction: -0.34, liftFraction: 0.03 },
    },
    {
      spriteId: "rockA",
      scale: 0.38,
      height: 0.35,
      weight: 0.9,
      companion: { spriteId: "mossBall", scale: 0.3, dxFraction: 0.3, liftFraction: 0.05 },
    },
    { spriteId: "grassTuft", scale: 0.95, height: 0.6, weight: 1.2 },
    { spriteId: "driftwoodLog", scale: 0.8, height: 0.8, weight: 0.7 },
    { spriteId: "driftwoodBranch", scale: 0.9, height: 0.9, weight: 0.7, side: "left" },
    {
      spriteId: "driftwoodBranch2",
      scale: 0.95,
      height: 0.9,
      weight: 0.7,
      side: "right",
      mirror: true,
    },
  ],
};

/**
 * CANOPY pass: the tall weed. `envelopeFloor` 0.10 and a 0.8 centre skip —
 * this band is FLANKS ONLY, and that restriction is the single thing keeping
 * the tank open.
 *
 * An earlier version ran this at floor 0.75 across the full width. It closed
 * the frame into a hedge, buried the driftwood the composition is built
 * around, and is exactly what "the tank became chaotic" meant. If the middle
 * ever needs something, it wants a FAR-band silhouette, not a canopy piece.
 *
 * Deliberately mixed: `tallGrass`/`kelp` are strap silhouettes and
 * `cabomba`/`fern` are feathery, since a canopy of any one of them alone
 * reads as a texture repeat rather than planting.
 *
 * NO `rotalaTall` — the red stem plant is deliberately absent from the whole
 * scene now (the authored theme dropped its two front-layer ones as well),
 * even though the reference art does carry warm accents.
 *
 * THE SCALE CEILING HERE IS ~1.7, AND IT IS A HARD ONE. These are fixed-
 * resolution PNGs, unlike `backdrop.ts`'s generators which re-render at any
 * size. `compose-sprites.ts` multiplies by `sizeFactorFor` = 0.6, so scale
 * 1.7 draws a piece at almost exactly its native pixel size; past that it is
 * being upscaled, and on a 3x screen the softness is obvious. The tallest
 * asset is 414px (`tall-grass.png`), which is what caps this canopy at
 * roughly half a portrait water column — filling higher would need taller
 * source art, not a bigger number here.
 */
const BACK_CANOPY_BAND: Band = {
  key: "sprite-back-canopy",
  layer: "back",
  columns: 12,
  xFrom: -0.02,
  xTo: 1.02,
  skipCentre: 0.8,
  skipEdge: 0.05,
  envelopeFloor: 0.1,
  variants: [
    { spriteId: "grassSpiky", scale: 1.0, height: 0.3, weight: 1.0 },
    { spriteId: "fern", scale: 1.0, height: 0.45, weight: 1.0 },
    { spriteId: "anubiasB", scale: 0.9, height: 0.5, weight: 0.9 },
    { spriteId: "cabomba", scale: 1.1, height: 0.65, weight: 1.1 },
    { spriteId: "kelp", scale: 1.15, height: 0.8, weight: 1.0 },
    { spriteId: "tallGrass", scale: 1.2, height: 0.85, weight: 1.1 },
    { spriteId: "kelp", scale: 1.45, height: 0.95, weight: 1.0, mirror: true },
    { spriteId: "tallGrass", scale: 1.6, height: 1.0, weight: 1.2 },
  ],
};

/** Built once at import: deterministic, so `composeSpriteScene` (which re-runs on every resize) pays nothing for it. */
export const SPRITE_BACKDROP_FILL: readonly SpritePlacement[] = [
  PEBBLE_BAND,
  FAR_BAND,
  BACK_GROUND_BAND,
  BACK_CANOPY_BAND,
].flatMap(scatter);
