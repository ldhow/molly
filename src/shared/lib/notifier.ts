// The port between "something happened" and "the user is told about it".
//
// This file deliberately contains NO presentation. It is a one-function
// interface with a no-op default. The app chooses the mechanism — snackbar,
// push notification, native Alert, in-app banner, or nothing at all — by
// calling `setNotifier()` once during startup.
//
// Why a module-level singleton rather than Context: the QueryClient's cache
// callbacks fire outside the React tree, so they cannot read a hook. Keeping
// the port here means feature code never imports a toast library, and swapping
// the mechanism later touches exactly one call site.

export type NotificationLevel = "success" | "error";

export type Notification = {
  level: NotificationLevel;
  /** Human-readable text, already resolved from `meta` or the error. */
  message: string;
  /** Where it came from — useful if mutations and queries should look different. */
  source: "query" | "mutation";
  /** The raw error, for logging or crash reporting. Absent on success. */
  error?: unknown;
  /** The query/mutation key, for de-duplication or debugging. */
  key?: readonly unknown[];
};

export type NotifierFn = (notification: Notification) => void;

const noop: NotifierFn = () => {};

const devLogger: NotifierFn = ({ level, message, source, error }) => {
  const line = `[notifier:${source}:${level}] ${message}`;
  if (level === "error") {
    console.warn(line, error ?? "");
  } else {
    console.log(line);
  }
};

// __DEV__ is a React Native global; in a bare Node test runner it may be undefined.
let currentNotifier: NotifierFn = typeof __DEV__ !== "undefined" && __DEV__ ? devLogger : noop;

/**
 * Register the app's presentation mechanism. Call once, early — typically in
 * `AppProviders` before the first render.
 *
 * Returns a function that restores the previous notifier, which keeps tests
 * from leaking state into each other.
 */
export function setNotifier(next: NotifierFn): () => void {
  const previous = currentNotifier;
  currentNotifier = next;
  return () => {
    currentNotifier = previous;
  };
}

/**
 * Emit a notification. Called by `queryClient.ts`; feature code should not need
 * this directly, since outcomes are declared via `meta`. It is exported for the
 * rare non-query case (e.g. "Copied to clipboard").
 */
export function notify(notification: Notification): void {
  try {
    currentNotifier(notification);
  } catch (error) {
    // A broken notifier must never take down a query. Swallow and log.
    console.warn("[notifier] notifier threw", error);
  }
}
