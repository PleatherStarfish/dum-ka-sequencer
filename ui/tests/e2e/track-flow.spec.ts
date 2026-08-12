import { expect, test } from "@playwright/test";

import { getDriverState, openCaesura, waitForPlaying } from "./support/appHarness";

/**
 * Smoke test for the Track Flow box lane UI: creating a box and dragging a track
 * tab into it must route that track into the box's lane (`trackFlowBoxes`) in the
 * backend `parallel_set_playback` request — never into the ordinary parallel
 * participant list. The lane resolver + conflict identity are covered by the Rust
 * transport tests; this asserts the UI (drag-to-assign) → request wiring.
 */

test("drags a track into a Track Flow box and routes it into the box lane", async ({
  page,
}) => {
  await openCaesura(page);
  await expect(page.locator(".parallel-track-cell")).toHaveCount(1);

  // Add a second track; creation makes it the active track. Default is parallel.
  await page.getByRole("button", { name: "New track", exact: true }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);

  // Create a new Track Flow box (an empty draft), then capture its ids.
  await page.getByTestId("track-flow-add-box").click();
  const box = page.locator('[data-testid^="track-flow-box-"]').first();
  await expect(box).toBeVisible();
  const boxId = (await box.getAttribute("data-testid"))!.replace(
    "track-flow-box-",
    ""
  );

  // Drag the second track's tab cell into the box.
  const secondCell = page.locator(".parallel-track-cell").nth(1);
  const secondTrackId = (await secondCell.getAttribute("data-testid"))!.replace(
    "parallel-track-cell-",
    ""
  );
  await secondCell.locator(".parallel-track-tab").dragTo(
    page.getByTestId(`track-flow-box-${boxId}`)
  );

  // The dragged track now renders inside the box (as a box member), not as a
  // standalone parallel cell at the top level.
  await expect(
    page
      .getByTestId(`track-flow-box-${boxId}`)
      .getByTestId(`parallel-track-cell-${secondTrackId}`)
  ).toBeVisible();

  // Play and inspect the request the backend actually received.
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const state = await getDriverState(page);
  const calls = state.calls.filter(
    (call) => call.command === "parallel_set_playback"
  );
  expect(calls.length).toBeGreaterThan(0);
  const request = (calls[calls.length - 1]!.args as { request: unknown })
    .request as {
    tracks: Array<{ id: string }>;
    trackFlowBoxes: Array<{
      id: string;
      sources: Array<{ id: string }>;
      seed: number;
    }>;
  };

  // One parallel participant + one box lane carrying the dragged track, disjoint.
  expect(request.tracks).toHaveLength(1);
  expect(request.tracks.some((track) => track.id === secondTrackId)).toBe(false);
  expect(request.trackFlowBoxes).toHaveLength(1);
  const lane = request.trackFlowBoxes[0]!;
  expect(lane.sources.map((source) => source.id)).toEqual([secondTrackId]);
});

test("keeps other empty draft boxes when assigning a track into one box", async ({
  page,
}) => {
  await openCaesura(page);
  await page.getByRole("button", { name: "New track", exact: true }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);

  // Two empty draft boxes (deterministic ids box-1, box-2).
  await page.getByTestId("track-flow-add-box").click();
  await page.getByTestId("track-flow-add-box").click();
  await expect(page.locator(".tf-box-group")).toHaveCount(2);

  // Switch the active track to Track Flow via the Role picker; it joins the first
  // box (the role change's default target).
  await page.getByTestId("track-role-trackFlow").check();

  // The first box now has the member; the second (still-empty) draft must survive.
  await expect(page.getByTestId("track-flow-box-box-1")).toBeVisible();
  await expect(page.getByTestId("track-flow-box-box-2")).toBeVisible();
});

test("moves a track into a box via the Role picker", async ({ page }) => {
  await openCaesura(page);
  await page.getByRole("button", { name: "New track", exact: true }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
  const secondTrackId = (await page
    .locator(".parallel-track-cell")
    .nth(1)
    .getAttribute("data-testid"))!.replace("parallel-track-cell-", "");

  // The active (second) track starts continuous; switching it to Track Flow with
  // no boxes yet mints a new one.
  await expect(page.getByTestId("track-role-continuous")).toBeChecked();
  await page.getByTestId("track-role-trackFlow").check();
  await expect(page.locator(".tf-box-group")).toHaveCount(1);

  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);
  const state = await getDriverState(page);
  const request = (
    state.calls.filter((call) => call.command === "parallel_set_playback").at(-1)!
      .args as { request: unknown }
  ).request as {
    tracks: Array<{ id: string }>;
    trackFlowBoxes: Array<{ sources: Array<{ id: string }> }>;
  };
  expect(request.tracks.some((track) => track.id === secondTrackId)).toBe(false);
  expect(request.trackFlowBoxes).toHaveLength(1);
  expect(request.trackFlowBoxes[0]!.sources.map((s) => s.id)).toEqual([
    secondTrackId,
  ]);
});
