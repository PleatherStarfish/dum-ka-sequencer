import { describe, expect, it } from "vitest";

import {
  PLAYBACK_PENDING_TITLE,
  PLAYBACK_READY_TITLE,
  selectCurrentGeneratorPreviewFailure,
  selectPlaybackAvailability,
  type GeneratorPreviewFailure,
} from "./playbackAvailability";

const FAILURE: GeneratorPreviewFailure = {
  requestKey: "request-a",
  cycle: 3,
  message:
    "dumka structure mismatch: pattern needs Subdivision 5 (or a multiple); the section has 4",
};

const blockedInput = (overrides: Partial<Parameters<typeof selectPlaybackAvailability>[0]> = {}) => ({
  canStartPlayback: false,
  generatorEnabled: true,
  failure: FAILURE,
  currentRequestKey: FAILURE.requestKey,
  currentCycle: FAILURE.cycle,
  ...overrides,
});

describe("selectCurrentGeneratorPreviewFailure", () => {
  it("returns the enabled generator failure for its exact request and cycle", () => {
    expect(
      selectCurrentGeneratorPreviewFailure({
        failure: FAILURE,
        currentRequestKey: FAILURE.requestKey,
        currentCycle: FAILURE.cycle,
        generatorEnabled: true,
      })
    ).toBe(FAILURE);
  });

  it("rejects stale request and cycle failures", () => {
    expect(
      selectCurrentGeneratorPreviewFailure({
        failure: FAILURE,
        currentRequestKey: "request-b",
        currentCycle: FAILURE.cycle,
        generatorEnabled: true,
      })
    ).toBeNull();
    expect(
      selectCurrentGeneratorPreviewFailure({
        failure: FAILURE,
        currentRequestKey: FAILURE.requestKey,
        currentCycle: FAILURE.cycle + 1,
        generatorEnabled: true,
      })
    ).toBeNull();
  });

  it("ignores absent failures and failures for a disabled generator", () => {
    expect(
      selectCurrentGeneratorPreviewFailure({
        failure: null,
        currentRequestKey: FAILURE.requestKey,
        currentCycle: FAILURE.cycle,
        generatorEnabled: true,
      })
    ).toBeNull();
    expect(
      selectCurrentGeneratorPreviewFailure({
        failure: FAILURE,
        currentRequestKey: FAILURE.requestKey,
        currentCycle: FAILURE.cycle,
        generatorEnabled: false,
      })
    ).toBeNull();
  });
});

describe("selectPlaybackAvailability", () => {
  it("keeps the existing gate authoritative when playback can start", () => {
    expect(
      selectPlaybackAvailability(blockedInput({ canStartPlayback: true }))
    ).toEqual({
      kind: "ready",
      title: PLAYBACK_READY_TITLE,
      message: null,
    });
  });

  it("uses the existing waiting copy while the current render is pending", () => {
    expect(selectPlaybackAvailability(blockedInput({ failure: null }))).toEqual({
      kind: "pending",
      title: PLAYBACK_PENDING_TITLE,
      message: null,
    });
  });

  it("carries the current engine rejection into the title and visible message", () => {
    expect(selectPlaybackAvailability(blockedInput())).toEqual({
      kind: "rejected",
      title: `Playback blocked: ${FAILURE.message}`,
      message: FAILURE.message,
    });
  });

  it("treats stale request and cycle failures as pending", () => {
    expect(
      selectPlaybackAvailability(
        blockedInput({ currentRequestKey: "corrected-pattern-request" })
      )
    ).toEqual({
      kind: "pending",
      title: PLAYBACK_PENDING_TITLE,
      message: null,
    });
    expect(
      selectPlaybackAvailability(blockedInput({ currentCycle: FAILURE.cycle + 1 }))
    ).toEqual({
      kind: "pending",
      title: PLAYBACK_PENDING_TITLE,
      message: null,
    });
  });

  it("does not call a disabled generator's validation error playback-blocking", () => {
    expect(
      selectPlaybackAvailability(blockedInput({ generatorEnabled: false }))
    ).toEqual({
      kind: "pending",
      title: PLAYBACK_PENDING_TITLE,
      message: null,
    });
  });

  it("moves from rejection through a corrected request to ready without stale copy", () => {
    const rejected = selectPlaybackAvailability(blockedInput());
    const correctedPending = selectPlaybackAvailability(
      blockedInput({ currentRequestKey: "corrected-pattern-request" })
    );
    const recovered = selectPlaybackAvailability(
      blockedInput({
        canStartPlayback: true,
        currentRequestKey: "corrected-pattern-request",
      })
    );

    expect(rejected.kind).toBe("rejected");
    expect(correctedPending).toEqual({
      kind: "pending",
      title: PLAYBACK_PENDING_TITLE,
      message: null,
    });
    expect(recovered).toEqual({
      kind: "ready",
      title: PLAYBACK_READY_TITLE,
      message: null,
    });
  });
});
