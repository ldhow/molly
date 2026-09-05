// Sprite-mode theme built from the BLENDER-RENDERED pieces — approach "C",
// the third sibling of `nature-scape.ts` (Skia generators) and
// `nature-scape-sprites.ts` (painted PNGs).
//
// Composed against the same reference `nature-scape-sprites.ts` targets:
// balanced left/right mass, each side carrying its own driftwood + boulder +
// planting, and a clear swim corridor down the middle. Two differences from
// that theme, both consequences of where the art comes from:
//
//   1. NO ~1.7x SCALE CEILING. That theme documents a hard cap because its
//      PNGs have no source art above their shipped pixel size, and pushing
//      past it read as visibly soft on a 3x screen. These pieces are
//      rendered at 2-4x their logical `width`/`height` (see `renderRes` in
//      `blender-manifest.ts`), so a centrepiece can actually be scaled up.
//      Re-run `yarn decor:blender -- --res ...` if a piece ever needs more.
//   2. THE DRIFTWOOD IS ONE PIECE, NOT A CLUSTER. `nature-scape-sprites.ts`
//      stacks a log and two branches to fake a root ball out of parts that
//      each stay near their own resolution. `build_driftwood` models the
//      trunk-plus-branches relationship in the geometry, so one placement
//      does what three used to.
//
// Every species has two seeds (`…` and `…B`). Alternating them is the whole
// reason they exist — repeating one silhouette across a scene is the loudest
// tell that decor is stamped rather than grown.

import { BLENDER_BACKDROP_FILL } from "../backdrop-blender";
import type { SpritePlacement, SpriteSceneTheme } from "../compose-sprites";

/**
 * Ordered back-to-front. `compose-sprites.ts` sorts by layer, so the order
 * here only matters within a layer — but keeping it readable back-to-front
 * makes the intended depth obvious when tuning.
 */
const PLACEMENTS: SpritePlacement[] = [
  // Back band — tall, cool, low contrast. Kelp anchors both edges; grass and
  // cabomba fill between without crowding the corridor.
  { spriteId: "b3Kelp", layer: "back", xFraction: 0.02, scale: 1.2 },
  { spriteId: "b3GrassB", layer: "back", xFraction: 0.12, scale: 0.95 },
  { spriteId: "b3Cabomba", layer: "back", xFraction: 0.2, scale: 0.7 },
  { spriteId: "b3Mossball", layer: "back", xFraction: 0.27, scale: 0.7 },
  { spriteId: "b3CabombaB", layer: "back", xFraction: 0.78, scale: 0.65 },
  { spriteId: "b3Grass", layer: "back", xFraction: 0.88, scale: 1.0 },
  { spriteId: "b3KelpB", layer: "back", xFraction: 0.97, scale: 1.15 },

  // Mid band — the hardscape that carries the composition's mass. One
  // driftwood and one boulder per side, deliberately different seeds so the
  // two sides do not mirror each other.
  {
    spriteId: "b3Driftwood",
    layer: "mid",
    xFraction: 0.16,
    scale: 1.35,
    maxHeightFraction: 0.42,
  },
  { spriteId: "b3Rock", layer: "mid", xFraction: 0.08, scale: 1.1, maxHeightFraction: 0.3 },
  { spriteId: "b3Sword", layer: "mid", xFraction: 0.24, scale: 1.1 },
  { spriteId: "b3Anubias", layer: "mid", xFraction: 0.3, scale: 0.9 },
  {
    spriteId: "b3DriftwoodB",
    layer: "mid",
    xFraction: 0.84,
    scale: 1.3,
    mirror: true,
    maxHeightFraction: 0.42,
  },
  { spriteId: "b3RockB", layer: "mid", xFraction: 0.93, scale: 1.15, maxHeightFraction: 0.3 },
  { spriteId: "b3SwordB", layer: "mid", xFraction: 0.74, scale: 1.05 },
  { spriteId: "b3AnubiasB", layer: "mid", xFraction: 0.69, scale: 0.95 },

  // Front band — small, warm, high contrast, hugging the substrate so it
  // frames the corridor instead of blocking it.
  { spriteId: "b3Rocksmall", layer: "frontMid", xFraction: 0.35, scale: 0.75 },
  { spriteId: "b3Bush", layer: "frontMid", xFraction: 0.05, scale: 0.9 },
  { spriteId: "b3BushB", layer: "frontMid", xFraction: 0.95, scale: 0.85 },
  { spriteId: "b3MossballB", layer: "front", xFraction: 0.63, scale: 0.8 },
  { spriteId: "b3RocksmallB", layer: "front", xFraction: 0.9, scale: 0.8 },
  { spriteId: "b3Bush", layer: "front", xFraction: 0.14, scale: 0.75, mirror: true },
];

/**
 * The authored composition ALONE — no backdrop fill.
 *
 * Kept separate for the same reason `nature-scape-sprites.ts` keeps
 * `SPRITE_SCAPE` separate from `SPRITE_SCAPE_FILLED`: placements are keyed
 * by array index, so prepending the fill here would shift every authored
 * index and silently misapply any editor drag.
 */
export const BLENDER_SCAPE: SpriteSceneTheme = {
  name: "blender-scape",
  // Same corridor the other two themes author, so `verify-aquarium.ts`'s
  // occupancy and corridor checks compare like with like.
  swimLanes: [{ xFraction: [0.32, 0.72] }],
  placements: PLACEMENTS,
};

/** What anything rendering this theme should actually use. */
export const BLENDER_SCAPE_FILLED: SpriteSceneTheme = {
  ...BLENDER_SCAPE,
  placements: [...BLENDER_BACKDROP_FILL, ...BLENDER_SCAPE.placements],
};
