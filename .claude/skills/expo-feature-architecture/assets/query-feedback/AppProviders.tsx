// src/providers/AppProviders.tsx
//
// Composes every app-wide provider, and — the part that matters for this skill —
// is the ONE place where the notifier port is bound to a concrete mechanism.
//
// Replace the body of `appNotifier` with whatever the product wants. Nothing
// else in the codebase changes when you do.

import { useEffect, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";

import { setNotifier, type NotifierFn } from "@/shared/lib/notifier";

import { queryClient } from "./queryClient";

// ---------------------------------------------------------------------------
// Bind the port. Pick ONE mechanism — see references/query-feedback.md for
// snackbar, push-notification and native-Alert adapters.
//
// The default below is intentionally inert: outcomes are routed here and
// dropped, so the app runs correctly with no notification UI at all until you
// choose one.
// ---------------------------------------------------------------------------
const appNotifier: NotifierFn = ({ level, message, error }) => {
  if (level === "error" && error) {
    // Wire crash reporting here (Sentry.captureException, etc.) — this fires
    // for every failure in the app, which is exactly what you want for logging.
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

/** Pause queries while offline instead of burning retries against a dead radio. */
function useOnlineManager() {
  useEffect(
    () =>
      onlineManager.setEventListener((setOnline) =>
        NetInfo.addEventListener((state) => {
          setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
        }),
      ),
    [],
  );
}

export function AppProviders({ children }: PropsWithChildren) {
  useAppStateFocus();
  useOnlineManager();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>{children}</SafeAreaProvider>
    </QueryClientProvider>
  );
}
