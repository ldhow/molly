import { useMemo } from "react";

import type { SessionRow } from "@/db/schema";
import { TANK_FISH_SCALE, STAGE_SCALE } from "@/shared/constants/tank";
import { traitsOfRow } from "@/shared/fish/catalog";
import { stageForProgress } from "@/shared/fish/life-stage";
import type { LifeStage } from "@/shared/fish/types";
import { useNow } from "@/shared/hooks/use-now";
import { useSessionsQuery } from "@/shared/hooks/use-sessions-query";
import { classifyFish } from "@/shared/lib/tank-membership";
import { seedFromString } from "@/shared/lib/seed";
import type { TankFish } from "@/shared/components/tank/tank-canvas";

/**
 * Every finished session is a fish: completed → alive, failed/abandoned →
 * dead. Only fish currently classified as in-tank (§ `classifyFish`) render
 * here — capacity and the 24h dead-fish TTL are enforced there, not by a
 * render-time slice.
 */
export function useOwnedFish() {
  const { data: rows, isLoading } = useSessionsQuery();
  const now = useNow(60_000);

  return useMemo(() => {
    const all = rows ?? [];
    const { inTank, holding } = classifyFish(all, now);
    return {
      fish: inTank.map(toTankFish),
      totalCount: all.length,
      aliveCount: all.filter((r) => r.outcome === "completed").length,
      holdingCount: holding.length,
      isLoading,
    };
  }, [rows, now, isLoading]);
}

/** How far through the planned session the fish got before it died. */
function deathProgress(row: SessionRow): number {
  const total = row.plannedMinutes * 60_000;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (row.endedAt - row.startedAt) / total));
}

function toTankFish(row: SessionRow): TankFish {
  const alive = row.outcome === "completed";
  const stage: LifeStage = alive ? "adult" : stageForProgress(deathProgress(row));
  // Dead fish deliberately skip the sizeForMinutes ambition bonus — that
  // rewards completing a long session, and a corpse should look like
  // whatever it grew into before the user gave up, not how big it was aiming
  // to get.
  const scale = alive
    ? TANK_FISH_SCALE * STAGE_SCALE.adult * sizeForMinutes(row.plannedMinutes)
    : TANK_FISH_SCALE * STAGE_SCALE[stage];
  return {
    key: row.id,
    traits: traitsOfRow(row),
    stage,
    status: alive ? "alive" : "dead",
    scale,
    seed: seedFromString(row.id),
  };
}

/** Longer sessions grow slightly larger adults (0.85×–1.15×). */
function sizeForMinutes(minutes: number): number {
  const t = Math.min(1, Math.max(0, (minutes - 10) / 110));
  return 0.85 + t * 0.3;
}
