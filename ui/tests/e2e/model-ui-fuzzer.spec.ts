import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import {
  closeMainEditor,
  expectedMatraCellCount,
  getDriverState,
  getE2eState,
  openCaesura,
  openMainEditor,
  waitForIdle,
  waitForPlaying,
  waitForTimelineReady,
  type DriverState,
  type E2eState,
} from "./support/appHarness";

const DEFAULT_FUZZ_STEPS = 40;
const DEFAULT_FUZZ_SEEDS = "20260517";
const EDGE_SUBDIVISION_VALUES = [1, 3, 4, 5, 7, 11, 64];
const EDGE_TEMPO_VALUES = [20, 40, 79.5, 120, 399.5, 400, 401, 0];
const EDGE_PITCH_VALUES = [-1, 0, 1, 48, 60, 72, 127, 128];
const EDGE_VELOCITY_VALUES = [0, 1, 2, 64, 96, 126, 127, 128];
const EDGE_CYCLE_VALUES = [1, 2, 3, 4, 7, 8, 16, 32, 64, 65];

type FuzzLogEntry = {
  index: number;
  name: string;
  before: {
    playing: boolean;
    cycleBeats: number;
    canStartPlayback: boolean;
    inflectionCount: number;
  };
  detail: string;
};

type FuzzModel = {
  state: E2eState;
  driver: DriverState;
  playing: boolean;
  cycleBeats: number;
  hasAutomationTrack: boolean;
};

type FuzzContext = {
  page: Page;
  rng: SplitMix64;
  log: FuzzLogEntry[];
};

type FuzzAction = {
  name: string;
  weight: number;
  allowed: (model: FuzzModel) => boolean;
  run: (context: FuzzContext, model: FuzzModel) => Promise<string>;
};

class SplitMix64 {
  private state: bigint;

  constructor(seed: number) {
    this.state = BigInt.asUintN(64, BigInt(seed));
  }

  nextU64(): bigint {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return BigInt.asUintN(64, z ^ (z >> 31n));
  }

  next(): number {
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * Math.max(1, maxExclusive));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty list");
    }
    return items[this.int(items.length)]!;
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSeeds(): number[] {
  const raw = process.env.CAESURA_UI_FUZZ_SEEDS ?? DEFAULT_FUZZ_SEEDS;
  return raw
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((seed) => Number.isFinite(seed));
}

function actionWeightedChoice(actions: FuzzAction[], rng: SplitMix64): FuzzAction {
  const totalWeight = actions.reduce((sum, action) => sum + action.weight, 0);
  let cursor = rng.next() * totalWeight;
  for (const action of actions) {
    cursor -= action.weight;
    if (cursor <= 0) return action;
  }
  return actions[actions.length - 1]!;
}

function numberInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('[role="spinbutton"]')
    .first();
}

async function locatorIsVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function ensureDetailsOpen(page: Page, selector: string): Promise<void> {
  if (selector === "#section-boundaries-panel") {
    await openMainEditor(page, "boundaries");
    return;
  }
  if (selector === ".panel-state-boundaries") {
    await openMainEditor(page, "boundaries");
    return;
  }
  const details = page.locator(selector);
  const isOpen = await details.evaluate(
    (node) => (node as HTMLDetailsElement).open
  );
  if (!isOpen) {
    await details.locator("summary").click();
  }
}

async function fillNumber(locator: Locator, value: number): Promise<void> {
  await locator.fill(`${value}`);
  await locator.evaluate((node) => {
    if (node instanceof HTMLInputElement) node.blur();
  });
}

async function openAutomationDialog(page: Page): Promise<Locator> {
  await closeMainEditor(page);
  await page.getByRole("button", { name: "Automation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Automation" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeAutomationDialog(dialog: Locator): Promise<void> {
  const close = dialog.getByLabel("Close Automation editor");
  if (await locatorIsVisible(close)) {
    await close.click();
  }
}

async function currentModel(page: Page): Promise<FuzzModel> {
  const state = await getE2eState(page);
  const driver = await getDriverState(page);
  const request = driver.lastPreviewRequest?.request;
  const automation = request?.automation as
    | { tracks?: Array<Record<string, unknown>> }
    | null
    | undefined;
  return {
    state,
    driver,
    playing: state.transportIsPlaying,
    cycleBeats:
      typeof request?.cycleBeats === "number"
        ? request.cycleBeats
        : state.switchRequest.cycleBeats ?? 8,
    hasAutomationTrack: Boolean(automation?.tracks?.length),
  };
}

async function waitForFuzzSettled(page: Page): Promise<E2eState> {
  await waitForTimelineReady(page);
  const handle = await page.waitForFunction(async () => {
    const ready = () => {
      const state = window.__CAESURA_E2E_STATE__;
      return state &&
        state?.switchRequest.ok &&
        state.preview &&
        state.timelinePreviewReady &&
        state.timelineRhythmReady &&
        state.timelineLayerSourcesCoherent
        ? state
        : false;
    };
    const first = ready();
    if (!first) return false;
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return ready();
  });
  return (await handle.jsonValue()) as E2eState;
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function scanFiniteNumbers(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} is not finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanFiniteNumbers(item, `${path}[${index}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      scanFiniteNumbers(nested, path ? `${path}.${key}` : key, errors);
    }
  }
}

function validatePreviewRequest(request: Record<string, unknown> | null | undefined): string[] {
  const errors: string[] = [];
  if (!request) return ["missing preview request"];
  scanFiniteNumbers(request, "request", errors);

  if (!inRange(request.cycleBeats, 1, 64)) {
    errors.push(`cycleBeats out of range: ${String(request.cycleBeats)}`);
  }
  if (!inRange(request.pitch, 0, 127)) {
    errors.push(`pitch out of range: ${String(request.pitch)}`);
  }
  if (!inRange(request.velocity, 1, 127)) {
    errors.push(`velocity out of range: ${String(request.velocity)}`);
  }

  const accent = request.accent as
    | {
        beatStart?: { min?: unknown; max?: unknown };
        sectionStartExtra?: { min?: unknown; max?: unknown };
        jathiStart?: { min?: unknown; max?: unknown };
      }
    | undefined;
  for (const label of ["beatStart", "sectionStartExtra", "jathiStart"] as const) {
    const range = accent?.[label];
    if (!inRange(range?.min, 0, 127) || !inRange(range?.max, 0, 127)) {
      errors.push(`${label} accent range is outside 0..127`);
    }
  }

  const inflections = request.inflections;
  if (Array.isArray(inflections)) {
    for (const [index, inflection] of inflections.entries()) {
      const item = inflection as Record<string, unknown>;
      if (!inRange(item.position, 0, 1)) errors.push(`inflection ${index} position invalid`);
      if (!inRange(item.changeProbability, 0, 1)) {
        errors.push(`inflection ${index} probability invalid`);
      }
      for (const key of ["subdivisionWeights", "jathiWeights"]) {
        const weights = item[key];
        if (!Array.isArray(weights)) continue;
        for (const [weightIndex, weight] of weights.entries()) {
          const value = (weight as { weight?: unknown }).weight;
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            errors.push(`inflection ${index} ${key}[${weightIndex}] weight invalid`);
          }
        }
      }
    }
  }

  return errors;
}

async function assertFuzzInvariants(
  page: Page,
  runtimeErrors: string[],
  actionIndex: number
): Promise<void> {
  const state = await waitForFuzzSettled(page);
  expect(runtimeErrors).toEqual([]);

  const driver = await getDriverState(page);
  expect(state.switchRequest.ok).toBe(true);
  expect(state.preview).not.toBeNull();
  expect(state.sections.length).toBeGreaterThan(0);
  expect(validatePreviewRequest(driver.lastPreviewRequest?.request)).toEqual([]);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.locator(".preview-banner")).toHaveCount(0);

  if (state.transportIsPlaying) {
    expect(state.playbackStructureLocked).toBe(true);
    await expect(page.getByTestId("transport-play")).toBeDisabled();
    await expect(page.getByTestId("transport-stop")).toBeEnabled();
    if (driver.lastScoreCreateRequest) {
      expect(driver.lastScoreCreateRequest).toEqual(driver.lastPreviewRequest?.request);
    }
  } else {
    expect(state.playbackStructureLocked).toBe(false);
    if (state.canStartPlayback) {
      await expect(page.getByTestId("transport-play")).toBeEnabled();
    }
  }

  if (actionIndex % 10 === 0) {
    await expect(page.getByTestId("gati-matra-cell")).toHaveCount(
      expectedMatraCellCount(state)
    );
  }
}

async function clickBoundaryRail(
  page: Page,
  cycleBeats: number,
  afterBeat: number
): Promise<void> {
  const rail = page.getByLabel("Section boundaries");
  const box = await rail.boundingBox();
  if (!box) throw new Error("Boundary rail was not visible");
  await page.mouse.click(
    box.x + box.width * (afterBeat / cycleBeats),
    box.y + box.height / 2
  );
}

function stoppedAction(name: string, weight: number, run: FuzzAction["run"]): FuzzAction {
  return { name, weight, allowed: (model) => !model.playing, run };
}

const fuzzActions: FuzzAction[] = [
  {
    name: "start playback",
    weight: 3,
    allowed: (model) => !model.playing && model.state.canStartPlayback,
    run: async ({ page }) => {
      await closeMainEditor(page);
      await page.getByTestId("transport-play").click();
      await waitForPlaying(page);
      return "transport started";
    },
  },
  {
    name: "stop playback",
    weight: 3,
    allowed: (model) => model.playing,
    run: async ({ page }) => {
      await closeMainEditor(page);
      await page.getByTestId("transport-stop").click();
      await waitForIdle(page);
      return "transport stopped";
    },
  },
  {
    name: "toggle synth",
    weight: 1,
    allowed: () => true,
    run: async ({ page }) => {
      await closeMainEditor(page);
      const button = page.getByRole("button", { name: /Synth (on|off)/ });
      const label = await button.textContent();
      await button.click();
      return `clicked ${label?.trim() ?? "synth toggle"}`;
    },
  },
  {
    name: "edit tempo",
    weight: 3,
    allowed: () => true,
    run: async ({ page, rng }) => {
      await closeMainEditor(page);
      const value = rng.pick(EDGE_TEMPO_VALUES);
      const input = page.getByLabel("Tempo");
      await input.fill(`${value}`);
      await input.press("Enter");
      return `tempo=${value}`;
    },
  },
  stoppedAction("edit cycle beats", 4, async ({ page, rng }) => {
    await ensureDetailsOpen(page, "#section-boundaries-panel");
    const scoreSetup = page.locator("#section-boundaries-panel");
    const value = rng.pick(EDGE_CYCLE_VALUES);
    await fillNumber(numberInputByLabel(scoreSetup, "Beats/cycle"), value);
    return `cycleBeats=${value}`;
  }),
  stoppedAction("edit pitch", 3, async ({ page, rng }) => {
    await ensureDetailsOpen(page, "#section-boundaries-panel");
    const scoreSetup = page.locator("#section-boundaries-panel");
    const value = rng.pick(EDGE_PITCH_VALUES);
    await fillNumber(numberInputByLabel(scoreSetup, "Pitch"), value);
    return `pitch=${value}`;
  }),
  stoppedAction("edit velocity", 3, async ({ page, rng }) => {
    await ensureDetailsOpen(page, "#section-boundaries-panel");
    const scoreSetup = page.locator("#section-boundaries-panel");
    const value = rng.pick(EDGE_VELOCITY_VALUES);
    await fillNumber(numberInputByLabel(scoreSetup, "Velocity"), value);
    return `velocity=${value}`;
  }),
  stoppedAction("inspect stopped cycle", 2, async ({ page, rng }) => {
    await closeMainEditor(page);
    const value = rng.pick([0, 1, 2, 3, 5]);
    const previous = page.getByRole("button", {
      name: "Inspect previous stopped cycle",
    });
    const next = page.getByRole("button", { name: "Inspect next stopped cycle" });
    for (let index = 0; index < 8 && (await previous.isEnabled()); index += 1) {
      await previous.click();
    }
    for (let index = 0; index < value; index += 1) {
      await next.click();
    }
    return `inspectCycle=${value}`;
  }),
  stoppedAction("click boundary rail", 4, async ({ page, rng }, model) => {
    if (model.cycleBeats <= 1) return "skipped cycleBeats<=1";
    const afterBeat = 1 + rng.int(model.cycleBeats - 1);
    await clickBoundaryRail(page, model.cycleBeats, afterBeat);
    return `afterBeat=${afterBeat}`;
  }),
  stoppedAction("edit initial subdivision", 3, async ({ page, rng }) => {
    const sections = await openMainEditor(page, "boundaries");
    const startSection = sections.getByLabel("Section 1 inspector");
    const value = rng.pick(EDGE_SUBDIVISION_VALUES);
    await fillNumber(numberInputByLabel(startSection, "Subdivision"), value);
    return `subdivision=${value}`;
  }),
  stoppedAction("edit initial grouping", 3, async ({ page, rng }) => {
    const sections = await openMainEditor(page, "boundaries");
    const grouping = sections
      .getByLabel("Section 1 inspector")
      .getByLabel("Grouping", { exact: true });
    const values = await grouping.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
    const value = rng.pick(values);
    await grouping.selectOption(value);
    return `grouping=${value || "none"}`;
  }),
  stoppedAction("mutate velocity automation lane", 3, async ({ page, rng }) => {
    const dialog = await openAutomationDialog(page);
    const graph = dialog.getByRole("img", { name: "Velocity automation graph" });
    if (await locatorIsVisible(graph)) {
      const pointRows = dialog.locator(".automation-point-row");
      const rowCount = await pointRows.count();
      const row = pointRows.nth(rng.int(Math.max(1, rowCount)));
      const value = rng.pick(EDGE_VELOCITY_VALUES);
      await fillNumber(row.locator('[role="spinbutton"]').nth(1), value);
      await closeAutomationDialog(dialog);
      return `automationVelocityPoint=${value}`;
    }

    const target = dialog.getByRole("button", {
      name: /Velocity\s+Cycle\s+int\s+beat/,
    });
    if ((await target.count()) > 0) {
      await target.first().click();
      await closeAutomationDialog(dialog);
      return "automation velocity target added";
    }
    await closeAutomationDialog(dialog);
    return "automation velocity target unavailable";
  }),
  stoppedAction("toggle timeline automation lane", 2, async ({ page, rng }, model) => {
    if (!model.hasAutomationTrack) return "skipped no automation track";
    const toggle = page.locator(".timeline-automation-toggle");
    if (!(await locatorIsVisible(toggle))) return "skipped no timeline toggle";
    await toggle.click();
    const checkboxes = page
      .getByRole("group", { name: "Timeline automation lanes" })
      .locator('input[type="checkbox"]');
    if ((await checkboxes.count()) > 0) {
      await checkboxes.nth(rng.int(await checkboxes.count())).setChecked(rng.bool());
    }
    await toggle.click();
    return "timeline automation lane toggled";
  }),
  {
    name: "assert playback locks",
    weight: 3,
    allowed: (model) => model.playing,
    run: async ({ page }) => {
      await ensureDetailsOpen(page, "#section-boundaries-panel");
      await expect(page.getByLabel("Beats/cycle")).toBeDisabled();
      await expect(page.getByLabel("Section boundaries")).toHaveClass(
        /is-disabled/
      );
      return "structure locks asserted";
    },
  },
];

async function attachFuzzArtifacts(
  testInfo: TestInfo,
  seed: number,
  steps: number,
  log: FuzzLogEntry[],
  page: Page
): Promise<void> {
  const driver = await getDriverState(page).catch((error) => ({
    error: String(error),
  }));
  const state = await getE2eState(page).catch((error) => ({ error: String(error) }));
  await testInfo.attach("ui-fuzz-repro.json", {
    body: JSON.stringify({ seed, steps, log, state, driver }, null, 2),
    contentType: "application/json",
  });
}

const fuzzSteps = parsePositiveInteger(
  process.env.CAESURA_UI_FUZZ_STEPS,
  DEFAULT_FUZZ_STEPS
);
const fuzzSeeds = parseSeeds();

test.describe("model-based UI fuzzer", () => {
  test.describe.configure({ mode: "serial" });

  for (const seed of fuzzSeeds) {
    test(`seed ${seed} exercises ${fuzzSteps} UI state transitions`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(
        parsePositiveInteger(
          process.env.CAESURA_UI_FUZZ_TIMEOUT_MS,
          Math.max(120_000, fuzzSteps * 1_500)
        )
      );

      const rng = new SplitMix64(seed);
      const log: FuzzLogEntry[] = [];
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeErrors.push(`console.error: ${message.text()}`);
        }
      });

      await openCaesura(page);

      try {
        for (let index = 0; index < fuzzSteps; index += 1) {
          const model = await currentModel(page);
          const allowedActions = fuzzActions.filter((action) => action.allowed(model));
          const action = actionWeightedChoice(allowedActions, rng);
          const detail = await action.run({ page, rng, log }, model);
          log.push({
            index,
            name: action.name,
            before: {
              playing: model.playing,
              cycleBeats: model.cycleBeats,
              canStartPlayback: model.state.canStartPlayback,
              inflectionCount: model.state.switchRequest.inflectionCount ?? 0,
            },
            detail,
          });
          await assertFuzzInvariants(page, runtimeErrors, index);
        }

        const finalModel = await currentModel(page);
        if (finalModel.playing) {
          await page.getByTestId("transport-stop").click();
          await waitForIdle(page);
        }
      } catch (error) {
        await attachFuzzArtifacts(testInfo, seed, fuzzSteps, log, page);
        throw error;
      }
    });
  }
});
