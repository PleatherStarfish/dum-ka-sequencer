import { describe, expect, it } from "vitest";

import {
  parallelRuntimeWouldEngage,
  shouldPushSingleTrackConfig,
  type AudibilityFlags,
} from "./playbackGating";

const t = (overrides: Partial<AudibilityFlags> = {}): AudibilityFlags => ({
  muted: false,
  soloed: false,
  ...overrides,
});

describe("parallelRuntimeWouldEngage", () => {
  it("a single track never engages the parallel runtime", () => {
    expect(parallelRuntimeWouldEngage([t()])).toBe(false);
    expect(parallelRuntimeWouldEngage([])).toBe(false);
  });

  it("two audible tracks engage the parallel runtime", () => {
    expect(parallelRuntimeWouldEngage([t(), t()])).toBe(true);
  });

  it("flip-flops: muting to one audible track drops out of parallel", () => {
    const tracks = [t(), t()];
    expect(parallelRuntimeWouldEngage(tracks)).toBe(true);
    tracks[1]!.muted = true;
    // The exact hazard P0.4 guards against: the derived value now says
    // single-track even though a parallel runtime may still be playing.
    expect(parallelRuntimeWouldEngage(tracks)).toBe(false);
  });

  it("keeps a multi-track project parallel for one audible custom-tempo track", () => {
    expect(
      parallelRuntimeWouldEngage([
        t({ tempoMode: "custom" }),
        t({ muted: true, tempoMode: "global" }),
      ])
    ).toBe(true);
  });

  it("solo filters to the soloed set; one soloed track is single-track", () => {
    expect(
      parallelRuntimeWouldEngage([t({ soloed: true }), t(), t()])
    ).toBe(false);
    expect(
      parallelRuntimeWouldEngage([t({ soloed: true }), t({ soloed: true }), t()])
    ).toBe(true);
  });
});

describe("shouldPushSingleTrackConfig", () => {
  it("allows the push for a genuine single-track project (stopped or playing)", () => {
    expect(
      shouldPushSingleTrackConfig({
        runtimeWouldEngageParallel: false,
        parallelRuntimePlaying: false,
      })
    ).toBe(true);
  });

  it("blocks the push while a parallel runtime is actually playing", () => {
    // Even if mute/solo makes the derived value say single-track, the pinned
    // "playing parallel" signal must keep the push blocked (no teardown).
    expect(
      shouldPushSingleTrackConfig({
        runtimeWouldEngageParallel: false,
        parallelRuntimePlaying: true,
      })
    ).toBe(false);
  });

  it("blocks the push while the current config would engage parallel (stopped staging)", () => {
    expect(
      shouldPushSingleTrackConfig({
        runtimeWouldEngageParallel: true,
        parallelRuntimePlaying: false,
      })
    ).toBe(false);
  });
});
