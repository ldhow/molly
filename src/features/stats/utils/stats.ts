import type { SessionRow } from "@/db/schema";
import { addDays, toLocalDate } from "@/shared/lib/dates";
import {
  completedOf,
  computeBestStreak,
  computeCurrentStreak,
  totalCompletedMinutes,
} from "@/shared/lib/sessions";

export interface DayBar {
  date: string;
  /** Single-letter weekday label. */
  label: string;
  minutes: number;
}

export interface StatsSummary {
  todayMinutes: number;
  weekMinutes: number;
  currentStreak: number;
  bestStreak: number;
  totalSessions: number;
  totalCompletedMinutes: number;
  last7: DayBar[];
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export function computeStats(rows: SessionRow[], now: number): StatsSummary {
  const completed = completedOf(rows);
  const minutesByDate = new Map<string, number>();
  for (const row of completed) {
    minutesByDate.set(row.localDate, (minutesByDate.get(row.localDate) ?? 0) + row.plannedMinutes);
  }

  const today = toLocalDate(now);
  const last7: DayBar[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const [y, m, d] = date.split("-").map(Number);
    last7.push({
      date,
      label: WEEKDAY_LETTERS[new Date(y, m - 1, d).getDay()],
      minutes: minutesByDate.get(date) ?? 0,
    });
  }

  return {
    todayMinutes: minutesByDate.get(today) ?? 0,
    weekMinutes: last7.reduce((sum, day) => sum + day.minutes, 0),
    currentStreak: computeCurrentStreak(rows, now),
    bestStreak: computeBestStreak(rows),
    totalSessions: rows.length,
    totalCompletedMinutes: totalCompletedMinutes(rows),
    last7,
  };
}
