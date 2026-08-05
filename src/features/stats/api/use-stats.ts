import { useMemo } from "react";

import { useNow } from "@/shared/hooks/use-now";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";

import { computeStats } from "../utils/stats";

export function useStats() {
  const { data: rows, isLoading } = useSessionsQuery();
  // Minute granularity keeps "today"/streaks fresh across midnight without
  // calling the impure Date.now() during render.
  const now = useNow(60_000);
  const stats = useMemo(() => computeStats(rows ?? [], now), [rows, now]);
  return { stats, rows: rows ?? [], isLoading };
}
