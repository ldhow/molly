import { coinBalance } from "@/shared/economy/coins";

import { useDecorQuery } from "./use-decor-query";
import { useSessionsQuery } from "./use-sessions-query";

/** Reads both `["sessions"]` and `["decor"]` — either invalidation refreshes it. */
export function useCoinBalance() {
  const { data: rows, isLoading: sessionsLoading } = useSessionsQuery();
  const { data: items, isLoading: decorLoading } = useDecorQuery();
  return {
    balance: coinBalance(rows ?? [], items ?? []),
    isLoading: sessionsLoading || decorLoading,
  };
}
