import { useCallback, useMemo, useState } from "react";

import {
  generateBreedRecipe,
  generatedColorId,
  rollGeneratedSeed,
  seedOfGeneratedId,
  type BreedRecipe,
} from "@/shared/fish/generated-breed";
import type { BodyId, DorsalId, FishTraits, LifeStage, TailId } from "@/shared/fish/types";
import { PATTERN_SEED_BUCKETS } from "@/shared/fish/catalog";
import { useGeneratedBreedsStore } from "@/shared/store/generated-breeds-store";

/**
 * Twelve rather than "as many as fit": each preview is a real bake, and
 * `render/fish-cache.ts` holds roughly 20 adult textures inside its 24MB
 * budget. Rolling much wider than that just evicts the previous roll before
 * it can be compared against the new one.
 */
export const BATCH_SIZE = 12;

export function useBreedLab() {
  const [seeds, setSeeds] = useState<number[]>(() =>
    Array.from({ length: BATCH_SIZE }, () => rollGeneratedSeed()),
  );
  const [heroSeed, setHeroSeed] = useState<number>(() => seeds[0]);
  const [stage, setStage] = useState<LifeStage>("adult");
  const [body, setBody] = useState<BodyId>("standard");
  const [tail, setTail] = useState<TailId>("round");
  const [dorsal, setDorsal] = useState<DorsalId>("standard");
  const [patternSeed, setPatternSeed] = useState(0);

  const savedMap = useGeneratedBreedsStore((s) => s.breeds);
  const saveBreed = useGeneratedBreedsStore((s) => s.saveBreed);
  const removeBreed = useGeneratedBreedsStore((s) => s.removeBreed);

  const rollBatch = useCallback(() => {
    const next = Array.from({ length: BATCH_SIZE }, () => rollGeneratedSeed());
    setSeeds(next);
    setHeroSeed(next[0]);
  }, []);

  const rollOne = useCallback(() => {
    const seed = rollGeneratedSeed();
    setSeeds((prev) => [seed, ...prev].slice(0, BATCH_SIZE));
    setHeroSeed(seed);
  }, []);

  /** Accepts a pasted `gen:xxx` id (from the preview gallery) or a raw decimal seed. */
  const focusSeedInput = useCallback((raw: string) => {
    const text = raw.trim();
    const fromId = seedOfGeneratedId(text);
    const seed = fromId ?? (/^\d+$/.test(text) ? Number(text) >>> 0 : null);
    if (seed === null) return false;
    setSeeds((prev) => [seed, ...prev.filter((s) => s !== seed)].slice(0, BATCH_SIZE));
    setHeroSeed(seed);
    return true;
  }, []);

  const traitsFor = useCallback(
    (seed: number): FishTraits => ({
      color: generatedColorId(seed),
      body,
      tail,
      dorsal,
      patternSeed,
    }),
    [body, tail, dorsal, patternSeed],
  );

  const rolled = useMemo(() => seeds.map((seed) => generateBreedRecipe(seed)), [seeds]);
  const saved = useMemo<BreedRecipe[]>(() => Object.values(savedMap), [savedMap]);
  const heroRecipe = useMemo(() => generateBreedRecipe(heroSeed), [heroSeed]);

  const toggleSave = useCallback(
    (recipe: BreedRecipe) => {
      if (savedMap[recipe.id]) removeBreed(recipe.id);
      else saveBreed(recipe);
    },
    [savedMap, saveBreed, removeBreed],
  );

  return {
    rolled,
    saved,
    savedMap,
    heroSeed,
    heroRecipe,
    stage,
    body,
    tail,
    dorsal,
    patternSeed,
    patternSeedBuckets: PATTERN_SEED_BUCKETS,
    rollBatch,
    rollOne,
    focusSeedInput,
    setHeroSeed,
    setStage,
    setBody,
    setTail,
    setDorsal,
    setPatternSeed,
    traitsFor,
    toggleSave,
  };
}
