// eslint.config.js — ESLint 9 flat config.
//
// This file is where the architecture stops being a convention and starts being
// enforced. The boundary rules from .claude/skills/expo-feature-architecture
// are encoded as directory-scoped `no-restricted-imports` patterns: a
// cross-feature import fails `npm run lint` instead of surviving code review.
//
// Layout note: this project keeps the router at `src/app` (not root `app/`)
// and aliases `@/*` to `./src/*`, so the patterns below use `@/features/...`
// rather than the skill's `@/src/features/...`.
//
// Pattern matching note: `no-restricted-imports` groups use gitignore-style
// globs, where `*` does NOT cross a `/`. So `@/features/*` matches
// `@/features/session` (the public API) while `@/features/*/*` matches
// `@/features/session/components/DurationPicker` (internals).

const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const prettierConfig = require("eslint-config-prettier/flat");

const NO_DEEP_FEATURE_IMPORTS = {
  group: ["@/features/*/*"],
  message:
    "Import a feature through its public API only: `@/features/<name>`. Reaching into screens/, components/ or api/ couples you to its internals.",
};

const NO_FEATURE_IMPORTS_AT_ALL = {
  group: ["@/features/*", "@/features/*/*"],
  message:
    "No cross-feature imports. Inside your own feature use relative paths; if two features need the same thing, promote it to `@/shared`.",
};

const NO_APP_IMPORTS = {
  group: ["@/app/*", "**/src/app/*"],
  message:
    "`src/` must never import from the router directory. Routes depend on features, not the other way round — pass route params down as props instead.",
};

const NO_PROVIDER_IMPORTS = {
  group: ["@/providers/*"],
  message:
    "Only the root layout composes providers. Everything else declares intent (e.g. query `meta`) and lets the provider act on it.",
};

module.exports = defineConfig([
  expoConfig,

  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      "dist/**",
      "web-build/**",
      "coverage/**",
      "android/**",
      "ios/**",
      "example/**",
      ".claude/**",
      "expo-env.d.ts",
      "src/db/migrations/**",
    ],
  },

  // ---------------------------------------------------------------------------
  // src/app/ — routes only. Thin wrappers that import a Screen and render it.
  // ---------------------------------------------------------------------------
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_DEEP_FEATURE_IMPORTS] }],
      // A route file that grows past this is holding logic that belongs in a
      // Screen component. Warn rather than error — layouts legitimately run longer.
      "max-lines": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },

  // ---------------------------------------------------------------------------
  // src/features/** — self-contained domains, no lateral dependencies.
  // ---------------------------------------------------------------------------
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [NO_FEATURE_IMPORTS_AT_ALL, NO_APP_IMPORTS, NO_PROVIDER_IMPORTS],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // src/shared/** — the base of the dependency graph. Depends on nothing above it.
  // ---------------------------------------------------------------------------
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              ...NO_FEATURE_IMPORTS_AT_ALL,
              message:
                "`shared/` must never depend on `features/`. If shared code needs feature-specific behaviour, invert it: accept it as a parameter or a registered adapter.",
            },
            NO_APP_IMPORTS,
            {
              ...NO_PROVIDER_IMPORTS,
              message:
                "`shared/` must not depend on `providers/`. Providers compose shared building blocks, not the reverse.",
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // R3F components (src/shared/components/tank/*-3d.tsx) — react/no-unknown-property
  // only knows DOM/RN element props by default; these are three.js/@react-three/fiber
  // JSX props (a mesh's `position`, a light's `intensity`, `args` for constructor
  // params, `attach` for scene.background/fog, etc.), not typos.
  // ---------------------------------------------------------------------------
  {
    files: ["src/shared/components/tank/*-3d.tsx"],
    rules: {
      "react/no-unknown-property": [
        "error",
        { ignore: ["args", "attach", "object", "position", "rotation", "intensity", "roughness"] },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // src/db/** — persistence infra. Imports drizzle/expo-sqlite, nothing app-side.
  // ---------------------------------------------------------------------------
  {
    files: ["src/db/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_FEATURE_IMPORTS_AT_ALL,
            NO_APP_IMPORTS,
            NO_PROVIDER_IMPORTS,
            {
              group: ["@/shared/*"],
              message: "`db/` sits below `shared/` — keep it free of app-layer imports.",
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // src/providers/** — composes shared building blocks; never features or routes.
  // ---------------------------------------------------------------------------
  {
    files: ["src/providers/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_FEATURE_IMPORTS_AT_ALL, NO_APP_IMPORTS] }],
    },
  },

  // ---------------------------------------------------------------------------
  // src/** (except the router dir) — named exports. Feature code is consumed
  // through barrel files, and default exports make barrels ambiguous and
  // rename-unsafe. src/app/** is exempt: Expo Router requires default exports.
  // ---------------------------------------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/**"],
    rules: {
      "import/no-default-export": "error",
    },
  },

  // ---------------------------------------------------------------------------
  // Ambient declaration files — `export default` inside `declare module` is the
  // shape of the shim, not a real default export.
  // ---------------------------------------------------------------------------
  {
    files: ["**/*.d.ts"],
    rules: {
      "import/no-default-export": "off",
    },
  },

  // ---------------------------------------------------------------------------
  // Tests — relax the rules that only make sense for production code.
  // ---------------------------------------------------------------------------
  {
    files: ["**/*.test.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}", "**/*.setup.{ts,tsx}"],
    rules: {
      "max-lines": "off",
      "import/no-default-export": "off",
    },
  },

  // Must stay last: switches off every stylistic rule so Prettier is the only
  // thing with an opinion about whitespace.
  prettierConfig,
]);
