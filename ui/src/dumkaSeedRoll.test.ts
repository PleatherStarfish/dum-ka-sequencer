import { describe, expect, it } from "vitest";

import {
  analyzeDumkaPattern,
  compileDumkaPattern,
  deriveDumkaBeatSlotCounts,
} from "./dumkaPattern";
import {
  burstMask,
  rollEuclideanSeed,
  type SeedRollOptions,
} from "./dumkaSeedRoll";

function options(overrides: Partial<SeedRollOptions> = {}): SeedRollOptions {
  return {
    slotsPerBeat: [8, 8, 8, 8],
    density: "medium",
    style: "plain",
    restPolicy: "tied",
    ...overrides,
  };
}

function derivedSlots(pattern: string): number[] {
  const analysis = deriveDumkaBeatSlotCounts(pattern);
  if (!analysis.ok) {
    throw new Error(
      `rolled pattern failed at ${analysis.issue.line}:${analysis.issue.col}: ${analysis.issue.message}`
    );
  }
  return analysis.slotsPerBeat;
}

describe("dumkaSeedRoll", () => {
  it("mirrors the Caesura burst mask on the published worked example", () => {
    const asString = (mask: boolean[]) =>
      mask.map((bit) => (bit ? "1" : "0")).join("");
    // moinsound 2022: (5, 13, 3) — pinned upstream in the platform masks.
    expect(asString(burstMask(5, 13, 3))).toBe("1110000110000");
    // max_run 1 reduces to plain Bjorklund.
    expect(asString(burstMask(3, 8, 1))).toBe("10010010");
  });

  it("is deterministic per roll seed and diverges across seeds", () => {
    const opts = options();
    expect(rollEuclideanSeed(7, opts)).toBe(rollEuclideanSeed(7, opts));
    expect(rollEuclideanSeed(7, opts)).not.toBe(rollEuclideanSeed(8, opts));
  });

  it("emits readable E(k,n,r) sugar for the plain style", () => {
    const pattern = rollEuclideanSeed(7, options());
    expect(pattern).toMatch(/^E\(\d+,8(,\d+)?\)( E\(\d+,8(,\d+)?\)){3}$/);
    const analysis = analyzeDumkaPattern(pattern);
    expect(analysis.ok && analysis.required).toEqual({
      cycleBeats: 4,
      subdivision: 8,
      workingSubdivision: 8,
    });
  });

  it("expands burst and inverted styles into per-beat groups that parse", () => {
    for (const style of ["bursts", "inverted"] as const) {
      for (const rollSeed of [1, 2, 3, 11, 29]) {
        const pattern = rollEuclideanSeed(rollSeed, options({ style }));
        expect(pattern.startsWith("[")).toBe(true);
        const compiled = compileDumkaPattern(pattern);
        if (!compiled.ok) {
          throw new Error(
            `${style} roll ${rollSeed} failed to parse: ${compiled.issue.message} in ${pattern}`
          );
        }
        expect(compiled.compiled.totalBeats).toBe(4);
      }
    }
  });

  it("honors the rest policy in expanded styles", () => {
    const tied = rollEuclideanSeed(5, options({ style: "bursts", restPolicy: "tied" }));
    const silent = rollEuclideanSeed(
      5,
      options({ style: "bursts", restPolicy: "silent" })
    );
    expect(tied).toContain("_");
    expect(silent).not.toContain("_");
  });

  it("repairs a tied expanded mask deterministically when holds hide its grid", () => {
    const opts = options({
      slotsPerBeat: [5, 4, 1, 1],
      density: "sparse",
      style: "bursts",
      restPolicy: "tied",
    });
    const first = rollEuclideanSeed(0, opts);
    expect(first).toBe(rollEuclideanSeed(0, opts));
    expect(first).toContain("_");
    expect(derivedSlots(first)).toEqual([5, 4, 1, 1]);
  });

  it("tracks density bands", () => {
    const sparse = compileDumkaPattern(
      rollEuclideanSeed(3, options({ density: "sparse" }))
    );
    const dense = compileDumkaPattern(
      rollEuclideanSeed(3, options({ density: "dense" }))
    );
    if (!sparse.ok || !dense.ok) throw new Error("rolls parse");
    expect(sparse.compiled.events.length).toBeLessThan(
      dense.compiled.events.length
    );
  });

  it("preserves heterogeneous local grids in every style and rest policy", () => {
    const source = "[x x x x x] [x . x .] x x";
    const sourceAnalysis = deriveDumkaBeatSlotCounts(source);
    if (!sourceAnalysis.ok) throw new Error("source pattern must compile");
    expect(sourceAnalysis.slotsPerBeat).toEqual([5, 4, 1, 1]);

    for (const style of ["plain", "bursts", "inverted"] as const) {
      for (const restPolicy of ["silent", "tied"] as const) {
        for (const density of ["sparse", "medium", "dense"] as const) {
          // These seeds include the tied-mask collapses that originally
          // produced `[x _ _ _ _]` (Subdivision 1) from a five-slot beat.
          for (const rollSeed of [0, 1, 2, 5, 6, 12, 42, 99]) {
            const pattern = rollEuclideanSeed(
              rollSeed,
              options({
                slotsPerBeat: sourceAnalysis.slotsPerBeat,
                style,
                restPolicy,
                density,
              })
            );
            const rolledAnalysis = deriveDumkaBeatSlotCounts(pattern);
            if (!rolledAnalysis.ok) {
              throw new Error(
                `${style}/${restPolicy}/${density}/${rollSeed}: ${rolledAnalysis.issue.message} in ${pattern}`
              );
            }
            // Global LCM equality alone would miss the bug: [20,20,20,20]
            // also needs Subdivision 20. Pin the full per-beat vector first.
            expect(
              rolledAnalysis.slotsPerBeat,
              `${style}/${restPolicy}/${density}/${rollSeed}: ${pattern}`
            ).toEqual(sourceAnalysis.slotsPerBeat);
            expect(rolledAnalysis.required).toEqual(sourceAnalysis.required);
          }
        }
      }
    }
  });

  it("pins the semantically changed heterogeneous roll", () => {
    // This pin intentionally changed when the roller stopped flattening every
    // beat onto the source pattern's cycle-wide LCM grid.
    expect(
      rollEuclideanSeed(1, options({ slotsPerBeat: [5, 4, 1, 1] }))
    ).toBe(
      "E(3,5,4) E(1,4,3) E(1,1) E(1,1)"
    );
  });

  it("uses only the platform beat and Subdivision clamps", () => {
    const tooManyBeats = rollEuclideanSeed(
      3,
      options({ slotsPerBeat: Array<number>(129).fill(1) })
    );
    const beatAnalysis = deriveDumkaBeatSlotCounts(tooManyBeats);
    if (!beatAnalysis.ok) throw new Error(beatAnalysis.issue.message);
    expect(beatAnalysis.required.cycleBeats).toBe(128);
    expect(beatAnalysis.slotsPerBeat).toEqual(Array<number>(128).fill(1));

    const oversizedSubdivision = rollEuclideanSeed(
      3,
      options({ slotsPerBeat: [128] })
    );
    expect(derivedSlots(oversizedSubdivision)).toEqual([64]);

    const minimums = rollEuclideanSeed(
      3,
      options({ slotsPerBeat: [0, -4, Number.NaN] })
    );
    expect(derivedSlots(minimums)).toEqual([1, 1, 1]);
    expect(derivedSlots(rollEuclideanSeed(3, options({ slotsPerBeat: [] })))).toEqual([
      1,
    ]);
  });
});
