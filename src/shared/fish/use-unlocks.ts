import { useMemo } from "react";

import { FISH_VARIANTS } from "./variants";
import { isUnlocked } from "./unlocks";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";

export function useUnlocks() {
  const { data: rows } = useSessionsQuery();
  return useMemo(() => {
    const sessionRows = rows ?? [];
    const entries = FISH_VARIANTS.map((variant) => ({
      variant,
      unlocked: isUnlocked(variant, sessionRows),
    }));
    return {
      entries,
      unlockedIds: entries.filter((e) => e.unlocked).map((e) => e.variant.id),
    };
  }, [rows]);
}
