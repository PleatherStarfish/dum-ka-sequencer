import { describe, expect, it } from "vitest";

import {
  LEGACY_AUTOSAVE_ENABLED_KEY,
  LEGACY_SETUP_PREFERENCES_KEY,
  defaultMachinePrefs,
  normalizeMachinePrefs,
  planSetupPrefsMigration,
  removableLegacySetupKeys,
} from "./machinePrefs";

const reader =
  (values: Record<string, string>) =>
  (key: string): string | null =>
    values[key] ?? null;

describe("normalizeMachinePrefs", () => {
  it("returns defaults for garbage", () => {
    expect(normalizeMachinePrefs(null)).toEqual(defaultMachinePrefs());
    expect(normalizeMachinePrefs("nope")).toEqual(defaultMachinePrefs());
    expect(normalizeMachinePrefs(42)).toEqual(defaultMachinePrefs());
  });

  it("keeps valid fields and repairs invalid ones", () => {
    const prefs = normalizeMachinePrefs({
      prefsVersion: 99,
      midiDestination: { id: "-673416519", name: "IAC Driver Bus 1" },
      autosaveEnabled: false,
      autosaveIntervalMs: 999_999,
      autoloadRecentSession: false,
    });
    expect(prefs.prefsVersion).toBe(1);
    expect(prefs.midiDestination).toEqual({
      id: "-673416519",
      name: "IAC Driver Bus 1",
    });
    expect(prefs.autosaveEnabled).toBe(false);
    expect(prefs.autosaveIntervalMs).toBe(60_000);
    expect(prefs.autoloadRecentSession).toBe(false);
  });

  it("drops destinations without a usable id", () => {
    expect(
      normalizeMachinePrefs({ midiDestination: { id: "", name: "X" } })
        .midiDestination
    ).toBeNull();
    expect(
      normalizeMachinePrefs({ midiDestination: { name: "X" } }).midiDestination
    ).toBeNull();
    expect(
      normalizeMachinePrefs({ midiDestination: { id: "7" } }).midiDestination
    ).toEqual({ id: "7", name: "7" });
  });
});

describe("planSetupPrefsMigration", () => {
  it("does nothing when the machine-prefs file already exists", () => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "file" },
      reader({
        [LEGACY_SETUP_PREFERENCES_KEY]: JSON.stringify({
          autosaveEnabled: false,
        }),
      })
    );
    expect(plan.shouldMigrate).toBe(false);
    // Stale legacy keys still get cleaned up.
    expect(plan.keysToRemove).toEqual([LEGACY_SETUP_PREFERENCES_KEY]);
    expect(plan.prefs).toEqual(defaultMachinePrefs());
  });

  it("does nothing when there is nothing legacy to migrate", () => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      reader({})
    );
    expect(plan.shouldMigrate).toBe(false);
    expect(plan.keysToRemove).toEqual([]);
  });

  it("migrates legacy setup preferences once", () => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      reader({
        [LEGACY_SETUP_PREFERENCES_KEY]: JSON.stringify({
          autosaveEnabled: false,
          autosaveIntervalMs: 10_000,
          autoloadRecentSession: false,
        }),
        [LEGACY_AUTOSAVE_ENABLED_KEY]: "true",
      })
    );
    expect(plan.shouldMigrate).toBe(true);
    expect(plan.prefs.autosaveEnabled).toBe(false);
    expect(plan.prefs.autosaveIntervalMs).toBe(10_000);
    expect(plan.prefs.autoloadRecentSession).toBe(false);
    expect(plan.keysToRemove).toEqual([
      LEGACY_SETUP_PREFERENCES_KEY,
      LEGACY_AUTOSAVE_ENABLED_KEY,
    ]);
  });

  it("falls back through the legacy standalone flag chain", () => {
    // Only the old boolean key exists: its value wins.
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      reader({ [LEGACY_AUTOSAVE_ENABLED_KEY]: "false" })
    );
    expect(plan.shouldMigrate).toBe(true);
    expect(plan.prefs.autosaveEnabled).toBe(false);
    expect(plan.prefs.autosaveIntervalMs).toBe(3_000);

    // restoreAutosaveOnLaunch (the oldest name) is honored when the new
    // field is absent.
    const older = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      reader({
        [LEGACY_SETUP_PREFERENCES_KEY]: JSON.stringify({
          restoreAutosaveOnLaunch: false,
        }),
      })
    );
    expect(older.prefs.autosaveEnabled).toBe(false);
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
    ["invalid", true],
  ])("reads legacy standalone autosave value %j as %j", (raw, expected) => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      reader({ [LEGACY_AUTOSAVE_ENABLED_KEY]: raw })
    );

    expect(plan.prefs.autosaveEnabled).toBe(expected);
  });

  it("treats an unparsable legacy blob as defaults but still cleans it up", () => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      reader({ [LEGACY_SETUP_PREFERENCES_KEY]: "not json" })
    );
    expect(plan.shouldMigrate).toBe(true);
    expect(plan.prefs).toEqual(defaultMachinePrefs());
    expect(plan.keysToRemove).toEqual([LEGACY_SETUP_PREFERENCES_KEY]);
  });
});

describe("removableLegacySetupKeys", () => {
  const legacyValues = reader({
    [LEGACY_AUTOSAVE_ENABLED_KEY]: "false",
  });

  it("retains the only durable legacy copy when migration writing fails", () => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "defaults" },
      legacyValues
    );

    expect(plan.shouldMigrate).toBe(true);
    expect(removableLegacySetupKeys(plan, false)).toEqual([]);
    expect(removableLegacySetupKeys(plan, true)).toEqual([
      LEGACY_AUTOSAVE_ENABLED_KEY,
    ]);
  });

  it("cleans stale legacy keys when a machine-prefs file already exists", () => {
    const plan = planSetupPrefsMigration(
      { prefs: defaultMachinePrefs(), source: "file" },
      legacyValues
    );

    expect(plan.shouldMigrate).toBe(false);
    expect(removableLegacySetupKeys(plan, false)).toEqual([
      LEGACY_AUTOSAVE_ENABLED_KEY,
    ]);
  });
});
