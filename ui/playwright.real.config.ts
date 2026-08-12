import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Real-backend parity suite (tests/e2e/real-backend-parity.spec.ts).
//
// Runs on its own port with reuseExistingServer disabled so it can never
// silently attach to a dev server that was started without CAESURA_E2E=1
// (or to an unrelated project squatting on 5173) — the suite must control
// the exact Vite config (Tauri API aliased to the e2e driver seam).

const nodePolyfillPath = fileURLToPath(
  new URL("./tests/e2e/support/node-polyfills.cjs", import.meta.url)
);
const uiDir = fileURLToPath(new URL(".", import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, `--require ${nodePolyfillPath}`]
  .filter(Boolean)
  .join(" ");

const PORT = 5179;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /real-backend-parity\.spec\.ts/,
  fullyParallel: false,
  // Real playback at musical tempo plus real Rust work: cycles take ~3s
  // each and the suite shares one harness, so give tests more headroom
  // than the mock suite's 30s.
  timeout: 60_000,
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
    {
      name: "chromium-real-backend",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
