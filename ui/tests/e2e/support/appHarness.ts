import { expect, type Locator, type Page } from "@playwright/test";

import {
  installMockTauri,
  readDriverState,
  readE2eState,
  type MockTauriOptions,
} from "./mockTauri";

export interface E2eState {
  transportIsPlaying: boolean;
  playbackStructureLocked: boolean;
  canStartPlayback: boolean;
  activeSeedPathId: string | null;
  activeSeedTraceCount: number;
  queuedSeedPathId: string | null;
  latestSeedTraceCycle: number | null;
  timelineLayoutCycle: number;
  timelinePreviewReady: boolean;
  timelineRhythmReady: boolean;
  timelineLayerSourcesCoherent: boolean;
  timelineRenderSyncing: boolean;
  timelinePreviewCycle: number | null;
  renderedTimelineLayoutCycle: number;
  renderedSectionCount: number;
  rhythmSpanCount: number;
  visibleTransportEventCounts: {
    ratchet: number;
    ornament: number;
    pitch: number;
    channelHocket: number;
  };
  switchRequest: { ok: boolean; cycleBeats?: number; inflectionCount?: number };
  sections: Array<{
    sectionIndex: number;
    startBeat: number;
    endBeat: number;
    gati: number;
    jathi?: number | null;
    beats: Array<{
      beat: number;
      gati: number;
      sectionStart: boolean;
      accentVelocity?: number;
      pitch?: number;
      automationTargets?: string[];
    }>;
  }>;
  preview: {
    cycle: number;
    beatCount: number;
    pulseSpanCount: number;
    sectionStartBeats: number[];
    beatGatis: number[];
  } | null;
}

export interface PreviewPulseSpan {
  id: number;
  kind: "section" | "gatiBeat" | "jathiPulse";
  sectionIndex: number | null;
  beat: number | null;
  gati: number | null;
  jathi: number | null;
  index: number | null;
  start: number;
  duration: number;
  startMatra: number;
  matraLen: number;
  /** JB-H NotesPerCell phrasing on bhedam spans; null elsewhere (mirrors
   * PulseSpanDto.notesPerCell). */
  notesPerCell?: number | null;
  speedMultiplier?: unknown;
  protectedCuts?: number[];
  tags?: string[];
}

export interface DriverState {
  calls: Array<{ sequence: number; command: string; args: unknown }>;
  dialogHistory: Array<{
    sequence: number;
    kind: "ask" | "open" | "save";
    options: unknown;
    result: unknown;
  }>;
  snapshot: {
    tempoBpm: number;
    isPlaying: boolean;
    currentCycle: number;
    currentTick: number;
  };
  lastPreviewRequest: { request: Record<string, unknown>; cycle: number } | null;
  lastPreview: {
    beats: Array<{
      beat: number;
      gati: number;
      pitch?: number;
      accentVelocity?: number;
      baseVelocity?: number;
      automationValues?: Array<{ target: string; value: number }>;
    }>;
    pulseSpans: PreviewPulseSpan[];
  } | null;
  lastScoreCreateRequest: Record<string, unknown> | null;
  lastPatchSave: { path: string; patch: Record<string, unknown> } | null;
  lastPatchLoadPath: string | null;
  patchFiles: Record<string, unknown>;
  autosavePatch: unknown | null;
  lastAutosavePatch: unknown | null;
  lastScoreSavePath: string | null;
  lastGeneratorPreviewRequest: { cycle?: number; spans?: unknown[] } | null;
  lastTrackPlaybackRequest:
    | (Record<string, unknown> & {
        generatorEnabled?: boolean;
        automation?: unknown;
      })
    | null;
  lastParallelPlaybackRequest: Record<string, unknown> | null;
  pendingPreviewCycles: number[];
  commandFailures: Record<string, string>;
  midiRoute: {
    desired: { id: string; name: string } | null;
    connected: boolean;
    lastError: string | null;
  };
  machinePrefs: {
    prefsVersion: number;
    midiDestination: { id: string; name: string } | null;
    autosaveEnabled: boolean;
    autosaveIntervalMs: number;
    autoloadRecentSession: boolean;
  };
  midiDestinations: Array<{ id: string; name: string }>;
}

export type MainEditorId = "boundaries" | "generator" | "evolve" | "channel";

// Kept in lockstep with MainEditorChrome's MainEditorId union and each
// panel's DOM id — enforced by ui/src/e2eHarnessContract.test.ts, so an app
// restructure fails the vitest fast lane instead of silently rotting the
// nightly e2e suite (the 2026-07-06 score→shape restructure did exactly
// that).
const MAIN_EDITOR_PANEL_SELECTORS: Record<MainEditorId, string> = {
  boundaries: "#section-boundaries-panel",
  generator: "#generator-editor",
  evolve: "#evolve-plan-editor",
  channel: "#channel-shaper-panel",
};

const MAIN_EDITOR_OPEN_SELECTOR = Object.values(MAIN_EDITOR_PANEL_SELECTORS)
  .map((selector) => `${selector}[open]`)
  .join(", ");

export async function openCaesura(
  page: Page,
  options: MockTauriOptions = {}
): Promise<void> {
  await openCaesuraShell(page, options);
  await waitForTimelineReady(page);
}

export async function openCaesuraShell(
  page: Page,
  options: MockTauriOptions = {}
): Promise<void> {
  await installMockTauri(page, options);
  await page.goto("/");
  await page.getByTestId("timeline-panel").waitFor();
}

export async function openMainEditor(
  page: Page,
  editor: MainEditorId,
  options: { force?: boolean } = {}
): Promise<Locator> {
  const existing = page.locator(MAIN_EDITOR_OPEN_SELECTOR);
  if ((await existing.count()) > 0) {
    const targetAlreadyOpen = await page
      .locator(`${MAIN_EDITOR_PANEL_SELECTORS[editor]}[open]`)
      .count();
    if (targetAlreadyOpen > 0) {
      const panel = page.locator(MAIN_EDITOR_PANEL_SELECTORS[editor]);
      await panel.waitFor({ state: "visible" });
      return panel;
    }
    await closeMainEditor(page);
  }
  const launcher = page.getByTestId(`main-editor-launcher-${editor}`);
  if (options.force) {
    await launcher.evaluate((element) => (element as HTMLButtonElement).click());
  } else {
    await launcher.click();
  }
  const panel = page.locator(MAIN_EDITOR_PANEL_SELECTORS[editor]);
  await panel.waitFor({ state: "visible" });
  return panel;
}

export async function closeMainEditor(page: Page): Promise<void> {
  const existing = page.locator(MAIN_EDITOR_OPEN_SELECTOR);
  if ((await existing.count()) === 0) return;
  await page
    .locator(".main-editor-backdrop")
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(existing).toHaveCount(0);
}

export async function waitForTimelineReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window.__CAESURA_E2E_STATE__;
    return Boolean(
      state?.timelinePreviewReady &&
        state.timelineRhythmReady &&
        state.timelineLayerSourcesCoherent
    );
  });
}

export async function waitForPlaying(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window.__CAESURA_E2E_STATE__;
    return Boolean(state?.transportIsPlaying && state.timelineLayerSourcesCoherent);
  });
}

export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window.__CAESURA_E2E_STATE__;
    return Boolean(
      state &&
        !state.transportIsPlaying &&
        !state.playbackStructureLocked &&
        state.timelineLayerSourcesCoherent
    );
  });
}

export async function getE2eState(page: Page): Promise<E2eState> {
  return await readE2eState<E2eState>(page);
}

export async function getDriverState(page: Page): Promise<DriverState> {
  return await readDriverState<DriverState>(page);
}

export async function fillNumeric(
  locator: Locator,
  value: number | string
): Promise<void> {
  await locator.fill(String(value));
  await locator.blur();
}

export async function clearCommandFailure(
  page: Page,
  command: string
): Promise<void> {
  await setCommandFailure(page, command, null);
}

export async function setCommandFailure(
  page: Page,
  command: string,
  message: string | null
): Promise<void> {
  await page.evaluate(
    ({ commandName, errorMessage }) =>
      window.__CAESURA_E2E_DRIVER__?.setCommandFailure(
        commandName,
        errorMessage
      ),
    { commandName: command, errorMessage: message }
  );
}

export async function emitLiveCycle(page: Page, cycle: number): Promise<void> {
  await page.evaluate(
    (cycleIndex) => window.__CAESURA_E2E_DRIVER__?.emitLiveCycle(cycleIndex),
    cycle
  );
}

export async function emitNativeMenuAction(
  page: Page,
  action: string
): Promise<void> {
  await page.evaluate(
    (menuAction) => window.__CAESURA_E2E_DRIVER__?.emitNativeMenuAction(menuAction),
    action
  );
}

export async function enqueueDialogResponse(
  page: Page,
  kind: "ask" | "open" | "save",
  value: unknown
): Promise<void> {
  await page.evaluate(
    ({ dialogKind, dialogValue }) =>
      window.__CAESURA_E2E_DRIVER__?.enqueueDialogResponse(
        dialogKind,
        dialogValue
      ),
    { dialogKind: kind, dialogValue: value }
  );
}

export async function releasePreviewCycle(page: Page, cycle: number): Promise<void> {
  await page.evaluate(
    (cycleIndex) => window.__CAESURA_E2E_DRIVER__?.releasePreviewCycle(cycleIndex),
    cycle
  );
}

export async function waitForPendingPreview(
  page: Page,
  cycle: number
): Promise<void> {
  await page.waitForFunction(
    (cycleIndex) =>
      window.__CAESURA_E2E_DRIVER__
        ?.getState()
        ?.pendingPreviewCycles.includes(cycleIndex),
    cycle
  );
}

export function commandNames(driver: DriverState): string[] {
  return driver.calls.map((call) => call.command);
}

export function countCommand(driver: DriverState, command: string): number {
  return driver.calls.filter((call) => call.command === command).length;
}

export async function expectNoErrorNotices(page: Page): Promise<void> {
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.locator(".preview-banner")).toHaveCount(0);
}

export function expectedMatraCellCount(state: E2eState): number {
  return state.sections.reduce(
    (sum, section) =>
      sum + section.beats.reduce((beatSum, beat) => beatSum + beat.gati, 0),
    0
  );
}
