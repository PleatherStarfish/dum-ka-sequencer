import { expect, test } from "@playwright/test";

import {
  closeMainEditor,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

/**
 * Timeline regression guards from the "timeline UI is broken / velocities
 * not showing" report:
 *
 * 1. The section-boundary rail renders as a horizontal grid INSIDE the
 *    timeline chrome — a component/stylesheet class mismatch once left its
 *    beat numbers stacking as unstyled ghosts above the panel.
 * 2. Generated rhythm cells carry velocity shading: every sounding cell
 *    sets --velocity-mix from the exact velocity realized MIDI gets, and
 *    with metric velocity active the mixes must actually differ.
 */

test("boundary rail lays out horizontally inside the timeline", async ({
  page,
}) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  const rail = page.locator(".boundary-rail");
  await expect(rail).toBeVisible();
  const layout = await rail.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const beats = [...element.querySelectorAll(".boundary-rail-beat")].map(
      (beat) => beat.getBoundingClientRect()
    );
    return {
      display: style.display,
      distinctTops: new Set(beats.map((rect) => Math.round(rect.top))).size,
      beatCount: beats.length,
    };
  });
  expect(layout.display).toBe("grid");
  expect(layout.beatCount).toBeGreaterThan(1);
  // Horizontal: every beat number sits on ONE row, not a vertical stack.
  expect(layout.distinctTops).toBe(1);
});

test("generated timeline cells shade by velocity, distinctly under metric tiers", async ({
  page,
}) => {
  await openCaesura(page, {
    setupPreferences: { autosaveEnabled: false, autoloadRecentSession: false },
  });
  const generator = await openMainEditor(page, "generator");
  await generator.getByLabel("Generator kind").selectOption("dumka");
  await generator
    .getByLabel("Dum-Ka metric velocity mode")
    .selectOption("auto");
  await closeMainEditor(page);

  // Wait past the sync placeholder: the lane renders full-span fallback
  // cells until the generator preview lands, and those carry no velocity by
  // design. The real cells must arrive and carry it.
  await page.waitForFunction(() => {
    const cells = document.querySelectorAll(".rhythm-layer-span i:not(.is-rest)");
    return (
      cells.length > 1 &&
      [...cells].some((cell) =>
        (cell.getAttribute("title") ?? "").includes("velocity")
      )
    );
  });
  const cells = page.locator(".rhythm-layer-span i:not(.is-rest)");
  const rendered = await cells.evaluateAll((elements) =>
    elements.map((element) => {
      const computed = window.getComputedStyle(element as HTMLElement);
      return {
        mix: (element as HTMLElement).style.getPropertyValue("--velocity-mix"),
        fill: (element as HTMLElement).style.getPropertyValue("--velocity-fill"),
        // The RENDERED background, not just the inline var: a flat stylesheet
        // override once painted over the velocity vars, so the cells looked
        // identical even though --velocity-mix was set. This assertion is the
        // guard against that "var set but visually flattened" recurrence.
        backgroundImage: computed.backgroundImage,
        title: element.getAttribute("title") ?? "",
      };
    })
  );
  // Every sounding cell reports a velocity and paints a velocity gradient
  // (not a flat fill).
  for (const cell of rendered) {
    expect(cell.mix, `cell missing velocity mix (${cell.title})`).not.toBe("");
    expect(cell.fill, `cell missing velocity fill (${cell.title})`).not.toBe("");
    expect(cell.title).toContain("velocity");
    expect(
      cell.backgroundImage,
      `cell background is flat, not a velocity gradient (${cell.title})`
    ).toContain("gradient");
  }
  // Metric tiers produce real dynamics the eye can see: the fill heights AND
  // the actually-rendered backgrounds both differ across cells.
  expect(new Set(rendered.map((cell) => cell.fill)).size).toBeGreaterThan(1);
  expect(
    new Set(rendered.map((cell) => cell.backgroundImage)).size
  ).toBeGreaterThan(1);
});
