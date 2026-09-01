/**
 * Rotating x-slots for auto-placed items — spread across the tank so a run
 * of placements (buying several items, or tapping several inventory items
 * in a row) doesn't stack everything on the same spot. Used by both
 * `useBuyDecorMutation` (auto-place on purchase) and the Decorate screen
 * (auto-place the moment an unplaced item is tapped from the inventory).
 *
 * Before this was shared, the Decorate screen placed every newly-tapped item
 * at a flat `xFraction: 0.5` — fine for the first item, but every item after
 * it landed exactly on top of the last, reading as "items clumped together".
 */
const AUTO_PLACE_X_SLOTS = [0.18, 0.62, 0.38, 0.82, 0.28, 0.72, 0.48, 0.88, 0.12, 0.58];

export function autoPlaceXFraction(placedCount: number): number {
  return AUTO_PLACE_X_SLOTS[placedCount % AUTO_PLACE_X_SLOTS.length];
}
