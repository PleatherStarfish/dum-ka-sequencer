import { expect, test } from "@playwright/test";

import {
  fillNumeric,
  getDriverState,
  openCaesura,
  waitForPlaying,
} from "./support/appHarness";

/**
 * E2E for the Track Flow matrix modal (docs/TEST_COVERAGE_PLAN_2026-07.md
 * §2.3): assemble a two-member box (one member via drag-to-assign, one via the
 * Role picker), open its transition-matrix modal, author the box seed, a START
 * entry weight, and two transition weights, and assert the box lane in the
 * `parallel_set_playback` request carries the seed plus the authored chain
 * re-indexed to the members' `sources` order (`spec` is null until a weight is
 * authored, so its very presence proves the editor wrote through).
 */

test("edits a box's seed and chain matrix; both reach the box lane request", async ({
  page,
}) => {
  await openCaesura(page);
  await expect(page.locator(".parallel-track-cell")).toHaveCount(1);

  // Two more tracks (each creation activates the new track: track-3 ends up
  // active) and an empty draft box (deterministic id box-1, expanded).
  await page.getByRole("button", { name: "New track", exact: true }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(2);
  await page.getByRole("button", { name: "New track", exact: true }).click();
  await expect(page.locator(".parallel-track-cell")).toHaveCount(3);
  await page.getByTestId("track-flow-add-box").click();
  const box = page.getByTestId("track-flow-box-box-1");
  await expect(box).toBeVisible();

  // The matrix editor needs two members: drag track-2's tab into the box, then
  // move the active track-3 in via the Role picker (defaults to the first box).
  await page
    .getByTestId("parallel-track-cell-track-2")
    .locator(".parallel-track-tab")
    .dragTo(box);
  await expect(box.getByTestId("parallel-track-cell-track-2")).toBeVisible();
  await page.getByTestId("track-role-trackFlow").check();
  await expect(box.getByTestId("parallel-track-cell-track-3")).toBeVisible();

  // Open the transition-matrix modal.
  await page.getByTestId("track-flow-box-matrix-box-1").click();
  const modal = page.getByTestId("track-flow-matrix-modal");
  await expect(modal).toBeVisible();

  // Box seed (plain number input, commits per change).
  await modal.getByTestId("track-flow-box-seed").fill("777");
  await expect(modal.getByTestId("track-flow-box-seed")).toHaveValue("777");

  // Chain editor: one START weight and both cross transitions. Members are
  // addressed by aria-label prefix so the spec is independent of track names.
  const chainEditor = modal.getByTestId("track-flow-chain-editor");
  await expect(chainEditor).toBeVisible();
  const startWeights = chainEditor.locator('[aria-label^="Start weight for"]');
  await expect(startWeights).toHaveCount(2);
  await fillNumeric(startWeights.first(), 5);
  const transitions = chainEditor.locator(
    '[aria-label^="Transition weight from"]'
  );
  await expect(transitions).toHaveCount(4);
  // Row-major 2×2 grid: nth(1) = member1→member2, nth(2) = member2→member1.
  await fillNumeric(transitions.nth(1), 4);
  await fillNumeric(transitions.nth(2), 3);

  await modal.getByRole("button", { name: "Close transition matrix" }).click();
  await expect(modal).toHaveCount(0);

  // Play, then inspect the request the backend actually received.
  await page.getByTestId("transport-play").click();
  await waitForPlaying(page);

  const driver = await getDriverState(page);
  const request = driver.lastParallelPlaybackRequest as {
    tracks: Array<{ id: string }>;
    trackFlowBoxes: Array<{
      id: string;
      name: string;
      seed: number;
      sources: Array<{ id: string }>;
      spec: null | {
        order: string;
        stateCount: number;
        transitions: Array<{ from: number[]; to: number; weight: number }>;
        entryWeights: Array<{ states: number[]; weight: number }>;
        fallback: number;
        fallbackWeights: unknown[];
      };
    }>;
  };

  // The two members live in the box lane, not the parallel participant list.
  expect(request.tracks.map((track) => track.id)).toEqual(["track-1"]);
  expect(request.trackFlowBoxes).toHaveLength(1);
  const lane = request.trackFlowBoxes[0]!;
  expect(lane.id).toBe("box-1");
  expect(lane.seed).toBe(777);
  expect(lane.sources.map((source) => source.id)).toEqual([
    "track-2",
    "track-3",
  ]);

  // The authored chain arrives re-indexed to sources order (track-2 → 0,
  // track-3 → 1); zero-weight cells are omitted.
  expect(lane.spec).not.toBeNull();
  expect(lane.spec!.order).toBe("first");
  expect(lane.spec!.stateCount).toBe(2);
  expect(lane.spec!.entryWeights).toEqual([{ states: [0], weight: 5 }]);
  expect(lane.spec!.transitions).toHaveLength(2);
  expect(lane.spec!.transitions).toEqual(
    expect.arrayContaining([
      { from: [0], to: 1, weight: 4 },
      { from: [1], to: 0, weight: 3 },
    ])
  );
});
