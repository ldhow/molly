import type { SessionRow } from "@/db/schema";
import {
  computeBestStreak,
  longestCompletedSessionMinutes,
  totalCompletedMinutes,
} from "@/shared/lib/sessions";

import { COLOR_DEFS } from "./catalog";
import type { ColorDef, ColorId, UnlockRule } from "./types";

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

export function unlockHint(rule: UnlockRule): string {
  switch (rule.type) {
    case "default":
      return "Available from the start";
    case "sessionMinutes":
      return `Complete a single ${rule.minutes}-minute focus session`;
    case "totalHours":
      return `Accumulate ${rule.hours} hours of completed focus`;
    case "streakDays":
      return `Reach a ${rule.days}-day focus streak`;
    case "streakOrGrant":
      return `Reach a ${rule.days}-day focus streak — or a special event`;
  }
}
