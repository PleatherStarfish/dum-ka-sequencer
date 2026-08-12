import { describe, expect, it } from "vitest";

import type { PitchState, RhythmPattern } from "./bridge";
import { patternKey, pitchName } from "./patchIo";
import {
  channelContexts,
  channelWeightKey,
  channelWeightShare,
  channelWeightValue,
  defaultChannelWeight,
  defaultPitchWeight,
  defaultRhythmWeight,
  isWholeCellPattern,
  pitchContexts,
  pitchTargetLabel,
  pitchTargetsForStates,
  pitchWeightShare,
  rhythmContexts,
  rhythmWeightKey,
  rhythmWeightShare,
  rhythmWeightValue,
} from "./markovWeights";

const states: RhythmPattern[] = [{ pulses: [2, 2] }, { pulses: [4] }];

describe("rhythm helpers", () => {
  it("detects a whole-cell pattern", () => {
    expect(isWholeCellPattern({ pulses: [4] }, 4)).toBe(true);
    expect(isWholeCellPattern({ pulses: [2, 2] }, 4)).toBe(false);
    expect(isWholeCellPattern({ pulses: [4] }, 3)).toBe(false);
  });

  it("enumerates contexts by order", () => {
    expect(rhythmContexts(2, "first")).toEqual([[0], [1]]);
    expect(rhythmContexts(2, "second")).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  });

  it("builds a stable weight key", () => {
    expect(rhythmWeightKey(4, "first", ["a"], "b")).toBe("4:first:a:b");
  });

  it("defaults to staying on the last state, or 1 from the zero context", () => {
    expect(defaultRhythmWeight([0], 0)).toBe(1);
    expect(defaultRhythmWeight([1], 1)).toBe(1);
    expect(defaultRhythmWeight([1], 0)).toBe(0);
  });

  it("reads explicit weights, else the default", () => {
    expect(rhythmWeightValue({}, 4, "first", [0], 0, states)).toBe(1);
    const key = rhythmWeightKey(
      4,
      "first",
      [patternKey(states[0]!)],
      patternKey(states[1]!)
    );
    expect(rhythmWeightValue({ [key]: 5 }, 4, "first", [0], 1, states)).toBe(5);
  });

  it("normalizes a row into shares", () => {
    // From the all-zero context both defaults are 1 → equal shares.
    expect(rhythmWeightShare({}, 4, "first", [0], 0, states)).toBe(0.5);
  });
});

describe("channel helpers", () => {
  it("enumerates contexts and keys", () => {
    expect(channelContexts([1, 2], "first")).toEqual([[1], [2]]);
    expect(channelContexts([1, 2], "second")).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ]);
    expect(channelWeightKey("first", [1], 2)).toBe("first:1:2");
  });

  it("defaults to the next channel in rotation", () => {
    expect(defaultChannelWeight([1, 2, 3], [1], 2)).toBe(1);
    expect(defaultChannelWeight([1, 2, 3], [1], 3)).toBe(0);
    expect(defaultChannelWeight([1, 2, 3], [3], 1)).toBe(1);
  });

  it("reads explicit weights and shares", () => {
    expect(channelWeightValue({}, [1, 2], "first", [1], 2)).toBe(1);
    expect(channelWeightValue({ "first:1:2": 4 }, [1, 2], "first", [1], 2)).toBe(4);
    expect(channelWeightShare({}, [1, 2], "first", [1], 2)).toBe(1);
  });
});

describe("pitch helpers", () => {
  const pitchStates: PitchState[] = [
    { pitch: 60, label: "" },
    { pitch: 64, label: "third" },
  ];

  it("labels targets", () => {
    expect(pitchTargetLabel({ label: "named", kind: { type: "absolute", pitch: 60 } })).toBe(
      "named"
    );
    expect(pitchTargetLabel({ label: "", kind: { type: "absolute", pitch: 60 } })).toBe(
      pitchName(60)
    );
    expect(
      pitchTargetLabel({ label: "", kind: { type: "relativeChromatic", steps: 2 } })
    ).toBe("+2 semi");
    expect(
      pitchTargetLabel({ label: "", kind: { type: "relativeCollection", steps: -1 } })
    ).toBe("-1 step");
  });

  it("builds absolute targets per state plus the relative moves", () => {
    const targets = pitchTargetsForStates(pitchStates);
    expect(targets).toHaveLength(pitchStates.length + 8);
    expect(targets[0]).toEqual({
      label: pitchName(60),
      kind: { type: "absolute", pitch: 60 },
    });
  });

  it("enumerates contexts", () => {
    expect(pitchContexts(pitchStates, "first")).toEqual([[0], [1]]);
  });

  it("defaults +1 step to weight 1", () => {
    const targets = pitchTargetsForStates(pitchStates);
    const plusOne = targets.findIndex(
      (t) => t.kind.type === "relativeCollection" && t.kind.steps === 1
    );
    expect(defaultPitchWeight(pitchStates, targets, [0], plusOne)).toBe(1);
  });

  it("produces a normalized share", () => {
    const targets = pitchTargetsForStates(pitchStates);
    const share = pitchWeightShare({}, pitchStates, targets, "first", [0], 0);
    expect(share).toBeGreaterThanOrEqual(0);
    expect(share).toBeLessThanOrEqual(1);
  });
});
