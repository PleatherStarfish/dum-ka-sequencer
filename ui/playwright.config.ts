import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const nodePolyfillPath = fileURLToPath(
  new URL("./tests/e2e/support/node-polyfills.cjs", import.meta.url)
);
const uiDir = fileURLToPath(new URL(".", import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, `--require ${nodePolyfillPath}`]
  .filter(Boolean)
  .join(" ");
const PORT = 5178;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm --dir ${uiDir} dev --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: uiDir,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CAESURA_E2E: "1",
      NODE_OPTIONS: nodeOptions,
    },
  },
  projects: [
    // The stable browser suite: every spec in tests/e2e EXCEPT the ones below,
    // so a newly added spec is in the CI lane by default. (The previous
    // regime — an explicit file list in package.json — silently orphaned four
    // specs from CI; see docs/TEST_COVERAGE_PLAN_2026-07.md Phase 0.4.)
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [
        // Nightly-only bounded fuzz/chaos lanes (own projects below).
        "**/model-ui-fuzzer.spec.ts",
        "**/chaos-gremlins.spec.ts",
        // Runs only under playwright.real.config.ts against the compiled
        // Rust backend; under the mock webServer it cannot pass.
        "**/real-backend-parity.spec.ts",
        // Env-gated report tool + screenshot utility, not regression tests.
        "**/css-dead-selector-report.spec.ts",
        "**/_headershot.spec.ts",
      ],
    },
    {
      name: "fuzz",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/model-ui-fuzzer.spec.ts",
    },
    {
      name: "chaos",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/chaos-gremlins.spec.ts",
    },
    // Dev utilities (CSS dead-selector crawl, header screenshots) — run on
    // demand via the package.json scripts, never in a CI lane.
    {
      name: "tools",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["**/css-dead-selector-report.spec.ts", "**/_headershot.spec.ts"],
    },
  ],
});
