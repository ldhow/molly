import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";

interface SwapArgs {
  /** Fish to bring into the tank. Omit to only free `removeId`'s slot. */
  addId?: string;
  /** Fish to send back to the Holding Tank. */
  removeId?: string;
}

/** Moves fish between the tank and the Holding Tank — add, remove, or swap. */
export function useSwapTankFishMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't update your tank." },
    mutationFn: async ({ addId, removeId }: SwapArgs) => {
      if (addId && removeId) {
        await db.transaction(async (tx) => {
          await tx.update(sessions).set({ inTank: 0 }).where(eq(sessions.id, removeId));
          await tx.update(sessions).set({ inTank: 1 }).where(eq(sessions.id, addId));
        });
      } else if (addId) {
        await db.update(sessions).set({ inTank: 1 }).where(eq(sessions.id, addId));
      } else if (removeId) {
        await db.update(sessions).set({ inTank: 0 }).where(eq(sessions.id, removeId));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
