import type { SessionRow } from "@/db/schema";

/** Perf cap — the Skia tank never bakes/renders more than this many fish. */
export const TANK_CAPACITY = 12;

export const DEAD_FISH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A corpse whose 24h TTL has elapsed is treated as archived even if its
 * `in_tank` flag is still 1 — this is what lets a slot free itself without a
 * write, so the next completed session can auto-join the tank.
 */
export function isVisibleInTank(row: SessionRow, now: number): boolean {
  if (row.inTank !== 1) return false;
  if (row.outcome === "completed") return true;
  return now - row.endedAt < DEAD_FISH_TTL_MS;
}

export function classifyFish(
  rows: SessionRow[],
  now: number,
): { inTank: SessionRow[]; holding: SessionRow[] } {
  const inTank = rows.filter((r) => isVisibleInTank(r, now));
  const holding = rows.filter((r) => !isVisibleInTank(r, now));
  return { inTank, holding };
}
