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

import { bakedImageSource, type BakedImageSource } from "./baked-uri";

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

/** Identity of an encoded fish preview. Exported so a caller can check the cache (`peekBakedSource`) before committing to the bake+encode behind it. */
export function fishSourceKey(traits: FishTraits, stage: LifeStage, dpr: number): string {
  return `fish|${fishBakeKey(traits, stage)}|${dpr.toFixed(2)}`;
}

/** Namespaced apart from `fishSourceKey` — the two bake-key vocabularies are different but share one URI cache. */
export function fishSilhouetteSourceKey(traits: FishTraits, dpr: number): string {
  return `fishsil|${fishSilhouetteBakeKey(traits)}|${dpr.toFixed(2)}`;
}

/** The same bake as `getCachedFish`, encoded for a plain `<Image>` — see `baked-uri.ts` for why a static tile shouldn't own a Skia `<Canvas>`. */
export function getCachedFishSource(
  traits: FishTraits,
  stage: LifeStage,
  dpr: number,
): BakedImageSource | null {
  const baked = getCachedFish(traits, stage, dpr);
  if (!baked) return null;
  return bakedImageSource(fishSourceKey(traits, stage, dpr), baked);
}

/** `getCachedFishSilhouette`'s encoded twin. */
export function getCachedFishSilhouetteSource(
  traits: FishTraits,
  dpr: number,
): BakedImageSource | null {
  const baked = getCachedFishSilhouette(traits, dpr);
  if (!baked) return null;
  return bakedImageSource(fishSilhouetteSourceKey(traits, dpr), baked);
}
