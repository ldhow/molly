import type { SessionRow } from "@/db/schema";
import {
  computeBestStreak,
  longestCompletedSessionMinutes,
  totalCompletedMinutes,
} from "@/shared/lib/sessions";

import { FISH_VARIANTS } from "./variants";
import type { FishVariant, UnlockRule, VariantId } from "./types";

export function isUnlocked(variant: FishVariant, rows: SessionRow[]): boolean {
  const rule = variant.unlock;
  switch (rule.type) {
    case "default":
      return true;
    case "sessionMinutes":
      return longestCompletedSessionMinutes(rows) >= rule.minutes;
    case "streakDays":
      return computeBestStreak(rows) >= rule.days;
    case "totalHours":
      return totalCompletedMinutes(rows) >= rule.hours * 60;
  }
}

export function unlockedVariantIds(rows: SessionRow[]): VariantId[] {
  return FISH_VARIANTS.filter((v) => isUnlocked(v, rows)).map((v) => v.id);
}

export function unlockHint(rule: UnlockRule): string {
  switch (rule.type) {
    case "default":
      return "Available from the start";
    case "sessionMinutes":
      return `Complete a single ${rule.minutes}-minute focus session`;
    case "streakDays":
      return `Reach a ${rule.days}-day focus streak`;
    case "totalHours":
      return `Accumulate ${rule.hours} hours of completed focus`;
  }
}
