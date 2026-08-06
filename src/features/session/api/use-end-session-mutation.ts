import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import type { FishTraits } from "@/shared/fish/types";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { toLocalDate } from "@/shared/lib/dates";
import { classifyFish, TANK_CAPACITY } from "@/shared/lib/tank-membership";

import type { ActiveSession, SessionOutcome } from "../types";

interface EndSessionArgs {
  session: ActiveSession;
  outcome: SessionOutcome;
  endedAt: number;
  traits: FishTraits;
}

/** Persists a finished session and refreshes everything derived from it. */
export function useEndSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't save your session." },
    mutationFn: async ({ session, outcome, endedAt, traits }: EndSessionArgs) => {
      // A newly-finished fish auto-joins the tank if there's room, else it
      // lands straight in the Holding Tank — capacity is enforced here, not
      // by a render-time slice.
      const existing = await db.select().from(sessions);
      const { inTank } = classifyFish(existing, endedAt);

      await db.insert(sessions).values({
        id: session.id,
        // Legacy column mirrors the color for pre-trait readers.
        variantId: traits.color,
        colorId: traits.color,
        bodyId: traits.body,
        tailId: traits.tail,
        dorsalId: traits.dorsal,
        plannedMinutes: session.plannedMinutes,
        startedAt: session.startedAt,
        endedAt,
        outcome,
        localDate: toLocalDate(endedAt),
        inTank: inTank.length < TANK_CAPACITY ? 1 : 0,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
