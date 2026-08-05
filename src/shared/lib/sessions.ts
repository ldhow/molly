import type { SessionRow } from "@/db/schema";

import { addDays, toLocalDate } from "./dates";

export function completedOf(rows: SessionRow[]): SessionRow[] {
  return rows.filter((r) => r.outcome === "completed");
}

/** Unique local dates that have at least one completed session. */
export function completedDates(rows: SessionRow[]): Set<string> {
  return new Set(completedOf(rows).map((r) => r.localDate));
}

/** Consecutive days ending today (or yesterday, if today has none yet). */
export function computeCurrentStreak(rows: SessionRow[], now: number): number {
  const dates = completedDates(rows);
  const today = toLocalDate(now);
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive completed days, ever. */
export function computeBestStreak(rows: SessionRow[]): number {
  const dates = [...completedDates(rows)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of dates) {
    run = prev !== null && addDays(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return best;
}

export function totalCompletedMinutes(rows: SessionRow[]): number {
  return completedOf(rows).reduce((sum, r) => sum + r.plannedMinutes, 0);
}

export function longestCompletedSessionMinutes(rows: SessionRow[]): number {
  return completedOf(rows).reduce((max, r) => Math.max(max, r.plannedMinutes), 0);
}
