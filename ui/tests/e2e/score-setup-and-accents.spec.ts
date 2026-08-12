import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  fillNumeric,
  getDriverState,
  closeMainEditor,
  openCaesura,
  openMainEditor,
  waitForTimelineReady,
} from "./support/appHarness";

type PreviewRequest = {
  name?: string;
  cycleBeats?: number;
  pitch?: number;
  velocity?: number;
  initialWeights?: Array<{ subdivision: number; weight: number }>;
  initialJathiWeights?: Array<{ jathi: number; weight: number }>;
  inflections?: Array<{
    position: number;
    changeProbability: number;
  }>;
  singleParameterRhythmicModulation?: boolean;
  accent?: {
    beatStart: { min: number; max: number };
    sectionStartExtra: { min: number; max: number };
    jathiStart: { min: number; max: number };
    jathiMode: "overrideGati" | "layered";
  };
};

function numberInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('[role="spinbutton"]')
    .first();
}

function textInputByLabel(scope: Locator, label: string): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .locator('input[type="text"]')
    .first();
}

async function waitForRequestValue(
  page: Page,
  path: string[],
  expected: unknown
): Promise<void> {
  await page.waitForFunction(
    ({ propertyPath, expectedJson }) => {
      let value: unknown =
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request;
      for (const segment of propertyPath) {
        value =
          value && typeof value === "object"
            ? (value as Record<string, unknown>)[segment]
            : undefined;
      }
      return JSON.stringify(value) === expectedJson;
    },
    { propertyPath: path, expectedJson: JSON.stringify(expected) }
  );
}

async function waitForPreviewBeatCount(
  page: Page,
  beatCount: number
): Promise<void> {
  await page.waitForFunction(
    (expectedBeatCount) =>
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreview?.beats?.length ===
      expectedBeatCount,
    beatCount
  );
}

test.describe("cycle setup and accents", () => {
  test("edits score identity, cycle length, pitch, and velocity into preview and playback", async ({
    page,
  }) => {
    await openCaesura(page);

    const setup = await openMainEditor(page, "boundaries");
    const coreGridBox = await setup.locator(".cycle-core-grid").boundingBox();
    expect(coreGridBox?.height ?? 999).toBeLessThanOrEqual(72);
    for (const label of ["Beats/cycle", "Pitch", "Velocity"]) {
      const fieldBox = await numberInputByLabel(setup, label)
        .locator('xpath=ancestor::*[contains(@class, "numeric-field")][1]')
        .boundingBox();
      expect(fieldBox?.height ?? 999).toBeLessThanOrEqual(32);
    }

    await textInputByLabel(setup, "Cycle name").fill("cycle setup e2e");
    await fillNumeric(numberInputByLabel(setup, "Beats/cycle"), "5");
    await fillNumeric(numberInputByLabel(setup, "Pitch"), "72");
    await fillNumeric(numberInputByLabel(setup, "Velocity"), "88");

    await waitForRequestValue(page, ["name"], "cycle setup e2e");
    await waitForRequestValue(page, ["cycleBeats"], 5);
    await waitForRequestValue(page, ["pitch"], 72);
    await waitForRequestValue(page, ["velocity"], 88);
    await waitForPreviewBeatCount(page, 5);
    await waitForTimelineReady(page);

    let driver = await getDriverState(page);
    let request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.inflections?.map((item) => item.position)).toEqual([]);
    expect(driver.lastPreview?.beats).toHaveLength(5);
    expect(driver.lastPreview?.beats.every((beat) => beat.pitch === 72)).toBe(true);
    expect(driver.lastPreview?.beats.every((beat) => beat.baseVelocity === 88)).toBe(
      true
    );
    expect(driver.lastPreview?.beats[0]?.accentVelocity).toBe(100);

    await closeMainEditor(page);
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForFunction(
      () =>
        window.__CAESURA_E2E_DRIVER__?.getState()?.lastScoreCreateRequest
          ?.name === "cycle setup e2e"
    );

    driver = await getDriverState(page);
    const created = driver.lastScoreCreateRequest as PreviewRequest;
    expect(created).toMatchObject({
      name: "cycle setup e2e",
      cycleBeats: 5,
      pitch: 72,
      velocity: 88,
    });
    expect(created.inflections?.map((item) => item.position)).toEqual([]);
  });

  test("clamps invalid pitch and velocity before preview requests", async ({
    page,
  }) => {
    await openCaesura(page);

    const setup = await openMainEditor(page, "boundaries");

    await fillNumeric(numberInputByLabel(setup, "Pitch"), "200");
    await fillNumeric(numberInputByLabel(setup, "Velocity"), "0");

    await waitForRequestValue(page, ["pitch"], 127);
    await waitForRequestValue(page, ["velocity"], 1);
    await waitForTimelineReady(page);

    const driver = await getDriverState(page);
    const request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.pitch).toBe(127);
    expect(request.velocity).toBe(1);
    await expect(numberInputByLabel(setup, "Pitch")).toHaveValue("127");
    await expect(numberInputByLabel(setup, "Velocity")).toHaveValue("1");
    expect(driver.lastPreview?.beats.every((beat) => beat.pitch === 127)).toBe(true);
    expect(driver.lastPreview?.beats.every((beat) => beat.baseVelocity === 1)).toBe(
      true
    );
  });

  test("edits accent ranges and grouping mode", async ({
    page,
  }) => {
    await openCaesura(page);

    const sections = await openMainEditor(page, "boundaries");
    const accents = sections.getByLabel("Section accents");
    const accentBarBox = await accents.boundingBox();
    expect(accentBarBox?.height ?? 999).toBeLessThanOrEqual(96);

    await fillNumeric(
      accents.locator('input[aria-label="Section random margin"]'),
      "5"
    );
    await fillNumeric(
      accents.locator('input[aria-label="Subdivision random margin"]'),
      "7"
    );
    await fillNumeric(
      accents.locator('input[aria-label="Grouping random margin"]'),
      "9"
    );
    await accents.getByLabel("Grouping mode").selectOption("layered");

    await expect(
      accents.locator('input[aria-label="Section random margin"]')
    ).toHaveValue("5");
    await expect(
      accents.locator('input[aria-label="Subdivision random margin"]')
    ).toHaveValue("7");
    const jathiMarginInput = accents.locator(
      'input[aria-label="Grouping random margin"]'
    );
    await expect(jathiMarginInput).toHaveValue("9");
    const jathiMarginBox = await jathiMarginInput
      .locator('xpath=ancestor::*[contains(@class, "numeric-field")][1]')
      .boundingBox();
    expect(jathiMarginBox?.width ?? 0).toBeGreaterThanOrEqual(58);

    await waitForRequestValue(page, ["accent", "sectionStartExtra"], {
      min: 0,
      max: 10,
    });
    await waitForRequestValue(page, ["accent", "beatStart"], {
      min: 0,
      max: 14,
    });
    await waitForRequestValue(page, ["accent", "jathiStart"], {
      min: 0,
      max: 18,
    });
    await waitForRequestValue(page, ["accent", "jathiMode"], "layered");
    const driver = await getDriverState(page);
    const request = driver.lastPreviewRequest?.request as PreviewRequest;
    expect(request.accent).toEqual({
      beatStart: { min: 0, max: 14 },
      sectionStartExtra: { min: 0, max: 10 },
      jathiStart: { min: 0, max: 18 },
      jathiMode: "layered",
    });
    await expect(sections.locator(".editor-panel-summary")).toContainText(
      "grouping layered"
    );
  });
});
