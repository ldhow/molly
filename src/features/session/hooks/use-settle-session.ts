import * as Haptics from "expo-haptics";
import { useCallback } from "react";

import { rollVariant, standardVariant } from "@/shared/creature/catalog";
import { patternSeedOf, rollTraits, standardTraits } from "@/shared/fish/catalog";

import { useSessionStore } from "../store/session-store";
import type { RolledCreature, SessionOutcome } from "../types";
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

      // The reveal moment: rare traits/variants only come from completed
      // sessions — a dead creature is always the plain/common kind. Molly's
      // pattern variant is derived from the session id so it's identical
      // here and whenever this row is later re-read via traitsOfRow().
      const rolled: RolledCreature =
        active.speciesId === "molly"
          ? {
              speciesId: "molly",
              colorId: active.colorId,
              traits: {
                ...(outcome === "completed"
                  ? rollTraits(active.colorId)
                  : standardTraits(active.colorId)),
                patternSeed: patternSeedOf(active.id),
              },
            }
          : {
              speciesId: active.speciesId,
              variant:
                outcome === "completed"
                  ? rollVariant(active.speciesId)
                  : standardVariant(active.speciesId),
            };

      store.finish(outcome, endedAt, rolled);
      endSession.mutate({ session: active, outcome, endedAt, rolled });
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
