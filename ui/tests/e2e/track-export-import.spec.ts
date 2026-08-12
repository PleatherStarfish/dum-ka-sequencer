import { expect, test } from "@playwright/test";

import {
  getDriverState,
  openCaesura,
  waitForTimelineReady,
} from "./support/appHarness";

test("exports the active track and imports it as a fresh saved-timing track", async ({
  page,
}) => {
  const trackPath = "/tmp/caesura-e2e-active.dumka-track";
  const deleteSavePath = "/tmp/caesura-e2e-before-delete.dumka-track";

  await openCaesura(page, {
    saveDialogResponses: [trackPath, deleteSavePath],
    openDialogResponses: [trackPath],
    askDialogResponses: [true],
  });

  await expect(page.locator(".parallel-track-cell")).toHaveCount(1);
  await page.locator(".parallel-track-export").first().click();
  await page.waitForFunction(
    (path) => Boolean(window.__CAESURA_E2E_DRIVER__?.getState()?.patchFiles[path]),
    trackPath
  );
  await expect(page.locator(".success-banner")).toContainText("Exported track");

  const savedState = await getDriverState(page);
  const savedEnvelope = savedState.patchFiles[trackPath] as
    | Record<string, unknown>
    | undefined;
  expect(savedEnvelope).toMatchObject({
    app: "Dum-Ka",
    kind: "track",
    schemaVersion: 1,
  });

  await page.getByRole("button", { name: "Import track from a file" }).click();
  await waitForTimelineReady(page);

  await expect(page.locator(".success-banner")).toContainText("Imported track");
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Track 2/ })).toBeVisible();
  await expect(page.locator(".parallel-track-tab-meta em").last()).toContainText(
    "Track 1 (2)"
  );
  await expect(page.getByLabel("Track BPM mode")).toHaveValue("custom");
  await expect(page.getByLabel("Track cycle mode")).toHaveValue("custom");
  await expect(page.getByLabel("Track custom BPM")).toHaveValue(/^80(?:\.0)?$/);
  await expect(page.getByLabel("Track custom cycle")).toHaveValue("4");

  const importedState = await getDriverState(page);
  expect(
    importedState.calls.filter((call) => call.command === "track_save_to_path")
  ).toHaveLength(1);
  expect(
    importedState.calls.filter((call) => call.command === "track_load_from_path")
  ).toHaveLength(1);
  expect(importedState.dialogHistory.map((entry) => entry.kind)).toEqual([
    "save",
    "open",
    "ask",
  ]);

  await page
    .locator(".parallel-track-cell")
    .first()
    .getByRole("button", { name: /Delete/ })
    .click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Track 1" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText(
    "Are you sure you want to delete this track?"
  );
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);

  await deleteDialog.getByRole("button", { name: "Save track" }).click();
  await page.waitForFunction(
    (path) => Boolean(window.__CAESURA_E2E_DRIVER__?.getState()?.patchFiles[path]),
    deleteSavePath
  );
  await expect(deleteDialog).toBeVisible();

  await deleteDialog.getByRole("button", { name: "Delete track" }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Track 1/ })).toBeVisible();

  const deletedState = await getDriverState(page);
  expect(Boolean(deletedState.patchFiles[deleteSavePath])).toBe(true);
  expect(deletedState.dialogHistory.map((entry) => entry.kind)).toEqual([
    "save",
    "open",
    "ask",
    "save",
  ]);
});

test("imports a track into an already applied multi-track project", async ({
  page,
}) => {
  const trackPath = "/tmp/caesura-e2e-applied-project.dumka-track";
  await openCaesura(page, {
    saveDialogResponses: [trackPath],
    openDialogResponses: [trackPath],
    askDialogResponses: [false],
  });

  await page
    .locator(".parallel-track-actions")
    .getByRole("button", { name: "New track", exact: true })
    .click();
  await expect(page.locator(".success-banner")).toContainText("Added track");
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);

  await page.locator(".parallel-track-export").first().click();
  await expect(page.locator(".success-banner")).toContainText("Exported track");
  await page.getByRole("button", { name: "Import track from a file" }).click();

  await expect(page.locator(".success-banner")).toContainText("Imported track");
  await expect(page.locator(".parallel-track-cell")).toHaveCount(3);
  const driver = await getDriverState(page);
  expect(
    driver.calls.filter((call) => call.command === "track_load_from_path")
  ).toHaveLength(1);
  expect(driver.dialogHistory.map((entry) => entry.kind)).toEqual([
    "save",
    "open",
    "ask",
  ]);
});
