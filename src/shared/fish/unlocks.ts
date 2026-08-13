import type { SessionRow } from "@/db/schema";
import {
  computeBestStreak,
  longestCompletedSessionMinutes,
  totalCompletedMinutes,
} from "@/shared/lib/sessions";

import { COLOR_DEFS } from "./catalog";
import type { ColorDef, ColorId } from "./types";

// `unlockHint` is fully generic over `UnlockRule` (colors, species, any future
// unlockable axis) — defined once in `@/shared/lib/roll.ts`, re-exported here
// so every existing `@/shared/fish/unlocks` import keeps working unchanged.
export { unlockHint } from "@/shared/lib/roll";

/**
 * Colors unlock by progression; body/tail/dorsal traits are never locked —
 * they're rolled at session completion and "collected" once owned.
 */
export function isColorUnlocked(
  def: ColorDef,
  rows: SessionRow[],
  grantedColors: readonly string[] = [],
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
      return computeBestStreak(rows) >= rule.days || grantedColors.includes(def.id);
  }
}

export function unlockedColorIds(
  rows: SessionRow[],
  grantedColors: readonly string[] = [],
): ColorId[] {
  return COLOR_DEFS.filter((def) => isColorUnlocked(def, rows, grantedColors)).map((def) => def.id);
}
