import type { SessionRow } from "@/db/schema";
import { getSpeciesDef } from "@/shared/creature/catalog";
import { speciesOfRow } from "@/shared/creature/resolve";
import type { SpeciesId } from "@/shared/creature/types";

/** Perf cap — the Skia tank never bakes/renders more than this many SLOT-CONSUMING fish (see `occupiesTankSlot`). */
export const TANK_CAPACITY = 12;

export const DEAD_FISH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this species counts against `TANK_CAPACITY`.
 *
 * Crawlers — snail and shrimp — do NOT. The cap exists to bound how many
 * individuals are steered and drawn as free-swimming bodies in open water,
 * and a `locomotion: "crawl"` species isn't one: `sim/crawl.ts` binds it to a
 * surface, so it stays out of the swimming population's way both visually and
 * in the sim. It also matches how a real tank is stocked — a cleanup crew
 * doesn't come out of your fish budget.
 *
 * Keyed on LOCOMOTION rather than an id list so a future crawler is free by
 * construction, and so this can never disagree with which renderer a species
 * actually uses (`render/creature-layer.tsx` branches on the same field).
 */
export function speciesOccupiesTankSlot(speciesId: SpeciesId): boolean {
  return getSpeciesDef(speciesId).locomotion !== "crawl";
}

export function occupiesTankSlot(row: SessionRow): boolean {
  return speciesOccupiesTankSlot(speciesOfRow(row));
}

/** How many of `TANK_CAPACITY`'s slots these rows actually consume — NOT `rows.length`, since crawlers are free. */
export function tankSlotsUsed(rows: SessionRow[]): number {
  let used = 0;
  for (const row of rows) if (occupiesTankSlot(row)) used++;
  return used;
}

/** Whether a slot-consuming individual could still join `inTank`. A crawler can always join regardless of this. */
export function tankHasRoom(inTank: SessionRow[]): boolean {
  return tankSlotsUsed(inTank) < TANK_CAPACITY;
}

/** Whether `speciesId` may join a tank currently holding `inTank` — free for crawlers, capacity-gated for everyone else. */
export function canJoinTank(inTank: SessionRow[], speciesId: SpeciesId): boolean {
  return !speciesOccupiesTankSlot(speciesId) || tankHasRoom(inTank);
}

/** Sold fish are gone for good — the row survives (Fishdex, stats), but it's
 *  neither in the tank nor in the Holding Tank. */
export function isSold(row: SessionRow): boolean {
  return row.soldAt !== null;
}

/**
 * A corpse whose 24h TTL has elapsed is treated as archived even if its
 * `in_tank` flag is still 1 — this is what lets a slot free itself without a
 * write, so the next completed session can auto-join the tank.
 */
export function isVisibleInTank(row: SessionRow, now: number): boolean {
  if (isSold(row)) return false;
  if (row.inTank !== 1) return false;
  if (row.outcome === "completed") return true;
  return now - row.endedAt < DEAD_FISH_TTL_MS;
}

export function classifyFish(
  rows: SessionRow[],
  now: number,
): { inTank: SessionRow[]; holding: SessionRow[]; sold: SessionRow[] } {
  const sold = rows.filter(isSold);
  const rest = rows.filter((r) => !isSold(r));
  const inTank = rest.filter((r) => isVisibleInTank(r, now));
  const holding = rest.filter((r) => !isVisibleInTank(r, now));
  return { inTank, holding, sold };
}
