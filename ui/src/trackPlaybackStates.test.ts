import { describe, expect, it } from "vitest";

import type { ParallelTrackPosition, TrackFlowPlaybackEvent } from "./bridge";
import type { ParallelTrackPatch } from "./patchIo";
import { trackFlowLaneId } from "./trackFlowBoxes";
import {
  TRACK_PLAYBACK_STATE_LABELS,
  trackPlaybackStates,
  type TrackPlaybackStateTrack,
} from "./trackPlaybackStates";

function track(
  id: string,
  overrides: Partial<TrackPlaybackStateTrack> = {}
): TrackPlaybackStateTrack {
  return {
    id,
    muted: false,
    soloed: false,
    trigger: null,
    ...overrides,
  };
}

function triggeredBy(sourceTrackId: string): ParallelTrackPatch["trigger"] {
  return { sourceTrackId } as ParallelTrackPatch["trigger"];
}

function row(trackId: string, cycle = 0): ParallelTrackPosition {
  return {
    trackIndex: 0,
    trackId,
    trackName: trackId,
    cycle,
    tickInCycle: 0,
    ticksPerCycle: 3840,
    referenceStartTick: cycle * 3840,
    referenceEndTick: (cycle + 1) * 3840,
  };
}

function laneChoice(
  boxId: string,
  sourceTrackId: string,
  cycle = 0
): TrackFlowPlaybackEvent {
  return {
    cycle,
    referenceStartTick: cycle * 3840,
    laneId: trackFlowLaneId(boxId),
    sourceTrackId,
    sourceTrackName: sourceTrackId,
  };
}

describe("trackPlaybackStates", () => {
  it("shows nothing while the transport is stopped", () => {
    const states = trackPlaybackStates({
      isPlaying: false,
      positions: [row("a")],
      trackFlowEvents: [],
      tracks: [track("a"), track("b", { muted: true })],
      boxes: [],
    });
    expect(states.get("a")).toBe("idle");
    expect(states.get("b")).toBe("idle");
  });

  it("single-track path: no position rows, the lone audible track sounds", () => {
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [],
      trackFlowEvents: [],
      tracks: [track("solo-track")],
      boxes: [],
    });
    expect(states.get("solo-track")).toBe("sounding");
  });

  it("parallel: rowed audible tracks sound, muted tracks are silenced", () => {
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row("a"), row("b")],
      trackFlowEvents: [],
      tracks: [track("a"), track("b"), track("c", { muted: true })],
      boxes: [],
    });
    expect(states.get("a")).toBe("sounding");
    expect(states.get("b")).toBe("sounding");
    expect(states.get("c")).toBe("silenced");
  });

  it("a muted trigger source of an audible follower is driving, not silenced", () => {
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row("follower")],
      trackFlowEvents: [],
      tracks: [
        track("clock", { muted: true }),
        track("follower", { trigger: triggeredBy("clock") }),
      ],
      boxes: [],
    });
    expect(states.get("clock")).toBe("driving");
    // The follower has a row → a launched run covers the playhead.
    expect(states.get("follower")).toBe("sounding");
  });

  it("a triggered follower without a row is armed (post stale-window fix)", () => {
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row("lead")],
      trackFlowEvents: [],
      tracks: [track("lead"), track("follower", { trigger: triggeredBy("lead") })],
      boxes: [],
    });
    expect(states.get("lead")).toBe("sounding");
    expect(states.get("follower")).toBe("armed");
  });

  it("solo hides non-soloed tracks unless they drive an audible follower", () => {
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row("follower")],
      trackFlowEvents: [],
      tracks: [
        track("clock"), // solo-hidden but needed by the soloed follower
        track("bystander"),
        track("follower", { soloed: true, trigger: triggeredBy("clock") }),
      ],
      boxes: [],
    });
    expect(states.get("clock")).toBe("driving");
    expect(states.get("bystander")).toBe("silenced");
    expect(states.get("follower")).toBe("sounding");
  });

  it("box members: the lane's current-cycle selection sounds, the rest wait", () => {
    const lane = trackFlowLaneId("main");
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row(lane, 3)],
      trackFlowEvents: [
        laneChoice("main", "m1", 2), // stale earlier cycle
        laneChoice("main", "m2", 3), // the lane's CURRENT cycle
      ],
      tracks: [track("m1"), track("m2"), track("m3", { muted: true })],
      boxes: [{ id: "main", memberTrackIds: ["m1", "m2", "m3"] }],
    });
    expect(states.get("m1")).toBe("waiting");
    expect(states.get("m2")).toBe("sounding");
    expect(states.get("m3")).toBe("silenced");
  });

  it("box members wait conservatively when only a stale cycle selection exists", () => {
    const lane = trackFlowLaneId("main");
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row(lane, 5)],
      trackFlowEvents: [laneChoice("main", "m1", 4)],
      tracks: [track("m1"), track("m2")],
      boxes: [{ id: "main", memberTrackIds: ["m1", "m2"] }],
    });
    expect(states.get("m1")).toBe("waiting");
    expect(states.get("m2")).toBe("waiting");
  });

  it("box members wait when the runtime is engaged but their lane has no row", () => {
    const states = trackPlaybackStates({
      isPlaying: true,
      positions: [row("elsewhere")],
      trackFlowEvents: [],
      tracks: [track("m1"), track("elsewhere")],
      boxes: [{ id: "empty-lane", memberTrackIds: ["m1"] }],
    });
    expect(states.get("m1")).toBe("waiting");
  });

  it("every state has a tooltip label (idle intentionally blank)", () => {
    expect(TRACK_PLAYBACK_STATE_LABELS.idle).toBe("");
    for (const state of [
      "sounding",
      "armed",
      "driving",
      "waiting",
      "silenced",
    ] as const) {
      expect(TRACK_PLAYBACK_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});
