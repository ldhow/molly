import { useRouter } from "expo-router";
import { useCallback } from "react";

import type { VariantId } from "@/shared/fish/types";

import { useSessionStore } from "../store/session-store";
import {
  requestNotificationPermission,
  scheduleCompletionNotification,
} from "../utils/notifications";

export function useStartSession() {
  const router = useRouter();
  const start = useSessionStore((s) => s.start);

  return useCallback(
    (variantId: VariantId, plannedMinutes: number) => {
      const session = start(variantId, plannedMinutes);
      // Fire-and-forget: the session must start instantly even if the
      // permission prompt is still up or gets denied.
      void requestNotificationPermission().then((granted) => {
        if (granted) {
          void scheduleCompletionNotification(plannedMinutes * 60);
        }
      });
      router.push("/session");
      return session;
    },
    [router, start],
  );
}
