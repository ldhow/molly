// DEV ONLY — drops a chosen species straight into the tank, so art and swim
// behaviour can be checked without sitting through a focus session per fish.
//
// THIS WRITES A COMPLETED SESSION ROW, and there is no way around that: the
// `sessions` table is the single source of truth, and tank contents, the
// Fishdex, stats, streaks and coin balance are all derived from it at read
// time (see CLAUDE.md). "Add a fish" and "record a finished session" are the
// same operation by construction — a `spawned` column, or any other side
// channel, would be exactly the denormalised state the schema rule exists to
// forbid.
//
// The visible consequence, which is why this is gated on `__DEV__` rather
// than merely hidden: every spawn also adds `SPAWN_MINUTES` to lifetime focus
// minutes, counts toward today's streak, and can unlock colours whose rule is
// session-count based. A dev database is therefore not a realistic one. Delete
// the rows (or the app data) before judging anything on the Stats screen.

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { toLocalDate } from "@/shared/lib/dates";
import { createId } from "@/shared/lib/id";
import { isMollyTankFish, type AnyTankFish } from "@/shared/lib/tank-fish";
import { canJoinTank, classifyFish } from "@/shared/lib/tank-membership";

/**
 * Mid-range on `use-owned-fish.ts`'s `sizeForMinutes` curve (10-120 min maps
 * to 0.85x-1.15x), so a spawned fish is neither the smallest nor the largest
 * the tank can hold and its size reads as typical rather than as an outlier.
 */
const SPAWN_MINUTES = 60;

/**
 * Inserts the row that makes `fish` real. Takes the same `AnyTankFish` the
 * preview was rendering, so what you looked at is what lands in the tank.
 */
export function useDevSpawnFishMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't add that fish." },
    mutationFn: async (fish: AnyTankFish) => {
      const now = Date.now();
      // Same capacity rule as the real terminal path in
      // `use-end-session-mutation.ts`: join the tank if there is room, else
      // land in the Holding Tank. Deliberately NOT bypassed for a dev spawn —
      // the over-capacity path is one of the things worth being able to test.
      const existing = await db.select().from(sessions);
      const { inTank } = classifyFish(existing, now);

      const molly = isMollyTankFish(fish);
      await db.insert(sessions).values({
        id: createId(),
        // Legacy NOT NULL column — molly mirrors its colour, a creature writes
        // the opaque `species:variant` value that is never read back. See the
        // schema's own comment and `resolveCreature()`.
        variantId: molly ? fish.traits.color : `${fish.speciesId}:${fish.variant}`,
        colorId: molly ? fish.traits.color : null,
        bodyId: molly ? fish.traits.body : null,
        tailId: molly ? fish.traits.tail : null,
        dorsalId: molly ? fish.traits.dorsal : null,
        speciesId: molly ? null : fish.speciesId,
        creatureVariant: molly ? null : fish.variant,
        plannedMinutes: SPAWN_MINUTES,
        startedAt: now - SPAWN_MINUTES * 60_000,
        endedAt: now,
        outcome: "completed",
        // Computed in JS at insert time, never derived from `endedAt` on read
        // — the invariant `localDate` exists for.
        localDate: toLocalDate(now),
        inTank: canJoinTank(inTank, molly ? "molly" : fish.speciesId) ? 1 : 0,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
