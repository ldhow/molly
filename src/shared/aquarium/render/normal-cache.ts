// React-side cache for `fish/normal-map.ts`'s body normal field, next to
// `fish-cache.ts` and playing the same role for the relight pass that that
// file plays for the albedo bake.
//
// A PLAIN MAP, NOT AN LRU — the one place in this tree where that's the right
// call. `normalMapKey` is `body|stage`, so the key space is exactly
// `2 x 4 = 8` entries and it is bounded by the type system rather than by a
// budget. At `NORMAL_PX_PER_UNIT` the whole set is well under a megabyte, and
// the fish that share a map are precisely the fish most likely to be on screen
// together, so an eviction policy could only ever throw away something it was
// about to be asked for again.

import { Skia } from "@shopify/react-native-skia";

import type { BakedArt } from "@/shared/aquarium/core/bake";
import { axolotlVolume } from "@/shared/aquarium/creatures/axolotl/normal-map";
import { bakeBodyNormalMap, bakeNormalMap, normalMapKey } from "@/shared/aquarium/fish/normal-map";
import type { FishTraits, LifeStage } from "@/shared/fish/types";

/** `null` memoises a Skia allocation failure so a broken device retries once, not every frame. */
const cache = new Map<string, BakedArt | null>();

/**
 * The body normal map for this fish's shape and life stage, or null if there
 * isn't one. Callers must treat null as "draw with the relight gains at zero"
 * rather than as a failure to draw — see `fish-layer.tsx`.
 *
 * Null happens two ways: Skia refused the allocation, or the stage is `egg`.
 * An egg is not a body — `bake-fish.ts` routes it to `buildEggAquariumSpec`,
 * an entirely different silhouette — so a body normal field would be
 * registered against the wrong shape and light a fish that isn't there.
 */
export function getCachedNormalMap(traits: FishTraits, stage: LifeStage): BakedArt | null {
  if (stage === "egg") return null;
  const key = normalMapKey(traits, stage);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const baked = bakeBodyNormalMap(Skia, traits, stage);
  cache.set(key, baked);
  return baked;
}

/**
 * The axolotl's map — one for the whole species, since its body is
 * variant-blind and creatures have no life-stage squish. It is the only
 * non-molly species with one; see `creatures/axolotl/normal-map.ts` for why
 * the other four can't simply be added here.
 */
export function getCachedAxolotlNormalMap(): BakedArt | null {
  const key = "axolotl";
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const baked = bakeNormalMap(Skia, axolotlVolume());
  cache.set(key, baked);
  return baked;
}
