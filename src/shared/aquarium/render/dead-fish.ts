// Shared dead-fish rendering constants — used by both `fish-layer.tsx`
// (molly) and `creature-layer.tsx` (every other species) so a corpse looks
// identical across species.

/** Desaturation applied to dead fish/creatures. Shared so every renderer cannot drift. */
export const DEAD_GRAYSCALE_MATRIX = [
  0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0.3, 0.55, 0.15, 0, 0.02, 0, 0, 0, 1, 0,
];
export const DEAD_OPACITY = 0.6;
