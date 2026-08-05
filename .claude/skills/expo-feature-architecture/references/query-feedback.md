# Centralized query/mutation feedback

Read this when wiring up `AppProviders`, writing a query/mutation hook in a feature, or deciding where an API error should be handled. Ready-to-copy files are in `assets/query-feedback/`.

## Contents

1. [The idea](#the-idea)
2. [Files and where they go](#files-and-where-they-go)
3. [Declaring intent from a feature](#declaring-intent-from-a-feature)
4. [Dispatch rules](#dispatch-rules)
5. [Choosing a presentation mechanism](#choosing-a-presentation-mechanism)
6. [Errors that aren't notifications](#errors-that-arent-notifications)
7. [Testing](#testing)
8. [Anti-patterns](#anti-patterns)

---

## The idea

TanStack Query's `QueryCache` and `MutationCache` accept `onError`/`onSuccess` callbacks that fire for **every** query and mutation in the app, no matter which feature owns them. That makes the cache the natural place to catch failures once — instead of thirty `onError` handlers that each do something slightly different and three that forgot.

The feature side of the contract is `meta`: an arbitrary object attached to a query or mutation, readable from the cache callbacks. A feature says *what it means*; the provider decides *what happens*.

```
feature declares          provider catches           app presents
─────────────────         ────────────────           ────────────
meta: {              →    QueryCache /          →    notifier port
  successMessage,          MutationCache              (snackbar? push?
  errorMessage,            callbacks                   Alert? nothing?)
  suppressGlobalError
}
```

Three seams, each replaceable without touching the others. The important one for this skill: **no feature file imports a notification library.** Swapping snackbar for push notifications is a one-file change in `AppProviders.tsx`.

## Files and where they go

| Asset | Destination | Role |
|---|---|---|
| `notifier.ts` | `src/shared/lib/notifier.ts` | The port. One function, no-op by default. |
| `errors.ts` | `src/shared/lib/errors.ts` | Turns thrown values into safe user-facing copy. |
| `query-meta.ts` | `src/shared/types/query-meta.ts` | Types `meta` via `Register` augmentation. |
| `queryClient.ts` | `src/providers/queryClient.ts` | The centralized catch. |
| `AppProviders.tsx` | `src/providers/AppProviders.tsx` | Binds the port to a real mechanism. |

`src/app/_layout.tsx` stays thin, as always:

```tsx
import { Stack } from "expo-router";
import { AppProviders } from "@/providers/AppProviders";
import "../global.css";

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack />
    </AppProviders>
  );
}
```

Note the direction of dependencies: `providers/` imports from `shared/`, never the reverse. That's why the port lives in `shared/lib/` — feature code may legitimately need `notify()` for non-query events, and features can't import from `providers/`.

## Declaring intent from a feature

A mutation that should confirm success and explain failure:

```ts
// src/features/profile/api/useUpdateProfileMutation.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateProfile } from "./profileApi";
import { profileKeys } from "./profileKeys";

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProfile,
    meta: {
      successMessage: "Profile updated",
      errorMessage: "Couldn't update your profile",
    },
    // Local handlers are for side effects, not messaging.
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(profile.id) });
    },
  });
}
```

A mutation whose failure is already visible in the form:

```ts
export function useLoginMutation() {
  return useMutation({
    mutationFn: login,
    // The form renders "Incorrect email or password" under the field. A second
    // floating message on top of that is noise.
    meta: { suppressGlobalError: true },
  });
}
```

A query — usually no `meta` at all:

```ts
export function useProfileQuery(id: string) {
  return useQuery({
    queryKey: profileKeys.detail(id),
    queryFn: () => fetchProfile(id),
    // No meta: a first-load failure renders the screen's error state, and a
    // background refetch failure notifies automatically.
  });
}
```

## Dispatch rules

What `queryClient.ts` does with each outcome:

| Source | Outcome | Condition | Result |
|---|---|---|---|
| Mutation | success | `meta.successMessage` set | notify success |
| Mutation | success | no `successMessage` | silent |
| Mutation | error | `meta.suppressGlobalError` | silent |
| Mutation | error | otherwise | notify error — `meta.errorMessage`, else derived from the error |
| Query | error | `meta.suppressGlobalError` | silent |
| Query | error | `meta.errorMessage` set | notify error |
| Query | error | data already cached (background refetch) | notify error |
| Query | error | first load, no `meta` | **silent** — screen renders its own error state |

Two asymmetries worth understanding, because they're the reasoning that makes the rest consistent:

**Mutations notify on failure by default; queries don't.** A mutation follows a deliberate user action, so silence reads as a broken button. A query often runs on mount, where the screen itself has room to show a proper error state with a retry affordance — much more useful than a message that disappears in three seconds.

**Background refetch failures do notify.** The screen is showing stale data and looks fine, so the failure is otherwise invisible. This is the one query case where a transient message is the right medium.

**Ordering:** cache-level callbacks run *before* the hook's own `onSuccess`/`onError`, and TanStack Query awaits them if they return a promise. Local handlers keep working normally; keep them for invalidation, navigation, and form resets.

## Choosing a presentation mechanism

Replace `appNotifier` in `AppProviders.tsx`. Everything below is illustrative — pick one, or write your own; nothing else in the codebase changes.

**Snackbar** (e.g. `react-native-paper`, `react-native-toast-message`, or your own component driven by a Zustand store):

```ts
const appNotifier: NotifierFn = ({ level, message }) => {
  showSnackbar({ message, variant: level });
};
```

**Native alert** — heavier, blocks interaction; reasonable for errors only:

```ts
import { Alert } from "react-native";

const appNotifier: NotifierFn = ({ level, message }) => {
  if (level === "error") Alert.alert("Error", message);
};
```

**Local push notification** (`expo-notifications`) — for outcomes that matter when the app is backgrounded, like a long upload finishing:

```ts
import * as Notifications from "expo-notifications";

const appNotifier: NotifierFn = ({ level, message, source }) => {
  if (source !== "mutation") return;
  void Notifications.scheduleNotificationAsync({
    content: { title: level === "error" ? "Something went wrong" : "Done", body: message },
    trigger: null,
  });
};
```

**Split by level or source** — errors as a blocking alert, successes as a snackbar:

```ts
const appNotifier: NotifierFn = (notification) => {
  if (notification.level === "error") alertNotifier(notification);
  else snackbarNotifier(notification);
};
```

**Add crash reporting anywhere in there.** The port sees every failure in the app, which makes it the right place for `Sentry.captureException(error)` — and that stays true regardless of which UI you pick, including no UI at all.

## Errors that aren't notifications

Centralized messaging doesn't mean centralized *handling*. Keep these where they belong:

- **Auth refresh, retries, status-code mapping** → the API client in `src/shared/lib/`. By the time an error reaches the cache it should already be a normalized `ApiError`.
- **Rendering failures** (a component throwing during render) → an error boundary in `AppProviders`. The query cache doesn't see these.
- **Validation before submit** → the form. Never fire a mutation you already know will fail just to reuse the error path.
- **Recovery logic** — rollback, redirect to login, sign-out on 401 → local `onError`, or an interceptor. The cache callback decides what the user is *told*, not what the app *does*.

## Testing

**Feature hooks assert on `meta`, not on notifications.** The hook's contract is that it declares the right intent:

```ts
it("declares a success message", () => {
  const { result } = renderHook(() => useUpdateProfileMutation(), { wrapper });
  expect(result.current.options?.meta?.successMessage).toBe("Profile updated");
});
```

Simpler still: keep `meta` objects as exported constants and assert on those directly.

**Test the dispatch logic once**, in `src/providers/queryClient.test.ts`, with a fake notifier. `setNotifier` returns a restore function so tests don't leak:

```ts
import { QueryClient } from "@tanstack/react-query";
import { setNotifier, type Notification } from "@/shared/lib/notifier";

it("stays silent on a first-load query failure", async () => {
  const seen: Notification[] = [];
  const restore = setNotifier((n) => seen.push(n));

  // ...trigger a failing query against a test client...

  expect(seen).toHaveLength(0);
  restore();
});
```

Cases worth covering, since they're the rules everything else assumes: mutation success with and without `successMessage`; mutation error respecting `suppressGlobalError`; query first-load failure staying silent; query background-refetch failure notifying.

**Use `createTestQueryClient()`** from `queryClient.ts` — `retry: false` stops failure tests taking seconds, and the isolated cache stops cross-test bleed.

## Anti-patterns

| Don't | Do |
|---|---|
| `try/catch` around a mutation call in a component to show a message | `meta.errorMessage` |
| `Alert.alert` inside a feature's `onError` | let the cache dispatch; bind `Alert` in `AppProviders` if that's the chosen mechanism |
| Import a toast library inside `src/features/**` | import nothing; declare `meta` |
| Copy the raw `error.message` into the UI | `getErrorMessage()` — backend strings aren't user-facing copy |
| Give every query a `successMessage` | queries are silent on success by design |
| Put retry/auth-refresh logic in `meta` | that's the API client's job |
| Read notifier state with a hook inside the cache callback | the callback runs outside React; that's why the port is a module singleton |
