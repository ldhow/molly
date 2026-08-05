// eslint.config.js — ESLint 9 flat config.
//
// This file is where the architecture stops being a convention and starts being
// enforced. The boundary rules from SKILL.md are encoded as directory-scoped
// `no-restricted-imports` patterns: a cross-feature import fails `npm run lint`
// instead of surviving code review.
//
// Pattern matching note: `no-restricted-imports` groups use gitignore-style
// globs, where `*` does NOT cross a `/`. So `@/features/*` matches
// `@/features/profile` (the public API) while `@/features/*/*` matches
// `@/features/profile/components/Card` (internals). Where both are
// forbidden, both patterns are listed.

const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
// eslint-config-prettier v10+ exposes a flat entrypoint. On v9, use
// require("eslint-config-prettier") instead — same object, works either way.
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
  group: ["@/app/*", "**/app/*"],
  message:
    "Nothing may import from `src/app/`. Routes depend on features, not the other way round — pass route params down as props instead.",
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
      "expo-env.d.ts",
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
      "max-lines": [
        "warn",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
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
        { patterns: [NO_FEATURE_IMPORTS_AT_ALL, NO_APP_IMPORTS] },
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
              group: ["@/providers/*"],
              message:
                "`shared/` must not depend on `providers/`. Providers compose shared building blocks, not the reverse.",
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // src/** — named exports. Feature code is consumed through barrel files, and
  // default exports make barrels ambiguous and rename-unsafe.
  //
  // `src/app/**` MUST be excluded rather than merely listed earlier: Expo Router
  // requires a default export from every route file, so without this ignore the
  // rule would flag every route in the project.
  // ---------------------------------------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/**"],
    rules: {
      "import/no-default-export": "error",
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
