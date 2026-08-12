import { expect, test } from "@playwright/test";

import { closeMainEditor, openCaesura, openMainEditor } from "./support/appHarness";

test.describe("main editor launcher", () => {
  test("opens one full-window editor at a time and closes with escape", async ({
    page,
  }) => {
    await openCaesura(page);

    const launchers = ["boundaries", "generator", "evolve", "channel"];
    for (const launcher of launchers) {
      await expect(page.getByTestId(`main-editor-launcher-${launcher}`)).toBeVisible();
    }

    const boundaries = await openMainEditor(page, "boundaries");
    await expect(page.getByRole("dialog", { name: "Sections and subdivisions editor" })).toBeVisible();
    await expect(boundaries).toBeVisible();
    await expect(page.getByTestId("main-editor-launcher-boundaries")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await closeMainEditor(page);
    await openMainEditor(page, "channel");
    await expect(page.getByRole("dialog", { name: "Channel shaper editor" })).toBeVisible();
    await expect(boundaries).toBeHidden();
    await expect(page.getByTestId("main-editor-launcher-boundaries")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await expect(page.getByTestId("main-editor-launcher-channel")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Channel shaper editor" })).toBeHidden();
    await expect(page.getByTestId("main-editor-launcher-channel")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  test("keeps debug sections as inline accordions", async ({ page }) => {
    await openCaesura(page);

    const midiDebug = page.locator(".panel-state-midi");
    await expect(midiDebug).toBeVisible();
    await expect(page.getByText("MIDI out", { exact: true })).toBeVisible();
    await expect(midiDebug.locator(".midi-debug-toolbar")).toBeHidden();

    await midiDebug.locator("summary").click();
    await expect(midiDebug.locator(".midi-debug-toolbar")).toBeVisible();
  });

  test("uses standardized quiet launcher buttons with svg icons", async ({
    page,
  }) => {
    await openCaesura(page);

    const launchers = page.locator(".main-editor-launcher");
    await expect(launchers).toHaveCount(4);
    await expect(launchers.locator(".main-editor-launcher-icon svg")).toHaveCount(4);

    const styles = await launchers.evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        const icon = button.querySelector(".main-editor-launcher-icon");
        const iconStyle = icon ? getComputedStyle(icon) : null;
        return {
          borderStyle: style.borderStyle,
          borderWidth: style.borderWidth,
          borderRadius: style.borderRadius,
          minHeight: style.minHeight,
          background: style.backgroundColor,
          iconText: icon?.textContent?.trim() ?? "",
          iconBorderWidth: iconStyle?.borderWidth ?? "",
        };
      })
    );

    const [first] = styles;
    for (const style of styles) {
      expect(style.borderStyle).toBe(first.borderStyle);
      expect(style.borderWidth).toBe(first.borderWidth);
      expect(style.borderRadius).toBe(first.borderRadius);
      expect(style.minHeight).toBe(first.minHeight);
      expect(style.background).toBe(first.background);
      expect(style.iconBorderWidth).toBe("1px");
      expect(style.iconText).toBe("");
    }
  });

  test("keeps full-window editor content scrollable inside the modal", async ({
    page,
  }) => {
    await openCaesura(page);

    const editors = [
      ["boundaries", "#section-boundaries-panel", ".editor-panel-body", true, "auto"],
      ["channel", "#channel-shaper-panel", ".shaper-body", false, "hidden"],
    ] as const;

    for (const [
      editor,
      panelSelector,
      bodySelector,
      shouldScroll,
      expectedOverflowY,
    ] of editors) {
      await openMainEditor(page, editor);
      const metrics = await page.evaluate(
        ({ panelSelector, bodySelector, shouldScroll, expectedOverflowY }) => {
          const panel = document.querySelector(panelSelector);
          const body = panel?.querySelector(bodySelector);
          if (!(panel instanceof HTMLElement) || !(body instanceof HTMLElement)) {
            throw new Error(`Expected ${panelSelector} body to be present`);
          }
          const panelRect = panel.getBoundingClientRect();
          const bodyRect = body.getBoundingClientRect();
          const bodyStyle = getComputedStyle(body);
          const before = body.scrollTop;
          body.scrollTop = body.scrollHeight;
          const after = body.scrollTop;
          body.scrollTop = before;
          return {
            bodyBottom: bodyRect.bottom,
            panelBottom: panelRect.bottom,
            bodyHasVisibleHeight: bodyRect.height > 120,
            bodyOverflowY: bodyStyle.overflowY,
            scrollHeight: body.scrollHeight,
            clientHeight: body.clientHeight,
            scrolled: after > before,
            shouldScroll,
            expectedOverflowY,
          };
        },
        { panelSelector, bodySelector, shouldScroll, expectedOverflowY }
      );

      expect(metrics.bodyBottom).toBeLessThanOrEqual(metrics.panelBottom + 2);
      expect(metrics.bodyHasVisibleHeight).toBe(true);
      expect(metrics.bodyOverflowY).toBe(metrics.expectedOverflowY);
      expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight);
      if (metrics.shouldScroll && metrics.scrollHeight > metrics.clientHeight + 1) {
        expect(metrics.scrolled).toBe(true);
      }

      await closeMainEditor(page);
    }
  });

  test("uses an opaque full-window editor surface", async ({ page }) => {
    await openCaesura(page);

    const boundaries = await openMainEditor(page, "boundaries");
    await expect(boundaries).toBeVisible();

    const boundarySurface = await page.evaluate(() => {
      const editor = document.querySelector("#section-boundaries-panel");
      if (!editor) {
        throw new Error("Expected section boundaries editor to be present");
      }
      return {
        background: getComputedStyle(editor).backgroundColor,
        zIndex: Number.parseInt(getComputedStyle(editor).zIndex, 10),
      };
    });

    expect(boundarySurface.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(boundarySurface.background).not.toBe("transparent");
    expect(boundarySurface.zIndex).toBeGreaterThan(0);
  });
});
