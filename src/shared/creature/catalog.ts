import { rollFrom } from "@/shared/lib/roll";

import type { SpeciesDef, SpeciesId } from "./types";

/**
 * Unlock tiers deliberately mirror the spread `@/shared/fish/catalog.ts`
 * already uses across its 16 colors (cheapest -> hardest) — a coherent
 * "build a longer habit, unlock a rarer companion" arc, not arbitrary
 * numbers. Molly is the ONLY `default` — the app is titled "Molly"; a
 * first-run snail default would undercut that.
 */
export const SPECIES_DEFS: Record<SpeciesId, SpeciesDef> = {
  molly: {
    id: "molly",
    order: 0,
    name: "Molly",
    description: "The original — 16 colors, its own body/tail/dorsal trait system.",
    rarity: { tier: "common" },
    accentColor: "#f2b53a",
    emoji: "🐟",
    unlock: { type: "default" },
    locomotion: "undulating",
    sizeRatio: 1,
    copy: {
      grownVerb: "made it",
      diedVerb: "didn't survive",
      noun: "molly",
      lifeStageLabels: {
        egg: "An egg rests in the current…",
        fry: "A tiny fry hatched!",
        juvenile: "Growing into a young molly",
        adult: "Almost fully grown — keep going!",
      },
    },
    // Real variants are `@/shared/fish/catalog.ts`'s COLOR_DEFS + the
    // body/tail/dorsal roll — molly keeps its own established system
    // untouched. Every species-dispatch call site branches on
    // `speciesId === "molly"` BEFORE reading `.variants`, so this empty
    // array is never actually read; see `resolveCreature()`.
    variants: [],
  },

  snail: {
    id: "snail",
    order: 1,
    name: "Snail",
    description:
      "Never swims — glides along the substrate, up the glass and over the plants on one muscular foot.",
    rarity: { tier: "common" },
    accentColor: "#8a7355",
    emoji: "🐌",
    unlock: { type: "sessionMinutes", minutes: 25 },
    locomotion: "crawl",
    sizeRatio: 0.68,
    copy: {
      grownVerb: "made it",
      diedVerb: "didn't survive",
      noun: "snail",
      lifeStageLabels: {
        egg: "A speck of shell rests in the current…",
        fry: "A hatchling shell no bigger than a grain of sand!",
        juvenile: "The shell is starting to coil",
        adult: "Almost fully grown — keep going!",
      },
    },
    variants: [
      { id: "garden", name: "Garden", rarity: { tier: "common" }, weight: 60 },
      { id: "mystery", name: "Mystery", rarity: { tier: "uncommon" }, weight: 25 },
      { id: "golden", name: "Golden", rarity: { tier: "rare" }, weight: 12 },
      { id: "opal", name: "Opal", rarity: { tier: "legendary" }, weight: 3 },
    ],
  },

  frog: {
    id: "frog",
    order: 2,
    name: "Frog",
    description: "Round-bodied and big-eyed — rewards a single long, focused sitting.",
    rarity: { tier: "uncommon" },
    accentColor: "#4f9e5c",
    emoji: "🐸",
    unlock: { type: "sessionMinutes", minutes: 50 },
    locomotion: "rigid",
    sizeRatio: 0.7,
    copy: {
      grownVerb: "found its feet",
      diedVerb: "didn't survive",
      noun: "frog",
      lifeStageLabels: {
        egg: "A speck of spawn rests in the current…",
        fry: "A tadpole wriggled free!",
        juvenile: "Growing legs — nearly a froglet",
        adult: "Almost fully grown — keep going!",
      },
    },
    variants: [
      { id: "leaf", name: "Leaf", rarity: { tier: "common" }, weight: 60 },
      { id: "toad", name: "Toad", rarity: { tier: "uncommon" }, weight: 25 },
      { id: "poison", name: "Poison Dart", rarity: { tier: "rare" }, weight: 12 },
      { id: "crystal", name: "Crystal", rarity: { tier: "legendary" }, weight: 3 },
    ],
  },

  turtle: {
    id: "turtle",
    order: 3,
    name: "Turtle",
    description: "A slow, deliberate swimmer with a domed shell — rewards cumulative focus time.",
    rarity: { tier: "rare" },
    accentColor: "#5c7a4a",
    emoji: "🐢",
    unlock: { type: "totalHours", hours: 20 },
    locomotion: "rigid",
    sizeRatio: 0.9,
    copy: {
      grownVerb: "made it",
      diedVerb: "didn't survive",
      noun: "turtle",
      lifeStageLabels: {
        egg: "An egg rests buried in the current…",
        fry: "A hatchling paddled free of its shell!",
        juvenile: "The shell is hardening — nearly grown",
        adult: "Almost fully grown — keep going!",
      },
    },
    variants: [
      { id: "river", name: "River", rarity: { tier: "common" }, weight: 60 },
      { id: "painted", name: "Painted", rarity: { tier: "uncommon" }, weight: 25 },
      { id: "star", name: "Star-Shelled", rarity: { tier: "rare" }, weight: 12 },
      { id: "celestial", name: "Celestial", rarity: { tier: "legendary" }, weight: 3 },
    ],
  },

  axolotl: {
    id: "axolotl",
    order: 4,
    name: "Axolotl",
    description: "Feathery external gills and a gentle undulating swim — rewards a daily habit.",
    rarity: { tier: "epic" },
    accentColor: "#f0a8c4",
    emoji: "🦎",
    unlock: { type: "streakDays", days: 14 },
    locomotion: "undulating",
    sizeRatio: 1.1,
    copy: {
      grownVerb: "made it",
      diedVerb: "didn't survive",
      noun: "axolotl",
      lifeStageLabels: {
        egg: "An egg rests in the current…",
        fry: "A tiny larva hatched, gills already unfurling!",
        juvenile: "The gill fronds are filling out",
        adult: "Almost fully grown — keep going!",
      },
    },
    variants: [
      { id: "leucistic", name: "Leucistic", rarity: { tier: "common" }, weight: 60 },
      { id: "wildtype", name: "Wild Olive", rarity: { tier: "uncommon" }, weight: 25 },
      { id: "golden", name: "Golden Albino", rarity: { tier: "rare" }, weight: 12 },
      { id: "melanoid", name: "Melanoid", rarity: { tier: "legendary" }, weight: 3 },
    ],
  },

  otter: {
    id: "otter",
    order: 5,
    name: "Otter",
    description: "The showcase companion — playful, quick, and the hardest to earn.",
    rarity: { tier: "legendary" },
    accentColor: "#7a5a3a",
    emoji: "🦦",
    unlock: { type: "streakOrGrant", days: 21 },
    locomotion: "rigid",
    sizeRatio: 1.6,
    copy: {
      grownVerb: "made it",
      diedVerb: "didn't survive",
      noun: "otter",
      lifeStageLabels: {
        egg: "A den rests quiet in the current…",
        fry: "A pup opened its eyes for the first time!",
        juvenile: "Learning to swim — nearly grown",
        adult: "Almost fully grown — keep going!",
      },
    },
    variants: [
      { id: "river", name: "River", rarity: { tier: "common" }, weight: 60 },
      { id: "sea", name: "Sea", rarity: { tier: "uncommon" }, weight: 25 },
      { id: "silver", name: "Silver", rarity: { tier: "rare" }, weight: 12 },
      { id: "arctic", name: "Arctic", rarity: { tier: "legendary" }, weight: 3 },
    ],
  },
};

export const SPECIES_LIST: readonly SpeciesDef[] = Object.values(SPECIES_DEFS).sort(
  (a, b) => a.order - b.order,
);

export function getSpeciesDef(id: string): SpeciesDef {
  return SPECIES_DEFS[id as SpeciesId] ?? SPECIES_DEFS.molly;
}

/** Rolled at session completion — the reveal moment, non-molly species only. */
export function rollVariant(species: Exclude<SpeciesId, "molly">): string {
  return rollFrom(SPECIES_DEFS[species].variants);
}

/** The all-common-equivalent for a non-molly species: its lowest-weight-independent, first-listed (common-tier) variant — growing/failed-session/preview default. */
export function standardVariant(species: Exclude<SpeciesId, "molly">): string {
  const variants = SPECIES_DEFS[species].variants;
  return variants[0]?.id ?? "";
}
