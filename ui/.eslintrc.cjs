/**
 * ESLint config for the Caesura UI.
 *
 * Pragmatic by design: this codebase had no lint config and a very large
 * `App.tsx`, so the goal here is to catch real correctness bugs (unused vars,
 * bad hook usage, fallthrough) without drowning CI in pre-existing stylistic
 * noise. Rules that would flag a large volume of harmless existing code are set
 * to "warn" (visible, non-blocking) rather than "error". Tighten over time.
 *
 * Uses the classic eslintrc format (ESLint 8) so the existing
 * `eslint src --ext ts,tsx` script works unchanged.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: "18" },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    // React Hooks correctness — these catch real bugs, keep as error/warn.
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",

    // Let TypeScript own "undefined variable" detection; avoids false positives
    // on types/globals in a TS codebase.
    "no-undef": "off",

    // Unused vars: surface them, but allow intentional `_`-prefixed throwaways
    // (used in tests/destructuring) and don't hard-fail the build on them yet.
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],

    // High-noise stylistic/escape-hatch rules → warn (not blocking) for now.
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/no-empty-function": "warn",
    "no-empty": ["warn", { allowEmptyCatch: true }],

    // Genuine footguns → keep as error.
    "no-fallthrough": "error",
    "no-constant-condition": ["error", { checkLoops: false }],

    // App.tsx mixes tabs and spaces pervasively. That's a formatting concern
    // (a Prettier pass would fix it), not a correctness issue, so we don't let
    // it block lint. Re-enable once the tree is formatter-clean.
    "no-mixed-spaces-and-tabs": "off",

    // One pre-existing unnecessary escape; surfaced but non-blocking.
    "no-useless-escape": "warn",
  },
  overrides: [
    {
      // Guardrail 1: model modules (`src/**/*.ts`, excluding tests/fixtures/types)
      // must stay pure so their logic is unit-testable without a renderer. React
      // belongs in components (`.tsx`). See
      // docs/COMPONENT_LOGIC_EXTRACTION_PLAN.md.
      files: ["src/**/*.ts"],
      excludedFiles: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.d.ts",
        "src/__fixtures__/**/*.ts",
      ],
      rules: {
        "@typescript-eslint/no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "react",
                message:
                  "Model modules (src/*.ts) must stay pure — keep React in components (.tsx). See docs/COMPONENT_LOGIC_EXTRACTION_PLAN.md.",
              },
              {
                name: "react-dom",
                message:
                  "Model modules (src/*.ts) must stay pure — keep React in components (.tsx).",
              },
            ],
          },
        ],
      },
    },
    {
      // Tests and fixtures: relax a few rules that are normal in test code.
      files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/__fixtures__/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
  ],
  ignorePatterns: ["dist", "node_modules", "*.cjs", "vite.config.ts.timestamp-*"],
};
