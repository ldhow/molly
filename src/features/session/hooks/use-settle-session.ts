import * as Haptics from "expo-haptics";
import { useCallback } from "react";

import { rollTraits, standardTraits } from "@/shared/fish/catalog";

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

      // The reveal moment: rare body/tail/dorsal traits only come from
      // completed sessions — a dead molly is always the plain kind.
      const traits =
        outcome === "completed" ? rollTraits(active.colorId) : standardTraits(active.colorId);
      store.finish(outcome, endedAt, traits);
      endSession.mutate({ session: active, outcome, endedAt, traits });
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
