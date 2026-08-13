import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { toLocalDate } from "@/shared/lib/dates";
import { classifyFish, TANK_CAPACITY } from "@/shared/lib/tank-membership";

import type { ActiveSession, RolledCreature, SessionOutcome } from "../types";

interface EndSessionArgs {
  session: ActiveSession;
  outcome: SessionOutcome;
  endedAt: number;
  rolled: RolledCreature;
}

/** Persists a finished session and refreshes everything derived from it. */
export function useEndSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't save your session." },
    mutationFn: async ({ session, outcome, endedAt, rolled }: EndSessionArgs) => {
      // A newly-finished fish auto-joins the tank if there's room, else it
      // lands straight in the Holding Tank — capacity is enforced here, not
      // by a render-time slice. Species-agnostic: TANK_CAPACITY is one flat
      // pool shared by every species, same as today's molly-only pool.
      const existing = await db.select().from(sessions);
      const { inTank } = classifyFish(existing, endedAt);

      const isMolly = rolled.speciesId === "molly";
      await db.insert(sessions).values({
        id: session.id,
        // Legacy column, NOT NULL: molly mirrors its color (pre-trait
        // readers resolve it via traitsOfRow); a non-molly row writes an
        // opaque satisfy-the-constraint value that's never read back — see
        // `resolveCreature()`.
        variantId: isMolly ? rolled.colorId : `${rolled.speciesId}:${rolled.variant}`,
        colorId: isMolly ? rolled.colorId : null,
        bodyId: isMolly ? rolled.traits.body : null,
        tailId: isMolly ? rolled.traits.tail : null,
        dorsalId: isMolly ? rolled.traits.dorsal : null,
        speciesId: isMolly ? null : rolled.speciesId,
        creatureVariant: isMolly ? null : rolled.variant,
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
