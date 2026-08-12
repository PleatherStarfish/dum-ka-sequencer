import { describe, expect, it } from "vitest";

import type { PulseSpan } from "./bridge";
import { accentLaneChoice } from "./components/TimelineLanes";

function span(kind: PulseSpan["kind"]): PulseSpan {
  return {
    id: 1,
    kind,
    sectionIndex: 0,
    beat: null,
    gati: null,
    jathi: null,
    index: null,
    start: 0,
    duration: 1,
    startMatra: 0,
    matraLen: 1,
    subdivision: 1,
    protectedCuts: [],
    tags: [],
    matraVelocities: [],
  };
}

describe("accentLaneChoice", () => {
  it("labels a grouping section", () => {
    expect(accentLaneChoice([span("jathiPulse")])).toEqual({
      kind: "jathiPulse",
      label: "gen · grouping",
    });
  });

  it("falls back to the gati beat row when neither accent layer is active", () => {
    expect(accentLaneChoice([span("gatiBeat")]).kind).toBe("gatiBeat");
  });
});
