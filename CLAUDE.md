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
yarn aquarium:preview      # regenerate src/docs/aquarium-preview.html — the fish/creature art iteration loop
yarn aquarium:design       # local server + browser UI to live-tune the 2D V2 scene
yarn verify:aquarium       # headless 2D V2 checks — anatomy invariants, bakes, spine-warp, scene composition
yarn tank:design           # local server + live 3D scene to tune the whole 3D tank (writes tank-design.ts)
yarn verify:3d             # headless 3D checks — geometry, patterns, bake budget, drift fingerprints
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

[aquarium-canvas.tsx](src/shared/aquarium/render/aquarium-canvas.tsx) composes water, sand, planted decor, and fish/creatures; the same canvas renders the tank (many individuals) and the in-session view (one centered growing fish) via the `mode` prop. Animation uses Skia `useClock()`-driven Reanimated `SharedValue`s passed straight into Skia props — use Skia's `interpolateColors`, not Reanimated's `interpolateColor`.

Rendering is capped at `TANK_CAPACITY` (25, [tank-membership.ts](src/shared/lib/tank-membership.ts)). Which fish occupy those 25 slots is explicit, not just "newest": `sessions.inTank` (0/1) marks tank membership, and fish beyond capacity live in the **Holding Tank** ([holding-tank](src/features/holding-tank) feature, `/holding-tank` route) — a screen where the user swaps fish in and out. A dead fish's corpse also disappears from view (though its `inTank` flag and row are untouched) 24h after `endedAt` (`DEAD_FISH_TTL_MS`), which is what lets a slot free itself for the next completed session to auto-join without any write.

### How a fish is drawn — read this before touching fish art

[src/shared/aquarium/](src/shared/aquarium/) is the 2D renderer — self-contained (see its [README.md](src/shared/aquarium/README.md) for the full import allowlist) and Skia-only, no separate SVG/declarative backends to keep in sync. A trait combination goes through anatomy (`fish/anatomy.ts`, `fish/fins.ts`) → pigment (`fish/pigment.ts`, `fish/pattern-defs.ts`) → a bake (`fish/bake-fish.ts` through `core/bake.ts`) that produces one texture per fish, animated with a spine-warp shader (`core/sksl/warp.ts`) while swimming. Non-molly species (otter/turtle/frog/axolotl/snail) follow the same shape under `creatures/<species>/`, dispatched through `creatures/bake-creature.ts`.

Read [src/docs/aquarium-guide.md](src/docs/aquarium-guide.md) before changing anything under `src/shared/aquarium/fish/`, `creatures/`, `scene/`, or `sim/` — it has the full design rationale (why a rigid single-texture bake instead of the old three-layer approach, the anatomy pipeline, the swim model) and points at [src/docs/fish-art-guide.md](src/docs/fish-art-guide.md)'s equivalent function-by-function map, ported for this tree.

`yarn aquarium:preview` regenerates [src/docs/aquarium-preview.html](src/docs/aquarium-preview.html): every colour × life stage × body/tail/dorsal combo, a yaw strip, a full-scene composite, and every non-molly species × variant, from the exact code the app runs. **This is the iteration loop for art work — no device needed.** `yarn verify:aquarium` runs the same tree's headless invariant checks (anatomy, bake, spine-warp fold-safety, scene composition, a swim trace) — run it after any change under `fish/`, `creatures/`, `scene/`, or `sim/`.

Fish are **generated, not authored**: ~480 trait combinations, so there is no sprite sheet. One baked texture per individual (not three, unlike the old renderer this replaced), byte-budgeted LRU-cached per art kind (`render/fish-cache.ts`, `render/creature-cache.ts`, `render/decor-cache.ts`). Dead fish/creatures are the same drawing with a grayscale `ColorMatrix` (`render/dead-fish.ts`'s `DEAD_GRAYSCALE_MATRIX`/`DEAD_OPACITY`), flipped, resting on the sand — there is no separate dead artwork.

### The 3D tank

There is a **second, opt-in renderer**: real three.js geometry behind a persisted 2D V2/3D toggle on the Tank screen ([render-mode-store.ts](src/shared/store/render-mode-store.ts), switched by [tank-view.tsx](src/shared/components/tank/tank-view.tsx)). It is molly-only and it is not a port of the 2D art — the mesh is authored separately — but it shares molly's **pigment** with the 2D tree via [src/shared/fish/render-spec.ts](src/shared/fish/render-spec.ts): the fish trait IR that art now targets only for this purpose (the old 2D renderer that also read it is gone). `raster.ts` rasterizes `render-spec.ts`'s `buildFishSpec(...).skinAlbedo` into a texture the 3D body wears (via `skin-map.ts`), so a colour or pattern edit in `render-spec.ts` lands in the 3D tank. Lighting is deliberately _excluded_ from that texture; 3D lights it for real.

Every tunable value in the 3D scene lives in one place, [tank-design.ts](src/shared/components/tank/tank-design.ts), which the app, the browser preview and the editor all read — that shared module is what stops the preview drifting from the device. **Read [src/docs/tank-3d-guide.md](src/docs/tank-3d-guide.md) before changing anything 3D**, and use `yarn tank:design` rather than editing constants by hand. `expo-gl` is a native module, so 3D changes need a real `eas build` before an `eas update` can carry them.
