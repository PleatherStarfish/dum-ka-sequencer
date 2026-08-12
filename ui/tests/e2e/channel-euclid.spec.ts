import { expect, test } from "@playwright/test";

import {
  fillNumeric,
  getDriverState,
  openCaesura,
  openMainEditor,
} from "./support/appHarness";

test.describe("euclid channel assignment", () => {
  test("switching strategy seeds layers, shows Bjorklund strips and badges", async ({
    page,
  }) => {
    await openCaesura(page);
    const channel = await openMainEditor(page, "channel");

    const hocketSwitch = channel.locator(
      'input[type="checkbox"][data-automation-target="channelHocket.enabled"]'
    );
    if (!(await hocketSwitch.isChecked())) {
      await channel.locator(".channel-power-card").click();
      await expect(hocketSwitch).toBeChecked();
    }

    // Markov stays the default: matrix tab active, Order/Axis present.
    await expect(channel.getByRole("button", { name: /Matrix/ })).toHaveClass(
      /is-active/
    );
    await expect(channel.getByLabel("Channel axis count")).toBeVisible();

    await channel
      .getByLabel("Channel assignment strategy")
      .selectOption("euclid");

    // The strategy swap replaces the markov tabs with the Pattern tab and
    // hides the markov-only header fields.
    await expect(channel.getByRole("button", { name: /Pattern/ })).toHaveClass(
      /is-active/
    );
    await expect(channel.getByRole("button", { name: /Matrix/ })).toHaveCount(0);
    await expect(channel.getByLabel("Channel axis count")).toHaveCount(0);

    // Enabling hocket seeded two channels; switching seeded one layer per
    // channel with pulses spread by largest remainder over 16 steps.
    const layers = channel.locator(".channel-euclid-layer");
    await expect(layers).toHaveCount(2);
    await expect(channel.getByLabel("Euclid layer 1 pulses")).toHaveValue("8");
    await expect(channel.getByLabel("Euclid layer 2 pulses")).toHaveValue("8");

    // Author E(3,8) + E(2,8): the strips carry the literature masks and the
    // combined strip resolves layer priority + fallback.
    await fillNumeric(channel.getByLabel("Euclid steps"), 8);
    await fillNumeric(channel.getByLabel("Euclid layer 1 pulses"), 3);
    await fillNumeric(channel.getByLabel("Euclid layer 2 pulses"), 2);
    await expect(
      layers.first().locator(".rhythm-shapegroup-mask")
    ).toHaveAttribute("aria-label", /mask 10010010$/);
    await expect(
      channel.locator('[aria-label^="Euclid resolved channels"]')
    ).toBeVisible();

    // Interval-vector readout + Euclidean-string badges (Ellis et al.).
    await expect(channel.locator(".channel-euclid-readout").first()).toContainText(
      "E(3,8)"
    );
    await expect(
      channel.locator(".channel-euclid-badge").first()
    ).toContainText(/Euclidean string/);

    // Reset + span-accent controls round-trip into the playback request.
    await channel.getByLabel("Euclid reset scope").selectOption("section");
    await channel.getByLabel("Euclid span accents").selectOption("bypass");
    await channel
      .getByLabel("Euclid span accent channel")
      .selectOption("fallback");

    // The strategy reaches the debounced track_set_playback config push.
    await page.waitForFunction(() => {
      const request = window.__CAESURA_E2E_DRIVER__?.getState()
        ?.lastTrackPlaybackRequest;
      return (
        request?.channelHocket?.assignMode === "euclid" &&
        request?.channelHocket?.euclid?.reset === "section" &&
        request?.channelHocket?.euclid?.spanAccentMode === "bypass"
      );
    });
    const driver = await getDriverState(page);
    const hocket = driver.lastTrackPlaybackRequest?.channelHocket as {
      assignMode: string;
      euclid: {
        placement: string;
        steps: number;
        reset: string;
        spanAccentMode: string;
        spanAccentChannel: number | null;
        layers: Array<{ channel: number; pulses: number }>;
      };
    };
    expect(hocket.assignMode).toBe("euclid");
    expect(hocket.euclid).toMatchObject({
      placement: "partition",
      steps: 8,
      reset: "section",
      spanAccentMode: "bypass",
      spanAccentChannel: null,
    });
    expect(hocket.euclid.layers.map((layer) => layer.pulses)).toEqual([3, 2]);

    // Switching back restores the markov surface untouched.
    await channel
      .getByLabel("Channel assignment strategy")
      .selectOption("markov");
    await expect(channel.getByRole("button", { name: /Matrix/ })).toHaveClass(
      /is-active/
    );
    await expect(channel.getByLabel("channel weight 1 to 1")).toBeVisible();
  });
});
