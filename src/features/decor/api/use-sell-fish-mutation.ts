import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { useCallback, useState } from "react";

import { db } from "@/db/client";
import { sessions, type SessionRow } from "@/db/schema";
import { isSellable, sellPriceOf } from "@/shared/economy/pricing";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { afterPaint, yieldToUI } from "@/shared/lib/yield-to-ui";

interface SellContext {
  previous: SessionRow[] | undefined;
}

/** Stable empty initial state — a fresh `new Set()` per render would be a new reference every time. */
const NO_IDS: ReadonlySet<string> = new Set();

export interface SellFishController {
  /** Call this on confirm. Hides the fish immediately, then persists it. */
  sell: (id: string) => void;
  /**
   * Fish already sold in this screen's lifetime but not yet reflected in the
   * `["sessions"]` cache. The Sell list MUST filter these out — that filter is
   * the thing that makes a sale look instant (see the hook's doc below).
   */
  hiddenIds: ReadonlySet<string>;
}

/**
 * Sells a fish for coins — permanent, one-way. Re-reads the row inside the
 * transaction rather than trusting whatever `SessionRow` the caller already
 * has: a double-tapped Sell button (or a stale screen) must not sell the
 * same fish twice for two payouts. `soldAt !== null` already is a silent
 * no-op, mirroring `useSettleSession`'s first-caller-wins contract.
 *
 * ## Why a sale is a three-phase, not one-phase, update
 *
 * Writing the sale optimistically into `["sessions"]` and letting the list
 * re-derive from that is the obvious design, and it was the slow one. That
 * query key is read by nearly every mounted screen at once — the Tank's Skia
 * aquarium (`useOwnedFish`), the Fishdex, Stats, the coin chip — and the Sell
 * screen is PUSHED OVER those, so they are all still mounted and all still
 * subscribed. React batches the tick into one commit, so the one row leaving
 * this FlatList could not paint until every one of those screens had finished
 * re-rendering too. The sale was cheap; being billed for the whole app's
 * re-render at the same moment is what read as a 1-2s lag.
 *
 * So the three phases, cheapest first:
 *
 * 1. `sell()` adds the id to `hiddenIds` — LOCAL state, so only the Sell
 *    screen re-renders. It filters the fish out and paints on the next frame.
 *    Nothing else in the app is subscribed to this, so nothing else can slow
 *    it down.
 * 2. `afterPaint` → `onMutate` writes the real sale into the query cache.
 *    Every other screen re-renders here, off the critical path, with the
 *    removal already on screen. `hiddenIds` is now redundant (`isSellable` is
 *    false for a sold row) and stays only as a rollback record.
 * 3. `mutationFn` opens with `yieldToUI()` so phase 2's re-render paints
 *    before drizzle's SYNCHRONOUS expo-sqlite transaction blocks the thread.
 *
 * Deliberately does NOT invalidate on success: `sellPriceOf`/`isSellable`
 * are pure functions of the row's already-known fields, so the optimistic
 * write above is byte-identical to what the transaction persists — an
 * invalidate-triggered refetch would just replace every row with a
 * fresh-but-identical object (`db.select()` never returns the same
 * reference twice), which is exactly what was making the whole list flash
 * and re-render on every sale. `onError` rolls back BOTH the cache snapshot
 * and `hiddenIds`, so a failed sale puts the fish back rather than leaving a
 * hole. Real drift (a second device, a manual DB edit) still heals on the
 * next natural refetch — app-foreground refetch is already wired in
 * AppProviders.
 */
export function useSellFishMutation(): SellFishController {
  const queryClient = useQueryClient();
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(NO_IDS);

  const { mutate } = useMutation<void, unknown, string, SellContext>({
    meta: { errorMessage: "Couldn't sell that fish." },
    mutationFn: async (id: string) => {
      await yieldToUI();
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(sessions).where(eq(sessions.id, id));
        if (!row || !isSellable(row)) return;
        await tx
          .update(sessions)
          .set({ soldAt: Date.now(), soldPrice: sellPriceOf(row), inTank: 0 })
          .where(eq(sessions.id, id));
      });
    },
    onMutate: (id) => {
      const previous = queryClient.getQueryData<SessionRow[]>(SESSIONS_QUERY_KEY);
      const now = Date.now();
      queryClient.setQueryData<SessionRow[]>(SESSIONS_QUERY_KEY, (rows) =>
        rows?.map((row) =>
          row.id === id && isSellable(row)
            ? { ...row, soldAt: now, soldPrice: sellPriceOf(row), inTank: 0 }
            : row,
        ),
      );
      return { previous };
    },
    onError: (_err, id, context) => {
      if (context?.previous) queryClient.setQueryData(SESSIONS_QUERY_KEY, context.previous);
      setHiddenIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  });

  // `mutate` is stable for the life of the hook (React Query binds it once on
  // the observer), so this callback is too — which is what lets the screen
  // hand one `onSell` to every card and keep `memo(SellFishCard)` effective.
  const sell = useCallback(
    (id: string) => {
      setHiddenIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      afterPaint(() => mutate(id));
    },
    [mutate],
  );

  return { sell, hiddenIds };
}
