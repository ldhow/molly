import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { decorItems, type DecorItemRow } from "@/db/schema";
import { decorResellPriceOf } from "@/shared/decor/pricing";
import { DECOR_QUERY_KEY } from "@/shared/hooks/use-decor-query";
import { yieldToUI } from "@/shared/lib/yield-to-ui";

interface ResellContext {
  previous: DecorItemRow[] | undefined;
}

/**
 * Sells an owned decor item back — permanent, one-way, and always for less
 * than it cost (`decorResellPriceOf`), so buy-then-resell can never mint free
 * coins. Re-reads `pricePaid` from the row inside the transaction rather than
 * trusting a stale caller-held copy, and no-ops if it's already resold — same
 * double-tap guard every other sell path in this app uses.
 *
 * Optimistic and non-invalidating like every other decor mutation (see
 * `use-place-decor-mutation.ts`'s doc for why): the resale price is a pure
 * function of `pricePaid`, so the optimistic write is byte-identical to what
 * the transaction persists.
 */
export function useResellDecorMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string, ResellContext>({
    meta: { errorMessage: "Couldn't sell that item." },
    mutationFn: async (id: string) => {
      await yieldToUI();
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(decorItems).where(eq(decorItems.id, id));
        if (!row || row.resoldAt !== null) return;
        await tx
          .update(decorItems)
          .set({
            resoldAt: Date.now(),
            resalePrice: decorResellPriceOf(row.pricePaid),
            layer: null,
            xFraction: null,
            scale: null,
            mirror: null,
            sortOrder: null,
          })
          .where(eq(decorItems.id, id));
      });
    },
    onMutate: (id) => {
      const previous = queryClient.getQueryData<DecorItemRow[]>(DECOR_QUERY_KEY);
      const now = Date.now();
      queryClient.setQueryData<DecorItemRow[]>(DECOR_QUERY_KEY, (rows) =>
        rows?.map((row) =>
          row.id === id && row.resoldAt === null
            ? {
                ...row,
                resoldAt: now,
                resalePrice: decorResellPriceOf(row.pricePaid),
                layer: null,
                xFraction: null,
                scale: null,
                mirror: null,
                sortOrder: null,
              }
            : row,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(DECOR_QUERY_KEY, context.previous);
    },
  });
}
