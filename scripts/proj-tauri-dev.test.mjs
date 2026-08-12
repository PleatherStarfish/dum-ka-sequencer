import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIG_RELATIVE_PATH,
  cargoInvocation,
  parsePort,
  tauriOverride,
  writeConfigAtomically,
} from "./proj-tauri-dev.mjs";

test("parsePort accepts the complete valid boundary", () => {
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("38800"), 38800);
  assert.equal(parsePort("65535"), 65535);
});

test("parsePort rejects missing, ambiguous, and out-of-range values", () => {
  for (const value of [
    undefined,
    "",
    "0",
    "01",
    "-1",
    "65536",
    "38800.0",
    " 38800",
    "38800 ",
    "38800x",
  ]) {
    assert.throws(() => parsePort(value), /integer from 1 through 65535/);
  }
});

test("one parsed port controls both Vite and the Tauri dev URL", () => {
  const config = tauriOverride(38800);
  assert.deepEqual(config, {
    build: {
      beforeDevCommand: {
        cwd: "../ui",
        script: "pnpm dev --host 127.0.0.1 --port 38800 --strictPort",
      },
      devUrl: "http://127.0.0.1:38800",
    },
  });
});

test("the cargo command always consumes the generated override", () => {
  assert.deepEqual(cargoInvocation(), [
    "cargo",
    ["tauri", "dev", "--config", CONFIG_RELATIVE_PATH],
  ]);
});

test("the executable refuses to run when proj did not inject a port", () => {
  const environment = { ...process.env };
  delete environment.PROJ_PORT_TAURI_UI;
  const script = fileURLToPath(new URL("./proj-tauri-dev.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PROJ_PORT_TAURI_UI must be an integer/);
});

test("config replacement is atomic, private, and leaves no temporary file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dumka-proj-launcher-"));
  const target = path.join(directory, CONFIG_RELATIVE_PATH);
  const first = tauriOverride(38800);
  const second = tauriOverride(38801);

  try {
    await writeConfigAtomically(target, first);
    await writeConfigAtomically(target, second);

    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), second);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.dirname(target)), [path.basename(target)]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
