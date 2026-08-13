# Molly — Forest-style Focus App as a Molly Fish Tank

## Context

Build a focus/productivity app in the fresh Expo SDK 57 starter at this repo, modeled on Forest but themed as an aquarium: start a focus session and a molly fish grows from egg → fry → juvenile → adult; complete it and the fish joins your tank permanently; leave the app mid-session (beyond a ~10s grace period) and the fish dies — the dead fish stays visible in the tank for 24h as a reminder, then fades from view (the session record itself is never deleted). The tank holds a hard-capped 25 fish at a time; anything beyond that lives in a Holding Tank the user can browse and swap fish in from. V1 also includes stats/history/streaks and multiple molly variants unlocked by session length and streaks. Rendering via Skia canvas. Targets iOS + Android equally.

**Technical stack (user-mandated)**: feature-based architecture · **Zustand** for state · **React Query** for data fetching/caching · **Drizzle ORM** over expo-sqlite.

**Visuals (superseded — see below)**: originally "fish must look realistic → 2D photorealistic sprite images (AI-generated, transparent PNGs) rendered inside the Skia scene — NOT vector-drawn fish."

**Visuals (current, user-confirmed)**: fish are **drawn procedurally** from `src/shared/fish/render-spec.ts`. The sprite-image route was reversed because a fish is 4 independent trait axes (15 colours × 2 bodies × 2 tails × 2 dorsals × 4 life stages ≈ 480 combinations); authored PNGs would either cost 480 images or force the rolled traits to stop being visible. The render spec generates all of them, and the realism instead comes from the drawing itself — radial volume shading, soft-edged patterns, translucent fins, blend-mode gloss — which the widened IR now supports. The `<Image>` sprite path in `fish-sprite.tsx` and the empty manifest in `src/shared/lib/sprites.ts` remain as an override for individual colours. Skia still renders the water, light, bubbles and plants.

**AGENTS.md mandate**: re-read the exact SDK 57 doc page (https://docs.expo.dev/versions/v57.0.0/) for each API immediately before writing its code.

**Species axis (not reconciled below — flag only):** the app grew a second axis this document doesn't reflect yet. A session now grows one of 6 species (`molly` plus `otter`/`turtle`/`frog`/`axolotl`/`snail`), picked pre-session like molly's color, with the non-molly species' own small variant list rolled at completion instead of molly's 4-axis body/tail/dorsal system. `sessions` gained nullable `speciesId`/`creatureVariant` columns; `@/shared/creature/{types,catalog,unlocks,resolve}.ts` is the new species domain (sibling to, not a replacement of, `@/shared/fish/*`); non-molly rendering lives entirely in `src/shared/aquarium/creatures/` and is 2D-V2-only (the legacy 2D and 3D renderers below only ever show a tank's molly individuals — see `src/docs/aquarium-guide.md`'s "Creatures" section for the full design). Everywhere below that says "fish" or describes the 4-trait roll as the only economy should be read as "molly specifically," not the whole app.

## Verified technical decisions

| Concern           | Decision                                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skia              | `@shopify/react-native-skia` **2.6.2** (SDK 57's bundled version, included in Expo Go — no dev build). Do NOT install npm latest (2.10.x) — it would force a dev build.                                                                                                                                                     |
| Skia + Reanimated | Pass Reanimated shared/derived values directly as Skia props; Skia `useClock()` + `useDerivedValue` for continuous motion. Use Skia's `interpolateColors` (not Reanimated's `interpolateColor`).                                                                                                                            |
| DB                | **Drizzle ORM** (`drizzle-orm/expo-sqlite` driver over `openDatabaseSync`) + `drizzle-kit generate` for bundled SQL migrations applied with `useMigrations`. Requires `babel-plugin-inline-import` + metro `sourceExts: ['sql']`. `expo-sqlite/kv-store` backs the Zustand persist storage for the active-session snapshot. |
| Data layer        | **React Query** (`@tanstack/react-query`): queries wrap Drizzle selects (`['sessions']`, etc.); the end-session mutation inserts a row and invalidates. All derived data (fish, stats, streaks, unlocks) computed in query `select`/pure functions — no denormalized counters.                                              |
| App state         | **Zustand** store for the active session (pure state machine + timestamps), persisted via `persist` middleware with `createJSONStorage(() => Storage)` over `expo-sqlite/kv-store` (AsyncStorage-compatible API) so it survives app kill.                                                                                   |
| Notifications     | `expo-notifications` ~57.0.8 — local notifications work in Expo Go (only Android remote push is blocked). `scheduleNotificationAsync` with `TIME_INTERVAL` trigger.                                                                                                                                                         |
| Backgrounding     | RN `AppState` `change` listener. JS timers suspend in background → all life/death judgments are **timestamp-based on foreground return / relaunch**, never background timers.                                                                                                                                               |

Verify while implementing (per AGENTS.md): exact `setNotificationHandler` option names in SDK 57 (`shouldShowBanner`/`shouldShowList` vs older `shouldShowAlert`); current drizzle-kit expo config shape (`dialect: 'sqlite'`, `driver: 'expo'`) and `useMigrations` import path; `reactCompiler` experiment × Reanimated worklets (supported, but toggle off if worklets misbehave).

## Dependencies

```sh
npx expo install @shopify/react-native-skia expo-sqlite expo-notifications expo-haptics
npm i zustand @tanstack/react-query drizzle-orm
npm i -D drizzle-kit babel-plugin-inline-import
```

Config additions: `drizzle.config.ts` (sqlite dialect, expo driver, schema path, out `src/db/migrations`), `metro.config.js` (add `sql` to sourceExts), `babel.config.js` (inline-import for `.sql`). Workflow stays Expo Go (`npx expo start`).

## File structure (feature-based)

Every feature follows the same internal layout: `screens/ components/ store/ types/ hooks/ utils/ constants/` (folders omitted when a feature has nothing for them). `shared/` holds everything reused across features.

```
src/
  app/                          # expo-router routes ONLY — thin re-exports of feature screens
    _layout.tsx                 # providers: QueryClientProvider, db useMigrations gate,
                                # notification handler, session AppState wiring, orphan-snapshot judgment
    (tabs)/
      _layout.tsx               # Tabs: Focus | Tank | Stats | Fishdex (expo-symbols icons)
      index.tsx  tank.tsx  stats.tsx  fishdex.tsx
    session.tsx                 # active session — outside tab group, gestureEnabled:false
  db/
    schema.ts                   # drizzle table: sessions
    client.ts                   # openDatabaseSync('molly.db') + drizzle()
    migrations/                 # drizzle-kit output (generated, committed)
  shared/
    components/                 # ScreenContainer, Button, EmptyState, Toast
    hooks/                      # useNow.ts (1 Hz clock for countdown UI)
    utils/                      # dates.ts (toLocalDate YYYY-MM-DD), id.ts (session ids)
    constants/                  # theme.ts (colors, spacing, water palette)
    types/                      # cross-feature primitives (e.g. SessionRecord row type re-export)
  features/
    fish/                       # domain catalog consumed by all other features
      types/                    # VariantId, FishVariant, LifeStage, OwnedFish
      constants/                # variants.ts — static 7-variant molly catalog
      utils/                    # unlocks.ts — pure: (sessions) -> unlocked variant ids
    session/
      screens/                  # SessionScreen.tsx
      components/               # DurationPicker.tsx, SessionResultSheet.tsx
      store/                    # session-store.ts — Zustand + persist(kv-store): active session snapshot
      types/                    # ActiveSession, SessionEvent, SessionStatus
      hooks/                    # useSessionController.ts (AppState + store + notifs glue),
                                # useEndSession.ts (RQ mutation: drizzle insert + invalidate ['sessions'])
      utils/                    # machine.ts — PURE timestamp state machine (core correctness),
                                # notifications.ts — schedule/cancel completion + dying notifs
      constants/                # GRACE_MS, duration presets, notification copy
    home/
      screens/                  # FocusHomeScreen.tsx — duration picker + variant preview + Start
    tank/
      screens/                  # TankScreen.tsx
      components/               # TankCanvas.tsx (water/sand/plants/bubbles/fish scene),
                                # FishSprite.tsx, Bubbles.tsx, Plants.tsx
      hooks/                    # useOwnedFish.ts (RQ over drizzle select -> OwnedFish[]),
                                # useFishSwim.ts (per-fish Reanimated swim model)
      utils/                    # sprites.ts — variant×stage asset manifest + size/anchor metadata
      constants/                # tank layout, max rendered fish (25), bubble/plant params
    stats/
      screens/                  # StatsScreen.tsx
      components/               # StatCard.tsx, WeekBars.tsx, HistoryList.tsx
      hooks/                    # useStats.ts (RQ over sessions, select -> derived stats)
      utils/                    # stats.ts — pure: daily/weekly totals + streak
    fishdex/
      screens/                  # FishdexScreen.tsx
      components/               # FishdexCard.tsx
      hooks/                    # useUnlocks.ts (RQ select over sessions via fish/utils/unlocks)
```

## Data model

Single drizzle table `sessions` is the source of truth for tank, stats, streaks, unlocks. `OwnedFish` derives 1:1 from sessions (completed → alive, failed/abandoned → dead). Tank renders up to `TANK_CAPACITY` (25, perf cap) fish; which ones is explicit via the `sessions.inTank` flag, not just recency — fish beyond capacity sit in the Holding Tank, a screen where the user chooses which archived fish to swap into the tank. A dead fish's corpse also drops out of the "in tank" view 24h after `endedAt` (`isVisibleInTank`, `src/shared/lib/tank-membership.ts`), freeing its slot for auto-fill without needing a write.

```ts
// db/schema.ts (drizzle sqlite)
sessions: { id: text pk, variantId: text, plannedMinutes: integer,
            startedAt: integer (epoch ms), endedAt: integer,
            outcome: text ('completed'|'failed'|'abandoned'),
            localDate: text /* YYYY-MM-DD computed in JS at insert — avoids UTC off-by-one for stats */ }

// features/fish/types/
type VariantId = 'black'|'goldDust'|'dalmatian'|'sailfin'|'balloon'|'lyretail'|'marble';
interface FishVariant { id; name; description;      // sprite assets live in tank/utils/sprites.ts manifest
  accentColor;                                       // for UI chips/fishdex cards, not fish rendering
  unlock: {type:'default'} | {type:'sessionMinutes';minutes} | {type:'streakDays';days} | {type:'totalHours';hours}; }

// features/session/store/session-store.ts — persisted slice (survives app kill)
interface ActiveSession { id; variantId; plannedMinutes; startedAt: number; backgroundedAt: number|null; }
```

## Session state machine (`features/session/utils/machine.ts` + `store/session-store.ts`)

`machine.ts` is a pure function of `(snapshot, event, now)`; the Zustand store holds the snapshot and applies transitions. States: `idle → running → grace → completed | failed` (+ `abandoned` via Give Up).

- **START**: set snapshot in store (persist middleware writes kv immediately); schedule completion notification (`TIME_INTERVAL`, planned seconds).
- **APP_BACKGROUND / iOS `inactive`** (treated the same): set `backgroundedAt` (persisted — this is what survives a kill); schedule a ~7s "Your molly is suffocating — come back!" notification.
- **APP_FOREGROUND** (same logic on cold relaunch when the rehydrated store has a snapshot), judged in order:
  1. `backgroundedAt >= startedAt + plannedMs` → **completed** (finished before leaving).
  2. `now - backgroundedAt <= 10_000` → survived: clear `backgroundedAt`, cancel dying notif, "phew" toast.
  3. else → **failed** (fish dies; corpse stays visible for 24h, then fades — the session row is permanent).
  - Crash edge (snapshot with `backgroundedAt === null` on cold start): lenient — completed if past planned end, else failed.
- **TICK**: UI-only (`useNow`); completion is derived (`now >= startedAt + plannedMs`) so throttled timers can't miss it.
- **Terminal**: clear store snapshot; `useEndSession` mutation inserts the SessionRecord and invalidates `['sessions']`; cancel pending notifications.

`useSessionController` (mounted once from root layout) wires `AppState` → store transitions → mutation/notifications; screens read the store with selectors.

## Skia tank scene (sprite-based fish)

- **Water**: Rect + LinearGradient (`#0b3a5c → #063049 → #02131f`), light-ray skewed rects (low-opacity), sand path. Optional polish: subtle caustics/shimmer via a Skia fragment shader over the sprites — this is what sells "underwater realism" cheaply.
- **Plants**: stroked paths swaying via `useClock` → derived skew (or plant sprite images if generated alongside fish).
- **Bubbles**: ~12 circles, `y = canvasH - ((t*speed + phase) % canvasH)`.
- **Fish** (`FishSprite.tsx`): Skia `<Image>` (loaded with `useImage` from bundled PNGs) inside a `Group` with transform `[{translateX},{translateY},{scaleX: heading-flip},{rotate: tilt},{scale: size}]`. Motion realism from animation, not frames: heading flip on direction change, tilt toward vertical motion (~±12°), sin bob, subtle `scaleX` oscillation (~1.0↔0.96) as a swim-stroke illusion. If per-variant swim frames are generated, cycle 2–3 frames; single-frame fallback still looks alive with the transforms above.
- **Sprite manifest** (`tank/utils/sprites.ts`): static `require()` map `variantId × lifeStage → asset`, plus per-variant size/anchor metadata.
- **Swim** (`useFishSwim`, `src/shared/lib/swim-model.ts`): a continuously-steered particle — cruise/glide/hover/burst modes, turn-rate-limited heading, speed eased toward a per-mode target (never a dead stop), soft-wall steering. Turns are a `perspective`+`rotateY` sweep through depth rather than a mirror flip. Body wave + tail beat frequency scale with speed via a shared `beatPhase`. ≤25 fish is fine; escape hatch if needed: Skia Atlas API.
- **Dead fish**: same sprite with a Skia `ColorMatrix` grayscale/desaturate filter + reduced opacity, `scaleY: -1`, lying on sand, no wander — no separate dead artwork needed.
- **Growth in session**: stage from progress (egg <10%, fry <40%, juvenile <75%, adult ≥75%); scale ~0.25→1.0 continuously; on stage boundary crossfade (opacity) between stage sprites + scale-pop. Session screen reuses TankCanvas with one centered fish.

## Fish art pipeline (AI-generated sprites)

- **Spec**: transparent-background PNG, side view facing left, consistent lighting/angle across all variants, ~512×512 (adults; smaller ok for fry/egg), stored under `assets/fish/<variantId>/<stage>.png`.
- **Needed set**: 7 adult variants (black, gold dust, dalmatian, sailfin, balloon, lyretail, marble) + shared `egg.png` and `fry.png` + per-variant `juvenile.png` (or adult sprite at reduced scale as v1 shortcut → only ~9 images minimum).
- **Process**: during implementation, generate with an AI image tool from a prompt pack written per variant (accurate molly morphology: rounded body, fan tail; balloon = short round body; sailfin = tall dorsal; dalmatian = white + black spots...). If no image-generation tool is available in-session, the deliverable is the prompt pack + specs, and simple placeholder sprites keep the app fully runnable until the real art is dropped into `assets/fish/`.
- **Review**: dev-only sprite gallery screen showing every variant × stage on the tank background to check consistency/edges before wiring the real tank.

## Unlock rules (`features/fish/utils/unlocks.ts`)

Black molly: default · Gold dust: completed session ≥30 min · Dalmatian: ≥60 min · Sailfin: ≥90 min · Balloon: 3-day streak · Lyretail: 7-day streak · Marble: 10 total completed hours. Pure functions over session records, consumed via React Query `select`; Fishdex shows locked variants as silhouettes with hints.

## Stats (`features/stats/`)

Pure derivations from `sessions` (grouped by the stored `localDate`): daily/weekly minutes; streak = walk back from today/yesterday over days with ≥1 completed session. Screen: today/week StatCards, 7-day bar row (plain Views), streak, FlatList history. All via `useStats` React Query hook — recomputes automatically when the end-session mutation invalidates `['sessions']`.

## Implementation phases (each runnable)

1. **Skeleton + data layer**: install deps; drizzle config (drizzle.config.ts, metro, babel) + `db/schema.ts` + generated migration + `useMigrations` gate in root layout; QueryClientProvider; tabs + 4 placeholder screens; `shared/` scaffolding (theme, dates, ScreenContainer); `features/fish` (types, variants catalog). Test: tabs navigate, migration applies, a dev-inserted row round-trips through a RQ query.
2. **Session engine, no graphics**: `machine.ts`, Zustand `session-store.ts` with kv persist, `useSessionController`, `useNow`, SessionScreen with text countdown + Give Up + result sheet; `useEndSession` mutation. Test grace/kill behavior here, before any Skia.
3. **Tank rendering**: generate/place fish sprite assets + `sprites.ts` manifest + `FishSprite` (dev-only sprite gallery first to review art consistency), then full `TankCanvas` (water, bubbles, plants, wander); wire tank screen to `useOwnedFish` incl. dead (grayscale-filtered) fish.
4. **Growing fish in session**: single-fish TankCanvas with stage growth; notifications (permission on first start, completion + dying notifs).
5. **Stats + Fishdex + unlocks**: `stats.ts`, `unlocks.ts`, both screens; duration picker gated to unlocked variants.
6. **Polish**: haptics, death/complete animations, empty states, dev menu (10s test session, clear data).

## Verification

- `npx expo start` → `i` (iOS sim) / `a` (Android emulator) in Expo Go.
- **Grace**: start session → home (iOS sim `Cmd+Shift+H`) → return <10s → alive + toast; stay out >15s → dead fish appears in tank.
- **App kill**: background mid-session → swipe-kill → relaunch → death result + dead fish (proves Zustand rehydration + relaunch judgment).
- **Completed while backgrounded**: 1-min dev session, background 5s before end, return after end → completed.
- **iOS inactive**: pull down notification center mid-session, restore quickly → no death.
- **Timer robustness**: countdown snaps to correct remaining time after JS pauses (timestamp-derived).
- **Streaks/unlocks**: dev-insert back-dated sessions and check streak + unlock output (`stats.ts`, `unlocks.ts`, `machine.ts` are pure — unit-testable if a runner is added).
- **Reactivity**: completing a session updates Tank/Stats/Fishdex without reload (RQ invalidation).
