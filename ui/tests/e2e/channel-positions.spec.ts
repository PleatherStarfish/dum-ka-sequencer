import { expect, test } from "@playwright/test";

import {
  fillNumeric,
  getDriverState,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

/**
 * E2E for the channel shaper's Positions tab (shipped 2026-07-03, previously
 * zero E2E coverage): enable channel hocket, add a position rule, author its
 * label, scope, Nth, action weights, and render-channel weights, and assert
 * the derived `channelHocket.positionRules` reaches the backend
 * `track_set_playback` request in the engine's normalized shape (sparse
 * weight lists, reset block keyed by mode).
 */

test("authors a position rule that reaches the channelHocket request", async ({
  page,
}) => {
  await openCaesura(page);

  const panel = await openMainEditor(page, "channel");

  // Power on hocket and pick a 3-channel axis (1..3) so the rule's weight
  // grids have channels to route to.
  const hocketSwitch = panel.locator(
    'input[type="checkbox"][data-automation-target="channelHocket.enabled"]'
  );
  if (!(await hocketSwitch.isChecked())) {
    await panel.locator(".channel-power-card").click();
    await expect(hocketSwitch).toBeChecked();
  }
  await page.getByLabel("Channel axis count").selectOption("3");

  // Switch to the Positions tab (ChannelHocketTabId "positions").
  await panel.getByRole("button", { name: /Positions/ }).click();
  await expect(panel.locator(".channel-position-panel")).toBeVisible();
  await expect(panel.locator(".channel-empty-state")).toContainText(
    "No position rules."
  );

  // Add a rule: defaults to every-1st-note, render-only, routed to the first
  // non-fallback channel (Ch 2).
  await panel
    .locator(".channel-position-head")
    .getByRole("button", { name: "add", exact: true })
    .click();
  const rule = panel.locator(".channel-position-rule");
  await expect(rule).toHaveCount(1);
  await expect(panel.locator(".channel-position-head")).toContainText("1 active");

  // Author the rule. NumericFields are addressed via their automation-target
  // attributes (the rule id is minted at runtime, so labels are matched by
  // suffix): scope section, every 3rd note, normal-Markov action weight 2
  // alongside the default render-only 1, and a second render channel (Ch 3).
  await panel.getByLabel("Position rule 1 label").fill("first-note router");
  await rule.getByLabel("Scope").selectOption("section");
  await fillNumeric(rule.locator('input[data-automation-target$=".nth"]'), 3);
  await fillNumeric(
    rule.locator('input[data-automation-target$=".action.normalMarkov.weight"]'),
    2
  );
  await fillNumeric(
    rule.locator('input[data-automation-target$=".render.channel.3.weight"]'),
    4
  );

  // The rule reaches the debounced track_set_playback config push.
  await page.waitForFunction(() => {
    const request = window.__CAESURA_E2E_DRIVER__?.getState()
      ?.lastTrackPlaybackRequest;
    return (
      request?.channelHocketEnabled === true &&
      request?.channelHocket?.positionRules?.length === 1 &&
      request?.channelHocket?.positionRules?.[0]?.nth === 3
    );
  });
  const driver = await getDriverState(page);
  const channelHocket = driver.lastTrackPlaybackRequest?.channelHocket as {
    channels: number[];
    positionRules: Array<{
      id: string;
      label: string;
      enabled: boolean;
      scope: string;
      nth: number;
      actionWeights: {
        normalMarkov: number;
        renderOnly: number;
        resetMarkov: number;
      };
      renderWeights: Array<{ channel: number; weight: number }>;
      reset: { mode: string; weights: unknown[] };
    }>;
  };
  expect(channelHocket.channels).toEqual([1, 2, 3]);
  expect(channelHocket.positionRules).toHaveLength(1);
  const sentRule = channelHocket.positionRules[0]!;
  expect(sentRule.id).toEqual(expect.any(String));
  expect(sentRule).toMatchObject({
    label: "first-note router",
    enabled: true,
    scope: "section",
    nth: 3,
    actionWeights: { normalMarkov: 2, renderOnly: 1, resetMarkov: 0 },
    reset: { mode: "staticFallback", weights: [] },
  });
  // Sparse render weights: the default Ch 2 seed plus the authored Ch 3.
  expect(sentRule.renderWeights).toEqual([
    { channel: 2, weight: 1 },
    { channel: 3, weight: 4 },
  ]);

  // Disabling the rule drops it from the request (enabled rules only).
  await rule
    .locator('input[data-automation-target$=".enabled"]')
    .first()
    .uncheck({ force: true });
  await expect(panel.locator(".channel-position-head")).toContainText("0 active");
  await page.waitForFunction(
    () =>
      window.__CAESURA_E2E_DRIVER__?.getState()?.lastTrackPlaybackRequest
        ?.channelHocket?.positionRules?.length === 0
  );
});
