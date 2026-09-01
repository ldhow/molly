import { useMemo } from "react";

import type { SessionRow } from "@/db/schema";
import { TANK_FISH_SCALE, STAGE_SCALE } from "@/shared/constants/tank";
import { getSpeciesDef } from "@/shared/creature/catalog";
import { resolveCreature } from "@/shared/creature/resolve";
import { stageForProgress } from "@/shared/fish/life-stage";
import type { LifeStage } from "@/shared/fish/types";
import { classifyFish, isSold } from "@/shared/lib/tank-membership";
import { seedFromString } from "@/shared/lib/seed";
import type { AnyTankFish } from "@/shared/lib/tank-fish";

import { useNow } from "./use-now";
import { useSessionsQuery } from "./use-sessions-query";

/**
 * Caches one `AnyTankFish` per row OBJECT (not per id) — `toTankFish` is a
 * pure function of the row's own fields, so as long as the row reference is
 * unchanged (true for every fish except the one a mutation actually touched;
 * see `use-sellable-fish.ts`'s `entryFor`, the same pattern for the Sell Fish
 * list), reusing the cached object here keeps it referentially stable across
 * a mutation. `resolveCreature`/`traitsOfRow` build a fresh object on every
 * call, so without this, selling (or ending) ONE session would hand every
 * OTHER tank fish a brand-new `traits` object each time — recomputing fin
 * anatomy and defeating downstream memoization in `FishLayer`/`Fish3D` for
 * fish that didn't actually change, on every unrelated sessions mutation.
 */
const tankFishCache = new WeakMap<SessionRow, AnyTankFish>();
function tankFishFor(row: SessionRow): AnyTankFish {
  const cached = tankFishCache.get(row);
  if (cached) return cached;
  const fish = toTankFish(row);
  tankFishCache.set(row, fish);
  return fish;
}

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
    // Sold fish are gone — excluded from both counts, same as they're
    // excluded from `inTank`/`holding` (`classifyFish`).
    const owned = all.filter((r) => !isSold(r));
    return {
      fish: inTank.map(tankFishFor),
      totalCount: owned.length,
      aliveCount: owned.filter((r) => r.outcome === "completed").length,
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

function toTankFish(row: SessionRow): AnyTankFish {
  const alive = row.outcome === "completed";
  const stage: LifeStage = alive ? "adult" : stageForProgress(deathProgress(row));
  const creature = resolveCreature(row);
  // `sizeRatio` is 1 for molly (a no-op multiply) and each other species'
  // size relative to that same baseline — see `SpeciesDef.sizeRatio`'s doc
  // comment for why this feeds render scale rather than a separate knob.
  const sizeRatio = getSpeciesDef(creature.speciesId).sizeRatio;
  // Dead fish deliberately skip the sizeForMinutes ambition bonus — that
  // rewards completing a long session, and a corpse should look like
  // whatever it grew into before the user gave up, not how big it was aiming
  // to get.
  const scale = alive
    ? TANK_FISH_SCALE * sizeRatio * STAGE_SCALE.adult * sizeForMinutes(row.plannedMinutes)
    : TANK_FISH_SCALE * sizeRatio * STAGE_SCALE[stage];
  const base = {
    key: row.id,
    stage,
    status: (alive ? "alive" : "dead") as "alive" | "dead",
    scale,
    seed: seedFromString(row.id),
  };
  return creature.speciesId === "molly"
    ? { ...base, speciesId: "molly", traits: creature.traits }
    : { ...base, speciesId: creature.speciesId, variant: creature.variant };
}

/** Longer sessions grow slightly larger adults (0.85×–1.15×). */
function sizeForMinutes(minutes: number): number {
  const t = Math.min(1, Math.max(0, (minutes - 10) / 110));
  return 0.85 + t * 0.3;
}
