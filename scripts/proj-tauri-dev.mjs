#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PORT_ENV = "PROJ_PORT_TAURI_UI";
export const CONFIG_RELATIVE_PATH = ".dev/tauri.proj.conf.json";

export function parsePort(raw) {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,4}$/.test(raw)) {
    throw new Error(`${PORT_ENV} must be an integer from 1 through 65535`);
  }

  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error(`${PORT_ENV} must be an integer from 1 through 65535`);
  }
  return port;
}

export function tauriOverride(port) {
  return {
    build: {
      beforeDevCommand: {
        cwd: "../ui",
        script: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
      },
      devUrl: `http://127.0.0.1:${port}`,
    },
  };
}

export function cargoInvocation() {
  return ["cargo", ["tauri", "dev", "--config", CONFIG_RELATIVE_PATH]];
}

export async function writeConfigAtomically(target, config) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function main() {
  let port;
  try {
    port = parsePort(process.env[PORT_ENV]);
  } catch (error) {
    console.error(`proj-tauri-dev: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const configPath = path.join(repositoryRoot, CONFIG_RELATIVE_PATH);
  await writeConfigAtomically(configPath, tauriOverride(port));

  const [command, args] = cargoInvocation();
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`cargo tauri dev exited from signal ${signal}`));
        return;
      }
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`proj-tauri-dev: ${error.message}`);
    process.exitCode = 1;
  });
}
