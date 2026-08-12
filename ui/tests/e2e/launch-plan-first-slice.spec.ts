import { expect, test } from "@playwright/test";

import {
  clearCommandFailure,
  commandNames,
  countCommand,
  emitLiveCycle,
  emitNativeMenuAction,
  expectNoErrorNotices,
  expectedMatraCellCount,
  getDriverState,
  getE2eState,
  openCaesura,
  openCaesuraShell,
  releasePreviewCycle,
  waitForIdle,
  waitForPendingPreview,
  waitForPlaying,
  waitForTimelineReady,
} from "./support/appHarness";

test.describe("launch plan first slice", () => {
  test("boots into a coherent default timeline without command errors", async ({
    page,
  }) => {
    await openCaesura(page);

    const state = await getE2eState(page);
    const driver = await getDriverState(page);

    await expect(page).toHaveTitle("Dum-Ka");
    await expect(page.locator(".masthead h1")).toHaveText("Dum-Ka");
    await expectNoErrorNotices(page);
    await expect(
      page.getByLabel("Transport").getByText("Idle", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("e2e-score")).toBeVisible();
    await expect(page.getByText("0 section boundaries")).toBeVisible();
    await expect(page.getByText("1 realized sections")).toBeVisible();
    expect(state.switchRequest).toMatchObject({
      ok: true,
      cycleBeats: 4,
      inflectionCount: 0,
    });
    expect(state.preview).toMatchObject({
      cycle: 0,
      beatCount: 4,
      sectionStartBeats: [1],
    });
    expect(state.timelineLayerSourcesCoherent).toBe(true);
    expect(state.rhythmSpanCount).toBeGreaterThan(0);
    expect(commandNames(driver)).toContain("transport_get_snapshot");
    expect(commandNames(driver)).toContain("score_preview_subdivision_switch");
    expect(commandNames(driver)).toContain("generator_preview");
  });

  test("keeps Play disabled while the initial preview is pending, then enables it", async ({
    page,
  }) => {
    await openCaesuraShell(page, { holdPreviewCycles: [0] });
    await waitForPendingPreview(page, 0);

    let state = await getE2eState(page);
    expect(state.timelinePreviewReady).toBe(false);
    expect(state.timelineLayerSourcesCoherent).toBe(false);
    expect(state.canStartPlayback).toBe(false);
    await expect(page.getByTestId("transport-play")).toBeDisabled();

    await releasePreviewCycle(page, 0);
    await waitForTimelineReady(page);

    state = await getE2eState(page);
    expect(state.timelinePreviewReady).toBe(true);
    expect(state.timelineRhythmReady).toBe(true);
    expect(state.canStartPlayback).toBe(true);
    await expect(page.getByTestId("transport-play")).toBeEnabled();
  });

  test("surfaces an initial preview failure without allowing playback", async ({
    page,
  }) => {
    await openCaesuraShell(page, {
      commandFailures: {
        score_preview_subdivision_switch: "e2e preview failed",
      },
    });

    await expect(page.locator(".preview-banner")).toContainText("e2e preview failed");
    const state = await getE2eState(page);
    expect(state.timelinePreviewReady).toBe(false);
    expect(state.canStartPlayback).toBe(false);
    await expect(page.getByTestId("transport-play")).toBeDisabled();
  });

  test("recovers from a preview failure after the backend succeeds again", async ({
    page,
  }) => {
    await openCaesuraShell(page, {
      commandFailures: {
        score_preview_subdivision_switch: "e2e preview failed",
      },
    });
    await expect(page.locator(".preview-banner")).toContainText("e2e preview failed");

    await clearCommandFailure(page, "score_preview_subdivision_switch");
    await page
      .locator(".preview-cycle-selector")
      .getByRole("button", { name: "Inspect next stopped cycle" })
      .click();
    await waitForTimelineReady(page);

    const state = await getE2eState(page);
    const driver = await getDriverState(page);
    await expectNoErrorNotices(page);
    expect(state.timelineLayoutCycle).toBe(1);
    expect(state.canStartPlayback).toBe(true);
    expect(driver.lastPreviewRequest?.cycle).toBe(1);
    await expect(page.getByTestId("transport-play")).toBeEnabled();
  });

  test("records a preview request that matches the neutral default patch", async ({
    page,
  }) => {
    await openCaesura(page);

    const driver = await getDriverState(page);
    const request = driver.lastPreviewRequest?.request;

    expect(driver.lastPreviewRequest?.cycle).toBe(0);
    expect(request).toMatchObject({
      name: "untitled",
      cycleBeats: 4,
      seedMode: "perCycle",
      seed: expect.any(Number),
      pitch: 60,
      velocity: 96,
      singleParameterRhythmicModulation: false,
      accent: {
        beatStart: { min: 0, max: 0 },
        sectionStartExtra: { min: 0, max: 0 },
        jathiStart: { min: 0, max: 0 },
        jathiMode: "overrideGati",
      },
    });
    expect(request?.seed).not.toBe(20260505);
    expect(request?.initialWeights).toEqual([{ subdivision: 4, weight: 1 }]);
    expect(request?.inflections).toEqual([]);
    expect(request?.switchCountWeights).toEqual([{ count: 0, weight: 1 }]);
  });

  test("uses the locked new-session seed preference before any patch load", async ({
    page,
  }) => {
    await openCaesura(page, {
      globalSeedStartupLock: { locked: true, seed: 314159 },
    });

    const driver = await getDriverState(page);
    expect(driver.lastPreviewRequest?.request).toMatchObject({
      seedMode: "perCycle",
      seed: 314159,
    });
  });

  test("keeps startup locking and only the retained seed streams", async ({ page }) => {
    await openCaesura(page);

    await page.locator(".seed-loop-monitor").click();
    const dialog = page.getByRole("dialog", { name: "Seed Strategy" });
    await expect(dialog).toBeVisible();

    for (const name of ["Global", "Generator", "Channel", "Log"]) {
      await expect(dialog.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    for (const removed of ["Pitch", "Ratchet", "Drift", "Morph"]) {
      await expect(dialog.getByRole("tab", { name: removed, exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: removed, exact: true })).toHaveCount(0);
    }

    await dialog.getByRole("tab", { name: "Global" }).click();
    const lock = dialog.getByRole("switch", {
      name: "Lock global seed for new sessions",
    });
    await lock.click();
    await expect(lock).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(
            window.localStorage.getItem("caesura.globalSeedStartupLock.v1") ?? "{}"
          )
        )
      )
      .toMatchObject({ locked: true });

    await dialog.getByRole("tab", { name: "Generator" }).click();
    await expect(dialog.getByRole("group", { name: "Generator seed mode" })).toBeVisible();
    await dialog.getByRole("tab", { name: "Channel" }).click();
    await expect(dialog.getByRole("group", { name: "Channel seed mode" })).toBeVisible();
  });
  test("keeps same-gati fired boundaries as separate visual sections", async ({
    page,
  }) => {
    const path = "/tmp/caesura-e2e-same-gati.dumka";
    await openCaesura(page, {
      forceSameGatiSections: true,
      lastPatchPath: path,
      setupPreferences: { autosaveEnabled: true, autoloadRecentSession: true },
      patchFiles: {
        [path]: {
          app: "Dum-Ka",
          schemaVersion: 1,
          savedAt: "2026-05-16T12:00:00.000Z",
          transport: {
            tempoBpm: 80,
            synthEnabled: false,
            synthPrograms: [],
            rhythmPlaybackEnabled: true,
            currentScoreId: null,
            cycleTempoFlux: { enabled: false },
          },
          sequencer: {
            name: "same gati sections",
            cycleBeats: 8,
            initialWeights: [{ subdivision: 4, weight: 1 }],
            initialJathiWeights: [],
            boundaries: [
              {
                id: "boundary-after-2",
                afterBeat: 2,
                changeProbability: 1,
                weights: [{ subdivision: 4, weight: 1 }],
                jathiWeights: [],
              },
              {
                id: "boundary-after-6",
                afterBeat: 6,
                changeProbability: 1,
                weights: [{ subdivision: 4, weight: 1 }],
                jathiWeights: [],
              },
            ],
            sectionCountWeights: [{ count: 2, weight: 1 }],
            seedMode: "locked",
            seed: 20260505,
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
        },
      },
    });
    await page.waitForFunction(
      (loadedPath) => {
        const state = window.__CAESURA_E2E_DRIVER__?.getState();
        return (
          state?.lastPatchLoadPath === loadedPath &&
          state?.lastPreviewRequest?.request?.inflections?.length === 2
        );
      },
      path
    );

    const state = await getE2eState(page);
    expect(state.sections.length).toBeGreaterThan(1);
    expect(new Set(state.sections.map((section) => section.gati))).toEqual(new Set([4]));
    expect(state.preview?.sectionStartBeats).toEqual([1, 3, 7]);
    await expect(page.getByTestId("resolved-section")).toHaveCount(3);
    await expect(page.getByTestId("gati-matra-cell")).toHaveCount(
      expectedMatraCellCount(state)
    );

    const sections = page.getByTestId("resolved-section");
    await expect(sections.nth(0)).toHaveAttribute("data-gati", "4");
    await expect(sections.nth(1)).toHaveAttribute("data-gati", "4");
    await expect(sections.nth(2)).toHaveAttribute("data-gati", "4");
  });

  test("resets timeline sync from a native menu action and returns to a coherent idle timeline", async ({
    page,
  }) => {
    await openCaesura(page, { holdPreviewCycles: [1] });
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await emitLiveCycle(page, 1);
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__;
      return Boolean(state?.timelineLayoutCycle === 1 && !state.timelineLayerSourcesCoherent);
    });

    await emitNativeMenuAction(page, "resetTransportSync");
    await waitForIdle(page);

    const state = await getE2eState(page);
    const driver = await getDriverState(page);
    expect(state.timelineLayoutCycle).toBe(0);
    expect(state.timelineLayerSourcesCoherent).toBe(true);
    expect(countCommand(driver, "transport_resync")).toBe(1);
    expect(countCommand(driver, "transport_get_snapshot")).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Timeline and playback sync reset")).toBeVisible();
    await expect(page.getByText("Syncing live render")).toHaveCount(0);
  });
});
