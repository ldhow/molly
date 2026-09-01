import { useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/db/client";
import { decorItems } from "@/db/schema";
import { DECOR_QUERY_KEY } from "@/shared/hooks/use-decor-query";

/**
 * Dev-only: wipes every owned decor item, so the tank goes back to bare
 * (just the far/back backdrop fill — see `aquarium-canvas.tsx`'s `userScape`
 * doc). Lets a cluttered test tank be cleared without reinstalling the app
 * or losing sessions/fish — only `decor_items` is touched.
 */
export function useResetDecorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Couldn't reset decor." },
    mutationFn: async () => {
      await db.delete(decorItems);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DECOR_QUERY_KEY }),
  });
}
