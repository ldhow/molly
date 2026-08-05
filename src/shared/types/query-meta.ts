// Types the `meta` field on every query and mutation in the app.
//
// TanStack Query v5 exposes a `Register` interface for exactly this. Augmenting
// it turns `meta` from an untyped bag into a checked contract: `successMessage`
// autocompletes, and `sucessMessage` fails typecheck instead of silently never
// firing.
//
// This file must be part of the TS program for the augmentation to apply. It is,
// because `queryClient.ts` imports `FeedbackMeta` from it.

export type FeedbackMeta = {
  /**
   * Shown when a mutation succeeds. Ignored for queries — a successful fetch is
   * not news, and announcing every refetch is noise.
   */
  successMessage?: string;

  /**
   * Shown instead of the generic fallback when this operation fails.
   * On a query, providing this also opts the query into notifying on first-load
   * failure (queries are otherwise silent — see queryClient.ts).
   */
  errorMessage?: string;

  /**
   * Opt out of centralized error notification entirely. Use when the UI already
   * communicates the failure inline.
   */
  suppressGlobalError?: boolean;
};

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: FeedbackMeta;
    mutationMeta: FeedbackMeta;
  }
}
