import { useMemo } from "react";

import { getVariant } from "@/shared/fish/variants";
import type { VariantId } from "@/shared/fish/types";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";

import { MAX_RENDERED_FISH, STAGE_SCALE } from "@/shared/constants/tank";
import { seedFromString } from "@/shared/lib/seed";
import type { TankFish } from "@/shared/components/tank/tank-canvas";

/**
 * Every finished session is a fish: completed → alive, failed/abandoned →
 * dead. Newest first, capped for rendering with a "+N more" count.
 */
export function useOwnedFish() {
  const { data: rows, isLoading } = useSessionsQuery();

  return useMemo(() => {
    const all = (rows ?? []).map((row): TankFish => ({
      key: row.id,
      variant: getVariant(row.variantId as VariantId),
      stage: "adult",
      status: row.outcome === "completed" ? "alive" : "dead",
      scale: STAGE_SCALE.adult * sizeForMinutes(row.plannedMinutes),
      seed: seedFromString(row.id),
    }));
    const fish = all.slice(0, MAX_RENDERED_FISH);
    return {
      fish,
      totalCount: all.length,
      aliveCount: all.filter((f) => f.status === "alive").length,
      hiddenCount: Math.max(0, all.length - fish.length),
      isLoading,
    };
  }, [rows, isLoading]);
}

/** Longer sessions grow slightly larger adults (0.85×–1.15×). */
function sizeForMinutes(minutes: number): number {
  const t = Math.min(1, Math.max(0, (minutes - 10) / 110));
  return 0.85 + t * 0.3;
}
