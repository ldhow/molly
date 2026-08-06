# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Molly — a Forest-style focus app themed as an aquarium. A focus session grows a molly fish; completing it adds a live fish to your tank, leaving the app mid-session (past a 10s grace period) kills it and the dead fish stays in the tank. Expo SDK 57 (React Native 0.86, React 19), iOS + Android.

**Business/product context lives in [src/docs/](src/docs/) — read it before working.** [src/docs/PLAN.md](src/docs/PLAN.md) is the authoritative design doc: data model, session state machine, Skia scene, unlock rules, phased plan, and a manual verification checklist. Read it before changing session, tank, or unlock behavior.

## Commands

```sh
npx expo start --port 8082 # dev server against the EAS dev build (8081 is taken)
npx expo start --web
npx drizzle-kit generate   # after editing src/db/schema.ts — writes src/db/migrations/ (commit it)
yarn fish:preview          # regenerate src/docs/fish-preview.html — the fish-art iteration loop
yarn fish:colors           # local server + browser UI to live-tune palette/pattern colors per variety
npm run verify             # typecheck + lint + format:check
```

Note `format:check` is currently red across ~80 pre-existing files; `npx prettier --check` the files you touched rather than reading the whole-repo result as a regression.

No test runner is configured. The pure modules (`features/session/utils/machine.ts`, `features/stats/utils/stats.ts`, `features/fish/utils/unlocks.ts`, `shared/utils/`) are written to be unit-testable if one is added; until then, verify behavior with the checklist at the end of [src/docs/PLAN.md](src/docs/PLAN.md).

`ios/` and `android/` are gitignored generated output — don't hand-edit them; change [app.json](app.json) instead.

## Hard constraints

- **EAS development build.** This was "Expo Go only" with `@shopify/react-native-skia` pinned to **2.6.2** (the version Expo Go bundles for SDK 57). The project has since moved to a dev build, so the pin and the no-native-code rule are no longer hard constraints. 2.6.2 is nonetheless still what the fish renderer targets, and it already provides every primitive that renderer needs — treat a Skia upgrade as an independent decision, not a prerequisite for anything.
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

[tank-canvas.tsx](src/shared/components/tank/tank-canvas.tsx) composes water, sand, plants, bubbles, and fish; the same canvas renders the tank (many fish) and the in-session view (one centered growing fish) via the `mode` prop. Animation uses Skia `useClock()` + Reanimated `useDerivedValue` passed straight into Skia props — use Skia's `interpolateColors`, not Reanimated's `interpolateColor`.

Rendering is capped at `TANK_CAPACITY` (25, [tank-membership.ts](src/shared/lib/tank-membership.ts)). Which fish occupy those 25 slots is explicit, not just "newest": `sessions.inTank` (0/1) marks tank membership, and fish beyond capacity live in the **Holding Tank** ([holding-tank](src/features/holding-tank) feature, `/holding-tank` route) — a screen where the user swaps fish in and out. A dead fish's corpse also disappears from view (though its `inTank` flag and row are untouched) 24h after `endedAt` (`DEAD_FISH_TTL_MS`), which is what lets a slot free itself for the next completed session to auto-join without any write.

### How a fish is drawn — read this before touching fish art

[render-spec.ts](src/shared/fish/render-spec.ts) is the single source of truth. It builds a renderer-agnostic list of primitives (SVG path strings + paint descriptors) for a trait combination, and **must stay free of React/React Native/Skia imports** — it runs under plain Node so the preview gallery can use it.

There are **three backends over that one IR**, and they must be changed together:

| Backend          | File                                                                          | Role                                 |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| Declarative Skia | [fish-sprite.tsx](src/shared/components/tank/fish-sprite.tsx) `PrimitiveNode` | reference implementation             |
| Imperative Skia  | [fish-picture.ts](src/shared/components/tank/fish-picture.ts) `drawSpec`      | what actually ships — feeds the bake |
| SVG              | [fish-preview.ts](scripts/fish-preview.ts) `primitiveSvg`                     | the preview gallery                  |

Each is a `switch` over the same union with an exhaustive `default` that throws, so **adding an IR case fails `npm run typecheck` until all three handle it.** That is the mechanism keeping the preview honest — do not weaken it.

For a function-by-function map of where each part (body, tail, dorsal, pelvic/anal/pectoral, patterns, shimmer, shading, eye/mouth) lives in `render-spec.ts`, see [src/docs/fish-art-guide.md](src/docs/fish-art-guide.md).

`yarn fish:preview` regenerates [src/docs/fish-preview.html](src/docs/fish-preview.html): every colour × life stage, plus dead and locked, from the exact code the app runs. **This is the iteration loop for art work — no device needed.** Only add IR features both Skia and SVG can express; the header comment in `render-spec.ts` carries the mapping table and the list of deliberately-excluded features (sweep gradients, Perlin noise, SkSL) with reasons.

[scripts/fish-path-editor.html](scripts/fish-path-editor.html) is a hand-drawing tool for the body/fin Bézier shapes themselves — open it directly in a browser, no build step. Draw or drag points, load what's currently shipping as a starting point, and it exports `d` strings and landmark/pivot objects shaped to paste directly into `render-spec.ts`.

Fish are **generated, not authored**: ~480 trait combinations, so there is no sprite sheet. `FISH_RENDER_MODE` in `fish-picture.ts` selects `"image"` (default — bake once to a texture, one quad per frame), `"picture"`, or `"nodes"`; each degrades to the next automatically. The `<Image>` sprite path and the empty manifest in [sprites.ts](src/shared/lib/sprites.ts) survive as a per-colour override. Dead fish are the same drawing with a grayscale `ColorMatrix`, flipped, resting on the sand — there is no separate dead artwork.
