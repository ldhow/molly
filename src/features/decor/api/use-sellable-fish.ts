import { useMemo } from "react";

import type { SessionRow } from "@/db/schema";
import { isSellable, sellPriceOf } from "@/shared/economy/pricing";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";
import { isSold } from "@/shared/lib/tank-membership";

export interface SellableEntry {
  row: SessionRow;
  price: number;
}

/**
 * Caches one `{row, price}` wrapper per row OBJECT (not per id). `sellPriceOf`
 * is a pure function of the row's own fields, so as long as the row
 * reference is unchanged — true for every fish except the one just sold or
 * bought, since `use-sell-fish-mutation.ts`'s optimistic `.map()` returns the
 * SAME reference for every non-matching row — reusing the cached wrapper
 * here keeps `entry` referentially stable across a mutation. That's what
 * lets `React.memo(SellFishCard)`/`memo(FishTile)` actually skip re-rendering
 * (and re-drawing their Skia preview) for every fish except the one that
 * changed, instead of the whole list re-rendering on every sale.
 */
const entryCache = new WeakMap<SessionRow, SellableEntry>();
function entryFor(row: SessionRow): SellableEntry {
  const cached = entryCache.get(row);
  if (cached) return cached;
  const entry: SellableEntry = { row, price: sellPriceOf(row) };
  entryCache.set(row, entry);
  return entry;
}

/** Every owned fish (tank + holding tank), split into sellable (completed,
 *  not already sold) vs. not (dead, or already sold). */
export function useSellableFish() {
  const { data: rows, isLoading } = useSessionsQuery();

  return useMemo(() => {
    const owned = (rows ?? []).filter((r) => !isSold(r));
    const sellable: SellableEntry[] = [];
    const unsellable: SessionRow[] = [];
    for (const row of owned) {
      if (isSellable(row)) {
        sellable.push(entryFor(row));
      } else {
        unsellable.push(row);
      }
    }
    return { sellable, unsellable, isLoading };
  }, [rows, isLoading]);
}
