/**
 * Tests for the Phase-E trigger timeline overlay selectors: pure renders of the
 * engine decision trace (no re-derivation), so the overlay can't drift.
 */
import { describe, expect, it } from "vitest";

import {
  filterTriggerDecisions,
  selectTriggerOverlayMarks,
  type TriggerOverlayDecisionLike,
} from "./timelineModel";

const RCT = 3840; // reference cycle ticks (4 beats × 960 PPQN)

function decision(
  overrides: Partial<TriggerOverlayDecisionLike> = {}
): TriggerOverlayDecisionLike {
  return {
    sourceCycleIndex: 0,
    matchedBeat: 3,
    eventTick: 2880, // beat 3
    candidateTick: 2880,
    outcome: "launched",
    suppressReason: null,
    startKind: "atEvent",
    rollValue: null,
    rollThreshold: null,
    ...overrides,
  };
}

describe("selectTriggerOverlayMarks", () => {
  it("returns nothing without a cycle length", () => {
    expect(
      selectTriggerOverlayMarks([decision()], { referenceCycleTicks: 0, showRejected: true })
    ).toEqual([]);
  });

  it("positions a mark by its reference-tick phase within the cycle", () => {
    const mark = selectTriggerOverlayMarks([decision()], {
      referenceCycleTicks: RCT,
      showRejected: false,
    })[0]!;
    // Beat 3 of a 4-beat cycle ⇒ phase 2880/3840 = 0.75 for both ends.
    expect(mark.placementFraction).toBeCloseTo(0.75, 5);
    expect(mark.eventFraction).toBeCloseTo(0.75, 5);
    expect(mark.outcome).toBe("launched");
  });

  it("separates the event onset from a displaced placement (the connector)", () => {
    // CenterInRest places the launch at the beat midpoint (3360) while the
    // matched onset stays at the beat start (2880).
    const mark = selectTriggerOverlayMarks(
      [decision({ candidateTick: 3360, startKind: "centerInRest" })],
      { referenceCycleTicks: RCT, showRejected: false }
    )[0]!;
    expect(mark.eventFraction).toBeCloseTo(2880 / RCT, 5);
    expect(mark.placementFraction).toBeCloseTo(3360 / RCT, 5);
    expect(mark.placementFraction).toBeGreaterThan(mark.eventFraction);
  });

  it("hides suppressed candidates unless inspecting", () => {
    const events = [
      decision({ outcome: "launched" }),
      decision({ outcome: "suppressed", suppressReason: "gateProbability", matchedBeat: 1 }),
    ];
    expect(
      selectTriggerOverlayMarks(events, { referenceCycleTicks: RCT, showRejected: false })
    ).toHaveLength(1);
    expect(
      selectTriggerOverlayMarks(events, { referenceCycleTicks: RCT, showRejected: true })
    ).toHaveLength(2);
  });

  it("keeps only the most recent maxMarks", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      decision({ sourceCycleIndex: i, eventTick: 2880 + i, candidateTick: 2880 + i })
    );
    const marks = selectTriggerOverlayMarks(events, {
      referenceCycleTicks: RCT,
      showRejected: true,
      maxMarks: 8,
    });
    expect(marks).toHaveLength(8);
    // The tail (most recent) is retained.
    expect(marks[marks.length - 1]!.sourceCycleIndex).toBe(49);
    expect(marks[0]!.sourceCycleIndex).toBe(42);
  });

  it("phase wraps non-negatively for ticks past the cycle", () => {
    const mark = selectTriggerOverlayMarks(
      [decision({ sourceCycleIndex: 2, eventTick: 2 * RCT + 960, candidateTick: 2 * RCT + 960 })],
      { referenceCycleTicks: RCT, showRejected: false }
    )[0]!;
    // (2*RCT + 960) mod RCT = 960 ⇒ phase 0.25.
    expect(mark.placementFraction).toBeCloseTo(0.25, 5);
  });

  it("keeps maxMarks bounded and wraps negative ticks non-negatively", () => {
    expect(
      selectTriggerOverlayMarks([decision()], {
        referenceCycleTicks: RCT,
        showRejected: true,
        maxMarks: 0,
      })
    ).toEqual([]);

    const mark = selectTriggerOverlayMarks(
      [decision({ eventTick: -1, candidateTick: -960 })],
      { referenceCycleTicks: RCT, showRejected: true, maxMarks: 1 }
    )[0]!;
    expect(mark.eventFraction).toBeCloseTo((RCT - 1) / RCT, 5);
    expect(mark.placementFraction).toBeCloseTo((RCT - 960) / RCT, 5);

    const nonFiniteLimit = selectTriggerOverlayMarks(
      Array.from({ length: 40 }, (_, i) => decision({ sourceCycleIndex: i })),
      { referenceCycleTicks: RCT, showRejected: true, maxMarks: Number.POSITIVE_INFINITY }
    );
    expect(nonFiniteLimit).toHaveLength(32);
  });
});

describe("filterTriggerDecisions", () => {
  const events = [
    decision({ outcome: "launched" }),
    decision({ outcome: "suppressed" }),
    decision({ outcome: "queued" }),
    decision({ outcome: "launched" }),
  ];

  it("returns a copy for 'all'", () => {
    const out = filterTriggerDecisions(events, "all");
    expect(out).toHaveLength(4);
    expect(out).not.toBe(events);
  });

  it("filters by outcome", () => {
    expect(filterTriggerDecisions(events, "launched")).toHaveLength(2);
    expect(filterTriggerDecisions(events, "suppressed")).toHaveLength(1);
    expect(filterTriggerDecisions(events, "queued")).toHaveLength(1);
  });
});
