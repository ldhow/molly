export type RarityTier = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface Rarity {
  tier: RarityTier;
  /** Sub-tier within rare/epic, shown as ★s (e.g. Epic ★★★). */
  stars?: 1 | 2 | 3;
}

export type UnlockRule =
  | { type: "default" }
  | { type: "sessionMinutes"; minutes: number }
  | { type: "totalHours"; hours: number }
  | { type: "streakDays"; days: number }
  /** Streak OR a manual grant (dev/event stand-in). */
  | { type: "streakOrGrant"; days: number };

export interface RollableDef<Id extends string> {
  id: Id;
  name: string;
  rarity: Rarity;
  /** Relative roll weight within its axis. */
  weight: number;
}

/** Weighted random pick — the one roll algorithm every trait/variant axis uses. */
export function rollFrom<Id extends string>(defs: readonly RollableDef<Id>[]): Id {
  const total = defs.reduce((sum, d) => sum + d.weight, 0);
  let ticket = Math.random() * total;
  for (const def of defs) {
    ticket -= def.weight;
    if (ticket < 0) return def.id;
  }
  return defs[0].id;
}

/** Human-readable unlock condition — shared by every unlockable axis (colors, species, ...). */
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
