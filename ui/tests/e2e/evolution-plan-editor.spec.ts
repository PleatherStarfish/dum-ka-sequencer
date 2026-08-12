import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  closeMainEditor,
  fillNumeric,
  getDriverState,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

interface PersistedDirective {
  id: number;
  order: number;
  enabled: boolean;
  fromCycle: number;
  toCycle: number;
  family: string;
  pacing: "perCycle" | "linear" | "easeInOut";
  intensity: number;
  scope: { startBeat: number; lenBeats: number } | null;
  options: Record<string, unknown>;
}

interface PersistedGenerator {
  kind?: string;
  plan?: PersistedDirective[];
  planLengthCycles?: number;
}

interface PersistedPatch {
  generator?: PersistedGenerator;
  project?: {
    tracks?: Array<{ generator?: PersistedGenerator }>;
  };
}

function commandCount(
  driver: Awaited<ReturnType<typeof getDriverState>>,
  command: string
): number {
  return driver.calls.filter((call) => call.command === command).length;
}

function generatorPreviewCountAtCycle(
  driver: Awaited<ReturnType<typeof getDriverState>>,
  cycle: number
): number {
  return driver.calls.filter((call) => {
    if (call.command !== "generator_preview") return false;
    const args = call.args as { request?: { cycle?: number } };
    return args.request?.cycle === cycle;
  }).length;
}

async function addPinWithKeyboard(
  editor: Locator,
  familyLabel: string
): Promise<void> {
  const add = editor.getByRole("button", {
    name: `Add ${familyLabel} pin`,
  });
  await add.focus();
  await add.press("Enter");
}

async function returnStoppedPreviewToSeed(page: Page): Promise<void> {
  const selector = page.getByLabel("Stopped cycle selector");
  const previous = selector.getByRole("button", {
    name: "Inspect previous stopped cycle",
  });
  while (await previous.isEnabled()) {
    await previous.click();
  }
  await expect(selector.locator("output")).toHaveText("0");
}

test("authors, saves, and recalls a Dum-Ka evolution score", async ({
  page,
}) => {
  const patchPath = "/tmp/dumka-e2e/evolution-plan-editor.dumka";

  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
    saveDialogResponses: [patchPath],
    openDialogResponses: [patchPath],
  });

  const generator = await openMainEditor(page, "generator");
  await generator.getByLabel("Generator kind").selectOption("dumka");
  await closeMainEditor(page);

  let editor = await openMainEditor(page, "evolve");
  // Let the initially visible composition cache settle, then prove that the
  // editor-only canvas extent neither rebuilds the current musical preview nor
  // stages a new playback configuration. Newly exposed offscreen composition
  // cycles remain free to populate their own cache.
  await page.waitForTimeout(450);
  const beforeViewResize = await getDriverState(page);
  const currentPreviewCount = generatorPreviewCountAtCycle(beforeViewResize, 0);
  const playbackWriteCount = commandCount(
    beforeViewResize,
    "track_set_playback"
  );
  await fillNumeric(editor.getByLabel("Plan view cycles"), 24);
  await page.waitForTimeout(450);
  const afterViewResize = await getDriverState(page);
  expect(generatorPreviewCountAtCycle(afterViewResize, 0)).toBe(
    currentPreviewCount
  );
  expect(commandCount(afterViewResize, "track_set_playback")).toBe(
    playbackWriteCount
  );

  // Two families may intentionally occupy the same cycle: a gently paced
  // Remove transition and a scoped Rotate range layered across cycles 1-4.
  await addPinWithKeyboard(editor, "Remove");
  await expect(
    editor.getByRole("button", { name: "Remove, cycle 1, 25%" })
  ).toBeVisible();
  await editor.getByRole("button", { name: "Smooth across 4 cycles" }).click();
  await expect(editor.getByLabel("Directive transition")).toHaveValue(
    "easeInOut"
  );
  await expect(
    editor.getByRole("button", {
      name: "Remove, cycles 1 through 4, 25%, gentle transition",
    })
  ).toBeVisible();

  await addPinWithKeyboard(editor, "Rotate");
  await fillNumeric(editor.getByLabel("To cycle"), 4);
  await editor.getByRole("button", { name: "Scope beat 2" }).click();
  await editor
    .getByRole("button", { name: "Scope beat 4" })
    .click({ modifiers: ["Shift"] });
  await editor.getByLabel("Rotate direction").selectOption("later");
  await expect(
    editor.getByRole("button", {
      name: "Rotate, cycles 1 through 4, 25%, repeat each cycle",
    })
  ).toBeVisible();

  // The next keyboard pin lands at cycle 5. Moving its start into the first
  // Rotate range must be rejected, without disturbing the authored range.
  await addPinWithKeyboard(editor, "Rotate");
  await fillNumeric(editor.getByLabel("From cycle"), 3);
  await expect(editor.getByRole("alert")).toContainText("dumka plan overlap");
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(
    editor.getByRole("button", {
      name: "Rotate, cycles 1 through 4, 25%, repeat each cycle",
    })
  ).toHaveCount(1);

  await closeMainEditor(page);
  await returnStoppedPreviewToSeed(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () => (await getDriverState(page)).lastPatchSave?.path)
    .toBe(patchPath);
  await expect(page.locator(".success-banner")).toContainText("Saved patch");

  const driver = await getDriverState(page);
  const saved = driver.lastPatchSave?.patch as PersistedPatch;
  const expectedPlan = [
    expect.objectContaining({
      id: 1,
      order: 0,
      enabled: true,
      fromCycle: 1,
      toCycle: 4,
      family: "barlowRemove",
      pacing: "easeInOut",
      intensity: 25,
      scope: null,
    }),
    expect.objectContaining({
      id: 2,
      order: 1,
      enabled: true,
      fromCycle: 1,
      toCycle: 4,
      family: "rotate",
      pacing: "perCycle",
      intensity: 25,
      scope: { startBeat: 1, lenBeats: 3 },
      options: expect.objectContaining({ rotateDirection: "later" }),
    }),
  ];
  expect(saved.generator).toMatchObject({
    kind: "dumka",
    planLengthCycles: 24,
    plan: expectedPlan,
  });
  expect(saved.project?.tracks?.[0]?.generator).toMatchObject({
    kind: "dumka",
    planLengthCycles: 24,
    plan: expectedPlan,
  });

  // Prove Recall reconstructs the score rather than leaving the live draft in
  // place: remove the pin and change the canvas before loading the saved patch.
  editor = await openMainEditor(page, "evolve");
  const removePin = editor.getByRole("button", {
    name: "Remove, cycles 1 through 4, 25%, gentle transition",
  });
  await removePin.focus();
  await removePin.press("Enter");
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await fillNumeric(editor.getByLabel("Plan view cycles"), 18);
  await closeMainEditor(page);

  await page.getByRole("button", { name: "Recall" }).click();
  await expect
    .poll(async () => (await getDriverState(page)).lastPatchLoadPath)
    .toBe(patchPath);
  await expect(page.locator(".success-banner")).toContainText("Recalled patch");

  editor = await openMainEditor(page, "evolve");
  await expect(editor.getByLabel("Plan view cycles")).toHaveValue("24");
  await expect(
    editor.getByRole("button", {
      name: "Remove, cycles 1 through 4, 25%, gentle transition",
    })
  ).toBeVisible();
  const rotateRange = editor.getByRole("button", {
    name: "Rotate, cycles 1 through 4, 25%, repeat each cycle",
  });
  await rotateRange.focus();
  await rotateRange.press("Enter");
  await expect(editor.getByLabel("From cycle")).toHaveValue("1");
  await expect(editor.getByLabel("To cycle")).toHaveValue("4");
  await expect(editor.getByRole("button", { name: "Scope beat 2" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(editor.getByRole("button", { name: "Scope beat 4" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(editor.getByLabel("Rotate direction")).toHaveValue("later");
});
