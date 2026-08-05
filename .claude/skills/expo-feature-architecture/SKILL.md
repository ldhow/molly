---
name: expo-feature-architecture
description: Feature-based architecture for Expo + React Native apps (Expo Router, TypeScript, NativeWind, TanStack Query, Zustand/Context, Jest + RNTL, ESLint + Prettier). Use when starting a new Expo project, adding a feature or screen, deciding where a component/hook/API call/screen/store belongs, or reviewing/refactoring an Expo codebase for structure. Trigger on "feature folder", "feature-based architecture", "project structure", "folder structure", "where should this file go", Expo Router routes, ESLint or Prettier setup, import boundary enforcement, centralized or global API error handling, TanStack Query meta, or any request to create a screen, component, hook, or API integration in an Expo app — even when architecture is not mentioned. Governs scaffolding AND the ongoing rules Claude follows whenever it writes code in such an app (import boundaries, naming, state placement, styling, testing, linting, formatting, error-handling placement, route-vs-feature separation).
---

# Expo Feature-Based Architecture

A skill for structuring Expo + React Native apps around **features** (self-contained domains like `auth`, `checkout`, `profile`) instead of technical layers dumped in one flat pile. Each feature owns its components, hooks, API calls, local state, types, and tests. Features never reach into each other's internals. **Expo Router's `src/app/` directory stays reserved for routing only** — it must not become a dumping ground for logic.

Stack this skill assumes: **Expo + Expo Router + TypeScript, NativeWind (Tailwind classes on RN components), TanStack Query (server state), Zustand or Context (local/client state), Jest + React Native Testing Library, ESLint (flat config) + Prettier.**

## When to use this

- **New project** → scaffold the full skeleton (`src/app/` router shell, `src/features/`, `src/shared/`, NativeWind config, ESLint + Prettier config, query client).
- **New feature** → scaffold one feature folder under `src/features/`, then wire a thin route file in `src/app/` to it.
- **Any code-writing task in an Expo app** (a screen, component, hook, API call, store) → place it correctly per the rules below and follow naming/state/styling/testing conventions, even if the user didn't ask about architecture explicitly.
- **Reviewing/refactoring** → check for import-boundary violations, logic leaking into `src/app/` route files, misplaced state, and per-call error handling that should be centralized.

## The key Expo-specific rule: `src/app/` is routes only

Expo Router treats every file under `src/app/` as a route — the file path *is* the URL path. This means, unlike a typical web React project, `src/app/` **cannot** be used to hold feature logic, shared providers, or arbitrary components; anything placed there either becomes a route or breaks routing conventions.

So the split is:
- **`src/app/`** — route files only. Each route file is a **thin wrapper** that imports a screen component from a feature's `screens/` folder and renders it. Layouts (`_layout.tsx`), tab/stack config, and route params live here — not business logic.
- **`src/` (everything except `src/app/`)** — features, shared code, providers, lib. Within each feature, `screens/` holds the top-level screen(s) a route renders; `components/` holds smaller reusable pieces used by those screens (or by each other) — never a route target itself.

## Top-level structure

```
src/
├── app/                      # Expo Router — ROUTES ONLY, kept thin
│   ├── _layout.tsx            # root layout: wraps app in <AppProviders>, loads fonts/splash
│   ├── (tabs)/
│   │   ├── _layout.tsx         # tab bar config
│   │   ├── index.tsx            # imports & renders a feature's Screen component
│   │   └── profile.tsx
│   └── [id].tsx                 # dynamic route, still just imports+renders
├── providers/
│   ├── AppProviders.tsx      # QueryClientProvider, ThemeProvider, etc.
│   └── queryClient.ts         # QueryClient + centralized query/mutation feedback
├── features/
│   └── <feature-name>/       # kebab-case, e.g. "auth", "profile", "checkout"
│       ├── screens/            # top-level screen(s) that routes render — nothing else goes here
│       ├── components/        # feature-scoped UI components (View/Text-based)
│       ├── hooks/              # feature-scoped non-query hooks
│       ├── api/                # fetch functions + TanStack Query hooks
│       ├── store/               # optional: Zustand store or Context for feature-local client state
│       ├── types/
│       │   └── index.ts
│       └── index.ts             # PUBLIC API — includes a top-level `<Feature>Screen` for routes to render
├── shared/                   # reused across 2+ features; never imports from features/
│   ├── components/            # Button, Card, etc. (RN primitives + NativeWind)
│   ├── hooks/
│   ├── lib/                    # utils, api client instance, cn(), notifier port, error helpers
│   ├── types/
│   │   └── query-meta.ts       # TanStack Query `meta` typing (module augmentation)
│   └── ...
└── global.css                # NativeWind directives

assets/                       # images/fonts — stays at the ROOT, see note below
tailwind.config.js
eslint.config.js              # flat config — also enforces the import boundaries below
.prettierrc                   # formatting, incl. Tailwind class sorting
.prettierignore
```

`src/app/` is a first-class Expo Router location, not a workaround — Expo's own default template uses it from SDK 55 on. Two things must be true for it to work:

- **`tsconfig.json` maps `"@/*"` to `"./src/*"`**, which is why every import in this skill reads `@/features/profile`, not `@/src/features/profile`.
- **No `app/` directory at the project root.** If both exist the root one wins and `src/app/` is silently ignored — a confusing failure mode when migrating.

Leave `assets/` (images, fonts, splash) at the project root. Moving it into `src/` means updating every path in `app.json`, and native prebuild tooling has historically been brittle about it. Nothing is gained: the argument for `src/app/` is keeping *source* together, and binary assets aren't source.

Run `scripts/scaffold_feature.sh` to generate this (see "Scaffolding" below).

## Import boundary rules (enforce these — this is the core of the skill)

1. **`src/app/` route files only import — never define — logic.** A route file should be a handful of lines: import a `<Feature>Screen` from `@/features/<name>` (via its `screens/` folder, exposed through `index.ts`) and render it, plus route-specific config (`Stack.Screen options`, params via `useLocalSearchParams`).
2. **No cross-feature imports.** `src/features/checkout` must never import from `src/features/auth/components/...` or any other feature's internals. If two features need the same thing, promote it to `src/shared/`.
3. **Only import a feature through its `index.ts`.** From *outside* the feature (including from `src/app/`): `import { ProfileScreen } from "@/features/profile"` ✅ — never reach into `@/features/profile/screens/...` or `.../components/...` ❌. Inside the feature, relative imports between its own files are fine.
4. **`index.ts` is a curated public API.** Export the `<Feature>Screen(s)` from `screens/` (what routes render) plus any `components/`/hooks genuinely needed elsewhere. Internal helpers stay unexported.
5. **`src/shared/` never imports from `src/features/`.** One-way dependency: features depend on shared, never the reverse.
6. **`screens/` only holds route-level screens, never a home for reusable pieces.** If a "screen" component starts getting reused by more than one route, that's a signal it should be broken up: keep a thin screen per route in `screens/`, and move the reusable parts into `components/`.

These aren't honour-system rules — `eslint.config.js` encodes rules 1, 2, 3 and 5 as `no-restricted-imports` patterns scoped by directory, so a violation fails `npm run lint` rather than surviving review. See "Linting" below.

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Feature folder | kebab-case, domain noun | `user-profile`, `checkout` |
| Screen component (in `screens/`, exported from index.ts, rendered by a route) | PascalCase + `Screen` suffix | `screens/ProfileScreen.tsx` |
| Component file (in `components/`) | PascalCase.tsx | `components/ProfileCard.tsx` |
| Hook file | camelCase, `use` prefix | `useProfileForm.ts` |
| Query hook | `use<Noun><Verb>Query` / `...Mutation` | `useProfileQuery`, `useUpdateProfileMutation` |
| Store file | camelCase + `Store` | `profileStore.ts` |
| Types file | always `types/index.ts`, PascalCase exports | `export interface Profile { ... }` |
| Test file | colocated, same name + `.test.tsx`/`.test.ts` | `ProfileCard.test.tsx` |
| Route file (in `src/app/`) | dictated by Expo Router file conventions | `(tabs)/profile.tsx`, `[id].tsx` |

## Where state goes

- **Server state** (anything fetched from an API) → **always TanStack Query**, hooks live in `src/features/<name>/api/`. Never mirror server data into `useState`, Context, or Zustand — read it from the query cache (`useQuery`) and mutate via `useMutation`.
- **Feature-local client state** shared by several components within one feature (e.g., a multi-step form's current step, active filters) → a **Zustand store** in `src/features/<name>/store/` if nontrivial, or **React Context** for simpler prop-drilling relief. Prefer plain `useState`/`useReducer` when only one component needs it.
- **Cross-feature global client state** (rare — e.g. current logged-in user, theme, auth token) → lives in `src/providers/` or `src/shared/`, never inside a single feature's folder.
- **Route params** (`useLocalSearchParams`, `useLocalSearchParams<Params>()`) are read in the route file and passed as props into the feature's Screen component — the feature itself shouldn't call Expo Router hooks directly inside deeply nested components; keep router coupling at the screen's top level where practical.

Decision order when adding new state: *is it server data? → Query. Is it a route param? → read in the route file, pass down. Is it used by 2+ components in one feature? → store/Context. Otherwise → local `useState`.*

## Centralized query/mutation feedback

Every query and mutation failure — and every mutation success worth announcing — is caught in **one place**: the `QueryCache` / `MutationCache` callbacks on the `QueryClient` in `src/providers/queryClient.ts`. Features do not each roll their own `try/catch`, `Alert.alert`, or `onError` toast call; they **declare intent** via TanStack Query's `meta` field and let the provider decide what to do with it.

```ts
// src/features/profile/api/useUpdateProfileMutation.ts
return useMutation({
  mutationFn: updateProfile,
  meta: {
    successMessage: "Profile updated",
    errorMessage: "Couldn't update your profile",
  },
});
```

**This skill deliberately does not choose a presentation mechanism.** The provider catches the outcome and emits it to a **notifier port** (`src/shared/lib/notifier.ts`) — a one-function interface, no-op by default. The app decides at wiring time whether that becomes a snackbar, a push notification, a native `Alert`, a banner, or silence, by calling `setNotifier(...)` once in `AppProviders`. Swapping presentation later touches exactly one file and no feature code.

Rules:

1. **Never handle an API error inside a component or screen for the sole purpose of showing a message.** Declare `meta.errorMessage` and let the cache handle it.
2. **Mutations notify on error by default** (the user pressed a button; silence reads as a bug). Opt out per-mutation with `meta.suppressGlobalError: true` when the UI already communicates the failure inline — e.g. a login form that renders a field-level error.
3. **Queries stay quiet by default.** A first-load failure should render the screen's own error/retry state, not a floating message. Two exceptions the provider handles automatically: a query with an explicit `meta.errorMessage`, and a *background refetch* failure (`query.state.data !== undefined`) where the screen still shows stale data and would otherwise fail invisibly.
4. **Local `onSuccess`/`onError` are for side effects, not messaging** — cache invalidation, navigation, resetting a form. The cache-level callback runs *before* the hook-level one, so both coexist cleanly.
5. **`meta` is typed, not free-form.** `src/shared/types/query-meta.ts` augments TanStack Query's `Register` interface so `successMessage`, `errorMessage` and `suppressGlobalError` autocomplete and typos fail typecheck.
6. **Keep transport concerns out of `meta`.** Retry counts, auth refresh, and status-code mapping belong to the API client in `src/shared/lib/`, not to per-feature metadata.

Full implementation — `queryClient.ts`, `notifier.ts`, the `meta` typing, `AppProviders.tsx`, adapter examples for snackbar/push/Alert, and testing guidance — is in `references/query-feedback.md`. Ready-to-copy files are in `assets/notifications/`.

## Styling (NativeWind)

- Use `className` directly on core RN components (`View`, `Text`, `Pressable`, `ScrollView`, etc.) — no `StyleSheet.create` for anything expressible in Tailwind utilities.
- `src/global.css` holds only the three Tailwind directives; `tailwind.config.js` sets `content` to scan `./src/**/*.{js,jsx,ts,tsx}` — one glob now covers routes and features alike.
- Compose conditional classes with the shared `cn()` helper (clsx + tailwind-merge) from `src/shared/lib/cn.ts` — never string-concatenate classes.
- For styles NativeWind can't express (complex shadows, platform-specific tuning), fall back to a small `StyleSheet.create` colocated in the same file — don't fight the tool.

## Formatting (Prettier)

Prettier owns all formatting; ESLint owns correctness. They never overlap — `eslint-config-prettier` turns off every stylistic ESLint rule, so there is exactly one tool that can complain about a line break.

- `.prettierrc` lives at the project root and is checked in; never rely on editor defaults.
- `prettier-plugin-tailwindcss` sorts NativeWind `className` strings into canonical Tailwind order, and is configured with `tailwindFunctions: ["cn"]` so classes inside the `cn()` helper get sorted too. This kills a whole category of pointless diffs.
- Don't run Prettier *as* an ESLint rule (`eslint-plugin-prettier`) — it makes lint slow and reports formatting as errors. Run it as its own script.
- Scripts: `format` (write) and `format:check` (CI). `.prettierignore` excludes `node_modules`, `.expo`, `dist`, `android`, `ios`, and lockfiles.

Exact config: `assets/prettierrc.json`, `assets/prettierignore`. Setup and scripts: `references/tooling-setup.md`.

## Linting (ESLint flat config)

ESLint is the enforcement mechanism for this skill's architecture, not just a style checker. `eslint.config.js` (flat config, ESLint 9+) extends `eslint-config-expo/flat`, then layers directory-scoped rules:

- **`src/app/**`** — bans deep feature imports (`@/features/*/*`), so routes can only touch a feature's public API. A `max-lines` warning keeps route files thin; if a route trips it, the logic belongs in a Screen component.
- **`src/features/**`** — bans *all* `@/features/*` imports. Inside your own feature you use relative paths, so any aliased feature import is by definition a cross-feature import. Also bans importing from `src/app/`.
- **`src/shared/**`** — bans `@/features/*` and `@/features/*/*`, enforcing the one-way dependency.
- **`src/**`** — `import/no-default-export`, because feature code is consumed through named barrel exports. `src/app/**` is exempt: Expo Router requires a default export from every route.

When adding a new top-level directory under `src/`, add its boundary block to `eslint.config.js` at the same time — an unlisted directory is an unenforced one.

Exact config with comments: `assets/eslint.config.js`. Install steps, scripts, CI wiring and pre-commit setup: `references/tooling-setup.md`.

## Testing (Jest + React Native Testing Library)

- Colocate tests next to source: `Component.tsx` + `Component.test.tsx` in the same folder.
- Import from `@testing-library/react-native`, not `@testing-library/react`.
- Test hooks with `renderHook` from `@testing-library/react-native`.
- Mock network calls in `api/` tests — never hit real endpoints. Mock `expo-router` navigation hooks (`useRouter`, `useLocalSearchParams`) when a component under test uses them.
- A feature's `index.ts` barrel is not itself tested; test the underlying files.
- Route files in `src/app/` are thin enough that they typically don't need their own tests — test the Screen component they render instead.
- **Feature tests assert on `meta`, not on notifications.** A mutation hook's contract is that it declares `meta.successMessage` — that it becomes a snackbar is the provider's business. Test the provider's dispatch logic once, in `src/providers/queryClient.test.ts`, with a fake notifier.
- Build test query clients with `retry: false` so failure paths don't take three seconds.

## Scaffolding

Use `scripts/scaffold_feature.sh` to generate folders and boilerplate files.

**New project skeleton:**
```bash
bash scripts/scaffold_feature.sh --init <project-root>
```
Creates `src/app/_layout.tsx`, `src/providers/` (including `queryClient.ts` wired to the notifier port), `src/shared/`, `src/global.css`, `tailwind.config.js`, and copies `eslint.config.js`, `.prettierrc` and `.prettierignore` from `assets/`. On SDK 55+ templates `src/app/` already exists; on older templates it moves a root-level `app/` into `src/` and rewrites the `@/*` alias for you. It prints the `npm i -D` command for the lint/format dependencies rather than installing them.

**New feature:**
```bash
bash scripts/scaffold_feature.sh <project-root> <feature-name>
```
Example: `bash scripts/scaffold_feature.sh . user-profile` creates `src/features/user-profile/` with `screens/`, `components/`, `hooks/`, `api/`, `store/`, `types/index.ts`, and `index.ts` exporting a `UserProfileScreen` from `screens/`, plus a sample query hook (with `meta` filled in) and a sample test. It prints — but does not auto-create — a suggested route file snippet, since where a route belongs (which tab, which stack, static vs dynamic segment) depends on your navigation structure.

After scaffolding, fill in the placeholders with real logic — don't leave the sample `Placeholder` component/hook in place — add the printed route stub to the right place in `src/app/`, and run `npm run lint && npm run format` to confirm the new files pass the boundary rules.

## Reference files

- `references/tooling-setup.md` — Prettier + ESLint install, full annotated configs, package.json scripts, CI and pre-commit wiring, and how to migrate an existing project onto these rules without a 500-file diff.
- `references/query-feedback.md` — the centralized catch: `queryClient.ts`, the notifier port, `meta` typing, `AppProviders.tsx`, adapters for snackbar / push notification / native Alert, and how to test it.
- `references/example-feature.md` — a complete, realistic feature (`todos`) with every file filled in: Screen component, query hooks, mutation with `meta`, Zustand store, types, tests, and the route file that wires it up. Use it as the reference when generating real code, not just the skeleton.

Ready-to-copy files live in `assets/`.
