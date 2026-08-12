import { expect, test } from "@playwright/test";

import {
  closeMainEditor,
  getDriverState,
  getE2eState,
  openCaesura,
  openMainEditor,
  waitForPlaying,
} from "./support/appHarness";

/**
 * The visual rhythm builder is a front-end over the pattern text: every
 * block edit must commit through the same path as typing, resolve through
 * the same mock preview table (patterns pinned in mockTauri.ts), and play
 * exactly the previewed request. This proves the GUI cannot open a second
 * authoring path around the one generator seam.
 */
test("builds a tuplet visually and plays exactly the previewed request", async ({
  page,
}) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });

  await page.getByRole("button", { name: "Generator" }).click();
  await page.getByLabel("Generator kind").selectOption("dumka");
  const field = page.getByLabel("Dum-Ka pattern");
  await field.fill("x . x .");
  await field.blur();
  await expect(page.getByLabel("Required structure")).toHaveText(
    "needs 4 beats · Subdivision 1"
  );

  // Rest → note through the toolbar; the textarea mirrors the commit.
  await page.getByRole("button", { name: "block 1: rest" }).click();
  await page.getByRole("button", { name: "Set element to note" }).click();
  await expect(field).toHaveValue("x x x .");

  // Split the first beat into a quintuplet; structure follows.
  await page.getByRole("button", { name: "block 0: note x" }).click();
  const splitCount = page.getByLabel("Split count");
  await splitCount.fill("5");
  await splitCount.blur();
  await page.getByRole("button", { name: "Split into tuplet" }).click();
  await expect(field).toHaveValue("[x x x x x] x x .");
  await expect(page.getByLabel("Required structure")).toHaveText(
    "needs 4 beats · Subdivision 5"
  );
  await expect(
    page.getByRole("button", { name: "group 0: 5 in the time of 1" })
  ).toHaveText("5:1");
  await expect(page.locator(".dumka-preview-error")).toHaveCount(0);

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
      return generator?.kind === "dumka" &&
        generator.pattern === "[x x x x x] x x .";
    })
    .toBe(true);

  await expect(page.getByTestId("transport-play")).toBeEnabled();
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const driver = await getDriverState(page);
  expect(driver.lastGeneratorPreviewRequest?.generator).toEqual(
    driver.lastTrackPlaybackRequest?.generator
  );
});

test("Span covers existing Pattern beats without extending the cycle", async ({
  page,
}) => {
  const counted =
    "[dum . . ka] [. . ka . x] [dum . ka .] [x x . x]";
  const spanningTwo = "[dum . . ka] [. . ka . x]@2 [x x . x]";
  const spanningThree = "[dum . . ka] [. . ka . x]@3";

  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  const generator = await openMainEditor(page, "generator");
  await generator.getByLabel("Generator kind").selectOption("dumka");
  const field = generator.getByLabel("Dum-Ka pattern");

  await generator
    .getByRole("button", { name: "group 5: 4 in the time of 1" })
    .click();
  const count = generator.getByLabel("Group count");
  await count.fill("5");
  await count.blur();
  await expect(field).toHaveValue(counted);

  const span = generator.getByLabel("Group span in existing beats");
  await span.fill("2");
  await span.blur();
  await expect(field).toHaveValue(spanningTwo);
  await expect(generator.locator(".rb-ruler > span")).toHaveCount(4);
  await expect(generator.getByLabel("Required structure")).toHaveText(
    "needs 4 beats · Subdivision 20"
  );
  await expect(
    generator.getByRole("button", { name: "group 5: 5 in the time of 2" })
  ).toHaveText("5:2");

  await span.fill("3");
  await span.blur();
  await expect(field).toHaveValue(spanningThree);
  await expect(generator.locator(".rb-ruler > span")).toHaveCount(4);
  await expect(generator.getByLabel("Required structure")).toHaveText(
    "needs 4 beats · Subdivision 20"
  );
  await expect(
    generator.getByRole("button", { name: "group 5: 5 in the time of 3" })
  ).toHaveText("5:3");

  await generator.getByRole("button", { name: "Apply structure" }).click();
  await expect(
    generator.getByRole("button", { name: "Structure ready" })
  ).toBeDisabled();
  await closeMainEditor(page, "generator");
  await expect(page.getByTestId("transport-play")).toBeEnabled();
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const driver = await getDriverState(page);
  expect(driver.lastGeneratorPreviewRequest?.cycleBeats).toBe(4);
  expect(driver.lastGeneratorPreviewRequest?.generator).toEqual(
    driver.lastTrackPlaybackRequest?.generator
  );
});

test("plays a nested beat-2 5:2 group as a tied span without articulation", async ({
  page,
}) => {
  const plain = "x [[x x x x x]@2]@2 x";

  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  await page.getByRole("button", { name: "Generator" }).click();
  await page.getByLabel("Generator kind").selectOption("dumka");
  const field = page.getByLabel("Dum-Ka pattern");
  await field.fill("x x x x");
  await field.blur();

  await page.getByRole("button", { name: "block 1: note x" }).click();
  await page
    .getByRole("button", { name: "block 2: note x" })
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Group selection" }).click();
  await expect(field).toHaveValue("x [x x]@2 x");

  // Wrap the group once more, then edit the inner ratio. This pins the nested
  // selection geometry for the optional Articulate styling gesture.
  await page.getByRole("button", { name: "Group selection" }).click();
  await expect(field).toHaveValue("x [[x x]@2]@2 x");
  await page
    .getByRole("button", { name: "group 2: 2 in the time of 2" })
    .click();

  const count = page.getByLabel("Group count");
  await count.fill("5");
  await count.blur();
  await expect(field).toHaveValue(plain);
  await expect(page.getByLabel("Required structure")).toHaveText(
    "needs 4 beats · Subdivision 5"
  );

  await page.getByRole("button", { name: "Apply structure" }).click();
  await expect(
    page.getByRole("button", { name: "Structure ready" })
  ).toBeDisabled();
  await expect(page.locator(".dumka-preview-error")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Articulate crossing notes" })
  ).toHaveCount(0);
  await expect(field).toHaveValue(plain);
  await page.locator("#generator-editor summary").click();

  await expect
    .poll(async () => {
      const driver = await getDriverState(page);
      const generator = driver.lastGeneratorPreviewRequest?.generator as
        | { kind?: string; pattern?: string }
        | undefined;
      return generator?.kind === "dumka" && generator.pattern === plain;
    })
    .toBe(true);

  await expect(page.getByTestId("transport-play")).toBeEnabled();
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const driver = await getDriverState(page);
  const state = await getE2eState(page);
  expect(driver.lastGeneratorPreviewRequest?.generator).toEqual(
    driver.lastTrackPlaybackRequest?.generator
  );
  expect(driver.lastGeneratorPreviewRequest?.enabled).toBe(
    driver.lastTrackPlaybackRequest?.generatorEnabled
  );
  expect(driver.lastGeneratorPreviewRequest?.automation).toEqual(
    driver.lastTrackPlaybackRequest?.automation
  );
  expect(state.timelineLayerSourcesCoherent).toBe(true);
});

test("plays a sustain through an actual Grouping fence", async ({ page }) => {
  const plain = "[[x x x x x]@2 .]@2";

  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  const generator = await openMainEditor(page, "generator");
  await generator.getByLabel("Generator kind").selectOption("dumka");
  const field = generator.getByLabel("Dum-Ka pattern");
  await field.fill(plain);
  await field.blur();
  await expect(generator.getByLabel("Required structure")).toHaveText(
    "needs 2 beats · Subdivision 15"
  );
  await generator.getByRole("button", { name: "Apply structure" }).click();
  await expect(
    generator.getByRole("button", { name: "Structure ready" })
  ).toBeDisabled();

  await closeMainEditor(page);
  const sections = await openMainEditor(page, "boundaries");
  const grouping = sections
    .getByLabel("Section 1 inspector")
    .getByLabel("Grouping", { exact: true });
  await expect(grouping.locator('option[value="3"]')).toHaveCount(1);
  await grouping.selectOption("3");
  await page.waitForFunction(
    () =>
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastPreviewRequest?.request
        ?.initialJathiWeights?.[0]?.jathi === 3
  );

  await closeMainEditor(page);
  const reopened = await openMainEditor(page, "generator");
  await expect(reopened.locator(".dumka-preview-error")).toHaveCount(0);
  await expect(reopened.getByLabel("Dum-Ka pattern")).toHaveValue(plain);

  await closeMainEditor(page);
  await expect(page.getByTestId("transport-play")).toBeEnabled();
  const driver = await getDriverState(page);
  expect(
    (driver.lastGeneratorPreviewRequest?.generator as { pattern?: string })
      ?.pattern
  ).toBe(plain);
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);
  const playing = await getDriverState(page);
  expect(
    (playing.lastTrackPlaybackRequest?.generator as { pattern?: string })?.pattern
  ).toBe(plain);
});

test("plays the reported mixed 5:2 tuplet crossing beat 2", async ({
  page,
}) => {
  const plain =
    "[dum . . ka] [. . ka . x]@2 [dum . ka .] [x x . x]";

  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  const generator = await openMainEditor(page, "generator");
  await generator.getByLabel("Generator kind").selectOption("dumka");
  const field = generator.getByLabel("Dum-Ka pattern");
  await field.fill(plain);
  await field.blur();
  await expect(generator.getByLabel("Required structure")).toHaveText(
    "needs 5 beats · Subdivision 20"
  );
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
  await expect(page.getByTestId("transport-play")).toBeEnabled();
  const driver = await getDriverState(page);
  expect(
    (driver.lastGeneratorPreviewRequest?.generator as { pattern?: string })
      ?.pattern
  ).toBe(plain);
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);
  const playing = await getDriverState(page);
  expect(
    (playing.lastTrackPlaybackRequest?.generator as { pattern?: string })?.pattern
  ).toBe(plain);
});
