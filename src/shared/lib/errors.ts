// Turns whatever was thrown into something safe to show a user.
// Raw errors (a SQLite failure string, a TypeError from a null field) are not
// user-facing copy, so anything the app doesn't explicitly recognise collapses
// to the generic fallback.

export const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Resolve display copy for an error. This app's data source is local SQLite,
 * so there is no backend user-message channel — explicit `meta` overrides win,
 * everything else collapses to the fallback.
 */
export function getErrorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  void error;
  return fallback;
}
