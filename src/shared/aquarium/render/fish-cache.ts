// React-side bake cache: the app's real, on-device `Skia` (not the Node
// bridge) baking through the same `core/bake.ts`/`fish/bake-fish.ts` used by
// the headless verify/preview scripts.
//
// One layer per fish (not the old pipeline's three), so the budget here is
// roughly half of `fish-picture.ts`'s 48MB even before density-aware DPR
// shrinks it further on non-3x devices.

import { Skia } from "@shopify/react-native-skia";

import { bakeBytes, createBakeLru, type BakedArt } from "@/shared/aquarium/core/bake";
import {
  bakeFish,
  bakeFishSilhouette,
  fishBakeKey,
  fishSilhouetteBakeKey,
} from "@/shared/aquarium/fish/bake-fish";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

const BUDGET_BYTES = 24 * 1024 * 1024;
const lru = createBakeLru(BUDGET_BYTES);

export function getCachedFish(traits: FishTraits, stage: LifeStage, dpr: number): BakedArt | null {
  const key = `${fishBakeKey(traits, stage)}|${dpr.toFixed(2)}`;
  const hit = lru.get(key);
  if (hit) return hit;
  const baked = bakeFish(Skia, traits, stage, dpr);
  if (baked) lru.set(key, baked, bakeBytes(baked.bounds, dpr));
  return baked;
}

/** Colour-blind — keyed on shape only, so every locked colour sharing a body/tail/dorsal combo shares one bake. */
export function getCachedFishSilhouette(traits: FishTraits, dpr: number): BakedArt | null {
  const key = `${fishSilhouetteBakeKey(traits)}|${dpr.toFixed(2)}`;
  const hit = lru.get(key);
  if (hit) return hit;
  const baked = bakeFishSilhouette(Skia, traits, dpr);
  if (baked) lru.set(key, baked, bakeBytes(baked.bounds, dpr));
  return baked;
}
