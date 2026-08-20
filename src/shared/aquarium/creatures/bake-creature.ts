// The one place that knows which non-molly species have real anatomy vs.
// still fall back to `bake-placeholder.ts`'s rigid blob — `render/
// creature-cache.ts` calls only this, never a per-species bake module
// directly, so shipping a species' real anatomy (Phase C) is a one-line
// change here and nowhere else. Deliberately NOT an exhaustive switch with a
// throwing default (unlike `fish-picture.ts`'s three-backend contract): an
// unbuilt species falling through to the placeholder is the intended,
// documented behaviour, not a bug to catch.

import type { BakedArt } from "@/shared/aquarium/core/bake";
import type { SkiaApi } from "@/shared/aquarium/core/skia-types";

import {
  bakePlaceholderCreature,
  placeholderCreatureBakeKey,
  type CreatureSpeciesId,
} from "./bake-placeholder";
import { bakeAxolotl, axolotlBakeKey } from "./axolotl/bake-creature";
import { bakeFrog, frogBakeKey } from "./frog/bake-creature";
import { bakeOtter, otterBakeKey } from "./otter/bake-creature";
import { bakeSnail, snailBakeKey } from "./snail/bake-creature";
import { bakeTurtle, turtleBakeKey } from "./turtle/bake-creature";

/**
 * Which piece of a species to bake. Only the snail has more than one (see
 * `snail/bake-creature.ts`: its eye stalks sway independently of its body);
 * every other species ignores it and returns its single texture, so callers
 * that do not care never pass it.
 */
export type CreaturePart = "full" | "body" | "tentacles";

export function creatureBakeKey(
  speciesId: CreatureSpeciesId,
  variant: string,
  part: CreaturePart = "full",
): string {
  switch (speciesId) {
    case "snail":
      return snailBakeKey(variant, part);
    case "frog":
      return frogBakeKey(variant);
    case "turtle":
      return turtleBakeKey(variant);
    case "axolotl":
      return axolotlBakeKey(variant);
    case "otter":
      return otterBakeKey(variant);
    default:
      return placeholderCreatureBakeKey(speciesId, variant);
  }
}

export function bakeCreature(
  Skia: SkiaApi,
  speciesId: CreatureSpeciesId,
  variant: string,
  dpr: number,
  part: CreaturePart = "full",
): BakedArt | null {
  switch (speciesId) {
    case "snail":
      return bakeSnail(Skia, variant, dpr, part);
    case "frog":
      return bakeFrog(Skia, variant, dpr);
    case "turtle":
      return bakeTurtle(Skia, variant, dpr);
    case "axolotl":
      return bakeAxolotl(Skia, variant, dpr);
    case "otter":
      return bakeOtter(Skia, variant, dpr);
    default:
      return bakePlaceholderCreature(Skia, speciesId, variant, dpr);
  }
}
