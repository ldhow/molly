// src/shared/lib/errors.ts
//
// Turns whatever was thrown into something safe to show a user.
// Raw API errors ("Request failed with status code 500", a JSON blob, a
// TypeError from a null field) are not user-facing copy, so anything the app
// doesn't explicitly recognise collapses to the generic fallback.

export const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";
export const OFFLINE_ERROR_MESSAGE = "You appear to be offline. Check your connection.";

/** Thrown by the API client for non-2xx responses. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Copy the backend intends for end users, if the contract provides it. */
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /network request failed|failed to fetch/i.test(error.message)
  );
}

/**
 * Resolve display copy for an error. Precedence:
 *   explicit override  >  backend user-facing message  >  offline  >  fallback
 */
export function getErrorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof ApiError && error.userMessage) {
    return error.userMessage;
  }
  if (isNetworkError(error)) {
    return OFFLINE_ERROR_MESSAGE;
  }
  return fallback;
}
