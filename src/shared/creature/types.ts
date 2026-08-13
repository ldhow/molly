// The species axis — a thin layer ABOVE `@/shared/fish/{types,catalog}`, not a
// replacement of it. Molly stays exactly what it always was (16 colors x
// body/tail/dorsal, `FishTraits`, `COLOR_DEFS`); this module adds five more
// SPECIES a session can grow, each with its own much smaller "variant" list
// (a coat/coloring, not a 4-axis trait system — see `SpeciesDef.variants`).
//
// Reuses `Rarity`/`UnlockRule`/`RollableDef` from `@/shared/lib/roll.ts` (the
// same generic pieces `@/shared/fish/types.ts` re-exports) rather than
// duplicating them — a species' unlock rule and a color's unlock rule are the
// exact same union, evaluated the exact same way against session history.

import type { LifeStage } from "@/shared/fish/types";
import type { Rarity, RollableDef, UnlockRule } from "@/shared/lib/roll";

export type SpeciesId = "molly" | "otter" | "turtle" | "frog" | "axolotl" | "snail";

/** Whether this species' swim-bend animation runs the spine-warp shader (an elongated body that undulates) or renders rigid (legs/shell — swim-transformed, not body-bent). See `fish/spine.ts`'s header for what the warp actually does. */
export type Locomotion = "undulating" | "rigid";

export interface SpeciesCopy {
  /** "made it" / "found its feet" — completes "Your {noun} {grownVerb}!" */
  grownVerb: string;
  /** "didn't survive" / "couldn't hold on" — completes "Your {noun} {diedVerb}." */
  diedVerb: string;
  /** Lowercase, for mid-sentence use: "Your otter…", "a healthy tiger frog…" */
  noun: string;
  /**
   * FULL sentences per life stage, mirroring `session-screen.tsx`'s existing
   * `STAGE_LABEL` shape ("An egg rests in the current…") — not just a noun
   * substitution, since the copy varies in structure per species, not only
   * in the creature word.
   */
  lifeStageLabels: Record<LifeStage, string>;
}

export interface SpeciesDef {
  id: SpeciesId;
  /** Unlock sequence & Creaturedex order (1-based), independent of ColorDef's own `order`. */
  order: number;
  name: string;
  description: string;
  rarity: Rarity;
  /** UI chips/badges — not creature rendering. */
  accentColor: string;
  /** Stand-in outcome icon for surfaces without real creature art yet (stats history, notifications). */
  emoji: string;
  unlock: UnlockRule;
  locomotion: Locomotion;
  /** Render scale relative to molly's baseline (1) — feeds `AQUARIUM_FISH_SCALE`-equivalent render scale, bake DPR budget, and swim-speed tuning together, not independently. */
  sizeRatio: number;
  copy: SpeciesCopy;
  /**
   * This species' own small coat/coloring list — NOT a 4-axis trait system
   * like molly's. Never individually unlock-gated (same "never locked, just
   * rolled" rule molly's body/tail/dorsal already follow) — one entry should
   * carry a deliberately low `weight` as a "chase" variant so the species
   * doesn't read as fully seen after ~4 sessions; see `catalog.ts`.
   */
  variants: readonly RollableDef<string>[];
}

/** A concrete non-molly creature: which species, which rolled variant. Molly keeps using `FishTraits` — this is the OTHER five species' equivalent. */
export interface CreatureTraits {
  species: Exclude<SpeciesId, "molly">;
  variant: string;
  patternSeed?: number;
}
