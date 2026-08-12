import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  fillNumeric,
  getDriverState,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

type PreviewRequest = {
  cycleBeats?: number;
  initialWeights?: Array<{ subdivision: number; weight: number }>;
  initialJathiWeights?: Array<{ jathi: number; weight: number }>;
  inflections?: Array<{
    id?: string | null;
    position: number;
    changeProbability: number;
    subdivisionWeights: Array<{ subdivision: number; weight: number }>;
    jathiWeights: Array<{ jathi: number; weight: number }>;
  }>;
};

const BOUNDARY_FIXTURE_PATH = "/tmp/caesura-e2e-boundary-fixture.dumka";

function boundaryFixturePatch() {
  return {
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
      name: "boundary fixture",
      cycleBeats: 8,
      initialWeights: [{ subdivision: 4, weight: 1 }],
      initialJathiWeights: [],
      boundaries: [
        {
          id: "boundary-after-2",
          afterBeat: 2,
          changeProbability: 1,
          weights: [{ subdivision: 3, weight: 1 }],
          jathiWeights: [{ jathi: 4, weight: 1 }],
        },
        {
          id: "boundary-after-6",
          afterBeat: 6,
          changeProbability: 1,
          weights: [{ subdivision: 5, weight: 1 }],
          jathiWeights: [],
        },
      ],
      sectionCountWeights: [{ count: 2, weight: 1 }],
      seedMode: "perCycle",
      seed: 20260516,
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

async function openBoundaryFixture(page: Page): Promise<void> {
  await openCaesura(page, {
    lastPatchPath: BOUNDARY_FIXTURE_PATH,
    setupPreferences: { autosaveEnabled: true, autoloadRecentSession: true },
    patchFiles: {
      [BOUNDARY_FIXTURE_PATH]: boundaryFixturePatch(),
    },
  });
  await page.waitForFunction(
    (path) => {
      const state = window.__CAESURA_E2E_DRIVER__?.getState();
      return (
        state?.lastPatchLoadPath === path &&
        state?.lastPreviewRequest?.request?.cycleBeats === 8
      );
    },
    BOUNDARY_FIXTURE_PATH
  );
}

async function clickBoundaryRail(page: Page, afterBeat: number): Promise<void> {
  const rail = page.getByLabel("Section boundaries");
  const box = await rail.boundingBox();
  if (!box) throw new Error("Boundary rail was not visible");
  const cycleBeats = 8;
  const x = box.x + box.width * (afterBeat / cycleBeats);
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
}

async function waitForInflectionCount(
  page: Page,
  count: number
): Promise<void> {
  await page.waitForFunction(
    (expectedCount) =>
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.inflections?.length === expectedCount,
    count
  );
}

async function waitForInflectionAt(
  page: Page,
  position: number,
  predicate: (inflection: NonNullable<PreviewRequest["inflections"]>[number]) => boolean
): Promise<void> {
  await page.waitForFunction(
    ({ expectedPosition, predicateSource }) => {
      const request = window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest
        ?.request;
      const check = new Function("inflection", `return (${predicateSource})(inflection);`);
      const inflection = request?.inflections?.find(
        (item: { position: number }) =>
          Math.abs(item.position - expectedPosition) < 0.0001
      );
      return Boolean(inflection && check(inflection));
    },
    { expectedPosition: position, predicateSource: predicate.toString() }
  );
}

function numberInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('[role="spinbutton"]')
    .first();
}

test.describe("boundary and fixed-section authoring", () => {
  test("adds and removes a deterministic boundary from the timeline rail", async ({
    page,
  }) => {
    await openBoundaryFixture(page);

    await clickBoundaryRail(page, 4);
    await waitForInflectionCount(page, 3);

    let driver = await getDriverState(page);
    let request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.inflections?.map((item) => item.position)).toEqual([
      0.25,
      0.5,
      0.75,
    ]);
    expect(
      request.inflections?.find((item) => item.position === 0.5)
    ).toMatchObject({
      changeProbability: 1,
      subdivisionWeights: [{ subdivision: 4, weight: 1 }],
      jathiWeights: [],
    });
    await expect(page.getByText("3 section boundaries")).toBeVisible();

    await page
      .getByLabel("Boundary after beat 4 actions")
      .getByRole("button", { name: "del" })
      .click();
    await waitForInflectionCount(page, 2);

    driver = await getDriverState(page);
    request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.inflections?.map((item) => item.position)).toEqual([0.25, 0.75]);
    await expect(page.getByText("2 section boundaries")).toBeVisible();
  });

  test("edits boundary detail position, fixed subdivision, and grouping", async ({
    page,
  }) => {
    await openBoundaryFixture(page);

    await page
      .getByLabel("Boundary after beat 2 actions")
      .getByRole("button", { name: "edit" })
      .click();
    const dialog = page.locator(".boundary-detail-dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Grouping", { exact: true }).selectOption("");
    await waitForInflectionAt(
      page,
      0.25,
      (inflection) => inflection.jathiWeights.length === 0
    );

    await fillNumeric(numberInputByLabel(dialog, "Subdivision"), "7");
    await waitForInflectionAt(page, 0.25, (inflection) => {
      return (
        inflection.subdivisionWeights.length === 1 &&
        inflection.subdivisionWeights[0]?.subdivision === 7 &&
        inflection.subdivisionWeights[0]?.weight === 1
      );
    });

    await dialog.getByLabel("Boundary after beat", { exact: true }).selectOption("5");
    await waitForInflectionAt(
      page,
      0.625,
      (inflection) => inflection.subdivisionWeights[0]?.subdivision === 7
    );

    const driver = await getDriverState(page);
    const request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.inflections?.map((item) => item.position)).toEqual([0.625, 0.75]);
    expect(request.inflections?.find((item) => item.position === 0.625)).toMatchObject({
      changeProbability: 1,
      subdivisionWeights: [{ subdivision: 7, weight: 1 }],
      jathiWeights: [],
    });
  });

  test("adds fixed boundary slots from the section workbench", async ({ page }) => {
    await openCaesura(page);

    const panel = await openMainEditor(page, "boundaries");
    const addBoundary = panel.locator(".section-map-add");
    await expect(addBoundary).toBeEnabled();
    await addBoundary.click();
    await addBoundary.click();
    await page.waitForFunction(() => {
      const request =
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request;
      return (
        Array.isArray(request?.inflections) &&
        request.inflections.length === 2 &&
        request?.cycleBeats === 4
      );
    });

    const driver = await getDriverState(page);
    const request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.inflections?.map((item) => item.position)).toEqual([0.25, 0.5]);
    expect(request.inflections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeProbability: 1,
          subdivisionWeights: [{ subdivision: 4, weight: 1 }],
          jathiWeights: [],
        }),
      ])
    );
    await expect(panel.getByRole("button", { name: /After beat 1/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: /After beat \d/ })).toHaveCount(2);
    await expect(panel.getByLabel("After beat 2 inspector")).toBeVisible();
  });

  test("edits fixed values from the section map inspector", async ({ page }) => {
    await openBoundaryFixture(page);

    const panel = await openMainEditor(page, "boundaries");
    const sectionMap = panel.getByLabel("Section map");
    await sectionMap.getByRole("button", { name: /After beat 2/ }).click();
    const inspector = panel.getByLabel("After beat 2 inspector");
    await expect(inspector).toContainText("After beat 2");

    await fillNumeric(numberInputByLabel(inspector, "Subdivision"), "7");
    await waitForInflectionAt(page, 0.25, (inflection) => {
      return (
        inflection.changeProbability === 1 &&
        inflection.subdivisionWeights.length === 1 &&
        inflection.subdivisionWeights[0]?.subdivision === 7 &&
        inflection.subdivisionWeights[0]?.weight === 1
      );
    });
    await inspector.getByLabel("Grouping", { exact: true }).selectOption("");
    await waitForInflectionAt(
      page,
      0.25,
      (inflection) => inflection.jathiWeights.length === 0
    );
  });

  test("edits the initial fixed values without changing later boundaries", async ({
    page,
  }) => {
    await openBoundaryFixture(page);

    const panel = await openMainEditor(page, "boundaries");
    const sectionMap = panel.getByLabel("Section map");
    await sectionMap.getByRole("button", { name: /Section 1/ }).click();
    const startSection = panel.getByLabel("Section 1 inspector");

    await fillNumeric(numberInputByLabel(startSection, "Subdivision"), "6");
    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
          ?.initialWeights?.length === 1 &&
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
          ?.initialWeights?.[0]?.subdivision === 6
    );

    const grouping = startSection.getByLabel("Grouping", { exact: true });
    await expect(grouping.locator('option[value="4"]')).toHaveCount(1);
    await grouping.selectOption("4");
    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
          ?.initialJathiWeights?.[0]?.jathi === 4
    );

    const driver = await getDriverState(page);
    const request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.initialWeights).toEqual([{ subdivision: 6, weight: 1 }]);
    expect(request.initialJathiWeights).toEqual([{ jathi: 4, weight: 1 }]);
    expect(request.inflections?.[0]?.subdivisionWeights).toEqual([
      { subdivision: 3, weight: 1 },
    ]);
    expect(request.inflections?.[0]?.jathiWeights).toEqual([
      { jathi: 4, weight: 1 },
    ]);
  });
});
