// Guards the Playwright harness against app restructures: the harness's
// editor-id → panel-selector map is plain data the e2e suite trusts, so when a
// main editor is added/retired/renamed this FAST-lane test fails immediately
// instead of the (non-blocking, nightly) e2e suite silently rotting — which is
// exactly what happened when the 2026-07-06 restructure retired the `score`
// editor and the whole suite went red unnoticed. See
// docs/TEST_COVERAGE_PLAN_2026-07.md Phase 1.4.
//
// Sources are read via import.meta.glob raw imports (the modelCoverage.test.ts
// pattern) — the app tsconfig has no Node types, so no node:fs here.
import { describe, expect, it } from "vitest";
import appHtml from "../index.html?raw";
import e2eHarnessRust from "../../src-tauri/src/e2e_harness.rs?raw";
import mainRust from "../../src-tauri/src/main.rs?raw";
import tauriConfigRaw from "../../src-tauri/tauri.conf.json?raw";

const harnessSources = import.meta.glob("../tests/e2e/support/appHarness.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const componentSources = import.meta.glob(
  ["./components/*.tsx", "./App.tsx"],
  { query: "?raw", import: "default", eager: true }
) as Record<string, string>;

const harness = Object.values(harnessSources)[0] ?? "";
const chrome =
  Object.entries(componentSources).find(([path]) =>
    path.endsWith("MainEditorChrome.tsx")
  )?.[1] ?? "";

function unionValues(source: string, typeName: string): string[] {
  const match = source.match(
    new RegExp(`export type ${typeName} =([^;]+);`, "m")
  );
  const body = match?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/"([a-z-]+)"/g)].flatMap((entry) =>
    entry[1] === undefined ? [] : [entry[1]]
  );
}

function harnessSelectorMap(source: string): Record<string, string> {
  const block = source.match(
    /MAIN_EDITOR_PANEL_SELECTORS: Record<MainEditorId, string> = \{([^}]+)\}/m
  );
  expect(block, "harness selector map not found").not.toBeNull();
  const map: Record<string, string> = {};
  for (const entry of (block?.[1] ?? "").matchAll(/([a-zA-Z]+): "#([a-z-]+)"/g)) {
    const editor = entry[1];
    const domId = entry[2];
    if (editor !== undefined && domId !== undefined) {
      map[editor] = domId;
    }
  }
  return map;
}

describe("e2e harness ↔ app main-editor contract", () => {
  it("loaded both source files", () => {
    expect(harness.length).toBeGreaterThan(0);
    expect(chrome.length).toBeGreaterThan(0);
  });

  it("harness MainEditorId union matches MainEditorChrome's", () => {
    const harnessIds = unionValues(harness, "MainEditorId").sort();
    const appIds = unionValues(chrome, "MainEditorId").sort();
    expect(appIds.length).toBeGreaterThan(0);
    expect(harnessIds).toEqual(appIds);
  });

  it("every harness panel selector's DOM id exists in a component", () => {
    const map = harnessSelectorMap(harness);
    expect(Object.keys(map).length).toBeGreaterThan(0);
    const sources = Object.values(componentSources).join("\n");
    for (const [editor, domId] of Object.entries(map)) {
      expect(
        sources.includes(`id="${domId}"`),
        `harness maps editor "${editor}" to #${domId}, but no component renders id="${domId}"`
      ).toBe(true);
    }
  });

  it("every app editor id has a harness selector entry", () => {
    const map = harnessSelectorMap(harness);
    for (const id of unionValues(chrome, "MainEditorId")) {
      expect(
        map[id],
        `app editor "${id}" has no MAIN_EDITOR_PANEL_SELECTORS entry in the harness`
      ).toBeTruthy();
    }
  });
});

describe("Dum-Ka identity contract", () => {
  it("keeps the native, browser, and masthead titles aligned", () => {
    const config = JSON.parse(tauriConfigRaw) as {
      productName?: string;
      identifier?: string;
      app?: { windows?: Array<{ title?: string }> };
    };
    const appSource =
      Object.entries(componentSources).find(([path]) =>
        path.endsWith("App.tsx")
      )?.[1] ?? "";

    expect(config.productName).toBe("Dum-Ka");
    expect(config.identifier).toBe("io.github.pleatherstarfish.dumka");
    expect(config.app?.windows?.[0]?.title).toBe("Dum-Ka");
    expect(appHtml).toContain("<title>Dum-Ka</title>");
    expect(appSource).toContain("<h1>Dum-Ka</h1>");
  });

  it("keeps production and e2e virtual MIDI port names aligned", () => {
    expect(mainRust).toContain('Transport::start("Dum-Ka MIDI")');
    expect(e2eHarnessRust).toContain(
      'Transport::start("Dum-Ka MIDI (e2e)")'
    );
  });
});

// The persistence specs assert the schema version of app-SAVED documents with
// literals (importing patchIo into the Playwright runner trips its ESM loader
// on type-only re-exports). Those literals rotted silently through the v4/v5
// bumps while the e2e lane was non-blocking; this fast-lane guard pins every
// saved-document version assertion to the real constant. Fixture INPUT
// documents legitimately carry old versions and are not matched here.
describe("e2e persistence specs assert the current patch schema version", () => {
  const persistenceSources = import.meta.glob(
    [
      "../tests/e2e/patch-persistence.spec.ts",
      "../tests/e2e/track-export-import.spec.ts",
    ],
    { query: "?raw", import: "default", eager: true }
  ) as Record<string, string>;

  it("every saved-document schemaVersion assertion matches PATCH_SCHEMA_VERSION", async () => {
    const { PATCH_SCHEMA_VERSION } = await import("./patchIo");
    const entries = Object.entries(persistenceSources);
    expect(entries.length).toBe(2);
    let assertions = 0;
    for (const [path, source] of entries) {
      for (const match of source.matchAll(/schemaVersion\)\.toBe\((\d+)\)/g)) {
        assertions += 1;
        expect(
          Number(match[1]),
          `${path} asserts a saved schemaVersion of ${match[1]}`
        ).toBe(PATCH_SCHEMA_VERSION);
      }
      // Track envelope expectation shape: `schemaVersion: N,` inside the
      // toMatchObject right after `kind: "track",`.
      for (const match of source.matchAll(
        /kind: "track",\s*\n\s*schemaVersion: (\d+),/g
      )) {
        assertions += 1;
        expect(
          Number(match[1]),
          `${path} expects a track envelope schemaVersion of ${match[1]}`
        ).toBe(PATCH_SCHEMA_VERSION);
      }
    }
    expect(assertions).toBeGreaterThanOrEqual(4);
  });
});
