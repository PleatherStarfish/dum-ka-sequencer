import { describe, expect, it } from "vitest";
import {
  gatePosition,
  initialGateState,
  promoteTimeline,
  type PositionGateState,
} from "./telemetryGating";
import type { LivePositionSample, TransportPosition } from "./bridge";

function position(timelineEpoch: number, currentTick: number): TransportPosition {
  return {
    sampleEpoch: timelineEpoch * 100 + currentTick,
    timelineEpoch,
    tempoBpm: 80,
    isPlaying: true,
    currentTick,
    currentCycle: 0,
    ticksPerCycle: 3840,
    currentScoreId: "s",
    parallelTrackPositions: [],
  };
}

function derived(timelineEpoch: number, receivedAt: number): LivePositionSample {
  return { position: position(timelineEpoch, 0), receivedAt };
}

describe("telemetry position gating", () => {
  it("applies a position whose timeline epoch matches the hydrated/promoted grid", () => {
    // Mirrors the initial-load epoch-coherence requirement: after hydrate sets
    // the promoted epoch, the first stream position at that epoch is applied.
    let state: PositionGateState = { ...initialGateState(), promotedTimelineEpoch: 5 };
    state = gatePosition(state, position(5, 120), 1000);
    expect(state.live?.position.currentTick).toBe(120);
    expect(state.pending).toBeNull();
  });

  it("drops a stale position from an older grid after a newer grid promoted", () => {
    let state: PositionGateState = { ...initialGateState(), promotedTimelineEpoch: 6 };
    const before = state.live;
    state = gatePosition(state, position(5, 999), 1000);
    expect(state.live).toBe(before); // unchanged — stale position ignored
  });

  it("buffers a too-new position, then applies it when the matching grid promotes", () => {
    let state: PositionGateState = { ...initialGateState(), promotedTimelineEpoch: 5 };
    // Position for epoch 6 arrives before its timeline snapshot.
    state = gatePosition(state, position(6, 42), 1000);
    expect(state.live).toBeNull(); // not applied yet
    expect(state.pending?.position.timelineEpoch).toBe(6);
    expect(state.pendingSince).toBe(1000);

    // The matching timeline snapshot promotes → buffered position is applied
    // (preferred over the snapshot-derived anchor, since it's fresher).
    state = promoteTimeline(state, 6, derived(6, 2000));
    expect(state.promotedTimelineEpoch).toBe(6);
    expect(state.live?.position.currentTick).toBe(42);
    expect(state.live?.receivedAt).toBe(1000);
    expect(state.pending).toBeNull();
    expect(state.pendingSince).toBe(0);
  });

  it("keeps only the latest too-new position while buffering", () => {
    let state: PositionGateState = { ...initialGateState(), promotedTimelineEpoch: 5 };
    state = gatePosition(state, position(6, 1), 1000);
    state = gatePosition(state, position(6, 2), 1016);
    expect(state.pending?.position.currentTick).toBe(2);
    expect(state.pendingSince).toBe(1000); // first-stall timestamp retained
  });

  it("falls back to the snapshot-derived anchor when no buffered position matches", () => {
    let state: PositionGateState = { ...initialGateState(), promotedTimelineEpoch: 5 };
    state = promoteTimeline(state, 6, derived(6, 2000));
    expect(state.live?.receivedAt).toBe(2000);
    expect(state.promotedTimelineEpoch).toBe(6);
  });
});
