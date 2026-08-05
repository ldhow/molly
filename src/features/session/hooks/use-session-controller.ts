import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useSessionStore } from "../store/session-store";
import { judgeColdStart, judgeForeground, plannedEndOf } from "../utils/machine";
import {
  cancelDyingNotification,
  ensureAndroidChannel,
  scheduleDyingNotification,
} from "../utils/notifications";

import { useSettleSession } from "./use-settle-session";

/**
 * Session runtime, mounted exactly once from the root layout.
 * Owns everything that must keep working while the user is anywhere in the
 * app (or has just relaunched it): cold-start judgment of an orphaned
 * snapshot, AppState grace-period tracking, and derived completion.
 */
export function useSessionController() {
  const router = useRouter();
  const settle = useSettleSession();
  const settleRef = useRef(settle);
  // Keep the ref fresh without mutating during render. Declared before the
  // effects below so it runs first on mount.
  useEffect(() => {
    settleRef.current = settle;
  }, [settle]);

  // Cold-start judgment of a snapshot that survived an app kill.
  const coldStartDone = useRef(false);
  useEffect(() => {
    if (coldStartDone.current) return;
    coldStartDone.current = true;

    void ensureAndroidChannel();

    const store = useSessionStore.getState();
    const active = store.active;
    if (!active) return;

    const now = Date.now();
    const judgment = judgeColdStart(active, now);
    if (judgment.kind === "completed") {
      settleRef.current("completed", Math.min(now, plannedEndOf(active)));
    } else if (judgment.kind === "failed") {
      settleRef.current("failed", now);
    } else if (judgment.clearBackgrounded) {
      store.clearBackgrounded();
    }
    // Whatever the outcome, surface it: either the still-running timer or
    // the result sheet lives on the session screen.
    router.navigate("/session");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grace-period tracking across background/foreground transitions.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const store = useSessionStore.getState();
      const active = store.active;
      if (!active) return;

      const now = Date.now();
      if (nextState === "active") {
        const judgment = judgeForeground(active, now);
        if (judgment.kind === "completed") {
          settleRef.current("completed", Math.min(now, plannedEndOf(active)));
        } else if (judgment.kind === "failed") {
          settleRef.current("failed", now);
        } else {
          if (judgment.clearBackgrounded) {
            store.clearBackgrounded();
            store.setGraceRecovered(true);
          }
          void cancelDyingNotification();
        }
      } else {
        // 'inactive' (app switcher, notification shade) is treated like
        // 'background'; the grace period absorbs harmless flickers.
        if (active.backgroundedAt === null) {
          store.markBackgrounded(now);
          void scheduleDyingNotification();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // Derived completion while foregrounded: a throttled timer can only delay
  // the check, never miss it, because the judgment reads timestamps.
  const activeId = useSessionStore((s) => s.active?.id);
  useEffect(() => {
    if (!activeId) return;
    const id = setInterval(() => {
      const active = useSessionStore.getState().active;
      if (active && Date.now() >= plannedEndOf(active)) {
        settleRef.current("completed", plannedEndOf(active));
      }
    }, 500);
    return () => clearInterval(id);
  }, [activeId]);
}
