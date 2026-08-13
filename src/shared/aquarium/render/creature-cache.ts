// React-side bake cache for non-molly species — the `fish-cache.ts` twin.
// Separate LRU/budget from the fish cache: a tank mixing several species
// shouldn't let one species' bakes evict another's, and creature bakes are
// smaller (no fins, no spine-warp padding) so this budget is set lower.
//
// Goes through `creatures/bake-creature.ts`'s dispatcher, never a
// per-species (or the placeholder) bake module directly, so a species
// graduating from placeholder to real anatomy needs no change here.

import { Skia } from "@shopify/react-native-skia";

import { bakeBytes, createBakeLru, type BakedArt } from "@/shared/aquarium/core/bake";
import { bakeCreature, creatureBakeKey } from "@/shared/aquarium/creatures/bake-creature";
import type { CreatureSpeciesId } from "@/shared/aquarium/creatures/bake-placeholder";

const BUDGET_BYTES = 12 * 1024 * 1024;
const lru = createBakeLru(BUDGET_BYTES);

export function getCachedCreature(
  speciesId: CreatureSpeciesId,
  variant: string,
  dpr: number,
): BakedArt | null {
  const key = `${creatureBakeKey(speciesId, variant)}|${dpr.toFixed(2)}`;
  const hit = lru.get(key);
  if (hit) return hit;
  const baked = bakeCreature(Skia, speciesId, variant, dpr);
  if (baked) lru.set(key, baked, bakeBytes(baked.bounds, dpr));
  return baked;
}
