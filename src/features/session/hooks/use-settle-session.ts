import * as Haptics from "expo-haptics";
import { useCallback } from "react";

import { useSessionStore } from "../store/session-store";
import type { SessionOutcome } from "../types";
import { cancelAllSessionNotifications } from "../utils/notifications";

import { useEndSessionMutation } from "../api/use-end-session-mutation";

/**
 * The single terminal path for a session: clears the active snapshot,
 * records the result for the result sheet, persists the row, and cancels
 * pending notifications. Safe to call from multiple watchers — the first
 * caller wins, later calls see `active === null` and no-op.
 */
export function useSettleSession() {
  const endSession = useEndSessionMutation();

  return useCallback(
    (outcome: SessionOutcome, endedAt: number) => {
      const store = useSessionStore.getState();
      const active = store.active;
      if (!active) return false;

      store.finish(outcome, endedAt);
      endSession.mutate({ session: active, outcome, endedAt });
      void cancelAllSessionNotifications();

      if (outcome === "completed") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return true;
    },
    [endSession],
  );
}
