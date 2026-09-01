import { useQuery } from "@tanstack/react-query";

import { db } from "@/db/client";
import { decorItems, type DecorItemRow } from "@/db/schema";

export const DECOR_QUERY_KEY = ["decor"] as const;

/** Every owned decor item — placed and unplaced alike. Invalidated on buy/place/remove. */
export function useDecorQuery() {
  return useQuery<DecorItemRow[]>({
    queryKey: DECOR_QUERY_KEY,
    queryFn: () => db.select().from(decorItems),
  });
}
