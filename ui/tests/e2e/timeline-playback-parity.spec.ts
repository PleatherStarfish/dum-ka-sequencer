import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Rust-generated cross-runtime pin for the stopped-preview cycle limit (see
 * dto_fixture_preview_limits_match in src-tauri/src/main.rs). The spec builds
 * its expected strings and probe cycles from this file so the mock's page
 * literals cannot drift from the backend constants unnoticed.
 */
const previewLimits = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../src/__fixtures__/dto/preview_limits.json", import.meta.url)
    ),
    "utf8"
  )
) as {
  liveGeneratorPreviewCycleRadius: number;
  maxStoppedGeneratorPreviewCycle: number;
};

import {
  closeMainEditor,
  emitLiveCycle,
  expectedMatraCellCount,
  fillNumeric,
  getDriverState,
  getE2eState,
  openCaesura,
  openMainEditor,
  type PreviewPulseSpan,
  releasePreviewCycle,
  waitForIdle,
  waitForPlaying,
} from "./support/appHarness";

const FRESH_SESSION_OPTIONS = {
  setupPreferences: {
    autosaveEnabled: false,
    autoloadRecentSession: false,
  },
};

function numberInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('[role="spinbutton"]')
    .first();
}

async function openFreshEightBeatCaesura(
  page: Page,
  options: Parameters<typeof openCaesura>[1] = {}
): Promise<void> {
  await openCaesura(page, {
    ...FRESH_SESSION_OPTIONS,
    ...options,
    setupPreferences: {
      ...FRESH_SESSION_OPTIONS.setupPreferences,
      ...(options?.setupPreferences ?? {}),
    },
  });

  const state = await getE2eState(page);
  if (state.switchRequest.cycleBeats === 8) return;

  const scoreSetup = await openMainEditor(page, "boundaries");
  await fillNumeric(numberInputByLabel(scoreSetup, "Beats/cycle"), "8");
  await page.waitForFunction(() => {
    const state = window.__CAESURA_E2E_STATE__;
    return Boolean(
      state?.switchRequest?.cycleBeats === 8 &&
        state.timelinePreviewReady &&
        state.timelineRhythmReady &&
        state.timelineLayerSourcesCoherent
    );
  });
  await closeMainEditor(page);
}

async function openAutomationDialog(page: Page) {
  await page.getByRole("button", { name: "Automation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Automation" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function configureVelocityAutomationLane(page: Page): Promise<void> {
  const dialog = await openAutomationDialog(page);
  await dialog
    .getByRole("button", { name: /Velocity\s+Cycle\s+int\s+beat/ })
    .click();
  await expect(
    dialog.getByRole("img", { name: "Velocity automation graph" })
  ).toBeVisible();

  const pointRows = dialog.locator(".automation-point-row");
  await expect(pointRows).toHaveCount(2);
  await fillNumeric(pointRows.first().locator('[role="spinbutton"]').nth(1), "48");
  await fillNumeric(pointRows.nth(1).locator('[role="spinbutton"]').nth(1), "112");
  await dialog.getByLabel("Close Automation editor").click();
}

async function waitForVelocityAutomationPreview(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const beats =
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreview?.beats ?? [];
    const values = beats.map((beat) =>
      beat.automationValues?.find(
        (value) => value.target === "sequencer.velocity"
      )?.value
    );
    return (
      values.length === 8 &&
      Math.round(Number(values[0])) === 48 &&
      Math.round(Number(values[7])) === 104
    );
  });
}

async function showVelocityAutomationTimelineLane(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Show automation lanes in timeline" })
    .click();
  const menu = page.getByRole("group", { name: "Timeline automation lanes" });
  await expect(menu).toBeVisible();
  await menu
    .locator(".timeline-automation-option")
    .filter({ hasText: "Velocity" })
    .locator('input[type="checkbox"]')
    .check();
  await expect(
    page.getByRole("button", { name: "1 automation lanes shown in timeline" })
  ).toBeVisible();
}

async function configureInitialJathiPulseLane(page: Page): Promise<void> {
  const sections = await openMainEditor(page, "boundaries");
  const startSection = sections.getByLabel("Section 1 inspector");
  await fillNumeric(numberInputByLabel(startSection, "Subdivision"), "3");
  await page.waitForFunction(
    () =>
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.initialWeights?.length === 1 &&
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.initialWeights?.[0]?.subdivision === 3
  );
  const grouping = startSection.getByLabel("Grouping", { exact: true });
  await expect(grouping.locator('option[value="4"]')).toHaveCount(1);
  await grouping.selectOption("4");
  await page.waitForFunction(
    () =>
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.initialWeights?.[0]?.weight === 1 &&
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.initialJathiWeights?.[0]?.jathi === 4 &&
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.initialJathiWeights?.[0]?.weight === 1
  );
}

async function waitForJathiPulsePreview(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const spans =
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreview?.pulseSpans ?? [];
    const jathiSpans = spans.filter(
      (span: { kind?: string }) => span.kind === "jathiPulse"
    );
    return (
      jathiSpans.length === 6 &&
      jathiSpans[0]?.jathi === 4 &&
      jathiSpans[5]?.jathi === 4 &&
      jathiSpans.every((span: { sectionIndex?: number }) => span.sectionIndex === 1)
    );
  });
}

test.describe("timeline/playback parity", () => {
  test("renders the stopped timeline from the exact preview returned by the bridge", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);

    const state = await getE2eState(page);
    const driver = await getDriverState(page);

    expect(state.switchRequest.ok).toBe(true);
    expect(state.timelineLayoutCycle).toBe(0);
    expect(state.preview?.cycle).toBe(0);
    expect(driver.lastPreviewRequest?.cycle).toBe(state.timelineLayoutCycle);
    expect(driver.lastPreview?.beats.map((beat) => beat.gati)).toEqual(
      state.preview?.beatGatis
    );

    const sections = page.getByTestId("resolved-section");
    await expect(sections).toHaveCount(state.sections.length);
    for (const [index, section] of state.sections.entries()) {
      const rendered = sections.nth(index);
      await expect(rendered).toHaveAttribute("data-start-beat", `${section.startBeat}`);
      await expect(rendered).toHaveAttribute("data-end-beat", `${section.endBeat}`);
      await expect(rendered).toHaveAttribute("data-gati", `${section.gati}`);
    }

    await expect(page.getByTestId("gati-matra-cell")).toHaveCount(
      expectedMatraCellCount(state)
    );
  });

  test("renders jathi pulse lanes from the exact preview pulse spans", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);
    await configureInitialJathiPulseLane(page);
    await waitForJathiPulsePreview(page);

    const state = await getE2eState(page);
    expect(state.sections.map((section) => section.gati)).toEqual([3]);
    expect(state.sections.map((section) => section.jathi)).toEqual([4]);

    const driver = await getDriverState(page);
    const jathiSpans =
      driver.lastPreview?.pulseSpans.filter(
        (span): span is PreviewPulseSpan & { kind: "jathiPulse" } =>
          span.kind === "jathiPulse"
      ) ?? [];
    const expectedSpans = jathiSpans.map((span) => ({
      sectionIndex: span.sectionIndex,
      jathi: span.jathi,
      index: span.index,
      start: span.start,
      duration: span.duration,
    }));

    expect(expectedSpans).toEqual([
      { sectionIndex: 1, jathi: 4, index: 1, start: 0, duration: 4 / 3 },
      { sectionIndex: 1, jathi: 4, index: 2, start: 4 / 3, duration: 4 / 3 },
      { sectionIndex: 1, jathi: 4, index: 3, start: 8 / 3, duration: 4 / 3 },
      { sectionIndex: 1, jathi: 4, index: 4, start: 4, duration: 4 / 3 },
      { sectionIndex: 1, jathi: 4, index: 5, start: 16 / 3, duration: 4 / 3 },
      { sectionIndex: 1, jathi: 4, index: 6, start: 20 / 3, duration: 4 / 3 },
    ]);

    await expect(
      page.locator(".timeline-lane-label-cell.is-jathi-pulses")
    ).toHaveText(["grouping 4"]);
    // The row itself keeps the accessible name after the label moved to
    // the panel-level rail.
    await expect(
      page.locator(".aligned-timeline-row.is-jathi-pulses").first()
    ).toHaveAttribute("aria-label", "grouping 4");

    const cells = page.getByTestId("jathi-pulse-cell");
    await expect(cells).toHaveCount(jathiSpans.length);
    for (const [index, span] of jathiSpans.entries()) {
      const cell = cells.nth(index);
      await expect(cell).toHaveText(`${span.index}`);
      await expect(cell).toHaveAttribute("data-section-index", `${span.sectionIndex}`);
      await expect(cell).toHaveAttribute("data-jathi", `${span.jathi}`);
      await expect(cell).toHaveAttribute("data-pulse-index", `${span.index}`);
      await expect(cell).toHaveAttribute("data-start", `${span.start}`);
      await expect(cell).toHaveAttribute("data-duration", `${span.duration}`);
      await expect(cell).toHaveAttribute(
        "title",
        `grouping ${span.jathi} pulse ${span.index}`
      );
    }
  });

  test("starts playback only after applying the same structure and generator request shown in the timeline", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);

    await expect(page.getByTestId("transport-play")).toBeEnabled();
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const state = await getE2eState(page);
    const driver = await getDriverState(page);
    const commandNames = driver.calls.map((call) => call.command);
    const playIndex = commandNames.lastIndexOf("transport_play");
    const createIndex = commandNames.lastIndexOf("score_create_subdivision_switch");
    const playbackSetIndex = commandNames.lastIndexOf("track_set_playback");

    expect(playIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(playbackSetIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeLessThan(playIndex);
    expect(playbackSetIndex).toBeLessThan(playIndex);
    expect(driver.lastScoreCreateRequest).toEqual(driver.lastPreviewRequest?.request);
    expect(driver.lastGeneratorPreviewRequest?.cycle).toBe(state.timelineLayoutCycle);
    expect(driver.lastGeneratorPreviewRequest?.enabled).toBe(
      driver.lastTrackPlaybackRequest?.generatorEnabled
    );
    expect(driver.lastGeneratorPreviewRequest?.generator).toEqual(
      driver.lastTrackPlaybackRequest?.generator
    );
    expect(driver.lastGeneratorPreviewRequest?.automation).toEqual(
      driver.lastTrackPlaybackRequest?.automation
    );
    expect(driver.lastGeneratorPreviewRequest?.trackId).toBeNull();
    expect(state.timelineLayerSourcesCoherent).toBe(true);
    await expect(page.getByText("Syncing live render")).toHaveCount(0);
    await expect(page.getByTestId("transport-play")).toBeDisabled();
    await expect(page.getByTestId("transport-stop")).toBeEnabled();
  });

  test("parallel preview carries the authored track identity applied at Play", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);
    await page.getByRole("button", { name: "New track", exact: true }).click();
    await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
    await expect
      .poll(async () => (await getDriverState(page)).lastGeneratorPreviewRequest?.trackId)
      .not.toBeNull();

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const driver = await getDriverState(page);
    const preview = driver.lastGeneratorPreviewRequest;
    const parallel = driver.lastParallelPlaybackRequest;
    expect(parallel).not.toBeNull();
    const active = parallel?.tracks[0];
    expect(preview?.trackId).toBe(active?.id);
    expect(preview?.generator).toEqual(active?.playback.generator);
    expect(preview?.automation).toEqual(active?.playback.automation);
    expect(preview?.enabled).toBe(active?.playback.generatorEnabled);
  });

  test("renders automation lane values from the preview and applies the same automation to playback", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);
    await configureVelocityAutomationLane(page);
    await waitForVelocityAutomationPreview(page);
    await showVelocityAutomationTimelineLane(page);

    const driverBeforePlay = await getDriverState(page);
    const expectedCellText =
      driverBeforePlay.lastPreview?.beats.map((beat) => {
        const value = beat.automationValues?.find(
          (sample) => sample.target === "sequencer.velocity"
        )?.value;
        expect(value).toBeDefined();
        return `${Math.round(value!)}`;
      }) ?? [];

    expect(expectedCellText).toEqual(["48", "56", "64", "72", "80", "88", "96", "104"]);
    const automationCells = page.locator(".automation-layer-cell");
    await expect(automationCells).toHaveCount(expectedCellText.length);
    await expect(automationCells).toHaveText(expectedCellText);
    await expect(automationCells.first()).toHaveAttribute(
      "title",
      "beat 1 · Velocity 48 · phase 0/8"
    );
    await expect(automationCells.last()).toHaveAttribute(
      "title",
      "beat 8 · Velocity 104 · phase 7/8"
    );

    const state = await getE2eState(page);
    expect(
      state.sections.flatMap((section) =>
        section.beats.map((beat) => beat.automationTargets ?? [])
      )
    ).toEqual(Array.from({ length: 8 }, () => ["sequencer.velocity"]));

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const driverAfterPlay = await getDriverState(page);
    const previewAutomation = driverAfterPlay.lastPreviewRequest?.request.automation;
    expect(driverAfterPlay.lastScoreCreateRequest?.automation).toEqual(
      previewAutomation
    );
    expect(driverAfterPlay.lastTrackPlaybackRequest?.automation).toEqual(
      previewAutomation
    );
    expect(driverAfterPlay.lastGeneratorPreviewRequest?.automation).toEqual(
      driverAfterPlay.lastTrackPlaybackRequest?.automation
    );
    expect(driverAfterPlay.lastGeneratorPreviewRequest?.generator).toEqual(
      driverAfterPlay.lastTrackPlaybackRequest?.generator
    );
    expect(driverAfterPlay.lastGeneratorPreviewRequest?.enabled).toBe(
      driverAfterPlay.lastTrackPlaybackRequest?.generatorEnabled
    );
  });

  test("authors a Dum-Ka pattern and plays exactly the previewed request", async ({
    page,
  }) => {
    const pattern = "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2";
    await openFreshEightBeatCaesura(page);
    await page.getByRole("button", { name: "Generator" }).click();
    await page.getByLabel("Generator kind").selectOption("dumka");
    const field = page.getByLabel("Dum-Ka pattern");
    await field.fill(pattern);
    await field.blur();
    await expect(page.getByLabel("Required structure")).toHaveText(
      "needs 4 beats · Subdivision 20"
    );
    await page.getByRole("button", { name: "Apply structure" }).click();
    await expect(
      page.getByRole("button", { name: "Structure ready" })
    ).toBeDisabled();
    await page.locator("#generator-editor summary").click();

    await expect
      .poll(async () => {
        const driver = await getDriverState(page);
        const generator = driver.lastGeneratorPreviewRequest?.generator as
          | { kind?: string; pattern?: string }
          | undefined;
        return generator?.kind === "dumka" && generator.pattern === pattern;
      })
      .toBe(true);

    await expect(page.getByTestId("transport-play")).toBeEnabled();
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const driver = await getDriverState(page);
    expect(driver.lastGeneratorPreviewRequest?.generator).toEqual(
      driver.lastTrackPlaybackRequest?.generator
    );
    const played = driver.lastTrackPlaybackRequest?.generator as {
      kind?: string;
      pattern?: string;
    };
    expect(played.kind).toBe("dumka");
    expect(played.pattern).toBe(pattern);
    expect(driver.lastTrackPlaybackRequest?.generatorEnabled).toBe(true);
  });

  test("explains a rejected generator preview after the editor closes and recovers without stale copy", async ({
    page,
  }) => {
    const message =
      "dumka structure mismatch: pattern spans 4 beats but the cycle has 8";
    const pendingTitle =
      "Waiting for the timeline render to match the current patch";

    await openFreshEightBeatCaesura(page);
    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    await expect(generator.getByText(message, { exact: true })).toBeVisible();

    await closeMainEditor(page);
    await expect(page.getByLabel("Dum-Ka pattern")).toHaveCount(0);

    const play = page.getByTestId("transport-play");
    await expect(play).toBeDisabled();
    await expect(play).toHaveAttribute("title", `Playback blocked: ${message}`);
    const warning = page.locator("#transport-playback-warning");
    await expect(warning).toHaveAttribute("role", "status");
    await expect(warning).toContainText(message);
    await expect(play).toHaveAttribute(
      "aria-describedby",
      "transport-playback-warning"
    );

    const reopened = await openMainEditor(page, "generator");
    await reopened.getByRole("button", { name: "Apply structure" }).click();

    // The corrected request has a new key immediately, so the old terminal
    // failure becomes ordinary pending state before its replacement resolves.
    expect(await play.getAttribute("title")).toBe(pendingTitle);
    expect(await warning.count()).toBe(0);

    await expect(play).toBeEnabled();
    await expect(play).toHaveAttribute("title", "Play");
    await expect(play).not.toHaveAttribute("aria-describedby", /.+/);
  });

  test("mock dumka preview mirrors the engine's cells and pinned diagnostics", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);

    const results = await page.evaluate(async (horizonCycle) => {
      const driver = window.__CAESURA_E2E_DRIVER__;
      if (!driver) throw new Error("missing e2e driver");
      const spans20 = [1, 2, 3, 4].map((spanId) => ({
        spanId,
        spanLen: 20,
        label: null,
        sectionIndex: 1,
        subdivision: 20,
      }));
      const spans4 = [1, 2, 3, 4].map((spanId) => ({
        spanId,
        spanLen: 4,
        label: null,
        sectionIndex: 1,
        subdivision: 4,
      }));
      const dumka = (pattern: string) => ({
        kind: "dumka",
        pattern,
        seedMode: { type: "locked", seed: 7 },
      });
      const request = (
        generator: Record<string, unknown>,
        spans: unknown[],
        cycleBeats: number,
        enabled = true
      ) => ({
        spans,
        enabled,
        generator,
        cycle: 0,
        cycleBeats,
        automation: null,
        trackId: null,
      });
      const evolutionAutomation = {
        lengthCycles: 1,
        markers: [],
        tracks: [
          {
            id: "dumka-evolution-rate",
            target: "generator.dumka.evolutionRate",
            enabled: true,
            combine: "replace",
            graphRange: null,
            curves: [
              {
                id: "dumka-evolution-rate-hold",
                enabled: true,
                interpolation: "hold",
                points: [
                  {
                    id: "dumka-evolution-rate-zero",
                    time: { numer: 0, denom: 1 },
                    value: { type: "number", value: 0 },
                    anchorId: null,
                    outCurve: null,
                  },
                ],
              },
            ],
          },
        ],
      };
      const errorFor = async (req: Record<string, unknown>) => {
        try {
          await driver.invoke("generator_preview", { request: req });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const articulated =
        "[dum@3 ka] [. ka] [[dum .] [ka .] [dum .] [ka .] [dum .]]@2";
      const ok = (await driver.invoke("generator_preview", {
        request: request(dumka(articulated), spans20, 4),
      })) as { spans: Array<{ cells: Array<Record<string, unknown>> }> };
      const disabled = (await driver.invoke("generator_preview", {
        request: request(dumka(articulated), spans20, 4, false),
      })) as { spans: unknown[] };
      const staticLater = (await driver.invoke("generator_preview", {
        request: {
          ...request(dumka(articulated), spans20, 4),
          cycle: 1,
        },
      })) as { spans: Array<{ cells: Array<{ rest: boolean }> }> };
      return {
        firstSpanCells: ok.spans[0]!.cells,
        totalSounding: ok.spans
          .flatMap((span) => span.cells)
          .filter((cell) => cell.rest === false).length,
        disabledSpanCount: disabled.spans.length,
        staticLaterSounding: staticLater.spans
          .flatMap((span) => span.cells)
          .filter((cell) => !cell.rest).length,
        evolvingCycleError: await errorFor({
          ...request(
            { ...dumka(articulated), evolutionRate: 1 },
            spans20,
            4
          ),
          cycle: 1,
        }),
        automatedEvolutionCycleError: await errorFor({
          ...request(dumka(articulated), spans20, 4),
          cycle: 1,
          automation: evolutionAutomation,
        }),
        parseError: await errorFor(request(dumka("[x"), spans20, 4)),
        beatsError: await errorFor(request(dumka("x . x ."), spans20, 3)),
        sustain: await driver.invoke("generator_preview", {
          request: request(dumka("x _ x ."), spans4, 4),
        }),
        subdivisionMetadataError: await errorFor(
          request(
            dumka(articulated),
            spans20.map((span, index) => ({
              ...span,
              subdivision: index === 0 ? 10 : 20,
            })),
            4
          )
        ),
        evolutionRateError: await errorFor(
          request({ ...dumka(articulated), evolutionRate: 101 }, spans20, 4)
        ),
        driftLeashError: await errorFor(
          request({ ...dumka(articulated), driftLeash: 250 }, spans20, 4)
        ),
        negativeEvolutionRateError: await errorFor(
          request({ ...dumka(articulated), evolutionRate: -1 }, spans20, 4)
        ),
        fractionalDriftLeashError: await errorFor(
          request({ ...dumka(articulated), driftLeash: 0.5 }, spans20, 4)
        ),
        stoppedPreviewHorizonError: await errorFor({
          ...request(dumka(articulated), spans20, 4),
          cycle: horizonCycle,
        }),
        unknownEntry: await errorFor(
          request(dumka("zzz not precompiled"), spans20, 4)
        ),
      };
    }, previewLimits.maxStoppedGeneratorPreviewCycle + 1);

    expect(results.totalSounding).toBe(8);
    expect(results.firstSpanCells).toEqual([
      {
        index: 0,
        start: 0,
        len: 15,
        rest: false,
        tiedFromPrevious: false,
        tiedToNext: false,
      },
      {
        index: 1,
        start: 15,
        len: 5,
        rest: false,
        tiedFromPrevious: false,
        tiedToNext: false,
      },
    ]);
    expect(results.disabledSpanCount).toBe(0);
    expect(results.staticLaterSounding).toBe(8);
    expect(results.evolvingCycleError).toBe(
      "mock dumka preview cannot resolve evolving cycle 1; use the real-backend lane"
    );
    expect(results.automatedEvolutionCycleError).toBe(
      "mock dumka preview cannot resolve evolving cycle 1; use the real-backend lane"
    );
    expect(results.parseError).toBe(
      "dumka pattern parse error at line 1, column 3: unclosed '['"
    );
    expect(results.beatsError).toBe(
      "dumka structure mismatch: pattern spans 4 beats but the cycle has 3"
    );
    expect(results.sustain.spans[0].cells.at(-1)).toMatchObject({
      rest: false,
      tiedFromPrevious: false,
      tiedToNext: true,
    });
    expect(results.sustain.spans[1].cells[0]).toMatchObject({
      rest: false,
      tiedFromPrevious: true,
      tiedToNext: false,
    });
    expect(results.subdivisionMetadataError).toBe(
      "dumka structure mismatch: spans carry 80 steps over 4 beats; a uniform per-beat Subdivision is required"
    );
    expect(results.evolutionRateError).toBe(
      "dumka evolutionRate must be 0-100, got 101"
    );
    expect(results.driftLeashError).toBe(
      "dumka driftLeash must be 0-100, got 250"
    );
    // Non-u32 values never reach the engine's validator — the serde
    // boundary refuses them first — so the mock reports its own loud
    // rejection instead of impersonating a DumkaRange Display that Rust
    // cannot produce for these inputs.
    expect(results.negativeEvolutionRateError).toContain(
      "mock dumka preview rejected evolutionRate -1"
    );
    expect(results.fractionalDriftLeashError).toContain(
      "mock dumka preview rejected driftLeash 0.5"
    );
    expect(results.stoppedPreviewHorizonError).toBe(
      `generator preview cycle ${
        previewLimits.maxStoppedGeneratorPreviewCycle + 1
      } exceeds the stopped preview limit of ${
        previewLimits.maxStoppedGeneratorPreviewCycle
      } and is not within ${
        previewLimits.liveGeneratorPreviewCycleRadius
      } cycles of live playback`
    );
    expect(results.unknownEntry).toContain("no precompiled entry");
  });

  test("mock generator mirrors dispatch, cycle-start automation, and Rust seed vectors", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);

    const results = await page.evaluate(async () => {
      const driver = window.__CAESURA_E2E_DRIVER__;
      if (!driver) throw new Error("missing e2e driver");
      const base = driver.getState().lastGeneratorPreviewRequest;
      if (!base) throw new Error("missing generator preview request");
      const spans = [{ spanId: 9, spanLen: 64, label: null, sectionIndex: 1 }];
      const generator = (
        seedMode: Record<string, unknown>,
        densityPercent: number
      ) => ({
        kind: "example",
        densityPercent,
        seedMode,
      });
      const automation = (points: unknown[]) => ({
        lengthCycles: 1,
        markers: [],
        tracks: [
          {
            id: "density-add",
            target: "generator.example.density",
            enabled: true,
            combine: "add",
            graphRange: null,
            curves: [
              {
                id: "density-add-curve",
                enabled: true,
                interpolation: "linear",
                points,
              },
            ],
          },
        ],
      });
      const invoke = (request: Record<string, unknown>) =>
        driver.invoke("generator_preview", { request });
      const errorFor = async (request: Record<string, unknown>) => {
        try {
          await invoke(request);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const common = { ...base, spans, enabled: true, cycle: 0, cycleBeats: 8 };
      const seeded42 = await invoke({
        ...common,
        generator: generator({ type: "locked", seed: "42" }, 60),
        automation: null,
      });
      const seeded42Replay = await invoke({
        ...common,
        generator: generator({ type: "locked", seed: "42" }, 60),
        automation: null,
      });
      const seeded43 = await invoke({
        ...common,
        generator: generator({ type: "locked", seed: "43" }, 60),
        automation: null,
      });
      const automated = await invoke({
        ...common,
        generator: generator({ type: "locked", seed: "42" }, 60),
        automation: automation([
          {
            id: "density-add-point",
            time: { numer: 0, denom: 1 },
            value: { type: "number", value: 40 },
            anchorId: null,
            outCurve: null,
          },
        ]),
      });
      const emptyCurveFallback = await invoke({
        ...common,
        generator: generator({ type: "locked", seed: "42" }, 100),
        automation: automation([]),
      });
      const largeSeedVector = await invoke({
        ...common,
        spans: [{ spanId: 9, spanLen: 16, label: null, sectionIndex: 1 }],
        generator: generator(
          { type: "locked", seed: "9007199254740993" },
          60
        ),
        automation: null,
      });
      const perCycle = await invoke({
        ...common,
        cycle: 3,
        generator: generator(
          { type: "perCycle", seed: "9007199254740993" },
          60
        ),
        automation: null,
      });
      const history = await invoke({
        ...common,
        cycle: 3,
        generator: generator(
          {
            type: "history",
            seed: "9007199254740993",
            history: ["17", "9007199254740995"],
            historyWeight: 1,
            newSeedWeight: 1,
            maxHistory: 4,
          },
          60
        ),
        automation: null,
      });
      const unknownKindError = await errorFor({
        ...common,
        generator: {
          kind: "notARealGenerator",
          densityPercent: 60,
          seedMode: { type: "locked", seed: "42" },
        },
      });
      const invalidDensityError = await errorFor({
        ...common,
        generator: generator({ type: "locked", seed: "42" }, 101),
      });
      const scoreRequest = driver.getState().lastPreviewRequest?.request;
      if (!scoreRequest) throw new Error("missing score preview request");
      const scorePreview = await driver.invoke("score_preview_subdivision_switch", {
        request: {
          ...scoreRequest,
          automation: automation([
            {
              id: "density-ramp-start",
              time: { numer: 0, denom: 1 },
              value: { type: "number", value: 0 },
              anchorId: null,
              outCurve: null,
            },
            {
              id: "density-ramp-end",
              time: { numer: 1, denom: 1 },
              value: { type: "number", value: 80 },
              anchorId: null,
              outCurve: null,
            },
          ]),
        },
        cycle: 0,
      });
      return {
        seeded42,
        seeded42Replay,
        seeded43,
        automated,
        emptyCurveFallback,
        largeSeedVector,
        perCycle,
        history,
        unknownKindError,
        invalidDensityError,
        cycleStartValues: scorePreview.beats.map(
          (beat: { automationValues?: Array<{ target: string; value: number }> }) =>
            beat.automationValues?.find(
              (sample) => sample.target === "generator.example.density"
            )?.value
        ),
      };
    });

    const rests = (preview: {
      spans: Array<{ cells: Array<{ rest: boolean }> }>;
    }) =>
      preview.spans[0].cells.map((cell: { rest: boolean }) => cell.rest);
    expect(rests(results.seeded42)).toEqual(rests(results.seeded42Replay));
    expect(rests(results.seeded42)).not.toEqual(rests(results.seeded43));
    expect(rests(results.automated).every((rest: boolean) => !rest)).toBe(true);
    expect(
      rests(results.emptyCurveFallback).every((rest: boolean) => !rest)
    ).toBe(true);
    expect(rests(results.largeSeedVector)).toEqual([
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(results.largeSeedVector.seed.seed).toBe("9007199254740993");
    expect(results.perCycle.seed).toEqual({
      seed: "14860520765803676662",
      source: "perCycle",
      history: [],
    });
    expect(results.history.seed).toEqual({
      seed: "301863032735174168",
      source: "new",
      history: [
        "9007199254740995",
        "2128267588419207165",
        "3977028428741929007",
        "301863032735174168",
      ],
    });
    expect(results.cycleStartValues).toEqual(Array(8).fill(0));
    expect(results.unknownKindError).toContain("unknown generator kind");
    expect(results.invalidDensityError).toContain(
      "example density must be 0-100"
    );
  });

  test("keeps timeline rows mounted while the playing cycle preview is stale", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page, {
      holdPreviewCycles: [1],
    });
    const sectionCountBefore = await page.locator(".resolved-section").count();
    const rowCountBefore = await page
      .locator(".resolved-section .aligned-timeline-row")
      .count();
    expect(sectionCountBefore).toBeGreaterThan(0);
    expect(rowCountBefore).toBeGreaterThan(0);

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    await emitLiveCycle(page, 1);
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__;
      return Boolean(
        state?.transportIsPlaying &&
          state.timelineLayoutCycle === 1 &&
          !state.timelineLayerSourcesCoherent
      );
    });

    await expect
      .poll(async () => (await getDriverState(page)).pendingPreviewCycles)
      .toContain(1);

    let state = await getE2eState(page);
    let driver = await getDriverState(page);
    expect(driver.pendingPreviewCycles).toContain(1);
    expect(state.timelineLayerSourcesCoherent).toBe(false);
    expect(state.timelineRenderSyncing).toBe(true);
    expect(state.renderedSectionCount).toBe(sectionCountBefore);
    await expect(page.getByText("Syncing live render")).toBeVisible();
    await expect(page.locator(".resolved-section")).toHaveCount(sectionCountBefore);
    await expect(page.locator(".resolved-section .aligned-timeline-row")).toHaveCount(
      rowCountBefore
    );

    await releasePreviewCycle(page, 1);
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__;
      return Boolean(
        state?.transportIsPlaying &&
          state.timelinePreviewReady &&
          state.timelineRhythmReady &&
          state.timelineLayerSourcesCoherent &&
          !state.timelineRenderSyncing
      );
    });

    state = await getE2eState(page);
    driver = await getDriverState(page);
    expect(driver.pendingPreviewCycles).toEqual([]);
    await expect(page.getByText("Syncing live render")).toHaveCount(0);
    const previewCycles = driver.calls.flatMap((call) =>
      call.command === "score_preview_subdivision_switch"
        ? [(call.args as { cycle?: number } | undefined)?.cycle]
        : []
    );
    const rhythmCycles = driver.calls.flatMap((call) =>
      call.command === "generator_preview"
        ? [(call.args as { request?: { cycle?: number } } | undefined)?.request
            ?.cycle]
        : []
    );
    expect(previewCycles).toContain(1);
    expect(
      rhythmCycles.some((cycle): cycle is number => typeof cycle === "number" && cycle >= 1)
    ).toBe(true);
    await expect(page.getByText("Syncing live render")).toHaveCount(0);
    await expect(page.locator(".resolved-section")).toHaveCount(sectionCountBefore);
    await expect(page.locator(".resolved-section .aligned-timeline-row")).toHaveCount(
      rowCountBefore
    );
  });

  test("locks high-risk structure controls while playback is running and releases them after stop", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    let state = await getE2eState(page);
    expect(state.playbackStructureLocked).toBe(true);
    await expect(page.getByText("Structure locked while playing")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Inspect previous stopped cycle" })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Inspect next stopped cycle" })
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Pick target" })).toHaveCount(0);

    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    state = await getE2eState(page);
    expect(state.playbackStructureLocked).toBe(false);
    await expect(page.getByText("Structure locked while playing")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Inspect next stopped cycle" })
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Pick target" })).toHaveCount(0);
  });

  test("sources the live generator row from the realized snapshot, not the stopped preview", async ({
    page,
  }) => {
    // The realized snapshot diverges from the preview (play+rest cells vs one
    // full play cell) the way a history-seed cycle realizes a different pattern
    // than the preview seed — the exact case where the old preview-derived row
    // disagreed with the audio.
    await openFreshEightBeatCaesura(page, { divergentRealizedRhythm: true });

    const rhythmRow = page.locator(".aligned-timeline-row.is-rhythm-layer");
    await expect(rhythmRow).toHaveCount(1);
    // Stopped: the row is preview-sourced — one full play cell per span, no rests.
    await expect(rhythmRow.locator("i.is-rest")).toHaveCount(0);
    await expect(rhythmRow.locator(".rhythm-layer-span").first()).toBeVisible();

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    // Playing: the row is realized-sourced — it shows the realized rest cells and
    // only the realized snapshot carries.
    await expect(rhythmRow.locator("i.is-rest").first()).toBeVisible();

    await page.getByTestId("transport-stop").click();
    await waitForIdle(page);

    // Stopped again: back to the preview source, rest cells gone.
    await expect(rhythmRow.locator("i.is-rest")).toHaveCount(0);
    await expect(rhythmRow.locator(".rhythm-layer-span").first()).toBeVisible();
  });

  test("re-resolves stopped timeline cycles without changing the playback structure request", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);
    const firstDriverState = await getDriverState(page);
    const firstRequest = firstDriverState.lastPreviewRequest?.request;

    await page.getByRole("button", { name: "Inspect next stopped cycle" }).click();
    await page.getByRole("button", { name: "Inspect next stopped cycle" }).click();
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__;
      return Boolean(
        state?.timelineLayoutCycle === 2 &&
          state.timelinePreviewReady &&
          state.timelineRhythmReady &&
          state.timelineLayerSourcesCoherent
      );
    });

    const state = await getE2eState(page);
    const driver = await getDriverState(page);
    expect(state.timelineLayoutCycle).toBe(2);
    expect(state.timelinePreviewCycle).toBe(2);
    expect(driver.lastPreviewRequest?.cycle).toBe(2);
    expect(driver.lastPreviewRequest?.request).toEqual(firstRequest);
    expect(driver.lastGeneratorPreviewRequest?.cycle).toBe(2);
    expect(state.sections.length).toBe(state.preview?.sectionStartBeats.length);
  });
});

test("the playhead travels inside the track region, never the label rail", async ({
  page,
}) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  // The playhead is a zero-width span whose line is a pseudo-element; its
  // screen position is lane.x + the rAF-driven translate3d offset. Wait
  // for the first live position (opacity flips to 1), then sample.
  const playhead = page.getByTestId("timeline-playhead");
  await expect
    .poll(async () =>
      playhead.evaluate((node) => (node as HTMLElement).style.opacity)
    )
    .toBe("1");

  // Regression: with a per-row label gutter, fraction × parent-width
  // mapped the playhead over the FULL row (rail included), so it started
  // a rail-width behind the audible beat and converged only by cycle end.
  // It must always sit within the track region.
  for (let sample = 0; sample < 3; sample += 1) {
    const offset = await playhead.evaluate((node) => {
      const transform = (node as HTMLElement).style.transform;
      const match = /translate3d\((-?[\d.]+)px/.exec(transform);
      return match ? Number(match[1]) : Number.NaN;
    });
    const cellBox = await page
      .getByTestId("gati-matra-cell")
      .first()
      .boundingBox();
    const laneBox = await page.locator(".resolved-lane").boundingBox();
    expect(Number.isNaN(offset)).toBe(false);
    expect(cellBox).not.toBeNull();
    expect(laneBox).not.toBeNull();
    const playheadScreenX = laneBox!.x + offset;
    expect(playheadScreenX).toBeGreaterThanOrEqual(cellBox!.x - 1);
    expect(playheadScreenX).toBeLessThanOrEqual(
      laneBox!.x + laneBox!.width + 1
    );
    await page.waitForTimeout(150);
  }
});
