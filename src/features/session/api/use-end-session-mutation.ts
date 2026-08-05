import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { toLocalDate } from "@/shared/lib/dates";

import type { ActiveSession, SessionOutcome } from "../types";

interface EndSessionArgs {
  session: ActiveSession;
  outcome: SessionOutcome;
  endedAt: number;
}

/** Persists a finished session and refreshes everything derived from it. */
export function useEndSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't save your session." },
    mutationFn: async ({ session, outcome, endedAt }: EndSessionArgs) => {
      await db.insert(sessions).values({
        id: session.id,
        variantId: session.variantId,
        plannedMinutes: session.plannedMinutes,
        startedAt: session.startedAt,
        endedAt,
        outcome,
        localDate: toLocalDate(endedAt),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
