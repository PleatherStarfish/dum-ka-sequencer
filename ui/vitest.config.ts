import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default environment is Node (pure logic). Files that need a DOM can opt in
    // per-file with a `// @vitest-environment jsdom` pragma (add the `jsdom`
    // dev-dep when the first such test lands).
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Report on the whole source tree so untested files (notably App.tsx)
      // show up as 0% rather than being invisible. Tests and fixtures are
      // excluded from the denominator.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/__fixtures__/**",
        "src/**/*.d.ts",
      ],
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
