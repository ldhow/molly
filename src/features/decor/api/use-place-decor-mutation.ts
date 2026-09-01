import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { decorItems, type DecorItemRow } from "@/db/schema";
import type { DecorLayer } from "@/shared/decor/types";
import { DECOR_QUERY_KEY } from "@/shared/hooks/use-decor-query";
import { yieldToUI } from "@/shared/lib/yield-to-ui";

export interface PlaceArgs {
  id: string;
  layer: DecorLayer;
  xFraction: number;
  scale: number;
  mirror: boolean;
  sortOrder: number;
}

interface PlaceContext {
  previous: DecorItemRow[] | undefined;
}

function applyPlacement(row: DecorItemRow, args: PlaceArgs): DecorItemRow {
  return {
    ...row,
    layer: args.layer,
    xFraction: args.xFraction,
    scale: args.scale,
    mirror: args.mirror ? 1 : 0,
    sortOrder: args.sortOrder,
  };
}

/**
 * Places (or repositions) an owned decor item. Optimistic, like the buy/sell
 * mutations — the tank updates the instant a control (or a drag gesture) is
 * released, not after the DB round-trips. Never invalidates on success: the
 * new field values are exactly what's written, so there's nothing to
 * reconcile, and a drag-to-reposition can fire this once per gesture —
 * invalidating each time would replace the whole decor list with
 * fresh-but-identical objects mid-arrangement, reading as the layout
 * "jumping" right after every drop (see `use-sell-fish-mutation.ts`'s doc
 * for the same effect on the sell list).
 */
export function usePlaceDecorMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, PlaceArgs, PlaceContext>({
    meta: { errorMessage: "Couldn't move that item." },
    mutationFn: async (args) => {
      await yieldToUI();
      await db
        .update(decorItems)
        .set({
          layer: args.layer,
          xFraction: args.xFraction,
          scale: args.scale,
          mirror: args.mirror ? 1 : 0,
          sortOrder: args.sortOrder,
        })
        .where(eq(decorItems.id, args.id));
    },
    onMutate: (args) => {
      const previous = queryClient.getQueryData<DecorItemRow[]>(DECOR_QUERY_KEY);
      queryClient.setQueryData<DecorItemRow[]>(DECOR_QUERY_KEY, (rows) =>
        rows?.map((row) => (row.id === args.id ? applyPlacement(row, args) : row)),
      );
      return { previous };
    },
    onError: (_err, _args, context) => {
      if (context?.previous) queryClient.setQueryData(DECOR_QUERY_KEY, context.previous);
    },
  });
}
