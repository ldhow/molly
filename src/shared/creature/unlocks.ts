import type { SessionRow } from "@/db/schema";
import {
  computeBestStreak,
  longestCompletedSessionMinutes,
  totalCompletedMinutes,
} from "@/shared/lib/sessions";

import { SPECIES_LIST } from "./catalog";
import type { SpeciesDef, SpeciesId } from "./types";

/**
 * Species unlock by progression, exactly like colors do
 * (`@/shared/fish/unlocks.ts::isColorUnlocked`) — same `UnlockRule` union,
 * same session-history predicates. Variants within an unlocked species are
 * never individually locked, same "rolled and collected" rule molly's
 * body/tail/dorsal already follow.
 */
export function isSpeciesUnlocked(
  def: SpeciesDef,
  rows: SessionRow[],
  grantedSpecies: readonly string[] = [],
): boolean {
  const rule = def.unlock;
  switch (rule.type) {
    case "default":
      return true;
    case "sessionMinutes":
      return longestCompletedSessionMinutes(rows) >= rule.minutes;
    case "totalHours":
      return totalCompletedMinutes(rows) >= rule.hours * 60;
    case "streakDays":
      return computeBestStreak(rows) >= rule.days;
    case "streakOrGrant":
      return computeBestStreak(rows) >= rule.days || grantedSpecies.includes(def.id);
  }
}

export function unlockedSpeciesIds(
  rows: SessionRow[],
  grantedSpecies: readonly string[] = [],
): SpeciesId[] {
  return SPECIES_LIST.filter((def) => isSpeciesUnlocked(def, rows, grantedSpecies)).map(
    (def) => def.id,
  );
}
