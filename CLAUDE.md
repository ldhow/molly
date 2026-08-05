# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Molly — a Forest-style focus app themed as an aquarium. A focus session grows a molly fish; completing it adds a live fish to your tank, leaving the app mid-session (past a 10s grace period) kills it and the dead fish stays in the tank. Expo SDK 57 (React Native 0.86, React 19), iOS + Android.

**Business/product context lives in [src/docs/](src/docs/) — read it before working.** [src/docs/PLAN.md](src/docs/PLAN.md) is the authoritative design doc: data model, session state machine, Skia scene, unlock rules, phased plan, and a manual verification checklist. Read it before changing session, tank, or unlock behavior.

## Commands

```sh
npx expo start          # dev server; the only supported workflow (Expo Go)
npx expo start --web
npx drizzle-kit generate   # after editing src/db/schema.ts — writes src/db/migrations/ (commit it)
npx tsc --noEmit           # typecheck
npx expo lint              # ESLint is not installed yet; this prompts to set it up
```

No test runner is configured. The pure modules (`features/session/utils/machine.ts`, `features/stats/utils/stats.ts`, `features/fish/utils/unlocks.ts`, `shared/utils/`) are written to be unit-testable if one is added; until then, verify behavior with the checklist at the end of [src/docs/PLAN.md](src/docs/PLAN.md).

`ios/` and `android/` are gitignored generated output — don't hand-edit them; change [app.json](app.json) instead.

## Hard constraints

- **Expo Go only.** `@shopify/react-native-skia` is pinned to **2.6.2** because that is the version bundled in Expo Go for SDK 57. Upgrading it (or adding any package with custom native code) forces a dev build and breaks the workflow.
- **SDK 57 API surfaces changed.** Per [AGENTS.md](AGENTS.md), re-read the exact page at https://docs.expo.dev/versions/v57.0.0/ for each Expo API immediately before writing code against it.
- **`reactCompiler` and `typedRoutes` are on** ([app.json](app.json) `experiments`). Typed routes means `router.push("/session")` is checked against the file tree.

## Architecture

### Layering

`src/app/` holds expo-router routes **only** — each is a thin re-export of a feature screen (see [src/app/session.tsx](src/app/session.tsx)). All real code lives in `src/features/<feature>/` with a uniform internal layout (`screens/ components/ hooks/ store/ utils/ constants/ types/`, folders omitted when empty), or in `src/shared/` when reused across features. Imports use the `@/*` → `src/*` and `@/assets/*` → `assets/*` aliases.

[src/app/_layout.tsx](src/app/_layout.tsx) is the composition root: it gates rendering on `useMigrations`, provides the React Query client, installs the notification handler, and mounts `useSessionController` once.

### One table is the source of truth

`sessions` ([src/db/schema.ts](src/db/schema.ts)) is the only table. Tank contents, stats, streaks, and variant unlocks are all **derived** from session rows via pure functions — there are no denormalized counters and nothing else is persisted. `useSessions` ([src/shared/hooks/useSessions.ts](src/shared/hooks/useSessions.ts)) owns the single `['sessions']` query key; every feature hook (`useOwnedFish`, `useStats`, `useUnlocks`) builds on it. Ending a session inserts one row and invalidates that key, which is what makes every screen update at once.

`localDate` (YYYY-MM-DD) is computed in JS at insert time so stats grouping can't drift by a day across UTC boundaries — never derive the day from `endedAt` at read time.

Drizzle migrations are bundled as SQL text: `babel-plugin-inline-import` + `sourceExts: ['sql']` in [metro.config.js](metro.config.js) make `import migrations from "@/db/migrations/migrations"` work. Regenerate with drizzle-kit, don't hand-write migration files.

### Session engine — the correctness-critical part

Three pieces, deliberately separated:

- [features/session/utils/machine.ts](src/features/session/utils/machine.ts) — **pure** functions of `(session, now)`. Every life/death decision is timestamp arithmetic; nothing depends on a timer having fired, because JS timers are throttled or suspended in the background.
- [features/session/store/session-store.ts](src/features/session/store/session-store.ts) — Zustand, holding the active-session snapshot. It persists via a **synchronous** `expo-sqlite/kv-store` adapter specifically so cold-start judgment can't race async rehydration. Only `active` is persisted (`partialize`); `result` and `graceRecovered` are in-memory.
- [features/session/hooks/useSessionController.ts](src/features/session/hooks/useSessionController.ts) — the glue, mounted once from the root layout. Cold-start judgment of an orphaned snapshot, `AppState` transitions (iOS `inactive` is treated as backgrounded; the grace period absorbs flickers), and a 500ms derived-completion watcher.

All terminal paths funnel through `useSettleSession` ([src/features/session/hooks/useSettleSession.ts](src/features/session/hooks/useSettleSession.ts)) — it is idempotent by design (later callers see `active === null` and no-op), so multiple watchers racing to end the same session is safe. Add new session outcomes there, not in the controller.

When changing session logic, put the decision in `machine.ts` as a pure function and keep the hooks as dumb wiring.

### Skia tank

[TankCanvas](src/features/tank/components/TankCanvas.tsx) composes water, sand, plants, bubbles, and fish; the same canvas renders the tank (many fish) and the in-session view (one centered growing fish) via the `mode` prop. Animation uses Skia `useClock()` + Reanimated `useDerivedValue` passed straight into Skia props — use Skia's `interpolateColors`, not Reanimated's `interpolateColor`.

[FishSprite](src/features/tank/components/FishSprite.tsx) draws a sprite image when one is registered in [sprites.ts](src/features/tank/utils/sprites.ts) and otherwise falls back to a built-in vector renderer driven by `FishVariant.colors/bodyShape/finShape`. **The sprite manifest is currently empty** — the app runs entirely on the vector fallback. To ship real art, follow the spec and prompt pack in [assets/fish/README.md](assets/fish/README.md) and register the files in `sprites.ts`; nothing else needs to change. Dead fish are the same drawing with a grayscale `ColorMatrix`, flipped, resting on the sand — there is no separate dead artwork.

Rendering is capped at `MAX_RENDERED_FISH` (25) with a "+N more" count.
