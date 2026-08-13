import { useRouter } from "expo-router";
import { useCallback } from "react";

import { getSpeciesDef } from "@/shared/creature/catalog";

import { useSessionStore } from "../store/session-store";
import type { CreatureSelection } from "../types";
import {
  requestNotificationPermission,
  scheduleCompletionNotification,
} from "../utils/notifications";

export function useStartSession() {
  const router = useRouter();
  const start = useSessionStore((s) => s.start);

  return useCallback(
    (selection: CreatureSelection, plannedMinutes: number) => {
      const session = start(selection, plannedMinutes);
      const noun = getSpeciesDef(selection.speciesId).copy.noun;
      // Fire-and-forget: the session must start instantly even if the
      // permission prompt is still up or gets denied.
      void requestNotificationPermission().then((granted) => {
        if (granted) {
          void scheduleCompletionNotification(plannedMinutes * 60, noun);
        }
      });
      router.push("/session");
      return session;
    },
    [router, start],
  );
}
