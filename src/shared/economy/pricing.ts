// Sale pricing for fish — the only source of coins (`coins.ts` derives the
// balance from prices already paid out, recorded at sale time on the row
// itself; see `db/schema.ts`'s `soldPrice` doc for why it isn't recomputed
// here at read time).
//
// Dependency-free beyond the fish/creature catalogs and `SessionRow`'s type —
// no DB client, no React. Runs under plain Node so a verify script can assert
// on it (see `scripts/verify-economy.ts`).

import type { SessionRow } from "@/db/schema";
import { getSpeciesDef } from "@/shared/creature/catalog";
import { resolveCreature } from "@/shared/creature/resolve";
import { BODY_DEFS, DORSAL_DEFS, getColorDef, TAIL_DEFS } from "@/shared/fish/catalog";
import type { RarityTier } from "@/shared/lib/roll";

const TIER_RANK: Record<RarityTier, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

function maxTier(a: RarityTier, b: RarityTier): RarityTier {
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

export const COINS_PER_MINUTE = 1;

/** The axis the user CHOSE — colour for molly, species for everyone else.
 *  Since `MIN_MINUTES_BY_TIER` (`shared/lib/roll.ts`) gates a pick behind a
 *  minimum session length, this is the main price driver: rarity here always
 *  correlates with a longer session, on purpose. */
export const RARITY_MULTIPLIER: Record<RarityTier, number> = {
  common: 1,
  uncommon: 1.5,
  rare: 2.5,
  epic: 4,
  legendary: 7,
};

/** The axis the ROLL produced — molly's body/tail/dorsal, or the variant.
 *  A bonus, never the main term: it's luck, not effort, so it can't carry
 *  the price the way the picked axis does. */
export const ROLL_BONUS: Record<RarityTier, number> = {
  common: 1,
  uncommon: 1.15,
  rare: 1.35,
  epic: 1.6,
  legendary: 2,
};

/** The rarity of the axis the user picked before the session started. */
export function pickedTierOf(row: SessionRow): RarityTier {
  const creature = resolveCreature(row);
  if (creature.speciesId === "molly") {
    return getColorDef(creature.traits.color).rarity.tier;
  }
  return getSpeciesDef(creature.speciesId).rarity.tier;
}

/** The rarity of whatever the roll at settle produced. */
export function rolledTierOf(row: SessionRow): RarityTier {
  const creature = resolveCreature(row);
  if (creature.speciesId === "molly") {
    const { body, tail, dorsal } = creature.traits;
    const bodyTier = BODY_DEFS.find((d) => d.id === body)?.rarity.tier ?? "common";
    const tailTier = TAIL_DEFS.find((d) => d.id === tail)?.rarity.tier ?? "common";
    const dorsalTier = DORSAL_DEFS.find((d) => d.id === dorsal)?.rarity.tier ?? "common";
    return maxTier(maxTier(bodyTier, tailTier), dorsalTier);
  }
  const def = getSpeciesDef(creature.speciesId);
  return def.variants.find((v) => v.id === creature.variant)?.rarity.tier ?? "common";
}

/** A fish is sellable only if it lived and hasn't already been sold —
 *  dead fish are worthless, and selling is permanent (one-way). */
export function isSellable(row: SessionRow): boolean {
  return row.outcome === "completed" && row.soldAt === null;
}

export function sellPriceOf(row: SessionRow): number {
  const price =
    row.plannedMinutes *
    COINS_PER_MINUTE *
    RARITY_MULTIPLIER[pickedTierOf(row)] *
    ROLL_BONUS[rolledTierOf(row)];
  return Math.max(1, Math.round(price));
}
