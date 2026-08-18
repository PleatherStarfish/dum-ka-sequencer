import { expect, test } from "@playwright/test";

import {
  closeMainEditor,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

/**
 * Regression guards for the Evolve editor repaint loop ("the evolve UI
 * constantly twitches and reloads"). Two properties are pinned:
 *
 * 1. Editing a property curve must not blank the cached preview strip. A
 *    curve edit rotates the generator preview request key; the cached cells
 *    must keep their last values (dimmed as stale) while the refetch
 *    replaces them, instead of flashing to "not cached" and crawling back.
 * 2. An idle open editor performs no DOM mutations at all.
 */

async function setUpDumkaEvolve(page: import("@playwright/test").Page) {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  const generator = await openMainEditor(page, "generator");
  await generator.getByLabel("Generator kind").selectOption("dumka");
  await closeMainEditor(page);
  await openMainEditor(page, "evolve");
}

test("drawing a property point keeps cached pacing cells rendered (stale, not blanked)", async ({
  page,
}) => {
  await setUpDumkaEvolve(page);

  // Wait until the preview fill effect has cached cycle 2's step size.
  await expect(
    page.locator(
      '[aria-label^="Cycle 2 step size"]:not([aria-label*="not cached"])'
    )
  ).toBeVisible();

  // Record every transient blank: if any previously cached pacing cell's
  // label ever flips to "not cached" after the edit, the observer logs it —
  // catching even a single-frame flash that a retrying assertion would miss
  // once the refetch restores the value.
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __evolveBlankLog: string[] }).__evolveBlankLog =
      log;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        const label = target.getAttribute?.("aria-label") ?? "";
        if (/^Cycle \d+ step size not cached/.test(label)) log.push(label);
      }
    });
    observer.observe(document.querySelector("#evolve-plan-editor")!, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
  });

  // Draw a density point at cycle 6 with a real click.
  await page.getByRole("group", { name: /^Cycle 6 density/ }).click();

  // The edit reached the app: the drawn density point exists as a handle.
  await expect(
    page.getByRole("button", { name: "Move or remove density point at cycle 6" })
  ).toBeVisible();

  // The cached cells stay rendered, now marked stale while the refetch runs.
  // (The mock driver cannot resolve steered evolving cycles — "use the
  // real-backend lane" — so here the strip legitimately REMAINS stale; the
  // real-backend spec covers convergence back to fresh values.)
  await expect
    .poll(async () =>
      page
        .locator(
          ".evolve-plan-step-cell.is-stale, .evolve-plan-property-cell.is-stale"
        )
        .count()
    )
    .toBeGreaterThan(0);

  // No cached cell ever flashed to "not cached", even transiently.
  const blankLog = await page.evaluate(
    () =>
      (window as unknown as { __evolveBlankLog: string[] }).__evolveBlankLog
  );
  expect(blankLog).toEqual([]);
});

test("an idle open evolve editor performs zero DOM mutations", async ({
  page,
}) => {
  await setUpDumkaEvolve(page);
  await page.waitForTimeout(1200); // let preview caching settle

  const idle = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const root = document.querySelector("#evolve-plan-editor");
        if (!root) {
          resolve(-1);
          return;
        }
        let mutations = 0;
        const observer = new MutationObserver((records) => {
          mutations += records.length;
        });
        observer.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(mutations);
        }, 1500);
      })
  );
  expect(idle).toBe(0);
});
