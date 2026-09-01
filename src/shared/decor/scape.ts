// Turns owned+placed decor into the sprite theme `AquariumCanvas` composes —
// the seam between "rows in a table" and "a scene". Deliberately takes plain
// `PlacedDecor` objects rather than `DecorItemRow`s so this stays DB-free and
// Node-runnable (mirrors how `scene/compose-sprites.ts` itself has no DB
// dependency).

import type { SpritePlacement, SpriteSceneTheme } from "@/shared/aquarium";

import { getDecorDef } from "./catalog";
import type { PlacedDecor } from "./types";

/** Swim lanes are inert at runtime today (`AquariumCanvas` never reads
 *  `swimLaneRects`) — a placeholder centre lane keeps the shape consistent
 *  with the authored theme in case that changes later. */
const DEFAULT_SWIM_LANES = [{ xFraction: [0.32, 0.72] as [number, number] }];

export function scapeFromItems(items: readonly PlacedDecor[]): SpriteSceneTheme {
  const placements: SpritePlacement[] = [];
  for (const item of items) {
    // A retired sprite id (removed from SCENE_SPRITES after being sold)
    // orphans the row rather than crashing the render — same "skip rather
    // than throw" contract `compose-sprites.ts` applies to an unknown id.
    const def = getDecorDef(item.itemId);
    if (!def) continue;
    placements.push({
      id: item.id,
      spriteId: item.itemId,
      layer: item.layer,
      xFraction: item.xFraction,
      scale: item.scale,
      mirror: item.mirror,
      maxHeightFraction: def.maxHeightFraction,
    });
  }
  return {
    name: "user-scape",
    placements,
    swimLanes: DEFAULT_SWIM_LANES,
  };
}
