import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spawns the real Rust backend in e2e-harness mode and waits for /health.
 *
 * Build the binary first: `cargo build -p cseq-app --features e2e-harness`
 * (the `pnpm test:e2e:real` script does this). TMPDIR is isolated per run so
 * the harness's real `patch_autosave` writes cannot touch the developer's
 * actual autosave in the system temp dir.
 */

const HARNESS_BINARY = fileURLToPath(
  new URL("../../../../target/debug/cseq-app", import.meta.url)
);
const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 150;

async function reserveHarnessPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a real-backend harness port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export interface RealBackendHandle {
  port: number;
  /** Per-run isolated temp dir (also the harness process TMPDIR). */
  tempDir: string;
  /** True when the harness opened a real virtual MIDI port. */
  midiReady: boolean;
  /** Ground-truth invoke from Node, bypassing the UI entirely. */
  invoke<T>(cmd: string, args?: unknown): Promise<T>;
  stop(): void;
}

export async function startRealBackend(): Promise<RealBackendHandle> {
  const port = await reserveHarnessPort();
  const tempDir = mkdtempSync(join(tmpdir(), "caesura-real-e2e-"));
  const childEnv = { ...process.env };
  delete childEnv.CAESURA_MACHINE_DIR;
  const child: ChildProcess = spawn(HARNESS_BINARY, [], {
    env: {
      ...childEnv,
      CAESURA_E2E_HARNESS_PORT: String(port),
      TMPDIR: tempDir,
      RUST_LOG: process.env.CAESURA_HARNESS_LOG ?? "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.once("exit", () => rmSync(tempDir, { recursive: true, force: true }));
  spawnedChildren.push(child);
  // tracing-subscriber writes to stdout; drain both streams so the process
  // can never block on a full pipe, and keep a log file for debugging.
  const logPath = join(tempDir, "harness.log");
  const stderrChunks: string[] = [];
  const drain = (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
    if (stderrChunks.length > 200) stderrChunks.shift();
    appendFileSync(logPath, chunk);
  };
  child.stdout?.on("data", drain);
  child.stderr?.on("data", drain);

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let midiReady = false;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `real-backend harness exited with code ${child.exitCode} before /health.\n` +
          `Did you run \`cargo build -p cseq-app --features e2e-harness\`?\n` +
          stderrChunks.join("")
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const health = (await response.json()) as { ok: boolean; midiReady: boolean };
        midiReady = health.midiReady;
        break;
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(
        `real-backend harness did not become healthy within ${HEALTH_TIMEOUT_MS}ms.\n` +
          stderrChunks.join("")
      );
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, HEALTH_POLL_MS));
  }

  return {
    port,
    tempDir,
    midiReady,
    async invoke<T>(cmd: string, args?: unknown): Promise<T> {
      const response = await fetch(`${baseUrl}/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmd, args: args ?? {} }),
      });
      const text = await response.text();
      const value = text.length > 0 ? JSON.parse(text) : null;
      if (!response.ok) {
        const error =
          value && typeof value === "object" && "error" in value
            ? (value as { error: unknown }).error
            : value;
        throw new Error(typeof error === "string" ? error : JSON.stringify(error));
      }
      return value as T;
    },
    stop() {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000).unref();
    },
  };
}

// Last-resort cleanup: if a worker exits without afterAll (crash, force
// kill), don't leave harness binaries running their 2ms scheduler loops.
const spawnedChildren: ChildProcess[] = [];
process.on("exit", () => {
  for (const child of spawnedChildren) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
