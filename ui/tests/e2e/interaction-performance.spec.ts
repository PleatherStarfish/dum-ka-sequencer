import { expect, test, type Page } from "@playwright/test";

import {
  closeMainEditor,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

async function installReactCommitCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const metrics = { commits: 0 };
    let rendererId = 0;
    const renderers = new Map<number, unknown>();
    const hook = {
      supportsFiber: true,
      renderers,
      inject(renderer: unknown) {
        rendererId += 1;
        renderers.set(rendererId, renderer);
        return rendererId;
      },
      onCommitFiberRoot() {
        metrics.commits += 1;
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      getFiberRoots() {
        return new Set();
      },
    };
    Object.defineProperty(window, "__CAESURA_RENDER_METRICS__", {
      configurable: true,
      value: metrics,
    });
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      value: hook,
    });
  });
}

test.describe("interaction performance contracts", () => {
  test("a stopped transport does not commit the App tree every animation frame", async ({
    page,
  }) => {
    await installReactCommitCounter(page);
    await openCaesura(page, { autosaveEnabledPreference: false });
    const initialCommits = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __CAESURA_RENDER_METRICS__?: { commits: number };
          }
        ).__CAESURA_RENDER_METRICS__?.commits ?? 0
    );
    expect(initialCommits).toBeGreaterThan(0);

    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const metrics = (
        window as typeof window & {
          __CAESURA_RENDER_METRICS__?: { commits: number };
        }
      ).__CAESURA_RENDER_METRICS__;
      if (metrics) metrics.commits = 0;
    });
    await page.waitForTimeout(1_000);
    const idleCommits = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __CAESURA_RENDER_METRICS__?: { commits: number };
          }
        ).__CAESURA_RENDER_METRICS__?.commits ?? Number.POSITIVE_INFINITY
    );

    // Snapshot polling may legitimately publish a small number of updates.
    // The former stopped-rAF bug committed roughly 60 times per second.
    expect(idleCommits).toBeLessThan(20);
  });

  test("closed main editors do not retain their heavy form bodies", async ({ page }) => {
    await openCaesura(page);
    const editorBodies = page.locator(
      ".main-editor-surface .editor-panel-body, .main-editor-surface .shaper-body"
    );
    await expect(editorBodies).toHaveCount(0);

    await openMainEditor(page, "channel");
    await expect(editorBodies).toHaveCount(1);

    await closeMainEditor(page);
    await expect(editorBodies).toHaveCount(0);
  });
});
