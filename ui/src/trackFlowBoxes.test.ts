import { describe, expect, it } from "vitest";

import {
  boxForTrack,
  boxedTrackIdSet,
  defaultTrackFlowChain,
  isReservedTrackFlowId,
  trackFlowEntryKey,
  trackFlowLaneId,
  trackFlowSeedPathId,
  trackFlowSpecFromChain,
  trackFlowTransitionKey,
  type TrackFlowBox,
} from "./trackFlowBoxes";

const box = (id: string, memberTrackIds: string[]): TrackFlowBox => ({
  id,
  name: id.toUpperCase(),
  memberTrackIds,
  chain: defaultTrackFlowChain(),
  seed: 0,
  collapsed: false,
});

describe("Track Flow id helpers", () => {
  it("derives per-box lane and composite seed-path ids", () => {
    expect(trackFlowLaneId("main")).toBe("track-flow-main");
    expect(trackFlowLaneId("a")).toBe("track-flow-a");
    expect(trackFlowSeedPathId("main", "t3")).toBe("track-flow-main:t3");
    // The same source in two boxes never aliases.
    expect(trackFlowSeedPathId("a", "t3")).not.toBe(trackFlowSeedPathId("b", "t3"));
  });

  it("reserves the whole track-flow- family", () => {
    expect(isReservedTrackFlowId("track-flow-main")).toBe(true);
    expect(isReservedTrackFlowId("track-flow-anything:x")).toBe(true);
    expect(isReservedTrackFlowId("track-3")).toBe(false);
    expect(isReservedTrackFlowId("track-flo")).toBe(false);
  });
});

describe("box membership helpers", () => {
  it("collects all boxed track ids and finds a track's box", () => {
    const boxes = [box("a", ["t1", "t2"]), box("b", ["t3"])];
    expect([...boxedTrackIdSet(boxes)].sort()).toEqual(["t1", "t2", "t3"]);
    expect(boxForTrack(boxes, "t3")?.id).toBe("b");
    expect(boxForTrack(boxes, "nope")).toBeNull();
  });
});

describe("trackFlowSpecFromChain", () => {
  it("returns null for an unauthored chain (⇒ backend uniform default)", () => {
    expect(trackFlowSpecFromChain(defaultTrackFlowChain(), ["a", "b"])).toBeNull();
  });

  it("returns null when there are no audible members", () => {
    const chain = { ...defaultTrackFlowChain(), entryWeights: { a: 1 } };
    expect(trackFlowSpecFromChain(chain, [])).toBeNull();
  });

  it("indexes an authored chain in audible-member order", () => {
    const chain = {
      order: "first" as const,
      weights: {
        [trackFlowTransitionKey(["a"], "b")]: 2,
        [trackFlowTransitionKey(["b"], "a")]: 3,
      },
      entryWeights: { [trackFlowEntryKey(["a"])]: 1 },
      fallbackWeights: { b: 4 },
      fallback: "b",
    };
    const spec = trackFlowSpecFromChain(chain, ["a", "b"]);
    expect(spec).not.toBeNull();
    expect(spec!.stateCount).toBe(2);
    expect(spec!.transitions).toEqual([
      { from: [0], to: 1, weight: 2 },
      { from: [1], to: 0, weight: 3 },
    ]);
    expect(spec!.entryWeights).toEqual([{ states: [0], weight: 1 }]);
    expect(spec!.fallbackWeights).toEqual([{ state: 1, weight: 4 }]);
    expect(spec!.fallback).toBe(1);
  });

  it("drops transitions/entries referencing removed members and remaps fallback", () => {
    // Member `b` is no longer audible; only [a, c] remain.
    const chain = {
      order: "first" as const,
      weights: {
        [trackFlowTransitionKey(["a"], "b")]: 5, // dropped (target removed)
        [trackFlowTransitionKey(["a"], "c")]: 7, // kept, re-indexed
      },
      entryWeights: {
        [trackFlowEntryKey(["b"])]: 2, // dropped (state removed)
        [trackFlowEntryKey(["c"])]: 3, // kept
      },
      fallbackWeights: { b: 9 }, // dropped
      fallback: "b", // removed ⇒ remapped to 0
    };
    const spec = trackFlowSpecFromChain(chain, ["a", "c"]);
    expect(spec!.stateCount).toBe(2);
    expect(spec!.transitions).toEqual([{ from: [0], to: 1, weight: 7 }]);
    expect(spec!.entryWeights).toEqual([{ states: [1], weight: 3 }]);
    expect(spec!.fallbackWeights).toEqual([]);
    expect(spec!.fallback).toBe(0);
  });
});
