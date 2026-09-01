// Sprite-mode counterpart to `nature-scape.ts` — authored against real
// painted PNG pieces instead of generated species (see `sprite-manifest.ts`'s
// header for where they came from), and composed to read close to the
// `scene.png` reference: fairly balanced left/right mass (each side gets its
// own driftwood + rock + anubias + a warm accent), rather than the
// procedural theme's deliberately left-dominant asymmetry. Swim lane still
// kept clear down the middle.
//
// `sandPatch` is NOT placed here — it's drawn as the actual ground by
// `render/sprite-layers.tsx`'s `SpriteSubstrate` (stretched to the full
// canvas width, replacing `water.tsx`'s procedural sand shader in this
// mode), not scattered as one more decor piece.

import { SPRITE_BACKDROP_FILL } from "../backdrop-sprites";
import type { SpriteSceneTheme } from "../compose-sprites";

export const SPRITE_SCAPE: SpriteSceneTheme = {
  name: "nature-scape-sprites",
  swimLanes: [{ xFraction: [0.32, 0.72] }],
  placements: [
    // Back layer. Kelp/grass bumped up and two extra rong (cabomba) tucked
    // in behind the driftwood clusters, echoing the reference's denser
    // background planting.
    { spriteId: "kelp", layer: "back", xFraction: 0.03, scale: 1.15 },
    { spriteId: "grassSpiky", layer: "back", xFraction: 0.1, scale: 0.85 },
    { spriteId: "cabomba", layer: "back", xFraction: 0.09, scale: 0.6 },
    { spriteId: "fern", layer: "back", xFraction: 0.62, scale: 0.9 },
    { spriteId: "mossBall", layer: "back", xFraction: 0.14, scale: 0.75 },
    { spriteId: "mossBall", layer: "back", xFraction: 0.87, scale: 0.7 },
    { spriteId: "cabomba", layer: "back", xFraction: 0.92, scale: 0.55 },
    { spriteId: "tallGrass", layer: "back", xFraction: 0.97, scale: 1.1 },

    // Mid layer: driftwood + rock scaled up to read as the dominant
    // hardscape (matching the reference's large tangled root ball and
    // boulder), plus extra rong worked in on both sides. Left leans on the
    // taller/more tangled driftwood, right leans on the bigger boulder.
    // THE DRIFTWOOD IS A CLUSTER, NOT A PIECE. The source PNGs are small
    // (`driftwood-branch.png` is 93x205) and no single one of them can be a
    // centrepiece at a size that still looks sharp. Overlapping a wide low
    // log with two rising branches gives the big tangled root ball the
    // reference art has, out of parts that each stay near their own
    // resolution.
    //
    // Every piece here is clamped to the SAME ~1.7 "native pixel size"
    // ceiling `backdrop-sprites.ts`'s `BACK_CANOPY_BAND` documents as hard:
    // these are fixed-resolution PNGs with no source art above their shipped
    // pixel size, so past 1.7 the renderer is upscaling, and on a 3x screen
    // that read as visibly soft/broken — reported directly ("khi scale lớn
    // sẽ bị vỡ"). An earlier revision pushed the branches to 2.1-2.4 to make
    // the cluster read as a bigger centerpiece and accepted the softness as
    // the cost; that trade is no longer worth it. If the cluster needs to
    // look bigger again, that has to come from taller/wider source art, not
    // a larger number here.
    //
    // `maxHeightFraction` still guards against a landscape canvas turning
    // this into a wall — see `SpritePlacement.maxHeightFraction`.
    {
      spriteId: "driftwoodLog",
      layer: "mid",
      xFraction: 0.17,
      scale: 1.55,
      maxHeightFraction: 0.2,
    },
    {
      spriteId: "driftwoodBranch",
      layer: "mid",
      xFraction: 0.12,
      scale: 1.7,
      maxHeightFraction: 0.42,
    },
    {
      spriteId: "driftwoodBranch2",
      layer: "mid",
      xFraction: 0.24,
      scale: 1.7,
      mirror: true,
      maxHeightFraction: 0.34,
    },
    { spriteId: "rockB", layer: "mid", xFraction: 0.23, scale: 1.0 },
    // Moss on the two dominant boulders — same rock+moss pairing the fill
    // uses, hand-placed here because these are the pieces the eye lands on.
    // The leafy pieces that used to sit right here (a `leafyClump` and an
    // `anubiasA`, both reading as growing directly out of the rock/driftwood
    // cluster) are gone — reported directly ("bỏ lá ra khỏi đá, lũa"). Moss
    // stays: it's the reference art's own rock treatment, not foliage on the
    // hardscape.
    { spriteId: "mossBall", layer: "mid", xFraction: 0.2, scale: 0.55, yLift: 62 },
    { spriteId: "rockA", layer: "mid", xFraction: 0.06, scale: 0.9 },
    { spriteId: "cabomba", layer: "mid", xFraction: 0.26, scale: 0.6 },

    { spriteId: "rockHuge", layer: "mid", xFraction: 0.83, scale: 1.05 },
    { spriteId: "mossBall", layer: "mid", xFraction: 0.86, scale: 0.6, yLift: 78 },
    // Right-hand cluster: smaller than the left one by design (the theme's
    // header calls for balanced-but-not-mirrored mass), same log+branch
    // pairing.
    {
      spriteId: "driftwoodLog",
      layer: "mid",
      xFraction: 0.78,
      scale: 1.7,
      mirror: true,
      maxHeightFraction: 0.22,
    },
    {
      spriteId: "driftwoodBranch2",
      layer: "mid",
      xFraction: 0.91,
      scale: 1.7,
      maxHeightFraction: 0.38,
    },
    // (the `anubiasB` that used to sit at 0.87, against this cluster, is
    // removed for the same reason as the left cluster's, above)
    { spriteId: "rockSmall", layer: "mid", xFraction: 0.94, scale: 0.85 },
    { spriteId: "kelp", layer: "mid", xFraction: 0.96, scale: 0.55, mirror: true },

    // Front layer: low filler kept sparse so it never blocks the swim lane.
    // The two `rotalaTall` accents that used to sit at 0.29 and 0.79 are
    // gone — the red stem plant is deliberately absent from the whole scene
    // now, here and in `backdrop-sprites.ts`. NOTE this shifted every later
    // index in this array, which `scripts/lib/sprite-placement-patch.ts`
    // keys on; that's the documented cost of a hand-edit, and it only
    // matters for a design-editor session open across the change.
    { spriteId: "cabomba", layer: "front", xFraction: 0.62, scale: 0.8 },
    { spriteId: "leafyClump", layer: "front", xFraction: 0.2, scale: 0.9 },
    { spriteId: "leafyBush", layer: "front", xFraction: 0.74, scale: 0.85 },
    { spriteId: "cabomba", layer: "front", xFraction: 0.09, scale: 0.5 },
    { spriteId: "anubiasB", layer: "front", xFraction: 0.95, scale: 0.5 },
    // These five were loose `pebble`/`pebbleBrown` sprites breaking up the
    // substrate/glass seam in-lane. Those PNGs were deleted, so the same job
    // is done by small mossy rocks — kept low and scattered so they still
    // read as texture rather than as an obstacle in the swim lane.
    { spriteId: "rockSmall", layer: "front", xFraction: 0.4, scale: 0.34 },
    { spriteId: "mossBall", layer: "front", xFraction: 0.42, scale: 0.24, yLift: 16 },
    { spriteId: "rockSmall", layer: "front", xFraction: 0.5, scale: 0.28, mirror: true },
    { spriteId: "rockSmall", layer: "front", xFraction: 0.6, scale: 0.32 },
    { spriteId: "mossBall", layer: "front", xFraction: 0.615, scale: 0.22, yLift: 14 },
    { spriteId: "rockSmall", layer: "front", xFraction: 0.68, scale: 0.3, mirror: true },
    { spriteId: "rockSmall", layer: "front", xFraction: 0.35, scale: 0.26 },
  ],
};

/**
 * What the app, `verify-aquarium.ts` and `aquarium-preview.ts` actually
 * render: the authored composition above with `scene/backdrop-sprites.ts`'s
 * procedural far/back fill behind it. The fill goes FIRST so it draws behind
 * the authored pieces within each layer.
 *
 * Kept as a SEPARATE constant rather than spread into `SPRITE_SCAPE.
 * placements`, and this is not cosmetic: `scripts/lib/sprite-placement-
 * patch.ts` keys placements by ARRAY INDEX — a sprite piece has no seed to
 * key on — and `composeSpriteScene` builds `PlacedSprite.key` from that same
 * index. Injecting ~70 fill entries into the authored array would shift
 * every index and silently misapply every drag in the design editor's
 * Sprites tab. `SPRITE_SCAPE` therefore stays exactly what it was, and the
 * editor keeps operating on it untouched.
 */
export const SPRITE_SCAPE_FILLED: SpriteSceneTheme = {
  ...SPRITE_SCAPE,
  placements: [...SPRITE_BACKDROP_FILL, ...SPRITE_SCAPE.placements],
};
