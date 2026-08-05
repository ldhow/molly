// src/providers/queryClient.ts
//
// The single place every query and mutation outcome passes through.
//
// QueryCache/MutationCache callbacks fire for EVERY query and mutation in the
// app, regardless of which feature owns it. That makes this the one seam where
// failure handling belongs — features declare intent via `meta` and never write
// their own error-display code.
//
// Nothing here knows what a snackbar is. Outcomes go to the notifier port; the
// app decides the mechanism in AppProviders.

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { DEFAULT_ERROR_MESSAGE, getErrorMessage } from "@/shared/lib/errors";
import { notify } from "@/shared/lib/notifier";
// Imported for its side effect as well as its type: this is what pulls the
// `Register` module augmentation into the program.
import type { FeedbackMeta } from "@/shared/types/query-meta";

function resolveErrorMessage(meta: FeedbackMeta | undefined, error: unknown): string {
  return meta?.errorMessage ?? getErrorMessage(error, DEFAULT_ERROR_MESSAGE);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      // React Native has no window focus; refetching on app foreground is wired
      // via AppState in AppProviders instead.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },

  queryCache: new QueryCache({
    onError: (error, query) => {
      const meta = query.meta;
      if (meta?.suppressGlobalError) return;

      // Queries are quiet by default. A first-load failure should render the
      // screen's own error/retry state — a floating message on top of an empty
      // screen tells the user nothing they can act on.
      //
      // Two cases still deserve a notification:
      //   1. The query explicitly asked for one via meta.errorMessage.
      //   2. It's a background refetch (data is already cached), so the screen
      //      is showing stale content and the failure is otherwise invisible.
      const isBackgroundRefetch = query.state.data !== undefined;
      if (!meta?.errorMessage && !isBackgroundRefetch) return;

      notify({
        level: "error",
        source: "query",
        message: resolveErrorMessage(meta, error),
        error,
        key: query.queryKey,
      });
    },
  }),

  mutationCache: new MutationCache({
    // Cache-level callbacks run BEFORE the hook's own onSuccess/onError, so a
    // feature can still invalidate or navigate in its local handler.
    onSuccess: (_data, _variables, _context, mutation) => {
      const message = mutation.meta?.successMessage;
      if (!message) return;

      notify({
        level: "success",
        source: "mutation",
        message,
        key: mutation.options.mutationKey,
      });
    },

    onError: (error, _variables, _context, mutation) => {
      // Mutations notify by default: the user pressed a button, so silence
      // reads as a broken app. Opt out with meta.suppressGlobalError when the
      // form shows the failure inline.
      if (mutation.meta?.suppressGlobalError) return;

      notify({
        level: "error",
        source: "mutation",
        message: resolveErrorMessage(mutation.meta, error),
        error,
        key: mutation.options.mutationKey,
      });
    },
  }),
});

/**
 * Fresh client per test — `retry: false` keeps failure-path tests from taking
 * seconds, and an isolated cache stops tests leaking into each other.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}
