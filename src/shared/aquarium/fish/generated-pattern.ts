// The rich half of the generated-breed projection pair.
//
// `catalog.ts` hands out a DOWNGRADED def for a `gen:` id — its pattern is a
// legal `FishPattern`, so the legacy renderer and the 3D skin bake can draw
// it. This renderer can draw more than that, so it re-reads the breed's own
// recipe and puts `bands` / `blossom` / clustered `speckle` back.
//
// Why the recipe declares its pattern union in `@/shared/fish/generated-breed`
// rather than importing `AquariumPattern` from here: that module sits BELOW
// this tree (`catalog.ts` imports it), so the dependency can only point one
// way. `_assignable` below is the guard that keeps the two declarations
// honest — the moment either grows a member the other lacks, this file stops
// compiling, instead of a pattern silently falling through `patternPrimitives`
// at runtime.

import type { BreedRecipe, GeneratedPattern } from "@/shared/fish/generated-breed";

import type { AquariumPattern } from "./pattern-defs";

/** Compile-time bridge — a type error the moment the two vocabularies drift. */
const _assignable: (p: GeneratedPattern) => AquariumPattern = (p) => p;
void _assignable;

export function aquariumPatternOf(recipe: BreedRecipe): AquariumPattern {
  return recipe.pattern;
}
