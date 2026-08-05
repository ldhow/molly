# Tooling setup: Prettier + ESLint

Read this when setting up a new project, adding lint/format to an existing one, or changing the boundary rules. Ready-to-copy configs are in `assets/eslint.config.js`, `assets/prettierrc.json`, `assets/prettierignore`.

## Contents

1. [Division of labour](#division-of-labour)
2. [Install](#install)
3. [Files to create](#files-to-create)
4. [package.json scripts](#packagejson-scripts)
5. [How the boundary rules work](#how-the-boundary-rules-work)
6. [Adding a new boundary](#adding-a-new-boundary)
7. [Pre-commit and CI](#pre-commit-and-ci)
8. [Adopting this in an existing codebase](#adopting-this-in-an-existing-codebase)
9. [Troubleshooting](#troubleshooting)

---

## Division of labour

**Prettier owns formatting. ESLint owns correctness and architecture.** They must never both have an opinion about the same thing, or you get fights that show up as unfixable lint errors after a format run.

This is enforced by putting `eslint-config-prettier` **last** in the flat config array, which switches off every stylistic ESLint rule.

Specifically **don't** use `eslint-plugin-prettier` (running Prettier *as* a lint rule). It makes lint several times slower, reports formatting as errors in the middle of real problems, and produces confusing output when the two disagree. Run Prettier as its own script.

## Install

ESLint first — Expo's CLI scaffolds it and picks versions matching your SDK:

```bash
npx expo lint
```

On first run this installs `eslint` and `eslint-config-expo` and writes a starter `eslint.config.js`. Overwrite that file with `assets/eslint.config.js`.

Then the rest:

```bash
npm i -D prettier eslint-config-prettier prettier-plugin-tailwindcss
```

Version notes:
- **ESLint 9+** — required for flat config. `eslint-config-expo` supports it from SDK 51 via the `/flat` entrypoint.
- **eslint-config-prettier 10+** — provides `eslint-config-prettier/flat`. On v9, change that one import to `require("eslint-config-prettier")`; the object works as a flat config entry either way.
- **prettier-plugin-tailwindcss 0.6+** — required for `tailwindFunctions`. If you're on Tailwind v3 rather than v4, replace `tailwindStylesheet` with `tailwindConfig: "./tailwind.config.js"`.

## Files to create

| Copy from | To | Notes |
|---|---|---|
| `assets/eslint.config.js` | `eslint.config.js` | Project root, CommonJS |
| `assets/prettierrc.json` | `.prettierrc` | Project root |
| `assets/prettierignore` | `.prettierignore` | Project root |

The `@/` alias the boundary rules depend on comes from `tsconfig.json`. Because routes live in `src/app/`, the alias points at `src`, not the project root — this is Expo's documented setup for a top-level `src` directory:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

If you migrated from a root-level `app/`, this alias is the step people forget: leaving `"@/*": ["./*"]` makes every `@/features/...` import resolve to a nonexistent root `features/` folder, and the ESLint boundary patterns silently match nothing.

Keep `strict: true`. The `meta` typing in `references/query-feedback.md` is worth much less without it.

## package.json scripts

```json
{
  "scripts": {
    "lint": "expo lint",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "verify": "npm run typecheck && npm run lint && npm run format:check"
  }
}
```

`verify` is what CI runs and what to run before declaring a feature done. Typecheck goes first — a type error usually explains any lint errors downstream of it.

## How the boundary rules work

`no-restricted-imports` groups use **gitignore-style globs**, where `*` does not cross a `/`. That gives a clean way to distinguish a feature's public API from its internals:

| Pattern | Matches | Meaning |
|---|---|---|
| `@/features/*` | `@/features/profile` | The feature's barrel — its public API |
| `@/features/*/*` | `@/features/profile/api/useProfileQuery` | Its internals |

From that, each directory gets the rule that matches its role:

- **`src/app/**`** bans `@/features/*/*` only. Routes may import a feature's barrel — that's the whole point — but not reach past it.
- **`src/features/**`** bans both patterns. Inside its own feature, code uses relative imports (`../components/Card`), so *any* aliased feature import is by definition pointed at a different feature.
- **`src/shared/**`** bans both, plus `@/providers/*`, keeping shared at the bottom of the dependency graph.

The `max-lines` warning on `src/app/**` is a heuristic for rule 1 ("routes don't define logic"). It can't detect logic directly, but a route file that needs 60+ lines almost always has some.

`import/no-default-export` on `src/**` keeps barrel exports unambiguous and rename-safe. `src/app/**` is excluded via `ignores` — Expo Router requires a default export from every route file, so the rule would otherwise flag all of them.

## Adding a new boundary

When you add a top-level directory under `src/` — say `src/services/` — add its block to `eslint.config.js` in the same commit. An unlisted directory is an unenforced one, and unenforced directories are where the architecture erodes first.

Decide two things and encode them: what may this directory import, and who may import it?

```js
{
  files: ["src/services/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: [NO_FEATURE_IMPORTS_AT_ALL, NO_APP_IMPORTS] },
    ],
  },
},
```

## Pre-commit and CI

Pre-commit, formatting only — keep it fast enough that nobody reaches for `--no-verify`:

```bash
npm i -D husky lint-staged
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["prettier --write", "eslint --fix"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

CI runs the full `verify` script, since typecheck across the project is too slow for a hook.

```yaml
- run: npm ci
- run: npm run verify
```

## Adopting this in an existing codebase

If the project still has a root-level `app/`, move it first — the ESLint boundary globs are written against `src/app/`:

```bash
mkdir -p src && git mv app src/app
git mv global.css src/global.css   # if you have one
```

Then set `"paths": { "@/*": ["./src/*"] }` in `tsconfig.json`, update `tailwind.config.js` `content` to `["./src/**/*.{js,jsx,ts,tsx}"]`, fix the `global.css` import in `src/app/_layout.tsx` to `"../global.css"`, and restart with `npx expo start --clear`. Leave `assets/` at the root. Verify there is no leftover root `app/` directory — if one exists, Expo Router uses it and ignores `src/app/` entirely, which presents as "my routes changed but nothing happened".

Do the move in its own commit, before the formatting pass below, so the two don't tangle in review.

Running `prettier --write .` on a mature repo rewrites every file and destroys `git blame`. Do it deliberately:

1. Format everything in **one commit that changes nothing else**, with a message saying so.
2. Record its SHA in `.git-blame-ignore-revs`, then `git config blame.ignoreRevsFile .git-blame-ignore-revs`. GitHub honours this file automatically.
3. Add the ESLint boundary rules as `"warn"` first and run `npm run lint` to see the true size of the problem.
4. Fix violations feature by feature, promoting genuinely shared code to `src/shared/` as you go. Resist the urge to make a cross-feature import legal by re-exporting it from a barrel — that hides the coupling instead of removing it.
5. Flip the rules to `"error"` once the count reaches zero, in a commit of its own.

## Troubleshooting

**"Boundary rules never fire."** They match on the literal import string, so a relative escape like `../../features/checkout/api/x` slips past. Add `import/no-relative-parent-imports` scoped to `src/features/**`, or add `**/features/*/*` to the pattern groups.

**"`prettier-plugin-tailwindcss` isn't sorting classes."** It must be the last entry in `plugins`. Confirm `tailwindStylesheet`/`tailwindConfig` points at a file that exists, and add any custom class-composing helpers to `tailwindFunctions`.

**"ESLint can't resolve `@/...`."** `eslint-config-expo` reads `tsconfig.json` paths; make sure it's at the project root and the alias is `"@/*": ["./*"]` — note the imports in this skill are `@/...`, not `@/features/...`.

**"Lint passes locally, fails in CI."** Almost always an ignore mismatch: `.prettierignore` and the `ignores` block in `eslint.config.js` are separate lists and drift apart. Keep `android/`, `ios/`, `.expo/`, `dist/`, `coverage/` in both.
