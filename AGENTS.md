# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Architecture

**Follow the `expo-feature-architecture` skill** (.claude/skills/expo-feature-architecture) for all structure, naming, state-placement, import-boundary, error-handling, lint, and format decisions. The boundary rules are enforced by `eslint.config.js` — `npm run verify` (typecheck + lint + format:check) must pass before declaring work done.

Project-specific deviations from the skill (agreed, do not "fix"):

- **All source filenames are kebab-case** (`fish-sprite.tsx`, `use-session-controller.ts`, `session-store.ts`), overriding the skill's PascalCase/camelCase file-naming table. Exported symbols keep their conventional casing (`FishSprite`, `useSessionController`); route files follow Expo Router conventions as usual.
- **`src/db/`** is an extra top-level dir (Drizzle schema/client/migrations; below `shared/` in the dependency graph). Schema changes: edit `src/db/schema.ts`, then `npx drizzle-kit generate` and commit the output.
- **Styling is StyleSheet for now** — NativeWind is not installed yet. When it lands, follow the skill's styling section; until then don't add new styling approaches.
- **No Jest yet.** Business logic still goes in pure functions (`utils/`) so it's testable when the runner lands.
- Small per-feature `utils/` and `constants/` folders are allowed alongside the skill's standard folders.

Domain notes: the single `sessions` table is the source of truth — tank fish, stats, streaks, unlocks are all derived at read time via React Query (`SESSIONS_QUERY_KEY`); never add denormalized counters. Session life/death judgments are pure timestamp functions in `src/features/session/utils/machine.ts` — never background JS timers. Full design doc: [src/docs/PLAN.md](src/docs/PLAN.md).

# Running

Use Expo Go with `npx expo start --port 8082` (8081 is occupied on this machine). Android: AVD `molly`. Never `expo run:ios` (SDK 57 needs a newer Xcode than this machine has).
