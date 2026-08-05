// Composes every app-wide provider, and — the part that matters for the
// architecture — is the ONE place where the notifier port is bound to a
// concrete mechanism.
//
// Replace the body of `appNotifier` with whatever the product wants. Nothing
// else in the codebase changes when you do.

import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { setNotifier, type NotifierFn } from "@/shared/lib/notifier";

import { queryClient } from "./query-client";

// ---------------------------------------------------------------------------
// Bind the port. Intentionally inert for now: outcomes are routed here and
// dropped (dev builds still log via the notifier's dev logger). Swap in a
// snackbar/Alert adapter here when the product wants visible feedback.
// ---------------------------------------------------------------------------
const appNotifier: NotifierFn = ({ level, message, error }) => {
  if (level === "error" && error) {
    // Wire crash reporting here (Sentry.captureException, etc.) — this fires
    // for every failure in the app.
  }
  void message;
};

setNotifier(appNotifier);

/** Keep TanStack Query's focus tracking honest on native (there is no window). */
function useAppStateFocus() {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);
}

// No online manager: this app's data source is local SQLite, so pausing
// queries while offline would be wrong.

export function AppProviders({ children }: PropsWithChildren) {
  useAppStateFocus();

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
