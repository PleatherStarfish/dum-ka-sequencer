import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  closeMainEditor,
  fillNumeric,
  openMainEditor,
  waitForTimelineReady,
  waitForPlaying,
  type E2eState,
} from "./support/appHarness";
import { installRealTauri, readRealDriverState } from "./support/realTauri";
import { startRealBackend, type RealBackendHandle } from "./support/realBackend";

/**
 * Real Rust ↔ real UI parity. Unlike every other spec in this suite, there is
 * no mockTauri here: the app's invokes are forwarded to the actual compiled
 * backend (src-tauri e2e-harness mode), so these tests cover the seam the
 * mock cannot — bridge request shapes through real serde, the real resolver
 * producing the preview the timeline renders, and the real transport emitting
 * the MIDI the preview promises.
 *
 * Run with `pnpm test:e2e:real` (builds the harness binary first).
 */

interface SnapshotMidiEvent {
  sequence: number;
  cycle: number;
  tickInCycle: number;
  messageType: string;
  data1: number | null;
  channel: number | null;
}

interface SnapshotRhythmCell {
  index: number;
  start: number;
  len: number;
  rest: boolean;
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
  velocity?: number;
}

interface SnapshotRhythmSpan {
  spanId: number;
  spanLen: number;
  cells: SnapshotRhythmCell[];
}

interface SnapshotRhythmEvent {
  cycle: number;
  parallelTrackIndex: number | null;
  parallelTrackId: string | null;
  span: SnapshotRhythmSpan;
}

interface SnapshotSeedTraceEvent {
  cycle: number;
  domain: string;
  label: string;
  seed: string;
  baseSeed: string | null;
  source: string;
  historyBefore: string[];
  historyAfter: string[];
  parallelTrackIndex: number | null;
  trackId: string | null;
}

interface RealSnapshot {
  isPlaying: boolean;
  currentCycle: number;
  ticksPerCycle: number;
  midiDebugEvents: SnapshotMidiEvent[];
  realizedRhythmEvents: SnapshotRhythmEvent[];
  seedTraceEvents: SnapshotSeedTraceEvent[];
}

interface PlannedGeneratorPreview {
  seed: {
    seed: string;
    source: string;
    history: string[];
  };
  spans: SnapshotRhythmSpan[];
  trace: Array<{
    cycle: number;
    directiveId: number;
    family: string;
    requested: number;
    applied: number;
    skipped: string;
    corridorClamp?: {
      limit: "floor" | "ceiling";
      densityPercent: number;
    } | null;
    perceptual?: {
      modelVersion: "v1";
      actualMilli: number;
      targetMilli: number;
      toleranceMilli: number;
      reached: boolean;
      exhausted: boolean;
    } | null;
  }>;
}

let backend: RealBackendHandle;

test.describe("real backend parity", () => {
  test.beforeAll(async () => {
    backend = await startRealBackend();
  });

  test.afterAll(() => {
    backend?.stop();
  });

  test.afterEach(async () => {
    await backend?.invoke("transport_stop").catch(() => undefined);
    await backend
      ?.invoke("parallel_set_playback", { request: null })
      .catch(() => undefined);
  });

  async function openCaesuraReal(page: Page): Promise<void> {
    await installRealTauri(page, {
      harnessPort: backend.port,
      previousSessionInterrupted: false,
      setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
      // Lock the session seed so the stochastic layers (boundary rolls,
      // rhythm articulation, grouping) resolve identically on every run.
      globalSeedStartupLock: { locked: true, seed: 20260611 },
    });
    await page.goto("/");
    await page.getByTestId("timeline-panel").waitFor();
    await waitForTimelineReady(page);
  }

  async function readPublishedState(page: Page): Promise<E2eState> {
    return await page.evaluate(
      () => window.__CAESURA_E2E_STATE__ as unknown as E2eState
    );
  }

  function numberInputByLabel(scope: Locator, label: string): Locator {
    return scope
      .locator("label")
      .filter({ hasText: label })
      .locator('[role="spinbutton"]')
      .first();
  }

  async function openFreshEightBeatCaesura(page: Page): Promise<void> {
    await openCaesuraReal(page);

    const state = await readPublishedState(page);
    if (state.switchRequest.cycleBeats === 8) return;

    const scorePanel = await openMainEditor(page, "boundaries");
    await fillNumeric(numberInputByLabel(scorePanel, "Beats/cycle"), "8");
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__ as E2eState | undefined;
      return Boolean(
        state?.switchRequest?.cycleBeats === 8 &&
          state.timelinePreviewReady &&
          state.timelineRhythmReady &&
          state.timelineLayerSourcesCoherent
      );
    });
    await closeMainEditor(page);
  }

  async function openAutomationDialog(page: Page): Promise<Locator> {
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
      const values = beats.map((beat: { automationValues?: Array<{
        target: string;
        value: number;
      }> }) =>
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

  /** Author a deterministic structure: 4 beats/cycle, only gati 7 possible. */
  async function authorForcedGatiSeven(page: Page): Promise<void> {
    const scorePanel = await openMainEditor(page, "boundaries");
    await fillNumeric(numberInputByLabel(scorePanel, "Beats/cycle"), "4");
    await closeMainEditor(page);

    const boundariesPanel = await openMainEditor(page, "boundaries");
    const startSection = boundariesPanel.getByLabel("Section 1 inspector");
    await fillNumeric(numberInputByLabel(startSection, "Subdivision"), "7");
    await closeMainEditor(page);

    // The edit auto-applies; wait until the *real* preview drives the
    // published timeline state to the authored structure.
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__ as unknown as E2eState | undefined;
      if (!state?.timelinePreviewReady || !state.preview) return false;
      return (
        state.preview.beatCount === 4 &&
        state.preview.beatGatis.length === 4 &&
        state.preview.beatGatis.every((gati: number) => gati === 7)
      );
    });
  }

  test("app boots against the real backend with no rejected invokes", async ({
    page,
  }) => {
    await openCaesuraReal(page);

    const driver = await readRealDriverState(page);
    expect(driver.invokeErrors).toEqual([]);

    // The boot sequence must have applied real score + playback config.
    const commands = driver.calls.map((call) => call.command);
    expect(commands).toContain("score_create_subdivision_switch");
    expect(commands).toContain("score_preview_subdivision_switch");

    // And the preview rendered by the timeline came from the real resolver.
    const state = await readPublishedState(page);
    expect(state.timelinePreviewReady).toBe(true);
    expect(state.preview?.beatCount).toBeGreaterThan(0);
  });

  test("authored gati-7 structure round-trips request → real resolver → timeline", async ({
    page,
  }) => {
    await openCaesuraReal(page);
    await authorForcedGatiSeven(page);

    const driver = await readRealDriverState(page);
    expect(driver.invokeErrors).toEqual([]);

    // Stopped authoring updates the preview command; score creation is applied
    // at Play. Assert the exact request that the real backend resolved here.
    const state = await readPublishedState(page);
    expect(driver.lastPreviewRequest?.cycle).toBe(state.timelineLayoutCycle);
    const request = driver.lastPreviewRequest?.request as {
      cycleBeats?: number;
      initialWeights?: Array<{ subdivision: number; weight: number }>;
    } | undefined;
    expect(request?.cycleBeats).toBe(4);
    expect(request?.initialWeights).toEqual([{ subdivision: 7, weight: 1 }]);

    // The timeline sections grouped from the real preview agree.
    for (const section of state.sections) {
      expect(section.gati).toBe(7);
      for (const beat of section.beats) {
        expect(beat.gati).toBe(7);
      }
    }
  });

  test("stopped timeline generator preview is resolved by the real backend", async ({
    page,
  }) => {
    await openFreshEightBeatCaesura(page);

    const state = await readPublishedState(page);
    const driver = await readRealDriverState(page);
    expect(driver.invokeErrors).toEqual([]);
    expect(driver.lastGeneratorPreviewRequest?.cycle).toBe(state.timelineLayoutCycle);
    expect(driver.lastGeneratorPreviewRequest?.spans ?? []).toHaveLength(
      state.rhythmSpanCount
    );
    expect(driver.lastGeneratorPreviewRequest).toHaveProperty("automation");
    expect(driver.lastGeneratorPreviewRequest).toHaveProperty("trackId");

    const generatorPreview = driver.lastGeneratorPreview as
      | { spans?: unknown[] }
      | null;
    expect(generatorPreview?.spans ?? []).toHaveLength(
      state.rhythmSpanCount
    );
    expect(state.timelineLayerSourcesCoherent).toBe(true);
  });

  test("the real backend resolves an authored Dum-Ka pattern", async ({
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
        const driver = await readRealDriverState(page);
        const generator = driver.lastGeneratorPreviewRequest?.generator as
          | { kind?: string; pattern?: string }
          | undefined;
        return generator?.kind === "dumka" && generator.pattern === pattern;
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        const preview = driver.lastGeneratorPreview as {
          spans?: Array<{ cells?: unknown[] }>;
        } | null;
        return (preview?.spans ?? []).length;
      })
      .toBe(4);

    const driver = await readRealDriverState(page);
    // Between choosing the Dum-Ka kind and applying its structure, previews
    // against the still-eight-beat project legitimately fail; the real
    // backend must answer those with the engine's pinned Display, and
    // nothing else may have errored.
    for (const entry of driver.invokeErrors) {
      expect(entry.command).toBe("generator_preview");
      expect(entry.error).toBe(
        "dumka structure mismatch: pattern spans 4 beats but the cycle has 8"
      );
    }
    const preview = driver.lastGeneratorPreview as {
      spans: Array<{ cells: Array<{ rest: boolean }> }>;
    };
    const sounding = preview.spans
      .flatMap((span) => span.cells)
      .filter((cell) => !cell.rest).length;
    expect(sounding).toBe(8);
  });

  test("a planned Dum-Ka preview is the cycle-one playback realization", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");

    await openCaesuraReal(page);

    // Keep both the fold and the parity assertion deliberately small: four
    // quarter-note onsets on a fixed one-pulse beat grid.
    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    const pattern = generator.getByLabel("Dum-Ka pattern");
    await pattern.fill("x x x x");
    await pattern.blur();
    await expect(generator.getByLabel("Required structure")).toHaveText(
      "needs 4 beats · Subdivision 1"
    );
    await generator.getByRole("button", { name: "Apply structure" }).click();
    await expect(
      generator.getByRole("button", { name: "Structure ready" })
    ).toBeDisabled();
    await closeMainEditor(page);

    const evolve = await openMainEditor(page, "evolve");
    const addRemove = evolve.getByRole("button", {
      name: "Add Remove pin",
    });
    await addRemove.focus();
    await addRemove.press("Enter");
    await expect(
      evolve.getByRole("button", { name: "Remove, cycle 1, 25%" })
    ).toBeVisible();

    // This tick is rendered only from the real generator_preview trace. A
    // filled 1/1 entry proves the scheduled quota survived projection.
    await expect(
      evolve
        .getByLabel("Composition strip")
        .getByRole("img", { name: "Remove: 1/1" })
    ).toBeVisible({ timeout: 15_000 });

    // Capture the exact cycle-one request authored by the UI. Re-resolving the
    // same request through the real preview command gives us a stable value to
    // compare with the scheduler's surfaced realization below, independent of
    // later composition-cache requests completing out of order.
    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        return driver.calls.some((call) => {
          if (call.command !== "generator_preview") return false;
          const request = (
            call.args as {
              request?: {
                cycle?: number;
                generator?: { kind?: string; plan?: unknown[] };
              };
            }
          ).request;
          return (
            request?.cycle === 1 &&
            request.generator?.kind === "dumka" &&
            (request.generator.plan?.length ?? 0) === 1
          );
        });
      })
      .toBe(true);

    const authoredDriver = await readRealDriverState(page);
    const plannedCall = authoredDriver.calls
      .filter((call) => {
        if (call.command !== "generator_preview") return false;
        const request = (
          call.args as {
            request?: {
              cycle?: number;
              generator?: { kind?: string; plan?: unknown[] };
            };
          }
        ).request;
        return (
          request?.cycle === 1 &&
          request.generator?.kind === "dumka" &&
          (request.generator.plan?.length ?? 0) === 1
        );
      })
      .at(-1);
    expect(plannedCall).toBeDefined();
    const plannedRequest = (
      plannedCall!.args as { request: Record<string, unknown> }
    ).request;
    const plannedPreview = await backend.invoke<PlannedGeneratorPreview>(
      "generator_preview",
      { request: plannedRequest }
    );
    expect(plannedPreview.trace).toEqual([
      {
        cycle: 1,
        directiveId: 1,
        family: "barlowRemove",
        requested: 1,
        applied: 1,
        skipped: "none",
      },
    ]);

    const seedPreview = await backend.invoke<PlannedGeneratorPreview>(
      "generator_preview",
      { request: { ...plannedRequest, cycle: 0 } }
    );
    const onsetCount = (preview: PlannedGeneratorPreview) =>
      preview.spans
        .flatMap((span) => span.cells)
        .filter((cell) => !cell.rest && !cell.tiedFromPrevious).length;
    expect(seedPreview.trace).toEqual([]);
    expect(onsetCount(seedPreview)).toBe(4);
    expect(onsetCount(plannedPreview)).toBe(3);

    await closeMainEditor(page);
    const stoppedCycle = page.getByLabel("Stopped cycle selector");
    await expect(stoppedCycle.locator("output")).toHaveText("1");
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__ as E2eState | undefined;
      return Boolean(
        state?.timelineLayoutCycle === 1 &&
          state.timelinePreviewReady &&
          state.timelineRhythmReady &&
          state.timelineLayerSourcesCoherent
      );
    });

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await expect
      .poll(
        async () => {
          const snapshot = await backend.invoke<RealSnapshot>(
            "transport_get_snapshot"
          );
          return snapshot.realizedRhythmEvents.filter(
            (event) => event.cycle === 1
          ).length;
        },
        { timeout: 20_000, intervals: [100] }
      )
      .toBe(plannedPreview.spans.length);

    const playbackSnapshot = await backend.invoke<RealSnapshot>(
      "transport_get_snapshot"
    );
    const realizedCycleOne = playbackSnapshot.realizedRhythmEvents
      .filter((event) => event.cycle === 1)
      .map((event) => event.span)
      .sort((left, right) => left.spanId - right.spanId);
    expect(realizedCycleOne).toEqual(
      [...plannedPreview.spans].sort((left, right) => left.spanId - right.spanId)
    );

    const playbackDriver = await readRealDriverState(page);
    expect(playbackDriver.lastTrackPlaybackRequest?.generator).toEqual(
      plannedRequest.generator
    );
    expect(playbackDriver.lastTrackPlaybackRequest?.generatorEnabled).toBe(true);
    expect(playbackDriver.invokeErrors).toEqual([]);
  });

  test("a perceptually paced Dum-Ka edit keeps stopped preview and playback identical", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");
    test.setTimeout(90_000);

    await openCaesuraReal(page);

    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    const pattern = generator.getByLabel("Dum-Ka pattern");
    await pattern.fill("x x x x");
    await pattern.blur();
    await expect(generator.getByLabel("Required structure")).toHaveText(
      "needs 4 beats · Subdivision 1"
    );
    await generator.getByRole("button", { name: "Apply structure" }).click();
    await expect(
      generator.getByRole("button", { name: "Structure ready" })
    ).toBeDisabled();
    await closeMainEditor(page);

    const evolve = await openMainEditor(page, "evolve");
    const addRemove = evolve.getByRole("button", { name: "Add Remove pin" });
    await addRemove.focus();
    await addRemove.press("Enter");
    await expect(
      evolve.getByRole("button", { name: "Remove, cycle 1, 25%" })
    ).toBeVisible();

    await evolve.getByLabel("Step size mode").selectOption("perceptual");
    await fillNumeric(evolve.getByLabel("Maximum operations"), "1");
    await fillNumeric(evolve.getByLabel("Perceptual tolerance"), "0");
    // A maximum target makes the one legal Remove prefix strictly closer
    // than the zero-operation hold, without hard-coding model-v1's score.
    await fillNumeric(evolve.getByLabel("Target magnitude"), "100");

    type PerceptualPlanRow = {
      family?: string;
      magnitude?: {
        mode?: string;
        modelVersion?: string;
        targetMilli?: number;
        toleranceMilli?: number;
        maxOperations?: number;
      };
    };
    type PerceptualPreviewRequest = Record<string, unknown> & {
      cycle?: number;
      generator?: {
        kind?: string;
        plan?: PerceptualPlanRow[];
      };
    };
    const requestMatches = (
      request: PerceptualPreviewRequest | undefined,
      targetMilli: number,
      toleranceMilli: number
    ) => {
      const row = request?.generator?.plan?.[0];
      return (
        request?.cycle === 1 &&
        request.generator?.kind === "dumka" &&
        row?.family === "barlowRemove" &&
        row.magnitude?.mode === "perceptual" &&
        row.magnitude.modelVersion === "v1" &&
        row.magnitude.targetMilli === targetMilli &&
        row.magnitude.toleranceMilli === toleranceMilli &&
        row.magnitude.maxOperations === 1
      );
    };

    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        return driver.calls.some((call) => {
          if (call.command !== "generator_preview") return false;
          const request = (call.args as { request?: PerceptualPreviewRequest })
            .request;
          return requestMatches(request, 100_000, 0);
        });
      })
      .toBe(true);

    const probeDriver = await readRealDriverState(page);
    const probeCall = probeDriver.calls
      .filter((call) => call.command === "generator_preview")
      .findLast((call) => {
        const request = (call.args as { request?: PerceptualPreviewRequest })
          .request;
        return requestMatches(request, 100_000, 0);
      });
    expect(probeCall).toBeDefined();
    const probeRequest = (
      probeCall!.args as { request: PerceptualPreviewRequest }
    ).request;
    const probePreview = await backend.invoke<PlannedGeneratorPreview>(
      "generator_preview",
      { request: probeRequest }
    );
    const probeTrace = probePreview.trace[0];
    expect(probeTrace).toMatchObject({
      cycle: 1,
      directiveId: 1,
      family: "barlowRemove",
      requested: 1,
      applied: 1,
    });
    expect(probeTrace?.perceptual?.modelVersion).toBe("v1");
    const actualMilli = probeTrace?.perceptual?.actualMilli;
    expect(actualMilli).toBeDefined();
    expect(actualMilli!).toBeGreaterThan(0);
    expect(actualMilli!).toBeLessThanOrEqual(100_000);

    // The UI authors scores in 0.1-unit increments. Calibrate the persisted
    // target to the nearest representable score and use a one-tenth tolerance
    // so the real model result must truthfully report that it was reached.
    const calibratedTargetMilli = Math.round(actualMilli! / 100) * 100;
    await fillNumeric(
      evolve.getByLabel("Target magnitude"),
      String(calibratedTargetMilli / 1_000)
    );
    await fillNumeric(evolve.getByLabel("Perceptual tolerance"), "0.1");

    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        return driver.calls.some((call) => {
          if (call.command !== "generator_preview") return false;
          const request = (call.args as { request?: PerceptualPreviewRequest })
            .request;
          return requestMatches(request, calibratedTargetMilli, 100);
        });
      })
      .toBe(true);

    const calibratedDriver = await readRealDriverState(page);
    const calibratedCall = calibratedDriver.calls
      .filter((call) => call.command === "generator_preview")
      .findLast((call) => {
        const request = (call.args as { request?: PerceptualPreviewRequest })
          .request;
        return requestMatches(request, calibratedTargetMilli, 100);
      });
    expect(calibratedCall).toBeDefined();
    const calibratedRequest = (
      calibratedCall!.args as { request: PerceptualPreviewRequest }
    ).request;
    const calibratedPreview = await backend.invoke<PlannedGeneratorPreview>(
      "generator_preview",
      { request: calibratedRequest }
    );
    const calibratedTrace = calibratedPreview.trace[0];
    expect(calibratedTrace).toEqual({
      cycle: 1,
      directiveId: 1,
      family: "barlowRemove",
      requested: 1,
      applied: 1,
      skipped: "none",
      perceptual: {
        modelVersion: "v1",
        actualMilli,
        targetMilli: calibratedTargetMilli,
        toleranceMilli: 100,
        reached: true,
        exhausted: false,
      },
    });
    expect(Math.abs(actualMilli! - calibratedTargetMilli)).toBeLessThanOrEqual(
      100
    );
    await expect(
      evolve.getByRole("status", {
        name: /Cycle 1 directive change: .* within tolerance/,
      })
    ).toBeVisible();

    const seedPreview = await backend.invoke<PlannedGeneratorPreview>(
      "generator_preview",
      { request: { ...calibratedRequest, cycle: 0 } }
    );
    const onsetCount = (preview: PlannedGeneratorPreview) =>
      preview.spans
        .flatMap((span) => span.cells)
        .filter((cell) => !cell.rest && !cell.tiedFromPrevious).length;
    expect(onsetCount(seedPreview)).toBe(4);
    expect(onsetCount(calibratedPreview)).toBe(3);

    await closeMainEditor(page);
    await expect(page.getByLabel("Stopped cycle selector").locator("output")).toHaveText(
      "1"
    );
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__ as E2eState | undefined;
      return Boolean(
        state?.timelineLayoutCycle === 1 &&
          state.timelinePreviewReady &&
          state.timelineRhythmReady &&
          state.timelineLayerSourcesCoherent
      );
    });
    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        const request = driver.lastGeneratorPreviewRequest as
          | PerceptualPreviewRequest
          | undefined;
        if (!requestMatches(request, calibratedTargetMilli, 100)) return false;
        return JSON.stringify(
          (driver.lastGeneratorPreview as PlannedGeneratorPreview | null)?.spans
        );
      })
      .toBe(JSON.stringify(calibratedPreview.spans));

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await expect
      .poll(
        async () => {
          const snapshot = await backend.invoke<RealSnapshot>(
            "transport_get_snapshot"
          );
          return snapshot.realizedRhythmEvents.filter(
            (event) => event.cycle === 1
          ).length;
        },
        { timeout: 20_000, intervals: [100] }
      )
      .toBe(calibratedPreview.spans.length);

    const playback = await backend.invoke<RealSnapshot>(
      "transport_get_snapshot"
    );
    const realizedCycleOne = playback.realizedRhythmEvents
      .filter((event) => event.cycle === 1)
      .map((event) => event.span)
      .sort((left, right) => left.spanId - right.spanId);
    expect(realizedCycleOne).toEqual(
      [...calibratedPreview.spans].sort(
        (left, right) => left.spanId - right.spanId
      )
    );

    const playbackDriver = await readRealDriverState(page);
    expect(playbackDriver.lastTrackPlaybackRequest?.generator).toEqual(
      calibratedRequest.generator
    );
    expect(playbackDriver.invokeErrors).toEqual([]);
  });

  test("a gentle Dum-Ka transition reaches the same target through gradual playback", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");
    test.setTimeout(90_000);

    await openFreshEightBeatCaesura(page);

    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    const pattern = generator.getByLabel("Dum-Ka pattern");
    await pattern.fill("x x x x x x x x");
    await pattern.blur();
    await expect(generator.getByLabel("Required structure")).toHaveText(
      "needs 8 beats · Subdivision 1"
    );
    await generator.getByRole("button", { name: "Apply structure" }).click();
    await expect(
      generator.getByRole("button", { name: "Structure ready" })
    ).toBeDisabled();
    await closeMainEditor(page);

    const evolve = await openMainEditor(page, "evolve");
    const addRemove = evolve.getByRole("button", { name: "Add Remove pin" });
    await addRemove.focus();
    await addRemove.press("Enter");
    await evolve
      .getByRole("button", { name: "Smooth across 4 cycles" })
      .click();
    await expect(evolve.getByLabel("Directive transition")).toHaveValue(
      "easeInOut"
    );
    await expect(
      evolve.getByRole("button", {
        name: "Remove, cycles 1 through 4, 25%, gentle transition",
      })
    ).toBeVisible();

    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        return driver.calls.some((call) => {
          if (call.command !== "generator_preview") return false;
          const request = (
            call.args as {
              request?: {
                cycle?: number;
                generator?: {
                  kind?: string;
                  plan?: Array<{ pacing?: string }>;
                };
              };
            }
          ).request;
          return (
            request?.cycle === 1 &&
            request.generator?.kind === "dumka" &&
            request.generator.plan?.[0]?.pacing === "easeInOut"
          );
        });
      })
      .toBe(true);

    const authoredDriver = await readRealDriverState(page);
    const transitionCall = authoredDriver.calls
      .filter((call) => {
        if (call.command !== "generator_preview") return false;
        const request = (
          call.args as {
            request?: {
              cycle?: number;
              generator?: {
                kind?: string;
                plan?: Array<{ pacing?: string }>;
              };
            };
          }
        ).request;
        return (
          request?.cycle === 1 &&
          request.generator?.kind === "dumka" &&
          request.generator.plan?.[0]?.pacing === "easeInOut"
        );
      })
      .at(-1);
    expect(transitionCall).toBeDefined();
    const transitionRequest = (
      transitionCall!.args as { request: Record<string, unknown> }
    ).request;
    const previews: PlannedGeneratorPreview[] = [];
    for (let cycle = 0; cycle <= 4; cycle += 1) {
      previews.push(
        await backend.invoke<PlannedGeneratorPreview>("generator_preview", {
          request: { ...transitionRequest, cycle },
        })
      );
    }
    const onsetCount = (preview: PlannedGeneratorPreview) =>
      preview.spans
        .flatMap((span) => span.cells)
        .filter((cell) => !cell.rest && !cell.tiedFromPrevious).length;
    expect(previews.map(onsetCount)).toEqual([8, 8, 7, 7, 6]);
    expect(
      previews.slice(1).map((preview) => [
        preview.trace[0]?.requested,
        preview.trace[0]?.applied,
      ])
    ).toEqual([
      [0, 0],
      [1, 1],
      [0, 0],
      [1, 1],
    ]);

    await closeMainEditor(page);
    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__ as E2eState | undefined;
      return Boolean(
        state?.timelineLayoutCycle === 1 &&
          state.timelinePreviewReady &&
          state.timelineRhythmReady &&
          state.timelineLayerSourcesCoherent
      );
    });
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    const realizedByCycle = new Map<number, SnapshotRhythmSpan[]>();
    await expect
      .poll(
        async () => {
          const snapshot = await backend.invoke<RealSnapshot>(
            "transport_get_snapshot"
          );
          for (let cycle = 1; cycle <= 4; cycle += 1) {
            const spans = snapshot.realizedRhythmEvents
              .filter((event) => event.cycle === cycle)
              .map((event) => event.span)
              .sort((left, right) => left.spanId - right.spanId);
            if (spans.length === previews[cycle]!.spans.length) {
              realizedByCycle.set(cycle, spans);
            }
          }
          return realizedByCycle.size;
        },
        { timeout: 45_000, intervals: [250] }
      )
      .toBe(4);

    const playbackDriver = await readRealDriverState(page);
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      expect(realizedByCycle.get(cycle)).toEqual(
        [...previews[cycle]!.spans].sort(
          (left, right) => left.spanId - right.spanId
        )
      );
    }

    expect(playbackDriver.lastTrackPlaybackRequest?.generator).toEqual(
      transitionRequest.generator
    );
    expect(playbackDriver.invokeErrors).toEqual([]);
  });

  test("a compounding Fragment range plateaus at the authored density ceiling", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openFreshEightBeatCaesura(page);

    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    const pattern = generator.getByLabel("Dum-Ka pattern");
    await pattern.fill("x _ _ _ x _ _ _");
    await pattern.blur();
    await generator.getByRole("button", { name: "Apply structure" }).click();
    await expect(
      generator.getByRole("button", { name: "Structure ready" })
    ).toBeDisabled();
    await fillNumeric(
      generator.getByRole("slider", { name: "Dum-Ka density ceiling" }),
      "50"
    );
    await closeMainEditor(page);

    const evolve = await openMainEditor(page, "evolve");
    const addFragment = evolve.getByRole("button", { name: "Add Fragment pin" });
    await addFragment.focus();
    await addFragment.press("Enter");
    await evolve.getByRole("button", { name: "Smooth across 4 cycles" }).click();
    await evolve.getByLabel("Directive transition").selectOption("perCycle");
    await fillNumeric(evolve.getByLabel("Directive intensity"), "100");

    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        return driver.calls.some((call) => {
          if (call.command !== "generator_preview") return false;
          const request = (call.args as {
            request?: {
              cycle?: number;
              generator?: {
                kind?: string;
                densityCeiling?: number;
                plan?: Array<{ family?: string; toCycle?: number }>;
              };
            };
          }).request;
          return (
            request?.cycle === 4 &&
            request.generator?.kind === "dumka" &&
            request.generator.densityCeiling === 50 &&
            request.generator.plan?.[0]?.family === "fragment" &&
            request.generator.plan[0]?.toCycle === 4
          );
        });
      })
      .toBe(true);

    const authoredDriver = await readRealDriverState(page);
    const cycleFourCall = authoredDriver.calls
      .filter((call) => call.command === "generator_preview")
      .findLast((call) => {
        const request = (call.args as {
          request?: {
            cycle?: number;
            generator?: { densityCeiling?: number; plan?: unknown[] };
          };
        }).request;
        return (
          request?.cycle === 4 &&
          request.generator?.densityCeiling === 50 &&
          (request.generator.plan?.length ?? 0) > 0
        );
      });
    expect(cycleFourCall).toBeDefined();
    const authoredRequest = (
      cycleFourCall!.args as { request: Record<string, unknown> }
    ).request;
    const previews: PlannedGeneratorPreview[] = [];
    for (let cycle = 0; cycle <= 4; cycle += 1) {
      previews.push(
        await backend.invoke<PlannedGeneratorPreview>("generator_preview", {
          request: { ...authoredRequest, cycle },
        })
      );
    }
    const onsetCount = (preview: PlannedGeneratorPreview) =>
      preview.spans
        .flatMap((span) => span.cells)
        .filter((cell) => !cell.rest && !cell.tiedFromPrevious).length;
    const counts = previews.map(onsetCount);
    expect(counts.slice(1).every((count) => count <= 4)).toBe(true);
    expect(counts[4]).toBe(4);
    expect(
      previews
        .slice(1)
        .flatMap((preview) => preview.trace)
        .some((entry) => entry.corridorClamp?.limit === "ceiling")
    ).toBe(true);
    await expect(
      evolve.getByRole("img", { name: /ceiling corridor 50%/ }).first()
    ).toBeVisible();
    await expect(
      evolve.getByRole("group", {
        name: /Cycle 4 composition: .* corridor 0% through 50%/,
      })
    ).toBeVisible();
  });

  test("a random-access History preview matches sequential cycle-two playback", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");
    test.setTimeout(60_000);

    await openCaesuraReal(page);

    // Author one remembered seed through the real UI, then leave the score's
    // structural stream Locked. The generator is the only History stream in
    // this regression, so a span mismatch can only come from generator seed
    // replay rather than an independently evolving score structure.
    await page.locator(".seed-loop-monitor").click();
    const seeds = page.getByRole("dialog", { name: "Seed Strategy" });
    await expect(seeds).toBeVisible();
    await seeds.getByRole("tab", { name: "Global", exact: true }).click();
    const globalMode = seeds.getByRole("group", { name: "Global seed mode" });
    await globalMode.getByRole("button", { name: "History" }).click();
    await seeds.getByLabel("Remembered seeds").fill("17");
    await fillNumeric(seeds.getByLabel("History length"), "4");
    await globalMode.getByRole("button", { name: "Locked" }).click();
    await seeds.getByLabel("Close Seed Strategy").click();

    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator seed mode").selectOption("history");
    await fillNumeric(
      generator.getByLabel("Generator seed", { exact: true }),
      "4"
    );
    await closeMainEditor(page);

    // Seed 4 is intentional: cycles 0 and 1 learn two new seeds, then cycle 2
    // reuses the first learned seed. Resolving cycle 2 directly from the
    // authored one-item pool instead would incorrectly return seed 17.
    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        return driver.lastGeneratorPreviewRequest?.generator;
      })
      .toMatchObject({
        kind: "example",
        seedMode: {
          type: "history",
          seed: 4,
          history: ["17"],
          historyWeight: 1,
          newSeedWeight: 1,
          maxHistory: 4,
        },
      });

    const authoredDriver = await readRealDriverState(page);
    const stoppedRequest = authoredDriver.lastGeneratorPreviewRequest;
    expect(stoppedRequest).not.toBeNull();
    const cycleTwoPreview = await backend.invoke<PlannedGeneratorPreview>(
      "generator_preview",
      { request: { ...stoppedRequest!, cycle: 2 } }
    );
    expect(cycleTwoPreview.seed).toEqual({
      seed: "11796566853483608125",
      source: "history",
      history: [
        "17",
        "11796566853483608125",
        "4336353081869094754",
      ],
    });

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await expect
      .poll(
        async () => {
          const snapshot = await backend.invoke<RealSnapshot>(
            "transport_get_snapshot"
          );
          return {
            spans: snapshot.realizedRhythmEvents.filter(
              (event) => event.cycle === 2
            ).length,
            trace: snapshot.seedTraceEvents.filter(
              (event) => event.cycle === 2 && event.domain === "generator"
            ).length,
          };
        },
        { timeout: 30_000, intervals: [100] }
      )
      .toEqual({ spans: cycleTwoPreview.spans.length, trace: 1 });

    const playback = await backend.invoke<RealSnapshot>(
      "transport_get_snapshot"
    );
    const realizedCycleTwo = playback.realizedRhythmEvents
      .filter((event) => event.cycle === 2)
      .map((event) => event.span)
      .sort((left, right) => left.spanId - right.spanId);
    expect(realizedCycleTwo).toEqual(
      [...cycleTwoPreview.spans].sort(
        (left, right) => left.spanId - right.spanId
      )
    );

    const generatorSeedTrace = playback.seedTraceEvents.find(
      (event) => event.cycle === 2 && event.domain === "generator"
    );
    expect(generatorSeedTrace).toMatchObject({
      seed: cycleTwoPreview.seed.seed,
      source: cycleTwoPreview.seed.source,
      historyBefore: [
        "17",
        "11796566853483608125",
        "4336353081869094754",
      ],
      historyAfter: cycleTwoPreview.seed.history,
    });

    const playbackDriver = await readRealDriverState(page);
    expect(playbackDriver.lastTrackPlaybackRequest?.generator).toEqual(
      stoppedRequest!.generator
    );
    expect(playbackDriver.invokeErrors).toEqual([]);
  });

  test("the real backend accepts the mixed 5:2 crossing beat 2 as a tie", async ({
    page,
  }) => {
    const plain =
      "[dum . . ka] [. . ka . x]@2 [dum . ka .] [x x . x]";

    await openFreshEightBeatCaesura(page);
    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    const field = generator.getByLabel("Dum-Ka pattern");
    await field.fill(plain);
    await field.blur();
    await generator.getByRole("button", { name: "Apply structure" }).click();
    await expect(generator.locator(".dumka-preview-error")).toHaveCount(0);

    await expect(
      generator.getByRole("button", { name: "Articulate", exact: true })
    ).toHaveCount(0);
    await expect(
      generator.getByRole("button", { name: "Articulate crossing notes" })
    ).toHaveCount(0);
    await expect(field).toHaveValue(plain);
    await closeMainEditor(page);

    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        const request = driver.lastGeneratorPreviewRequest as
          | { generator?: { pattern?: string } }
          | null;
        return request?.generator?.pattern;
      })
      .toBe(plain);
    const driver = await readRealDriverState(page);
    const preview = driver.lastGeneratorPreview as {
      spans?: Array<{
        cells: Array<{
          tiedFromPrevious: boolean;
          tiedToNext: boolean;
        }>;
      }>;
    } | null;
    expect(preview?.spans).toHaveLength(5);
    expect(
      preview?.spans?.some((span, index, spans) =>
        span.cells.some(
          (cell) =>
            cell.tiedToNext &&
            spans[index + 1]?.cells[0]?.tiedFromPrevious === true
        )
      )
    ).toBe(true);
  });

  test("a tied 5:2 preview reaches real MIDI at the same onsets", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");
    const pattern = "[x x x x x]@2";

    await openCaesuraReal(page);
    const generator = await openMainEditor(page, "generator");
    await generator.getByLabel("Generator kind").selectOption("dumka");
    const field = generator.getByLabel("Dum-Ka pattern");
    await field.fill(pattern);
    await field.blur();
    await expect(generator.getByLabel("Required structure")).toHaveText(
      "needs 2 beats · Subdivision 5"
    );
    await generator.getByRole("button", { name: "Apply structure" }).click();
    await expect(
      generator.getByRole("button", { name: "Structure ready" })
    ).toBeDisabled();
    await closeMainEditor(page);

    await expect(page.getByTestId("transport-play")).toBeEnabled();
    await expect
      .poll(async () => {
        const driver = await readRealDriverState(page);
        const preview = driver.lastGeneratorPreview as {
          spans?: Array<{ spanLen: number; cells: Array<{ start: number; rest: boolean }> }>;
        } | null;
        return preview?.spans?.length ?? 0;
      })
      .toBe(2);

    const beforePlayDriver = await readRealDriverState(page);
    const preview = beforePlayDriver.lastGeneratorPreview as {
      spans: Array<{
        spanLen: number;
        cells: Array<{
          start: number;
          rest: boolean;
          tiedFromPrevious: boolean;
        }>;
      }>;
    };
    let spanStart = 0;
    const previewOnsetMatras = preview.spans.flatMap((span) => {
      const onsets = span.cells
        .filter((cell) => !cell.rest && !cell.tiedFromPrevious)
        .map((cell) => spanStart + cell.start);
      spanStart += span.spanLen;
      return onsets;
    });
    expect(previewOnsetMatras).toEqual([0, 2, 4, 6, 8]);
    expect(spanStart).toBe(10);

    const beforePlay = await backend.invoke<RealSnapshot>(
      "transport_get_snapshot"
    );
    const cursor = beforePlay.midiDebugEvents.reduce(
      (max, event) => Math.max(max, event.sequence),
      -1
    );

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);
    await expect
      .poll(async () => {
        const snapshot = await backend.invoke<RealSnapshot>(
          "transport_get_snapshot"
        );
        return snapshot.midiDebugEvents
          .filter(
            (event) =>
              event.sequence > cursor &&
              event.cycle === 0 &&
              event.messageType === "noteOn"
          )
          .map((event) => event.tickInCycle);
      })
      .toEqual([0, 384, 768, 1152, 1536]);

    const afterPlayDriver = await readRealDriverState(page);
    expect(afterPlayDriver.lastTrackPlaybackRequest?.generator).toEqual(
      beforePlayDriver.lastGeneratorPreviewRequest?.generator
    );
    expect(
      (afterPlayDriver.lastTrackPlaybackRequest?.generator as { pattern?: string })
        .pattern
    ).toBe(pattern);
  });

  test("playback starts only after the real score and generator payloads are applied", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");

    await openFreshEightBeatCaesura(page);
    await expect(page.getByTestId("transport-play")).toBeEnabled();
    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const state = await readPublishedState(page);
    const driver = await readRealDriverState(page);
    const commandNames = driver.calls.map((call) => call.command);
    const playIndex = commandNames.lastIndexOf("transport_play");
    const createIndex = commandNames.lastIndexOf("score_create_subdivision_switch");
    const playbackSetIndex = commandNames.lastIndexOf("track_set_playback");

    expect(playIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(playbackSetIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeLessThan(playIndex);
    expect(playbackSetIndex).toBeLessThan(playIndex);
    expect(driver.lastScoreCreateRequest).toEqual(
      driver.lastPreviewRequest?.request
    );
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
  });

  test("score automation reaches real preview and track playback payloads", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");

    await openFreshEightBeatCaesura(page);
    await configureVelocityAutomationLane(page);
    await waitForVelocityAutomationPreview(page);
    await showVelocityAutomationTimelineLane(page);

    const driverBeforePlay = await readRealDriverState(page);
    const preview = driverBeforePlay.lastPreview as
      | {
          beats?: Array<{
            automationValues?: Array<{ target: string; value: number }>;
          }>;
        }
      | null;
    const expectedCellText =
      preview?.beats?.map((beat) => {
        const value = beat.automationValues?.find(
          (sample) => sample.target === "sequencer.velocity"
        )?.value;
        expect(value).toBeDefined();
        return `${Math.round(value!)}`;
      }) ?? [];

    expect(expectedCellText).toEqual([
      "48",
      "56",
      "64",
      "72",
      "80",
      "88",
      "96",
      "104",
    ]);
    const automationCells = page.locator(".automation-layer-cell");
    await expect(automationCells).toHaveCount(expectedCellText.length);
    await expect(automationCells).toHaveText(expectedCellText);

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const driverAfterPlay = await readRealDriverState(page);
    const previewAutomation =
      driverAfterPlay.lastPreviewRequest?.request.automation;
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
    expect(driverAfterPlay.invokeErrors).toEqual([]);
  });

  test("triggered follower config reaches real parallel playback", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");

    await openCaesuraReal(page);
    await expect(page.locator(".parallel-track-cell")).toHaveCount(1);

    await page.getByRole("button", { name: "New track", exact: true }).click();
    await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
    // The role flip round-trips the real backend (applyParallelProject), so
    // the radio checks asynchronously — `.check()` would throw "did not
    // change its state" against the real latency. Click, then poll.
    const triggeredRole = page.getByTestId("track-role-triggered");
    await triggeredRole.click();
    await expect(triggeredRole).toBeChecked({ timeout: 15_000 });
    await expect(page.getByTestId("track-trigger-mode")).toHaveValue("triggered");
    await page.getByTestId("track-trigger-detail").selectOption("advanced");
    await expect(page.getByTestId("track-trigger-status")).toHaveText("armed");

    const sourceId = await page.getByTestId("track-trigger-source").inputValue();
    expect(sourceId).toBeTruthy();

    await page.getByTestId("track-trigger-quantize").selectOption("fraction");
    await expect(page.getByLabel("Quantize beat divisions")).toBeVisible();
    await expect(page.getByTestId("track-trigger-quantize-dir")).toHaveValue("next");

    await page.getByTestId("transport-play").click();
    await waitForPlaying(page);

    const driver = await readRealDriverState(page);
    const calls = driver.calls.filter(
      (call) => call.command === "parallel_set_playback"
    );
    expect(calls.length).toBeGreaterThan(0);
    const request = driver.lastParallelPlaybackRequest as
      | {
          tracks?: Array<{
            id: string;
            trigger:
              | null
              | {
                  sourceTrackId: string;
                  when: unknown;
                  reTrigger: string;
                  length: { type: string };
                  launchQuantize:
                    | { grid: { type: string }; direction: string }
                    | null;
                };
          }>;
        }
      | null;
    const follower = request?.tracks?.find((track) => track.trigger);
    expect(follower).toBeTruthy();
    expect(follower!.trigger!.sourceTrackId).toBe(sourceId);
    expect(follower!.trigger!.when).toEqual({
      beats: { type: "at", beat: 3 },
      tree: { type: "leaf", predicate: { type: "isRest" } },
    });
    expect(follower!.trigger!.reTrigger).toBe("restart");
    expect(follower!.trigger!.length).toEqual({ type: "scoreCycle" });
    expect(follower!.trigger!.launchQuantize).toEqual({
      grid: { type: "referenceBeatFraction", divisions: 4 },
      direction: "next",
    });
    expect(driver.invokeErrors).toEqual([]);
  });

  /**
   * Play until at least two full cycles completed, return onset ticks.
   * The MIDI debug log persists across stop/play, so `sinceSequence` scopes
   * the capture to events recorded after a given point.
   */
  async function captureTwoCycles(sinceSequence: number): Promise<{
    ticksPerCycle: number;
    onsetTicksByCycle: Map<number, number[]>;
    lastSequence: number;
  }> {
    // currentCycle persists across stop (it is not reset until the next
    // play's first scheduler tick), so a bare cycle check could satisfy on
    // leftovers from a previous run. isPlaying and currentCycle are written
    // under the same lock, so requiring both means "this run reached 2".
    await expect
      .poll(
        async () => {
          const snapshot = await backend.invoke<RealSnapshot>(
            "transport_get_snapshot"
          );
          return snapshot.isPlaying && snapshot.currentCycle >= 2;
        },
        { timeout: 45_000, intervals: [250] }
      )
      .toBe(true);

    const snapshot = await backend.invoke<RealSnapshot>("transport_get_snapshot");
    const onsetTicksByCycle = new Map<number, number[]>();
    let lastSequence = sinceSequence;
    for (const event of snapshot.midiDebugEvents) {
      lastSequence = Math.max(lastSequence, event.sequence);
      if (event.sequence <= sinceSequence) continue;
      if (event.messageType !== "noteOn") continue;
      if (event.cycle >= 2) continue; // current cycle may be partial
      const ticks = onsetTicksByCycle.get(event.cycle) ?? [];
      ticks.push(event.tickInCycle);
      onsetTicksByCycle.set(event.cycle, ticks);
    }
    return {
      ticksPerCycle: snapshot.ticksPerCycle,
      onsetTicksByCycle,
      lastSequence,
    };
  }

  test("timeline preview and real MIDI output describe the same cycle", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "no MIDI output available in this environment");
    test.setTimeout(90_000);

    await openCaesuraReal(page);
    await authorForcedGatiSeven(page);

    // Structure promised by the real preview the timeline renders: 4 beats,
    // gati 7 each. The always-on rhythm layer may legally group matras into
    // longer notes and may rest spans entirely (beat starts are not
    // guaranteed to sound), so the parity invariants are:
    // (1) every onset sits on the 28-matra grid the preview promises,
    // (2) onsets stay within the matra count and carry the authored
    //     pitch/channel,
    // (3) replaying from cycle 0 reproduces the exact same onsets (seeds).
    const state = await readPublishedState(page);
    const beats = state.sections.flatMap((section) => section.beats);
    expect(beats).toHaveLength(4);
    for (const beat of beats) expect(beat.gati).toBe(7);

    const beforeFirstRun = await backend.invoke<RealSnapshot>(
      "transport_get_snapshot"
    );
    const firstRunCursor = beforeFirstRun.midiDebugEvents.reduce(
      (max, event) => Math.max(max, event.sequence),
      -1
    );

    await page.getByTestId("transport-play").click();
    const firstRun = await captureTwoCycles(firstRunCursor);
    await page.getByTestId("transport-stop").click();

    const { ticksPerCycle, onsetTicksByCycle } = firstRun;
    expect(ticksPerCycle).toBe(4 * 960);
    expect([...onsetTicksByCycle.keys()].sort()).toEqual([0, 1]);

    const ticksPerMatra = ticksPerCycle / 28;
    for (const [cycle, ticks] of onsetTicksByCycle) {
      expect(
        ticks.length,
        `cycle ${cycle}: onset count must not exceed the matra count`
      ).toBeLessThanOrEqual(28);
      expect(ticks.length).toBeGreaterThanOrEqual(1);

      for (const tick of ticks) {
        const nearestGridTick =
          Math.round(tick / ticksPerMatra) * ticksPerMatra;
        expect(
          Math.abs(tick - nearestGridTick),
          `cycle ${cycle}: noteOn at tickInCycle ${tick} should sit on the ` +
            `28-matra grid promised by the previewed gati-7 beats`
        ).toBeLessThanOrEqual(1);
      }
    }

    // Every onset carries the authored pitch and channel.
    const snapshot = await backend.invoke<RealSnapshot>("transport_get_snapshot");
    for (const event of snapshot.midiDebugEvents) {
      if (event.messageType !== "noteOn") continue;
      if (event.sequence <= firstRunCursor) continue;
      expect(event.data1, "noteOn pitch must be the authored pitch").toBe(60);
      expect(event.channel, "noteOn channel must be the authored channel").toBe(1);
    }

    // Determinism: restart playback through the UI (the supported path —
    // the app and transport must stay in sync) and require byte-identical
    // cycle 0/1 onsets. Re-sample the sequence cursor after stopping: the
    // first run keeps recording (partial cycle 2, all-notes-off) between
    // our snapshot and the stop click.
    await expect
      .poll(async () => {
        const snapshot = await backend.invoke<RealSnapshot>(
          "transport_get_snapshot"
        );
        return snapshot.isPlaying;
      })
      .toBe(false);
    const betweenRuns = await backend.invoke<RealSnapshot>(
      "transport_get_snapshot"
    );
    const replayCursor = betweenRuns.midiDebugEvents.reduce(
      (max, event) => Math.max(max, event.sequence),
      -1
    );

    await page.getByTestId("transport-play").click();
    const secondRun = await captureTwoCycles(replayCursor);
    await page.getByTestId("transport-stop").click();

    for (const [cycle, ticks] of onsetTicksByCycle) {
      expect(
        secondRun.onsetTicksByCycle.get(cycle),
        `cycle ${cycle}: replay from cycle 0 must reproduce identical onsets`
      ).toEqual(ticks);
    }
  });

  test("patch save and reload through the real backend preserves the score", async ({
    page,
  }) => {
    await openCaesuraReal(page);
    await authorForcedGatiSeven(page);

    const patchPath = `${backend.tempDir}/parity-roundtrip.dumka`;

    // Save via the real patch_save_to_path (real file, real JSON).
    await page.evaluate(async (path) => {
      const driver = window.__CAESURA_E2E_DRIVER__ as unknown as {
        enqueueDialogResponse(kind: string, value: unknown): void;
        emitNativeMenuAction(action: string): void;
      };
      driver.enqueueDialogResponse("save", path);
      driver.emitNativeMenuAction("savePatchAs");
    }, patchPath);
    await page.waitForFunction(() => {
      const driver = window.__CAESURA_E2E_DRIVER__ as unknown as {
        getState(): { calls: Array<{ command: string }> };
      };
      return driver
        .getState()
        .calls.some((call) => call.command === "patch_save_to_path");
    });

    // The file the backend wrote must parse and validate in the backend.
    const loaded = await backend.invoke<Record<string, unknown>>(
      "patch_load_from_path",
      { path: patchPath }
    );
    expect(loaded).not.toBeNull();
    const sequencer = (loaded as { sequencer?: { cycleBeats?: number } }).sequencer;
    expect(sequencer?.cycleBeats).toBe(4);

    // Reload it through the app's recall flow and confirm the timeline
    // returns to the authored structure.
    await page.evaluate(async (path) => {
      const driver = window.__CAESURA_E2E_DRIVER__ as unknown as {
        enqueueDialogResponse(kind: string, value: unknown): void;
        emitNativeMenuAction(action: string): void;
      };
      driver.enqueueDialogResponse("open", path);
      driver.emitNativeMenuAction("recallPatch");
    }, patchPath);

    await page.waitForFunction(() => {
      const state = window.__CAESURA_E2E_STATE__ as unknown as E2eState | undefined;
      if (!state?.timelinePreviewReady || !state.preview) return false;
      return (
        state.preview.beatCount === 4 &&
        state.preview.beatGatis.every((gati: number) => gati === 7)
      );
    });

    const driver = await readRealDriverState(page);
    expect(driver.invokeErrors).toEqual([]);
  });

  test("track export and import round-trip through the real backend", async ({
    page,
  }) => {
    test.skip(!backend.midiReady, "transport unavailable in this environment");
    await openCaesuraReal(page);
    const trackPath = `${backend.tempDir}/parity-track.dumka-track`;

    await page.evaluate((path) => {
      const driver = window.__CAESURA_E2E_DRIVER__ as unknown as {
        enqueueDialogResponse(kind: string, value: unknown): void;
      };
      driver.enqueueDialogResponse("save", path);
    }, trackPath);
    await page.locator(".parallel-track-export").first().click();
    await expect(page.locator(".success-banner")).toContainText("Exported track");

    const saved = await backend.invoke<Record<string, unknown>>(
      "track_load_from_path",
      { path: trackPath }
    );
    expect(saved).toMatchObject({
      app: "Dum-Ka",
      kind: "track",
      schemaVersion: 1,
      globalContext: { tempoBpm: 80, cycleBeats: 4 },
      track: {
        id: "track-1",
        name: "Track 1",
        tempoMode: "global",
        cycleLengthMode: "global",
        generatorEnabled: true,
        generator: {
          kind: "example",
          densityPercent: 100,
        },
        sequencer: {
          name: "",
          cycleBeats: 4,
          boundaries: [],
        },
      },
    });

    await page.evaluate((path) => {
      const driver = window.__CAESURA_E2E_DRIVER__ as unknown as {
        enqueueDialogResponse(kind: string, value: unknown): void;
      };
      driver.enqueueDialogResponse("open", path);
      driver.enqueueDialogResponse("ask", true);
    }, trackPath);
    await page.getByRole("button", { name: "Import track from a file" }).click();

    await expect(page.locator(".success-banner")).toContainText("Imported track");
    await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
    const driver = await readRealDriverState(page);
    expect(driver.calls.map((call) => call.command)).toContain(
      "track_save_to_path"
    );
    expect(driver.calls.map((call) => call.command)).toContain(
      "track_load_from_path"
    );
    expect(driver.invokeErrors).toEqual([]);
  });
});
