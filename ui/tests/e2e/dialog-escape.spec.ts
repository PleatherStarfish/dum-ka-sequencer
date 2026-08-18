import { expect, test } from "@playwright/test";

import { emitNativeMenuAction, openCaesura } from "./support/appHarness";

/**
 * The shared utility-dialog contract (UI_CONTROL_REFERENCE "Shared interaction
 * elements"): backdrop, ×, Done/Close, or Escape closes the dialog. Escape was
 * silently dead for every ModalFrame dialog (UC-3 in UI_CONTROL_AUDIT.md), so
 * dialogs stacked invisibly; this pins the fixed behavior end to end.
 */
test("Escape closes utility dialogs, topmost first", async ({ page }) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });

  const setupTitle = page.getByText("Audio & MIDI Setup", { exact: false }).first();
  const seedTitle = page.getByText("Seed Strategy", { exact: false }).first();

  // Single dialog: Escape closes it.
  await emitNativeMenuAction(page, "openSetup");
  await expect(setupTitle).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(setupTitle).toBeHidden();

  // Stacked dialogs: Escape unwinds one frame at a time, topmost first.
  await emitNativeMenuAction(page, "openSetup");
  await expect(setupTitle).toBeVisible();
  await emitNativeMenuAction(page, "openSeeds");
  await expect(seedTitle).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(seedTitle).toBeHidden();
  await expect(setupTitle).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(setupTitle).toBeHidden();

  // A numeric field consumes the first Escape to cancel its draft; the dialog
  // stays open, and only the next Escape closes it.
  await emitNativeMenuAction(page, "openSeeds");
  await expect(seedTitle).toBeVisible();
  const seedField = page.getByLabel("Global seed").locator("input").first();
  const fallbackField = page
    .locator(".seed-history-length input")
    .first();
  const field = (await seedField.count()) ? seedField : fallbackField;
  await field.click();
  await field.fill("123456");
  await page.keyboard.press("Escape");
  await expect(seedTitle).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(seedTitle).toBeHidden();
});
