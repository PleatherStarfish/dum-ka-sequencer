// Carve-up boot check: runs the launcher spec against a dedicated port.
// Usage: pnpm exec playwright test --config playwright.bootcheck.config.ts main-editor-launcher --workers=1
// Purpose: typecheck alone cannot prove the app still boots (a re-export form
// tsc accepts can crash Vite's transform at runtime) — run this after every
// App.tsx extraction round. See docs/AI_HANDOFF.md "Main UI" notes.
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const nodePolyfillPath = fileURLToPath(
  new URL("./tests/e2e/support/node-polyfills.cjs", import.meta.url)
);
const uiDir = fileURLToPath(new URL(".", import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, `--require ${nodePolyfillPath}`]
  .filter(Boolean)
  .join(" ");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:5181" },
  webServer: {
    command: `pnpm --dir ${uiDir} dev --host 127.0.0.1 --port 5181 --strictPort`,
    cwd: uiDir,
    url: "http://127.0.0.1:5181",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CAESURA_E2E: "1", NODE_OPTIONS: nodeOptions },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
