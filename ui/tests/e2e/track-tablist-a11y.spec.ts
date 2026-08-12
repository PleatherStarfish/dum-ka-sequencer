import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { openCaesura } from "./support/appHarness";

/**
 * Regression guard for a pre-existing axe `aria-required-children` violation.
 *
 * The parallel-track strip used `role="tablist"` while each track cell also
 * held Mute/Solo/Export/Delete buttons. A `tablist` may only own `tab`
 * elements, so axe flagged those buttons as critical "children which are not
 * allowed". The strip is now a labeled button group (`role="group"`) with
 * `aria-current` marking the active track, which keeps the click-to-select
 * behavior without the invalid tablist semantics.
 */
test("parallel track strip has no ARIA structure violations", async ({
  page,
}) => {
  await openCaesura(page);
  await page
    .locator(".parallel-track-actions")
    .getByRole("button", { name: "New track", exact: true })
    .click();
  await expect(page.getByTestId("parallel-track-tab-track-2")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include(".parallel-track-tabs")
    .analyze();

  expect(
    results.violations,
    JSON.stringify(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target),
      })),
      null,
      2
    )
  ).toEqual([]);
});
