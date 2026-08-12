import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";

import {
  closeMainEditor,
  expectedMatraCellCount,
  fillNumeric,
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

const GREMLINS_BUNDLE_PATH = fileURLToPath(
  new URL("../../node_modules/gremlins.js/dist/gremlins.min.js", import.meta.url)
);
const DEFAULT_GREMLINS_ACTIONS = 360;
const DEFAULT_GREMLINS_SEGMENT_ACTIONS = 24;
const DEFAULT_GREMLINS_DELAY_MS = 6;
const DEFAULT_GREMLINS_LIVE_CYCLE_MS = 75;
const DEFAULT_GREMLINS_PREVIEW_DELAY_MAX_MS = 60;
const DEFAULT_GREMLINS_SEEDS = "20260517";

type GremlinsProfile =
  | "stopped-editor"
  | "automation-dialog"
  | "live-locked"
  | "live-transport";

type GremlinsLogEntry = {
  level: "log" | "info" | "warn" | "error";
  text: string;
  at: number;
};

type GremlinsAudit = {
  errors: string[];
  actionCounts: Record<string, number>;
  snapshots: Array<{
    label: string;
    playing: boolean;
    locked: boolean;
    coherent: boolean;
    sectionCount: number;
    callCount: number;
  }>;
};

type GremlinsSegmentResult = {
  log: GremlinsLogEntry[];
  audit: GremlinsAudit;
};

type PhaseRecord = {
  phase: string;
  profile: GremlinsProfile;
  segment: number;
  actions: number;
  before: StateSummary;
  after: StateSummary;
  log: GremlinsLogEntry[];
  audit: GremlinsAudit;
};

type StateSummary = {
  playing: boolean;
  locked: boolean;
  canStartPlayback: boolean;
  coherent: boolean;
  cycle: number | null;
  sectionCount: number;
  callCount: number;
};

type ChaosPhase = {
  name: string;
  profile: GremlinsProfile;
  share: number;
  liveCycleChurn?: boolean;
  requirePlaying?: boolean;
  restartPlaybackBetweenSegments?: boolean;
  openAutomationDialog?: boolean;
};

const phases: ChaosPhase[] = [
  {
    name: "stopped editor surface",
    profile: "stopped-editor",
    share: 0.25,
  },
  {
    name: "stopped automation dialog",
    profile: "automation-dialog",
    share: 0.2,
    openAutomationDialog: true,
  },
  {
    name: "locked live playback surface",
    profile: "live-locked",
    share: 0.4,
    liveCycleChurn: true,
    requirePlaying: true,
    restartPlaybackBetweenSegments: true,
  },
  {
    name: "live transport churn",
    profile: "live-transport",
    share: 0.15,
    liveCycleChurn: true,
    restartPlaybackBetweenSegments: true,
  },
];

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSeeds(): number[] {
  const raw = process.env.CAESURA_GREMLINS_SEEDS ?? DEFAULT_GREMLINS_SEEDS;
  const seeds = raw
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((seed) => Number.isFinite(seed));
  return seeds.length > 0 ? seeds : [Number.parseInt(DEFAULT_GREMLINS_SEEDS, 10)];
}

function phaseBudget(totalActions: number, phase: ChaosPhase): number {
  return Math.max(1, Math.round(totalActions * phase.share));
}

function summary(state: E2eState, driver: DriverState): StateSummary {
  return {
    playing: state.transportIsPlaying,
    locked: state.playbackStructureLocked,
    canStartPlayback: state.canStartPlayback,
    coherent: state.timelineLayerSourcesCoherent,
    cycle: state.preview?.cycle ?? null,
    sectionCount: state.sections.length,
    callCount: driver.calls.length,
  };
}

async function summarizeState(page: Page): Promise<StateSummary> {
  return summary(await getE2eState(page), await getDriverState(page));
}

function inRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function scanFiniteNumbers(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} is not finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanFiniteNumbers(item, `${path}[${index}]`, errors)
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      scanFiniteNumbers(nested, path ? `${path}.${key}` : key, errors);
    }
  }
}

function validatePreviewRequest(
  request: Record<string, unknown> | null | undefined
): string[] {
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
      if (!inRange(item.position, 0, 1)) {
        errors.push(`inflection ${index} position invalid`);
      }
      if (!inRange(item.changeProbability, 0, 1)) {
        errors.push(`inflection ${index} probability invalid`);
      }
    }
  }

  return errors;
}

async function locatorIsVisible(locator: ReturnType<Page["locator"]>): Promise<boolean> {
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

async function openAutomationDialog(page: Page): Promise<void> {
  if (await locatorIsVisible(page.getByRole("dialog", { name: "Automation" }))) {
    return;
  }
  await closeMainEditor(page);
  await page.getByRole("button", { name: "Automation", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Automation" })).toBeVisible();
}

async function closeFloatingSurfaces(page: Page): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press("Escape");
  }
  for (let index = 0; index < 6; index += 1) {
    const closeButtons = page.getByRole("dialog").getByRole("button", {
      name: /close/i,
    });
    if ((await closeButtons.count()) === 0) break;
    const close = closeButtons.first();
    if (!(await locatorIsVisible(close))) break;
    await close.click({ timeout: 1_000 }).catch(() => undefined);
  }
  const automationClose = page.getByLabel("Close Automation editor");
  if (await locatorIsVisible(automationClose)) {
    await automationClose.click({ timeout: 1_000 }).catch(() => undefined);
  }
}

async function configureHighRiskState(page: Page): Promise<void> {
  await ensureDetailsOpen(page, "#section-boundaries-panel");
  await ensureDetailsOpen(page, ".panel-state-boundaries");

  const startSection = page.getByLabel("Section 1 inspector");
  await fillNumeric(
    startSection.getByRole("spinbutton", { name: "Subdivision" }),
    "6"
  );
  const grouping = startSection.getByLabel("Grouping", { exact: true });
  await expect(grouping.locator('option[value="4"]')).toHaveCount(1);
  await grouping.selectOption("4");

  await openAutomationDialog(page);
  const dialog = page.getByRole("dialog", { name: "Automation" });
  const velocityGraph = dialog.getByRole("img", { name: "Velocity automation graph" });
  if (!(await locatorIsVisible(velocityGraph))) {
    await dialog
      .getByRole("button", { name: /Velocity\s+Cycle\s+int\s+beat/ })
      .click();
  }
  await expect(velocityGraph).toBeVisible();
  const pointRows = dialog.locator(".automation-point-row");
  await fillNumeric(pointRows.first().locator('[role="spinbutton"]').nth(1), "48");
  await fillNumeric(pointRows.nth(1).locator('[role="spinbutton"]').nth(1), "112");
  await closeFloatingSurfaces(page);

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
  await page
    .getByRole("button", { name: "1 automation lanes shown in timeline" })
    .click();

  await waitForTimelineReady(page);
}

async function ensurePlaying(page: Page): Promise<void> {
  await closeFloatingSurfaces(page);
  const state = await getE2eState(page);
  if (state.transportIsPlaying) {
    await waitForPlaying(page);
    return;
  }
  await expect(page.getByTestId("transport-play")).toBeEnabled();
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);
}

async function ensureIdle(page: Page): Promise<void> {
  await closeFloatingSurfaces(page);
  const state = await getE2eState(page);
  if (!state.transportIsPlaying) return;
  await page.getByTestId("transport-stop").click();
  await waitForIdle(page);
}

async function installGremlins(page: Page): Promise<void> {
  await page.addInitScript({ path: GREMLINS_BUNDLE_PATH });
}

async function waitForChaosTimelineReady(
  page: Page,
  timeoutMs = 20_000
): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const state = window.__CAESURA_E2E_STATE__;
        return Boolean(
          state?.timelinePreviewReady &&
            state.timelineRhythmReady &&
            state.timelineLayerSourcesCoherent
        );
      },
      undefined,
      { timeout: timeoutMs }
    );
  } catch (error) {
    const state = await getE2eState(page).catch((stateError) => ({
      error: String(stateError),
    }));
    const driver = await getDriverState(page).catch((driverError) => ({
      error: String(driverError),
    }));
    throw new Error(
      `timeline did not settle within ${timeoutMs}ms after chaos segment: ${JSON.stringify(
        { state, driver },
        null,
        2
      )}`,
      { cause: error }
    );
  }
}

async function runGremlinsSegment(
  page: Page,
  options: {
    seed: number;
    profile: GremlinsProfile;
    actions: number;
    delayMs: number;
    liveCycleMs: number;
    liveCycleChurn: boolean;
    cycleBase: number;
    previewDelayMaxMs: number;
  }
): Promise<GremlinsSegmentResult> {
  return await page.evaluate(async (config) => {
    const gremlins = window.gremlins;
    if (!gremlins?.createHorde) {
      throw new Error("gremlins.js was not loaded");
    }

    const randomizer = new gremlins.Chance(config.seed);
    const log: GremlinsLogEntry[] = [];
    const audit: GremlinsAudit = { errors: [], actionCounts: {}, snapshots: [] };
    window.__CAESURA_GREMLINS_LOG__ = log;
    window.__CAESURA_GREMLINS_AUDIT__ = audit;

    const toText = (items: unknown[]): string =>
      items
        .map((item) => {
          if (typeof item === "string") return item;
          if (item instanceof Element) return item.outerHTML.slice(0, 140);
          try {
            return JSON.stringify(item);
          } catch {
            return String(item);
          }
        })
        .join(" ");
    const logger = {
      log: (...items: unknown[]) =>
        log.push({ level: "log", text: toText(items), at: performance.now() }),
      info: (...items: unknown[]) =>
        log.push({ level: "info", text: toText(items), at: performance.now() }),
      warn: (...items: unknown[]) =>
        log.push({ level: "warn", text: toText(items), at: performance.now() }),
      error: (...items: unknown[]) =>
        log.push({ level: "error", text: toText(items), at: performance.now() }),
    };

    const visibleElement = (element: Element | null): boolean => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const insideTransport = (element: Element): boolean =>
      Boolean(
        element.closest('[aria-label="Transport"]') ||
          element.closest('[data-testid="transport-play"]') ||
          element.closest('[data-testid="transport-stop"]')
      );
    const canTarget = (element: Element | null): boolean => {
      if (!visibleElement(element)) return false;
      if (!element) return false;
      if (element.closest("[aria-hidden='true']")) return false;
      if (element.closest("[data-playwright-ignore='true']")) return false;
      if (config.profile === "live-locked" && insideTransport(element)) {
        return false;
      }
      if (
        (config.profile === "stopped-editor" ||
          config.profile === "automation-dialog") &&
        insideTransport(element)
      ) {
        return false;
      }
      return true;
    };
    const canFillElement = (element: Element | null): boolean => {
      if (!canTarget(element)) return false;
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
      ) {
        return false;
      }
      if (element.disabled || element.readOnly) return false;
      if (element.getAttribute("aria-disabled") === "true") return false;
      return true;
    };
    const recordAction = (name: string, detail = ""): void => {
      audit.actionCounts[name] = (audit.actionCounts[name] ?? 0) + 1;
      if (detail) {
        logger.log("chaos", name, detail);
      }
    };
    const activeRoot = (): ParentNode => {
      if (config.profile === "automation-dialog") {
        return (
          document.querySelector('[role="dialog"][aria-label="Automation"]') ??
          document
        );
      }
      return document;
    };
    const pickElement = <T extends Element>(selector: string): T | null => {
      const candidates = Array.from(activeRoot().querySelectorAll<T>(selector)).filter(
        canTarget
      );
      return candidates.length ? randomizer.pick(candidates) : null;
    };
    const setNativeValue = (
      element: HTMLInputElement | HTMLTextAreaElement,
      value: string
    ): void => {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    };
    const clickAt = (element: Element, x: number, y: number): void => {
      for (const type of ["mousemove", "mouseover", "mousedown", "mouseup", "click"]) {
        element.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
          })
        );
      }
    };
    const dragAcross = (
      element: Element,
      startX: number,
      startY: number,
      endX: number,
      endY: number
    ): void => {
      const steps = 4;
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: startX,
          clientY: startY,
        })
      );
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: startX,
          clientY: startY,
        })
      );
      for (let index = 1; index <= steps; index += 1) {
        const amount = index / steps;
        const clientX = startX + (endX - startX) * amount;
        const clientY = startY + (endY - startY) * amount;
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            clientX,
            clientY,
          })
        );
        element.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          })
        );
      }
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: endX,
          clientY: endY,
        })
      );
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: endX,
          clientY: endY,
        })
      );
    };
    const appControlSpecies = () => () => {
      const control = pickElement<HTMLElement>(
        [
          "summary",
          "button:not(:disabled)",
          "input[type='checkbox']:not(:disabled)",
          "input[type='radio']:not(:disabled)",
        ].join(",")
      );
      if (!control) return;
      control.click();
      recordAction("appControl", control.textContent?.trim().slice(0, 80) ?? "");
    };
    const numberEdgeSpecies = () => () => {
      const input = pickElement<HTMLInputElement>("input[type='number']:not(:disabled)");
      if (!input || input.readOnly) return;
      const labelText =
        input.getAttribute("aria-label") ??
        input.closest("label")?.textContent?.trim() ??
        "";
      const values = [
        -1, 0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 16, 20, 31, 32, 48, 64, 72, 80, 96,
        112, 120, 127, 128, 255, 400, 401,
      ];
      const value = String(randomizer.pick(values));
      input.focus();
      setNativeValue(input, value);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
        })
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
        })
      );
      recordAction("numberEdge", `${labelText}=${value}`);
    };
    const textEdgeSpecies = () => () => {
      const input = pickElement<HTMLInputElement | HTMLTextAreaElement>(
        "input[type='text']:not(:disabled), textarea:not(:disabled)"
      );
      if (!input || input.readOnly) return;
      const values = [
        "",
        "Caesura",
        "fuzz",
        "012345678901234567890123456789",
        "khanda chatusra tisra",
      ];
      const value = randomizer.pick(values);
      input.focus();
      setNativeValue(input, value);
      recordAction("textEdge", value);
    };
    const selectSpecies = () => () => {
      const select = pickElement<HTMLSelectElement>("select:not(:disabled)");
      if (!select || select.options.length === 0) return;
      select.selectedIndex = randomizer.natural({
        min: 0,
        max: select.options.length - 1,
      });
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      recordAction("select", select.value);
    };
    const boundaryRailSpecies = () => () => {
      const rail = document.querySelector(
        '[aria-label="Section boundaries"]'
      );
      if (!canTarget(rail)) return;
      if (rail?.classList.contains("is-disabled")) return;
      const rect = rail.getBoundingClientRect();
      const x = rect.left + rect.width * randomizer.floating({ min: 0.05, max: 0.95 });
      const y = rect.top + rect.height * randomizer.floating({ min: 0.05, max: 0.95 });
      clickAt(rail, x, y);
      recordAction("boundaryRail", `${Math.round(x)},${Math.round(y)}`);
    };
    const automationGraphSpecies = () => () => {
      const graphs = Array.from(
        document.querySelectorAll<HTMLElement>('[aria-label$="automation graph"]')
      ).filter(canTarget);
      const graph = graphs.length ? randomizer.pick(graphs) : null;
      if (!graph) return;
      const rect = graph.getBoundingClientRect();
      const x1 = rect.left + rect.width * randomizer.floating({ min: 0.08, max: 0.92 });
      const y1 = rect.top + rect.height * randomizer.floating({ min: 0.08, max: 0.92 });
      if (randomizer.bool({ likelihood: 45 })) {
        const x2 = rect.left + rect.width * randomizer.floating({ min: 0.08, max: 0.92 });
        const y2 = rect.top + rect.height * randomizer.floating({ min: 0.08, max: 0.92 });
        dragAcross(graph, x1, y1, x2, y2);
        recordAction("automationGraphDrag", `${Math.round(x1)},${Math.round(y1)}`);
      } else {
        clickAt(graph, x1, y1);
        recordAction("automationGraphClick", `${Math.round(x1)},${Math.round(y1)}`);
      }
    };
    const timelineSurfaceSpecies = () => () => {
      const surface = document.querySelector<HTMLElement>('[data-testid="timeline-panel"]');
      if (!canTarget(surface)) return;
      const rect = surface.getBoundingClientRect();
      const x = rect.left + rect.width * randomizer.floating({ min: 0.02, max: 0.98 });
      const y = rect.top + rect.height * randomizer.floating({ min: 0.02, max: 0.98 });
      if (randomizer.bool({ likelihood: 35 })) {
        dragAcross(surface, x, y, x + randomizer.integer({ min: -120, max: 120 }), y);
        recordAction("timelineDrag", `${Math.round(x)},${Math.round(y)}`);
      } else {
        clickAt(surface, x, y);
        recordAction("timelineClick", `${Math.round(x)},${Math.round(y)}`);
      }
    };
    const transportSpecies = () => () => {
      if (config.profile !== "live-transport") return;
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            '[data-testid="transport-play"]',
            '[data-testid="transport-stop"]',
            'button[aria-label*="Rhythm"]',
            'button[aria-label*="Synth"]',
            "button",
          ].join(",")
        )
      ).filter((element) => canTarget(element) && insideTransport(element));
      const control = controls.length ? randomizer.pick(controls) : null;
      if (!control) return;
      control.click();
      recordAction("transportControl", control.textContent?.trim().slice(0, 80) ?? "");
    };
    const driverPressureSpecies = () => () => {
      if (!config.liveCycleChurn) return;
      const driver = window.__CAESURA_E2E_DRIVER__;
      if (!driver) return;
      if (randomizer.bool({ likelihood: 70 })) {
        liveCycle += randomizer.natural({ min: 1, max: 3 });
        driver.emitLiveCycle?.(liveCycle);
        recordAction("driverLiveCycle", String(liveCycle));
      } else {
        const delay = randomizer.natural({
          min: 0,
          max: config.previewDelayMaxMs,
        });
        driver.setPreviewDelay?.(delay);
        recordAction("driverPreviewDelay", String(delay));
      }
    };
    const auditSnapshot = (label: string): void => {
      const state = window.__CAESURA_E2E_STATE__;
      const driver = window.__CAESURA_E2E_DRIVER__?.getState?.();
      if (!state) {
        audit.errors.push(`${label}: missing E2E state`);
        return;
      }
      if (state.transportIsPlaying && !state.playbackStructureLocked) {
        audit.errors.push(`${label}: playback running without structure lock`);
      }
      audit.snapshots.push({
        label,
        playing: Boolean(state.transportIsPlaying),
        locked: Boolean(state.playbackStructureLocked),
        coherent: Boolean(state.timelineLayerSourcesCoherent),
        sectionCount: state.sections?.length ?? 0,
        callCount: driver?.calls?.length ?? 0,
      });
      if (audit.snapshots.length > 50) audit.snapshots.shift();
    };
    const auditSpecies = () => () => auditSnapshot("species-audit");

    let liveCycle = config.cycleBase;
    const timer =
      config.liveCycleChurn && config.liveCycleMs > 0
        ? window.setInterval(() => {
            liveCycle += 1;
            window.__CAESURA_E2E_DRIVER__?.emitLiveCycle?.(liveCycle);
            auditSnapshot(`live-cycle-${liveCycle}`);
          }, config.liveCycleMs)
        : null;

    try {
      auditSnapshot("before-horde");
      const horde = gremlins.createHorde({
        window,
        logger,
        randomizer,
        species: [
          gremlins.species.clicker({
            clickTypes: [
              "click",
              "click",
              "click",
              "dblclick",
              "mousedown",
              "mouseup",
              "mouseover",
              "mousemove",
              "mouseout",
            ],
            canClick: canTarget,
            showAction: () => {},
            log: true,
          }),
          gremlins.species.formFiller({
            canFillElement,
            showAction: () => {},
            log: true,
          }),
          gremlins.species.scroller({
            showAction: () => {},
            log: true,
          }),
          gremlins.species.typer({
            targetElement: (x: number, y: number) => {
              const target = document.elementFromPoint(x, y);
              return canTarget(target) ? target : document.body;
            },
            keyGenerator: () => {
              const keys = [9, 13, 27, 32, 37, 38, 39, 40, 48, 49, 50, 55, 56, 57];
              return randomizer.pick(keys) ?? 13;
            },
            showAction: () => {},
            log: true,
          }),
          appControlSpecies,
          numberEdgeSpecies,
          textEdgeSpecies,
          selectSpecies,
          boundaryRailSpecies,
          automationGraphSpecies,
          timelineSurfaceSpecies,
          transportSpecies,
          driverPressureSpecies,
          auditSpecies,
        ],
        mogwais: [
          gremlins.mogwais.alert({
            confirmResponse: () => true,
            promptResponse: () => "",
          }),
        ],
        strategies: [
          gremlins.strategies.distribution({
            distribution: [
              0.12, 0.12, 0.04, 0.07, 0.13, 0.14, 0.05, 0.05, 0.09, 0.07,
              0.08, 0.05, 0.05, 0.04,
            ],
            delay: config.delayMs,
            nb: config.actions,
          }),
        ],
      });
      await horde.unleash();
      auditSnapshot("after-horde");
    } finally {
      if (timer !== null) window.clearInterval(timer);
    }

    return {
      log: log.slice(-200),
      audit,
    };
  }, options);
}

async function assertChaosInvariants(
  page: Page,
  runtimeErrors: string[],
  phaseResult: GremlinsSegmentResult,
  requirePlaying: boolean
): Promise<void> {
  await waitForChaosTimelineReady(page);
  expect(runtimeErrors).toEqual([]);
  expect(phaseResult.audit.errors).toEqual([]);
  expect(phaseResult.log.filter((entry) => entry.level === "error")).toEqual([]);

  const state = await getE2eState(page);
  const driver = await getDriverState(page);
  expect(state.switchRequest.ok).toBe(true);
  expect(state.preview).not.toBeNull();
  expect(state.sections.length).toBeGreaterThan(0);
  expect(state.timelinePreviewReady).toBe(true);
  expect(state.timelineRhythmReady).toBe(true);
  expect(state.timelineLayerSourcesCoherent).toBe(true);
  expect(validatePreviewRequest(driver.lastPreviewRequest?.request)).toEqual([]);
  scanFiniteNumbers(state, "state", runtimeErrors);
  scanFiniteNumbers(driver.lastPreview, "lastPreview", runtimeErrors);
  expect(runtimeErrors).toEqual([]);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.locator(".preview-banner")).toHaveCount(0);
  await expect(page.getByTestId("gati-matra-cell")).toHaveCount(
    expectedMatraCellCount(state)
  );

  if (requirePlaying) {
    expect(state.transportIsPlaying).toBe(true);
  }
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
}

async function attachChaosArtifacts(
  testInfo: TestInfo,
  seed: number,
  totalActions: number,
  phaseRecords: PhaseRecord[],
  runtimeErrors: string[],
  page: Page
): Promise<void> {
  const state = await getE2eState(page).catch((error) => ({ error: String(error) }));
  const driver = await getDriverState(page).catch((error) => ({
    error: String(error),
  }));
  await testInfo.attach("gremlins-chaos-repro.json", {
    body: JSON.stringify(
      {
        seed,
        totalActions,
        runtimeErrors,
        phases: phaseRecords,
        state,
        driver,
      },
      null,
      2
    ),
    contentType: "application/json",
  });
}

const totalActions = parsePositiveInteger(
  process.env.CAESURA_GREMLINS_ACTIONS,
  DEFAULT_GREMLINS_ACTIONS
);
const segmentActions = parsePositiveInteger(
  process.env.CAESURA_GREMLINS_SEGMENT_ACTIONS,
  DEFAULT_GREMLINS_SEGMENT_ACTIONS
);
const delayMs = parsePositiveInteger(
  process.env.CAESURA_GREMLINS_DELAY_MS,
  DEFAULT_GREMLINS_DELAY_MS
);
const liveCycleMs = parsePositiveInteger(
  process.env.CAESURA_GREMLINS_LIVE_CYCLE_MS,
  DEFAULT_GREMLINS_LIVE_CYCLE_MS
);
const previewDelayMaxMs = parsePositiveInteger(
  process.env.CAESURA_GREMLINS_PREVIEW_DELAY_MAX_MS,
  DEFAULT_GREMLINS_PREVIEW_DELAY_MAX_MS
);
const seeds = parseSeeds();

test.describe("gremlins.js chaos UI fuzzer", () => {
  test.describe.configure({ mode: "serial" });

  for (const seed of seeds) {
    test(`seed ${seed} stresses editor and playback with ${totalActions} browser actions`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(
        parsePositiveInteger(
          process.env.CAESURA_GREMLINS_TIMEOUT_MS,
          Math.max(1_800_000, totalActions * Math.max(60, delayMs + 40))
        )
      );

      const runtimeErrors: string[] = [];
      const phaseRecords: PhaseRecord[] = [];
      page.on("pageerror", (error) => {
        runtimeErrors.push(`pageerror: ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeErrors.push(`console.error: ${message.text()}`);
        }
      });

      await installGremlins(page);
      await openCaesura(page);
      await page.waitForFunction(() => Boolean(window.gremlins?.createHorde));
      await configureHighRiskState(page);

      try {
        for (const [phaseIndex, phase] of phases.entries()) {
          await closeFloatingSurfaces(page);
          if (phase.openAutomationDialog) {
            await openAutomationDialog(page);
          }
          if (phase.requirePlaying || phase.restartPlaybackBetweenSegments) {
            await ensurePlaying(page);
          } else {
            await ensureIdle(page);
          }

          const budget = phaseBudget(totalActions, phase);
          const segments = Math.max(1, Math.ceil(budget / segmentActions));
          for (let segment = 0; segment < segments; segment += 1) {
            if (phase.requirePlaying || phase.restartPlaybackBetweenSegments) {
              await ensurePlaying(page);
            }
            const remaining = budget - segment * segmentActions;
            const actions = Math.min(segmentActions, remaining);
            const before = await summarizeState(page);
            const phaseResult = await runGremlinsSegment(page, {
              seed: seed + phaseIndex * 10_000 + segment,
              profile: phase.profile,
              actions,
              delayMs,
              liveCycleMs,
              liveCycleChurn: Boolean(phase.liveCycleChurn),
              cycleBase: phaseIndex * 1_000 + segment * 100,
              previewDelayMaxMs,
            });
            const after = await summarizeState(page);
            phaseRecords.push({
              phase: phase.name,
              profile: phase.profile,
              segment,
              actions,
              before,
              after,
              log: phaseResult.log,
              audit: phaseResult.audit,
            });
            await assertChaosInvariants(
              page,
              runtimeErrors,
              phaseResult,
              Boolean(phase.requirePlaying)
            );
          }
          await closeFloatingSurfaces(page);
        }

        await ensureIdle(page);
      } catch (error) {
        await attachChaosArtifacts(
          testInfo,
          seed,
          totalActions,
          phaseRecords,
          runtimeErrors,
          page
        );
        throw error;
      }
    });
  }
});
