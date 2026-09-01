import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { COLOR_DEFS, rollTraits } from "@/shared/fish/catalog";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { toLocalDate } from "@/shared/lib/dates";
import { createId } from "@/shared/lib/id";
import { classifyFish, TANK_CAPACITY } from "@/shared/lib/tank-membership";

/**
 * Dev-only: inserts one completed session with a random color/traits — the
 * same row shape a real focus session produces on completion, just skipping
 * the wait. Mirrors `useEndSessionMutation` (features/session); duplicated
 * rather than imported since that feature only exports its screens.
 */
export function useAddDevFishMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't add a dev fish." },
    mutationFn: async () => {
      const now = Date.now();
      const color = COLOR_DEFS[Math.floor(Math.random() * COLOR_DEFS.length)].id;
      const traits = rollTraits(color);
      const plannedMinutes = 10 + Math.floor(Math.random() * 50);

      const existing = await db.select().from(sessions);
      const { inTank } = classifyFish(existing, now);

      await db.insert(sessions).values({
        id: createId(),
        variantId: traits.color,
        colorId: traits.color,
        bodyId: traits.body,
        tailId: traits.tail,
        dorsalId: traits.dorsal,
        plannedMinutes,
        startedAt: now - plannedMinutes * 60_000,
        endedAt: now,
        outcome: "completed",
        localDate: toLocalDate(now),
        inTank: inTank.length < TANK_CAPACITY ? 1 : 0,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
