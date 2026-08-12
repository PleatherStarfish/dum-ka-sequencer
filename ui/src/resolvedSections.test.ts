import { describe, expect, it } from "vitest";

import type { PulseSpan } from "./bridge";
import {
  groupResolvedSections,
  pulseSpanLabel,
  sectionPulseSpans,
  type ResolvedBeatView,
} from "./resolvedSections";
import { isValidGroupingChoice } from "./sectionsSubdivisionsLogic";

function span(partial: Partial<PulseSpan>): PulseSpan {
  return {
    id: 0,
    kind: "section",
    sectionIndex: 0,
    beat: null,
    gati: null,
    jathi: null,
    index: null,
    start: 0,
    duration: 1,
    startMatra: 0,
    matraLen: 4,
    subdivision: 4,
    protectedCuts: [],
    tags: [],
    matraVelocities: [],
    ...partial,
  };
}

describe("pulseSpanLabel", () => {
  it("labels subdivision beats, with a custom-division variant", () => {
    expect(pulseSpanLabel(span({ kind: "gatiBeat", beat: 2, matraLen: 4 }))).toBe(
      "subdivision beat 2 · 4 pulses"
    );
    expect(
      pulseSpanLabel(
        span({ kind: "gatiBeat", beat: 2, gati: 5, matraLen: 5, tags: ["custom-division"] })
      )
    ).toBe("part 2 · subdivision 5 · 5 pulses");
  });

  it("labels grouping pulses and sections", () => {
    expect(
      pulseSpanLabel(span({ kind: "jathiPulse", jathi: 4, index: 2, matraLen: 3 }))
    ).toBe("grouping 4 pulse 2 · 3 pulses");
    expect(pulseSpanLabel(span({ kind: "section", sectionIndex: 1, matraLen: 8 }))).toBe(
      "section 1 · 8 pulses"
    );
  });
});

describe("sectionPulseSpans", () => {
  it("filters spans by section index", () => {
    const spans = [
      span({ id: 1, sectionIndex: 0 }),
      span({ id: 2, sectionIndex: 1 }),
      span({ id: 3, sectionIndex: 1 }),
    ];
    expect(sectionPulseSpans(spans, 1).map((s) => s.id)).toEqual([2, 3]);
    expect(sectionPulseSpans(spans, 5)).toEqual([]);
  });
});

describe("groupResolvedSections", () => {
  it("uses the whole custom equal-parts section as the jathi timing frame", () => {
    const beats: ResolvedBeatView[] = Array.from({ length: 4 }, (_, index) => ({
      beat: index + 1,
      gati: 3,
      effectiveGati: 3,
      gatiSpeedMultiplier: null,
      startAkshara: index,
      endAkshara: index + 1,
      divisionIndex: index + 1,
      divisionCount: 4,
      sectionIndex: 0,
      jathi: 6,
      sectionStart: index === 0,
      accentVelocity: 100,
      pitch: 60,
      baseVelocity: 100,
      automationPhase: null,
      automationValues: [],
    }));
    const spans: PulseSpan[] = [
      span({ id: 1, kind: "section", duration: 4, matraLen: 12 }),
      ...Array.from({ length: 4 }, (_, index) =>
        span({
          id: index + 2,
          kind: "gatiBeat",
          beat: index + 1,
          gati: 3,
          start: index,
          duration: 1,
          startMatra: index * 3,
          matraLen: 3,
          tags: ["custom-division"],
        })
      ),
    ];

    const [section] = groupResolvedSections(beats, spans);

    expect(section?.customSubdivision).toBe(true);
    expect(section?.timingMatras).toBe(12);
    expect(section?.gatiTimingFrameMatras).toBe(12);
    expect(section?.gatiTimingFrameBeats).toBe(4);
    expect(
      isValidGroupingChoice(
        6,
        section?.timingMatras,
        section?.gatiTimingFrameMatras
      )
    ).toBe(true);
  });
});
