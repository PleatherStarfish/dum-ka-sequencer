// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_STOPPED_PREVIEW_CYCLE } from "../timelineModel";
import { StoppedPreviewCycleSelector } from "./TimelinePanel";

afterEach(cleanup);

describe("StoppedPreviewCycleSelector", () => {
  it("caps the displayed cycle and disables advancing at the stopped limit", () => {
    const setUserPreviewCycle = vi.fn();
    render(
      <StoppedPreviewCycleSelector
        displayedCycle={0}
        isPlaying={false}
        setUserPreviewCycle={setUserPreviewCycle}
        userPreviewCycle={Number.MAX_SAFE_INTEGER}
      />
    );

    expect(screen.getByText(String(MAX_STOPPED_PREVIEW_CYCLE))).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Inspect next stopped cycle",
      }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect previous stopped cycle" })
    );
    const update = setUserPreviewCycle.mock.calls[0]?.[0] as (
      cycle: number
    ) => number;
    expect(update(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_STOPPED_PREVIEW_CYCLE - 1
    );
  });

  it("clamps the next-cycle state update at the stopped limit", () => {
    const setUserPreviewCycle = vi.fn();
    render(
      <StoppedPreviewCycleSelector
        displayedCycle={0}
        isPlaying={false}
        setUserPreviewCycle={setUserPreviewCycle}
        userPreviewCycle={MAX_STOPPED_PREVIEW_CYCLE - 1}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect next stopped cycle" })
    );
    const update = setUserPreviewCycle.mock.calls[0]?.[0] as (
      cycle: number
    ) => number;
    expect(update(MAX_STOPPED_PREVIEW_CYCLE - 1)).toBe(
      MAX_STOPPED_PREVIEW_CYCLE
    );
    expect(update(MAX_STOPPED_PREVIEW_CYCLE)).toBe(MAX_STOPPED_PREVIEW_CYCLE);
  });
});
