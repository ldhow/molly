import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { decorItems, sessions, type DecorItemRow } from "@/db/schema";
import { autoPlaceXFraction } from "@/shared/decor/auto-place";
import { getDecorDef } from "@/shared/decor/catalog";
import { coinBalance } from "@/shared/economy/coins";
import { DECOR_QUERY_KEY } from "@/shared/hooks/use-decor-query";
import { createId } from "@/shared/lib/id";
import { yieldToUI } from "@/shared/lib/yield-to-ui";

/** Built once by the caller (`useOwnedDecor`'s current rows are in scope
 *  there) — NOT inside the mutation — so the exact same row/id is what goes
 *  into the optimistic cache write AND what the transaction persists. Two
 *  separately-`createId()`'d rows would desync the cache from the DB the
 *  moment a periodic refetch (app foreground, 30s staleTime) replaced the
 *  optimistic id with the real one — a delayed version of the same
 *  full-list flash `use-sell-fish-mutation.ts` documents avoiding. */
export function buildDecorRow(
  itemId: string,
  existing: readonly DecorItemRow[],
): DecorItemRow | null {
  const def = getDecorDef(itemId);
  if (!def) return null;
  const placedCount = existing.filter((i) => i.layer !== null).length;
  const maxSort = existing.reduce((max, i) => Math.max(max, i.sortOrder ?? -1), -1);
  return {
    id: createId(),
    itemId: def.id,
    pricePaid: def.price,
    acquiredAt: Date.now(),
    layer: def.layers[0],
    xFraction: autoPlaceXFraction(placedCount),
    scale: def.defaultScale,
    mirror: 0,
    sortOrder: maxSort + 1,
    resoldAt: null,
    resalePrice: null,
  };
}

interface BuyContext {
  previous: DecorItemRow[] | undefined;
}

/**
 * Buys a decor item and auto-places it. Takes the already-built row (see
 * `buildDecorRow`), not a bare item id — the transaction re-checks the
 * balance from freshly-selected rows before inserting THIS row, never
 * trusting the caller's cached balance, so a double-tapped Buy button can't
 * spend the same coins twice.
 *
 * `onMutate` inserts the row into the cache SYNCHRONOUSLY (no `await` before
 * it) and `mutationFn` opens with `yieldToUI()` — together this guarantees
 * the item visibly appears on the same frame the button is tapped, with the
 * actual DB write happening a tick later in the background (see
 * `yieldToUI`'s doc for why ordering alone doesn't guarantee that). Success
 * does NOT invalidate: the row that landed in the cache is byte-identical to
 * what the transaction persisted, so a refetch would only replace it with an
 * identical-but-different-reference copy (see `use-sell-fish-mutation.ts`'s
 * doc for why that reads as the whole list reloading). The one path that
 * DOES need reconciling is the rare real failure — balance actually
 * insufficient server-side — where `inserted` comes back `false`.
 */
export function useBuyDecorMutation() {
  const queryClient = useQueryClient();
  return useMutation<boolean, unknown, DecorItemRow, BuyContext>({
    meta: { errorMessage: "Couldn't buy that item." },
    mutationFn: async (row) => {
      await yieldToUI();
      let inserted = false;
      await db.transaction(async (tx) => {
        const [rows, items] = await Promise.all([
          tx.select().from(sessions),
          tx.select().from(decorItems),
        ]);
        const def = getDecorDef(row.itemId);
        if (!def || coinBalance(rows, items) < def.price) return;
        await tx.insert(decorItems).values(row);
        inserted = true;
      });
      return inserted;
    },
    onMutate: (row) => {
      const previous = queryClient.getQueryData<DecorItemRow[]>(DECOR_QUERY_KEY);
      queryClient.setQueryData<DecorItemRow[]>(DECOR_QUERY_KEY, (existing) => [
        ...(existing ?? []),
        row,
      ]);
      return { previous };
    },
    onError: (_err, _row, context) => {
      if (context?.previous) queryClient.setQueryData(DECOR_QUERY_KEY, context.previous);
    },
    onSuccess: (inserted) => {
      if (!inserted) queryClient.invalidateQueries({ queryKey: DECOR_QUERY_KEY });
    },
  });
}
