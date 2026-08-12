import { expect, test, type Page } from "@playwright/test";

import { closeMainEditor, openCaesura, openMainEditor } from "./support/appHarness";

type NumericContainmentFailure = {
  index: number;
  className: string;
  childClassName: string;
  root: { left: number; right: number; top: number; bottom: number };
  child: { left: number; right: number; top: number; bottom: number };
};

type WeightFieldModeFailure = {
  ariaLabel: string | null;
  title: string | null;
  automationTarget: string | null;
  mode: string | null;
  step: string | null;
  value: string;
};

async function numericContainmentFailures(
  page: Page
): Promise<NumericContainmentFailure[]> {
  return await page.locator(".numeric-field:visible").evaluateAll((fields) => {
    const tolerance = 0.75;
    const rectData = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });

    return fields.flatMap((field, index) => {
      const root = field.getBoundingClientRect();
      return Array.from(
        field.querySelectorAll(".numeric-field__input, .numeric-field__steppers")
      ).flatMap((child) => {
        const rect = child.getBoundingClientRect();
        const escapes =
          rect.left < root.left - tolerance ||
          rect.right > root.right + tolerance ||
          rect.top < root.top - tolerance ||
          rect.bottom > root.bottom + tolerance;
        if (!escapes) return [];
        return [
          {
            index,
            className: field.className,
            childClassName: child.className,
            root: rectData(root),
            child: rectData(rect),
          },
        ];
      });
    });
  });
}

async function expectPreviewCycleSelectorContained(page: Page): Promise<void> {
  const previewPill = page.locator(".preview-cycle-pill").first();
  await expect(previewPill).toBeVisible();
  const boxes = await previewPill.evaluate((pill) => {
    const selector = pill.querySelector(".preview-cycle-selector");
    if (!(selector instanceof HTMLElement)) return null;
    const pillRect = pill.getBoundingClientRect();
    const selectorRect = selector.getBoundingClientRect();
    const buttonRects = Array.from(selector.querySelectorAll("button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    const outputRect = selector.querySelector("output")?.getBoundingClientRect();
    return {
      numericFieldCount: pill.querySelectorAll(".numeric-field").length,
      pill: {
        left: pillRect.left,
        right: pillRect.right,
        top: pillRect.top,
        bottom: pillRect.bottom,
      },
      selector: {
        left: selectorRect.left,
        right: selectorRect.right,
        top: selectorRect.top,
        bottom: selectorRect.bottom,
        height: selectorRect.height,
      },
      buttons: buttonRects,
      output: outputRect
        ? {
            left: outputRect.left,
            right: outputRect.right,
            top: outputRect.top,
            bottom: outputRect.bottom,
          }
        : null,
    };
  });

  expect(boxes).not.toBeNull();
  if (!boxes) return;
  expect(boxes.numericFieldCount).toBe(0);
  expect(boxes.selector.left).toBeGreaterThanOrEqual(boxes.pill.left - 0.75);
  expect(boxes.selector.right).toBeLessThanOrEqual(boxes.pill.right + 0.75);
  expect(boxes.selector.top).toBeGreaterThanOrEqual(boxes.pill.top - 0.75);
  expect(boxes.selector.bottom).toBeLessThanOrEqual(boxes.pill.bottom + 0.75);
  expect(boxes.selector.height).toBeLessThanOrEqual(28);
  expect(boxes.buttons).toHaveLength(2);
  expect(boxes.output).not.toBeNull();
}

async function expectVisibleNumericFieldsContained(page: Page): Promise<void> {
  expect(await numericContainmentFailures(page)).toEqual([]);
}

async function weightFieldModeFailures(page: Page): Promise<WeightFieldModeFailure[]> {
  return await page
    .locator(".numeric-field__input:visible")
    .evaluateAll((inputs) =>
      inputs.flatMap((input) => {
        if (!(input instanceof HTMLInputElement)) return [];
        const ariaLabel = input.getAttribute("aria-label");
        const title = input.getAttribute("title");
        const automationTarget = input.getAttribute("data-automation-target");
        const haystack = [ariaLabel, title, automationTarget]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        const isWeight =
          haystack.includes("weight") || haystack.includes(".weight");
        if (!isWeight) return [];
        const mode = input.getAttribute("data-numeric-mode");
        const step = input.getAttribute("step");
        const showsDecimal = /\d+\.\d/.test(input.value);
        if (mode === "weight" && step === "1" && !showsDecimal) return [];
        return [
          {
            ariaLabel,
            title,
            automationTarget,
            mode,
            step,
            value: input.value,
          },
        ];
      })
    );
}

async function expectVisibleWeightFieldsInteger(page: Page): Promise<void> {
  expect(await weightFieldModeFailures(page)).toEqual([]);
}

test.describe("control chrome", () => {
  test("keeps numeric fields and steppers inside their control bounds", async ({
    page,
  }) => {
    await openCaesura(page);

    const selector = page.locator(".preview-cycle-selector").first();
    await expect(selector.locator("output")).toHaveText("0");
    await expect(
      selector.getByRole("button", { name: "Inspect previous stopped cycle" })
    ).toBeDisabled();
    await selector.getByRole("button", { name: "Inspect next stopped cycle" }).click();
    await expect(selector.locator("output")).toHaveText("1");
    await selector
      .getByRole("button", { name: "Inspect previous stopped cycle" })
      .click();
    await expect(selector.locator("output")).toHaveText("0");
    await expectPreviewCycleSelectorContained(page);
    await expectVisibleNumericFieldsContained(page);
    await expectVisibleWeightFieldsInteger(page);

    for (const editor of ["boundaries", "channel"] as const) {
      await openMainEditor(page, editor);
      await expectVisibleNumericFieldsContained(page);
      await expectVisibleWeightFieldsInteger(page);
      await closeMainEditor(page);
    }
  });
});
