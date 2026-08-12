import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";

const useE2eTauriMocks =
  process.env.CAESURA_E2E === "1" || process.env.VITE_E2E_MOCK_TAURI === "1";

// Tauri expects a fixed port and disables HMR fallback polling.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: useE2eTauriMocks
    ? {
        alias: {
          "@tauri-apps/api/core": fileURLToPath(
            new URL("./tests/e2e/mocks/tauri-core.ts", import.meta.url)
          ),
          "@tauri-apps/api/event": fileURLToPath(
            new URL("./tests/e2e/mocks/tauri-event.ts", import.meta.url)
          ),
          "@tauri-apps/plugin-dialog": fileURLToPath(
            new URL("./tests/e2e/mocks/tauri-dialog.ts", import.meta.url)
          ),
        },
      }
    : undefined,
  server: {
    port: 5173,
    strictPort: true,
    // Explicit IPv4 loopback: `host: false` ("localhost") binds IPv6-only
    // under newer Node, and the Tauri webview resolves localhost to
    // 127.0.0.1 — the mismatch renders a blank window.
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: true,
  },
});
