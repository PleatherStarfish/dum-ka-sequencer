import { expect, test, type Page } from "@playwright/test";

import {
  closeMainEditor,
  countCommand,
  getDriverState,
  getE2eState,
  openCaesura,
  openMainEditor,
  setCommandFailure,
  waitForIdle,
  waitForPlaying,
} from "./support/appHarness";

const TRANSPORT_LOCK_FIXTURE_PATH = "/tmp/caesura-e2e-transport-lock.dumka";

function transportLockFixturePatch() {
  const jathiWeights = [3, 4, 5, 7, 9].map((jathi) => ({ jathi, weight: 1 }));
  const gatiWeights = [
    { subdivision: 3, weight: 1 },
    { subdivision: 4, weight: 1 },
    { subdivision: 5, weight: 1 },
    { subdivision: 7, weight: 1 },
  ];
  return {
    app: "Dum-Ka",
    schemaVersion: 1,
    savedAt: "2026-06-12T12:00:00.000Z",
    transport: {
      tempoBpm: 80,
      synthEnabled: false,
      synthPrograms: [],
      rhythmPlaybackEnabled: true,
      currentScoreId: null,
      cycleTempoFlux: { enabled: false },
    },
    sequencer: {
      name: "transport lock fixture",
      cycleBeats: 8,
      initialWeights: [{ subdivision: 4, weight: 1 }],
      initialJathiWeights: jathiWeights,
      boundaries: [
        {
          id: "boundary-after-2",
          afterBeat: 2,
          changeProbability: 1,
          weights: gatiWeights,
          jathiWeights,
        },
      ],
      sectionCountWeights: [
        { count: 0, weight: 1 },
        { count: 1, weight: 1 },
      ],
      seedMode: "perCycle",
      seed: 20260612,
      pitch: 60,
      velocity: 96,
      accent: {
        beatStart: { min: 0, max: 0 },
        sectionStartExtra: { min: 0, max: 0 },
        jathiStart: { min: 0, max: 0 },
        jathiMode: "overrideGati",
      },
    },
    rhythm: {},
    setup: {
      autosaveEnabled: true,
      autosaveIntervalMs: 3000,
      autoloadRecentSession: true,
    },
  };
}

async function openAutomationDialog(page: Page) {
  await page.getByRole("button", { name: "Automation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Automation" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function getAutomationPointCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const automation =
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.automation;
    if (!automation || typeof automation !== "object") return 0;
    const tracks = (automation as { tracks?: unknown }).tracks;
    if (!Array.isArray(tracks)) return 0;
    const curves = (tracks[0] as { curves?: unknown } | undefined)?.curves;
    if (!Array.isArray(curves)) return 0;
    const points = (curves[0] as { points?: unknown } | undefined)?.points;
    return Array.isArray(points) ? points.length : 0;
  });
}

async function waitForAutomationPointCount(
  page: Page,
  expectedCount: number
): Promise<void> {
  await page.waitForFunction((count) => {
    const automation =
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.automation;
    if (!automation || typeof automation !== "object") return false;
    const tracks = (automation as { tracks?: unknown }).tracks;
    if (!Array.isArray(tracks)) return false;
    const curves = (tracks[0] as { curves?: unknown } | undefined)?.curves;
    if (!Array.isArray(curves)) return false;
    const points = (curves[0] as { points?: unknown } | undefined)?.points;
    return Array.isArray(points) && points.length === count;
  }, expectedCount);
}

async function clickAutomationGraph(
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
  xUnit: number,
  yUnit: number
): Promise<void> {
  const graph = dialog.getByRole("img", { name: "Velocity automation graph" });
  const box = await graph.boundingBox();
  if (!box) {
    throw new Error("Velocity automation graph was not visible");
  }
  await page.mouse.click(box.x + box.width * xUnit, box.y + box.height * yUnit);
}

test.describe("transport lifecycle and playback locks", () => {
  test("coalesces rapid Play activation into one transport start", async ({
    page,
  }) => {
    await openCaesura(page);

    await page.getByTestId("transport-play").dblclick();
    await waitForPlaying(page);

    const driver = await getDriverState(page);
    expect(countCommand(driver, "transport_play")).toBe(1);
    await expect(page.getByLabel("Transport").getByText("Running")).toBeVisible();
    await expect(page.getByTestId("transport-play")).toBeDisabled();
  });

  test("reports stop failure without clearing the running transport state", async ({
    page,
  }) => {
    await openCaesura(page);
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    await setCommandFailure(page, "transport_stop", "e2e stop failed");
    await page.getByTestId("transport-stop").click();

    await expect(page.locator(".error-banner")).toContainText("e2e stop failed");
    let state = await getE2eState(page);
    expect(state.transportIsPlaying).toBe(true);
    await expect(page.getByLabel("Transport").getByText("Running")).toBeVisible();
    await expect(page.getByTestId("transport-stop")).toBeEnabled();

    await setCommandFailure(page, "transport_stop", null);
    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    state = await getE2eState(page);
    const driver = await getDriverState(page);
    expect(state.transportIsPlaying).toBe(false);
    expect(countCommand(driver, "transport_stop")).toBe(2);
  });

  test("commits valid tempo edits to transport and clamps out-of-range values", async ({
    page,
  }) => {
    await openCaesura(page);
    const tempoInput = page.getByLabel("Global BPM");

    await tempoInput.fill("123.5");
    await tempoInput.press("Enter");
    await page.waitForFunction(
      () => window.__CAESURA_E2E_DRIVER__?.getState()?.snapshot.tempoBpm === 123.5
    );

    let driver = await getDriverState(page);
    expect(countCommand(driver, "transport_set_tempo")).toBe(1);
    await expect(tempoInput).toHaveValue("123.5");

    await tempoInput.fill("401");
    await tempoInput.press("Enter");
    await page.waitForFunction(
      () => window.__CAESURA_E2E_DRIVER__?.getState()?.snapshot.tempoBpm === 400
    );
    await expect(tempoInput).toHaveValue(/^400(?:\.0)?$/);

    driver = await getDriverState(page);
    expect(countCommand(driver, "transport_set_tempo")).toBe(2);
    expect(driver.snapshot.tempoBpm).toBe(400);
  });

  test("toggles the built-in synth through backend commands without duplicate pending toggles", async ({
    page,
  }) => {
    await openCaesura(page);
    await page.waitForFunction(
      () =>
        (window.__CAESURA_E2E_DRIVER__
          ?.getState()
          ?.calls.filter((call) => call.command === "synth_set_programs").length ??
          0) >= 1
    );
    const baseline = await getDriverState(page);
    const baselineProgramCalls = countCommand(baseline, "synth_set_programs");
    const baselineEnabledCalls = countCommand(baseline, "synth_set_enabled");

    await page.getByRole("button", { name: /Synth off/ }).click();
    await page.waitForFunction(
      ({ enabledCalls }) =>
        window.__CAESURA_E2E_DRIVER__
          ?.getState()
          ?.calls.filter((call) => call.command === "synth_set_enabled").length ===
        enabledCalls + 1,
      { enabledCalls: baselineEnabledCalls }
    );
    await expect(page.getByRole("button", { name: /Synth on/ })).toBeVisible();

    let driver = await getDriverState(page);
    // Programs were already applied by the keyed background owner. Enabling
    // joins that successful payload instead of issuing an identical write.
    expect(countCommand(driver, "synth_set_programs")).toBe(baselineProgramCalls);
    expect(countCommand(driver, "synth_set_enabled")).toBe(baselineEnabledCalls + 1);

    await page.getByRole("button", { name: /Synth on/ }).click();
    await page.waitForFunction(
      ({ enabledCalls }) =>
        window.__CAESURA_E2E_DRIVER__
          ?.getState()
          ?.calls.filter((call) => call.command === "synth_set_enabled").length ===
        enabledCalls + 2,
      { enabledCalls: baselineEnabledCalls }
    );

    driver = await getDriverState(page);
    expect(countCommand(driver, "synth_set_programs")).toBe(baselineProgramCalls);
    expect(countCommand(driver, "synth_set_enabled")).toBe(baselineEnabledCalls + 2);
    await expect(page.getByRole("button", { name: /Synth off/ })).toBeVisible();
  });

  test("authors playback generation from the generator editor", async ({
    page,
  }) => {
    await openCaesura(page);

    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastTrackPlaybackRequest
          ?.generatorEnabled === true
    );

    const driver = await getDriverState(page);
    expect(driver.lastTrackPlaybackRequest?.generatorEnabled).toBe(true);
    const generator = await openMainEditor(page, "generator");
    const enabled = generator.getByRole("checkbox");
    await expect(enabled).toBeChecked();
    await enabled.uncheck();
    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastTrackPlaybackRequest
          ?.generatorEnabled === false
    );
    expect(
      (await getDriverState(page)).lastTrackPlaybackRequest?.generatorEnabled
    ).toBe(false);
  });

  test("locks cycle length, boundary topology, and automation length while playing", async ({
    page,
  }) => {
    await openCaesura(page, {
      lastPatchPath: TRANSPORT_LOCK_FIXTURE_PATH,
      setupPreferences: { autosaveEnabled: true, autoloadRecentSession: true },
      patchFiles: {
        [TRANSPORT_LOCK_FIXTURE_PATH]: transportLockFixturePatch(),
      },
    });
    await page.waitForFunction(
      (path) =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPatchLoadPath === path &&
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
          ?.cycleBeats === 8,
      TRANSPORT_LOCK_FIXTURE_PATH
    );
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    await openMainEditor(page, "boundaries");
    await expect(page.getByLabel("Beats/cycle")).toBeDisabled();

    const rail = page.getByLabel("Section boundaries");
    await expect(rail).toHaveClass(/is-disabled/);
    await expect(rail).toHaveAttribute(
      "title",
      "Stop playback before changing section boundaries"
    );
    await expect(
      page
        .getByLabel("Boundary after beat 2 actions")
        .getByRole("button", { name: "edit" })
    ).toBeDisabled();
    await expect(
      page
        .getByLabel("Boundary after beat 2 actions")
        .getByRole("button", { name: "del" })
    ).toBeDisabled();

    await expect(page.locator(".automation-length-field input")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Pick target" })).toHaveCount(0);

    await closeMainEditor(page);
    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    // Closed editor bodies are intentionally unmounted. Reopen Sections so
    // these assertions target its authored controls rather than the disabled
    // inherited-cycle readout in the track strip.
    await openMainEditor(page, "boundaries");
    await expect(page.getByLabel("Beats/cycle")).toBeEnabled();
    await expect(rail).not.toHaveClass(/is-disabled/);
    await expect(page.locator(".automation-length-field input")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Pick target" })).toHaveCount(0);
  });

  test("locks automation graph point and segment editing while playing", async ({
    page,
  }) => {
    await openCaesura(page);

    let dialog = await openAutomationDialog(page);
    await dialog
      .getByRole("button", { name: /Velocity\s+Cycle\s+int\s+beat/ })
      .click();
    await expect(
      dialog.getByRole("img", { name: "Velocity automation graph" })
    ).toBeVisible();
    await waitForAutomationPointCount(page, 2);

    await dialog.getByRole("button", { name: "add marker" }).click();
    await expect(dialog.locator(".automation-marker-row")).toHaveCount(1);
    await clickAutomationGraph(page, dialog, 0.45, 0.35);
    await waitForAutomationPointCount(page, 3);

    await dialog.getByLabel("Close Automation editor").click();
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    dialog = await openAutomationDialog(page);
    await expect(dialog).toHaveClass(/is-disabled/);
    await expect(dialog.getByLabel("Find")).toBeDisabled();
    await expect(dialog.getByLabel("Group")).toBeDisabled();
    await expect(dialog.getByLabel("Type")).toBeDisabled();
    await expect(dialog.locator(".automation-target-row").first()).toBeDisabled();

    await expect(dialog.getByRole("switch").first()).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "remove lane" })
    ).toBeDisabled();

    const pointRows = dialog.locator(".automation-point-row");
    await expect(pointRows).toHaveCount(3);
    const editablePoint = pointRows.nth(1);
    await expect(editablePoint.locator('[role="spinbutton"]').nth(0)).toBeDisabled();
    await expect(editablePoint.locator('[role="spinbutton"]').nth(1)).toBeDisabled();
    await expect(editablePoint.locator("select")).toBeDisabled();
    await expect(
      editablePoint.getByRole("button", { name: "remove" })
    ).toBeDisabled();

    const graphControls = dialog.locator(".automation-graph-controls");
    await expect(
      graphControls.locator("label").filter({ hasText: "Segment" }).locator("select")
    ).toBeDisabled();
    await expect(
      graphControls.locator("label").filter({ hasText: "Curve" }).locator("select")
    ).toBeDisabled();
    await expect(
      graphControls.getByRole("slider", { name: "Automation curve bend" })
    ).toBeDisabled();

    const lockedPointCount = await getAutomationPointCount(page);
    await clickAutomationGraph(page, dialog, 0.68, 0.45);
    expect(await getAutomationPointCount(page)).toBe(lockedPointCount);

    await dialog.getByLabel("Close Automation editor").click();
    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    dialog = await openAutomationDialog(page);
    await expect(dialog).not.toHaveClass(/is-disabled/);
    const releasedPoint = dialog.locator(".automation-point-row").nth(1);
    await expect(releasedPoint.locator('[role="spinbutton"]').nth(0)).toBeEnabled();
    await expect(releasedPoint.locator('[role="spinbutton"]').nth(1)).toBeEnabled();
    await expect(releasedPoint.locator("select")).toBeEnabled();
    await expect(
      releasedPoint.getByRole("button", { name: "remove" })
    ).toBeEnabled();
    await expect(
      dialog
        .locator(".automation-graph-controls label")
        .filter({ hasText: "Curve" })
        .locator("select")
    ).toBeEnabled();

    await clickAutomationGraph(page, dialog, 0.68, 0.45);
    await waitForAutomationPointCount(page, lockedPointCount + 1);
  });
});
