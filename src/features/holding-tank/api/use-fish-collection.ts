import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";
import { useNow } from "@/shared/hooks/use-now";
import { classifyFish } from "@/shared/lib/tank-membership";

/** Every session split into "currently in the tank" vs. "in the Holding Tank". */
export function useFishCollection() {
  const { data: rows, isLoading } = useSessionsQuery();
  const now = useNow(60_000);
  const { inTank, holding } = classifyFish(rows ?? [], now);
  return { inTank, holding, isLoading };
}
