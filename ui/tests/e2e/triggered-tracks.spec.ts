import { expect, test, type Page } from "@playwright/test";

import { getDriverState, openCaesura, waitForPlaying } from "./support/appHarness";

async function addTrack(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New track", exact: true }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
}

async function makeActiveTrackTriggered(page: Page): Promise<void> {
  await page.getByTestId("track-role-triggered").check();
  await expect(page.getByTestId("track-trigger-mode")).toHaveValue("triggered");
}

async function addTriggeredFollower(page: Page): Promise<void> {
  await addTrack(page);
  await makeActiveTrackTriggered(page);
}

/**
 * Smoke test for the Triggered Tracks UI: configure a second track as triggered
 * by the first on a beat-3 rest, confirm the armed → running state machine, and
 * confirm the trigger config reaches the backend `parallel_set_playback`
 * request (the single source of truth the engine compiles from). Phase B makes
 * WHEN a real multi-condition tree (`when`), so these assert the canonical
 * `when` shape rather than the legacy single `condition`.
 */
test("configures a triggered follower and shows armed → running", async ({ page }) => {
  await openCaesura(page);
  await expect(page.locator(".parallel-track-cell")).toHaveCount(1);
  await expect(page.getByTestId("track-role-triggered")).toBeDisabled();
  await expect(page.getByTestId("track-role-reason")).toContainText(
    "Add another track to enable Triggered"
  );

  // Add a second track; creation makes it the active track.
  await addTrack(page);

  // Default mode is continuous.
  await expect(page.getByTestId("track-role-continuous")).toBeChecked();

  // Switch to triggered; it auto-selects the only other (continuous) track as
  // source and defaults to the beat-3 rest condition.
  await makeActiveTrackTriggered(page);
  await page.getByTestId("track-trigger-detail").selectOption("advanced");
  await expect(page.getByTestId("track-trigger-status")).toHaveText("armed");
  // WHEN defaults to a single ALL row: "beat is rest" at beat 3.
  await expect(page.getByTestId("track-trigger-when-subject-0")).toHaveValue("isRest");
  await expect(page.getByTestId("track-trigger-when-beats")).toHaveValue("at");
  await expect(page.getByLabel("Trigger beat index (0-based)")).toHaveValue("3");

  const sourceId = await page.getByTestId("track-trigger-source").inputValue();
  expect(sourceId).toBeTruthy();

  // Quantize the launch to a 1/N-beat grid; the divisions field reveals.
  await page.getByTestId("track-trigger-quantize").selectOption("fraction");
  await expect(page.getByLabel("Quantize beat divisions")).toBeVisible();
  await expect(page.getByTestId("track-trigger-quantize-dir")).toHaveValue("next");

  // Play: the follower joins parallel playback; the badge flips to running.
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);
  await expect(page.getByTestId("track-trigger-status")).toHaveText("running");
  await expect(page.getByTestId("track-trigger-mode")).toBeDisabled();
  await expect(page.getByTestId("track-trigger-locked")).toContainText("locked during playback");
  await expect(page.getByTestId("track-trigger-when-subject-0")).toBeDisabled();
  await expect(page.getByTestId("track-trigger-quantize")).toBeDisabled();
  await expect(page.getByTestId("track-trigger-preset-fillRest")).toBeDisabled();

  // The configured trigger reached the backend playback request verbatim.
  const state = await getDriverState(page);
  const calls = state.calls.filter((call) => call.command === "parallel_set_playback");
  expect(calls.length).toBeGreaterThan(0);
  const request = (calls[calls.length - 1]!.args as { request: unknown }).request as {
    tracks: Array<{
      id: string;
      trigger:
        | null
        | {
            sourceTrackId: string;
            when: unknown;
            reTrigger: string;
            length: { type: string };
            launchQuantize: { grid: { type: string }; direction: string } | null;
          };
    }>;
  };
  const follower = request.tracks.find((track) => track.trigger);
  expect(follower).toBeTruthy();
  expect(follower!.trigger!.sourceTrackId).toBe(sourceId);
  // The canonical WHEN tree reaches the backend (no legacy `condition`).
  expect(follower!.trigger!.when).toEqual({
    beats: { type: "at", beat: 3 },
    tree: { type: "leaf", predicate: { type: "isRest" } },
  });
  expect(follower!.trigger!.reTrigger).toBe("restart");
  expect(follower!.trigger!.length).toEqual({ type: "scoreCycle" });
  // The launch-quantize selection reached the backend request too.
  expect(follower!.trigger!.launchQuantize).toEqual({
    grid: { type: "referenceBeatFraction", divisions: 4 },
    direction: "next",
  });
});

test("trigger inspector shows bands, presets, and a track-row chip", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);
  await page.getByTestId("track-trigger-detail").selectOption("advanced");

  // The GATE band is live (Phase C) — off by default (always accepts).
  await expect(page.getByTestId("track-trigger-gate-enabled")).not.toBeChecked();
  await expect(page.getByTestId("track-trigger-gate-off")).toBeVisible();
  // Multi-condition match is live (Phase B): ALL/ANY are selectable.
  await expect(page.getByTestId("track-trigger-match")).toBeEnabled();
  await expect(page.getByTestId("track-trigger-match")).toHaveValue("all");
  // Observe is fixed to structure+generator in v1, shown as static status text.
  await expect(page.getByTestId("track-trigger-observe")).toContainText(
    "structure + generator"
  );

  // The newly-triggered active track gets a compact mode chip on its row.
  await expect(
    page.locator('[data-testid^="parallel-track-trigger-chip-"]')
  ).toHaveCount(1);

  // A still-future preset is disabled; available presets just populate rows.
  await expect(page.getByTestId("track-trigger-preset-answerNextCycle")).toBeDisabled();
  // Probabilistic fill is live now (Phase C GATE).
  await expect(page.getByTestId("track-trigger-preset-probabilisticFill")).toBeEnabled();
  await page.getByTestId("track-trigger-preset-phaseLockedShadow").click();
  await expect(page.getByTestId("track-trigger-align")).toHaveValue("atSourceCycleStart");
  await expect(page.getByTestId("track-trigger-when-subject-0")).toHaveValue("isSounding");

  // A subject's value control appears only for that subject, and NumericField
  // clamps to the same bounded ranges as the normalizers.
  await page.getByTestId("track-trigger-when-subject-0").selectOption("gatiIs");
  await expect(page.getByTestId("track-trigger-when-gati-0")).toBeVisible();
  await page.getByTestId("track-trigger-when-gati-0").fill("99");
  await page.getByTestId("track-trigger-when-gati-0").press("Enter");
  await expect(page.getByTestId("track-trigger-when-gati-0")).toHaveValue("32");

  await page.getByTestId("track-trigger-align").selectOption("afterEventTicks");
  await expect(page.getByTestId("track-trigger-after-ticks")).toBeVisible();
  await page.getByTestId("track-trigger-after-ticks").fill("-5");
  await page.getByTestId("track-trigger-after-ticks").press("Enter");
  await expect(page.getByTestId("track-trigger-after-ticks")).toHaveValue("0");

  await page.getByTestId("track-trigger-quantize").selectOption("multiple");
  await expect(page.getByLabel("Quantize beat multiple")).toBeVisible();
  await page.getByLabel("Quantize beat multiple").fill("99");
  await page.getByLabel("Quantize beat multiple").press("Enter");
  await expect(page.getByLabel("Quantize beat multiple")).toHaveValue("64");
  await page.getByTestId("track-trigger-quantize-dir").selectOption("previous");
  await expect(page.getByTestId("track-trigger-quantize-dir")).toHaveValue("previous");
});

test("builds a multi-condition WHEN tree that reaches the backend", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);
  await page.getByTestId("track-trigger-detail").selectOption("advanced");

  // Evaluate at every beat, and combine the rows with ANY (at least one).
  await page.getByTestId("track-trigger-when-beats").selectOption("anyBeat");
  await page.getByTestId("track-trigger-match").selectOption("any");

  // Add a second row: NOT (sounding count in cycle ≥ 2). Row 0 stays "is rest".
  await page.getByTestId("track-trigger-when-add").click();
  await page.getByTestId("track-trigger-when-subject-1").selectOption("soundingCountInCycle");
  await page.getByTestId("track-trigger-when-op-1").selectOption("atLeast");
  await page.getByTestId("track-trigger-when-count-1").fill("2");
  await page.getByTestId("track-trigger-when-count-1").press("Enter");
  await page.getByTestId("track-trigger-when-not-1").check({ force: true });

  // Play so the composed config is flushed to the backend, then assert the tree.
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const state = await getDriverState(page);
  const calls = state.calls.filter((call) => call.command === "parallel_set_playback");
  expect(calls.length).toBeGreaterThan(0);
  const request = (calls[calls.length - 1]!.args as { request: unknown }).request as {
    tracks: Array<{ trigger: null | { when: unknown } }>;
  };
  const follower = request.tracks.find((track) => track.trigger);
  expect(follower).toBeTruthy();
  expect(follower!.trigger!.when).toEqual({
    beats: { type: "anyBeat" },
    tree: {
      type: "any",
      nodes: [
        { type: "leaf", predicate: { type: "isRest" } },
        {
          type: "not",
          node: {
            type: "leaf",
            predicate: { type: "soundingCountInCycle", op: "atLeast", count: 2 },
          },
        },
      ],
    },
  });
});

test("enabling the GATE band sends a probability gate to the backend", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);
  await page.getByTestId("track-trigger-detail").selectOption("advanced");

  // Enable the gate; the probability/cooldown/miss-boost row reveals.
  await page.getByTestId("track-trigger-gate-enabled").check();
  await expect(page.getByTestId("track-trigger-gate-row")).toBeVisible();

  // 60% probability, 2-cycle cooldown, 20% miss-boost.
  await page.getByTestId("track-trigger-gate-probability").fill("60");
  await page.getByTestId("track-trigger-gate-probability").press("Enter");
  await page.getByTestId("track-trigger-gate-cooldown").fill("2");
  await page.getByTestId("track-trigger-gate-cooldown").press("Enter");
  await page.getByTestId("track-trigger-gate-miss-boost").fill("20");
  await page.getByTestId("track-trigger-gate-miss-boost").press("Enter");

  // Play so the config flushes to the backend, then assert the gate shape.
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const state = await getDriverState(page);
  const calls = state.calls.filter((call) => call.command === "parallel_set_playback");
  expect(calls.length).toBeGreaterThan(0);
  const request = (calls[calls.length - 1]!.args as { request: unknown }).request as {
    tracks: Array<{
      trigger: null | {
        gate: null | {
          probabilityPerMille: number;
          cooldownCycles: number;
          missBoostPerMille: number;
        };
      };
    }>;
  };
  const follower = request.tracks.find((track) => track.trigger);
  expect(follower).toBeTruthy();
  expect(follower!.trigger!.gate).toMatchObject({
    probabilityPerMille: 600,
    cooldownCycles: 2,
    missBoostPerMille: 200,
  });
});

test("a resolved-context placement and a weighted START reach the backend", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);
  await page.getByTestId("track-trigger-detail").selectOption("advanced");

  // Fixed mode offers the Phase-D placements.
  await page.getByTestId("track-trigger-align").selectOption("centerInRest");
  await expect(page.getByTestId("track-trigger-align")).toHaveValue("centerInRest");

  // Switch to a weighted START: the first option seeds from the current
  // placement (centerInRest); add a second (at source return) and weight it.
  await page.getByTestId("track-trigger-start-mode").selectOption("weighted");
  await expect(page.getByTestId("track-trigger-start-align-0")).toHaveValue("centerInRest");
  await page.getByTestId("track-trigger-start-add").click();
  await page.getByTestId("track-trigger-start-align-1").selectOption("atSourceReturn");
  await page.getByTestId("track-trigger-start-weight-1").fill("3");
  await page.getByTestId("track-trigger-start-weight-1").press("Enter");

  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const state = await getDriverState(page);
  const calls = state.calls.filter((call) => call.command === "parallel_set_playback");
  expect(calls.length).toBeGreaterThan(0);
  const request = (calls[calls.length - 1]!.args as { request: unknown }).request as {
    tracks: Array<{
      trigger: null | {
        startSelect: null | {
          options: Array<{ alignment: { type: string }; weight: number }>;
        };
      };
    }>;
  };
  const follower = request.tracks.find((track) => track.trigger);
  expect(follower).toBeTruthy();
  expect(follower!.trigger!.startSelect!.options).toEqual([
    { alignment: { type: "centerInRest" }, weight: 1 },
    { alignment: { type: "atSourceReturn" }, weight: 3 },
  ]);
});

test("the trigger timeline overlay + log render the engine decision trace", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);

  // Default config fills the lead's beat-3 rest every cycle.
  await page.getByTestId("track-trigger-detail").selectOption("advanced");
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  // Once it launches, the engine emits decisions ⇒ the TIMELINE overlay + LOG
  // populate (both render the trace directly, so they can't disagree with audio).
  await expect(page.getByTestId("track-trigger-status")).toHaveText("running", { timeout: 10000 });
  await expect(page.getByTestId("track-trigger-timeline")).toBeVisible();
  await expect(page.getByTestId("track-trigger-overlay-mark").first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId("track-trigger-log-line").first()).toBeVisible();

  // The log filter is interactive and snapshot-driven (a launched fill exists).
  await page.getByTestId("track-trigger-log-filter").selectOption("launched");
  await expect(page.getByTestId("track-trigger-log-line").first()).toBeVisible();
  // The inspect toggle reveals rejected candidates (none here ⇒ still no crash).
  await page.getByTestId("track-trigger-inspect").check();
  await expect(page.getByTestId("track-trigger-timeline")).toBeVisible();
});

test("deferred roadmap capabilities are documented outside live dropdowns", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);
  await page.getByTestId("track-trigger-detail").selectOption("advanced");

  // Deferred capabilities are not selectable in live dropdowns.
  for (const value of [
    "untilStop", // RUN lifetime
    "untilReturn", // RUN length
    "rotateToAccent", // START placement
    "ratchetFired", // WHEN subject (post-score)
    "sourceRunning", // WHEN subject (cross-track)
  ]) {
    await expect(page.locator(`option[value="${value}"]`)).toHaveCount(0);
  }
  // They are instead named in the roadmap copy.
  await expect(page.getByTestId("track-trigger-roadmap")).toContainText("until-stop");
  await expect(page.getByTestId("track-trigger-roadmap")).toContainText("post-score");
});

test("the summary, Basic/Advanced disclosure, and help read the live config", async ({ page }) => {
  await openCaesura(page);
  await addTriggeredFollower(page);

  // A plain-language summary leads, describing the default fill-a-rest config.
  const summary = page.getByTestId("track-trigger-summary");
  await expect(summary).toContainText("rests on beat index 3");
  await expect(summary).toContainText("launch one cycle");

  // Basic mode hides advanced controls (the GATE band, the Match combinator).
  await expect(page.getByTestId("track-trigger-gate")).toHaveCount(0);
  await expect(page.getByTestId("track-trigger-match")).toHaveCount(0);

  // Advanced reveals them.
  await page.getByTestId("track-trigger-detail").selectOption("advanced");
  await expect(page.getByTestId("track-trigger-gate")).toBeVisible();
  await expect(page.getByTestId("track-trigger-match")).toBeVisible();

  // The summary tracks a preset (the probabilistic gate shows up in words).
  await page.getByTestId("track-trigger-preset-probabilisticFill").click();
  await expect(summary).toContainText("60% probability");

  // The help popover explains the two-decision model.
  await page.getByTestId("track-trigger-help").click();
  await expect(page.getByTestId("track-trigger-help-text")).toContainText("listens to a source track");
});
