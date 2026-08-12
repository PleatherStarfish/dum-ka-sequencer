import { expect, test } from "@playwright/test";

import { openCaesura, openMainEditor } from "./support/appHarness";

test.describe("channel shaper", () => {
  test("keeps the channel set neutral while showing other track usage", async ({
    page,
  }) => {
    await openCaesura(page);
    await page
      .locator(".parallel-track-actions")
      .getByRole("button", { name: "New track", exact: true })
      .click();
    await expect(page.getByTestId("parallel-track-tab-track-2")).toBeVisible();

    const channel = await openMainEditor(page, "channel");
    const axis = channel.locator(".channel-axis-strip");
    await expect(axis.locator(".channel-usage-summary")).toContainText("Ch 1 T1");
    await expect(axis.locator(".channel-chip.is-used-by-other").first()).toBeVisible();

    const channelCells = await axis.locator(".channel-chip").evaluateAll((chips) =>
      chips.map((chip) => ({
        inlineBackground: (chip as HTMLElement).style.backgroundColor,
        className: chip.className,
      }))
    );
    expect(channelCells).toHaveLength(16);
    expect(channelCells.every((cell) => cell.inlineBackground === "")).toBe(true);
  });

  test("uses a compact header, channel strip, and tabbed matrix workbench", async ({
    page,
  }) => {
    await openCaesura(page);

    const channel = await openMainEditor(page, "channel");
    await expect(channel.locator(".channel-console-header")).toBeVisible();
    await expect(channel.locator(".channel-axis-strip")).toBeVisible();

    const hocketSwitch = channel.locator(
      'input[type="checkbox"][data-automation-target="channelHocket.enabled"]'
    );
    if (!(await hocketSwitch.isChecked())) {
      await channel.locator(".channel-power-card").click();
      await expect(hocketSwitch).toBeChecked();
    }

    await expect(channel.getByRole("button", { name: /Matrix/ })).toHaveClass(
      /is-active/
    );
    await expect(channel.locator(".channel-matrix-wrap")).toBeVisible();
    await expect(channel.getByLabel("channel weight 1 to 1")).toBeVisible();

    const metrics = await channel
      .locator(".channel-hocket-body")
      .evaluate((body) => {
        const matrix = body.querySelector(".channel-matrix-wrap");
        if (!(matrix instanceof HTMLElement)) {
          throw new Error("Expected channel matrix viewport");
        }
        const bodyStyle = getComputedStyle(body);
        const matrixStyle = getComputedStyle(matrix);
        return {
          bodyOverflowY: bodyStyle.overflowY,
          matrixOverflowY: matrixStyle.overflowY,
          matrixHeight: matrix.getBoundingClientRect().height,
          matrixScrollbarGutter: matrixStyle.scrollbarGutter,
          matrixPaddingBottom: matrixStyle.paddingBottom,
        };
      });
    expect(metrics.bodyOverflowY).toBe("hidden");
    expect(metrics.matrixOverflowY).toBe("auto");
    expect(metrics.matrixHeight).toBeGreaterThan(180);
    expect(metrics.matrixScrollbarGutter).toContain("stable");
    expect(parseFloat(metrics.matrixPaddingBottom)).toBeGreaterThan(0);

    await channel.getByRole("button", { name: /Entry & Fallback/ }).click();
    await expect(channel.locator(".channel-entry-panel")).toBeVisible();
    await expect(
      channel.locator(
        'input[data-automation-target="channelHocket.fallback.channel.1.weight"]'
      )
    ).toBeVisible();

  });
});
