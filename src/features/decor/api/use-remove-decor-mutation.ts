import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { decorItems, type DecorItemRow } from "@/db/schema";
import { DECOR_QUERY_KEY } from "@/shared/hooks/use-decor-query";
import { yieldToUI } from "@/shared/lib/yield-to-ui";

interface RemoveContext {
  previous: DecorItemRow[] | undefined;
}

/** "Put away" — nulls the placement columns so the item returns to the
 *  inventory strip. The row (and ownership) survives; nothing is sold or
 *  deleted. Optimistic, matching every other decor mutation — and, same as
 *  those, never invalidates on success (see `use-place-decor-mutation.ts`'s
 *  doc for why: nothing to reconcile, and it would just flash the list). */
export function useRemoveDecorMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string, RemoveContext>({
    meta: { errorMessage: "Couldn't put that item away." },
    mutationFn: async (id: string) => {
      await yieldToUI();
      await db
        .update(decorItems)
        .set({ layer: null, xFraction: null, scale: null, mirror: null, sortOrder: null })
        .where(eq(decorItems.id, id));
    },
    onMutate: (id) => {
      const previous = queryClient.getQueryData<DecorItemRow[]>(DECOR_QUERY_KEY);
      queryClient.setQueryData<DecorItemRow[]>(DECOR_QUERY_KEY, (rows) =>
        rows?.map((row) =>
          row.id === id
            ? { ...row, layer: null, xFraction: null, scale: null, mirror: null, sortOrder: null }
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
