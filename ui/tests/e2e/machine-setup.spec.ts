import { expect, test } from "@playwright/test";

import {
  emitNativeMenuAction,
  getDriverState,
  openCaesura,
  openCaesuraShell,
} from "./support/appHarness";

const iac = { id: "-673416519", name: "IAC Driver Bus 1" };
const synth = { id: "12345", name: "Hardware Synth" };

async function openSetupMidiTab(page: import("@playwright/test").Page) {
  await emitNativeMenuAction(page, "openSetup");
  const dialog = page.getByRole("dialog", { name: "Audio & MIDI Setup" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "MIDI", exact: true }).click();
  return dialog;
}

test.describe("machine setup", () => {
  test("loading a patch never overwrites machine-local autosave settings", async ({
    page,
  }) => {
    const patchPath = "/tmp/caesura/hostile-setup.dumka";
    await openCaesura(page, {
      // Machine prefs file exists with autosave at 3s enabled.
      machinePrefs: {
        autosaveEnabled: true,
        autosaveIntervalMs: 3000,
        autoloadRecentSession: true,
      },
      setupPreferences: undefined,
      lastPatchPath: patchPath,
      recentPatches: [{ path: patchPath, name: "hostile" }],
      // The patch carries hostile setup prefs plus a UI open/tab state.
      patchFiles: {
        [patchPath]: {
          app: "Dum-Ka",
          schemaVersion: 1,
          savedAt: "2026-01-01T00:00:00.000Z",
          transport: { tempoBpm: 80, synthEnabled: false, synthPrograms: [] },
          sequencer: { name: "hostile", cycleBeats: 4 },
          rhythm: {},
          setup: {
            open: false,
            tab: "files",
            autosaveEnabled: false,
            autosaveIntervalMs: 60000,
            autoloadRecentSession: false,
          },
        },
      },
    });

    // Recall the hostile patch explicitly.
    await emitNativeMenuAction(page, "recallRecentPatch");
    await page.waitForTimeout(300);

    const driver = await getDriverState(page);
    // No machine_prefs_set call carried the hostile 60000ms interval.
    const hostileWrites = driver.calls.filter(
      (call) =>
        call.command === "machine_prefs_set" &&
        (call.args as { prefs?: { autosaveIntervalMs?: number } })?.prefs
          ?.autosaveIntervalMs === 60000
    );
    expect(hostileWrites).toHaveLength(0);
    // The machine prefs file still holds the local 3s value.
    expect(driver.machinePrefs.autosaveIntervalMs).toBe(3000);
    expect(driver.machinePrefs.autosaveEnabled).toBe(true);

    // Setup Files tab still reflects the machine value (3s), not the patch's 60.
    await emitNativeMenuAction(page, "openSetup");
    const dialog = page.getByRole("dialog", { name: "Audio & MIDI Setup" });
    await dialog.getByRole("button", { name: "Files", exact: true }).click();
    const interval = dialog.locator(
      ".setup-grid-panel [role='spinbutton']"
    ).first();
    await expect(interval).toHaveValue("3");
  });

  test("migrates legacy setup preferences once, then clears the keys", async ({
    page,
  }) => {
    await openCaesura(page, {
      // No machine-prefs file → source "defaults" → migration may run.
      machinePrefs: null,
      setupPreferences: {
        autosaveEnabled: false,
        autosaveIntervalMs: 10000,
        autoloadRecentSession: false,
      },
    });
    await page.waitForTimeout(200);

    const driver = await getDriverState(page);
    const migrations = driver.calls.filter(
      (call) => call.command === "machine_prefs_set"
    );
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    const migrated = migrations[0].args as {
      prefs: { autosaveIntervalMs: number; autosaveEnabled: boolean };
    };
    expect(migrated.prefs.autosaveIntervalMs).toBe(10000);
    expect(migrated.prefs.autosaveEnabled).toBe(false);

    // The legacy localStorage key is gone after migration.
    const legacy = await page.evaluate(() =>
      window.localStorage.getItem("caesura.setupPreferences.v1")
    );
    expect(legacy).toBeNull();
  });

  test("preserves a user prefs edit made while slow hydration is pending", async ({
    page,
  }) => {
    await openCaesuraShell(page, {
      machinePrefs: {
        autosaveEnabled: true,
        autosaveIntervalMs: 10_000,
        autoloadRecentSession: true,
      },
      commandDelayMs: { machine_prefs_get: 800 },
    });

    await emitNativeMenuAction(page, "openSetup");
    const dialog = page.getByRole("dialog", { name: "Audio & MIDI Setup" });
    await dialog.getByRole("button", { name: "Files", exact: true }).click();
    const autosave = dialog.getByRole("switch", {
      name: "autosave temporary recovery",
    });
    await expect(autosave).toBeChecked();
    await autosave.click();
    await expect(autosave).not.toBeChecked();

    // Hydration applies the untouched machine interval, but neither overwrites
    // nor fails to persist the newer user toggle.
    const interval = dialog.locator("[role='spinbutton']").first();
    await expect(interval).toHaveValue("10", { timeout: 3_000 });
    await expect(autosave).not.toBeChecked();
    await expect
      .poll(async () => (await getDriverState(page)).machinePrefs.autosaveEnabled)
      .toBe(false);
  });

  test("persists edits made during a delayed fallback prefs write", async ({
    page,
  }) => {
    await openCaesuraShell(page, {
      machinePrefs: null,
      commandFailures: { machine_prefs_get: "prefs unavailable" },
      commandDelayMs: {
        machine_prefs_get: 500,
        machine_prefs_set: 700,
      },
    });

    await emitNativeMenuAction(page, "openSetup");
    const dialog = page.getByRole("dialog", { name: "Audio & MIDI Setup" });
    await dialog.getByRole("button", { name: "Files", exact: true }).click();
    const autosave = dialog.getByRole("switch", {
      name: "autosave temporary recovery",
    });
    await autosave.click();

    // Wait until the get failure has entered its fallback write, then make a
    // second edit while that write is in flight.
    await expect
      .poll(async () =>
        (await getDriverState(page)).calls.filter(
          (call) => call.command === "machine_prefs_set"
        ).length
      )
      .toBeGreaterThan(0);
    const interval = dialog.locator("[role='spinbutton']").first();
    await interval.fill("7");
    await interval.press("Enter");

    await expect
      .poll(
        async () => {
          const prefs = (await getDriverState(page)).machinePrefs;
          return [prefs.autosaveEnabled, prefs.autosaveIntervalMs];
        },
        { timeout: 4_000 }
      )
      .toEqual([false, 7_000]);
  });

  test("picks a destination, warns on unplug, reconnects on rescan", async ({
    page,
  }) => {
    await openCaesura(page, {
      machinePrefs: { autosaveEnabled: true },
      midiDestinations: [iac, synth],
    });

    const dialog = await openSetupMidiTab(page);
    const select = dialog.getByLabel("MIDI destination");
    await expect(select).toHaveValue("");

    await select.selectOption(iac.id);
    await expect(
      dialog.locator(".setup-route-status")
    ).toContainText("Also sending to IAC Driver Bus 1.");
    let driver = await getDriverState(page);
    expect(driver.midiRoute.desired?.id).toBe(iac.id);
    expect(driver.midiRoute.connected).toBe(true);

    // Simulate unplugging the IAC bus: the watcher pushes a missing status,
    // the top-bar chip appears, and clicking it reopens Setup → MIDI.
    await page.evaluate((present) => {
      (
        window.__CAESURA_E2E_DRIVER__ as unknown as {
          emitMidiDevicesChanged: (
            list: Array<{ id: string; name: string }>
          ) => void;
        }
      ).emitMidiDevicesChanged(present);
    }, [synth]);
    const chip = page.locator(".midi-route-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("IAC Driver Bus 1");
    await dialog.getByRole("button", { name: "Close Audio & MIDI Setup" }).click();
    await chip.click();
    await expect(
      page.getByRole("dialog", { name: "Audio & MIDI Setup" })
    ).toBeVisible();

    // Plug it back in and rescan: reconnects, chip disappears.
    await page.evaluate((present) => {
      (
        window.__CAESURA_E2E_DRIVER__ as unknown as {
          emitMidiDevicesChanged: (
            list: Array<{ id: string; name: string }>
          ) => void;
        }
      ).emitMidiDevicesChanged(present);
    }, [iac, synth]);
    await page
      .getByRole("dialog", { name: "Audio & MIDI Setup" })
      .getByRole("button", { name: "rescan" })
      .click();
    driver = await getDriverState(page);
    expect(driver.midiRoute.connected).toBe(true);
    await expect(page.locator(".midi-route-chip")).toHaveCount(0);
  });

  test("a stale rescan cannot overwrite a newer destination choice", async ({
    page,
  }) => {
    await openCaesura(page, {
      machinePrefs: {
        midiDestination: iac,
        autosaveEnabled: true,
      },
      midiDestinations: [iac, synth],
    });
    const dialog = await openSetupMidiTab(page);
    const select = dialog.getByLabel("MIDI destination");
    await expect(select).toHaveValue(iac.id);

    await page.evaluate(() => {
      (
        window.__CAESURA_E2E_DRIVER__ as unknown as {
          setCommandDelay: (command: string, delayMs: number) => void;
        }
      ).setCommandDelay("midi_list_destinations", 700);
    });
    await dialog.getByRole("button", { name: "rescan" }).click();
    await select.selectOption(synth.id);
    await expect(select).toHaveValue(synth.id);

    // The rescan captured A before its delayed list completed. Its late status
    // must not roll the UI/ref back after the B picker intent has won.
    await page.waitForTimeout(850);
    await expect(select).toHaveValue(synth.id);
    const driver = await getDriverState(page);
    expect(driver.midiRoute.desired?.id).toBe(synth.id);
  });

  test("MIDI panic silences without stopping the transport", async ({ page }) => {
    await openCaesura(page, { machinePrefs: { autosaveEnabled: true } });

    // From the menu accelerator.
    await emitNativeMenuAction(page, "midiPanic");
    // From the Setup dialog button.
    const dialog = await openSetupMidiTab(page);
    await dialog.getByRole("button", { name: "MIDI panic" }).click();

    const driver = await getDriverState(page);
    const panics = driver.calls.filter(
      (call) => call.command === "transport_panic"
    );
    expect(panics.length).toBeGreaterThanOrEqual(2);
    // Panic must never be an alias for stop.
    const stops = driver.calls.filter(
      (call) => call.command === "transport_stop"
    );
    expect(stops).toHaveLength(0);
  });
});
