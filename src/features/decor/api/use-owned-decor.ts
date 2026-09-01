import { useMemo } from "react";

import type { DecorItemRow } from "@/db/schema";
import { isOwnedDecor } from "@/shared/decor/ownership";
import { useDecorQuery } from "@/shared/hooks/use-decor-query";

/** Every OWNED decor item (resold ones excluded — they're gone, see
 *  `isOwnedDecor`), split into placed (in the tank) vs. unplaced (in the inventory). */
export function useOwnedDecor() {
  const { data: rows, isLoading } = useDecorQuery();

  return useMemo(() => {
    const all = (rows ?? []).filter(isOwnedDecor);
    const placed: DecorItemRow[] = [];
    const unplaced: DecorItemRow[] = [];
    for (const row of all) {
      (row.layer !== null ? placed : unplaced).push(row);
    }
    return { all, placed, unplaced, isLoading };
  }, [rows, isLoading]);
}
