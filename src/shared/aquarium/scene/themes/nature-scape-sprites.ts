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
    { spriteId: "driftwoodBranch", layer: "mid", xFraction: 0.12, scale: 0.7 },
    { spriteId: "rockB", layer: "mid", xFraction: 0.23, scale: 1.0 },
    { spriteId: "rockA", layer: "mid", xFraction: 0.06, scale: 0.9 },
    { spriteId: "anubiasA", layer: "mid", xFraction: 0.18, scale: 0.7 },
    { spriteId: "cabomba", layer: "mid", xFraction: 0.26, scale: 0.6 },

    { spriteId: "rockHuge", layer: "mid", xFraction: 0.83, scale: 1.05 },
    { spriteId: "driftwoodLog", layer: "mid", xFraction: 0.76, scale: 0.68 },
    { spriteId: "driftwoodBranch2", layer: "mid", xFraction: 0.91, scale: 0.72 },
    { spriteId: "anubiasB", layer: "mid", xFraction: 0.87, scale: 0.75 },
    { spriteId: "rockSmall", layer: "mid", xFraction: 0.94, scale: 0.85 },
    { spriteId: "kelp", layer: "mid", xFraction: 0.96, scale: 0.55, mirror: true },

    // Front layer: low filler kept sparse so it never blocks the swim lane.
    // Two rotala accents (left-center and far right) echo the reference's
    // warm-colour punctuation on both sides, plus two extra rong sprigs
    // tucked at the outer edges (well clear of the swim lane).
    { spriteId: "rotalaTall", layer: "front", xFraction: 0.29, scale: 0.75 },
    { spriteId: "rotalaTall", layer: "front", xFraction: 0.79, scale: 0.8 },
    { spriteId: "cabomba", layer: "front", xFraction: 0.62, scale: 0.8 },
    { spriteId: "leafyClump", layer: "front", xFraction: 0.2, scale: 0.9 },
    { spriteId: "leafyBush", layer: "front", xFraction: 0.74, scale: 0.85 },
    { spriteId: "cabomba", layer: "front", xFraction: 0.09, scale: 0.5 },
    { spriteId: "anubiasB", layer: "front", xFraction: 0.95, scale: 0.5 },
    { spriteId: "pebble", layer: "front", xFraction: 0.4, scale: 1.1 },
    { spriteId: "pebble", layer: "front", xFraction: 0.5, scale: 0.9 },
    { spriteId: "pebble", layer: "front", xFraction: 0.6, scale: 1.0 },
    { spriteId: "pebbleBrown", layer: "front", xFraction: 0.68, scale: 1.0 },
    { spriteId: "pebble", layer: "front", xFraction: 0.35, scale: 0.8 },
  ],
};
