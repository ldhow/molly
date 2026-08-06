import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { SESSIONS_QUERY_KEY } from "@/shared/hooks/use-sessions-query";
import { classifyFish } from "@/shared/lib/tank-membership";

/**
 * Dev-only: hard-deletes the most recently added in-tank fish's session row.
 * Mirrors `useAddDevFishMutation` — undoing a fabricated row, not archiving a
 * real one, so this deletes rather than clearing `inTank` (that's what the
 * Holding Tank's swap does for real fish).
 */
export function useRemoveDevFishMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't remove a dev fish." },
    mutationFn: async () => {
      const now = Date.now();
      const existing = await db.select().from(sessions);
      const { inTank } = classifyFish(existing, now);
      if (inTank.length === 0) return;

      const mostRecent = inTank.reduce((a, b) => (b.endedAt > a.endedAt ? b : a));
      await db.delete(sessions).where(eq(sessions.id, mostRecent.id));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}
