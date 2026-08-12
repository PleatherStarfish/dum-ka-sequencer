// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LivePositionSample } from "../bridge";
import {
  LiveTransportReadout,
  liveTransportReadoutText,
} from "./LiveTransportReadout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const live: LivePositionSample = {
  receivedAt: 1_000,
  position: {
    sampleEpoch: 1,
    timelineEpoch: 1,
    isPlaying: true,
    tempoBpm: 120,
    currentTick: 100,
    currentCycle: 2,
    ticksPerCycle: 1_920,
    currentScoreId: "score",
    parallelTrackPositions: [],
  },
};

describe("LiveTransportReadout", () => {
  it("dead-reckons the visible tick without publishing App state", () => {
    expect(liveTransportReadoutText(live, null, 1_100)).toBe(
      "Cycle 2 · tick 292/1920"
    );
  });

  it("updates its own text node from animation frames", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(1_100);
    const livePositionRef = { current: live };

    render(
      <LiveTransportReadout
        playing
        livePositionRef={livePositionRef}
        activeTrackId={null}
        fallbackCycle={2}
        fallbackTick={100}
        fallbackTicksPerCycle={1_920}
      />
    );
    expect(screen.getByText("Cycle 2 · tick 100/1920")).toBeTruthy();

    act(() => frame?.(1_100));
    expect(screen.queryByText("Cycle 2 · tick 100/1920")).toBeNull();
    expect(document.body.textContent).toContain("Cycle 2 · tick 292/1920");
  });
});
